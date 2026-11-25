// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REFERENCE } from "../../src/cli/reference.js";

const BIN = resolve("dist/cli/main.js");
const examplePath = resolve("examples/state.json");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trazo-state-"));
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
  const path = join(dir, "s.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
};

describe("state CLI", () => {
  it("schema state prints the reference", () => {
    expect(run(["schema", "state"])).toEqual({ code: 0, stdout: REFERENCE.state, stderr: "" });
    expect(REFERENCE.state.startsWith("state:")).toBe(true);
  });

  it("example state prints examples/state.json byte for byte", () => {
    const expected = readFileSync(examplePath, "utf8");
    expect(run(["example", "state"])).toEqual({ code: 0, stdout: expected, stderr: "" });
  });

  it("check accepts the example", () => {
    expect(run(["check", examplePath])).toEqual({ code: 0, stdout: "ok\n", stderr: "" });
  });

  it("check rejects a history state with exit 1 and the exact message", () => {
    const path = write((d) => d.states.push({ id: "h", kind: "history" }));
    expect(run(["check", path])).toEqual({
      code: 1,
      stdout: "",
      stderr:
        'error  states[10].kind: "history" states are not supported (basic notation only) \u2192 use kind initial, final, exception, or a plain state\n',
    });
  });

  it("check rejects a composite state with exit 1", () => {
    const path = write((d) => (d.states[1].children = ["x"]));
    expect(run(["check", path])).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "error  states[1].children: composite states and regions are not supported (basic notation only) \u2192 flatten the states into one level\n",
    });
  });

  it("make draws the example: exit 0, a html file and its path", () => {
    const out = join(dir, "s.html");
    const r = run(["make", examplePath, "-o", out]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe(out);
    const html = readFileSync(out, "utf8");
    expect(html).toContain('class="diagram t-state"');
    expect(html).toContain("Exceptional state (dashed)");
  });

  it("make --json reports ok", () => {
    const r = run(["make", examplePath, "--json", "-o", join(dir, "s.html")]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('"ok":true');
    expect(r.stdout).not.toContain("render-unavailable");
  });

  it("make still reports validation errors first and writes nothing", () => {
    const out = join(dir, "bad.html");
    const path = write((d) => d.states.push({ id: "h", kind: "history" }));
    const r = run(["make", path, "-o", out]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("history");
    expect(existsSync(out)).toBe(false);
  });

  it("an unknown type lists state", () => {
    expect(run(["check", "-"], '{"type":"zzzzzz","title":"T"}').stderr).toContain(
      "use one of: architecture, workflow, erd, sequence, chen, state",
    );
  });
});
