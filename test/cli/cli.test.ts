// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { REFERENCE } from "../../src/cli/reference.js";

const BIN = resolve("dist/cli/main.js");
const USAGE_TAIL = 'run "trazo --help" for usage\n';

const valid = {
  type: "architecture",
  title: "Tiny",
  nodes: [{ id: "a" }, { id: "b" }],
  edges: ["a -> b"],
};
const withWarning = { ...valid, edges: ["a -> b", "a -> b"] };
const invalid = { ...valid, edges: ["a -> zz"] };
const INVALID_STDERR = 'error  edges[0].to: unknown node "zz"\n';
const WARNING_LINE = "warn   edges[1]: same as edges[0]\n";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "trazo-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], input?: string | Buffer) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: dir,
    encoding: "utf8",
    ...(input === undefined ? {} : { input }),
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function write(name: string, value: unknown): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value),
  );
  return path;
}

const usageError = (message: string) => `error: ${message}\n${USAGE_TAIL}`;

describe("make", () => {
  it("writes html next to the input and prints the absolute path", () => {
    write("d.json", valid);
    const r = run(["make", "d.json"]);
    expect(r).toEqual({ code: 0, stdout: `${join(dir, "d.html")}\n`, stderr: "" });
    expect(readFileSync(join(dir, "d.html"), "utf8").startsWith("<!doctype html>")).toBe(true);
  });

  it("keeps the input's directory for the default output", () => {
    mkdirSync(join(dir, "sub"));
    write("sub/checkout.json", valid);
    const r = run(["make", "sub/checkout.json"]);
    expect(r).toEqual({ code: 0, stdout: `${join(dir, "sub", "checkout.html")}\n`, stderr: "" });
    expect(existsSync(join(dir, "sub", "checkout.html"))).toBe(true);
  });

  it("honours -o and --out", () => {
    write("d.json", valid);
    expect(run(["make", "d.json", "-o", "x.html"])).toEqual({
      code: 0,
      stdout: `${join(dir, "x.html")}\n`,
      stderr: "",
    });
    expect(run(["make", "d.json", "--out", "y.html"]).stdout).toBe(`${join(dir, "y.html")}\n`);
    expect(existsSync(join(dir, "d.html"))).toBe(false);
    expect(existsSync(join(dir, "y.html"))).toBe(true);
  });

  it("writes html to stdout with -o -", () => {
    write("d.json", valid);
    const r = run(["make", "d.json", "-o", "-"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.startsWith("<!doctype html>")).toBe(true);
    expect(existsSync(join(dir, "d.html"))).toBe(false);
  });

  it("applies --theme dark", () => {
    write("d.json", valid);
    const r = run(["make", "d.json", "--theme", "dark"]);
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, "d.html"), "utf8")).toContain('data-theme="dark"');
  });

  it("reads stdin and writes html to stdout", () => {
    const r = run(["make", "-"], JSON.stringify(valid));
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.startsWith("<!doctype html>")).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("reports an output that cannot be written and leaves no temp file", () => {
    write("d.json", valid);
    write("blocker", "i am a file");
    const r = run(["make", "d.json", "-o", "blocker/x.html"]);
    // mkdir under a regular file fails with EEXIST on Windows and ENOTDIR elsewhere
    const cause = /\((E[A-Z]+)\)/.exec(r.stderr)?.[1];
    expect(["EEXIST", "ENOTDIR"]).toContain(cause);
    expect(r).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError(`cannot write "blocker/x.html" (${cause})`),
    });
    expect(readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
  });

  it("reads stdin and honours -o", () => {
    const r = run(["make", "-", "-o", "s.html"], JSON.stringify(valid));
    expect(r).toEqual({ code: 0, stdout: `${join(dir, "s.html")}\n`, stderr: "" });
    expect(existsSync(join(dir, "s.html"))).toBe(true);
  });

  it("prints warnings to stderr and still succeeds", () => {
    write("d.json", withWarning);
    const r = run(["make", "d.json"]);
    expect(r).toEqual({ code: 0, stdout: `${join(dir, "d.html")}\n`, stderr: WARNING_LINE });
  });

  it("rejects an invalid diagram without creating the output", () => {
    write("d.json", invalid);
    const r = run(["make", "d.json"]);
    expect(r).toEqual({ code: 1, stdout: "", stderr: INVALID_STDERR });
    expect(existsSync(join(dir, "d.html"))).toBe(false);
  });

  it("leaves an existing output byte-identical on invalid input", () => {
    write("d.json", invalid);
    const out = write("d.html", "previous contents");
    const r = run(["make", "d.json"]);
    expect(r).toEqual({ code: 1, stdout: "", stderr: INVALID_STDERR });
    expect(readFileSync(out, "utf8")).toBe("previous contents");
  });

  it("reports invalid JSON with line and column", () => {
    write("d.json", '{"type": }');
    const r = run(["make", "d.json"]);
    expect(r).toEqual({
      code: 1,
      stdout: "",
      stderr:
        "error  $: invalid JSON at line 1, column 10 → look for a trailing comma, a missing quote or an unescaped character there\n",
    });
  });

  it("prints a json success line", () => {
    write("d.json", valid);
    const r = run(["make", "d.json", "--json"]);
    expect(r).toEqual({
      code: 0,
      stdout: `${JSON.stringify({ ok: true, output: join(dir, "d.html"), issues: [] })}\n`,
      stderr: "",
    });
  });

  it("includes warnings in the json success line", () => {
    write("d.json", withWarning);
    const r = run(["make", "d.json", "--json"]);
    expect(r.code).toBe(0);
    expect(r.stderr).toBe("");
    const line = JSON.parse(r.stdout) as { ok: boolean; issues: { code: string }[] };
    expect(line.ok).toBe(true);
    expect(line.issues.map((i) => i.code)).toEqual(["edge/duplicate"]);
  });

  it("prints a json failure line", () => {
    write("d.json", invalid);
    const r = run(["make", "d.json", "--json"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toBe("");
    expect(r.stdout.endsWith("\n")).toBe(true);
    expect(JSON.parse(r.stdout)).toEqual({
      ok: false,
      issues: [
        {
          severity: "error",
          code: "ref/unknown-node",
          path: "edges[0].to",
          message: 'unknown node "zz"',
        },
      ],
    });
    expect(existsSync(join(dir, "d.html"))).toBe(false);
  });

  it("rejects --json when html goes to stdout", () => {
    write("d.json", valid);
    expect(run(["make", "d.json", "-o", "-", "--json"])).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError("--json cannot be combined with html on stdout"),
    });
  });
});

