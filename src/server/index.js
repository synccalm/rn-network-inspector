'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { createStore } = require('./store');
const { findOpenPort } = require('./find-port');
const { openBrowser } = require('./open-browser');
const { createStaticHandler } = require('./static');
const { generateToken, safeEqual, extractToken, isSameOrigin, isLoopbackHost } = require('./auth');
const runtimeFile = require('./runtime-file');

const DASHBOARD_DIR = path.join(__dirname, '..', 'dashboard');

function generateSessionId() {
  return crypto.randomBytes(4).toString('hex'); // short, url-friendly
}

function broadcast(sockets, message) {
  const data = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

/**
 * Starts the local HTTP + WebSocket server that backs the CLI.
 *
 * - Serves the prebuilt dashboard at `/` and `/:sessionId`.
 * - `/ws/sdk`       — SDK instances connect here and push `{type:'log'}`
 *                      (network requests) or `{type:'console'}` (app logs).
 * - `/ws/dashboard` — browser dashboard(s) connect here: get the current
 *                      session's history on connect, then live updates.
 * - `GET  /api/session` — the current capture.
 * - `POST /api/clear`   — wipes the in-memory log store for this session.
 *
 * The capture contains whatever the app sent — routinely auth headers and
 * user data — so it is not served openly:
 *
 * - The listener binds to loopback unless `host` says otherwise, keeping it
 *   off the LAN by default.
 * - Reads (`/api/session`, `/api/clear`, `/ws/dashboard`) require the
 *   per-session token minted below.
 * - WebSocket upgrades are Origin-checked, so a page the developer merely
 *   visits cannot open a socket and read the capture.
 *
 * `/ws/sdk` is deliberately writable without a token: the token rotates on
 * every restart, and requiring it would mean editing `SyncCalm.init()` each
 * time. It is write-only — nothing can be read back through it — and the
 * Origin check still bars browsers, leaving only same-machine (or, after an
 * explicit `--host`, same-LAN) processes able to append logs.
 */
async function startServer(options) {
  const opts = options || {};
  const startPort = opts.startPort || 4040;
  const maxAttempts = opts.maxAttempts || 50;
  // Loopback by default. Binding to every interface publishes the capture to
  // the whole network, so it must be an explicit, deliberate choice.
  const host = opts.host || '127.0.0.1';
  const shouldOpen = opts.open !== false;

  const store = createStore();
  const sessionId = generateSessionId();
  const token = opts.token || generateToken();
  const serveStatic = createStaticHandler(DASHBOARD_DIR);

  function authorize(req, url, res) {
    if (safeEqual(extractToken(req, url) || '', token)) return true;
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'unauthorized',
        message:
          'This endpoint requires the session token. Open the dashboard URL printed by ' +
          '`npx synccalm`, or send it as `Authorization: Bearer <token>`.',
      })
    );
    return false;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/clear') {
      if (!authorize(req, url, res)) return;
      store.clear();
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
      if (!authorize(req, url, res)) return;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ sessionId, logs: store.getRequestLogs(), consoleLogs: store.getConsoleLogs() }));
      return;
    }

    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ noServer: true });
  const sdkSockets = new Set();
  const dashboardSockets = new Set();

  // Every store mutation (log/console/clear), from any source — SDK
  // sockets, the dashboard's own WS clear message, or the REST /api/clear
  // endpoint — flows through this single subscription, so every connected
  // dashboard tab always reflects the store's actual state.
  store.onEvent((event) => broadcast(dashboardSockets, event));

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const origin = req.headers.origin;
    const hostHeader = req.headers.host;

    function deny(status, reason) {
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    }

    if (pathname !== '/ws/sdk' && pathname !== '/ws/dashboard') {
      deny(404, 'Not Found');
      return;
    }

    if (pathname === '/ws/dashboard') {
      // A browser always sends Origin and cannot spoof it, so this is what
      // stops a foreign page from hijacking the socket (CSWSH).
      if (!isSameOrigin(origin, hostHeader)) {
        deny(403, 'Forbidden');
        return;
      }
      if (!safeEqual(extractToken(req, url) || '', token)) {
        deny(401, 'Unauthorized');
        return;
      }
    } else if (origin && !isSameOrigin(origin, hostHeader)) {
      // The React Native SDK is a native client: it either sends no Origin
      // (Android/OkHttp) or one derived from the target URL (iOS), both of
      // which pass. A browser page pointed here does not.
      deny(403, 'Forbidden');
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      if (pathname === '/ws/sdk') {
        sdkSockets.add(ws);
        ws.on('close', () => sdkSockets.delete(ws));
        ws.on('message', (raw) => {
          let msg;
          try {
            msg = JSON.parse(raw.toString());
          } catch (e) {
            return;
          }
          if (!msg || !msg.payload) return;
          if (msg.type === 'log') {
            store.addRequestLog(msg.payload);
          } else if (msg.type === 'console') {
            store.addConsoleLog(msg.payload);
          }
        });
        return;
      }

      // pathname === '/ws/dashboard'
      dashboardSockets.add(ws);
      ws.send(
        JSON.stringify({
          type: 'init',
          payload: { sessionId, logs: store.getRequestLogs(), consoleLogs: store.getConsoleLogs() },
        })
      );
      ws.on('close', () => dashboardSockets.delete(ws));
      ws.on('message', (raw) => {
        let msg;
        try {
          msg = JSON.parse(raw.toString());
        } catch (e) {
          return;
        }
        if (msg && msg.type === 'clear') {
          store.clear();
        }
      });
    });
  });

  const port = await findOpenPort(server, startPort, maxAttempts, host);
  const displayHost = isLoopbackHost(host) || host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  // The token rides in the fragment: fragments are never sent to a server,
  // so it cannot leak through Referer or a proxy access log.
  const url = `http://${displayHost}:${port}/${sessionId}#token=${token}`;

  runtimeFile.write({ port, token, sessionId, host, pid: process.pid, startedAt: Date.now() });
  const cleanup = () => runtimeFile.remove(port);
  server.on('close', cleanup);
  process.once('exit', cleanup);

  if (shouldOpen) openBrowser(url);

  return { server, port, host, sessionId, token, url, store };
}

module.exports = { startServer };
