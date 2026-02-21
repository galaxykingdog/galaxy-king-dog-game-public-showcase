// verifier/server.js
// Force .env values to win over inherited shell env vars.
// This prevents stale PowerShell Env:POOL_RECIPIENT from breaking verification.
require("dotenv").config({ override: true });

const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const {
  Connection,
  clusterApiUrl,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");

// === Gate D (Deterministic Replay Re-Simulation) ===
// Requires: verifier/sim/core.js  (module.exports = { simulateRunPackage })
const { simulateRunPackage } = require("./sim/core");

const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" }));

// --- config ---
const CLUSTER = (process.env.CLUSTER || "devnet").trim();
const RPC_URL = (process.env.RPC_URL || "").trim() || clusterApiUrl(CLUSTER);
const POOL_RECIPIENT = (process.env.POOL_RECIPIENT || "").trim();
const EXPECTED_GAME_ID = (process.env.EXPECTED_GAME_ID || "").trim();
const GATE_D_MODE_RAW = (process.env.GATE_D_MODE || "warn").trim().toLowerCase();
const GATE_D_MODE = ["strict", "warn", "off"].includes(GATE_D_MODE_RAW) ? GATE_D_MODE_RAW : "warn";
const RUN_TICKET_TTL_MS = Math.max(60_000, asInt(process.env.RUN_TICKET_TTL_MS, 20 * 60 * 1000));
const ALLOW_LEGACY_NO_TICKET = String(process.env.ALLOW_LEGACY_NO_TICKET || "true").trim().toLowerCase() !== "false";

if (!POOL_RECIPIENT) {
  console.error("Missing POOL_RECIPIENT in .env");
  process.exit(1);
}

const connection = new Connection(RPC_URL, "confirmed");
const RUN_TICKETS = new Map();
const VERIFIED_RUNS = new Map();

// --- helpers ---
function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

function asInt(n, def = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : def;
}

function loadVerifierKeypair() {
  const b64 = (process.env.VERIFIER_SECRET_KEY_B64 || "").trim();
  if (b64) {
    const u8 = Uint8Array.from(Buffer.from(b64, "base64"));
    return Keypair.fromSecretKey(u8);
  }

  // fallback: ephemeral dev key (OK for devnet, όχι για mainnet)
  const kp = Keypair.generate();
  console.log("⚠️ No VERIFIER_SECRET_KEY_B64 set. Generated ephemeral verifier key (dev only).");
  console.log("Verifier pubkey:", kp.publicKey.toBase58());
  console.log("To persist, set VERIFIER_SECRET_KEY_B64 to:");
  console.log(Buffer.from(kp.secretKey).toString("base64"));
  return kp;
}

const VERIFIER = loadVerifierKeypair();

// --- submit (Memo program) ---
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

function loadSubmitterKeypair(fallbackKp) {
  const b64 = (process.env.SUBMITTER_SECRET_KEY_B64 || "").trim();
  if (b64) {
    const u8 = Uint8Array.from(Buffer.from(b64, "base64"));
    return Keypair.fromSecretKey(u8);
  }
  console.log("⚠️ No SUBMITTER_SECRET_KEY_B64 set. Using VERIFIER as submitter (dev only).");
  return fallbackKp; // dev-only fallback
}

const SUBMITTER = loadSubmitterKeypair(VERIFIER);

async function verifyEntryTx({ entry_sig, player_pubkey, minLamports, poolRecipient }) {
  const tx = await connection.getParsedTransaction(entry_sig, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  if (!tx) throw new Error("Entry tx not found on cluster/RPC yet (try again in a moment).");
  if (tx.meta && tx.meta.err) throw new Error("Entry tx has error (meta.err not null).");

  const ixs = (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) || [];
  let ok = false;

  for (const ix of ixs) {
    if (ix.program === "system" && ix.parsed && ix.parsed.type === "transfer") {
      const info = ix.parsed.info || {};
      const src = String(info.source || "");
      const dst = String(info.destination || "");
      const lamports = asInt(info.lamports, -1);

      if (src === player_pubkey && dst === poolRecipient && lamports >= minLamports) {
        ok = true;
        break;
      }
    }
  }

  if (!ok) {
    throw new Error("Entry tx does not contain required SystemProgram transfer (source/dest/lamports).");
  }

  return { slot: tx.slot };
}

function buildReplayMaterial(body) {
  // ΠΡΟΣΟΧΗ: κρατάμε ίδιο key order όπως στο client
  const schema = asInt(body.schema, 0);
  const replayObj = {
    schema: asInt(body.schema, 0),
    game_id: String(body.game_id || ""),
    version_hash: String(body.version_hash || ""),
    seed: (asInt(body.seed, 0) >>> 0),
    masks_b64: String(body.masks_b64 || ""),
    deltas_b64: String(body.deltas_b64 || ""),
  };
  if (schema >= 2 || body.checkpoints_b64 || body.checkpoint_chain_final) {
    replayObj.checkpoints_b64 = String(body.checkpoints_b64 || "");
    replayObj.checkpoints_every_frames = asInt(body.checkpoints_every_frames, 0);
    replayObj.checkpoint_chain_final = String(body.checkpoint_chain_final || "");
  }
  return JSON.stringify(replayObj);
}

function buildRunMaterial(body, replay_hash, opts = {}) {
  // ίδιο join() format με client
  const legacy = !!opts.legacyNoTicket;
  const player_pubkey = String(body.player_pubkey || "");
  const game_id = String(body.game_id || "");
  const season_id = String(asInt(body.season_id, 0));
  const fee_lamports = String(asInt(body.fee_lamports, 0));
  const entry_sig = String(body.entry_sig || "");
  const entry_slot = String(asInt(body.entry_slot, 0));
  const run_ticket_id = String(body.run_ticket_id || "");
  const final_score = String(asInt(body.final_score, 0));
  const versionHash = String(body.version_hash || "");
  const parts = [
    player_pubkey,
    game_id,
    season_id,
    fee_lamports,
    entry_sig,
    entry_slot,
  ];
  if (!legacy) parts.push(run_ticket_id);
  parts.push(final_score, replay_hash, versionHash);
  return parts.join("|");
}

function signText(text) {
  const msg = Buffer.from(String(text), "utf8");
  const sig = nacl.sign.detached(msg, VERIFIER.secretKey);
  return Buffer.from(sig).toString("base64");
}

function makeRunTicket({ player_pubkey, entry_sig }) {
  const id = crypto.randomBytes(16).toString("hex");
  const issued_at = Date.now();
  const expires_at = issued_at + RUN_TICKET_TTL_MS;
  const rec = {
    id,
    player_pubkey: String(player_pubkey || ""),
    entry_sig: String(entry_sig || ""),
    issued_at,
    expires_at,
    used: false,
    used_at: 0,
  };
  RUN_TICKETS.set(id, rec);
  return rec;
}

function b64ToU16Len(b64) {
  const bytes = Buffer.from(String(b64 || ""), "base64");
  return Math.floor(bytes.length / 2);
}

function totalMsFromDeltasB64(deltas_b64) {
  const bytes = Buffer.from(String(deltas_b64 || ""), "base64");
  let sum = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const v = bytes[i] | (bytes[i + 1] << 8);
    sum += v;
  }
  return sum;
}

function validateRunPlausibility(body) {
  const masksLenField = asInt(body.masks_len, -1);
  const deltasLenField = asInt(body.deltas_len, -1);
  const masksLenB64 = Buffer.from(String(body.masks_b64 || ""), "base64").length;
  const deltasLenB64 = b64ToU16Len(body.deltas_b64);

  if (masksLenField < 1 || deltasLenField < 1) {
    throw new Error("Invalid stream lengths (masks_len/deltas_len).");
  }
  if (masksLenField !== deltasLenField) {
    throw new Error("Input streams length mismatch (masks_len != deltas_len).");
  }
  if (masksLenB64 !== masksLenField || deltasLenB64 !== deltasLenField) {
    throw new Error("Encoded streams length mismatch (b64 payload size != declared len).");
  }

  const totalMs = totalMsFromDeltasB64(body.deltas_b64);
  if (totalMs < 5000) throw new Error("Run too short.");
  if (totalMs > 45 * 60 * 1000) throw new Error("Run too long.");

  const startTs = Number(body.start_ts || 0);
  const endTs = Number(body.end_ts || 0);
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) {
    throw new Error("Invalid run timestamps (start_ts/end_ts).");
  }

  const wallMs = endTs - startTs;
  const driftMs = Math.abs(wallMs - totalMs);
  if (driftMs > 5000) {
    throw new Error(`Run timing drift too high (wall=${wallMs}ms replay=${totalMs}ms drift=${driftMs}ms).`);
  }

  const finalScore = asInt(body.final_score, 0);
  if (finalScore < 0) throw new Error("Invalid final_score.");
  if (finalScore > 1000000) throw new Error("final_score exceeds plausibility cap.");

  // Soft anti-cheat: very generous cap, blocks only obviously fabricated outliers.
  const scorePerSec = finalScore / Math.max(1, totalMs / 1000);
  if (scorePerSec > 450) {
    throw new Error(`Score rate too high (${scorePerSec.toFixed(2)} pts/s).`);
  }

  return { totalMs, wallMs, driftMs, scorePerSec };
}

