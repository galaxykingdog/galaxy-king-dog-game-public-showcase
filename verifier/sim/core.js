// verifier/sim/core.js (headless deterministic re-simulation)
// ---------------------------------------------------------------------------
// This file is a Phaser-free, mainnet-grade deterministic replay core.
// It is designed to match src/main.js ruleset:
//   POHP_GAME_VERSION = "GKD|RULESET=v1.4.0|BUILD=main.js"
//
// Important: The intent is *bit-for-bit* determinism for score + wave.
// ---------------------------------------------------------------------------

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// -------------------- small math helpers --------------------
function clamp(v, a, b) {
  v = Number(v);
  if (!Number.isFinite(v)) return a;
  return Math.max(a, Math.min(b, v));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Minimal Phaser Math stubs so we can keep logic close to main.js
const Phaser = {
  Math: {
    Clamp: clamp,
    Linear: lerp,
    Angle: {
      RotateTo: (_cur, target /*, step */) => target,
      Wrap: (a) => a,
    },
  },
};

// -------------------- base64 helpers (same packing as main.js) --------------------
function b64ToU8(b64) {
  const bin = Buffer.from(b64, 'base64');
  return new Uint8Array(bin);
}

function b64ToU16(b64) {
  const bytes = Buffer.from(b64, 'base64');
  const u16 = new Uint16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < u16.length; i++) {
    u16[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  }
  return u16;
}

// -------------------- optional PNG size (for closer hitboxes) --------------------
function readPngSize(absPath) {
  const buf = fs.readFileSync(absPath);
  // PNG IHDR chunk starts at byte 16
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { w, h };
}

// -------------------- POHP RNG (same as main.js) --------------------
function POHP_mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -------------------- sprites / groups (Phaser-free stubs) --------------------
function makeBody(sprite) {
  return {
    enable: true,
    width: 0,
    height: 0,
    reset: (x, y) => {
      sprite.x = x;
      sprite.y = y;
    },
    setVelocity: (vx, vy) => {
      sprite.vx = vx;
      sprite.vy = vy;
    },
    setVelocityX: (vx) => {
      sprite.vx = vx;
    },
    setVelocityY: (vy) => {
      sprite.vy = vy;
    },
    setSize: (w, h) => {
      sprite.body.width = w;
      sprite.body.height = h;
    },
    setOffset: () => {},
  };
}

function makeSprite(key, x, y) {
  const s = {
    key,
    x,
    y,
    vx: 0,
    vy: 0,
    rotation: 0,
    active: true,
    visible: true,
    alpha: 1,
    scale: 1,
    data: Object.create(null),
    body: null,
    setData(k, v) { this.data[k] = v; return this; },
    getData(k) { return this.data[k]; },
    setActive(v) { this.active = !!v; return this; },
    setVisible(v) { this.visible = !!v; return this; },
    setAlpha(a) { this.alpha = a; return this; },
    setScale(scl) { this.scale = Number(scl) || 1; return this; },
    setPosition(nx, ny) { this.x = nx; this.y = ny; return this; },
    setVelocity(vx, vy) { this.vx = vx; this.vy = vy; return this; },
    setVelocityX(vx) { this.vx = vx; return this; },
    setVelocityY(vy) { this.vy = vy; return this; },
    setCollideWorldBounds() { return this; },
    setRotation(r) { this.rotation = Number(r) || 0; return this; },
  };
  s.body = makeBody(s);
  return s;
}

function makeGroup(factoryKey) {
  const g = {
    children: { entries: [] },
    create(x, y, key) {
      const s = makeSprite(key || factoryKey || 'sprite', x, y);
      this.children.entries.push(s);
      return s;
    },
    getFirstDead() {
      return this.children.entries.find(s => !s.active) || null;
    },
  };
  return g;
}

function countActive(entries) {
  return entries.filter(x => x && x.active).length;
}

// -------------------- RULESET constants (copied from src/main.js v1.3.1) --------------------

// screen
const SCREEN_W = 800;
const SCREEN_H = 600;

// Player
const PLAYER_START_X = 400;
const PLAYER_START_Y = 550;
const PLAYER_SPEED = 220;
const SHIP_SCALE = 0.8;

// bullets
const MAX_PLAYER_BULLETS_ONSCREEN = 3;
const BULLET_PLAYER_SCALE = 0.6;
const BULLET_ENEMY_SCALE = 0.5;
const PLAYER_BULLET_VY = -400;

// enemy formation geometry
const FORMATION_CENTER_X = 400;
const ENEMY_SPACING_X = 50;
const ENEMY_SPACING_Y = 44;
const ENEMY_START_Y = 90;
const FORMATION_Y_OFFSET = -40;
const FORMATION_STEP_DOWN = 8;
const FORMATION_LOWEST_Y_MAX = 320;

// formation movement
const FORMATION_SPEED_MUL = 1.55;
const FORMATION_SWAY_PERIOD_MS = 1700;
const FORMATION_SWAY_AMP_MIN = 8;
const FORMATION_SWAY_AMP_PER_WAVE = 0.55;
const FORMATION_SWAY_AMP_MAX = 18;
const FORMATION_HARD_BOUND_L = 40;
const FORMATION_HARD_BOUND_R = 760;

// difficulty
const ENEMY_SPEED_FACTOR = (1 / 3.5);
const ENEMY_CHANCE_FACTOR = 1.15;
const DIFFICULTY_SCALE = 0.80;

const PER_WAVE_SPEED_UP = 0.018;
const PER_WAVE_BULLET_UP = 0.014;
const WAVE_SPEED_MUL_CAP  = 1.95;
const WAVE_RATE_MUL_CAP   = 1.85;
const WAVE_BULLET_MUL_CAP = 1.90;
const PER_WAVE_RATE_UP  = 0.012;

// thin-out
const THIN_OUT_SPEED_UP = 0.35;

// respawn/invuln
const RESPAWN_DELAY = 800;
const INVULN_DURATION = 1600;
const START_INVULN = 900;
const DIVE_EXIT_Y = 650;
const RETURN_ENTRY_Y = -12;

// wave clear delay
const WAVE_CLEAR_DELAY_MS = 750;

// Enemy rotation (cosmetic only in headless)
const ENEMY_ROT_OFFSET = -Math.PI / 2;
const ENEMY_FORMATION_ROT = Math.PI;
const ENEMY_DIVE_ROT = ENEMY_FORMATION_ROT;
const ENEMY_RETURN_ROT = ENEMY_FORMATION_ROT + Math.PI;
const ENEMY_ROT_SPEED_DIVE = 10.0;
const ENEMY_ROT_SPEED_RETURN = 8.0;

// scores (main.js)
const ENEMY_SCORES = { flagship: 150, red: 100, purple: 80, blue: 30 };

// Enemy AI kernels (main.js)
const ENEMY_AI_KERNELS = {
  flagship: {
    iq: 0.70,
    aim: 0.20,
    volley: 0.85,
    flankBias: 0.65,
    patience: 0.70,
    punish: 0.75,
    feint: 0.35,
    mark: 0.60,
    scout: 0.40,
    gunner: 0.45,
    dive: 0.45,
    returnTight: 0.60,
  },
  red: {
    iq: 0.55,
    aim: 0.12,
    volley: 0.55,
    flankBias: 0.35,
    patience: 0.55,
    punish: 0.55,
    feint: 0.18,
    mark: 0.25,
    scout: 0.10,
    gunner: 0.70,
    dive: 0.35,
    returnTight: 0.50,
  },
  purple: {
    iq: 0.62,
    aim: 0.15,
    volley: 0.50,
    flankBias: 0.30,
    patience: 0.70,
    punish: 0.60,
    feint: 0.28,
    mark: 0.55,
    scout: 0.55,
    gunner: 0.35,
    dive: 0.40,
    returnTight: 0.60,
  },
  blue: {
    iq: 0.35,
    aim: 0.08,
    volley: 0.25,
    flankBias: 0.20,
    patience: 0.45,
    punish: 0.28,
    feint: 0.10,
    mark: 0.10,
    scout: 0.08,
    gunner: 0.25,
    dive: 0.25,
    returnTight: 0.40,
  },
};

// -------------------- game-phase and input bits --------------------
const GAME_PHASE = { START: 0, RUNNING: 1, GAME_OVER: 2 };
const PLAYER_STATE = { PLAYING: 0, DYING: 1, RESPAWNING: 2 };
const POHP_INPUT_BITS = { LEFT: 1, RIGHT: 2, SHOOT: 4 };

// -------------------- AI / formation intel (ported) --------------------
const EXP_SWARM_MOODS = true;
const EXP_LANE_HEATMAP = true;
const AI_SELF_IMPROVE = true;
const EXP_PRESSURE_GOVERNOR = true;
const EXP_CALM_PULSES = true;
const EXP_LATE_GAME_BRAKES = true;
const EXP_FEINT_NUDGE = true;

let formationIntel = null;
let aiLearn = null;
let aiPressureMul = 1.0;
let aiCalmMs = 0;
let aiCalmT = 0;

function AI_clamp01(x) { return clamp(x, 0, 1); }

function AI_getKernel(type) {
  return ENEMY_AI_KERNELS[type] || ENEMY_AI_KERNELS.blue;
}

function AI_initFormationIntel() {
  formationIntel = {
    mood: 'CALM',
    moodMs: 0,
    lastShotMs: 999999,
    lastKillMs: 999999,
    heat: new Array(9).fill(0),
    heatMs: 0,
    lastPlayerX: PLAYER_START_X,
    drift: 0,
    diveHunger: 0,
    punish: 0,
  };
}

function AI_initLearn() {
  aiLearn = {
    level: 0,
    hits: 0,
    kills: 0,
    hotLane: 4,
    hotLaneX: null,
    patience: 0,
  };
}

function AI_snapLane(x) {
  const lanes = 9;
  const minX = 80;
  const maxX = 720;
  const w = (maxX - minX) / (lanes - 1);
  const idx = Phaser.Math.Clamp(Math.round((x - minX) / w), 0, lanes - 1);
  return { idx, x: minX + idx * w };
}

function AI_predictPlayerXAtY(_targetY, playerX, vx) {
  // in v1.3.1 bullets are vertical, so prediction only helps lane choice.
  // We'll keep a light, deterministic estimate based on current velocity.
  const est = playerX + vx * 0.10;
  return Phaser.Math.Clamp(est, 40, 760);
}

function AI_tickFormationIntel(delta, playerX, playerVx) {
  if (!formationIntel) AI_initFormationIntel();
  const fi = formationIntel;

  fi.moodMs += delta;
  fi.lastShotMs += delta;
  fi.lastKillMs += delta;

  if (EXP_LANE_HEATMAP) {
    fi.heatMs += delta;
    // decay
    for (let i = 0; i < fi.heat.length; i++) fi.heat[i] *= Math.pow(0.9992, delta);

    const lane = AI_snapLane(playerX);
    fi.heat[lane.idx] += 0.018 * (delta / 16.67);
    // clamp
    for (let i = 0; i < fi.heat.length; i++) fi.heat[i] = Math.min(fi.heat[i], 2.5);
  }

  // drift estimate
  const dx = playerX - fi.lastPlayerX;
  fi.lastPlayerX = playerX;
  fi.drift = Phaser.Math.Clamp(0.85 * fi.drift + 0.15 * dx, -160, 160);

  // hunger / punish slowly rise
  fi.diveHunger = Phaser.Math.Clamp(fi.diveHunger + 0.0025 * (delta / 16.67), 0, 1.2);
  fi.punish = Phaser.Math.Clamp(fi.punish + 0.0020 * (delta / 16.67), 0, 1.2);

  // mood switching (deterministic)
  if (EXP_SWARM_MOODS) {
    // calm pulse window
    const calmPulse = (EXP_CALM_PULSES && aiCalmMs > 0);
    if (calmPulse) {
      fi.mood = 'CALM';
      fi.moodMs = 0;
      fi.diveHunger *= 0.75;
      fi.punish *= 0.65;
      return;
    }

    // simple state logic (same spirit as main)
    // if player has been stable in a lane, go PROBE; if high pressure, PUNISH.
    const heatMax = Math.max(...fi.heat);
    const pressure = aiPressureMul;

    if (pressure > 1.35 || heatMax > 1.6) {
      if (fi.mood !== 'PUNISH') { fi.mood = 'PUNISH'; fi.moodMs = 0; }
    } else if (fi.moodMs > 2400 && heatMax > 1.0) {
      if (fi.mood !== 'PROBE') { fi.mood = 'PROBE'; fi.moodMs = 0; }
    } else if (fi.moodMs > 4200) {
      // occasionally FEINT
      if (EXP_FEINT_NUDGE && fi.mood !== 'FEINT' && heatMax > 0.8) {
        fi.mood = 'FEINT'; fi.moodMs = 0;
      } else {
        fi.mood = 'CALM'; fi.moodMs = 0;
      }
    }
  }
}

function AI_brakeFactor(wave) {
  if (!EXP_LATE_GAME_BRAKES) return 1.0;
  const w = Math.max(1, wave);
  // soft brakes late game
  const late = Math.max(0, w - 18);
  return Phaser.Math.Clamp(1.0 - late * 0.012, 0.70, 1.0);
}

function AI_tickLateFunGovernor(delta, wave, lives) {
  if (!EXP_LATE_GAME_BRAKES) return;
  // Keep parity with main.js semantics: this is a brake multiplier, never > 1.
  const late = Phaser.Math.Clamp(1 - Math.exp(-Math.max(0, wave - 1) / 12), 0, 1);
  const struggle = (lives <= 1) ? 0.18 : (lives === 2) ? 0.08 : 0.0;
  const skill = (AI_SELF_IMPROVE && aiLearn) ? (aiLearn.level || 0) : 0;

  let target = Phaser.Math.Clamp(0.58 + 0.08 * skill - 0.04 * struggle - 0.08 * late, 0.52, 0.68);
  target *= AI_brakeFactor(wave);
  if (aiCalmMs > 0) target = Math.min(target, 0.78);

  aiPressureMul = Phaser.Math.Clamp(aiPressureMul * 0.90 + target * 0.10, 0.55, 1.0);

  if (EXP_CALM_PULSES) {
    aiCalmT += delta;
    const period = 15000 + Math.min(9000, Math.max(0, wave - 1) * 280);
    if (aiCalmT >= period) {
      aiCalmT = 0;
      aiCalmMs = 1050 + Math.min(900, Math.max(0, wave - 1) * 25);
    }
    if (aiCalmMs > 0) aiCalmMs = Math.max(0, aiCalmMs - delta);
  }
}

function AI_learnTick(delta) {
  if (!AI_SELF_IMPROVE || !aiLearn) return;
  // small decay so learning is not runaway
  const d = delta / 16.67;
  aiLearn.patience = lerp(aiLearn.patience || 0, 0, 0.01 * d);
}

function AI_onPlayerHit() {
  if (!AI_SELF_IMPROVE || !aiLearn) return;
  aiLearn.hits = (aiLearn.hits || 0) + 1;
  // mercy: calm window
  if (EXP_PRESSURE_GOVERNOR) {
    aiCalmMs = 900;
  }
}

function AI_onEnemyKilled() {
  if (!AI_SELF_IMPROVE || !aiLearn) return;
  aiLearn.kills = (aiLearn.kills || 0) + 1;
  const k = aiLearn.kills;
  // level-up slowly
  if (k === 15 || k === 40 || k === 70 || k === 110) {
    aiLearn.level = (aiLearn.level || 0) + 1;
  }
}

// -------------------- wave multipliers (main.js) --------------------
function waveSpeedMul(w) {
  return Math.min(WAVE_SPEED_MUL_CAP, 1 + (w - 1) * PER_WAVE_SPEED_UP);
}
function waveRateMul(w) {
  return Math.min(WAVE_RATE_MUL_CAP, 1 + (w - 1) * PER_WAVE_RATE_UP);
}
function waveBulletMul(w) {
  return Math.min(WAVE_BULLET_MUL_CAP, 1 + (w - 1) * PER_WAVE_BULLET_UP);
}

// -------------------- difficulty setter (main.js) --------------------
let enemySpeedBase = 30;
let enemyDiveBaseChance = 0.001;
let enemyBulletBaseChance = 0.0004;

function applyWaveDifficulty(w) {
  // Match src/main.js v1.4.0 wave ramp.
  const ww = Math.max(1, w);
  const x = Math.max(0, ww - 1);
  const late = Phaser.Math.Clamp(1 - Math.exp(-x / 14), 0, 1);

  const baseSpeed = 28 + 34 * late + Math.min(16, 0.65 * x);
  const baseDiveChance = 0.00085 + 0.00110 * late + Math.min(0.00024, 0.00002 * x);
  const baseBulletChance = 0.00055 + 0.00095 * late + Math.min(0.00026, 0.00002 * x);

  const sMul = waveSpeedMul(ww);
  const rMul = waveRateMul(ww);
  enemySpeedBase = baseSpeed * ENEMY_SPEED_FACTOR * sMul * DIFFICULTY_SCALE;
  enemyDiveBaseChance = baseDiveChance * ENEMY_CHANCE_FACTOR * rMul * DIFFICULTY_SCALE;
  enemyBulletBaseChance = baseBulletChance * ENEMY_CHANCE_FACTOR * rMul * DIFFICULTY_SCALE;
}

// -------------------- bullets: body sizing + caps (main.js) --------------------
let ENEMY_BULLET_SPEED_PPS = 260;

function maxEnemyBulletsNow(wave) {
  if (wave <= 2) return 5;
  if (wave <= 5) return 6;
  if (wave <= 9) return 7;
  return 8;
}

function setupBulletBody(sprite, kind, texSizes) {
  // mimic main.js setupBulletBody() (centered skinny body)
  const isPlayer = (kind === 'player');
  const wMul = isPlayer ? 0.55 : 0.65;
  const hMul = isPlayer ? 0.90 : 0.92;

  const key = isPlayer ? 'bullet_player' : 'bullet_enemy';
  const t = texSizes[key] || { w: 32, h: 32 };
  const displayW = t.w * sprite.scale;
  const displayH = t.h * sprite.scale;

  const bodyW = displayW * wMul;
  const bodyH = displayH * hMul;

  sprite.body.setSize(bodyW, bodyH);
  // offset is irrelevant in our center-based collider
}

// -------------------- dive scheduler (ported from main.js) --------------------
// This creates the classic “irregular but patterned” Galaxian rhythm.
const DIVE_MASTER_TICK_MS = 80;
const DIVE_COUNTER_BASES = [12, 20, 28, 38, 54];
let diveMasterAccMs = 0;
let diveCounters = DIVE_COUNTER_BASES.slice();
let divePendingTriggers = 0;
let divePendingSquadBoost = 0;

const MAX_DIVING_ENEMIES = 6;

let enemyFormation = []; // 2D
let enemyDirection = 1;
let diveBurstQueue = [];
let lastDiverKey = '';

function aliveRatioNow(enemies) {
  const alive = enemies.children.entries.filter(e => e.active).length;
  const total = enemies.children.entries.length || 1;
  return alive / total;
}

function diveCounterReset(baseTicks, w, idx, isInit, enemies) {
  const ar = aliveRatioNow(enemies);
  const thin = 1.0 - (1.0 - ar) * 0.22;
  const waveScale = Math.max(0.55, 1.0 - (w - 1) * 0.03);
  const idxMul = 1.0 + idx * 0.08;
  let v = Math.floor(baseTicks * waveScale * thin * idxMul);
  v = Phaser.Math.Clamp(v, 6, 120);
  const j = isInit ? POHP_grBetween(-2, 2) : POHP_grBetween(-3, 4);
  v = Math.max(4, v + j);
  return v;
}

function squadTriggerGateChance(w, ar) {
  const base = (w <= 2) ? 0.28 : (w <= 6) ? 0.33 : (w <= 12) ? 0.38 : 0.42;
  const thin = 1.0 + (1.0 - ar) * 0.28;
  const calm = (aiCalmMs > 0) ? 0.72 : 1.0;
  const brake = AI_brakeFactor(w);
  return Phaser.Math.Clamp(base * thin * calm * brake, 0.12, 0.70);
}

function diveBurstCountForWave(w) {
  if (w <= 1) return 1;
  if (w <= 3) return 1 + (POHP_grChance(0.25) ? 1 : 0);
  if (w <= 7) return 1 + (POHP_grChance(0.45) ? 1 : 0);
  if (w <= 15) return 2 + (POHP_grChance(0.35) ? 1 : 0);
  return 2 + (POHP_grChance(0.50) ? 1 : 0);
}

function buildDiveBurstQueue(enemies, w) {
  const list = enemies.children.entries.filter(e => e.active && e.getData('state') === 'formation');
  if (!list.length) return [];

  const ar = aliveRatioNow(enemies);
  const want = diveBurstCountForWave(w);

  const out = [];
  const byType = (t) => list.filter(e => e.getData('type') === t);
  const pickOne = (arr) => {
    if (!arr.length) return null;
    // avoid picking exact same as last
    let tries = 0;
    while (tries++ < 4) {
      const e = arr[POHP_grInt(arr.length)];
      const k = e.getData('key') || '';
      if (k !== lastDiverKey) { lastDiverKey = k; return e; }
    }
    const e = arr[POHP_grInt(arr.length)];
    lastDiverKey = e.getData('key') || '';
    return e;
  };

  // weight toward higher tiers a bit later / thinner
  const flagshipChance = Phaser.Math.Clamp(0.10 + (w - 1) * 0.01 + (1.0 - ar) * 0.12, 0.08, 0.35);
  const redChance = Phaser.Math.Clamp(0.20 + (w - 1) * 0.01 + (1.0 - ar) * 0.10, 0.15, 0.45);
  const purpleChance = Phaser.Math.Clamp(0.25 + (w - 1) * 0.01 + (1.0 - ar) * 0.08, 0.18, 0.48);

  for (let i = 0; i < want; i++) {
    let e = null;
    const r = POHP_grFloat();
    if (r < flagshipChance) e = pickOne(byType('flagship'));
    if (!e && r < flagshipChance + redChance) e = pickOne(byType('red'));
    if (!e && r < flagshipChance + redChance + purpleChance) e = pickOne(byType('purple'));
    if (!e) e = pickOne(byType('blue'));
    if (!e) e = pickOne(list);
    if (e) out.push(e);
  }

  // gate for squad extra burst
  const gate = squadTriggerGateChance(w, ar);
  if (divePendingSquadBoost > 0 && POHP_grChance(gate)) {
    const extra = (w <= 3) ? 1 : 2;
    for (let j = 0; j < extra; j++) {
      const e = pickOne(list);
      if (e) out.push(e);
    }
    divePendingSquadBoost = 0;
  }
  return out;
}

const ENEMY_STUCK_OFFSCREEN_MS = 1600;
const ENEMY_MAX_DIVE_MS = 9000;
const ENEMY_MAX_RETURN_MS = 4500;
const ENEMY_SANITY_MIN_X = -120;
const ENEMY_SANITY_MAX_X = 920;
const ENEMY_SANITY_MIN_Y = -220;
const ENEMY_SANITY_MAX_Y = 860;

function forceEnemyWrapToReturn(e) {
  if (!e) return;
  const homeX = e.getData('homeX');
  const homeY = e.getData('homeY');

  e.x = Number.isFinite(homeX) ? homeX : e.x;
  e.y = RETURN_ENTRY_Y;
  e.setVisible(true).setActive(true);
  if (e.body) {
    e.body.enable = true;
    e.body.reset(e.x, e.y);
    e.body.setVelocity(0, 0);
  }

  e.setData('returnY', Number.isFinite(homeY) ? homeY : 120);
  e.setData('state', 'returning');
  e.setData('stateMs', 0);
  e.setData('offscreenMs', 0);
  e.setData('loopT', 0);
}

function forceEnemyToFormation(e) {
  if (!e) return;
  const homeX = e.getData('homeX');
  const homeY = e.getData('homeY');

  e.x = Number.isFinite(homeX) ? homeX : e.x;
  e.y = Number.isFinite(homeY) ? homeY : 120;
  e.setVisible(true).setActive(true);
  if (e.body) {
    e.body.enable = true;
    e.body.reset(e.x, e.y);
    e.body.setVelocity(0, 0);
  }

  e.setData('state', 'formation');
  e.setRotation(ENEMY_FORMATION_ROT);
  e.setData('stateMs', 0);
  e.setData('offscreenMs', 0);
  e.setData('loopT', 0);
}

function setEnemyRotationFromVelocity(e, dt) {
  const st = e.getData('state');
  const d = (typeof dt === 'number' && dt > 0) ? dt : 0.016;
  if (st === 'diveLoop' || st === 'diveStraight') {
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ENEMY_DIVE_ROT, ENEMY_ROT_SPEED_DIVE * d);
    return;
  }
  if (st === 'formation') {
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ENEMY_FORMATION_ROT, ENEMY_ROT_SPEED_RETURN * d);
    return;
  }
  if (st === 'returning') {
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ENEMY_RETURN_ROT, ENEMY_ROT_SPEED_RETURN * d);
    return;
  }
}

