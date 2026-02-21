let pohpDownloadText;
// Galaxy King Dog — “Arcade High‑Score” Final Main.js
// Phaser v3.55.2
//
// Features kept + polished:
// ✅ Infinite waves + Galaxian/Galaga gentle ramp per wave (speed / fire rate / bullet speed)
// ✅ “Thin‑out” speed-up (when few enemies remain)
// ✅ Max 3 player bullets on screen
// ✅ Stable respawn FSM + invulnerability blink (1.6s)
// ✅ START icon blink + 3‑2‑1 countdown + GAME OVER image
// ✅ HI‑SCORE (persistent) + TOP5 (persistent) + Blockchain submit stub (B key)
// ✅ Audio: BGM loop + enemy move loop + enemy dive loop + player shoot SFX
//
// Assets expected in /assets:
// backround1.jpg, ship.png, enemy_*.png, bullet_*.png, explosion.png, boom.png
// start_game.png, assets3.png assets2.png assets1.png, gameover.png
// sfx_laser1.ogg, sfx_enemy_move_loop.wav, sfx_enemy_dive_loop.wav, bgm_galaxy_mystery_loop.wav

// =================== CONFIG ===================
document.title = 'DOG KING (POHP v3)';

const config = {
  type: Phaser.AUTO,
  width: 800,
  height: 600,
  parent: 'game-container',
  backgroundColor: '#000011',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  render: { pixelArt: true, antialias: false, roundPixels: true },
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false }
  },
  scene: { preload, create, update }
};

// =================== GAME PHASE ===================
const GAME_PHASE = {
  START: 0,
  COUNTDOWN: 1,
  RUNNING: 2,
  GAME_OVER: 3
};
let gamePhase = GAME_PHASE.START;

// =================== TUNING (easy knobs) ===================
// If you want “half difficulty”, lower this to 0.50.
const DIFFICULTY_SCALE = 0.80;

// Enemy speeds: x3.5 slower (your earlier request)
const ENEMY_SPEED_FACTOR = 1 / 3.5;

// Enemy chance (dive + shooting): x3 more frequent (your earlier request)
const ENEMY_CHANCE_FACTOR = 1.15;

// Galaxian/Galaga gentle ramps per wave
const PER_WAVE_SPEED_UP = 0.018;     // +1.8% / wave
const PER_WAVE_BULLET_UP = 0.014;    // +1.4% / wave

const WAVE_SPEED_MUL_CAP  = 1.95;
const WAVE_RATE_MUL_CAP   = 1.85;
const WAVE_BULLET_MUL_CAP = 1.90;
const PER_WAVE_RATE_UP  = 0.012;     // +1.2% / wave

// Thin-out speed-up (when few enemies remain)
const THIN_OUT_SPEED_UP  = 0.35;     // up to +35% move speed
const THIN_OUT_RATE_UP   = 0.55;     // up to +55% fire rate
const THIN_OUT_BULLET_UP = 0.18;     // up to +18% bullet speed

function waveSpeedMul(w)  { return Math.min(WAVE_SPEED_MUL_CAP,  1 + (w - 1) * PER_WAVE_SPEED_UP); }
function waveBulletMul(w) { return Math.min(WAVE_BULLET_MUL_CAP, 1 + (w - 1) * PER_WAVE_BULLET_UP); }
function waveRateMul(w)   { return Math.min(WAVE_RATE_MUL_CAP,   1 + (w - 1) * PER_WAVE_RATE_UP); }

// =================== START / COUNTDOWN UI ===================
const START_ICON_TARGET_W = 600;
const START_ICON_TARGET_H = 300;
const START_ICON_Y = 300;
const COUNTDOWN_SIZE_SCALE = 1.93;

let startIcon = null;
let gameOverImage = null;
let countdownSprites = [];
let countdownInProgress = false;

// =================== AUDIO (mix knobs) ===================
const BGM_VOLUME = 0.28;             // background music volume
const SFX_SHOOT_VOLUME = 0.45;       // player shoot
const SFX_HIT_VOLUME = 0.55;         // player hit
const SFX_ENEMY_MOVE_VOL = 0.22;     // continuous “formation move” hum
const SFX_ENEMY_DIVE_VOL = 0.28;     // continuous “dive” loop hum

let audioUnlocked = false;
let bgm = null;
let sfxPlayerShoot = null;
let sfxHitShip = null;
let sfxEnemyMoveLoop = null;
let sfxEnemyDiveLoop = null;

// =================== PLAYER FSM ===================
const PLAYER_STATE = {
  PLAYING: 0,
  DYING: 1,
  RESPAWNING: 2,
  GAME_OVER: 3
};

let playerState = PLAYER_STATE.PLAYING;
let respawnTimer = 0;
let invulnerabilityTimer = 0;

const RESPAWN_DELAY = 800;     // ms
const INVULN_DURATION = 1600;  // ms  ✅ (your request: longer blink invulnerable)
const DIVE_EXIT_Y = 650;       // dive exits screen below this Y
const RETURN_ENTRY_Y = -12;   // wrap re-entry Y (less “vanish”)
const MAX_PLAYER_BULLETS_ONSCREEN = 3;

// =================== GLOBALS ===================
let game;
let mainScene;

let player;
let enemies;
let enemyBullets;
let playerBullets;
let stars;

let score = 0;
let highScore = 0;
let topScores = []; // [{score,wave,ts}]

let scoreText, livesText, waveText, highScoreText, topText, chainStatusText, pohpStatusText;
let lives = 3;
let wave = 1;
let waveAdvancePending = false; // guard against double wave scheduling
let playerAlive = true;

let cursors, spaceKey, restartKey, submitKey, proofKey, exportScoresKey, importScoresKey;
let scoreImportInput = null;

let playerBulletEnemyCollider;
let enemyBulletPlayerCollider;
let enemyPlayerCollider;

let formationTotalAtWave = 0;
let totalEnemiesSpawnedAtWaveStart = 0; // NOTE++ used for formation/dive AI ratios

// last-life aura
let boomAura = null;

// =================== “BLOCKCHAIN” SUBMIT (STUB) ===================
const CHAIN_SUBMIT_URL = ""; // set later (e.g. "http://127.0.0.1:8787/submit-score")
const LS_HISCORE_KEY = "gkd_hiScore_v1";
const LS_TOP5_KEY    = "gkd_top5_v1";
const LS_PENDING_KEY = "gkd_chain_pending_v1";

// =================== ENEMY FORMATION ===================
const FORMATION_CENTER_X = 400;
const ENEMY_SPACING_X = 50;
const ENEMY_SPACING_Y = 44;
const ENEMY_START_Y = 90;
const FORMATION_Y_OFFSET = -40;

// Formation safety: keep the formation from drifting downward forever (endless arcade)
const FORMATION_STEP_DOWN = 8;
const FORMATION_LOWEST_Y_MAX = 320;

// Formation sway (classic Galaxian feel): noticeable left-right motion + slight sinusoidal drift.
// Deterministic (depends only on recorded delta stream).
const FORMATION_SWAY_PERIOD_MS = 1700;     // ~1.7s per full sway
const FORMATION_SWAY_AMP_MIN = 8;          // px
const FORMATION_SWAY_AMP_PER_WAVE = 0.55;  // +px per wave (capped below)
const FORMATION_SWAY_AMP_MAX = 18;         // px cap (keeps it fair)
const FORMATION_SPEED_MUL = 1.55;          // makes formation motion more “arcade visible”
const FORMATION_HARD_BOUND_L = 40;
const FORMATION_HARD_BOUND_R = 760;

// Arcade directors (timers/cooldowns) to avoid bursty spikes (still deterministic via POHP_gr*)
let enemyFireCooldownMs = 0;

// Fire Budget + Formation Volley Director (keeps late-waves fair + "classic" cadence)
let enemyFireBudget = 0; // refills over time; each enemy shot spends 1
let formationFireTimerMs = 0;
let formationVolleyLeft = 0;
let formationVolleyGapMs = 0;
let formationVolleyTimerMs = 0; // timer until next formation volley
let formationSwayMs = 0;
let formationSwayPrev = 0; // previous integer sway offset (px)
let formationMoveAccPx = 0; // pixel-step accumulator for crisp classic movement
let formationFeintMs = 0;
let formationFeintDir = 1;
let formationShootExactX = 400;
// Formation Group AI (Kernel 1/2): side bias + planned volley columns (keeps formation feeling “coordinated”)
let formationGroupSide = 1;         // -1 = left flank, +1 = right flank
let formationGroupSideHoldMs = 0;   // how long we keep the current side preference
let formationVolleyPlanCols = [];   // planned column order for the current volley
let formationVolleyPlanIdx = 0;     // cursor into plan


// =================== ENEMY AI KERNELS (Formation “brains” + communication bus) ===================
// Goal: each enemy TYPE behaves differently *while in formation*,
// and they coordinate via a tiny shared bus (formationIntel).
// - BLUE: “xazoulides” (low discipline, low accuracy, low coordination)
// - PURPLE: “scouts” (marks lanes, medium discipline)
// - RED: “gunners” (tight windows, higher hit rate, occasional bursts)
// - FLAGSHIP: “leader” (sets flank bias + volley mode, strongest coordination)
//
// NOTE: This is GAMEPLAY ONLY (main.js). No chain/verifier changes.
const ENEMY_AI_KERNELS = {
  blue: {
    name: "BLUE",
    formation: {
      aimWinMul: 1.18,
      pAlignedBase: 0.56,
      pStrayBase: 0.05,
      waitBias: 0.92,
      cooldownMs: 760,
      weight: 0.90,
      markChance: 0.00,
      burstChance: 0.00
    }
  },
  purple: {
    name: "PURPLE",
    formation: {
      aimWinMul: 1.05,
      pAlignedBase: 0.64,
      pStrayBase: 0.06,
      waitBias: 0.88,
      cooldownMs: 660,
      weight: 1.05,
      markChance: 0.14,      // purple can “mark” a lane briefly
      burstChance: 0.00
    }
  },
  red: {
    name: "RED",
    formation: {
      aimWinMul: 0.92,
      pAlignedBase: 0.72,
      pStrayBase: 0.05,
      waitBias: 0.82,
      cooldownMs: 560,
      weight: 1.14,
      markChance: 0.05,
      burstChance: 0.14      // rare “double-tap” (braked by budget + caps)
    }
  },
  flagship: {
    name: "FLAGSHIP",
    formation: {
      aimWinMul: 0.90,
      pAlignedBase: 0.78,
      pStrayBase: 0.04,
      waitBias: 0.80,
      cooldownMs: 720,
      weight: 1.18,
      markChance: 0.18,      // leader marks lane more often
      burstChance: 0.18      // rare “command burst” (still braked)
    }
  }
};

// Shared formation communication “bus”
let formationIntel = {
  // marked lane (snapped to 25px) – used by reds/flagship to coordinate volleys
  markX: null,
  markTtlMs: 0,
  markBy: "",

  // leader selection (usually flagship if alive)
  leaderKey: null,
  leaderType: "",
  leaderHoldMs: 0,

  // flank pressure: -1 left, +1 right
  flankSide: 1,
  flankHoldMs: 0,

  // volley mode: "focus" (around target) or "sweep" (from flank)
  mode: "focus",
  modeHoldMs: 0,

  // burst heat: prevents repeated bursts from feeling unfair
  burstHeatMs: 0,
  // tactic heat: prevents repeated aggressive volley modes (pinch/cross) from feeling unfair
  tacticHeatMs: 0,

  // experimental swarm cognition / “communication bus”
  mood: "calm",
  moodTtlMs: 0,
  focusLaneX: null,   // computed from lane heatmap / habits
  laneHeat: null,     // Int16Array created lazily
  heatAccMs: 0,
  feintMs: 0,
  feintDir: 1

};

function AI_getKernel(type) {
  return ENEMY_AI_KERNELS[type] || ENEMY_AI_KERNELS.blue;
}

// Updates formationIntel once per enemyShooting tick (deterministic).
function AI_tickFormationIntel(deltaMs, formationEnemies, frontline, aliveRatio, melee) {
  // decay timers
  formationIntel.markTtlMs = Math.max(0, (formationIntel.markTtlMs || 0) - deltaMs);
  formationIntel.leaderHoldMs = Math.max(0, (formationIntel.leaderHoldMs || 0) - deltaMs);
  formationIntel.flankHoldMs = Math.max(0, (formationIntel.flankHoldMs || 0) - deltaMs);
  formationIntel.modeHoldMs = Math.max(0, (formationIntel.modeHoldMs || 0) - deltaMs);
  formationIntel.burstHeatMs = Math.max(0, (formationIntel.burstHeatMs || 0) - deltaMs);
  formationIntel.tacticHeatMs = Math.max(0, (formationIntel.tacticHeatMs || 0) - deltaMs);

  if (!formationEnemies || formationEnemies.length === 0) return;

  // --- Experimental lane heatmap (player habit tracking; deterministic) ---
  if (EXP_LANE_HEATMAP) {
    if (!formationIntel.laneHeat) {
      // 800px wide / 25px lanes => ~32 lanes
      formationIntel.laneHeat = new Int16Array(33);
      formationIntel.heatAccMs = 0;
    }
    const laneStep = FORMATION_SHOOT_LANE_SPACING || 25;
    const px = (player && player.active) ? player.x : 400;
    const li = Phaser.Math.Clamp(Math.round(px / laneStep), 0, formationIntel.laneHeat.length - 1);
    formationIntel.laneHeat[li] = Math.min(32000, (formationIntel.laneHeat[li] || 0) + 4);

    // decay heatmap at a fixed cadence (prevents runaway)
    formationIntel.heatAccMs = (formationIntel.heatAccMs || 0) + deltaMs;
    while (formationIntel.heatAccMs >= 120) {
      formationIntel.heatAccMs -= 120;
      for (let i = 0; i < formationIntel.laneHeat.length; i++) {
        const v = formationIntel.laneHeat[i];
        if (v > 0) formationIntel.laneHeat[i] = v - 1;
      }
    }

    // choose hottest lane as focus target (converted back to X)
    let bestI = 0, bestV = -1;
    for (let i = 0; i < formationIntel.laneHeat.length; i++) {
      const v = formationIntel.laneHeat[i];
      if (v > bestV) { bestV = v; bestI = i; }
    }
    formationIntel.focusLaneX = bestI * laneStep;
  } else {
    formationIntel.focusLaneX = null;
  }

  // --- Experimental swarm moods (calm / probe / punish / feint) ---
  if (EXP_SWARM_MOODS) {
    formationIntel.moodTtlMs = Math.max(0, (formationIntel.moodTtlMs || 0) - deltaMs);
    if ((formationIntel.moodTtlMs || 0) <= 0) {
      // probabilities shift with player skill + mercy
      const skill = (AI_SELF_IMPROVE ? (aiLearn.level || 0) : 0);
      const mercyNow = (EXP_MERCY_GOVERNOR && (aiLearn.mercyMs || 0) > 0) ? AI_clamp01((aiLearn.mercyMs || 0) / 2200) : 0;

      let pCalm = 0.36 + 0.22 * mercyNow - 0.10 * skill;
      let pProbe = 0.30 + 0.06 * skill;
      let pPunish = 0.24 + 0.22 * skill - 0.12 * mercyNow;
      let pFeint = 0.10 + 0.10 * skill - 0.06 * mercyNow;

      // normalize
      const s = Math.max(0.0001, pCalm + pProbe + pPunish + pFeint);
      pCalm /= s; pProbe /= s; pPunish /= s; pFeint /= s;

      const r = POHP_grFloat();
      let mood = "calm";
      if (r < pCalm) mood = "calm";
      else if (r < pCalm + pProbe) mood = "probe";
      else if (r < pCalm + pProbe + pPunish) mood = "punish";
      else mood = "feint";

      formationIntel.mood = mood;

      // duration per mood (bounded, wave-aware)
      const base = (mood === "calm") ? 1400 : (mood === "probe") ? 1500 : (mood === "punish") ? 1200 : 900;
      const jitter = (mood === "feint") ? 500 : 900;
      formationIntel.moodTtlMs = base + POHP_grBetween(0, jitter);

      // feint event: tiny nudge, clamped by movement bounds
      if (mood === "feint" && EXP_FEINT_NUDGE) {
        formationIntel.feintMs = 260 + POHP_grBetween(0, 220);
        formationIntel.feintDir = (POHP_grChance(0.5) ? 1 : -1);
        formationFeintMs = formationIntel.feintMs;
        formationFeintDir = formationIntel.feintDir;
      }
    }
  }

  // update swarm consciousness (meta-AI director)
  AI_mindTick(deltaMs, aliveRatio, melee);

  // compute formation center X
  let cx = 0;
  const ref = (frontline && frontline.length) ? frontline : formationEnemies;
  for (let i = 0; i < ref.length; i++) cx += ref[i].x;
  cx = cx / Math.max(1, ref.length);

  // pick leader: flagship if present; else red; else purple; else blue
  const inFormation = formationEnemies.filter(e => e && e.active && e.getData('state') === 'formation');
  const hasKey = (k) => inFormation.some(e => (e.getData('slotKey') === k));
  const leaderStillValid = formationIntel.leaderKey && hasKey(formationIntel.leaderKey);

  if (!leaderStillValid || formationIntel.leaderHoldMs <= 0) {
    const flagships = inFormation.filter(e => e.getData('type') === 'flagship');
    const reds = inFormation.filter(e => e.getData('type') === 'red');
    const purples = inFormation.filter(e => e.getData('type') === 'purple');

    let leader = null;

    const pickNearestToCx = (list) => {
      if (!list.length) return null;
      list.sort((a, b) => Math.abs(a.x - cx) - Math.abs(b.x - cx));
      return list[0];
    };

    leader = pickNearestToCx(flagships) || pickNearestToCx(reds) || pickNearestToCx(purples) || pickNearestToCx(inFormation);

    formationIntel.leaderKey = leader ? leader.getData('slotKey') : null;
    formationIntel.leaderType = leader ? (leader.getData('type') || 'blue') : "";
    // hold longer early, shorter later
    const baseHold = Math.max(650, 1400 - (wave - 1) * 55);
    formationIntel.leaderHoldMs = baseHold + POHP_grInt(700);
  }

  // flank side control (flagship leads; others weaker)
  if (formationIntel.flankHoldMs <= 0) {
    const px = (player && player.active) ? player.x : 400;
    let prefer = (px < cx) ? -1 : 1;

    const lt = formationIntel.leaderType || "blue";
    const leaderIsFlag = (lt === 'flagship');
    let feintP = leaderIsFlag ? 0.22 : 0.35; // non-flagships feint more (less disciplined)

    // Swarm consciousness: nudge flank choice based on player dodge bias + intent (still deterministic)
    if (EXP_SWARM_CONSCIOUSNESS && aiMind) {
      const db = (aiMind.dodgeBias || 0);
      const intent = aiMind.intent || "entertain";
      // If player consistently drifts, bias prefer toward that side (herding), except during relief.
      if (intent !== "relief" && Math.abs(db) > 0.22) {
        prefer = (db > 0) ? 1 : -1;
      }
      // Discipline vs feint: challenge => fewer feints, entertain => a bit more, relief => safer
      const v = (aiMind.variety || 0.5);
      if (intent === "challenge") feintP -= 0.06 * (0.8 + 0.4 * v);
      else if (intent === "entertain") feintP += 0.03 * (0.8 + 0.4 * v);
      else feintP += 0.06; // relief: feints happen but overall fire is braked elsewhere
      // pressure + calm further reduce feints (keeps motion readable)
      feintP += 0.06 * AI_clamp01(aiPressureEwma || 0) - 0.04 * AI_clamp01(aiPressureMul || 1);
      feintP = Phaser.Math.Clamp(feintP, 0.10, 0.55);
    }

    formationIntel.flankSide = POHP_grChance(1 - feintP) ? prefer : -prefer;

    const base = leaderIsFlag ? 900 : 720;
    formationIntel.flankHoldMs = base + POHP_grInt(720);
  }


  // volley mode control (expanded tactics)
  if (formationIntel.modeHoldMs <= 0) {
    const lt = formationIntel.leaderType || "blue";
    const leaderIsFlag = (lt === 'flagship');
    // as waves increase & thin-out, focus becomes more common
    const thin = Phaser.Math.Clamp((1 - aliveRatio) * 0.9, 0, 0.9);
    const waveN = Phaser.Math.Clamp((wave - 1) / 18, 0, 1);
    const mood = (EXP_SWARM_MOODS && formationIntel && formationIntel.mood) ? formationIntel.mood : "calm";

    // base weights (never allow mode spam under pressure)
    let wFocus = Phaser.Math.Clamp(0.56 + 0.24 * waveN + 0.18 * thin + (melee ? 0.10 : 0) + (leaderIsFlag ? 0.08 : 0), 0.35, 0.95);
    let wSweep = Phaser.Math.Clamp(0.34 + 0.10 * (mood === "probe" ? 1 : 0) + (leaderIsFlag ? 0.04 : 0), 0.10, 0.80);


    // Swarm consciousness: adjust tactic weights by intent (variety vs discipline) while respecting brakes
    const mind = (EXP_SWARM_CONSCIOUSNESS && aiMind) ? aiMind : null;
    const mindV = mind ? (mind.variety || 0.5) : 0.5;
    const mindF = mind ? (mind.finesse || 0.45) : 0.45;
    const intent = mind ? (mind.intent || "entertain") : "entertain";

    if (intent === "relief") {
      wFocus *= 1.12;
      wSweep *= 0.90;
    } else if (intent === "challenge") {
      wFocus *= (1.00 + 0.10 * mindF);
      wSweep *= (0.96 - 0.05 * mindF);
    } else {
      // entertain: more pattern variety, but never increases raw fire rates
      wSweep *= (1.02 + 0.12 * mindV);
    }

    // Extra tactics (pinch/cross): only when leader is flagship AND not in heavy brake/heat
    let wPinch = 0.0;
    let wCross = 0.0;
    if (EXP_TACTICS_V2 && leaderIsFlag && (formationIntel.tacticHeatMs || 0) <= 0 && invulnerabilityTimer <= 0) {
      const skill = (AI_SELF_IMPROVE ? (aiLearn.level || 0) : 0);
      // These modes are "smart patterns", not raw accuracy boosts.
      // Keep them rare and heavily braked by late-game pressure.
      const allowBase = Phaser.Math.Clamp((0.25 + 0.55 * skill) * (mood === "punish" ? 1.0 : 0.55) * (1 - 0.85 * AI_clamp01(1 - (aiPressureMul || 1))) * (1 - 0.75 * AI_clamp01(aiPressureEwma || 0)), 0, 0.85);
      // Consciousness: allow smart patterns slightly more when intent is entertain/challenge and pressure is low
      let allow = allowBase;
      if (EXP_SWARM_CONSCIOUSNESS && aiMind) {
        const intent = aiMind.intent || "entertain";
        const v = (aiMind.variety || 0.5);
        const f = (aiMind.finesse || 0.45);
        const bump = (intent === "challenge") ? (0.92 + 0.20 * f) : (intent === "entertain") ? (0.90 + 0.22 * v) : 0.78;
        allow = Phaser.Math.Clamp(allow * bump, 0, 0.85);
      }

      wPinch = 0.10 * allow + (mood === "punish" ? 0.10 * allow : 0.0);
      wCross = 0.08 * allow + (mood === "probe" ? 0.06 * allow : 0.0);
    }

    // mood nudges
    if (mood === "calm")   { wFocus *= 1.12; wSweep *= 0.90; }
    if (mood === "probe")  { wSweep *= 1.10; wFocus *= 0.94; }
    if (mood === "punish") { wFocus *= 1.04; wPinch *= 1.10; }
    if (mood === "feint")  { wSweep *= 1.05; wCross *= 1.05; }

    // normalize and sample deterministically
    const sum = Math.max(0.0001, wFocus + wSweep + wPinch + wCross);
    wFocus /= sum; wSweep /= sum; wPinch /= sum; wCross /= sum;

    const r = POHP_grFloat();
    let mode = "focus";
    if (r < wFocus) mode = "focus";
    else if (r < wFocus + wSweep) mode = "sweep";
    else if (r < wFocus + wSweep + wPinch) mode = "pinch";
    else mode = "cross";

    formationIntel.mode = mode;

    // put a "heat" on aggressive tactics so they don't chain
    if (EXP_TACTICS_V2 && (mode === "pinch" || mode === "cross") && formationIntel) {
      formationIntel.tacticHeatMs = 1500 + POHP_grInt(1300);
    }

    formationIntel.modeHoldMs = (leaderIsFlag ? 900 : 700) + POHP_grInt(900);
  }


  // lane marking (communication)
  if (formationIntel.markTtlMs <= 0) {
    const px = (player && player.active) ? player.x : 400;
    const predicted = AI_predictPlayerXAtY(120);
    const target = AI_snapLane(Phaser.Math.Linear(px, predicted, 0.75), 25);

    // “who marks” depends on leader type, but purples can also mark.
    const lt = formationIntel.leaderType || "blue";
    const leaderKernel = AI_getKernel(lt);
    let pMark = leaderKernel.formation.markChance;

    // Consciousness: tune marking discipline (affects coordination, not raw fire spam)
    if (EXP_SWARM_CONSCIOUSNESS && aiMind) {
      const intent = aiMind.intent || "entertain";
      const v = (aiMind.variety || 0.5);
      const f = (aiMind.finesse || 0.45);
      if (intent === "challenge") pMark *= (1.00 + 0.25 * f);
      else if (intent === "relief") pMark *= 0.65;
      else pMark *= (0.92 + 0.18 * v);
      // never exceed brakes
      pMark *= Phaser.Math.Clamp((aiPressureMul || 1.0), 0.55, 1.0);
      pMark = Phaser.Math.Clamp(pMark, 0.02, 0.70);
    }


    // if no flagship leader, allow purples to contribute marks sometimes
    if (lt !== 'flagship') {
      const hasPurple = inFormation.some(e => (e.getData('type') === 'purple'));
      if (hasPurple) pMark = Math.max(pMark, ENEMY_AI_KERNELS.purple.formation.markChance);
    }

    // brakes: don't re-mark too aggressively when player is invulnerable
    if (invulnerabilityTimer > 0) pMark *= 0.25;

    if (POHP_grChance(pMark)) {
      formationIntel.markX = target;
      formationIntel.markBy = lt;
      const ttlMin = (lt === 'flagship') ? 520 : 380;
      const ttlMax = (lt === 'flagship') ? 820 : 620;
      formationIntel.markTtlMs = ttlMin + POHP_grInt(ttlMax - ttlMin + 1);
    }
  }
}

