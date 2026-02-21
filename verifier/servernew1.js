// verifier/sim/core.js
// Gate D: Deterministic re-simulation (PURE JS, no Phaser)
// v1.3.1 patch: fixes missing vars/functions + uses shared ruleset + fixes assetsDir default.

const fs = require("fs");
const path = require("path");

// Try to load frozen ruleset (v1.3.1)
let RS = null;
try {
  RS = require("../../src/chain/ruleset_v1_3_1_pure.js");
} catch {
  RS = null; // fallback to internal defaults
}

const SCREEN_W = RS?.SCREEN_W ?? 800;
const SCREEN_H = RS?.SCREEN_H ?? 600;

const PLAYER_SPEED = 220;
const PLAYER_BULLET_VY = -400;

const MAX_PLAYER_BULLETS_POOL = 12;
const MAX_ENEMY_BULLETS_POOL = 32;

const RESPAWN_DELAY = RS?.RESPAWN_DELAY ?? 800;
const INVULN_DURATION = RS?.INVULN_DURATION ?? 1600;
const WAVE_SPAWN_DELAY_MS = RS?.WAVE_SPAWN_DELAY_MS ?? 750;

// --- RunPackage format (as used by verifier/server.js)
const POHP_INPUT_BITS = {
  left: 1 << 0,
  right: 1 << 1,
  shoot: 1 << 2,
};

// --- helpers ---
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function makeAABB(x, y, halfW, halfH) {
  return { l: x - halfW, r: x + halfW, t: y - halfH, b: y + halfH };
}
function aabbOverlap(A, B) {
  return !(A.r < B.l || A.l > B.r || A.b < B.t || A.t > B.b);
}

function decodeU8FromB64(b64) {
  if (!b64) return new Uint8Array(0);
  return new Uint8Array(Buffer.from(String(b64), "base64"));
}
function decodeU16LEFromB64(b64) {
  const u8 = decodeU8FromB64(b64);
  return new Uint16Array(u8.buffer, u8.byteOffset, Math.floor(u8.byteLength / 2));
}

function makeMulberry32(seedU32) {
  let a = seedU32 >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadPngSize(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 24) return null;
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { w, h };
  } catch {
    return null;
  }
}

