import { Word } from '../remotion/types';
import { EditSpec } from './logic';

export type Score = { total: number; hook: number; flow: number; value: number; trend: number };
export type Meta = { title: string; description: string; hashtags: string[] };
export type Clip = {
  id: string; title: string; created: number; status: 'draft' | 'approved' | 'posted'; reason: string;
  score: Score | null; meta: Meta; spec: EditSpec; profile_id?: string;
};
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
export type StyleAnalysis = {
  summary: string; pacing: string; varies: string[]; cannot_reproduce: string[]; unsure: string[];
  elements: { type: string; how: string }[]; title: { present: boolean; note: string };
};
export type StyleProfile = {
  id: string; name: string; builtin?: boolean; draft?: boolean; summary?: string; planner: 'speech' | 'story';
  style: Partial<EditSpec>; elements?: StyleElement[]; rules: StyleRule[]; brief: string;
  references?: { name: string; file: string; url: string; width?: number; height?: number; duration?: number; cuts?: number; shot_seconds?: number }[];
  analysis?: StyleAnalysis | null; note?: string; engine?: string; analysed?: number;
};
export type DirectPlan = {
  title: string; post_title: string; description: string; hashtags: string[]; notes: string[];
  elements: { type: string; at_seconds: number; seconds: number; text: string; colour: string; label_look: string; position: string; on_subject: boolean; animation: string }[];
  freezes: { at_seconds: number; seconds: number }[];
  speeds: { from_seconds: number; to_seconds: number; rate: number }[];
};
