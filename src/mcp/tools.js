'use strict';

const { discoverServer, clearServer } = require('./discovery');
const { flattenDiff, summarize } = require('./diff');

function requestSummary(log) {
  return {
    id: log.id,
    method: (log.method || 'GET').toUpperCase(),
    url: log.url,
    status: log.status,
    statusText: log.statusText || null,
    error: log.error || null,
    timestamp: log.startTime || log.receivedAt,
    duration: typeof log.duration === 'number' ? log.duration : null,
  };
}

function matchingVersions(logs, url, method) {
  const targetMethod = method ? method.toUpperCase() : null;
  return logs
    .filter((l) => l.url === url && (!targetMethod || (l.method || 'GET').toUpperCase() === targetMethod))
    .slice()
    .sort((a, b) => (a.startTime || a.receivedAt || 0) - (b.startTime || b.receivedAt || 0));
}

/**
 * Recent captured requests, newest first, optionally filtered by a
 * case-insensitive URL substring and/or exact HTTP method.
 */
async function listRequests(args) {
  const { urlPattern, method, limit } = args || {};
  const { session } = await discoverServer();
  let logs = session.logs || [];
  const totalCaptured = logs.length;

  if (method) {
    const m = method.toUpperCase();
    logs = logs.filter((l) => (l.method || 'GET').toUpperCase() === m);
  }
  if (urlPattern) {
    const needle = urlPattern.toLowerCase();
    logs = logs.filter((l) => (l.url || '').toLowerCase().includes(needle));
  }

  logs = logs.slice().sort((a, b) => (b.startTime || b.receivedAt || 0) - (a.startTime || a.receivedAt || 0));

  const max = Math.min(limit && limit > 0 ? limit : 50, 200);
  const trimmed = logs.slice(0, max);

  return {
    sessionId: session.sessionId,
    totalCaptured,
    matched: logs.length,
    returned: trimmed.length,
    requests: trimmed.map(requestSummary),
  };
}

/**
 * Full detail (headers, bodies, timing) for one captured request.
 */
async function getRequest(args) {
  const { id } = args || {};
  if (!id) throw new Error('id is required');

  const { session } = await discoverServer();
  const log = (session.logs || []).find((l) => l.id === id);
  if (!log) {
    throw new Error(`No captured request found with id "${id}". Use list_requests to find valid ids.`);
  }

  return {
    id: log.id,
    method: (log.method || 'GET').toUpperCase(),
    url: log.url,
    status: log.status,
    statusText: log.statusText || null,
    error: log.error || null,
    requestHeaders: log.requestHeaders || {},
    requestBody: log.requestBody === undefined ? null : log.requestBody,
    responseHeaders: log.responseHeaders || {},
    responseBody: log.responseBody === undefined ? null : log.responseBody,
    startTime: log.startTime,
    endTime: log.endTime,
    duration: typeof log.duration === 'number' ? log.duration : null,
  };
}

/**
 * Every captured hit to a given endpoint (URL + optional method), most
 * recent first, numbered v1..vN in the order they were actually captured.
 */
async function getEndpointHistory(args) {
  const { url, method } = args || {};
  if (!url) throw new Error('url is required');

  const { session } = await discoverServer();
  const versions = matchingVersions(session.logs || [], url, method);

  const entries = versions.map((log, idx) => ({ version: idx + 1, ...requestSummary(log) }));
  entries.reverse(); // most recent first

  return {
    url,
    method: method ? method.toUpperCase() : null,
    versionCount: entries.length,
    versions: entries,
  };
}

/**
 * Structural diff between two captured versions of the same endpoint's
 * response body. versionA/versionB are 1-indexed (matching
 * get_endpoint_history's `version` field); omit either or both to default
 * to the two most recent versions.
 */
async function diffEndpointVersions(args) {
  const { url, method, versionA, versionB } = args || {};
  if (!url) throw new Error('url is required');

  const { session } = await discoverServer();
  const versions = matchingVersions(session.logs || [], url, method);

  if (versions.length < 2) {
    const label = method ? `${method.toUpperCase()} ${url}` : url;
    throw new Error(`Endpoint "${label}" has only ${versions.length} captured version(s) — need at least 2 to diff.`);
  }

  const lastIndex = versions.length - 1;
  const resolvedA = typeof versionA === 'number' ? versionA - 1 : lastIndex - 1;
  const resolvedB = typeof versionB === 'number' ? versionB - 1 : lastIndex;

  const inRange = (i) => i >= 0 && i < versions.length;
  if (!inRange(resolvedA) || !inRange(resolvedB)) {
    throw new Error(`Version out of range — endpoint has ${versions.length} captured version(s) (v1..v${versions.length}).`);
  }
  if (resolvedA === resolvedB) {
    throw new Error(`versionA and versionB both resolve to v${resolvedA + 1} — pick two different versions.`);
  }

  const logA = versions[resolvedA];
  const logB = versions[resolvedB];
  const changes = flattenDiff(logA.responseBody, logB.responseBody, '');

  return {
    url,
    method: method ? method.toUpperCase() : (logB.method || 'GET').toUpperCase(),
    versionA: { version: resolvedA + 1, id: logA.id, timestamp: logA.startTime || logA.receivedAt, status: logA.status },
    versionB: { version: resolvedB + 1, id: logB.id, timestamp: logB.startTime || logB.receivedAt, status: logB.status },
    summary: summarize(changes),
    changes,
  };
}

/**
 * Wipes the current session's captured requests and console logs.
 */
async function clearLogs() {
  await clearServer();
  return { cleared: true };
}

module.exports = { listRequests, getRequest, getEndpointHistory, diffEndpointVersions, clearLogs };
