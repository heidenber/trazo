// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface Run {
  task: string;
  tool: string;
  run: number;
  finalOk: boolean;
  screenshot: string | null;
}
interface Pair {
  task: string;
  run: number;
  bothOk: boolean;
  trazo: Run | null;
  archify: Run | null;
}
interface RatePairs {
  selectPairs(results: { runs: Run[] }): Pair[];
  buildRatingPage(pairs: Pair[], opts: { resultsName: string }): string;
}

const root = resolve(__dirname, "../..");
const script = join(root, "bench", "rate-pairs.mjs");
const lib = (await import(/* @vite-ignore */ script)) as RatePairs;

const shot = (task: string, tool: string, n: number) =>
  join(tmpdir(), "tb", `${task}-${tool}-skill-${n}`, "diagram.png");
const rec = (task: string, tool: string, run: number, finalOk: boolean): Run => ({
  task,
  tool,
  run,
  finalOk,
  screenshot: finalOk ? shot(task, tool, run) : null,
});

const results = {
  runs: [
    rec("arch-shop", "trazo", 1, true),
    rec("arch-shop", "archify", 1, false),
    rec("arch-shop", "trazo", 2, true),
    rec("arch-shop", "archify", 2, true),
    rec("arch-shop", "trazo", 3, true),
    rec("arch-shop", "archify", 3, true),
    rec("wf-<x>", "trazo", 1, true),
    rec("wf-<x>", "archify", 1, false),
    rec("wf-<x>", "trazo", 2, false),
    rec("wf-<x>", "archify", 2, true),
  ],
};

describe("selectPairs", () => {
  it("takes the lowest run where both tools produced a final diagram, in task order", () => {
    const pairs = lib.selectPairs(results);
    expect(pairs.map((p) => p.task)).toEqual(["arch-shop", "wf-<x>"]);
    expect(pairs[0]).toMatchObject({ run: 2, bothOk: true });
    expect(pairs[0]?.trazo?.screenshot).toBe(shot("arch-shop", "trazo", 2));
    expect(pairs[0]?.archify?.screenshot).toBe(shot("arch-shop", "archify", 2));
  });

  it("falls back to run 1 flagged bothOk false when no run has both", () => {
    const pair = lib.selectPairs(results)[1];
    expect(pair).toMatchObject({ task: "wf-<x>", run: 1, bothOk: false });
    expect(pair?.archify?.finalOk).toBe(false);
  });
});

describe("buildRatingPage", () => {
  const html = lib.buildRatingPage(lib.selectPairs(results), { resultsName: "r.json" });

  it("states that the rating is not blind and names both tools", () => {
    expect(html).toContain("Author preference, not blind");
    expect(html).toMatch(/>trazo</);
    expect(html).toMatch(/>Archify</);
  });

  it("shows each screenshot by file URL and marks a missing diagram", () => {
    expect(html).toContain(pathToFileURL(shot("arch-shop", "trazo", 2)).href);
    expect(html).toContain(pathToFileURL(shot("arch-shop", "archify", 2)).href);
    expect(html).toContain("No final diagram");
  });

  it("escapes task names and offers preference, scores, note and export", () => {
    expect(html).toContain("wf-&lt;x&gt;");
    expect(html).not.toContain("wf-<x>");
    for (const v of ['value="trazo"', 'value="archify"', 'value="tie"']) expect(html).toContain(v);
    expect(html).toContain("<textarea");
    expect(html).toContain('"blind":false');
    expect(html).toContain("Export JSON");
  });
});

describe("CLI", () => {
  it("writes the page to --out and prints its path", () => {
    const dir = mkdtempSync(join(tmpdir(), "rate-pairs-"));
    try {
      const input = join(dir, "r.json");
      const out = join(dir, "page", "index.html");
      writeFileSync(input, JSON.stringify(results));
      const r = spawnSync(process.execPath, [script, input, "--out", out], { encoding: "utf8" });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe("");
      expect(r.stdout.trim()).toBe(out);
      expect(existsSync(out)).toBe(true);
      expect(readFileSync(out, "utf8")).toContain("Author preference, not blind");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 with usage when the results file is missing", () => {
    const r = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain("usage: node bench/rate-pairs.mjs <results.json>");
  });
});