const utf16le = (text: string) =>
  Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
const utf16be = (text: string) =>
  Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]);
const utf8bom = (text: string) =>
  Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]);

describe("check", () => {
  const ok = { code: 0, stdout: "ok\n", stderr: "" };
  const text = JSON.stringify(valid);

  it.each([
    ["UTF-16LE", utf16le],
    ["UTF-16BE", utf16be],
    ["UTF-8", utf8bom],
  ])("reads a %s file with a BOM", (_name, encode) => {
    write("d.json", encode(text));
    expect(run(["check", "d.json"])).toEqual(ok);
  });

  it("reads UTF-16LE with a BOM from stdin", () => {
    expect(run(["check", "-"], utf16le(text))).toEqual(ok);
  });

  it("make gives the same html for a UTF-16LE input as for UTF-8", () => {
    write("a.json", text);
    write("b.json", utf16le(text));
    expect(run(["make", "a.json", "-o", "a.html"]).code).toBe(0);
    expect(run(["make", "b.json", "-o", "b.html"]).code).toBe(0);
    expect(readFileSync(join(dir, "b.html")).equals(readFileSync(join(dir, "a.html")))).toBe(true);
  });

  it("prints ok and writes nothing", () => {
    write("d.json", valid);
    expect(run(["check", "d.json"])).toEqual({ code: 0, stdout: "ok\n", stderr: "" });
    expect(existsSync(join(dir, "d.html"))).toBe(false);
  });

  it("reads stdin", () => {
    expect(run(["check", "-"], JSON.stringify(valid))).toEqual({
      code: 0,
      stdout: "ok\n",
      stderr: "",
    });
  });

  it("prints warnings to stderr", () => {
    write("d.json", withWarning);
    expect(run(["check", "d.json"])).toEqual({ code: 0, stdout: "ok\n", stderr: WARNING_LINE });
  });

  it("reports an invalid diagram", () => {
    write("d.json", invalid);
    expect(run(["check", "d.json"])).toEqual({ code: 1, stdout: "", stderr: INVALID_STDERR });
  });

  it("prints json shapes", () => {
    write("ok.json", valid);
    write("bad.json", invalid);
    expect(run(["check", "ok.json", "--json"])).toEqual({
      code: 0,
      stdout: '{"ok":true,"issues":[]}\n',
      stderr: "",
    });
    const bad = run(["check", "bad.json", "--json"]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toBe("");
    expect((JSON.parse(bad.stdout) as { ok: boolean }).ok).toBe(false);
  });
});

describe("usage errors", () => {
  it("suggests a command", () => {
    expect(run(["mkae", "d.json"])).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError('unknown command "mkae" (did you mean "make"?)'),
    });
  });

  it("reports an unknown command without a suggestion", () => {
    expect(run(["zzzzzz"]).stderr).toBe(usageError('unknown command "zzzzzz"'));
  });

  it("reports a missing input", () => {
    expect(run(["make"])).toEqual({ code: 2, stdout: "", stderr: usageError("missing <input>") });
    expect(run([])).toEqual({ code: 2, stdout: "", stderr: usageError("missing command") });
  });

  it("reports an unknown option", () => {
    const r = run(["make", "d.json", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe(usageError('unknown option "--bogus"'));
  });

  it("suggests the closest long option", () => {
    expect(run(["make", "d.json", "--output", "x.html"])).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError('unknown option "--output" (did you mean "--out"?)'),
    });
  });

  it("suggests make when the first argument looks like a file", () => {
    for (const name of ["x.json", "X.JSON", "dir/x", "dir\\x"]) {
      expect(run([name])).toEqual({
        code: 2,
        stdout: "",
        stderr: usageError(`unknown command "${name}" (did you mean "trazo make ${name}"?)`),
      });
    }
  });

  it("reports a bad theme", () => {
    write("d.json", valid);
    expect(run(["make", "d.json", "--theme", "blue"])).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError('invalid --theme "blue" (use light or dark)'),
    });
  });

  it("reports a missing file", () => {
    expect(run(["make", "nope.json"])).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError('cannot read "nope.json"'),
    });
  });
});

