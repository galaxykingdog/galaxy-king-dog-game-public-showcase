// verifier/server.js
require("dotenv").config();

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

if (!POOL_RECIPIENT) {
  console.error("Missing POOL_RECIPIENT in .env");
  process.exit(1);
}

const connection = new Connection(RPC_URL, "confirmed");

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
  return JSON.stringify({
    schema: asInt(body.schema, 0),
    game_id: String(body.game_id || ""),
    version_hash: String(body.version_hash || ""),
    seed: (asInt(body.seed, 0) >>> 0),
    masks_b64: String(body.masks_b64 || ""),
    deltas_b64: String(body.deltas_b64 || ""),
  });
}

function buildRunMaterial(body, replay_hash) {
  // ίδιο join() format με client
  const player_pubkey = String(body.player_pubkey || "");
  const game_id = String(body.game_id || "");
  const season_id = String(asInt(body.season_id, 0));
  const fee_lamports = String(asInt(body.fee_lamports, 0));
  const entry_sig = String(body.entry_sig || "");
  const entry_slot = String(asInt(body.entry_slot, 0));
  const final_score = String(asInt(body.final_score, 0));
  const versionHash = String(body.version_hash || "");

  return [
    player_pubkey,
    game_id,
    season_id,
    fee_lamports,
    entry_sig,
    entry_slot,
    final_score,
    replay_hash,
    versionHash,
  ].join("|");
}

function signText(text) {
  const msg = Buffer.from(String(text), "utf8");
  const sig = nacl.sign.detached(msg, VERIFIER.secretKey);
  return Buffer.from(sig).toString("base64");
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
    gateD: true,
  });
});

app.post("/verify", async (req, res) => {
  try {
    const body = req.body || {};

    // basic required fields
    const game_id = String(body.game_id || "");
    const player_pubkey = String(body.player_pubkey || "");
    const entry_sig = String(body.entry_sig || "");
    const fee_lamports = asInt(body.fee_lamports, 0);
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

    // 3) integrity: run_hash
    const runMaterial = buildRunMaterial(body, replay_hash);
    const run_hash = sha256Hex(runMaterial);
    if (run_hash !== client_run_hash) {
      throw new Error("run_hash mismatch.");
    }

    // 4) verify entry fee tx on Solana
    const txInfo = await verifyEntryTx({
      entry_sig,
      player_pubkey,
      minLamports: fee_lamports,
      poolRecipient: POOL_RECIPIENT,
    });

    // 5) Gate D: deterministic re-simulation (real Proof-of-Play)
    const sim = simulateRunPackage(body, {
      assetsDir: process.env.ASSETS_DIR
        ? path.resolve(__dirname, process.env.ASSETS_DIR)
        : undefined,
    });

    if (!sim || sim.ok === false) {
      throw new Error(`Gate D failed: ${sim && sim.err ? sim.err : "resim_failed"}`);
    }

    const claimedScore = asInt(body.final_score, 0);
    const claimedWave = asInt(body.final_wave, 0);

    if (sim.score !== claimedScore || sim.wave !== claimedWave) {
      throw new Error(
        `Gate D mismatch: resim score/wave=${sim.score}/${sim.wave} but claimed=${claimedScore}/${claimedWave}`
      );
    }

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

    res.json({
      ok: true,
      cluster: CLUSTER,
      verifier_pubkey: VERIFIER.publicKey.toBase58(),
      verifier_sig,
      memoText,
      observed_entry_slot: txInfo.slot,
      run_hash,
      replay_hash,
      // optional debug fields:
      resim_score: sim.score,
      resim_wave: sim.wave,
      resim_frames: sim.frames,
      resim_totalMs: sim.totalMs,
    });
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
