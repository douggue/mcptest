import { describe, expect, test } from 'vitest';
import { createExtrasApi } from '../src/lib/extrasApi';
import { routeFromHash } from '../src/lib/routes';
import {
  comparedLine,
  firstPick,
  flagText,
  liftText,
  missingRows,
  pickList,
  reviewAnchor,
  reviewHref,
  reviewVideoOf,
  scoreText,
  shownRows,
  valueText,
  winnersText,
  type CountRow,
  type PickableVideo,
  type ThumbReviewView,
} from '../src/lib/thumbReview';

const CHANNEL = `UC${'c'.repeat(22)}`;
const row = (over: Partial<CountRow> = {}): CountRow => ({
  key: 'face',
  label: 'Face or person',
  value: 'large',
  winners: 6,
  winnersTagged: 8,
  winnerShare: 0.75,
  channels: 3,
  ordinary: 1,
  ordinaryTagged: 8,
  ordinaryShare: 0.125,
  lift: 4.7,
  yours: false,
  flag: null,
  winning: true,
  examples: ['aaaaaaaaaaa'],
  ...over,
});
const pick = (videoId: string): PickableVideo => ({
  videoId,
  title: videoId,
  channelId: CHANNEL,
  channelTitle: 'Mine',
  score: 1,
  ageDays: 3,
});
const view = (over: Partial<ThumbReviewView> = {}): ThumbReviewView => ({
  target: { ...pick('ttttttttttt'), tags: { description: 'A machine.' } },
  winners: [],
  ordinary: [],
  rows: [
    row(),
    row({ value: 'small', winning: false, yours: true }),
    row({ key: 'logo', value: 'yes', winning: false, flag: 'branding' }),
    row({ key: 'colours', value: 'blue', yours: true }),
  ],
  winnersTagged: 8,
  ordinaryTagged: 8,
  channels: 3,
  rejected: [],
  comparedAt: '2026-11-21T10:00:00.000Z',
  answer: null,
  ...over,
});

describe('how a counted row is worded', () => {
  test('names the value, who shows it and how it compares with ordinary videos', () => {
    expect(valueText(row())).toBe('Face or person: large');
    expect(winnersText(row())).toBe('6 of 8 winners (75%) · 3 channels');
    expect(winnersText(row({ channels: 1 }))).toMatch(/1 channel$/);
    expect(liftText(row())).toBe('4.7× as common as on ordinary videos (13%)');
    expect(liftText(row({ ordinaryShare: null, lift: null }))).toBe(
      'no ordinary videos to compare',
    );
  });

  test('says why a flagged value is not advice', () => {
    expect(flagText('branding')).toMatch(/branding/);
    expect(flagText('topic')).toMatch(/the topic, not the thumbnail/);
    expect(flagText(null)).toBe('');
  });

  test('shows a score as a multiple, or a dash when it cannot be judged', () => {
    expect(scoreText(12.44)).toBe('12×');
    expect(scoreText(3.24)).toBe('3.2×');
    expect(scoreText(0.02)).toBe('<0.1×');
    expect(scoreText(null)).toBe('–');
  });
});

describe('which rows the page shows', () => {
  test('winning values first, then flagged ones; what yours lacks is the winning values it does not show', () => {
    expect(shownRows(view()).map((entry) => entry.value)).toEqual(['large', 'blue', 'yes']);
    expect(missingRows(view()).map((entry) => entry.value)).toEqual(['large']);
  });

  test('says what was compared, and what could not be looked at', () => {
    expect(comparedLine(view())).toBe(
      'Set against 8 winning thumbnails from 3 channels, each beside an ordinary video of the same channel (8 in all).',
    );
    expect(comparedLine(view({ channels: 1, rejected: [{ videoId: 'x', reason: 'y' }] }))).toMatch(
      /1 channel,.*1 could not be looked at and is not counted\.$/,
    );
    expect(
      comparedLine(
        view({
          rejected: [
            { videoId: 'x', reason: 'y' },
            { videoId: 'z', reason: 'y' },
          ],
        }),
      ),
    ).toMatch(/2 could not be looked at and are not counted/);
  });
});

