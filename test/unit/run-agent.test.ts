// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  agentEnv,
  buildAgentArgs,
  buildPrompt,
  defaultSandboxRoot,
  modelDir,
  opencodeConfig,
  opencodeEnv,
  opencodeRunEnv,
  parseArgs,
  parseOpencodeStream,
  parseStream,
  planRuns,
  runName,
  shellCommandLine,
  shimExePath,
  shimFiles,
  skillSegments,
} from "../../bench/run-agent-lib.mjs";

const root = resolve(__dirname, "../..");
const tasks = ["arch-shop", "wf-expenses"];
const line = (o: unknown) => JSON.stringify(o);
const bash = (id: string, command: string) =>
  line({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
  });
const write = (id: string, file: string) =>
  line({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name: "Write", input: { file_path: file, content: "{}" } }],
    },
  });
const edit = (id: string, file: string) =>
  line({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Edit", input: { file_path: file } }] },
  });
const res = (id: string, content: string, isError = false) =>
  line({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  });
const result = (extra: object = {}) =>
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    usage: {
      input_tokens: 120,
      output_tokens: 45,
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 700,
    },
    ...extra,
  });

describe("parseStream", () => {
  it("reads check and make chained in one Bash call", () => {
    const text = [
      write("a", "/s/shop.json"),
      res("a", "ok"),
      bash("b", "trazo check shop.json && trazo make shop.json -o diagram.html"),
      res("b", "ok\nC:/s/diagram.html"),
      result(),
    ].join("\n");
    const stats = parseStream(text);
    expect(stats.firstTryOk).toBe(true);
    expect(stats.failedCommands).toBe(0);
    expect(stats.lastMakeInput).toBe("shop.json");
  });

  it("counts a failed chained call once and not as a first-try make", () => {
    const text = [
      bash("b", "trazo check shop.json && trazo make shop.json -o diagram.html"),
      res("b", "Exit code 1\nerror  nodes[0]: ...", true),
      edit("c", "/s/shop.json"),
      bash("d", "trazo check shop.json && trazo make shop.json -o diagram.html"),
      res("d", "ok"),
      result(),
    ].join("\n");
    const stats = parseStream(text);
    expect(stats.failedCommands).toBe(1);
    expect(stats.repairs).toBe(1);
    expect(stats.firstTryOk).toBe(false);
  });

  it("ignores a denied call that mixes other commands with trazo", () => {
    const text = [
      bash("a", "cat > shop.json <<'EOF'\n{}\nEOF\ntrazo make shop.json -o diagram.html"),
      res("a", "Contains brace with quote character (expansion obfuscation)", true),
      write("b", "/s/shop.json"),
      bash("c", "trazo make shop.json -o diagram.html"),
      res("c", "C:/s/diagram.html"),
      result(),
    ].join("\n");
    const stats = parseStream(text);
    expect(stats.failedCommands).toBe(0);
    expect(stats.repairs).toBe(0);
    expect(stats.firstTryOk).toBe(true);
  });

  it("counts a mixed call that the sandbox allowed, and a failed one as a failure", () => {
    const ok = [
      bash("a", "trazo make wf.json -o diagram.html && rm wf.json && ls diagram.html"),
      res("a", "rm in 'C:/s/wf.json' needs approval.", true),
      bash("b", "trazo make wf.json -o diagram.html && ls diagram.html"),
      res("b", "C:/s/diagram.html\ndiagram.html"),
      result(),
    ].join("\n");
    const okStats = parseStream(ok);
    expect(okStats.failedCommands).toBe(0);
    expect(okStats.firstTryOk).toBe(true);
    expect(okStats.lastMakeInput).toBe("wf.json");

    const bad = [
      bash("a", "trazo make wf.json -o diagram.html && ls diagram.html"),
      res("a", "Exit code 1\nerror  steps[0]: ...", true),
      result(),
    ].join("\n");
    const badStats = parseStream(bad);
    expect(badStats.failedCommands).toBe(1);
    expect(badStats.firstTryOk).toBe(false);
  });

  it("counts a clean first-try run", () => {
    const text = [
      line({ type: "system", subtype: "init" }),
      write("a", "/s/diagram.json"),
      res("a", "ok"),
      bash("b", "trazo check diagram.json"),
      res("b", "ok"),
      bash("c", "trazo make diagram.json -o diagram.html"),
      res("c", "wrote diagram.html"),
      result(),
    ].join("\n");
    expect(parseStream(text)).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      cacheCreationTokens: 300,
      cacheReadTokens: 700,
      failedCommands: 0,
      repairs: 0,
      firstTryOk: true,
      hasResult: true,
      resultIsError: false,
      lastMakeInput: "diagram.json",
    });
  });

  it("counts one failed check, one repair, then success", () => {
    const text = [
      bash("a", "trazo check diagram.json"),
      res("a", "Exit code 1\nnodes.0.kind: unknown", true),
      edit("b", "/s/diagram.json"),
      res("b", "ok"),
      write("w", "/s/notes.md"),
      bash("c", "trazo check diagram.json"),
      res("c", "ok"),
      bash("d", "trazo make diagram.json -o diagram.html"),
      res("d", "wrote"),
      result(),
    ].join("\n");
    const stats = parseStream(text);
    expect(stats.failedCommands).toBe(1);
    expect(stats.repairs).toBe(1);
    expect(stats.firstTryOk).toBe(true);
  });

  it("treats a make that fails first as not first try, and detects failure by exit text", () => {
    const text = [
      bash("a", "trazo make d.json -o d.html"),
      res("a", "Exit code 1\nerror", false),
      write("b", "d.json"),
      bash("c", "trazo make d.json -o d.html"),
      res("c", "wrote"),
      bash("e", "ls"),
      res("e", "Exit code 2", true),
      result(),
    ].join("\n");
    const stats = parseStream(text);
    expect(stats.firstTryOk).toBe(false);
    expect(stats.failedCommands).toBe(1);
    expect(stats.repairs).toBe(1);
  });

  it("does not count json edits before the first failure", () => {
    const text = [
      write("a", "d.json"),
      edit("b", "d.json"),
      bash("c", "trazo make d.json"),
      res("c", "ok"),
      result(),
    ].join("\n");
    expect(parseStream(text).repairs).toBe(0);
  });

  it("returns zeros when there is no result message (timeout) and ignores bad lines", () => {
    const text = ["not json", bash("a", "trazo check d.json"), "{broken"].join("\n");
    expect(parseStream(text)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      failedCommands: 0,
      repairs: 0,
      firstTryOk: false,
      hasResult: false,
      resultIsError: false,
      lastMakeInput: null,
    });
    expect(parseStream("").hasResult).toBe(false);
  });
});

