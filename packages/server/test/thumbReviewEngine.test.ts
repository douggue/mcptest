import {
  SqliteChannelRepo,
  SqliteEdgeRepo,
  SqliteMapRepo,
  SqliteThumbReviewRepo,
  SqliteVideoRepo,
  THUMBNAIL_PROMPT_MARKER,
  markerLines,
  openDatabase,
  type ThumbTags,
} from '@jgtube/core';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AnalysisId } from '../src/analyses';
import type { EngineId } from '../src/engines/types';
import type { QuestionFocus } from '../src/questionFocus';
import { adviceParts, thumbReviewEngine } from '../src/thumbReviewEngine';
import type { ThumbReviewEngine } from '../src/thumbReviewTypes';

type StorableVideo = Parameters<SqliteVideoRepo['upsertMany']>[0][number];

const NOW = new Date('2026-11-21T12:00:00Z');
const CENTER = `UC${'c'.repeat(22)}`;
const PEERS = [`UC${'p'.repeat(22)}`, `UC${'q'.repeat(22)}`];
const NO_MAP = `UC${'n'.repeat(22)}`;
const DAY = 86_400_000;

const TAGS: ThumbTags = {
  face: 'none',
  expression: 'none',
  words: 6,
  textSize: 'small',
  textColour: 'white',
  background: 'plain',
  colours: ['blue'],
  subjectSize: 'small',
  highlight: false,
  split: false,
  flagOrMap: false,
  logo: false,
  brightness: 'dark',
  clutter: 3,
  description: 'A small machine on a blue background.',
};

const id = (channel: string, n: number): string => `${channel.slice(2, 3)}vid${n}`.padEnd(11, '_');
const video = (channelId: string, n: number, views: number): StorableVideo => ({
  id: id(channelId, n),
  channelId,
  title: n === 1 ? 'The bicycle that changed everything' : `Video ${n} of ${channelId.slice(2, 3)}`,
  views,
  durationSeconds: 600,
  published: { date: new Date(NOW.getTime() - (10 + n) * DAY), precision: 'day', raw: '' },
});

let engine: ThumbReviewEngine;
let reviews: SqliteThumbReviewRepo;
let videoRepo: SqliteVideoRepo;
let asked: Array<{ analysis: AnalysisId; only?: EngineId; focus?: QuestionFocus }>;
let answerFor: (analysis: AnalysisId, focus?: QuestionFocus) => string;

/** Winners get a large face; everything else is plain. */
function tagAnswer(focus: QuestionFocus | undefined): string {
  const ids = focus && 'videoIds' in focus ? focus.videoIds : [];
  return JSON.stringify(
    ids.map((videoId) => ({
      id: videoId,
      ...TAGS,
      ...(videoId.includes('vid1') ? { face: 'large', expression: 'surprised' } : {}),
    })),
  );
}

const { start, end } = markerLines(THUMBNAIL_PROMPT_MARKER);
const ADVICE = `WHAT YOUR THUMBNAIL DOES\nIt is plain.\n\nTHE PROMPT\n${start}\nA bright frame.\n${end}`;

beforeEach(() => {
  const db = openDatabase(':memory:');
  reviews = new SqliteThumbReviewRepo(db);
  const repos = {
    channels: new SqliteChannelRepo(db),
    videos: (videoRepo = new SqliteVideoRepo(db)),
    edges: new SqliteEdgeRepo(db),
    maps: new SqliteMapRepo(db),
    thumbReviews: reviews,
  };
  for (const channelId of [CENTER, ...PEERS]) {
    repos.channels.upsert(
      {
        id: channelId,
        title: `Channel ${channelId.slice(2, 3)}`,
        handle: null,
        subscribers: 1000,
        subscribersHidden: false,
        videoCount: null,
      },
      NOW,
    );
    // Video 1 is a winner far above the channel's usual 1000 views.
    repos.videos.upsertMany(
      [1, 2, 3, 4, 5, 6].map((n) => video(channelId, n, n === 1 ? 40_000 : 1000)),
      NOW,
    );
  }
  repos.maps.create(
    {
      centerChannelId: CENTER,
      depth: 1,
      region: 'US',
      members: [
        { channelId: CENTER, steps: 0 },
        ...PEERS.map((channelId) => ({ channelId, steps: 1 })),
      ],
    },
    NOW,
  );
  asked = [];
  answerFor = (analysis, focus) => (analysis === 'thumbnail-tags' ? tagAnswer(focus) : ADVICE);
  engine = thumbReviewEngine({
    now: () => NOW,
    repos,
    analyse: async (analysis, _channel, only, focus) => {
      asked.push({ analysis, only, focus });
      return { text: answerFor(analysis, focus), engine: 'claude', skipped: [], turns: 1 };
    },
  });
});

const ownVideo = (): string => id(CENTER, 2);

describe('thumbnailVideos', () => {
  test('offers the owner’s videos newest first, then the map’s videos strongest first', () => {
    const videos = engine.thumbnailVideos(CENTER);

    expect(videos?.own[0]).toMatchObject({ videoId: id(CENTER, 1), channelId: CENTER });
    expect(videos?.own.map((entry) => entry.videoId)).toHaveLength(6);
    expect(videos?.map[0]?.score).toBeGreaterThan(5);
    expect(videos?.map.every((entry) => entry.channelId !== CENTER)).toBe(true);
    expect(videos?.reviewed).toEqual([]);
  });

  test('is null for a channel with no map', () => {
    expect(engine.thumbnailVideos(NO_MAP)).toBeNull();
  });
});

