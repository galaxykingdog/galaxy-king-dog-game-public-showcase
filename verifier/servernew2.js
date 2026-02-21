// verifier/server.js
// Local PoHP Verifier API (Gate D enabled)
// - GET /health
// - POST /verify
//
// Dev-friendly defaults:
// - If fee_lamports == 0, entry_sig is NOT required.
// - Set REQUIRE_ENTRY_SIG=1 in .env to force entry_sig always.
// - Set SUBMIT_ONCHAIN=1 in .env if you later want to submit a Memo tx on Solana (devnet).

require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nacl = require("tweetnacl");

let solanaWeb3 = null;
try {
  solanaWeb3 = require("@solana/web3.js");
} catch (e) {
  // It's OK for local hashing + Gate D simulation, but entry-tx verify / on-chain submit will be unavailable.
  solanaWeb3 = null;
}

const { simulateRunPackage } = require("./sim/core.js");

function asInt(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

function sha256Hex(s) {
  return crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
}

function buildReplayMaterial(body) {
  // MUST match client key order
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
  // MUST match client join("|") format
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

const PORT = asInt(process.env.PORT, 8787);
const ASSETS_DIR = process.env.ASSETS_DIR ? path.resolve(__dirname, process.env.ASSETS_DIR) : undefined;
const POOL_RECIPIENT = String(process.env.POOL_RECIPIENT || "");
const CLUSTER = String(process.env.CLUSTER || "devnet");
const REQUIRE_ENTRY_SIG = String(process.env.REQUIRE_ENTRY_SIG || "0") === "1";
const SUBMIT_ONCHAIN = String(process.env.SUBMIT_ONCHAIN || "0") === "1";
const RPC_URL = String(process.env.RPC_URL || (solanaWeb3 ? solanaWeb3.clusterApiUrl(CLUSTER) : ""));

if (!POOL_RECIPIENT) {
  console.error("Missing POOL_RECIPIENT in .env");
  process.exit(1);
}

const app = express();

const corsOptions = {
  origin: ["http://127.0.0.1:8000", "http://localhost:8000"],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "12mb" }));

process.on("unhandledRejection", (e) => {
  console.error("unhandledRejection:", e);
});
process.on("uncaughtException", (e) => {
  console.error("uncaughtException:", e);
});

const VERIFIER = solanaWeb3 ? solanaWeb3.Keypair.generate() : null;
const SUBMITTER = solanaWeb3 ? solanaWeb3.Keypair.generate() : null;

function getConnection() {
  if (!solanaWeb3) throw new Error("Solana web3 not available");
  const url = RPC_URL && RPC_URL.length ? RPC_URL : solanaWeb3.clusterApiUrl(CLUSTER);
  return new solanaWeb3.Connection(url, "confirmed");
}

async function verifyEntryTx({ entry_sig, player_pubkey, minLamports, poolRecipient }) {
  if (!solanaWeb3) throw new Error("Solana web3 not available (cannot verify entry tx)");
  const connection = getConnection();

  // parsed transaction is easiest to validate transfer
  const parsed = await connection.getParsedTransaction(entry_sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (!parsed) throw new Error("Entry tx not found / not confirmed yet");

  const from = String(player_pubkey);
  const to = String(poolRecipient);
  const want = Number(minLamports);

  const ixList = (parsed.transaction?.message?.instructions || []);
  let ok = false;

  for (const ix of ixList) {
    // Parsed instructions often come as { program: "system", parsed: { type, info } }
    const p = ix?.parsed;
    if (!p) continue;
    if (p.type !== "transfer" && p.type !== "transferChecked") continue;
    const info = p.info || {};
    const src = String(info.source || info.from || "");
    const dst = String(info.destination || info.to || "");
    const lamports = Number(info.lamports || 0);
    if (src === from && dst === to && lamports >= want) {
      ok = true;
      break;
    }
  }

  if (!ok) throw new Error("Entry tx does not contain a matching transfer to poolRecipient");

  return { slot: parsed.slot || 0 };
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    cluster: CLUSTER,
    rpcUrl: RPC_URL || (solanaWeb3 ? solanaWeb3.clusterApiUrl(CLUSTER) : ""),
    poolRecipient: POOL_RECIPIENT,
    verifier_pubkey: VERIFIER ? VERIFIER.publicKey.toBase58() : "NO_SOLANA_WEB3",
    submitter_pubkey: SUBMITTER ? SUBMITTER.publicKey.toBase58() : "NO_SOLANA_WEB3",
    gateD: true,
    requireEntrySig: REQUIRE_ENTRY_SIG,
    submitOnchain: SUBMIT_ONCHAIN,
  });
});

