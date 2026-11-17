import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { access, copyFile, link, mkdir, mkdtemp, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { importAssets, probeFile, runMediaTool } from './media';
import { speechSource, validateCues, type SpeechInfo, type SpeechProgress, type SpeechRequest, type SpeechResult, type SpeechEngine, type SpeechModelName, type SpeechSettings, type SpeechVoice } from '../src/core/speech';
import type { Project } from '../src/core/types';

// Always pass a local model directory and decoded PCM; neither the model loader nor FFmpeg can fetch URLs.
export const whisperWorker = String.raw`
import sys, os, json, wave, socket
os.environ['HF_HUB_OFFLINE']='1'
os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
os.environ['TRANSFORMERS_OFFLINE']='1'
def no_network(*args, **kwargs): raise RuntimeError('Network is disabled in local speech recognition')
socket.socket.connect=no_network
socket.create_connection=no_network
import mlx_whisper, numpy as np, importlib
if sys.argv[1]=='check':
    print(json.dumps({'ready':True}),flush=True)
    sys.exit(0)
model, audio, language = sys.argv[1:4]
if not os.path.isdir(model): raise RuntimeError('Local model directory is missing')
class Progress:
    def __init__(self,*args,**kwargs): self.total=kwargs.get('total',1); self.n=0
    def __enter__(self): return self
    def __exit__(self,*args): pass
    def update(self,n):
        self.n+=n
        print(json.dumps({'progress':min(1,self.n/self.total)}),flush=True)
importlib.import_module('mlx_whisper.transcribe').tqdm.tqdm=Progress
with wave.open(audio,'rb') as f:
    assert f.getframerate()==16000 and f.getnchannels()==1 and f.getsampwidth()==2
    pcm=np.frombuffer(f.readframes(f.getnframes()),dtype=np.int16).astype(np.float32)/32768.0
# Keep a short safety margin, but do not let a model timestamp a long digital-silence prefix at zero.
active=np.flatnonzero(np.abs(pcm)>0.0001)
if not len(active):
    print(json.dumps({'cues':[]}),flush=True)
    sys.exit(0)
offset=max(0, int(active[0])-1280) if active[0]>3200 else 0
r=mlx_whisper.transcribe(pcm[offset:],path_or_hf_repo=model,language=None if language=='auto' else language,task='transcribe',verbose=False,temperature=0,condition_on_previous_text=False,word_timestamps=True)
cues=[]
def units(text): return sum(2 if ord(c)>0x2e80 else 1 for c in text)
def emit(words):
    if words and words[-1]['end']>words[0]['start']:
        cues.append({'start':words[0]['start']+offset/16000,'end':words[-1]['end']+offset/16000,'text':''.join(w['word'] for w in words).strip()})
for s in r['segments']:
    words=s.get('words',[])
    if not words:
        if s['end']>s['start']: cues.append({'start':s['start']+offset/16000,'end':s['end']+offset/16000,'text':s['text']})
        continue
    group=[]
    for w in words:
        if group and (units(''.join(x['word'] for x in group)+w['word'])>42 or w['end']-group[0]['start']>5):
            emit(group);group=[]
        group.append(w)
        if w['word'].strip().endswith(('.', '?', '!', '。', '？', '！')): emit(group);group=[]
    emit(group)
print(json.dumps({'cues':cues},ensure_ascii=False),flush=True)
`;
/** Only abandoned per-job temporary directories are removed at app startup. Completed WAVs are retained. */
export async function cleanSpeechTemporaries(directory:string) {
  try { for (const entry of await readdir(directory,{withFileTypes:true})) if(entry.isDirectory()&&entry.name.startsWith('.speech-')) await rm(path.join(directory,entry.name),{recursive:true,force:true}); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
}
const jobs = new Map<string,{controller:AbortController;done:Promise<SpeechResult>}>();
export function cancelSpeech(id:string) { if(id==='model-download') modelDownload?.abort(); jobs.get(id)?.controller.abort(); }
export async function cancelAllSpeech() { modelDownload?.abort(); for(const j of jobs.values()) j.controller.abort(); await Promise.allSettled([...jobs.values()].map(j=>j.done)); }
export async function runSpeechProcess(file:string,args:string[],signal?:AbortSignal,onLine?:(line:string)=>void,timeout=120000,extraEnv:Record<string,string>={},extra:{cwd?:string;onErrorLine?:(line:string)=>void}={}):Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{shell:false,windowsHide:true,cwd:extra.cwd,env:{...process.env,HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1',...extraEnv}});
    let output='', pending='', diagnostic='', failure:Error|undefined;
    const abort=()=>{failure=new Error('Speech task cancelled.');child.kill('SIGKILL');};
    signal?.addEventListener('abort',abort,{once:true}); if(signal?.aborted) abort();
    const timer=setTimeout(()=>{failure=new Error('Local speech process timed out.');child.kill('SIGKILL');},timeout);
    child.stdout.on('data',data=>{ output+=data; pending+=data; if(output.length>8*1024*1024){failure=new Error('Speech output exceeds limit.');child.kill('SIGKILL');return;}const lines=pending.split('\n');pending=lines.pop()??'';for(const line of lines) onLine?.(line); });
    child.stderr.on('data',data=>{diagnostic=(diagnostic+data).slice(-4000);if(extra.onErrorLine) for(const line of String(data).split(/\r?\n/)) if(line) extra.onErrorLine(line);});
    child.on('error',e=>{failure=e;});
    child.on('close',code=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure||code!==0) reject(failure??new Error(`Local speech failed: ${diagnostic || code}`));else resolve(output);});
  });
}
// Windows: the System.Speech (SAPI) engine that ships with the OS. Scripts are fixed text; voice,
// rate and file paths travel only through the child environment, never through the command line.
const sapiPrelude="$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;Add-Type -AssemblyName System.Speech;$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;";
const sapiVoices=sapiPrelude+"$s.GetInstalledVoices()|Where-Object{$_.Enabled}|ForEach-Object{$_.VoiceInfo.Name+\"`t\"+$_.VoiceInfo.Culture.Name}";
const sapiSpeak=sapiPrelude+"$s.SelectVoice($env:REACUT_TTS_VOICE);$s.Rate=[int]$env:REACUT_TTS_RATE;$s.SetOutputToWaveFile($env:REACUT_TTS_OUTPUT);$s.Speak([System.IO.File]::ReadAllText($env:REACUT_TTS_INPUT,[System.Text.Encoding]::UTF8));$s.Dispose()";
function runSAPI(script:string,env:Record<string,string>,signal:AbortSignal|undefined,timeout:number):Promise<string> {
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  return runSpeechProcess(powershell,['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],signal,undefined,timeout,env);
}
/** SAPI rates run from -10 (one third speed) to 10 (triple speed) around roughly 175 words/minute. */
export function sapiRate(wordsPerMinute:number):number {
  return Math.max(-10,Math.min(10,Math.round(10*Math.log(wordsPerMinute/175)/Math.log(3))));
}
export function parseSAPIVoices(output:string):SpeechVoice[] {
  return output.split(/\r?\n/).flatMap(line=>{const m=line.match(/^([^\t]+)\t([A-Za-z]{2,3})-([A-Za-z0-9-]+)$/);return m?[{name:m[1].trim(),locale:`${m[2]}_${m[3]}`}]:[];});
}
/** Apple Silicon keeps its MLX worker; every other system uses the whisper.cpp command-line engine. */
export const speechEngine=():SpeechEngine=>process.platform==='darwin'&&process.arch==='arm64'?'mlx':'whisper-cpp';
let bundledSpeechTools:string|undefined;
/** The packaged main process supplies the folder that holds the bundled recognition engine. */
export function setBundledSpeechToolsDirectory(directory:string) { bundledSpeechTools=directory; }
export async function whisperExecutable():Promise<string|undefined> {
  const candidates=[process.env.REACUT_WHISPER,bundledSpeechTools&&path.join(bundledSpeechTools,process.platform==='win32'?'whisper-cli.exe':'whisper-cli')];
  for(const candidate of candidates) if(candidate&&path.isAbsolute(candidate)) { try { if((await stat(candidate)).isFile()) return candidate; } catch { /* Next candidate. */ } }
  return undefined;
}
/** Size of a whisper.cpp model file, after checking that it starts with the format's marker. */
export async function ggmlModelBytes(file:string):Promise<number> {
  if(!path.isAbsolute(file)) throw new Error('Choose a speech model file (ggml .bin).');
  let handle;
  try { handle=await open(file,'r'); } catch { throw new Error('The speech model file is missing. Download or choose it again.'); }
  try {
    const head=Buffer.alloc(4), info=await handle.stat();
    await handle.read(head,0,4,0);
    if(!info.isFile()||info.size<1024*1024||head.readUInt32LE(0)!==0x67676d6c) throw new Error('This file is not a Whisper speech model (ggml .bin).');
    return info.size;
  } finally { await handle.close(); }
}
/** Models published for whisper.cpp, with the checksums listed in that project's own documentation. */
export const WHISPER_MODELS:Record<SpeechModelName,{file:string;megabytes:number;sha1:string}>={
  base:{file:'ggml-base.bin',megabytes:142,sha1:'465707469ff3a37a2b9b8d8f89f2f99de7299dac'},
  small:{file:'ggml-small.bin',megabytes:466,sha1:'55356645c2b361a969dfd0ef2c5a50d530afd8d5'},
};
const WHISPER_MODEL_SOURCE='https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
let modelDownload:AbortController|undefined;
async function sha1File(file:string):Promise<string> {
  const hash=createHash('sha1'), handle=await open(file,'r');
  try { for await(const chunk of handle.createReadStream()) hash.update(chunk); } finally { await handle.close(); }
  return hash.digest('hex');
}
/** Download one model, only ever because the user pressed the button. The file is kept only if
 * it matches its published checksum; an interrupted or altered download leaves nothing behind. */
export async function downloadWhisperModel(name:SpeechModelName,directory:string,progress:(fraction:number)=>void,fetcher:typeof globalThis.fetch=globalThis.fetch,catalog=WHISPER_MODELS):Promise<string> {
  const model=catalog[name];
  if(!model) throw new Error('Unknown speech model.');
  if(modelDownload) throw new Error('A speech model download is already running.');
  const controller=new AbortController(); modelDownload=controller;
  const destination=path.join(directory,model.file), partial=destination+'.partial';
  try {
    await mkdir(directory,{recursive:true});
    try { if(await sha1File(destination)===model.sha1) { progress(1); return destination; } } catch { /* Not downloaded yet. */ }
    controller.signal.throwIfAborted();
    const response=await fetcher(WHISPER_MODEL_SOURCE+model.file,{signal:controller.signal,redirect:'follow'});
    if(!response.ok||!response.body) throw new Error(`The speech model download failed (HTTP ${response.status}).`);
    const total=Number(response.headers.get('content-length'))||model.megabytes*1024*1024;
    const hash=createHash('sha1'), file=createWriteStream(partial);
    let received=0;
    try {
      for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        received+=chunk.length;
        if(received>2*model.megabytes*1024*1024) throw new Error('The speech model download is larger than expected.');
        hash.update(chunk);
        if(!file.write(chunk)) await once(file,'drain');
        progress(Math.min(.99,received/total));
      }
    } finally { await new Promise<void>(resolve=>file.end(()=>resolve())); }
    if(hash.digest('hex')!==model.sha1) throw new Error('The downloaded speech model failed its integrity check. Try again.');
    await rename(partial,destination);
    progress(1);
    return destination;
  } catch(error) {
    await rm(partial,{force:true}).catch(()=>{});
    throw controller.signal.aborted?new Error('The speech model download was cancelled.'):error;
  } finally { modelDownload=undefined; }
}
/** whisper.cpp's JSON: one entry per caption-sized segment with millisecond offsets. */
export function parseWhisperOutput(text:string):{start:number;end:number;text:string}[] {
  const data=JSON.parse(text);
  if(!data||!Array.isArray(data.transcription)) throw new Error('Invalid recognition result.');
  return data.transcription.flatMap((segment:any)=>{
    const from=Number(segment?.offsets?.from), to=Number(segment?.offsets?.to), words=typeof segment?.text==='string'?segment.text.trim():'';
    // Bracketed entries such as [BLANK_AUDIO] or (music) describe sounds, not speech.
    return Number.isFinite(from)&&Number.isFinite(to)&&to>from&&words&&!/^[\[(].*[\])]$/.test(words)?[{start:from/1000,end:to/1000,text:words}]:[];
  });
}
async function recognizeWithWhisper(executable:string,model:string,temp:string,language:string,signal:AbortSignal,progress:(value:number)=>void):Promise<unknown> {
  // The tool reads its arguments in the system code page, so every path it is given stays plain
  // ASCII: it runs inside the job folder and a model under a non-ASCII path is linked in beside it.
  let modelArgument=model;
  if(!/^[\x20-\x7e]+$/.test(model)) {
    modelArgument='model.bin';
    try { await link(model,path.join(temp,modelArgument)); } catch { await copyFile(model,path.join(temp,modelArgument)); }
  }
  await runSpeechProcess(executable,['-m',modelArgument,'-f','speech.wav','-l',language,'-t',String(Math.max(1,Math.min(8,os.availableParallelism()))),'-ml','42','-sow','-oj','-of','speech','-pp'],signal,undefined,3600000,{},
    {cwd:temp,onErrorLine:line=>{const match=/progress\s*=\s*(\d+)%/.exec(line);if(match&&!signal.aborted) progress(Math.min(1,Number(match[1])/100));}});
  return parseWhisperOutput(await readFile(path.join(temp,'speech.json'),'utf8'));
}
export async function speechVoices(signal?:AbortSignal):Promise<SpeechVoice[]> {
  if(process.platform==='win32') return parseSAPIVoices(await runSAPI(sapiVoices,{},signal,30000));
  if(process.platform!=='darwin') return [];
  const result=await runSpeechProcess('/usr/bin/say',['-v','?'],signal,undefined,15000);
  return result.split('\n').flatMap(line=>{const m=line.match(/^(.+?)\s+([a-z]{2,3}_[A-Z]{2})\s+#/);return m?[{name:m[1].trim(),locale:m[2]}]:[];});
}
export async function localSpeechSettings(settings:SpeechSettings):Promise<SpeechSettings> {
  const result={...settings};
  result.python=process.env.REACUT_SPEECH_PYTHON || result.python;
  result.model=process.env.REACUT_SPEECH_MODEL || result.model;
  if(!result.model&&speechEngine()==='mlx') {
    const snapshots=path.join(os.homedir(),'.cache/huggingface/hub/models--mlx-community--whisper-small-mlx/snapshots');
    try {const entries=await readdir(snapshots);for(const entry of entries.sort()){try {const folder=path.join(snapshots,entry);await modelBytes(folder);result.model=folder;break;} catch { /* Skip incomplete cached snapshots. */ }}} catch { /* No download. */ }
  }
  return result;
}
async function modelBytes(folder:string):Promise<number> {
  if(!path.isAbsolute(folder)) throw new Error('Choose a local MLX model folder (config.json and weights.npz / weights.safetensors).');
  await access(path.join(folder,'config.json'));
  for(const name of ['weights.safetensors','weights.npz']) {try {const s=await stat(path.join(folder,name));if(s.isFile()&&s.size>0) return s.size;}catch{/* Next format. */}}
  throw new Error('Local model weights are missing; no files will be downloaded.');
}
export async function speechInfo(settings:SpeechSettings):Promise<SpeechInfo> {
  const config=await localSpeechSettings(settings), voices=await speechVoices().catch(()=>[]);
  const engine=speechEngine();
  try {
    if(engine==='whisper-cpp') {
      if(!(await whisperExecutable())) throw new Error('The speech recognition engine is not part of this installation.');
      if(!config.model) throw new Error('Download or choose a speech model first.');
      return {...config,engine,ready:true,modelBytes:await ggmlModelBytes(config.model),voices};
    }
    if(!config.python || !path.isAbsolute(config.python)) throw new Error('Choose an existing Python executable with mlx-whisper installed. No automatic installation.');
    if(!config.model) throw new Error('Select an already downloaded MLX Whisper model folder.');
    const bytes=await modelBytes(config.model);
    await runSpeechProcess(config.python,['-c',whisperWorker,'check'],undefined,undefined,30000);
    return {...config,engine,ready:true,modelBytes:bytes,voices};
  }catch(e){return {...config,engine,ready:false,error:(e as Error).message,voices};}
}
export function generateSpeech(jobId:string,p:Project,request:SpeechRequest,settings:SpeechSettings,directory:string,progress:(p:SpeechProgress)=>void):Promise<SpeechResult> {
  if(typeof jobId!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(jobId)) throw new Error('Invalid speech job.');
  if(jobs.size) throw new Error('A speech task is already running.');
  if(!request || !['asr','tts'].includes(request.mode)) throw new Error('Invalid speech request.');
  const controller=new AbortController();
  const done=Promise.resolve().then(generate).finally(()=>jobs.delete(jobId));jobs.set(jobId,{controller,done});return done;
  async function generate():Promise<SpeechResult>{
    const {signal}=controller;let temp:string|undefined;
    const report=(stage:SpeechProgress['stage'],value?:number)=>{signal.throwIfAborted();progress({jobId,stage,progress:value});};
    try {
      report('prepare',0);await mkdir(directory,{recursive:true});temp=await mkdtemp(path.join(directory,'.speech-'));
      const wav=path.join(temp,'speech.wav');
      if(request.mode==='asr'){
        if(!['auto','zh','en'].includes(request.language)||typeof request.source!=='string') throw new Error('Invalid recognition language/source.');
        const source=speechSource(p,request.source), config=await localSpeechSettings(settings);
        const engine=speechEngine(), executable=engine==='whisper-cpp'?await whisperExecutable():undefined;
        if(engine==='whisper-cpp') {
          if(!executable||!config.model) throw new Error('Download or choose a speech model first.');
          await ggmlModelBytes(config.model);
        } else {
          if(!config.python||!path.isAbsolute(config.python)||!config.model) throw new Error('Configure local MLX Whisper and Python first.');
          await modelBytes(config.model);
        }
        const probe=await probeFile(source.asset.path,signal);if(!probe.streams.some(s=>s.codec_type==='audio')) throw new Error('Source has no audio stream.');
        const before=await stat(source.asset.path);
        await runMediaTool('ffmpeg',['-v','error','-nostdin','-y','-ss',String(source.sourceIn),'-i',source.asset.path,'-t',String(source.duration),'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',wav],3600000,1024*1024,{signal});
        report('recognize',0);let cues:unknown;
        if(executable) cues=await recognizeWithWhisper(executable,config.model!,temp,request.language,signal,value=>report('recognize',value));
        else await runSpeechProcess(config.python!,['-c',whisperWorker,config.model!,wav,request.language],signal,line=>{
          try {const event=JSON.parse(line);if(Number.isFinite(event.progress)) report('recognize',Math.max(0,Math.min(1,event.progress)));if(event.cues) cues=event.cues;}catch{ /* Non-protocol runtime output. */ }
        },3600000);
        signal.throwIfAborted();const after=await stat(source.asset.path);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs) throw new Error('Source changed during recognition.');
        const validated=validateCues(cues,source.duration);if(!validated.length) throw new Error('No speech detected.');
        report('complete',1);return {mode:'asr',cues:validated};
      }
      if(process.platform!=='darwin'&&process.platform!=='win32') throw new Error('Local system TTS currently requires macOS or Windows.');
      if(typeof request.text!=='string'||!request.text.trim()||request.text.length>10000||!Number.isInteger(request.rate)||request.rate<80||request.rate>400) throw new Error('Enter 1–10000 characters and a rate of 80–400 words/minute.');
      if(!(await speechVoices(signal)).some(v=>v.name===request.voice)) throw new Error('Selected system voice is unavailable.');
      const windows=process.platform==='win32';
      const input=path.join(temp,'text.txt'),spoken=path.join(temp,windows?'spoken.wav':'speech.aiff');await writeFile(input,request.text,'utf8');
      report('synthesize');
      if(windows) await runSAPI(sapiSpeak,{REACUT_TTS_VOICE:request.voice,REACUT_TTS_RATE:String(sapiRate(request.rate)),REACUT_TTS_INPUT:input,REACUT_TTS_OUTPUT:spoken},signal,600000);
      else await runSpeechProcess('/usr/bin/say',['-v',request.voice,'-r',String(request.rate),'-f',input,'-o',spoken],signal,undefined,600000);
      await runMediaTool('ffmpeg',['-v','error','-nostdin','-y','-i',spoken,'-ar','48000','-ac','1','-c:a','pcm_s16le',wav],600000,1024*1024,{signal});
      report('import',.9);
      const [asset]=await importAssets([wav],path.join(directory,'thumbnails'),signal);signal.throwIfAborted();
      const destination=path.join(directory,randomUUID()+'.wav');await rename(wav,destination);
      asset.path=destination;asset.url=`reacut-media://asset?path=${encodeURIComponent(destination)}`;asset.name=request.text.trim().slice(0,40);
      // Audio WAV has no preview proxy; the persistent source is the playback asset.
      report('complete',1);return {mode:'tts',asset};
    }finally {if(temp) await rm(temp,{recursive:true,force:true});}
  }
}
