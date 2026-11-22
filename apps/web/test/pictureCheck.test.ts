import { describe, expect, test } from 'vitest';
import { choiceFor, choiceHelp, type EngineReport } from '../src/lib/analyses';
import { createApi } from '../src/lib/api';
import {
  enginesToCheck,
  pictureCheckLine,
  failedCheck,
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
  test('is every engine by default: Antigravity sees pictures as files, the check is optional', () => {
    expect(seeingEngines(null)).toEqual(['claude', 'codex', 'agy']);
    expect(seeingEngines(report())).toEqual(['claude', 'codex', 'agy']);
    expect(seeingEngines(report([passed]))).toEqual(['claude', 'codex', 'agy']);
  });

  test('leaves out Antigravity only after it failed the check', () => {
    expect(seeingEngines(report([failed]))).toEqual(['claude', 'codex']);
    expect(failedCheck(report([failed]), 'agy')).toBe(true);
    expect(failedCheck(report([passed]), 'agy')).toBe(false);
    expect(failedCheck(null, 'agy')).toBe(false);
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
  test('says what a pass shows', () => {
    expect(pictureCheckLine(passed)).toBe('Passed the picture check: it named both colours.');
  });

  test('quotes what the engine said when it did not see them, and what that means', () => {
    expect(pictureCheckLine(failed)).toBe(
      'Did not see the pictures: it answered “I cannot open images.” The pictures were red and blue. Until it passes, questions about pictures go to Claude Code or Codex.',
    );
    expect(pictureCheckLine({ ...failed, answer: '' })).toMatch(/it gave no answer/);
  });

  test('before a check, says it sees pictures as files and the check is optional', () => {
    expect(pictureCheckLine(null)).toBe(
      'Sees pictures as files; the check is optional. Run it if its picture answers look wrong.',
    );
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
  test('stays with Antigravity when no check was run, or it passed', () => {
    expect(choiceFor('thumbnails', 'agy', report())).toEqual({ choice: 'agy', note: null });
    expect(choiceFor('thumbnails', 'agy', report([passed]))).toEqual({ choice: 'agy', note: null });
  });

  test('says another AI writes it once Antigravity failed the check, and what to do', () => {
    expect(choiceFor('thumbnails', 'agy', report([failed]))).toEqual({
      choice: 'agy',
      note: 'Antigravity did not pass its last picture check, so the next AI that sees pictures answers this one. Run the check again in Settings.',
    });
  });

  test('the switch’s help says pictures reach Antigravity as files, and names a failed check', () => {
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
    expect(choiceHelp('agy', ready)).toBe(
      'Only Antigravity answers; nothing else is tried if it cannot, except a question about pictures, which goes on to the next AI that sees them. Antigravity sees pictures as files.',
    );
    expect(choiceHelp('agy', { ...ready, pictureChecks: [failed] })).toMatch(
      /did not pass its last picture check.*Run the check again in Settings\.$/,
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
