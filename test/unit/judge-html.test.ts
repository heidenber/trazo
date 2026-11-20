// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

interface Result {
  ok: boolean;
  issues: { kind: string; detail: string }[];
  textCount: number;
  screenshot: string | null;
}
interface Judge {
  judgeHtml(file: string, opts?: Record<string, unknown>): Promise<Result>;
  findBrowser(): string | null;
}

const root = resolve(__dirname, "../..");
const modulePath = join(root, "bench", "judge-html.mjs");
const fixture = (name: string) => join(root, "test", "fixtures", "judge-html", `${name}.html`);
const judge = (await import(/* @vite-ignore */ modulePath)) as Judge;
const hasBrowser = judge.findBrowser() !== null;
const kinds = (r: Result) => [...new Set(r.issues.map((i) => i.kind))].sort();

describe.skipIf(!hasBrowser)("judgeHtml", () => {
  it("accepts a clean page and counts its visible text", async () => {
    const r = await judge.judgeHtml(fixture("clean"), {
      expectedTerms: ["orders  SERVICE", "gateway"],
    });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.textCount).toBe(3);
    expect(r.screenshot).toBeNull();
  });

  it("reports expected terms missing from the visible text", async () => {
    const r = await judge.judgeHtml(fixture("clean"), {
      expectedTerms: ["Gateway", "Cache layer"],
    });
    expect(r.ok).toBe(false);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]?.kind).toBe("content-missing");
    expect(r.issues[0]?.detail).toContain("Cache layer");
  });

  it("detects overlapping HTML text", async () => {
    const r = await judge.judgeHtml(fixture("overlap-html"), { settleMs: 200 });
    expect(r.ok).toBe(false);
    expect(kinds(r)).toEqual(["text-overlap"]);
  });

  it("detects overlapping SVG text", async () => {
    const r = await judge.judgeHtml(fixture("overlap-svg"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["text-overlap"]);
  });

  it("detects text clipped by an overflow:hidden ancestor", async () => {
    const r = await judge.judgeHtml(fixture("clipped-html"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["text-clipped"]);
  });

  it("detects SVG text running past the svg viewport", async () => {
    const r = await judge.judgeHtml(fixture("clipped-svg"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["text-clipped"]);
  });

  it("detects text placed outside the page", async () => {
    const r = await judge.judgeHtml(fixture("outside-page"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["outside-page"]);
  });

  it("reports uncaught exceptions", async () => {
    const r = await judge.judgeHtml(fixture("js-error"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["js-error"]);
    expect(r.issues[0]?.detail).toContain("boom");
  });

  it("reports a page with no visible text", async () => {
    const r = await judge.judgeHtml(fixture("empty"), { settleMs: 200 });
    expect(r.textCount).toBe(0);
    expect(kinds(r)).toEqual(["render-empty"]);
  });

  it("writes a full-page screenshot when asked", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "judge-test-")), "shot.png");
    const r = await judge.judgeHtml(fixture("clean"), { screenshotPath: out });
    expect(r.screenshot).toBe(out);
    expect(readFileSync(out).subarray(1, 4).toString()).toBe("PNG");
  });

  it("rejects when the file does not exist", async () => {
    await expect(judge.judgeHtml(fixture("nope"), { settleMs: 200 })).rejects.toThrow(/not found/i);
  });
});

describe("judge-html CLI", () => {
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, [modulePath, ...args], { encoding: "utf8", timeout: 60_000 });

  it("exits 2 with usage when no file is given", () => {
    const r = cli();
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage:");
  });

  it("exits 2 on an unknown option", () => {
    const r = cli(fixture("clean"), "--bogus");
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown option "--bogus"');
  });

  it("exits 2 when the browser path does not exist", () => {
    const r = cli(fixture("clean"), "--browser", join(tmpdir(), "no-such-browser.exe"));
    expect(r.status).toBe(2);
  });

  it.skipIf(!hasBrowser)("exits 0 for a clean page and 1 for a flawed one, with --json", () => {
    const good = cli(fixture("clean"), "--json");
    expect(good.status).toBe(0);
    expect(JSON.parse(good.stdout).ok).toBe(true);
    const bad = cli(fixture("overlap-svg"), "--json", "--expect", "Missing term");
    expect(bad.status).toBe(1);
    const parsed = JSON.parse(bad.stdout) as Result;
    expect(parsed.issues.map((i) => i.kind).sort()).toEqual(["content-missing", "text-overlap"]);
    expect(existsSync(fixture("clean"))).toBe(true);
  });
});
