import { beforeEach, describe, expect, test } from 'vitest';
import {
  FINDING_MAX_QUOTES,
  FINDING_MIN_QUOTES,
  parseViewerFindings,
  verifyFindings,
} from '../src/comments/findings';
import { commentCandidates } from '../src/comments/candidates';
import type { ChannelHistory } from '../src/changes/changes';
import { openDatabase } from '../src/db/sqlite';
import { SqliteCommentRepo } from '../src/repos/sqliteCommentRepo';
import type { StoredVideo } from '../src/repos/types';

const NOW = new Date('2026-11-21T12:00:00Z');
const VIDEO = 'abcdefghijk';
const OTHER = 'zyxwvutsrqp';
const comment = (id: string, likes: number, videoId = VIDEO) => ({
  commentId: id,
  videoId,
  text: `Text of ${id}`,
  likes,
  publishedAt: NOW,
});

describe('SqliteCommentRepo', () => {
  let repo: SqliteCommentRepo;
  beforeEach(() => {
    repo = new SqliteCommentRepo(openDatabase(':memory:'));
  });

  test('keeps the comments of each read, replacing the earlier ones, most liked first', () => {
    repo.saveRead(VIDEO, { status: 'read', comments: [comment('a', 1), comment('old', 50)] }, NOW);
    repo.saveRead(VIDEO, { status: 'read', comments: [comment('a', 2), comment('b', 9)] }, NOW);
    repo.saveRead(OTHER, { status: 'disabled', comments: [] }, NOW);

    expect(
      repo.listForVideos([VIDEO, OTHER]).map((stored) => [stored.commentId, stored.likes]),
    ).toEqual([
      ['b', 9],
      ['a', 2],
    ]);
    expect(Object.fromEntries(repo.reads([VIDEO, OTHER, 'neverreadxx']))).toEqual({
      [VIDEO]: { status: 'read', count: 2, readAt: NOW },
      [OTHER]: { status: 'disabled', count: 0, readAt: NOW },
    });
  });

  test("keeps a channel's latest answer", () => {
    expect(repo.findAnswer('UCc')).toBeNull();
    const answer = {
      videoIds: [VIDEO],
      findings: [{ kind: 'request' as const, says: 'More bridges', commentIds: ['a', 'b'] }],
      engine: 'claude',
      askedAt: NOW,
    };
    repo.saveAnswer('UCc', answer);
    expect(repo.findAnswer('UCc')).toEqual(answer);
  });
});

describe('viewer findings', () => {
  const answer = [
    'Here is what I found.',
    'FINDING 1',
    'KIND: request',
    'SAYS: Viewers ask for a video on bridges.',
    'COMMENTS: a, b, c, d',
    '',
    '**FINDING 2**',
    'KIND: objection',
    'SAYS: Some say the numbers were wrong.',
    'COMMENTS: e, invented',
    '',
    'FINDING 3',
    'KIND: rant',
    'SAYS: Nothing.',
    'COMMENTS: a, b',
  ].join('\n');

  test('reads each finding the answer gives in the form asked for', () => {
    const { findings, unread } = parseViewerFindings(answer);

    expect(findings).toEqual([
      {
        kind: 'request',
        says: 'Viewers ask for a video on bridges.',
        commentIds: ['a', 'b', 'c', 'd'],
      },
      {
        kind: 'objection',
        says: 'Some say the numbers were wrong.',
        commentIds: ['e', 'invented'],
      },
    ]);
    expect(unread).toBe(1);
  });

  test('keeps only comment ids that were handed out, and findings quoting enough of them', () => {
    const { findings } = parseViewerFindings(answer);

    const { kept, dropped } = verifyFindings(findings, new Set(['a', 'b', 'c', 'd', 'e']));

    expect(FINDING_MIN_QUOTES).toBe(2);
    expect(FINDING_MAX_QUOTES).toBe(3);
    expect(kept).toEqual([
      { kind: 'request', says: 'Viewers ask for a video on bridges.', commentIds: ['a', 'b', 'c'] },
    ]);
    expect(dropped).toBe(1);
  });
});

describe('commentCandidates', () => {
  const video = (id: string, views: number, days: number): StoredVideo => ({
    id: id.padEnd(11, '_'),
    channelId: `UC${'a'.repeat(22)}`,
    title: `Title ${id}`,
    views,
    durationSeconds: 600,
    published: { date: new Date(NOW.getTime() - days * 86_400_000), precision: 'day', raw: '' },
    fetchedAt: NOW,
  });
  const history: ChannelHistory = {
    channel: {
      id: `UC${'a'.repeat(22)}`,
      title: 'Alike',
      handle: null,
      subscribers: 1000,
      subscribersHidden: false,
      videoCount: null,
      fetchedAt: NOW,
    },
    videos: [
      ...[1, 2, 3, 4, 5].map((n) => video(`old${n}`, 1000, 40 + n)),
      video('big', 90_000, 6),
      video('mid', 20_000, 8),
    ],
    readings: [],
  };

  test("lists the map's winners, strongest first, with what is known of their comments", () => {
    const reads = new Map([['big________', { status: 'read' as const, count: 80, readAt: NOW }]]);

    const candidates = commentCandidates([history], NOW, reads);

    expect(
      candidates.map((entry) => [entry.videoId, entry.channelTitle, entry.read?.count ?? null]),
    ).toEqual([
      ['big________', 'Alike', 80],
      ['mid________', 'Alike', null],
    ]);
    expect(candidates[0]?.score).toBeGreaterThan(candidates[1]?.score ?? 0);
  });
});
