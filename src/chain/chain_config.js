// src/chain/chain_config.js
// Front-end Chain Wiring (Step 1)
// NOTE: For now, entry fees can be sent to a TEMP recipient for testing.
// Later, replace poolRecipient with the on-chain Pool PDA (program-owned, no withdraw authority).

window.CHAIN = {
  enabled: true,

  // Cluster / RPC
  cluster: "devnet", // "devnet" | "mainnet-beta"
  rpcUrl: "",        // optional override. leave "" to use web3 default clusterApiUrl

  // Backend verifier endpoints (DEV)
  ticketUrl: "http://127.0.0.1:8787/ticket",
  verifyUrl: "http://127.0.0.1:8787/verify",
  submitUrl: "",

  // Season / rule context (used inside run_hash)
  seasonId: 1,

  // Entry fee (lamports). Default: 0.00027 SOL = 270,000 lamports.
  feeLamports: 270000,

  // Bot policy (on-chain later; kept here for UI + package fields)
  botMultiplier: 10,

  // TEMP recipient for entry fee transfer (testing only).
  // Replace with Pool PDA once the program is deployed.
  poolRecipient: "Cor54nWNV8rBhWBAhwGUwFisxxWiaUgem11K5Xo3A6n",

  // UX policy
  requireWalletToStart: true, // if true: SPACE -> connect + pay -> then start countdown
};

