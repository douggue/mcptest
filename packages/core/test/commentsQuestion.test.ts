import { describe, expect, test } from 'vitest';
import { COMMENTS_IN_QUESTION, commentsForQuestion } from '../src/comments/question';
import { openDatabase } from '../src/db/sqlite';
import { SqliteCommentRepo } from '../src/repos/sqliteCommentRepo';

const NOW = new Date('2026-11-21T12:00:00Z');

describe('commentsForQuestion', () => {
  test("hands out each video's most liked stored comments, up to a stated number", () => {
    const repo = new SqliteCommentRepo(openDatabase(':memory:'));
    const many = Array.from({ length: COMMENTS_IN_QUESTION + 5 }, (_, n) => ({
      commentId: `c${n}`,
      videoId: 'videoaaaaaa',
      text: `Comment ${n}`,
      likes: n,
      publishedAt: NOW,
    }));
    repo.saveRead('videoaaaaaa', { status: 'read', comments: many }, NOW);
    repo.saveRead(
      'videobbbbbb',
      { status: 'read', comments: [{ ...many[0]!, commentId: 'b1', videoId: 'videobbbbbb' }] },
      NOW,
    );

    const handed = commentsForQuestion(repo, ['videoaaaaaa', 'videobbbbbb', 'neverread__']);

    expect(COMMENTS_IN_QUESTION).toBe(60);
    expect(handed.get('videoaaaaaa')).toHaveLength(COMMENTS_IN_QUESTION);
    expect(handed.get('videoaaaaaa')?.[0]?.commentId).toBe(`c${COMMENTS_IN_QUESTION + 4}`);
    expect(handed.get('videobbbbbb')?.map((comment) => comment.commentId)).toEqual(['b1']);
    expect(handed.get('neverread__')).toEqual([]);
  });
});
