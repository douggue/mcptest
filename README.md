# mcptest

Project-scoped setup for [flow-mcp](https://github.com/GTAI-1/flow-mcp), an MCP server that drives Google Flow through a dedicated Chrome window.

## Setup (on your own machine)

Requires Node.js 22+, Google Chrome and a desktop session (it can't run headless).

```bash
./scripts/setup-flow-mcp.sh          # clones + builds into ./flow-mcp (gitignored)
npm --prefix flow-mcp run login      # sign into Google and open a Flow project, once
```

Then start Claude Code in this folder. `.mcp.json` registers the `flow` server; approve it when prompted, and ask *"check my Flow session"*.

To use it from every folder instead:

```bash
claude mcp add --scope user flow -- node "$PWD/flow-mcp/dist/index.js"
```
