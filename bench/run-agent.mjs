// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Agent benchmark runner. Needs the built dist/ (npm run build) and the CLI of the chosen agent
// (Claude Code, or OpenCode with a free model). On Windows the agent is resolved to its real .exe (a .cmd shim is
// followed to the .exe it launches, wrappers are skipped) and spawned without a shell, so multi-line prompts arrive
// intact; if none is found pass --agent-cmd <path to the .exe>. The resolved path is printed and saved as agentBin.
//   node bench/run-agent.mjs --model <id> [--agent claude-code|opencode] [--task <id>]...
//     [--condition skill|no-skill|both] [--runs N] [--out <file>] [--agent-cmd <path>]
//     [--tool trazo|archify[,...]] [--effort low|medium|high|xhigh|max] [--browser <path>] [--sandbox-root <dir>] [--timeout <s>] [--resume] [--dry-run]
// Each run happens in a fresh sandbox: tmp/bench-runs/<model>/ for claude-code, <os tmp>/trazo-bench-runs/<model>/
// for opencode (outside the repository). Runs that include archify live in <os tmp>/trazo-bench/<model>/ and need
// the pinned copy from bench/stage-archify.mjs. Results are appended to --out as each run finishes.
// Never run in CI: a real run spends model quota.

import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { summarize } from "../scripts/bench-lib.mjs";
import { tmpdir } from "node:os";
import {
  agentEnv,
  buildAgentArgs,
  archifyCloneDir,
  buildPrompt,
  countAgentErrors,
  countIssues,
  formatCommandLine,
  judgeSummary,
  keepSkillEntry,
  opencodeConfig,
  opencodeEnv,
  opencodeRunEnv,
  parseArgs,
  parseOpencodeStream,
  parseStream,
  planRuns,
  runName,
  sandboxLayout,
  shellCommandLine,
  shimExePath,
  shimFiles,
  skillSegments,
  toolAdapter,
  withoutAgentErrors,
} from "./run-agent-lib.mjs";
import { judgeHtml } from "./judge-html.mjs";
import { locateSkillDir } from "./stage-archify.mjs";

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
const layout = sandboxLayout(opts, root, tmpdir());
const sandboxRoot = layout.runs;
const isOpencode = opts.agent === "opencode";
const withArchify = opts.tools.includes("archify");
const withTrazo = opts.tools.includes("trazo");
// Without --tool the names, the record and the plan stay as they were before adapters.
const toolsGiven = process.argv.slice(2).includes("--tool");
const plan = planRuns(opts.tasks, opts.conditions, opts.runs, toolsGiven ? opts.tools : undefined);
const toolOf = (p) => p.tool ?? "trazo";

