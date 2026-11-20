/**
 * The service's one way of saying anything: a line of JSON on standard
 * output, which systemd's journal keeps. One line an event, so the journal
 * can be searched and nothing spreads over several lines.
 *
 * Secrets never reach a line: the logger is told the key and the token, and
 * takes them (and anything shaped like a bot token) out of every line before
 * it is written.
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  /** Values that must never be written: the API key, the bot token. */
  readonly secrets?: readonly string[];
  readonly now?: () => Date;
  /** Replaces standard output; used by tests. */
  readonly write?: (line: string) => void;
}

const SECRET_PLACEHOLDER = '[secret]';
/** Shorter than this, a "secret" would blank out ordinary words. */
const MIN_SECRET_LENGTH = 8;
const BOT_TOKEN_SHAPE = /\d{5,}:[\w-]{20,}/g;

const toStdout = (line: string): void => {
  process.stdout.write(line);
};

function withoutSecrets(line: string, secrets: readonly string[]): string {
  return secrets
    .filter((secret) => secret.length >= MIN_SECRET_LENGTH)
    .reduce((text, secret) => text.split(secret).join(SECRET_PLACEHOLDER), line)
    .replace(BOT_TOKEN_SHAPE, SECRET_PLACEHOLDER);
}

function toLine(time: string, level: LogLevel, event: string, fields: LogFields): string {
  try {
    return JSON.stringify({ time, level, event, ...fields });
  } catch {
    // Fields that cannot be written as JSON are left out; the event still is.
    return JSON.stringify({ time, level, event, unwritable: true });
  }
}

/** A logger that writes single-line JSON with the secrets taken out. */
export function createLogger(options: LoggerOptions = {}): Logger {
  const write = options.write ?? toStdout;
  const now = options.now ?? ((): Date => new Date());
  const secrets = options.secrets ?? [];
  const log = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    const line = toLine(now().toISOString(), level, event, fields);
    write(`${withoutSecrets(line, secrets)}\n`);
  };
  return {
    info: (event, fields) => log('info', event, fields),
    warn: (event, fields) => log('warn', event, fields),
    error: (event, fields) => log('error', event, fields),
  };
}
