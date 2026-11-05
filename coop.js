// Atomic Blast – Společná výprava (kooperativní kampaň).
// Jeden modul pro prohlížeč (<script>, globál Coop) i Node (require) – používá ho lokální režim
// v index.html i server (server/index.js), aby se pravidla nepsala dvakrát.
// Staví na server/engine.js (pohyb, bomby, oheň, power-upy); sem patří jen to, co je navíc:
// levely a jejich témata, příšery, úkoly, oživování, boss.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./server/engine.js'));
  else root.Coop = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (E) {
'use strict';

const { COLS, ROWS, T, EMPTY, WALL, BRICK, cell } = E;
const NEST = 3;                       // speciální pevné políčko v mřížce (hnízdo příšer)
const INTRO_TIME = 2.6, OUTRO_TIME = 2.8, RESPAWN_TIME = 3, GRACE_TIME = 2;
const START_CELLS = [[1, 1], [2, 1], [1, 2]];

// ---------- Obtížnost ----------
const DIFFICULTIES = {
  easy:   { label: 'LEHKÁ',    lives: 7, speed: 0.85, extra: -1, bossHp: 8,  shootEvery: 3.6 },
  normal: { label: 'NORMÁLNÍ', lives: 5, speed: 1.0,  extra: 0,  bossHp: 12, shootEvery: 3.0 },
  hard:   { label: 'TĚŽKÁ',    lives: 3, speed: 1.2,  extra: 1,  bossHp: 16, shootEvery: 2.4 },
};

// ---------- Příšery ----------
// passBricks = prochází cihlami, chase = pronásleduje nejbližšího hráče, hp = kolik zásahů ohněm vydrží
const MONSTER_TYPES = {
  balloon: { speed: 1.3, color: '#ff9ad5', passBricks: false, chase: false, points: 100, hp: 1 },
  ghost:   { speed: 1.6, color: '#b0c4ff', passBricks: true,  chase: false, points: 200, hp: 1 },
  hunter:  { speed: 2.2, color: '#ff4d4d', passBricks: false, chase: true,  points: 400, hp: 1 },
  shooter: { speed: 0.9, color: '#ffa640', passBricks: false, chase: false, points: 500, hp: 1, shoots: true },
  tank:    { speed: 0.8, color: '#7fbf7f', passBricks: false, chase: true,  points: 800, hp: 3 },
};

// ---------- Levely ----------
// layout: random | cave | rooms | corridors | open ; objective: seznam částí úkolu
const LEVELS = [
  { name: 'LES', sub: 'Zahřívací kolo', theme: { floorA: '#3a8a3a', floorB: '#3f943f', wall: '#5a7a3a', wallLight: '#7aa04a', wallDark: '#3e5a28', brick: '#8a5a2a', brickLine: '#5a3815', bg: '#0b1a0b' },
    layout: 'random', density: 0.7, objective: [{ kind: 'kill' }], monsters: ['balloon', 'balloon', 'balloon'] },
  { name: 'JESKYNĚ', sub: 'Ztracené klíče', theme: { floorA: '#4a4652', floorB: '#504c58', wall: '#2a2830', wallLight: '#3a3842', wallDark: '#1a1820', brick: '#7a5a48', brickLine: '#4a3528', bg: '#0b0b10' },
    layout: 'cave', density: 0.8, objective: [{ kind: 'keys', n: 3 }], monsters: ['balloon', 'balloon', 'ghost', 'ghost'] },
  { name: 'LEDOVÁ PEVNOST', sub: 'Dva spínače', theme: { floorA: '#a8dcf0', floorB: '#b8e6f8', wall: '#4a80b0', wallLight: '#78b0e0', wallDark: '#2a5080', brick: '#d8ecf8', brickLine: '#88b8d8', bg: '#081020' },
    layout: 'rooms', density: 0.55, objective: [{ kind: 'switches' }], monsters: ['ghost', 'ghost', 'hunter', 'shooter'] },
  { name: 'LÁVOVÉ DOLY', sub: 'Hnízdo', theme: { floorA: '#3a1a10', floorB: '#421c12', wall: '#201008', wallLight: '#4a2818', wallDark: '#100804', brick: '#a84020', brickLine: '#ff8030', bg: '#180804' },
    layout: 'corridors', density: 0.6, objective: [{ kind: 'nest' }, { kind: 'kill' }], monsters: ['shooter', 'shooter', 'hunter', 'balloon'] },
  { name: 'HRAD', sub: 'Poslední stráž', theme: { floorA: '#4a3c5a', floorB: '#524462', wall: '#6a6a7a', wallLight: '#8a8a9a', wallDark: '#3a3a48', brick: '#8a7060', brickLine: '#504038', bg: '#0e0a14' },
    layout: 'rooms', density: 0.75, objective: [{ kind: 'keys', n: 2 }, { kind: 'kill' }], monsters: ['tank', 'tank', 'hunter', 'hunter', 'ghost', 'shooter'] },
  { name: 'BOSSOVA KOMNATA', sub: 'Velký Bombus', theme: { floorA: '#2a1a2a', floorB: '#301e30', wall: '#5a2040', wallLight: '#8a3060', wallDark: '#300818', brick: '#6a4a5a', brickLine: '#3a2030', bg: '#100408' },
    layout: 'open', density: 0.3, objective: [{ kind: 'boss' }], monsters: [], boss: true },
];

// ---------- Mapa ----------
function isPillar(x, y) { return x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0); }
function buildGrid(L) {
  const g = E.makeGrid(L.density);
  const wall = (x, y) => { if (!isPillar(x, y)) g[y][x] = WALL; };
  if (L.layout === 'rooms') {         // dvě svislé a jedna vodorovná zeď s průchody → 6 místností
    for (let y = 1; y < ROWS - 1; y++) { if (y !== 3 && y !== 9) { wall(4, y); wall(10, y); } }
    for (let x = 1; x < COLS - 1; x++) { if (x !== 2 && x !== 7 && x !== 12) wall(x, 6); }
  } else if (L.layout === 'corridors') {   // dlouhé chodby s průchody
    for (let x = 1; x < COLS - 1; x++) { if (![3, 7, 11].includes(x)) wall(x, 4); if (![1, 5, 9, 13].includes(x)) wall(x, 8); }
  } else if (L.layout === 'cave') {        // náhodné kamenné bloky
    for (let i = 0; i < 12; i++) { const x = 1 + Math.floor(Math.random() * (COLS - 2)), y = 1 + Math.floor(Math.random() * (ROWS - 2)); if (x + y > 5) wall(x, y); }
  } else if (L.layout === 'open') {        // jen pár cihel, volný prostor pro bosse
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (g[y][x] === BRICK && (x + y) % 3 !== 0) g[y][x] = EMPTY;
  }
  // start vždy volný
  for (const [x, y] of START_CELLS) g[y][x] = EMPTY;
  for (const [x, y] of [[3, 1], [1, 3], [2, 2]]) if (g[y][x] === BRICK) g[y][x] = EMPTY;
  ensureConnected(g);
  return g;
}
// všechno, co není zeď, musí být dosažitelné ze startu (cihly se dají odstřelit) – jinak prorazíme zeď
function ensureConnected(g) {
  for (let guard = 0; guard < 60; guard++) {
    const seen = reach(g, 1, 1, (x, y) => g[y][x] !== WALL);
    const bad = [];
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (g[y][x] !== WALL && !seen.has(x + ',' + y)) bad.push([x, y]);
    if (!bad.length) return;
    // zeď (ne pilíř), která sousedí s dosaženou i nedosaženou buňkou
    let fixed = false;
    outer: for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (g[y][x] !== WALL || isPillar(x, y)) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => g[b] && g[b][a] !== undefined && g[b][a] !== WALL);
      if (nb.some(([a, b]) => seen.has(a + ',' + b)) && nb.some(([a, b]) => !seen.has(a + ',' + b))) { g[y][x] = EMPTY; fixed = true; break outer; }
    }
    if (!fixed) { const [x, y] = bad[0]; g[y][x] = WALL; }   // osamělá díra bez souseda → zazdít
  }
}
function reach(g, sx, sy, pass) {
  const seen = new Set([sx + ',' + sy]); const q = [[sx, sy]];
  while (q.length) { const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen.has(k) || !pass(nx, ny)) continue; seen.add(k); q.push([nx, ny]); } }
  return seen;
}
function farCells(g, pred, minDist) {
  const out = []; for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (x + y >= (minDist || 8) && pred(x, y)) out.push([x, y]);
  return out;
}
function pickRandom(arr) { return arr.splice(Math.floor(Math.random() * arr.length), 1)[0]; }

