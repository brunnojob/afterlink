import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createChatServer } from '../server.js';
import { random, session } from '../public/crypto.js';

async function fixture(t, options) {
  const app = createChatServer(options);
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => {
    for (const ws of app.wss.clients) ws.terminate();
    await new Promise(resolve => app.server.close(resolve));
  });
  async function connect() {
    const ws = new WebSocket(origin.replace('http:', 'ws:') + '/socket', { origin });
    const inbox = [], waiters = [];
    ws.on('message', raw => {
      const message = JSON.parse(raw);
      if (waiters.length) waiters.shift()(message); else inbox.push(message);
    });
    await once(ws, 'open');
    return { ws, next: () => inbox.length ? Promise.resolve(inbox.shift()) : new Promise(resolve => waiters.push(resolve)), send: value => ws.send(JSON.stringify(value)) };
  }
  return { ...app, connect, origin };
}

test('browser crypto authenticates, separates rooms, rejects tampering and replay', async () => {
  const secret = random(32), room = random(24);
  const alice = await session(secret, room), bob = await session(secret, room);
  const packet = await alice.seal({ kind: 'message', text: 'Olá, mundo <script>' });
  assert.ok(!JSON.stringify(packet).includes('Olá'));
  assert.equal((await bob.open(packet)).text, 'Olá, mundo <script>');
  await assert.rejects(bob.open(packet));
  await assert.rejects((await session(random(32), room)).open(packet));
  await assert.rejects((await session(secret, random(24))).open(packet));
  const corrupt = { ...packet, body: (packet.body[0] === 'A' ? 'B' : 'A') + packet.body.slice(1) };
  await assert.rejects((await session(secret, room)).open(corrupt));
  assert.equal((await alice.open(await bob.seal({ kind: 'hello', name: 'B' })) ).name, 'B');
});

test('relay pairs two browsers, forwards ciphertext, blocks a third, destroys closed rooms', { timeout: 5000 }, async t => {
  const app = await fixture(t);
  const host = await app.connect(); host.send({ type: 'create' });
  const created = await host.next(); assert.equal(created.type, 'created');
  const guest = await app.connect(); guest.send({ type: 'join', room: created.room });
  assert.equal((await host.next()).type, 'paired'); assert.equal((await guest.next()).type, 'paired');
  const third = await app.connect(); third.send({ type: 'join', room: created.room });
  assert.equal((await third.next()).type, 'unavailable');
  const key = random(32), a = await session(key, created.room), b = await session(key, created.room);
  const packet = await a.seal({ kind: 'message', text: 'private hello' }); host.send(packet);
  const forwarded = await guest.next(); assert.deepEqual(forwarded, packet);
  assert.equal((await b.open(forwarded)).text, 'private hello');
  host.ws.close(); assert.equal((await guest.next()).type, 'ended'); assert.equal(app.rooms.size, 0);
  const rejoin = await app.connect(); rejoin.send({ type: 'join', room: created.room });
  assert.equal((await rejoin.next()).type, 'unavailable');
});

test('rooms expire and are removed', { timeout: 5000 }, async t => {
  const app = await fixture(t, { roomLifetime: 60 });
  const host = await app.connect(); host.send({ type: 'create' }); await host.next();
  assert.equal((await host.next()).type, 'ended'); assert.equal(app.rooms.size, 0);
});

test('malformed input closes a session without crashing the server', { timeout: 5000 }, async t => {
  const app = await fixture(t);
  const host = await app.connect(); const closed = once(host.ws, 'close'); host.ws.send('null'); await closed;
  const response = await fetch(app.origin + '/'); assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal((await fetch(app.origin + '/server.js')).status, 404);
});

test('cross-origin WebSocket upgrades are rejected', { timeout: 5000 }, async t => {
  const app = await fixture(t);
  const ws = new WebSocket(app.origin.replace('http:', 'ws:') + '/socket', { origin: 'https://other.example' });
  await once(ws, 'error'); assert.equal(app.rooms.size, 0);
});

test('oversized traffic cannot be relayed', { timeout: 5000 }, async t => {
  const app = await fixture(t);
  const host = await app.connect(); const closed = once(host.ws, 'close');
  host.ws.send('x'.repeat(33000));
  const [code] = await closed; assert.equal(code, 1009);
});
