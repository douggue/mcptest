import { Word } from '../remotion/types';
import { EditSpec } from './logic';

export type Score = { total: number; hook: number; flow: number; value: number; trend: number };
export type Meta = { title: string; description: string; hashtags: string[] };
export type Clip = {
  id: string; title: string; created: number; status: 'draft' | 'approved' | 'posted'; reason: string;
  score: Score | null; meta: Meta; spec: EditSpec;
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
