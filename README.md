<div align="center">

# SyncCalm

**See every network request your React Native app makes — live, in your browser.**

*Because syncing should be calm — no surprises, no silent errors.*

Captures `fetch` and `XMLHttpRequest` traffic in development and streams it to a
local dashboard, with a collapsible JSON viewer and **git-style diffing** across
repeated calls to the same endpoint. Ships with an **MCP server** so Claude can
read your captured traffic directly.

[![npm](https://img.shields.io/npm/v/@synccalm/rn-network-inspector.svg)](https://www.npmjs.com/package/@synccalm/rn-network-inspector)
[![license](https://img.shields.io/npm/l/@synccalm/rn-network-inspector.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/@synccalm/rn-network-inspector.svg)](https://nodejs.org)

</div>

---

## Why

Debugging API calls in React Native usually means `console.log(JSON.stringify(res))`,
squinting at a wall of unformatted text in Metro, and scrolling back to compare it
with the last response by eye.

SyncCalm gives you the network tab you already know from the browser — plus the
thing browsers don't have: **the same endpoint's responses, diffed against each
other**, so "why did this work a minute ago?" takes seconds instead of a rebuild.

- 🔌 **Zero config** — one `init()` call, one CLI command. No native modules, no linking, no `pod install`.
- 📡 **Real time** — requests appear as they happen, over WebSocket.
- 🌲 **JSON tree** — expand, collapse, syntax highlight, copy any node.
- 🔀 **Compare mode** — diff any two hits of an endpoint; additions green, removals red, changes yellow.
- 🤖 **Claude via MCP** — ask questions about your traffic in plain English. [Jump to setup ↓](#-claude-integration-mcp)
- 📦 **Dev only** — a no-op when `__DEV__` is false, so it can't ship to production.

> **Scope:** v1 is a local development tool — no auth, no cloud, no persistence.
> Logs live in memory and reset when the server stops. See [Limitations](#limitations).

---

## Quick start

### 1. Install

```sh
npm install --save-dev @synccalm/rn-network-inspector
# or
yarn add -D @synccalm/rn-network-inspector
# or
pnpm add -D @synccalm/rn-network-inspector
```

### 2. Start the dashboard

From your project root, in its own terminal:

```sh
npx synccalm
```

```
  ✓ synccalm is running

    Dashboard   http://localhost:4040/a1b2c3d4
    Session     a1b2c3d4

  Press Ctrl+C to stop.
```

It picks port `4040`, or the next free port if that's taken, and opens your browser.

### 3. Initialize the SDK

In your app's entry point — `index.js`, `App.tsx`, or wherever your app boots:

```js
import SyncCalm from '@synccalm/rn-network-inspector';

if (__DEV__) {
  SyncCalm.init();
}
```

That's everything. Every `fetch()` and `XMLHttpRequest` your app makes now appears
in the dashboard as it happens — **including axios**, which uses XHR under the hood
on React Native.

`SyncCalm.init()` does nothing whenever `__DEV__` is `false`, so leaving that
guarded call in your shipped entry point is safe — no interception, no listeners,
no overhead in production builds.

---

## Connecting from a simulator or device

The SDK connects to the server running on your development machine. How it finds
that machine depends on where your app runs:

| Where your app runs | What to do |
| --- | --- |
| **iOS Simulator** | Nothing — `localhost` already works |
| **Android Emulator** | Nothing — auto-detected via `10.0.2.2` |
| **Physical device** (same Wi-Fi) | Pass your machine's LAN IP: `SyncCalm.init({ host: '192.168.1.23' })` |
| **Non-default port** | `SyncCalm.init({ port: 4041 })` — match whatever `npx synccalm` printed |

> Find your LAN IP with `ipconfig getifaddr en0` on macOS, or `hostname -I` on Linux.

---

## The dashboard

| View | What it does |
| --- | --- |
| **All requests** | Chronological feed, newest first — method, URL, status, duration |
| **Graph** | The same requests grouped by method + URL. Endpoints hit more than once get a version history (`v1`, `v2`, `v3`…) |
| **Compare** | Pick any two versions of an endpoint and diff their response bodies, inline or side by side |
| **Logs** | `console.log` / `info` / `warn` / `error` / `debug` from your app's JS |
| **Copy** | Every JSON node has a copy button, plus one-click "copy full response" |
| **Clear** | Wipes the current session |

<!-- ![Dashboard](./docs/screenshot-dashboard.png) -->
<!-- ![Compare mode](./docs/screenshot-compare.gif) -->

---

## 🤖 Claude integration (MCP)

SyncCalm ships a second binary, `synccalm-mcp` — an
[MCP](https://modelcontextprotocol.io) server that lets **Claude Code or Claude
Desktop query your captured traffic directly**. No copy-pasting JSON into a chat
window: Claude reads the real requests and responses, and can diff repeated calls
to the same endpoint itself.

### Setup

```sh
claude mcp add --transport stdio synccalm -- npx -p @synccalm/rn-network-inspector synccalm-mcp
```

Two things worth knowing about that command:

- **Scope.** By default this registers the server for the **current project only** —
  sessions started from any other directory won't see the tools. Add `-s user` to
  make it available everywhere.
- **Restart required.** Claude Code fixes its tool list when a session starts, so a
  session that's already running won't pick up a newly added server. Quit, relaunch,
  and confirm with `/mcp`.

For **Claude Desktop**, add this to your `claude_desktop_config.json` instead:

```json
{
  "mcpServers": {
    "synccalm": {
      "command": "npx",
      "args": ["-p", "@synccalm/rn-network-inspector", "synccalm-mcp"]
    }
  }
}
```

Then just run your app and start asking. **You don't need a separate
`npx synccalm`** — when the MCP server starts and finds no collector running, it
starts one itself so your app has somewhere to connect.

### Things to ask

> *"What changed between the last two hits to /api/profile?"*

> *"List every failed request in this session."*

> *"The login response looks wrong — show me the full body of the most recent POST
> to /auth/validate-refresh-token."*

> *"Which endpoint is slowest right now?"*

### Tools exposed

| Tool | What it does |
| --- | --- |
| `list_requests` | Recent requests — method, URL, status, timing. Filterable by URL substring and method |
| `get_request` | Full detail for one request: headers, JSON bodies, duration |
| `get_endpoint_history` | Every captured hit to one endpoint, newest first, numbered `v1..vN` |
| `diff_endpoint_versions` | Structural diff between two versions of an endpoint's response (defaults to the latest two) |
| `clear_logs` | Wipes the session — the only tool that writes |

Every tool returns structured JSON, so Claude reasons over real values rather than
parsing prose.

### With or without the dashboard

|  | MCP only | Plus `npx synccalm` |
| --- | --- | --- |
| What you run | nothing — Claude spawns it | `npx synccalm` (add `--no-open` to skip the browser) |
| Browser dashboard | at the URL logged to stderr | opens automatically |
| Logs survive a Claude restart | ✗ — the collector dies with the MCP server | ✓ — independent lifetime |
| Shared across several Claude sessions | ✗ | ✓ |

Both can run together. If a collector is already running, the MCP server always
defers to it instead of starting a second one — so Claude and the dashboard always
read the exact same session.

### Privacy

The MCP server only talks to `localhost` — the same in-memory session the dashboard
shows. Nothing is uploaded anywhere. The only data that leaves your machine is
whatever Claude sends to the model as part of your conversation, exactly as with any
file you show it. Bear that in mind if your traffic carries real tokens or personal
data.

---

## API

```ts
import SyncCalm from '@synccalm/rn-network-inspector';

SyncCalm.init(options?: {
  host?: string;            // default: 'localhost' ('10.0.2.2' on the Android emulator)
  port?: number;            // default: 4040
  enabled?: boolean;        // default: true — set false to disable even in dev
  maxBodyLength?: number;   // default: 200000 — longer bodies are truncated
  logToConsole?: boolean;   // default: false — also mirror captures to the Metro console
  captureConsole?: boolean; // default: true — capture console.* for the Logs tab
});
```

TypeScript types ship with the package — no `@types` install needed.

## CLI

```sh
npx synccalm                 # start the server and open the dashboard
npx synccalm --port 5000     # start searching for a free port from 5000
npx synccalm --no-open       # don't open a browser
npx synccalm --help          # show help
```

The short `synccalm` command comes from the package's local `node_modules/.bin`, so
it works once you've installed the dev dependency. Without installing first, use the
full package name — `npx @synccalm/rn-network-inspector` — which runs the same binary.

## Environment variables

These affect the **MCP server** (`synccalm-mcp`):

| Variable | Effect |
| --- | --- |
| `SYNCCALM_PORT` | Pin the collector port instead of scanning `4040`–`4089` |
| `SYNCCALM_HOST` | Collector host. Default `localhost` |
| `SYNCCALM_NO_AUTOSTART` | Set to `1` to refuse to start an embedded collector, requiring `npx synccalm` to be running |

---

## Troubleshooting

**Nothing shows up in the dashboard.**
Check, in order: (1) is `npx synccalm` still running? (2) does the port in
`SyncCalm.init({ port })` match the one it printed? (3) is `init()` actually being
called — is `__DEV__` true? A quick `SyncCalm.init({ logToConsole: true })` will
mirror captures into Metro so you can confirm the SDK is alive.

**Works on the simulator, not on my physical device.**
The device can't reach `localhost` — that's your machine, not the phone. Pass your
LAN IP: `SyncCalm.init({ host: '192.168.1.23' })`. Both must be on the same
network, and some corporate or guest Wi-Fi blocks device-to-device traffic entirely.

**Port 4040 is already in use.**
It automatically moves to the next free port and prints the one it picked. Pass the
same port to `init()`.

**My axios / Apollo / react-query calls don't appear.**
They should — all of them go through `fetch` or `XHR` on React Native. If they don't,
something in your stack replaced `global.fetch` *after* `init()` ran. Move
`SyncCalm.init()` earlier, above the rest of your imports in the entry file.

**Claude doesn't see the tools.**
MCP servers register per-project by default and load only at session start. Run
`claude mcp add -s user --transport stdio synccalm -- npx -p @synccalm/rn-network-inspector synccalm-mcp`, then fully
restart Claude Code and check `/mcp`.

**Response bodies are cut off.**
Bodies longer than 200,000 characters are truncated. Raise it with
`SyncCalm.init({ maxBodyLength: 1000000 })`.

---

## FAQ

**Can this end up in my production bundle?**
`init()` returns immediately when `__DEV__` is false, so nothing is patched even if
the call ships. Install it as a `devDependency` and keep the `if (__DEV__)` guard,
and it stays out of your way entirely.

**Does it need a native module or `pod install`?**
No. It's pure JavaScript — it patches `fetch` and `XMLHttpRequest` at runtime.
Nothing to link, nothing to rebuild.

**Does it work with Expo?**
Yes, on any Expo setup where you control the JS entry point.

**How is this different from Flipper or Reactotron?**
Those are broad, general-purpose debuggers. SyncCalm does one thing: network traffic,
with response diffing across repeated calls and a Claude/MCP interface. It's also
far lighter — no desktop app, no native setup.

**Where does my data go?**
Nowhere. Everything is in memory on your own machine and disappears when the server
stops.

**Does it capture native logs from Xcode or Logcat?**
No — JS only. See [Limitations](#limitations).

---

## Limitations

v1 is deliberately small:

- **No auth or accounts** — a local dev tool, nothing more
- **No persistence or cloud sync** — logs live in memory and reset on restart
- **No production or remote logging** — dev only, guarded by `__DEV__`
- **No state-management integration** — network requests and `console.*`, nothing else
- **MCP is stdio-only** and unauthenticated by design — single-user, local
- **JS-side logs only** — `console.*` from your app and its JS dependencies. Native
  logs (Xcode console, Logcat) would need a native module and are out of scope

## Requirements

- Node.js 16 or newer
- React Native 0.60+ (peer dependency, optional — the CLI and MCP server run standalone)

## Contributing

Issues and PRs are welcome at
[github.com/synccalm/synccalm-rn](https://github.com/synccalm/synccalm-rn).

## License

MIT © [json-formatter.co.in](https://json-formatter.co.in)
