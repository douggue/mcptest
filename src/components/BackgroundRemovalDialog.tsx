import { localizeMessage } from "../i18n/messages";
import { useUITranslation } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DerivativeProgress } from "../core/types";
import { applyBackgroundRemoval, backgroundRemovalPlan } from "../core/backgroundRemoval";
import { useEditorStore } from "../editor/store";

export default function BackgroundRemovalDialog({ onClose }: { onClose(): void }) {
  const ui = useUITranslation();
  const [captured] = useState(() => {
    const s = useEditorStore.getState();
    return { project: s.project, clipId: s.selectedIds[0] };
  });
  const [model, setModel] = useState<{ ready: boolean; megabytes: number } | null>(null);
  const [download, setDownload] = useState<number | null>(null);
  const [progress, setProgress] = useState<DerivativeProgress | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const running = useRef<string | null>(null), alive = useRef(true), cancelled = useRef(false), downloading = useRef(false);
  const fail = (e: unknown) => { if (alive.current) setError(String(e).replace(/^Error: Error invoking remote method '[^']+': (?:Error: )?/, "")); };
  useEffect(() => {
    alive.current = true;
    void window.editorAPI?.getBackgroundModel().then((value) => { if (alive.current) setModel(value); }).catch(fail);
    const unsubscribe = window.editorAPI?.onDerivativeProgress((event) => {
      if (event.jobId === running.current) setProgress(event);
      if (event.jobId === "background-model" && alive.current) setDownload(event.progress);
    });
    return () => {
      alive.current = false; unsubscribe?.();
      if (running.current) void window.editorAPI?.cancelBackgroundRemoval(running.current);
      if (downloading.current) void window.editorAPI?.cancelBackgroundRemoval("background-model");
    };
  }, []);
  let preflight = "";
  try { backgroundRemovalPlan(captured.project, captured.clipId); } catch (e) { preflight = (e as Error).message; }
  const fetchModel = async () => {
    setError(""); setDownload(0); downloading.current = true;
    try { const value = await window.editorAPI!.downloadBackgroundModel(); if (alive.current) setModel(value); }
    catch (e) { fail(e); }
    finally { downloading.current = false; if (alive.current) setDownload(null); }
  };
  const start = async () => {
    if (!window.editorAPI || running.current) return;
    const jobId = crypto.randomUUID(); running.current = jobId; cancelled.current = false; setBusy(true); setError("");
    try {
      const result = await window.editorAPI.removeBackground(jobId, captured.project, captured.clipId);
      if (!alive.current || cancelled.current) return;
      const store = useEditorStore.getState();
      if (store.project !== captured.project) throw new Error(ui("处理期间项目已改变。未覆盖新编辑，请重新选择片段后处理。", "The project changed during processing. New edits were preserved. Select the clip again to retry."));
      const edited = applyBackgroundRemoval(store.project, captured.clipId, result);
      store.commit(edited.project); store.select([edited.clipId]);
      onClose();
    } catch (e) { fail(e); }
    finally { running.current = null; if (alive.current) setBusy(false); }
  };
  const title = ui("去除背景", "Remove background");
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header><h2>{title}</h2><button disabled={busy} aria-label={ui("关闭去除背景", "Close background removal")} onClick={onClose}><X size={18}/></button></header>
    <div className="modal-body">
      <p>{captured.project.clips.find((c) => c.id === captured.clipId)?.name}</p>
      <p>{ui("把画面中的人物从背景中分离出来，便于放到其他画面或背景之上。图片得到透明背景；视频会生成一份纯色背景的副本，并自动为片段开启色度抠像，可在“画面”中微调。", "Separates the person in the picture from the background so the clip can sit over other footage or a new backdrop. A still gets a transparent background. A video gets a copy with a flat-colour background and the clip's chroma key is switched on to remove it; you can fine-tune it under Picture.")}</p>
      <p className="muted small">{ui("在本机处理，视频大约每秒处理数帧，较长的片段需要等待。原文件保持原样，可撤销。", "Processing happens on this computer at a few frames a second, so longer clips take a while. The original file is unchanged and the edit can be undone.")}</p>
      {model && !model.ready && <div>
        <p role="status">{ui(`需要先下载人像模型（${model.megabytes} MiB），只需一次。`, `The person model (${model.megabytes} MiB) has to be downloaded first, once.`)}</p>
        <button disabled={busy || download !== null} onClick={() => void fetchModel()}>{ui("下载人像模型", "Download the person model")}</button>
      </div>}
      {download !== null && <div className="export-progress"><p>{ui("正在下载人像模型…", "Downloading the person model…")}</p><progress max={1} value={download}/><p>{Math.round(download * 100)}%</p><button onClick={() => void window.editorAPI?.cancelBackgroundRemoval("background-model")}>{ui("取消下载", "Cancel download")}</button></div>}
      {progress && <div className="export-progress"><p>{localizeMessage(progress.message)}</p><progress max={1} value={progress.progress}/><p>{Math.round(progress.progress * 100)}%</p></div>}
      {(error || preflight) && <p role="alert" className="inline-warning">{localizeMessage(error || preflight)}</p>}
    </div><footer>{busy ? <button onClick={() => { cancelled.current = true; if (running.current) void window.editorAPI?.cancelBackgroundRemoval(running.current); }}>{ui("取消处理", "Cancel processing")}</button> : <><button onClick={onClose}>{ui("关闭", "Close")}</button><button className="primary" disabled={!!preflight || !window.editorAPI || !model?.ready || download !== null} onClick={() => void start()}>{ui("开始去除", "Remove background")}</button></>}</footer>
  </section></div>;
}
