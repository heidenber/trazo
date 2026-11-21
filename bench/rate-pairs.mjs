#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

/**
 * Builds the author-preference rating page for a head-to-head results file.
 * One pair per task: the lowest run where both tools produced a final diagram,
 * else run 1 flagged. The page names both tools: this rating is NOT blind.
 *
 *   node bench/rate-pairs.mjs <results.json> [--out file.html] [--sandbox-root dir]
 *
 * Default output: <sandbox root>/_rating/index.html (outside the repo).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TOOLS = [
  ["trazo", "trazo"],
  ["archify", "Archify"],
];

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export function selectPairs(results) {
  const tasks = [...new Set(results.runs.map((r) => r.task))];
  return tasks.map((task) => {
    const find = (tool, run) =>
      results.runs.find((r) => r.task === task && r.tool === tool && r.run === run) ?? null;
    const runs = [...new Set(results.runs.filter((r) => r.task === task).map((r) => r.run))].sort(
      (a, b) => a - b,
    );
    const both = runs.find((n) => TOOLS.every(([t]) => find(t, n)?.finalOk));
    const run = both ?? 1;
    return {
      task,
      run,
      bothOk: both !== undefined,
      trazo: find("trazo", run),
      archify: find("archify", run),
    };
  });
}

function panel(rec, label) {
  if (!rec?.finalOk || !rec.screenshot) {
    return `<figure><figcaption>${esc(label)}</figcaption><p class="missing">No final diagram</p></figure>`;
  }
  const img = pathToFileURL(rec.screenshot).href;
  const page = pathToFileURL(join(dirname(rec.screenshot), "diagram.html")).href;
  return `<figure><figcaption>${esc(label)}</figcaption><a href="${esc(page)}" target="_blank"><img src="${esc(img)}" alt="${esc(label)} diagram"></a><a href="${esc(page)}" target="_blank">Open interactive</a></figure>`;
}

function scale(i, tool) {
  return [1, 2, 3, 4, 5]
    .map((n) => `<label><input type="radio" name="s${i}-${tool}" value="${n}">${n}</label>`)
    .join("");
}

export function buildRatingPage(pairs, { resultsName }) {
  const meta = JSON.stringify({ kind: "author-preference", blind: false, results: resultsName });
  const sections = pairs
    .map(
      (p, i) => `<section data-task="${esc(p.task)}" data-run="${p.run}">
<h2>${esc(p.task)} <small>run ${p.run}${p.bothOk ? "" : " (not both valid)"}</small></h2>
<div class="pair">${panel(p.trazo, "trazo")}${panel(p.archify, "Archify")}</div>
<fieldset><legend>Preference</legend>${TOOLS.map(([v, l]) => `<label><input type="radio" name="p${i}" value="${v}">${l}</label>`).join("")}<label><input type="radio" name="p${i}" value="tie">Tie</label></fieldset>
${TOOLS.map(([v, l]) => `<fieldset><legend>${l} score (1-5)</legend>${scale(i, v)}</fieldset>`).join("\n")}
<textarea name="n${i}" rows="2" placeholder="Note"></textarea>
</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Author preference, not blind</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;max-width:1600px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}
figure{margin:0;border:1px solid #ccc;padding:8px}
figcaption{font-weight:600;margin-bottom:6px}
img{width:100%;height:auto;display:block;margin-bottom:6px}
.missing{color:#b00;padding:40px;text-align:center}
section{border-bottom:2px solid #eee;padding-bottom:24px;margin-bottom:24px}
fieldset{display:inline-block;margin:8px 8px 0 0}
textarea{display:block;width:100%;margin-top:8px}
</style></head><body>
<h1>Author preference, not blind</h1>
<p>Results: ${esc(resultsName)}. The rater knows which tool made each diagram.</p>
${sections}
<button id="export">Export JSON</button>
<script>
const META = ${meta};
document.getElementById("export").onclick = () => {
  const val = (n) => document.querySelector('[name="' + n + '"]:checked')?.value ?? null;
  const ratings = [...document.querySelectorAll("section")].map((s, i) => ({
    task: s.dataset.task,
    run: Number(s.dataset.run),
    preference: val("p" + i),
    scores: { trazo: Number(val("s" + i + "-trazo")) || null, archify: Number(val("s" + i + "-archify")) || null },
    note: document.querySelector('[name="n' + i + '"]').value,
  }));
  const blob = new Blob([JSON.stringify({ ...META, date: new Date().toISOString(), ratings }, null, 2) + "\\n"], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "author-preference.json" });
  a.click();
};
</script>
</body></html>
`;
}

function main(argv) {
  const args = [...argv];
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const out = opt("--out");
  const sandboxRoot = opt("--sandbox-root") ?? join(tmpdir(), "trazo-bench");
  const input = args[0];
  if (!input || args.length > 1) {
    process.stderr.write(
      "usage: node bench/rate-pairs.mjs <results.json> [--out file.html] [--sandbox-root dir]\n",
    );
    return 2;
  }
  const results = JSON.parse(readFileSync(input, "utf8"));
  const file = resolve(out ?? join(sandboxRoot, "_rating", "index.html"));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, buildRatingPage(selectPairs(results), { resultsName: basename(input) }));
  process.stdout.write(file + "\n");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
