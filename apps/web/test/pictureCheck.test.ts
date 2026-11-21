import { describe, expect, test } from 'vitest';
import { choiceFor, choiceHelp, type EngineReport } from '../src/lib/analyses';
import { createApi } from '../src/lib/api';
import {
  enginesToCheck,
  pictureCheckLine,
  seeingEngines,
  withCheck,
  type PictureCheck,
} from '../src/lib/pictureCheck';

const passed: PictureCheck = {
  engine: 'agy',
  passed: true,
  answer: 'red, blue',
  shown: ['red', 'blue'],
  checkedAt: '2026-11-21T10:00:00.000Z',
};
const failed: PictureCheck = { ...passed, passed: false, answer: 'I cannot open images.' };
const report = (checks?: readonly PictureCheck[]): EngineReport => ({
  engines: [],
  order: ['claude', 'agy', 'codex'],
  ...(checks ? { pictureChecks: checks } : {}),
});

describe('seeingEngines', () => {
  test('is Claude Code and Codex until another engine passes the picture check', () => {
    expect(seeingEngines(null)).toEqual(['claude', 'codex']);
    expect(seeingEngines(report())).toEqual(['claude', 'codex']);
    expect(seeingEngines(report([failed]))).toEqual(['claude', 'codex']);
    expect(seeingEngines(report([passed]))).toEqual(['claude', 'codex', 'agy']);
  });
});

describe('enginesToCheck', () => {
  test('lists the engines in use that are not known to see pictures, with their last check', () => {
    expect(enginesToCheck(report([failed]))).toEqual([{ engine: 'agy', check: failed }]);
    expect(enginesToCheck(report())).toEqual([{ engine: 'agy', check: null }]);
    expect(enginesToCheck({ engines: [], order: ['claude'] })).toEqual([]);
    expect(enginesToCheck(null)).toEqual([]);
  });
});

describe('pictureCheckLine', () => {
  test('says what a pass allows', () => {
    expect(pictureCheckLine(passed)).toBe('Sees pictures: picture questions can use it.');
  });

  test('quotes what the engine said when it did not see them, and what was shown', () => {
    expect(pictureCheckLine(failed)).toBe(
      'Did not see the pictures: it answered “I cannot open images.” The pictures were red and blue.',
    );
    expect(pictureCheckLine({ ...failed, answer: '' })).toMatch(/it gave no answer/);
  });

  test('says nothing before a check', () => {
    expect(pictureCheckLine(null)).toBe('');
  });
});

describe('withCheck', () => {
  test('puts a new result in place of the engine’s last, leaving the report as it was', () => {
    const before = report([failed]);
    const after = withCheck(before, passed);
    expect(after?.pictureChecks).toEqual([passed]);
    expect(before.pictureChecks).toEqual([failed]);
    expect(withCheck(null, passed)).toBeNull();
  });
});

describe('a picture question asked of Antigravity', () => {
  test('goes to Claude Code or Codex, saying why and what to do, until it passes the check', () => {
    expect(choiceFor('thumbnails', 'agy', report([failed]))).toEqual({
      choice: 'auto',
      note: 'Antigravity has not passed the picture check yet, so this one goes to Claude Code, or else Codex. Run the check in Settings to let Antigravity do it.',
    });
  });

  test('stays with Antigravity once it has passed', () => {
    expect(choiceFor('thumbnails', 'agy', report([passed]))).toEqual({ choice: 'agy', note: null });
  });

  test('the switch’s help names the check only while it has not passed', () => {
    const ready = {
      ...report(),
      engines: [
        {
          id: 'agy',
          label: 'Antigravity',
          installed: true,
          signedIn: null,
          version: '1',
          ready: true,
          note: null,
        },
      ],
    } as const;
    expect(choiceHelp('agy', ready)).toMatch(/needs Claude Code or Codex until Antigravity passes/);
    expect(choiceHelp('agy', { ...ready, pictureChecks: [passed] })).toBe(
      'Only Antigravity answers; nothing else is tried if it cannot.',
    );
  });
});

describe('the picture check call of the API client', () => {
  test('asks the server to check one engine and returns the result', async () => {
    // Arrange
    const sent: string[] = [];
    const api = createApi(async (url, init) => {
      sent.push(`${String(init?.method)} ${String(url)} ${String(init?.body)}`);
      return new Response(JSON.stringify({ success: true, data: passed, error: null }));
    });

    // Act
    const result = await api.checkPictures('agy');

    // Assert
    expect(result).toEqual(passed);
    expect(sent).toEqual(['POST /api/engines/picture-check {"engine":"agy"}']);
  });

  test('throws the server’s plain message when the run fails', async () => {
    const api = createApi(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            data: null,
            error: 'Antigravity CLI is not installed.',
          }),
          { status: 503 },
        ),
    );
    await expect(api.checkPictures('agy')).rejects.toThrow('Antigravity CLI is not installed.');
  });
});