describe("parseArgs", () => {
  it("applies the defaults", () => {
    const o = parseArgs(["--model", "m1"], tasks, "2026-11-01");
    expect(o).toMatchObject({
      model: "m1",
      tasks,
      conditions: ["skill", "no-skill"],
      runs: 3,
      agentCmd: "claude",
      timeout: 600,
      dryRun: false,
      resume: false,
    });
    expect(o.out.replace(/\\/g, "/")).toMatch(
      /bench\/results\/2026-11-01-agent-claude-code\.json$/,
    );
  });

  it("reads every option", () => {
    const o = parseArgs(
      [
        "--model",
        "m",
        "--task",
        "wf-expenses",
        "--task",
        "arch-shop",
        "--condition",
        "skill",
        "--runs",
        "1",
        "--out",
        "x.json",
        "--agent-cmd",
        "fake",
        "--timeout",
        "5",
        "--dry-run",
        "--resume",
      ],
      tasks,
      "2026-11-01",
    );
    expect(o).toMatchObject({
      tasks: ["wf-expenses", "arch-shop"],
      conditions: ["skill"],
      runs: 1,
      out: "x.json",
      agentCmd: "fake",
      timeout: 5,
      dryRun: true,
      resume: true,
    });
  });

  it("rejects bad input with a clear message", () => {
    expect(() => parseArgs([], tasks, "d")).toThrow("--model is required");
    expect(() => parseArgs(["--model", "m", "--task", "nope"], tasks, "d")).toThrow(
      "unknown task: nope",
    );
    expect(() => parseArgs(["--model", "m", "--condition", "x"], tasks, "d")).toThrow(
      "--condition must be skill, no-skill or both",
    );
    expect(() => parseArgs(["--model", "m", "--runs", "0"], tasks, "d")).toThrow(
      "--runs needs a positive integer",
    );
    expect(() => parseArgs(["--model", "m", "--bogus"], tasks, "d")).toThrow(
      "unknown option: --bogus",
    );
    expect(() => parseArgs(["--model"], tasks, "d")).toThrow("--model needs a value");
  });
});

