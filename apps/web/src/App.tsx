import type { MapSnapshot } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Benchmarks } from './components/Benchmarks';
import { BreakoutFeed } from './components/BreakoutFeed';
import { Inspector } from './components/Inspector';
import { MapToolbar } from './components/MapToolbar';
import { ScopeToggle } from './components/ScopeToggle';
import { Radar } from './components/Radar';
import { Shell } from './components/Shell';
import { ThumbnailBoard } from './components/ThumbnailBoard';
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
  const selected = snapshot?.channels.find((channel) => channel.id === selectedId) ?? null;
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
            onSetRemoved={(removed) => {
              api
                .setRemoved(snapshot.center.id, selected.id, removed)
                .then(() => load(snapshot.center.id))
                .catch((error: unknown) => setMessage(messageOf(error)));
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
        <ThumbnailBoard
          state={board}
          centerTitle={snapshot.center.title}
          modelId={snapshot.model?.id ?? null}
        />
      )}
    </Shell>
  );
}
