import type { MapSnapshot } from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Benchmarks } from './components/Benchmarks';
import { BreakoutFeed } from './components/BreakoutFeed';
import { Inspector } from './components/Inspector';
import { MapToolbar } from './components/MapToolbar';
import { Radar } from './components/Radar';
import { Shell } from './components/Shell';
import { createApi, type JobState } from './lib/api';
import { layoutRadar } from './lib/radarLayout';

const STORAGE_KEY = 'jgtube.channel';
const POLL_INTERVAL_MS = 1500;
const DEFAULT_DEPTH = 2;

/** The browser may refuse storage (private windows); the app works without it. */
function recall(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function remember(channel: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, channel);
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
    try {
      const id = await api.startCrawl(channel, depth);
      setJob({ id, status: 'running', progress: null, result: null, error: null });
    } catch (error) {
      setMessage(messageOf(error));
    }
  };

  const layout = useMemo(() => (snapshot ? layoutRadar(snapshot) : null), [snapshot]);
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
        onSubmit={() => void submit()}
        job={job}
        message={message}
        depth={depth}
        onDepthChange={setDepth}
        onExport={snapshot ? () => download(snapshot) : null}
      />
      <Radar
        snapshot={snapshot}
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
        {selected && <Inspector channel={selected} onClose={() => setSelectedId(null)} />}
      </Radar>
      {snapshot && (
        <section className="w-full bg-space-deep px-gutter-desktop py-space-xl">
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-space-xl xl:grid-cols-12">
            <BreakoutFeed items={snapshot.breakouts} centerTitle={snapshot.center.title} />
            <Benchmarks snapshot={snapshot} selectedId={selectedId} onSelect={select} />
          </div>
        </section>
      )}
    </Shell>
  );
}
