import type { CompetitorStatus, LogoFound, MapSnapshot, SavedChannel } from '@jgtube/core';
import { CRAWL_DEFAULT_DEPTH, CRAWL_DEFAULT_MAX_CHANNELS } from '@jgtube/core/src/limits';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Api, JobState } from '../lib/api';
import { inScope, type Scope } from '../lib/feed';
import { createLogoApi, withLogos, withSavedLogos } from '../lib/logos';
import { layoutRadar } from '../lib/radarLayout';
import { useLogos } from './useLogos';

const STORAGE_KEY = 'jgtube.channel';
const MODEL_STORAGE_KEY = 'jgtube.model';
const POLL_INTERVAL_MS = 1500;

/** The browser may refuse storage (private windows); the app works without it. */
function recall(key = STORAGE_KEY): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function remember(channel: string, key = STORAGE_KEY): void {
  try {
    window.localStorage.setItem(key, channel);
  } catch {
    // Nothing to do: remembering the channel is only a convenience.
  }
}

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong';

/** Hands the browser the map on screen as a JSON file. */
export function downloadMap(snapshot: MapSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jgtube-map-${snapshot.center.handle ?? snapshot.center.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/** The crawl, its job and the map it made: what the toolbar and the saved channels work on. */
function useCrawl(api: Api) {
  const [query, setQuery] = useState(recall);
  const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [depth, setDepth] = useState<number>(CRAWL_DEFAULT_DEPTH);
  const [model, setModel] = useState(() => recall(MODEL_STORAGE_KEY));
  const [size, setSize] = useState<number>(CRAWL_DEFAULT_MAX_CHANNELS);
  const [saved, setSaved] = useState<readonly SavedChannel[]>([]);

  // Every channel a map was made for. If the list cannot be read, the row keeps what it had.
  const loadSaved = useCallback(() => {
    api
      .savedChannels()
      .then(setSaved)
      .catch(() => undefined);
  }, [api]);
  useEffect(loadSaved, [loadSaved]);

  const load = useCallback(
    async (channel: string): Promise<boolean> => {
      try {
        const found = await api.latestMap(channel);
        setSnapshot(found);
        if (found === null) {
          setMessage(
            `No map has been made for ${channel} yet. Press Find competitors to make one.`,
          );
        }
        return found !== null;
      } catch (error) {
        setMessage(messageOf(error));
        return false;
      }
    },
    [api],
  );

  // On first load, show the stored map for the channel used last time.
  useEffect(() => {
    const remembered = recall().trim();
    if (remembered) void load(remembered);
  }, [load]);

  // While a crawl runs, poll it; when it ends, load the map it made.
  useEffect(() => {
    if (job?.status !== 'running') return;
    const timer = window.setInterval(() => {
      api
        .job(job.id)
        .then((next) => {
          setJob(next);
          if (next.status === 'done' && next.result) {
            void load(next.result.centerChannelId);
            loadSaved();
          }
          if (next.status === 'failed') setMessage(next.error ?? 'The map could not be made');
        })
        .catch((error: unknown) => {
          setJob(null);
          setMessage(messageOf(error));
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [api, job, load, loadSaved]);

  const submit = async () => {
    const channel = query.trim();
    if (!channel) return;
    setMessage(null);
    remember(channel);
    remember(model.trim(), MODEL_STORAGE_KEY);
    try {
      const id = await api.startCrawl(channel, depth, model, size);
      setJob({ id, status: 'running', progress: null, result: null, error: null });
    } catch (error) {
      setMessage(messageOf(error));
    }
  };

  return {
    ...{ query, setQuery, snapshot, setSnapshot, job, message, setMessage },
    ...{ depth, setDepth, model, setModel, size, setSize },
    ...{ saved, setSaved, load, submit },
  };
}

/**
 * The map on screen and everything about it the top of the page works on:
 * the crawl, the saved channels and the radar's scope.
 */
export function useMapPage(api: Api) {
  const crawl = useCrawl(api);
  const { snapshot, setSnapshot, setSaved, saved, load, setMessage } = crawl;
  const [scope, setScope] = useState<Scope>('peers');
  const logoApi = useMemo(() => createLogoApi(), []);

  // A map made before logos were stored gains them in the background, as they are read.
  const putLogos = useCallback(
    (mapId: number, found: readonly LogoFound[]) => {
      setSnapshot((now) => (now?.mapId === mapId ? withLogos(now, found) : now));
      setSaved((now) => withSavedLogos(now, found));
    },
    [setSnapshot, setSaved],
  );
  const logoRun = useLogos(logoApi, snapshot, putLogos);

  // Back to a channel looked up earlier: its stored map, with nothing read from YouTube.
  const open = (channel: SavedChannel) => {
    const typed = channel.handle ? `@${channel.handle}` : channel.id;
    crawl.setQuery(typed);
    remember(typed);
    setMessage(null);
    void load(channel.id);
  };

  // Deletes a saved channel's map; the screen moves to the next saved channel, or to the start.
  const remove = async (channel: SavedChannel) => {
    try {
      await api.deleteSavedChannel(channel.id);
    } catch (error) {
      setMessage(messageOf(error));
      return;
    }
    const rest = saved.filter((other) => other.id !== channel.id);
    setSaved(rest);
    if (snapshot?.center.id !== channel.id) return;
    const [next] = rest;
    if (next) {
      open(next);
      return;
    }
    setSnapshot(null);
    crawl.setQuery('');
    remember('');
    setMessage(null);
  };

  const peerCount = snapshot ? inScope(snapshot.channels, 'peers').length : 0;
  // With no channel like the centre found yet, showing an empty radar would help nobody.
  const activeScope: Scope = peerCount === 0 ? 'all' : scope;
  const visible = useMemo(
    () =>
      snapshot && {
        ...snapshot,
        channels: inScope(snapshot.channels, activeScope),
        breakouts: inScope(snapshot.breakouts, activeScope),
      },
    [snapshot, activeScope],
  );
  const layout = useMemo(() => (visible ? layoutRadar(visible) : null), [visible]);

  /** Records the owner's say on a channel of the map on screen, then reads the map again. */
  const setStatus = async (channelId: string, status: CompetitorStatus): Promise<void> => {
    if (!snapshot) return;
    await api.setCompetitorStatus(snapshot.center.id, channelId, status);
    await load(snapshot.center.id);
  };

  return {
    ...crawl,
    ...{ logoRun, open, remove, peerCount, activeScope, setScope, visible, layout },
    ...{ setStatus },
  };
}

export type MapPage = ReturnType<typeof useMapPage>;
