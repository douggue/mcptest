// Serve a *persistent* Camoufox profile over a Playwright websocket.
//
// Playwright's `firefox.launchServer()` normally launches a throwaway browser.
// Since Playwright 1.5x it also accepts two undocumented options that we rely on:
//   _userDataDir   -> launches a persistent context from that profile directory
//   _sharedBrowser -> every client that connects sees the same contexts, including
//                     the persistent one (browser.contexts()[0]), instead of an
//                     isolated per-connection view.
// Together they give exactly what a profile manager needs: a real on-disk Firefox
// profile with a visible window, that scripts can also attach to.
//
// Usage: node launch_server.js <playwright-driver-package-dir>
//   stdin : one line, base64(JSON launch options)
//   stdout: a line "WS_ENDPOINT ws://127.0.0.1:PORT/..." once ready, then "READY"
//   Closing stdin shuts the browser down cleanly (profile files flushed).

const path = require('path')

const driverPackage = process.argv[2]
let playwright
try {
  playwright = require(path.join(driverPackage, 'index.js'))
} catch (error) {
  console.error(`Could not load Playwright driver from ${driverPackage}: ${error.message}`)
  process.exit(2)
}

function readConfig() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    const finish = () => {
      const line = data.split('\n')[0]
      try {
        resolve(JSON.parse(Buffer.from(line, 'base64').toString('utf8')))
      } catch (e) {
        reject(e)
      }
    }
    process.stdin.on('data', (chunk) => {
      data += chunk
      if (data.includes('\n')) finish()
    })
    process.stdin.once('end', () => { if (!data.includes('\n')) finish() })
    process.stdin.once('error', reject)
    process.stdin.resume()
  })
}

const stdinClosed = new Promise((resolve) => {
  process.stdin.once('end', resolve)
  process.stdin.once('close', resolve)
})

async function main() {
  const options = await readConfig()
  const userDataDir = options.userDataDir
  delete options.userDataDir
  if (!userDataDir) throw new Error('userDataDir is required')

  // Persistent-context launches take context options too (viewport etc.).
  const launchOptions = {
    ...options,
    _userDataDir: userDataDir,
    _sharedBrowser: true,
    host: '127.0.0.1',
  }

  const server = await playwright.firefox.launchServer(launchOptions)
  const proc = server.process()
  process.stdout.write(`BROWSER_PID ${proc ? proc.pid : ''}\n`)
  process.stdout.write(`WS_ENDPOINT ${server.wsEndpoint()}\n`)
  process.stdout.write('READY\n')

  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    try { await server.close() } catch (_) { /* already gone */ }
    process.exit(0)
  }
  server.on('close', () => {
    process.stdout.write('BROWSER_CLOSED\n')
    process.exit(0)
  })
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.on('SIGBREAK', shutdown)
  await stdinClosed
  await shutdown()
}

main().catch((error) => {
  console.error(`LAUNCH_ERROR ${error && error.message ? error.message : error}`)
  process.exit(1)
})