function startEnemyDive(e, playerX, w) {
  if (!e || !e.active) return;
  e.setData('state', 'diveLoop');
  e.setData('loopT', 0);
  e.setData('stateMs', 0);
  e.setData('offscreenMs', 0);

  const dir = (e.x < 400) ? -1 : 1;
  const radius = 85;
  const cx = e.x + dir * radius;
  const cy = e.y + 20;
  e.setData('loopDir', dir);
  e.setData('loopRadius', radius);
  e.setData('loopCenterX', cx);
  e.setData('loopCenterY', cy);

  const targetX = Phaser.Math.Clamp(
    Number.isFinite(playerX) ? POHP_grBetween(playerX - 140, playerX + 140) : POHP_grBetween(150, 650),
    40,
    760
  );
  e.setData('diveTargetX', targetX);
  e.setData('lastX', e.x);
  e.setData('lastY', e.y);
}

// -------------------- enemy shooting state --------------------
let enemyFireBudget = 0;
let enemyFireTimerMs = 0;
let enemyFireCooldownMs = 0;

let formationFireTimerMs = 0;
let formationVolleyTimerMs = 0;
let formationVolleyLeft = 0;
let formationVolleyGapMs = 80;
let formationVolleyPlanCols = [];
let formationVolleyPlanIdx = 0;
let formationShootExactX = 0;
let formationGroupSide = 0;
let formationGroupSideHoldMs = 0;

