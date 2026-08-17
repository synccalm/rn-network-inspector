#!/usr/bin/env node
'use strict';

const { startServer } = require('../src/server');
const { isLoopbackHost } = require('../src/server/auth');

function parseArgs(argv) {
  const args = { command: 'start', port: 4040, host: '127.0.0.1', open: true, help: false };
  const rest = argv.slice(2);

  if (rest[0] && !rest[0].startsWith('-')) {
    args.command = rest[0];
    rest.shift();
  }

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--port' || arg === '-p') {
      const value = parseInt(rest[i + 1], 10);
      if (!Number.isNaN(value)) args.port = value;
      i++;
    } else if (arg === '--host') {
      const value = rest[i + 1];
      if (value && !value.startsWith('-')) args.host = value;
      i++;
    } else if (arg === '--no-open') {
      args.open = false;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    }
  }

  return args;
}

function printHelp() {
  console.log(`
  synccalm — local network inspector dashboard for React Native

  Usage
    npx synccalm [start]      Start the local server and open the dashboard
    npx synccalm --port 4050  Start searching for an open port from 4050
    npx synccalm --no-open    Don't auto-open the browser
    npx synccalm --host <ip>  Bind beyond loopback (see below)
    npx synccalm --help       Show this help message

  Network exposure
    The capture holds whatever your app sent — auth headers, cookies, user
    data — so the server binds to 127.0.0.1 and every read requires the
    session token printed at startup.

    Simulators and emulators reach loopback already, so the default works.
    Testing on a physical device needs --host 0.0.0.0, which publishes the
    port to your whole network; prefer 'adb reverse tcp:4040 tcp:4040' or
    an SSH tunnel instead where you can.
`);
}

function warnAboutExposure(host, port) {
  console.log('');
  console.log('  ⚠  Bound to a network interface, not just this machine.');
  console.log(`     Anything that can reach ${host}:${port} can attempt to read the capture,`);
  console.log('     which may include auth headers and user data. The session token is');
  console.log('     still required, so keep the dashboard URL private.');
  console.log('');
  console.log("     Safer for physical devices:  adb reverse tcp:" + port + " tcp:" + port);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  if (args.command !== 'start') {
    console.error(`Unknown command: "${args.command}"`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  try {
    const { port, sessionId, url } = await startServer({
      startPort: args.port,
      host: args.host,
      open: args.open,
    });

    console.log('');
    console.log('  ✓ synccalm is running');
    console.log('');
    console.log(`    Dashboard   ${url}`);
    console.log(`    Session     ${sessionId}`);
    console.log(`    Bound to    ${args.host}${isLoopbackHost(args.host) ? ' (this machine only)' : ''}`);
    console.log('');
    console.log('  The dashboard URL carries the session token needed to read the');
    console.log('  capture — treat it like a password.');

    if (!isLoopbackHost(args.host)) warnAboutExposure(args.host, port);

    console.log('');
    console.log('  In your app entry point (dev only):');
    console.log('');
    console.log("    import SyncCalm from '@synccalm/rn-network-inspector';");
    console.log('    if (__DEV__) {');
    console.log(`      SyncCalm.init({ port: ${port} });`);
    console.log('    }');
    console.log('');
    console.log('  On the Android emulator this connects automatically via 10.0.2.2.');
    console.log("  On a physical device, pass { host: '<your-machine-LAN-IP>' } too.");
    console.log('');
    console.log('  Press Ctrl+C to stop.');
    console.log('');

    process.on('SIGINT', () => {
      console.log('\n  Stopping synccalm…');
      process.exit(0);
    });
  } catch (err) {
    console.error('Failed to start synccalm:', err && err.message ? err.message : err);
    process.exitCode = 1;
  }
}

main();
