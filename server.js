import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/crypto.js', ['crypto.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);

export function createChatServer({ roomLifetime = 3600000, maxConnections = 1000 } = {}) {
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    const headers = {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
    };
    if (req.url === '/healthz') {
      res.writeHead(200, { ...headers, 'Content-Type': 'text/plain' });
      return res.end('ok');
    }
    const asset = assets.get(req.url);
    if (!asset || !['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(404, headers);
      return res.end();
    }
    try {
      const data = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
      res.writeHead(200, { ...headers, 'Content-Type': asset[1] });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      res.writeHead(500, headers);
      res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false });
  server.on('upgrade', (req, socket, head) => {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { socket.destroy(); return; }
    if (req.url !== '/socket' || origin.host !== req.headers.host || !['https:', 'http:'].includes(origin.protocol) || wss.clients.size >= maxConnections) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  const send = (ws, value) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
  };
  function endRoom(id, reason = 'A conversa terminou. Crie um novo convite.') {
    const room = rooms.get(id);
    if (!room) return;
    rooms.delete(id);
    clearTimeout(room.timer);
    for (const peer of room.peers) {
      peer.room = null;
      send(peer, { type: 'ended', reason });
      peer.close(1000, 'Session ended');
    }
    room.peers.clear();
  }
  wss.on('connection', ws => {
    ws.alive = true;
    let count = 0;
    let windowStart = Date.now();
    const joinDeadline = setTimeout(() => ws.close(1008, 'Join timeout'), 10000);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('error', () => {});
    ws.on('message', (raw, binary) => {
      if (Date.now() - windowStart > 10000) { count = 0; windowStart = Date.now(); }
      if (++count > 40 || binary) return ws.close(1008, 'Invalid traffic');
      let data;
      try { data = JSON.parse(raw.toString()); } catch { return ws.close(1008, 'Invalid packet'); }
      if (!data || typeof data !== 'object') return ws.close(1008, 'Invalid packet');
      if (!ws.room && data.type === 'create') {
        const id = randomBytes(24).toString('base64url');
        const room = { peers: new Set([ws]), paired: false, timer: setTimeout(() => endRoom(id, 'O limite de uma hora desta sala terminou.'), roomLifetime) };
        rooms.set(id, room);
        ws.room = id;
        clearTimeout(joinDeadline);
        send(ws, { type: 'created', room: id });
      } else if (!ws.room && data.type === 'join' && typeof data.room === 'string') {
        const room = rooms.get(data.room);
        if (!room || room.paired) {
          send(ws, { type: 'unavailable' });
          return ws.close(1000, 'Unavailable');
        }
        ws.room = data.room;
        clearTimeout(joinDeadline);
        room.peers.add(ws);
        room.paired = true;
        for (const peer of room.peers) send(peer, { type: 'paired' });
      } else if (ws.room && data.type === 'packet') {
        const room = rooms.get(ws.room);
        if (!room?.paired || typeof data.sender !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(data.sender) || typeof data.iv !== 'string' || !/^[A-Za-z0-9_-]{16}$/.test(data.iv) || typeof data.body !== 'string' || !/^[A-Za-z0-9_-]{24,24000}$/.test(data.body)) return ws.close(1008, 'Invalid packet');
        const packet = { type: 'packet', sender: data.sender, iv: data.iv, body: data.body };
        for (const peer of room.peers) {
          if (peer !== ws) {
            if (peer.bufferedAmount > 65536) return endRoom(ws.room);
            send(peer, packet);
          }
        }
      } else ws.close(1008, 'Unexpected packet');
    });
    ws.on('close', () => {
      clearTimeout(joinDeadline);
      if (ws.room) endRoom(ws.room);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 15000);
  server.on('close', () => {
    clearInterval(heartbeat);
    for (const id of rooms.keys()) endRoom(id);
    wss.close();
  });
  return { server, wss, rooms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server, wss } = createChatServer();
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Afterlink is listening.'));
  const stop = () => {
    for (const ws of wss.clients) ws.terminate();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
