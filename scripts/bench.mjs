// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Deterministic benchmark. Needs the built dist/ (npm run build).
//   node scripts/bench.mjs [--runs N] [--no-write]
//   node scripts/bench.mjs --summary <agent-result.json>

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { estimateTokens, median, summarize, synthArchitecture } from "./bench-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = ["architecture", "workflow", "erd", "sequence"];
const MAKE_MS = 1000;
const HTML_BYTES = 300 * 1024;
const READING_TOKENS = 2000;

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.indexOf(name);

if (flag("--summary") !== -1) {
  const file = args[flag("--summary") + 1];
  if (!file) fail("--summary needs a file");
  const data = JSON.parse(readFileSync(file, "utf8"));
  console.log(JSON.stringify(summarize(data.runs), null, 2));
  process.exit(0);
}

let runs = 5;
if (flag("--runs") !== -1) {
  runs = Number(args[flag("--runs") + 1]);
  if (!Number.isInteger(runs) || runs < 1) fail("--runs needs a positive integer");
}
const write = flag("--no-write") === -1;

const distIndex = join(root, "dist", "index.js");
const distCli = join(root, "dist", "cli", "main.js");
const distReference = join(root, "dist", "cli", "reference.js");
if (!existsSync(distIndex) || !existsSync(distCli) || !existsSync(distReference))
  fail("dist/ not found; run npm run build");

const { make, VERSION } = await import(pathToFileURL(distIndex).href);
const { REFERENCE } = await import(pathToFileURL(distReference).href);

const read = (p) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const skillBody = read("skill/SKILL.md").replace(/^---\n[\s\S]*?\n---\n/, "");
const skillTokens = estimateTokens(skillBody);
const bytes = (s) => Buffer.byteLength(s);
const stats = (xs) => ({ median: median(xs), min: Math.min(...xs), max: Math.max(...xs) });
const round = (x) => Math.round(x * 10) / 10;

const reading = {};
const htmlBytes = {};
const deterministic = {};
for (const type of TYPES) {
  const example = read(`examples/${type}.json`);
  const schemaTokens = estimateTokens(REFERENCE[type]);
  const exampleTokens = estimateTokens(example);
  const total = schemaTokens + exampleTokens;
  reading[type] = { schemaTokens, exampleTokens, total, totalWithSkill: total + skillTokens };
  const a = await make(example);
  const b = await make(example);
  if (!a.ok || a.html === undefined) fail(`example ${type} did not build`);
  htmlBytes[type] = bytes(a.html);
  deterministic[type] = a.html === b.html;
}

const synth = JSON.stringify(synthArchitecture(50));
const first = await make(synth);
if (!first.ok || first.html === undefined) fail("synthetic diagram did not build");
const second = await make(synth);
deterministic.synthetic = first.html === second.html;
htmlBytes.synthetic = bytes(first.html);

const inProcess = [];
for (let i = 0; i < runs + 1; i++) {
  const t = performance.now();
  await make(synth);
  if (i > 0) inProcess.push(performance.now() - t); // first run is a warm-up
}
const cli = [];
for (let i = 0; i < runs + 1; i++) {
  const t = performance.now();
  const r = spawnSync(process.execPath, [distCli, "make", "-", "-o", "-"], {
    input: synth,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  if (r.status !== 0) fail(`CLI make failed: ${r.stderr}`);
  if (i > 0) cli.push(performance.now() - t);
}

const make50 = {
  nodes: 50,
  runs,
  inProcessMs: stats(inProcess.map(round)),
  cliMs: stats(cli.map(round)),
  htmlBytes: htmlBytes.synthetic,
};
const date = new Date().toISOString().slice(0, 10);
const result = {
  kind: "deterministic",
  date,
  trazoVersion: VERSION,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  skillTokens,
  reading,
  make50,
  htmlBytes,
  deterministic,
  thresholds: { makeMs: MAKE_MS, htmlBytes: HTML_BYTES },
  pass: {
    // The target covers trazo's own work; Node start-up and module loading show up in cliMs only.
    makeMs: make50.inProcessMs.median < MAKE_MS,
    htmlBytes: Object.values(htmlBytes).every((n) => n <= HTML_BYTES),
    readingTokens: TYPES.every((t) => reading[t].totalWithSkill < READING_TOKENS),
  },
};

const kb = (n) => (n / 1024).toFixed(1);
const pad = (s, n) => String(s).padEnd(n);
const lines = [
  `${pad("type", 14)}${pad("schema", 8)}${pad("example", 9)}${pad("+skill", 8)}${pad("html KB", 9)}deterministic`,
];
for (const type of TYPES) {
  const r = reading[type];
  lines.push(
    `${pad(type, 14)}${pad(r.schemaTokens, 8)}${pad(r.exampleTokens, 9)}${pad(r.totalWithSkill, 8)}${pad(kb(htmlBytes[type]), 9)}${deterministic[type]}`,
  );
}
lines.push(
  `make 50 nodes  in-process ${make50.inProcessMs.median} ms   cli ${make50.cliMs.median} ms   html ${kb(htmlBytes.synthetic)} KB   (in-process target ${MAKE_MS} ms: ${result.pass.makeMs ? "pass" : "over"})`,
);
console.log(lines.join("\n"));

if (write) {
  const dir = join(root, "bench", "results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${date}-deterministic.json`), `${JSON.stringify(result, null, 2)}\n`);
}

if (!Object.values(deterministic).every(Boolean)) fail("output is not deterministic");
if (!result.pass.htmlBytes) fail("an HTML file is over 300 KB");
