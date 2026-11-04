// Čistá herní logika arény (bez DOM) – běží na serveru.
// Odpovídá lokální aréně v index.html, ale ve stavovém objektu místo globálů.
'use strict';

const COLS = 15, ROWS = 13, T = 48;
const EMPTY = 0, WALL = 1, BRICK = 2;
const BOMB_TIME = 2.5, FIRE_TIME = 0.5, ROUND_TIME = 120, SUDDEN_DEATH_AT = 30;
const STARTS = [[1, 1], [COLS - 2, ROWS - 2], [COLS - 2, 1], [1, ROWS - 2]];
const COLORS = ['#4fd3ff', '#ff5c7a', '#7cff5c', '#ffd34d'];
const R = T * 0.35;

function makeGrid() {
  const g = [];
  for (let y = 0; y < ROWS; y++) { g.push([]); for (let x = 0; x < COLS; x++) {
    if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) g[y].push(WALL);
    else g[y].push(Math.random() < 0.75 ? BRICK : EMPTY);
  } }
  for (const [cx, cy] of STARTS) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = cx + dx, y = cy + dy; if (g[y] && g[y][x] === BRICK && (dx === 0 || dy === 0)) g[y][x] = EMPTY;
  }
  return g;
}

// Nastavení místnosti (vybírá zakladatel v lobby)
const DEFAULT_SETTINGS = { powerups: 'normal', roundTime: 120, roundsToWin: 3, suddenDeath: true };
const POWERUP_PRESETS = {
  low:    { dropRate: 0.35, startBombs: 1, startFire: 2 },
  normal: { dropRate: 0.65, startBombs: 1, startFire: 2 },
  high:   { dropRate: 0.90, startBombs: 2, startFire: 3 },
};
function normalizeSettings(s) {
  const o = { ...DEFAULT_SETTINGS, ...(s || {}) };
  if (!POWERUP_PRESETS[o.powerups]) o.powerups = 'normal';
  if (![60, 120, 180].includes(+o.roundTime)) o.roundTime = 120; else o.roundTime = +o.roundTime;
  if (![1, 3, 5].includes(+o.roundsToWin)) o.roundsToWin = 3; else o.roundsToWin = +o.roundsToWin;
  o.suddenDeath = !!o.suddenDeath;
  return o;
}

function createRound(playerInfos, settings) {
  // playerInfos: [{id, name}] – id = slot 0..3
  const opts = normalizeSettings(settings);
  const preset = POWERUP_PRESETS[opts.powerups];
  const players = playerInfos.map((info, i) => {
    const [sx, sy] = STARTS[info.id];
    return { id: info.id, name: info.name, x: sx * T + T / 2, y: sy * T + T / 2, color: COLORS[info.id],
      alive: true, maxBombs: preset.startBombs, fire: preset.startFire, speed: 2.6, kick: false, dir: { x: 0, y: 1 }, anim: 0 };
  });
  return { grid: makeGrid(), bombs: [], fires: [], powerups: [], players, roundTimer: opts.roundTime,
    suddenDeath: null, roundOver: false, events: [], opts, dropRate: preset.dropRate };
}

