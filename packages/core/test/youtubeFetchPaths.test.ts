import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

/**
 * Every way Jgtube's own code reaches the network, read from the source. A
 * new path to YouTube that does not go through `youtubeFetch` (and so would
 * skip the owner's proxy) fails here.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SOURCE_FOLDERS = ['packages/core/src', 'packages/server/src', 'packages/mcp/src'];

/** The one place the global `fetch` and the proxy library are used for YouTube. */
const HELPER = 'packages/core/src/sources/youtubeFetch.ts';
/**
 * Files that may use the global `fetch` because they never ask YouTube's
 * pages for anything: the official Data API on googleapis.com, and Google's
 * Gemini API (an AI engine). The proxy is for page reading, not for these.
 */
const NOT_YOUTUBE_PAGES: ReadonlySet<string> = new Set([
  'packages/core/src/sources/dataApi.ts',
  'packages/core/src/sources/commentsApi.ts',
  'packages/server/src/engines/geminiVideo.ts',
]);
/** The modules that open connections of their own. Only the server's entry point listens. */
const NETWORK_MODULES = /^(node:)?(https?|http2|net|tls|dgram|undici)$/;
const NETWORK_ALLOWED: ReadonlySet<string> = new Set([HELPER, 'packages/server/src/main.ts']);
/** Addresses of YouTube's pages, pictures and video servers. */
const YOUTUBE_HOSTS = /youtube\.com|youtu\.be|ytimg\.com|googlevideo\.com|googleusercontent\.com/;

function sourceFiles(folder: string): readonly string[] {
  return readdirSync(join(ROOT, folder), { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

const FILES = SOURCE_FOLDERS.flatMap(sourceFiles);

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

/** Every node in a file, depth first. */
function nodesOf(source: ts.SourceFile): readonly ts.Node[] {
  const found: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Whether an identifier named `fetch` is only a name here (a property, a method, a parameter). */
function isOnlyAName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    (ts.isPropertyAccessExpression(parent) &&
      parent.name === node &&
      parent.expression.getText() !== 'globalThis') ||
    ((ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent)) &&
      parent.name === node) ||
    ts.isTypeQueryNode(parent) ||
    ts.isQualifiedName(parent)
  );
}

/** Whether the file declares something of its own named `fetch` (a parameter, a variable, an import). */
function declaresFetch(nodes: readonly ts.Node[]): boolean {
  return nodes.some(
    (node) =>
      (ts.isParameter(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isImportSpecifier(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'fetch',
  );
}

/** Uses of the global `fetch` in a file, as line numbers. */
function globalFetchUses(source: ts.SourceFile): readonly number[] {
  const nodes = nodesOf(source);
  const local = declaresFetch(nodes);
  return nodes
    .filter((node): node is ts.Identifier => ts.isIdentifier(node) && node.text === 'fetch')
    .filter((node) => !isOnlyAName(node))
    .filter((node) => {
      const parent = node.parent;
      const viaGlobal =
        ts.isPropertyAccessExpression(parent) &&
        ts.isIdentifier(parent.expression) &&
        parent.expression.text === 'globalThis';
      return viaGlobal || !local;
    })
    .map((node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
}

/** Calls of the YouTube library's `Innertube.create`, and whether each is given `fetch: youtubeFetch`. */
function innertubeCreates(source: ts.SourceFile): readonly boolean[] {
  return nodesOf(source)
    .filter(
      (node): node is ts.CallExpression =>
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.getText(source) === 'Innertube.create',
    )
    .map((call) => {
      const options = call.arguments[0];
      if (options === undefined || !ts.isObjectLiteralExpression(options)) return false;
      return options.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === 'fetch' &&
          property.initializer.getText(source) === 'youtubeFetch',
      );
    });
}

function importedModules(source: ts.SourceFile): readonly string[] {
  return nodesOf(source)
    .filter(ts.isImportDeclaration)
    .map((node) => (node.moduleSpecifier as ts.StringLiteral).text);
}

describe('every path to YouTube goes through youtubeFetch', () => {
  test('the scan finds the source files and the helper', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES).toContain(HELPER);
  });

  test('no file but the helper and the non-YouTube APIs uses the global fetch', () => {
    const offenders = FILES.filter((file) => file !== HELPER && !NOT_YOUTUBE_PAGES.has(file))
      .map((file) => ({ file, lines: globalFetchUses(parse(file)) }))
      .filter(({ lines }) => lines.length > 0);
    expect(offenders).toEqual([]);
  });

  test('the files allowed the global fetch never name a YouTube page, picture or video host', () => {
    const naming = [...NOT_YOUTUBE_PAGES].filter((file) =>
      YOUTUBE_HOSTS.test(
        readFileSync(join(ROOT, file), 'utf8')
          .split('\n')
          .filter((line) => !/^\s*(\*|\/\/)/.test(line))
          .join('\n'),
      ),
    );
    expect(naming).toEqual([]);
  });

  test('the YouTube library is always made with youtubeFetch', () => {
    const creates = FILES.map((file) => ({ file, calls: innertubeCreates(parse(file)) })).filter(
      ({ calls }) => calls.length > 0,
    );
    expect(creates.length).toBeGreaterThan(0);
    expect(creates.filter(({ calls }) => calls.includes(false))).toEqual([]);
  });

  test('no other file opens network connections of its own', () => {
    const offenders = FILES.filter((file) => !NETWORK_ALLOWED.has(file))
      .map((file) => ({ file, modules: importedModules(parse(file)) }))
      .map(({ file, modules }) => ({
        file,
        modules: modules.filter((name) => NETWORK_MODULES.test(name)),
      }))
      .filter(({ modules }) => modules.length > 0);
    expect(offenders).toEqual([]);
  });

  test('the checks catch a file that bypasses the helper', () => {
    const bypass = ts.createSourceFile(
      'bypass.ts',
      [
        "import { Innertube } from 'youtubei.js';",
        'export const read = (url: string) => fetch(url);',
        'export const also = globalThis.fetch;',
        'export const client = () => Innertube.create({ lang: "en" });',
        'export const fine = (deps: { fetch: typeof fetch }) => deps.fetch("x");',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
    );
    expect(globalFetchUses(bypass)).toEqual([2, 3]);
    expect(innertubeCreates(bypass)).toEqual([false]);
  });
});