// ---------- Vytvoření levelu ----------
// playerInfos: [{id, name}], opts: {difficulty, friendlyFire}, carry: {lives, score, players:{id→stats}} z minulého levelu
function createLevel(levelIndex, playerInfos, opts, carry) {
  const L = LEVELS[levelIndex]; const diff = DIFFICULTIES[(opts && opts.difficulty) || 'normal'] || DIFFICULTIES.normal;
  const s = {
    coop: true, level: levelIndex, levelCount: LEVELS.length, name: L.name, sub: L.sub, theme: L.theme, opts: { difficulty: (opts && opts.difficulty) || 'normal', friendlyFire: !!(opts && opts.friendlyFire) },
    grid: buildGrid(L), bombs: [], fires: [], powerups: [], players: [], monsters: [], projectiles: [], events: [],
    lives: carry && carry.lives != null ? carry.lives : diff.lives, score: carry && carry.score || 0, maxLives: diff.lives,
    intro: INTRO_TIME, outro: 0, done: null, time: 0, dropRate: 0.5, diff,
    keys: [], switches: [], nest: null, portal: null, boss: null,
  };
  // hráči – startují spolu v rohu; statistiky (bomby, plamen…) se přenášejí z minulého levelu
  playerInfos.forEach((info, i) => {
    const [sx, sy] = START_CELLS[i % START_CELLS.length];
    const p = E.makePlayer(info, sx, sy, 1, 2);
    const old = carry && carry.players && carry.players[info.id];
    if (old) { p.maxBombs = old.maxBombs; p.fire = old.fire; p.speed = old.speed; p.kick = old.kick; }
    p.respawn = 0; p.grace = GRACE_TIME; p.deaths = 0; p.left = false;
    s.players.push(p);
  });
  const g = s.grid;
  const taken = new Set(START_CELLS.map(([x, y]) => x + ',' + y));
  const free = (x, y) => !taken.has(x + ',' + y);
  // portál (vždy viditelný, otevře se po splnění úkolu) – ne v bossově komnatě
  if (!L.boss) {
    const cands = farCells(g, (x, y) => g[y][x] !== WALL && free(x, y), 14);
    const [px, py] = cands.length ? pickRandom(cands) : [COLS - 2, ROWS - 2];
    g[py][px] = EMPTY; s.portal = { cx: px, cy: py, open: false }; taken.add(px + ',' + py);
  }
  for (const part of L.objective) {
    if (part.kind === 'keys') {
      const bricks = farCells(g, (x, y) => g[y][x] === BRICK && free(x, y), 7);
      for (let i = 0; i < part.n && bricks.length; i++) { const [x, y] = pickRandom(bricks); s.keys.push({ cx: x, cy: y, revealed: false, taken: false }); taken.add(x + ',' + y); }
    }
    if (part.kind === 'switches') {
      // dva spínače daleko od sebe (každý v jiné části mapy)
      const a = farCells(g, (x, y) => g[y][x] !== WALL && free(x, y) && x >= COLS - 5 && y <= 4, 6);
      const b = farCells(g, (x, y) => g[y][x] !== WALL && free(x, y) && x <= 4 && y >= ROWS - 5, 6);
      for (const list of [a, b]) { const [x, y] = list.length ? pickRandom(list) : pickRandom(farCells(g, (x, y) => g[y][x] !== WALL && free(x, y), 8));
        g[y][x] = EMPTY; s.switches.push({ cx: x, cy: y, on: false }); taken.add(x + ',' + y); }
    }
    if (part.kind === 'nest') {
      const cands = farCells(g, (x, y) => !isPillar(x, y) && free(x, y) && Math.abs(x - 7) <= 2 && Math.abs(y - 6) <= 2, 8);
      const [x, y] = cands.length ? pickRandom(cands) : [7, 5];
      g[y][x] = NEST; s.nest = { cx: x, cy: y, hp: 3, maxHp: 3, spawnT: 4, hitCd: 0 }; taken.add(x + ',' + y);
    }
  }
  ensureConnected(g);
  // příšery
  let roster = L.monsters.slice();
  if (diff.extra < 0 && roster.length > 1) roster.pop();
  if (diff.extra > 0 && roster.length) roster.push(roster[roster.length - 1]);
  const empties = farCells(g, (x, y) => g[y][x] === EMPTY && free(x, y), 9);
  for (const type of roster) {
    if (!empties.length) break;
    const [x, y] = pickRandom(empties);
    s.monsters.push(makeMonster(type, x, y, diff.speed * (1 + levelIndex * 0.05)));
  }
  if (L.boss) {
    const [bx, by] = [COLS - 3, ROWS - 3];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isPillar(bx + dx, by + dy)) g[by + dy][bx + dx] = EMPTY;
    s.boss = { cx: bx, cy: by, x: bx * T + T / 2, y: by * T + T / 2, dir: [0, 1], anim: 0, hp: diff.bossHp, maxHp: diff.bossHp, hitCd: 0, spawnT: 6, shootT: 4, think: 0, path: null, speed: 1.1 * diff.speed, enraged: false, alive: true };
  }
  // háčky pro engine.explode
  s.onBrick = (x, y) => { const k = s.keys.find(k => k.cx === x && k.cy === y); if (k) { k.revealed = true; s.events.push('reveal'); return true; } return false; };
  s.onSpecial = (x, y) => { if (s.nest && s.nest.cx === x && s.nest.cy === y && s.nest.hitCd <= 0) { s.nest.hp--; s.nest.hitCd = 0.6; s.events.push('bosshit');
    if (s.nest.hp <= 0) { g[y][x] = EMPTY; s.nest.hp = 0; s.events.push('nestdown'); s.score += 1500; } } };
  return s;
}
function makeMonster(type, x, y, speedMul) {
  const t = MONSTER_TYPES[type];
  return { type, cx: x, cy: y, x: x * T + T / 2, y: y * T + T / 2, dir: [0, 0], speed: t.speed * speedMul, think: 0, anim: Math.random() * 6, alive: true, hp: t.hp, hitCd: 0, shootT: 2 + Math.random() * 2, path: null, grace: 0 };
}