describe("plan and command", () => {
  it("plans task x condition x run in a stable order and names sandboxes", () => {
    const plan = planRuns(["a", "b"], ["skill", "no-skill"], 2);
    expect(plan).toHaveLength(8);
    expect(plan[0]).toEqual({ task: "a", condition: "skill", run: 1 });
    expect(runName(plan[3] as never)).toBe("a-no-skill-2");
  });

  it("builds the prompt and the fixed claude arguments", () => {
    const prompt = buildPrompt("Draw a thing.");
    expect(prompt.startsWith("Draw a thing.")).toBe(true);
    expect(prompt).toContain("diagram.html");
    expect(prompt).toContain("`trazo`");
    expect(prompt.toLowerCase()).not.toContain("skill");
    expect(buildAgentArgs("P", "m1")).toEqual([
      "-p",
      "P",
      "--model",
      "m1",
      "--setting-sources",
      "project",
      "--strict-mcp-config",
      "--allowedTools",
      "Read",
      "Write",
      "Edit",
      "Bash(trazo:*)",
      "--output-format",
      "stream-json",
      "--verbose",
    ]);
  });

  it("isolates the agent from user CLAUDE.md, auto memory and git context and puts the shim first on PATH", () => {
    const base = { Path: "C:\\bin", HOME: "/h" };
    const env = agentEnv(base, "C:\\shim", "win32");
    expect(env).toEqual({
      Path: "C:\\shim;C:\\bin",
      HOME: "/h",
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS: "1",
    });
    expect(base).toEqual({ Path: "C:\\bin", HOME: "/h" });
    expect(agentEnv({}, "/shim", "linux").PATH).toBe("/shim:");
  });

  it("makes a model id safe as one directory name", () => {
    expect(modelDir("claude-haiku-4-5")).toBe("claude-haiku-4-5");
    expect(modelDir("opencode/deepseek-v4.1-flash-free")).toBe("opencode-deepseek-v4.1-flash-free");
    expect(modelDir("a b:c\\d")).toBe("a-b-c-d");
    for (const bad of ["", ".", ".."]) expect(modelDir(bad)).toBe("model");
  });

  it("makes shims per platform", () => {
    const win = shimFiles("C:\\node.exe", "C:\\r\\dist\\cli\\main.js", "win32").map((f) => f.name);
    expect(win).toEqual(["trazo.cmd", "trazo"]);
    const nix = shimFiles("/usr/bin/node", "/r/dist/cli/main.js", "linux");
    expect(nix.map((f) => f.name)).toEqual(["trazo"]);
    expect(nix[0]?.content).toContain('exec "/usr/bin/node" "/r/dist/cli/main.js" "$@"');
  });
});

// OpenCode events, shaped like the JSONL of `opencode run --format json` (v2.1.3), trimmed.
const ocTokens = (input: number, output: number, reasoning = 0, read = 0, write = 0) => ({
  input,
  output,
  reasoning,
  cache: { read, write },
});
const ocStart = () => line({ type: "step_start", part: { type: "step-start", snapshot: "abc" } });
const ocFinish = (reason: string, tokens?: object) =>
  line({
    type: "step_finish",
    part: { type: "step-finish", reason, cost: 0, ...(tokens ? { tokens } : {}) },
  });
const ocText = (text: string) => line({ type: "text", part: { type: "text", text } });
const ocShell = (command: string, exit: number) =>
  line({
    type: "tool_use",
    part: {
      type: "tool",
      tool: "shell",
      state: {
        status: "completed",
        input: { command, workdir: "/s" },
        output: exit ? "error: bad\n" : "ok\n",
        metadata: { metadata: { status: "completed", exit } },
      },
    },
  });
const ocDenied = (command: string, tool = "shell") =>
  line({
    type: "tool_use",
    part: {
      type: "tool",
      tool,
      state: {
        status: "error",
        input: { command, workdir: "/s" },
        error: `Permission denied: ${tool}`,
      },
    },
  });
const ocFile = (tool: "write" | "edit", path: string) =>
  line({
    type: "tool_use",
    part: {
      type: "tool",
      tool,
      state: {
        status: "completed",
        input: { path, content: "{}" },
        output: "Created file successfully",
        metadata: { metadata: {} },
      },
    },
  });