// feints
let formationFeintMs = 0;
let formationFeintDir = 0;

function resetFireDirectorForWave(w) {
  enemyFireBudget = 0;
  enemyFireTimerMs = 0;
  enemyFireCooldownMs = 0;
  formationFireTimerMs = 0;
  formationVolleyTimerMs = 0;
  formationVolleyLeft = 0;
  formationVolleyGapMs = (w <= 2) ? 90 : (w <= 6) ? 80 : 70;
  formationVolleyPlanCols = [];
  formationVolleyPlanIdx = 0;
  formationShootExactX = 0;
  formationGroupSide = 0;
  formationGroupSideHoldMs = 0;
  formationFeintMs = 0;
  formationFeintDir = 0;
}

function enemyShooting(delta, ctx) {
  const { enemies, enemyBullets, player, wave } = ctx;
  if (!enemies || !player) return;

  // tick intel + governors
  AI_tickFormationIntel(delta, player.x, player.vx);

  // global budgets
  const ar = aliveRatioNow(enemies);
  const thinMul = 1.0 + (1.0 - ar) * 0.20;
  const brake = AI_brakeFactor(wave);
  const calm = (aiCalmMs > 0) ? 0.75 : 1.0;

  // budget grows ~ bullets/sec
  const baseBps = 0.42 + Math.min(0.95, (wave - 1) * 0.06);
  const bps = baseBps * thinMul * brake * calm;
  enemyFireBudget += bps * (delta / 1000);
  enemyFireBudget = Math.min(enemyFireBudget, 5.0);

  // cadence timer
  enemyFireTimerMs += delta;
  const fireTickMs = Phaser.Math.Clamp(160 - (wave - 1) * 4, 90, 160);
  if (enemyFireTimerMs < fireTickMs) return;
  enemyFireTimerMs = 0;

  // enforce bullet cap
  const maxEB = maxEnemyBulletsNow(wave);
  const waveBulletCap = Math.max(3, Math.floor(maxEB * 0.75));
  if (countActive(enemyBullets.children.entries) >= waveBulletCap) return;
  if (enemyFireBudget < 1.0) return;

  // pick a shooter: prefer formation gunners / leaders
  const all = enemies.children.entries;
  const formation = all.filter(e => e.active && e.getData('state') === 'formation');
  const divers = all.filter(e => e.active && (e.getData('state') === 'diveLoop' || e.getData('state') === 'diveStraight'));
  if (!formation.length && !divers.length) return;

  // decide source group
  let useDiver = false;
  if (divers.length && formation.length) {
    // divers shoot more often later
    const p = Phaser.Math.Clamp(0.12 + (wave - 1) * 0.012 + (1 - ar) * 0.08, 0.12, 0.42);
    useDiver = POHP_grChance(p);
  } else if (divers.length) {
    useDiver = true;
  }

  let shooter = null;
  const pickFrom = (arr) => arr[POHP_grInt(arr.length)];
  if (useDiver) {
    shooter = pickFrom(divers);
  } else {
    // favor gunners (red), then purple, then flagship, then blue
    // Match main.js behavior closer: formation shooters are chosen from frontline columns.
    const byCol = new Map();
    for (const e of formation) {
      const col = e.getData('col') ?? 0;
      const cur = byCol.get(col);
      if (!cur || e.y > cur.y) byCol.set(col, e);
    }
    const frontline = Array.from(byCol.values());
    const reds = frontline.filter(e => e.getData('type') === 'red');
    const purps = frontline.filter(e => e.getData('type') === 'purple');
    const flags = frontline.filter(e => e.getData('type') === 'flagship');
    const blues = frontline.filter(e => e.getData('type') === 'blue');
    const r = POHP_grFloat();
    shooter = (r < 0.38 && reds.length) ? pickFrom(reds)
      : (r < 0.62 && purps.length) ? pickFrom(purps)
      : (r < 0.74 && flags.length) ? pickFrom(flags)
      : (blues.length ? pickFrom(blues) : pickFrom(frontline.length ? frontline : formation));
  }

  if (!shooter) return;

  // fire
  shootEnemyBullet(shooter, ctx);
  enemyFireBudget -= 1.0;
  if (enemyFireBudget < 0) enemyFireBudget = 0;
}