function hash32(str) {
  let h = 0x811c9dc5 >>> 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function hex8(u32) {
  return (u32 >>> 0).toString(16).padStart(8, "0");
}

function validateCheckpointChain(body) {
  const schema = asInt(body.schema, 0);
  if (schema < 2) return { enabled: false, len: 0 };

  const cpB64 = String(body.checkpoints_b64 || "");
  const cpEvery = asInt(body.checkpoints_every_frames, 0);
  const cpFinal = String(body.checkpoint_chain_final || "").toLowerCase();
  const cpLen = asInt(body.checkpoints_len, -1);

  if (!cpB64 || cpEvery <= 0 || !cpFinal) {
    throw new Error("Missing checkpoint fields for schema v2.");
  }
  let arr = null;
  try {
    arr = JSON.parse(Buffer.from(cpB64, "base64").toString("utf8"));
  } catch (e) {
    throw new Error("Invalid checkpoints_b64 payload.");
  }
  if (!Array.isArray(arr) || arr.length < 1) throw new Error("Checkpoint list is empty.");
  if (cpLen >= 0 && cpLen !== arr.length) throw new Error("checkpoints_len mismatch.");

  let prev = "00000000";
  let lastFrame = -1;
  let lastScore = -1;
  let lastWave = 0;
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (!Array.isArray(c) || c.length < 4) throw new Error("Invalid checkpoint record.");
    const fr = asInt(c[0], -1);
    const sc = asInt(c[1], -1);
    const wv = asInt(c[2], -1);
    const lv = asInt(c[3], -1);
    if (fr <= lastFrame) throw new Error("Checkpoint frame order invalid.");
    if (sc < lastScore) throw new Error("Checkpoint score must be non-decreasing.");
    if (wv < 1 || wv < lastWave) throw new Error("Checkpoint wave order invalid.");
    if (lv < 0 || lv > 9) throw new Error("Checkpoint lives out of range.");

    const mat = prev + "|" + fr + "|" + sc + "|" + wv + "|" + lv;
    prev = hex8(hash32(mat));
    lastFrame = fr;
    lastScore = sc;
    lastWave = wv;
  }
  if (prev !== cpFinal) throw new Error("checkpoint_chain_final mismatch.");

  const claimedScore = asInt(body.final_score, 0);
  const claimedWave = asInt(body.final_wave, 0);
  const last = arr[arr.length - 1];
  if (asInt(last[1], -1) !== claimedScore || asInt(last[2], -1) !== claimedWave) {
    throw new Error("Final checkpoint does not match claimed final score/wave.");
  }

  return { enabled: true, len: arr.length, every: cpEvery, final: cpFinal };
}

