/**
 * The program behind `npm run subjects` and `npm run status`. Everything it
 * does is in `cli/run.ts`; this only joins it to the terminal.
 */
import { runCli } from './cli/run';

process.exitCode = runCli(process.argv.slice(2), {
  env: process.env,
  out: (line) => void process.stdout.write(`${line}\n`),
  err: (line) => void process.stderr.write(`${line}\n`),
  now: () => new Date(),
});