// ---------- Úkol ----------
function objectiveParts(s) {
  const L = LEVELS[s.level]; const out = [];
  for (const part of L.objective) {
    if (part.kind === 'kill') { const left = s.monsters.filter(m => m.alive).length; out.push({ text: left ? `👾 znič příšery (${left})` : '👾 příšery ✔', done: left === 0 }); }
    if (part.kind === 'keys') { const got = s.keys.filter(k => k.taken).length; out.push({ text: `🔑 klíče ${got}/${s.keys.length}` + (got === s.keys.length ? ' ✔' : ' (pod cihlami)'), done: got === s.keys.length }); }
    if (part.kind === 'switches') { const on = s.switches.filter(w => w.on).length; out.push({ text: s.switchesDone ? '🔘 spínače ✔' : `🔘 stůjte na obou spínačích najednou (${on}/2)`, done: !!s.switchesDone }); }
    if (part.kind === 'nest') { out.push({ text: s.nest && s.nest.hp > 0 ? `🪺 znič hnízdo (${s.nest.hp}/${s.nest.maxHp})` : '🪺 hnízdo ✔', done: !s.nest || s.nest.hp <= 0 }); }
    if (part.kind === 'boss') { out.push({ text: s.boss && s.boss.alive ? `👹 poraz bosse (${s.boss.hp}/${s.boss.maxHp})` : '👹 boss poražen ✔', done: !s.boss || !s.boss.alive }); }
  }
  return out;
}
function objectiveText(s) { return objectiveParts(s).map(p => p.text).join(' · '); }
function objectiveDone(s) { return objectiveParts(s).every(p => p.done); }

