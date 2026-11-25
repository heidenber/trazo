// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REFERENCE } from "../../src/cli/reference.js";

const BIN = resolve("dist/cli/main.js");
const examplePath = resolve("examples/class.json");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trazo-class-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], input?: string) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const write = (edit: (d: any) => void) => {
  const doc = JSON.parse(readFileSync(examplePath, "utf8"));
  edit(doc);
  const path = join(dir, "c.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
};

describe("class CLI", () => {
  it("schema class prints the reference", () => {
    expect(run(["schema", "class"])).toEqual({ code: 0, stdout: REFERENCE.class, stderr: "" });
    expect(REFERENCE.class.startsWith("class:")).toBe(true);
  });

  it("example class prints examples/class.json byte for byte", () => {
    const expected = readFileSync(examplePath, "utf8");
    expect(run(["example", "class"])).toEqual({ code: 0, stdout: expected, stderr: "" });
  });

  it("check accepts the example", () => {
    expect(run(["check", examplePath])).toEqual({ code: 0, stdout: "ok\n", stderr: "" });
  });

  it("check rejects an unknown class with exit 1 and the exact message", () => {
    const path = write((d) => d.relations.push("Order -- Ordr"));
    expect(run(["check", path])).toEqual({
      code: 1,
      stdout: "",
      stderr: 'error  relations[8]: unknown class "Ordr" \u2192 did you mean "Order"?\n',
    });
  });

  it("make fails with class/render-unavailable until the layout lands", () => {
    const out = join(dir, "c.html");
    expect(run(["make", examplePath, "-o", out])).toEqual({
      code: 1,
      stdout: "",
      stderr:
        'error  $: class diagrams cannot be rendered yet \u2192 "trazo check" validates them already; rendering arrives in a later release\n',
    });
    expect(existsSync(out)).toBe(false);
  });

  it("make --json reports the code", () => {
    const r = run(["make", examplePath, "--json", "-o", join(dir, "c.html")]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('"code":"class/render-unavailable"');
  });

  it("an unknown type lists class", () => {
    expect(run(["check", "-"], '{"type":"zzzzzz","title":"T"}').stderr).toContain(
      "use one of: architecture, workflow, erd, sequence, chen, state, class",
    );
  });
});
