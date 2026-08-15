'use strict';

const { spawn } = require('child_process');

/**
 * Best-effort cross-platform "open URL in default browser", with no
 * external dependency. Failures are silent — the CLI always prints the URL
 * too, so the user can open it by hand if this doesn't work.
 */
function openBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch (e) {
    // ignore — not fatal
  }
}

module.exports = { openBrowser };
