// Edit by asking: apply the typed changes the AI chose (server/studio/ask.py) to a spec, as one undoable step.
// Every value is checked and clamped here, so an odd answer cannot break the clip.
import { ASPECTS, Aspect, CaptionPreset, Graphic, GraphicType, LabelStyle, LookPreset, Transition } from '../remotion/types';
import { EditSpec, addFreeze, addSpeed, clamp, newGraphic, removeFillers, round3, setAspect, uid, withSegments } from './logic';

export type AskChange = { op: string } & Record<string, unknown>;
export type AskResult = { changes: AskChange[]; reply: string; engine: string };

const HEX = /^#[0-9a-fA-F]{6}$/;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const yes = (v: unknown): boolean | undefined => (v === 'yes' ? true : v === 'no' ? false : undefined);
const DY: Record<string, number> = { top: -38, upper: -22, middle: 0, lower: 18, bottom: 32 };

/** The title that stays up all video (from a style), if the clip has one. */
function standingTitle(spec: EditSpec): Graphic | undefined {
  return spec.graphics.find((g) => g.origin === 'style' && g.type === 'label' && g.duration > (spec.out - spec.in) * 0.6);
}

/** Apply the changes in order. Returns the new spec and a line per change that could not be made. */
export function applyAsk(spec: EditSpec, changes: AskChange[]): { spec: EditSpec; skipped: string[]; made: AskChange[] } {
  let s: EditSpec = spec;
  const skipped: string[] = [];
  const made: AskChange[] = [];
  // the AI's times count from where the clip started before this request, even after a trim in the same request
  const start = spec.in;
  const at = (rel: unknown) => round3(clamp(start + (num(rel) ?? 0), s.in, s.out));
  const words = () => s.words.filter((w) => w.end > s.in && w.start < s.out);

  for (const c of changes) {
    const before = skipped.length;
    const prev = s;   // a change that is refused is undone on its own, keeping the ones before it
    switch (c.op) {
      case 'title': {
        const text = str(c.text).trim();
        const title = standingTitle(s);
        const visible = c.visible !== false;
        if (title) {
          s = { ...s, graphics: s.graphics.flatMap((g) => (g.id !== title.id ? [g] : visible ? [{ ...g, primary: text || g.primary }] : [])) };
        } else {
          s = { ...s, hook: { ...s.hook, text: text ? text.replace(/\{([^}|]*)(?:\|#[0-9a-fA-F]{3,8})?\}/g, '$1') : s.hook.text, visible } };
        }
        break;
      }
      case 'captions': {
        const cap = { ...s.captions };
        if (typeof c.visible === 'boolean') cap.visible = c.visible;
        if (str(c.look)) cap.preset = str(c.look) as CaptionPreset;
        if (str(c.font)) cap.font = str(c.font);
        if (num(c.size)) cap.size = clamp(num(c.size)!, 30, 140);
        if (HEX.test(str(c.colour))) cap.color = str(c.colour);
        if (HEX.test(str(c.highlight))) cap.highlight = str(c.highlight);
        if (num(c.position)) cap.position = clamp(num(c.position)!, 5, 95);
        if (num(c.words_per_line)) cap.maxWords = clamp(Math.round(num(c.words_per_line)!), 1, 8);
        if (yes(c.uppercase) !== undefined) cap.uppercase = yes(c.uppercase)!;
        if (c.punctuation === 'drop') cap.noPunct = true;
        if (c.punctuation === 'keep') cap.noPunct = false;
        s = { ...s, captions: cap };
        break;
      }
      case 'look': {
        const lk = { ...s.look };
        if (str(c.preset)) lk.preset = str(c.preset) as LookPreset;
        const fine = (key: 'brightness' | 'contrast' | 'saturation', lo: number, hi: number) => {
          const v = num(c[key]); if (v !== undefined && v >= 0) lk[key] = clamp(v, lo, hi);
        };
        fine('brightness', 0.7, 1.4); fine('contrast', 0.7, 1.4); fine('saturation', 0, 1.8);
        if (yes(c.black_and_white) !== undefined) lk.bw = yes(c.black_and_white)!;
        if (yes(c.vignette) !== undefined) lk.vignette = yes(c.vignette)!;
        if (yes(c.mirror) !== undefined) lk.flip = yes(c.mirror)!;
        const opt = (key: 'grain' | 'bars' | 'drift' | 'fadeIn' | 'fadeOut', from: string, hi: number) => {
          const v = num(c[from]); if (v !== undefined && v >= 0) lk[key] = clamp(v, 0, hi) || undefined;
        };
        opt('grain', 'grain', 1); opt('bars', 'bars', 18); opt('drift', 'push_in', 0.25); opt('fadeIn', 'fade_in', 2); opt('fadeOut', 'fade_out', 2);
        s = { ...s, look: lk };
        break;
      }
      case 'shape': {
        if (str(c.aspect) in ASPECTS) s = setAspect(s, str(c.aspect) as Aspect);
        if (num(c.fps) === 30 || num(c.fps) === 60) s = withSegments({ ...s, fps: num(c.fps)! });
        break;
      }
      case 'trim': {
        const a = num(c.start_seconds), b = num(c.end_seconds);
        // the end may move past the clip's current end, but not past the last word the clip knows plus a moment
        const last = Math.max(s.out, ...s.words.map((w) => w.end + 1));
        const tin = a !== undefined && a >= 0 ? start + a : s.in;
        const tout = Math.min(last, b !== undefined && b >= 0 ? start + b : s.out);
        if (tout - tin < 1) { skipped.push('The trim would leave less than a second, so it was not made.'); break; }
        s = withSegments({ ...s, in: round3(tin), out: round3(tout) });
        break;
      }
      case 'cut_words':
      case 'restore_words': {
        const ids = words().map((w) => w.id);
        const all = c.op === 'restore_words' && num(c.from_word) === -1;
        const lo = Math.min(num(c.from_word) ?? -1, num(c.to_word) ?? -1), hi = Math.max(num(c.from_word) ?? -1, num(c.to_word) ?? -1);
        if (!all && (!ids.includes(lo) || !ids.includes(hi))) { skipped.push(`Words ${lo}-${hi} are not in this clip.`); break; }
        const cut = c.op === 'cut_words';
        s = withSegments({ ...s, words: s.words.map((w) => (all || (w.id >= lo && w.id <= hi) ? { ...w, removed: cut } : w)) });
        if (cut && words().every((w) => w.removed)) { skipped.push('That would cut every word, so it was not made.'); s = prev; }
        break;
      }
      case 'tighten': {
        if (c.remove_fillers === true) s = removeFillers(s).spec;
        const p = num(c.pause_seconds);
        if (p !== undefined && p !== 0) s = withSegments({ ...s, edit: { ...(s.edit ?? { silence: 0 }), silence: p < 0 ? 0 : clamp(p, 0.15, 3) } });
        break;
      }
      case 'add_freeze':
        s = addFreeze(s, at(c.at_seconds), clamp(num(c.seconds) ?? 1, 0.2, 5));
        break;
      case 'remove_freeze': {
        const fz = s.freezes ?? [];
        if (num(c.at_seconds) === -1) { s = { ...s, freezes: [] }; break; }
        if (!fz.length) { skipped.push('There is no freeze to remove.'); break; }
        const t = at(c.at_seconds);
        const near = fz.reduce((a, b) => (Math.abs(b.at - t) < Math.abs(a.at - t) ? b : a));
        s = { ...s, freezes: fz.filter((f) => f !== near) };
        break;
      }
      case 'speed': {
        const a = at(c.from_seconds), b = at(c.to_seconds), rate = num(c.rate) ?? 1;
        if (b - a < 0.2) { skipped.push('That speed change is too short to make.'); break; }
        if (Math.abs(rate - 1) < 0.01) s = { ...s, speeds: (s.speeds ?? []).filter((x) => x.end <= a || x.start >= b) };
        else s = addSpeed(s, a, b - a, clamp(rate, 0.25, 8));
        break;
      }
      case 'zoom': {
        const t = at(c.at_seconds), scale = num(c.scale) ?? 1.2;
        if (scale <= 1.01) { s = { ...s, zooms: s.zooms.filter((z) => Math.abs(z.at - t) > 1) }; break; }
        s = { ...s, zooms: [...s.zooms, { id: uid(), at: t, duration: clamp(num(c.seconds) ?? 1.2, 0.3, 10), scale: clamp(scale, 1.02, 2) }].sort((x, y) => x.at - y.at) };
        break;
      }
      case 'add_graphic': {
        const type = str(c.type) as GraphicType;
        const g: Graphic = { ...newGraphic(type, at(c.at_seconds)), origin: 'ai' };
        g.duration = clamp(num(c.seconds) || g.duration, 0.2, 30);
        if (str(c.text)) g.primary = str(c.text);
        if (HEX.test(str(c.colour))) g.color = str(c.colour);
        if (type === 'label' && str(c.label_look)) g.style = str(c.label_look) as LabelStyle;
        if (g.zone === 'free' && !['flash', 'dip'].includes(type)) g.dy = DY[str(c.position)] ?? g.dy;
        s = { ...s, graphics: [...s.graphics, g].sort((x, y) => x.at - y.at) };
        break;
      }
      case 'edit_graphic': {
        const id = str(c.id);
        if (!s.graphics.some((g) => g.id === id)) { skipped.push(`There is no graphic with id ${id}.`); break; }
        if (c.remove === true) { s = { ...s, graphics: s.graphics.filter((g) => g.id !== id) }; break; }
        s = {
          ...s, graphics: s.graphics.map((g) => {
            if (g.id !== id) return g;
            const n = { ...g };
            if (str(c.text)) n.primary = str(c.text);
            if (HEX.test(str(c.colour))) n.color = str(c.colour);
            if ((num(c.at_seconds) ?? -1) >= 0) n.at = at(c.at_seconds);
            if (num(c.seconds)) n.duration = clamp(num(c.seconds)!, 0.2, 60);
            return n;
          }),
        };
        break;
      }
      case 'transition': {
        const type = str(c.type) as Transition;
        const shot = num(c.shot) ?? -1;
        const tdur = num(c.seconds) ? clamp(num(c.seconds)!, 0.15, 1.2) : undefined;
        if (s.shots.length < 2) { skipped.push('This clip has one shot, so there is nowhere to put a transition. Add a cut first (Framing → Cut at).'); break; }
        if (shot !== -1 && (shot < 2 || shot > s.shots.length)) { skipped.push(`There is no shot ${shot} to change (the first shot has no transition).`); break; }
        s = { ...s, shots: s.shots.map((x, i) => (i > 0 && (shot === -1 || i === shot - 1) ? { ...x, transition: type, tdur: tdur ?? x.tdur } : x)) };
        break;
      }
      case 'frame': {
        const fm = { ...(s.frame ?? { mode: 'full' as const, shape: 'rounded' as const, width: 100, aspect: 1, y: 50, bg: 'blur' as const }) };
        if (c.mode === 'full' || c.mode === 'panel') {
          fm.mode = c.mode;
          if (c.mode === 'panel' && fm.width >= 100) { fm.width = 90; fm.aspect = 0.957; fm.y = 52; }
        }
        if (['square', 'rounded', 'squircle'].includes(str(c.corners))) { fm.shape = str(c.corners) as typeof fm.shape; fm.corner = undefined; }
        if ((num(c.corner_size) ?? -1) >= 0) fm.corner = clamp(num(c.corner_size)!, 0, 50);
        if (c.background === 'blur' || c.background === 'black') fm.bg = c.background;
        s = { ...s, frame: fm };
        break;
      }
      case 'audio': {
        const a = { ...s.audio };
        const v = (k: string) => { const x = num(c[k]); return x !== undefined && x >= 0 ? clamp(x, 0, 1) : undefined; };
        if (v('voice') !== undefined) a.voice = v('voice')!;
        if (v('effects') !== undefined) a.fx = v('effects')!;
        if (v('music') !== undefined) { if (a.music) a.music = { ...a.music, volume: v('music')! }; else skipped.push('There is no music to change; add some under Framing → Audio.'); }
        s = { ...s, audio: a };
        break;
      }
      default:
        skipped.push(`Unknown change "${c.op}".`);
    }
    if (skipped.length === before) made.push(c);
  }
  return { spec: s, skipped, made };
}

/** One line per change, for the list shown after asking. */
export function describeChange(c: AskChange): string {
  const t = (v: unknown) => (num(v) !== undefined ? `${num(v)!.toFixed(1)}s` : '');
  switch (c.op) {
    case 'title': return c.visible === false ? 'Hid the title' : `Title: ${str(c.text).replace(/\{([^}|]*)(?:\|[^}]*)?\}/g, '$1') || 'unchanged'}`;
    case 'captions': return 'Changed the captions';
    case 'look': return 'Changed the look';
    case 'shape': return `Shape ${str(c.aspect) || ''} ${num(c.fps) ? num(c.fps) + ' fps' : ''}`.trim();
    case 'trim': return 'Trimmed the clip';
    case 'cut_words': return `Cut words ${c.from_word}–${c.to_word}`;
    case 'restore_words': return 'Put words back';
    case 'tighten': return 'Tightened pauses and fillers';
    case 'add_freeze': return `Freeze at ${t(c.at_seconds)}`;
    case 'remove_freeze': return 'Removed a freeze';
    case 'speed': return `Speed x${c.rate} from ${t(c.from_seconds)}`;
    case 'zoom': return `Zoom at ${t(c.at_seconds)}`;
    case 'add_graphic': return `Added ${str(c.type)}${str(c.text) ? ` "${str(c.text)}"` : ''} at ${t(c.at_seconds)}`;
    case 'edit_graphic': return c.remove === true ? 'Removed a graphic' : 'Changed a graphic';
    case 'transition': return `${str(c.type)} transition`;
    case 'frame': return 'Changed the picture frame';
    case 'audio': return 'Changed the volumes';
    default: return str(c.op);
  }
}

