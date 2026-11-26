/**
 * The outlier bank as the API and the connector see it: one look at the
 * bank, the owner's collections, and "Find more outliers", which reads
 * YouTube under the store's lease like a map or a refresh does.
 */
import {
  NICHE_TOPICS,
  SqliteCollectionRepo,
  SqliteFindRepo,
  allowanceNow,
  collectionCsv,
  collectionMarkdown,
  createBankReader,
  fetchApiChannel,
  findMoreOutliers,
  planFind,
  queryBank,
  searchRecentVideos,
  type BankCloseness,
  type BankFilterState,
  type Db,
  type FindProgress,
  type FindRepo,
  type FindVia,
  type MapSnapshot,
  type YouTubeSource,
} from '@jgtube/core';
import type { BankFindDeps, BankInside } from './bankTypes';

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back an API search looks: the bank's longest age filter but one. */
const API_SEARCH_DAYS = 90;
const TIER_ORDER = { close: 0, medium: 1, far: 2 } as const;

/** The closest tier each channel has on any of the owner's latest maps. */
export function closenessTable(
  snapshots: readonly MapSnapshot[],
): ReadonlyMap<string, BankCloseness> {
  const table = new Map<string, BankCloseness>();
  for (const snapshot of snapshots) {
    for (const channel of snapshot.channels) {
      if (channel.id === snapshot.center.id) continue;
      const kept = table.get(channel.id);
      if (kept && TIER_ORDER[kept.tier] <= TIER_ORDER[channel.tier]) continue;
      table.set(channel.id, {
        centerId: snapshot.center.id,
        centerTitle: snapshot.center.title,
        tier: channel.tier,
      });
    }
  }
  return table;
}

const filename = (name: string, extension: string): string =>
  `${
    name
      .replace(/[^\w -]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'collection'
  }.${extension}`;

function collectionsPart(
  deps: BankFindDeps,
  collections: SqliteCollectionRepo,
  read: () => BankViewSource,
) {
  return {
    list: () => collections.list(),
    create: (name: string) => collections.find(collections.create(name, deps.now())),
    remove: (id: number) => collections.delete(id),
    add: (id: number, videoId: string) => collections.add(id, videoId, deps.now()),
    take: (id: number, videoId: string) => collections.remove(id, videoId),
    exportAs(id: number, as: 'csv' | 'md') {
      const found = collections.find(id);
      if (!found) return null;
      const byId = new Map(read().videos.map((video) => [video.videoId, video]));
      const videos = collections.videoIds(id).flatMap((videoId) => byId.get(videoId) ?? []);
      return as === 'csv'
        ? { filename: filename(found.name, 'csv'), type: 'text/csv', text: collectionCsv(videos) }
        : {
            filename: filename(found.name, 'md'),
            type: 'text/markdown',
            text: collectionMarkdown(found.name, videos, deps.now()),
          };
    },
  };
}

type BankViewSource = ReturnType<ReturnType<typeof createBankReader>['read']>;

/** How YouTube is searched and channels are read: the owner's API key when set, else the paced pages. */
export function findSource(
  deps: Pick<BankFindDeps, 'apiKey' | 'source' | 'now' | 'apiSearch' | 'fetchApiChannel'>,
  via: FindVia,
  counted: { requests: number },
) {
  const apiKey = deps.apiKey();
  if (via === 'api' && apiKey !== undefined) {
    const read = deps.fetchApiChannel ?? fetchApiChannel;
    const search = deps.apiSearch ?? searchRecentVideos;
    const source: YouTubeSource = {
      ...deps.source,
      fetchChannel: (channelId, maxVideos) =>
        read(channelId, maxVideos, { apiKey, onRequest: () => (counted.requests += 1) }),
    };
    return {
      source,
      search: async (query: string) => {
        const publishedAfter = new Date(deps.now().getTime() - API_SEARCH_DAYS * DAY_MS);
        const hits = await search(query, { apiKey, publishedAfter });
        return hits.map((hit) => ({ videoId: hit.videoId, channelId: hit.channelId }));
      },
    };
  }
  return { source: deps.source, search: (query: string) => deps.source.searchVideos(query) };
}

/** The finds' spending with what the sweeps spent from the same budget added. */
function sharedSpend(deps: BankFindDeps, finds: FindRepo): FindRepo {
  return {
    record: (run) => finds.record(run),
    spentSince: (via, since) =>
      finds.spentSince(via, since) + (deps.budget?.alsoSpent(via, since) ?? 0),
  };
}

export function bankEngine(deps: BankFindDeps): BankInside {
  const db: Db = deps.db;
  const collections = new SqliteCollectionRepo(db);
  const finds = sharedSpend(deps, new SqliteFindRepo(db));
  const reader = createBankReader(db, {
    now: deps.now,
    context: () => {
      const table = closenessTable(deps.snapshots());
      return { closenessOf: (id) => table.get(id) ?? null };
    },
  });
  const via = (): FindVia => (deps.apiKey() === undefined ? 'pages' : 'api');
  const filterContext = () => {
    const membership = collections.membership();
    return {
      collectionsOf: (videoId: string) => membership.get(videoId) ?? [],
      collectionNames: new Map(collections.list().map((one) => [one.id, one.name])),
    };
  };
  return {
    look(state: BankFilterState, page, channelId) {
      const bank = reader.read();
      const context = filterContext();
      const videos =
        channelId === undefined
          ? bank.videos
          : bank.videos.filter((video) => video.channel.id === channelId);
      const found = queryBank(videos, state, context, page);
      const saved = Object.fromEntries(
        found.videos.flatMap((video) => {
          const ids = context.collectionsOf(video.videoId);
          return ids.length > 0 ? [[video.videoId, ids] as const] : [];
        }),
      );
      return { builtAt: bank.builtAt, page: found, collections: collections.list(), saved };
    },
    findInfo(channels) {
      const how = via();
      return {
        via: how,
        plan: planFind(how, channels),
        allowance: allowanceNow(finds, how, deps.now(), deps.budget?.pageCap()),
        topics: NICHE_TOPICS.map((topic) => topic.label),
      };
    },
    findMore(request, onProgress: (progress: FindProgress) => void) {
      return deps.reading(async () => {
        const how = via();
        const counted = { requests: 0 };
        const before = reader.read().videos.length;
        const outcome = await findMoreOutliers(
          {
            ...deps.repos,
            transact: deps.transact,
            now: deps.now,
            finds,
            via: how,
            ...(deps.budget ? { pageCap: deps.budget.pageCap() } : {}),
            ...findSource(deps, how, counted),
            ...(how === 'api' ? { apiRequestsMade: () => counted.requests } : {}),
          },
          request,
          onProgress,
        );
        return { ...outcome, bankBefore: before, bankAfter: reader.read().videos.length };
      });
    },
    video(videoId) {
      const video = reader.read().videos.find((one) => one.videoId === videoId);
      if (!video) return null;
      return {
        video,
        collections: collections.list(),
        saved: collections.membership().get(videoId) ?? [],
      };
    },
    collections: collectionsPart(deps, collections, () => reader.read()),
    videos: () => reader.read().videos,
  };
}
