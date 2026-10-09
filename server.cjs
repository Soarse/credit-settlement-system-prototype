const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const appId = 'credit-settlement-system-prototype';
const portArg = process.argv.find((arg) => arg.startsWith('--port='));
const port = Number(portArg ? portArg.slice('--port='.length) : (process.env.PORT || 8081));
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('Invalid port. Use --port=8081 or set PORT.');
  process.exit(1);
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};

function writeRuntimeLog(file, message) {
  try {
    fs.appendFileSync(path.join(root, file), `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch (_) {
    // Logging must never prevent the local prototype from starting.
  }
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  if (pathname === '/__health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, app: appId, root, port }));
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== path.join(root, 'index.html')) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 500); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.once('error', (error) => {
  const message = error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use.`
    : (error.stack || String(error));
  console.error(message);
  writeRuntimeLog('server-error.log', message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const message = `Improved retail settlement prototype: http://127.0.0.1:${port}`;
  console.log(message);
  writeRuntimeLog('server.log', message);
});