// --- core sim ---
function simulateRunPackage(body, opts = {}) {
  try {
    // 1) decode input streams
    const seed = (Number(body.seed) >>> 0) || 0;
    const masks = decodeU8FromB64(body.masks_b64);
    const deltas = decodeU16LEFromB64(body.deltas_b64);

    const frames = Math.min(masks.length, deltas.length);
    if (frames <= 0) throw new Error("empty runPackage streams");

    // 2) assets directory (IMPORTANT!)
    // default should point to project-root /assets, not verifier/assets
    const assetsDir =
      opts.assetsDir ||
      path.resolve(__dirname, "..", "..", "assets"); // verifier/sim -> project/assets

    // 3) read sprite sizes (fallbacks if missing)
    const spriteKeys = {
      ship: "ship.png",
      enemy_blue: "enemy_blue.png",
      enemy_red: "enemy_red.png",
      enemy_purple: "enemy_purple.png",
      enemy_flagship: "enemy_flagship.png",
      bullet_player: "bullet_player.png",
      bullet_enemy: "bullet_enemy.png",
    };

    const sprite = {};
    for (const [k, file] of Object.entries(spriteKeys)) {
      const s = loadPngSize(path.join(assetsDir, file));
      sprite[k] = {
        w: s?.w ?? (k === "ship" ? 64 : 48),
        h: s?.h ?? (k === "ship" ? 64 : 48),
        scale:
          k === "ship" ? 0.8 :
          k.startsWith("enemy_") ? 0.6 :
          k.startsWith("bullet_") ? 0.55 : 1.0,
      };
    }

    // 4) deterministic RNG
    const gr = makeMulberry32(seed);
    const grFloat = () => gr();
    const grBetween = (a, b) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return lo + Math.floor(grFloat() * (hi - lo + 1));
    };

    // 5) state
    let score = 0;
    let wave = 1;
    let lives = 3;

    const PLAYER_STATE = {
      PLAYING: "playing",
      DYING: "dying",
      GAME_OVER: "game_over",
    };

    const player = { x: 400, y: 550, vx: 0, active: true };
    let playerState = PLAYER_STATE.PLAYING;

    // NOTE: keep same “double decrement per frame” style you had
    let invulnerabilityTimer = 900; // initial start buffer
    let respawnTimer = 0;
    let shootCooldown = 0;
    let prevMask = 0;

    let waveSpawnTimer = 0;

    const enemies = []; // all enemies (formation + divers)
    const playerBullets = [];
    const enemyBullets = [];

    for (let i = 0; i < MAX_PLAYER_BULLETS_POOL; i++) playerBullets.push({ x: -999, y: -999, vx: 0, vy: 0, active: false });
    for (let i = 0; i < MAX_ENEMY_BULLETS_POOL; i++) enemyBullets.push({ x: -999, y: -999, vx: 0, vy: 0, active: false });

    // formation movement
    let enemyDirection = 1;
    let formationMoveAcc = 0;
    let formationSwayMs = 0;
    let formationSwayPrev = 0;

    // difficulty
    let enemySpeedBase = 22;
    let enemyDiveBaseChance = 0.0010;
    let enemyBulletBaseChance = 0.0008;

    function applyWaveDifficulty(w) {
      if (RS?.applyWaveDifficulty) {
        const d = RS.applyWaveDifficulty(w);
        enemySpeedBase = d.enemySpeedBase;
        enemyDiveBaseChance = d.enemyDiveBaseChance;
        enemyBulletBaseChance = d.enemyBulletBaseChance;
        return;
      }
      // fallback
      const x = Math.max(0, w - 1);
      enemySpeedBase = 14 + x * 0.7;
      enemyDiveBaseChance = 0.001 + x * 0.00005;
      enemyBulletBaseChance = 0.0007 + x * 0.00004;
    }

    function aliveRatioNow() {
      const alive = enemies.filter(e => e.active).length;
      const total = enemies.length || 1;
      return clamp(alive / total, 0, 1);
    }

    function getFirstDeadBullet(pool) {
      for (const b of pool) if (!b.active) return b;
      return null;
    }
    function disableBullet(b) {
      b.active = false;
      b.x = -999;
      b.y = -999;
      b.vx = 0;
      b.vy = 0;
    }

    function createEnemyFormation() {
      enemies.length = 0;

      const rows = RS?.formationRows ? RS.formationRows() : [
        { key: "enemy_flagship", type: "flagship", count: 2 },
        { key: "enemy_red", type: "red", count: 6 },
        { key: "enemy_purple", type: "purple", count: 8 },
        { key: "enemy_blue", type: "blue", count: 10 },
        { key: "enemy_blue", type: "blue", count: 10 },
      ];

      let rowIndex = 0;
      for (const row of rows) {
        const count = row.count;
        const startX = (RS?.FORMATION_CENTER_X ?? 400) - ((count - 1) * (RS?.ENEMY_SPACING_X ?? 50)) / 2;
        for (let i = 0; i < count; i++) {
          const e = {
            key: row.key,
            type: row.type,
            x: startX + i * (RS?.ENEMY_SPACING_X ?? 50),
            y: (RS?.ENEMY_START_Y ?? 90) + rowIndex * (RS?.ENEMY_SPACING_Y ?? 44) + (RS?.FORMATION_Y_OFFSET ?? -40),
            homeX: 0,
            homeY: 0,
            active: true,
            state: "formation", // formation | diveLoop | returning
            loopT: 0,
            diveTargetX: 400,
            diveShotsLeft: 0,
            shotCdMs: 0,
            offscreenMs: 0,
          };
          e.homeX = e.x;
          e.homeY = e.y;
          enemies.push(e);
        }
        rowIndex++;
      }

      formationMoveAcc = 0;
      formationSwayMs = 0;
      formationSwayPrev = 0;
      enemyDirection = 1;

      // clear bullets between waves (matches “fairness”)
      for (const b of playerBullets) disableBullet(b);
      for (const b of enemyBullets) disableBullet(b);

      applyWaveDifficulty(wave);
    }

    function shootPlayerBullet() {
      // onscreen cap (v1.3.1)
      const activeCount = playerBullets.filter(b => b.active).length;
      const maxOnscreen = RS?.MAX_PLAYER_BULLETS_ONSCREEN ?? 3;
      if (activeCount >= maxOnscreen) return;

      const b = getFirstDeadBullet(playerBullets);
      if (!b) return;

      b.active = true;
      b.x = player.x;
      b.y = player.y - 20;
      b.vx = 0;
      b.vy = PLAYER_BULLET_VY;
    }

    function shootEnemyBullet(x, y) {
      const cap = RS?.maxEnemyBulletsNow ? RS.maxEnemyBulletsNow(wave) : 8;
      if (enemyBullets.filter(b => b.active).length >= cap) return false;

      const b = getFirstDeadBullet(enemyBullets);
      if (!b) return false;

      b.active = true;
      b.x = x;
      b.y = y + 18;
      b.vx = 0;
      b.vy = RS?.ENEMY_BULLET_SPEED_PPS ?? 120;
      return true;
    }

    function onWaveCleared() {
      wave += 1;
      waveSpawnTimer = WAVE_SPAWN_DELAY_MS;
    }

    function hitEnemy(playerBullet, enemy) {
      disableBullet(playerBullet);
      enemy.active = false;

      const pts = RS?.scoreForEnemyKey ? RS.scoreForEnemyKey(enemy.key) : 50;
      score += pts;

      const alive = enemies.some(e => e.active);
      if (!alive) onWaveCleared();
    }

    function hitPlayer(_source) {
      if (!player.active) return;
      if (invulnerabilityTimer > 0) return;

      lives -= 1;
      player.active = false;
      playerState = PLAYER_STATE.DYING;

      respawnTimer = RESPAWN_DELAY;
      invulnerabilityTimer = 0; // will be set on respawn if lives remain
    }

    function updatePlayerState(deltaMs, mask) {
      if (invulnerabilityTimer > 0) invulnerabilityTimer -= deltaMs;

      if (playerState === PLAYER_STATE.PLAYING) {
        player.vx = 0;
        const left = (mask & POHP_INPUT_BITS.left) !== 0;
        const right = (mask & POHP_INPUT_BITS.right) !== 0;
        const shoot = (mask & POHP_INPUT_BITS.shoot) !== 0;
        const shootJust = shoot && ((prevMask & POHP_INPUT_BITS.shoot) === 0);

        if (left && player.x > 0) player.vx = -PLAYER_SPEED;
        else if (right && player.x < SCREEN_W) player.vx = PLAYER_SPEED;

        if (shootCooldown > 0) shootCooldown -= deltaMs;
        if (shootJust && shootCooldown <= 0) {
          shootPlayerBullet();
          shootCooldown = 130;
        }
      } else if (playerState === PLAYER_STATE.DYING) {
        respawnTimer -= deltaMs;
        if (respawnTimer <= 0) {
          if (lives > 0) {
            player.active = true;
            player.x = 400;
            player.y = 550;
            player.vx = 0;
            invulnerabilityTimer = INVULN_DURATION;
            playerState = PLAYER_STATE.PLAYING;
          } else {
            playerState = PLAYER_STATE.GAME_OVER;
          }
        }
      }
    }

    function updateEnemyFormation(deltaMs) {
      const dt = deltaMs / 1000;

      // formation-only enemies
      const formation = enemies.filter(e => e.active && e.state === "formation");
      if (formation.length === 0) return;

      const aliveRatio = aliveRatioNow();
      const speedMul = RS?.waveSpeedMul ? RS.waveSpeedMul(wave) : 1;
      const thinMul = RS?.thinSpeedMul ? RS.thinSpeedMul(aliveRatio) : 1;

      formationMoveAcc += enemyDirection * enemySpeedBase * speedMul * thinMul * dt;

      const step = Math.trunc(formationMoveAcc);
      if (step !== 0) {
        for (const e of formation) e.x += step;
        formationMoveAcc -= step;
      }

      // sway (pure sinus)
      formationSwayMs += deltaMs;
      const swayNow = RS?.formationSwayOffsetPx ? RS.formationSwayOffsetPx(wave, formationSwayMs) : 0;
      const swayDx = swayNow - formationSwayPrev;
      if (swayDx !== 0) {
        for (const e of formation) e.x += swayDx;
        formationSwayPrev = swayNow;
      }

      // bounds + step down
      let minX = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const e of formation) {
        if (e.x < minX) minX = e.x;
        if (e.x > maxX) maxX = e.x;
        if (e.y > maxY) maxY = e.y;
      }

      const L = RS?.FORMATION_HARD_BOUND_L ?? 40;
      const R = RS?.FORMATION_HARD_BOUND_R ?? 760;

      const stepDown = RS?.FORMATION_STEP_DOWN ?? 8;
      const maxLowest = RS?.FORMATION_LOWEST_Y_MAX ?? 320;

      let bounced = false;
      if (enemyDirection > 0 && maxX > R) { enemyDirection = -1; bounced = true; }
      else if (enemyDirection < 0 && minX < L) { enemyDirection = 1; bounced = true; }

      if (bounced) {
        const dy = (maxY + stepDown > maxLowest) ? Math.max(0, maxLowest - maxY) : stepDown;
        if (dy > 0) for (const e of formation) e.y += dy;
      }
    }

    function maybeStartEnemyDive() {
      const formation = enemies.filter(e => e.active && e.state === "formation");
      if (formation.length === 0) return;

      const divingCount = enemies.filter(e => e.active && e.state === "diveLoop").length;
      const maxDivers = RS?.maxDiversNow ? RS.maxDiversNow(wave) : 3;
      if (divingCount >= maxDivers) return;

      const p = enemyDiveBaseChance;
      if (grFloat() >= p) return;

      const e = formation[grBetween(0, formation.length - 1)];
      e.state = "diveLoop";
      e.loopT = 0;
      e.offscreenMs = 0;

      // minimal dive shooting budget (approx of main)
      const baseShots = (wave <= 2) ? 2 : (wave <= 4) ? 3 : (wave <= 7) ? 4 : 5;
      let shots = baseShots;
      if (e.type === "blue") shots = Math.max(1, baseShots - 1);
      else if (e.type === "red") shots = baseShots + (wave >= 4 ? 1 : 0);
      else if (e.type === "flagship") shots = baseShots + (wave >= 3 ? 2 : 1);
      e.diveShotsLeft = clamp(shots, 1, 7);

      const initCdMin = Math.max(110, 240 - (wave - 1) * 6);
      const initCdMax = Math.max(initCdMin + 90, 460 - (wave - 1) * 8);
      e.shotCdMs = grBetween(initCdMin, initCdMax);

      const targetX = clamp(player.x + grBetween(-140, 140), 40, 760);
      e.diveTargetX = targetX;
    }

    function updateDivingEnemies(deltaMs) {
      const dt = deltaMs / 1000;

      for (const e of enemies) {
        if (!e.active) continue;

        if (e.state === "diveLoop") {
          e.loopT += deltaMs;
          e.offscreenMs += deltaMs;
          e.shotCdMs = Math.max(0, (e.shotCdMs || 0) - deltaMs);

          // simple dive: move down + drift towards targetX
          const downSpeed = 120 + Math.min(120, (wave - 1) * 8);
          e.y += downSpeed * dt;

          const dx = e.diveTargetX - e.x;
          e.x += clamp(dx, -160 * dt, 160 * dt);

          // if passed bottom, return
          if (e.y > 640) {
            e.state = "returning";
            e.y = -40;
          }
        } else if (e.state === "returning") {
          // go back to homeY, then snap to formation
          const dy = e.homeY - e.y;
          e.y += clamp(dy, -260 * dt, 260 * dt);
          const dx = e.homeX - e.x;
          e.x += clamp(dx, -260 * dt, 260 * dt);

          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            e.x = e.homeX;
            e.y = e.homeY;
            e.state = "formation";
            e.offscreenMs = 0;
          }
        }
      }
    }

    let enemyFireCooldownMs = 0;

    function enemyShooting(deltaMs) {
      enemyFireCooldownMs = Math.max(0, enemyFireCooldownMs - deltaMs);

      const aliveRatio = aliveRatioNow();
      const rateMul = RS?.waveRateMul ? RS.waveRateMul(wave) : 1;
      const thinRate = RS?.thinRateMul ? RS.thinRateMul(aliveRatio) : 1;

      // Divers (limited)
      const divers = enemies.filter(e => e.active && e.state === "diveLoop");
      if (divers.length > 0 && enemyFireCooldownMs <= 0) {
        const ready = divers.filter(e => (e.shotCdMs || 0) <= 0 && (e.diveShotsLeft || 0) > 0);
        if (ready.length > 0) {
          const shooter = ready[grBetween(0, ready.length - 1)];
          if (shootEnemyBullet(shooter.x, shooter.y)) {
            shooter.diveShotsLeft -= 1;
            shooter.shotCdMs = grBetween(260, 520);
            enemyFireCooldownMs = grBetween(180, 360);
            return;
          }
        }
      }

      // Formation fire (simple but deterministic)
      if (enemyFireCooldownMs <= 0) {
        const formation = enemies.filter(e => e.active && e.state === "formation");
        if (formation.length > 0) {
          const p = (enemyBulletBaseChance * rateMul * thinRate) * 70; // scaled for ms-tick
          if (grFloat() < clamp(p, 0, 0.22)) {
            const shooter = formation[grBetween(0, formation.length - 1)];
            if (shootEnemyBullet(shooter.x, shooter.y)) {
              const gMin = Math.max(220, 720 - (wave - 1) * 10);
              const gMax = Math.max(320, 980 - (wave - 1) * 12);
              enemyFireCooldownMs = grBetween(gMin, gMax);
              return;
            }
          }
        }
        enemyFireCooldownMs = 20 + grBetween(0, 40);
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

    function collisionsStep() {
      const pHalfW = (sprite.ship.w * sprite.ship.scale) / 2;
      const pHalfH = (sprite.ship.h * sprite.ship.scale) / 2;

      const enemyHalf = {};
      for (const k of ["enemy_blue", "enemy_red", "enemy_purple", "enemy_flagship"]) {
        enemyHalf[k] = { halfW: (sprite[k].w * sprite[k].scale) / 2, halfH: (sprite[k].h * sprite[k].scale) / 2 };
      }

      const pbMul = RS?.BULLET_HITBOX?.player ?? { wMul: 0.55, hMul: 0.90 };
      const ebMul = RS?.BULLET_HITBOX?.enemy ?? { wMul: 0.65, hMul: 0.92 };

      const pbHalfW = ((sprite.bullet_player.w * sprite.bullet_player.scale) * pbMul.wMul) / 2;
      const pbHalfH = ((sprite.bullet_player.h * sprite.bullet_player.scale) * pbMul.hMul) / 2;

      const ebHalfW = ((sprite.bullet_enemy.w * sprite.bullet_enemy.scale) * ebMul.wMul) / 2;
      const ebHalfH = ((sprite.bullet_enemy.h * sprite.bullet_enemy.scale) * ebMul.hMul) / 2;

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
          if (aabbOverlap(pBox, makeAABB(b.x, b.y, ebHalfW, ebHalfH))) { disableBullet(b); hitPlayer(b); break; }
        }
        for (const e of enemies) {
          if (!e.active) continue;
          const half = enemyHalf[e.key] || { halfW: 10, halfH: 10 };
          if (aabbOverlap(pBox, makeAABB(e.x, e.y, half.halfW, half.halfH))) { hitPlayer(e); break; }
        }
      }
    }

    // init formation
    createEnemyFormation();

    // main loop
    for (let i = 0; i < frames; i++) {
      const deltaMs = deltas[i];
      const mask = masks[i];

      physicsStep(deltaMs);
      collisionsStep();

      if (respawnTimer > 0) respawnTimer -= deltaMs;
      if (invulnerabilityTimer > 0) invulnerabilityTimer -= deltaMs;

      if (waveSpawnTimer > 0) {
        waveSpawnTimer -= deltaMs;
        if (waveSpawnTimer <= 0) createEnemyFormation();
      }

      if (playerState === PLAYER_STATE.GAME_OVER) break;

      updatePlayerState(deltaMs, mask);

      updateEnemyFormation(deltaMs);
      maybeStartEnemyDive();
      updateDivingEnemies(deltaMs);

      enemyShooting(deltaMs);
      cleanupBullets();

      prevMask = mask;
    }

    return {
      ok: true,
      score,
      wave,
      lives,
      ended: playerState === PLAYER_STATE.GAME_OVER,
      frames,
      totalMs: deltas.slice(0, frames).reduce((a, b) => a + b, 0),
      assetsDirUsed: assetsDir,
      ruleset: RS?.RULESET_VERSION ?? "(no_ruleset)",
    };
  } catch (e) {
    return { ok: false, err: String(e?.message || e) };
  }
}

module.exports = { simulateRunPackage };
