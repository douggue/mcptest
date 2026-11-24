import { createServer as createHttpServer, request as httpRequest, type Server } from 'node:http';
import { connect, createServer as createNetServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * Small proxies on this computer for tests: an HTTP proxy (CONNECT tunnels and
 * plain forwarding) and a SOCKS5 proxy with an optional user name and
 * password. Each records which host and port it was asked to reach. They
 * stand in for a provider's gateway; nothing leaves this computer unless a
 * test points them somewhere else.
 */

export interface LocalServer {
  readonly port: number;
  /** "host:port" of every place this proxy was asked to reach, in order. */
  readonly seen: readonly string[];
  close(): Promise<void>;
}

const portOf = (server: { address(): AddressInfo | string | null }): number =>
  (server.address() as AddressInfo).port;

function closer(server: Server | ReturnType<typeof createNetServer>, sockets: Set<Socket>) {
  return () =>
    new Promise<void>((resolve) => {
      sockets.forEach((socket) => socket.destroy());
      server.close(() => resolve());
    });
}

/** A plain web server that answers every request with `body`, standing in for YouTube. */
export async function startTarget(body = 'hello from the target'): Promise<LocalServer> {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const server = createHttpServer((request, response) => {
    seen.push(String(request.url));
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end(body);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: portOf(server),
    get seen() {
      return [...seen];
    },
    close: closer(server, sockets),
  };
}

/**
 * An HTTP proxy. With `credentials` ("user:password") it answers 407 to anyone
 * without them. With `onlyRecord` it notes where a tunnel was asked for and
 * answers 403 without connecting anywhere, so a test can see that a request
 * for a real YouTube host came this way without it leaving this computer.
 */
export async function startHttpProxy(
  credentials?: string,
  onlyRecord = false,
): Promise<LocalServer> {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const allowed = (header: string | undefined): boolean =>
    credentials === undefined || header === `Basic ${Buffer.from(credentials).toString('base64')}`;
  const server = createHttpServer((request, response) => {
    const target = new URL(String(request.url));
    seen.push(target.host);
    if (!allowed(request.headers['proxy-authorization'])) {
      response.writeHead(407).end();
      return;
    }
    const onward = httpRequest(
      target,
      { method: request.method, headers: { ...request.headers, host: target.host } },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(response);
      },
    );
    onward.on('error', () => response.writeHead(502).end());
    request.pipe(onward);
  });
  server.on('connect', (request, client: Socket, head: Buffer) => {
    seen.push(String(request.url));
    if (!allowed(request.headers['proxy-authorization'])) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
      return;
    }
    if (onlyRecord) {
      client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    const [host = '', port = '0'] = String(request.url).split(':');
    const upstream = connect(Number(port), host, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: portOf(server),
    get seen() {
      return [...seen];
    },
    close: closer(server, sockets),
  };
}

const SOCKS_VERSION = 5;
const NO_AUTH = 0;
const USER_PASS = 2;
const NO_METHOD = 0xff;

/** Reads the SOCKS5 greeting, an optional user and password, then one CONNECT request. */
function socksSession(client: Socket, credentials: string | undefined, seen: string[]): void {
  let stage: 'greeting' | 'auth' | 'request' = 'greeting';
  let buffered = Buffer.alloc(0);
  const onData = (chunk: Buffer): void => {
    buffered = Buffer.concat([buffered, chunk]);
    if (stage === 'greeting' && buffered.length >= 2) {
      const methods = [...buffered.subarray(2, 2 + (buffered[1] ?? 0))];
      buffered = buffered.subarray(2 + (buffered[1] ?? 0));
      const wanted = credentials === undefined ? NO_AUTH : USER_PASS;
      if (!methods.includes(wanted)) {
        client.end(Buffer.from([SOCKS_VERSION, NO_METHOD]));
        return;
      }
      client.write(Buffer.from([SOCKS_VERSION, wanted]));
      stage = credentials === undefined ? 'request' : 'auth';
    }
    if (stage === 'auth' && buffered.length >= 2) {
      const userLength = buffered[1] ?? 0;
      const user = buffered.subarray(2, 2 + userLength).toString();
      const passLength = buffered[2 + userLength] ?? 0;
      const pass = buffered.subarray(3 + userLength, 3 + userLength + passLength).toString();
      buffered = buffered.subarray(3 + userLength + passLength);
      const ok = `${user}:${pass}` === credentials;
      client.write(Buffer.from([1, ok ? 0 : 1]));
      if (!ok) {
        client.end();
        return;
      }
      stage = 'request';
    }
    if (stage === 'request' && buffered.length >= 7) {
      client.off('data', onData);
      const kind = buffered[3];
      let host: string;
      let rest: Buffer;
      if (kind === 1) {
        host = [...buffered.subarray(4, 8)].join('.');
        rest = buffered.subarray(8);
      } else {
        const length = buffered[4] ?? 0;
        host = buffered.subarray(5, 5 + length).toString();
        rest = buffered.subarray(5 + length);
      }
      const port = rest.readUInt16BE(0);
      seen.push(`${host}:${port}`);
      const upstream = connect(port, host, () => {
        client.write(Buffer.from([SOCKS_VERSION, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
        upstream.write(rest.subarray(2));
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
    }
  };
  client.on('data', onData);
  client.on('error', () => client.destroy());
}

/** A SOCKS5 proxy. With `credentials` ("user:password") it asks for and checks them. */
export async function startSocks5Proxy(credentials?: string): Promise<LocalServer> {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const server = createNetServer((client) => socksSession(client, credentials, seen));
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: portOf(server),
    get seen() {
      return [...seen];
    },
    close: closer(server, sockets),
  };
}

/** A port on this computer with nothing listening on it. */
export async function closedPort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = portOf(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