describe('a link to the review of one video', () => {
  test('opens the Thumbnail tab of that video’s page, as the old in-page link still does', () => {
    expect(reviewHref('aaaaaaaaaaa')).toBe('#/video/aaaaaaaaaaa/thumbnail');
    expect(routeFromHash(reviewHref('aaaaaaaaaaa'))).toMatchObject({
      view: 'video',
      videoId: 'aaaaaaaaaaa',
      tab: 'thumbnail',
    });
    expect(routeFromHash('#thumbnail-review-aaaaaaaaaaa')).toMatchObject({
      view: 'video',
      videoId: 'aaaaaaaaaaa',
      tab: 'thumbnail',
    });
    expect(reviewVideoOf('#thumbnail-review-aaaaaaaaaaa')).toBe('aaaaaaaaaaa');
    expect(reviewVideoOf('#thumbnail-review-short')).toBeNull();
    expect(reviewVideoOf('#/thumbnails')).toBeNull();
    expect(reviewAnchor('aaaaaaaaaaa')).toBe('thumbnail-review-aaaaaaaaaaa');
    expect(reviewAnchor(null)).toBe('thumbnail-review');
  });
});

describe('the videos to pick from', () => {
  const videos = {
    own: [pick('own00000001'), pick('own00000002')],
    map: [pick('own00000002'), pick('map00000001')],
    reviewed: [] as string[],
  };

  test('lists yours first, then the map’s, each once', () => {
    expect(pickList(videos).map((video) => video.videoId)).toEqual([
      'own00000001',
      'own00000002',
      'map00000001',
    ]);
    expect(pickList(null)).toEqual([]);
  });

  test('starts with the last reviewed video, else your newest, else the map’s first', () => {
    expect(firstPick({ ...videos, reviewed: ['map00000001'] })).toBe('map00000001');
    expect(firstPick(videos)).toBe('own00000001');
    expect(firstPick({ own: [], map: videos.map, reviewed: [] })).toBe('own00000002');
    expect(firstPick({ own: [], map: [], reviewed: [] })).toBeNull();
    expect(firstPick(null)).toBeNull();
  });
});

describe('the thumbnail review calls of the API client', () => {
  test('read the videos and a review, and start a review with the chosen engine', async () => {
    // Arrange
    const sent: string[] = [];
    const api = createExtrasApi(async (url, init) => {
      sent.push(
        `${init?.method ?? 'GET'} ${String(url)} ${init?.body ? String(init.body) : ''}`.trim(),
      );
      const data = String(url).includes('/ask') ? { jobId: 'j1' } : null;
      return new Response(JSON.stringify({ success: true, data, error: null }), {
        status: String(url).includes('/ask') ? 202 : 200,
      });
    });

    // Act
    await api.thumbnailVideos(CHANNEL);
    await api.thumbnailReview(CHANNEL, 'aaaaaaaaaaa');
    const jobId = await api.askThumbnailReview(CHANNEL, 'aaaaaaaaaaa', 'codex');
    await api.askThumbnailReview(CHANNEL, 'aaaaaaaaaaa', 'auto');

    // Assert
    expect(jobId).toBe('j1');
    expect(sent).toEqual([
      `GET /api/thumbnail-review/videos?channel=${CHANNEL}`,
      `GET /api/thumbnail-review?channel=${CHANNEL}&video=aaaaaaaaaaa`,
      `POST /api/thumbnail-review/ask {"channel":"${CHANNEL}","videoId":"aaaaaaaaaaa","engine":"codex"}`,
      `POST /api/thumbnail-review/ask {"channel":"${CHANNEL}","videoId":"aaaaaaaaaaa"}`,
    ]);
  });
});