function shootEnemyBullet(enemy, ctx) {
  const { enemyBullets, player, texSizes, wave } = ctx;
  const maxEB = maxEnemyBulletsNow(wave);
  if (countActive(enemyBullets.children.entries) >= maxEB) return;

  let bullet = enemyBullets.getFirstDead(false);
  if (!bullet) {
    bullet = enemyBullets.create(0, 0, 'bullet_enemy');
  }

  bullet.setActive(true).setVisible(true).setScale(BULLET_ENEMY_SCALE);
  setupBulletBody(bullet, 'enemy', texSizes);

  const x = enemy.x;
  const y = enemy.y + 16;
  bullet.setPosition(x, y);
  bullet.body.enable = true;
  bullet.body.reset(x, y);

  // v1.3.1 forced vertical bullets
  bullet.body.setVelocity(0, ENEMY_BULLET_SPEED_PPS);
}

// -------------------- formation movement + dive tick (adapted from main) --------------------
let formationSwayMs = 0;
let formationSwayPrev = 0;
let formationMoveAccPx = 0;

function updateEnemyFormation(delta, ctx) {
  const { enemies, player, wave } = ctx;
  const es = enemies.children.entries;
  if (!es.length) return;
  const dt = delta / 1000;

  let leftmostX = 800;
  let rightmostX = 0;
  let lowestY = 0;
  let found = false;
  const formationEnemies = [];

  for (const e of es) {
    if (!e.active) continue;
    if (e.getData('state') !== 'formation') continue;
    found = true;
    formationEnemies.push(e);
    leftmostX = Math.min(leftmostX, e.x);
    rightmostX = Math.max(rightmostX, e.x);
    lowestY = Math.max(lowestY, e.y);
  }

  // Match main.js: bounce on 50/750 edges, then optional capped step-down.
  let moveDown = false;
  if (found) {
    if (rightmostX >= 750 && enemyDirection > 0) {
      enemyDirection = -1;
      moveDown = true;
    } else if (leftmostX <= 50 && enemyDirection < 0) {
      enemyDirection = 1;
      moveDown = true;
    }
  }

  let stepDown = 0;
  if (moveDown && lowestY < FORMATION_LOWEST_Y_MAX) {
    stepDown = Math.min(FORMATION_STEP_DOWN, FORMATION_LOWEST_Y_MAX - lowestY);
  }

  const ar = aliveRatioNow(enemies);
  const thinMul = 1 + (1 - ar) * THIN_OUT_SPEED_UP;
  const speedBrake = 0.88 + 0.12 * (aiPressureMul || 1);
  const currentSpeed = enemySpeedBase * thinMul * speedBrake;

  formationSwayMs += delta;
  const amp = Phaser.Math.Clamp(
    FORMATION_SWAY_AMP_MIN + wave * FORMATION_SWAY_AMP_PER_WAVE,
    FORMATION_SWAY_AMP_MIN,
    FORMATION_SWAY_AMP_MAX
  );
  const omega = (Math.PI * 2) / FORMATION_SWAY_PERIOD_MS;
  const swayNow = Math.round(Math.sin(formationSwayMs * omega) * amp);
  const swayDelta = swayNow - formationSwayPrev;
  formationSwayPrev = swayNow;

  formationMoveAccPx += (currentSpeed * FORMATION_SPEED_MUL * enemyDirection * dt);
  let stepDx = (formationMoveAccPx | 0);
  formationMoveAccPx -= stepDx;

  let dx = stepDx + swayDelta;

  if (EXP_FEINT_NUDGE && formationFeintMs > 0) {
    formationFeintMs = Math.max(0, formationFeintMs - (dt * 1000));
    dx += (formationFeintDir > 0 ? 2 : -2);
  }

  if (found && dx !== 0) {
    const newLeft = leftmostX + dx;
    const newRight = rightmostX + dx;
    if (newRight > FORMATION_HARD_BOUND_R) dx -= (newRight - FORMATION_HARD_BOUND_R);
    if (newLeft < FORMATION_HARD_BOUND_L) dx += (FORMATION_HARD_BOUND_L - newLeft);
  }

  for (const e of formationEnemies) {
    if (dx !== 0) e.x += dx;
    if (stepDown > 0) e.y += stepDown;
    e.setData('homeX', e.x);
    e.setData('homeY', e.y);
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ENEMY_FORMATION_ROT, 0.15);
  }

  // dive master tick
  diveMasterAccMs += delta;
  while (diveMasterAccMs >= DIVE_MASTER_TICK_MS) {
    diveMasterAccMs -= DIVE_MASTER_TICK_MS;
    for (let i = 0; i < diveCounters.length; i++) {
      diveCounters[i] -= 1;
      if (diveCounters[i] <= 0) {
        divePendingTriggers += 1;
        diveCounters[i] = diveCounterReset(DIVE_COUNTER_BASES[i], wave, i, false, enemies);
      }
    }
  }

  // spend pending triggers into a burst queue
  if (divePendingTriggers > 0 && diveBurstQueue.length === 0) {
    const ar2 = aliveRatioNow(enemies);
    const gate = squadTriggerGateChance(wave, ar2);
    if (POHP_grChance(gate)) {
      divePendingSquadBoost += 1;
    }
    diveBurstQueue = buildDiveBurstQueue(enemies, wave);
    divePendingTriggers = 0;
  }

  // launch from burst queue if room
  const divingCount = es.filter(e => e.active && (e.getData('state') === 'diveLoop' || e.getData('state') === 'diveStraight')).length;
  if (diveBurstQueue.length > 0 && divingCount < MAX_DIVING_ENEMIES) {
    const e = diveBurstQueue.shift();
    if (e && e.active && e.getData('state') === 'formation') {
      startEnemyDive(e, player.x, wave);
    }
  }

  // opportunistic feint
  if (EXP_FEINT_NUDGE && formationFeintMs <= 0 && formationIntel && formationIntel.mood === 'FEINT') {
    if (POHP_grChance(0.18)) {
      formationFeintMs = 420 + POHP_grBetween(-80, 80);
      formationFeintDir = (POHP_grChance(0.5) ? 1 : -1);
    }
  }
}

