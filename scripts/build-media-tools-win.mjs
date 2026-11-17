/** Cross-compile self-contained Windows x64 media tools on Linux from pinned, unmodified upstream sources. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('The Windows media-tool recipe cross-compiles on a Linux x64 host (WSL works) with mingw-w64 and NASM.');
const target = 'win32-x64';
const host = 'x86_64-w64-mingw32';
const work = path.join(root, '.media-build', target);
const downloads = path.join(root, '.media-build', 'downloads');
const output = path.join(root, 'media-tools', target);
const prefix = path.join(work, 'prefix');
const sources = [
  {
    name: 'ffmpeg', version: '9.0.2', file: 'ffmpeg-9.0.2.tar.xz',
    url: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
    sha256: '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',
    directory: 'ffmpeg-9.0.2',
  },
  {
    name: 'x264', version: 'b35605ace3ddf7c1a5d67a2eb553f034aef41d55', file: 'x264-b35605ac.tar.gz',
    url: 'https://code.videolan.org/videolan/x264/-/archive/b35605ace3ddf7c1a5d67a2eb553f034aef41d55/x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55.tar.gz',
    sha256: 'cd71a7515b0e9a012e1ac9b1f8415bebcaf6fc97d4db32286642ac4c0fbe24f9',
    directory: 'x264-b35605ace3ddf7c1a5d67a2eb553f034aef41d55',
  },
  {
    // macOS links the system zlib; Windows has none, so it is linked statically from source.
    name: 'zlib', version: '1.3.1', file: 'zlib-1.3.1.tar.gz',
    url: 'https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz',
    sha256: '9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23',
    directory: 'zlib-1.3.1',
  },
];
const tools = ['ffmpeg.exe', 'ffprobe.exe'];
// Every Windows installation provides these; anything else would have to ship beside the tools.
const systemLibraries = new Set(['advapi32.dll', 'bcrypt.dll', 'gdi32.dll', 'kernel32.dll', 'msvcrt.dll', 'ole32.dll', 'oleaut32.dll', 'psapi.dll', 'shell32.dll', 'shlwapi.dll', 'user32.dll']);
const digest = data => createHash('sha256').update(data).digest('hex');
const hashFile = async file => digest(await fs.readFile(file));
const recipeHash = await hashFile(fileURLToPath(import.meta.url));
function run(command, args, cwd = root, env = process.env, capture = false) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout ?? '';
}
function systemLibrariesOnly(file) {
  const libraries = [...run(`${host}-objdump`, ['-p', file], root, process.env, true).matchAll(/DLL Name: (\S+)/g)].map(match => match[1]);
  if (!libraries.length || libraries.some(library => !systemLibraries.has(library.toLowerCase())))
    throw new Error(`Non-system runtime dependency in ${file}: ${libraries.join(', ')}`);
  return libraries.sort();
}
try {
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (manifest.recipeSHA256 === recipeHash && manifest.target === target) {
    for (const tool of manifest.tools) {
      const file = path.join(output, tool.name);
      if (await hashFile(file) !== tool.buildSHA256) throw new Error('Cached tool digest changed');
      systemLibrariesOnly(file);
    }
    for (const source of sources)
      if (await hashFile(path.join(output, 'sources', source.file)) !== source.sha256) throw new Error('Cached source digest changed');
    console.log(`Verified cached media tools: ${output}`);
    process.exit(0);
  }
} catch { /* Missing/stale generated output is rebuilt from verified sources. */ }
await fs.mkdir(downloads, { recursive: true });
await fs.mkdir(work, { recursive: true });
for (const source of sources) {
  const file = path.join(downloads, source.file);
  let valid = false;
  try { valid = await hashFile(file) === source.sha256; } catch { /* download */ }
  if (!valid) {
    const temporary = file + '.partial';
    run('curl', ['--fail', '--location', '--retry', '2', '--proto', '=https', source.url, '-o', temporary]);
    if (await hashFile(temporary) !== source.sha256) throw new Error(`Source checksum mismatch: ${source.name}`);
    await fs.rename(temporary, file);
  }
  await fs.rm(path.join(work, source.directory), { recursive: true, force: true });
  run('tar', ['-xf', file, '-C', work]);
}
const directory = name => path.join(work, sources.find(source => source.name === name).directory);
const jobs = String(Math.min(8, os.availableParallelism()));
// Only libraries built into this prefix may be discovered; the host's own packages stay invisible.
const env = { ...process.env, PKG_CONFIG_PATH: '', PKG_CONFIG_LIBDIR: path.join(prefix, 'lib/pkgconfig') };
delete env.CFLAGS; delete env.LDFLAGS; delete env.CPPFLAGS;
await fs.rm(prefix, { recursive: true, force: true });
const configs = {};
configs.zlib = ['-f', 'win32/Makefile.gcc', `PREFIX=${host}-`, `BINARY_PATH=${path.join(prefix, 'bin')}`, `INCLUDE_PATH=${path.join(prefix, 'include')}`, `LIBRARY_PATH=${path.join(prefix, 'lib')}`];
configs.x264 = [`--prefix=${prefix}`, `--host=${host}`, `--cross-prefix=${host}-`, '--enable-static', '--enable-pic', '--disable-cli', '--disable-opencl'];
configs.ffmpeg = [
  `--prefix=${prefix}`, '--arch=x86_64', '--target-os=mingw32', `--cross-prefix=${host}-`, '--enable-cross-compile',
  '--enable-static', '--disable-shared', '--disable-autodetect', '--enable-gpl', '--enable-libx264', '--enable-zlib',
  '--enable-w32threads', '--disable-network', '--disable-protocols', '--enable-protocol=file,pipe',
  '--disable-devices', '--enable-indev=lavfi', '--disable-ffplay', '--disable-doc', '--disable-debug',
  '--pkg-config=pkg-config', '--pkg-config-flags=--static',
  `--extra-cflags=-I${path.join(prefix, 'include')}`, `--extra-ldflags=-L${path.join(prefix, 'lib')} -static`,
];
console.log(`Building zlib for ${target}…`);
run('make', [...configs.zlib, '-j', jobs, 'libz.a'], directory('zlib'), env);
run('make', [...configs.zlib, 'install'], directory('zlib'), env);
for (const name of ['x264', 'ffmpeg']) {
  console.log(`Building ${name} for ${target}…`);
  run('./configure', configs[name], directory(name), env);
  run('make', ['-j', jobs], directory(name), env);
  run('make', ['install'], directory(name), env);
}
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'sources'), { recursive: true });
await fs.mkdir(path.join(output, 'licenses'), { recursive: true });
const release = (await fs.readFile(path.join(directory('ffmpeg'), 'RELEASE'), 'utf8')).trim();
const built = [];
for (const name of tools) {
  const file = path.join(output, name);
  await fs.copyFile(path.join(prefix, 'bin', name), file);
  built.push({ name, version: `${path.parse(name).name} version ${release}`, buildSHA256: await hashFile(file), libraries: systemLibrariesOnly(file) });
}
for (const source of sources) await fs.copyFile(path.join(downloads, source.file), path.join(output, 'sources', source.file));
for (const name of ['COPYING.GPLv2', 'COPYING.GPLv3', 'COPYING.LGPLv2.1', 'COPYING.LGPLv3', 'LICENSE.md'])
  await fs.copyFile(path.join(directory('ffmpeg'), name), path.join(output, 'licenses', `FFmpeg-${name}`));
