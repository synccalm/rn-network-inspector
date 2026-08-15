'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/**
 * Serves the prebuilt, dependency-free dashboard bundle. `/assets/*` maps
 * to files on disk; every other path (including `/:sessionId`) serves the
 * SPA shell so the dashboard's own client-side routing/session badge can
 * take over.
 */
function createStaticHandler(rootDir) {
  const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'));

  return function serveStatic(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith('/assets/')) {
      const filePath = path.join(rootDir, pathname);
      const relative = path.relative(rootDir, filePath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  };
}

module.exports = { createStaticHandler };
