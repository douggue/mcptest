import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '@jgtube/core';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { analysisEngines, type AnalysisOptions } from '../src/analysisEngine';
import type { EngineId, EngineRunRequest } from '../src/engines/types';
import type { PictureNeed } from '../src/pictureFiles';

const VIDEO = 'aaaaaaaaaaa';
const SHEETS = {
  files: [
    { name: 'frames-01.jpg', bytes: new Uint8Array([0xff, 0xd8]) },
    { name: 'frames-02.jpg', bytes: new Uint8Array([0xff, 0xd8]) },
  ],
  listing: 'preview frames; @frames-01.jpg is Sheet 1 of 2. @frames-02.jpg is Sheet 2 of 2.',
};

let folder = '';
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'jgtube-asker-'));
});
afterEach(() => rmSync(folder, { recursive: true, force: true }));

function asking(order: readonly EngineId[], options: Partial<AnalysisOptions>) {
  return analysisEngines(
    {
      config: { ...loadConfig({}), dbPath: join(folder, 'jgtube.db') },
      options: {
        storePath: join(folder, 'jgtube.db'),
        pictureChecksPath: join(folder, 'checks.json'),
        engines: { order, agyYouTubeLinks: false },
        ...options,
      },
      work: { run: (work: () => unknown) => work() } as never,
    },
    new AbortController().signal,
  );
}

describe('a frame study', () => {
  test('hands Antigravity the frame sheets as files, with no tool, and checks it named them', async () => {
    const needs: PictureNeed[] = [];
    const requests: EngineRunRequest[] = [];
    const parts = asking(['agy', 'claude'], {
      pictureFiles: async (_channel, need) => {
        needs.push(need);
        return SHEETS;
      },
      runEngine: async (_id, request) => {
        requests.push(request);
        return { text: 'PICTURES OPENED: 2, frames-01.jpg, frames-02.jpg\nSheet 1 …', turns: 1 };
      },
    });

    const answer = await parts.studyFrames(VIDEO);

    expect(needs).toEqual([{ kind: 'frames', videoId: VIDEO }]);
    expect(answer.engine).toBe('agy');
    expect(answer.seen).toEqual({ shown: 2, named: 2 });
    expect(requests[0]?.allowedTools).toEqual([]);
    expect(requests[0]?.mcpServers).toEqual({});
    expect(requests[0]?.files).toEqual(SHEETS.files);
    expect(requests[0]?.prompt).toContain('@frames-01.jpg is Sheet 1 of 2');
    expect(requests[0]?.prompt).not.toContain('view_video_frames');
    parts.cleanUp();
  });

  test('goes on to the next engine that sees pictures when the sheets cannot be had as files', async () => {
    const tried: EngineId[] = [];
    const parts = asking(['agy', 'claude'], {
      pictureFiles: async () => {
        throw new Error('this video has no frames to look at');
      },
      runEngine: async (id, request) => {
        tried.push(id);
        expect(request.allowedTools).toEqual(['mcp__jgtube__view_video_frames']);
        return { text: 'Frames.', turns: 1 };
      },
    });

    const answer = await parts.studyFrames(VIDEO, 'agy');

    expect(tried).toEqual(['claude']);
    expect(answer.standInFor).toEqual({
      engine: 'agy',
      because: 'The pictures could not be made into files: this video has no frames to look at',
    });
    parts.cleanUp();
  });

  test('is not done at all only when no engine that sees pictures is there', async () => {
    const parts = asking([], { runEngine: async () => ({ text: 'never', turns: 1 }) });

    await expect(parts.studyFrames(VIDEO)).rejects.toThrow(
      /needs an AI that sees pictures \(Claude Code, Codex or Antigravity\)/,
    );
    parts.cleanUp();
  });
});