describe("parseOpencodeStream", () => {
  it("counts a clean first try and sums tokens over the steps", () => {
    const text = [
      ocStart(),
      ocFile("write", "/s/diagram.json"),
      ocFinish("tool-calls", ocTokens(100, 20, 5, 300, 50)),
      ocStart(),
      ocShell("trazo check diagram.json", 0),
      ocFinish("tool-calls", ocTokens(10, 30, 0, 500, 0)),
      ocStart(),
      ocShell("trazo make diagram.json -o diagram.html", 0),
      ocFinish("tool-calls", ocTokens(5, 5, 5, 600)),
      ocStart(),
      ocText("done"),
      ocFinish("stop", ocTokens(1, 1, 0, 700)),
    ].join("\n");
    expect(parseOpencodeStream(text)).toEqual({
      inputTokens: 116,
      outputTokens: 20 + 5 + 30 + 5 + 5 + 1,
      cacheCreationTokens: 50,
      cacheReadTokens: 2100,
      failedCommands: 0,
      repairs: 0,
      firstTryOk: true,
      hasResult: true,
      resultIsError: false,
      lastMakeInput: "diagram.json",
    });
  });

  it("counts a failed check, a json repair, then success", () => {
    const text = [
      ocShell("trazo check diagram.json", 1),
      ocFile("edit", "C:\\s\\diagram.json"),
      ocFile("write", "/s/notes.md"),
      ocShell("trazo check diagram.json", 0),
      ocShell("trazo make diagram.json -o diagram.html", 0),
      ocText("done"),
    ].join("\n");
    const stats = parseOpencodeStream(text);
    expect(stats.failedCommands).toBe(1);
    expect(stats.repairs).toBe(1);
    expect(stats.firstTryOk).toBe(true);
  });

  it("reads check and make chained in one call, and a chained failure is not a first-try make", () => {
    const ok = parseOpencodeStream(
      [
        ocShell("trazo check shop.json && trazo make shop.json -o diagram.html", 0),
        ocText("done"),
      ].join("\n"),
    );
    expect(ok.firstTryOk).toBe(true);
    expect(ok.failedCommands).toBe(0);
    expect(ok.lastMakeInput).toBe("shop.json");

    const bad = parseOpencodeStream(
      [
        ocShell("trazo check shop.json && trazo make shop.json -o diagram.html", 1),
        ocFile("edit", "/s/shop.json"),
        ocShell("trazo check shop.json && trazo make shop.json -o diagram.html", 0),
        ocText("done"),
      ].join("\n"),
    );
    expect(bad.failedCommands).toBe(1);
    expect(bad.repairs).toBe(1);
    expect(bad.firstTryOk).toBe(false);
  });

  it("does not count a call the permissions refused", () => {
    const text = [
      ocDenied("bash -c 'trazo make shop.json -o diagram.html'"),
      ocDenied("ls ."),
      ocFile("write", "/s/shop.json"),
      ocShell("trazo make shop.json -o diagram.html", 0),
      ocText("done"),
    ].join("\n");
    const stats = parseOpencodeStream(text);
    expect(stats.failedCommands).toBe(0);
    expect(stats.repairs).toBe(0);
    expect(stats.firstTryOk).toBe(true);
    expect(stats.lastMakeInput).toBe("shop.json");
  });

  it("treats a make that fails first as not first try and ignores other failing commands", () => {
    const text = [
      ocShell("trazo make d.json -o d.html", 2),
      ocFile("write", "d.json"),
      ocShell("trazo make d.json -o d.html", 0),
      ocShell("ls", 2),
      ocText("done"),
    ].join("\n");
    const stats = parseOpencodeStream(text);
    expect(stats.firstTryOk).toBe(false);
    expect(stats.failedCommands).toBe(1);
    expect(stats.repairs).toBe(1);
  });

  it("has no result when the run was cut off, and ignores bad lines", () => {
    const text = [
      "not json",
      ocStart(),
      ocText("let me check"),
      ocShell("trazo check d.json", 0),
      ocStart(),
      "{broken",
    ].join("\n");
    expect(parseOpencodeStream(text)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      failedCommands: 0,
      repairs: 0,
      firstTryOk: false,
      hasResult: false,
      resultIsError: false,
      lastMakeInput: null,
    });
    expect(parseOpencodeStream("").hasResult).toBe(false);
  });

  it("takes a closing text as the result even when the last step_finish is missing", () => {
    const stats = parseOpencodeStream([ocStart(), ocText("ok")].join("\n"));
    expect(stats.hasResult).toBe(true);
    expect(stats.resultIsError).toBe(false);
  });

  it("reports an error event as an errored result", () => {
    const err = line({
      type: "error",
      error: { type: "provider.no-route", message: "Model unavailable: x/y" },
    });
    const stats = parseOpencodeStream(err);
    expect(stats.hasResult).toBe(true);
    expect(stats.resultIsError).toBe(true);
  });
});

