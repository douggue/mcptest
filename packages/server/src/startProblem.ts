import { cleanMessage } from './jobs';

/**
 * Why the server could not start, in words the owner can act on. The usual
 * case is a second start while the first is still running.
 */
export function startProblem(error: NodeJS.ErrnoException, host: string, port: number): string {
  if (error.code === 'EADDRINUSE') {
    return [
      `Jgtube could not start: something on this computer is already using port ${port}.`,
      `Most likely Jgtube is already running in another window: open http://${host}:${port} in your browser,`,
      'or close that window (Ctrl+C) and type npm start again.',
      'To run a second copy, set a different JGTUBE_PORT in the .env file.',
    ].join('\n');
  }
  if (error.code === 'EACCES') {
    return `Jgtube could not start: this computer does not allow it to use port ${port}. Set a different JGTUBE_PORT in the .env file.`;
  }
  return `Jgtube could not start: ${cleanMessage(error)}`;
}
