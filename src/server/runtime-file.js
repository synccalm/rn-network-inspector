'use strict';

/**
 * Records the running collector's `{ port, token, sessionId, pid }` in a
 * 0600 file under the OS temp directory, one file per port.
 *
 * This is how local tooling — chiefly the MCP server — keeps working now
 * that reads require a token: a process running as the same user can read
 * the file, while anything reaching the machine over the network cannot.
 *
 * Every operation is best-effort. Bookkeeping must never be the reason the
 * collector fails to start.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.tmpdir(), 'synccalm');

function filePathFor(port) {
  return path.join(DIR, `${port}.json`);
}

function write(state) {
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePathFor(state.port), JSON.stringify(state), { mode: 0o600 });
    return filePathFor(state.port);
  } catch (e) {
    return null;
  }
}

function remove(port) {
  try {
    fs.unlinkSync(filePathFor(port));
  } catch (e) {
    // already gone, or never written
  }
}

function read(port) {
  try {
    const state = JSON.parse(fs.readFileSync(filePathFor(port), 'utf8'));
    return state && typeof state.token === 'string' ? state : null;
  } catch (e) {
    return null;
  }
}

/**
 * Every collector this user has recorded, newest first. Entries whose process
 * is gone are pruned as they're found, so a crashed run doesn't leave a stale
 * file that misdirects discovery forever.
 */
function readAll() {
  let names;
  try {
    names = fs.readdirSync(DIR);
  } catch (e) {
    return [];
  }

  const states = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    let state;
    try {
      state = JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
    } catch (e) {
      continue;
    }
    if (!state || typeof state.port !== 'number' || typeof state.token !== 'string') continue;

    if (typeof state.pid === 'number' && !isAlive(state.pid)) {
      remove(state.port);
      continue;
    }
    states.push(state);
  }
  return states.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

function isAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 tests for existence without signalling
    return true;
  } catch (e) {
    return e.code === 'EPERM'; // exists but owned by someone else
  }
}

module.exports = { write, remove, read, readAll, DIR };
