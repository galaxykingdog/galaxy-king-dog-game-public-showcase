// src/chain/chain_client.js
// Front-end Chain Wiring (Step 1)
// - Wallet connect (Phantom)
// - Entry fee transfer (temporary recipient; Pool PDA later)
// - Feeds chain fields into the POHP runPackage builder (player_pubkey, fee_lamports, entry_sig, entry_slot)
// - (NEW) Verifier wiring: /verify + /submit (Gate C)

(function () {
  function $(id) { return document.getElementById(id); }

  const state = {
    connected: false,
    pubkey: "",
    lastEntrySig: "",
    lastEntrySlot: null,
    lastRunTicketId: "",

    lastVerify: null,
    lastSubmitSig: null,
  };

  function status(msg) {
    try {
      const el = $("chain-status");
      if (el) el.textContent = msg;
    } catch (_) {}
    try {
      if (typeof window.__CHAIN_STATUS_CB === "function") window.__CHAIN_STATUS_CB(msg);
    } catch (_) {}
  }

  function getConnection() {
    const rpc = (window.CHAIN && window.CHAIN.rpcUrl) ? window.CHAIN.rpcUrl : "";
    const url = rpc && rpc.length ? rpc : solanaWeb3.clusterApiUrl(window.CHAIN?.cluster || "devnet");
    return new solanaWeb3.Connection(url, "processed");
  }

  function getBackendCfg() {
    const cfg = window.CHAIN || {};
    return {
      ticketUrl: cfg.ticketUrl || "",
      verifyUrl: cfg.verifyUrl || "",
      submitUrl: cfg.submitUrl || "",
    };
  }

  async function postJSON(url, payload) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let j = null;
    try { j = await r.json(); } catch (_) {}

    if (!r.ok) {
      const msg = (j && (j.error || j.message)) ? (j.error || j.message) : ("HTTP " + r.status);
      throw new Error(msg);
    }
    return j;
  }

  async function connectWallet() {
    if (!window.solana || !window.solana.isPhantom) {
      status("CHAIN: Phantom wallet not found");
      return false;
    }
    try {
      status("CHAIN: connecting wallet…");
      const resp = await window.solana.connect();
      const pk = resp?.publicKey?.toString?.() || window.solana.publicKey?.toString?.() || "";
      if (!pk) {
        status("CHAIN: wallet connect failed");
        return false;
      }
      state.connected = true;
      state.pubkey = pk;
      status("CHAIN: connected " + pk.slice(0, 4) + "…" + pk.slice(-4));

      // Feed into POHP
      if (window.POHP && typeof window.POHP.setPlayerPubkey === "function") {
        window.POHP.setPlayerPubkey(pk);
      }
      return true;
    } catch (e) {
      status("CHAIN: wallet connect cancelled");
      return false;
    }
  }

  async function payEntryFee() {
    const cfg = window.CHAIN || {};
    const feeLamports = Number(cfg.feeLamports || 0);
    const recipient = cfg.poolRecipient;

    if (!feeLamports || feeLamports <= 0) {
      status("CHAIN: fee is not set");
      return null;
    }
    if (!recipient) {
      status("CHAIN: poolRecipient missing");
      return null;
    }
    if (!state.connected) {
      const ok = await connectWallet();
      if (!ok) return null;
    }

    try {
      const connection = getConnection();
      status("CHAIN: preparing entry tx…");

      const fromPubkey = new solanaWeb3.PublicKey(state.pubkey);
      const toPubkey = new solanaWeb3.PublicKey(recipient);

      const tx = new solanaWeb3.Transaction().add(
        solanaWeb3.SystemProgram.transfer({
          fromPubkey,
          toPubkey,
          lamports: feeLamports
        })
      );

      tx.feePayer = fromPubkey;
      const latest = await connection.getLatestBlockhash("processed");
      tx.recentBlockhash = latest.blockhash;

      status("CHAIN: sign & send entry fee…");

      // Phantom supports signAndSendTransaction
      let sig = null;
      if (typeof window.solana.signAndSendTransaction === "function") {
        const sent = await window.solana.signAndSendTransaction(tx);
        sig = sent?.signature || sent;
      } else {
        // fallback: signTransaction + sendRawTransaction
        const signed = await window.solana.signTransaction(tx);
        sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, preflightCommitment: "processed" });
      }

      if (!sig) {
        status("CHAIN: entry tx failed");
        return null;
      }

      status("CHAIN: confirming entry tx…");
      await connection.confirmTransaction(
        { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        "processed"
      );

      // Best-effort slot
      let slot = null;
      try {
        const st = await connection.getSignatureStatus(sig, { searchTransactionHistory: true });
        slot = st?.value?.slot ?? null;
      } catch (_) {}
      if (slot == null) {
        try {
          const txInfo = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
          slot = txInfo?.slot ?? null;
        } catch (_) {}
      }

      state.lastEntrySig = sig;
      state.lastEntrySlot = slot;

      status("CHAIN: entry paid ✓ " + sig.slice(0, 6) + "…" + sig.slice(-6));

      // Feed into POHP (so run_hash locks to fee+sig+slot)
      if (window.POHP && typeof window.POHP.setEntryProof === "function") {
        window.POHP.setEntryProof({
          fee_lamports: feeLamports,
          entry_sig: sig,
          entry_slot: slot
        });
      }

      return { sig, slot, feeLamports };
    } catch (e) {
      status("CHAIN: entry tx cancelled/failed");
      return null;
    }
  }

  async function ensureEntryPaid() {
    const cfg = window.CHAIN || {};
    if (!cfg.enabled) return true;

    // Always require wallet to be connected (binds run to wallet)
    if (!state.connected) {
      const ok = await connectWallet();
      if (!ok) return false;
    }

    // Always require a fresh entry payment for each run
    const entry = await payEntryFee();
    if (!entry) return false;

    const { ticketUrl } = getBackendCfg();
    if (!ticketUrl) {
      status("CHAIN: ticketUrl missing");
      return false;
    }

    try {
      status("CHAIN: requesting run ticket…");
      const t = await postJSON(ticketUrl, {
        player_pubkey: state.pubkey,
        entry_sig: state.lastEntrySig,
      });
      if (!t || t.ok !== true || !t.run_ticket_id) {
        throw new Error("ticket failed");
      }
      state.lastRunTicketId = String(t.run_ticket_id || "");
      if (window.POHP && typeof window.POHP.setRunTicket === "function") {
        window.POHP.setRunTicket({ run_ticket_id: state.lastRunTicketId });
      }
      status("CHAIN: run ticket ready");
      return true;
    } catch (e) {
      status("CHAIN: ticket request failed");
      return false;
    }
  }

  // =========================
  // NEW: verifier integration
  // =========================

  async function verifyRun(runPackage) {
    const { verifyUrl } = getBackendCfg();
    if (!verifyUrl) throw new Error("Missing CHAIN.verifyUrl");

    status("CHAIN: verifying…");
    let j = null;
    try {
      j = await postJSON(verifyUrl, runPackage);
    } catch (e) {
      // Back-compat fallback for older strict verifier builds:
      // if only Gate D mismatches, keep a non-confirmed "claimed" verdict instead of hard fail.
      const msg = String(e?.message || e || "");
      const isGateDMismatch = /Gate D (mismatch|failed)/i.test(msg);
      if (!isGateDMismatch) throw e;

      j = {
        ok: true,
        degraded: true,
        gate_d_mode: "legacy_strict_server",
        gate_d_status: /mismatch/i.test(msg) ? "mismatch" : "failed",
        gate_d_warning: msg,
        final_score_claimed: Number(runPackage?.final_score ?? 0),
        final_wave_claimed: Number(runPackage?.final_wave ?? 0),
        score_confirmed: false,
        score_verification_level: "claimed_score_integrity_only",
        season_verification_tier: "provisional",
        season_reward_eligible: false,
        run_hash: String(runPackage?.run_hash || ""),
        replay_hash: String(runPackage?.replay_hash || ""),
      };
    }

    if (!j || j.ok !== true) throw new Error(j?.error || "verify failed");

    state.lastVerify = j;
    try { localStorage.setItem("GKD_LAST_VERIFY", JSON.stringify(j)); } catch (_) {}
    const scoreConfirmed = !!j.score_confirmed;
    const scoreLabel = scoreConfirmed ? "score confirmed" : "score claimed";
    const scoreLine = "score " + String(j.final_score_claimed ?? runPackage?.final_score ?? 0) + " wave " + String(j.final_wave_claimed ?? runPackage?.final_wave ?? 0);
    const verdict = {
      verified_at: Date.now(),
      score: Number(j.final_score_claimed ?? runPackage?.final_score ?? 0),
      wave: Number(j.final_wave_claimed ?? runPackage?.final_wave ?? 0),
      score_confirmed: scoreConfirmed,
      score_verification_level: String(j.score_verification_level || ""),
      season_verification_tier: String(j.season_verification_tier || (scoreConfirmed ? "verified" : "provisional")),
      season_reward_eligible: !!j.season_reward_eligible,
      gate_d_mode: String(j.gate_d_mode || ""),
      gate_d_status: String(j.gate_d_status || ""),
      gate_d_warning: String(j.gate_d_warning || ""),
      run_hash: String(j.run_hash || ""),
      replay_hash: String(j.replay_hash || ""),
    };
    try { localStorage.setItem("GKD_LAST_SCORE_VERDICT", JSON.stringify(verdict)); } catch (_) {}
    try {
      if (typeof window.__CHAIN_VERIFY_CB === "function") window.__CHAIN_VERIFY_CB(verdict, j);
    } catch (_) {}

    status("CHAIN: verified ✅ (" + scoreLabel + ", " + scoreLine + ")");
    return j; // includes memoText, verifier_sig, observed_entry_slot, ...
  }

  async function submitMemo(memoText) {
    const { submitUrl } = getBackendCfg();
    if (!submitUrl) throw new Error("Missing CHAIN.submitUrl");

    status("CHAIN: submitting…");
    const j = await postJSON(submitUrl, { memoText });

    if (!j || j.ok !== true) throw new Error(j?.error || "submit failed");

    state.lastSubmitSig = j.submit_sig || "";
    try { localStorage.setItem("GKD_LAST_SUBMIT", JSON.stringify(j)); } catch (_) {}

    status("CHAIN: submitted ✅ " + (state.lastSubmitSig ? (state.lastSubmitSig.slice(0, 6) + "…" + state.lastSubmitSig.slice(-6)) : ""));
    return j;
  }

  // One-call helper (GameOver should call this)
  async function finalizeRun(runPackage) {
    let v = null;
    const pkgRunHash = String(runPackage?.run_hash || "");
    if (state.lastVerify && pkgRunHash && String(state.lastVerify.run_hash || "") === pkgRunHash) {
      // Avoid re-verifying the same run package (run tickets are one-time use).
      v = state.lastVerify;
      status("CHAIN: reusing existing verify result for this run");
    } else {
      v = await verifyRun(runPackage);
    }

    // Optional submit if submitUrl exists
    const { submitUrl } = getBackendCfg();
    if (submitUrl && v?.memoText) {
      const eligible = !!v.season_reward_eligible;
      if (!eligible) {
        const tier = String(v.season_verification_tier || "provisional");
        status("CHAIN: verify ok, reward pending (" + tier + "), submit skipped");
        return { verify: v, submit: null, submit_error: null };
      }
      try {
        const s = await submitMemo(v.memoText);
        return { verify: v, submit: s, submit_error: null };
      } catch (e) {
        // Keep verify success even if submit tx fails (e.g. unfunded submitter on devnet).
        const msg = String(e?.message || e || "submit_failed");
        status("CHAIN: verify ok, submit skipped (" + msg + ")");
        return { verify: v, submit: null, submit_error: msg };
      }
    }
    return { verify: v, submit: null, submit_error: null };
  }

  function init() {
    // Hook connect button (optional; SPACE flow can also connect)
    try {
      const btn = $("btn-connect");
      if (btn) {
        btn.addEventListener("click", async () => { await connectWallet(); });
      }
    } catch (_) {}

    if (!window.CHAIN?.enabled) {
      status("CHAIN: disabled (config)");
      return;
    }
    if (!window.solana || !window.solana.isPhantom) {
      status("CHAIN: Phantom not detected (install wallet)");
      return;
    }

    const { verifyUrl } = getBackendCfg();
    if (!verifyUrl) {
      status("CHAIN: pending (set verifyUrl)");
      return;
    }

    status("CHAIN: ready (connect wallet)");
  }

  window.ChainClient = {
    init,
    connectWallet,
    payEntryFee,
    ensureEntryPaid,

    // NEW exports
    verifyRun,
    submitMemo,
    finalizeRun,

    _state: state
  };
})();