// ---------- Příšery, střely, boss ----------
function monsterCanEnter(s, m, x, y) {
  if (y < 0 || y >= ROWS || x < 0 || x >= COLS) return false;
  const v = s.grid[y][x];
  if (v === WALL || v >= NEST) return false;
  if (v === BRICK && !MONSTER_TYPES[m.type].passBricks) return false;
  if (E.bombAt(s, x, y)) return false;
  return true;
}
function nearestPlayer(s, x, y) {
  let best = null, bd = Infinity;
  for (const p of s.players) if (p.alive) { const d = Math.abs(p.x - x) + Math.abs(p.y - y); if (d < bd) { bd = d; best = p; } }
  return best;
}
function bfsPath(s, sx, sy, goal, pass) {
  const prev = new Map([[sx + ',' + sy, null]]); const q = [[sx, sy]];
  while (q.length) { const [x, y] = q.shift();
    if (goal(x, y)) { const path = []; let k = x + ',' + y; while (k) { path.unshift(k.split(',').map(Number)); const p = prev.get(k); k = p ? p.join(',') : null; } return path; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || prev.has(k) || !pass(nx, ny)) continue; prev.set(k, [x, y]); q.push([nx, ny]); } }
  return null;
}
function hurtPlayer(s, p) { if (p.alive && p.grace <= 0) E.killPlayer(s, p); }
function stepMonsters(s, dt) {
  for (const m of s.monsters) {
    if (!m.alive) continue;
    m.anim += dt * 6; m.hitCd -= dt; m.grace -= dt;
    const t = MONSTER_TYPES[m.type];
    const gx = m.cx * T + T / 2, gy = m.cy * T + T / 2;
    const atCenter = Math.abs(m.x - gx) < 1.5 && Math.abs(m.y - gy) < 1.5;
    if (atCenter) {
      m.x = gx; m.y = gy;
      let next = null;
      const target = nearestPlayer(s, m.x, m.y);
      if (t.chase && target) {
        m.think -= dt;
        if (m.think <= 0) { m.think = 0.5; const tx = cell(target.x), ty = cell(target.y);
          const path = bfsPath(s, m.cx, m.cy, (x, y) => x === tx && y === ty, (x, y) => monsterCanEnter(s, m, x, y) || (x === tx && y === ty));
          m.path = path && path.length > 1 ? path.slice(1) : null; }
        if (m.path && m.path.length) { const [nx, ny] = m.path[0]; if (monsterCanEnter(s, m, nx, ny)) { next = [nx - m.cx, ny - m.cy]; m.path.shift(); } else m.path = null; }
      }
      if (!next) {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => monsterCanEnter(s, m, m.cx + dx, m.cy + dy));
        const fwd = dirs.find(([dx, dy]) => dx === m.dir[0] && dy === m.dir[1]);
        if (fwd && Math.random() < 0.7) next = fwd; else if (dirs.length) next = dirs[Math.floor(Math.random() * dirs.length)];
      }
      if (t.shoots) {
        // střelec: když je hráč ve stejném řádku/sloupci s volným výhledem, otočí se k němu a vystřelí
        m.shootT -= dt;
        if (target && m.shootT <= 0) { const tx = cell(target.x), ty = cell(target.y);
          if ((tx === m.cx || ty === m.cy) && lineClear(s, m.cx, m.cy, tx, ty)) {
            const d = [Math.sign(tx - m.cx), Math.sign(ty - m.cy)]; m.dir = d; shoot(s, m.x, m.y, d, 5); m.shootT = s.diff.shootEvery; next = null; m.think = 0.4; }
        }
        if (next && Math.random() < 0.4) next = null;   // střelec je váhavý
      }
      if (next) { m.dir = next; m.cx += next[0]; m.cy += next[1]; }
    } else {
      const step = m.speed * T * dt;
      m.x += Math.sign(gx - m.x) * Math.min(step, Math.abs(gx - m.x));
      m.y += Math.sign(gy - m.y) * Math.min(step, Math.abs(gy - m.y));
    }
    if (m.grace <= 0) for (const p of s.players) if (p.alive && Math.abs(m.x - p.x) < T * 0.6 && Math.abs(m.y - p.y) < T * 0.6) hurtPlayer(s, p);
  }
  // oheň zraňuje příšery
  for (const f of s.fires) for (const m of s.monsters) if (m.alive && m.hitCd <= 0 && cell(m.x) === f.cx && cell(m.y) === f.cy) {
    m.hp--; m.hitCd = 0.6;
    if (m.hp <= 0) { m.alive = false; s.score += MONSTER_TYPES[m.type].points * (s.level + 1); s.events.push('monster'); if (Math.random() < 0.3) E.dropPowerup(s, m.cx, m.cy, true); }
    else s.events.push('bosshit');
  }
}
function lineClear(s, x0, y0, x1, y1) {
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0); let x = x0 + dx, y = y0 + dy;
  while (x !== x1 || y !== y1) { if (s.grid[y][x] !== EMPTY) return false; x += dx; y += dy; if (Math.abs(x - x0) + Math.abs(y - y0) > 8) return false; }
  return true;
}
function shoot(s, x, y, d, cellsPerSec) { s.projectiles.push({ x, y, dx: d[0], dy: d[1], speed: cellsPerSec * T, life: 3 }); s.events.push('shoot'); }
function stepProjectiles(s, dt) {
  for (const pr of s.projectiles) {
    pr.x += pr.dx * pr.speed * dt; pr.y += pr.dy * pr.speed * dt; pr.life -= dt;
    const cx = cell(pr.x), cy = cell(pr.y);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || s.grid[cy][cx] !== EMPTY) pr.life = 0;
    else for (const p of s.players) if (p.alive && Math.abs(p.x - pr.x) < T * 0.4 && Math.abs(p.y - pr.y) < T * 0.4) { hurtPlayer(s, p); pr.life = 0; }
  }
  s.projectiles = s.projectiles.filter(pr => pr.life > 0);
}
function stepNest(s, dt) {
  const n = s.nest; if (!n || n.hp <= 0) return;
  n.hitCd -= dt; n.spawnT -= dt;
  const own = s.monsters.filter(m => m.alive && m.fromNest).length;
  if (n.spawnT <= 0 && own < 3) { n.spawnT = 6;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [n.cx + dx, n.cy + dy]).filter(([x, y]) => s.grid[y] && s.grid[y][x] === EMPTY);
    if (dirs.length) { const [x, y] = dirs[Math.floor(Math.random() * dirs.length)]; const m = makeMonster('balloon', x, y, s.diff.speed); m.fromNest = true; m.grace = 1; s.monsters.push(m); s.events.push('spawn'); } }
}
function stepBoss(s, dt) {
  const b = s.boss; if (!b || !b.alive) return;
  b.anim += dt * 5; b.hitCd -= dt; b.spawnT -= dt; b.shootT -= dt; b.think -= dt;
  const gx = b.cx * T + T / 2, gy = b.cy * T + T / 2;
  const atCenter = Math.abs(b.x - gx) < 1.5 && Math.abs(b.y - gy) < 1.5;
  if (atCenter) {
    b.x = gx; b.y = gy;
    s.grid[b.cy][b.cx] = EMPTY;              // boss buldozeruje cihly
    const target = nearestPlayer(s, b.x, b.y);
    if (b.think <= 0 && target) { b.think = 0.6; const tx = cell(target.x), ty = cell(target.y);
      const path = bfsPath(s, b.cx, b.cy, (x, y) => x === tx && y === ty, (x, y) => s.grid[y][x] !== WALL);
      b.path = path && path.length > 1 ? path.slice(1) : null; }
    let next = null;
    if (b.path && b.path.length) { const [nx, ny] = b.path.shift(); if (s.grid[ny][nx] !== WALL) next = [nx - b.cx, ny - b.cy]; }
    if (!next) { const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => s.grid[b.cy + dy] && s.grid[b.cy + dy][b.cx + dx] !== WALL && s.grid[b.cy + dy][b.cx + dx] !== undefined);
      if (dirs.length) next = dirs[Math.floor(Math.random() * dirs.length)]; }
    if (next) { b.dir = next; b.cx += next[0]; b.cy += next[1]; }
  } else {
    const step = b.speed * T * dt;
    b.x += Math.sign(gx - b.x) * Math.min(step, Math.abs(gx - b.x));
    b.y += Math.sign(gy - b.y) * Math.min(step, Math.abs(gy - b.y));
  }
  // dotyk zabíjí
  for (const p of s.players) if (p.alive && Math.abs(b.x - p.x) < T * 0.8 && Math.abs(b.y - p.y) < T * 0.8) hurtPlayer(s, p);
  // zásah ohněm (jen pokud není chvíli po zásahu)
  if (b.hitCd <= 0) for (const f of s.fires) if (Math.abs(f.cx * T + T / 2 - b.x) < T * 0.9 && Math.abs(f.cy * T + T / 2 - b.y) < T * 0.9) {
    b.hp--; b.hitCd = 0.8; s.events.push('bosshit');
    if (!b.enraged && b.hp <= b.maxHp / 2) { b.enraged = true; b.speed *= 1.5; s.events.push('enrage'); }
    if (b.hp <= 0) { b.hp = 0; b.alive = false; s.score += 5000; s.events.push('bossdown'); for (const m of s.monsters) m.alive = false; s.projectiles = []; }
    break;
  }
  // fáze 1: volá pomocníky; fáze 2 (zuřivost): navíc střílí do čtyř stran
  const helpers = s.monsters.filter(m => m.alive).length;
  if (b.spawnT <= 0 && helpers < (b.enraged ? 5 : 4)) { b.spawnT = b.enraged ? 6 : 8;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [b.cx + dx, b.cy + dy]).filter(([x, y]) => s.grid[y] && s.grid[y][x] === EMPTY);
    for (let i = 0; i < 2 && dirs.length; i++) { const [x, y] = pickRandom(dirs); const m = makeMonster(b.enraged && s.diff === DIFFICULTIES.hard ? 'hunter' : 'balloon', x, y, s.diff.speed); m.grace = 1; s.monsters.push(m); }
    s.events.push('spawn'); }
  if (b.enraged && b.shootT <= 0 && atCenter) { b.shootT = 3.2; for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) shoot(s, b.x, b.y, d, 4); }
}

