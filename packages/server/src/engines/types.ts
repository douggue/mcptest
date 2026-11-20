/**
 * What every engine has in common. An engine is a program on the owner's
 * computer (Claude Code, Codex CLI, Antigravity CLI) that can answer one
 * question using Jgtube's tools. Each is started once, without a chat window,
 * boxed in as far as that program's own controls allow, and gives back plain
 * text or one of five named failures.
 */

/** The engines that answer with Jgtube's tools, by the name of their command. */
export type EngineId = 'agy' | 'claude' | 'codex';

/** Every engine, including the one that is a web service and only watches video. */
export type AnyEngineId = EngineId | 'gemini-api';

/**
 * Why there is no answer.
 * - 'not-installed': the program is not on this computer.
 * - 'not-signed-in': it is there, but the owner has a one-time step to do in it first.
 * - 'limit': the owner's plan has no capacity left for now.
 * - 'timeout': it ran too long and was stopped.
 * - 'failed': anything else.
 */
export type EngineFailure = 'not-installed' | 'not-signed-in' | 'limit' | 'timeout' | 'failed';

export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** One boxed-in question. The same request can be handed to any engine. */
export interface EngineRunRequest {
  readonly prompt: string;
  /** Who the engine is and how to answer. Engines with no place for it put it ahead of the prompt. */
  readonly systemPrompt: string;
  /** The only tool servers the run should see, by name. */
  readonly mcpServers: Readonly<Record<string, McpServerSpec>>;
  /** Full tool names, such as `mcp__jgtube__get_map`. */
  readonly allowedTools: readonly string[];
  /** A limit on steps, for the engines that have one. */
  readonly maxTurns: number;
  readonly timeoutMs: number;
  /** Where the run starts. A private, empty folder, so no project settings are picked up. */
  readonly cwd: string;
}

export interface EngineRunResult {
  readonly text: string;
  /** How many steps it took, when the engine says. */
  readonly turns: number | null;
}

/** The names one program goes by. */
export interface Program {
  /** The command, such as `claude`. */
  readonly command: string;
  /** What a person calls the program, such as "Claude Code". */
  readonly label: string;
  /** The short name used in a sentence, such as "Claude". */
  readonly name: string;
}

interface Emitter {
  on(event: string, listener: (...values: unknown[]) => void): unknown;
}

/** 'SIGTERM' asks the process to stop; 'SIGKILL' stops it whether it likes it or not. */
export type StopSignal = 'SIGTERM' | 'SIGKILL';

/** The parts of a running process the engines use, so tests can stand in for one. */
export interface ProcessChild extends Emitter {
  readonly stdout: Emitter;
  readonly stderr: Emitter;
  kill(signal?: StopSignal): void;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Text for the program's input, which is then closed. Absent: it has no input at all. */
  readonly input?: string;
  /** Windows only: the arguments are already quoted and must be passed on untouched. */
  readonly verbatim?: boolean;
}

export type SpawnProcess = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ProcessChild;

/** Looking at files, so tests can stand in for the disk. */
export interface FileLookup {
  exists(path: string): boolean;
  /** The file as text. Throws when it cannot be read. */
  read(path: string): string;
}

/** What an engine needs from the outside world. */
export interface EngineDeps {
  readonly spawn: SpawnProcess;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** How long a process asked to stop is given before it is forced; tests shorten it. */
  readonly killGraceMs?: number;
  /** The operating system, which decides how a program is started; tests set it. */
  readonly platform?: string;
  /** Aborted when Jgtube is closing: the run is stopped, or never started. */
  readonly signal?: AbortSignal;
  /** Replaces the disk when looking for a program or reading its settings; tests set it. */
  readonly files?: FileLookup;
  /** The owner's home folder, where a program keeps its settings; tests set it. */
  readonly homeDir?: string;
}

/** What is known about one engine on this computer, found without spending any allowance. */
export interface EngineStatus {
  readonly id: AnyEngineId;
  /** The name a person knows it by. */
  readonly label: string;
  readonly installed: boolean;
  /** Null when it cannot be told without asking the engine a question. */
  readonly signedIn: boolean | null;
  readonly version: string | null;
  /** Whether Jgtube would use it: installed, not known to be signed out, and set up. */
  readonly ready: boolean;
  /** One plain sentence when something needs doing or knowing, else null. */
  readonly note: string | null;
}

export interface AnalysisEngine {
  readonly id: EngineId;
  readonly label: string;
  /** Runs the request once. Rejects with an EngineRunError. */
  run(request: EngineRunRequest, deps: EngineDeps): Promise<EngineRunResult>;
  /** Whether it is installed and signed in, and its version. Never rejects. */
  check(deps: EngineDeps): Promise<EngineStatus>;
}

/** A question about one video, for an engine that can watch. */
export interface VideoQuestion {
  readonly question: string;
  readonly systemPrompt: string;
  readonly timeoutMs: number;
  /** A private folder the run may make its own folder in. */
  readonly cwd: string;
}

/** A question about a video file on this computer. */
export interface VideoWatchRequest extends VideoQuestion {
  readonly videoPath: string;
}

/** A question about a public YouTube video, named by its id. */
export interface VideoLinkRequest extends VideoQuestion {
  readonly videoId: string;
}
