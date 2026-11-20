import type { CompetitorStatus, MapSnapshot } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Benchmarks } from './components/Benchmarks';
import { BreakoutFeed } from './components/BreakoutFeed';
import { Inspector } from './components/Inspector';
import { MapToolbar } from './components/MapToolbar';
import { Niches } from './components/Niches';
import { SameTopic } from './components/SameTopic';
import { ScopeToggle } from './components/ScopeToggle';
import { Radar } from './components/Radar';
import { RefreshBar } from './components/RefreshBar';
import { Shell } from './components/Shell';
import { ThumbnailBoard } from './components/ThumbnailBoard';
import { AskClaude } from './components/AskClaude';
import { useAnalysis } from './components/useAnalysis';
import { useNiches } from './components/useNiches';
import { useRefresh } from './components/useRefresh';
import { useSameTopic } from './components/useSameTopic';
import { useThumbnailBoard } from './components/useThumbnailBoard';
import { createApi, type JobState } from './lib/api';
import { inScope, type Scope } from './lib/feed';
import { layoutRadar } from './lib/radarLayout';

const STORAGE_KEY = 'jgtube.channel';
const MODEL_STORAGE_KEY = 'jgtube.model';
const POLL_INTERVAL_MS = 1500;
const DEFAULT_DEPTH = 2;
const DEFAULT_SIZE = 150;

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

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Something went wrong';

function download(snapshot: MapSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `jgtube-map-${snapshot.center.handle ?? snapshot.center.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const api = useMemo(() => createApi(), []);
  const [query, setQuery] = useState(recall);
  const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [scope, setScope] = useState<Scope>('peers');
  const [model, setModel] = useState(() => recall(MODEL_STORAGE_KEY));
  const [size, setSize] = useState(DEFAULT_SIZE);

  const load = useCallback(
    async (channel: string): Promise<boolean> => {
      try {
        const found = await api.latestMap(channel);
        setSnapshot(found);
        setSelectedId(null);
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
          if (next.status === 'done' && next.result) void load(next.result.centerChannelId);
          if (next.status === 'failed') setMessage(next.error ?? 'The map could not be made');
        })
        .catch((error: unknown) => {
          setJob(null);
          setMessage(messageOf(error));
        });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [api, job, load]);

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
  const board = useThumbnailBoard(api, snapshot);
  const sameTopic = useSameTopic(api, snapshot);
  const niches = useNiches(api, snapshot?.mapId ?? null);
  const analysis = useAnalysis(api);
  // A refresh stores new view counts, which the niche list turns into measured growth.
  const refresh = useRefresh(api, niches.reload);
  const selected = snapshot?.channels.find((channel) => channel.id === selectedId) ?? null;
  /** Records the owner's say on a channel of the map on screen, then reads the map again. */
  const setStatus = async (channelId: string, status: CompetitorStatus): Promise<void> => {
    if (!snapshot) return;
    await api.setCompetitorStatus(snapshot.center.id, channelId, status);
    await load(snapshot.center.id);
  };
  const select = (channelId: string) => {
    setSelectedId((current) => (current === channelId ? null : channelId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <Shell>
      <MapToolbar
        center={snapshot?.center ?? null}
        query={query}
        onQueryChange={setQuery}
        model={model}
        onModelChange={setModel}
        measuredAgainst={snapshot?.model?.title ?? null}
        onSubmit={() => void submit()}
        job={job}
        message={message}
        depth={depth}
        onDepthChange={setDepth}
        size={size}
        onSizeChange={setSize}
        onExport={snapshot ? () => download(snapshot) : null}
      />
      <Radar
        snapshot={visible}
        layout={layout}
        selectedId={selectedId}
        onSelect={select}
        emptyState={
          <div className="max-w-md rounded bg-space-canvas/80 p-space-lg backdrop-blur-md">
            <h1 className="text-headline-lg text-on-surface">Map who you compete with</h1>
            <p className="mt-2 text-body-lg text-on-surface-variant">
              Paste your channel above and press Find competitors. Jgtube follows YouTube&rsquo;s
              recommendations out from your videos; a full map takes a few minutes.
            </p>
          </div>
        }
      >
        {snapshot && (
          <ScopeToggle
            scope={activeScope}
            onChange={(next) => {
              setScope(next);
              setSelectedId(null);
            }}
            peerCount={peerCount}
            totalCount={snapshot.channels.length}
          />
        )}
        {selected && snapshot && (
          <Inspector
            channel={selected}
            onClose={() => setSelectedId(null)}
            onSetStatus={(status) => {
              setStatus(selected.id, status).catch((error: unknown) =>
                setMessage(messageOf(error)),
              );
            }}
          />
        )}
      </Radar>
      {visible && (
        <section className="w-full bg-space-deep px-gutter-desktop py-space-xl">
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-space-xl xl:grid-cols-12">
            <BreakoutFeed items={visible.breakouts} centerTitle={visible.center.title} />
            <Benchmarks snapshot={visible} selectedId={selectedId} onSelect={select} />
          </div>
        </section>
      )}
      {snapshot && (
        <SameTopic state={sameTopic} centerTitle={snapshot.center.title} onSetStatus={setStatus} />
      )}
      {snapshot && (
        <ThumbnailBoard
          state={board}
          centerTitle={snapshot.center.title}
          modelId={snapshot.model?.id ?? null}
        />
      )}
      {snapshot && (
        <AskClaude
          analysis={analysis}
          centerId={snapshot.center.id}
          centerTitle={snapshot.center.title}
        />
      )}
      <Niches niches={niches} hasMap={snapshot !== null} />
      <RefreshBar refresh={refresh} />
      <p className="mx-auto w-full max-w-[1440px] px-gutter-desktop pb-space-xl text-label-caps text-outline">
        Jgtube reads YouTube&rsquo;s public pages without an account. That is outside
        YouTube&rsquo;s terms of service and can stop working without notice. Scores and earnings
        are estimates.
      </p>
    </Shell>
  );
}
