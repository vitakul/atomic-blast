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
const NEST = 3;                       // speciální pevná políčka v mřížce (>= 3 zastaví plamen a zavolá s.onSpecial):
const CAGE = 4, TORCH = 5;            // hnízdo příšer · klec se zvířátkem · pochodeň
const INTRO_TIME = 2.6, OUTRO_TIME = 2.8, GRACE_TIME = 2.5, OUTRO_WON = 5.5;   // po poražení bosse se přehraje jeho „rozpad“
// Oživení: nikdo nezůstává mimo hru natrvalo. Čekání roste s každou smrtí v daném levelu
// (5 s, 10 s, 15 s, 20 s, …20 s), v dalším levelu se počítá znovu od začátku.
const RESPAWN_BASE = 5, RESPAWN_STEP = 5, RESPAWN_MAX = 20;
function respawnTime(deaths) { return Math.min(RESPAWN_MAX, RESPAWN_BASE + RESPAWN_STEP * Math.max(0, deaths - 1)); }
// Oživovací power-up ❤: padá jen z cihly/příšery, když někdo čeká na oživení; sebrání živým hráčem vrátí všechny čekající hned
const REVIVE_DROP_BRICK = 0.18, REVIVE_DROP_MONSTER = 0.35;
function someoneWaiting(s) { return s.players.some(p => !p.alive && !p.left && p.respawn > 0); }
function maybeDropRevive(s, x, y, chance) {
  if (!someoneWaiting(s) || s.powerups.some(u => u.kind === 'revive') || Math.random() >= chance) return false;
  s.powerups.push({ cx: x, cy: y, kind: 'revive', shield: E.FIRE_TIME + 0.05 });
  s.events.push('reviveup');
  return true;
}
const START_CELLS = [[1, 1], [2, 1], [1, 2]];

// ---------- Zlaté power-upy (speciální schopnosti) ----------
// Hráč má nejvýš jednu zlatou schopnost (nová nahradí starou). Přetrvá do dalších levelů, ztratí ji jen smrtí
// (štít se navíc spotřebuje, když tě zachrání). Na mapě je vždy nejvýš jeden zlatý power-up.
const GOLD_TYPES = {
  phase:     { icon: '👻', name: 'Průchod cihlami', desc: 'procházíš cihlami (v cihle ale bombu nepoložíš)' },
  shield:    { icon: '🛡️', name: 'Štít', desc: 'jednou tě zachrání před smrtí, pak praskne' },
  remote:    { icon: '📡', name: 'Rozbuška', desc: 'bomby čekají na tebe – když už žádnou nemáš, další stisk je odpálí' },
  fireproof: { icon: '🧯', name: 'Nehořlavost', desc: 'plameny z bomb ti neublíží (ani tvoje vlastní)' },
  magnet:    { icon: '🧲', name: 'Magnet', desc: 'přitahuješ power-upy, klíče i krystaly' },
  pierce:    { icon: '☄️', name: 'Průrazný plamen', desc: 'tvůj oheň proletí přes cihly a rozbije je všechny' },
  bombpass:  { icon: '🦘', name: 'Přeskok bomb', desc: 'chodíš přes bomby, nic tě nezastaví' },
};
const GOLD_KINDS = Object.keys(GOLD_TYPES);
const GOLD_DROP_BRICK = 0.02, GOLD_DROP_MONSTER = 0.05, REMOTE_FUSE = 10, SHIELD_GRACE = 1.5, GOLD_NOTE_TIME = 4.5;
function goldOnMap(s) { return s.powerups.some(u => u.kind === 'gold'); }
function pickGoldKind(s) {
  // raději schopnost, kterou zrovna nikdo nemá
  const held = new Set(s.players.map(p => p.gold).filter(Boolean));
  const fresh = GOLD_KINDS.filter(k => !held.has(k));
  const list = fresh.length ? fresh : GOLD_KINDS;
  return list[Math.floor(Math.random() * list.length)];
}
function dropGold(s, x, y, kind) {
  // zlatý power-up oheň nezničí (shield = nekonečno)
  s.powerups.push({ cx: x, cy: y, kind: 'gold', gold: kind || pickGoldKind(s), shield: Infinity });
  s.events.push('goldup');
}
function maybeDropGold(s, x, y, chance) {
  if (goldOnMap(s) || Math.random() >= chance) return false;
  dropGold(s, x, y); return true;
}

// ---------- Obtížnost ----------
const DIFFICULTIES = {
  // waveEvery/waveCap = jak často a kolik příšer přichází v levelu „vydržte“; torch = jak dlouho hoří pochodeň
  easy:   { label: 'LEHKÁ',    speed: 0.85, extra: -1, shootEvery: 3.6, waveEvery: 6.5, waveCap: 6,  torch: 40, survive: 50 },
  normal: { label: 'NORMÁLNÍ', speed: 1.0,  extra: 0,  shootEvery: 3.0, waveEvery: 5.0, waveCap: 8,  torch: 30, survive: 60 },
  hard:   { label: 'TĚŽKÁ',    speed: 1.2,  extra: 1,  shootEvery: 2.4, waveEvery: 4.0, waveCap: 10, torch: 22, survive: 70 },
};

// ---------- Příšery ----------
// passBricks = prochází cihlami, chase = pronásleduje nejbližšího hráče, hp = kolik zásahů ohněm vydrží
// name/desc = co se ukáže v úvodu levelu, kde se příšera objeví poprvé
const MONSTER_TYPES = {
  balloon:   { speed: 1.3, color: '#ff9ad5', passBricks: false, chase: false, points: 100, hp: 1, name: 'Balónek', desc: 'bloudí sem a tam' },
  ghost:     { speed: 1.6, color: '#b0c4ff', passBricks: true,  chase: false, points: 200, hp: 1, name: 'Duch', desc: 'prochází cihlami' },
  hunter:    { speed: 2.2, color: '#ff4d4d', passBricks: false, chase: true,  points: 400, hp: 1, name: 'Lovec', desc: 'jde po vás' },
  shooter:   { speed: 0.9, color: '#ffa640', passBricks: false, chase: false, points: 500, hp: 1, shoots: 'fire', name: 'Střelec', desc: 'střílí ohnivé koule' },
  tank:      { speed: 0.8, color: '#7fbf7f', passBricks: false, chase: true,  points: 800, hp: 3, name: 'Obrněnec', desc: 'vydrží 3 zásahy' },
  // nové příšery se schopnostmi
  frog:      { speed: 1.4, color: '#5ad65a', passBricks: false, chase: false, points: 300, hp: 1, jumps: true, name: 'Žabák', desc: 'skáče přes cihly i bomby, ve skoku ho oheň nechytí' },
  slime:     { speed: 1.1, color: '#5ee0c0', passBricks: false, chase: false, points: 250, hp: 1, splits: true, name: 'Sliz', desc: 'po zásahu se rozdělí na dva malé' },
  mole:      { speed: 1.3, color: '#b08058', passBricks: false, chase: false, points: 450, hp: 1, burrows: true, name: 'Krtek', desc: 'zahrabe se a vyleze u vás' },
  spider:    { speed: 1.5, color: '#9a7ae0', passBricks: false, chase: false, points: 350, hp: 1, webs: true, name: 'Pavouk', desc: 'tká pavučiny, které zpomalují (oheň je spálí)' },
  snowman:   { speed: 0.8, color: '#eef6ff', passBricks: false, chase: false, points: 500, hp: 2, shoots: 'ice', name: 'Sněhulák', desc: 'koulí zmrazí – kamarád vás rozmrazí dotykem' },
  glutton:   { speed: 1.4, color: '#f0b030', passBricks: false, chase: false, points: 600, hp: 1, eats: true, name: 'Hltoun', desc: 'spolyká bomby; po třetí praskne a vybuchne' },
  chameleon: { speed: 1.5, color: '#c070ff', passBricks: false, chase: false, points: 600, hp: 1, hides: true, name: 'Chameleon', desc: 'zneviditelní se a plíží se k vám' },
  bat:       { speed: 2.0, color: '#8a6ac8', passBricks: true,  chase: false, points: 300, hp: 1, flies: true, name: 'Netopýr', desc: 'létá cik-cak přes cihly i bomby' },
  mummy:     { speed: 0.85, color: '#e8dcb8', passBricks: false, chase: true, points: 700, hp: 2, unravels: true, name: 'Mumie', desc: 'jde po vás; po prvním zásahu se rozmotá a zrychlí' },
  bomber:    { speed: 1.25, color: '#5a5a6a', passBricks: false, chase: false, points: 650, hp: 1, bombs: true, name: 'Bombík', desc: 'pokládá vlastní bomby, když jste blízko' },
};
const WEB_LIFE = 9, WEB_SLOW = 0.45, FREEZE_TIME = 2.2, GLUTTON_POP = 3;