// ============================================================
// AI Self‑Improvement (gameplay‑only, deterministic)
// - Enemies "learn" within a run from the player's habits/performance.
// - This is NOT ML training; it's a bounded adaptive director for fun/fairness.
// - Uses only in‑game state + POHP deterministic helpers (no Math.random()).
// ============================================================
const AI_SELF_IMPROVE = true;


// --- Experimental “crazy scientist” gameplay AI toggles (gameplay-only; deterministic) ---
const EXP_SWARM_MOODS = true;        // formation cycles through “moods” (calm/probe/punish/feint)
const EXP_LANE_HEATMAP = true;       // formation builds a simple lane heatmap of player habits
const EXP_FEINT_NUDGE = true;        // occasional small formation feint nudges (bounded + clamped)
const EXP_MERCY_GOVERNOR = true;     // short mercy window after player gets hit (fun guard)
const EXP_TACTICS_V2 = false;        // extra formation tactics (pinch/cross) — optional         // extra formation tactics (pinch/cross) — smart but still braked

const EXP_LATE_FUN_GOVERNOR = true;  // late-game pressure governor (keeps endless fun/playable)

// “Consciousness” director: meta-AI that chooses tactics/discipline while respecting brakes
const EXP_SWARM_CONSCIOUSNESS = true; // gameplay-only; bounded + deterministic


// Late-game governor state (gameplay-only; deterministic)
let aiPressureMul = 1.0;   // 0.55..1.0 (<=1 means "braking")
let aiPressureEwma = 0.0;  // smoothed 0..1 pressure
let aiCalmMs = 0;          // short calm window (ms)
let aiCalmT = 0;           // timer to next calm pulse (ms)

// Lightweight learning state (0..1), updated once per second-ish.
let aiLearn = {
  level: 0.0,           // current learning level (smoothed)
  target: 0.0,          // target learning level from observed skill
  hotLaneX: 400,        // EWMA of player's snapped lane (formation "reads" habits)
  noHitMs: 0,           // time since last player hit
  killsSinceHit: 0,     // kills since last player hit
  accMs: 0              // accumulator for periodic updates

  ,playerHitStreak: 0,   // consecutive hits landed on player (for mercy governor)
  mercyMs: 0             // mercy timer (ms) after player hit

};

// ============================================================
// Swarm “Consciousness” (meta‑AI director; gameplay‑only)
// - PURPOSE: make enemies feel smarter via tactics + pacing, NOT via raw aimbot.
// - CONSTRAINT: always respects late-game brakes (aiPressureMul/EWMA + mercy).
// - Deterministic: no Math.random; only POHP_* RNG where sampling is needed.
let aiMind = {
  enabled: true,
  intent: "entertain",   // entertain | challenge | relief
  variety: 0.50,          // 0..1 (more pattern variety)
  finesse: 0.45,          // 0..1 (more discipline/marking, bounded)
  dodgeBias: 0.0,         // EWMA of player lateral movement (-1..+1)
  lastPlayerX: 400,
  accMs: 0,
  // anti-repetition memory
  lastMode: "focus",
  repeatMode: 0
};

function AI_mindTick(deltaMs, aliveRatio, melee) {
  if (!EXP_SWARM_CONSCIOUSNESS || !aiMind || !aiMind.enabled) return;

  aiMind.accMs = (aiMind.accMs || 0) + deltaMs;
  if (aiMind.accMs < 400) return; // update ~2.5Hz for smoothness
  aiMind.accMs -= 400;

  const w = (typeof wave === "number" && wave > 0) ? wave : 1;
  const late = AI_clamp01(1 - Math.exp(-(w - 1) / 12));
  const skill = (AI_SELF_IMPROVE && aiLearn) ? (aiLearn.level || 0) : 0;

  const mercy = (EXP_MERCY_GOVERNOR && aiLearn && (aiLearn.mercyMs || 0) > 0)
    ? AI_clamp01((aiLearn.mercyMs || 0) / 2200)
    : 0;

  const pressure = AI_clamp01(aiPressureEwma || 0);
  const calm = ((aiCalmMs || 0) > 0) ? 1.0 : 0.0;

  // Intent selection (keeps late game fun)
  let intent = "entertain";
  if (lives <= 1 || mercy > 0.12 || pressure > 0.70 || calm > 0) intent = "relief";
  else if (skill > 0.48 && pressure < 0.60 && !melee && aliveRatio > 0.30) intent = "challenge";
  aiMind.intent = intent;

  // Desired variety & finesse (both bounded and braked)
  let desiredVar = 0.46 + 0.32 * skill + 0.12 * late - 0.36 * pressure - 0.22 * mercy;
  if (intent === "entertain") desiredVar += 0.10;
  if (intent === "relief") desiredVar -= 0.18;
  desiredVar = Phaser.Math.Clamp(desiredVar, 0.20, 0.85);

  let desiredFin = 0.40 + 0.42 * skill + 0.10 * late - 0.46 * pressure - 0.30 * mercy;
  if (intent === "challenge") desiredFin += 0.06;
  if (intent === "relief") desiredFin -= 0.22;
  desiredFin = Phaser.Math.Clamp(desiredFin, 0.18, 0.78);

  // Brakes: never increase cruelty under pressure; finesse scales with aiPressureMul (<=1)
  desiredFin *= Phaser.Math.Clamp((aiPressureMul || 1.0), 0.55, 1.0);

  // Smooth updates
  aiMind.variety = Phaser.Math.Clamp((aiMind.variety || 0.5) * 0.85 + desiredVar * 0.15, 0.15, 0.90);
  aiMind.finesse = Phaser.Math.Clamp((aiMind.finesse || 0.45) * 0.85 + desiredFin * 0.15, 0.10, 0.85);
}


function AI_snapLane(x) {
  const laneStep = 25;
  return Math.round(x / laneStep) * laneStep;
}

function AI_clamp01(v) { return Phaser.Math.Clamp(v, 0, 1); }

// Compute a late‑game "pressure/brake" factor (0..1).
// Higher => reduce spam, keep fairness when screen is cluttered or player is low‑life.
function AI_brakeFactor(w, aliveRatio, melee) {
  const wave = (typeof w === "number" && w > 0) ? w : 1;

  // smooth wave ramp that saturates (so late game doesn't explode)
  const late = AI_clamp01(1 - Math.exp(-(wave - 1) / 10));

  // clutter from enemy bullets
  let clutter = 0;
  if (enemyBullets && enemyBullets.countActive) {
    const cap = Math.max(1, maxEnemyBulletsNow());
    clutter = AI_clamp01(enemyBullets.countActive(true) / cap);
  }

  // struggle: fewer lives => more braking (fun fairness)
  const lifeStruggle = (lives <= 1) ? 1.0 : (lives === 2) ? 0.45 : 0.0;

  // brief mercy right after respawn invuln starts
  const invuln = (typeof invulnerabilityTimer === "number" && invulnerabilityTimer > 0) ? 1.0 : 0.0;

  // melee (<=3 enemies) is already naturally harder; apply a touch more brake.
  
  // Mercy governor: after the player is hit, ease pressure briefly (fun guard).
  const mercy = (EXP_MERCY_GOVERNOR && (aiLearn.mercyMs || 0) > 0) ? AI_clamp01((aiLearn.mercyMs || 0) / 2600) : 0;

  const meleeBoost = melee ? 0.18 : 0.0;

  // Weighted sum, capped
  return AI_clamp01(0.18 * late + 0.55 * clutter + 0.30 * lifeStruggle + 0.18 * invuln + meleeBoost + 0.30 * mercy);
}

function AI_tickLateFunGovernor(deltaMs) {
  if (!EXP_LATE_FUN_GOVERNOR) {
    aiPressureMul = 1.0;
    aiPressureEwma = 0.0;
    aiCalmMs = 0;
    aiCalmT = 0;
    return;
  }

  const w = (typeof wave === "number" && wave > 0) ? wave : 1;
  const late = AI_clamp01(1 - Math.exp(-(w - 1) / 12));

  // Enemy bullet clutter (0..1)
  let clutter = 0;
  if (enemyBullets && enemyBullets.countActive) {
    const cap = Math.max(1, maxEnemyBulletsNow());
    clutter = AI_clamp01(enemyBullets.countActive(true) / cap);
  }

  // Diving pressure (0..1)
  let divingCount = 0;
  if (enemies && enemies.children && enemies.children.entries) {
    for (const e of enemies.children.entries) {
      if (!e || !e.active) continue;
      const st = e.getData('state') || 'formation';
      if (st !== 'formation') divingCount++;
    }
  }
  const diverP = AI_clamp01(divingCount / Math.max(1, MAX_DIVING_ENEMIES || 1));

  // alive ratio and melee hint
  const alive = enemies && enemies.countActive ? enemies.countActive(true) : 0;
  const melee = (alive > 0 && alive <= 3) ? 1.0 : 0.0;

  // struggle / fairness inputs
  const struggle = (lives <= 1) ? 0.18 : (lives === 2) ? 0.08 : 0.0;
  const invuln = (typeof invulnerabilityTimer === "number" && invulnerabilityTimer > 0) ? 0.10 : 0.0;

  // composite pressure (bounded)
  let pressure = 0.52 * clutter + 0.24 * diverP + 0.14 * late + 0.10 * melee + struggle + invuln;
  pressure = AI_clamp01(pressure);

  // smooth EWMA (prevents jittery swings)
  aiPressureEwma = (aiPressureEwma * 0.88) + (pressure * 0.12);

  // deterministic "breathing" calm pulse (gives late game rhythm)
  aiCalmT += deltaMs;
  const period = 15000 + Math.min(9000, (w - 1) * 280);
  if (aiCalmT >= period) {
    aiCalmT = 0;
    // slightly longer calm later, but always short
    aiCalmMs = 1050 + Math.min(900, (w - 1) * 25);
  }
  if (aiCalmMs > 0) aiCalmMs = Math.max(0, aiCalmMs - deltaMs);

  // target pressure: skilled players can tolerate slightly more, but never becomes cruel
  const skill = (AI_SELF_IMPROVE && aiLearn) ? (aiLearn.level || 0) : 0;
  const target = Phaser.Math.Clamp(0.58 + 0.08 * skill - 0.04 * struggle, 0.52, 0.68);
  const over = aiPressureEwma - target;

  // desired multiplier (only brakes)
  let desired = Phaser.Math.Clamp(1 - over * 1.25, 0.55, 1.0);
  if (aiCalmMs > 0) desired = Math.min(desired, 0.78);

  // smooth the multiplier (director-like feel)
  aiPressureMul = Phaser.Math.Clamp(aiPressureMul * 0.90 + desired * 0.10, 0.55, 1.0);
}



// Called every frame from update(). Keeps learning deterministic and bounded.
function AI_learnTick(deltaMs) {
  if (!AI_SELF_IMPROVE) return;

  // track "habit lane" (EWMA)
  const px = (player && player.active) ? player.x : 400;

  // Swarm consciousness input: track player lateral dodge bias (EWMA)
  if (EXP_SWARM_CONSCIOUSNESS && aiMind) {
    const dx = px - (aiMind.lastPlayerX || px);
    aiMind.lastPlayerX = px;
    const dir = (dx > 1.2) ? 1 : (dx < -1.2) ? -1 : 0;
    aiMind.dodgeBias = Phaser.Math.Clamp((aiMind.dodgeBias || 0) * 0.94 + dir * 0.06, -1, 1);
  }

  const lane = AI_snapLane(px);
  aiLearn.hotLaneX = Phaser.Math.Clamp(aiLearn.hotLaneX * 0.98 + lane * 0.02, 30, 770);

  // time since hit
  aiLearn.noHitMs = Math.min(120000, (aiLearn.noHitMs || 0) + deltaMs);

  if (EXP_MERCY_GOVERNOR && (aiLearn.mercyMs || 0) > 0) {
    aiLearn.mercyMs = Math.max(0, (aiLearn.mercyMs || 0) - deltaMs);
  }
  aiLearn.accMs = (aiLearn.accMs || 0) + deltaMs;

  // update learning target periodically (~1s)
  if (aiLearn.accMs >= 1000) {
    aiLearn.accMs -= 1000;

    // Skill proxy: survive longer + kill more without getting hit.
    const survive = AI_clamp01((aiLearn.noHitMs || 0) / 45000);        // 45s -> 1.0
    const kills   = AI_clamp01((aiLearn.killsSinceHit || 0) / 14);     // 14 kills -> 1.0
    let skill = 0.55 * survive + 0.45 * kills;

    // If player is low-life, temper the learning so it doesn't feel cruel.
    if (lives <= 1) skill *= 0.72;
    if (invulnerabilityTimer > 0) skill *= 0.78;

    // Late waves: cap learning growth a bit to avoid a runaway.
    const late = AI_clamp01(1 - Math.exp(-((wave || 1) - 1) / 12));
    const cap = 0.78 - 0.10 * late; // 0.78..0.68
    aiLearn.target = Phaser.Math.Clamp(skill, 0, cap);

    // smooth towards target
    const lerp = 0.12; // per second
    aiLearn.level = Phaser.Math.Clamp(aiLearn.level * (1 - lerp) + aiLearn.target * lerp, 0, cap);
  }
}

function AI_onPlayerHit() {
  if (!AI_SELF_IMPROVE) return;
  aiLearn.noHitMs = 0;
  aiLearn.killsSinceHit = 0;


  if (EXP_MERCY_GOVERNOR) {
    aiLearn.playerHitStreak = Math.min(3, (aiLearn.playerHitStreak || 0) + 1);
    // short “mercy” window grows with streak; keeps late game fun, not cruel
    aiLearn.mercyMs = Math.max(aiLearn.mercyMs || 0, 900 + aiLearn.playerHitStreak * 550);
  }
  // learning "backs off" a bit after it lands a hit (keeps it fun)
  aiLearn.level = Math.max(0, aiLearn.level - 0.12);
  aiLearn.target = Math.max(0, aiLearn.target - 0.18);
}

function AI_onEnemyKilled(type) {
  if (!AI_SELF_IMPROVE) return;
  aiLearn.killsSinceHit = (aiLearn.killsSinceHit || 0) + 1;

  if (EXP_MERCY_GOVERNOR && (aiLearn.playerHitStreak || 0) > 0) {
    // slowly relax mercy streak as player earns kills
    if ((aiLearn.killsSinceHit % 4) === 0) aiLearn.playerHitStreak = Math.max(0, aiLearn.playerHitStreak - 1);
  }

  // small positive reinforcement when player farms too fast (enemies adapt slightly)
  const t = (type || "blue");
  const bonus = (t === "blue") ? 0.004 : (t === "purple") ? 0.006 : (t === "red") ? 0.008 : 0.010;
  aiLearn.level = Phaser.Math.Clamp(aiLearn.level + bonus, 0, 0.80);
}

let formationShootRangeMul = 2;
const FORMATION_SHOOT_LANE_SPACING = 25; // Galaxian uses +0x19 steps (~25px)

const ENEMY_BULLETS_ONSCREEN_MAX = 8;
const GALAXIAN_REF_HEIGHT = 224; // ~visible height on original hardware (rotated 224x256)
const GALAXIAN_ENEMY_BULLET_PPF = 2; // disassembly: enemy missile adds +0x02 each tick (constant speed)
const ENEMY_BULLET_SPEED_PPS = Math.round(GALAXIAN_ENEMY_BULLET_PPF * 60 * (config.height / GALAXIAN_REF_HEIGHT));


// =================== AI HELPERS (formation timing + lane snap) ===================
// These helpers never change physics. They only help enemies decide WHEN to shoot.
// Bullets remain classic vertical missiles (constant speed).
function AI_snapLane(x, laneStep = 25) {
  return Math.round(x / laneStep) * laneStep;
}

function AI_predictPlayerXAtY(shootFromY) {
  const px = (player && player.active) ? player.x : 400;
  const vx = (player && player.body) ? (player.body.velocity.x || 0) : 0;
  const py = (player && player.active) ? player.y : 560;
  const dy = Math.max(1, py - shootFromY);
  const tSec = Phaser.Math.Clamp(dy / Math.max(1, ENEMY_BULLET_SPEED_PPS), 0.05, 0.95);
  return Phaser.Math.Clamp(px + vx * tSec, 30, 770);
}


// Enemy-bullet on-screen cap (AI brake): ramps slowly with wave but never exceeds ENEMY_BULLETS_ONSCREEN_MAX.
// This keeps the game playable while still letting later waves feel heavier.
function maxEnemyBulletsNow() {
  const w = (typeof wave === "number" && wave > 0) ? wave : 1;
  const ramp = 6 + Math.floor((w - 1) / 6); // W1-6:6, W7-12:7, W13-18:8, ...
  const cap = Math.max(3, ENEMY_BULLETS_ONSCREEN_MAX);
  return Phaser.Math.Clamp(ramp, 5, cap);
}

// Bullet hitboxes: make them skinny like the original hardware (prevents “fat bullet” unfair hits).
// Call after setScale().
function setupBulletBody(bullet, kind /* "player" | "enemy" */) {
  if (!bullet || !bullet.body) return;
  const dw = bullet.displayWidth || bullet.width || 6;
  const dh = bullet.displayHeight || bullet.height || 14;

  const wMul = (kind === "player") ? 0.55 : 0.65;
  const hMul = (kind === "player") ? 0.90 : 0.92;

  const bw = Math.max(3, Math.floor(dw * wMul));
  const bh = Math.max(10, Math.floor(dh * hMul));

  bullet.body.setSize(bw, bh, true);
  bullet.body.setAllowGravity(false);
}


// Dive Director (Galaxian-style): schedule “charger” attacks on a timer so Wave 1 already has dives.
// This feels like the original: “every so often, one or more enemies leave the convoy to attack”,
// with frequency increasing later. (Deterministic via seeded POHP_gr* RNG.)
let diveDirectorMs = 0;     // legacy (kept for compatibility; v1.0.7 uses counters)
let diveBurstMs = 0;        // time until the next diver in the current burst
let diveBurstLeft = 0;      // how many divers remain to launch in this burst
let lastDiverKey = null;    // prevents “same slot repeats” feeling

let diveBurstQueue = [];    // enemies scheduled for current burst (launched sequentially)
let diveAttackFromRight = true; // 0=break left, 1=break right (Galaxian ALIENS_ATTACK_FROM_RIGHT_FLANK)

