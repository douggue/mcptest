import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from '@jgtube/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createConnectorEngine } from './connectorEngine';
import { plainMessage } from './failure';
import { createConnectorServer } from './server';

const PROJECT_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));

/** Standard output carries the protocol, so everything said to a person goes to standard error. */
const say = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

/**
 * The app is started from the project folder, so a store path that is not
 * absolute means "inside the project folder". Claude starts the connector from
 * somewhere else; anchoring the path here makes both open the same store.
 */
function anchoredConfig(config: Config): Config {
  return isAbsolute(config.dbPath)
    ? config
    : { ...config, dbPath: resolve(PROJECT_ROOT, config.dbPath) };
}

/**
 * Reads the `.env` file in the project folder, if there is one: the same file
 * the app reads, so both use the same settings. Values already set by whoever
 * started the connector win over the file.
 */
function loadEnvFile(): void {
  try {
    process.loadEnvFile(resolve(PROJECT_ROOT, '.env'));
  } catch {
    // No .env file: settings come from the environment or their defaults.
  }
}

async function start(): Promise<void> {
  loadEnvFile();
  // The connector is driven by a model and none of its tools uses the YouTube
  // API key, so it does not keep one: a key it never holds cannot leak through it.
  delete process.env['YOUTUBE_API_KEY'];
  const config = anchoredConfig(loadConfig());
  const engine = createConnectorEngine(config);
  const server = createConnectorServer({ engine, log: say });

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    server
      .close()
      .catch((error: unknown) => say(`Jgtube connector: ${plainMessage(error)}`))
      .finally(() => {
        engine.close();
        process.exit(0);
      });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  // Claude closes standard input when it is done with the connector.
  process.stdin.once('end', stop);
  process.stdin.once('close', stop);

  await server.connect(new StdioServerTransport());
  say(`Jgtube connector is running. Store: ${config.dbPath}`);
}

start().catch((error: unknown) => {
  say(
    `Jgtube connector could not start: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
