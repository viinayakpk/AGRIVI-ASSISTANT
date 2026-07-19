#!/usr/bin/env node
// Builds dist/agrivi-companion.html from src/ — a plain concatenation in a
// fixed, explicit order (no bundler, no dependencies). The order below is
// the ONLY thing that matters for correctness: every file relies on shared
// top-level scope, the same way the original single-file version did, so
// anything a file references must be defined by a file earlier in this list.
//
// Run: node build.js
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const OUT = path.join(__dirname, "dist", "agrivi-companion.html");

const STYLES = [
  "styles/01-tokens-base.css",
  "styles/02-redesign-field-deck.css",
  "styles/03-redesign-focused-shell.css",
  "styles/04-history-panel.css",
];

const SCRIPT = [
  "core/00-preamble.js",
  "core/01-tenant.js",
  "core/01b-privacy.js",
  "core/02-schemas.js",
  "core/03-matching.js",
  "core/04-capability.js",
  "core/05-tools.js",
  "core/06-trace.js",
  "core/07-eventlog.js",
  "core/08-memory.js",

  "agents/01-tiering.js",
  "agents/02-providers.js",
  "agents/03-breakers.js",
  "agents/04-shared.js",
  "agents/05-screen.js",
  "agents/06-router.js",
  "agents/07-normalizer.js",
  "agents/08-extractor.js",
  "agents/09-planner.js",
  "agents/10-critic.js",
  "agents/11-advisor.js",
  "agents/12-chat.js",
  "agents/13-websearch.js",
  "agents/14-foresight.js",
  "agents/15-run-tiers.js",

  "core/09-verifier.js",
  "core/10-policy.js",
  "core/11-kernel.js",
  "core/12-outbox.js",

  "ui/01-render.js",
  "ui/02-plumbing.js",
  "ui/03-boot.js",
];

const read = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8").replace(/\n+$/, "");

const html = [
  read("shell/01-head-top.html"),
  "<style>",
  STYLES.map(read).join("\n\n"),
  "</style>",
  read("shell/02-body.html"),
  "<script>",
  SCRIPT.map(read).join("\n\n"),
  "</script>",
  read("shell/03-tail.html"),
].join("\n") + "\n";

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`Built ${OUT} (${html.split("\n").length} lines) from ${STYLES.length + SCRIPT.length + 4} source files.`);
