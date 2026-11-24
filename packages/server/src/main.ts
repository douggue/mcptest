import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { UPLOAD_PATH, createApp } from './app';
import { VIDEO_FILES_PATH } from './breakdownHubRoutes';
import { FORMAT_IMAGES_PATH } from './formatRoutes';
import { createEngine } from './engine';
import { JobStore, cleanMessage } from './jobs';
import { liveSettings } from './liveSettings';
import {
  SWEEP_CHECK_HOURS,
  startRefreshTimer,
  startSweepThroughApi,
  startThroughApi,
} from './schedule';
import { startProblem } from './startProblem';
import { settingsEngine } from './settingsEngine';
import { namesSetOutside, settingsStore } from './settingsStore';

/** Only this computer can reach the server; it has no login. */
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4317;
const WEB_ROOT = resolve(fileURLToPath(new URL('../../../apps/web/dist', import.meta.url)));
const MAX_BODY_BYTES = 16_384;
/** The settings file, beside where Jgtube is started: the one `process.loadEnvFile` reads. */
const ENV_FILE = '.env';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/**
 * The page may load its own files, video thumbnails (i.ytimg.com) and channel
 * logos (yt3.googleusercontent.com), and nothing else.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' https://i.ytimg.com https://yt3.googleusercontent.com data:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join('; ');

function readPort(): number {
  const raw = process.env['JGTUBE_PORT'];
  if (raw === undefined) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new Error('JGTUBE_PORT must be a whole number from 1024 to 65535');
  }
  return port;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function toRequest(request: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(name, value);
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const url = `http://${request.headers.host ?? HOST}${request.url ?? '/'}`;
  // A video file is far larger than any other body: it is handed on as a
  // stream for the route to write to disk, with the route's own size cap.
  const path = request.url ?? '';
  const isStreamed =
    path.startsWith(UPLOAD_PATH) || path === VIDEO_FILES_PATH || path === FORMAT_IMAGES_PATH;
  if (request.method === 'PUT' && isStreamed) {
    // A request whose body is a stream must say it does not expect to read
    // the reply while it sends; the browser's type for this lacks the field.
    const streamed: RequestInit & { duplex: 'half' } = {
      method: 'PUT',
      headers,
      body: Readable.toWeb(request) as ReadableStream<Uint8Array>,
      duplex: 'half',
    };
    return new Request(url, streamed);
  }
  return new Request(url, {
    method: request.method,
    headers,
    body: hasBody ? new Uint8Array(await readBody(request)) : undefined,
  });
}

/** Maps a URL path to a file inside the built web app, or null if it would escape that folder. */
function webFile(pathname: string): string | null {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, '');
  const target = resolve(join(WEB_ROOT, relative === '' ? 'index.html' : relative));
  return target === WEB_ROOT || target.startsWith(WEB_ROOT + sep) ? target : null;
}

async function serveWeb(pathname: string, response: ServerResponse): Promise<void> {
  const requested = webFile(pathname);
  // A path that names a file is that file or nothing; answering a missing script
  // with the page would hide the mistake. Any other path gets the app shell.
  const namesFile = requested !== null && extname(requested) !== '';
  const candidates = namesFile ? [requested] : [join(WEB_ROOT, 'index.html')];
  for (const path of candidates) {
    try {
      const body = await readFile(path);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        'content-security-policy': CONTENT_SECURITY_POLICY,
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        // For browsers that do not honour frame-ancestors in the policy above.
        'x-frame-options': 'DENY',
      });
      response.end(body);
      return;
    } catch {
      // Try the next candidate.
    }
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(namesFile ? 'Not found' : 'The web app has not been built yet. Run: npm run build');
}

/** Reads settings from a `.env` file beside where Jgtube is started, if there is one. */
function loadEnvFile(): void {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file: settings come from the environment or their defaults.
  }
}

function start(): void {
  // What was set before the file is read wins over the file, and the settings screen says so.
  const outside = namesSetOutside(process.env);
  loadEnvFile();
  // The keys and the engine order can change while Jgtube runs; see liveSettings.
  const live = liveSettings(process.env);
  const { config } = live;
  const engine = createEngine(config, { engines: live.engines });
  const port = readPort();
  const allowedHosts = [`${HOST}:${port}`, `localhost:${port}`];
  const settings = settingsEngine({
    store: settingsStore({
      envPath: resolve(ENV_FILE),
      env: process.env,
      outside,
      onSaved: live.reload,
    }),
    engineStatus: (fresh) => engine.engineStatus(fresh),
  });
  const app = createApp({ engine, jobs: new JobStore(), allowedHosts, settings });

  const refuse = (response: ServerResponse, status: number, text: string): void => {
    if (!response.headersSent) {
      response.writeHead(status, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      });
    }
    response.end(text);
  };

  const handle = (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    // Requests that name another host arrive through DNS rebinding; see app.ts.
    if (!allowedHosts.includes(request.headers.host ?? '')) {
      refuse(response, 403, 'This server only answers to its own address');
      return Promise.resolve();
    }
    const pathname = new URL(request.url ?? '/', `http://${HOST}`).pathname;
    if (!pathname.startsWith('/api/')) return serveWeb(pathname, response);
    return toRequest(request)
      .then(app)
      .then(async (result) => {
        response.writeHead(result.status, Object.fromEntries(result.headers));
        // As bytes, not text: pictures and archives must arrive unchanged.
        response.end(Buffer.from(await result.arrayBuffer()));
      });
  };

  const server = createServer((request, response) => {
    // A malformed address must fail this one request, never the process.
    try {
      handle(request, response).catch((error: unknown) => {
        // The page gets a plain answer; the reason goes to this window, where it can be found.
        process.stderr.write(`Request failed: ${cleanMessage(error)}\n`);
        refuse(response, 500, 'Something went wrong');
      });
    } catch {
      refuse(response, 400, 'Bad request');
    }
  });
  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`Unhandled rejection: ${String(reason)}\n`);
  });

  server.on('error', (error: NodeJS.ErrnoException) => {
    process.stderr.write(`${startProblem(error, HOST, port)}\n`);
    engine.shutdown().finally(() => process.exit(1));
  });
  server.listen(port, HOST, () => {
    process.stdout.write(`Jgtube is running at http://${HOST}:${port}\n`);
  });
  const timer =
    config.refreshHours === undefined
      ? null
      : startRefreshTimer({
          everyHours: config.refreshHours,
          start: startThroughApi(app, `${HOST}:${port}`),
          onProblem: (message) => process.stderr.write(`Scheduled refresh: ${message}\n`),
        });
  if (config.refreshHours !== undefined) {
    process.stdout.write(`Stored channels are refreshed every ${config.refreshHours} hours\n`);
  }
  // Asks every hour whether the watchlist's sweep is due; off unless the owner set a schedule.
  const sweepTimer = startRefreshTimer({
    everyHours: SWEEP_CHECK_HOURS,
    start: startSweepThroughApi(app, `${HOST}:${port}`),
    onProblem: (message) => process.stderr.write(`Scheduled sweep: ${message}\n`),
  });
  const stop = (): void => {
    timer?.stop();
    sweepTimer.stop();
    server.close();
    // Any AI engine that is running is stopped and work under way winds down
    // before the store is closed, so nothing is cut off in the middle of a
    // write and no engine's process is left behind.
    engine.shutdown().catch((error: unknown) => {
      process.stderr.write(`Jgtube did not close cleanly: ${String(error)}\n`);
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

start();