// ---------- Hráči: oživení, spínače, klíče, portál ----------
function stepTeam(s, dt) {
  for (const p of s.players) {
    if (p.left) continue;
    p.grace -= dt;
    if (!p.alive && p.respawn > 0) { p.respawn -= dt; if (p.respawn <= 0) revive(s, p); }
  }
  // spínače: oba stisknuté najednou → hotovo napořád
  if (s.switches.length) {
    for (const w of s.switches) { const was = w.on; w.on = s.players.some(p => p.alive && cell(p.x) === w.cx && cell(p.y) === w.cy); if (w.on && !was) s.events.push('switch'); }
    if (!s.switchesDone && s.switches.every(w => w.on)) { s.switchesDone = true; s.events.push('portal'); s.score += 1000; }
  }
  for (const p of s.players) if (p.alive) {
    const cx = cell(p.x), cy = cell(p.y);
    const k = s.keys.find(k => k.revealed && !k.taken && k.cx === cx && k.cy === cy);
    if (k) { k.taken = true; s.events.push('key'); s.score += 300; }
  }
  if (s.portal) {
    const open = objectiveDone(s);
    if (open && !s.portal.open) { s.portal.open = true; s.events.push('portal'); }
    if (s.portal.open && s.players.some(p => p.alive && cell(p.x) === s.portal.cx && cell(p.y) === s.portal.cy)) return 'level';
  } else if (s.boss && !s.boss.alive) return 'won';
  return null;
}
function onDeath(s, p) {
  p.deaths++;
  if (s.lives > 0) { s.lives--; p.respawn = RESPAWN_TIME; }
  else p.respawn = 0;   // bez životů zůstává mrtvý do konce levelu
}
function revive(s, p) {
  // vedle živého spoluhráče, jinak na startu
  const mate = s.players.find(q => q.alive && !q.left);
  let spot = null;
  if (mate) { const mx = cell(mate.x), my = cell(mate.y);
    const cands = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [mx + dx, my + dy]).filter(([x, y]) => s.grid[y] && s.grid[y][x] === EMPTY && !E.bombAt(s, x, y) && !s.fires.some(f => f.cx === x && f.cy === y));
    if (cands.length) spot = cands[0]; }
  if (!spot) spot = START_CELLS[s.players.indexOf(p) % START_CELLS.length];
  p.x = spot[0] * T + T / 2; p.y = spot[1] * T + T / 2; p.alive = true; p.grace = GRACE_TIME; p.respawn = 0;
  p.maxBombs = Math.max(1, p.maxBombs - 1); p.fire = Math.max(2, p.fire - 1);
  s.events.push('revive');
}

