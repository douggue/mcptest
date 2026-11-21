import { describe, expect, test } from 'vitest';
import { COMMENT_MINING_MAX_VIDEOS, mineComments } from '../src/comments/mine';
import { openDatabase } from '../src/db/sqlite';
import { SqliteCommentRepo } from '../src/repos/sqliteCommentRepo';
import type { CommentsResult } from '../src/sources/commentsApi';
import { ApiRefusal } from '../src/sources/dataApi';

const NOW = new Date('2026-11-21T12:00:00Z');

describe('mineComments', () => {
  test('reads each video in turn, keeps its comments and says how each went', async () => {
    const comments = new SqliteCommentRepo(openDatabase(':memory:'));
    const asked: string[] = [];
    const steps: string[] = [];
    const fetchComments = async (videoId: string): Promise<CommentsResult> => {
      asked.push(videoId);
      if (videoId === 'offvideo___') return { status: 'disabled', comments: [] };
      if (videoId === 'failing____')
        throw new Error('The YouTube API refused the request (500): x');
      return {
        status: 'read',
        comments: [{ commentId: `${videoId}-1`, videoId, text: 'Hi', likes: 1, publishedAt: NOW }],
      };
    };

    const outcomes = await mineComments(
      { comments, fetchComments, now: () => NOW },
      ['goodvideo__', 'offvideo___', 'failing____'],
      (done, total) => steps.push(`${done}/${total}`),
    );

    expect(COMMENT_MINING_MAX_VIDEOS).toBe(10);
    expect(asked).toEqual(['goodvideo__', 'offvideo___', 'failing____']);
    expect(outcomes).toEqual([
      { videoId: 'goodvideo__', status: 'read', count: 1, problem: null },
      { videoId: 'offvideo___', status: 'disabled', count: 0, problem: null },
      {
        videoId: 'failing____',
        status: 'failed',
        count: 0,
        problem: 'The YouTube API refused the request (500): x',
      },
    ]);
    expect(steps).toEqual(['1/3', '2/3', '3/3']);
    expect(comments.listForVideos(['goodvideo__']).map((stored) => stored.commentId)).toEqual([
      'goodvideo__-1',
    ]);
  });

  test('stops at the first refusal of the daily allowance, leaving the rest unread', async () => {
    const comments = new SqliteCommentRepo(openDatabase(':memory:'));
    const quota =
      'The YouTube API key has used up its daily allowance. It resets at midnight Pacific time.';

    const outcomes = await mineComments(
      {
        comments,
        fetchComments: async () => {
          throw new ApiRefusal(quota, ['quotaExceeded']);
        },
        now: () => NOW,
      },
      ['first______', 'second_____'],
    );

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['failed', 'skipped']);
  });
});
