// Local development: runs MediaMTX (if MEDIAMTX_BIN is set or `mediamtx` is on PATH), the engine and the web dashboard.
const { spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const procs = [];
function start(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const tag = `[${name}] `;
  const pipe = (s, out) => s.on('data', (d) => out.write(d.toString().split('\n').filter(Boolean).map((l) => (l.startsWith('[') ? l : tag + l)).join('\n') + '\n'));
  pipe(p.stdout, process.stdout); pipe(p.stderr, process.stderr);
  p.on('exit', (c) => console.log(`${tag}exited ${c}`));
  procs.push(p);
}
const config = require('../src/config');
const mtx = process.env.MEDIAMTX_BIN || 'mediamtx';
start('mediamtx', mtx, [path.join(root, 'deploy', 'mediamtx.yml')], { env: { ...process.env, MTX_HLSCDNSECRET: config.HLS_CDN_SECRET } });
const node = [process.execPath, '--disable-warning=ExperimentalWarning'];
start('engine', node[0], [node[1], 'src/engine/index.js']);
start('web', node[0], [node[1], 'src/web/index.js']);
const stop = () => { procs.forEach((p) => p.kill('SIGTERM')); setTimeout(() => process.exit(0), 500); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