// ---------- Hlavní krok ----------
// inputs: { [playerId]: {dx, dy, bomb} } → null, nebo { done: 'level' | 'won' | 'lost' } (až po dohrání „outra“)
function step(s, inputs, dt) {
  s.events = [];
  if (s.done) { s.outro -= dt; return s.outro <= 0 ? { done: s.done } : null; }
  if (s.intro > 0) { s.intro -= dt; return null; }
  s.time += dt;
  const aliveBefore = s.players.map(p => p.alive);
  E.stepPlayers(s, inputs, dt);
  E.stepBombs(s, dt);
  E.stepFires(s, dt, (f, p) => p.grace <= 0 && (s.opts.friendlyFire || f.owner === p.id || f.owner == null));
  E.stepPickups(s);
  stepMonsters(s, dt);
  stepProjectiles(s, dt);
  stepNest(s, dt);
  stepBoss(s, dt);
  const result = stepTeam(s, dt);
  s.players.forEach((p, i) => { if (aliveBefore[i] && !p.alive) onDeath(s, p); });
  if (result) { s.done = result; s.outro = OUTRO_TIME; s.score += result === 'level' ? 1000 * (s.level + 1) : 0; s.events.push(result === 'won' ? 'victory' : 'levelup'); return null; }
  const anyoneUp = s.players.some(p => !p.left && (p.alive || p.respawn > 0));
  if (!anyoneUp) { s.done = 'lost'; s.outro = OUTRO_TIME; s.events.push('gameover'); }
  return null;
}
// statistiky k přenesení do dalšího levelu
function carryOf(s) {
  const players = {}; for (const p of s.players) players[p.id] = { maxBombs: p.maxBombs, fire: p.fire, speed: p.speed, kick: p.kick };
  return { lives: s.lives, score: s.score, players };
}

