// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
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
  createProfileDir(root?: string): string;
  containsTerm(visible: string, term: string): boolean;
}

const root = resolve(__dirname, "../..");
const modulePath = join(root, "bench", "judge-html.mjs");
const fixture = (name: string) => join(root, "test", "fixtures", "judge-html", `${name}.html`);
const judge = (await import(/* @vite-ignore */ modulePath)) as Judge;
const hasBrowser = judge.findBrowser() !== null;
const kinds = (r: Result) => [...new Set(r.issues.map((i) => i.kind))].sort();

describe("containsTerm", () => {
  it("matches whole words and phrases, case-insensitive and whitespace-normalized", () => {
    expect(judge.containsTerm("the api gateway", "API")).toBe(true);
    expect(judge.containsTerm("order   service", "Order Service")).toBe(true);
    expect(judge.containsTerm("post_tags table", "post_tags")).toBe(true);
    expect(judge.containsTerm("(web) -> db", "web")).toBe(true);
  });

  it("does not match inside a longer word", () => {
    expect(judge.containsTerm("an application", "app")).toBe(false);
    expect(judge.containsTerm("rapid growth", "api")).toBe(false);
    expect(judge.containsTerm("post_tags", "tags")).toBe(false);
    expect(judge.containsTerm("databases", "database")).toBe(false);
  });

  it("treats regex characters in a term literally", () => {
    expect(judge.containsTerm("cost (usd)", "(usd)")).toBe(true);
    expect(judge.containsTerm("abc", "a.c")).toBe(false);
  });
});

describe("createProfileDir", () => {
  it("creates a _judge-* folder under the given root, making the root if needed", () => {
    const base = mkdtempSync(join(tmpdir(), "judge-profile-"));
    const rootDir = join(base, "bench", "root");
    const dir = judge.createProfileDir(rootDir);
    expect(dirname(dir)).toBe(rootDir);
    expect(basename(dir).startsWith("_judge-")).toBe(true);
    expect(existsSync(dir)).toBe(true);
    rmSync(base, { recursive: true, force: true });
  });
});

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

  it("matches expected terms as whole words in the rendered page", async () => {
    const r = await judge.judgeHtml(fixture("words"), {
      expectedTerms: ["app", "api", "post_tags", "application"],
    });
    expect(r.issues.map((i) => i.detail)).toEqual([
      'expected "app" not in visible text',
      'expected "api" not in visible text',
    ]);
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

  it("ignores text that is clipped away completely, as hidden on purpose", async () => {
    const r = await judge.judgeHtml(fixture("sr-only"), {
      expectedTerms: ["Orders service"],
      settleMs: 200,
    });
    expect(r.issues).toEqual([]);
    expect(r.textCount).toBe(2);
    const missing = await judge.judgeHtml(fixture("sr-only"), {
      expectedTerms: ["Dark mode", "Present"],
      settleMs: 200,
    });
    expect(missing.issues.map((i) => i.kind)).toEqual(["content-missing", "content-missing"]);
  });

  it("still reports text that is only partly clipped", async () => {
    const r = await judge.judgeHtml(fixture("clipped-partial"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["text-clipped"]);
    expect(r.textCount).toBe(1);
  });

  it("detects SVG text running past the svg viewport", async () => {
    const r = await judge.judgeHtml(fixture("clipped-svg"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["text-clipped"]);
  });

  it("detects SVG text past an svg that hides its overflow", async () => {
    const r = await judge.judgeHtml(fixture("svg-overflow-hidden"), { settleMs: 200 });
    expect(kinds(r)).toEqual(["text-clipped"]);
  });

  it("accepts SVG text past an svg that renders its overflow", async () => {
    const r = await judge.judgeHtml(fixture("svg-overflow-visible"), { settleMs: 200 });
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
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