function updateDivingEnemies(delta, ctx) {
  const { enemies, player, wave } = ctx;
  const es = enemies.children.entries;
  const d = delta / 1000;
  const sMul = waveSpeedMul(wave);
  const ar = aliveRatioNow(enemies);
  const thinMul = 1 + (1 - ar) * 0.35;
  const speedBrake = 0.90 + 0.10 * (aiPressureMul || 1);

  for (const e of es) {
    if (!e.active) continue;
    const st = e.getData('state');
    if (st === 'formation') {
      e.setData('stateMs', 0);
      e.setData('offscreenMs', 0);
      continue;
    }
    if (st !== 'diveLoop' && st !== 'diveStraight' && st !== 'returning') continue;

    let stateMs = (e.getData('stateMs') || 0) + delta;
    e.setData('stateMs', stateMs);

    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) {
      forceEnemyToFormation(e);
      continue;
    }

    const off = (e.x < ENEMY_SANITY_MIN_X || e.x > ENEMY_SANITY_MAX_X || e.y < ENEMY_SANITY_MIN_Y || e.y > ENEMY_SANITY_MAX_Y);
    let offscreenMs = e.getData('offscreenMs') || 0;
    offscreenMs = off ? (offscreenMs + delta) : 0;
    e.setData('offscreenMs', offscreenMs);

    if (st === 'returning') {
      if (stateMs > ENEMY_MAX_RETURN_MS) {
        forceEnemyToFormation(e);
        continue;
      }
    } else if (stateMs > ENEMY_MAX_DIVE_MS) {
      forceEnemyWrapToReturn(e);
      continue;
    }

    if (offscreenMs > ENEMY_STUCK_OFFSCREEN_MS) {
      forceEnemyWrapToReturn(e);
      continue;
    }

    if (st === 'diveLoop') {
      let t = (e.getData('loopT') || 0) + d * (1.25 * ENEMY_SPEED_FACTOR * sMul * thinMul * speedBrake);
      if (t > 1) t = 1;
      e.setData('loopT', t);

      const dir = e.getData('loopDir') || 1;
      const radius = e.getData('loopRadius') || 85;
      const cx = e.getData('loopCenterX') || e.x;
      const cy = e.getData('loopCenterY') || (e.y + 40);
      const tEase = 0.5 - 0.5 * Math.cos(Math.PI * t);
      const angle = -Math.PI / 2 + dir * (Math.PI * 1.4) * tEase;
      e.setPosition(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      setEnemyRotationFromVelocity(e, d);

      if (t >= 1) e.setData('state', 'diveStraight');
    } else if (st === 'diveStraight') {
      const vxMax = 150 * ENEMY_SPEED_FACTOR * sMul * thinMul * speedBrake;
      const vy = 145 * ENEMY_SPEED_FACTOR * sMul * thinMul * speedBrake;

      let targetX = e.getData('diveTargetX');
      if (!Number.isFinite(targetX)) targetX = e.x;
      if (player && player.active) {
        const typ = e.getData('type') || 'blue';
        const chase = (typ === 'blue') ? 0.25 : (typ === 'purple') ? 0.45 : (typ === 'red') ? 0.65 : 0.85;
        const lerpAmt = Phaser.Math.Clamp(d * (0.85 + chase * 1.35), 0, 0.20);
        targetX = Phaser.Math.Clamp(Phaser.Math.Linear(targetX, player.x, lerpAmt), 30, 770);
        e.setData('diveTargetX', targetX);
      }
      const dx = targetX - e.x;
      const vx = Phaser.Math.Clamp(dx * 2.9, -vxMax, vxMax);
      e.x += vx * d;
      e.y += vy * d;
      setEnemyRotationFromVelocity(e, d);

      if (e.y > DIVE_EXIT_Y) {
        const homeX = e.getData('homeX');
        const homeY = e.getData('homeY');
        e.x = Number.isFinite(homeX) ? homeX : e.x;
        e.y = RETURN_ENTRY_Y;
        e.setVisible(true).setActive(true);
        if (e.body) e.body.enable = true;
        e.setData('returnY', Number.isFinite(homeY) ? homeY : 120);
        e.setData('state', 'returning');
        e.setData('stateMs', 0);
        e.setData('offscreenMs', 0);
      }
    } else if (st === 'returning') {
      const returnY = e.getData('returnY');
      const targetY = Number.isFinite(returnY) ? returnY : 120;
      const returnSpeed = 170 * ENEMY_SPEED_FACTOR * sMul;
      e.y += returnSpeed * d;
      setEnemyRotationFromVelocity(e, d);
      if (e.y >= targetY) {
        e.y = targetY;
        e.setData('state', 'formation');
        e.setRotation(ENEMY_FORMATION_ROT);
        e.setData('stateMs', 0);
        e.setData('offscreenMs', 0);
      }
    }
  }
}

