import type {
  CompetitorStatus,
  TransferIdea,
  LogoFound,
  MapSnapshot,
  NicheChannel,
  SavedChannel,
} from '@jgtube/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Benchmarks } from './components/Benchmarks';
import { ConnectionsContext, type Connections } from './components/Connections';
import { FlowStrip } from './components/FlowStrip';
import { useFlow } from './components/useFlow';
import { ideaFromTransfer } from './lib/flow';
import { ChangesSection } from './components/ChangesSection';
import { useAlertCounts } from './components/useAlerts';
import { OwnVideos } from './components/OwnVideos';
import { UploadCalendar } from './components/UploadCalendar';
import { LengthPacing } from './components/LengthPacing';
import { BreakoutFeed } from './components/BreakoutFeed';
import { Formulas } from './components/Formulas';
import { HookLibrary } from './components/HookLibrary';
import { IdeaLab } from './components/IdeaLab';
import { ScriptWriter } from './components/ScriptWriter';
import { Inspector } from './components/Inspector';
import { MapToolbar } from './components/MapToolbar';
import { Niches } from './components/Niches';
import { SameTopic } from './components/SameTopic';
import { SavedChannels } from './components/SavedChannels';
import { ScopeToggle } from './components/ScopeToggle';
import { Radar } from './components/Radar';
import { RefreshBar } from './components/RefreshBar';
import { Shell } from './components/Shell';
import { ThumbnailBoard } from './components/ThumbnailBoard';
import { Transfers } from './components/Transfers';
import { AskClaude } from './components/AskClaude';
import { useAnalysis } from './components/useAnalysis';
import { useBreakdown } from './components/useBreakdown';
import { useLab } from './components/useLab';
import { useLogos } from './components/useLogos';
import { useLabJob } from './components/useLabJob';
import { useScript } from './components/useScript';
import { useNiches } from './components/useNiches';
import { useRefresh } from './components/useRefresh';
import { useSameTopic } from './components/useSameTopic';
import { useThumbnailBoard } from './components/useThumbnailBoard';
import { useTransfers } from './components/useTransfers';
import { CRAWL_DEFAULT_DEPTH, CRAWL_DEFAULT_MAX_CHANNELS } from '@jgtube/core/src/limits';
import { createApi, type JobState } from './lib/api';
import { breakdownChoices } from './lib/breakdown';
import { inScope, type Scope } from './lib/feed';
import { createLabApi } from './lib/labApi';
import { createLogoApi, describeLogoRun, withLogos, withSavedLogos } from './lib/logos';
import { toggleModel, voiceChoices } from './lib/scriptWriter';
import { describeMix } from './lib/mix';
import { layoutRadar } from './lib/radarLayout';
import { uploadVideoFile } from './lib/upload';

