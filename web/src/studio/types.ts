import { Word } from '../remotion/types';
import { EditSpec } from './logic';

export type Score = { total: number; hook: number; flow: number; value: number; trend: number };
export type Meta = { title: string; description: string; hashtags: string[] };
/** What Find moments makes: standalone highlights, a numbered series, clips on one topic, or one recap / trailer of several pieces. */
export type ClipKind = 'highlights' | 'series' | 'topic' | 'recap' | 'trailer';
export type Clip = {
  id: string; title: string; created: number; status: 'draft' | 'approved' | 'posted'; reason: string;
  score: Score | null; meta: Meta; spec: EditSpec; profile_id?: string; kind?: ClipKind;
};
export type MomentsResult = { added: number; engine: string; note: string; performance_posts: number };
export type ExportAllResult = { exported: ExportRow[]; failed: { clip_id: string; title: string; error: string }[] };
export type Source = { url: string; duration: number; width: number; height: number; fps: number; poster: string; size?: number };
export type Project = {
  id: string; name: string; origin: string; created: number; source: Source;
  transcript: { words: Word[]; engine: string; language: string } | null; clips: Clip[];
};
export type ProjectSummary = {
  id: string; name: string; origin: string; created: number; source: Source; words: number; engine: string;
  clips: { id: string; title: string; score: Score | null; in: number; out: number; status: string }[];
};
export type Asset = { name: string; label: string; url: string; size: number; type: 'image' | 'video' | 'gif' | 'audio'; id: string };
export type Template = { id: string; name: string; note: string; spec: Partial<EditSpec> };
export type ExportRow = {
  id: string; created: number; project_id: string; clip_id: string; title: string; file: string; cover: string;
  duration: number; width: number; height: number; fps: number; size: number; status: string; copied_to?: string | null;
};

export type StyleRule = { id: string; kind: 'writing' | 'editing'; text: string; source: string; on: boolean };
export type StyleElement = {
  type: string; style?: string; color?: string; text: string; at: 'start' | 'end' | number; duration: 'all' | number;
  dx?: number; dy?: number; scale?: number; animation?: string;
};
export type StyleTextRole = {
  role: string; lettering: string; nearest_font: string; uppercase: boolean; italic: boolean; height_pct: number; colour: string;
  accents: { colour: string; used_for: string }[]; outline: string; shadow_or_glow: string; box: string; position: number; align: string;
  lines: number; words_per_line: number; arrives: string; stays_seconds: number; used_for: string;
};
/** The AI's report on a set of references. Older reports lack the newer sections, so most are optional. */
export type StyleAnalysis = {
  summary: string; pacing: string; varies: string[]; cannot_reproduce: string[]; unsure: string[];
  elements: { type: string; how: string; when?: string; seconds?: number }[]; title: { present: boolean; note: string };
  canvas?: string; opening?: string; ending?: string; transitions?: string; branding?: string;
  picture?: { mode: string; corners: string; background: string; box_position: number; box_width: number };
  framing?: { subject_size: string; subject_position: string; movement: string; note: string };
  text_styles?: StyleTextRole[];
  palette?: { colour: string; meaning: string }[];
  colour?: { brightness: number; contrast: number; saturation: number; black_and_white: boolean; vignette: boolean; note: string };
  structure?: { beat: string; from_seconds: number; to_seconds: number; on_screen: string }[];
  timeline?: { reference: number; at_seconds: number; kind: string; what: string }[];
  sound?: { music: string; effects: string; voice: string; words_per_minute?: number; captions_match_speech?: string };
  example_lines?: string[]; per_reference?: { reference: number; notes: string }[];
  confidence?: Record<string, 'low' | 'medium' | 'high'>;
};
export type StyleProfile = {
  id: string; name: string; builtin?: boolean; draft?: boolean; summary?: string; planner: 'speech' | 'story';
  style: Partial<EditSpec>; elements?: StyleElement[]; rules: StyleRule[]; brief: string;
  references?: { name: string; file: string; url: string; width?: number; height?: number; duration?: number; cuts?: number; shot_seconds?: number }[];
  analysis?: StyleAnalysis | null; note?: string; engine?: string; analysed?: number;
  /** What the planners may add in this style (built-in styles only; none means no limits). */
  limits?: { graphics: string[]; label_look?: string; sfx: boolean; emoji: boolean; hook: boolean; freezes: boolean; speeds: boolean; min_rate?: number; zooms: boolean; tracking: boolean };
  /** The style's own steps, shown as a checklist in the editor. */
  workflow?: StyleStep[];
};
export type StyleStep = { text: string; tool: '' | 'frame' | 'style' | 'words' | 'motion' | 'post'; check: string };
export type DirectPlan = {
  title: string; post_title: string; description: string; hashtags: string[]; notes: string[];
  elements: { type: string; at_seconds: number; seconds: number; text: string; colour: string; label_look: string; position: string; on_subject: boolean; animation: string }[];
  freezes: { at_seconds: number; seconds: number }[];
  speeds: { from_seconds: number; to_seconds: number; rate: number }[];
};

/* ---- YouTube posting (server/routers/youtube.py). Tokens never reach the browser. */
export type YouTubeChannel = {
  id: string; title: string; handle: string; thumbnail: string; account_id: string; account_handle: string;
  connected: number; needs_reconnect: boolean; problem: string; can_upload: boolean; checked: number;
};
export type YouTubeState = {
  client_id: string; client_secret_set: boolean; configured: boolean; redirect_url: string;
  redirect_source: 'saved' | 'env' | 'request' | 'desktop'; server_edition: boolean; channels: YouTubeChannel[];
  last: { ok: boolean; text: string; at: number; channel_id?: string } | null;
  notes: { unverified: string; quota: string; testing: string }; stand_in: boolean;
};
export type YouTubePrivacy = 'private' | 'unlisted' | 'public';
/** The `youtube` record on an Agency post that was uploaded (or is uploading) from Cutroom. */
export type YouTubeRecord = {
  state: 'uploading' | 'live' | 'scheduled' | 'private' | 'failed' | 'cancelled'; job_id?: string; channel_id: string;
  video_id?: string; privacy?: string; publish_at?: string; error?: string; warning?: string;
  likes?: number | null; comments?: number | null; checked?: number; uploaded?: number;
};
export type YouTubePost = {
  id: string; video_key: string; video_title: string; account_id: string; scheduled: string; status: string; url: string;
  views: number; caption: Meta; youtube: YouTubeRecord;
};
export type PublishResult = { post_id: string; video_id: string; url: string; privacy: string; publish_at: string; state: string; warnings: string[] };
/** An export row as /api/exports returns it; `meta` is the clip's post text when it was rendered. */
export type ExportWithMeta = ExportRow & { meta?: Meta };