describe('askThumbnailReview', () => {
  test('tags yours and the chosen winners, counts in code, then asks for the advice from the count', async () => {
    // Act
    const steps: string[] = [];
    const outcome = await engine.askThumbnailReview(CENTER, ownVideo(), 'codex', (text) =>
      steps.push(text),
    );

    // Assert
    expect(outcome).toMatchObject({ winners: 2, rejected: 0, engine: 'claude' });
    expect(asked.map((entry) => entry.analysis)).toEqual(['thumbnail-tags', 'thumbnail-advice']);
    expect(asked[0]?.only).toBe('codex');
    expect(asked[1]?.focus).toEqual({ kind: 'thumb-advice', videoId: ownVideo() });
    expect(steps).toHaveLength(2);

    const review = engine.findThumbnailReview(CENTER, ownVideo());
    expect(review?.target).toMatchObject({ videoId: ownVideo(), tags: TAGS });
    expect(review?.winners.map((thumb) => thumb.videoId)).toEqual([
      id(PEERS[0] ?? '', 1),
      id(PEERS[1] ?? '', 1),
    ]);
    const face = review?.rows.find((row) => row.key === 'face' && row.value === 'large');
    expect(face).toMatchObject({ winners: 2, channels: 2, yours: false, winning: true });
    expect(review?.answer).toMatchObject({ prompt: 'A bright frame.', engine: 'claude' });
    expect(engine.thumbnailComparison(CENTER, ownVideo())).toContain('Face or person = large');
    expect(engine.thumbnailVideos(CENTER)?.reviewed).toEqual([ownVideo()]);
  });

  test('reuses kept tags, asking only for thumbnails never tagged', async () => {
    await engine.askThumbnailReview(CENTER, ownVideo());
    asked = [];

    await engine.askThumbnailReview(CENTER, id(CENTER, 3));

    const tagged = asked.filter((entry) => entry.analysis === 'thumbnail-tags');
    expect(tagged.map((entry) => entry.focus)).toEqual([
      { kind: 'thumb-tags', videoIds: [id(CENTER, 3)] },
    ]);
  });

  test('records thumbnails whose tags are off the checklist, and never counts them', async () => {
    answerFor = (analysis, focus) => {
      if (analysis !== 'thumbnail-tags') return 'No prompt here.';
      const parsed = JSON.parse(tagAnswer(focus)) as Array<Record<string, unknown>>;
      return JSON.stringify(
        parsed.map((entry) =>
          entry['id'] === id(PEERS[1] ?? '', 1) ? { ...entry, face: 'huge' } : entry,
        ),
      );
    };

    const outcome = await engine.askThumbnailReview(CENTER, ownVideo());

    expect(outcome.rejected).toBe(1);
    const review = engine.findThumbnailReview(CENTER, ownVideo());
    expect(review?.rejected).toEqual([
      { videoId: id(PEERS[1] ?? '', 1), reason: 'face is not one of the fixed values' },
    ]);
    expect(review?.winnersTagged).toBe(1);
    expect(review?.answer?.prompt).toBeNull();
  });

  test('refuses a video not on the map, and says so when your thumbnail could not be tagged', async () => {
    await expect(engine.askThumbnailReview(CENTER, 'zzzzzzzzzzz')).rejects.toThrow(
      /not one of this map/,
    );
    await expect(engine.askThumbnailReview(NO_MAP, ownVideo())).rejects.toThrow(
      /not one of this map/,
    );
    answerFor = () => 'I cannot see.';
    await expect(engine.askThumbnailReview(CENTER, ownVideo())).rejects.toThrow(
      /could not be looked at/,
    );
    expect(asked.some((entry) => entry.analysis === 'thumbnail-advice')).toBe(false);
  });

  test('says there is nothing to compare with on a map without winners', async () => {
    // Arrange: every look-alike video does as well as the others.
    for (const channelId of PEERS) {
      videoRepo.upsertMany(
        [1, 2, 3, 4, 5, 6].map((n) => video(channelId, n, 1000)),
        NOW,
      );
    }

    // Act and assert
    await expect(engine.askThumbnailReview(CENTER, ownVideo())).rejects.toThrow(
      /no winning videos/,
    );
    expect(engine.findThumbnailReview(CENTER, ownVideo())).toBeNull();
    expect(engine.thumbnailComparison(CENTER, ownVideo())).toBeNull();
  });
});

describe('adviceParts', () => {
  test('shows the advice without the prompt and its heading, and lifts the prompt out', () => {
    expect(adviceParts(ADVICE)).toEqual({
      text: 'WHAT YOUR THUMBNAIL DOES\nIt is plain.',
      prompt: 'A bright frame.',
    });
  });

  test('keeps the whole answer when there is no single prompt, or it runs far too long', () => {
    expect(adviceParts('Just advice.')).toEqual({ text: 'Just advice.', prompt: null });
    const long = `${start}\n${'x'.repeat(7000)}\n${end}`;
    expect(adviceParts(long).prompt).toBeNull();
  });
});
