'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { createTestServers } = require('./server.cjs');

function request(url, method = 'GET', headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function fixture(t) {
  const sites = await createTestServers({ ports: { parent: 0, popup: 0 } });
  t.after(() => sites.close());
  return sites;
}

async function rebind(port) {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('two distinct HTTP origins bind IPv4 loopback and advertise actual ephemeral ports', async (t) => {
  const sites = await fixture(t);
  assert.notEqual(sites.origins.parent, sites.origins.popup);
  for (const role of ['parent', 'popup']) {
    const address = sites.servers[role].address();
    assert.equal(address.address, '127.0.0.1');
    assert.equal(sites.origins[role], `http://127.0.0.1:${address.port}`);
    const response = await request(`${sites.origins[role]}/config.json`);
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse(response.body), { role, origins: sites.origins });
    assert.match(response.headers['content-type'], /application\/json/);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
  }
});

test('parent/popup HTTP bodies expose storage, real popup and machine-readable probes', async (t) => {
  const sites = await fixture(t);
  for (const role of ['parent', 'popup']) {
    const response = await request(`${sites.origins[role]}/${role}`);
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html; charset=utf-8/);
    assert.match(response.body, new RegExp(`data-testid="${role}-page"`));
    for (const id of ['cookie-value', 'local-value', 'session-value', 'indexeddb-value', 'open-popup', 'message-status', 'popup-list']) {
      assert.ok(response.body.includes(`data-testid="${id}"`), id);
    }
    assert.match(response.body, /cross-origin/);
    assert.match(response.body, /fixture\.js/);
    assert.match(response.headers['cache-control'], /no-store/);
    assert.match(response.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(response.headers['cross-origin-opener-policy'], undefined, 'do not sever the opener under test');
  }
  const script = await request(`${sites.origins.parent}/fixture.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers['content-type'], /javascript/);
  assert.match(script.body, /window\.open\(/);
  assert.match(script.body, /event\.origin/);
  assert.match(script.body, /event\.source/);
  assert.match(script.body, /window\.close\(/);
  // Source-shape assertions only: these do NOT execute browser or native semantics.
});

test('exact routes, methods and HEAD; unknown paths do not fall back to a page', async (t) => {
  const sites = await fixture(t);
  for (const role of ['parent', 'popup']) {
    for (const path of ['/', `/${role}`, `/${role}.html`]) {
      assert.equal((await request(sites.origins[role] + path)).status, 200);
    }
    const other = role === 'parent' ? 'popup' : 'parent';
    for (const path of [`/${other}`, '/missing', '/server.cjs', '/%2e%2e/server.cjs', '/fixture.js/extra']) {
      assert.equal((await request(sites.origins[role] + path)).status, 404);
    }
    const head = await request(`${sites.origins[role]}/`, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    const post = await request(`${sites.origins[role]}/`, 'POST');
    assert.equal(post.status, 405);
    assert.equal(post.headers.allow, 'GET, HEAD');
  }
});

test('query/path/Host script input is never reflected or used as origin configuration', async (t) => {
  const sites = await fixture(t);
  const attack = '<script>alert("not-a-credential")</script>';
  for (const role of ['parent', 'popup']) {
    const baseline = await request(`${sites.origins[role]}/`);
    const query = await request(`${sites.origins[role]}/?account=${encodeURIComponent(attack)}`);
    assert.equal(query.body, baseline.body);
    const missing = await request(`${sites.origins[role]}/${encodeURIComponent(attack)}`);
    assert.equal(missing.status, 404);
    assert.ok(!missing.body.includes(attack));
    const config = await request(`${sites.origins[role]}/config.json`, 'GET', { Host: 'evil.invalid:9999' });
    assert.deepEqual(JSON.parse(config.body), { role, origins: sites.origins });
  }
});

test('close is idempotent, stops active connections and releases both listening ports', async (t) => {
  const sites = await fixture(t);
  const ports = Object.values(sites.servers).map((server) => server.address().port);
  const accepted = new Promise((resolve) => sites.servers.parent.once('connection', resolve));
  const socket = net.createConnection({ host: '127.0.0.1', port: ports[0] });
  socket.on('error', () => {}); // Remote reset is an acceptable result of forced server shutdown.
  t.after(() => socket.destroy());
  const disconnected = new Promise((resolve) => socket.once('close', resolve));
  await accepted;
  socket.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n'); // Incomplete headers keep this connection active.
  await sites.close();
  await disconnected;
  await sites.close();
  for (const server of Object.values(sites.servers)) assert.equal(server.listening, false);
  for (const port of ports) await rebind(port);
  await assert.rejects(request(`${sites.origins.parent}/`), { code: 'ECONNREFUSED' });
});

test('partial bind failure releases the first server', async (t) => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const blockedPort = blocker.address().port;
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const parentPort = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  await assert.rejects(createTestServers({ ports: { parent: parentPort, popup: blockedPort } }), { code: 'EADDRINUSE' });
  await rebind(parentPort);
});

test('port configuration rejects invalid input and identical nonzero origins', async () => {
  for (const ports of [{ parent: -1 }, { popup: 65536 }, { parent: '4317' }, { parent: 1.5 }, { parent: 4317, popup: 4317 }]) {
    await assert.rejects(createTestServers({ ports }), /port/i);
  }
});

test('connector probe starts disconnected and only marks matched callback as synthetic connection', async (t) => {
  const sites = await fixture(t);
  for (const role of ['parent', 'popup']) {
    const response = await request(`${sites.origins[role]}/${role}`);
    assert.match(response.body, /data-testid="connection-status" data-state="not-connected"/);
    assert.match(response.body, /不是普通登录/);
  }
  const script = await request(`${sites.origins.parent}/fixture.js`);
  assert.match(script.body, /state\('connection-status', 'pending'\)/);
  assert.match(script.body, /state\('connection-status', 'connected-synthetic'\)/);
  assert.ok(script.body.indexOf("state('connection-status', 'connected-synthetic')") > script.body.indexOf('event.source !== child.win'));
  // HTTP/source checks only; native callback and close semantics require a separate driver.
});
