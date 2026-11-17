import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DerivativeProgress } from "../core/types";
import { applyAudioCleanup, audioCleanupPlan, type AudioCleanupRequest } from "../core/audioCleanup";
import { useEditorStore } from "../editor/store";

export default function AudioCleanupDialog({ onClose }: { onClose(): void }) {
  const ui = useUITranslation();
  const [captured] = useState(() => {
    const s = useEditorStore.getState();
    return { project: s.project, clipId: s.selectedIds[0] };
  });
  const [denoise, setDenoise] = useState(true), [normalize, setNormalize] = useState(true);
  const [progress, setProgress] = useState<DerivativeProgress | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const running = useRef<string | null>(null), alive = useRef(true), cancelled = useRef(false);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.editorAPI?.onDerivativeProgress((event) => { if (event.jobId === running.current) setProgress(event); });
    return () => { alive.current = false; unsubscribe?.(); if (running.current) void window.editorAPI?.cancelAudioCleanup(running.current); };
  }, []);
  const request: AudioCleanupRequest = { denoise, normalize };
  let preflight = "";
  try { audioCleanupPlan(captured.project, captured.clipId, request); } catch (e) { preflight = (e as Error).message; }
  const start = async () => {
    if (!window.editorAPI || running.current) return;
    const jobId = crypto.randomUUID(); running.current = jobId; cancelled.current = false; setBusy(true); setError("");
    try {
      const asset = await window.editorAPI.cleanAudio(jobId, captured.project, captured.clipId, request);
      if (!alive.current || cancelled.current) return;
      const store = useEditorStore.getState();
      if (store.project !== captured.project) throw new Error(ui("处理期间项目已改变。未覆盖新编辑，请重新选择片段后处理。", "The project changed during processing. New edits were preserved. Select the clip again to retry."));
      const result = applyAudioCleanup(store.project, captured.clipId, request, asset);
      store.commit(result.project); store.select([result.clipId]);
      onClose();
    } catch (e) { if (alive.current) setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, "")); }
    finally { running.current = null; if (alive.current) setBusy(false); }
  };
  const title = ui("清理声音", "Clean up audio");
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2><button disabled={busy} aria-label={ui("关闭声音清理", "Close audio clean-up")} onClick={onClose}><X size={18}/></button></header>
    <div className="modal-body">
      <p>{captured.project.clips.find((c) => c.id === captured.clipId)?.name}</p>
      <label><input id="cleanup-denoise" type="checkbox" checked={denoise} disabled={busy} onChange={(e) => setDenoise(e.target.checked)} /> {ui("降低背景噪声（嘶声、嗡声、风扇声）", "Reduce background noise (hiss, hum, fan noise)")}</label>
      <label><input id="cleanup-normalize" type="checkbox" checked={normalize} disabled={busy} onChange={(e) => setNormalize(e.target.checked)} /> {ui("统一响度", "Even out the loudness")}</label>
      <p className="muted small">{ui("会为该片段的源文件生成一份处理后的副本并替换到片段上；原文件保持原样，可撤销。视频片段的画面不会重新编码。", "A cleaned copy of this clip's source file is created and used by the clip. The original file is unchanged and the edit can be undone. The picture of a video clip is not re-encoded.")}</p>
      {progress && <div className="export-progress"><p>{localizeMessage(progress.message)}</p><progress max={1} value={progress.progress}/><p>{Math.round(progress.progress * 100)}%</p></div>}
      {(error || preflight) && <p role="alert" className="inline-warning">{localizeMessage(error || preflight)}</p>}
    </div><footer>{busy ? <button onClick={() => { cancelled.current = true; if (running.current) void window.editorAPI?.cancelAudioCleanup(running.current); }}>{ui("取消处理", "Cancel processing")}</button> : <><button onClick={onClose}>{ui("关闭", "Close")}</button><button className="primary" disabled={!!preflight || !window.editorAPI} onClick={() => void start()}>{ui("开始清理", "Clean up")}</button></>}</footer>
  </section></div>;
}
