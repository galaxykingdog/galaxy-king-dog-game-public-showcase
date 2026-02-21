# Galaxy King Dog

Competitive arcade shooter with deterministic replay proof and Solana verifier flow.

## Project Structure
- `src/main.js`: Phaser gameplay + PoHP run package creation (deterministic inputs/deltas/hash).
- `src/chain/chain_config.js`: Frontend chain settings (cluster, fee, pool recipient, verifier URLs).
- `src/chain/chain_client.js`: Wallet connect, entry fee tx, `/verify` + `/submit` calls.
- `verifier/server.js`: Backend verifier API (`/health`, `/verify`, `/submit`).
- `verifier/sim/core.js`: Deterministic replay simulation (Gate D).
- `tools/dev_server.py`: Static server (+ optional legacy `/submit-score` save route).
- `index.html`: Loads Phaser, Solana web3, chain config/client, and game.

## Requirements
- Node.js 18+ (for verifier)
- Python 3.x (for static game server)
- Phantom wallet (for chain-enabled play)

## Quick Start (Local)

### 1) Start game static server
From repo root:

```powershell
python tools\dev_server.py 8000
```

Open: `http://127.0.0.1:8000`

### 2) Start verifier server
In another terminal:

```powershell
cd verifier
npm install
npm start
```

Verifier default URL: `http://127.0.0.1:8787`

## Chain Configuration

Edit `src/chain/chain_config.js`:
- `enabled`: set `true` for verifier + wallet flow, `false` for offline/local play.
- `cluster` / `rpcUrl`
- `verifyUrl` and `submitUrl`
- `feeLamports`
- `poolRecipient`
- `requireWalletToStart`

Important: `poolRecipient` in `src/chain/chain_config.js` must match `POOL_RECIPIENT` used by verifier.

## Verifier Environment

`verifier/server.js` requires a pool recipient at startup.

Create `verifier/.env` from template first:

```powershell
copy verifier\.env.example verifier\.env
```

Then set values in `verifier/.env` with at least:
- `PORT=8787`
- `CLUSTER=devnet`
- `RPC_URL=https://api.devnet.solana.com`
- `POOL_RECIPIENT=<same as chain_config.js poolRecipient>`

Optional:
- `VERIFIER_SECRET_KEY_B64`
- `SUBMITTER_SECRET_KEY_B64`
- `EXPECTED_GAME_ID`
- `ASSETS_DIR`

Security note:
- Never commit `verifier/.env` (contains private keys).

## Gameplay + Proof Flow
- `SPACE`: start run (wallet/payment enforced if chain config requires it).
- During run, PoHP records input masks + frame deltas.
- On game over, a run package is finalized (`replay_hash`, `run_hash`, etc.).
- `B`: submit proof through verifier (`/verify`, then optional `/submit`).
- `P`: download run package JSON.

## Troubleshooting
- `CHAIN: Phantom not detected`: install/enable Phantom extension.
- `Missing POOL_RECIPIENT in .env`: add `POOL_RECIPIENT` in `verifier/.env`.
- `/verify` fails with hash mismatch: ensure client/verifier are on same branch/ruleset.
- Verifier unreachable: check `verifyUrl` in `src/chain/chain_config.js` and that verifier is running.

## Notes
- Gameplay is client-side.
- Verification is deterministic replay + hashing.
- Payout/reward logic depends on your on-chain setup and verifier policy.

## Seasonal Verification Policy (Recommended)
- Keep verifier in `GATE_D_MODE=warn` during active development/beta.
- Treat only `season_verification_tier=verified` as reward-eligible.
- Treat `season_verification_tier=provisional` as pending/unpaid.
- New run packages use `schema: 2` with checkpoint-chain fields:
  - `checkpoints_b64`
  - `checkpoints_every_frames`
  - `checkpoint_chain_final`
  - `checkpoints_len`

### Quick seasonal audit (all downloaded run packages)
From `verifier/`:

```powershell
npm run season:check -- --dir "C:\Users\<you>\Downloads"
```

This prints each package with:
- `tier`: `provisional` or `verified`
- `score` / `wave`
- Gate D status note

### Launch hardening checklist
1. Finish Gate D parity so real packages return `gate_d_status=pass`.
2. Set `GATE_D_MODE=strict` in `verifier/.env`.
3. Set `ALLOW_LEGACY_NO_TICKET=false` in `verifier/.env` (enforce one-time run tickets).
4. Restart verifier and re-run `season:check`.
5. Enable rewards only for `season_verification_tier=verified`.
