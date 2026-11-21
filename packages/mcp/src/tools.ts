import type { FetchImage } from '@jgtube/core';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMakeMap } from './crawlTool';
import { ToolFailure, plainMessage } from './failure';
import { getConcept, getHooks, getIdeaBrief } from './labTools';
import { getFactSheet, type GetFactSheetArgs } from './factSheetTool';
import { getChannelNote, type GetChannelNoteArgs } from './noteTool';
import { getNearMisses, listNiches, setCompetitorStatus } from './ownerTools';
import { getBreakouts, getChannelVideos, getMap, getThumbnailBoard } from './readTools';
import { failureResult } from './results';
import type {
  GetBreakdownPartArgs,
  GetBreakoutsArgs,
  GetChannelBrandArgs,
  GetChannelVideosArgs,
  GetConceptArgs,
  GetHooksArgs,
  GetIdeaBriefArgs,
  GetMapArgs,
  GetNearMissesArgs,
  GetScriptArgs,
  GetThumbnailBoardArgs,
  GetTranscriptArgs,
  GetTranscriptPaceArgs,
  GetVideoDetailsArgs,
  GetVideoStudyArgs,
  ListNichesArgs,
  ListTransferOpportunitiesArgs,
  MakeMapArgs,
  SetCompetitorStatusArgs,
  ViewThumbnailsArgs,
  ViewVideoFramesArgs,
} from './schemas';
import { getScript } from './scriptTool';
import { getBreakdownPart, getFrameStudy, getVideoWatch } from './studyTools';
import { viewThumbnails } from './thumbnailTool';
import { listTransferOpportunities } from './transferTool';
import type { ConnectorEngine, ToolContext } from './types';
import {
  getChannelBrand,
  getTranscript,
  getTranscriptPace,
  getVideoDetails,
  viewVideoFrames,
} from './videoTools';

export interface ToolDeps {
  readonly engine: ConnectorEngine;
  /** Replaces the network for thumbnails and channel pictures; used by tests. */
  readonly fetchImage?: FetchImage;
  /** Where diagnostics go. Never standard output: that carries the protocol. */
  readonly log?: (line: string) => void;
}

export interface ToolHandlers {
  getMap(args: GetMapArgs): Promise<CallToolResult>;
  getBreakouts(args: GetBreakoutsArgs): Promise<CallToolResult>;
  getThumbnailBoard(args: GetThumbnailBoardArgs): Promise<CallToolResult>;
  viewThumbnails(args: ViewThumbnailsArgs): Promise<CallToolResult>;
  getChannelVideos(args: GetChannelVideosArgs): Promise<CallToolResult>;
  makeMap(args: MakeMapArgs, context?: ToolContext): Promise<CallToolResult>;
  getNearMisses(args: GetNearMissesArgs): Promise<CallToolResult>;
  setCompetitorStatus(args: SetCompetitorStatusArgs): Promise<CallToolResult>;
  listNiches(args: ListNichesArgs): Promise<CallToolResult>;
  listTransferOpportunities(args: ListTransferOpportunitiesArgs): Promise<CallToolResult>;
  getTranscript(args: GetTranscriptArgs): Promise<CallToolResult>;
  viewVideoFrames(args: ViewVideoFramesArgs): Promise<CallToolResult>;
  getChannelBrand(args: GetChannelBrandArgs): Promise<CallToolResult>;
  getVideoDetails(args: GetVideoDetailsArgs): Promise<CallToolResult>;
  getVideoWatch(args: GetVideoStudyArgs): Promise<CallToolResult>;
  getFrameStudy(args: GetVideoStudyArgs): Promise<CallToolResult>;
  getIdeaBrief(args: GetIdeaBriefArgs): Promise<CallToolResult>;
  getConcept(args: GetConceptArgs): Promise<CallToolResult>;
  getHooks(args: GetHooksArgs): Promise<CallToolResult>;
  getScript(args: GetScriptArgs): Promise<CallToolResult>;
  getTranscriptPace(args: GetTranscriptPaceArgs): Promise<CallToolResult>;
  getBreakdownPart(args: GetBreakdownPartArgs): Promise<CallToolResult>;
  getChannelNote(args: GetChannelNoteArgs): Promise<CallToolResult>;
  getFactSheet(args: GetFactSheetArgs): Promise<CallToolResult>;
}

/** The default place for diagnostics. */
export const logToStderr = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * The tools as plain functions. Every failure, expected or not, comes back as
 * an error result holding one clean sentence; unexpected ones are also logged.
 */
export function createToolHandlers(deps: ToolDeps): ToolHandlers {
  const { engine, fetchImage } = deps;
  const log = deps.log ?? logToStderr;
  const makeMap = createMakeMap(engine);

  const guarded = async (
    tool: string,
    work: () => CallToolResult | Promise<CallToolResult>,
  ): Promise<CallToolResult> => {
    try {
      return await work();
    } catch (error) {
      const message = plainMessage(error);
      if (!(error instanceof ToolFailure)) log(`jgtube ${tool} failed: ${message}`);
      return failureResult(message);
    }
  };

  return {
    getMap: (args) => guarded('get_map', () => getMap(engine, args)),
    getBreakouts: (args) => guarded('get_breakouts', () => getBreakouts(engine, args)),
    getThumbnailBoard: (args) =>
      guarded('get_thumbnail_board', () => getThumbnailBoard(engine, args)),
    viewThumbnails: (args) => guarded('view_thumbnails', () => viewThumbnails(fetchImage, args)),
    getChannelVideos: (args) => guarded('get_channel_videos', () => getChannelVideos(engine, args)),
    makeMap: (args, context) => guarded('make_map', () => makeMap(args, context)),
    getNearMisses: (args) => guarded('get_near_misses', () => getNearMisses(engine, args)),
    setCompetitorStatus: (args) =>
      guarded('set_competitor_status', () => setCompetitorStatus(engine, args)),
    listNiches: (args) => guarded('list_niches', () => listNiches(engine, args)),
    listTransferOpportunities: (args) =>
      guarded('list_transfer_opportunities', () => listTransferOpportunities(engine, args)),
    getTranscript: (args) => guarded('get_transcript', () => getTranscript(engine, args)),
    viewVideoFrames: (args) => guarded('view_video_frames', () => viewVideoFrames(engine, args)),
    getChannelBrand: (args) =>
      guarded('get_channel_brand', () => getChannelBrand(engine, fetchImage, args)),
    getVideoDetails: (args) => guarded('get_video_details', () => getVideoDetails(engine, args)),
    getVideoWatch: (args) => guarded('get_video_watch', () => getVideoWatch(engine, args)),
    getFrameStudy: (args) => guarded('get_frame_study', () => getFrameStudy(engine, args)),
    getIdeaBrief: (args) => guarded('get_idea_brief', () => getIdeaBrief(engine, args)),
    getConcept: (args) => guarded('get_concept', () => getConcept(engine, args)),
    getHooks: (args) => guarded('get_hooks', () => getHooks(engine, args)),
    getScript: (args) => guarded('get_script', () => getScript(engine, args)),
    getTranscriptPace: (args) =>
      guarded('get_transcript_pace', () => getTranscriptPace(engine, args)),
    getBreakdownPart: (args) => guarded('get_breakdown_part', () => getBreakdownPart(engine, args)),
    getChannelNote: (args) => guarded('get_channel_note', () => getChannelNote(engine, args)),
    getFactSheet: (args) => guarded('get_fact_sheet', () => getFactSheet(engine, args)),
  };
}
