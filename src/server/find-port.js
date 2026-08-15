'use strict';

/**
 * Attempts to bind `server` starting at `startPort`, incrementing on
 * EADDRINUSE up to `maxAttempts` times. Resolves with the port that worked.
 */
function findOpenPort(server, startPort, maxAttempts, host) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let port = startPort;

    function onError(err) {
      if (err.code === 'EADDRINUSE' && attempt < maxAttempts) {
        attempt += 1;
        port += 1;
        setImmediate(tryListen);
      } else {
        server.removeListener('error', onError);
        reject(err);
      }
    }

    function tryListen() {
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    }

    tryListen();
  });
}

module.exports = { findOpenPort };
