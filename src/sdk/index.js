'use strict';

/**
 * synccalm — SDK
 *
 * Patches XMLHttpRequest so every network call made by the app (raw XHR,
 * global.fetch — which React Native implements on top of XHR — and any
 * library that ultimately rides on XHR, e.g. axios's default RN adapter) is
 * captured exactly once and streamed to the local `synccalm` server.
 * Also patches the console methods so app logs show up in the Logs tab.
 *
 * This whole module is a no-op outside of __DEV__, and `init()` is safe to
 * call multiple times or on every reload — it patches XHR.prototype and
 * console at most once per process.
 */

// Captured before anything is patched, so the SDK's own diagnostic prints
// (see `logToConsole`) never loop back through the patched console methods
// and get re-reported as app logs.
const rawConsole = {
  log: console.log ? console.log.bind(console) : function () {},
};

let initialized = false;
let socket = null;
let reconnectTimer = null;

var config = {
  host: null,
  port: 4040,
  enabled: true,
  maxBodyLength: 200000,
  logToConsole: false,
  captureConsole: true,
};

function isDev() {
  // eslint-disable-next-line no-undef
  return typeof __DEV__ === 'undefined' || __DEV__ === true;
}

function getDefaultHost() {
  try {
    // Required lazily so this module never hard-crashes outside of RN
    // (e.g. if it's ever imported in a plain Node/Jest environment).
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { Platform } = require('react-native');
    if (Platform && Platform.OS === 'android') {
      // The Android emulator maps the host machine's localhost to 10.0.2.2.
      return '10.0.2.2';
    }
  } catch (e) {
    // Not running inside React Native — fall through to localhost.
  }
  return 'localhost';
}

function safeStringify(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (e) {
    try {
      return String(value);
    } catch (e2) {
      return null;
    }
  }
}

function tryParseJson(text) {
  if (typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  const first = trimmed[0];
  if (first !== '{' && first !== '[' && first !== '"') return text;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return text;
  }
}

function truncate(value) {
  if (typeof value === 'string' && value.length > config.maxBodyLength) {
    return (
      value.slice(0, config.maxBodyLength) +
      `… [truncated, ${value.length - config.maxBodyLength} more chars]`
    );
  }
  return value;
}

function headersStringToObject(headersString) {
  const result = {};
  if (!headersString) return result;
  headersString
    .trim()
    .split(/[\r\n]+/)
    .forEach((line) => {
      if (!line) return;
      const idx = line.indexOf(': ');
      if (idx === -1) return;
      result[line.slice(0, idx)] = line.slice(idx + 2);
    });
  return result;
}

function sendMessage(type, payload) {
  if (config.logToConsole) {
    try {
      if (type === 'log') rawConsole.log('[synccalm]', payload.method, payload.url, payload.status);
      else if (type === 'console') rawConsole.log('[synccalm]', '[' + payload.level + ']', payload.message);
    } catch (e) {}
  }
  if (!socket || socket.readyState !== 1 /* WebSocket.OPEN */) return;
  try {
    socket.send(JSON.stringify({ type: type, payload: payload }));
  } catch (e) {
    // Best-effort only — never let logging break the app.
  }
}

function connect() {
  if (!config.enabled) return;

  const host = config.host || getDefaultHost();
  const wsUrl = `ws://${host}:${config.port}/ws/sdk`;

  try {
    // eslint-disable-next-line no-undef
    socket = new WebSocket(wsUrl);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  socket.onopen = function onOpen() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };
  socket.onclose = function onClose() {
    scheduleReconnect();
  };
  socket.onerror = function onError() {
    // onclose fires right after — reconnect is scheduled there.
  };
}

