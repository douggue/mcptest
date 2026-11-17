/** Real speech recognition on Windows: a system voice speaks a sentence and the bundled engine
 * transcribes it. Needs REACUT_WHISPER (the engine) and REACUT_SPEECH_MODEL (a ggml model file).
 * Run: npx tsx tests/speech-windows.ts */
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateSpeech, speechInfo, speechVoices } from "../electron/speech";
import { createProject } from "../src/core/model";

if (process.platform !== "win32") throw new Error("This check runs on Windows.");
const output = path.join(process.cwd(), ".test-output", "speech-windows");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const info = await speechInfo({});
assert(info.ready, `The engine or model is not usable: ${info.error}`);
assert.equal(info.engine, "whisper-cpp");
const voice = (await speechVoices()).find((item) => item.locale.startsWith("en_"));
assert(voice, "An English system voice is required");
const sentence = "The quick brown fox jumps over the lazy dog. Video editing runs on this computer.";
const project = createProject("Captions");
const spoken = await generateSpeech(randomUUID(), project, { mode: "tts", text: sentence, voice: voice.name, rate: 170 }, {}, output, () => {});
assert.equal(spoken.mode, "tts");
if (spoken.mode !== "tts") throw new Error("unreachable");
project.assets.push(spoken.asset);
const progress: number[] = [];
const started = Date.now();
const recognized = await generateSpeech(randomUUID(), project, { mode: "asr", source: `asset:${spoken.asset.id}`, language: "en" }, {}, output,
  (event) => { if (event.stage === "recognize" && event.progress !== undefined) progress.push(event.progress); });
assert.equal(recognized.mode, "asr");
if (recognized.mode !== "asr") throw new Error("unreachable");
const text = recognized.cues.map((cue) => cue.text).join(" ");
const heard = ["quick", "brown", "fox", "lazy", "dog", "computer"].filter((word) => text.toLowerCase().includes(word));
assert(heard.length >= 4, `Too few of the spoken words were recognised: "${text}"`);
for (const cue of recognized.cues) assert(cue.start >= 0 && cue.end > cue.start && cue.end <= spoken.asset.duration + 1, "Cue times must lie inside the recording");
const evidence = {
  passedAt: new Date().toISOString(), voice: voice.name, spokenSeconds: spoken.asset.duration, model: info.model, modelBytes: info.modelBytes,
  recognitionSeconds: (Date.now() - started) / 1000, cues: recognized.cues, wordsHeard: heard, progressReports: progress.length,
};
await writeFile(path.join(output, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log("Windows speech recognition checks passed:", JSON.stringify(evidence, null, 2));
