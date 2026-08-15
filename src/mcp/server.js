'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const tools = require('./tools');
const { discoverServer } = require('./discovery');

function toolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResult(err) {
  const message = err && err.message ? err.message : String(err);
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

// Wraps a tools.js handler so a thrown Error becomes a proper MCP tool
// error result instead of crashing the server process.
function handler(fn) {
  return async (args) => {
    try {
      return toolResult(await fn(args));
    } catch (err) {
      return errorResult(err);
    }
  };
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };

async function start() {
  const server = new McpServer({ name: 'synccalm', version: '1.0.0' });

  server.registerTool(
    'list_requests',
    {
      title: 'List captured network requests',
      description:
        'Lists recently captured network requests from the running synccalm session (method, URL, status, timestamp, duration), most recent first. Optionally filter by a URL substring and/or HTTP method.',
      inputSchema: {
        urlPattern: z.string().optional().describe('Case-insensitive substring to filter URLs by, e.g. "auth" or "/users/1".'),
        method: z.string().optional().describe('Filter to a single HTTP method, e.g. "GET" or "POST".'),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Max number of requests to return (default 50, max 200).'),
      },
      annotations: READ_ONLY,
    },
    handler(tools.listRequests)
  );

  server.registerTool(
    'get_request',
    {
      title: 'Get full request/response detail',
      description:
        'Returns the full captured detail for one request — headers, JSON body, status, and duration — given its id (from list_requests or get_endpoint_history).',
      inputSchema: {
        id: z.string().describe('The request id, as returned by list_requests or get_endpoint_history.'),
      },
      annotations: READ_ONLY,
    },
    handler(tools.getRequest)
  );

  server.registerTool(
    'get_endpoint_history',
    {
      title: 'Get all captured versions of an endpoint',
      description:
        'Returns every captured hit to a given URL (optionally scoped to one HTTP method), most recent first, numbered v1..vN in capture order. Call this before diff_endpoint_versions to see how many versions exist and their version numbers.',
      inputSchema: {
        url: z.string().describe('The exact URL of the endpoint, as it appears in list_requests output.'),
        method: z.string().optional().describe('Restrict to one HTTP method. If omitted, matches the URL across all methods.'),
      },
      annotations: READ_ONLY,
    },
    handler(tools.getEndpointHistory)
  );

  server.registerTool(
    'diff_endpoint_versions',
    {
      title: 'Diff two captured versions of an endpoint',
      description:
        "Compares two captured versions of the same endpoint's response body and returns a flat list of added/removed/changed keys, each with its old and/or new value. Defaults to the two most recent versions when versionA/versionB are omitted.",
      inputSchema: {
        url: z.string().describe('The exact URL of the endpoint.'),
        method: z.string().optional().describe('Restrict to one HTTP method. If omitted, matches the URL across all methods.'),
        versionA: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Base version number (1-indexed, from get_endpoint_history). Defaults to the second-most-recent version.'),
        versionB: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Compare version number (1-indexed). Defaults to the most recent version.'),
      },
      annotations: READ_ONLY,
    },
    handler(tools.diffEndpointVersions)
  );

  server.registerTool(
    'clear_logs',
    {
      title: 'Clear captured logs',
      description:
        "Wipes all captured requests and console logs from the current synccalm session. The dashboard and any other connected clients reflect the empty session immediately.",
      inputSchema: {},
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    handler(tools.clearLogs)
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Bring the collector up now rather than on the first tool call, so the
  // app's SDK has something to connect to as soon as this server starts.
  // Non-fatal: if it fails, the tools report it individually and a later
  // call can retry.
  discoverServer().catch((err) => {
    process.stderr.write(`[synccalm-mcp] Collector not ready: ${err && err.message ? err.message : err}\n`);
  });
}

module.exports = { start };