describe("opencode adapter helpers", () => {
  it("builds the opencode arguments and leaves the claude ones as they were", () => {
    expect(buildAgentArgs("P", "opencode/m", "opencode")).toEqual([
      "run",
      "--standalone",
      "-m",
      "opencode/m",
      "--format",
      "json",
      "P",
    ]);
    expect(buildAgentArgs("P", "m1", "claude-code")).toEqual(buildAgentArgs("P", "m1"));
  });

  it("puts the skill where each agent loads project skills", () => {
    expect(skillSegments("claude-code")).toEqual([".claude", "skills", "trazo"]);
    expect(skillSegments("opencode")).toEqual([".opencode", "skills", "trazo"]);
  });

  it("picks the default sandbox root per agent: opencode outside the repository", () => {
    expect(defaultSandboxRoot("claude-code", "vendor/m.1", "/repo", "/tmp")).toBe(
      join("/repo", "tmp", "bench-runs", "vendor-m.1"),
    );
    expect(defaultSandboxRoot("opencode", "opencode/m.1", "/repo", "/tmp")).toBe(
      join("/tmp", "trazo-bench-runs", "opencode-m.1"),
    );
  });

  it("writes an opencode.json that allows read, edit and trazo only", () => {
    const skill = opencodeConfig("skill");
    expect(skill.permission).toEqual({
      "*": "deny",
      read: "allow",
      edit: "allow",
      external_directory: "deny",
      shell: { "*": "deny", "trazo *": "allow" },
      skill: { "*": "deny", trazo: "allow" },
    });
    const none = opencodeConfig("no-skill");
    expect(none.permission).toEqual({ ...skill.permission, skill: "deny" });
  });

  it("sets PWD to the sandbox so OpenCode does not work in the launching folder", () => {
    const base = { PWD: "/repo", INIT_CWD: "/repo", OLDPWD: "/x", KEEP: "1" };
    expect(opencodeRunEnv(base, "/sb")).toEqual({ PWD: "/sb", KEEP: "1" });
    expect(base.PWD).toBe("/repo");
  });

  it("points OpenCode config, data and home into the state folder and drops OPENCODE_* from the user's env", () => {
    const base = {
      Path: "C:\\bin",
      HOME: "/h",
      USERPROFILE: "C:\\u",
      OPENCODE_CONFIG: "x",
      OPENCODE_PERMISSION: "{}",
      KEEP: "1",
    };
    const state = join("/w", "_opencode");
    const env = opencodeEnv(base, "C:\\shim", state, "win32");
    expect(env).toEqual({
      Path: "C:\\shim;C:\\bin",
      KEEP: "1",
      HOME: join(state, "home"),
      USERPROFILE: join(state, "home"),
      XDG_CONFIG_HOME: join(state, "config"),
      XDG_DATA_HOME: join(state, "data"),
      XDG_STATE_HOME: join(state, "state"),
      XDG_CACHE_HOME: join(state, "cache"),
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
    });
    expect(base.OPENCODE_CONFIG).toBe("x");
    expect(opencodeEnv({}, "/shim", state, "linux").PATH).toBe("/shim:");
  });
});

describe("shimExePath", () => {
  const npmShim = [
    "@ECHO off",
    "SETLOCAL",
    'SET "dp0=%~dp0"',
    'IF EXIST "%dp0%\\node.exe" (',
    '  SET "_prog=%dp0%\\node.exe"',
    ") ELSE (",
    '  SET "_prog=node"',
    ")",
    'endLocal & goto #_undefined_# 2>NUL & title %COMSPEC% & "%dp0%\\node_modules\\@opencode\\cli\\bin\\opencode.exe"   %*',
    "",
  ].join("\r\n");
  it("derives the real exe from an npm shim, relative to the shim folder", () => {
    const dir = resolve("some", "npm");
    expect(shimExePath(npmShim, dir)).toBe(
      resolve(dir, "node_modules", "@opencode", "cli", "bin", "opencode.exe"),
    );
  });
  it("accepts the %~dp0 spelling", () => {
    const dir = resolve("x");
    expect(shimExePath('@"%~dp0\\bin\\tool.exe" %*', dir)).toBe(resolve(dir, "bin", "tool.exe"));
  });
  it("returns null for a wrapper that does not reference an exe", () => {
    expect(shimExePath('@echo off\r\nnode "%~dp0\\wrapper.js" %*\r\n', resolve("w"))).toBeNull();
    expect(shimExePath('@echo off\r\n"C:\\other\\opencode.exe" %*\r\n', resolve("w"))).toBeNull();
  });
});

describe("shellCommandLine", () => {
  it("quotes like formatCommandLine for plain arguments", () => {
    expect(shellCommandLine("tool.cmd", ["run", "a b"])).toBe('tool.cmd run "a b"');
  });
  it("throws a clear error when an argument contains a newline", () => {
    expect(() => shellCommandLine("tool.cmd", ["a\n\nb"])).toThrow(/newline/);
    expect(() => shellCommandLine("tool.cmd", ["a\r\nb"])).toThrow(/newline/);
  });
});