// Galaxian-style Attack Scheduler (master + secondary counters)
// The “master tick” decrements multiple “secondary” counters.
// When any secondary counter hits 0, we trigger a dive burst.
// This creates the classic “irregular but patterned” Galaxian rhythm.
const DIVE_MASTER_TICK_MS = 80;
const DIVE_COUNTER_BASES = [12, 20, 28, 38, 54]; // in master-ticks; tuned for Wave 1 fun
let diveMasterAccMs = 0;
let diveCounters = DIVE_COUNTER_BASES.slice();
let divePendingTriggers = 0;
let divePendingSquadBoost = 0;

let enemyFormation = []; // 2D
let enemyDirection = 1;

// difficulty (set by applyWaveDifficulty)
let enemySpeedBase = 30;
let enemyDiveBaseChance = 0.001;
let enemyBulletBaseChance = 0.0004;
const MAX_DIVING_ENEMIES = 6;

// rotation feel during dive
// If your enemy art points DOWN at rotation 0, keep this = -Math.PI/2
// If it points RIGHT, use 0
// If it points UP, use Math.PI/2
const ENEMY_ROT_OFFSET = -Math.PI / 2;
const ENEMY_FORMATION_ROT = Math.PI; // face DOWN in formation (if your art already faces down, set 0)
const ENEMY_DIVE_ROT      = ENEMY_FORMATION_ROT; // keep face DOWN during dive/attack
const ENEMY_RETURN_ROT    = ENEMY_FORMATION_ROT + Math.PI; // face UP while returning to formation
const ENEMY_ROT_SPEED_DIVE   = 10.0; // rad/sec turn speed while diving
const ENEMY_ROT_SPEED_RETURN = 8.0;  // rad/sec turn speed when returning

// scores
const ENEMY_SCORES = { flagship: 150, red: 100, purple: 80, blue: 30 };

// =================== HELPERS ===================
function setColliderActive(c, on) { if (c) c.active = !!on; }

function disablePlayerPhysics(p) {
  if (!p) return;
  p.setActive(false);
  p.setVisible(false);
  p.setVelocity(0, 0);
  if (p.body) {
    p.body.enable = false;
    p.body.setVelocity(0, 0);
  }
}

function enablePlayerPhysics(p, x, y) {
  if (!p) return;
  p.setPosition(x, y);
  p.setActive(true);
  p.setVisible(true);
  p.setAlpha(1);

  // critical respawn fix
  if (p.body) {
    p.body.enable = true;
    p.body.reset(x, y);
    p.body.setVelocity(0, 0);
  }
  p.setCollideWorldBounds(true);
}

function safeJSONParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function loadScores() {
  try {
    const hs = parseInt(localStorage.getItem(LS_HISCORE_KEY) || "0", 10);
    highScore = Number.isFinite(hs) ? hs : 0;

    const arr = safeJSONParse(localStorage.getItem(LS_TOP5_KEY) || "[]", []);
    topScores = Array.isArray(arr) ? arr : [];
    topScores = topScores.filter(x => x && Number.isFinite(x.score)).slice(0, 5);
  } catch {
    highScore = 0;
    topScores = [];
  }
}

function saveScores() {
  try {
    localStorage.setItem(LS_HISCORE_KEY, String(highScore));
    localStorage.setItem(LS_TOP5_KEY, JSON.stringify(topScores.slice(0, 5)));
  } catch { /* ignore */ }
}

function normalizeTopScores(arr) {
  if (!Array.isArray(arr)) return [];
  const clean = arr
    .map((x) => ({
      score: Number((x && x.score) || 0) | 0,
      wave: Math.max(1, Number((x && x.wave) || 1) | 0),
      ts: Number((x && x.ts) || Date.now()) | 0,
    }))
    .filter((x) => Number.isFinite(x.score) && x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return clean;
}

function refreshScoreTexts() {
  if (highScoreText) highScoreText.setText('HI-SCORE: ' + highScore);
  if (topText) topText.setText(formatTopScores());
}

function exportScoresBackup() {
  try {
    const payload = {
      schema: 1,
      exported_at: Date.now(),
      high_score: Number(highScore || 0),
      top5: normalizeTopScores(topScores),
    };
    const fileName = 'gkd_scores_backup_' + Date.now() + '.json';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (chainStatusText) chainStatusText.setText('SCORES: backup exported ✅');
  } catch (e) {
    if (chainStatusText) chainStatusText.setText('SCORES: export failed ❌');
  }
}

function importScoresBackupText(raw) {
  const data = safeJSONParse(String(raw || ''), null);
  if (!data || typeof data !== 'object') throw new Error('Invalid backup JSON');
  const importedTop = normalizeTopScores(data.top5 || []);
  const importedHigh = Math.max(0, Number(data.high_score || 0) | 0);
  const bestTop = importedTop.length ? importedTop[0].score : 0;
  highScore = Math.max(importedHigh, bestTop);
  topScores = importedTop;
  saveScores();
  refreshScoreTexts();
}

function importScoresBackup() {
  if (!scoreImportInput) {
    scoreImportInput = document.createElement('input');
    scoreImportInput.type = 'file';
    scoreImportInput.accept = 'application/json,.json';
    scoreImportInput.style.display = 'none';
    document.body.appendChild(scoreImportInput);
    scoreImportInput.addEventListener('change', () => {
      const f = scoreImportInput && scoreImportInput.files && scoreImportInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          importScoresBackupText(String(reader.result || ''));
          if (chainStatusText) chainStatusText.setText('SCORES: backup imported ✅');
        } catch (e) {
          if (chainStatusText) chainStatusText.setText('SCORES: import failed ❌');
        }
      };
      reader.readAsText(f);
      scoreImportInput.value = '';
    });
  }
  scoreImportInput.click();
}

function maybeUpdateHighScore() {
  if (score > highScore) {
    highScore = score;
    return true;
  }
  return false;
}

function pushTopScore(s, w) {
  const entry = { score: s, wave: w, ts: Date.now() };
  topScores.push(entry);
  topScores.sort((a, b) => b.score - a.score);
  topScores = topScores.slice(0, 5);
}

function formatTopScores() {
  if (!topScores.length) return "TOP 5:\n—";
  const lines = ["TOP 5:"];
  for (let i = 0; i < topScores.length; i++) {
    const e = topScores[i];
    lines.push(`${i + 1}. ${e.score}  (W${e.wave})`);
  }
  return lines.join("\n");
}

// Hash helpers (blockchain payload)
function fnv1a32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ("00000000" + (h >>> 0).toString(16)).slice(-8);
}

async function sha256Hex(str) {
  if (!window.crypto || !crypto.subtle) return fnv1a32(str);
  const buf = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// =================== PROOF OF HIGH PLAY (Seeded RNG + Input Log + Run Package + Replay Verify) ===================
// Goal: keep gameplay rules the same, but make runs replayable & verifiable.
// - NO nondeterministic random() anywhere (we use seeded RNG streams)
// - Record: (inputs per frame) + (delta ms per frame) + (seed)
// - Export: runPackage.json on GAME OVER
// - Replay mode: ?replay=1 lets you load runPackage.json and re-simulate to PASS/FAIL score.

const POHP_SCHEMA_VERSION = 2;
const POHP_GAME_ID = "420_HIGH_SCORE_GALAXIAN";   // metadata only (does not affect gameplay)
const POHP_GAME_VERSION = "GKD|RULESET=v1.4.0|BUILD=main.js";       // bump when you change gameplay-affecting logic       // bump when you change gameplay-affecting logic       // bump when you change gameplay-affecting logic

// (Chain fields placeholders for later Solana integration)
const POHP_DEFAULT_SEASON_ID = 1;
const POHP_DEFAULT_FEE_LAMPORTS = 0;

let POHP_SEASON_ID = POHP_DEFAULT_SEASON_ID;
let POHP_FEE_LAMPORTS = POHP_DEFAULT_FEE_LAMPORTS;
let POHP_ENTRY_SIG = "";
let POHP_ENTRY_SLOT = 0;
let POHP_RUN_TICKET_ID = "";

let POHP_PLAYER_PUBKEY = ""; // set from connected wallet (base58) for serious runs

// Small global API so blockchain/solana code can plug-in without touching gameplay.
window.POHP = window.POHP || {};
window.POHP.setPlayerPubkey = (pk) => { POHP_PLAYER_PUBKEY = (pk || "").toString(); };
window.POHP.setSeasonId = (sid) => {
  const n = Number(sid);
  POHP_SEASON_ID = Number.isFinite(n) ? n : POHP_DEFAULT_SEASON_ID;
};
window.POHP.setEntryProof = ({ fee_lamports = 0, entry_sig = "", entry_slot = 0 } = {}) => {
  POHP_FEE_LAMPORTS = Number(fee_lamports) || 0;
  POHP_ENTRY_SIG = (entry_sig || "").toString();
  POHP_ENTRY_SLOT = Number(entry_slot) || 0;
};
window.POHP.setRunTicket = ({ run_ticket_id = "" } = {}) => {
  POHP_RUN_TICKET_ID = (run_ticket_id || "").toString();
};


// Input bits per frame
const POHP_INPUT_BITS = { LEFT: 1, RIGHT: 2, SHOOT: 4 };

// Runtime state
let POHP_runSeed = 0;
let POHP_runStartTs = 0;
let POHP_runEndTs = 0;

// Two independent RNG streams:
// - Visual RNG: stars etc. (never affects gameplay RNG sequence)
// - Game RNG: ONLY gameplay-critical randomness (dives, bullet speed, enemy pick)
let POHP_rngVisual = null;
let POHP_rngGame = null;

function POHP_mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a += 0x6D2B79F5;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function POHP_u32Seed() {
  try {
    if (window.crypto && crypto.getRandomValues) {
      const u = new Uint32Array(1);
      crypto.getRandomValues(u);
      return u[0] >>> 0;
    }
  } catch { /* ignore */ }
  // deterministic-ish fallback (still deterministic)
  return (Date.now() >>> 0) ^ 0xA5A5A5A5;
}

function POHP_initVisualRngOnce() {
  if (POHP_rngVisual) return;
  POHP_rngVisual = POHP_mulberry32(POHP_u32Seed());
}

function POHP_setGameRng(seedU32) {
  POHP_rngGame = POHP_mulberry32(seedU32 >>> 0);
}

function POHP_vrFloat() { return POHP_rngVisual ? POHP_rngVisual() : 0.5; }
function POHP_grFloat() { return POHP_rngGame ? POHP_rngGame() : 0.5; }


// NOTE++ helper: chance(p) used by AI cadence code (deterministic)
function POHP_grChance(p) {
  p = Number(p);
  if (!Number.isFinite(p)) return false;
  if (p <= 0) return false;
  if (p >= 1) return true;
  return POHP_grFloat() < p;
}

// NOTE++ helper: integer RNG
// - POHP_grInt(n) -> 0..n-1
// - POHP_grInt(min, max) -> min..max
function POHP_grInt(a, b) {
  if (b === undefined) {
    const n = Math.floor(Number(a));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(POHP_grFloat() * n);
  }

  const min = Math.floor(Number(a));
  const max = Math.floor(Number(b));
  if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
  if (max < min) return min;
  return POHP_grBetween(min, max);
}

// NOTE++ helper: signed integer RNG in [-maxAbs, +maxAbs] (deterministic)
function POHP_grSigned(maxAbs) {
  maxAbs = Math.floor(Number(maxAbs));
  if (!Number.isFinite(maxAbs) || maxAbs <= 0) return 0;
  const span = maxAbs * 2 + 1; // inclusive
  return Math.floor(POHP_grFloat() * span) - maxAbs;
}

function POHP_vrBetween(min, max) {
  const r = POHP_vrFloat();
  return Math.floor(r * (max - min + 1)) + min;
}
function POHP_vrFloatBetween(min, max) {
  return min + POHP_vrFloat() * (max - min);
}


function POHP_grBetween(min, max) {
  const r = POHP_grFloat();
  return Math.floor(r * (max - min + 1)) + min;
}
function POHP_grFloatBetween(min, max) {
  return min + POHP_grFloat() * (max - min);
}
function POHP_grPick(arr) {
  if (!arr || arr.length === 0) return null;
  const i = Math.floor(POHP_grFloat() * arr.length);
  return arr[i];
}

function POHP_hash32(str) {
  // FNV-1a 32-bit, deterministic and cheap for per-frame checkpoints.
  let h = 0x811c9dc5 >>> 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function POHP_hex8(u32) {
  return (u32 >>> 0).toString(16).padStart(8, "0");
}

function POHP_recordCheckpoint(force) {
  if (!POHP_record.active) return;
  const every = Math.max(1, POHP_record.checkpointEveryFrames | 0);
  if (!force && (POHP_record.frame % every !== 0)) return;
  if (!force && POHP_record.frame === POHP_record.lastCheckpointFrame) return;

  const fr = POHP_record.frame | 0;
  const sc = score | 0;
  const wv = wave | 0;
  const lv = lives | 0;
  POHP_record.checkpoints.push([fr, sc, wv, lv]);
  const prev = String(POHP_record.checkpointChain || "00000000");
  const mat = prev + "|" + fr + "|" + sc + "|" + wv + "|" + lv;
  POHP_record.checkpointChain = POHP_hex8(POHP_hash32(mat));
  POHP_record.lastCheckpointFrame = fr;
}

// Recorder (LIVE mode)
const POHP_record = {
  active: false,
  masks: [],   // number[] (0..7)
  deltas: [],  // number[] (ms)
  prevMask: 0,
  frame: 0,
  checkpoints: [], // [frame, score, wave, lives]
  checkpointEveryFrames: 60,
  checkpointChain: "00000000",
  lastCheckpointFrame: 0,
};

// Replay (VERIFY mode)
const POHP_replay = {
  requested: false,  // ?replay=1
  enabled: false,
  loaded: false,
  frame: 0,
  simTimeMs: 0,
  masks: null,   // Uint8Array
  deltas: null,  // Uint16Array
  expectedScore: 0,
  expectedWave: 0,
  packageReplayHash: "",
  packageRunHash: "",
  packageVersionHash: "",
  hashOk: null,   // null | true | false
  schema: POHP_SCHEMA_VERSION,
  // internal: cached copies for integrity check
  masks_b64: "",
  deltas_b64: "",
  seed: 0
  ,
  checkpoints_b64: "",
  checkpoint_chain_final: "",
  checkpoints_every_frames: 0
};

// Last built run package (built on Game Over; downloaded via user gesture)
let POHP_lastPackage = null;
let POHP_lastPackageName = "";
let POHP_lastPackageReady = false;

// Per-frame input state (shared by live + replay)
const POHP_input = {
  mask: 0,
  prevMask: 0,
  left: false,
  right: false,
  shoot: false,
  shootJust: false
};

function POHP_isReplayRequested() {
  try {
    const qs = new URLSearchParams(window.location.search);
    return qs.get("replay") === "1";
  } catch { return false; }
}

// --- base64 packing helpers (compact runPackage) ---
function POHP_u8ToB64(u8) {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin);
}
function POHP_b64ToU8(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i) & 0xff;
  return u8;
}
function POHP_u16ToB64(u16) {
  const bytes = new Uint8Array(u16.length * 2);
  for (let i = 0; i < u16.length; i++) {
    const v = u16[i] & 0xffff;
    bytes[i * 2] = v & 0xff;
    bytes[i * 2 + 1] = (v >>> 8) & 0xff;
  }
  return POHP_u8ToB64(bytes);
}
function POHP_b64ToU16(b64) {
  const bytes = POHP_b64ToU8(b64);
  const n = Math.floor(bytes.length / 2);
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = (bytes[i * 2] | (bytes[i * 2 + 1] << 8)) & 0xffff;
  }
  return out;
}

function POHP_downloadJSON(filename, obj) {
  try {
    const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.log("RUN PACKAGE:", obj);
  }
}


function POHP_tryDownloadLatest() {
  try {
    if (POHP_lastPackageReady && POHP_lastPackage && POHP_lastPackageName) {
      POHP_downloadJSON(POHP_lastPackageName, POHP_lastPackage);
      if (pohpStatusText) pohpStatusText.setText('PROOF: downloaded ✅  (' + POHP_lastPackageName + ')');
      return true;
    }
    // If user refreshed, try recover from localStorage
    const n = localStorage.getItem('pohp_last_runPackage_name');
    const j = localStorage.getItem('pohp_last_runPackage_json');
    if (n && j) {
      POHP_downloadJSON(n, JSON.parse(j));
      if (pohpStatusText) pohpStatusText.setText('PROOF: downloaded ✅  (' + n + ')');
      return true;
    }
    if (pohpStatusText) pohpStatusText.setText('PROOF: not ready yet (finish a run first)');
    return false;
  } catch (e) {
    if (pohpStatusText) pohpStatusText.setText('PROOF: download blocked — check Ctrl+J (Downloads)');
    return false;
  }
}


function POHP_readLiveMask() {
  let m = 0;
  if (cursors && cursors.left && cursors.left.isDown) m |= POHP_INPUT_BITS.LEFT;
  if (cursors && cursors.right && cursors.right.isDown) m |= POHP_INPUT_BITS.RIGHT;
  if (spaceKey && spaceKey.isDown) m |= POHP_INPUT_BITS.SHOOT;
  return m;
}

// Called at the start of each RUN (beginGame)
function POHP_beginRunSession() {
  POHP_runStartTs = Date.now();
  POHP_runEndTs = 0;

  POHP_record.prevMask = 0;
  POHP_input.mask = 0;
  POHP_input.prevMask = 0;

  // Replay run uses the seed embedded in the package
  if (POHP_replay.enabled && POHP_replay.loaded) {
    POHP_runSeed = (POHP_replay.seed >>> 0);
    POHP_setGameRng(POHP_runSeed);
    POHP_record.active = false;
    return;
  }

  // Live run: new seed, start recording frames
  POHP_runSeed = POHP_u32Seed();
  POHP_setGameRng(POHP_runSeed);

  POHP_record.masks = [];
  POHP_record.deltas = [];
  POHP_record.frame = 0;
  POHP_record.checkpoints = [];
  POHP_record.checkpointEveryFrames = 60;
  POHP_record.checkpointChain = "00000000";
  POHP_record.lastCheckpointFrame = 0;
  POHP_record.active = true;
}

// Replay step override: use recorded delta/time and recorded input mask
function POHP_replayOverrideTimeDelta(time, delta) {
  if (!(POHP_replay.enabled && POHP_replay.loaded)) return { time, delta };

  const d = POHP_replay.deltas[POHP_replay.frame] || 16;
  POHP_replay.simTimeMs += d;
  return { time: POHP_replay.simTimeMs, delta: d };
}

function POHP_advanceInputsAndRecord(deltaMs) {
  POHP_input.prevMask = POHP_input.mask;

  if (POHP_replay.enabled && POHP_replay.loaded) {
    POHP_input.mask = (POHP_replay.frame < POHP_replay.masks.length) ? POHP_replay.masks[POHP_replay.frame] : 0;
  } else {
    POHP_input.mask = POHP_readLiveMask();
  }

  const m = POHP_input.mask;
  const pm = POHP_input.prevMask;

  POHP_input.left = !!(m & POHP_INPUT_BITS.LEFT);
  POHP_input.right = !!(m & POHP_INPUT_BITS.RIGHT);
  POHP_input.shoot = !!(m & POHP_INPUT_BITS.SHOOT);
  POHP_input.shootJust = POHP_input.shoot && !(pm & POHP_INPUT_BITS.SHOOT);

  // Record only during live run while RUNNING
  if (POHP_record.active) {
    POHP_record.masks.push(m & 0xff);
    const d = Math.max(0, Math.min(65535, Math.round(deltaMs)));
    POHP_record.deltas.push(d);
    POHP_record.frame += 1;
  }

  // Replay advances one frame per simulation step
  if (POHP_replay.enabled && POHP_replay.loaded) {
    POHP_replay.frame += 1;
  }
}

async function POHP_buildRunPackage(finalScore, finalWave) {
  const versionHash = await sha256Hex(POHP_GAME_VERSION);
  const seedCommit = await sha256Hex("seed:" + String(POHP_runSeed >>> 0));

  const masksU8 = new Uint8Array(POHP_record.masks);
  const deltasU16 = new Uint16Array(POHP_record.deltas);

  const masks_b64 = POHP_u8ToB64(masksU8);
  const deltas_b64 = POHP_u16ToB64(deltasU16);
  const checkpoints_json = JSON.stringify(POHP_record.checkpoints || []);
  const checkpoints_b64 = btoa(checkpoints_json);
  const checkpoints_every_frames = POHP_record.checkpointEveryFrames | 0;
  const checkpoint_chain_final = String(POHP_record.checkpointChain || "00000000");
  const checkpoints_len = (POHP_record.checkpoints || []).length;

  const replayMaterial = JSON.stringify({
    schema: POHP_SCHEMA_VERSION,
    game_id: POHP_GAME_ID,
    version_hash: versionHash,
    seed: POHP_runSeed >>> 0,
    masks_b64,
    deltas_b64,
    checkpoints_b64,
    checkpoints_every_frames,
    checkpoint_chain_final
  });

  const replay_hash = await sha256Hex(replayMaterial);

  const runMaterial = [
    POHP_PLAYER_PUBKEY || "",
    POHP_GAME_ID,
    String(POHP_SEASON_ID),
    String(POHP_FEE_LAMPORTS),
    POHP_ENTRY_SIG || "",
    String(POHP_ENTRY_SLOT),
    POHP_RUN_TICKET_ID || "",
    String(finalScore),
    replay_hash,
    versionHash
  ].join("|");

  const run_hash = await sha256Hex(runMaterial);

  return {
    schema: POHP_SCHEMA_VERSION,
    game_id: POHP_GAME_ID,
    game_version: POHP_GAME_VERSION,
    version_hash: versionHash,

    player_pubkey: POHP_PLAYER_PUBKEY || "",
    season_id: POHP_SEASON_ID,
    fee_lamports: POHP_FEE_LAMPORTS,
    entry_sig: POHP_ENTRY_SIG || "",
    entry_slot: POHP_ENTRY_SLOT,
    run_ticket_id: POHP_RUN_TICKET_ID || "",

    start_ts: POHP_runStartTs,
    end_ts: POHP_runEndTs || Date.now(),

    seed: POHP_runSeed >>> 0,
    seed_commit: seedCommit,

    final_score: finalScore,
    final_wave: finalWave,

    masks_len: masksU8.length,
    deltas_len: deltasU16.length,
    masks_b64,
    deltas_b64,
    checkpoints_len,
    checkpoints_b64,
    checkpoints_every_frames,
    checkpoint_chain_final,

    replay_hash,
    run_hash
  };
}