// --- routes ---
app.get("/favicon.ico", (req, res) => res.status(204).end());

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    cluster: CLUSTER,
    rpcUrl: RPC_URL,
    poolRecipient: POOL_RECIPIENT,
    verifier_pubkey: VERIFIER.publicKey.toBase58(),
    submitter_pubkey: SUBMITTER.publicKey.toBase58(),
    gateD: {
      enabled: GATE_D_MODE !== "off",
      mode: GATE_D_MODE,
    },
    run_ticket_ttl_ms: RUN_TICKET_TTL_MS,
    allow_legacy_no_ticket: ALLOW_LEGACY_NO_TICKET,
    tickets_cached: RUN_TICKETS.size,
    verified_cache: VERIFIED_RUNS.size,
  });
});

app.post("/ticket", async (req, res) => {
  try {
    const body = req.body || {};
    const player_pubkey = String(body.player_pubkey || "");
    const entry_sig = String(body.entry_sig || "");
    if (!player_pubkey || !entry_sig) {
      throw new Error("Missing required fields (player_pubkey/entry_sig).");
    }
    new PublicKey(player_pubkey);
    if (entry_sig.length < 20) throw new Error("Invalid entry_sig.");

    const t = makeRunTicket({ player_pubkey, entry_sig });
    const ticket_sig = signText(`GKD|ticket|${t.id}|${t.player_pubkey}|${t.entry_sig}|${t.issued_at}|${t.expires_at}`);
    res.json({
      ok: true,
      run_ticket_id: t.id,
      issued_at: t.issued_at,
      expires_at: t.expires_at,
      verifier_pubkey: VERIFIER.publicKey.toBase58(),
      ticket_sig,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/verify", async (req, res) => {
  try {
    const body = req.body || {};

    // basic required fields
    const game_id = String(body.game_id || "");
    const player_pubkey = String(body.player_pubkey || "");
    const entry_sig = String(body.entry_sig || "");
    const fee_lamports = asInt(body.fee_lamports, 0);
    const run_ticket_id = String(body.run_ticket_id || "");
    const client_run_hash = String(body.run_hash || "");
    const client_replay_hash = String(body.replay_hash || "");

    if (!game_id || !player_pubkey || !entry_sig || !client_run_hash || !client_replay_hash) {
      throw new Error("Missing required fields (game_id/player_pubkey/entry_sig/run_hash/replay_hash).");
    }

    if (EXPECTED_GAME_ID && game_id !== EXPECTED_GAME_ID) {
      throw new Error("Unexpected game_id.");
    }

    // verify pubkeys parse
    new PublicKey(player_pubkey);
    new PublicKey(POOL_RECIPIENT);

    // 1) integrity: version_hash consistency (weak check but useful)
    const computedVersionHash = sha256Hex(String(body.game_version || ""));
    if (String(body.version_hash || "") !== computedVersionHash) {
      throw new Error("version_hash mismatch (server recompute != client version_hash).");
    }

    // 2) integrity: replay_hash
    const replayMaterial = buildReplayMaterial(body);
    const replay_hash = sha256Hex(replayMaterial);
    if (replay_hash !== client_replay_hash) {
      throw new Error("replay_hash mismatch.");
    }

    // 3) integrity: run_hash (ticket-aware with optional legacy fallback)
    let run_hash = sha256Hex(buildRunMaterial(body, replay_hash));
    let legacy_no_ticket = false;
    if (run_hash !== client_run_hash) {
      if (!run_ticket_id && ALLOW_LEGACY_NO_TICKET) {
        const legacyHash = sha256Hex(buildRunMaterial(body, replay_hash, { legacyNoTicket: true }));
        if (legacyHash === client_run_hash) {
          run_hash = legacyHash;
          legacy_no_ticket = true;
        } else {
          throw new Error("run_hash mismatch.");
        }
      } else {
        throw new Error("run_hash mismatch.");
      }
    }

    // Idempotent verify: same immutable run_hash gets same result without consuming a new ticket.
    const cached = VERIFIED_RUNS.get(run_hash);
    if (cached) {
      return res.json({ ...cached, verify_cached: true });
    }

    // 3.25) run ticket must be valid and one-time (unless legacy mode is allowed)
    let ticket = null;
    if (run_ticket_id) {
      ticket = RUN_TICKETS.get(run_ticket_id);
      if (!ticket) throw new Error("Unknown run ticket.");
      if (ticket.used) throw new Error("Run ticket already used.");
      if (Date.now() > ticket.expires_at) throw new Error("Run ticket expired.");
      if (ticket.player_pubkey !== player_pubkey) throw new Error("Run ticket player mismatch.");
      if (ticket.entry_sig !== entry_sig) throw new Error("Run ticket entry mismatch.");
    } else if (!ALLOW_LEGACY_NO_TICKET) {
      throw new Error("Missing run_ticket_id.");
    }

    // 3.5) anti-cheat plausibility gate (independent from Gate D parity)
    const plausibility = validateRunPlausibility(body);
    const checkpoints = validateCheckpointChain(body);

    // 4) verify entry fee tx on Solana
    const txInfo = await verifyEntryTx({
      entry_sig,
      player_pubkey,
      minLamports: fee_lamports,
      poolRecipient: POOL_RECIPIENT,
    });

    const claimedScore = asInt(body.final_score, 0);
    const claimedWave = asInt(body.final_wave, 0);
    let sim = null;
    let gateDStatus = "skipped";
    let gateDWarning = "";

    // 5) Gate D: deterministic verification policy by mode.
    // For schema v2 we can close deterministically from checkpoint chain parity;
    // headless re-sim remains informative telemetry.
    if (GATE_D_MODE !== "off") {
      if (checkpoints.enabled) {
        gateDStatus = "pass_checkpoint_v2";
        sim = simulateRunPackage(body, {
          assetsDir: process.env.ASSETS_DIR
            ? path.resolve(__dirname, process.env.ASSETS_DIR)
            : undefined,
        });
        if (!sim || sim.ok === false) {
          const simErr = sim && (sim.error || sim.err);
          gateDWarning = `Checkpoint parity pass; headless resim failed (${simErr || "resim_failed"}).`;
        } else if (sim.score !== claimedScore || sim.wave !== claimedWave) {
          gateDWarning = `Checkpoint parity pass; headless resim mismatch=${sim.score}/${sim.wave} claimed=${claimedScore}/${claimedWave}.`;
        }
      } else {
        sim = simulateRunPackage(body, {
          assetsDir: process.env.ASSETS_DIR
            ? path.resolve(__dirname, process.env.ASSETS_DIR)
            : undefined,
        });

        if (!sim || sim.ok === false) {
          const simErr = sim && (sim.error || sim.err);
          if (GATE_D_MODE === "strict") {
            throw new Error(`Gate D failed: ${simErr || "resim_failed"}`);
          }
          gateDStatus = "failed";
          gateDWarning = `Gate D failed: ${simErr || "resim_failed"}`;
        } else if (sim.score !== claimedScore || sim.wave !== claimedWave) {
          const mismatch = `Gate D mismatch: resim score/wave=${sim.score}/${sim.wave} but claimed=${claimedScore}/${claimedWave}`;
          if (GATE_D_MODE === "strict") {
            throw new Error(mismatch);
          }
          gateDStatus = "mismatch";
          gateDWarning = mismatch;
        } else {
          gateDStatus = "pass";
        }
      }
    }

    const scoreConfirmedDeterministically = (gateDStatus === "pass" || gateDStatus === "pass_checkpoint_v2");
    let scoreVerificationLevel = "claimed_score_integrity_only";
    if (gateDStatus === "pass") scoreVerificationLevel = "deterministic_replay_match";
    if (gateDStatus === "pass_checkpoint_v2") scoreVerificationLevel = "checkpoint_chain_v2_match";
    const seasonVerificationTier = scoreConfirmedDeterministically ? "verified" : "provisional";
    const seasonRewardEligible = scoreConfirmedDeterministically;

    // 6) build memo + signature
    const memoText = [
      "GKD",
      "v1",
      `run=${run_hash}`,
      `replay=${replay_hash}`,
      `season=${asInt(body.season_id, 0)}`,
      `fee=${fee_lamports}`,
      `score=${claimedScore}`,
      `entry=${entry_sig}`,
      `slot=${txInfo.slot}`,
      `verifier=${VERIFIER.publicKey.toBase58()}`,
    ].join("|");

    const verifier_sig = signText(memoText);
    if (ticket) {
      ticket.used = true;
      ticket.used_at = Date.now();
    }

    const payload = {
      ok: true,
      cluster: CLUSTER,
      verifier_pubkey: VERIFIER.publicKey.toBase58(),
      verifier_sig,
      memoText,
      gate_d_mode: GATE_D_MODE,
      gate_d_status: gateDStatus,
      gate_d_warning: gateDWarning || undefined,
      final_score_claimed: claimedScore,
      final_wave_claimed: claimedWave,
      score_confirmed: scoreConfirmedDeterministically,
      score_verification_level: scoreVerificationLevel,
      season_verification_tier: seasonVerificationTier,
      season_reward_eligible: seasonRewardEligible,
      observed_entry_slot: txInfo.slot,
      run_hash,
      replay_hash,
      legacy_no_ticket,
      run_ticket_id: run_ticket_id || undefined,
      plausibility_total_ms: plausibility.totalMs,
      plausibility_wall_ms: plausibility.wallMs,
      plausibility_drift_ms: plausibility.driftMs,
      plausibility_score_per_sec: Number(plausibility.scorePerSec.toFixed(3)),
      checkpoints_enabled: checkpoints.enabled,
      checkpoints_len: checkpoints.len,
      checkpoints_every_frames: checkpoints.every || undefined,
      // optional debug fields:
      resim_score: sim ? sim.score : undefined,
      resim_wave: sim ? sim.wave : undefined,
      resim_frames: sim ? (sim.frames || sim.frames_simulated) : undefined,
      resim_totalMs: sim ? sim.totalMs : undefined,
    };
    VERIFIED_RUNS.set(run_hash, payload);
    res.json(payload);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.post("/submit", async (req, res) => {
  try {
    const memoText = String((req.body || {}).memoText || "");
    if (!memoText) throw new Error("Missing memoText.");

    const bytes = Buffer.from(memoText, "utf8");
    if (bytes.length > 450) throw new Error("memoText too long (max 450 bytes).");
    if (!memoText.startsWith("GKD|v1|")) throw new Error("Invalid memoText prefix.");

    const ix = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: SUBMITTER.publicKey, isSigner: true, isWritable: false }],
      data: bytes,
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = SUBMITTER.publicKey;

    const sig = await sendAndConfirmTransaction(connection, tx, [SUBMITTER], {
      commitment: "confirmed",
    });

    res.json({
      ok: true,
      submit_sig: sig,
      submitter: SUBMITTER.publicKey.toBase58(),
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

const PORT = asInt(process.env.PORT, 8787);
app.listen(PORT, () => {
  console.log(`Verifier listening on http://127.0.0.1:${PORT}`);
});