// ---------- Pohled pro vykreslení (stejný tvar lokálně i ze sítě) ----------
function view(s) {
  return {
    level: s.level, levelCount: s.levelCount, name: s.name, sub: s.sub, theme: s.theme, lives: s.lives, maxLives: s.maxLives, score: s.score,
    objective: objectiveText(s), intro: s.intro, outro: s.outro, done: s.done, friendlyFire: s.opts.friendlyFire, time: s.time,
    portal: s.portal, keys: s.keys, switches: s.switches, nest: s.nest && s.nest.hp > 0 ? s.nest : null,
    monsters: s.monsters.filter(m => m.alive), projectiles: s.projectiles,
    boss: s.boss && s.boss.alive ? s.boss : null,
    team: s.players.map(p => ({ id: p.id, respawn: p.respawn, grace: p.grace, left: p.left })),
  };
}
// kompaktní snapshot pro síť: základ z enginu + kooperativní doplněk „c“
function snapshot(s) {
  const base = E.snapshot(s);
  base.t = Math.floor(s.time);
  base.c = {
    lv: s.level, li: s.lives, ml: s.maxLives, sc: s.score, ob: objectiveText(s), in: +s.intro.toFixed(2), ou: +s.outro.toFixed(2), dn: s.done || '', tm: Math.floor(s.time),
    po: s.portal ? [s.portal.cx, s.portal.cy, s.portal.open ? 1 : 0] : null,
    ke: s.keys.map(k => [k.cx, k.cy, k.revealed ? 1 : 0, k.taken ? 1 : 0]),
    sw: s.switches.map(w => [w.cx, w.cy, w.on ? 1 : 0]),
    ne: s.nest && s.nest.hp > 0 ? [s.nest.cx, s.nest.cy, s.nest.hp, s.nest.maxHp] : null,
    m: s.monsters.filter(m => m.alive).map(m => [m.type, Math.round(m.x), Math.round(m.y), m.dir[0], m.dir[1], +m.anim.toFixed(1), m.hp]),
    pr: s.projectiles.map(p => [Math.round(p.x), Math.round(p.y), p.dx, p.dy]),
    bs: s.boss && s.boss.alive ? [Math.round(s.boss.x), Math.round(s.boss.y), s.boss.dir[0], s.boss.dir[1], +s.boss.anim.toFixed(1), s.boss.hp, s.boss.maxHp, s.boss.enraged ? 1 : 0, s.boss.hitCd > 0.5 ? 1 : 0] : null,
    tp: s.players.map(p => [p.id, +p.respawn.toFixed(1), p.grace > 0 ? 1 : 0, p.left ? 1 : 0]),
  };
  return base;
}
function viewFromSnapshot(c) {
  const L = LEVELS[c.lv];
  return {
    level: c.lv, levelCount: LEVELS.length, name: L.name, sub: L.sub, theme: L.theme, lives: c.li, maxLives: c.ml, score: c.sc,
    objective: c.ob, intro: c.in, outro: c.ou, done: c.dn || null, time: c.tm,
    portal: c.po ? { cx: c.po[0], cy: c.po[1], open: !!c.po[2] } : null,
    keys: c.ke.map(k => ({ cx: k[0], cy: k[1], revealed: !!k[2], taken: !!k[3] })),
    switches: c.sw.map(w => ({ cx: w[0], cy: w[1], on: !!w[2] })),
    nest: c.ne ? { cx: c.ne[0], cy: c.ne[1], hp: c.ne[2], maxHp: c.ne[3] } : null,
    monsters: c.m.map(m => ({ type: m[0], x: m[1], y: m[2], dir: [m[3], m[4]], anim: m[5], hp: m[6], alive: true })),
    projectiles: c.pr.map(p => ({ x: p[0], y: p[1], dx: p[2], dy: p[3] })),
    boss: c.bs ? { x: c.bs[0], y: c.bs[1], dir: [c.bs[2], c.bs[3]], anim: c.bs[4], hp: c.bs[5], maxHp: c.bs[6], enraged: !!c.bs[7], hitCd: c.bs[8] ? 1 : 0, alive: true } : null,
    team: c.tp.map(t => ({ id: t[0], respawn: t[1], grace: t[2], left: !!t[3] })),
  };
}

return { LEVELS, DIFFICULTIES, MONSTER_TYPES, NEST, INTRO_TIME, OUTRO_TIME, RESPAWN_TIME, createLevel, step, carryOf, view, snapshot, viewFromSnapshot, objectiveText };
});