const cell = v => Math.floor(v / T);
function bombAt(s, cx, cy) { return s.bombs.find(b => b.cx === cx && b.cy === cy); }
function solidAt(s, cx, cy, forPlayer) {
  if (cy < 0 || cy >= ROWS || cx < 0 || cx >= COLS) return true;
  if (s.grid[cy][cx] !== EMPTY) return true;
  const b = bombAt(s, cx, cy);
  if (b && !(forPlayer && b.passable.includes(forPlayer.id))) return true;
  return false;
}
function collides(s, x, y, p) {
  const pts = [[x - R, y - R], [x + R, y - R], [x - R, y + R], [x + R, y + R]];
  return pts.some(([px, py]) => solidAt(s, cell(px), cell(py), p));
}
function tryAxis(s, p, mx, my) {
  const nx = p.x + mx, ny = p.y + my;
  if (!collides(s, nx, ny, p)) { p.x = nx; p.y = ny; return; }
  if (mx !== 0) {
    const cy = cell(p.y) * T + T / 2, off = cy - p.y;
    if (Math.abs(off) > 2 && !collides(s, nx, cy, p)) p.y += Math.sign(off) * Math.min(Math.abs(off), Math.abs(mx));
  } else {
    const cx = cell(p.x) * T + T / 2, off = cx - p.x;
    if (Math.abs(off) > 2 && !collides(s, cx, ny, p)) p.x += Math.sign(off) * Math.min(Math.abs(off), Math.abs(my));
  }
}
function movePlayer(s, p, dx, dy, dt) {
  if (!p.alive || (dx === 0 && dy === 0)) return;
  p.dir = { x: dx, y: dy }; p.anim += dt * 10;
  const dist = p.speed * T * dt;
  tryAxis(s, p, dx * dist, 0);
  tryAxis(s, p, 0, dy * dist);
  if (p.kick) {
    const nx = cell(p.x) + dx, ny = cell(p.y) + dy; const b = bombAt(s, nx, ny);
    if (b && !b.moving && Math.abs((dx ? p.x : p.y) - ((dx ? nx : ny) * T + T / 2)) < T * 0.9) { b.moving = { x: dx, y: dy }; s.events.push('kick'); }
  }
}
function placeBomb(s, p) {
  if (!p.alive) return;
  const cx = cell(p.x), cy = cell(p.y);
  if (bombAt(s, cx, cy)) return;
  if (s.bombs.filter(b => b.owner === p.id).length >= p.maxBombs) return;
  // průchozí pro každého, kdo na políčku právě stojí (i soupeř, pod kterého bombu dáváš) – jinak by se zasekl
  const passable = s.players.filter(q => q.alive && Math.abs(q.x - (cx * T + T / 2)) < T / 2 + R && Math.abs(q.y - (cy * T + T / 2)) < T / 2 + R).map(q => q.id);
  if (!passable.includes(p.id)) passable.push(p.id);
  s.bombs.push({ cx, cy, owner: p.id, timer: BOMB_TIME, fire: p.fire, passable, moving: null, mx: cx * T + T / 2, my: cy * T + T / 2 });
  s.events.push('bomb');
}
function dropPowerup(s, x, y) {
  if (Math.random() >= (s.dropRate == null ? 0.65 : s.dropRate)) return;
  const r = Math.random();
  const kind = r < 0.40 ? 'bomb' : r < 0.72 ? 'fire' : r < 0.90 ? 'speed' : 'kick';
  s.powerups.push({ cx: x, cy: y, kind, shield: FIRE_TIME + 0.05 });   // odolný vůči plameni, který ho odkryl
}
function explode(s, b) {
  s.bombs.splice(s.bombs.indexOf(b), 1);
  s.events.push('explosion');
  const add = (cx, cy, kind) => s.fires.push({ cx, cy, timer: FIRE_TIME, kind });
  add(b.cx, b.cy, 'c');
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 1; i <= b.fire; i++) {
      const x = b.cx + dx * i, y = b.cy + dy * i;
      if (x < 0 || y < 0 || x >= COLS || y >= ROWS || s.grid[y][x] === WALL) break;
      if (s.grid[y][x] === BRICK) { s.grid[y][x] = EMPTY; add(x, y, dx ? 'h' : 'v'); dropPowerup(s, x, y); break; }
      add(x, y, dx ? 'h' : 'v');
      const other = bombAt(s, x, y); if (other) other.timer = 0;
    }
  }
}
function killPlayer(s, p) { if (p.alive) { p.alive = false; s.events.push('death'); } }
// Plamen zasáhne, jen když je střed hráče aspoň FIRE_MARGIN px uvnitř políčka (únik „o fous“ projde)
const FIRE_MARGIN = 8;
function fireHits(f, p) {
  return Math.abs(p.x - (f.cx * T + T / 2)) < T / 2 - FIRE_MARGIN && Math.abs(p.y - (f.cy * T + T / 2)) < T / 2 - FIRE_MARGIN;
}
function spiralCells(s) {
  const out = []; let x0 = 1, y0 = 1, x1 = COLS - 2, y1 = ROWS - 2;
  while (x0 <= x1 && y0 <= y1) {
    for (let x = x0; x <= x1; x++) out.push([x, y0]);
    for (let y = y0 + 1; y <= y1; y++) out.push([x1, y]);
    for (let x = x1 - 1; x >= x0; x--) out.push([x, y1]);
    for (let y = y1 - 1; y > y0; y--) out.push([x0, y]);
    x0++; y0++; x1--; y1--;
  }
  return out.filter(([x, y]) => s.grid[y][x] !== WALL);
}