const script = join(root, "bench", "run-agent.mjs");
const work = mkdtempSync(join(tmpdir(), "trazo-run-agent-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const run = (args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 120000 });

describe("run-agent.mjs", () => {
  it("dry-run prints the plan and the command lines and runs nothing", () => {
    const out = join(work, "dry.json");
    const r = run([
      "--model",
      "m1",
      "--task",
      "arch-shop",
      "--condition",
      "skill",
      "--runs",
      "1",
      "--dry-run",
      "--out",
      out,
      "--sandbox-root",
      join(work, "sb-dry"),
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("arch-shop-skill-1");
    expect(r.stdout).toContain("claude -p");
    expect(r.stdout).toContain("--model m1");
    expect(r.stdout).toContain("--allowedTools Read Write Edit Bash(trazo:*)");
    expect(r.stdout).toContain("1 run(s) planned");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(work, "sb-dry"))).toBe(false);
    expect(r.stdout).toContain(`cwd: ${join(work, "sb-dry", "arch-shop-skill-1")}`);
  });

  it("dry-run defaults the sandbox root to a per-model folder", () => {
    const out = join(work, "dry-default.json");
    const r = run([
      "--model",
      "vendor/m.1",
      "--task",
      "arch-shop",
      "--condition",
      "skill",
      "--runs",
      "1",
      "--dry-run",
      "--out",
      out,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `cwd: ${join(root, "tmp", "bench-runs", "vendor-m.1", "arch-shop-skill-1")}`,
    );
    expect(r.stdout).toContain("1 run(s) planned");
    expect(existsSync(out)).toBe(false);
    expect(existsSync(join(root, "tmp", "bench-runs", "vendor-m.1"))).toBe(false);
  });

  it("keeps the claude-code defaults when --agent is claude-code or absent", () => {
    const common = [
      "--model",
      "vendor/m.1",
      "--task",
      "arch-shop",
      "--condition",
      "skill",
      "--runs",
      "1",
      "--dry-run",
    ];
    for (const extra of [[], ["--agent", "claude-code"]]) {
      const r = run([...common, ...extra]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(
        `cwd: ${join(root, "tmp", "bench-runs", "vendor-m.1", "arch-shop-skill-1")}`,
      );
      expect(r.stdout).toContain("claude -p");
      expect(r.stdout).toContain("--setting-sources project");
    }
    const o = parseArgs(["--model", "m", "--agent", "claude-code"], tasks, "2026-11-01");
    expect(o).toMatchObject({ agent: "claude-code", agentCmd: "claude" });
    expect(o.out).toBe("bench/results/2026-11-01-agent-claude-code.json");
  });

  it("dry-run for opencode prints the opencode command and a sandbox outside the repository", () => {
    const out = join(work, "dry-oc.json");
    const r = run([
      "--agent",
      "opencode",
      "--model",
      "opencode/deepseek-v4.1-flash-free",
      "--task",
      "arch-shop",
      "--condition",
      "skill",
      "--runs",
      "1",
      "--dry-run",
      "--out",
      out,
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      "opencode run --standalone -m opencode/deepseek-v4.1-flash-free --format json",
    );
    expect(r.stdout).toContain(
      `cwd: ${join(tmpdir(), "trazo-bench-runs", "opencode-deepseek-v4.1-flash-free", "arch-shop-skill-1")}`,
    );
    expect(r.stdout).toContain("1 run(s) planned");
    expect(existsSync(out)).toBe(false);
    const explicit = run([
      "--agent",
      "opencode",
      "--model",
      "m",
      "--task",
      "arch-shop",
      "--runs",
      "1",
      "--dry-run",
      "--sandbox-root",
      join(work, "sb-oc"),
    ]);
    expect(explicit.stdout).toContain(`cwd: ${join(work, "sb-oc", "arch-shop-skill-1")}`);
  });

  it("rejects an unknown agent with exit 2", () => {
    const r = run(["--agent", "gpt", "--model", "m", "--dry-run"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("error: --agent must be claude-code or opencode");
  });

  it("fails on a missing model with exit 2", () => {
    const r = run(["--dry-run"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("error: --model is required");
  });

  const hasDist = existsSync(join(root, "dist", "cli", "main.js"));
  it.skipIf(!hasDist)(
    "runs a fake agent end to end: sandbox, shim, skill copy, record, resume",
    () => {
      const fake = join(work, "fake-agent.mjs");
      writeFileSync(
        fake,
        [
          'import { execSync } from "node:child_process";',
          'import { existsSync, writeFileSync } from "node:fs";',
          'const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
          'writeFileSync("diagram.json", sh("trazo example architecture"));',
          'sh("trazo check diagram.json");',
          'sh("trazo make diagram.json -o diagram.html");',
          'const skill = existsSync(".claude/skills/trazo/SKILL.md");',
          "const out = (o) => console.log(JSON.stringify(o));",
          'out({ type: "assistant", message: { content: [{ type: "tool_use", id: "1", name: "Bash", input: { command: "trazo make diagram.json -o diagram.html" } }] } });',
          'out({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "1", content: "ok", is_error: false }] } });',
          'out({ type: "result", subtype: "success", is_error: false, result: "skill=" + skill + " args=" + process.argv.slice(2).join("|"), usage: { input_tokens: 10, output_tokens: 5 } });',
          "",
        ].join("\n"),
      );
      const out = join(work, "e2e.json");
      const sb = join(work, "sb");
      const args = [
        "--model",
        "m1",
        "--task",
        "arch-shop",
        "--runs",
        "1",
        "--agent-cmd",
        fake,
        "--out",
        out,
        "--sandbox-root",
        sb,
      ];
      const r = run(args);
      expect(r.status, r.stderr).toBe(0);

      const data = JSON.parse(readFileSync(out, "utf8"));
      expect(data).toMatchObject({
        kind: "agent",
        agent: "claude-code",
        model: "m1",
        runsPerTask: 1,
      });
      expect(data.runs).toHaveLength(2);
      const by = Object.fromEntries(data.runs.map((x: { condition: string }) => [x.condition, x]));
      expect(by.skill).toMatchObject({
        task: "arch-shop",
        run: 1,
        inputTokens: 10,
        outputTokens: 5,
        failedCommands: 0,
        repairs: 0,
        firstTryOk: true,
        finalOk: true,
      });
      expect(by["no-skill"]).toMatchObject({ firstTryOk: true, finalOk: true });
      expect(typeof by.skill.seconds).toBe("number");

      expect(
        existsSync(join(sb, "arch-shop-skill-1", ".claude", "skills", "trazo", "SKILL.md")),
      ).toBe(true);
      expect(existsSync(join(sb, "arch-shop-no-skill-1", ".claude"))).toBe(false);
      expect(existsSync(join(sb, "arch-shop-skill-1", "diagram.html"))).toBe(true);
      const stream = readFileSync(join(sb, "arch-shop-skill-1", "stream.jsonl"), "utf8");
      expect(stream).toContain("skill=true");
      expect(stream).toContain("--setting-sources|project");
      expect(readFileSync(join(sb, "arch-shop-no-skill-1", "stream.jsonl"), "utf8")).toContain(
        "skill=false",
      );
      expect(r.stdout).toContain("firstTryRate");

      const again = run([...args, "--resume"]);
      expect(again.status).toBe(0);
      expect(JSON.parse(readFileSync(out, "utf8")).runs).toHaveLength(2);
      expect(again.stdout).toContain("skipped");
    },
    120000,
  );

  it.skipIf(!hasDist)(
    "runs a fake opencode end to end: config, isolation env, skill path, version, parser, agent label",
    () => {
      const fake = join(work, "fake-opencode.mjs");
      writeFileSync(
        fake,
        [
          'import { execSync } from "node:child_process";',
          'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
          'if (process.argv[2] === "--version") { console.log("opencode v9.9.9"); process.exit(0); }',
          'const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });',
          'writeFileSync("diagram.json", sh("trazo example architecture"));',
          'sh("trazo check diagram.json");',
          'sh("trazo make diagram.json -o diagram.html");',
          'const skill = existsSync(".opencode/skills/trazo/SKILL.md");',
          'const perm = JSON.parse(readFileSync("opencode.json", "utf8")).permission.skill;',
          "const out = (o) => console.log(JSON.stringify(o));",
          'out({ type: "step_start", part: { type: "step-start" } });',
          'out({ type: "tool_use", part: { type: "tool", tool: "shell", state: { status: "completed", input: { command: "trazo make diagram.json -o diagram.html" }, metadata: { metadata: { exit: 0 } } } } });',
          'out({ type: "step_finish", part: { reason: "tool-calls", tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 100, write: 7 } } } });',
          'out({ type: "text", part: { type: "text", text: "skill=" + skill + " perm=" + JSON.stringify(perm) + " pwd=" + process.env.PWD + " xdg=" + process.env.XDG_CONFIG_HOME + " args=" + process.argv.slice(2).join("|") } });',
          "",
        ].join("\n"),
      );
      const out = join(work, "e2e-oc.json");
      const sb = join(work, "sb-oc-e2e");
      const args = [
        "--agent",
        "opencode",
        "--model",
        "opencode/m1",
        "--task",
        "arch-shop",
        "--runs",
        "1",
        "--agent-cmd",
        fake,
        "--out",
        out,
        "--sandbox-root",
        sb,
      ];
      const r = run(args);
      expect(r.status, r.stderr).toBe(0);

      const data = JSON.parse(readFileSync(out, "utf8"));
      expect(data).toMatchObject({
        kind: "agent",
        agent: "opencode",
        agentVersion: "opencode v9.9.9",
        model: "opencode/m1",
        runsPerTask: 1,
      });
      const by = Object.fromEntries(data.runs.map((x: { condition: string }) => [x.condition, x]));
      expect(by.skill).toMatchObject({
        inputTokens: 10,
        outputTokens: 7,
        cacheCreationTokens: 7,
        cacheReadTokens: 100,
        failedCommands: 0,
        firstTryOk: true,
        finalOk: true,
      });
      expect(by["no-skill"]).toMatchObject({ firstTryOk: true, finalOk: true });

      const skillSandbox = join(sb, "arch-shop-skill-1");
      expect(existsSync(join(skillSandbox, ".opencode", "skills", "trazo", "SKILL.md"))).toBe(true);
      expect(existsSync(join(skillSandbox, ".claude"))).toBe(false);
      expect(existsSync(join(sb, "arch-shop-no-skill-1", ".opencode"))).toBe(false);
      const cfg = JSON.parse(readFileSync(join(skillSandbox, "opencode.json"), "utf8"));
      expect(cfg.permission.shell).toEqual({ "*": "deny", "trazo *": "allow" });
      expect(
        JSON.parse(readFileSync(join(sb, "arch-shop-no-skill-1", "opencode.json"), "utf8"))
          .permission.skill,
      ).toBe("deny");
      const stream = readFileSync(join(skillSandbox, "stream.jsonl"), "utf8");
      expect(stream).toContain("skill=true");
      // PWD would otherwise stay on the launching shell's folder and OpenCode would work (and write) there.
      expect(stream).toContain(JSON.stringify(`pwd=${skillSandbox} xdg=`).slice(1, -1));
      expect(stream).toContain(
        JSON.stringify(`xdg=${join(sb, "_opencode", "config")}`).slice(1, -1),
      );
      expect(stream).toContain("args=run|--standalone|-m|opencode/m1|--format|json|");
      expect(readFileSync(join(sb, "arch-shop-no-skill-1", "stream.jsonl"), "utf8")).toContain(
        "skill=false",
      );

      // The output file belongs to one agent: a different agent must not append to it.
      const mismatch = run([
        "--model",
        "opencode/m1",
        "--task",
        "arch-shop",
        "--runs",
        "1",
        "--agent-cmd",
        fake,
        "--out",
        out,
        "--sandbox-root",
        join(work, "sb-mismatch"),
      ]);
      expect(mismatch.status).toBe(1);
      expect(mismatch.stderr).toContain("holds agent opencode, not claude-code");
    },
    120000,
  );

  it("delivers the full prompt (newlines and suffix) as the last argument and records the agent binary", () => {
    const fake = join(work, "argv-agent.mjs");
    const argvFile = join(work, "argv.json");
    writeFileSync(
      fake,
      [
        'import { writeFileSync } from "node:fs";',
        'if (process.argv[2] === "--version") { console.log("opencode v1"); process.exit(0); }',
        `writeFileSync(${JSON.stringify(argvFile)}, JSON.stringify(process.argv.slice(2)));`,
        "",
      ].join("\n"),
    );
    const out = join(work, "argv-out.json");
    const r = run([
      "--agent",
      "opencode",
      "--model",
      "opencode/m1",
      "--task",
      "arch-shop",
      "--condition",
      "skill",
      "--runs",
      "1",
      "--agent-cmd",
      fake,
      "--out",
      out,
      "--sandbox-root",
      join(work, "sb-argv"),
    ]);
    expect(r.status, r.stderr).toBe(0);
    const argv = JSON.parse(readFileSync(argvFile, "utf8")) as string[];
    const last = argv[argv.length - 1];
    const taskPrompt = JSON.parse(
      readFileSync(join(root, "bench", "tasks.json"), "utf8"),
    ).tasks.find((t: { id: string }) => t.id === "arch-shop").prompt;
    expect(last).toBe(buildPrompt(taskPrompt));
    expect(last).toContain("\n\n");
    expect(last).toContain("diagram.html");
    expect(JSON.parse(readFileSync(out, "utf8")).agentBin).toBe(fake);
    expect(r.stdout).toContain(fake);
  });

  it.runIf(process.platform === "win32")(
    "resolves a .cmd shim to its exe, never through cmd.exe, and delivers the prompt",
    () => {
      const dir = join(work, "shim");
      const bin = join(dir, "node_modules", "pkg", "bin");
      mkdirSync(bin, { recursive: true });
      // A copy of node.exe stands in for the real binary; the shim's exe line is the npm one.
      copyFileSync(process.execPath, join(bin, "agent.exe"));
      const cmd = join(dir, "agent.cmd");
      writeFileSync(
        cmd,
        '@ECHO off\r\nSET "dp0=%~dp0"\r\n"%dp0%\\node_modules\\pkg\\bin\\agent.exe"   %*\r\n',
      );
      const r = run([
        "--agent",
        "opencode",
        "--model",
        "opencode/m1",
        "--task",
        "arch-shop",
        "--runs",
        "1",
        "--agent-cmd",
        cmd,
        "--out",
        join(work, "shim-out.json"),
        "--sandbox-root",
        join(work, "sb-shim"),
      ]);
      expect(r.stdout).toContain(`agent binary: ${join(bin, "agent.exe")}`);
    },
  );

  it("records a failed run when the agent produces nothing", () => {
    const fake = join(work, "silent.mjs");
    writeFileSync(fake, "process.exit(0);\n");
    const out = join(work, "silent.json");
    const r = run([
      "--model",
      "m1",
      "--task",
      "arch-shop",
      "--condition",
      "no-skill",
      "--runs",
      "1",
      "--agent-cmd",
      fake,
      "--out",
      out,
      "--sandbox-root",
      join(work, "sb2"),
    ]);
    expect(r.status).toBe(0);
    const rec = JSON.parse(readFileSync(out, "utf8")).runs[0];
    expect(rec).toMatchObject({ finalOk: false, firstTryOk: false, inputTokens: 0 });
    expect(rec.notes).toContain("no result message");
  });
});
