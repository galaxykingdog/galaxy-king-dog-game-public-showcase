#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const out = {
    dir: "",
    url: "http://127.0.0.1:8787/verify",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dir" && argv[i + 1]) {
      out.dir = argv[++i];
    } else if (a === "--url" && argv[i + 1]) {
      out.url = argv[++i];
    }
  }
  return out;
}

async function postVerify(url, payload) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) {
    const msg = j && (j.error || j.message) ? (j.error || j.message) : ("HTTP " + r.status);
    return { ok: false, error: msg };
  }
  return j || { ok: false, error: "Empty response" };
}

function chooseLatestDir() {
  const userProfile = process.env.USERPROFILE || "";
  if (!userProfile) return "";
  return path.join(userProfile, "Downloads");
}

function collectRunPackages(dir) {
  if (!fs.existsSync(dir)) throw new Error("Directory not found: " + dir);
  const files = fs.readdirSync(dir)
    .filter((n) => /^runPackage_.*\.json$/i.test(n))
    .map((n) => path.join(dir, n));
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files;
}

async function main() {
  const args = parseArgs(process.argv);
  const dir = args.dir || chooseLatestDir();
  if (!dir) {
    console.error("Usage: npm run season:check -- --dir <folder> [--url http://127.0.0.1:8787/verify]");
    process.exit(1);
  }

  const files = collectRunPackages(dir);
  if (!files.length) {
    console.log("No runPackage_*.json files found in:", dir);
    process.exit(0);
  }

  const rows = [];
  let ok = 0;
  let provisional = 0;
  let verified = 0;
  let failed = 0;

  for (const f of files) {
    let pkg = null;
    try {
      pkg = JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      rows.push({
        file: path.basename(f),
        status: "error",
        tier: "-",
        score: "-",
        wave: "-",
        note: "invalid json",
      });
      failed++;
      continue;
    }

    const res = await postVerify(args.url, pkg);
    if (!res.ok) {
      rows.push({
        file: path.basename(f),
        status: "error",
        tier: "-",
        score: pkg.final_score ?? "-",
        wave: pkg.final_wave ?? "-",
        note: res.error || "verify failed",
      });
      failed++;
      continue;
    }

    ok++;
    const tier = String(res.season_verification_tier || (res.score_confirmed ? "verified" : "provisional"));
    if (tier === "verified") verified++; else provisional++;

    rows.push({
      file: path.basename(f),
      status: "ok",
      tier,
      score: res.final_score_claimed ?? pkg.final_score ?? "-",
      wave: res.final_wave_claimed ?? pkg.final_wave ?? "-",
      note: String(res.gate_d_status || ""),
    });
  }

  console.log("Season Check");
  console.log("Directory:", dir);
  console.log("Verify URL:", args.url);
  console.log("Totals: ok=" + ok + " provisional=" + provisional + " verified=" + verified + " failed=" + failed);
  console.log("");
  for (const r of rows) {
    console.log([
      r.status.padEnd(5),
      r.tier.padEnd(11),
      ("score=" + r.score).padEnd(12),
      ("wave=" + r.wave).padEnd(10),
      r.note.padEnd(12),
      r.file,
    ].join(" | "));
  }
}

main().catch((e) => {
  console.error("Fatal:", e && e.message ? e.message : e);
  process.exit(1);
});