// ---------- Levely ----------
// layout: random | cave | rooms | corridors | open ; objective: seznam částí úkolu
const LEVELS = [
  { name: 'LES', sub: 'Zahřívací kolo', theme: { floorA: '#3a8a3a', floorB: '#3f943f', wall: '#5a7a3a', wallLight: '#7aa04a', wallDark: '#3e5a28', brick: '#8a5a2a', brickLine: '#5a3815', bg: '#0b1a0b' },
    layout: 'random', density: 0.7, objective: [{ kind: 'kill' }], monsters: ['balloon', 'balloon', 'frog', 'slime'],
    tips: [{ icon: '⭐', name: 'Zlatý power-up', desc: 'pod jednou cihlou je vzácná schopnost – vydrží, dokud neumřeš' }] },
  { name: 'JESKYNĚ', sub: 'Ztracené klíče', theme: { floorA: '#4a4652', floorB: '#504c58', wall: '#2a2830', wallLight: '#3a3842', wallDark: '#1a1820', brick: '#7a5a48', brickLine: '#4a3528', bg: '#0b0b10' },
    layout: 'cave', density: 0.8, objective: [{ kind: 'keys', n: 3 }], monsters: ['balloon', 'ghost', 'ghost', 'mole', 'spider'] },
  { name: 'BAŽINA', sub: 'Zajatá zvířátka', theme: { floorA: '#3e4a2c', floorB: '#445030', wall: '#2a5a58', wallLight: '#3a7a76', wallDark: '#1a3a3a', brick: '#6a5a34', brickLine: '#3e3418', bg: '#0a120a' },
    layout: 'pools', density: 0.65, objective: [{ kind: 'rescue', n: 3 }], monsters: ['slime', 'frog', 'ghost', 'spider', 'balloon'],
    tips: [{ icon: '🐰', name: 'Klece', desc: 'odpalte klec bombou a pak se zvířátka dotkněte' }] },
  { name: 'LEDOVÁ PEVNOST', sub: 'Dva spínače', theme: { floorA: '#a8dcf0', floorB: '#b8e6f8', wall: '#4a80b0', wallLight: '#78b0e0', wallDark: '#2a5080', brick: '#d8ecf8', brickLine: '#88b8d8', bg: '#081020' },
    layout: 'rooms', density: 0.55, objective: [{ kind: 'switches' }], monsters: ['ghost', 'hunter', 'shooter', 'snowman', 'snowman'] },
  { name: 'KRYSTALOVÝ DŮL', sub: 'Třpytivé poklady', theme: { floorA: '#2a2438', floorB: '#30293f', wall: '#1a1528', wallLight: '#3a3058', wallDark: '#0e0a18', brick: '#5a4a78', brickLine: '#a080ff', bg: '#07050f' },
    layout: 'mine', density: 0.65, objective: [{ kind: 'gems', n: 10 }], monsters: ['bat', 'bat', 'mole', 'hunter', 'slime'],
    tips: [{ icon: '💎', name: 'Krystaly', desc: 'část leží volně, zbytek je schovaný pod cihlami' }] },
  { name: 'LÁVOVÉ DOLY', sub: 'Hnízdo', theme: { floorA: '#3a1a10', floorB: '#421c12', wall: '#201008', wallLight: '#4a2818', wallDark: '#100804', brick: '#a84020', brickLine: '#ff8030', bg: '#180804' },
    layout: 'corridors', density: 0.6, objective: [{ kind: 'nest' }, { kind: 'kill' }], monsters: ['shooter', 'shooter', 'hunter', 'glutton', 'frog'] },
  { name: 'PYRAMIDA', sub: 'Runy v písku', theme: { floorA: '#d8b878', floorB: '#e0c084', wall: '#a07840', wallLight: '#c09858', wallDark: '#704e28', brick: '#c09050', brickLine: '#8a6a38', bg: '#1a1208' },
    layout: 'ring', density: 0.6, objective: [{ kind: 'runes', n: 4 }], monsters: ['mummy', 'mummy', 'mole', 'shooter', 'frog'],
    tips: [{ icon: '🔢', name: 'Runy', desc: 'šlápněte na ně popořadě 1→2→3→4, špatná runa = znovu od jedničky' }] },
  { name: 'NOČNÍ HŘBITOV', sub: 'Pochodně ve tmě', theme: { floorA: '#2a3040', floorB: '#2e3446', wall: '#5a5e6a', wallLight: '#7a7e8a', wallDark: '#2a2e38', brick: '#3a4a30', brickLine: '#24301e', bg: '#05060c', dark: true },
    layout: 'cave', density: 0.65, objective: [{ kind: 'torches', n: 4 }], monsters: ['ghost', 'ghost', 'bat', 'mummy', 'chameleon', 'spider'],
    tips: [{ icon: '🔥', name: 'Pochodně', desc: 'zapalte je plamenem z bomby – hoří jen chvíli, musí hořet všechny naráz' }] },
  { name: 'HRAD', sub: 'Poslední stráž', theme: { floorA: '#4a3c5a', floorB: '#524462', wall: '#6a6a7a', wallLight: '#8a8a9a', wallDark: '#3a3a48', brick: '#8a7060', brickLine: '#504038', bg: '#0e0a14' },
    layout: 'rooms', density: 0.75, objective: [{ kind: 'keys', n: 2 }, { kind: 'kill' }], monsters: ['tank', 'tank', 'hunter', 'chameleon', 'chameleon', 'spider', 'shooter'] },
  { name: 'TOVÁRNA', sub: 'Vydržte!', theme: { floorA: '#3a3a3e', floorB: '#404044', wall: '#5a5a62', wallLight: '#7a7a84', wallDark: '#2e2e34', brick: '#a86a2a', brickLine: '#6a3e14', bg: '#0c0c0e' },
    layout: 'factory', density: 0.6, objective: [{ kind: 'survive', pool: ['balloon', 'hunter', 'bomber', 'bat', 'slime', 'mummy', 'frog', 'tank'] }], monsters: ['bomber', 'bomber', 'hunter', 'balloon'],
    tips: [{ icon: '⏱', name: 'Vydržte', desc: 'příšery přicházejí pořád nové – přežijte, než se otevře portál' }] },
  { name: 'BOSSOVA KOMNATA', sub: 'Velký Bombus', theme: { floorA: '#2a1a2a', floorB: '#301e30', wall: '#5a2040', wallLight: '#8a3060', wallDark: '#300818', brick: '#6a4a5a', brickLine: '#3a2030', bg: '#100408' },
    layout: 'open', density: 0.3, objective: [{ kind: 'boss' }], monsters: [], boss: true },   // sub a tips doplní vylosovaný boss (BOSS_TYPES)
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
  } else if (L.layout === 'pools') {       // bažina: jezírka ve tvaru křížků
    for (let i = 0; i < 6; i++) { const x = 3 + Math.floor(Math.random() * (COLS - 6)), y = 3 + Math.floor(Math.random() * (ROWS - 6));
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) wall(x + dx, y + dy); }
  } else if (L.layout === 'mine') {        // důl: svislé šachty s průchody v různých výškách
    const gaps = { 4: [2, 7, 11], 7: [1, 5, 9], 10: [3, 7, 11] };
    for (const x of [4, 7, 10]) for (let y = 1; y < ROWS - 1; y++) if (!gaps[x].includes(y) && Math.random() < 0.85) wall(x, y);
  } else if (L.layout === 'ring') {        // pyramida: komnata uprostřed se čtyřmi vchody
    for (let x = 4; x <= 10; x++) for (const y of [3, 9]) if (x !== 7) wall(x, y);
    for (let y = 3; y <= 9; y++) { if (y !== 5) wall(4, y); if (y !== 7) wall(10, y); }   // sudé řádky jsou pilíře – vchody na lichých
  } else if (L.layout === 'factory') {     // továrna: krátké „linky“ (vodorovné zídky) po celé hale
    for (const [x0, y] of [[3, 3], [9, 3], [3, 9], [9, 9], [6, 6]]) for (let x = x0; x < x0 + 3; x++) wall(x, y);
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
// čtvrtiny mapy (0/1 = levá/pravá, horní/dolní) – roh se startem až na konec, ať jsou věci daleko
function quadrantOrder() { const q = [[1, 0], [0, 1], [1, 1]].sort(() => Math.random() - 0.5); q.push([0, 0]); return q; }
function inQuadrant(g, qx, qy, pred) {
  const xs = qx ? [8, COLS - 2] : [1, 6], ys = qy ? [7, ROWS - 2] : [1, 5]; const out = [];
  for (let y = ys[0]; y <= ys[1]; y++) for (let x = xs[0]; x <= xs[1]; x++) if (pred(x, y)) out.push([x, y]);
  return out.length ? pickRandom(out) : null;
}

// ---------- Vytvoření levelu ----------
// playerInfos: [{id, name}], opts: {difficulty, friendlyFire}, carry: {score, deaths, players:{id→stats}} z minulého levelu
function createLevel(levelIndex, playerInfos, opts, carry) {
  const L = LEVELS[levelIndex]; const diff = DIFFICULTIES[(opts && opts.difficulty) || 'normal'] || DIFFICULTIES.normal;
  // boss se losuje hned při startu výpravy (nebo ho vybrali v nastavení) a nese se v carry až do Bossovy komnaty
  const bossType = carry && BOSS_TYPES[carry.bossType] ? carry.bossType : pickBossType(opts && opts.boss);
  const stats = carry && carry.stats ? JSON.parse(JSON.stringify(carry.stats)) : { time: 0, kills: 0, startLevel: levelIndex, players: {}, lastHit: null };
  const s = {
    coop: true, level: levelIndex, levelCount: LEVELS.length, name: L.name, sub: L.sub, theme: L.theme, opts: { difficulty: (opts && opts.difficulty) || 'normal', friendlyFire: !!(opts && opts.friendlyFire) },
    grid: buildGrid(L), bombs: [], fires: [], powerups: [], players: [], monsters: [], projectiles: [], events: [],
    score: carry && carry.score || 0, deaths: carry && carry.deaths || 0,   // deaths = celkem za výpravu (jen statistika)
    intro: INTRO_TIME, outro: 0, done: null, time: 0, dropRate: 0.5, diff,
    keys: [], switches: [], nest: null, portal: null, boss: null, webs: [],
    cages: [], gems: [], runes: [], runeNext: 1, torches: [], survive: null, goldBrick: null, goldNote: null, magnetT: 0,
    bossType, stats, bossSay: null, bossDeath: null, snakeBits: [], poofs: [], tips: L.tips || [],
  };
  if (L.boss) { s.sub = BOSS_TYPES[bossType].name; s.tips = BOSS_TYPES[bossType].tips; }
  // hráči – startují spolu v rohu; statistiky (bomby, plamen…) se přenášejí z minulého levelu
  playerInfos.forEach((info, i) => {
    const [sx, sy] = START_CELLS[i % START_CELLS.length];
    const p = E.makePlayer(info, sx, sy, 1, 2);
    const old = carry && carry.players && carry.players[info.id];
    if (old) { p.maxBombs = old.maxBombs; p.fire = old.fire; p.speed = old.speed; p.kick = old.kick; }
    p.respawn = 0; p.grace = GRACE_TIME; p.deaths = 0; p.left = false; p.frozen = 0;
    p.gold = old && old.gold || null;   // zlatá schopnost přetrvává mezi levely
    s.players.push(p); stat(s, p.id);
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
    if (part.kind === 'rescue') {   // klece se zvířátky, každá v jiné části mapy
      const animals = ['bunny', 'chick', 'hedgehog', 'bunny'];
      for (const [qx, qy] of quadrantOrder().slice(0, part.n)) {
        const c = inQuadrant(g, qx, qy, (x, y) => !isPillar(x, y) && free(x, y) && x + y >= 7);
        if (!c) continue; const [x, y] = c;
        g[y][x] = CAGE; s.cages.push({ cx: x, cy: y, open: false, saved: false, animal: animals[s.cages.length] }); taken.add(x + ',' + y);
      }
    }
    if (part.kind === 'gems') {     // krystaly: víc než polovina volně, zbytek pod cihlami
      const hidden = Math.floor(part.n * 0.4);
      const bricks = farCells(g, (x, y) => g[y][x] === BRICK && free(x, y), 6);
      for (let i = 0; i < hidden && bricks.length; i++) { const [x, y] = pickRandom(bricks); s.gems.push({ cx: x, cy: y, revealed: false, taken: false }); taken.add(x + ',' + y); }
      const open = farCells(g, (x, y) => g[y][x] === EMPTY && free(x, y), 5);
      while (s.gems.length < part.n && open.length) { const [x, y] = pickRandom(open); s.gems.push({ cx: x, cy: y, revealed: true, taken: false }); taken.add(x + ',' + y); }
    }
    if (part.kind === 'runes') {    // runy 1–4 v různých čtvrtinách mapy, čísla zamíchaná
      for (const [qx, qy] of quadrantOrder()) {
        const c = inQuadrant(g, qx, qy, (x, y) => !isPillar(x, y) && free(x, y) && x + y >= 5);
        if (!c) continue; const [x, y] = c;
        g[y][x] = EMPTY; s.runes.push({ cx: x, cy: y, n: 0, lit: false, occ: false }); taken.add(x + ',' + y);
      }
      s.runes.sort(() => Math.random() - 0.5); s.runes.forEach((r, i) => { r.n = i + 1; });
    }
    if (part.kind === 'torches') {  // pochodně ve čtyřech čtvrtinách
      for (const [qx, qy] of quadrantOrder().slice(0, part.n)) {
        const c = inQuadrant(g, qx, qy, (x, y) => !isPillar(x, y) && free(x, y) && x + y >= 6);
        if (!c) continue; const [x, y] = c;
        g[y][x] = TORCH; s.torches.push({ cx: x, cy: y, lit: 0 }); taken.add(x + ',' + y);
      }
    }
    if (part.kind === 'survive') s.survive = { left: diff.survive, total: diff.survive, spawnT: 3, pool: part.pool };
  }
  // zlatý power-up: v každém levelu schovaný pod jednou cihlou (kromě bossovy komnaty)
  if (!L.boss) {
    const bricks = farCells(g, (x, y) => g[y][x] === BRICK && free(x, y), 6);
    if (bricks.length) { const [x, y] = pickRandom(bricks); s.goldBrick = { cx: x, cy: y }; taken.add(x + ',' + y); }
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
    s.monsters.push(makeMonster(type, x, y, diff.speed * (1 + levelIndex * 0.025)));
  }
  s.newcomers = newcomers(levelIndex, roster);
  s.intro += (s.newcomers.length + s.tips.length) * 1.3;   // ať je čas si přečíst, co nové příšery a prvky umí
  if (L.boss) s.boss = createBoss(s, bossType);
  // háčky pro engine.explode
  s.onBrick = (x, y) => { const k = s.keys.find(k => k.cx === x && k.cy === y); if (k) { k.revealed = true; s.events.push('reveal'); return true; }
    const gm = s.gems.find(q => q.cx === x && q.cy === y && !q.revealed); if (gm) { gm.revealed = true; s.events.push('reveal'); return true; }
    if (s.goldBrick && s.goldBrick.cx === x && s.goldBrick.cy === y) { s.goldBrick = null; dropGold(s, x, y); return true; }
    return maybeDropRevive(s, x, y, REVIVE_DROP_BRICK) || maybeDropGold(s, x, y, GOLD_DROP_BRICK); };
  s.onSpecial = (x, y) => {
    if (s.nest && s.nest.cx === x && s.nest.cy === y && s.nest.hitCd <= 0) { s.nest.hp--; s.nest.hitCd = 0.6; s.events.push('bosshit');
      if (s.nest.hp <= 0) { g[y][x] = EMPTY; s.nest.hp = 0; s.events.push('nestdown'); s.score += 1500; } }
    const c = s.cages.find(c => c.cx === x && c.cy === y && !c.open);
    if (c) { c.open = true; g[y][x] = EMPTY; s.events.push('cage'); }
    const t = s.torches.find(t => t.cx === x && t.cy === y);
    if (t && !s.torchesDone) { if (t.lit <= 0) s.events.push('torch'); t.lit = s.diff.torch; }
  };
  return s;
}
function makeMonster(type, x, y, speedMul) {
  const t = MONSTER_TYPES[type];
  return { type, cx: x, cy: y, x: x * T + T / 2, y: y * T + T / 2, dir: [0, 0], speed: t.speed * speedMul, think: 0, anim: Math.random() * 6, alive: true, hp: t.hp, hitCd: 0, shootT: 2 + Math.random() * 2, path: null, grace: 0,
    // schopnosti: skok (žabák), zahrabání (krtek), pavučiny, polykání bomb, neviditelnost, malý sliz
    jump: null, z: 0, jumpT: 1.5 + Math.random() * 2, under: false, burrowT: 3 + Math.random() * 2, webT: 1, eaten: 0, hidden: false, hideT: 2 + Math.random() * 2, small: false,
    bombT: 2 + Math.random() * 2, safeT: 0, unraveled: false };
}
// příšery, které se v tomto levelu objeví poprvé (ukážou se v úvodu levelu s popisem schopnosti)
function newcomers(levelIndex, roster) {
  const seen = new Set(); for (let i = 0; i < levelIndex; i++) for (const t of LEVELS[i].monsters) seen.add(t);
  return [...new Set(roster || LEVELS[levelIndex].monsters)].filter(t => !seen.has(t) && MONSTER_TYPES[t].desc);
}

// ---------- Úkol ----------
function objectiveParts(s) {
  const L = LEVELS[s.level]; const out = [];
  for (const part of L.objective) {
    if (part.kind === 'kill') { const left = s.monsters.filter(m => m.alive).length; out.push({ text: left ? `👾 znič příšery (${left})` : '👾 příšery ✔', done: left === 0 }); }
    if (part.kind === 'keys') { const got = s.keys.filter(k => k.taken).length; out.push({ text: `🔑 klíče ${got}/${s.keys.length}` + (got === s.keys.length ? ' ✔' : ' (pod cihlami)'), done: got === s.keys.length }); }
    if (part.kind === 'switches') { const on = s.switches.filter(w => w.on).length; out.push({ text: s.switchesDone ? '🔘 spínače ✔' : `🔘 stůjte na obou spínačích najednou (${on}/2)`, done: !!s.switchesDone }); }
    if (part.kind === 'nest') { out.push({ text: s.nest && s.nest.hp > 0 ? `🪺 znič hnízdo (${s.nest.hp}/${s.nest.maxHp})` : '🪺 hnízdo ✔', done: !s.nest || s.nest.hp <= 0 }); }
    if (part.kind === 'rescue') { const n = s.cages.filter(c => c.saved).length; out.push({ text: `🐰 zachraňte zvířátka ${n}/${s.cages.length}` + (n === s.cages.length ? ' ✔' : ' (odpalte klec, pak se dotkněte)'), done: n === s.cages.length }); }
    if (part.kind === 'gems') { const n = s.gems.filter(q => q.taken).length; out.push({ text: `💎 krystaly ${n}/${s.gems.length}` + (n === s.gems.length ? ' ✔' : ''), done: n === s.gems.length }); }
    if (part.kind === 'runes') { const done = s.runeNext > s.runes.length; out.push({ text: done ? '🔢 runy ✔' : `🔢 šlápněte na runy popořadě 1→${s.runes.length} (další: ${s.runeNext})`, done }); }
    if (part.kind === 'torches') { const lit = s.torches.filter(t => t.lit > 0).length; out.push({ text: s.torchesDone ? '🔥 pochodně ✔' : `🔥 zapalte bombou všechny pochodně naráz (${lit}/${s.torches.length} hoří)`, done: !!s.torchesDone }); }
    if (part.kind === 'survive') { const t = Math.ceil(s.survive ? s.survive.left : 0); out.push({ text: t > 0 ? `⏱ vydržte ještě ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : '⏱ vydrželi jste ✔', done: t <= 0 }); }
    if (part.kind === 'boss') { out.push({ text: bossGoal(s), done: !s.boss || !s.boss.alive }); }
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
  const t = MONSTER_TYPES[m.type];
  if (v === BRICK && !t.passBricks && !m.under) return false;
  if (E.bombAt(s, x, y) && !t.eats && !m.under && !t.flies) return false;   // netopýr přeletí   // hltoun do bomby vleze (a sní ji), krtek ji podleze
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
function hurtPlayer(s, p) { if (p.alive && p.grace <= 0 && !useShield(s, p)) E.killPlayer(s, p); }
// zlatý štít: místo smrti praskne a dá chvilku nesmrtelnosti
function useShield(s, p) {
  if (p.gold !== 'shield') return false;
  p.gold = null; p.grace = SHIELD_GRACE; s.events.push('shield'); return true;
}
function nearestThing(list, m, maxDist) {
  let best = null, bd = maxDist + 1;
  for (const o of list) { const d = Math.abs(o.cx - m.cx) + Math.abs(o.cy - m.cy); if (d < bd) { bd = d; best = o; } }
  return best;
}
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function stepMonsters(s, dt) {
  for (const m of s.monsters.slice()) {
    if (!m.alive) continue;
    m.anim += dt * 6; m.hitCd -= dt; m.grace -= dt; m.jumpT -= dt; m.webT -= dt; m.burrowT -= dt; m.bombT -= dt; m.safeT -= dt;
    const t = MONSTER_TYPES[m.type];
    // žabák ve vzduchu: letí po oblouku na cílové políčko, nic jiného nedělá (ani nezraňuje)
    if (m.jump) {
      const j = m.jump; j.t += dt; const k = Math.min(1, j.t / j.dur);
      m.x = j.x0 + (m.cx * T + T / 2 - j.x0) * k; m.y = j.y0 + (m.cy * T + T / 2 - j.y0) * k; m.z = Math.sin(k * Math.PI) * T * 0.7;
      if (k >= 1) { m.jump = null; m.z = 0; m.jumpT = 1.8 + Math.random() * 2.2; }
      continue;
    }
    // chameleon: střídá viditelnou a neviditelnou fázi; neviditelný se plíží k hráči
    if (t.hides) { m.hideT -= dt; if (m.hideT <= 0) { m.hidden = !m.hidden; m.hideT = m.hidden ? 3.5 : 2.5; s.events.push(m.hidden ? 'hide' : 'unhide'); } }
    const gx = m.cx * T + T / 2, gy = m.cy * T + T / 2;
    const atCenter = Math.abs(m.x - gx) < 1.5 && Math.abs(m.y - gy) < 1.5;
    if (atCenter) {
      m.x = gx; m.y = gy;
      let next = null;
      const target = nearestPlayer(s, m.x, m.y);
      // hltoun: na políčku s bombou ji spolkne (i power-up); po třetí bombě praskne
      if (t.eats) {
        const b = E.bombAt(s, m.cx, m.cy);
        if (b) { s.bombs.splice(s.bombs.indexOf(b), 1); m.eaten++; s.events.push('gulp');
          if (m.eaten >= GLUTTON_POP) { popGlutton(s, m); continue; } }
        const ui = s.powerups.findIndex(u => u.cx === m.cx && u.cy === m.cy && u.kind !== 'gold');
        if (ui >= 0) { s.powerups.splice(ui, 1); s.events.push('gulp'); }
      }
      // krtek: zahrabe se (nezranitelný, prochází cihlami, míří k hráči), po chvíli vyleze na volném políčku
      if (t.burrows) {
        if (!m.under && m.burrowT <= 0) { m.under = true; m.burrowT = 2.6; m.path = null; s.events.push('dig'); }
        else if (m.under && m.burrowT <= 0 && s.grid[m.cy][m.cx] === EMPTY && !E.bombAt(s, m.cx, m.cy)) {
          m.under = false; m.burrowT = 4 + Math.random() * 2; m.grace = 0.6; m.path = null; s.events.push('dig'); }
      }
      // žabák: občas skočí o dvě políčka – přes cihlu, bombu i oheň (ne přes zeď)
      if (t.jumps && m.jumpT <= 0) {
        const opts = DIRS.filter(([dx, dy]) => { const mx = m.cx + dx, my = m.cy + dy, lx = m.cx + 2 * dx, ly = m.cy + 2 * dy;
          return s.grid[my] && s.grid[my][mx] !== undefined && s.grid[my][mx] !== WALL && s.grid[my][mx] < NEST && s.grid[ly] && s.grid[ly][lx] === EMPTY && !E.bombAt(s, lx, ly); });
        if (opts.length) {
          // raději směrem k hráči
          let d = opts[Math.floor(Math.random() * opts.length)];
          if (target && Math.random() < 0.6) { const tx = cell(target.x), ty = cell(target.y);
            d = opts.slice().sort((p, q) => (Math.abs(m.cx + 2 * p[0] - tx) + Math.abs(m.cy + 2 * p[1] - ty)) - (Math.abs(m.cx + 2 * q[0] - tx) + Math.abs(m.cy + 2 * q[1] - ty)))[0]; }
          m.jump = { x0: m.x, y0: m.y, t: 0, dur: 0.55 }; m.dir = d; m.cx += 2 * d[0]; m.cy += 2 * d[1]; m.path = null; s.events.push('jump');
          continue;
        }
        m.jumpT = 0.6;
      }
      // pavouk: za sebou nechává pavučiny
      if (t.webs && m.webT <= 0 && s.grid[m.cy][m.cx] === EMPTY && !s.webs.some(w => w.cx === m.cx && w.cy === m.cy) && !isObjectiveCell(s, m.cx, m.cy) && s.webs.length < 12) {
        s.webs.push({ cx: m.cx, cy: m.cy, life: WEB_LIFE }); m.webT = 1.4 + Math.random();
      }
      // kam jít: hltoun k nejbližší bombě/power-upu, lovci (a neviditelný chameleon, zahrabaný krtek) k hráči
      let goal = null;
      if (t.eats) { const o = nearestThing(s.bombs, m, 5) || nearestThing(s.powerups.filter(u => u.kind !== 'gold'), m, 5); if (o) goal = [o.cx, o.cy]; }
      // bombík: když je hráč blízko, položí bombu (zraní každého) a chvíli je vůči ohni odolný, aby stihl utéct
      if (t.bombs && m.bombT <= 0 && target && Math.abs(cell(target.x) - m.cx) + Math.abs(cell(target.y) - m.cy) <= 3 && s.grid[m.cy][m.cx] === EMPTY && !E.bombAt(s, m.cx, m.cy)) {
        const px = m.cx * T + T / 2, py = m.cy * T + T / 2;
        const passable = s.players.filter(q => q.alive && Math.abs(q.x - px) < T / 2 + E.R && Math.abs(q.y - py) < T / 2 + E.R).map(q => q.id);
        s.bombs.push({ cx: m.cx, cy: m.cy, owner: null, timer: E.BOMB_TIME, fire: 2, passable, moving: null, mx: px, my: py, tagged: true });
        m.bombT = 5 + Math.random() * 2.5; m.safeT = E.BOMB_TIME + E.FIRE_TIME + 0.4; s.events.push('bomb');
      }
      if (!goal && target && (t.chase || (t.hides && m.hidden) || m.under)) goal = [cell(target.x), cell(target.y)];
      if (goal) {
        m.think -= dt; const key = goal.join(',');
        if (m.think <= 0 || m.goalKey !== key) { m.think = 0.5; m.goalKey = key; const [tx, ty] = goal;
          const path = bfsPath(s, m.cx, m.cy, (x, y) => x === tx && y === ty, (x, y) => monsterCanEnter(s, m, x, y) || (x === tx && y === ty));
          m.path = path && path.length > 1 ? path.slice(1) : null; }
        if (m.path && m.path.length) { const [nx, ny] = m.path[0]; if (monsterCanEnter(s, m, nx, ny)) { next = [nx - m.cx, ny - m.cy]; m.path.shift(); } else m.path = null; }
      }
      if (!next) {
        const dirs = DIRS.filter(([dx, dy]) => monsterCanEnter(s, m, m.cx + dx, m.cy + dy));
        const fwd = dirs.find(([dx, dy]) => dx === m.dir[0] && dy === m.dir[1]);
        if (fwd && Math.random() < (t.flies ? 0.3 : 0.7)) next = fwd;   // netopýr kličkuje else if (dirs.length) next = dirs[Math.floor(Math.random() * dirs.length)];
      }
      if (t.shoots && !m.under) {
        // střelec / sněhulák: když je hráč ve stejném řádku/sloupci s volným výhledem, otočí se k němu a vystřelí
        m.shootT -= dt;
        if (target && m.shootT <= 0 && !(t.shoots === 'ice' && target.frozen > 0)) { const tx = cell(target.x), ty = cell(target.y);
          if ((tx === m.cx || ty === m.cy) && lineClear(s, m.cx, m.cy, tx, ty)) {
            const d = [Math.sign(tx - m.cx), Math.sign(ty - m.cy)]; m.dir = d;
            shoot(s, m.x, m.y, d, t.shoots === 'ice' ? 4 : 5, t.shoots); m.shootT = s.diff.shootEvery * (t.shoots === 'ice' ? 1.2 : 1); next = null; m.think = 0.4; }
        }
        if (next && Math.random() < 0.4) next = null;   // střelec je váhavý
      }
      if (next) { m.dir = next; m.cx += next[0]; m.cy += next[1]; }
    } else {
      const step = m.speed * T * dt * (m.under ? 1.3 : 1);
      m.x += Math.sign(gx - m.x) * Math.min(step, Math.abs(gx - m.x));
      m.y += Math.sign(gy - m.y) * Math.min(step, Math.abs(gy - m.y));
    }
    if (m.grace <= 0 && !m.under) for (const p of s.players) if (p.alive && Math.abs(m.x - p.x) < T * 0.6 && Math.abs(m.y - p.y) < T * 0.6) hurtPlayer(s, p);
  }
  // oheň zraňuje příšery (ne zahrabaného krtka a žabáka ve skoku)
  for (const f of s.fires) for (const m of s.monsters.slice()) if (m.alive && !m.under && !m.jump && m.hitCd <= 0 && !(m.safeT > 0) && cell(m.x) === f.cx && cell(m.y) === f.cy) {
    m.hp--; m.hitCd = 0.6;
    if (m.hp <= 0) killMonster(s, m, f.owner);
    else { s.events.push('bosshit');
      if (MONSTER_TYPES[m.type].unravels && !m.unraveled) { m.unraveled = true; m.speed *= 1.7; s.events.push('unravel'); } }   // mumie se rozmotá
  }
}
function killMonster(s, m, owner) {
  const t = MONSTER_TYPES[m.type];
  s.stats.kills++; const st = stat(s, owner); if (st) st.kills++;
  m.alive = false; s.score += Math.round(t.points * (m.small ? 0.5 : 1)) * (s.level + 1); s.events.push('monster');
  if (t.splits && !m.small) {
    // sliz se rozpadne na dva malé, rychlejší, kteří se rozutečou opačnými směry
    const dirs = DIRS.filter(([dx, dy]) => monsterCanEnter(s, m, m.cx + dx, m.cy + dy));
    for (let i = 0; i < 2; i++) {
      const k = makeMonster(m.type, m.cx, m.cy, 1); k.speed = m.speed * 1.45; k.small = true; k.grace = 0.8; k.hitCd = 0.8;
      const d = dirs[i % Math.max(1, dirs.length)]; if (d) { k.dir = d; k.cx += d[0]; k.cy += d[1]; }
      s.monsters.push(k);
    }
    s.events.push('split');
  } else if (!maybeDropRevive(s, m.cx, m.cy, REVIVE_DROP_MONSTER) && !maybeDropGold(s, m.cx, m.cy, GOLD_DROP_MONSTER) && Math.random() < 0.3) E.dropPowerup(s, m.cx, m.cy, true);
}
function popGlutton(s, m) {
  // přejedený hltoun praskne: výbuch o dosahu 2, který zraní každého (je to „ničí“ bomba)
  killMonster(s, m); s.events.push('burp');
  const b = { cx: m.cx, cy: m.cy, owner: null, timer: 0, fire: 2, passable: [], moving: null, mx: m.x, my: m.y };
  s.bombs.push(b); E.explode(s, b);
}
function isObjectiveCell(s, x, y) {
  return (s.portal && s.portal.cx === x && s.portal.cy === y) || s.switches.some(w => w.cx === x && w.cy === y) || s.runes.some(r => r.cx === x && r.cy === y);
}
function stepWebs(s, dt) {
  for (const w of s.webs) { w.life -= dt; if (s.fires.some(f => f.cx === w.cx && f.cy === w.cy)) w.life = 0; }
  s.webs = s.webs.filter(w => w.life > 0);
}
function lineClear(s, x0, y0, x1, y1) {
  const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0); let x = x0 + dx, y = y0 + dy;
  while (x !== x1 || y !== y1) { if (s.grid[y][x] !== EMPTY) return false; x += dx; y += dy; if (Math.abs(x - x0) + Math.abs(y - y0) > 8) return false; }
  return true;
}
function shoot(s, x, y, d, cellsPerSec, kind) { s.projectiles.push({ x, y, dx: d[0], dy: d[1], speed: cellsPerSec * T, life: 3, kind: kind || 'fire' }); s.events.push(kind === 'ice' ? 'snowball' : kind === 'magic' ? 'zap' : 'shoot'); }
function stepProjectiles(s, dt) {
  for (const pr of s.projectiles) {
    pr.x += pr.dx * pr.speed * dt; pr.y += pr.dy * pr.speed * dt; pr.life -= dt;
    const cx = cell(pr.x), cy = cell(pr.y);
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS || s.grid[cy][cx] !== EMPTY) pr.life = 0;
    else for (const p of s.players) if (p.alive && Math.abs(p.x - pr.x) < T * 0.4 && Math.abs(p.y - pr.y) < T * 0.4) {
      if (pr.kind === 'ice') { if (p.grace <= 0 && !(p.frozen > 0)) { p.frozen = FREEZE_TIME; s.events.push('freeze'); } }
      else hurtPlayer(s, p);
      pr.life = 0; }
  }
  s.projectiles = s.projectiles.filter(pr => pr.life > 0);
}
function stepNest(s, dt) {
  const n = s.nest; if (!n || n.hp <= 0) return;
  n.hitCd -= dt; n.spawnT -= dt;
  const own = s.monsters.filter(m => m.alive && m.fromNest).length;
  if (n.spawnT <= 0 && own < 3) { n.spawnT = 6;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [n.cx + dx, n.cy + dy]).filter(([x, y]) => s.grid[y] && s.grid[y][x] === EMPTY);
    if (dirs.length) { const [x, y] = dirs[Math.floor(Math.random() * dirs.length)]; const m = makeMonster(Math.random() < 0.3 ? 'slime' : 'balloon', x, y, s.diff.speed); m.fromNest = true; m.grace = 1; s.monsters.push(m); s.events.push('spawn'); } }
}
// ---------- Bossové ----------
// V Bossově komnatě čeká jeden z pěti bossů (vylosuje se při startu výpravy, nebo ho zvolíte v nastavení).
// Každý má jiný způsob, jak ho porazit, fázi „zuřivost“ při polovině životů a vlastní hlášky.
// Pro kreslení (lokálně i po síti) se boss převádí na jednotný „pohled“: seznam částí {k, x, y, dir, anim, flags, n}.
// flags: 1 právě zasažen · 2 zranitelný · 4 iluze se třpytí · 8 omráčený · 16 nápřah · 32 ležící dvojče · 64 kouzlí · 128 mizí
const BF = { HIT: 1, VULN: 2, SHIMMER: 4, DAZED: 8, WINDUP: 16, DOWN: 32, CAST: 64, FADE: 128 };
const BOSS_TYPES = {
  bombus: { name: 'VELKÝ BOMBUS', short: 'BOMBUS', icon: '👹', hp: { easy: 8, normal: 12, hard: 16 },
    tips: [{ icon: '💣', name: 'Jak na něj', desc: 'zraňuje ho jen oheň z bomb – boří cihly a volá pomocníky' },
           { icon: '😡', name: 'Zuřivost', desc: 'v půlce životů zrychlí a začne střílet do čtyř stran' }],
    say: { start: ['BUM! Tady velím já!', 'Vítejte v mé komnatě, drobečci!'], hit: ['Au! To štípe!', 'Hej! To nebylo fér!', 'Grrr!'],
      enrage: ['TEĎ UŽ JSEM FAKT NAŠTVANÝ!', 'Kluci, pojďte mi pomoct!'], taunt: ['Chyťte mě, jestli to dokážete!', 'Moje bomby jsou větší!'], down: ['To... není... možné...!'] } },
  snake: { name: 'HAD SYČOUN', short: 'HAD', icon: '🐍', hp: { easy: 3, normal: 4, hard: 5 },
    tips: [{ icon: '✂️', name: 'Zkraťte ho', desc: 'oheň ho přesekne – kus těla za zásahem odpadne; had pořád dorůstá' },
           { icon: '🎯', name: 'Hlava', desc: 'hlava je zranitelná, až když má had nejvýš 2 články (zabliká červeně)' },
           { icon: '😡', name: 'Zuřivost', desc: 'v půlce životů zrychlí, roste rychleji a plive oheň' }],
    say: { start: ['Ssssyčím na vás... ssss!', 'Jsssem dlouhý a hladový!'], hit: ['Ssssakra!', 'Moje hlava! Ssss!'],
      enrage: ['TEĎ VÁS SSSSPOLKNU!', 'Ssssvlékám kůži a jdu na vásss!'], taunt: ['Rosssstu a rosssstu...', 'Ssssmyčka se ssstahuje!'], cut: ['Můj ocásssek!', 'To dorossste!'], down: ['Ssssss...sss...s...'] } },
  wizard: { name: 'MÁG ILUZÍN', short: 'MÁG', icon: '🧙', hp: { easy: 4, normal: 6, hard: 8 },
    tips: [{ icon: '🪞', name: 'Iluze', desc: 'vyčaruje své kopie – zranitelný je jen ten pravý, kopie po zásahu prasknou' },
           { icon: '🔮', name: 'Jak poznat pravého', desc: 'jen pravý kouzlí a střílí; kopie se občas zatřpytí' },
           { icon: '😡', name: 'Zuřivost', desc: 'v půlce životů se teleportuje častěji a vyvolá duchy' }],
    say: { start: ['Abraka-BUM! Který z nás je ten pravý?', 'Hokus pokus, už jsem tady... nebo tam?'], hit: ['Jak jste mě poznali?!', 'Au! Moje brada!'],
      poof: ['Cha! Vedle!', 'To byla jen iluze!', 'Netrefíte se!'], enrage: ['DOST HER! Duchové, ke mně!'], taunt: ['Hádejte, hádejte!', 'Kouzla nikdy nekončí!'], down: ['Moje... kouzla... mizí...'] } },
  twins: { name: 'DVOJČATA OHNIVÁK A LEDOVÁK', short: 'DVOJČATA', icon: '👯', hp: { easy: 3, normal: 4, hard: 5 },
    tips: [{ icon: '⏱', name: 'Skoro naráz', desc: 'poražené dvojče se za pár sekund zvedne – musíte porazit oba skoro zároveň' },
           { icon: '🔥', name: 'Ohnivák a Ledovák', desc: 'jeden střílí oheň, druhý mrazí – kamarád vás rozmrazí dotykem' },
           { icon: '😡', name: 'Zuřivost', desc: 'když jim zbývá půlka životů, zrychlí a střílejí častěji' }],
    say: { start: ['My dva jsme nerozluční!', 'Oheň a led – to je náš tým!'], hit: ['Brácho, pomoz!', 'Au! To pálí... nebo mrzne?'],
      down: ['Vstávej, brácho!', 'Ještě chvilku a jsem zpátky!'], up: ['Zase stojím! Hehe!', 'Nás jen tak nedostanete!'],
      enrage: ['TEĎ SE ZLOBÍME OBA!'], taunt: ['Dva jsou víc než jeden!'], end: ['Bráško... prohráli jsme...'] } },
  giant: { name: 'OBR BALVAN', short: 'OBR', icon: '🗿', hp: { easy: 4, normal: 6, hard: 8 },
    tips: [{ icon: '🪨', name: 'Dupání', desc: 'když zvedne nohu, dupne – ze stropu padá kamení (utečte ze stínů)' },
           { icon: '💫', name: 'Omráčený', desc: 'zranitelný je jen chvíli po dupnutí, když se mu točí hvězdičky – jinak má kamennou kůži' },
           { icon: '😡', name: 'Zuřivost', desc: 'v půlce životů dupe častěji a padá víc kamení' }],
    say: { start: ['DUP! DUP! Kdo mi leze do jeskyně?', 'Jsem velký jako hora!'], hit: ['AU! Kdo to byl?!', 'Moje palec!'],
      clank: ['Hahaha, to lechtá!', 'Kamennou kůži neprorazíte!'], stomp: ['DUUUP!', 'Pozor na hlavy!'],
      enrage: ['TEĎ TO TU CELÉ ZBOŘÍM!'], taunt: ['Rozdupu vás na placičku!'], down: ['Já... se... rozsypu...'] } },
};
const BOSS_KINDS = Object.keys(BOSS_TYPES);
function pickBossType(choice) { return BOSS_TYPES[choice] ? choice : BOSS_KINDS[Math.floor(Math.random() * BOSS_KINDS.length)]; }
const SNAKE_VULN = 3;   // hlava + 2 články
const BOSS_SAY_TIME = 2.8;
function bossSay(s, key, force) {
  const b = s.boss; if (!b) return;
  const list = (BOSS_TYPES[b.type].say || {})[key]; if (!list || !list.length) return;
  if (!force && s.bossSay && s.bossSay.t > 1.2) return;   // ať se hlášky nepřekřikují
  s.bossSay = { text: list[Math.floor(Math.random() * list.length)], t: BOSS_SAY_TIME };
}
function bossHp(s, type) { const t = BOSS_TYPES[type]; return t.hp[s.opts.difficulty] || t.hp.normal; }
function fireNear(s, x, y, r) { return s.fires.find(f => Math.abs(f.cx * T + T / 2 - x) < r && Math.abs(f.cy * T + T / 2 - y) < r); }
function fireOnCell(s, cx, cy) { return s.fires.find(f => f.cx === cx && f.cy === cy); }
function touchHurt(s, x, y, r) { for (const p of s.players) if (p.alive && Math.abs(x - p.x) < r && Math.abs(y - p.y) < r) hurtPlayer(s, p); }
function stat(s, id) { if (id == null) return null; return s.stats.players[id] || (s.stats.players[id] = { deaths: 0, kills: 0, golds: [], hits: 0 }); }
// společný zásah bosse s jedním ukazatelem životů
function damageBoss(s, b, owner, x, y) {
  b.hp = Math.max(0, b.hp - 1); b.hitCd = 0.8; s.events.push('bosshit');
  const st = stat(s, owner); if (st) st.hits++;
  if (b.hp <= 0) { defeatBoss(s, b, x, y, owner); return; }
  if (!b.enraged && b.hp <= b.maxHp / 2) enrageBoss(s, b);
  else if (Math.random() < 0.6) bossSay(s, 'hit');
}
function enrageBoss(s, b) {
  b.enraged = true; s.events.push('enrage'); bossSay(s, 'enrage', true);
  if (b.type === 'bombus') b.speed *= 1.5;
  if (b.type === 'snake') b.stepTime *= 0.75;
  if (b.type === 'wizard') spawnHelpers(s, b.cx, b.cy, ['ghost', 'ghost'], 6);
}
function defeatBoss(s, b, x, y, owner) {
  b.hp = 0; b.alive = false; s.score += 5000; s.events.push('bossdown');
  s.stats.lastHit = owner == null ? null : owner;
  s.bossSay = null; bossSay(s, b.type === 'twins' ? 'end' : 'down', true);
  s.bossDeath = { x, y, type: b.type };
  for (const m of s.monsters) m.alive = false; s.projectiles = [];
  if (b.rocks) b.rocks = [];
}
function spawnHelpers(s, cx, cy, kinds, cap) {
  if (s.monsters.filter(m => m.alive).length >= cap) return;
  const dirs = DIRS.map(([dx, dy]) => [cx + dx, cy + dy]).filter(([x, y]) => s.grid[y] && s.grid[y][x] === EMPTY && !E.bombAt(s, x, y));
  for (const kind of kinds) { if (!dirs.length) break; const [x, y] = pickRandom(dirs); const m = makeMonster(kind, x, y, s.diff.speed); m.grace = 1; s.monsters.push(m); }
  s.events.push('spawn');
}
// pohyb po mřížce: pozice x,y se plynule posouvá ke středu políčka cx,cy; choose() vybere další krok
function gridMove(b, dt, speed, choose) {
  const gx = b.cx * T + T / 2, gy = b.cy * T + T / 2;
  if (Math.abs(b.x - gx) < 1.5 && Math.abs(b.y - gy) < 1.5) {
    b.x = gx; b.y = gy;
    const next = choose(); if (next) { b.dir = next; b.cx += next[0]; b.cy += next[1]; }
    return true;
  }
  const step = speed * T * dt;
  b.x += Math.sign(gx - b.x) * Math.min(step, Math.abs(gx - b.x));
  b.y += Math.sign(gy - b.y) * Math.min(step, Math.abs(gy - b.y));
  return false;
}
// krok k nejbližšímu hráči (BFS po políčkách, kudy smí), jinak náhodně
function chaseStep(s, b, pass, think) {
  const target = nearestPlayer(s, b.x, b.y);
  b.think -= think || 0;
  if (target && (b.think <= 0 || !b.path)) { b.think = 0.6; const tx = cell(target.x), ty = cell(target.y);
    const path = bfsPath(s, b.cx, b.cy, (x, y) => x === tx && y === ty, (x, y) => pass(x, y) || (x === tx && y === ty));
    b.path = path && path.length > 1 ? path.slice(1) : null; }
  if (b.path && b.path.length) { const [nx, ny] = b.path[0]; if (pass(nx, ny)) { b.path.shift(); return [nx - b.cx, ny - b.cy]; } b.path = null; }
  const dirs = DIRS.filter(([dx, dy]) => pass(b.cx + dx, b.cy + dy));
  return dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : null;
}
function inLineShot(s, cx, cy, maxDist) {
  // hráč ve stejném řádku/sloupci s volným výhledem → směr výstřelu
  for (const p of s.players) if (p.alive) { const tx = cell(p.x), ty = cell(p.y);
    if ((tx === cx || ty === cy) && !(tx === cx && ty === cy) && Math.abs(tx - cx) + Math.abs(ty - cy) <= (maxDist || 8) && lineClear(s, cx, cy, tx, ty)) return [Math.sign(tx - cx), Math.sign(ty - cy)]; }
  return null;
}
function emptyCellsAwayFromPlayers(s, minDist) {
  const out = [];
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++)
    if (s.grid[y][x] === EMPTY && !E.bombAt(s, x, y) && s.players.every(p => !p.alive || Math.abs(cell(p.x) - x) + Math.abs(cell(p.y) - y) >= minDist)) out.push([x, y]);
  return out;
}

function createBoss(s, type) {
  const hp = bossHp(s, type), g = s.grid, sp = s.diff.speed;
  const clear = (x, y) => { if (g[y] && g[y][x] === BRICK) g[y][x] = EMPTY; };
  const base = { type, hp, maxHp: hp, hitCd: 0, enraged: false, alive: true, anim: 0, think: 0, path: null, dir: [0, 1], tauntT: 10 + Math.random() * 4 };
  if (type === 'snake') {
    // hlava vlevo, tělo se táhne doprava po spodní řadě (lichá řada = žádné pilíře)
    const y = ROWS - 2, segs = [];
    for (let i = 0; i < 8; i++) { const x = 5 + i; clear(x, y); segs.push({ cx: x, cy: y, px: x, py: y, x: x * T + T / 2, y: y * T + T / 2 }); }
    return { ...base, segs, moveT: 0, stepTime: 1 / (2.0 * sp), growT: 3, grow: 0, maxLen: 14, stuck: 0, spitT: 3, clankT: 0, dir: [-1, 0] };
  }
  const bx = COLS - 3, by = ROWS - 3;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isPillar(bx + dx, by + dy)) g[by + dy][bx + dx] = EMPTY;
  const at = (cx, cy) => ({ cx, cy, x: cx * T + T / 2, y: cy * T + T / 2 });
  if (type === 'wizard') {
    const b = { ...base, ...at(bx, by), tpT: 1.0, castT: 0, shootT: 2, wanderT: 0, fade: 0, illusions: [], clankT: 0 };
    return b;
  }
  if (type === 'twins') {
    const twin = (k, cx, cy) => ({ k, ...at(cx, cy), dir: [0, 1], anim: Math.random() * 6, hp, maxHp: hp, down: 0, think: 0, path: null, shootT: 2 + Math.random(), hitCd: 0 });
    const t2 = [COLS - 2, ROWS - 4]; clear(t2[0], t2[1]); clear(COLS - 2, ROWS - 2);
    return { ...base, hp: hp * 2, maxHp: hp * 2, twins: [twin('fire', bx, by), twin('ice', COLS - 2, ROWS - 2)],
      window: { easy: 8, normal: 6, hard: 4.5 }[s.opts.difficulty] || 6 };
  }
  if (type === 'giant') {
    return { ...base, ...at(bx, by), speed: 0.85 * sp, phase: 'walk', phaseT: 0, stompT: 4, rocks: [], clankT: 0,
      daze: { easy: 3.6, normal: 3.1, hard: 2.7 }[s.opts.difficulty] || 3.1 };
  }
  // Velký Bombus
  return { ...base, ...at(bx, by), spawnT: 6, shootT: 4, speed: 1.1 * sp };
}

function stepBoss(s, dt) {
  const b = s.boss; if (!b || !b.alive) return;
  b.anim += dt * 5; b.hitCd -= dt;
  if (s.bossSay) { s.bossSay.t -= dt; if (s.bossSay.t <= 0) s.bossSay = null; }
  if (!b.greeted) { b.greeted = true; bossSay(s, 'start', true); }
  b.tauntT -= dt; if (b.tauntT <= 0) { b.tauntT = 11 + Math.random() * 6; bossSay(s, 'taunt'); }
  ({ bombus: stepBombus, snake: stepSnake, wizard: stepWizard, twins: stepTwins, giant: stepGiant })[b.type](s, b, dt);
}

// --- Velký Bombus: boří cihly, volá pomocníky, v zuřivosti střílí do čtyř stran ---
function stepBombus(s, b, dt) {
  b.spawnT -= dt; b.shootT -= dt; b.think -= dt;
  const atCenter = gridMove(b, dt, b.speed, () => {
    s.grid[b.cy][b.cx] = EMPTY;              // boss buldozeruje cihly
    return chaseStep(s, b, (x, y) => s.grid[y] && s.grid[y][x] !== undefined && s.grid[y][x] !== WALL && s.grid[y][x] < NEST);
  });
  touchHurt(s, b.x, b.y, T * 0.8);
  if (b.hitCd <= 0) { const f = fireNear(s, b.x, b.y, T * 0.9); if (f) damageBoss(s, b, f.owner, b.x, b.y); }
  if (!b.alive) return;
  const helpers = s.monsters.filter(m => m.alive).length;
  if (b.spawnT <= 0 && helpers < (b.enraged ? 5 : 4)) { b.spawnT = b.enraged ? 6 : 8;
    const kinds = [0, 1].map(() => b.enraged ? (s.diff === DIFFICULTIES.hard ? 'hunter' : ['frog', 'slime', 'balloon'][Math.floor(Math.random() * 3)]) : ['balloon', 'balloon', 'frog'][Math.floor(Math.random() * 3)]);
    spawnHelpers(s, b.cx, b.cy, kinds, 99); }
  if (b.enraged && b.shootT <= 0 && atCenter) { b.shootT = 3.2; for (const d of DIRS) shoot(s, b.x, b.y, d, 4); }
}

// --- Had: články se plazí po políčkách; oheň had přesekne, hlava je zranitelná jen u krátkého hada ---
function snakeFree(s, b, x, y) {
  if (!s.grid[y] || s.grid[y][x] !== EMPTY || E.bombAt(s, x, y)) return false;
  // do vlastního těla nesmí (kromě ocasu, který se právě posune – pokud neroste)
  const n = b.segs.length - (b.grow > 0 ? 0 : 1);
  for (let i = 0; i < n; i++) if (b.segs[i].cx === x && b.segs[i].cy === y) return false;
  return true;
}
function stepSnake(s, b, dt) {
  b.clankT -= dt; b.spitT -= dt;
  // růst: přibývá článek na konci ocasu
  b.growT -= dt;
  if (b.growT <= 0) { b.growT = ({ easy: 4.6, normal: 3.6, hard: 2.8 }[s.opts.difficulty] || 3.6) * (b.enraged ? 0.7 : 1);
    if (b.segs.length + b.grow < b.maxLen) { b.grow++; s.events.push('grow'); } }
  b.moveT += dt;
  if (b.moveT >= b.stepTime) {
    b.moveT -= b.stepTime; if (b.moveT > b.stepTime) b.moveT = 0;
    const h = b.segs[0]; const pass = (x, y) => snakeFree(s, b, x, y);
    // hlava míří k nejbližšímu hráči, ale nepůjde zpátky do sebe
    const target = nearestPlayer(s, h.cx * T + T / 2, h.cy * T + T / 2);
    let next = null;
    if (target) { const tx = cell(target.x), ty = cell(target.y);
      const path = bfsPath(s, h.cx, h.cy, (x, y) => x === tx && y === ty, (x, y) => pass(x, y) || (x === tx && y === ty && s.grid[y][x] === EMPTY));
      if (path && path.length > 1 && pass(path[1][0], path[1][1])) next = [path[1][0] - h.cx, path[1][1] - h.cy]; }
    if (!next) { const dirs = DIRS.filter(([dx, dy]) => pass(h.cx + dx, h.cy + dy));
      const fwd = dirs.find(d => d[0] === b.dir[0] && d[1] === b.dir[1]);
      next = fwd && Math.random() < 0.6 ? fwd : dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : null; }
    for (const g of b.segs) { g.px = g.cx; g.py = g.cy; }
    if (next) {
      b.stuck = 0; b.dir = next;
      const tail = b.segs[b.segs.length - 1], old = { cx: tail.cx, cy: tail.cy };
      for (let i = b.segs.length - 1; i > 0; i--) { b.segs[i].cx = b.segs[i - 1].cx; b.segs[i].cy = b.segs[i - 1].cy; }
      h.cx += next[0]; h.cy += next[1];
      if (b.grow > 0) { b.grow--; b.segs.push({ cx: old.cx, cy: old.cy, px: old.cx, py: old.cy, x: old.cx * T + T / 2, y: old.cy * T + T / 2 }); }
    } else if (++b.stuck >= 3 && b.segs.length > 1) {   // zaseknutý had se otočí – z ocasu je hlava
      b.segs.reverse(); b.stuck = 0; const a = b.segs[0], c = b.segs[1]; b.dir = [a.cx - c.cx, a.cy - c.cy];
    }
  }
  // plynulá poloha článků (mezi minulým a novým políčkem)
  const k = Math.min(1, b.moveT / b.stepTime);
  for (const g of b.segs) { g.x = (g.px + (g.cx - g.px) * k) * T + T / 2; g.y = (g.py + (g.cy - g.py) * k) * T + T / 2; }
  const head = b.segs[0]; b.x = head.x; b.y = head.y; b.cx = head.cx; b.cy = head.cy;
  for (const g of b.segs) touchHurt(s, g.x, g.y, T * 0.6);
  // oheň: přesekne tělo v nejbližším zasaženém článku; hlavu zraní, jen když je had krátký
  let cutAt = -1, headFire = null;
  for (let i = 0; i < b.segs.length; i++) { const g = b.segs[i]; const f = fireOnCell(s, g.cx, g.cy);
    if (!f) continue; if (i === 0) headFire = f; else { cutAt = i; break; } }
  if (cutAt > 0) {
    const fallen = b.segs.splice(cutAt);
    s.score += 60 * fallen.length; s.events.push('cut'); if (fallen.length >= 3 || Math.random() < 0.5) bossSay(s, 'cut');
    s.snakeBits = (s.snakeBits || []).concat(fallen.map(g => [Math.round(g.x), Math.round(g.y)]));
    // z velkého useknutého kusu se občas vyklube malý sliz
    if (fallen.length >= 4 && s.monsters.filter(m => m.alive).length < 4) { const g = fallen[Math.floor(fallen.length / 2)];
      if (s.grid[g.cy][g.cx] === EMPTY) { const m = makeMonster('slime', g.cx, g.cy, s.diff.speed); m.small = true; m.grace = 1; m.hitCd = 1; s.monsters.push(m); } }
  }
  if (headFire && b.hitCd <= 0) {
    if (b.segs.length <= SNAKE_VULN) {
      damageBoss(s, b, headFire.owner, head.x, head.y); b.hitCd = 1.0;
      if (b.alive) b.grow += 2;   // vzteky se natáhne – zase ho musíte zkrátit
    } else if (b.clankT <= 0) { b.clankT = 0.6; s.events.push('clank'); }
  }
  if (!b.alive) return;
  // v zuřivosti plive oheň dopředu, když hráče vidí
  if (b.enraged && b.spitT <= 0) { const d = inLineShot(s, head.cx, head.cy, 6);
    if (d && d[0] === b.dir[0] && d[1] === b.dir[1]) { shoot(s, head.x, head.y, d, 4.5); b.spitT = 3; } }
}

// --- Mág: teleportuje se a vyčarovává iluze; zranitelný je jen pravý ---
function wizardIllusionCount(s, b) { return ({ easy: 2, normal: 3, hard: 4 }[s.opts.difficulty] || 3) + (b.enraged ? 1 : 0); }
function wizardTeleport(s, b) {
  const cands = emptyCellsAwayFromPlayers(s, 4); const all = cands.length >= 2 ? cands : emptyCellsAwayFromPlayers(s, 2);
  const n = wizardIllusionCount(s, b) + 1;
  const spots = []; while (spots.length < n && all.length) spots.push(pickRandom(all));
  if (!spots.length) return;
  const [rx, ry] = spots.shift(); b.cx = rx; b.cy = ry; b.x = rx * T + T / 2; b.y = ry * T + T / 2; b.path = null; b.appear = 0.5;
  b.illusions = spots.map(([x, y]) => ({ cx: x, cy: y, x: x * T + T / 2, y: y * T + T / 2, dir: [0, 1], anim: Math.random() * 6, shimT: 1 + Math.random() * 3, shim: 0, wanderT: Math.random(), appear: 0.5 }));
  b.tpT = ({ easy: 6.5, normal: 5.5, hard: 4.5 }[s.opts.difficulty] || 5.5) * (b.enraged ? 0.7 : 1);
  s.events.push('teleport');
}
function wizardWander(s, w, dt, speed) {
  w.wanderT -= dt;
  gridMove(w, dt, speed, () => {
    if (w.wanderT > 0) return null;
    w.wanderT = 0.6 + Math.random() * 1.2;
    const dirs = DIRS.filter(([dx, dy]) => s.grid[w.cy + dy] && s.grid[w.cy + dy][w.cx + dx] === EMPTY && !E.bombAt(s, w.cx + dx, w.cy + dy));
    return dirs.length && Math.random() < 0.7 ? dirs[Math.floor(Math.random() * dirs.length)] : null;
  });
}
function stepWizard(s, b, dt) {
  b.tpT -= dt; b.castT -= dt; b.shootT -= dt; b.clankT -= dt; b.appear = Math.max(0, (b.appear || 0) - dt);
  if (b.fade > 0) { b.fade -= dt; if (b.fade <= 0) wizardTeleport(s, b); return; }   // mizí – za chvilku se objeví jinde
  if (b.tpT <= 0) { b.fade = 0.5; s.events.push('vanish'); return; }
  if (b.wanderT === undefined) b.wanderT = 0;
  wizardWander(s, b, dt, 1.0 * s.diff.speed);
  for (const il of b.illusions) { il.anim += dt * 5; il.appear = Math.max(0, il.appear - dt); il.shimT -= dt;
    if (il.shimT <= 0) { il.shim = 0.35; il.shimT = 2 + Math.random() * 2.5; } il.shim = Math.max(0, il.shim - dt);
    wizardWander(s, il, dt, 1.0 * s.diff.speed); }
  // jen pravý kouzlí: nápřah s holí a pak magická střela po řádku/sloupci
  if (b.shootT <= 0) { const d = inLineShot(s, b.cx, b.cy, 9);
    if (d) { b.castT = 0.5; b.dir = d; b.shootT = s.diff.shootEvery * (b.enraged ? 0.8 : 1.1); b.pending = d; } else b.shootT = 0.4; }
  if (b.pending && b.castT <= 0) { shoot(s, b.x, b.y, b.pending, 5, 'magic'); b.pending = null; }
  touchHurt(s, b.x, b.y, T * 0.6);
  // dotyk iluze = prasknutí (neškodí)
  b.illusions = b.illusions.filter(il => { const hit = s.players.some(p => p.alive && Math.abs(il.x - p.x) < T * 0.6 && Math.abs(il.y - p.y) < T * 0.6) || fireOnCell(s, cell(il.x), cell(il.y));
    if (hit) { s.events.push('poof'); s.poofs = (s.poofs || []).concat([[Math.round(il.x), Math.round(il.y)]]); bossSay(s, 'poof'); }
    return !hit; });
  if (b.hitCd <= 0 && b.appear <= 0) { const f = fireOnCell(s, cell(b.x), cell(b.y));
    if (f) { damageBoss(s, b, f.owner, b.x, b.y); if (b.alive) { b.tpT = Math.min(b.tpT, 0.7); b.pending = null; } } }
}

// --- Dvojčata: poražené dvojče se po chvíli zvedne – musí padnout oba skoro naráz ---
function stepTwins(s, b, dt) {
  const sp = 1.55 * s.diff.speed * (b.enraged ? 1.3 : 1);
  for (const w of b.twins) {
    w.anim += dt * 5; w.hitCd -= dt; w.shootT -= dt; w.think -= dt;
    if (w.down > 0) {
      w.down -= dt;
      if (w.down <= 0) { w.down = 0; w.hp = Math.ceil(w.maxHp / 2); w.hitCd = 1; s.events.push('twinup'); bossSay(s, 'up', true); }
      continue;
    }
    const mate = b.twins.find(o => o !== w);
    gridMove(w, dt, sp, () => {
      // každé dvojče jde po jiném hráči (když jsou aspoň dva), ať vás obklíčí
      const alive = s.players.filter(p => p.alive);
      let target = nearestPlayer(s, w.x, w.y);
      if (alive.length > 1 && w.k === 'ice') target = alive.slice().sort((p, q) => (Math.abs(q.x - w.x) + Math.abs(q.y - w.y)) - (Math.abs(p.x - w.x) + Math.abs(p.y - w.y)))[0];
      const pass = (x, y) => s.grid[y] && s.grid[y][x] === EMPTY && !E.bombAt(s, x, y) && !(mate.cx === x && mate.cy === y && mate.down <= 0);
      if (target && w.think <= 0) { w.think = 0.6; const tx = cell(target.x), ty = cell(target.y);
        const path = bfsPath(s, w.cx, w.cy, (x, y) => x === tx && y === ty, (x, y) => pass(x, y) || (x === tx && y === ty));
        w.path = path && path.length > 1 ? path.slice(1) : null; }
      if (w.path && w.path.length) { const [nx, ny] = w.path[0]; if (pass(nx, ny)) { w.path.shift(); return [nx - w.cx, ny - w.cy]; } w.path = null; }
      const dirs = DIRS.filter(([dx, dy]) => pass(w.cx + dx, w.cy + dy));
      return dirs.length ? dirs[Math.floor(Math.random() * dirs.length)] : null;
    });
    if (w.shootT <= 0) { const d = inLineShot(s, cell(w.x), cell(w.y), 7);
      if (d) { w.dir = d; shoot(s, w.x, w.y, d, w.k === 'ice' ? 4 : 4.5, w.k === 'ice' ? 'ice' : 'fire'); w.shootT = s.diff.shootEvery * (b.enraged ? 0.75 : 1.05); } else w.shootT = 0.3; }
    touchHurt(s, w.x, w.y, T * 0.6);
    if (w.hitCd <= 0) { const f = fireNear(s, w.x, w.y, T * 0.6);
      if (f) { w.hp--; w.hitCd = 0.7; s.events.push('bosshit'); const st = stat(s, f.owner); if (st) st.hits++;
        if (w.hp <= 0) { w.hp = 0; w.down = b.window; w.path = null; s.events.push('twindown');
          if (b.twins.every(o => o.down > 0)) { b.hp = 0; defeatBoss(s, b, (b.twins[0].x + b.twins[1].x) / 2, (b.twins[0].y + b.twins[1].y) / 2, f.owner); return; }
          bossSay(s, 'down', true); }
        else if (Math.random() < 0.5) bossSay(s, 'hit'); } }
  }
  b.hp = b.twins.reduce((a, w) => a + w.hp, 0);
  if (!b.enraged && b.hp <= b.maxHp / 2) enrageBoss(s, b);
}

// --- Obr: dupne, ze stropu padá kamení; zranitelný jen chvíli po dupnutí (omráčený) ---
function stepGiant(s, b, dt) {
  b.clankT -= dt; b.phaseT -= dt; b.think -= dt;
  // padající kamení: stín na zemi, po dopadu zraní a z kamene je cihla
  for (const r of b.rocks) { r.t -= dt; if (r.t <= 0) {
    s.events.push('rock');
    for (const p of s.players) if (p.alive && cell(p.x) === r.cx && cell(p.y) === r.cy) hurtPlayer(s, p);
    const busy = E.bombAt(s, r.cx, r.cy) || s.powerups.some(u => u.cx === r.cx && u.cy === r.cy) || s.players.some(p => p.alive && cell(p.x) === r.cx && cell(p.y) === r.cy)
      || Math.abs(r.cx - b.cx) + Math.abs(r.cy - b.cy) <= 1;
    let bricks = 0; for (const row of s.grid) for (const v of row) if (v === BRICK) bricks++;
    if (!busy && s.grid[r.cy][r.cx] === EMPTY && bricks < 40) s.grid[r.cy][r.cx] = BRICK;
  } }
  b.rocks = b.rocks.filter(r => r.t > 0);
  if (b.phase === 'walk') {
    b.stompT -= dt;
    const atCenter = gridMove(b, dt, b.speed * (b.enraged ? 1.25 : 1), () => {
      s.grid[b.cy][b.cx] = EMPTY;            // obr šlape přes cihly
      if (b.stompT <= 0) return null;
      return chaseStep(s, b, (x, y) => s.grid[y] && s.grid[y][x] !== undefined && s.grid[y][x] !== WALL && s.grid[y][x] < NEST && !E.bombAt(s, x, y));
    });
    if (atCenter && b.stompT <= 0) { b.phase = 'windup'; b.phaseT = 1.0; s.events.push('windup'); }
  } else if (b.phase === 'windup') {
    if (b.phaseT <= 0) {
      b.phase = 'dazed'; b.phaseT = b.daze; s.events.push('stomp'); bossSay(s, 'stomp');
      // kamení míří hlavně na hráče a kolem nich
      const n = ({ easy: 4, normal: 5, hard: 6 }[s.opts.difficulty] || 5) + (b.enraged ? 2 : 0);
      const cands = []; for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) if (s.grid[y][x] === EMPTY && Math.abs(x - b.cx) + Math.abs(y - b.cy) > 1) cands.push([x, y]);
      const picks = [];
      for (const p of s.players) if (p.alive) { const px = cell(p.x), py = cell(p.y); const near = cands.filter(([x, y]) => Math.abs(x - px) + Math.abs(y - py) <= 1);
        if (near.length) picks.push(near.find(([x, y]) => x === px && y === py) || near[0]); }
      while (picks.length < n && cands.length) { const c = pickRandom(cands); if (!picks.some(q => q[0] === c[0] && q[1] === c[1])) picks.push(c); }
      b.rocks = b.rocks.concat(picks.slice(0, n + 2).map(([x, y], i) => ({ cx: x, cy: y, t: 1.1 + i * 0.12 })));
    }
  } else if (b.phase === 'dazed') {
    if (b.phaseT <= 0) { b.phase = 'walk'; b.stompT = ({ easy: 7, normal: 6, hard: 5 }[s.opts.difficulty] || 6) * (b.enraged ? 0.7 : 1); }
  }
  if (b.phase !== 'dazed') touchHurt(s, b.x, b.y, T * 0.8);   // omráčený obr nikoho nezraní – běžte k němu!
  const f = fireNear(s, b.x, b.y, T * 0.9);
  if (f) {
    if (b.phase === 'dazed') { if (b.hitCd <= 0) damageBoss(s, b, f.owner, b.x, b.y); }
    else if (b.clankT <= 0) { b.clankT = 0.7; s.events.push('clank'); if (Math.random() < 0.5) bossSay(s, 'clank'); }
  }
}

// body, kde boss zraňuje (pro bezpečné oživení)
function bossDanger(s) {
  const b = s.boss; if (!b || !b.alive) return [];
  if (b.type === 'snake') return b.segs.map(g => [g.cx * T + T / 2, g.cy * T + T / 2]);
  if (b.type === 'twins') return b.twins.filter(w => w.down <= 0).map(w => [w.x, w.y]);
  if (b.type === 'giant') return [[b.x, b.y], ...b.rocks.map(r => [r.cx * T + T / 2, r.cy * T + T / 2])];
  return [[b.x, b.y]];
}
function bossGoal(s) {
  const b = s.boss; if (!b) return '';
  if (!b.alive) return '👹 boss poražen ✔';
  const t = BOSS_TYPES[b.type];
  if (b.type === 'snake') return `${t.icon} ${b.segs.length > SNAKE_VULN ? `zkraťte hada (${b.segs.length} článků)` : 'TEĎ! zasáhněte hlavu'} · hlava ${b.hp}/${b.maxHp}`;
  if (b.type === 'wizard') return `${t.icon} najděte pravého mága (${b.hp}/${b.maxHp})`;
  if (b.type === 'twins') return `${t.icon} porazte obě dvojčata naráz (🔥 ${b.twins[0].hp} · ❄ ${b.twins[1].hp})`;
  if (b.type === 'giant') return `${t.icon} ${b.phase === 'dazed' ? 'TEĎ! obr je omráčený' : 'počkejte, až dupne, a pak ho odpalte'} (${b.hp}/${b.maxHp})`;
  return `${t.icon} poraz bosse (${b.hp}/${b.maxHp})`;
}
// jednotný pohled na bosse pro kreslení: části v pevném pořadí (u mága seřazené podle polohy, ať se pravý nepozná)
function bossView(s) {
  const b = s.boss; if (!b || !b.alive) return null;
  const P = (k, x, y, dir, anim, flags, n) => [k, Math.round(x), Math.round(y), dir[0], dir[1], +(anim || 0).toFixed(1), flags | 0, n || 0];
  const hit = b.hitCd > 0.5 ? BF.HIT : 0;
  let parts = [], ex = {};
  if (b.type === 'snake') {
    const vuln = b.segs.length <= SNAKE_VULN ? BF.VULN : 0;
    b.segs.forEach((g, i) => { const nxt = b.segs[i - 1] || null; const d = i === 0 ? b.dir : [Math.sign(nxt.x - g.x), Math.sign(nxt.y - g.y)];
      parts.push(P(i === 0 ? 'head' : i === b.segs.length - 1 ? 'tail' : 'seg', g.x, g.y, d, b.anim + i * 0.7, (i === 0 ? hit | vuln : 0), i)); });
  } else if (b.type === 'wizard') {
    if (b.fade > 0) parts.push(P('wizard', b.x, b.y, b.dir, b.anim, BF.FADE | hit));
    else {
      parts.push(P('wizard', b.x, b.y, b.dir, b.anim, hit | (b.castT > 0 ? BF.CAST : 0) | (b.appear > 0 ? BF.FADE : 0)));
      for (const il of b.illusions) parts.push(P('wizard', il.x, il.y, il.dir, il.anim, (il.shim > 0 ? BF.SHIMMER : 0) | (il.appear > 0 ? BF.FADE : 0)));
      parts.sort((p, q) => p[2] - q[2] || p[1] - q[1]);
    }
  } else if (b.type === 'twins') {
    for (const w of b.twins) parts.push(P(w.k, w.x, w.y, w.dir, w.anim, (w.hitCd > 0.4 ? BF.HIT : 0) | (w.down > 0 ? BF.DOWN : 0), w.down > 0 ? Math.ceil(w.down) : w.hp));
    ex.th = b.twins.map(w => w.hp); ex.tm = b.twins[0].maxHp;
  } else if (b.type === 'giant') {
    parts.push(P('giant', b.x, b.y, b.dir, b.anim, hit | (b.phase === 'dazed' ? BF.DAZED | BF.VULN : 0) | (b.phase === 'windup' ? BF.WINDUP : 0), b.phase === 'dazed' ? Math.ceil(b.phaseT) : 0));
    ex.rk = b.rocks.map(r => [r.cx, r.cy, +r.t.toFixed(2)]);
  } else parts.push(P('bombus', b.x, b.y, b.dir, b.anim, hit));
  return { type: b.type, hp: b.hp, maxHp: b.maxHp, enraged: b.enraged ? 1 : 0, parts, ex };
}
function bossFromArr(a) { return a && { type: a.type, hp: a.hp, maxHp: a.maxHp, enraged: !!a.enraged, alive: true, ex: a.ex || {},
  parts: a.parts.map(p => ({ k: p[0], x: p[1], y: p[2], dir: [p[3], p[4]], anim: p[5], flags: p[6], n: p[7] })) }; }

// ---------- Hráči: oživení, spínače, klíče, portál ----------
function stepTeam(s, dt) {
  for (const p of s.players) {
    if (p.left) continue;
    p.grace -= dt;
    if (p.frozen > 0) {
      p.frozen = p.alive ? p.frozen - dt : 0;
      // spoluhráč rozmrazí zmrzlého dotykem
      if (p.frozen > 0 && s.players.some(q => q !== p && q.alive && !(q.frozen > 0) && Math.abs(q.x - p.x) < T * 0.9 && Math.abs(q.y - p.y) < T * 0.9)) { p.frozen = 0; s.events.push('thaw'); }
    }
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
    const gm = s.gems.find(q => q.revealed && !q.taken && q.cx === cx && q.cy === cy);
    if (gm) { gm.taken = true; s.events.push('gem'); s.score += 150; }
    const c = s.cages.find(c => c.open && !c.saved && c.cx === cx && c.cy === cy);
    if (c) { c.saved = true; s.events.push('rescue'); s.score += 500; }
  }
  // runy: počítá se jen šlápnutí (vstup na runu); správná rozsvítí, špatná zhasne všechny
  for (const r of s.runes) {
    const occ = s.players.some(p => p.alive && cell(p.x) === r.cx && cell(p.y) === r.cy);
    if (occ && !r.occ && !r.lit && s.runeNext <= s.runes.length) {
      if (r.n === s.runeNext) { r.lit = true; s.runeNext++; s.events.push('switch');
        if (s.runeNext > s.runes.length) { s.score += 1000; s.events.push('portal'); } }
      else { for (const q of s.runes) q.lit = false; s.runeNext = 1; s.events.push('wrong'); }
    }
    r.occ = occ;
  }
  // pochodně: hoří jen chvíli; když hoří všechny naráz, úkol je splněný a už nezhasnou
  if (s.torches.length && !s.torchesDone) {
    for (const t of s.torches) if (t.lit > 0) { t.lit -= dt; if (t.lit <= 0) { t.lit = 0; s.events.push('torchout'); } }
    if (s.torches.every(t => t.lit > 0)) { s.torchesDone = true; for (const t of s.torches) t.lit = 1; s.score += 1500; s.events.push('portal'); }
  }
  if (s.goldNote) { s.goldNote.t -= dt; if (s.goldNote.t <= 0) s.goldNote = null; }
  if (s.portal) {
    const open = objectiveDone(s);
    if (open && !s.portal.open) { s.portal.open = true; s.events.push('portal'); }
    if (s.portal.open && s.players.some(p => p.alive && cell(p.x) === s.portal.cx && cell(p.y) === s.portal.cy)) return 'level';
  } else if (s.boss && !s.boss.alive) return 'won';
  return null;
}
// ---------- Zlaté schopnosti ----------
function setGold(s, p, kind) {
  const was = p.gold;
  if (was === 'phase' && kind !== 'phase') { p.x = cell(p.x) * T + T / 2; p.y = cell(p.y) * T + T / 2; }   // ať nezůstane zaklíněný v cihle
  if (was === 'remote' && kind !== 'remote') for (const b of s.bombs) if (b.owner === p.id && b.remote) { b.remote = false; b.timer = Math.min(b.timer, E.BOMB_TIME); }
  p.gold = kind;
}
function stepGoldPickup(s) {
  for (const p of s.players) if (p.alive) {
    const i = s.powerups.findIndex(u => u.kind === 'gold' && u.cx === cell(p.x) && u.cy === cell(p.y));
    if (i < 0) continue;
    const u = s.powerups.splice(i, 1)[0];
    setGold(s, p, u.gold); s.score += 500; stat(s, p.id).golds.push(u.gold);
    s.goldNote = { id: p.id, kind: u.gold, t: GOLD_NOTE_TIME }; s.events.push('gold');
  }
}
// rozbuška: když už hráč nemá volnou bombu, stisk odpálí jeho nejstarší čekající bombu
function remoteInput(s, p, inp) {
  if (p.gold !== 'remote' || !inp.bomb || !p.alive) return inp;
  const own = s.bombs.filter(b => b.owner === p.id);
  if (own.length < p.maxBombs) return inp;
  const b = own.find(b => b.remote) || own[0];
  if (b) { b.timer = 0; s.events.push('detonate'); }
  return { dx: inp.dx, dy: inp.dy, bomb: false };
}
// nové bomby převezmou schopnost majitele (rozbuška = dlouhý doutnák, průrazný plamen)
function tagBombs(s) {
  for (const b of s.bombs) if (!b.tagged) {
    b.tagged = true; const o = s.players.find(p => p.id === b.owner); if (!o) continue;
    if (o.gold === 'remote') { b.remote = true; b.timer = REMOTE_FUSE; }
    if (o.gold === 'pierce') b.pierce = true;
  }
}
// magnet: věci do 4 políček se každou chvilku posunou o políčko k hráči
function stepMagnet(s, dt) {
  s.magnetT -= dt; if (s.magnetT > 0) return; s.magnetT = 0.18;
  const itemAt = (x, y) => s.powerups.some(u => u.cx === x && u.cy === y) || s.keys.some(k => k.revealed && !k.taken && k.cx === x && k.cy === y) || s.gems.some(q => q.revealed && !q.taken && q.cx === x && q.cy === y);
  for (const p of s.players) if (p.alive && p.gold === 'magnet') {
    const px = cell(p.x), py = cell(p.y);
    const items = [...s.powerups.filter(u => u.kind !== 'gold'), ...s.keys.filter(k => k.revealed && !k.taken), ...s.gems.filter(q => q.revealed && !q.taken)];
    for (const it of items) {
      const dx = px - it.cx, dy = py - it.cy; if (!(dx || dy) || Math.abs(dx) + Math.abs(dy) > 4) continue;
      const tries = []; if (dx) tries.push([Math.sign(dx), 0]); if (dy) tries.push([0, Math.sign(dy)]); if (Math.abs(dy) > Math.abs(dx)) tries.reverse();
      for (const [sx, sy] of tries) { const nx = it.cx + sx, ny = it.cy + sy;
        if (s.grid[ny][nx] === EMPTY && !E.bombAt(s, nx, ny) && ((nx === px && ny === py) || !itemAt(nx, ny))) { it.cx = nx; it.cy = ny; break; } }
    }
  }
}
// level „vydržte“: odpočet a příšery, které pořád přicházejí (daleko od hráčů)
function stepSurvive(s, dt) {
  const v = s.survive; if (!v || v.left <= 0) return;
  v.left -= dt; if (v.left <= 0) { v.left = 0; s.score += 1500; s.events.push('portal'); return; }
  v.spawnT -= dt; if (v.spawnT > 0) return;
  v.spawnT = s.diff.waveEvery;
  const alive = s.monsters.filter(m => m.alive).length; if (alive >= s.diff.waveCap) return;
  const cands = [];
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++)
    if (s.grid[y][x] === EMPTY && !E.bombAt(s, x, y) && !isObjectiveCell(s, x, y) && s.players.every(p => !p.alive || Math.abs(cell(p.x) - x) + Math.abs(cell(p.y) - y) >= 6)) cands.push([x, y]);
  // ke konci houstne: dvě příšery naráz
  const n = Math.min(s.diff.waveCap - alive, v.left < v.total / 2 ? 2 : 1);
  for (let i = 0; i < n && cands.length; i++) { const [x, y] = pickRandom(cands);
    const m = makeMonster(v.pool[Math.floor(Math.random() * v.pool.length)], x, y, s.diff.speed * (1 + s.level * 0.025)); m.grace = 1; s.monsters.push(m); }
  s.events.push('spawn');
}
// ❤ sebrané živým hráčem oživí hned každého, kdo čeká (před engine.stepPickups, aby ho ten nespolkl)
function stepRevivePickup(s) {
  for (const p of s.players) if (p.alive) {
    const i = s.powerups.findIndex(u => u.kind === 'revive' && u.cx === cell(p.x) && u.cy === cell(p.y));
    if (i < 0) continue;
    s.powerups.splice(i, 1); s.score += 200;
    const waiting = s.players.filter(q => !q.alive && !q.left && q.respawn > 0);
    for (const q of waiting) revive(s, q);   // revive() sám hlásí událost 'revive'
    if (!waiting.length) s.events.push('powerup');
  }
}
function onDeath(s, p) {
  p.deaths++; s.deaths++; stat(s, p.id).deaths++;
  setGold(s, p, null);   // zlatá schopnost se smrtí ztrácí
  p.respawn = respawnTime(p.deaths);   // vždy se vrátí, jen čeká déle a déle
}
// bezpečné políčko: volné, bez bomby a plamene, žádná příšera ani boss v okolí
function safeCell(s, x, y) {
  if (!s.grid[y] || s.grid[y][x] !== EMPTY || E.bombAt(s, x, y) || s.fires.some(f => f.cx === x && f.cy === y)) return false;
  const px = x * T + T / 2, py = y * T + T / 2;
  if (s.monsters.some(m => m.alive && Math.abs(m.x - px) < T * 2 && Math.abs(m.y - py) < T * 2)) return false;
  if (bossDanger(s).some(([bx, by]) => Math.abs(bx - px) < T * 3 && Math.abs(by - py) < T * 3)) return false;
  if (s.projectiles.some(pr => Math.abs(pr.x - px) < T * 2 && Math.abs(pr.y - py) < T * 2)) return false;
  return true;
}
function revive(s, p) {
  // vedle živého spoluhráče, jinak na startu, jinak kdekoli bezpečně; když není kde, start i přes riziko (chrání nesmrtelnost)
  const mate = s.players.find(q => q.alive && !q.left);
  const cands = [];
  if (mate) { const mx = cell(mate.x), my = cell(mate.y);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) cands.push([mx + dx, my + dy]); }
  const home = START_CELLS[s.players.indexOf(p) % START_CELLS.length];
  cands.push(home, ...START_CELLS.filter(c => c !== home));
  for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) cands.push([x, y]);
  let spot = cands.find(([x, y]) => safeCell(s, x, y)) || home;
  p.x = spot[0] * T + T / 2; p.y = spot[1] * T + T / 2; p.alive = true; p.grace = GRACE_TIME; p.respawn = 0; p.frozen = 0;
  p.maxBombs = Math.max(1, p.maxBombs - 1); p.fire = Math.max(2, p.fire - 1);
  s.events.push('revive');
}

// ---------- Hlavní krok ----------
// inputs: { [playerId]: {dx, dy, bomb} } → null, nebo { done: 'level' | 'won' } (až po dohrání „outra“)
function step(s, inputs, dt) {
  s.events = []; s.snakeBits = []; s.poofs = [];
  if (s.done) { s.outro -= dt; if (s.bossSay) { s.bossSay.t -= dt; if (s.bossSay.t <= 0) s.bossSay = null; } return s.outro <= 0 ? { done: s.done } : null; }
  if (s.intro > 0) { s.intro -= dt; return null; }
  s.time += dt; s.stats.time += dt;
  const aliveBefore = s.players.map(p => p.alive);
  // zmrzlý hráč se nehýbe ani nepokládá bomby; v pavučině jde pomalu
  const inp = {}, speeds = s.players.map(p => p.speed);
  for (const p of s.players) {
    inp[p.id] = p.frozen > 0 ? { dx: 0, dy: 0, bomb: false } : (inputs[p.id] || { dx: 0, dy: 0, bomb: false });
    inp[p.id] = remoteInput(s, p, inp[p.id]);
    if (p.alive && s.grid[cell(p.y)][cell(p.x)] === BRICK) inp[p.id] = { dx: inp[p.id].dx, dy: inp[p.id].dy, bomb: false };   // v cihle bombu nepoložíš
    p.passBricks = p.gold === 'phase'; p.passBombs = p.gold === 'bombpass';
    if (p.alive && s.webs.some(w => w.cx === cell(p.x) && w.cy === cell(p.y))) p.speed *= WEB_SLOW;
  }
  E.stepPlayers(s, inp, dt);
  s.players.forEach((p, i) => { p.speed = speeds[i]; });
  tagBombs(s);
  E.stepBombs(s, dt);
  E.stepFires(s, dt, (f, p) => p.grace <= 0 && (s.opts.friendlyFire || f.owner === p.id || f.owner == null) && p.gold !== 'fireproof' && !useShield(s, p));
  stepRevivePickup(s);
  stepGoldPickup(s);
  E.stepPickups(s);
  stepMagnet(s, dt);
  stepSurvive(s, dt);
  stepMonsters(s, dt);
  stepWebs(s, dt);
  stepProjectiles(s, dt);
  stepNest(s, dt);
  stepBoss(s, dt);
  const result = stepTeam(s, dt);
  s.players.forEach((p, i) => { if (aliveBefore[i] && !p.alive) onDeath(s, p); });
  if (result) { s.done = result; s.outro = result === 'won' ? OUTRO_WON : OUTRO_TIME; s.score += result === 'level' ? 1000 * (s.level + 1) : 0; s.events.push(result === 'won' ? 'victory' : 'levelup'); return null; }
  // Konec výpravy neexistuje: i když padnou všichni naráz, každý jen čeká na své oživení.
  return null;
}
// Testovací zkratka (server ji pustí jen s AB_DEBUG=1): splní úkol levelu a postaví hráče do portálu / dorazí bosse
function debugFinishLevel(s) {
  for (const m of s.monsters) m.alive = false;
  for (const k of s.keys) { k.revealed = true; k.taken = true; }
  if (s.switches.length) s.switchesDone = true;
  if (s.nest) { s.nest.hp = 0; s.grid[s.nest.cy][s.nest.cx] = EMPTY; }
  for (const c of s.cages) { c.open = true; c.saved = true; s.grid[c.cy][c.cx] = EMPTY; }
  for (const q of s.gems) { q.revealed = true; q.taken = true; }
  for (const r of s.runes) r.lit = true; if (s.runes.length) s.runeNext = s.runes.length + 1;
  if (s.torches.length) { s.torchesDone = true; for (const t of s.torches) t.lit = 1; }
  if (s.survive) s.survive.left = 0;
  if (s.boss && s.boss.alive) { const [x, y] = bossDanger(s)[0] || [s.boss.x, s.boss.y]; if (s.boss.type === 'twins') for (const w of s.boss.twins) w.down = 1; defeatBoss(s, s.boss, x, y, (s.players[0] || {}).id); }
  const p = s.players.find(p => p.alive) || s.players[0];
  if (s.portal) { p.alive = true; p.x = s.portal.cx * T + T / 2; p.y = s.portal.cy * T + T / 2; }
  s.intro = 0;
}
// Testovací zkratka: položí ❤ na políčko hráče (pro ověření oživení power-upem po Wi-Fi)
function debugSpawnRevive(s, playerId) {
  const p = s.players.find(q => q.id === playerId) || s.players[0];
  s.powerups.push({ cx: cell(p.x), cy: cell(p.y), kind: 'revive', shield: 0 });
}
// Testovací zkratka: položí zlatý power-up (volitelně daného druhu) na políčko hráče
function debugSpawnGold(s, playerId, kind) {
  const p = s.players.find(q => q.id === playerId) || s.players[0];
  s.powerups = s.powerups.filter(u => u.kind !== 'gold');
  s.powerups.push({ cx: cell(p.x), cy: cell(p.y), kind: 'gold', gold: GOLD_TYPES[kind] ? kind : pickGoldKind(s), shield: Infinity });
}
// statistiky k přenesení do dalšího levelu
function carryOf(s) {
  const players = {}; for (const p of s.players) players[p.id] = { maxBombs: p.maxBombs, fire: p.fire, speed: p.speed, kick: p.kick, gold: p.alive ? p.gold : null };
  return { score: s.score, deaths: s.deaths, players, bossType: s.bossType, stats: JSON.parse(JSON.stringify(s.stats)) };
}
// statistiky celé výpravy pro vítěznou obrazovku (lokálně i po Wi-Fi v coop_end)
function finalStats(s) {
  const st = s.stats, n = Math.max(1, s.players.filter(p => !p.left).length);
  const perPlayer = s.deaths / n;
  const stars = Math.max(1, 3 - (perPlayer > 4 ? 1 : 0) - (perPlayer > 10 ? 1 : 0));
  return { boss: s.bossType, bossName: BOSS_TYPES[s.bossType].name, difficulty: s.opts.difficulty, time: Math.round(st.time), kills: st.kills, deaths: s.deaths, score: s.score,
    stars, lastHit: st.lastHit, fullRun: st.startLevel === 0,
    players: s.players.map(p => { const q = st.players[p.id] || { deaths: 0, kills: 0, golds: [], hits: 0 };
      return { id: p.id, name: p.name, color: p.color, deaths: q.deaths, kills: q.kills, golds: q.golds.slice(), hits: q.hits }; }) };
}

// ---------- Pohled pro vykreslení (stejný tvar lokálně i ze sítě) ----------
function view(s) {
  return {
    level: s.level, levelCount: s.levelCount, name: s.name, sub: s.sub, theme: s.theme, deaths: s.deaths, score: s.score,
    objective: objectiveText(s), intro: s.intro, outro: s.outro, done: s.done, friendlyFire: s.opts.friendlyFire, time: s.time,
    portal: s.portal, keys: s.keys, switches: s.switches, nest: s.nest && s.nest.hp > 0 ? s.nest : null,
    monsters: s.monsters.filter(m => m.alive), projectiles: s.projectiles, webs: s.webs, newcomers: s.newcomers, tips: s.tips, sub: s.sub,
    boss: bossFromArr(bossView(s)), bossType: s.bossType, bossSay: s.bossSay, bossDeath: s.bossDeath, snakeBits: s.snakeBits, poofs: s.poofs,
    cages: s.cages, gems: s.gems, runes: s.runes, runeNext: s.runeNext, torches: s.torches, torchMax: s.diff.torch, torchesDone: !!s.torchesDone,
    survive: s.survive ? { left: s.survive.left, total: s.survive.total } : null, goldNote: s.goldNote,
    team: s.players.map(p => ({ id: p.id, respawn: p.respawn, grace: p.grace, left: p.left, deaths: p.deaths, frozen: p.frozen, gold: p.gold || null })),
  };
}
// kompaktní snapshot pro síť: základ z enginu + kooperativní doplněk „c“
function snapshot(s) {
  const base = E.snapshot(s);
  base.t = Math.floor(s.time);
  base.c = {
    lv: s.level, de: s.deaths, sc: s.score, ob: objectiveText(s), in: +s.intro.toFixed(2), ou: +s.outro.toFixed(2), dn: s.done || '', tm: Math.floor(s.time),
    po: s.portal ? [s.portal.cx, s.portal.cy, s.portal.open ? 1 : 0] : null,
    ke: s.keys.map(k => [k.cx, k.cy, k.revealed ? 1 : 0, k.taken ? 1 : 0]),
    sw: s.switches.map(w => [w.cx, w.cy, w.on ? 1 : 0]),
    ne: s.nest && s.nest.hp > 0 ? [s.nest.cx, s.nest.cy, s.nest.hp, s.nest.maxHp] : null,
    // příšera: typ, x, y, směr, animace, hp, příznaky (1 malý · 2 zahrabaný · 4 neviditelný · 8 chvilka po vylezení), výška skoku, snědené bomby
    m: s.monsters.filter(m => m.alive).map(m => [m.type, Math.round(m.x), Math.round(m.y), m.dir[0], m.dir[1], +m.anim.toFixed(1), m.hp,
      (m.small ? 1 : 0) | (m.under ? 2 : 0) | (m.hidden ? 4 : 0) | (m.grace > 0 ? 8 : 0) | (m.unraveled ? 16 : 0) | (m.safeT > 0 ? 32 : 0), Math.round(m.z || 0), m.eaten || 0]),
    pr: s.projectiles.map(p => [Math.round(p.x), Math.round(p.y), p.dx, p.dy, p.kind === 'ice' ? 1 : p.kind === 'magic' ? 2 : 0]),
    we: s.webs.map(w => [w.cx, w.cy, +w.life.toFixed(1)]),
    nw: s.intro > 0 ? s.newcomers : null,
    // boss: typ (vylosovaný už při startu výpravy), jednotný pohled na části, hláška, místo, kde padl, efekty (useknuté články, prasklé iluze)
    bt: s.bossType, bs: bossView(s), sy: s.bossSay ? [s.bossSay.text, +s.bossSay.t.toFixed(1)] : null,
    bd: s.bossDeath ? [Math.round(s.bossDeath.x), Math.round(s.bossDeath.y)] : null, sb: s.snakeBits.length ? s.snakeBits : null, pf: s.poofs.length ? s.poofs : null,
    tp: s.players.map(p => [p.id, +p.respawn.toFixed(1), p.grace > 0 ? 1 : 0, p.left ? 1 : 0, p.deaths, +(p.frozen || 0).toFixed(1), p.gold || '']),
    // nové úkoly: klece, krystaly, runy, pochodně, odpočet „vydržte“; gn = kdo právě sebral zlatou schopnost
    ca: s.cages.map(c => [c.cx, c.cy, c.open ? 1 : 0, c.saved ? 1 : 0, c.animal]),
    ge: s.gems.map(q => [q.cx, q.cy, q.revealed ? 1 : 0, q.taken ? 1 : 0]),
    ru: s.runes.map(r => [r.cx, r.cy, r.n, r.lit ? 1 : 0]), rn: s.runeNext,
    to: s.torches.map(t => [t.cx, t.cy, +t.lit.toFixed(1)]), td: s.torchesDone ? 1 : 0, tx: s.diff.torch,
    sv: s.survive ? [+s.survive.left.toFixed(1), s.survive.total] : null,
    gn: s.goldNote ? [s.goldNote.id, s.goldNote.kind, +s.goldNote.t.toFixed(1)] : null,
  };
  return base;
}
function viewFromSnapshot(c) {
  const L = LEVELS[c.lv], BT = BOSS_TYPES[c.bt];
  return {
    level: c.lv, levelCount: LEVELS.length, name: L.name, sub: L.boss && BT ? BT.name : L.sub, theme: L.theme, deaths: c.de, score: c.sc,
    objective: c.ob, intro: c.in, outro: c.ou, done: c.dn || null, time: c.tm,
    portal: c.po ? { cx: c.po[0], cy: c.po[1], open: !!c.po[2] } : null,
    keys: c.ke.map(k => ({ cx: k[0], cy: k[1], revealed: !!k[2], taken: !!k[3] })),
    switches: c.sw.map(w => ({ cx: w[0], cy: w[1], on: !!w[2] })),
    nest: c.ne ? { cx: c.ne[0], cy: c.ne[1], hp: c.ne[2], maxHp: c.ne[3] } : null,
    monsters: c.m.map(m => ({ type: m[0], x: m[1], y: m[2], dir: [m[3], m[4]], anim: m[5], hp: m[6], alive: true,
      small: !!(m[7] & 1), under: !!(m[7] & 2), hidden: !!(m[7] & 4), grace: m[7] & 8 ? 1 : 0, unraveled: !!(m[7] & 16), safeT: m[7] & 32 ? 1 : 0, z: m[8] || 0, eaten: m[9] || 0 })),
    projectiles: c.pr.map(p => ({ x: p[0], y: p[1], dx: p[2], dy: p[3], kind: ['fire', 'ice', 'magic'][p[4]] || 'fire' })),
    webs: (c.we || []).map(w => ({ cx: w[0], cy: w[1], life: w[2] })), newcomers: c.nw || [], tips: L.boss && BT ? BT.tips : (L.tips || []),
    cages: (c.ca || []).map(a => ({ cx: a[0], cy: a[1], open: !!a[2], saved: !!a[3], animal: a[4] })),
    gems: (c.ge || []).map(q => ({ cx: q[0], cy: q[1], revealed: !!q[2], taken: !!q[3] })),
    runes: (c.ru || []).map(r => ({ cx: r[0], cy: r[1], n: r[2], lit: !!r[3] })), runeNext: c.rn || 1,
    torches: (c.to || []).map(t => ({ cx: t[0], cy: t[1], lit: t[2] })), torchMax: c.tx || 30, torchesDone: !!c.td,
    survive: c.sv ? { left: c.sv[0], total: c.sv[1] } : null,
    goldNote: c.gn ? { id: c.gn[0], kind: c.gn[1], t: c.gn[2] } : null,
    boss: bossFromArr(c.bs), bossType: c.bt || null, bossSay: c.sy ? { text: c.sy[0], t: c.sy[1] } : null, bossDeath: c.bd ? { x: c.bd[0], y: c.bd[1], type: c.bt } : null,
    snakeBits: c.sb || [], poofs: c.pf || [],
    team: c.tp.map(t => ({ id: t[0], respawn: t[1], grace: t[2], left: !!t[3], deaths: t[4] || 0, frozen: t[5] || 0, gold: t[6] || null })),
  };
}

return { LEVELS, DIFFICULTIES, MONSTER_TYPES, GOLD_TYPES, GOLD_KINDS, BOSS_TYPES, BOSS_KINDS, BF, finalStats, OUTRO_WON, NEST, CAGE, TORCH, REMOTE_FUSE, INTRO_TIME, OUTRO_TIME, GRACE_TIME, respawnTime, createLevel, makeMonster, step, carryOf, view, snapshot, viewFromSnapshot, objectiveText, debugFinishLevel, debugSpawnRevive, debugSpawnGold };
});
