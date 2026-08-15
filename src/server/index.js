'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const { createStore } = require('./store');
const { findOpenPort } = require('./find-port');
const { openBrowser } = require('./open-browser');
const { createStaticHandler } = require('./static');

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
 * - `POST /api/clear` — wipes the in-memory log store for this session.
 */
async function startServer(options) {
  const opts = options || {};
  const startPort = opts.startPort || 4040;
  const maxAttempts = opts.maxAttempts || 50;
  const host = opts.host || '0.0.0.0';
  const shouldOpen = opts.open !== false;

  const store = createStore();
  const sessionId = generateSessionId();
  const serveStatic = createStaticHandler(DASHBOARD_DIR);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'POST' && url.pathname === '/api/clear') {
      store.clear();
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/session') {
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
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname !== '/ws/sdk' && pathname !== '/ws/dashboard') {
      socket.destroy();
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
  const url = `http://localhost:${port}/${sessionId}`;

  if (shouldOpen) openBrowser(url);

  return { server, port, sessionId, url, store };
}

module.exports = { startServer };
