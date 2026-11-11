// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Agent benchmark runner. Needs the built dist/ (npm run build) and the CLI of the chosen agent
// (Claude Code, or OpenCode with a free model). On Windows the agent is resolved to its real .exe (a .cmd shim is
// followed to the .exe it launches, wrappers are skipped) and spawned without a shell, so multi-line prompts arrive
// intact; if none is found pass --agent-cmd <path to the .exe>. The resolved path is printed and saved as agentBin.
//   node bench/run-agent.mjs --model <id> [--agent claude-code|opencode] [--task <id>]...
//     [--condition skill|no-skill|both] [--runs N] [--out <file>] [--agent-cmd <path>]
//     [--sandbox-root <dir>] [--timeout <s>] [--resume] [--dry-run]
// Each run happens in a fresh sandbox: tmp/bench-runs/<model>/ for claude-code, <os tmp>/trazo-bench-runs/<model>/
// for opencode (outside the repository). Results are appended to --out as each run finishes.
// Never run in CI: a real run spends model quota.

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "../scripts/bench-lib.mjs";
import { tmpdir } from "node:os";
import {
  agentEnv,
  buildAgentArgs,
  buildPrompt,
  defaultSandboxRoot,
  formatCommandLine,
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
} from "./run-agent-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distCli = join(root, "dist", "cli", "main.js");

function fail(message, code = 1) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(code);
}

const tasksFile = JSON.parse(readFileSync(join(root, "bench", "tasks.json"), "utf8"));
const taskById = new Map(tasksFile.tasks.map((t) => [t.id, t]));
const today = new Date().toISOString().slice(0, 10);

let opts;
try {
  opts = parseArgs(
    process.argv.slice(2),
    tasksFile.tasks.map((t) => t.id),
    today,
  );
} catch (e) {
  fail(e.message, 2);
}
const outFile = resolve(root, opts.out);
const sandboxRoot = opts.sandboxRoot
  ? resolve(opts.sandboxRoot)
  : defaultSandboxRoot(opts.agent, opts.model, root, tmpdir());
const isOpencode = opts.agent === "opencode";
const parseOutput = isOpencode ? parseOpencodeStream : parseStream;
const plan = planRuns(opts.tasks, opts.conditions, opts.runs);