describe("--help and --version", () => {
  it("prints usage for --help and -h", () => {
    for (const flag of ["--help", "-h"]) {
      const r = run([flag]);
      expect(r.code).toBe(0);
      expect(r.stderr).toBe("");
      for (const word of ["trazo make", "trazo check", "--out", "--theme", "--json", "--version"]) {
        expect(r.stdout).toContain(word);
      }
      expect(
        r.stdout.endsWith(
          "\nFind trazo useful? Star it on GitHub: https://github.com/heidenber/trazo\n",
        ),
      ).toBe(true);
    }
  });

  it("prints the version from package.json", () => {
    const { version } = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      version: string;
    };
    for (const flag of ["--version", "-v"]) {
      expect(run([flag])).toEqual({ code: 0, stdout: `${version}\n`, stderr: "" });
    }
  });
});

describe("workflow diagrams", () => {
  const flow = {
    type: "workflow",
    title: "Tiny flow",
    steps: [
      { id: "a", kind: "start" },
      { id: "b", label: "Ok?", kind: "decision" },
      { id: "c", kind: "end" },
    ],
    edges: ["a -> b", "b -> c: yes"],
  };

  it("makes html for a workflow", () => {
    write("f.json", {
      ...flow,
      steps: [...flow.steps, { id: "d", kind: "end" }],
      edges: ["a -> b", "b -> c: yes", "b -> d: no"],
    });
    const r = run(["make", "f.json"]);
    expect(r).toEqual({ code: 0, stdout: `${join(dir, "f.html")}\n`, stderr: "" });
    expect(readFileSync(join(dir, "f.html"), "utf8")).toContain("t-shape-diamond");
  });

  it("rejects a decision with one outgoing edge", () => {
    write("f.json", flow);
    const r = run(["make", "f.json"]);
    expect(r).toEqual({
      code: 1,
      stdout: "",
      stderr: "error  steps[1]: decision needs at least 2 outgoing edges (has 1)\n",
    });
    expect(existsSync(join(dir, "f.html"))).toBe(false);
  });

  it("suggests workflow for a misspelt type", () => {
    write("f.json", { ...flow, type: "workflwo" });
    const r = run(["make", "f.json"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toContain('"workflow"');
    expect(existsSync(join(dir, "f.html"))).toBe(false);
  });
});

describe("erd diagrams", () => {
  const schema = {
    type: "erd",
    title: "Tiny schema",
    tables: [
      { id: "users", columns: ["id uuid pk"] },
      { id: "orders", columns: ["id uuid pk", "user_id uuid fk users.id"] },
    ],
  };

  it("makes html for an erd", () => {
    write("s.json", schema);
    const r = run(["make", "s.json"]);
    expect(r).toEqual({ code: 0, stdout: `${join(dir, "s.html")}\n`, stderr: "" });
    const html = readFileSync(join(dir, "s.html"), "utf8");
    expect(html).toContain("t-shape-table");
    expect(html).toContain("url(#t-end-zero-or-many)");
  });

  it("rejects an fk to an unknown column with a suggestion", () => {
    write("s.json", {
      ...schema,
      tables: [
        schema.tables[0],
        { id: "orders", columns: ["id uuid pk", "user_id uuid fk users.idd"] },
      ],
    });
    const r = run(["make", "s.json"]);
    expect(r).toEqual({
      code: 1,
      stdout: "",
      stderr:
        'error  tables[1].columns[1]: unknown column "users.idd" → did you mean "users.id"?\n',
    });
    expect(existsSync(join(dir, "s.html"))).toBe(false);
  });
});

describe("sequence diagrams", () => {
  const talk = {
    type: "sequence",
    title: "Tiny talk",
    participants: [{ id: "api" }, { id: "pg", kind: "database" }],
    messages: ["api -> pg: SELECT", "pg --> api: rows"],
  };

  it("makes html for a sequence", () => {
    write("q.json", talk);
    const r = run(["make", "q.json"]);
    expect(r).toEqual({ code: 0, stdout: `${join(dir, "q.html")}\n`, stderr: "" });
    const html = readFileSync(join(dir, "q.html"), "utf8");
    expect(html).toContain("t-lifeline");
    expect(html).toContain("url(#t-arrowhead-open)");
  });

  it("rejects a message to an unknown participant with a suggestion", () => {
    write("q.json", { ...talk, messages: ["api -> pgg: SELECT"] });
    const r = run(["make", "q.json"]);
    expect(r).toEqual({
      code: 1,
      stdout: "",
      stderr: 'error  messages[0]: unknown participant "pgg" \u2192 did you mean "pg"?\n',
    });
    expect(existsSync(join(dir, "q.html"))).toBe(false);
  });
});

const TYPES = ["architecture", "workflow", "erd", "sequence"] as const;

describe("schema", () => {
  it.each(TYPES)("prints the reference for %s", (type) => {
    expect(run(["schema", type])).toEqual({ code: 0, stdout: REFERENCE[type], stderr: "" });
  });

  it.each([
    [["schema"], "missing <type>"],
    [["schema", "erd", "x"], 'unexpected argument "x"'],
    [["schema", "erd", "--out", "a"], 'option "--out" only applies to make'],
    [["schema", "erd", "--theme", "dark"], 'option "--theme" only applies to make'],
    [["schema", "erd", "--json"], 'option "--json" only applies to make and check'],
    [["schema", "erdd"], 'unknown type "erdd" (did you mean "erd"?)'],
    [["schema", "foo"], 'unknown type "foo" (use one of: architecture, workflow, erd, sequence)'],
  ])("rejects %j", (args, message) => {
    expect(run(args)).toEqual({ code: 2, stdout: "", stderr: usageError(message) });
  });
});

describe("example", () => {
  it.each(TYPES)("prints examples/%s.json byte for byte", (type) => {
    const expected = readFileSync(resolve(`examples/${type}.json`), "utf8");
    expect(run(["example", type])).toEqual({ code: 0, stdout: expected, stderr: "" });
  });

  it.each([
    [["example"], "missing <type>"],
    [["example", "erd", "x"], 'unexpected argument "x"'],
    [["example", "erd", "--out", "a"], 'option "--out" only applies to make'],
    [["example", "erd", "--json"], 'option "--json" only applies to make and check'],
    [["example", "foo"], 'unknown type "foo" (use one of: architecture, workflow, erd, sequence)'],
  ])("rejects %j", (args, message) => {
    expect(run(args)).toEqual({ code: 2, stdout: "", stderr: usageError(message) });
  });

  it("pipes into make", () => {
    const example = run(["example", "erd"]).stdout;
    const r = run(["make", "-", "-o", "-"], example);
    expect(r.code).toBe(0);
    expect(r.stdout.startsWith("<!doctype html>")).toBe(true);
  });

  it("lists the new commands in help and still suggests for typos", () => {
    const help = run(["--help"]).stdout;
    expect(help).toContain("  trazo schema <type>\n");
    expect(help).toContain("  trazo example <type>\n");
    expect(run(["schem"])).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError('unknown command "schem" (did you mean "schema"?)'),
    });
    expect(run(["mkae", "x"]).stderr).toBe(
      usageError('unknown command "mkae" (did you mean "make"?)'),
    );
  });

  it("keeps check behavior unchanged", () => {
    write("w.json", withWarning);
    expect(run(["check", "w.json", "--json"]).stdout.startsWith('{"ok":true')).toBe(true);
    expect(run(["check", "w.json", "--out", "x"])).toEqual({
      code: 2,
      stdout: "",
      stderr: usageError('option "--out" only applies to make'),
    });
    expect(run(["check"])).toEqual({ code: 2, stdout: "", stderr: usageError("missing <input>") });
  });
});
