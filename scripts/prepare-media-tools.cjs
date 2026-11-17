// electron-builder runs this before collecting files, including direct CLI builds.
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
exports.default = async context => {
  const architecture = { 1: 'x64', 3: 'arm64' }[context.arch];
  const project = context.packager.projectDir;
  if (context.electronPlatformName === 'darwin') {
    if (process.platform !== 'darwin' || architecture !== process.arch)
      throw new Error('Build the macOS installer on a matching native architecture for bundled media tools.');
    execFileSync(process.execPath, [path.join(project, 'scripts/build-media-tools.mjs')], { stdio: 'inherit' });
  } else if (context.electronPlatformName === 'win32') {
    if (architecture !== 'x64') throw new Error('Bundled Windows media tools are only built for x64.');
    // The recipe cross-compiles on Linux; a Windows packaging host verifies tools copied from such a build.
    if (process.platform === 'linux' && process.arch === 'x64')
      execFileSync(process.execPath, [path.join(project, 'scripts/build-media-tools-win.mjs')], { stdio: 'inherit' });
    const directory = path.join(project, 'media-tools', 'win32-x64');
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
      if (manifest.target !== 'win32-x64' || !['ffmpeg.exe', 'ffprobe.exe'].every(name => manifest.tools.some(tool => tool.name === name)))
        throw new Error('unexpected manifest');
      for (const tool of manifest.tools)
        if (createHash('sha256').update(fs.readFileSync(path.join(directory, tool.name))).digest('hex') !== tool.buildSHA256)
          throw new Error(`${tool.name} does not match its manifest`);
      for (const source of manifest.sources) fs.accessSync(path.join(directory, 'sources', source.file));
    } catch (error) {
      throw new Error(`Bundled Windows media tools are missing or damaged (${error.message}). Run "npm run media:build:win" on Linux x64 or WSL and copy media-tools/win32-x64 into this checkout.`);
    }
  }
};
