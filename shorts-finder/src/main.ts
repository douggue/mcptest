/**
 * The service's entry point: `npm start`, and what systemd runs.
 *
 * It loads the settings, starts the service, and on SIGTERM or SIGINT stops
 * the loop, waits for work that is running and closes the store. A failure to
 * start is one line saying why, and a non-zero exit: 78 for a wrong setting
 * (which systemd is told not to restart for, since restarting cannot cure
 * it), 1 for anything else.
 */
import { ConfigError, loadConfig, type Config } from './config';
import { reasonOf } from './cycleStop';
import { createLogger, type Logger } from './log';
import { startService, type Service } from './service';

const EXIT_FAILED = 1;
/** "Configuration error" in the BSD convention systemd also knows. */
const EXIT_CONFIG = 78;

function fail(log: Logger, error: unknown): never {
  log.error('start_failed', { reason: reasonOf(error) });
  process.exit(error instanceof ConfigError ? EXIT_CONFIG : EXIT_FAILED);
}

function loadOrExit(): Config {
  try {
    return loadConfig();
  } catch (error) {
    // A wrong setting is named, never quoted, so this line holds no secret.
    return fail(createLogger(), error);
  }
}

function startOrExit(config: Config, log: Logger): Service {
  try {
    return startService(config, { log });
  } catch (error) {
    return fail(log, error);
  }
}

const config = loadOrExit();
const log = createLogger({
  secrets: [config.youtubeApiKey, ...(config.telegram === null ? [] : [config.telegram.botToken])],
});
const service = startOrExit(config, log);
log.info('started', {
  store: config.dbPath,
  regions: config.regions,
  dailyUnits: config.dailyUnits,
  alerts: config.telegram !== null,
  timeZone: config.timeZone,
});

let stopping = false;
const shutDown = (signal: string): void => {
  if (stopping) return;
  stopping = true;
  log.info('stopping', { signal });
  service.stop().then(
    () => log.info('stopped'),
    (error: unknown) => {
      log.error('stop_failed', { reason: reasonOf(error) });
      process.exitCode = EXIT_FAILED;
    },
  );
};
process.on('SIGTERM', () => shutDown('SIGTERM'));
process.on('SIGINT', () => shutDown('SIGINT'));