async function POHP_exportRunPackageOnGameOver(finalScore, finalWave) {
  POHP_recordCheckpoint(true);
  POHP_runEndTs = Date.now();
  POHP_record.active = false;

  const pkg = await POHP_buildRunPackage(finalScore, finalWave);
  const fname = `runPackage_${POHP_GAME_ID}_score${finalScore}_ts${POHP_runStartTs}.json`;
  POHP_downloadJSON(fname, pkg);
  return pkg;
}

async function POHP_finalizeRunPackageOnGameOver(finalScore, finalWave) {
  POHP_recordCheckpoint(true);
  POHP_runEndTs = Date.now();
  POHP_record.active = false;
  POHP_lastPackageReady = false;

  const pkg = await POHP_buildRunPackage(finalScore, finalWave);
  POHP_lastPackage = pkg;
  POHP_lastPackageName = `runPackage_${POHP_GAME_ID}_score${finalScore}_ts${POHP_runStartTs}.json`;
  POHP_lastPackageReady = true;

  // Also stash last package in localStorage as backup (download can be blocked by browsers if not user-triggered)
  try {
    localStorage.setItem("pohp_last_runPackage_name", POHP_lastPackageName);
    localStorage.setItem("pohp_last_runPackage_json", JSON.stringify(pkg));
  } catch {}
  return pkg;
}

async function POHP_verifyLoadedPackage() {
  try {
    const versionHash = await sha256Hex(POHP_GAME_VERSION);
    const schema = Number(POHP_replay.schema || POHP_SCHEMA_VERSION);
    const replayObj = {
      schema: Number(POHP_replay.schema || POHP_SCHEMA_VERSION),
      game_id: POHP_GAME_ID,
      version_hash: versionHash,
      seed: POHP_replay.seed >>> 0,
      masks_b64: POHP_replay.masks_b64,
      deltas_b64: POHP_replay.deltas_b64
    };
    if (schema >= 2) {
      replayObj.checkpoints_b64 = POHP_replay.checkpoints_b64 || "";
      replayObj.checkpoints_every_frames = POHP_replay.checkpoints_every_frames || 0;
      replayObj.checkpoint_chain_final = POHP_replay.checkpoint_chain_final || "";
    }
    const replayMaterial = JSON.stringify(replayObj);
    const replay_hash = await sha256Hex(replayMaterial);
    POHP_replay.hashOk = (replay_hash === POHP_replay.packageReplayHash);
  } catch {
    POHP_replay.hashOk = null;
  }
}

// UI loader for replay packages (?replay=1)
function POHP_setupReplayLoader(scene) {
  POHP_replay.requested = true;

  const t = scene.add.text(
    400, 520,
    "REPLAY MODE: choose runPackage.json\n(Score will be recomputed and checked)",
    { fontSize: "16px", fill: "#0f0", fontFamily: "Courier New", align: "center" }
  ).setOrigin(0.5).setDepth(20);

  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "application/json";
  inp.style.position = "absolute";
  inp.style.left = "12px";
  inp.style.top = "12px";
  inp.style.zIndex = "9999";
  inp.style.padding = "6px";
  inp.style.background = "rgba(0,0,0,0.7)";
  inp.style.color = "#0f0";
  inp.style.border = "1px solid #0f0";

  document.body.appendChild(inp);

  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;

    try {
      const raw = await f.text();
      const pkg = JSON.parse(raw);

      if (!pkg || ![1, 2].includes(Number(pkg.schema)) || !pkg.masks_b64 || !pkg.deltas_b64) {
        throw new Error("Invalid runPackage schema");
      }

      POHP_replay.enabled = true;
      POHP_replay.loaded = true;
      POHP_replay.schema = Number(pkg.schema || POHP_SCHEMA_VERSION);
      POHP_replay.frame = 0;
      POHP_replay.simTimeMs = 0;

      POHP_replay.expectedScore = pkg.final_score | 0;
      POHP_replay.expectedWave = pkg.final_wave | 0;

      POHP_replay.seed = (pkg.seed >>> 0);

      POHP_replay.packageReplayHash = String(pkg.replay_hash || "");
      POHP_replay.packageRunHash = String(pkg.run_hash || "");

      POHP_replay.masks_b64 = String(pkg.masks_b64);
      POHP_replay.deltas_b64 = String(pkg.deltas_b64);
      POHP_replay.checkpoints_b64 = String(pkg.checkpoints_b64 || "");
      POHP_replay.checkpoint_chain_final = String(pkg.checkpoint_chain_final || "");
      POHP_replay.checkpoints_every_frames = Number(pkg.checkpoints_every_frames || 0);

      POHP_replay.masks = POHP_b64ToU8(POHP_replay.masks_b64);
      POHP_replay.deltas = POHP_b64ToU16(POHP_replay.deltas_b64);

      POHP_setGameRng(POHP_replay.seed);

      POHP_verifyLoadedPackage();

      try { inp.remove(); } catch {}
      try { t.destroy(); } catch {}

      unlockAudioOnce(scene);
      beginGame(scene);
    } catch (e) {
      console.error(e);
      t.setText("REPLAY MODE: invalid runPackage.json\nCheck console for details");
    }
  });
}


function buildScorePayload() {
  return { game: "GalaxyKingDog", version: "1.0", score, wave, ts: Date.now() };
}

async function submitScoreToChain() {
  // Now submits the PoHP runPackage proof (NOT score stub). Gameplay unchanged.

  const pkg =
    POHP_lastPackage ||
    safeJSONParse(localStorage.getItem("pohp_last_runPackage_json") || "null", null);

  if (!pkg) {
    if (chainStatusText) chainStatusText.setText("CHAIN: no runPackage yet (finish a run)");
    return;
  }

  if (!window.CHAIN?.enabled) {
    if (chainStatusText) chainStatusText.setText("CHAIN: disabled (config)");
    return;
  }

  if (!window.ChainClient?.finalizeRun) {
    if (chainStatusText) chainStatusText.setText("CHAIN: chain client missing");
    return;
  }

  try {
    // verify → (optional submit if submitUrl exists)
    await window.ChainClient.finalizeRun(pkg);
  } catch (e) {
    if (chainStatusText) chainStatusText.setText("CHAIN: error " + String(e?.message || e));
  }
}


function aliveRatioNow() {
  if (!formationTotalAtWave) return 1;
  return Phaser.Math.Clamp(enemies.countActive(true) / formationTotalAtWave, 0, 1);
}

// =================== WAVE DIFFICULTY ===================
function applyWaveDifficulty(waveNum) {
  // Late-game safe ramp: grows early, then soft-caps so endless mode stays playable.
  const w = Math.max(1, waveNum);
  const x = Math.max(0, w - 1);
  const late = Phaser.Math.Clamp(1 - Math.exp(-x / 14), 0, 1);

  // Movement: early linear feel + late soft cap
  const baseSpeed        = 28 + 34 * late + Math.min(16, 0.65 * x);

  // Rates: rise early, then flatten (avoid bullet storms)
  const baseDiveChance   = 0.00085 + 0.00110 * late + Math.min(0.00024, 0.00002 * x);
  const baseBulletChance = 0.00055 + 0.00095 * late + Math.min(0.00026, 0.00002 * x);

  const sMul = waveSpeedMul(w);
  const rMul = waveRateMul(w);

  enemySpeedBase        = baseSpeed * ENEMY_SPEED_FACTOR * sMul * DIFFICULTY_SCALE;
  enemyDiveBaseChance   = baseDiveChance * ENEMY_CHANCE_FACTOR * rMul * DIFFICULTY_SCALE;
  enemyBulletBaseChance = baseBulletChance * ENEMY_CHANCE_FACTOR * rMul * DIFFICULTY_SCALE;
}

// =================== PRELOAD ===================
function preload() {
  // images
  this.load.image('background',     'assets/backround1.jpg');
  this.load.image('ship',           'assets/ship.png');
  this.load.image('enemy_blue',     'assets/enemy_blue.png');
  this.load.image('enemy_red',      'assets/enemy_red.png');
  this.load.image('enemy_purple',   'assets/enemy_purple.png');
  this.load.image('enemy_flagship', 'assets/enemy_flagship.png');
  this.load.image('bullet_player',  'assets/bullet_player.png');
  this.load.image('bullet_enemy',   'assets/bullet_enemy.png');
  this.load.image('explosion',      'assets/explosion.png');
  this.load.image('boom',           'assets/boom.png');

  // start/countdown/gameover
  this.load.image('start_icon', 'assets/start_game.png');
  this.load.image('count3',     'assets/assets3.png');
  this.load.image('count2',     'assets/assets2.png');
  this.load.image('count1',     'assets/assets1.png');
  this.load.image('gameover',   'assets/gameover.png');

  // audio
  this.load.audio('bgm',                 'assets/bgm_galaxy_mystery_loop.wav');
  this.load.audio('sfx_player_shoot',    'assets/sfx_laser1.ogg');
  this.load.audio('sfx_hitship',         'assets/sfx_laser1.ogg'); // reuse (lower volume + rate)
  this.load.audio('sfx_enemy_move_loop', 'assets/sfx_enemy_move_loop.wav');
  this.load.audio('sfx_enemy_dive_loop', 'assets/sfx_enemy_dive_loop.wav');
}

// =================== AUDIO INIT (after first user gesture) ===================
function unlockAudioOnce(scene) {
  if (audioUnlocked) return;
  audioUnlocked = true;

  // create sounds (guard: only if loaded)
  if (scene.cache.audio.exists('bgm')) bgm = scene.sound.add('bgm', { loop: true, volume: 0 });
  if (scene.cache.audio.exists('sfx_player_shoot')) sfxPlayerShoot = scene.sound.add('sfx_player_shoot', { volume: SFX_SHOOT_VOLUME });
  if (scene.cache.audio.exists('sfx_hitship')) sfxHitShip = scene.sound.add('sfx_hitship', { volume: SFX_HIT_VOLUME, rate: 0.85 });

  if (scene.cache.audio.exists('sfx_enemy_move_loop')) sfxEnemyMoveLoop = scene.sound.add('sfx_enemy_move_loop', { loop: true, volume: 0 });
  if (scene.cache.audio.exists('sfx_enemy_dive_loop')) sfxEnemyDiveLoop = scene.sound.add('sfx_enemy_dive_loop', { loop: true, volume: 0 });

  // start loops silently (so later we only fade volume)
  if (bgm) bgm.play();
  if (sfxEnemyMoveLoop) sfxEnemyMoveLoop.play();
  if (sfxEnemyDiveLoop) sfxEnemyDiveLoop.play();
}

function setLoopVolume(snd, target) {
  if (!snd) return;
  const cur = snd.volume ?? 0;
  const next = Phaser.Math.Linear(cur, target, 0.08);
  snd.setVolume(next);
}

// =================== CREATE ===================
function create() {
  POHP_initVisualRngOnce();
  loadScores();
  mainScene = this;

  // background
  this.add.image(400, 300, 'background').setDisplaySize(800, 600);

  // starfield
  stars = this.add.group();
  for (let i = 0; i < 100; i++) {
    const star = this.add.rectangle(
      POHP_vrBetween(0, 800),
      POHP_vrBetween(0, 600),
      2, 2, 0xffffff
    );
    star.setAlpha(POHP_vrFloatBetween(0.3, 1));
    stars.add(star);
  }

  // groups
  enemies = this.physics.add.group();
  enemyBullets = this.physics.add.group();
  playerBullets = this.physics.add.group();

  // bullet pooling
  const MAX_PLAYER_BULLETS = 12;
  const MAX_ENEMY_BULLETS  = 32;

  for (let i = 0; i < MAX_PLAYER_BULLETS; i++) {
    const b = this.physics.add.sprite(-100, -100, 'bullet_player');
    b.setActive(false); b.setVisible(false);
    b.setScale(0.6);
    setupBulletBody(b, "player");
    if (b.body) b.body.enable = false;
    playerBullets.add(b);
  }
  for (let i = 0; i < MAX_ENEMY_BULLETS; i++) {
    const b = this.physics.add.sprite(-100, -100, 'bullet_enemy');
    b.setActive(false); b.setVisible(false);
    b.setScale(0.5);
    setupBulletBody(b, "enemy");
    if (b.body) b.body.enable = false;
    enemyBullets.add(b);
  }

  // player + formation
  createPlayer(this);
  createEnemyFormation(this);

  // input
  cursors    = this.input.keyboard.createCursorKeys();
  spaceKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  restartKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
  submitKey  = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.B);
  proofKey   = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
  exportScoresKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.H);
  importScoresKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.J);

  // UI
  const uiStyle = { fontSize: '20px', fill: '#0f0', fontFamily: 'Courier New' };
  scoreText = this.add.text(10, 10, 'SCORE: 0', uiStyle);
  livesText = this.add.text(10, 40, 'LIVES: 3', uiStyle);
  waveText  = this.add.text(10, 70, 'WAVE: 1',  uiStyle);
  highScoreText = this.add.text(10, 100, 'HI-SCORE: ' + highScore, uiStyle);
  topText = this.add.text(10, 130, formatTopScores(), { ...uiStyle, fontSize: '16px' });

  chainStatusText = this.add.text(10, 260, '', { fontSize: '14px', fill: '#0f0', fontFamily: 'Courier New' }).setDepth(50);

// --- Chain UI hook (does NOT change gameplay mechanics) ---
// --- Chain UI hook (does NOT change gameplay mechanics) ---
window.__CHAIN_STATUS_CB = (msg) => {
  try {
    if (!chainStatusText) return;
    if (gamePhase === GAME_PHASE.GAME_OVER) {
      chainStatusText.setText(msg + "\nR = RESTART   B = SUBMIT PROOF (CHAIN)   P = DOWNLOAD PROOF   H = EXPORT SCORES   J = IMPORT SCORES");
    } else {
      chainStatusText.setText(msg);
    }
  } catch (e) {}
};

if (window.ChainClient && typeof window.ChainClient.init === 'function') {
  window.ChainClient.init();
} else {
  window.__CHAIN_STATUS_CB('CHAIN: client not loaded');
}

  pohpStatusText  = this.add.text(10, 290, '', { fontSize: '14px', fill: '#0f0', fontFamily: 'Courier New' }).setDepth(50);
  // POHP download button (shown on GAME OVER) — click works even if keyboard is weird
  pohpDownloadText = this.add.text(10, 320, '⬇ DOWNLOAD runPackage.json (click or press P)', { fontSize: '16px', fill: '#ff0', fontFamily: 'Courier New' })
    .setDepth(50)
    .setInteractive({ useHandCursor: true })
    .setVisible(false);
  pohpDownloadText.on('pointerdown', () => {
    POHP_tryDownloadLatest();
  });



  // game over image (hidden)
  gameOverImage = this.add.image(400, 300, 'gameover').setOrigin(0.5).setScale(0.85).setDepth(10).setVisible(false);

  // last-life aura
  boomAura = this.add.image(400, 550, 'boom')
    .setOrigin(0.5)
    .setScale(0.29)
    .setDepth(4)
    .setVisible(false);

  // collisions
  playerBulletEnemyCollider = this.physics.add.overlap(playerBullets, enemies, hitEnemy, null, this);
  enemyBulletPlayerCollider = this.physics.add.overlap(enemyBullets, player, hitPlayer, null, this);
  enemyPlayerCollider = this.physics.add.overlap(enemies, player, (enemy, playerObj) => hitPlayer(enemy, playerObj), null, this);

  respawnTimer = 0;
  invulnerabilityTimer = 0;

  // show start screen
  showStartScreen(this);

  // Optional replay verify mode: open index.html?replay=1
  if (POHP_isReplayRequested()) {
    POHP_setupReplayLoader(this);
  }
}

// =================== PLAYER CREATION ===================
function createPlayer(scene) {
  player = scene.physics.add.sprite(400, 550, 'ship');
  player.setCollideWorldBounds(true);
  player.setScale(0.8);
  player.setVelocity(0, 0);

  if (player.body) {
    player.body.enable = true;
    player.body.reset(400, 550);
    player.body.setVelocity(0, 0);
  }

  playerState = PLAYER_STATE.PLAYING;
  invulnerabilityTimer = 0;
  respawnTimer = 0;
}

// =================== ENEMY FORMATION CREATION ===================
function centeredXs(count, spacing) {
  const totalW = (count - 1) * spacing;
  const startX = FORMATION_CENTER_X - totalW / 2;
  const xs = [];
  for (let i = 0; i < count; i++) xs.push(startX + i * spacing);
  return xs;
}

function createEnemyFormation(scene) {
  enemies.clear(true, true);
  enemyFormation = [];
  enemyDirection = 1;
  formationSwayMs = 0;
  formationSwayPrev = 0;
  formationMoveAccPx = 0;
  formationTotalAtWave = 0;

  const layout = [
    { key: 'enemy_flagship', type: 'flagship', count: 2 },
    { key: 'enemy_red',      type: 'red',      count: 6 },
    { key: 'enemy_purple',   type: 'purple',   count: 8 },
    { key: 'enemy_blue',     type: 'blue',     count: 10 },
    { key: 'enemy_blue',     type: 'blue',     count: 10 },
  ];

  layout.forEach((rowDef, row) => {
    enemyFormation[row] = [];
    const xs = centeredXs(rowDef.count, ENEMY_SPACING_X);
    const y  = ENEMY_START_Y + FORMATION_Y_OFFSET + row * ENEMY_SPACING_Y;

    xs.forEach((x, i) => {
      const col = i;
      const e = scene.physics.add.sprite(x, y, rowDef.key);
      e.setScale(0.6);

      e.setData('row', row);
      e.setData('col', col);
      e.setData('slotKey', row + ':' + col);
      e.setData('type', rowDef.type);

      // AI kernel tags (formation brains)
      e.setData('kernel', rowDef.type);
      e.setData('fShotCdMs', 0);

      // home slot
      e.setData('homeX', x);
      e.setData('homeY', y);

      // dive state
      e.setData('state', 'formation'); // formation | diveLoop | diveStraight | returning
      e.setData('loopT', 0);
      e.setData('loopDir', 1);
      e.setData('diveTargetX', x);

      // rotation tracking
      e.setData('prevX', x);
      e.setData('prevY', y);

      e.setRotation(ENEMY_FORMATION_ROT);

      enemies.add(e);
      formationTotalAtWave += 1;
      enemyFormation[row][col] = e;
    });
  });

  // snapshot total at wave start (used for AI ratios)
  totalEnemiesSpawnedAtWaveStart = formationTotalAtWave;

  // reset dive timing for this wave/formation
  resetDiveDirectorForWave();
}

// =================== START SCREEN ===================
function showStartScreen(scene) {
  gamePhase = GAME_PHASE.START;
  countdownInProgress = false;

  // stop gameplay
  scene.physics.pause();
  clearAllBullets();

  // hide game over
  if (gameOverImage) gameOverImage.setVisible(false);
  if (chainStatusText) chainStatusText.setText('');
  if (pohpStatusText) pohpStatusText.setText('');

  // hide player/enemies while waiting
  disablePlayerPhysics(player);
  enemies.children.entries.forEach(e => { e.setActive(false); e.setVisible(false); if (e.body) e.body.enable = false; });

  // show start icon
  if (startIcon) startIcon.destroy();
  startIcon = scene.add.image(400, START_ICON_Y, 'start_icon')
    .setOrigin(0.5)
    .setAlpha(1)
    .setDisplaySize(START_ICON_TARGET_W, START_ICON_TARGET_H)
    .setDepth(9);

  // blink
  scene.tweens.add({
    targets: startIcon,
    alpha: { from: 1, to: 0.25 },
    duration: 600,
    yoyo: true,
    repeat: -1
  });

  // one-time SPACE
  scene.input.keyboard.once('keydown-SPACE', async () => {
      unlockAudioOnce(scene);

      // Require wallet + entry fee BEFORE the run (locks the run to an on-chain payment)
      if (window.CHAIN?.enabled && window.CHAIN?.requireWalletToStart && window.ChainClient?.ensureEntryPaid) {
        const ok = await window.ChainClient.ensureEntryPaid();
        if (!ok) {
          // user cancelled wallet / tx
          return;
        }
      }

      startCountdown(scene);
    });
}

// =================== COUNTDOWN ===================
function startCountdown(scene) {
  if (gamePhase !== GAME_PHASE.START || countdownInProgress) return;
  countdownInProgress = true;
  gamePhase = GAME_PHASE.COUNTDOWN;

  if (startIcon) startIcon.setVisible(false);

  const centerX = 400;
  const centerY = 300;
  const keys = ['count3', 'count2', 'count1'];
  let i = 0;

  function showNext() {
    if (i >= keys.length) {
      countdownSprites.forEach(s => s.destroy());
      countdownSprites = [];
      beginGame(scene);
      return;
    }

    const key = keys[i++];
    const spr = scene.add.image(centerX, centerY, key)
      .setOrigin(0.5)
      .setScale(COUNTDOWN_SIZE_SCALE)
      .setDepth(10)
      .setAlpha(0);

    countdownSprites.push(spr);

    scene.tweens.add({
      targets: spr,
      alpha: 1,
      duration: 250,
      yoyo: true,
      hold: 380,
      onComplete: showNext
    });
  }

  showNext();
}

// =================== BEGIN GAME ===================
function beginGame(scene) {
  countdownInProgress = false;
  gamePhase = GAME_PHASE.RUNNING;

  // remove start icon completely
  if (startIcon) startIcon.destroy();
  startIcon = null;

  // start a new verifiable run session (seeded RNG + recorder)
  POHP_beginRunSession();

  // reset run
  score = 0;
  lives = 3;
  wave  = 1;
  waveAdvancePending = false;
  applyWaveDifficulty(wave);

  // Give the convoy a little initial \"fire budget\" so Wave 1 doesn't feel dead.
  enemyFireBudget = Math.max(enemyFireBudget || 0, 1.25);
  formationVolleyTimerMs = 420 + POHP_grBetween(0, 520);
  formationVolleyLeft = 0;
  formationVolleyGapMs = 0;

  // reset formation communication bus (per-run)
  formationIntel.markX = null;
  formationIntel.markTtlMs = 0;
  formationIntel.markBy = "";
  formationIntel.leaderKey = null;
  formationIntel.leaderType = "";
  formationIntel.leaderHoldMs = 0;
  formationIntel.flankSide = 1;
  formationIntel.flankHoldMs = 0;
  formationIntel.mode = "focus";
  formationIntel.modeHoldMs = 0;
  formationIntel.burstHeatMs = 0;

  if (scoreText) scoreText.setText('SCORE: 0');
  if (livesText) livesText.setText('LIVES: 3');
  if (waveText)  waveText.setText('WAVE: 1');

  // rebuild formation + player
  clearAllBullets();
  createEnemyFormation(scene);
  enablePlayerPhysics(player, 400, 550);

  // safety: invuln grace at start
  invulnerabilityTimer = 900;
  respawnTimer = 0;
  playerState = PLAYER_STATE.PLAYING;

  // colliders OFF until updatePlayerState sees invuln
  setColliderActive(enemyBulletPlayerCollider, false);
  setColliderActive(enemyPlayerCollider, false);
  setColliderActive(playerBulletEnemyCollider, true);

  // resume physics
  scene.physics.resume();

  // audio mix
  if (bgm) bgm.setVolume(BGM_VOLUME);
}

