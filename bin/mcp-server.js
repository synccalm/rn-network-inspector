#!/usr/bin/env node
'use strict';

const { start } = require('../src/mcp/server');

start().catch((err) => {
  // The stdio transport owns stdout exclusively for JSON-RPC framing —
  // never write here. stderr is safe and is what Claude Code surfaces.
  process.stderr.write(`[synccalm-mcp] Failed to start: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