await fs.copyFile(path.join(directory('x264'), 'COPYING'), path.join(output, 'licenses', 'x264-COPYING'));
await fs.copyFile(path.join(directory('zlib'), 'LICENSE'), path.join(output, 'licenses', 'zlib-LICENSE'));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'sources', 'build-media-tools-win.mjs'));
await fs.writeFile(path.join(output, 'sources', 'README.txt'), 'Corresponding source for the bundled Windows FFmpeg/FFprobe executables. FFmpeg, x264 and zlib sources are unmodified. Place the source archives in .media-build/downloads of the JGcut repository and run node scripts/build-media-tools-win.mjs on Linux x64 with the mingw-w64 x86_64 GCC cross toolchain, NASM, make, pkg-config and Node.js 24.11+ or 26+. Configure arguments and the compiler version are in manifest.json; recipe placeholders/paths are resolved at build time. The executables statically include the mingw-w64 C runtime startup code and GCC support library of that toolchain and otherwise import only Windows system DLLs. GPL-2.0-or-later applies to this FFmpeg+x264 build. The original JGcut code is separately licensed under MIT.\n');
const scrub = value => value.replaceAll(prefix, '$BUILD_PREFIX');
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  target, builtAt: new Date().toISOString(), recipeSHA256: recipeHash,
  license: 'GPL-2.0-or-later', sourceModifications: 'none', buildHost: 'linux-x64',
  compiler: run(`${host}-gcc`, ['--version'], root, env, true).split('\n')[0],
  assembler: run('nasm', ['-v'], root, env, true).trim(),
  configure: Object.fromEntries(Object.entries(configs).map(([name, args]) => [name, args.map(scrub)])),
  sources, tools: built,
}, null, 2) + '\n');
console.log(`Self-contained media tools ready: ${output}`);