// =================== UPDATE ===================
function update(time, delta) {
  const dt = delta / 1000;

  // gameplay‑only adaptive AI learning (bounded)
  AI_learnTick(delta);
  AI_tickLateFunGovernor(delta);

  // starfield always
  if (stars) {
    stars.children.entries.forEach(star => {
      star.y += 30 * dt;
      if (star.y > 600) {
        star.y = 0;
        star.x = POHP_vrBetween(0, 800);
      }
    });
  }

    if (pohpDownloadText && gamePhase !== GAME_PHASE.GAME_OVER) pohpDownloadText.setVisible(false);

// GAME OVER input
  if (gamePhase === GAME_PHASE.GAME_OVER) {
    if (pohpDownloadText) pohpDownloadText.setVisible(true);

    if (restartKey && Phaser.Input.Keyboard.JustDown(restartKey)) {
      showStartScreen(mainScene);
    }
    if (submitKey && Phaser.Input.Keyboard.JustDown(submitKey)) {
      submitScoreToChain();
    }
    if (proofKey && Phaser.Input.Keyboard.JustDown(proofKey)) {
      POHP_tryDownloadLatest();
    }
    if (exportScoresKey && Phaser.Input.Keyboard.JustDown(exportScoresKey)) {
      exportScoresBackup();
    }
    if (importScoresKey && Phaser.Input.Keyboard.JustDown(importScoresKey)) {
      importScoresBackup();
    }

    return;
  }

  // not running -> nothing
  if (gamePhase !== GAME_PHASE.RUNNING) return;

  // Replay override (use recorded delta/time)
  if (POHP_replay.enabled && POHP_replay.loaded) {
    // if we reach end-of-log but game still running, end safely
    if (POHP_replay.frame >= POHP_replay.masks.length) {
      gameOver();
      return;
    }
    const sim = POHP_replayOverrideTimeDelta(time, delta);
    time = sim.time;
    delta = sim.delta;
  }

  // advance input frame (live: read+record, replay: feed from package)
  POHP_advanceInputsAndRecord(delta);

  // timers
  if (respawnTimer > 0) respawnTimer -= delta;
  if (invulnerabilityTimer > 0) invulnerabilityTimer -= delta;

  // last life aura (only visual)
  if (boomAura && player) {
    const show = (lives === 1) && player.active && (playerState === PLAYER_STATE.PLAYING);
    boomAura.setVisible(show);
    if (show) {
      boomAura.setPosition(player.x, player.y);
      boomAura.setAlpha(0.35 + 0.25 * (Math.sin(time / 70) > 0 ? 1 : 0));
    }
  }

  updatePlayerState(time, delta);
  updateEnemyFormation(delta);
  updateDivingEnemies(delta);
  enemyShooting(delta);
  cleanupBullets();

  // Safety-net: if the last enemy died via collision/offscreen/etc, ensure next wave starts (unless game over)
  maybeStartNextWave(this);

  // Record compact deterministic checkpoints for schema v2 anti-cheat auditing.
  POHP_recordCheckpoint(false);

  // audio loops depending on state
  const formationCount = enemies.children.entries.filter(e => e.active && e.getData('state') === 'formation').length;
  const divingCount = enemies.children.entries.filter(e => e.active && (e.getData('state') === 'diveLoop' || e.getData('state') === 'diveStraight')).length;

  setLoopVolume(sfxEnemyMoveLoop, formationCount > 0 ? SFX_ENEMY_MOVE_VOL : 0);
  setLoopVolume(sfxEnemyDiveLoop, divingCount > 0 ? SFX_ENEMY_DIVE_VOL : 0);
}

// =================== PLAYER FSM ===================
function updatePlayerState(time, delta) {
  switch (playerState) {
    case PLAYER_STATE.PLAYING:
      if (player && player.active) {
        // movement (from unified input state: live or replay)
        if (POHP_input.left && player.x > 0) player.setVelocityX(-220);
        else if (POHP_input.right && player.x < 800) player.setVelocityX(220);
        else player.setVelocityX(0);

        // shoot (edge-triggered, deterministic)
        if (POHP_input.shootJust) shootPlayerBullet();

        // invulnerability blink
        if (invulnerabilityTimer > 0) {
          player.setAlpha((Math.sin(time / 50) > 0) ? 0.45 : 1);
          setColliderActive(enemyBulletPlayerCollider, false);
          setColliderActive(enemyPlayerCollider, false);
        } else {
          player.setAlpha(1);
          setColliderActive(enemyBulletPlayerCollider, true);
          setColliderActive(enemyPlayerCollider, true);
        }
      }
      break;

    case PLAYER_STATE.DYING:
      if (respawnTimer <= 0) {
        playerState = PLAYER_STATE.RESPAWNING;
        respawnTimer = RESPAWN_DELAY;
      }
      break;

    case PLAYER_STATE.RESPAWNING:
      if (respawnTimer <= 0) {
        if (lives > 0) {
          enablePlayerPhysics(player, 400, 550);
          invulnerabilityTimer = INVULN_DURATION;
          setColliderActive(enemyBulletPlayerCollider, false);
          setColliderActive(enemyPlayerCollider, false);
          playerState = PLAYER_STATE.PLAYING;
        } else {
          // safety: should not happen here, but keep
          gameOver();
        }
      }
      break;

    case PLAYER_STATE.GAME_OVER:
      break;
  }
}

// =================== PLAYER SHOOTING ===================
function shootPlayerBullet() {
  if (gamePhase !== GAME_PHASE.RUNNING) return;
  if (playerState !== PLAYER_STATE.PLAYING) return;
  if (!player || !player.active) return;

  const activeCount = playerBullets.children.entries.filter(b => b.active).length;
  if (activeCount >= MAX_PLAYER_BULLETS_ONSCREEN) return;

  const bullet = playerBullets.getFirstDead(false);
  if (!bullet) return;

  if (sfxPlayerShoot) sfxPlayerShoot.play({ volume: SFX_SHOOT_VOLUME });

  bullet.setActive(true);
  bullet.setVisible(true);
  bullet.setScale(0.6);
  setupBulletBody(bullet, "player");

  const x = player.x;
  const y = player.y - 20;
  bullet.setPosition(x, y);

  if (bullet.body) {
    bullet.body.enable = true;
    bullet.body.reset(x, y);
    bullet.body.setVelocity(0, -400);
  }
}




function diveCounterReset(baseTicks, w, idx, isInit = false) {
  // Classic Galaxian timing model: a master tick decrements several counters.
  // We scale gently by wave (slower ramp) and by “thin-out” (fewer enemies => a bit more aggression).
  const ar = aliveRatioNow();
  const thin = 1.0 - (1.0 - ar) * 0.22;          // 1.00 .. ~0.78
  const waveScale = Math.max(0.55, 1.0 - (w - 1) * 0.03); // 1.00 .. 0.55
  const idxMul = 1.0 + idx * 0.08;               // slow counters stay slower

  let v = Math.floor(baseTicks * waveScale * thin * idxMul);
  v = Phaser.Math.Clamp(v, 6, 120);

  // small deterministic jitter keeps rhythm non-mechanical
  const j = isInit ? POHP_grBetween(-2, 2) : POHP_grBetween(-3, 4);
  v = Math.max(4, v + j);
  return v;
}

function squadTriggerGateChance(w) {
  // How often a trigger becomes a “squad burst” instead of a single attacker.
  // (Still limited by MAX_DIVING_ENEMIES and burst queue spacing.)
  if (w <= 1) return 0.18;
  if (w <= 4) return 0.24;
  if (w <= 8) return 0.30;
  if (w <= 12) return 0.36;
  return 0.42;
}
function diveIntervalRangeMs(w) {
  // Wave 1 should already have occasional dives; later waves compress the interval slowly.
  // Keep it gentle because this is blockchain hi-score (no sudden spikes).
  if (w <= 1) return [1700, 2600];
  if (w <= 4) return [1500, 2400];
  if (w <= 8) return [1300, 2150];
  if (w <= 12) return [1100, 1950];
  return [950, 1750];
}

function diveStartChanceForWave(w) {
  // In early waves, sometimes “nothing happens” (classic convoy hanging), but not “never”.
  // Gradually approaches ~90% later.
  if (w <= 1) return 0.70;
  if (w <= 4) return 0.78;
  if (w <= 8) return 0.85;
  return 0.90;
}

function diveBurstCountForWave(w, avail) {
  // Real Galaxian’s “true squad” is up to 3 (flagship + up to 2 escorts),
  // while higher difficulty *feels* like 3–5 attackers because sorties overlap.
  // For our endless hi-score mode we keep it fair: early waves mostly 1–2,
  // then gradually allow 3, later 4, and only occasionally 5.
  const cap = Math.max(1, Math.min(avail, 5));
  const r = POHP_grFloat();

  // Wave 1: lively but not chaotic
  if (w <= 1) {
    if (cap >= 3 && r < 0.05) return 3;
    if (cap >= 2 && r < 0.32) return 2;
    return 1;
  }

  // Wave 2–3: mostly 1–2, rare 3
  if (w <= 3) {
    if (cap >= 3 && r < 0.08) return 3;
    if (cap >= 2 && r < 0.50) return 2;
    return 1;
  }

  // Wave 4–7: mostly 2, sometimes 3, rare 4
  if (w <= 7) {
    if (cap >= 4 && r < 0.06) return 4;
    if (cap >= 3 && r < 0.22) return 3;
    if (cap >= 2 && r < 0.76) return 2;
    return 1;
  }

  // Wave 8–12: mostly 2–3, sometimes 4, very rare 5
  if (w <= 12) {
    if (cap >= 5 && r < 0.03) return 5;
    if (cap >= 4 && r < 0.13) return 4;
    if (cap >= 3 && r < 0.44) return 3;
    if (cap >= 2 && r < 0.88) return 2;
    return 1;
  }

  // Wave 13+: mostly 3, sometimes 4, occasional 5
  if (cap >= 5 && r < 0.06) return 5;
  if (cap >= 4 && r < 0.24) return 4;
  if (cap >= 3 && r < 0.72) return 3;
  if (cap >= 2 && r < 0.95) return 2;
  return 1;
}

function weightedPick(list, weightFn) {
  if (!list || list.length === 0) return null;
  let total = 0;
  const weights = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    const w = Math.max(0, Math.floor(weightFn(list[i]) * 1000)); // int weights for stable picks
    weights[i] = w;
    total += w;
  }
  if (total <= 0) return POHP_grPick(list);
  let pick = POHP_grBetween(1, total);
  for (let i = 0; i < list.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return list[i];
  }
  return list[list.length - 1];
}


// ---- Galaxian-style flank + squad selector (deterministic via POHP_gr* RNG) ----
function updateAttackFlank(leftmostX, rightmostX) {
  // Mimic Galaxian feel: when swarm nears an edge, attackers break off from that flank.
  // Otherwise, side can occasionally flip to avoid predictability (still deterministic).
  const LEFT_EDGE = 70;
  const RIGHT_EDGE = 730;

  if (leftmostX <= LEFT_EDGE) diveAttackFromRight = false;
  else if (rightmostX >= RIGHT_EDGE) diveAttackFromRight = true;
  else if (POHP_grFloat() < 0.07) diveAttackFromRight = !diveAttackFromRight;

  return diveAttackFromRight;
}

function clusterLanesByX(formationEnemies) {
  const list = formationEnemies
    .filter(e => e && e.active && e.getData('state') === 'formation')
    .slice()
    .sort((a, b) => a.x - b.x);

  const lanes = [];
  const TOL = 18;

  for (const e of list) {
    const last = lanes[lanes.length - 1];
    if (!last || Math.abs(e.x - last.x) > TOL) {
      lanes.push({ x: e.x, enemies: [e] });
    } else {
      last.enemies.push(e);
      // keep a stable-ish center
      last.x = (last.x * (last.enemies.length - 1) + e.x) / last.enemies.length;
    }
  }
  return lanes;
}

function chooseLane(lanes, fromRight, usedKeys) {
  if (!lanes || lanes.length === 0) return null;

  const ordered = fromRight
    ? lanes.slice().sort((a, b) => b.x - a.x)
    : lanes.slice().sort((a, b) => a.x - b.x);

  const occupied = ordered.filter(l =>
    l.enemies.some(e =>
      e && e.active && e.getData('state') === 'formation' &&
      (!usedKeys || !usedKeys.has(e.getData('slotKey')))
    )
  );

  if (occupied.length === 0) return null;

  // Take the first few lanes from the flank and pick with a bias (not purely “always first”).
  const cand = occupied.slice(0, Math.min(3, occupied.length));
  if (cand.length === 1) return cand[0];

  const r = POHP_grFloat();
  if (r < 0.65) return cand[0];
  if (r < 0.88) return cand[1];
  return cand[Math.min(2, cand.length - 1)];
}

function flagshipSquadChance(w) {
  // Classic Galaxian vibe: flagships sometimes launch with red escorts.
  // Keep it modest for fairness in a blockchain hi-score setting.
  if (w <= 1) return 0.10;
  if (w <= 4) return 0.12;
  if (w <= 8) return 0.15;
  return 0.18;
}

function buildDiveBurstQueue(formationEnemies, leftmostX, rightmostX, w, wantCount) {
  const eligible = formationEnemies.filter(e => e && e.active && e.getData('state') === 'formation');
  if (!eligible.length || wantCount <= 0) return [];

  const fromRight = updateAttackFlank(leftmostX, rightmostX);
  const used = new Set();
  const lanes = clusterLanesByX(eligible);

  const out = [];

  const flagships = eligible.filter(e => e.getData('type') === 'flagship');
  const reds = eligible.filter(e => e.getData('type') === 'red');

  // 1) Classic Galaxian move: sometimes launch a flagship squad (leader + up to 2 red escorts).
  // This produces the “convoy breaks into a small flock” feeling.
  const canFlagshipSquad = (flagships.length > 0) && (reds.length > 0) && (wantCount >= 2);
  if (canFlagshipSquad && POHP_grFloat() < flagshipSquadChance(w)) {
    // Prefer a flagship near the current flank (or near the chosen flank-lane if available)
    const lane = chooseLane(lanes, fromRight, null);

    let leader = null;
    if (lane) {
      const sorted = flagships.slice().sort((a, b) => Math.abs(a.x - lane.x) - Math.abs(b.x - lane.x));
      leader = sorted[0] || null;
      if (sorted.length > 1 && Math.abs(Math.abs(sorted[0].x - lane.x) - Math.abs(sorted[1].x - lane.x)) < 6) {
        if (POHP_grFloat() < 0.5) leader = sorted[1];
      }
    } else {
      // Fallback: pick from flank direction
      const sorted = flagships.slice().sort((a, b) => (fromRight ? (b.x - a.x) : (a.x - b.x)));
      leader = sorted[0] || POHP_grPick(flagships);
    }

    if (leader) {
      out.push(leader);
      used.add(leader.getData('slotKey'));

      // up to 2 escorts close in X (prefer nearest)
      const candidates = reds
        .filter(r => r && r.active && r.getData('state') === 'formation' && !used.has(r.getData('slotKey')))
        .map(r => ({ r, dx: Math.abs(r.x - leader.x) }))
        .filter(o => o.dx < 150)
        .sort((a, b) => a.dx - b.dx)
        .map(o => o.r);

      if (candidates.length && out.length < wantCount) {
        out.push(candidates[0]);
        used.add(candidates[0].getData('slotKey'));
      }
      if (candidates.length > 1 && out.length < wantCount) {
        // 2nd escort not always (keeps it less predictable)
        if (POHP_grFloat() < 0.72) {
          out.push(candidates[1]);
          used.add(candidates[1].getData('slotKey'));
        }
      }
    }
  }

  // 2) Fill remainder from the flank lanes.
  const px = (player && player.active) ? player.x : 400;

  let minY = Infinity, maxY = -Infinity;
  for (const e of eligible) { minY = Math.min(minY, e.y); maxY = Math.max(maxY, e.y); }
  const ySpan = Math.max(1, maxY - minY);

  // For “bigger flocks” (3–5), bias picks to be near the first picked lane (cohesion),
  // but still allow occasional spread.
  const anchorX = (out.length > 0) ? out[0].x : null;

  while (out.length < wantCount) {
    let lane = null;

    if (anchorX !== null && lanes.length > 1 && POHP_grFloat() < 0.72) {
      // Prefer lanes closest to anchorX, but only among the first few lanes from the flank
      const ordered = fromRight ? lanes.slice().sort((a, b) => b.x - a.x) : lanes.slice().sort((a, b) => a.x - b.x);
      const flankSlice = ordered.slice(0, Math.min(5, ordered.length));
      const viable = flankSlice.filter(l =>
        l.enemies.some(e => e && e.active && e.getData('state') === 'formation' && !used.has(e.getData('slotKey')))
      );
      if (viable.length) {
        viable.sort((a, b) => Math.abs(a.x - anchorX) - Math.abs(b.x - anchorX));
        // Pick #0 most of the time, occasionally #1 or #2 for variety
        const rr = POHP_grFloat();
        lane = viable[0];
        if (viable.length > 1 && rr > 0.70 && rr <= 0.90) lane = viable[1];
        if (viable.length > 2 && rr > 0.90) lane = viable[2];
      }
    }

    if (!lane) lane = chooseLane(lanes, fromRight, used);
    if (!lane) break;

    let pool = lane.enemies.filter(e =>
      e && e.active && e.getData('state') === 'formation' && !used.has(e.getData('slotKey'))
    );

    if (lastDiverKey && pool.length > 1) {
      const filtered = pool.filter(e => e.getData('slotKey') !== lastDiverKey);
      if (filtered.length) pool = filtered;
    }
    if (pool.length === 0) break;

    const chosen = weightedPick(pool, (e) => {
      const t = e.getData('type');

      // Galaxian flavor: blue/purple are common attackers; red becomes more common later.
      // Flagship is rare here because it's handled above as a squad (still possible if only option).
      let typeW = 1.0;
      if (t === 'purple') typeW = 1.20;
      else if (t === 'blue') typeW = 1.00;
      else if (t === 'red') typeW = (w <= 2) ? 0.55 : 0.85;
      else if (t === 'flagship') typeW = 0.18;

      // Lower row bias (pressure) but not absolute
      const yN = (e.y - minY) / ySpan;
      const yW = 0.78 + 0.55 * yN;

      // Mild player-x tracking to keep it spicy (still fair)
      const dx = Math.abs(e.x - px);
      const xW = 1.12 - Math.min(0.30, dx / 750);

      return typeW * yW * xW;
    });

    if (!chosen) break;

    out.push(chosen);
    used.add(chosen.getData('slotKey'));
  }

  return out.slice(0, wantCount);
}


function pickDiverCandidate(formationEnemies, usedKeysSet) {
  if (!formationEnemies || formationEnemies.length === 0) return null;

  // Prefer lower half (pressure), but with some chance to surprise from anywhere.
  const sorted = formationEnemies.slice().sort((a, b) => b.y - a.y);
  const poolBottom = sorted.slice(0, Math.min(sorted.length, 14));
  const pool = (POHP_grFloat() < 0.20) ? formationEnemies : poolBottom;

  // Avoid repeating the same slot too often.
  let candidates = pool.filter(e => e && e.active && e.getData('state') === 'formation');
  if (usedKeysSet && usedKeysSet.size > 0) {
    candidates = candidates.filter(e => !usedKeysSet.has(e.getData('slotKey')));
  }
  if (lastDiverKey && candidates.length > 1) {
    const filtered = candidates.filter(e => e.getData('slotKey') !== lastDiverKey);
    if (filtered.length) candidates = filtered;
  }
  if (candidates.length === 0) return null;

  // Type flavor + slight “lower row” bias + mild “player tracking” bias
  const px = (player && player.active) ? player.x : 400;
  const minY = sorted[sorted.length - 1].y;
  const maxY = sorted[0].y;
  const ySpan = Math.max(1, maxY - minY);

  const chosen = weightedPick(candidates, (e) => {
    const type = e.getData('type') || 'blue';
    let w = 1.0;

    if (type === 'purple') w *= 1.12;
    if (type === 'red') w *= 1.20;
    if (type === 'flagship') w *= 0.75; // still dives, just less often early

    // lower row bias (up to +25%)
    const yn = (e.y - minY) / ySpan; // 0..1
    w *= (1.0 + 0.25 * yn);

    // mild player-tracking: attackers closer to player x slightly more likely
    const dx = Math.min(1, Math.abs(e.x - px) / 400);
    w *= (1.0 + 0.10 * (1 - dx));

    return w;
  });

  if (chosen) lastDiverKey = chosen.getData('slotKey') || null;
  return chosen;
}

