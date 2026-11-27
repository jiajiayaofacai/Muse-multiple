'use strict';
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// No host option: these synthetic fixtures must never listen on LAN interfaces.
async function createTestServers({ ports = {} } = {}) {
  const chosen = { parent: ports.parent ?? 4317, popup: ports.popup ?? 4318 };
  for (const port of Object.values(chosen)) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
  }
  if (chosen.parent !== 0 && chosen.parent === chosen.popup) throw new TypeError('Ports must differ');
  const files = {};
  for (const name of ['parent.html', 'popup.html', 'fixture.js']) {
    files[name] = await readFile(path.join(__dirname, name));
  }
  const origins = {};
  const servers = {};
  let closing;
  function close() {
    closing ??= Promise.all(Object.values(servers).map((server) => new Promise((resolve, reject) => {
      server.close((error) => error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve());
      // Includes active sockets, not only idle keep-alive connections.
      server.closeAllConnections();
    }))).then(() => undefined);
    return closing;
  }
  try {
    for (const role of ['parent', 'popup']) {
      const server = http.createServer((req, res) => {
        const headers = {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          'Referrer-Policy': 'no-referrer',
        };
        function reply(status, type, body, extra = {}) {
          res.writeHead(status, { ...headers, 'Content-Type': type, ...extra });
          res.end(req.method === 'HEAD' ? undefined : body);
        }
        if (!['GET', 'HEAD'].includes(req.method)) {
          reply(405, 'text/plain; charset=utf-8', 'Method not allowed', { Allow: 'GET, HEAD' });
          return;
        }
        // Exact allowlist. Never resolve request paths against the filesystem or Host header.
        const route = req.url.split('?')[0];
        if (['/', `/${role}`, `/${role}.html`].includes(route)) {
          reply(200, 'text/html; charset=utf-8', files[`${role}.html`]);
        } else if (route === '/fixture.js') {
          reply(200, 'text/javascript; charset=utf-8', files['fixture.js']);
        } else if (route === '/config.json') {
          reply(200, 'application/json; charset=utf-8', JSON.stringify({ role, origins }));
        } else {
          reply(404, 'text/plain; charset=utf-8', 'Not found');
        }
      });
      servers[role] = server;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(chosen[role], '127.0.0.1', () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      origins[role] = `http://127.0.0.1:${server.address().port}`;
    }
  } catch (error) {
    await close();
    throw error;
  }
  return { origins, servers, close };
}

module.exports = { createTestServers };

if (require.main === module) {
  createTestServers().then((sites) => {
    console.log(`Synthetic parent: ${sites.origins.parent}/parent`);
    console.log(`Synthetic popup:  ${sites.origins.popup}/popup (open via parent button)`);
    console.log('Cross-origin only; not a Muse login or native WebView2 verification. Ctrl+C to stop.');
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => { sites.close().catch(() => { process.exitCode = 1; }); });
    }
  }).catch((error) => {
    console.error(`Synthetic sites failed to start: ${error.code || error.name}`);
    process.exitCode = 1;
  });
}
