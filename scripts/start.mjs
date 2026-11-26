/**
 * `npm start`: builds what changed since the last start, then runs the server.
 *
 * The web app is built only when its files changed, and the server is bundled
 * into one plain JavaScript file only when its code did, so starting with
 * nothing changed costs a look at the files' dates and sizes. Without the
 * bundler (it comes with tsx), the server runs from its TypeScript as before.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const STAMP = '.jgtube-build';
const at = (...parts) => join(ROOT, ...parts);

const WEB = {
  name: 'web app',
  inputs: [
    'apps/web/src',
    'apps/web/index.html',
    'apps/web/vite.config.ts',
    'apps/web/tailwind.config.js',
    'apps/web/postcss.config.js',
    'apps/web/package.json',
    'package-lock.json',
  ],
  output: 'apps/web/dist',
  ready: 'apps/web/dist/index.html',
};

const SERVER = {
  name: 'server',
  inputs: [
    'packages/core/src',
    'packages/core/package.json',
    'packages/server/src',
    'packages/server/package.json',
    'package-lock.json',
    'scripts/start.mjs',
  ],
  output: 'packages/server/dist',
  ready: 'packages/server/dist/main.mjs',
};

/** Every file under `path`, test files left out. */
function filesUnder(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) =>
    entry.name.includes('.test.') ? [] : filesUnder(join(path, entry.name)),
  );
}

/** Each input file's name, size and time of change, as one short hash. */
function fingerprint(inputs) {
  const hash = createHash('sha256');
  for (const file of inputs.flatMap((input) => filesUnder(at(input))).sort()) {
    const { size, mtimeMs } = statSync(file);
    hash.update(`${relative(ROOT, file)}\0${size}\0${mtimeMs}\n`);
  }
  return hash.digest('hex');
}

const stampOf = (part) => at(part.output, STAMP);

function isCurrent(part, print) {
  if (!existsSync(at(part.ready))) return false;
  try {
    return readFileSync(stampOf(part), 'utf8') === print;
  } catch {
    return false;
  }
}

const seconds = (since) => `${((performance.now() - since) / 1000).toFixed(1)} s`;

/** Builds a part when its files changed since the last build; says which, and how long it took. */
async function ensure(part, build) {
  const started = performance.now();
  const print = fingerprint(part.inputs);
  if (isCurrent(part, print)) {
    process.stdout.write(`  ${part.name}: up to date (${seconds(started)})\n`);
    return true;
  }
  process.stdout.write(`  ${part.name}: building…\n`);
  const built = await build();
  if (built) {
    writeFileSync(stampOf(part), print);
    process.stdout.write(`  ${part.name}: built in ${seconds(started)}\n`);
  }
  return built;
}

async function buildWeb() {
  const { build } = await import('vite');
  await build({ configFile: at('apps/web/vite.config.ts'), logLevel: 'warn' });
  return true;
}

/** Keeps npm packages outside the bundle; Jgtube's own packages go in. */
const outside = {
  name: 'outside',
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith('@jgtube/') ? undefined : { path: args.path, external: true },
    );
  },
};

async function bundleServer() {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    process.stdout.write('  server: no bundler found, so it runs from its TypeScript\n');
    return false;
  }
  await esbuild.build({
    entryPoints: [at('packages/server/src/main.ts')],
    // Three folders below the project, as the source is: the paths it works out stay the same.
    outfile: at(SERVER.ready),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'linked',
    logLevel: 'warning',
    plugins: [outside],
  });
  return true;
}

async function main() {
  process.stdout.write('Starting Jgtube…\n');
  await ensure(WEB, buildWeb);
  const bundled = await ensure(SERVER, bundleServer);
  if (bundled) {
    // Errors then name the TypeScript file and line, as they did before.
    process.setSourceMapsEnabled(true);
    await import(pathToFileURL(at(SERVER.ready)).href);
    return;
  }
  const { register } = await import('tsx/esm/api');
  register();
  await import(pathToFileURL(at('packages/server/src/main.ts')).href);
}

main().catch((error) => {
  process.stderr.write(`Jgtube could not start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
