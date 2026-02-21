# Galaxy King Dog

Arcade space shooter with deterministic replay verification for anti-cheat score integrity.

## Whitepapers
- [Galaxy King Dog Whitepaper v1.7 (fixed)](./Galaxy_King_Dog_Whitepaper_v1.7_fixed.pdf)
- [Galaxy King Dog Whitepaper v1.4](./Galaxy_King_Dog_Whitepaper_v1.4.pdf)

## What This Project Is
- Browser game built with Phaser (`src/main.js`)
- Deterministic run packaging (inputs + frame deltas + hashes)
- Local verifier service (`verifier/server.js`) for replay integrity checks
- Solana-oriented entry/verification flow hooks in `src/chain/*`

## Core Features
- Endless wave gameplay with increasing difficulty
- Persistent `HI-SCORE` + `TOP 5`
- Run package export at game over
- Deterministic verification pipeline:
  - `replay_hash`
  - `run_hash`
  - run ticket one-time usage
  - checkpoint chain (schema v2)
- Verification status in-game (`VERIFICATION CLOSED` / `PENDING`)

## Controls
- `SPACE`: start game
- `R`: restart after game over
- `B`: submit proof (chain flow)
- `P`: download run package
- `H`: export high-score backup JSON
- `J`: import high-score backup JSON

## Project Structure
- `src/main.js`: gameplay + run-package generation + UI status
- `src/chain/chain_config.js`: chain/verifier frontend config
- `src/chain/chain_client.js`: wallet + ticket + verify/submit client flow
- `verifier/server.js`: verifier API (`/health`, `/ticket`, `/verify`, `/submit`)
- `verifier/sim/core.js`: deterministic headless re-simulation core
- `verifier/tools/season_check.js`: audit tool for run packages
- `tools/dev_server.py`: local static server

## Requirements
- Node.js 18+
- Python 3.x
- Phantom wallet (if chain mode is enabled)

## Quick Start
### 1) Start game server
From repo root:

```powershell
python tools\dev_server.py 8000
```

Open: `http://127.0.0.1:8000`

### 2) Start verifier server
In a second terminal:

```powershell
cd verifier
npm install
copy .env.example .env
npm start
```

Verifier: `http://127.0.0.1:8787`

## Verifier Configuration
Edit `verifier/.env`:
- `POOL_RECIPIENT` must match `src/chain/chain_config.js` `poolRecipient`
- `GATE_D_MODE=strict` for production integrity close
- `ALLOW_LEGACY_NO_TICKET=false` to enforce run tickets

Do not commit real secrets:
- `VERIFIER_SECRET_KEY_B64`
- `SUBMITTER_SECRET_KEY_B64`

## Verification Model (Current)
- Input stream + delta stream integrity checks
- Entry transaction validation against configured pool recipient
- Run ticket one-time anti-replay check
- Checkpoint chain verification (`schema: 2`)
- Gate D status and score verdict surfaced in UI

## Run Package Audit
Verify all downloaded packages:

```powershell
cd verifier
npm run season:check -- --dir "C:\Users\<you>\Downloads"
```

Outputs tier/score/wave and verification notes per package.

## Production Checklist
1. Keep verifier always online.
2. Keep `GATE_D_MODE=strict`.
3. Keep `ALLOW_LEGACY_NO_TICKET=false`.
4. Backup run packages and verifier logs regularly.
5. Rotate any leaked/reused tokens and private keys.

## Security Notes
- Previous leaked tokens/keys must be revoked and rotated.
- Treat all credentials as compromised if ever pasted in chat or screenshots.
- Keep `.env` local only.

## License
See `license.txt`.
