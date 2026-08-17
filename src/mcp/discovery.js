'use strict';

/**
 * Resolves which collector backs this MCP session, and talks to it over the
 * same REST endpoints the dashboard uses. Prefers an already-running server
 * (started by `npx synccalm`); if none is found, starts one in-process
 * so the MCP server works standalone.
 *
 * Either way this process holds no log state of its own — every tool call
 * re-fetches from the collector, so there's never a second, possibly-stale
 * copy of the store.
 *
 * The collector's port is dynamic (starts at 4040, increments if taken —
 * see src/server/find-port.js), so by default this scans the same range the
 * CLI itself uses. Set SYNCCALM_PORT to skip scanning and pin an exact
 * port instead.
 */

const http = require('http');

const runtimeFile = require('../server/runtime-file');

const HOST = process.env.SYNCCALM_HOST || 'localhost';
const EXPLICIT_PORT = process.env.SYNCCALM_PORT ? parseInt(process.env.SYNCCALM_PORT, 10) : null;
const SCAN_START_PORT = 4040;
const SCAN_MAX_ATTEMPTS = 50;
const REQUEST_TIMEOUT_MS = 300;

let cachedPort = EXPLICIT_PORT || null;
// Tokens for collectors we've already resolved, keyed by port.
const tokens = new Map();

/**
 * Reads a collector's token from its 0600 runtime file. Reads are now
 * authenticated, so blind port-scanning no longer identifies a collector —
 * the file is what tells us both where one is and how to talk to it.
 * `SYNCCALM_TOKEN` overrides, for unusual setups.
 */
function tokenFor(port) {
  if (process.env.SYNCCALM_TOKEN) return process.env.SYNCCALM_TOKEN;
  if (tokens.has(port)) return tokens.get(port);
  const state = runtimeFile.read(port);
  const token = state ? state.token : null;
  if (token) tokens.set(port, token);
  return token;
}

function httpGetJson(port, path, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.get({ host: HOST, port, path, headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

function httpPost(port, path, token) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.request(
      { host: HOST, port, path, method: 'POST', headers, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function pingPort(port) {
  const token = tokenFor(port);
  if (!token) return null; // no local record of a collector here
  try {
    const session = await httpGetJson(port, '/api/session', token);
    if (session && typeof session.sessionId === 'string') return session;
  } catch (e) {
    tokens.delete(port); // stale token, or nothing listening
  }
  return null;
}

/**
 * Candidate ports, preferring collectors this user actually has recorded.
 * The port range is still swept as a fallback so a collector whose runtime
 * file was cleaned up (a tmp sweep, say) is found when SYNCCALM_TOKEN is set.
 */
async function scanRange(startPort, count) {
  const recorded = runtimeFile.readAll().map((s) => s.port);
  const swept = [];
  for (let port = startPort; port < startPort + count; port++) swept.push(port);
  const candidates = [...new Set([...recorded, ...swept])];

  const results = await Promise.all(
    candidates.map((port) => pingPort(port).then((session) => (session ? { port, session } : null)))
  );
  return results.find(Boolean) || null;
}

/**
 * Returns `{ host, port, session }` for the running dashboard server, where
 * `session` is the current `{ sessionId, logs, consoleLogs }` snapshot.
 * Throws a clear, actionable error if none is found.
 */
async function findExistingServer() {
  if (cachedPort) {
    const session = await pingPort(cachedPort);
    if (session) return { host: HOST, port: cachedPort, session };
    cachedPort = null; // server we knew about is gone — rediscover below
  }

  if (EXPLICIT_PORT) {
    const session = await pingPort(EXPLICIT_PORT);
    if (session) {
      cachedPort = EXPLICIT_PORT;
      return { host: HOST, port: EXPLICIT_PORT, session };
    }
    return null;
  }

  const found = await scanRange(SCAN_START_PORT, SCAN_MAX_ATTEMPTS);
  if (found) {
    cachedPort = found.port;
    return { host: HOST, port: found.port, session: found.session };
  }

  return null;
}

// Set once we've started our own collector, so we never start a second one.
let embeddedStartPromise = null;

/**
 * Starts an in-process collector (the same HTTP + WebSocket server the CLI
 * runs) so the MCP server works standalone — no separate `npx synccalm`
 * needed. The SDK connects to it exactly as it would the CLI's server.
 *
 * Note this ties the log lifetime to this process: when the MCP client
 * (e.g. Claude Code) exits, the collector goes with it and captured logs
 * are lost. Running `npx synccalm` separately gives logs an independent
 * lifetime; when one is already running we always defer to it instead.
 */
function startEmbeddedServer() {
  if (!embeddedStartPromise) {
    embeddedStartPromise = (async () => {
      // Required lazily so merely importing this module doesn't pull in ws.
      const { startServer } = require('../server');
      const { port, url, token } = await startServer({
        startPort: EXPLICIT_PORT || SCAN_START_PORT,
        open: false,
      });
      cachedPort = port;
      tokens.set(port, token);
      // stdout belongs to the JSON-RPC framing — stderr is the only safe
      // channel, and is what MCP clients surface in their logs.
      process.stderr.write(
        `[synccalm-mcp] No running synccalm server found — started an embedded one.\n` +
          `[synccalm-mcp] Point the SDK at port ${port}. Dashboard: ${url}\n` +
          `[synccalm-mcp] Logs live only while this MCP server runs. For logs that persist\n` +
          `[synccalm-mcp] across restarts, run \`npx synccalm\` separately instead.\n`
      );
      return port;
    })().catch((err) => {
      embeddedStartPromise = null; // allow a later retry
      throw err;
    });
  }
  return embeddedStartPromise;
}

/**
 * Returns `{ host, port, session }` for the collector backing this session,
 * preferring an already-running one and falling back to starting an
 * embedded collector. Set SYNCCALM_NO_AUTOSTART=1 to disable the
 * fallback and require an externally-run server.
 */
async function discoverServer() {
  const existing = await findExistingServer();
  if (existing) return existing;

  if (process.env.SYNCCALM_NO_AUTOSTART === '1') {
    const where = EXPLICIT_PORT
      ? `${HOST}:${EXPLICIT_PORT} (from SYNCCALM_PORT)`
      : `${HOST}:${SCAN_START_PORT}-${SCAN_START_PORT + SCAN_MAX_ATTEMPTS - 1}`;
    throw new Error(
      `No running synccalm server found on ${where}, and autostart is disabled ` +
        '(SYNCCALM_NO_AUTOSTART=1). Start one with `npx synccalm`.'
    );
  }

  const port = await startEmbeddedServer();
  const session = await pingPort(port);
  if (!session) {
    throw new Error('Started an embedded synccalm collector but could not read its session.');
  }
  return { host: HOST, port, session };
}

async function clearServer() {
  const { port } = await discoverServer();
  await httpPost(port, '/api/clear', tokenFor(port));
}

module.exports = { discoverServer, clearServer };
