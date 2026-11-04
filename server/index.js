// Atomic Blast – online server: místnosti s kódem, autoritativní simulace arény, WebSocket.
'use strict';
const http = require('http');
const { WebSocketServer } = require('ws');
const engine = require('./engine');

const PORT = process.env.PORT || 8787;
const MAX_PLAYERS = 3, ROUNDS_TO_WIN = 3, TICK_MS = 1000 / 30, BETWEEN_ROUNDS_MS = 4000;

const rooms = new Map();           // code → room
const clients = new Map();         // ws → { room, id, name }

function makeCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code; do { code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); } while (rooms.has(code));
  return code;
}
function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg) { const s = JSON.stringify(msg); for (const m of room.members.values()) if (m.ws.readyState === 1) m.ws.send(s); }
function lobbyInfo(room) {
  return { t: 'lobby', code: room.code, host: room.hostId, phase: room.phase, score: room.score, settings: room.settings,
    players: [...room.members.values()].map(m => ({ id: m.id, name: m.name, color: engine.COLORS[m.id] })) };
}

function createRoom() {
  const room = { code: makeCode(), members: new Map(), hostId: null, phase: 'lobby', state: null, score: {}, timer: null, pending: null, lastTick: 0,
    settings: { ...engine.DEFAULT_SETTINGS } };
  rooms.set(room.code, room);
  return room;
}
function joinRoom(ws, room, name) {
  if (room.members.size >= MAX_PLAYERS) return send(ws, { t: 'error', msg: 'Místnost je plná (max. 3 hráči).' });
  if (room.phase !== 'lobby') return send(ws, { t: 'error', msg: 'Hra už běží, počkej na konec zápasu.' });
  let id = 0; while ([...room.members.values()].some(m => m.id === id)) id++;
  const member = { ws, id, name: (name || 'Hráč').slice(0, 12), input: { dx: 0, dy: 0 }, bomb: false };
  room.members.set(ws, member);
  if (room.hostId === null) room.hostId = id;
  clients.set(ws, { room, id, name: member.name });
  send(ws, { t: 'joined', code: room.code, id });
  broadcast(room, lobbyInfo(room));
}
function leaveRoom(ws) {
  const c = clients.get(ws); if (!c) return;
  const room = c.room; room.members.delete(ws); clients.delete(ws);
  if (room.members.size === 0) { stopRoom(room); rooms.delete(room.code); return; }
  if (room.hostId === c.id) room.hostId = [...room.members.values()][0].id;
  if (room.state) { const p = room.state.players.find(p => p.id === c.id); if (p) p.alive = false; }
  broadcast(room, lobbyInfo(room));
  broadcast(room, { t: 'info', msg: c.name + ' odešel.' });
}
function stopRoom(room) { if (room.timer) clearInterval(room.timer); room.timer = null; if (room.pending) clearTimeout(room.pending); room.pending = null; }

function startMatch(room) {
  room.score = {}; for (const m of room.members.values()) room.score[m.id] = 0;
  startRound(room);
}
function startRound(room) {
  room.phase = 'playing';
  const infos = [...room.members.values()].map(m => ({ id: m.id, name: m.name }));
  room.state = engine.createRound(infos, room.settings);
  for (const m of room.members.values()) { m.input = { dx: 0, dy: 0 }; m.bomb = false; }
  broadcast(room, { t: 'round_start', score: room.score, players: infos.map(i => ({ ...i, color: engine.COLORS[i.id] })) });
  room.lastTick = Date.now();
  stopRoom(room);
  room.timer = setInterval(() => tick(room), TICK_MS);
}
function tick(room) {
  const now = Date.now(); const dt = Math.min(0.1, (now - room.lastTick) / 1000); room.lastTick = now;
  const inputs = {};
  for (const m of room.members.values()) { inputs[m.id] = { dx: m.input.dx, dy: m.input.dy, bomb: m.bomb }; m.bomb = false; }
  const result = engine.step(room.state, inputs, dt);
  broadcast(room, { t: 'state', s: engine.snapshot(room.state) });
  if (result) {
    stopRoom(room);
    room.phase = 'between';
    if (result.winner) room.score[result.winner.id] = (room.score[result.winner.id] || 0) + 1;
    const winnerId = Object.keys(room.score).find(id => room.score[id] >= (room.settings.roundsToWin || ROUNDS_TO_WIN));
    const matchOver = winnerId !== undefined;
    broadcast(room, { t: 'round_end', winner: result.winner ? { id: result.winner.id, name: result.winner.name } : null, score: room.score, matchOver,
      champion: matchOver ? { id: +winnerId, name: ([...room.members.values()].find(m => m.id === +winnerId) || {}).name } : null });
    room.pending = setTimeout(() => {
      room.pending = null;
      if (matchOver || room.members.size < 2) { room.phase = 'lobby'; room.state = null; broadcast(room, lobbyInfo(room)); }
      else startRound(room);
    }, BETWEEN_ROUNDS_MS);
  }
}