/** Real executable of a .cmd/.bat shim (see shimExePath), or null. */
function exeBehindShim(shim) {
  try {
    const exe = shimExePath(readFileSync(shim, "utf8"), dirname(resolve(shim)));
    return exe && existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the agent command to { file, prefix, shell }. A prompt never goes through cmd.exe: on Windows a
 * .cmd/.bat is replaced by the .exe it launches, and a wrapper that does not reference one is skipped.
 */
function resolveAgentOnce(cmd) {
  if (/\.(mjs|cjs|js)$/.test(cmd))
    return { file: process.execPath, prefix: [resolve(cmd)], shell: false, bin: resolve(cmd) };
  if (process.platform !== "win32") return { file: cmd, prefix: [], shell: false, bin: cmd };
  const hint = `pass --agent-cmd <path to ${opts.agent === "opencode" ? "opencode" : "the agent"}.exe>`;
  if (/[\\/]/.test(cmd) || /\.\w+$/.test(cmd)) {
    if (/\.(cmd|bat)$/i.test(cmd)) {
      const exe = exeBehindShim(cmd);
      if (!exe) fail(`${cmd} does not launch an .exe directly; ${hint}`);
      return { file: exe, prefix: [], shell: false, bin: exe };
    }
    return { file: cmd, prefix: [], shell: false, bin: cmd };
  }
  const found =
    spawnSync("where", [cmd], { encoding: "utf8" })
      .stdout?.split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean) ?? [];
  for (const f of found) {
    const exe = /\.exe$/i.test(f) ? f : /\.(cmd|bat)$/i.test(f) ? exeBehindShim(f) : null;
    if (exe) return { file: exe, prefix: [], shell: false, bin: exe };
  }
  return fail(
    `could not find an executable for "${cmd}" (wrappers and .cmd files that do not launch an .exe are skipped); ${hint}`,
  );
}
let resolvedAgent;
const resolveAgent = (cmd) => (resolvedAgent ??= resolveAgentOnce(cmd));

if (opts.dryRun) {
  for (const p of plan) {
    const prompt = buildPrompt(taskById.get(p.task).prompt);
    console.log(`${runName(p)}  (${p.condition})`);
    console.log(`  cwd: ${join(sandboxRoot, runName(p))}`);
    console.log(
      `  ${formatCommandLine(opts.agentCmd, buildAgentArgs(prompt, opts.model, opts.agent))}`,
    );
  }
  console.log(`${plan.length} run(s) planned, timeout ${opts.timeout} s each. Nothing was run.`);
  process.exit(0);
}

if (!existsSync(distCli)) fail("dist/ not found; run npm run build");
const agentBin = resolveAgent(opts.agentCmd).bin;
console.log(`agent binary: ${agentBin}`);
const VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown";

// Output file: load the existing record or start a new one.
let record;
if (existsSync(outFile)) {
  record = JSON.parse(readFileSync(outFile, "utf8"));
  if ((record.agent ?? "claude-code") !== opts.agent)
    fail(`${opts.out} holds agent ${record.agent}, not ${opts.agent}`);
  if (record.model !== opts.model)
    fail(`${opts.out} holds model ${record.model}, not ${opts.model}`);
  record.runsPerTask = opts.runs;
} else {
  record = {
    kind: "agent",
    date: today,
    trazoVersion: VERSION,
    agent: opts.agent,
    model: opts.model,
    runsPerTask: opts.runs,
    runs: [],
  };
}
record.agentBin = agentBin;
const save = () => {
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`);
};

// trazo shim on PATH, shared by all runs.
const binDir = join(sandboxRoot, "_bin");
mkdirSync(binDir, { recursive: true });
for (const f of shimFiles(process.execPath, distCli, process.platform)) {
  const path = join(binDir, f.name);
  writeFileSync(path, f.content);
  if (f.executable) chmodSync(path, 0o755);
}
const opencodeDir = join(sandboxRoot, "_opencode");
const baseEnv = isOpencode
  ? opencodeEnv(process.env, binDir, opencodeDir, process.platform)
  : agentEnv(process.env, binDir, process.platform);
if (isOpencode) {
  for (const d of ["home", "config", "data", "state", "cache"])
    mkdirSync(join(opencodeDir, d), { recursive: true });
  // Same isolated env as the runs, so the version check cannot touch the user's OpenCode state.
  const agent = resolveAgent(opts.agentCmd);
  const argv = [...agent.prefix, "--version"];
  const v = agent.shell
    ? spawnSync(shellCommandLine(agent.file, argv), {
        cwd: sandboxRoot,
        env: opencodeRunEnv(baseEnv, sandboxRoot),
        shell: true,
        encoding: "utf8",
      })
    : spawnSync(agent.file, argv, {
        cwd: sandboxRoot,
        env: opencodeRunEnv(baseEnv, sandboxRoot),
        encoding: "utf8",
      });
  const version = v.status === 0 ? v.stdout.trim() : "";
  if (!version) fail(`could not read the version from ${opts.agentCmd} --version`);
  record.agentVersion = version;
  save();
}

function killTree(child) {
  if (process.platform === "win32" && child.pid)
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else child.kill("SIGKILL");
}

/** Runs the agent in the sandbox; resolves to { code, timedOut, error }. */
function runAgent(sandbox, args) {
  const agent = resolveAgent(opts.agentCmd);
  return new Promise((done) => {
    const stream = createWriteStream(join(sandbox, "stream.jsonl"));
    const stderr = createWriteStream(join(sandbox, "stderr.log"));
    let timedOut = false;
    let settled = false;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.end();
      stderr.end(() => done(r));
    };
    const argv = [...agent.prefix, ...args];
    const env = isOpencode ? opencodeRunEnv(baseEnv, sandbox) : baseEnv;
    const child = agent.shell
      ? spawn(shellCommandLine(agent.file, argv), {
          cwd: sandbox,
          env,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(agent.file, argv, { cwd: sandbox, env, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, opts.timeout * 1000);
    child.stdout.pipe(stream);
    child.stderr.pipe(stderr);
    child.on("error", (e) => finish({ code: null, timedOut, error: e.message }));
    child.on("close", (code) => finish({ code, timedOut, error: null }));
  });
}

function finalCheck(sandbox, stats) {
  if (!existsSync(join(sandbox, "diagram.html"))) return false;
  const named = stats.lastMakeInput?.replace(/^["']|["']$/g, "");
  const candidates = [named, "diagram.json"]
    .filter(Boolean)
    .map((f) => (isAbsolute(f) ? f : join(sandbox, f)));
  const input = candidates.find((f) => existsSync(f));
  if (!input) return false;
  return spawnSync(process.execPath, [distCli, "check", input], { cwd: sandbox }).status === 0;
}

let skipped = 0;
let done = 0;
for (const p of plan) {
  const name = runName(p);
  if (
    opts.resume &&
    record.runs.some((r) => r.task === p.task && r.condition === p.condition && r.run === p.run)
  ) {
    skipped++;
    console.log(`${name}: skipped (already recorded)`);
    continue;
  }
  const sandbox = join(sandboxRoot, name);
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });
  if (isOpencode)
    writeFileSync(
      join(sandbox, "opencode.json"),
      `${JSON.stringify(opencodeConfig(p.condition), null, 2)}\n`,
    );
  if (p.condition === "skill") {
    const dest = join(sandbox, ...skillSegments(opts.agent));
    mkdirSync(dest, { recursive: true });
    copyFileSync(join(root, "skill", "SKILL.md"), join(dest, "SKILL.md"));
  }
  const prompt = buildPrompt(taskById.get(p.task).prompt);
  const started = Date.now();
  const outcome = await runAgent(sandbox, buildAgentArgs(prompt, opts.model, opts.agent));
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const streamText = existsSync(join(sandbox, "stream.jsonl"))
    ? readFileSync(join(sandbox, "stream.jsonl"), "utf8")
    : "";
  const stats = parseOutput(streamText);
  const notes = [];
  if (outcome.timedOut) notes.push(`timeout after ${opts.timeout} s`);
  if (outcome.error) notes.push(`spawn error: ${outcome.error}`);
  else if (!outcome.timedOut && outcome.code !== 0) notes.push(`agent exit code ${outcome.code}`);
  if (!stats.hasResult) notes.push("no result message");
  else if (stats.resultIsError) notes.push("result reported an error");
  const finalOk = finalCheck(sandbox, stats);
  const entry = {
    task: p.task,
    condition: p.condition,
    run: p.run,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    cacheCreationTokens: stats.cacheCreationTokens,
    cacheReadTokens: stats.cacheReadTokens,
    failedCommands: stats.failedCommands,
    repairs: stats.repairs,
    firstTryOk: stats.firstTryOk,
    finalOk,
    seconds,
  };
  if (notes.length) entry.notes = notes.join("; ");
  record.runs.push(entry);
  save();
  done++;
  console.log(
    `${name}: finalOk=${finalOk} firstTryOk=${stats.firstTryOk} failed=${stats.failedCommands} repairs=${stats.repairs} tokens=${stats.inputTokens}/${stats.outputTokens} ${seconds}s${notes.length ? `  [${notes.join("; ")}]` : ""}`,
  );
}

console.log(`\n${done} run(s) done, ${skipped} skipped. Results: ${outFile}`);
console.log(JSON.stringify(summarize(record.runs), null, 2));