const STORAGE_KEY = 'jgtube.channel';
const MODEL_STORAGE_KEY = 'jgtube.model';
const POLL_INTERVAL_MS = 1500;
/** The Ask AI section, which a breakdown started elsewhere on the page brings into view. */
const ASK_AI_ID = 'ask-claude';
/** The niche list before it has loaded: one empty list, so nothing is recomputed for it. */
const NO_NICHES: readonly NicheChannel[] = [];
/** The idea lab, which a formula taken into it brings into view. */
const IDEA_LAB_ID = 'idea-lab';
/** The script writer, which a concept's Draft button brings into view. */
const SCRIPT_WRITER_ID = 'script-writer';
const DEFAULT_DEPTH = CRAWL_DEFAULT_DEPTH;
const DEFAULT_SIZE = CRAWL_DEFAULT_MAX_CHANNELS;

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
  const labApi = useMemo(() => createLabApi(), []);
  const logoApi = useMemo(() => createLogoApi(), []);
  const [query, setQuery] = useState(recall);
  const [snapshot, setSnapshot] = useState<MapSnapshot | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [scope, setScope] = useState<Scope>('peers');
  const [model, setModel] = useState(() => recall(MODEL_STORAGE_KEY));
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [saved, setSaved] = useState<readonly SavedChannel[]>([]);

  // Every channel a map was made for. The row is a way back to them; if the
  // list cannot be read, the row keeps what it had and the rest of the page works.
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

  // A map made before logos were stored gains them in the background, as they are read.
  const putLogos = useCallback((mapId: number, found: readonly LogoFound[]) => {
    setSnapshot((now) => (now?.mapId === mapId ? withLogos(now, found) : now));
    setSaved((now) => withSavedLogos(now, found));
  }, []);
  const logoRun = useLogos(logoApi, snapshot, putLogos);

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

  // Back to a channel looked up earlier: its stored map, with nothing read from YouTube.
  const open = (channel: SavedChannel) => {
    const typed = channel.handle ? `@${channel.handle}` : channel.id;
    setQuery(typed);
    remember(typed);
    setMessage(null);
    void load(channel.id);
  };

  // Deletes a saved channel's map. If it was the one on screen, the screen
  // moves to the next saved channel, or back to the start when none is left.
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
    setSelectedId(null);
    setQuery('');
    remember('');
    setMessage(null);
  };

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
  const transfers = useTransfers(api, snapshot?.center.id ?? null, snapshot?.mapId ?? null);
  const analysis = useAnalysis(api);
  const breakdown = useBreakdown(api);
  const nicheChannels = niches.state.status === 'ready' ? niches.state.list.channels : NO_NICHES;
  const breakdownChannels = useMemo(
    () => (snapshot ? breakdownChoices(snapshot, { saved, niches: nicheChannels }) : []),
    [snapshot, saved, nicheChannels],
  );
  const labJobs = useLabJob(labApi);
  const lab = useLab(
    labApi,
    labJobs,
    snapshot?.center.id ?? null,
    snapshot?.mapId ?? null,
    analysis.choice,
  );
  // One AI run at a time, here as on the server: an analysis, a breakdown or one of the lab's.
  const asking =
    analysis.state.status === 'running' ||
    breakdown.state.status === 'running' ||
    labJobs.state.status === 'running';
  const script = useScript(labApi, labJobs, snapshot?.center.id ?? null, analysis.choice);
  const voices = useMemo(() => (snapshot ? voiceChoices(snapshot) : []), [snapshot]);
  const scriptModels = script.view?.script?.hookModels;
  /** Opens a concept's script; starting a script keeps its concept. */
  const draft = (conceptId: number) => {
    lab.keep(conceptId, true);
    script.open(conceptId);
    document
      .getElementById(SCRIPT_WRITER_ID)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const remix = (formulaId: number) => {
    lab.choose({ format: `formula:${formulaId}` });
    document.getElementById(IDEA_LAB_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const scrollTo = (id: string): void =>
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Read again whenever a run ends or a script changes, so the strip's counts stay true.
  const flow = useFlow(
    snapshot?.center.id ?? null,
    [
      labJobs.state.status,
      analysis.state.status,
      breakdown.state.status,
      script.view?.concept.id,
    ].join('|'),
  );
  const connections: Connections = {
    useVoice: (channel) => {
      script.change({ voiceChannelId: channel.id });
      scrollTo(SCRIPT_WRITER_ID);
    },
    voiceProblem: (channelId) =>
      script.view === null
        ? 'Open a script first: press “Write the script” on a concept in the idea lab.'
        : voices.some((voice) => voice.id === channelId)
          ? null
          : 'This channel is not on the map on screen, so its voice cannot be measured for this script.',
    useFormulas: (channel) => {
      lab.choose({ formulasFrom: channel });
      scrollTo(IDEA_LAB_ID);
    },
    useStyleLock: (channel) => flow.useStyleLock(channel.id),
    styleLock: flow.styleLock,
    stopStyleLock: flow.stopStyleLock,
    useReviewStyle: () => scrollTo(IDEA_LAB_ID),
  };
  /** Takes an idea of the transfer list into the idea lab: its best version on this map, and its template. */
  const conceptsFrom = (idea: TransferIdea): void => {
    if (!snapshot) return;
    const onMap = new Set([snapshot.center.id, ...snapshot.channels.map((channel) => channel.id)]);
    const taken = ideaFromTransfer(idea, onMap);
    if (taken.pick && !lab.picks.some((pick) => pick.videoId === taken.pick?.videoId)) {
      lab.pick(taken.pick);
    }
    lab.choose({ format: taken.format, fromIdea: taken.idea });
    scrollTo(IDEA_LAB_ID);
  };
  const reloadNiches = niches.reload;
  const reloadTransfers = transfers.reload;
  // A refresh stores new view counts and videos: the niche list turns them into
  // measured growth, and the transfer list may find new versions of an idea.
  const afterRefresh = useCallback(() => {
    reloadNiches();
    reloadTransfers();
  }, [reloadNiches, reloadTransfers]);
  const refresh = useRefresh(api, afterRefresh);
  const alertCounts = useAlertCounts(refresh.run.status);
  const selected = snapshot?.channels.find((channel) => channel.id === selectedId) ?? null;
  /** Starts a breakdown of any stored channel and brings the Ask AI section, where it reports, into view. */
  const breakDown = (channel: { readonly id: string; readonly title: string }): void => {
    breakdown.start({ id: channel.id, title: channel.title }, analysis.choice, false);
    document.getElementById(ASK_AI_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
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
    <ConnectionsContext.Provider value={snapshot ? connections : null}>
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
        {snapshot && <FlowStrip counts={flow.counts} />}
        {flow.problem && (
          <p
            role="alert"
            className="mx-auto w-full max-w-[1440px] px-gutter-desktop text-body-md text-error"
          >
            {flow.problem}
          </p>
        )}
        <SavedChannels
          channels={saved}
          currentId={snapshot?.center.id ?? null}
          busy={job?.status === 'running'}
          onOpen={open}
          onDelete={(channel) => void remove(channel)}
          badges={alertCounts.counts}
        />
        <ChangesSection
          snapshot={snapshot}
          reloadKey={refresh.run.status}
          onAlertsChanged={alertCounts.reload}
        />
        <Radar
          snapshot={visible}
          layout={layout}
          selectedId={selectedId}
          onSelect={select}
          emptyState={
            <div className="max-w-md rounded bg-space-canvas/80 p-space-lg backdrop-blur-md">
              {job?.status === 'running' ? (
                <div role="status">
                  <h1 className="text-headline-lg text-on-surface">Making your map</h1>
                  <p className="mt-2 text-body-lg text-on-surface-variant">
                    Jgtube is following YouTube&rsquo;s recommendations out from the channel and
                    reading the channels it finds. This takes a few minutes; the map appears here
                    when it is done. Keep this page open.
                  </p>
                </div>
              ) : (
                <>
                  <h1 className="text-headline-lg text-on-surface">Map who you compete with</h1>
                  <p className="mt-2 text-body-lg text-on-surface-variant">
                    Paste your channel above and press Find competitors. Jgtube follows
                    YouTube&rsquo;s recommendations out from your videos; a full map takes a few
                    minutes.
                  </p>
                </>
              )}
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
              mix={describeMix(snapshot.channels)}
            />
          )}
          {logoRun !== null && (
            <p
              role="status"
              className="absolute bottom-5 right-6 z-40 rounded-full bg-surface-card/90 px-3 py-1.5 text-label-caps text-on-surface-variant shadow-lg backdrop-blur-md"
            >
              {describeLogoRun(logoRun === 'starting' ? null : logoRun)}
            </p>
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
              busy={asking}
              onBreakDown={() => breakDown(selected)}
            />
          )}
        </Radar>
        {visible && (
          <section className="w-full bg-space-deep px-gutter-desktop py-space-xl">
            <div className="mx-auto grid max-w-[1440px] grid-cols-1 gap-space-xl xl:grid-cols-12">
              <BreakoutFeed
                items={visible.breakouts}
                centerTitle={visible.center.title}
                pickedIds={lab.picks.map((pick) => pick.videoId)}
                onPick={(item) =>
                  lab.pick({
                    videoId: item.videoId,
                    title: item.title,
                    channelTitle: item.channelTitle,
                    modelOpening: false,
                    from: 'breakout',
                  })
                }
              />
              <Benchmarks snapshot={visible} selectedId={selectedId} onSelect={select} />
            </div>
          </section>
        )}
        {snapshot && (
          <SameTopic
            state={sameTopic}
            centerTitle={snapshot.center.title}
            onSetStatus={setStatus}
          />
        )}
        {snapshot && (
          <ThumbnailBoard
            state={board}
            centerTitle={snapshot.center.title}
            modelId={snapshot.model?.id ?? null}
            onDownload={(channelId) => api.downloadThumbnails(channelId)}
            onDownloadTranscripts={(channelId) => api.downloadTranscripts(channelId)}
          />
        )}
        {snapshot && (
          <AskClaude
            analysis={analysis}
            breakdown={breakdown}
            channels={breakdownChannels}
            onSendVideo={uploadVideoFile}
            centerId={snapshot.center.id}
            centerTitle={snapshot.center.title}
          />
        )}
        {snapshot && (
          <Formulas lab={lab} busy={asking} centerTitle={snapshot.center.title} onRemix={remix} />
        )}
        {snapshot && (
          <HookLibrary
            lab={lab}
            busy={asking}
            centerTitle={snapshot.center.title}
            models={
              scriptModels && {
                chosen: scriptModels,
                toggle: (videoId) =>
                  script.change({ hookModels: toggleModel(scriptModels, videoId) }),
              }
            }
          />
        )}
        {snapshot && (
          <IdeaLab
            lab={lab}
            busy={asking}
            transfers={transfers.state.status === 'ready' ? transfers.state.list : null}
            centerTitle={snapshot.center.title}
            breakouts={snapshot.breakouts}
            onDraft={(concept) => draft(concept.id)}
          />
        )}
        {snapshot && <ScriptWriter script={script} lab={lab} busy={asking} voices={voices} />}
        <OwnVideos channelId={snapshot?.center.id ?? null} reloadKey={refresh.run.status} />
        <UploadCalendar channelId={snapshot?.center.id ?? null} reloadKey={refresh.run.status} />
        <LengthPacing channelId={snapshot?.center.id ?? null} reloadKey={refresh.run.status} />
        <Transfers
          transfers={transfers}
          hasMap={snapshot !== null}
          onMakeConcepts={snapshot ? conceptsFrom : undefined}
        />
        <Niches
          niches={niches}
          hasMap={snapshot !== null}
          onBreakDown={snapshot && !asking ? breakDown : undefined}
        />
        <RefreshBar refresh={refresh} />
        <p className="mx-auto w-full max-w-[1440px] px-gutter-desktop pb-space-xl text-label-caps text-outline">
          Jgtube reads YouTube&rsquo;s public pages without an account. That is outside
          YouTube&rsquo;s terms of service and can stop working without notice. Scores and earnings
          are estimates.
        </p>
      </Shell>
    </ConnectionsContext.Provider>
  );
}
