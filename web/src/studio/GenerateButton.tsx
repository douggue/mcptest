// A button that generates one still image and hands it back, for use inside the editor.
import { useEffect, useState } from 'react';

import { api } from '../api';
import { Button, Field, JobBar, Modal, Seg, toastError, useJobRunner } from '../ui';

export type GeneratedAsset = { url: string; type: 'image' | 'video' | 'gif' | 'audio'; name: string; label: string };

const SHAPES = ['9:16', '16:9', '1:1', '4:5', '3:4'];

/**
 * `prompt` pre-fills the description (for example the words spoken at the playhead), `aspect` is the short's shape.
 * `onDone` is called with the saved Library asset once the user accepts the picture.
 */
export function GenerateImageButton({ prompt, aspect, onDone, small = true, label = 'Generate image', disabled }: {
  prompt: string; aspect: string; onDone: (asset: GeneratedAsset) => void; small?: boolean; label?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(prompt);
  const [shape, setShape] = useState(SHAPES.includes(aspect) ? aspect : '9:16');
  const [result, setResult] = useState<GeneratedAsset | null>(null);
  const [hasKey, setHasKey] = useState(true);
  const { job, run, busy } = useJobRunner();

  useEffect(() => {
    if (!open) return;
    setText(prompt);
    setShape(SHAPES.includes(aspect) ? aspect : '9:16');
    setResult(null);
    api.get<{ key: boolean }>('/api/generate/options').then((o) => setHasKey(o.key)).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  async function generate() {
    try {
      setResult(await run<GeneratedAsset>(() => api.post('/api/generate/image', { prompt: text.trim(), aspect: shape })));
    } catch (e) { toastError(e); }
  }

  return (
    <>
      <Button small={small} icon="sparkle" onClick={() => setOpen(true)} disabled={disabled}>{label}</Button>
      {open && (
        <Modal title="Generate an image" onClose={() => !busy && setOpen(false)}>
          {!hasKey && <div className="notice warn">Pictures are made by Google's image model, so this needs a Gemini API key, even when Claude is set up. <a href="#/settings">Add one under Settings → AI</a>.</div>}
          <Field label="Describe the picture" hint="Say what is in it, where, and the mood. Ask for no text in the image.">
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          </Field>
          <Field label="Shape">
            <Seg small value={shape} onChange={setShape} options={SHAPES.map((s) => ({ value: s, label: s }))} />
          </Field>
          <JobBar job={job} />
          {result && <img src={result.url} alt="" style={{ maxHeight: 300, maxWidth: '100%', borderRadius: 10, alignSelf: 'center', display: 'block' }} />}
          <span className="small muted">Each image is billed by Google to your AI Studio account. It is also saved under Library → B-roll.</span>
          <div className="row">
            <span className="spacer" />
            <Button onClick={() => setOpen(false)} disabled={busy}>Close</Button>
            <Button variant={result ? 'default' : 'primary'} icon="sparkle" onClick={generate} busy={busy} disabled={!text.trim() || !hasKey}>{result ? 'Try again' : 'Generate'}</Button>
            {result && <Button variant="primary" icon="check" onClick={() => { onDone(result); setOpen(false); }} disabled={busy}>Use this image</Button>}
          </div>
        </Modal>
      )}
    </>
  );
}
