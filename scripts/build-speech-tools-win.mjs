/** Cross-compile the Windows x64 speech recognition engine (whisper.cpp's command-line tool) on Linux
 * from a pinned, unmodified upstream commit. Speech models are not part of this build. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('The Windows speech-tool recipe cross-compiles on a Linux x64 host (WSL works) with mingw-w64 g++ (posix threads) and CMake.');
const target = 'win32-x64';
const host = 'x86_64-w64-mingw32';
const work = path.join(root, '.media-build', `speech-${target}`);
const output = path.join(root, 'speech-tools', target);
const source = {
  name: 'whisper.cpp', version: 'v1.9.5', repository: 'https://github.com/ggml-org/whisper.cpp',
  commit: 'd1be6fde11ac6e0407606b4e42fe72d34add8037', license: 'MIT',
};
const tool = 'whisper-cli.exe';
const systemLibraries = new Set(['advapi32.dll', 'kernel32.dll', 'msvcrt.dll', 'user32.dll', 'shell32.dll', 'ole32.dll']);
// Definitions from the Windows SDK that the distribution's mingw-w64 headers do not carry yet. They are
// supplied on the compiler command line so the upstream source stays unmodified.
const compatibility = `#include <windows.h>
#ifndef THREAD_POWER_THROTTLING_CURRENT_VERSION
typedef struct _THREAD_POWER_THROTTLING_STATE { ULONG Version; ULONG ControlMask; ULONG StateMask; } THREAD_POWER_THROTTLING_STATE;
#define THREAD_POWER_THROTTLING_CURRENT_VERSION 1
#define THREAD_POWER_THROTTLING_EXECUTION_SPEED 0x1
#endif
`;
const digest = data => createHash('sha256').update(data).digest('hex');
const hashFile = async file => digest(await fs.readFile(file));
const recipeHash = await hashFile(fileURLToPath(import.meta.url));
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0)
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout ?? '';
}
function systemLibrariesOnly(file) {
  const libraries = [...run(`${host}-objdump`, ['-p', file], root, true).matchAll(/DLL Name: (\S+)/g)].map(match => match[1]);
  if (!libraries.length || libraries.some(library => !systemLibraries.has(library.toLowerCase())))
    throw new Error(`Non-system runtime dependency in ${file}: ${libraries.join(', ')}`);
  return libraries.sort();
}
try {
  const manifest = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
  if (manifest.recipeSHA256 === recipeHash && manifest.target === target) {
    if (await hashFile(path.join(output, tool)) !== manifest.tool.buildSHA256) throw new Error('Cached tool digest changed');
    systemLibrariesOnly(path.join(output, tool));
    console.log(`Verified cached speech tools: ${output}`);
    process.exit(0);
  }
} catch { /* Missing/stale generated output is rebuilt. */ }
await fs.rm(work, { recursive: true, force: true });
await fs.mkdir(work, { recursive: true });
const checkout = path.join(work, 'whisper.cpp');
run('git', ['clone', '--quiet', '--depth', '1', '--branch', source.version, source.repository, checkout]);
const commit = run('git', ['rev-parse', 'HEAD'], checkout, true).trim();
if (commit !== source.commit) throw new Error(`whisper.cpp ${source.version} is ${commit}, expected ${source.commit}`);
const compatibilityHeader = path.join(work, 'windows-sdk-compat.h');
await fs.writeFile(compatibilityHeader, compatibility);
// AVX2-era instructions are required at run time: any x64 processor from about 2013 onwards.
const configure = [
  '-DCMAKE_SYSTEM_NAME=Windows', '-DCMAKE_SYSTEM_PROCESSOR=x86_64',
  `-DCMAKE_C_COMPILER=${host}-gcc-posix`, `-DCMAKE_CXX_COMPILER=${host}-g++-posix`, `-DCMAKE_RC_COMPILER=${host}-windres`,
  '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DCMAKE_EXE_LINKER_FLAGS=-static',
  '-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF', '-DGGML_AVX=ON', '-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON',
  '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_BUILD_EXAMPLES=ON', '-DWHISPER_SDL2=OFF',
];
const build = path.join(work, 'build');
run('cmake', ['-S', checkout, '-B', build, ...configure, `-DCMAKE_C_FLAGS=-include ${compatibilityHeader}`]);
run('cmake', ['--build', build, '--target', 'whisper-cli', '-j', String(Math.min(8, os.availableParallelism()))]);
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(path.join(output, 'licenses'), { recursive: true });
const file = path.join(output, tool);
await fs.copyFile(path.join(build, 'bin', tool), file);
run(`${host}-strip`, [file]);
await fs.copyFile(path.join(checkout, 'LICENSE'), path.join(output, 'licenses', 'whisper.cpp-LICENSE'));
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'build-speech-tools-win.mjs'));
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  target, builtAt: new Date().toISOString(), recipeSHA256: recipeHash, sourceModifications: 'none', buildHost: 'linux-x64',
  compiler: run(`${host}-g++-posix`, ['--version'], root, true).split('\n')[0],
  configure, compatibilityHeader: compatibility, source,
  tool: { name: tool, buildSHA256: await hashFile(file), libraries: systemLibrariesOnly(file) },
}, null, 2) + '\n');
console.log(`Speech tools ready: ${output}`);
