# Galaxy King Dog Whitepaper (Unified v2.0)
Date: 2026-02-21  
Status: Consolidated specification for implementation and public reference.

## 1. Purpose
Galaxy King Dog is an arcade score game with deterministic replay verification and on-chain reward logic on Solana.  
This unified document merges:
- Whitepaper v1.7 (primary spec)
- v1.4 appendix logic for on-chain winner/claim flow

Goal: keep gameplay unchanged while securing score integrity, checkpoint payouts, and transparent distribution.

## 2. System Overview
- Gameplay runs client-side (`src/main.js`).
- Each run produces a deterministic proof package (PoP run package).
- Verifier checks integrity and replay consistency (`verifier/server.js`).
- On-chain program logic (as specified) handles checkpoint winners and claims.

## 3. Token, Pools, and Accounts
- Fungible token: `$420POP` (SPL, 9 decimals).
- Entry fees are paid in SOL lamports.
- Game Pool: program-owned PDA, receives entry fees.
- Charity Pool: program-owned PDA.
- Creator wallet: fixed destination for creator split.
- Program state tracks season progress, best score, record holder, and checkpoint claim flags.

Creator split rule (locked):
- 49% to creator wallet
- 51% to Charity Pool (direct transfer, not via creator wallet)

Charity return rule:
- 20% of Charity Pool incoming donations routed back to Game Pool.

## 4. Proof of Play (PoP) and Verification
Per run, package includes:
- `player_pubkey`
- `fee_lamports`, `entry_sig`, `entry_slot`
- `final_score`, `season_id`, pass flags
- `replay_hash`
- `version_hash`
- `run_hash`

Current integrity stack:
- Input/delta stream integrity
- Entry tx validation (source/destination/lamports)
- One-time run ticket anti-replay
- Checkpoint-chain verification (`schema: 2`)
- Deterministic verification verdict in verifier response

## 5. Emission and Seasons (Unified)
- Total farm seasons: 33 (halving-style structure)
- Human emission ends at Season 32
- Season 32 final Human token requires new WR claim (special rule)
- Season 33 is Chaos Season with fixed cap: 300,000 `$420POP`
- Final Chaos token is marked "Chaos King" token

Where older season-cap wording conflicts, this boundary is authoritative.

## 6. Score Targets and Farming Modes
Mode A:
- Fixed season score targets (starts around 2,000 and ramps to 40,000)
- Deterministic per-season config

Mode B:
- Progress-based multiplier using season mint progress `p = minted/mint_cap`
- Flat until threshold, then linear ramp with hard cap
- Final special Human token remains separate WR-gated rule

## 7. Fees and Updates
- Fee is stored as `fee_lamports` and updated periodically.
- Monthly update model:
  - Bot/admin proposes fee update from SOL/USD sources
  - 2/3 multisig approves `set_fee_lamports`
- Multisig cannot withdraw Game Pool/Charity Pool funds; only parameter/governance actions.

## 8. Checkpoints and Payout Rules
Checkpoint execution is permissionless claim-style:
- Program snapshots winner/holder at trigger time
- Any caller can execute claim tx
- Program enforces recipients and one-time `claimed` flags

Locked payout logic:
- Farm Season End:
  - 70% retained in pool
  - 20% Season Winner
  - 10% Creator payout (49/51 creator/charity split)
- World Record Break:
  - Payout occurs on each accepted WR break
  - 70% retained, 20% WR breaker, 10% creator split
- Human Season End:
  - 30% carried to Chaos
  - 40% Human Champion
  - 30% creator split
- Chaos Season End:
  - 67% Chaos Champion
  - 33% creator split

## 9. Winner and Tie-Break Determinism
Winner/record updates only from valid verified runs.

Tie-break order:
1. Higher score
2. Earlier slot/entry slot

This makes winner resolution deterministic and auditable.

## 10. NFTs and Marked Achievements
Achievement NFTs (as specified):
- Baby Metatron (first-ever play event)
- Season Champion Metatron (per season)
- Record Breaker Metatron (repeatable per new WR)
- Human Metatron (Human champion)
- Final Galaxy Metatron Defender (Chaos champion)

Special marked fungible achievements:
- Galaxy King (Human winner + record context)
- Chaos King (Chaos winner + record context)

## 11. Governance (Charity Operator)
Vote events happen at:
- End of Human emission
- End of Chaos

Rules:
- Eligibility: farmed >= 1 token
- Quorum: minimum 10,000 votes
- Duration: 99 days
- Tie: re-vote
- If quorum fails: funds remain in Charity Pool until next valid vote
- Charity destination must be whitelisted

## 12. Security and Operational Policy
- Keep verifier in strict integrity mode for production.
- Enforce one-time run tickets (`ALLOW_LEGACY_NO_TICKET=false`).
- Never commit `.env` or private keys.
- Rotate leaked credentials immediately.
- Keep periodic backups of run packages and verifier logs.

## 13. Implementation Notes
No gameplay change is required for this model.  
Required integration path:
1. Wallet connect + entry fee transfer
2. Run package generation with deterministic hashes
3. Verifier check + verdict
4. On-chain state update and permissionless claim execution

## 14. Source Merge Note
This unified text is compiled from:
- `Galaxy_King_Dog_Whitepaper_v1.7_fixed.pdf` (primary)
- `Galaxy_King_Dog_Whitepaper_v1.4.pdf` (appendix claim model content available in extracted text)

If any future constitutional update is approved, publish it as an explicit addendum section with date and supersession rule.
