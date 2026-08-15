'use strict';

/**
 * Local test helper — NOT part of the published package (outside the
 * "files" whitelist in package.json).
 *
 * Simulates what the SDK sends, without needing a real React Native app.
 * Connects to a running `synccalm` server as if it were the SDK, and
 * pushes a handful of requests — including three hits of the same
 * endpoint with slightly different responses, so you can try Compare mode.
 *
 * Usage:
 *   node bin/synccalm.js --port 4040   # in one terminal
 *   node examples/simulate-traffic.js 4040 # in another
 */

const WebSocket = require('ws');

const port = process.argv[2] || 4040;
const ws = new WebSocket(`ws://localhost:${port}/ws/sdk`);

function log(partial) {
  const now = Date.now();
  ws.send(
    JSON.stringify({
      type: 'log',
      payload: Object.assign(
        {
          requestHeaders: { Accept: 'application/json' },
          requestBody: null,
          responseHeaders: { 'content-type': 'application/json' },
          startTime: now - 80,
          endTime: now,
          duration: 80,
          error: null,
        },
        partial
      ),
    })
  );
}

ws.on('open', () => {
  console.log(`Connected to ws://localhost:${port}/ws/sdk — sending sample traffic…`);

  // three hits of the same endpoint, each with a slightly different body —
  // this is what populates the version history / compare mode.
  log({
    method: 'GET',
    url: 'https://api.example.com/users/1',
    status: 200,
    statusText: 'OK',
    responseBody: { id: 1, name: 'Ada', role: 'admin' },
  });

  setTimeout(() => {
    log({
      method: 'GET',
      url: 'https://api.example.com/users/1',
      status: 200,
      statusText: 'OK',
      responseBody: { id: 1, name: 'Ada Lovelace', role: 'admin', verified: true },
    });
  }, 400);

  setTimeout(() => {
    log({
      method: 'GET',
      url: 'https://api.example.com/users/1',
      status: 200,
      statusText: 'OK',
      responseBody: { id: 1, name: 'Ada Lovelace', role: 'owner', verified: true },
    });
  }, 800);

  setTimeout(() => {
    log({
      method: 'POST',
      url: 'https://api.example.com/users',
      requestBody: { name: 'Grace Hopper' },
      status: 201,
      statusText: 'Created',
      responseBody: { id: 2, name: 'Grace Hopper', role: 'user' },
    });
  }, 1200);

  setTimeout(() => {
    log({
      method: 'GET',
      url: 'https://api.example.com/orders?page=1',
      status: 404,
      statusText: 'Not Found',
      responseBody: { error: 'Not found' },
    });
  }, 1600);

  setTimeout(() => {
    console.log('Done. Leave the server running and explore the dashboard.');
    ws.close();
  }, 2000);
});

ws.on('error', (err) => {
  console.error('Could not connect — is `synccalm` running on that port?', err.message);
  process.exit(1);
});
