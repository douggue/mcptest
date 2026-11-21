import { useMemo } from 'react';
import { AskClaude } from './components/AskClaude';
import { Benchmarks } from './components/Benchmarks';
import { BreakoutFeed } from './components/BreakoutFeed';
import { ChangesSection } from './components/ChangesSection';
import { ConnectionsContext } from './components/Connections';
import { FlowStrip } from './components/FlowStrip';
import { Formulas } from './components/Formulas';
import { HookLibrary } from './components/HookLibrary';
import { IdeaLab } from './components/IdeaLab';
import { MapToolbar } from './components/MapToolbar';
import { Niches } from './components/Niches';
import { OwnVideos } from './components/OwnVideos';
import { RadarArea } from './components/RadarArea';
import { RefreshBar } from './components/RefreshBar';
import { SameTopic } from './components/SameTopic';
import { SavedChannels } from './components/SavedChannels';
import { ScriptWriter } from './components/ScriptWriter';
import { Shell } from './components/Shell';
import { ThumbnailBoard } from './components/ThumbnailBoard';
import { Transfers } from './components/Transfers';
import { UploadCalendar } from './components/UploadCalendar';
import { LengthPacing } from './components/LengthPacing';
import { CommentMining } from './components/CommentMining';
import { downloadMap, useMapPage } from './components/useMapPage';
import { usePagePath } from './components/usePagePath';
import { useWorkspace } from './components/useWorkspace';
import { createApi } from './lib/api';
import { toggleModel } from './lib/scriptWriter';
import { uploadVideoFile } from './lib/upload';

/**
 * The one page: the map at the top, then the sections in the rail's three
 * groups. Research: what is happening around the channel. Create: formats,
 * hooks, ideas and the script. Study: asking an AI, breakdowns and the
 * owner's own videos. Each section is one line here.
 */
export function App() {
  const api = useMemo(() => createApi(), []);
  const page = useMapPage(api);
  const { snapshot, visible } = page;
  const work = useWorkspace(api, snapshot, page.saved);
  const path = usePagePath(snapshot, work);
  const { lab, script, asking, refresh, transfers } = work;
  const centerId = snapshot?.center.id ?? null;
  const centerTitle = snapshot?.center.title ?? '';
  const scriptModels = script.view?.script?.hookModels;

  return (
    <ConnectionsContext.Provider value={snapshot ? path.connections : null}>
      <Shell>
        <MapToolbar
          center={snapshot?.center ?? null}
          query={page.query}
          onQueryChange={page.setQuery}
          model={page.model}
          onModelChange={page.setModel}
          measuredAgainst={snapshot?.model?.title ?? null}
          onSubmit={() => void page.submit()}
          job={page.job}
          message={page.message}
          depth={page.depth}
          onDepthChange={page.setDepth}
          size={page.size}
          onSizeChange={page.setSize}
          onExport={snapshot ? () => downloadMap(snapshot) : null}
        />
        {snapshot && <FlowStrip counts={path.flow.counts} />}
        {path.flow.problem && (
          <p
            role="alert"
            className="mx-auto w-full max-w-[1440px] px-gutter-desktop text-body-md text-error"
          >
            {path.flow.problem}
          </p>
        )}
        <SavedChannels
          channels={page.saved}
          currentId={centerId}
          busy={page.job?.status === 'running'}
          onOpen={page.open}
          onDelete={(channel) => void page.remove(channel)}
          badges={work.alertCounts.counts}
        />

        {/* Research */}
        <ChangesSection
          snapshot={snapshot}
          reloadKey={refresh.run.status}
          onAlertsChanged={work.alertCounts.reload}
        />
        <RadarArea page={page} busy={asking} onBreakDown={path.breakDown} />
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
              <Benchmarks snapshot={visible} selectedId={page.selectedId} onSelect={page.select} />
            </div>
          </section>
        )}
        {snapshot && (
          <SameTopic
            state={work.sameTopic}
            centerTitle={centerTitle}
            onSetStatus={page.setStatus}
          />
        )}
        {snapshot && (
          <ThumbnailBoard
            state={work.board}
            centerTitle={centerTitle}
            modelId={snapshot.model?.id ?? null}
            onDownload={(channelId) => api.downloadThumbnails(channelId)}
            onDownloadTranscripts={(channelId) => api.downloadTranscripts(channelId)}
          />
        )}
        <Transfers
          transfers={transfers}
          hasMap={snapshot !== null}
          onMakeConcepts={snapshot ? path.conceptsFrom : undefined}
        />
        <Niches
          niches={work.niches}
          hasMap={snapshot !== null}
          onBreakDown={snapshot && !asking ? path.breakDown : undefined}
        />

        {/* Create */}
        {snapshot && (
          <Formulas lab={lab} busy={asking} centerTitle={centerTitle} onRemix={path.remix} />
        )}
        {snapshot && (
          <HookLibrary
            lab={lab}
            busy={asking}
            centerTitle={centerTitle}
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
            centerTitle={centerTitle}
            breakouts={snapshot.breakouts}
            onDraft={(concept) => path.draft(concept.id)}
          />
        )}
        {snapshot && <ScriptWriter script={script} lab={lab} busy={asking} voices={work.voices} />}

        {/* Study */}
        {snapshot && (
          <AskClaude
            analysis={work.analysis}
            breakdown={work.breakdown}
            channels={work.breakdownChannels}
            onSendVideo={uploadVideoFile}
            centerId={snapshot.center.id}
            centerTitle={centerTitle}
          />
        )}
        <OwnVideos channelId={centerId} reloadKey={refresh.run.status} />
        <UploadCalendar channelId={centerId} reloadKey={refresh.run.status} />
        <LengthPacing channelId={centerId} reloadKey={refresh.run.status} />
        <CommentMining channelId={centerId} reloadKey={refresh.run.status} />

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
