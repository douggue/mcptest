// Used by start.bat / start.sh: exits 0 when something needs redoing after an update, 1 when it is up to date.
//   node stale.cjs build    the interface code changed since the last build
//   node stale.cjs install  package.json changed since the last npm install
const fs = require('fs');
const path = require('path');
const here = __dirname;
const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : mtime(p));
  }
  return t;
}
const what = process.argv[2];
if (what === 'install') {
  const done = mtime(path.join(here, 'node_modules', '.package-lock.json'));
  process.exit(!done || mtime(path.join(here, 'package.json')) > done ? 0 : 1);
}
const built = mtime(path.join(here, 'dist', 'index.html'));
const inputs = Math.max(newest(path.join(here, 'src')), ...['index.html', 'package.json', 'vite.config.ts', 'tsconfig.json'].map((f) => mtime(path.join(here, f))));
process.exit(!built || inputs > built ? 0 : 1);
