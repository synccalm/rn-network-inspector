'use strict';

const crypto = require('crypto');

/**
 * In-memory session store. No persistence, no disk writes — logs live only
 * as long as this server process is running, per the v1.0.0 scope.
 *
 * Tracks two independent streams captured by the SDK: network request/
 * response logs (Network tab) and console.log/warn/error calls (Logs tab).
 */
function createStore() {
  let requestLogs = [];
  let consoleLogs = [];
  const listeners = new Set();

  function emit(event) {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (e) {
        // never let one bad listener break the others
      }
    }
  }

  function withId(partial) {
    return Object.assign(
      {
        id: crypto.randomBytes(6).toString('hex'),
        receivedAt: Date.now(),
      },
      partial
    );
  }

  function addRequestLog(partial) {
    const log = withId(partial);
    requestLogs.push(log);
    emit({ type: 'log', payload: log });
    return log;
  }

  function addConsoleLog(partial) {
    const log = withId(partial);
    consoleLogs.push(log);
    emit({ type: 'console', payload: log });
    return log;
  }

  function clear() {
    requestLogs = [];
    consoleLogs = [];
    emit({ type: 'clear' });
  }

  function getRequestLogs() {
    return requestLogs;
  }

  function getConsoleLogs() {
    return consoleLogs;
  }

  function onEvent(fn) {
    listeners.add(fn);
    return function unsubscribe() {
      listeners.delete(fn);
    };
  }

  return { addRequestLog, addConsoleLog, clear, getRequestLogs, getConsoleLogs, onEvent };
}

module.exports = { createStore };