const fs = require('fs'), path = require('path'), os = require('os');
const GAME_HTML = path.join(__dirname, '..', 'index.html');
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: clients.size })); }
  else if (req.url === '/' || req.url.startsWith('/index.html') || req.url.startsWith('/?')) {
    fs.readFile(GAME_HTML, (err, data) => {
      if (err) { res.writeHead(500); res.end('index.html not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); res.end(data);
    });
  }
  else { res.writeHead(404); res.end(); }
});
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  return out;
}
const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const c = clients.get(ws);
    switch (msg.t) {
      case 'create': { if (c) leaveRoom(ws); joinRoom(ws, createRoom(), msg.name); break; }
      case 'join': { if (c) leaveRoom(ws); const room = rooms.get(String(msg.code || '').toUpperCase().trim());
        if (!room) return send(ws, { t: 'error', msg: 'Místnost s kódem ' + String(msg.code || '').toUpperCase() + ' neexistuje.' });
        joinRoom(ws, room, msg.name); break; }
      case 'start': { if (!c) return; const room = c.room;
        if (room.hostId !== c.id) return send(ws, { t: 'error', msg: 'Hru může spustit jen zakladatel.' });
        if (room.members.size < 2) return send(ws, { t: 'error', msg: 'Potřebujete aspoň 2 hráče.' });
        if (room.phase !== 'lobby') return send(ws, { t: 'error', msg: 'Zápas ještě běží – počkej, až skončí.' });
        startMatch(room); break; }
      case 'settings': { if (!c) return; const room = c.room;
        if (room.hostId !== c.id) return send(ws, { t: 'error', msg: 'Nastavení může měnit jen zakladatel.' });
        if (room.phase !== 'lobby') return;
        room.settings = engine.normalizeSettings({ ...room.settings, ...(msg.settings || {}) });
        broadcast(room, lobbyInfo(room)); break; }
      case 'input': { if (!c) return; const m = c.room.members.get(ws); if (!m) return;
        m.input = { dx: Math.sign(+msg.dx || 0), dy: Math.sign(+msg.dy || 0) }; if (msg.bomb) m.bomb = true; break; }
      case 'leave': { leaveRoom(ws); break; }
      case 'ping': { send(ws, { t: 'pong', ts: msg.ts }); break; }
    }
  });
  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 15000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n💣  ATOMIC BLAST – server po Wi-Fi běží!\n');
  console.log('   Na tomto počítači otevři:   http://localhost:' + PORT);
  const lan = lanAddresses();
  if (lan.length) { console.log('   Ostatní ve stejné Wi-Fi otevřou:'); for (const a of lan) console.log('      http://' + a.address + ':' + PORT + '   (' + a.name + ')'); }
  else console.log('   (Nenašel jsem adresu v lokální síti – jsi připojený k Wi-Fi?)');
  console.log('\n   Ukončit: Ctrl+C\n');
});
