#!/usr/bin/env node
'use strict';

const { startServer } = require('../src/server');

function parseArgs(argv) {
  const args = { command: 'start', port: 4040, open: true, help: false };
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
    npx synccalm --help       Show this help message
`);
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
    const { port, sessionId, url } = await startServer({ startPort: args.port, open: args.open });

    console.log('');
    console.log('  ✓ synccalm is running');
    console.log('');
    console.log(`    Dashboard   ${url}`);
    console.log(`    Session     ${sessionId}`);
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
