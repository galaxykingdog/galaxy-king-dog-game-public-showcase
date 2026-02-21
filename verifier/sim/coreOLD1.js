// verifier/sim/core.js
// Deterministic headless re-simulation for Gate D (Proof-of-High-Play)

const fs = require("fs");
const path = require("path");

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
function easeSineInOut(t) { return -0.5 * (Math.cos(Math.PI * t) - 1); }

function readPngSize(p) {
  const fd = fs.openSync(p, "r");
  try {
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } finally { fs.closeSync(fd); }
}

function decodeB64ToU8(b64) {
  return Uint8Array.from(Buffer.from(String(b64), "base64"));
}
function decodeB64ToU16LE(b64) {
  const buf = Buffer.from(String(b64), "base64");
  const n = Math.floor(buf.length / 2);
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) out[i] = buf.readUInt16LE(i * 2);
  return out;
}

// RNG (same style as main.js)
function mulberry32(seedU32) {
  let a = seedU32 >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// constants mirrored from your main.js
const SCREEN_W = 800;
const ENEMY_SPEED_FACTOR = 1 / 3.5;
const DIFFICULTY_SCALE = 1.12;
const ENEMY_CHANCE_FACTOR = 1.06;

const ENEMY_START_Y = 120;
const FORMATION_Y_OFFSET = 60;
const ENEMY_SPACING_X = 48;
const ENEMY_SPACING_Y = 42;
const FORMATION_CENTER_X = 400;

const MAX_PLAYER_BULLETS_ONSCREEN = 3;
const MAX_PLAYER_BULLETS = 12;
const MAX_ENEMY_BULLETS = 20;
const MAX_DIVING_ENEMIES = 4;

const DIVE_MASTER_TICK_MS = 80;
const DIVE_COUNTER_BASES = [12, 20, 28, 38, 54];

const THIN_OUT_SPEED_UP = 2.2;
const THIN_OUT_BULLET_UP = 1.45;

const INVULN_DURATION = 1600;
const RESPAWN_DELAY = 800;

const ENEMY_SCORES = {
  enemy_blue: 50,
  enemy_red: 80,
  enemy_purple: 60,
  enemy_flagship: 150,
};

const PLAYER_STATE = { PLAYING: "playing", DYING: "dying", GAME_OVER: "game_over" };
const POHP_INPUT_BITS = { left: 1, right: 2, shoot: 4 };

function waveSpeedMul(wave) { return 1 + (wave - 1) * 0.07; }
function waveRateMul(wave) { return 1 + (wave - 1) * 0.06; }
function waveBulletMul(wave) { return 1 + (wave - 1) * 0.05; }

function centeredXs(count, spacing, centerX) {
  const totalW = (count - 1) * spacing;
  const startX = centerX - totalW / 2;
  return Array.from({ length: count }, (_, i) => startX + i * spacing);
}

function makeAABB(x, y, halfW, halfH) { return { x, y, halfW, halfH }; }
function aabbOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) <= a.halfW + b.halfW &&
    Math.abs(a.y - b.y) <= a.halfH + b.halfH
  );
}
function getFirstDead(pool) {
  for (let i = 0; i < pool.length; i++) if (!pool[i].active) return pool[i];
  return null;
}
function countActive(arr, pred) {
  let n = 0;
  for (const x of arr) if (x.active && (!pred || pred(x))) n++;
  return n;
}