function scheduleReconnect() {
  if (reconnectTimer || !config.enabled) return;
  reconnectTimer = setTimeout(function reconnect() {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function reportRequest(xhr) {
  const meta = xhr.__synccalm;
  if (!meta || meta.logged) return;
  meta.logged = true;

  const endTime = Date.now();
  const startTime = meta.startTime || endTime;

  let responseBody = null;
  try {
    if (!xhr.responseType || xhr.responseType === 'text') {
      responseBody = truncate(xhr.responseText);
    } else if (xhr.responseType === 'json') {
      responseBody = truncate(safeStringify(xhr.response));
    }
  } catch (e) {
    // Some response types throw when read after an error/abort.
  }

  let responseHeaders = {};
  try {
    responseHeaders = headersStringToObject(xhr.getAllResponseHeaders());
  } catch (e) {}

  sendMessage('log', {
    method: (meta.method || 'GET').toUpperCase(),
    url: meta.url,
    requestHeaders: meta.requestHeaders,
    requestBody: tryParseJson(meta.requestBody),
    status: xhr.status || 0,
    statusText: xhr.statusText || '',
    responseHeaders: responseHeaders,
    responseBody: tryParseJson(responseBody),
    startTime: startTime,
    endTime: endTime,
    duration: endTime - startTime,
    error: xhr.status === 0 ? 'Network request failed' : null,
  });
}

function patchXHR() {
  const XHR = global.XMLHttpRequest;
  if (!XHR || !XHR.prototype || XHR.prototype.__synccalmPatched) return;

  const originalOpen = XHR.prototype.open;
  const originalSend = XHR.prototype.send;
  const originalSetRequestHeader = XHR.prototype.setRequestHeader;

  XHR.prototype.open = function patchedOpen(method, url) {
    this.__synccalm = {
      method: method,
      url: url,
      requestHeaders: {},
      requestBody: null,
      startTime: null,
      logged: false,
    };
    return originalOpen.apply(this, arguments);
  };

  XHR.prototype.setRequestHeader = function patchedSetRequestHeader(header, value) {
    if (this.__synccalm) this.__synccalm.requestHeaders[header] = value;
    return originalSetRequestHeader.apply(this, arguments);
  };

  XHR.prototype.send = function patchedSend(body) {
    const meta = this.__synccalm;
    if (meta) {
      meta.requestBody = truncate(safeStringify(body));
      meta.startTime = Date.now();

      const self = this;
      this.addEventListener('loadend', function onLoadEnd() {
        reportRequest(self);
      });
    }
    return originalSend.apply(this, arguments);
  };

  XHR.prototype.__synccalmPatched = true;
}

const CONSOLE_LEVELS = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * Best-effort JSON-safe serialization of a single console argument.
 * Errors become {name, message, stack}; functions/symbols become a short
 * label; objects/arrays go through the same stringify+truncate path as
 * network bodies, so oversized or circular values degrade gracefully
 * instead of crashing or hanging the app.
 */
function serializeConsoleArg(arg) {
  if (arg === undefined) return undefined;
  if (arg === null) return null;
  const type = typeof arg;
  if (type === 'string') return truncate(arg);
  if (type === 'number' || type === 'boolean') return arg;
  if (type === 'function') return `[Function: ${arg.name || 'anonymous'}]`;
  if (type === 'symbol') return arg.toString();
  if (arg instanceof Error) {
    return { __type: 'error', name: arg.name, message: arg.message, stack: truncate(arg.stack) };
  }
  return tryParseJson(truncate(safeStringify(arg)));
}

function formatConsolePreview(args) {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      try {
        return JSON.stringify(arg);
      } catch (e) {
        return String(arg);
      }
    })
    .join(' ');
}

function patchConsole() {
  if (console.__synccalmPatched) return;

  const originals = {};
  CONSOLE_LEVELS.forEach((level) => {
    const original = console[level];
    if (typeof original !== 'function') return;
    originals[level] = original.bind(console);

    console[level] = function patchedConsoleMethod() {
      const args = Array.prototype.slice.call(arguments);
      try {
        sendMessage('console', {
          level: level,
          message: truncate(formatConsolePreview(args)),
          args: args.map(serializeConsoleArg),
          timestamp: Date.now(),
        });
      } catch (e) {
        // Best-effort only — never let capturing break app logging.
      }
      return originals[level].apply(console, args);
    };
  });

  console.__synccalmPatched = true;
}

function init(options) {
  if (!isDev()) return; // stripped to a no-op in production
  if (initialized) return;
  initialized = true;

  config = Object.assign({}, config, options || {});

  patchXHR();
  if (config.captureConsole) patchConsole();
  connect();
}

const SyncCalm = { init: init };

module.exports = SyncCalm;
module.exports.default = SyncCalm;