/** Chrome or Edge for Archify's checks: --browser, then BENCH_BROWSER, then the usual install paths. */
function findBrowser() {
  const given = opts.browser || process.env.BENCH_BROWSER;
  if (given) return given;
  const env = process.env;
  const candidates = {
    win32: [
      join(env["PROGRAMFILES"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(env["PROGRAMFILES(X86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(env["LOCALAPPDATA"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      join(env["PROGRAMFILES(X86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
    ],
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  };
  return (candidates[process.platform] ?? []).find((f) => existsSync(f)) ?? "";
}

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

/**
 * --rejudge: judges the recorded runs again with the current expected terms. No agent runs and
 * nothing else in the record changes. Runs with an agentError are left as they are.
 */
async function rejudgeRecord() {
  if (!existsSync(outFile)) fail(`${opts.out} not found`);
  const rec = JSON.parse(readFileSync(outFile, "utf8"));
  if ((rec.agent ?? "claude-code") !== opts.agent)
    fail(`${opts.out} holds agent ${rec.agent}, not ${opts.agent}`);
  if (rec.model !== opts.model) fail(`${opts.out} holds model ${rec.model}, not ${opts.model}`);
  // Archify runs live under <root>/<model>; the record says whether the original run used that layout.
  const tools = rec.runs.some((r) => r.tool === "archify") ? ["archify"] : opts.tools;
  const runsDir = sandboxLayout({ ...opts, tools }, root, tmpdir()).runs;
  let judged = 0;
  for (const r of rec.runs) {
    if (r.agentError) continue;
    const task = taskById.get(r.task);
    if (!task) {
      console.log(`warning: ${r.task}-${r.condition}-${r.run}: unknown task, left as recorded`);
      continue;
    }
    // Plain trazo runs are named without the tool unless --tool was given.
    const named = join(
      runsDir,
      runName({ task: r.task, tool: r.tool, condition: r.condition, run: r.run }),
    );
    const plain = join(runsDir, runName({ task: r.task, condition: r.condition, run: r.run }));
    const sandbox = existsSync(named) || !existsSync(plain) ? named : plain;
    delete r.judgeError;
    delete r.screenshot;
    Object.assign(r, await judgeRun(sandbox, task.expect ?? []));
    judged++;
    console.log(`${basename(sandbox)}: judgeOk=${r.judgeOk}`);
  }
  writeFileSync(
    outFile,
    `${JSON.stringify(rec, null, 2)}
`,
  );
  console.log(`
${judged} run(s) judged again. Results: ${outFile}`);
  printSummaries(rec);
  process.exit(0);
}

/** The two summaries printed at the end of a run. */
function printSummaries(rec) {
  const errored = countAgentErrors(rec.runs);
  if (errored)
    console.log(
      `warning: ${errored} run(s) with an agent error are left out of the rates below (agentErrors per tool in the second summary); rerun them with --resume`,
    );
  console.log(JSON.stringify(summarize(withoutAgentErrors(rec.runs)), null, 2));
  console.log(
    JSON.stringify(
      {
        model: rec.model,
        ...judgeSummary(rec.runs, Object.fromEntries(tasksFile.tasks.map((t) => [t.id, t.type]))),
      },
      null,
      2,
    ),
  );
}

if (opts.rejudge) await rejudgeRecord();

if (opts.dryRun) {
  for (const p of plan) {
    const tool = toolAdapter(toolOf(p), {
      sandbox: join(sandboxRoot, runName(p)),
      browser: opts.browser,
    });
    const prompt = buildPrompt(taskById.get(p.task).prompt, tool);
    console.log(`${runName(p)}  (${p.condition})`);
    console.log(`  cwd: ${join(sandboxRoot, runName(p))}`);
    console.log(
      `  ${formatCommandLine(opts.agentCmd, buildAgentArgs(prompt, opts.model, opts.agent, tool, opts.effort))}`,
    );
  }
  console.log(`${plan.length} run(s) planned, timeout ${opts.timeout} s each. Nothing was run.`);
  process.exit(0);
}

if (!existsSync(distCli)) fail("dist/ not found; run npm run build");
const agentBin = resolveAgent(opts.agentCmd).bin;
console.log(`agent binary: ${agentBin}`);
const VERSION = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "unknown";
const browser = withArchify ? findBrowser() : "";
if (withArchify && !browser)
  console.log("warning: no Chrome or Edge found; ARCHIFY_CHROME is not set (use --browser)");
let archifySkillDir = "";
if (withArchify) {
  try {
    archifySkillDir = locateSkillDir(archifyCloneDir(layout.archifyHome));
  } catch (e) {
    fail(`${e.message}; run node bench/stage-archify.mjs first`);
  }
}

// Output file: load the existing record or start a new one.
let record;
if (existsSync(outFile)) {
  record = JSON.parse(readFileSync(outFile, "utf8"));
  if ((record.agent ?? "claude-code") !== opts.agent)
    fail(`${opts.out} holds agent ${record.agent}, not ${opts.agent}`);
  if (record.model !== opts.model)
    fail(`${opts.out} holds model ${record.model}, not ${opts.model}`);
  if ((record.effort ?? "") !== opts.effort)
    fail(`${opts.out} holds effort ${record.effort ?? "unset"}, not ${opts.effort || "unset"}`);
  record.runsPerTask = opts.runs;
} else {
  record = {
    kind: "agent",
    date: today,
    trazoVersion: VERSION,
    agent: opts.agent,
    model: opts.model,
    effort: opts.effort || null,
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
if (withTrazo)
  for (const f of shimFiles(process.execPath, distCli, process.platform)) {
    const path = join(binDir, f.name);
    writeFileSync(path, f.content);
    if (f.executable) chmodSync(path, 0o755);
  }
const opencodeDir = join(sandboxRoot, "_opencode");
const baseEnv = isOpencode
  ? opencodeEnv(process.env, binDir, opencodeDir, process.platform)
  : agentEnv(process.env, binDir, process.platform);
if (isOpencode)
  for (const d of ["home", "config", "data", "state", "cache"])
    mkdirSync(join(opencodeDir, d), { recursive: true });

/** Output of `<agent> --version`, or "" when it cannot be read. Uses the same isolated env as the runs. */
function readAgentVersion() {
  const agent = resolveAgent(opts.agentCmd);
  const argv = [...agent.prefix, "--version"];
  const env = isOpencode ? opencodeRunEnv(baseEnv, sandboxRoot) : baseEnv;
  const v = agent.shell
    ? spawnSync(shellCommandLine(agent.file, argv), {
        cwd: sandboxRoot,
        env,
        shell: true,
        encoding: "utf8",
      })
    : spawnSync(agent.file, argv, { cwd: sandboxRoot, env, encoding: "utf8" });
  return v.status === 0 ? v.stdout.trim() : "";
}
if (isOpencode) {
  const version = readAgentVersion();
  if (!version) fail(`could not read the version from ${opts.agentCmd} --version`);
  record.agentVersion = version;
  save();
} else {
  // Claude Code prints e.g. "2.1.308 (Claude Code)"; anything that does not start with a version is dropped.
  const version = readAgentVersion().split(/\r?\n/)[0] ?? "";
  record.agentVersion = /^\d+\.\d+\.\d+/.test(version) ? version : "unknown";
  save();
}

function killTree(child) {
  if (process.platform === "win32" && child.pid)
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
  else child.kill("SIGKILL");
}

/** Runs the agent in the sandbox; resolves to { code, timedOut, error }. */
function runAgent(sandbox, args, toolEnv) {
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
    const env = isOpencode ? opencodeRunEnv(baseEnv, sandbox) : { ...baseEnv, ...toolEnv };
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

function finalCheck(sandbox, stats, tool) {
  if (tool.nativeOk) return tool.nativeOk(stats, existsSync(join(sandbox, "diagram.html")));
  if (!existsSync(join(sandbox, "diagram.html"))) return false;
  const named = stats.lastMakeInput?.replace(/^["']|["']$/g, "");
  const candidates = [named, "diagram.json"]
    .filter(Boolean)
    .map((f) => (isAbsolute(f) ? f : join(sandbox, f)));
  const input = candidates.find((f) => existsSync(f));
  if (!input) return false;
  return spawnSync(process.execPath, [distCli, "check", input], { cwd: sandbox }).status === 0;
}

/** Judges <sandbox>/diagram.html the same way for every tool; the profile dirs live under the sandbox root. */
async function judgeRun(sandbox, expectedTerms) {
  const html = join(sandbox, "diagram.html");
  if (!existsSync(html)) return { judgeOk: false, judgeIssues: { "no-html": 1 } };
  const screenshotPath = join(sandbox, "diagram.png");
  try {
    const r = await judgeHtml(html, {
      expectedTerms,
      browserPath: opts.browser || undefined,
      screenshotPath,
      profileRoot: layout.archifyHome,
    });
    return {
      judgeOk: r.ok,
      judgeIssues: countIssues(r.issues),
      screenshot: r.screenshot ?? screenshotPath,
    };
  } catch (e) {
    return { judgeOk: null, judgeError: e.message };
  }
}

let skipped = 0;
let done = 0;
for (const p of plan) {
  const name = runName(p);
  if (
    opts.resume &&
    record.runs.some(
      (r) =>
        r.task === p.task &&
        r.condition === p.condition &&
        r.run === p.run &&
        (r.tool ?? "trazo") === toolOf(p) &&
        !r.agentError, // an agent error is not a result: --resume runs it again
    )
  ) {
    skipped++;
    console.log(`${name}: skipped (already recorded)`);
    continue;
  }
  record.runs = record.runs.filter(
    (r) =>
      !(
        r.agentError &&
        r.task === p.task &&
        r.condition === p.condition &&
        r.run === p.run &&
        (r.tool ?? "trazo") === toolOf(p)
      ),
  );
  const sandbox = join(sandboxRoot, name);
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });
  if (isOpencode)
    writeFileSync(
      join(sandbox, "opencode.json"),
      `${JSON.stringify(opencodeConfig(p.condition), null, 2)}\n`,
    );
  const tool = toolAdapter(toolOf(p), { sandbox, browser });
  if (p.condition === "skill") {
    const dest = join(sandbox, ...skillSegments(opts.agent, tool.skillName));
    mkdirSync(dest, { recursive: true });
    if (tool.name === "archify")
      cpSync(archifySkillDir, dest, { recursive: true, filter: keepSkillEntry });
    else copyFileSync(join(root, "skill", "SKILL.md"), join(dest, "SKILL.md"));
  }
  const prompt = buildPrompt(taskById.get(p.task).prompt, tool);
  const started = Date.now();
  const outcome = await runAgent(
    sandbox,
    buildAgentArgs(prompt, opts.model, opts.agent, tool, opts.effort),
    tool.env,
  );
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  const streamText = existsSync(join(sandbox, "stream.jsonl"))
    ? readFileSync(join(sandbox, "stream.jsonl"), "utf8")
    : "";
  const stats = isOpencode ? parseOpencodeStream(streamText) : parseStream(streamText, tool);
  const notes = [];
  if (outcome.timedOut) notes.push(`timeout after ${opts.timeout} s`);
  if (outcome.error) notes.push(`spawn error: ${outcome.error}`);
  else if (!outcome.timedOut && outcome.code !== 0) notes.push(`agent exit code ${outcome.code}`);
  if (!stats.hasResult) notes.push("no result message");
  else if (stats.resultIsError) notes.push("result reported an error");
  const finalOk = finalCheck(sandbox, stats, tool);
  const entry = {
    task: p.task,
    tool: tool.name,
    toolVersion: tool.version ?? VERSION,
    agentVersion: record.agentVersion,
    condition: p.condition,
    run: p.run,
    effort: opts.effort || null,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    cacheCreationTokens: stats.cacheCreationTokens,
    cacheReadTokens: stats.cacheReadTokens,
    failedCommands: stats.failedCommands,
    repairs: stats.repairs,
    firstTryOk: stats.firstTryOk,
    deniedCommands: stats.deniedCommands ?? 0,
    deniedTools: stats.deniedTools ?? {},
    finalOk,
    seconds,
  };
  // An agent that failed before working (auth, quota, API) says nothing about the tool: it is not judged.
  if (stats.agentError) entry.agentError = stats.agentError;
  else Object.assign(entry, await judgeRun(sandbox, taskById.get(p.task).expect ?? []));
  if (notes.length) entry.notes = notes.join("; ");
  record.runs.push(entry);
  save();
  done++;
  if (stats.agentError)
    console.log(
      `warning: ${name}: agent error (${stats.agentError}); the run is excluded from every rate and not judged`,
    );
  console.log(
    `${name}: finalOk=${finalOk} firstTryOk=${stats.firstTryOk} judgeOk=${entry.judgeOk} failed=${stats.failedCommands} denied=${stats.deniedCommands ?? 0} repairs=${stats.repairs} tokens=${stats.inputTokens}/${stats.outputTokens} ${seconds}s${notes.length ? `  [${notes.join("; ")}]` : ""}`,
  );
}

console.log(`\n${done} run(s) done, ${skipped} skipped. Results: ${outFile}`);
printSummaries(record);