function simulateRunPackage(pkg, opts = {}) {
  const assetsDir =
    opts.assetsDir || process.env.ASSETS_DIR || path.resolve(__dirname, "..", "assets");

  // sprite sizes (fallbacks; overridden by reading PNG headers if present)
  const sprite = {
    ship: { w: 32, h: 32, scale: 0.8 },
    enemy_blue: { w: 32, h: 32, scale: 0.6 },
    enemy_red: { w: 32, h: 32, scale: 0.6 },
    enemy_purple: { w: 32, h: 32, scale: 0.6 },
    enemy_flagship: { w: 32, h: 32, scale: 0.6 },
    bullet_player: { w: 8, h: 16, scale: 0.6 },
    bullet_enemy: { w: 8, h: 16, scale: 0.6 },
  };
  const pngMap = {
    ship: "ship.png",
    enemy_blue: "enemy_blue.png",
    enemy_red: "enemy_red.png",
    enemy_purple: "enemy_purple.png",
    enemy_flagship: "enemy_flagship.png",
    bullet_player: "bullet_player.png",
    bullet_enemy: "bullet_enemy.png",
  };
  for (const [k, file] of Object.entries(pngMap)) {
    try {
      const { w, h } = readPngSize(path.join(assetsDir, file));
      sprite[k].w = w; sprite[k].h = h;
    } catch (_) {}
  }

  const masks = decodeB64ToU8(pkg.masks_b64);
  const deltas = decodeB64ToU16LE(pkg.deltas_b64);
  const frames = Math.min(masks.length, deltas.length);

  const totalMs = Array.from(deltas).reduce((a, b) => a + b, 0);
  const maxFrames = opts.maxFrames ?? 200000;
  const maxTotalMs = opts.maxTotalMs ?? 20 * 60 * 1000;
  if (frames > maxFrames) return { ok: false, err: "too_many_frames" };
  if (totalMs > maxTotalMs) return { ok: false, err: "run_too_long" };

  const rng = mulberry32((pkg.seed ?? 0) >>> 0);
  const grFloat = () => rng();
  const grBetween = (min, max) => Math.floor(grFloat() * (max - min + 1)) + min;
  const grFloatBetween = (min, max) => grFloat() * (max - min) + min;
  const grPick = (arr) => arr[Math.floor(grFloat() * arr.length)];

  let wave = 1, score = 0, lives = 3;
  let playerState = PLAYER_STATE.PLAYING;

  let respawnTimer = 0;
  let invulnerabilityTimer = 900; // matches your startCountdown init

// Wave transition (endless waves) + prevent ReferenceError in older core.
const WAVE_SPAWN_DELAY_MS = 750;
let waveSpawnTimer = 0;

// Enemy fire scheduler (older core versions forgot to define this)
let enemyFireCooldownMs = 320;

  let shootCooldown = 0;

  let enemySpeedBase = 60 * ENEMY_SPEED_FACTOR;
  let enemyBulletBaseChance = 0.0008;
  let enemyDiveBaseChance = 0.001;
  let enemyBulletMinSpeed = 220;
  let enemyBulletMaxSpeed = 300;
  let enemyDiveSpeedY = 170;
  let enemyReturnSpeed = 250;

  function applyWaveDifficulty(w) {
    const baseSpeed = 60 * ENEMY_SPEED_FACTOR;
    const baseBulletChance = 0.0008;
    const baseDiveChance = 0.001;
    enemySpeedBase = baseSpeed * Math.pow(DIFFICULTY_SCALE, w - 1);
    enemyBulletBaseChance = baseBulletChance * Math.pow(ENEMY_CHANCE_FACTOR, w - 1);
    enemyDiveBaseChance = baseDiveChance * Math.pow(ENEMY_CHANCE_FACTOR, w - 1);
    enemyBulletMinSpeed = Math.round(220 * Math.pow(DIFFICULTY_SCALE, w - 1));
    enemyBulletMaxSpeed = Math.round(300 * Math.pow(DIFFICULTY_SCALE, w - 1));
    enemyDiveSpeedY = Math.round(170 * Math.pow(DIFFICULTY_SCALE, w - 1));
    enemyReturnSpeed = Math.round(250 * Math.pow(DIFFICULTY_SCALE, w - 1));
  }
  applyWaveDifficulty(1);

  const player = { active: true, x: 400, y: 550, vx: 0, vy: 0 };

  const playerBullets = Array.from({ length: MAX_PLAYER_BULLETS }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0 }));
  const enemyBullets = Array.from({ length: MAX_ENEMY_BULLETS }, () => ({ active: false, x: 0, y: 0, vx: 0, vy: 0, __isBullet: true }));

  const enemies = [];
  let enemyFormation = [];
  let enemyDirection = 1;

  function createEnemyFormation() {
    enemyDirection = 1;
    enemyFormation = [];
    enemies.length = 0;
    const rows = [
      ["enemy_flagship", 5],
      ["enemy_red", 7],
      ["enemy_purple", 8],
      ["enemy_blue", 9],
    ];
    let y = ENEMY_START_Y + FORMATION_Y_OFFSET;
    rows.forEach(([key, count]) => {
      const row = [];
      const xs = centeredXs(count, ENEMY_SPACING_X, FORMATION_CENTER_X);
      xs.forEach((x) => {
        const e = { active: true, key, x, y, state: "formation",
    diveShotsLeft: 0,
    shotCdMs: 0,
    shootExactX: 0, homeX: x, homeY: y, diveTime: 0, diveLoopCenterX: 0, diveLoopCenterY: 0, diveLoopRadius: 0, diveLoopSpeed: 0, diveLoopDir: 1, targetX: x };
        enemies.push(e);
        row.push(e);
      });
      enemyFormation.push(row);
      y += ENEMY_SPACING_Y;
    });
  }
  createEnemyFormation();

  // Galaxian-style Attack Scheduler state (master + secondary counters)
  let diveMasterAccMs = 0;
  let diveCounters = DIVE_COUNTER_BASES.map((b) => clamp(b + grBetween(-2, 2), 4, 120));
  let divePendingTriggers = 0;
  let divePendingSquadBoost = 0;


  function aliveRatioNow() {
    const total = enemies.length;
    const alive = enemies.filter((e) => e.active).length;
    return total > 0 ? alive / total : 0;
  }

  function startEnemyDive(e) {
    if (!e || !e.active) return;
    e.state = "diveLoop";
    e.diveTime = 0;
    e.diveLoopCenterX = e.x;
    e.diveLoopCenterY = e.y + 30;
    e.diveLoopRadius = grFloatBetween(50, 90);
    e.diveLoopSpeed = grFloatBetween(3.5, 5.0);
    e.diveLoopDir = grFloat() < 0.5 ? -1 : 1;
    e.targetX = clamp(player.x + grBetween(-120, 120), 60, 740);
  }

  function updateEnemyFormation(deltaMs) {
    const dt = deltaMs / 1000;
    const formationEnemies = [];
    for (const row of enemyFormation) for (const e of row) if (e && e.active && e.state === "formation") formationEnemies.push(e);
    if (formationEnemies.length === 0) return;

    const aliveRatio = aliveRatioNow();
    const thinMulSpeed = 1 + (1 - aliveRatio) * (THIN_OUT_SPEED_UP - 1);
    const currentSpeed = enemySpeedBase * waveSpeedMul(wave) * thinMulSpeed;

    for (const e of formationEnemies) { e.x += enemyDirection * currentSpeed * dt; e.homeX = e.x; e.homeY = e.y; }

    const leftmostX = Math.min(...formationEnemies.map((e) => e.x));
    const rightmostX = Math.max(...formationEnemies.map((e) => e.x));
    if (rightmostX > 750 && enemyDirection > 0) { enemyDirection = -1; for (const e of formationEnemies) { e.y += 20; e.homeY = e.y; } }
    else if (leftmostX < 50 && enemyDirection < 0) { enemyDirection = 1; for (const e of formationEnemies) { e.y += 20; e.homeY = e.y; } }

    // --- Galaxian-style attack scheduler (master + secondary counters) ---
    // Replaces raw per-enemy chance: gives irregular but patterned dive rhythm.
    diveMasterAccMs += deltaMs;
    while (diveMasterAccMs >= DIVE_MASTER_TICK_MS) {
      diveMasterAccMs -= DIVE_MASTER_TICK_MS;

      for (let i = 0; i < diveCounters.length; i++) {
        diveCounters[i] -= 1;
        if (diveCounters[i] <= 0) {
          divePendingTriggers += 1;
          if (i >= 3) divePendingSquadBoost += 1;

          // reset (scaled gently by wave + thin-out)
          const thin = 1.0 - (1.0 - aliveRatio) * 0.22;
          const waveScale = Math.max(0.55, 1.0 - (wave - 1) * 0.03);
          const idxMul = 1.0 + i * 0.08;
          let v = Math.floor(DIVE_COUNTER_BASES[i] * waveScale * thin * idxMul);
          v = clamp(v + grBetween(-3, 4), 4, 120);
          diveCounters[i] = v;
        }
      }

      if (divePendingTriggers > 4) divePendingTriggers = 4;
      if (divePendingSquadBoost > 2) divePendingSquadBoost = 2;
    }

    const divingNow = countActive(enemies, (e) => e.state !== "formation");
    const maxDiversNow = Math.min(MAX_DIVING_ENEMIES, 2 + Math.floor((wave - 1) / 4));
    let avail = maxDiversNow - divingNow;

    if (divePendingTriggers > 0 && avail > 0) {
      const attempts = Math.min(divePendingTriggers, 1 + Math.floor((wave - 1) / 5));
      let used = 0;

      const pickCandidate = () => {
        const pool = formationEnemies.filter(e => e && e.active && e.state === "formation");
        if (!pool.length) return null;

        // weight: lower rows + closer to player x
        let total = 0;
        const wts = [];
        const minY = Math.min(...pool.map(e=>e.y));
        const maxY = Math.max(...pool.map(e=>e.y));
        const ySpan = Math.max(1, maxY - minY);

        for (const e of pool) {
          const yN = (e.y - minY) / ySpan;
          const yW = 0.75 + 0.55 * yN;
          const dx = Math.abs(e.x - player.x);
          const xW = 1.12 - Math.min(0.30, dx / 750);
          const ww = yW * xW;
          wts.push(ww);
          total += ww;
        }

        let r = grFloat() * total;
        for (let i = 0; i < pool.length; i++) {
          r -= wts[i];
          if (r <= 0) return pool[i];
        }
        return pool[pool.length - 1];
      };

      for (let t = 0; t < attempts && avail > 0; t++) {
        const preferBig = (divePendingSquadBoost > 0);
        if (preferBig) divePendingSquadBoost -= 1;

        const gate = preferBig ? 0.90 : (0.62 + Math.min((wave - 1) * 0.02, 0.22));
        if (grFloat() > gate) { used++; continue; }

        const doSquad = preferBig || (grFloat() < (wave <= 1 ? 0.18 : wave <= 4 ? 0.24 : wave <= 8 ? 0.30 : wave <= 12 ? 0.36 : 0.42));
        let want = doSquad ? Math.min(avail, Math.min(5, 1 + Math.floor((wave - 1) / 3) + (grFloat() < 0.25 ? 1 : 0))) : 1;
        if (preferBig && want < 3 && avail >= 3) want = 3;

        for (let k = 0; k < want && avail > 0; k++) {
          const e = pickCandidate();
          if (!e) break;
          startEnemyDive(e);
          avail -= 1;
        }

        used++;
      }

      divePendingTriggers = Math.max(0, divePendingTriggers - used);
    }
  }

  function updateDivingEnemies(deltaMs) {
    const dt = deltaMs / 1000;
    for (const e of enemies) {
      if (!e.active) continue;
      // Tick dive shot cooldown
      if (e.shotCdMs > 0) { e.shotCdMs = Math.max(0, e.shotCdMs - deltaMs); }

      if (e.state === "diveLoop") {
        e.diveTime += dt;
        const t = e.diveTime;
        const phase = t * e.diveLoopSpeed;
        const ang = phase * e.diveLoopDir;
        e.x = e.diveLoopCenterX + Math.cos(ang) * e.diveLoopRadius;
        e.y = e.diveLoopCenterY + Math.sin(ang) * e.diveLoopRadius + t * 30;
        if (phase > Math.PI * 2 * 1.1) e.state = "diveStraight";
      } else if (e.state === "diveStraight") {
        const dx = e.targetX - e.x;
        const dir = Math.sign(dx) || 0;
        e.x += dir * 120 * dt;
        e.y += enemyDiveSpeedY * dt;
        if (e.y > 620) { e.y = -20; e.state = "returning"; }
      } else if (e.state === "returning") {
        e.y -= enemyReturnSpeed * dt;
        const t = clamp((e.homeY - e.y) / (e.homeY + 40), 0, 1);
        e.x = lerp(e.x, e.homeX, easeSineInOut(t));
        if (e.y <= e.homeY) { e.x = e.homeX; e.y = e.homeY; e.state = "formation"; e.diveShotsLeft = 0; e.shotCdMs = 0; }
      }
    }
  }

  function disableBullet(b) {
    if (!b) return;
    b.active = false;
    b.x = -100; b.y = -100;
    b.vx = 0; b.vy = 0;
  }
  function shootPlayerBullet() {
    const onScreen = countActive(playerBullets);
    if (onScreen >= MAX_PLAYER_BULLETS_ONSCREEN) return;
    const b = getFirstDead(playerBullets);
    if (!b) return;
    b.active = true; b.x = player.x; b.y = player.y - 18; b.vx = 0; b.vy = -400;
  }
  function shootEnemyBullet(a, b, isDive = false, shooterObj = null) {
  // Compatible call styles:
  //  - shootEnemyBullet(enemyObj, isDive)
  //  - shootEnemyBullet(x, y, isDive, enemyObj)
  let shooter = null;
  let x = 0, y = 0;
  if (a && typeof a === "object") {
    shooter = a; x = shooter.x; y = shooter.y; isDive = !!b;
  } else {
    x = a; y = b; shooter = shooterObj;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;

  const b0 = getFirstDead(enemyBullets);
  if (!b0) return;

  b0.active = true;
  b0.x = x;
  b0.y = y + (isDive ? 10 : 18);

  const ar = aliveRatioNow();
  const thinMul = 1 + (1 - ar) * THIN_OUT_BULLET_UP;
  const bMul = waveBulletMul(wave);

  let vMin = 500 * ENEMY_SPEED_FACTOR * bMul * thinMul;
  let vMax = 550 * ENEMY_SPEED_FACTOR * bMul * thinMul;
  if (isDive) { vMin *= 1.55; vMax *= 1.55; }
  const vY = grFloatBetween(vMin, vMax);

  let vX = 0;
  if (isDive && player.active) {
    const dy = Math.max(60, player.y - b0.y);
    const t = clamp(dy / Math.max(120, vY), 0.12, 1.05);

    const leadFactor = 0.32 + Math.min((wave - 1) * 0.02, 0.22);
    let targetX = player.x + player.vx * t * leadFactor;

    const exactX = (shooter && shooter.shootExactX != null) ? shooter.shootExactX : null;
    if (Number.isFinite(exactX)) {
      const blend = 0.40 + Math.min((wave - 1) * 0.01, 0.25);
      targetX = targetX * (1 - blend) + exactX * blend;
    }

    const errMax = Math.max(10, 28 - (wave - 1) * 1.2);
    targetX += grFloatBetween(-errMax, errMax);

    vX = clamp((targetX - x) / t, -420, 420);
  } else if (player.active) {
    const aimP = 0.08 + Math.min((wave - 1) * 0.006, 0.10);
    if (grFloat() < aimP) {
      const dy = Math.max(120, player.y - b0.y);
      const t = clamp(dy / Math.max(120, vY), 0.18, 1.3);
      const err = 140;
      const targetX = player.x + grFloatBetween(-err, err);
      vX = clamp((targetX - x) / t, -220, 220);
    }
  }

  b0.vx = vX;
  b0.vy = vY;
}

  function enemyShooting(deltaMs) {
  if (!player.active) return;

  enemyFireCooldownMs -= deltaMs;
  if (enemyFireCooldownMs > 0) return;

  const waveBulletCap = Math.min(MAX_ENEMY_BULLETS, 3 + Math.floor((wave - 1) / 4));
  const enemyBulletsOnScreenNow = enemyBullets.reduce((n,b)=>n+(b.active?1:0),0);
  if (enemyBulletsOnScreenNow >= waveBulletCap) {
    enemyFireCooldownMs = 80 + grBetween(0, 80);
    return;
  }

  const all = enemies.filter(e => e.active);
  if (!all.length) return;

  const formation = all.filter(e => e.state === "formation");
  const diving = all.filter(e => e.state === "diveLoop" || e.state === "diveStraight");

  const pickDiver = (list) => {
    let total = 0;
    const w = [];
    for (const e of list) {
      const ww = 1 / (18 + Math.abs(e.x - player.x));
      w.push(ww); total += ww;
    }
    let r = grFloat() * total;
    for (let i = 0; i < list.length; i++) {
      r -= w[i];
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  };

  const diveReady = diving.filter(e => {
    if ((e.diveShotsLeft || 0) <= 0) return false;
    if ((e.shotCdMs || 0) > 0) return false;
    if (e.y < 120) return false;
    return true;
  });

  const preferDiveChance = (diveReady.length > 0) ? Math.min(0.68 + (wave - 1) * 0.018, 0.93) : 0;

  if (diveReady.length > 0 && grFloat() < preferDiveChance) {
    const shooter = pickDiver(diveReady);

    const exactX = (shooter.shootExactX ?? player.x);
    const alignRange = 52 + Math.min((wave - 1) * 2, 48);
    const aligned = Math.abs(shooter.x - exactX) <= alignRange;

    const fireChance = aligned ? 0.97 : Math.min(0.48 + (wave - 1) * 0.018, 0.86);
    if (grFloat() < fireChance) {
      shootEnemyBullet(shooter.x, shooter.y, true);

      shooter.diveShotsLeft = Math.max(0, (shooter.diveShotsLeft || 0) - 1);

      const cdMin = Math.max(160, 420 - (wave - 1) * 12);
      const cdMax = Math.max(240, 620 - (wave - 1) * 16);
      shooter.shotCdMs = grBetween(cdMin, cdMax);

      shooter.shootExactX = clamp(player.x + grBetween(-95, 95), 60, 740);

      const gMin = Math.max(130, 340 - (wave - 1) * 6);
      const gMax = Math.max(190, 520 - (wave - 1) * 8);
      enemyFireCooldownMs = grBetween(gMin, gMax);
      return;
    }

    enemyFireCooldownMs = 60 + grBetween(0, 60);
    return;
  }

  if (formation.length > 0) {
    const base = 0.08 + Math.min((wave - 1) * 0.006, 0.10);
    const p = (diving.length === 0) ? Math.min(base * 1.8, 0.26) : base;

    if (grFloat() < p) {
      const shooter = formation[grBetween(0, formation.length - 1)];
      shootEnemyBullet(shooter.x, shooter.y, false);

      const gMin = Math.max(220, 720 - (wave - 1) * 10);
      const gMax = Math.max(320, 980 - (wave - 1) * 12);
      enemyFireCooldownMs = grBetween(gMin, gMax);
      return;
    }
  }

  enemyFireCooldownMs = 90 + grBetween(0, 90);
}


function updatePlayerState(deltaMs, mask) {
    // mirror your current main.js behavior (it decrements invuln twice per frame)
    if (invulnerabilityTimer > 0) invulnerabilityTimer -= deltaMs;

    if (playerState === PLAYER_STATE.PLAYING) {
      player.vx = 0;
      const left = (mask & POHP_INPUT_BITS.left) !== 0;
      const right = (mask & POHP_INPUT_BITS.right) !== 0;
      const shoot = (mask & POHP_INPUT_BITS.shoot) !== 0;
      const shootJust = shoot && ((prevMask & POHP_INPUT_BITS.shoot) === 0);

      if (left && player.x > 0) player.vx = -220;
      else if (right && player.x < SCREEN_W) player.vx = 220;

      if (shootCooldown > 0) shootCooldown -= deltaMs;
      if (shootJust && shootCooldown <= 0) { shootPlayerBullet(); shootCooldown = 130; }
    } else if (playerState === PLAYER_STATE.DYING) {
      // mirror your current main.js behavior (respawnTimer decremented twice per frame)
      respawnTimer -= deltaMs;
      if (respawnTimer <= 0) {
        if (lives > 0) {
          player.active = true;
          player.x = 400; player.y = 550; player.vx = 0;
          invulnerabilityTimer = INVULN_DURATION;
          playerState = PLAYER_STATE.PLAYING;
        } else {
          playerState = PLAYER_STATE.GAME_OVER;
        }
      }
    }
  }

  function cleanupBullets() {
    for (const b of playerBullets) if (b.active && b.y < -20) disableBullet(b);
    for (const b of enemyBullets) if (b.active && (b.y > 620 || b.x < -40 || b.x > 840)) disableBullet(b);
  }

  function physicsStep(deltaMs) {
    const dt = deltaMs / 1000;
    if (player.active) player.x = clamp(player.x + player.vx * dt, -10, SCREEN_W + 10);
    for (const b of playerBullets) if (b.active) b.y += b.vy * dt;
    for (const b of enemyBullets) if (b.active) { b.x += b.vx * dt; b.y += b.vy * dt; }
  }
function clearAllBullets() {
  for (const b of playerBullets) if (b.active) disableBullet(b);
  for (const b of enemyBullets) if (b.active) disableBullet(b);
}

function enemyTypeFromKey(key) {
  if (!key) return "blue";
  if (key.includes("flagship")) return "flagship";
  if (key.includes("red")) return "red";
  if (key.includes("purple")) return "purple";
  return "blue";
}

function hitEnemy(bullet, enemy) {
  if (!enemy || !enemy.active) return;

  if (bullet && bullet.active) disableBullet(bullet);
  enemy.active = false;

  // Score: mirror main.js ENEMY_SCORES + dive bonus
  const ENEMY_SCORES = { blue: 50, purple: 80, red: 120, flagship: 150 };
  const t = enemyTypeFromKey(enemy.key);
  let pts = ENEMY_SCORES[t] ?? 50;
  const isDiving = enemy.state && enemy.state !== "formation";
  if (isDiving) pts += 30 + Math.min(120, Math.floor(enemy.diveTime / 250) * 10);
  score += pts;

  // Wave clear
  if (countActive(enemies) === 0 && playerState !== PLAYER_STATE.GAME_OVER) {
    const clearBonus = 250 + wave * 25;
    score += clearBonus;
    wave += 1;
    applyWaveDifficulty(wave);
    clearAllBullets();
    waveSpawnTimer = WAVE_SPAWN_DELAY_MS;
  }
}

function hitPlayer(_bulletOrEnemy) {
  if (playerState !== PLAYER_STATE.PLAYING) return;
  if (invulnerabilityTimer > 0) return;

  lives -= 1;
  player.active = false;
  playerState = PLAYER_STATE.DYING;
  respawnTimer = RESPAWN_DELAY;

  if (lives <= 0) {
    playerState = PLAYER_STATE.GAME_OVER;
    respawnTimer = 0;
  }
}



  function collisionsStep() {
    const pHalfW = (sprite.ship.w * sprite.ship.scale) / 2;
    const pHalfH = (sprite.ship.h * sprite.ship.scale) / 2;

    const enemyHalf = {};
    for (const k of ["enemy_blue", "enemy_red", "enemy_purple", "enemy_flagship"]) {
      enemyHalf[k] = { halfW: (sprite[k].w * sprite[k].scale) / 2, halfH: (sprite[k].h * sprite[k].scale) / 2 };
    }
    const pbHalfW = (sprite.bullet_player.w * sprite.bullet_player.scale) / 2;
    const pbHalfH = (sprite.bullet_player.h * sprite.bullet_player.scale) / 2;
    const ebHalfW = (sprite.bullet_enemy.w * sprite.bullet_enemy.scale) / 2;
    const ebHalfH = (sprite.bullet_enemy.h * sprite.bullet_enemy.scale) / 2;

    // player bullets vs enemies
    for (const b of playerBullets) {
      if (!b.active) continue;
      const a = makeAABB(b.x, b.y, pbHalfW, pbHalfH);
      for (const e of enemies) {
        if (!e.active) continue;
        const half = enemyHalf[e.key] || { halfW: 10, halfH: 10 };
        const bb = makeAABB(e.x, e.y, half.halfW, half.halfH);
        if (aabbOverlap(a, bb)) { hitEnemy(b, e); break; }
      }
    }

    if (player.active) {
      const pBox = makeAABB(player.x, player.y, pHalfW, pHalfH);

      for (const b of enemyBullets) {
        if (!b.active) continue;
        if (aabbOverlap(pBox, makeAABB(b.x, b.y, ebHalfW, ebHalfH))) { hitPlayer(b); break; }
      }
      for (const e of enemies) {
        if (!e.active) continue;
        const half = enemyHalf[e.key] || { halfW: 10, halfH: 10 };
        if (aabbOverlap(pBox, makeAABB(e.x, e.y, half.halfW, half.halfH))) { hitPlayer(e); break; }
      }
    }
  }

  for (let i = 0; i < frames; i++) {
    const deltaMs = deltas[i];
    const mask = masks[i];

    // physics + overlaps before update() (Arcade step)
    physicsStep(deltaMs);
    collisionsStep();

    // your update() decrements these before updatePlayerState
    if (respawnTimer > 0) respawnTimer -= deltaMs;
    if (invulnerabilityTimer > 0) invulnerabilityTimer -= deltaMs;

    if (waveSpawnTimer > 0) {
      waveSpawnTimer -= deltaMs;
      if (waveSpawnTimer <= 0) createEnemyFormation();
    }

    if (playerState === PLAYER_STATE.GAME_OVER) break;

    updatePlayerState(deltaMs, mask);
    updateEnemyFormation(deltaMs);
    updateDivingEnemies(deltaMs);
    enemyShooting(deltaMs);
    cleanupBullets();

    prevMask = mask;
  }

  return { ok: true, score, wave, lives, ended: playerState === PLAYER_STATE.GAME_OVER, frames, totalMs };
}

module.exports = { simulateRunPackage };