// -------------------- collisions + cleanup --------------------
function spriteHalfSize(s, texSizes) {
  if (!s || !s.active || !s.body || s.body.enable === false) return { hw: 0, hh: 0 };
  // If body size was set, use it. Otherwise approximate by texture*scale.
  const bw = (s.body && s.body.width) ? s.body.width : ((texSizes[s.key]?.w || 32) * s.scale);
  const bh = (s.body && s.body.height) ? s.body.height : ((texSizes[s.key]?.h || 32) * s.scale);
  return { hw: bw / 2, hh: bh / 2 };
}

function overlaps(a, b, texSizes) {
  if (!a || !b) return false;
  if (!a.active || !b.active) return false;
  if (!a.body || !b.body) return false;
  if (a.body.enable === false || b.body.enable === false) return false;
  const as = spriteHalfSize(a, texSizes);
  const bs = spriteHalfSize(b, texSizes);
  if (as.hw <= 0 || as.hh <= 0 || bs.hw <= 0 || bs.hh <= 0) return false;
  return (Math.abs(a.x - b.x) <= (as.hw + bs.hw)) && (Math.abs(a.y - b.y) <= (as.hh + bs.hh));
}

function cleanupBullets(groups) {
  for (const g of groups) {
    for (const b of g.children.entries) {
      if (!b.active) continue;
      if (b.y < -40 || b.y > SCREEN_H + 40) {
        b.setActive(false).setVisible(false);
        if (b.body) b.body.enable = false;
      }
    }
  }
}

// -------------------- hit callbacks (ported logic) --------------------
function hitEnemy(bullet, enemy, ctx) {
  if (!bullet.active || !enemy.active) return;
  bullet.setActive(false).setVisible(false);
  if (bullet.body) bullet.body.enable = false;

  // base score
  const type = enemy.getData('type');
  let pts = ENEMY_SCORES[type] || 50;
  if (enemy.getData('state') !== 'formation') {
    pts += Math.floor(pts * 0.35);
  }
  ctx.score += pts;
  ctx.formationIntel && (ctx.formationIntel.lastKillMs = 0);
  AI_onEnemyKilled();

  enemy.setActive(false).setVisible(false);
  if (enemy.body) enemy.body.enable = false;

  // clear check
  if (ctx.enemies.children.entries.filter(e => e.active).length === 0) {
    // wave clear bonus
    const clearBonus = 250 + (ctx.wave * 25);
    ctx.score += clearBonus;
    ctx.wave += 1;
    ctx.waveSpawnTimer = WAVE_CLEAR_DELAY_MS;
    resetFireDirectorForWave(ctx.wave);
    applyWaveDifficulty(ctx.wave);
    AI_initFormationIntel();
  }
}

function hitPlayer(player, bullet, ctx) {
  if (!player.active) return;
  if (ctx.invulnerabilityTimer > 0) return;
  // disable bullet
  if (bullet) {
    bullet.setActive(false).setVisible(false);
    if (bullet.body) bullet.body.enable = false;
  }

  ctx.lives -= 1;
  AI_onPlayerHit();

  // disable player
  player.setActive(false).setVisible(false);
  player.body.enable = false;
  player.vx = 0;
  ctx.playerState = PLAYER_STATE.DYING;
  ctx.respawnTimer = RESPAWN_DELAY;

  if (ctx.lives <= 0) {
    ctx.gameOverTimer = 850;
  }
}

