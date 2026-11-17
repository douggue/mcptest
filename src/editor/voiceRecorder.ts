/** Microphone capture in the renderer. The stream never leaves the machine: the finished take
 * is handed to the main process as bytes and saved beside the project's other local media. */
export interface VoiceRecording {
  stop: () => Promise<Uint8Array>;
  cancel: () => void;
}
export async function startVoiceRecording(): Promise<VoiceRecording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined")
    throw new Error("此环境不支持录音");
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch {
    throw new Error("无法使用麦克风，请检查系统的麦克风权限和设备");
  }
  const type = ["audio/webm;codecs=opus", "audio/webm"].find((candidate) => MediaRecorder.isTypeSupported(candidate));
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  const finished = new Promise<void>((resolve, reject) => {
    recorder.addEventListener("stop", () => resolve(), { once: true });
    recorder.addEventListener("error", () => reject(new Error("录音失败")), { once: true });
  });
  recorder.start(1000);
  return {
    stop: async () => {
      if (recorder.state !== "inactive") recorder.stop();
      try { await finished; } finally { release(); }
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
      if (!bytes.length) throw new Error("没有录到声音");
      return bytes;
    },
    cancel: () => {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
