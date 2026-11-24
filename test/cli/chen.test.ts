// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REFERENCE } from "../../src/cli/reference.js";

const BIN = resolve("dist/cli/main.js");
const examplePath = resolve("examples/chen.json");

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trazo-chen-"));
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

const ternary = () => {
  const doc = JSON.parse(readFileSync(examplePath, "utf8"));
  doc.relationships[0].participants.push({ entity: "course", cardinality: "M" });
  const path = join(dir, "ternary.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
};

describe("chen CLI", () => {
  it("schema chen prints the reference", () => {
    expect(run(["schema", "chen"])).toEqual({ code: 0, stdout: REFERENCE.chen, stderr: "" });
    expect(REFERENCE.chen.startsWith("chen:")).toBe(true);
  });

  it("example chen prints examples/chen.json byte for byte", () => {
    const expected = readFileSync(examplePath, "utf8");
    expect(run(["example", "chen"])).toEqual({ code: 0, stdout: expected, stderr: "" });
  });

  it("check accepts the example", () => {
    expect(run(["check", examplePath])).toEqual({ code: 0, stdout: "ok\n", stderr: "" });
  });

  it("check rejects a ternary relationship with exit 1 and the exact message", () => {
    expect(run(["check", ternary()])).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "error  relationships[0].participants: ternary relationships are not supported yet (found 3 participants, expected 2) \u2192 use two participants, or model it as two binary relationships with an entity of its own\n",
    });
  });

  it("make fails cleanly until rendering lands: exit 1, no file", () => {
    const out = join(dir, "u.html");
    expect(run(["make", examplePath, "-o", out])).toEqual({
      code: 1,
      stdout: "",
      stderr:
        'error  $: chen diagrams cannot be rendered yet \u2192 "trazo check" validates them already; rendering arrives in a later release\n',
    });
    expect(existsSync(out)).toBe(false);
  });

  it("make --json reports the same error", () => {
    const r = run(["make", examplePath, "--json", "-o", join(dir, "u.html")]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: false,
      issues: [
        {
          severity: "error",
          code: "chen/render-unavailable",
          path: "$",
          message: "chen diagrams cannot be rendered yet",
          hint: '"trazo check" validates them already; rendering arrives in a later release',
        },
      ],
    });
  });

  it("make still reports validation errors first", () => {
    expect(run(["make", ternary(), "-o", join(dir, "t.html")]).stderr).toContain(
      "ternary relationships are not supported yet",
    );
  });

  it("unknown types list chen", () => {
    expect(run(["schema", "foo"]).stderr).toContain(
      "use one of: architecture, workflow, erd, sequence, chen",
    );
  });
});