// -------------------- core simulation --------------------
function simulateRunPackage(runPackage, opts = {}) {
  if (!runPackage || typeof runPackage !== 'object') {
    throw new Error('simulateRunPackage: invalid runPackage');
  }

  const assetsDir = (opts.assetsDir || process.env.ASSETS_DIR || '../assets');
  const texSizes = {
    ship: { w: 32, h: 32 },
    enemy_flagship: { w: 32, h: 32 },
    enemy_red: { w: 32, h: 32 },
    enemy_purple: { w: 32, h: 32 },
    enemy_blue: { w: 32, h: 32 },
    bullet_player: { w: 32, h: 32 },
    bullet_enemy: { w: 32, h: 32 },
  };
  try {
    // try resolve relative to verifier working dir
    const base = path.resolve(process.cwd(), assetsDir);
    const load = (k, filename) => {
      const p = path.join(base, filename);
      texSizes[k] = readPngSize(p);
    };
    load('ship', 'ship.png');
    load('enemy_flagship', 'enemy_flagship.png');
    load('enemy_red', 'enemy_red.png');
    load('enemy_purple', 'enemy_purple.png');
    load('enemy_blue', 'enemy_blue.png');
    load('bullet_player', 'bullet_player.png');
    load('bullet_enemy', 'bullet_enemy.png');
  } catch { /* fallback defaults */ }

  // bullet speed in PPS is based on reference scaling in main.js
  const referenceHeight = 600;
  ENEMY_BULLET_SPEED_PPS = Math.round(260 * (SCREEN_H / referenceHeight));

  // decode inputs
  const masks = runPackage.masks_b64 ? b64ToU8(runPackage.masks_b64) : new Uint8Array(0);
  const deltas = runPackage.deltas_b64 ? b64ToU16(runPackage.deltas_b64) : new Uint16Array(0);
  if (!masks.length || !deltas.length) {
    return { ok: false, error: "empty input streams (masks/deltas)" };
  }
  if (masks.length !== deltas.length) {
    return { ok: false, error: `masks/deltas length mismatch (${masks.length} vs ${deltas.length})` };
  }
  const frames = masks.length;

  // init RNG
  const seed = (runPackage.seed >>> 0);
  const rngGame = POHP_mulberry32(seed);
  let rngCalls = 0;
  function POHP_grFloat() { rngCalls += 1; return rngGame(); }
  function POHP_grChance(p) {
    p = Number(p);
    if (!Number.isFinite(p)) return false;
    if (p <= 0) return false;
    if (p >= 1) return true;
    return POHP_grFloat() < p;
  }
  function POHP_grBetween(min, max) {
    const r = POHP_grFloat();
    return Math.floor(r * (max - min + 1)) + min;
  }
  function POHP_grInt(a, b) {
    if (b === undefined) {
      const n = Math.floor(Number(a));
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.floor(POHP_grFloat() * n);
    }
    const mn = Math.floor(Number(a));
    const mx = Math.floor(Number(b));
    if (!Number.isFinite(mn) || !Number.isFinite(mx)) return 0;
    if (mx < mn) return mn;
    return POHP_grBetween(mn, mx);
  }
  // expose into closures that were ported above
  global.POHP_grFloat = POHP_grFloat;
  global.POHP_grChance = POHP_grChance;
  global.POHP_grBetween = POHP_grBetween;
  global.POHP_grInt = POHP_grInt;

  // reset globals for a clean sim
  AI_initFormationIntel();
  AI_initLearn();
  aiPressureMul = 1.0;
  aiCalmMs = 0;
  aiCalmT = 0;

  // init groups
  const enemies = makeGroup('enemy');
  const playerBullets = makeGroup('bullet_player');
  const enemyBullets = makeGroup('bullet_enemy');

  // preallocate a few bullets (mimic pools)
  for (let i = 0; i < 16; i++) {
    const b = playerBullets.create(-999, -999, 'bullet_player');
    b.setActive(false).setVisible(false);
    b.body.enable = false;
  }
  for (let i = 0; i < 32; i++) {
    const b = enemyBullets.create(-999, -999, 'bullet_enemy');
    b.setActive(false).setVisible(false);
    b.body.enable = false;
  }

  // player
  const player = makeSprite('ship', PLAYER_START_X, PLAYER_START_Y);
  player.setScale(SHIP_SCALE);
  // body size default
  player.body.setSize(texSizes.ship.w * SHIP_SCALE, texSizes.ship.h * SHIP_SCALE);

  // create formation (exact from main.js)
  function centeredXs(count, spacingX) {
    const totalW = (count - 1) * spacingX;
    const startX = FORMATION_CENTER_X - totalW / 2;
    const xs = [];
    for (let i = 0; i < count; i++) xs.push(startX + i * spacingX);
    return xs;
  }
  function createEnemyFormation() {
    enemies.children.entries.length = 0;
    enemyFormation = [];
    formationMoveAccPx = 0;
    formationSwayMs = 0;
    formationSwayPrev = 0;

    const rows = [
      { key: 'enemy_flagship', type: 'flagship', count: 2 },
      { key: 'enemy_red', type: 'red', count: 6 },
      { key: 'enemy_purple', type: 'purple', count: 8 },
      { key: 'enemy_blue', type: 'blue', count: 10 },
      { key: 'enemy_blue', type: 'blue', count: 10 },
    ];

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const y = ENEMY_START_Y + r * ENEMY_SPACING_Y + FORMATION_Y_OFFSET;
      const xs = centeredXs(row.count, ENEMY_SPACING_X);
      const arr = [];
      for (let c = 0; c < row.count; c++) {
        const x = xs[c];
        const e = enemies.create(x, y, row.key);
        e.setScale(0.6);
        e.body.setSize((texSizes[row.key].w || 32) * 0.6, (texSizes[row.key].h || 32) * 0.6);
        e.setData('type', row.type);
        e.setData('row', r);
        e.setData('col', c);
        e.setData('key', row.key);
        e.setData('homeX', x);
        e.setData('homeY', y);
        e.setData('state', 'formation');
        e.setData('stateMs', 0);
        e.rotation = ENEMY_FORMATION_ROT;
        arr.push(e);
      }
      enemyFormation.push(arr);
    }
  }

  // initial wave state
  let wave = Number(runPackage.final_wave) ? 1 : 1; // always start at wave 1
  applyWaveDifficulty(wave);
  resetFireDirectorForWave(wave);
  diveMasterAccMs = 0;
  diveCounters = DIVE_COUNTER_BASES.slice();
  divePendingTriggers = 0;
  divePendingSquadBoost = 0;
  diveBurstQueue = [];

  createEnemyFormation();

  // runtime state
  let score = 0;
  let lives = 3;
  let gamePhase = GAME_PHASE.RUNNING;
  let playerState = PLAYER_STATE.PLAYING;
  let respawnTimer = 0;
  let invulnerabilityTimer = START_INVULN;
  let waveSpawnTimer = 0;
  let gameOverTimer = 0;

  // input state
  let prevMask = 0;

  // time accumulator for blink sin etc
  let timeMs = 0;

  const ctx = {
    enemies,
    player,
    playerBullets,
    enemyBullets,
    texSizes,
    get score() { return score; },
    set score(v) { score = v; },
    get wave() { return wave; },
    set wave(v) { wave = v; },
    get lives() { return lives; },
    set lives(v) { lives = v; },
    get invulnerabilityTimer() { return invulnerabilityTimer; },
    set invulnerabilityTimer(v) { invulnerabilityTimer = v; },
    get respawnTimer() { return respawnTimer; },
    set respawnTimer(v) { respawnTimer = v; },
    get playerState() { return playerState; },
    set playerState(v) { playerState = v; },
    get waveSpawnTimer() { return waveSpawnTimer; },
    set waveSpawnTimer(v) { waveSpawnTimer = v; },
    get gameOverTimer() { return gameOverTimer; },
    set gameOverTimer(v) { gameOverTimer = v; },
    formationIntel,
  };

  function shootPlayerBullet() {
    if (gamePhase !== GAME_PHASE.RUNNING) return;
    if (playerState !== PLAYER_STATE.PLAYING) return;
    if (!player.active) return;
    const activeCount = countActive(playerBullets.children.entries);
    if (activeCount >= MAX_PLAYER_BULLETS_ONSCREEN) return;
    let bullet = playerBullets.getFirstDead(false);
    if (!bullet) bullet = playerBullets.create(0, 0, 'bullet_player');
    bullet.setActive(true).setVisible(true).setScale(BULLET_PLAYER_SCALE);
    setupBulletBody(bullet, 'player', texSizes);
    const x = player.x;
    const y = player.y - 20;
    bullet.setPosition(x, y);
    bullet.body.enable = true;
    bullet.body.reset(x, y);
    bullet.body.setVelocity(0, PLAYER_BULLET_VY);
  }

  function updatePlayerState(delta) {
    switch (playerState) {
      case PLAYER_STATE.PLAYING: {
        if (player.active) {
          // input
          const m = curMask;
          const left = !!(m & POHP_INPUT_BITS.LEFT);
          const right = !!(m & POHP_INPUT_BITS.RIGHT);
          const shoot = !!(m & POHP_INPUT_BITS.SHOOT);
          const shootJust = shoot && !(prevMask & POHP_INPUT_BITS.SHOOT);

          if (left && player.x > 0) player.setVelocityX(-PLAYER_SPEED);
          else if (right && player.x < SCREEN_W) player.setVelocityX(PLAYER_SPEED);
          else player.setVelocityX(0);

          if (shootJust) shootPlayerBullet();
        }
        break;
      }
      case PLAYER_STATE.DYING:
        // after DYING, enter RESPAWNING
        if (respawnTimer <= 0) {
          playerState = PLAYER_STATE.RESPAWNING;
          respawnTimer = RESPAWN_DELAY;
        }
        break;
      case PLAYER_STATE.RESPAWNING:
        if (respawnTimer <= 0) {
          if (lives > 0) {
            player.setPosition(PLAYER_START_X, PLAYER_START_Y);
            player.setActive(true).setVisible(true);
            player.body.enable = true;
            player.vx = 0;
            invulnerabilityTimer = INVULN_DURATION;
            playerState = PLAYER_STATE.PLAYING;
          } else {
            gamePhase = GAME_PHASE.GAME_OVER;
          }
        }
        break;
    }
  }

  function integrate(dt) {
    const s = dt / 1000;
    // player
    if (player.active && player.body.enable) {
      player.x += player.vx * s;
      player.x = Phaser.Math.Clamp(player.x, 0, SCREEN_W);
    }

    // bullets
    for (const b of playerBullets.children.entries) {
      if (!b.active || !b.body.enable) continue;
      b.x += b.vx * s;
      b.y += b.vy * s;
    }
    for (const b of enemyBullets.children.entries) {
      if (!b.active || !b.body.enable) continue;
      b.x += b.vx * s;
      b.y += b.vy * s;
    }
  }

  function doCollisions() {
    // player bullets vs enemies
    for (const b of playerBullets.children.entries) {
      if (!b.active || !b.body.enable) continue;
      for (const e of enemies.children.entries) {
        if (!e.active || !e.body.enable) continue;
        if (overlaps(b, e, texSizes)) {
          hitEnemy(b, e, ctx);
          break;
        }
      }
    }
    // enemy bullets vs player
    if (player.active && player.body.enable && invulnerabilityTimer <= 0) {
      for (const b of enemyBullets.children.entries) {
        if (!b.active || !b.body.enable) continue;
        if (overlaps(b, player, texSizes)) {
          hitPlayer(player, b, ctx);
          break;
        }
      }
    }
    // enemy body vs player
    if (player.active && player.body.enable && invulnerabilityTimer <= 0) {
      for (const e of enemies.children.entries) {
        if (!e.active || !e.body.enable) continue;
        if (overlaps(e, player, texSizes)) {
          hitPlayer(player, null, ctx);
          break;
        }
      }
    }
  }

  // optional deterministic trace (debug)
  const traceIntervalFrames = Math.max(
    0,
    Math.floor(Number.isFinite(+opts.trace_interval_frames)
      ? +opts.trace_interval_frames
      : +(process.env.TRACE_INTERVAL_FRAMES || 0))
  );
  const trace = [];
  function maybeTrace(frameIdx) {
    if (!traceIntervalFrames) return;
    if ((frameIdx % traceIntervalFrames) !== 0) return;
    const snapshot = {
      f: frameIdx,
      t: Math.floor(timeMs),
      score,
      wave,
      lives,
      ps: playerState,
      px: Math.round(player.x),
      py: Math.round(player.y),
      inv: Math.max(0, Math.floor(invulnerabilityTimer)),
      rng: rngCalls,
      ea: enemies.children.entries.filter(e => e.active && e.body.enable).length,
      pb: playerBullets.children.entries.filter(b => b.active && b.body.enable).length,
      eb: enemyBullets.children.entries.filter(b => b.active && b.body.enable).length,
    };
    trace.push({ f: frameIdx, h: sha256Hex(JSON.stringify(snapshot)).slice(0, 16) });
  }

  // main loop
  let curMask = 0;
  let framesProcessed = 0;
  for (let f = 0; f < frames; f++) {
    if (gamePhase !== GAME_PHASE.RUNNING) break;

    const delta = deltas[f] || 16;
    curMask = masks[f] || 0;
    timeMs += delta;

    // timers
    if (respawnTimer > 0) respawnTimer -= delta;
    if (invulnerabilityTimer > 0) invulnerabilityTimer -= delta;
    if (waveSpawnTimer > 0) {
      waveSpawnTimer -= delta;
      if (waveSpawnTimer <= 0) {
        createEnemyFormation();
      }
    }
    if (gameOverTimer > 0) {
      gameOverTimer -= delta;
      if (gameOverTimer <= 0) {
        gamePhase = GAME_PHASE.GAME_OVER;
        break;
      }
    }

    // update
    AI_tickLateFunGovernor(delta, wave, lives);
    AI_learnTick(delta);
    updatePlayerState(delta);
    updateEnemyFormation(delta, { enemies, player, wave });
    updateDivingEnemies(delta, { enemies, player, wave });
    enemyShooting(delta, { enemies, enemyBullets, player, wave, texSizes });

    // integrate movement (bullets + player)
    integrate(delta);

    // collisions
    doCollisions();

    // trace after collisions (closest to "state after step")
    maybeTrace(f);

    // cleanup
    cleanupBullets([playerBullets, enemyBullets]);

    // advance mask
    prevMask = curMask;
    framesProcessed += 1;
  }

  return {
    ok: true,
    score,
    wave,
    lives,
    frames_simulated: framesProcessed,
    trace,
  };
}

module.exports = { simulateRunPackage };