function resetDiveDirectorForWave() {
  // Reset Galaxian-style counter scheduler for this formation/wave.
  diveMasterAccMs = 0;
  divePendingTriggers = 0;
  divePendingSquadBoost = 0;

  // Deterministic initialization (seeded): gives “classic” irregular timing.
  diveCounters = DIVE_COUNTER_BASES.map((b, i) => diveCounterReset(b, wave, i, true));

  diveDirectorMs = 0; // legacy
  diveBurstMs = 0;
  diveBurstLeft = 0;
  diveBurstQueue = [];
  lastDiverKey = null;
}
// =================== ENEMY FORMATION MOVEMENT ===================
function updateEnemyFormation(delta) {
  if (!enemyFormation.length) return;
  const dt = delta / 1000;

  let leftmostX = 800, rightmostX = 0, lowestY = 0;
  let found = false;

  const formationEnemies = [];

  // Collect active formation enemies + bounds
  for (let row = 0; row < enemyFormation.length; row++) {
    if (!enemyFormation[row]) continue;
    for (let col = 0; col < enemyFormation[row].length; col++) {
      const e = enemyFormation[row][col];
      if (!e || !e.active) continue;
      if (e.getData('state') !== 'formation') continue;
      found = true;
      formationEnemies.push(e);
      leftmostX = Math.min(leftmostX, e.x);
      rightmostX = Math.max(rightmostX, e.x);
      lowestY = Math.max(lowestY, e.y);
    }
  }

  // Side bounds: bounce horizontally; step-down ONLY until a safe cap (endless)
  let moveDown = false;
  if (found) {
    if (rightmostX >= 750 && enemyDirection > 0) { enemyDirection = -1; moveDown = true; }
    else if (leftmostX <= 50 && enemyDirection < 0) { enemyDirection = 1; moveDown = true; }
  }

  let stepDown = 0;
  if (moveDown && lowestY < FORMATION_LOWEST_Y_MAX) {
    stepDown = Math.min(FORMATION_STEP_DOWN, FORMATION_LOWEST_Y_MAX - lowestY);
  }

  // Thin-out: mild speed-up when few enemies remain (no sudden spikes)
  const ar = aliveRatioNow();
  const thinMul = 1 + (1 - ar) * THIN_OUT_SPEED_UP;

  // IMPORTANT: no “lower formation => faster” multiplier (keeps waves fair + endless)
  const speedBrake = 0.88 + 0.12 * (aiPressureMul || 1);
  const currentSpeed = enemySpeedBase * thinMul * speedBrake;

  // Classic feel: (1) pixel-step accumulator, (2) gentle sinusoidal sway.
  // - Step accumulator makes motion visibly “alive” even at low speeds.
  // - Sway gives Galaxian-like oscillation and makes formation targets slightly harder.
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

  // Accumulate continuous speed into crisp integer pixel steps
  formationMoveAccPx += (currentSpeed * FORMATION_SPEED_MUL * enemyDirection * dt);
  let stepDx = (formationMoveAccPx | 0); // trunc toward 0
  formationMoveAccPx -= stepDx;

  // Total dx for this frame (integer pixels)
  let dx = stepDx + swayDelta;

  // Experimental feint nudge (tiny, bounded). Helps formation feel more “alive”.
  if (EXP_FEINT_NUDGE && formationFeintMs > 0) {
    formationFeintMs = Math.max(0, formationFeintMs - (dt * 1000));
    dx += (formationFeintDir > 0 ? 2 : -2);
  }

  // Hard clamp to keep formation inside bounds (prevents edge jitter / unfair steps)
  if (found && dx !== 0) {
    const newLeft = leftmostX + dx;
    const newRight = rightmostX + dx;
    if (newRight > FORMATION_HARD_BOUND_R) dx -= (newRight - FORMATION_HARD_BOUND_R);
    if (newLeft < FORMATION_HARD_BOUND_L)  dx += (FORMATION_HARD_BOUND_L - newLeft);
  }

  // Move formation enemies
  for (let i = 0; i < formationEnemies.length; i++) {
    const e = formationEnemies[i];

    if (dx !== 0) e.x += dx;
    if (stepDown > 0) e.y += stepDown;

    // update home slot (so returning enemies snap back correctly)
    e.setData('homeX', e.x);
    e.setData('homeY', e.y);

    // settle rotation
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ENEMY_FORMATION_ROT, 0.15);
  }

  
// ---- Dive Director (Galaxian-style): master + secondary counters (seeded) ----
  // Real Galaxian/Galaga feel: irregular timing with recognizable “beats”.
  // We model this with a master tick that decrements multiple counters.
  // When any counter hits 0 → trigger an attack (single or squad) and reset that counter.

  // 1) Launch queued divers with small spacing (squad feel)
  if (diveBurstQueue.length > 0) {
    if (diveBurstMs > 0) diveBurstMs -= delta;

    if (diveBurstMs <= 0) {
      const divingCount = enemies.children.entries.filter(e =>
        e.active && (e.getData('state') === 'diveLoop' || e.getData('state') === 'diveStraight')
      ).length;
      let maxDiversNow = Math.min(MAX_DIVING_ENEMIES, 2 + Math.floor((wave - 1) / 4));
    // Late-game brakes: under high pressure or during calm, reduce simultaneous divers a bit.
    if ((aiCalmMs || 0) > 0) maxDiversNow = Math.max(2, maxDiversNow - 1);
    if ((aiPressureMul || 1) < 0.75) maxDiversNow = Math.max(2, maxDiversNow - 1);
      const avail = maxDiversNow - divingCount;

      if (avail <= 0) {
        // can't start more right now; retry soon
        diveBurstMs = 110;
      } else {
        const next = diveBurstQueue.shift();
        if (next && next.active && next.getData('state') === 'formation') {
          startEnemyDive(next);
          lastDiverKey = next.getData('slotKey') || null;
        }
        // slight randomness keeps “beats” natural (still deterministic)
        diveBurstMs = POHP_grBetween(80, 150);
      }
    }
  }

  // 2) Tick the scheduler (deterministic)
  diveMasterAccMs += delta;
  while (diveMasterAccMs >= DIVE_MASTER_TICK_MS) {
    diveMasterAccMs -= DIVE_MASTER_TICK_MS;

    for (let i = 0; i < diveCounters.length; i++) {
      diveCounters[i] -= 1;
      if (diveCounters[i] <= 0) {
        divePendingTriggers += 1;
        if (i >= 3) divePendingSquadBoost += 1; // slower counters tend to trigger bigger bursts
        diveCounters[i] = diveCounterReset(DIVE_COUNTER_BASES[i], wave, i, false);
      }
    }

    // caps: prevent huge bursts after a lag spike
    if (divePendingTriggers > 4) divePendingTriggers = 4;
    if (divePendingSquadBoost > 2) divePendingSquadBoost = 2;
  }

  // 3) Consume pending triggers by scheduling new bursts into the queue
  if (divePendingTriggers > 0 && formationEnemies.length > 0) {
    const divingCount = enemies.children.entries.filter(e =>
      e.active && (e.getData('state') === 'diveLoop' || e.getData('state') === 'diveStraight')
    ).length;
    let maxDiversNow = Math.min(MAX_DIVING_ENEMIES, 2 + Math.floor((wave - 1) / 4));
    // Late-game brakes: under high pressure or during calm, reduce simultaneous divers a bit.
    if ((aiCalmMs || 0) > 0) maxDiversNow = Math.max(2, maxDiversNow - 1);
    if ((aiPressureMul || 1) < 0.75) maxDiversNow = Math.max(2, maxDiversNow - 1);

    // Note: queue reserves “future divers” so we don't exceed maxDiversNow.
    let avail = maxDiversNow - divingCount - diveBurstQueue.length;

    if (avail > 0) {
      const wasEmpty = (diveBurstQueue.length === 0);

      // how many triggers we try to consume this frame (slow ramp)
      let attemptCap = 1 + Math.floor((wave - 1) / 5); // 1..3
      if ((aiCalmMs || 0) > 0) attemptCap = Math.max(1, attemptCap - 1);
      if ((aiPressureMul || 1) < 0.75) attemptCap = Math.max(1, attemptCap - 1);
      const attempts = Math.min(divePendingTriggers, attemptCap);

      let used = 0;
      for (let t = 0; t < attempts && avail > 0; t++) {
        const preferBig = (divePendingSquadBoost > 0);
        if (preferBig) divePendingSquadBoost -= 1;

        // Not every trigger becomes an attack (classic “convoy hangs” moments),
        // but later waves convert more triggers into attacks.
        let gate = preferBig ? 0.90 : (0.62 + Math.min((wave - 1) * 0.02, 0.22)); // 0.62..0.84
        gate *= (0.70 + 0.30 * (aiPressureMul || 1));
        if ((aiCalmMs || 0) > 0) gate *= 0.86;
        gate = Phaser.Math.Clamp(gate, 0.45, 0.92);
        if (POHP_grFloat() > gate) { used++; continue; }

        const doSquad = preferBig || (POHP_grFloat() < squadTriggerGateChance(wave));
        let want = doSquad ? diveBurstCountForWave(wave, avail) : 1;

        if (preferBig && want < 3 && avail >= 3) want = 3;

        const squad = buildDiveBurstQueue(formationEnemies, leftmostX, rightmostX, wave, want);

        if (squad && squad.length) {
          for (const e of squad) {
            if (avail <= 0) break;
            if (!e || !e.active || e.getData('state') !== 'formation') continue;
            if (diveBurstQueue.includes(e)) continue;
            diveBurstQueue.push(e);
            avail -= 1;
          }
        }

        used++;
      }

      divePendingTriggers = Math.max(0, divePendingTriggers - used);

      if (wasEmpty && diveBurstQueue.length > 0) {
        // kick immediately (Wave 1 should start diving soon)
        diveBurstMs = 0;
      }

    } else {
      // keep a small pending; try again when divers return
      divePendingTriggers = Math.min(divePendingTriggers, 2);
      divePendingSquadBoost = Math.min(divePendingSquadBoost, 1);
    }
  }

}

// =================== DIVE LOGIC ===================

// ---- Enemy self-heal guards (prevents rare "lost enemy" edge-cases) ----
// These do NOT depend on player invulnerability; they only ensure an enemy can't get stuck off-screen or in a bad state.
const ENEMY_STUCK_OFFSCREEN_MS = 1600;
const ENEMY_MAX_DIVE_MS = 9000;
const ENEMY_MAX_RETURN_MS = 4500;
const ENEMY_SANITY_MIN_X = -120, ENEMY_SANITY_MAX_X = 920;
const ENEMY_SANITY_MIN_Y = -220, ENEMY_SANITY_MAX_Y = 860;

function forceEnemyWrapToReturn(e) {
  if (!e) return;
  const homeX = (typeof e.getData === "function") ? (e.getData('homeX') ?? e.x) : e.x;
  const homeY = (typeof e.getData === "function") ? (e.getData('homeY') ?? 120) : 120;

  e.x = homeX;
  e.y = RETURN_ENTRY_Y;

  e.setVisible(true);
  e.setActive(true);
  if (e.body) {
    e.body.enable = true;
    if (typeof e.body.reset === "function") e.body.reset(e.x, e.y);
    e.body.setVelocity(0, 0);
  }

  e.setData('returnY', homeY);
  e.setData('state', 'returning');
  e.setData('stateMs', 0);
  e.setData('offscreenMs', 0);
  e.setData('loopT', 0);
}

function forceEnemyToFormation(e) {
  if (!e) return;
  const homeX = (e.getData('homeX') ?? e.x);
  const homeY = (e.getData('homeY') ?? 120);

  e.x = (Number.isFinite(homeX) ? homeX : e.x);
  e.y = (Number.isFinite(homeY) ? homeY : 120);

  e.setVisible(true);
  e.setActive(true);
  if (e.body) {
    e.body.enable = true;
    if (typeof e.body.reset === "function") e.body.reset(e.x, e.y);
    e.body.setVelocity(0, 0);
  }

  e.setData('state', 'formation');
  e.setRotation(ENEMY_FORMATION_ROT);
  e.setData('stateMs', 0);
  e.setData('offscreenMs', 0);
  e.setData('loopT', 0);
}

function startEnemyDive(enemy) {
  const state = enemy.getData('state');
  if (state !== 'formation') return;

  const divingCount = enemies.children.entries.filter(e =>
    e.active && (e.getData('state') === 'diveLoop' || e.getData('state') === 'diveStraight')
  ).length;
  const maxDiversNow = Math.min(MAX_DIVING_ENEMIES, 2 + Math.floor((wave - 1) / 4));
  if (divingCount >= maxDiversNow) return;

  enemy.setData('state', 'diveLoop');
  enemy.setData('loopT', 0);
  enemy.setData('stateMs', 0);
  enemy.setData('offscreenMs', 0);

  // Dive shooting: attackers can "bomb" while diving (deterministic via POHP RNG)
  // TYPE-BASED AI ladder (blue < purple < red < flagship)
  const aliveNow = enemies.getChildren().filter(e => e.active).length;
  const aliveRatio = aliveNow / Math.max(1, (totalEnemiesSpawnedAtWaveStart || aliveNow || 1));

  const melee = (aliveNow <= 3);
  const diveBrake = AI_brakeFactor(wave, aliveRatio, melee);
  const pressureMul = (aiPressureMul || 1);
  const calmNow = ((aiCalmMs || 0) > 0);

  const type = (enemy.getData('type') || 'blue');
  const baseIQ = (type === 'blue') ? 0.25 : (type === 'purple') ? 0.45 : (type === 'red') ? 0.65 : 0.85;
  const waveBoost = Math.min(0.22, (wave - 1) * 0.015);
  const thinBoost = Math.max(0, (1 - aliveRatio) * 0.18);
  const iq = Phaser.Math.Clamp(baseIQ + waveBoost + thinBoost, 0.15, 0.95);
  enemy.setData('iq', iq);

  // how hard this enemy "tracks" the player while diving
  const chase = (type === 'blue') ? 0.25 : (type === 'purple') ? 0.45 : (type === 'red') ? 0.65 : 0.85;
  enemy.setData('chase', chase);

  // shots per dive (smarter types: slightly more)
  const baseShots = (wave <= 2) ? 2 : (wave <= 4) ? 3 : (wave <= 7) ? 4 : 5;
  let shots = baseShots;
  if (type === 'blue') shots = Math.max(1, baseShots - 1);
  else if (type === 'red') shots = baseShots + (wave >= 4 ? 1 : 0);
  else if (type === 'flagship') shots = baseShots + (wave >= 3 ? 2 : 1);
  shots = Phaser.Math.Clamp(shots, 1, 7);
  // Late-game brakes: fewer shots when pressure is high (keeps it fun)
  shots = Math.max(1, Math.floor(shots * (0.92 + 0.08 * pressureMul) * (1 - 0.22 * diveBrake)));
  if (calmNow) shots = Math.max(1, shots - 1);
  enemy.setData('diveShotsLeft', shots);

  // initial shot cadence: smart types and thin-out shoot sooner
  let cdScale = 1.10 - (iq * 0.22) - ((1 - aliveRatio) * 0.10);
  cdScale *= (1 + 0.18 * diveBrake + (calmNow ? 0.10 : 0));
  const initCdMin = Math.max(110, Math.floor(240 * cdScale) - (wave - 1) * 6);
  const initCdMax = Math.max(initCdMin + 90, Math.floor(460 * cdScale) - (wave - 1) * 8);
  enemy.setData('shotCdMs', POHP_grBetween(initCdMin, initCdMax));

  // "Shoot window" exact-X lane (updated again during the dive)
  const laneStep = 25;
  const snapLane = (v) => Math.round(v / laneStep) * laneStep;
  const drift = Phaser.Math.Clamp(120 + wave * 10, 120, 260);
  const randAimX = Phaser.Math.Clamp(player.x + POHP_grSigned(Math.min(160, drift)), 60, 740);
  const aimX = Phaser.Math.Linear(player.x, randAimX, 0.65 - iq * 0.35);
  enemy.setData('shootExactX', snapLane(aimX));
  enemy.setData('shootRangeMul', 1 + Math.floor(Math.min(3, (1 - aliveRatio) * 3)));

  const dir = (enemy.x < 400) ? -1 : 1;
  const radius = 85;
  const cx = enemy.x + dir * radius;
  const cy = enemy.y + 20;

  enemy.setData('loopDir', dir);
  enemy.setData('loopRadius', radius);
  enemy.setData('loopCenterX', cx);
  enemy.setData('loopCenterY', cy);

  const targetX = (player && player.active)
    ? POHP_grBetween(player.x - 140, player.x + 140)
    : POHP_grBetween(150, 650);

  enemy.setData('diveTargetX', Phaser.Math.Clamp(targetX, 40, 760));

  // reset prev for rotation by velocity
  enemy.setData('prevX', enemy.x);
  enemy.setData('prevY', enemy.y);
}

function setEnemyRotationFromVelocity(e, dt) {
  const st = e.getData('state');
  const d = (typeof dt === 'number' && dt > 0) ? dt : 0.016;

  // Update last pos every frame so velocity calc (if used) stays stable
  const lastX = e.getData('lastX');
  const lastY = e.getData('lastY');
  if (lastX === undefined || lastY === undefined) {
    e.setData('lastX', e.x);
    e.setData('lastY', e.y);
    // still force correct facing on first tick
    if (st === 'diveLoop' || st === 'diveStraight') e.rotation = ENEMY_DIVE_ROT;
    else e.rotation = ENEMY_FORMATION_ROT;
    return;
  }

  const vx = e.x - lastX;
  const vy = e.y - lastY;

  e.setData('lastX', e.x);
  e.setData('lastY', e.y);

  // === Classic Galaxian-style facing rule ===
  // Attack: always face DOWN
  if (st === 'diveLoop' || st === 'diveStraight') {
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ENEMY_DIVE_ROT, ENEMY_ROT_SPEED_DIVE * d);
    return;
  }

  // Formation / returning: rotate back to formation facing
  if (st === 'formation') {
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ENEMY_FORMATION_ROT, ENEMY_ROT_SPEED_RETURN * d);
    return;
  }
  if (st === 'returning') {
    const want = Phaser.Math.Angle.Wrap(ENEMY_RETURN_ROT);
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, want, ENEMY_ROT_SPEED_RETURN * d);
    return;
  }

  // Fallback (if you add other states later): face movement direction
  if (vx !== 0 || vy !== 0) {
    const ang = Math.atan2(vy, vx) + ENEMY_ROT_OFFSET;
    e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, ang, ENEMY_ROT_SPEED_RETURN * d);
  }
}

function updateDivingEnemies(delta) {
  const dt = delta / 1000;
  const sMul = waveSpeedMul(wave);
  const ar = aliveRatioNow();
  const thinMul = 1 + (1 - ar) * 0.35;
  const speedBrake = 0.90 + 0.10 * (aiPressureMul || 1);

  enemies.children.entries.forEach(e => {
    if (!e.active) return;

    // Tick dive shot cooldowns (stored per-enemy)
    let shotCd = e.getData('shotCdMs') || 0;
    if (shotCd > 0) {
      shotCd -= delta;
      if (shotCd < 0) shotCd = 0;
      e.setData('shotCdMs', shotCd);
    }

    const state = e.getData('state');

// ---- Self-heal guard: ensure no enemy can get stuck off-screen/invisible forever ----
if (state === 'formation') {
  e.setData('stateMs', 0);
  e.setData('offscreenMs', 0);
  return;
}

// Track time in this non-formation state
let stateMs = (e.getData('stateMs') || 0) + delta;
e.setData('stateMs', stateMs);

// NaN/Infinity safety (extremely rare, but prevents "ghost alive" enemies)
if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) {
  forceEnemyToFormation(e);
  return;
}

// Offscreen timer
let offscreenMs = e.getData('offscreenMs') || 0;
const off = (e.x < ENEMY_SANITY_MIN_X || e.x > ENEMY_SANITY_MAX_X || e.y < ENEMY_SANITY_MIN_Y || e.y > ENEMY_SANITY_MAX_Y);
offscreenMs = off ? (offscreenMs + delta) : 0;
e.setData('offscreenMs', offscreenMs);

// State timeouts
if (state === 'returning') {
  if (stateMs > ENEMY_MAX_RETURN_MS) { forceEnemyToFormation(e); return; }
} else if (state === 'diveLoop' || state === 'diveStraight') {
  if (stateMs > ENEMY_MAX_DIVE_MS) { forceEnemyWrapToReturn(e); return; }
} else {
  // Unknown state => recover quickly
  if (stateMs > 2200) { forceEnemyToFormation(e); return; }
}

// If it stayed offscreen too long, force a clean wrap->return
if (offscreenMs > ENEMY_STUCK_OFFSCREEN_MS) {
  forceEnemyWrapToReturn(e);
  return;
}

    if (state === 'diveLoop') {
      let t = (e.getData('loopT') || 0) + dt * (1.25 * ENEMY_SPEED_FACTOR * sMul * thinMul * speedBrake);
      if (t > 1) t = 1;
      e.setData('loopT', t);

      const dir = e.getData('loopDir') || 1;
      const radius = e.getData('loopRadius') || 85;
      const cx = e.getData('loopCenterX') || e.x;
      const cy = e.getData('loopCenterY') || (e.y + 40);

      const tEase = Phaser.Math.Easing.Sine.InOut(t);
      const angle = -Math.PI / 2 + dir * (Math.PI * 1.4) * tEase;

      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;

      e.setPosition(x, y);
      setEnemyRotationFromVelocity(e, dt); // ✅ classic “turn” feel

      if (t >= 1) e.setData('state', 'diveStraight');

    } else if (state === 'diveStraight') {
      const vxMax = 150 * ENEMY_SPEED_FACTOR * sMul * thinMul * speedBrake;
      const vy    = 145 * ENEMY_SPEED_FACTOR * sMul * thinMul * speedBrake;

      let targetX = e.getData('diveTargetX') || e.x;

      // smart types gently home while diving (keeps determinism)
      if (player && player.active && playerAlive) {
        const t = (e.getData('type') || 'blue');
        const baseChase = (t === 'blue') ? 0.25 : (t === 'purple') ? 0.45 : (t === 'red') ? 0.65 : 0.85;
        const chase = (e.getData('chase') == null) ? baseChase : e.getData('chase');
        const lerpAmt = Phaser.Math.Clamp((dt / 1000) * (0.85 + chase * 1.35), 0, 0.20);
        targetX = Phaser.Math.Clamp(Phaser.Math.Linear(targetX, player.x, lerpAmt), 30, 770);
        e.setData('diveTargetX', targetX);
      }
      const dx = targetX - e.x;
      const vx = Phaser.Math.Clamp(dx * 2.9, -vxMax, vxMax);

      e.x += vx * dt;
      e.y += vy * dt;

      setEnemyRotationFromVelocity(e, dt); // ✅ keep facing motion (down during dive)

      if (e.y > DIVE_EXIT_Y) {
        const homeX = e.getData('homeX') || e.x;
        const homeY = e.getData('homeY') || 120;

        // Wrap like classic Galaxian, but re-enter closer to the top so it doesn't feel like it “vanished”.
        e.x = homeX;
        e.y = RETURN_ENTRY_Y;
        e.setVisible(true);
        e.setActive(true);
        if (e.body) e.body.enable = true;

        e.setData('returnY', homeY);
        e.setData('state', 'returning');
        e.setData('stateMs', 0);
        e.setData('offscreenMs', 0);

        e.setData('prevX', e.x);
        e.setData('prevY', e.y);
      }

    } else if (state === 'returning') {
      const returnY = e.getData('returnY') || 120;
      const returnSpeed = 170 * ENEMY_SPEED_FACTOR * sMul;

      e.y += returnSpeed * dt;

      // face down while returning
      setEnemyRotationFromVelocity(e, dt);

      if (e.y >= returnY) {
        e.y = returnY;
        e.setData('state', 'formation');
        e.setRotation(ENEMY_FORMATION_ROT);
        e.setData('stateMs', 0);
        e.setData('offscreenMs', 0);
      }
    }
  });
}

