import { describe, expect, test } from 'vitest';
import { planLaunch, quoteForCmd } from '../../src/engines/executable';
import { EngineRunError } from '../../src/engines/failure';
import type { FileLookup, Program } from '../../src/engines/types';

const CLAUDE: Program = { command: 'claude', label: 'Claude Code', name: 'Claude' };
const NODE = 'C:\\Program Files\\nodejs\\node.exe';
const NPM = 'C:\\Users\\Jo\\AppData\\Roaming\\npm';

/** What npm writes beside a package's command on Windows, trimmed to the line that matters. */
const npmShim = (entry: string): string =>
  [
    '@ECHO off',
    'SETLOCAL',
    'CALL :find_dp0',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ') ELSE (',
    '  SET "_prog=node"',
    ')',
    `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${entry}" %*`,
  ].join('\r\n');

/** A disk holding only the files named here. */
const disk = (files: Readonly<Record<string, string>>): FileLookup => ({
  exists: (path) => path in files,
  read: (path) => {
    const text = files[path];
    if (text === undefined) throw new Error('no such file');
    return text;
  },
});

const windows = (files: Readonly<Record<string, string>>, path = `C:\\Windows;${NPM}`) => ({
  platform: 'win32',
  env: { Path: path, ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  files: disk(files),
  nodePath: NODE,
});

describe('planLaunch away from Windows', () => {
  test('starts the command by its name, with its arguments untouched', () => {
    const launch = planLaunch(CLAUDE, ['-p', 'What "works"?'], { platform: 'linux', env: {} });

    expect(launch).toEqual({ command: 'claude', args: ['-p', 'What "works"?'], verbatim: false });
  });
});

describe('planLaunch on Windows', () => {
  test('starts a program installed as an .exe directly', () => {
    const exe = `${NPM}\\claude.exe`;

    expect(planLaunch(CLAUDE, ['--version'], windows({ [exe]: '' }))).toEqual({
      command: exe,
      args: ['--version'],
      verbatim: false,
    });
  });

  test('prefers the .exe to a .cmd in the same folder, and an earlier folder to a later one', () => {
    const files = {
      'C:\\Windows\\claude.cmd': npmShim('node_modules\\x\\cli.js'),
      'C:\\Windows\\node_modules\\x\\cli.js': '',
      [`${NPM}\\claude.exe`]: '',
      [`${NPM}\\claude.cmd`]: '',
    };

    expect(planLaunch(CLAUDE, [], windows(files)).args[0]).toBe(
      'C:\\Windows\\node_modules\\x\\cli.js',
    );
    expect(planLaunch(CLAUDE, [], windows(files, NPM)).command).toBe(`${NPM}\\claude.exe`);
  });

  test('starts an npm .cmd shim through Node and the script it names, with no shell', () => {
    const entry = `${NPM}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`;
    const files = {
      [`${NPM}\\claude.cmd`]: npmShim('node_modules\\@anthropic-ai\\claude-code\\cli.js'),
      [entry]: '',
    };

    expect(planLaunch(CLAUDE, ['-p', 'a "b" %PATH% & c'], windows(files))).toEqual({
      command: NODE,
      args: [entry, '-p', 'a "b" %PATH% & c'],
      verbatim: false,
    });
  });

  test('reads the older shim form, and a shim that names a program instead of a script', () => {
    const older = `@"%~dp0\\node_modules\\x\\bin\\run.mjs" %*`;
    const native = `@ECHO off\r\n"%dp0%\\node_modules\\x\\bin\\claude.exe" %*`;

    expect(
      planLaunch(
        CLAUDE,
        ['-v'],
        windows({ [`${NPM}\\claude.cmd`]: older, [`${NPM}\\node_modules\\x\\bin\\run.mjs`]: '' }),
      ),
    ).toMatchObject({ command: NODE, args: [`${NPM}\\node_modules\\x\\bin\\run.mjs`, '-v'] });
    expect(
      planLaunch(
        CLAUDE,
        ['-v'],
        windows({
          [`${NPM}\\claude.cmd`]: native,
          [`${NPM}\\node_modules\\x\\bin\\claude.exe`]: '',
        }),
      ),
    ).toEqual({
      command: `${NPM}\\node_modules\\x\\bin\\claude.exe`,
      args: ['-v'],
      verbatim: false,
    });
  });

  test('falls back to cmd.exe for a shim it cannot read, with every argument quoted', () => {
    const shim = `${NPM}\\claude.cmd`;
    const launch = planLaunch(
      CLAUDE,
      ['-p', 'say "hi" & exit'],
      windows({ [shim]: '@call it %*' }),
    );

    expect(launch.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(launch.verbatim).toBe(true);
    expect(launch.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(launch.args[3]).toBe(
      `"${shim.replace(/ /g, '^ ')} ${quoteForCmd('-p')} ${quoteForCmd('say "hi" & exit')}"`,
    );
  });

  test('falls back to cmd.exe when the script a shim names is not there', () => {
    const files = { [`${NPM}\\claude.cmd`]: npmShim('node_modules\\gone\\cli.js') };

    expect(planLaunch(CLAUDE, [], windows(files)).verbatim).toBe(true);
  });

  test('refuses to pass a line break through cmd.exe, which would cut the command short', () => {
    const files = { [`${NPM}\\claude.bat`]: '@call it %*' };

    expect(() => planLaunch(CLAUDE, ['-p', 'one\ntwo'], windows(files))).toThrow(EngineRunError);
    expect(() => planLaunch(CLAUDE, ['-p', 'one\ntwo'], windows(files))).toThrow(/line break/);
  });

  test('says the program is not installed when no folder on the path holds it', () => {
    const attempt = () => planLaunch(CLAUDE, [], windows({}));

    expect(attempt).toThrow(EngineRunError);
    expect(attempt).toThrow(/Claude Code is not installed/);
    expect(() => planLaunch(CLAUDE, [], { ...windows({}), env: {} })).toThrow(/not installed/);
  });

  test('reads a path written with quotes and empty entries', () => {
    const files = { 'C:\\My Tools\\claude.exe': '' };

    expect(planLaunch(CLAUDE, [], windows(files, ';"C:\\My Tools";')).command).toBe(
      'C:\\My Tools\\claude.exe',
    );
  });
});

describe('quoteForCmd', () => {
  test('wraps the argument in quotes and escapes them for both readings of the line', () => {
    // cmd.exe reads the line once, and the shim hands `%*` on to be read again.
    expect(quoteForCmd('plain')).toBe('^^^"plain^^^"');
  });

  test('keeps a quote inside the argument a quote', () => {
    expect(quoteForCmd('say "hi"')).toBe('^^^"say^^^ \\^^^"hi\\^^^"^^^"');
  });

  test('doubles the backslashes that come before a quote or the end', () => {
    expect(quoteForCmd('C:\\dir\\')).toBe('^^^"C:\\dir\\\\^^^"');
    expect(quoteForCmd('a\\"b')).toBe('^^^"a\\\\\\^^^"b^^^"');
  });

  test('takes the meaning out of the characters cmd.exe acts on', () => {
    for (const mark of ['&', '|', '<', '>', '^', '%', '!', '(', ')']) {
      expect(quoteForCmd(`a${mark}b`)).toBe(`^^^"a^^^${mark}b^^^"`);
    }
  });
});