// inputs: { [playerId]: { dx, dy, bomb } }  → vrací null, nebo { winner: player|null } při konci kola
function step(s, inputs, dt) {
  if (s.roundOver) return null;
  s.events = [];
  s.roundTimer -= dt;
  if (s.roundTimer <= SUDDEN_DEATH_AT && (!s.opts || s.opts.suddenDeath)) {
    if (!s.suddenDeath) s.suddenDeath = { cells: spiralCells(s), i: 0, t: 0 };
    s.suddenDeath.t -= dt;
    if (s.suddenDeath.t <= 0 && s.suddenDeath.i < s.suddenDeath.cells.length) {
      const [x, y] = s.suddenDeath.cells[s.suddenDeath.i++]; s.suddenDeath.t = 0.25;
      s.grid[y][x] = WALL; s.powerups = s.powerups.filter(u => !(u.cx === x && u.cy === y));
      const b = bombAt(s, x, y); if (b) s.bombs.splice(s.bombs.indexOf(b), 1);
      for (const p of s.players) if (p.alive && cell(p.x) === x && cell(p.y) === y) killPlayer(s, p);
    }
  }
  for (const p of s.players) {
    const inp = inputs[p.id] || { dx: 0, dy: 0, bomb: false };
    movePlayer(s, p, Math.sign(inp.dx || 0), Math.sign(inp.dy || 0), dt);
    if (inp.bomb) placeBomb(s, p);
  }
  for (const b of [...s.bombs]) {
    b.timer -= dt;
    b.passable = b.passable.filter(id => { const p = s.players.find(q => q.id === id); if (!p) return false;
      return Math.abs(p.x - (b.cx * T + T / 2)) < T / 2 + R + 1 && Math.abs(p.y - (b.cy * T + T / 2)) < T / 2 + R + 1; });
    if (b.moving) {
      const nx = b.cx + b.moving.x, ny = b.cy + b.moving.y;
      const blocked = solidAt(s, nx, ny, null) || s.players.some(p => p.alive && cell(p.x) === nx && cell(p.y) === ny) || s.powerups.some(u => u.cx === nx && u.cy === ny);
      if (blocked) { b.moving = null; b.mx = b.cx * T + T / 2; b.my = b.cy * T + T / 2; }
      else {
        b.mx += b.moving.x * T * 6 * dt; b.my += b.moving.y * T * 6 * dt;
        if (Math.abs(b.mx - (nx * T + T / 2)) < 4 && Math.abs(b.my - (ny * T + T / 2)) < 4) { b.cx = nx; b.cy = ny; b.mx = nx * T + T / 2; b.my = ny * T + T / 2; }
      }
    }
    if (b.timer <= 0 && s.bombs.includes(b)) explode(s, b);
  }
  for (const f of s.fires) f.timer -= dt;
  s.fires = s.fires.filter(f => f.timer > 0);
  for (const u of s.powerups) u.shield = (u.shield || 0) - dt;
  for (const f of s.fires) {
    s.powerups = s.powerups.filter(u => u.shield > 0 || !(u.cx === f.cx && u.cy === f.cy));
    for (const p of s.players) if (p.alive && fireHits(f, p)) killPlayer(s, p);
  }
  for (const p of s.players) if (p.alive) {
    const i = s.powerups.findIndex(u => u.cx === cell(p.x) && u.cy === cell(p.y));
    if (i >= 0) { const u = s.powerups.splice(i, 1)[0]; s.events.push('powerup');
      if (u.kind === 'bomb') p.maxBombs = Math.min(8, p.maxBombs + 1);
      if (u.kind === 'fire') p.fire = Math.min(8, p.fire + 1);
      if (u.kind === 'speed') p.speed = Math.min(5, p.speed + 0.5);
      if (u.kind === 'kick') p.kick = true;
    }
  }
  const alive = s.players.filter(p => p.alive);
  if (alive.length <= 1 || s.roundTimer <= 0) {
    s.roundOver = true;
    return { winner: alive.length === 1 ? alive[0] : null };
  }
  return null;
}

// kompaktní stav pro síť
function snapshot(s) {
  return {
    g: s.grid.map(row => row.join('')).join(''),
    b: s.bombs.map(b => [b.cx, b.cy, Math.round(b.mx), Math.round(b.my), +b.timer.toFixed(2)]),
    f: s.fires.map(f => [f.cx, f.cy, +f.timer.toFixed(2), f.kind]),
    u: s.powerups.map(u => [u.cx, u.cy, u.kind]),
    p: s.players.map(p => ({ id: p.id, name: p.name, x: Math.round(p.x), y: Math.round(p.y), c: p.color, a: p.alive ? 1 : 0,
      dx: p.dir.x, dy: p.dir.y, an: +p.anim.toFixed(2), mb: p.maxBombs, fi: p.fire, sp: p.speed, k: p.kick ? 1 : 0 })),
    t: Math.max(0, Math.ceil(s.roundTimer)),
    e: s.events,
  };
}

module.exports = { COLS, ROWS, T, createRound, step, snapshot, COLORS, STARTS, DEFAULT_SETTINGS, normalizeSettings };