// =================== ENEMY SHOOTING ===================
function enemyShooting(deltaMs) {
  // Timers always tick (don't gate them behind the global cooldown)
  formationVolleyTimerMs -= deltaMs;
  if (formationVolleyGapMs > 0) formationVolleyGapMs -= deltaMs;
  enemyFireCooldownMs -= deltaMs;

  // Refill a small "fire budget" (brakes vs spam; deterministic)
  const refillPerSec = 3.2 + Math.min(3.0, (wave - 1) * 0.18);
  enemyFireBudget = Math.min(8, enemyFireBudget + (deltaMs / 1000) * refillPerSec);

  // Still respect a global cooldown for cadence smoothing
  if (enemyFireCooldownMs > 0) return;
  // Hard brake: if too many enemy bullets are already active, pause firing briefly.
  if (enemyBullets && enemyBullets.countActive && enemyBullets.countActive(true) >= maxEnemyBulletsNow()) {
    enemyFireCooldownMs = 35 + POHP_grInt(55);
    return;
  }


  const w = wave;
  const allAlive = enemies.getChildren().filter(e => e.active);
  if (!allAlive.length) return;

  // Tick per-enemy formation shot cooldowns (so types don't spam the same slot)
  for (let i = 0; i < allAlive.length; i++) {
    const e = allAlive[i];
    let cd = e.getData('fShotCdMs') || 0;
    if (cd > 0) {
      cd -= deltaMs;
      if (cd < 0) cd = 0;
      e.setData('fShotCdMs', cd);
    }
  }

  const alive = allAlive.length;
  const aliveRatio = alive / Math.max(1, (totalEnemiesSpawnedAtWaveStart || alive));
  const melee = (alive <= 3);
  const aiBrakeBase = AI_brakeFactor(w, aliveRatio, melee);
  const aiBrake = AI_clamp01(aiBrakeBase + (1 - (aiPressureMul || 1)) * 0.85 + ((aiCalmMs || 0) > 0 ? 0.12 : 0));
  const learnLevel = (AI_SELF_IMPROVE && aiLearn) ? (aiLearn.level || 0) : 0;


  const formationEnemies = allAlive.filter(e => (e.getData('state') || 'formation') === 'formation');
  const diving = allAlive.filter(e => (e.getData('state') || 'formation') !== 'formation');

  // === Brakes: cap bullets on screen per wave ===
  const capBase = maxEnemyBulletsNow();
let waveBulletCap = Math.max(3, Math.floor(capBase * (0.92 - 0.28 * aiBrake)));
if ((aiCalmMs || 0) > 0) waveBulletCap = Math.max(3, waveBulletCap - 1);
waveBulletCap = Phaser.Math.Clamp(waveBulletCap, 3, capBase);
  if (enemyBullets.countActive(true) >= waveBulletCap) {
    enemyFireCooldownMs = 20 + POHP_grInt(40);
    return;
  }

  // Cadence window for global cooldown (gets a bit faster with wave + thin-out)
  let gMin = Math.max(45, 90 - (w - 1) * 4);
  let gMax = Math.max(gMin + 10, 220 - (w - 1) * 6);
  if (aliveRatio < 0.45) { gMin = Math.max(35, gMin - 10); gMax = Math.max(gMin + 10, gMax - 18); }
  if (melee) { gMin = Math.max(28, gMin - 8); gMax = Math.max(gMin + 10, gMax - 20); }

  // Late-game brakes: slow overall cadence when pressure is high (keeps it fun/playable).
  if (aiBrake > 0) {
    const slow = 1 + aiBrake * 0.55; // up to ~1.55x slower
    gMin = Phaser.Math.Clamp(Math.floor(gMin * slow), 25, 260);
    gMax = Phaser.Math.Clamp(Math.floor(gMax * slow), gMin + 10, 360);
  }

  // Budget clamp under heavy pressure (prevents late-game bullet storms).
  if (aiBrake > 0.55) enemyFireBudget = Math.min(enemyFireBudget, 5.0);
  else if (aiBrake > 0.35) enemyFireBudget = Math.min(enemyFireBudget, 6.0);

  // === Helper: type-based IQ ladder (blue < purple < red < flagship) ===
  const enemyTypeOf = (e) => (e.getData('type') || 'blue');
  const baseIQOfType = (t) => (t === 'blue') ? 0.25 : (t === 'purple') ? 0.45 : (t === 'red') ? 0.65 : 0.85;
  const iqForEnemy = (e) => {
    const t = enemyTypeOf(e);
    const waveBoost = Math.min(0.24, (w - 1) * 0.014);
    const thinBoost = Math.min(0.20, (1 - aliveRatio) * 0.20);
    const meleeBoost = melee ? 0.10 : 0;
    return Phaser.Math.Clamp(baseIQOfType(t) + waveBoost + thinBoost + meleeBoost, 0.15, 0.97);
  };
  const typeWeight = (t) => (t === 'blue') ? 0.95 : (t === 'purple') ? 1.05 : (t === 'red') ? 1.12 : 1.18;

  const pickByWeight = (list, weightFn) => {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += Math.max(0, weightFn(list[i]));
    if (total <= 0) return list[POHP_grInt(list.length)];
    let r = POHP_grFloat() * total;
    for (let i = 0; i < list.length; i++) {
      r -= Math.max(0, weightFn(list[i]));
      if (r <= 0) return list[i];
    }
    return list[list.length - 1];
  };

  // Smarter but fair: predict player's X for bullet arrival (vertical bullets).
  const playerX = (player && player.active) ? player.x : 400;
  const playerVx = (player && player.body) ? (player.body.velocity.x || 0) : 0;

  function predictPlayerXAtY(shootFromY) {
    return AI_predictPlayerXAtY(shootFromY);
  }

  // Formation fire "target lane" (inspired by classic exactX/rangeMul idea)
  function updateFormationShootTarget() {
    const laneStep = 25;
    const snap = (x) => Math.round(x / laneStep) * laneStep;
    let target = snap(predictPlayerXAtY(120)); // predicted lane

    // Self‑improvement: bias slightly towards the player's "habit lane" (deterministic, bounded).
    // This makes formation fire feel smarter over time without increasing raw spam.
    if (AI_SELF_IMPROVE && aiLearn && Number.isFinite(aiLearn.hotLaneX)) {
      const mix = Phaser.Math.Clamp(0.18 + 0.42 * (aiLearn.level || 0), 0.18, 0.60);
      target = snap(target * (1 - mix) + aiLearn.hotLaneX * mix);
    }

    // Experimental: lane heatmap focus (reads player's recent lane habits even if they dodge prediction)
    if (EXP_LANE_HEATMAP && formationIntel && Number.isFinite(formationIntel.focusLaneX)) {
      const mood = (EXP_SWARM_MOODS && formationIntel.mood) ? formationIntel.mood : "calm";
      const moodMix = (mood === "punish") ? 0.28 : (mood === "probe") ? 0.16 : 0.08;
      const mix2 = Phaser.Math.Clamp(
        moodMix * (0.65 + 0.55 * (aiLearn.level || 0))
        * (EXP_SWARM_CONSCIOUSNESS && aiMind ? (0.92 + 0.20 * (aiMind.finesse || 0.45)) : 1.0)
        * Phaser.Math.Clamp((aiPressureMul || 1.0), 0.55, 1.0),
        0.06, 0.34
      );
      target = snap(target * (1 - mix2) + formationIntel.focusLaneX * mix2);
    }

    // If a purple/red/flagship marked a lane, use it (formation communication bus)
    if (formationIntel && (formationIntel.markTtlMs || 0) > 0 && Number.isFinite(formationIntel.markX)) {
      target = snap(formationIntel.markX);
    }

    formationShootExactX = target;

    // range multiplier grows as enemies thin out (classic aggressiveness idea)
    const rm = 1 + Math.floor(Math.min(3, (1 - aliveRatio) * 3));
    formationShootRangeMul = melee ? 4 : rm;
  }
  updateFormationShootTarget();

  // ============================================================
  // A) DIVING AI (in-flight attackers): more frequent + more "aimed"
  // ============================================================
  if (diving.length && enemyFireBudget >= 1) {
    const diveReady = diving.filter(e => (e.getData('shotCdMs') || 0) <= 0 && (e.getData('diveShotsLeft') || 0) > 0);
    if (diveReady.length) {
      const shooter = pickByWeight(diveReady, (e) => typeWeight(enemyTypeOf(e)) * (0.85 + 0.55 * iqForEnemy(e)));

      const iq = iqForEnemy(shooter);
      const t = enemyTypeOf(shooter);

      // prefer dive shots but don't always take them (keeps rhythm)
      const preferDive = Phaser.Math.Clamp(0.46 + 0.22 * iq + (w - 1) * 0.018 + (aliveRatio < 0.55 ? 0.06 : 0), 0.38, 0.93);
      const preferDiveGate = Phaser.Math.Clamp(preferDive * (0.85 + 0.15 * (aiPressureMul || 1)) * (1 - 0.40 * aiBrake), 0.18, 0.93);
      if (POHP_grChance(preferDiveGate)) {
        const laneStep = 25;
        const snap = (x) => Math.round(x / laneStep) * laneStep;

        // aim: dumb types lean toward "current X", smart types lean toward predicted X
        const predicted = predictPlayerXAtY(shooter.y);
        const aimX = Phaser.Math.Linear(playerX, predicted, iq);
        shooter.setData('shootExactX', snap(aimX));

        // aggressiveness: rangeMul grows with thin-out; melee pushes it higher
        let rangeMul = shooter.getData('shootRangeMul');
        if (rangeMul == null) rangeMul = 1 + Math.floor(Math.min(3, (1 - aliveRatio) * 3));
        if (melee) rangeMul = 4;
        shooter.setData('shootRangeMul', rangeMul);

        const shootExactX = shooter.getData('shootExactX') || snap(playerX);
        const dx = Math.abs(shooter.x - shootExactX);

        // window: dumb fires wider (more waste); smart waits for tighter alignment
        const baseRange = 12 + (laneStep * rangeMul);
        const alignRange = Phaser.Math.Clamp(
          Math.floor((baseRange + w * 1.4 + (1 - aliveRatio) * 30) * (1.18 - 0.30 * iq)),
          16, 120
        );
        const aligned = dx <= alignRange;

        let pAligned = Phaser.Math.Clamp(0.70 + 0.22 * iq + (1 - aliveRatio) * 0.10, 0.55, 0.95);
        let pStray = Phaser.Math.Clamp(0.22 - 0.14 * iq + (1 - aliveRatio) * 0.06, 0.05, 0.28);

        // Late-game brakes: under pressure, reduce dive shooting (prevents unplayable storms).
        if (aiBrake > 0) {
          pAligned = Phaser.Math.Clamp(pAligned * (1 - 0.18 * aiBrake) * (0.78 + 0.22 * (aiPressureMul || 1)), 0.45, 0.95);
          pStray   = Phaser.Math.Clamp(pStray   * (1 - 0.45 * aiBrake) * (0.70 + 0.30 * (aiPressureMul || 1)), 0.03, 0.28);
        }
        

        if (POHP_grChance(aligned ? pAligned : pStray)) {
          if (!shootEnemyBullet(shooter.x, shooter.y, true, shooter)) {
            // couldn't spawn (cap/pool) — wait a moment and try again later
            enemyFireCooldownMs = 40 + POHP_grInt(60);
            return;
          }
          shooter.setData('diveShotsLeft', (shooter.getData('diveShotsLeft') || 1) - 1);
          enemyFireBudget -= 1;

          // Next shot cooldown depends on IQ (smarter shoots a bit more often)
          const thin = (1 - aliveRatio);
          const cdScale = 1.08 - (iq * 0.22) - (thin * 0.10);
          const cdMin = Math.max(260, Math.floor(420 * cdScale));
          const cdMax = Math.max(cdMin + 140, Math.floor(820 * cdScale));
          shooter.setData('shotCdMs', cdMin + POHP_grInt(cdMax - cdMin));

          enemyFireCooldownMs = gMin + POHP_grInt(gMax - gMin + 1);
          return;
        } else {
          // short "think" delay, keeps it snappy
          enemyFireCooldownMs = 25 + POHP_grInt(55);
        }
      }
    }
  }

  // ============================================================
  // B) FORMATION AI (in-convoy): rare-ish but meaningful volleys
  // ============================================================
  if (!formationEnemies.length) return;

  // Build "frontline" (lowest in each column)
  const byCol = new Map();
  let minCol = 1e9, maxCol = -1e9;
  formationEnemies.forEach(e => {
    const col = e.getData('col') ?? 0;
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
    const cur = byCol.get(col);
    if (!cur || e.y > cur.y) byCol.set(col, e);
  });
  const frontline = Array.from(byCol.values());
  if (!frontline.length) return;

  // Update shared formation brain (leader + marks + mode)
  AI_tickFormationIntel(deltaMs, formationEnemies, frontline, aliveRatio, melee);

  // If leader wants a flank, bias the formation group side toward it.
  if (formationIntel && (formationIntel.flankHoldMs || 0) > 0) {
    formationGroupSide = (formationIntel.flankSide < 0) ? -1 : 1;
    formationGroupSideHoldMs = Math.max(formationGroupSideHoldMs, 260);
  }

  // ============================================================
  // B) FORMATION AI (Kernel 1): group-side bias (left/right flank)
  // ============================================================
  formationGroupSideHoldMs -= deltaMs;
  if (formationGroupSideHoldMs <= 0) {
    // formation center from frontline
    let cx = 0;
    for (let i = 0; i < frontline.length; i++) cx += frontline[i].x;
    cx = cx / Math.max(1, frontline.length);

    const prefer = (playerX < cx) ? -1 : 1;

    // If a leader is active, stay more disciplined to the leader flank.
    const leaderType = (formationIntel && formationIntel.leaderType) ? formationIntel.leaderType : "";
    const leaderIsFlag = (leaderType === "flagship");

    if (leaderIsFlag && formationIntel && (formationIntel.flankHoldMs || 0) > 0) {
      formationGroupSide = (formationIntel.flankSide < 0) ? -1 : 1;
    } else {
      // prefer player's side, but not always (keeps classic unpredictability)
      const disciplinedP = leaderIsFlag ? 0.78 : 0.65;
      formationGroupSide = POHP_grChance(disciplinedP) ? prefer : -prefer;
    }

    // hold window: longer early waves, shorter later waves
    const holdBase = Math.max(650, 1500 - (w - 1) * 60);
    formationGroupSideHoldMs = holdBase + POHP_grInt(850);
  }

  // ============================================================
  // B) FORMATION AI (Kernel 2): planned column order per volley
  // ============================================================
  const buildFormationVolleyPlan = (targetX) => {
    // pick the column closest to targetX
    let targetCol = frontline[0].getData('col') ?? 0;
    let best = 1e9;
    for (let i = 0; i < frontline.length; i++) {
      const e = frontline[i];
      const dx = Math.abs(e.x - targetX);
      if (dx < best) { best = dx; targetCol = e.getData('col') ?? targetCol; }
    }

    const colsSorted = Array.from(byCol.keys()).sort((a, b) => a - b);
    const edgeCol = (formationGroupSide < 0) ? colsSorted[0] : colsSorted[colsSorted.length - 1];

    // “Real Galaxian vibe”: formation chooses a tactical volley pattern.
    const mode = (formationIntel && formationIntel.mode)
      ? formationIntel.mode
      : ((melee || POHP_grChance(0.58)) ? "focus" : "sweep");

    const plan = [];

    if (mode === "focus") {
      plan.push(targetCol);
      // spread around target in a deterministic alternating pattern
      for (let k = 1; k <= 8; k++) {
        plan.push(targetCol + formationGroupSide * k);
        plan.push(targetCol - formationGroupSide * k);
      }
    } else if (mode === "sweep") {
      const step = (edgeCol <= targetCol) ? 1 : -1;
      for (let c = edgeCol; c !== targetCol; c += step) plan.push(c);
      plan.push(targetCol);
      // go a bit past target (sweep-through feel)
      for (let k = 1; k <= 6; k++) plan.push(targetCol + step * k);
    } else if (mode === "pinch") {
      // Pinch = alternating shots from both sides around the target.
      // Feels "smart" without increasing raw accuracy.
      for (let k = 2; k <= 10; k++) {
        plan.push(targetCol - k);
        plan.push(targetCol + k);
      }
      plan.push(targetCol - 1);
      plan.push(targetCol + 1);
      plan.push(targetCol);
      for (let k = 3; k <= 8; k++) {
        plan.push(targetCol - k);
        plan.push(targetCol + k);
      }
    } else { // "cross"
      // Cross = alternating from edges inward, then finishing near target.
      const colsSorted2 = Array.from(byCol.keys()).sort((a, b) => a - b);
      let L = 0, R = colsSorted2.length - 1;
      while (L <= R && plan.length < 18) {
        plan.push(colsSorted2[L++]);
        if (L <= R) plan.push(colsSorted2[R--]);
      }
      plan.push(targetCol);
      for (let k = 1; k <= 6; k++) {
        plan.push(targetCol + k);
        plan.push(targetCol - k);
      }
    }

    const out = [];
    const seen = new Set();
    for (let i = 0; i < plan.length; i++) {
      const c = plan[i];
      if (c < minCol || c > maxCol) continue;
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
    }
    return out;
  };

  // ============================================================
  // Volley scheduling (kept) — but now we also build a column plan
  // ============================================================
  if (formationVolleyLeft <= 0 && formationVolleyTimerMs <= 0) {
    const aiWave = Phaser.Math.Clamp((w - 1) / 18, 0, 1);
    const aiThin = Phaser.Math.Clamp((1 - aliveRatio) * 0.85, 0, 0.85);
    const aiMelee = melee ? 0.35 : 0;
    const ai = Phaser.Math.Clamp(aiWave + aiThin + aiMelee, 0, 1.35);

    // Brake: during player invulnerability, push volleys farther out
    const invuln = (invulnerabilityTimer > 0);
    let baseInt = 1180 - Math.floor((w - 1) * 48) - Math.floor(aiThin * 220);
    baseInt = Math.max(520, baseInt);
    if (melee) baseInt = Math.min(baseInt, 420);
    if (invuln) baseInt = Math.floor(baseInt * 1.25);

    let size = 1 + Math.floor((w - 1) / 4);
    size = Math.min(5, size);
    if (aliveRatio < 0.35) size += 1;
    if (melee) size = Math.max(size, 3);

    // Leader influence (formation communication): flagship can slightly “organize” volleys.
    // Braked hard during invulnerability.
    const leaderType = (formationIntel && formationIntel.leaderType) ? formationIntel.leaderType : "";
    if (!invuln && leaderType === "flagship") size += (w >= 3 ? 1 : 0);

    // Brake: keep respawn moments fair
    if (invuln) size = 1;
    size = Math.min(6, size);

    const laneStep = 25;
    const targetX = formationShootExactX || (Math.round(predictPlayerXAtY(120) / laneStep) * laneStep);

    formationVolleyTimerMs = baseInt + POHP_grInt(Math.floor(320 - ai * 120));
    formationVolleyLeft = size;
    formationVolleyGapMs = 0; // start immediately

    // Build a “planned” column order for this volley (Kernel 2)
    formationVolleyPlanCols = buildFormationVolleyPlan(targetX);
    formationVolleyPlanIdx = 0;
  }

  // If volley pending but we can't spend (budget + cap), keep cadence light and return
  const canSpend = (enemyFireBudget >= 1) && (enemyBullets.countActive(true) < waveBulletCap);
  if (formationVolleyLeft > 0 && !canSpend) {
    enemyFireCooldownMs = 55 + POHP_grInt(80);
    return;
  }

  // Fire one shot per gap tick while volley is active
  if (formationVolleyLeft > 0 && formationVolleyGapMs <= 0) {
    const laneStep = 25;
    const targetX = formationShootExactX || (Math.round(predictPlayerXAtY(120) / laneStep) * laneStep);

    // ------------------------------------------------------------
    // Shooter selection (planned columns first, then aligned fallback)
    // ------------------------------------------------------------
    let shooter = null;

    // 1) Planned column order (group behavior)
    for (let tries = 0; tries < 10 && formationVolleyPlanIdx < formationVolleyPlanCols.length; tries++) {
      const col = formationVolleyPlanCols[formationVolleyPlanIdx++];
      const e = byCol.get(col);
      if (e && e.active && (e.getData('state') || 'formation') === 'formation' && (e.getData('fShotCdMs') || 0) <= 0) {
        shooter = e;
        break;
      }
    }

    // 2) Fallback: pick among aligned frontline (more “hit” but fewer shots)
    const aimWinBase = Phaser.Math.Clamp(
      26 + Math.floor((w - 1) * 1.6) + Math.floor((1 - aliveRatio) * 60) + (melee ? 18 : 0),
      26, 130
    );

    const aligned = [];
    for (let i = 0; i < frontline.length; i++) {
      const e = frontline[i];
      if ((e.getData('fShotCdMs') || 0) > 0) continue;

      const t = enemyTypeOf(e);
      const k = AI_getKernel(t).formation;

      const iq = iqForEnemy(e);
      const t2 = enemyTypeOf(e);
      const typeLearnMul = (t2 === 'blue') ? 0.20 : (t2 === 'purple') ? 0.45 : (t2 === 'red') ? 0.75 : 1.00;
      const learnAdj = learnLevel * typeLearnMul;
      const win = Math.floor(aimWinBase * (1.08 - 0.34 * iq) * k.aimWinMul * (1.0 - 0.10 * learnAdj));
      if (Math.abs(e.x - targetX) <= win) aligned.push(e);
    }

    if (!shooter) {
      if (aligned.length) {
        // Prefer the side bias, but still prioritize closeness to the lane.
        const weightFn = (e) => {
          const t = enemyTypeOf(e);
          const k = AI_getKernel(t).formation;

          const iq = iqForEnemy(e);
          const dx = Math.abs(e.x - targetX);
          const col = e.getData('col') ?? 0;

          const sideDist = (formationGroupSide < 0) ? (col - minCol) : (maxCol - col);
          const sideW = 1 / (1 + sideDist); // higher near preferred flank
          const laneW = 1 / (14 + dx);

          // If a lane is marked, reds/flagship lean into it (communication)
          let markW = 1.0;
          if (formationIntel && (formationIntel.markTtlMs || 0) > 0 && Number.isFinite(formationIntel.markX)) {
            const mdx = Math.abs(e.x - formationIntel.markX);
            const nearMark = 1 / (18 + mdx);
            if (t === 'red' || t === 'flagship') markW = 0.85 + 0.90 * nearMark;
            else if (t === 'purple') markW = 0.92 + 0.55 * nearMark;
            else markW = 0.98 + 0.25 * nearMark;
          }

          const typeW = typeWeight(t);
          return typeW * k.weight * (0.75 + 0.55 * iq) * (0.35 + 0.65 * laneW) * (0.55 + 0.45 * sideW) * markW;
        };
        shooter = pickByWeight(aligned, weightFn);
      } else {
        // nobody aligned right now — wait instead of wasting “stray” bullets (brake + higher hit when it fires)
        formationVolleyGapMs = 85 + POHP_grInt(70);
        enemyFireCooldownMs = 30 + POHP_grInt(35);
        return;
      }
    }

    // ------------------------------------------------------------
    // Fire decision (slightly more accurate, but with brakes)
    // ------------------------------------------------------------
    const t = enemyTypeOf(shooter);
    const k = AI_getKernel(t).formation;

    const iq = iqForEnemy(shooter);
    const dx = Math.abs(shooter.x - targetX);
    const aimWin = Math.floor(aimWinBase * (1.08 - 0.34 * iq) * k.aimWinMul);
    const isAligned = dx <= aimWin;

    // Reduce firing during invulnerability (fairness brake)
    const invuln = (invulnerabilityTimer > 0);
    if (invuln) {
      formationVolleyGapMs = 120 + POHP_grInt(90);
      enemyFireCooldownMs = 40 + POHP_grInt(45);
      return;
    }

    // Type-based “hit” ladder + discipline (AI brakes)
    // - blue: lower pAligned, more waiting
    // - purple: medium, can mark lanes via formationIntel
    // - red: higher pAligned, tighter window, occasional bursts
    // - flagship: strongest coordination, still not spammy
    const thin = (1 - aliveRatio);

    let pAligned = Phaser.Math.Clamp(k.pAlignedBase + 0.18 * iq + 0.10 * thin, 0.40, 0.97);
    let pStray   = Phaser.Math.Clamp(k.pStrayBase   + 0.06 * thin - 0.05 * iq, 0.02, 0.18);

    // Self‑improvement: smarter types gain slightly higher "aligned fire" over time, but reduce stray spam.
    {
      const tL = enemyTypeOf(shooter);
      const typeLearnMul = (tL === 'blue') ? 0.20 : (tL === 'purple') ? 0.45 : (tL === 'red') ? 0.75 : 1.00;
      const learnAdj = learnLevel * typeLearnMul;

      pAligned = Phaser.Math.Clamp(pAligned + 0.07 * learnAdj, 0.38, 0.97);
      pStray   = Phaser.Math.Clamp(pStray   - 0.05 * learnAdj, 0.01, 0.18);
    }

    // Late‑game brakes: under high pressure, reduce firing probabilities (keeps it playable).
    if (aiBrake > 0) {
      pAligned = Phaser.Math.Clamp(pAligned * (1 - 0.22 * aiBrake), 0.34, 0.97);
      pStray   = Phaser.Math.Clamp(pStray   * (1 - 0.55 * aiBrake), 0.01, 0.18);
    }
    

    // Experimental: mood + mercy adjust formation accuracy (deterministic, bounded)
    {
      const mood = (EXP_SWARM_MOODS && formationIntel && formationIntel.mood) ? formationIntel.mood : "calm";
      let mA = 1.0, mS = 1.0, wAdd = 0.0;

      if (EXP_SWARM_MOODS) {
        if (mood === "calm")   { mA = 0.90; mS = 0.92; wAdd = 0.06; }
        if (mood === "probe")  { mA = 0.96; mS = 0.98; wAdd = 0.02; }
        if (mood === "punish") { mA = 1.08; mS = 0.86; wAdd = -0.03; }
        if (mood === "feint")  { mA = 0.98; mS = 0.85; wAdd = 0.00; }
      }

      const mercyNow = (EXP_MERCY_GOVERNOR && (aiLearn.mercyMs || 0) > 0) ? AI_clamp01((aiLearn.mercyMs || 0) / 2600) : 0;
      if (mercyNow > 0) {
        // after a hit, reduce “laser accuracy” and prefer waiting a bit more
        mA *= (1 - 0.18 * mercyNow);
        mS *= (1 - 0.35 * mercyNow);
        wAdd += 0.08 * mercyNow;
      }

      pAligned = Phaser.Math.Clamp(pAligned * mA, 0.32, 0.97);
      pStray   = Phaser.Math.Clamp(pStray   * mS, 0.01, 0.18);
      // stash for waitP calc below (small bias only)
      shooter.setData('moodWaitAdd', wAdd);
    }


    // If not aligned, most types wait; dumb types wait even more (keeps it fair)
    const waitP = Phaser.Math.Clamp(k.waitBias + (melee ? -0.06 : 0) - 0.10 * iq + (shooter.getData('moodWaitAdd') || 0), 0.55, 0.98);
    if (!isAligned && POHP_grChance(waitP)) {
      formationVolleyGapMs = 85 + POHP_grInt(80);
      enemyFireCooldownMs = 30 + POHP_grInt(45);
      return;
    }

    let fired = false;
    if (POHP_grChance(isAligned ? pAligned : pStray)) {
      if (shootEnemyBullet(shooter.x, shooter.y, false, shooter)) {
        enemyFireBudget -= 1;
        fired = true;
      }
    }

    // Optional RED/FLAGSHIP burst (very braked)
    // Only when aligned, bullets cap allows, budget allows, and no recent burst heat.
    if (fired && isAligned && (k.burstChance > 0) && enemyFireBudget >= 1 && enemyBullets.countActive(true) < (waveBulletCap - 1)) {
      const heatOk = !(formationIntel && (formationIntel.burstHeatMs || 0) > 0);
      const burstP = Phaser.Math.Clamp(k.burstChance * (0.65 + 0.55 * iq) * (melee ? 0.65 : 1.0) * (1 - 0.75 * aiBrake), 0, 0.30);
      if (heatOk && POHP_grChance(burstP)) {
        // second shot from the same shooter (classic “double tap” feel)
        if (shootEnemyBullet(shooter.x, shooter.y, false, shooter)) {
          enemyFireBudget -= 1;
          formationVolleyLeft -= 1; // count it as part of the volley (keeps total volume fair)
          if (formationIntel) formationIntel.burstHeatMs = 650; // cool-off
        }
      }
    }

    // Per-enemy cooldown (kernel-specific)
    {
      const cdBase = k.cooldownMs;
      const cdJit = 120 + POHP_grInt(240);
      shooter.setData('fShotCdMs', cdBase + cdJit);
    }

    formationVolleyLeft -= 1;

    // volley gap shrinks slowly with wave + thin-out, but never becomes a machinegun
    let gapBase = Math.max(70, 140 - Math.floor((w - 1) * 6) - Math.floor((1 - aliveRatio) * 20) - (melee ? 20 : 0));
    // Extra tactic pacing (smart patterns, not raw spam): pinch fires slightly tighter, cross slightly wider.
    if (EXP_TACTICS_V2 && formationIntel && formationIntel.mode) {
      const m = formationIntel.mode;
      if (m === 'pinch') gapBase = Math.max(60, gapBase - 14);
      if (m === 'cross') gapBase = Math.min(210, gapBase + 18);
    }
    formationVolleyGapMs = gapBase + POHP_grInt(55);

    enemyFireCooldownMs = gMin + POHP_grInt(gMax - gMin + 1);
    return;
  }

// otherwise, small idle cooldown so we keep ticking smoothly
  enemyFireCooldownMs = 20 + POHP_grInt(40);
}