app.post("/verify", async (req, res) => {
  try {
    const body = req.body || {};

    const game_id = String(body.game_id || "");
    const player_pubkey = String(body.player_pubkey || "");
    const fee_lamports = asInt(body.fee_lamports, 0);
    const entry_sig = String(body.entry_sig || "");
    const client_run_hash = String(body.run_hash || "");
    const client_replay_hash = String(body.replay_hash || "");

    if (!game_id || !player_pubkey || !client_run_hash || !client_replay_hash) {
      throw new Error("Missing required fields (game_id/player_pubkey/run_hash/replay_hash).");
    }

    if ((REQUIRE_ENTRY_SIG || fee_lamports > 0) && !entry_sig) {
      throw new Error("Missing entry_sig (required when fee_lamports>0 or REQUIRE_ENTRY_SIG=1).");
    }

    // Gate A/B: local hash validation
    const replayMaterial = buildReplayMaterial(body);
    const replay_hash = sha256Hex(replayMaterial);

    if (replay_hash !== client_replay_hash) {
      throw new Error(`Replay hash mismatch (computed=${replay_hash} client=${client_replay_hash}).`);
    }

    const runMaterial = buildRunMaterial(body, replay_hash);
    const run_hash = sha256Hex(runMaterial);

    if (run_hash !== client_run_hash) {
      throw new Error(`Run hash mismatch (computed=${run_hash} client=${client_run_hash}).`);
    }

    // Entry tx verify (optional in dev)
    let txInfo = { slot: asInt(body.entry_slot, 0) };
    if (entry_sig && fee_lamports > 0) {
      txInfo = await verifyEntryTx({
        entry_sig,
        player_pubkey,
        minLamports: fee_lamports,
        poolRecipient: POOL_RECIPIENT,
      });
    }

    // Gate D: deterministic resimulation
    const sim = simulateRunPackage(body, { assetsDir: ASSETS_DIR });
    if (!sim || sim.ok === false) {
      throw new Error(`Gate D failed: ${sim && sim.err ? sim.err : "resim_failed"}`);
    }

    const claimedScore = asInt(body.final_score, 0);
    const claimedWave = asInt(body.final_wave, 0);

    if (sim.score !== claimedScore || sim.wave !== claimedWave) {
      throw new Error(`Gate D mismatch: resim score/wave=${sim.score}/${sim.wave} but claimed=${claimedScore}/${claimedWave}`);
    }

    // Build memo-like payload + local verifier signature (dev-friendly)
    const memoText = [
      "GKD",
      "v1",
      `run=${run_hash}`,
      `replay=${replay_hash}`,
      `season=${asInt(body.season_id, 0)}`,
      `fee=${fee_lamports}`,
      `score=${claimedScore}`,
      `wave=${claimedWave}`,
      `entry=${entry_sig || "none"}`,
      `slot=${txInfo.slot || 0}`,
      `verifier=${VERIFIER ? VERIFIER.publicKey.toBase58() : "NO_SOLANA_WEB3"}`,
    ].join("|");

    const bytes = Buffer.from(memoText, "utf8");
    if (bytes.length > 450) throw new Error("memoText too long (max 450 bytes).");

    let verifier_sig_b64 = "";
    if (VERIFIER) {
      const sig = nacl.sign.detached(new Uint8Array(bytes), VERIFIER.secretKey);
      verifier_sig_b64 = Buffer.from(sig).toString("base64");
    }

    // (Optional) Later: submit on-chain memo tx (devnet)
    // Disabled by default to avoid needing SOL in submitter wallet.
    // If you enable it, ensure SUBMITTER has devnet SOL.
    let submit_sig = "";
    if (SUBMIT_ONCHAIN) {
      if (!solanaWeb3) throw new Error("SUBMIT_ONCHAIN=1 but Solana web3 not available");
      const { Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction } = solanaWeb3;
      const connection = getConnection();
      const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      const ix = new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [{ pubkey: SUBMITTER.publicKey, isSigner: true, isWritable: false }],
        data: bytes,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = SUBMITTER.publicKey;

      submit_sig = await sendAndConfirmTransaction(connection, tx, [SUBMITTER], { commitment: "confirmed" });
    }

    res.json({
      ok: true,
      run_hash,
      replay_hash,
      memoText,
      verifier_pubkey: VERIFIER ? VERIFIER.publicKey.toBase58() : "NO_SOLANA_WEB3",
      verifier_sig_b64,
      submit_sig,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

app.listen(PORT, () => {
  console.log(`Verifier listening on http://127.0.0.1:${PORT}`);
  console.log(`Verifier pubkey: ${VERIFIER ? VERIFIER.publicKey.toBase58() : "NO_SOLANA_WEB3"}`);
});
