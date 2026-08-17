'use strict';

/**
 * Access control for the local collector.
 *
 * The capture this server holds is not innocuous — it contains whatever the
 * app sent, which in practice means bearer tokens, session cookies and user
 * PII. Two independent controls guard it:
 *
 *   1. A per-session token, required on every read endpoint. It is minted at
 *      startup, handed to the dashboard through the URL fragment (fragments
 *      are never sent to a server, so it cannot leak via Referer) and written
 *      to a 0600 runtime file so local tooling such as the MCP server can
 *      still find it.
 *
 *   2. An Origin check on the WebSocket handshake. Browsers always attach
 *      Origin and cannot forge it, so comparing it against the request's own
 *      Host is what closes Cross-Site WebSocket Hijacking — a page the
 *      developer merely visits can otherwise open ws://localhost:4040 and
 *      read the entire capture.
 */

const crypto = require('crypto');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);

function generateToken() {
  return crypto.randomBytes(24).toString('hex');
}

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host));
}

/**
 * Constant-time string comparison. Length is compared first and leaks only
 * the token's length, which is fixed and public.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Accepts the token either as `Authorization: Bearer <token>` (dashboard
 * fetches, MCP, curl) or as `?token=<token>`. The query form exists because
 * a browser cannot set headers on a WebSocket handshake.
 */
function extractToken(req, url) {
  const header = req && req.headers && req.headers.authorization;
  if (header && /^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  if (url && url.searchParams) return url.searchParams.get('token');
  return null;
}

/**
 * True when `origin` names the same host:port the request was addressed to.
 *
 * Comparing against the request's own Host header (rather than a list built
 * from the bind address) keeps this correct however the server is reached —
 * localhost, 127.0.0.1, or a LAN IP after an explicit `--host`. An attacker
 * page is served from its own origin, so its Origin never matches.
 */
function isSameOrigin(origin, hostHeader) {
  if (!origin || !hostHeader) return false;
  try {
    return new URL(origin).host === hostHeader;
  } catch (e) {
    return false; // opaque origins ("null") and malformed values are denied
  }
}

module.exports = {
  generateToken,
  isLoopbackHost,
  safeEqual,
  extractToken,
  isSameOrigin,
};