function shootEnemyBullet(a, b, isDive = false, shooterObj = null) {
  // Backward-compatible: can be called as shootEnemyBullet(shooter) OR shootEnemyBullet(x, y, isDive, shooter)
  let shooter = null;
  let x = 0, y = 0;

  if (a && typeof a === 'object') {
    shooter = a;
    x = shooter.x;
    y = shooter.y;
    isDive = !!b;
  } else {
    x = a;
    y = b;
    shooter = shooterObj;
  }

  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

  // AI brake: don't spawn if too many enemy bullets are already active
  if (enemyBullets && enemyBullets.countActive && enemyBullets.countActive(true) >= maxEnemyBulletsNow()) return false;

  const bullet = enemyBullets.getFirstDead(false);
  if (!bullet) return false;

  bullet.setActive(true);
  bullet.setVisible(true);
  bullet.setScale(0.5);
  setupBulletBody(bullet, "enemy");

  const spawnY = y + (isDive ? 10 : 18);
  bullet.setPosition(x, spawnY);

  // Enemy bullet speed is CONSTANT across the whole game (classic Galaxian feel).
  // Original code updates the missile by +2 pixels per tick; we scale that to our 600px playfield.
  const vY = ENEMY_BULLET_SPEED_PPS;

  // --- Galaxian-ish "shoot window" + Galaga-ish leading aim for divers ---
  let vX = 0;

  if (isDive && player && player.active) {
    const playerVx = (player.body && player.body.velocity) ? player.body.velocity.x : 0;

    // Estimate time-to-intercept based on vertical separation and bullet vy
    const dy = Math.max(60, player.y - spawnY);
    const t = Phaser.Math.Clamp(dy / Math.max(120, vY), 0.12, 1.05);

    // Blend: lead a bit, but also bias toward a "chosen X" window (unpredictable)
    const leadFactor = 0.32 + Math.min((wave - 1) * 0.02, 0.22); // 0.32..0.54
    let targetX = player.x + playerVx * t * leadFactor;

    const exactX = shooter && shooter.getData ? shooter.getData('shootExactX') : null;
    if (Number.isFinite(exactX)) {
      const blend = 0.40 + Math.min((wave - 1) * 0.01, 0.25); // 0.40..0.65
      targetX = Phaser.Math.Linear(targetX, exactX, blend);
    }

    // Accuracy ramp (smaller error as wave increases, but never perfect)
    const errMax = Math.max(10, 28 - (wave - 1) * 1.2);
    targetX += POHP_grFloatBetween(-errMax, errMax);

    const vxRaw = (targetX - x) / t;
    vX = Phaser.Math.Clamp(vxRaw, -420, 420);
  } else {
    // Formation fire is mostly straight, with a tiny chance to "nudge" toward player (keeps pressure)
    const aimP = 0.08 + Math.min((wave - 1) * 0.006, 0.10);
    if (player && player.active && POHP_grFloat() < aimP) {
      const dy = Math.max(120, player.y - spawnY);
      const t = Phaser.Math.Clamp(dy / Math.max(120, vY), 0.18, 1.3);
      const err = 140; // sloppy
      const targetX = player.x + POHP_grFloatBetween(-err, err);
      vX = Phaser.Math.Clamp((targetX - x) / t, -220, 220);
    }
  }

  if (bullet.body) {
    bullet.body.enable = true;
    bullet.body.reset(x, spawnY);
    // Enemy bullets are strictly vertical (classic Galaxian feel)
    vX = 0;
    bullet.body.setVelocity(0, vY);
    return true;
  }

  return false;
}



// =================== WAVE ADVANCE (SAFETY NET) ===================
// Ensures next wave starts even if the last enemy disappears via collision/offscreen/etc.
// Uses a guard (waveAdvancePending) to prevent double-advances.
function maybeStartNextWave(scene) {
  if (waveAdvancePending) return;
  if (gamePhase !== GAME_PHASE.RUNNING) return;
  if (lives <= 0) return;
  if (!enemies || enemies.countActive(true) !== 0) return;

  const sc = scene || mainScene;
  if (!sc || !sc.time || typeof sc.time.delayedCall !== "function") return;

  waveAdvancePending = true;

  // wave clear bonus
  const clearBonus = 250 + (wave * 25);
  score += clearBonus;
  if (scoreText) scoreText.setText('SCORE: ' + score);

  // next wave
  wave += 1;
  applyWaveDifficulty(wave);

  // Reset formation volley timers each wave (keeps pressure consistent across quick clears).
  enemyFireBudget = Math.max(enemyFireBudget, 1.10);
  formationVolleyTimerMs = 350 + POHP_grBetween(0, 500);
  formationVolleyLeft = 0;
  formationVolleyGapMs = 0;

  // reset formation communication bus on new wave
  formationIntel.markX = null;
  formationIntel.markTtlMs = 0;
  formationIntel.markBy = "";
  formationIntel.leaderKey = null;
  formationIntel.leaderType = "";
  formationIntel.leaderHoldMs = 0;
  formationIntel.flankSide = 1;
  formationIntel.flankHoldMs = 0;
  formationIntel.modeHoldMs = 0;
  formationIntel.burstHeatMs = 0;
  // tacticHeatMs exists in v1.3.2 (used only when EXP_TACTICS_V2 is enabled)
  if (formationIntel.tacticHeatMs !== undefined) formationIntel.tacticHeatMs = 0;

  if (waveText) waveText.setText('WAVE: ' + wave);

  sc.time.delayedCall(750, () => {
    waveAdvancePending = false;
    if (gamePhase !== GAME_PHASE.RUNNING) return;
    if (lives <= 0) return;
    createEnemyFormation(sc);
  });
}

// =================== COLLISIONS ===================
function hitEnemy(bullet, enemy) {
  disableBullet(bullet);

  if (enemy && enemy.active) {
    enemy.setActive(false);
    enemy.setVisible(false);
    if (enemy.body) {
      enemy.body.enable = false;
      enemy.body.setVelocity(0, 0);
    }
  }

  const type = enemy.getData('type') || 'blue';
  // AI learns from player farming patterns (gameplay only)
  AI_onEnemyKilled(type);
  const points = ENEMY_SCORES[type] || ENEMY_SCORES.blue;

  // bonus for killing while diving (risk reward!)
  const st = enemy.getData('state');
  const diveBonus = (st === 'diveLoop' || st === 'diveStraight') ? Math.floor(points * 0.35) : 0;

  score += (points + diveBonus);
  if (scoreText) scoreText.setText('SCORE: ' + score);

  const gotNewHi = maybeUpdateHighScore();
  if (gotNewHi && highScoreText) {
    highScoreText.setText('HI-SCORE: ' + highScore);
    saveScores();
  }

  const scene = enemy.scene;
  const boom = scene.add.sprite(enemy.x, enemy.y, 'explosion');
  boom.setScale(1.0);
  scene.time.delayedCall(300, () => boom.destroy());

  // infinite waves
  if (enemies.countActive(true) === 0) {
    maybeStartNextWave(scene);
  }
}

function spawnPlayerHitFX(scene, x, y) {
  // boom.png effect (your request)
  const fx = scene.add.image(x, y, 'boom').setOrigin(0.5).setScale(1.15).setDepth(20);
  fx.setAlpha(1);
  scene.tweens.add({
    targets: fx,
    scale: 0.15,
    alpha: 0,
    duration: 420,
    onComplete: () => fx.destroy()
  });
}

function hitPlayer(bulletOrEnemy, playerObj) {
  if (gamePhase !== GAME_PHASE.RUNNING) return;
  if (playerState !== PLAYER_STATE.PLAYING) return;
  if (!playerObj || !playerObj.active) return;
  if (invulnerabilityTimer > 0) return;

  // disable bullet (if bullet)
  if (bulletOrEnemy) {
    const isBullet = enemyBullets.contains(bulletOrEnemy) || playerBullets.contains(bulletOrEnemy);
    if (isBullet) disableBullet(bulletOrEnemy);
  }

  // If this hit came from an enemy collision (enemy ↔ player), kill that enemy too
  // so the "last enemy dead => new wave" rule always triggers.
  if (bulletOrEnemy && enemies && typeof enemies.contains === 'function' && enemies.contains(bulletOrEnemy)) {
    const e = bulletOrEnemy;
    if (e && e.active) {
      e.setActive(false);
      e.setVisible(false);
      if (e.body) {
        e.body.enable = false;
        e.body.setVelocity(0, 0);
      }
    }
  }


  lives -= 1;
  if (lives < 0) lives = 0;
  if (livesText) livesText.setText('LIVES: ' + lives);

  // AI learns: landing a hit triggers a short back‑off (fun fairness)
  AI_onPlayerHit();

  const scene = playerObj.scene;

  if (sfxHitShip) sfxHitShip.play({ volume: SFX_HIT_VOLUME, rate: 0.85 });

  spawnPlayerHitFX(scene, playerObj.x, playerObj.y);

  disablePlayerPhysics(playerObj);

  setColliderActive(enemyBulletPlayerCollider, false);
  setColliderActive(enemyPlayerCollider, false);

  respawnTimer = RESPAWN_DELAY;

  if (lives > 0) {
    playerState = PLAYER_STATE.DYING;
  } else {
    playerState = PLAYER_STATE.GAME_OVER;
    scene.time.delayedCall(RESPAWN_DELAY, () => gameOver());
  }

  // Wave safety: if this collision also removed the last enemy, advance (unless game over)
  maybeStartNextWave(scene);
}

// =================== BULLETS HELPERS ===================
function disableBullet(bullet) {
  if (!bullet || !bullet.active) return;
  bullet.setActive(false);
  bullet.setVisible(false);
  bullet.setPosition(-100, -100);
  if (bullet.body) {
    bullet.body.enable = false;
    bullet.body.setVelocity(0, 0);
  }
}

function cleanupBullets() {
  playerBullets.children.entries.forEach(b => { if (b.active && b.y < -20) disableBullet(b); });
  enemyBullets.children.entries.forEach(b => { if (b.active && (b.y > 620 || b.x < -40 || b.x > 840)) disableBullet(b); });
}

function clearAllBullets() {
  if (playerBullets) playerBullets.children.entries.forEach(b => disableBullet(b));
  if (enemyBullets) enemyBullets.children.entries.forEach(b => disableBullet(b));
}

// =================== GAME OVER ===================
function gameOver() {
  gamePhase = GAME_PHASE.GAME_OVER;
  playerState = PLAYER_STATE.GAME_OVER;

  // === Proof-of-High-Play package ===
  // Live: export runPackage.json automatically
  // Replay: verify recomputed score vs expected
  if (POHP_replay.enabled && POHP_replay.loaded) {
    const okScore = (score === POHP_replay.expectedScore);
    const okWave  = (wave === POHP_replay.expectedWave);
    const hashNote = (POHP_replay.hashOk === null) ? "" : (POHP_replay.hashOk ? "hash OK" : "hash MISMATCH");
    if (pohpStatusText) pohpStatusText.setText(
      "REPLAY VERIFY: " + ((okScore && okWave) ? "PASS ✅" : "FAIL ❌") +
      "\nexpected score " + POHP_replay.expectedScore + " / got " + score +
      "\nexpected wave " + POHP_replay.expectedWave + " / got " + wave +
      (hashNote ? ("\n" + hashNote) : "")
    );
  } else {
    // Build runPackage (async). Download is triggered by user gesture (press P) to avoid browser blocking.
    POHP_finalizeRunPackageOnGameOver(score, wave).then(() => {
  if (pohpStatusText) pohpStatusText.setText("PROOF READY ✅  Press P to download runPackage.json  |  Verify: ?replay=1");

  // Auto-verify the exact runPackage we just built (NO gameplay changes)
  if (window.CHAIN?.enabled && window.ChainClient?.verifyRun) {
    window.ChainClient.verifyRun(POHP_lastPackage).then((v) => {
      if (!pohpStatusText) return;
      const scoreConfirmed = !!(v && v.score_confirmed);
      const mode = String((v && v.gate_d_mode) || "");
      const status = String((v && v.gate_d_status) || "");
      const claimedScore = Number((v && v.final_score_claimed) ?? score);
      const claimedWave = Number((v && v.final_wave_claimed) ?? wave);
      const seasonTier = String((v && v.season_verification_tier) || (scoreConfirmed ? "verified" : "provisional"));
      const rewardEligible = !!(v && v.season_reward_eligible);
      const verificationClosed = scoreConfirmed && mode === "strict" && (status === "pass" || status === "pass_checkpoint_v2");
      const verdictLine = scoreConfirmed
        ? ("SCORE VERIFIED ✅ " + claimedScore + " / wave " + claimedWave)
        : ("SCORE CLAIMED ⚠️ " + claimedScore + " / wave " + claimedWave + " (GateD " + mode + ":" + status + ")");
      const seasonLine = "SEASON: " + seasonTier.toUpperCase() + (rewardEligible ? " (reward eligible ✅)" : " (reward pending)");
      const closeLine = verificationClosed ? "VERIFICATION CLOSED ✅" : "VERIFICATION PENDING ⏳";
      pohpStatusText.setText("PROOF READY ✅  Press P to download runPackage.json  |  Verify: ?replay=1\n" + verdictLine + "\n" + seasonLine + "\n" + closeLine);
    }).catch(() => {
      // keep silent; UI will still show proof ready
    });
  }
}).catch(() => {
  if (pohpStatusText) pohpStatusText.setText("PROOF ERROR ❌  (open console)");
});

  }

  // finalize scores (skip persistence during replay verification)
  if (!(POHP_replay.enabled && POHP_replay.loaded)) {
    maybeUpdateHighScore();
    pushTopScore(score, wave);
    saveScores();
  } else {
    // still update hi-score display locally (no write)
    maybeUpdateHighScore();
  }

  if (highScoreText) highScoreText.setText('HI-SCORE: ' + highScore);
  if (topText) topText.setText(formatTopScores());

  // stop gameplay
  if (player) disablePlayerPhysics(player);
  clearAllBullets();

  setColliderActive(enemyBulletPlayerCollider, false);
  setColliderActive(enemyPlayerCollider, false);
  setColliderActive(playerBulletEnemyCollider, false);

  respawnTimer = 0;
  invulnerabilityTimer = 0;

  // show game over
  if (gameOverImage) gameOverImage.setVisible(true);

  if (chainStatusText) chainStatusText.setText("R = RESTART   B = SUBMIT PROOF (CHAIN)   P = DOWNLOAD PROOF");

  // audio: keep bgm low, loops silent
  if (bgm) bgm.setVolume(BGM_VOLUME * 0.65);
  if (sfxEnemyMoveLoop) sfxEnemyMoveLoop.setVolume(0);
  if (sfxEnemyDiveLoop) sfxEnemyDiveLoop.setVolume(0);

  mainScene.physics.pause();
}

// =================== START GAME ===================
game = new Phaser.Game(config);
