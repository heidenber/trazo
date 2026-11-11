// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { estimateTokens, median, summarize, synthArchitecture } from "../../scripts/bench-lib.mjs";
import { check, make } from "../../src/index.js";
import { REFERENCE } from "../../src/cli/reference.js";

const root = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const TYPES = ["architecture", "workflow", "erd", "sequence"] as const;

describe("bench-lib helpers", () => {
  it("estimates tokens as chars / 4, rounded up", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("takes the median of odd and even lists without mutating the input", () => {
    const xs = [3, 1, 2];
    expect(median(xs)).toBe(2);
    expect(xs).toEqual([3, 1, 2]);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("summarizes runs per condition", () => {
    const run = (condition: string, n: number, ok: boolean, repairs: number) => ({
      task: "t",
      condition,
      run: n,
      inputTokens: 100 * n,
      outputTokens: 10 * n,
      cacheCreationTokens: 1000 * n,
      cacheReadTokens: 10000 * n,
      failedCommands: repairs,
      repairs,
      firstTryOk: ok,
      finalOk: true,
      seconds: 10 * n,
    });
    const s = summarize([
      run("skill", 1, true, 0),
      run("skill", 2, true, 0),
      run("no-skill", 1, false, 2),
      run("no-skill", 2, true, 0),
    ]);
    expect(s.skill).toEqual({
      runs: 2,
      firstTryRate: 1,
      finalRate: 1,
      medianRepairs: 0,
      medianInputTokens: 150,
      medianTotalInputTokens: 16650,
      medianOutputTokens: 15,
      medianSeconds: 15,
    });
    expect(s["no-skill"]).toEqual({
      runs: 2,
      firstTryRate: 0.5,
      finalRate: 1,
      medianRepairs: 1,
      medianInputTokens: 150,
      medianTotalInputTokens: 16650,
      medianOutputTokens: 15,
      medianSeconds: 15,
    });
  });
});

describe("synthArchitecture", () => {
  it("has 50 nodes, 5 groups, and is identical across calls", () => {
    const d = synthArchitecture(50);
    expect(d.nodes).toHaveLength(50);
    expect(d.groups).toHaveLength(5);
    expect(JSON.stringify(synthArchitecture(50))).toBe(JSON.stringify(d));
  });

  it("validates with zero errors", () => {
    const r = check(synthArchitecture(50));
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("deterministic measurements", () => {
  it("makes byte-identical HTML under 300 KB for the 50-node diagram", async () => {
    const a = await make(synthArchitecture(50));
    const b = await make(synthArchitecture(50));
    expect(a.ok).toBe(true);
    expect(a.html).toBe(b.html);
    expect(Buffer.byteLength(a.html ?? "")).toBeLessThan(300 * 1024);
  });

  it.each(TYPES)("keeps the %s example under 300 KB and deterministic", async (type) => {
    const text = read(`examples/${type}.json`);
    const a = await make(text);
    const b = await make(text);
    expect(a.html).toBe(b.html);
    expect(Buffer.byteLength(a.html ?? "")).toBeLessThan(300 * 1024);
  });

  it.each(TYPES)("keeps reading cost of %s under 2000 tokens with the skill", (type) => {
    const skill = read("skill/SKILL.md").replace(/^---\n[\s\S]*?\n---\n/, "");
    const total =
      estimateTokens(skill) +
      estimateTokens(REFERENCE[type]) +
      estimateTokens(read(`examples/${type}.json`));
    expect(total).toBeLessThan(2000);
  });
});

describe("bench/tasks.json", () => {
  const file = JSON.parse(read("bench/tasks.json")) as {
    version: number;
    tasks: { id: string; type: string; level: number; prompt: string }[];
  };

  it("has 8 tasks with unique ids, 2 per type", () => {
    expect(file.version).toBe(1);
    expect(file.tasks).toHaveLength(8);
    expect(new Set(file.tasks.map((t) => t.id)).size).toBe(8);
    for (const type of TYPES) expect(file.tasks.filter((t) => t.type === type)).toHaveLength(2);
  });

  it("has levels 1-4 and non-empty prompts; erd tasks avoid composite keys", () => {
    for (const t of file.tasks) {
      expect(t.level).toBeGreaterThanOrEqual(1);
      expect(t.level).toBeLessThanOrEqual(4);
      expect(t.prompt.trim()).not.toBe("");
      if (t.type === "erd") expect(t.prompt.toLowerCase()).not.toContain("composite");
    }
  });
});
