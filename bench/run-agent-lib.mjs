// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Pure helpers for bench/run-agent.mjs: no I/O, no clock, no randomness.

import { basename, join, resolve } from "node:path";

export const PROMPT_SUFFIX =
  "\n\nThe `trazo` command is installed and turns a semantic JSON description into an HTML diagram; `trazo --help` explains it. Use the `trazo` command to build the diagram and save it as diagram.html in the current directory.";

const CONDITIONS = ["skill", "no-skill"];
const TOOLS = ["trazo", "archify"];
const AGENTS = ["claude-code", "opencode"];
const AGENT_CMDS = { "claude-code": "claude", opencode: "opencode" };

/** Parses the runner arguments. Throws Error with a plain message on bad input. */
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function parseArgs(argv, knownTasks, today) {
  const opts = {
    agent: "claude-code",
    model: "",
    tasks: [],
    conditions: [...CONDITIONS],
    runs: 3,
    out: "",
    agentCmd: "",
    timeout: 600,
    dryRun: false,
    resume: false,
    sandboxRoot: "",
    tools: ["trazo"],
    browser: "",
    effort: "",
  };
  let toolsGiven = false;
  const valueOf = (i) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new Error(`${argv[i]} needs a value`);
    return v;
  };
  const positive = (name, v) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new Error(`${name} needs a positive integer`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--model":
        opts.model = valueOf(i++);
        break;
      case "--task": {
        const id = valueOf(i++);
        if (!knownTasks.includes(id)) throw new Error(`unknown task: ${id}`);
        opts.tasks.push(id);
        break;
      }
      case "--condition": {
        const c = valueOf(i++);
        if (c !== "both" && !CONDITIONS.includes(c))
          throw new Error("--condition must be skill, no-skill or both");
        opts.conditions = c === "both" ? [...CONDITIONS] : [c];
        break;
      }
      case "--runs":
        opts.runs = positive("--runs", valueOf(i++));
        break;
      case "--timeout":
        opts.timeout = positive("--timeout", valueOf(i++));
        break;
      case "--agent": {
        const a = valueOf(i++);
        if (!AGENTS.includes(a)) throw new Error("--agent must be claude-code or opencode");
        opts.agent = a;
        break;
      }
      case "--out":
        opts.out = valueOf(i++);
        break;
      case "--agent-cmd":
        opts.agentCmd = valueOf(i++);
        break;
      case "--tool": {
        if (!toolsGiven) opts.tools = [];
        toolsGiven = true;
        for (const t of valueOf(i++).split(",")) {
          if (!TOOLS.includes(t)) throw new Error("--tool must be trazo or archify");
          if (!opts.tools.includes(t)) opts.tools.push(t);
        }
        break;
      }
      case "--browser":
        opts.browser = valueOf(i++);
        break;
      case "--effort": {
        const level = valueOf(i++);
        if (!EFFORTS.includes(level))
          throw new Error("--effort must be low, medium, high, xhigh or max");
        opts.effort = level;
        break;
      }
      case "--sandbox-root":
        opts.sandboxRoot = valueOf(i++);
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--resume":
        opts.resume = true;
        break;
      default:
        throw new Error(`unknown option: ${a}`);
    }
  }
  if (!opts.model) throw new Error("--model is required");
  if (opts.effort && opts.agent !== "claude-code")
    throw new Error("--effort needs --agent claude-code");
  if (opts.tools.includes("archify")) {
    if (opts.agent !== "claude-code") throw new Error("--tool archify needs --agent claude-code");
    if (opts.tools.length === 1 && !opts.conditions.includes("skill"))
      throw new Error("archify only runs with the skill condition");
  }
  // Defaults that depend on the agent are resolved once all options are read.
  if (!opts.out) opts.out = `bench/results/${today}-agent-${opts.agent}.json`;
  if (!opts.agentCmd) opts.agentCmd = AGENT_CMDS[opts.agent];
  if (opts.tasks.length === 0) opts.tasks = [...knownTasks];
  return opts;
}

export const ARCHIFY_VERSION = "v3.2.0";
export const ARCHIFY_REPO = "https://github.com/tt-a1i/archify";

/** Pinned clone of Archify, next to the sandboxes. */
export const archifyCloneDir = (home) => join(home, `_archify-${ARCHIFY_VERSION}`);

const SKILL_BIN = ".claude/skills/archify/bin/archify.mjs";
const forwardSlashes = (p) => p.replace(/\\/g, "/");
// Git Bash spells C:/x as /c/x.
const gitBashPath = (p) => p.replace(/^([A-Za-z]):\//, (_, d) => `/${d.toLowerCase()}/`);

/** Prompt tail for archify: names the one command the sandbox allows, so the agent does not guess a path. */
const archifySuffix = (bin) =>
  `\n\nThe \`archify\` skill is installed in this project. Use it to build the diagram and save it as diagram.html in the current directory. Run its commands exactly as \`node ${bin} <command> <file>\`; \`finalize\` checks the finished file.`;

/** Filter for the skill copy: the clone's history and dependencies stay out of the sandbox. */
export const keepSkillEntry = (src) => ![".git", "node_modules"].includes(basename(src));

/**
 * Everything the runner and the parser need to know about the tool under test. The Archify
 * skill is copied into each sandbox, so its allowed command depends on the sandbox path.
 */
export function toolAdapter(name, ctx = {}) {
  if (name === "trazo")
    return {
      name,
      version: null,
      promptSuffix: PROMPT_SUFFIX,
      bashRules: ["Bash(trazo:*)"],
      skillName: "trazo",
      env: {},
      shim: true,
      repairFile: (file) => file.endsWith(".json"),
      verbs: (cmd) =>
        segments(cmd)
          .map((s) => /^trazo\s+(check|make)\b/.exec(s)?.[1])
          .filter(Boolean),
      firstVerb: "make",
      nativeVerb: null,
      inputOf: (seg) => /^trazo\s+make\s+(\S+)/.exec(seg)?.[1] ?? null,
      nativeOk: null,
    };
  if (name === "archify") {
    const bin = forwardSlashes(join(ctx.sandbox ?? "", ...SKILL_BIN.split("/")));
    const env = { ARCHIFY_UPDATE_CHECK_DISABLED: "1" };
    if (ctx.browser) env.ARCHIFY_CHROME = ctx.browser;
    return {
      name,
      version: ARCHIFY_VERSION,
      promptSuffix: archifySuffix(bin),
      bashRules: [...new Set([bin, gitBashPath(bin), SKILL_BIN, `./${SKILL_BIN}`])].flatMap((f) => [
        `Bash(node ${f}:*)`,
        `Bash(node "${f}":*)`,
      ]),
      skillName: "archify",
      env,
      shim: false,
      repairFile: (file) => /\.(json|html)$/.test(file),
      verbs: (cmd) =>
        segments(cmd)
          .map((s) => /^node\s+["']?[^\s"']*archify\.mjs["']?\s+([\w-]+)/.exec(s)?.[1])
          .filter(Boolean),
      firstVerb: "finalize",
      nativeVerb: "finalize",
      inputOf: () => null,
      nativeOk: (stats, htmlExists) => htmlExists && stats.lastFinalizeOk === true,
    };
  }
  throw new Error(`unknown tool: ${name}`);
}

export function buildPrompt(taskPrompt, tool) {
  return taskPrompt + (tool ? tool.promptSuffix : PROMPT_SUFFIX);
}

export function buildAgentArgs(prompt, model, agent = "claude-code", tool, effort = "") {
  // --standalone: a private server per run, so the env overrides apply and no shared service is reused.
  if (agent === "opencode") return ["run", "--standalone", "-m", model, "--format", "json", prompt];
  return [
    "-p",
    prompt,
    "--model",
    model,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--allowedTools",
    "Read",
    "Write",
    "Edit",
    ...(tool ? tool.bashRules : ["Bash(trazo:*)"]),
    // Windows adds a PowerShell tool our Bash rules do not cover; its calls would be denied.
    "--disallowedTools",
    "PowerShell",
    "--output-format",
    "stream-json",
    "--verbose",
    ...(effort ? ["--effort", effort] : []),
  ];
}

/**
 * With `tools` each run runs every tool once; the order is the given one when task index plus
 * run index (run 1 is index 0) is even and reversed when odd, so across the matrix each tool
 * goes first in half of the runs.
 * Archify has no no-skill condition.
 */
export function planRuns(taskIds, conditions, runs, tools) {
  const plan = [];
  for (const [taskIndex, task] of taskIds.entries())
    for (const condition of conditions)
      for (let run = 1; run <= runs; run++) {
        if (!tools) {
          plan.push({ task, condition, run });
          continue;
        }
        const order = (taskIndex + run - 1) % 2 === 0 ? tools : [...tools].reverse();
        for (const tool of order)
          if (tool !== "archify" || condition === "skill")
            plan.push({ task, condition, run, tool });
      }
  return plan;
}

export function runName(plan) {
  const tool = plan.tool ? `-${plan.tool}` : "";
  return `${plan.task}${tool}-${plan.condition}-${plan.run}`;
}

// One safe directory name per model id; "." and ".." would escape or collapse the folder.
export function modelDir(model) {
  const safe = String(model).replace(/[^A-Za-z0-9._-]/g, "-");
  return safe === "" || safe === "." || safe === ".." ? "model" : safe;
}

/** Where each agent loads project skills from, relative to the sandbox. */
export function skillSegments(agent, skillName = "trazo") {
  return agent === "opencode"
    ? [".opencode", "skills", skillName]
    : [".claude", "skills", skillName];
}

// OpenCode sees the git repository around its working directory (its snapshots hold the
// repo tree), so its sandboxes default to the OS temp dir, outside this checkout.
export function defaultSandboxRoot(agent, model, repoRoot, tmpDir) {
  return agent === "opencode"
    ? join(tmpDir, "trazo-bench-runs", modelDir(model))
    : join(repoRoot, "tmp", "bench-runs", modelDir(model));
}

/**
 * Where the runs and the pinned Archify clone live. Runs that include archify go under
 * <root>/<model> (root defaults to <os tmp>/trazo-bench); trazo-only runs keep their old layout.
 */
export function sandboxLayout(opts, repoRoot, tmpDir) {
  const base = opts.sandboxRoot ? resolve(opts.sandboxRoot) : join(tmpDir, "trazo-bench");
  if (opts.tools.includes("archify"))
    return { runs: join(base, modelDir(opts.model)), archifyHome: base };
  const runs = opts.sandboxRoot
    ? resolve(opts.sandboxRoot)
    : defaultSandboxRoot(opts.agent, opts.model, repoRoot, tmpDir);
  return { runs, archifyHome: base };
}

/**
 * opencode.json for one sandbox. "*": "deny" turns off every tool not listed, so a denied
 * call fails at once instead of waiting for approval. The skill rules also hide the skills
 * OpenCode finds in the user's home (~/.agents, ~/.claude): only trazo is visible, and only
 * in the skill condition.
 */
export function opencodeConfig(condition) {
  return {
    $schema: "https://opencode.ai/config.json",
    permission: {
      "*": "deny",
      read: "allow",
      edit: "allow",
      external_directory: "deny",
      shell: { "*": "deny", "trazo *": "allow" },
      skill: condition === "skill" ? { "*": "deny", trazo: "allow" } : "deny",
    },
  };
}

/**
 * Environment for one OpenCode run: config, data, state, cache and home live under stateDir,
 * so the user's own OpenCode config, auth and sessions are not read. OPENCODE_* variables of
 * the user are dropped (OPENCODE_CONFIG and friends would inject their config).
 */
export function opencodeEnv(baseEnv, binDir, stateDir, platform) {
  const env = {};
  for (const [k, v] of Object.entries(baseEnv))
    if (!k.toUpperCase().startsWith("OPENCODE_")) env[k] = v;
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${binDir}${platform === "win32" ? ";" : ":"}${env[pathKey] ?? ""}`;
  env.HOME = join(stateDir, "home");
  env.USERPROFILE = join(stateDir, "home");
  env.XDG_CONFIG_HOME = join(stateDir, "config");
  env.XDG_DATA_HOME = join(stateDir, "data");
  env.XDG_STATE_HOME = join(stateDir, "state");
  env.XDG_CACHE_HOME = join(stateDir, "cache");
  env.OPENCODE_DISABLE_CLAUDE_CODE = "1";
  return env;
}

/**
 * OpenCode takes its project directory from $PWD, not from the spawn cwd. A PWD inherited from
 * the launching shell points at the repo and the agent would read and write there (and ignore
 * the sandbox's opencode.json), so every run gets PWD = its sandbox.
 */
export function opencodeRunEnv(env, sandbox) {
  const out = { ...env, PWD: sandbox };
  delete out.INIT_CWD;
  delete out.OLDPWD;
  return out;
}

export function formatCommandLine(cmd, args) {
  const quote = (s) => (/^[\w@%+=:,./\\()*-]+$/.test(s) ? s : `"${s.replace(/(["\\])/g, "\\$1")}"`);
  return [cmd, ...args].map(quote).join(" ");
}

/** Like formatCommandLine, for a shell spawn: cmd.exe cuts the line at the first newline, so refuse instead of truncating. */
export function shellCommandLine(cmd, args) {
  if ([cmd, ...args].some((a) => a.includes("\n") || a.includes("\r"))) {
    throw new Error(
      "refusing to pass an argument with a newline through a shell: cmd.exe would truncate the prompt; use the real executable (--agent-cmd <path to the .exe>)",
    );
  }
  return formatCommandLine(cmd, args);
}

/**
 * Real executable behind a Windows .cmd/.bat shim: the quoted path ending in .exe that starts with
 * %dp0% or %~dp0 (npm shims), resolved against the shim's folder. null when the text has none (a wrapper).
 */
export function shimExePath(text, shimDir) {
  const sep = "[\\\\/]";
  const m = [...text.matchAll(new RegExp(`"%~?dp0%?${sep}*([^"%]*?\\.exe)"`, "gi"))].pop(); // the last one is the launch line
  return m ? resolve(shimDir, ...m[1].split(new RegExp(`${sep}+`)).filter(Boolean)) : null;
}

export function shimFiles(nodePath, distCli, platform) {
  const files = [];
  if (platform === "win32")
    files.push({
      name: "trazo.cmd",
      content: `@echo off\r\n"${nodePath}" "${distCli}" %*\r\n`,
      executable: false,
    });
  files.push({
    name: "trazo",
    content: `#!/bin/sh\nexec "${nodePath}" "${distCli}" "$@"\n`,
    executable: true,
  });
  return files;
}

/**
 * Environment for one agent run. The user's own CLAUDE.md and auto memory would otherwise
 * load into every run (`--setting-sources` does not cover them) and skew both conditions.
 */
export function agentEnv(baseEnv, binDir, platform) {
  const env = { ...baseEnv };
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path") ?? "PATH";
  env[pathKey] = `${binDir}${platform === "win32" ? ";" : ":"}${env[pathKey] ?? ""}`;
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS = "1";
  return env;
}

// Agents often chain `trazo check x && trazo make x`; each segment is read on its own.
const segments = (cmd) => cmd.split(/&&|\|\||;|\n/).map((s) => s.trim());
const trazoVerbs = (cmd) => toolAdapter("trazo").verbs(cmd);
// A command that ran and failed reports "Exit code N". An error without it is the sandbox
// refusing the whole call (a heredoc or an `rm` next to trazo), so trazo never ran.
const denied = (block) =>
  block.is_error === true && !/^Exit code \d/.test(resultText(block.content));

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.map((c) => (typeof c === "string" ? c : (c?.text ?? ""))).join("\n");
  return "";
}

/**
 * Reads Claude Code `--output-format stream-json` output (one JSON object per line).
 * Assumed shapes: assistant messages carry tool_use blocks {id, name, input}; user messages
 * carry tool_result blocks {tool_use_id, is_error, content}; the last line is
 * {type:"result", is_error, usage:{input_tokens, output_tokens, cache_*}}.
 */
export function parseStream(text, tool = toolAdapter("trazo")) {
  const stats = {
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
    deniedCommands: 0,
    deniedTools: {},
  };
  if (tool.nativeVerb) stats.lastFinalizeOk = null;
  const uses = new Map();
  let failedSeen = false;
  let firstMakeSeen = false;
  let syntheticText = null;
  let resultReason = null;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== "object") continue;
    if (ev.type === "assistant" && ev.message?.model === "<synthetic>") {
      // Claude Code writes its own failures (auth, quota, API) as a synthetic assistant message.
      const t = ev.message.content?.find?.((b) => b?.type === "text")?.text;
      syntheticText = typeof t === "string" ? t : "";
    }
    if (ev.type === "result") {
      stats.hasResult = true;
      stats.resultIsError = ev.is_error === true;
      // Only failures of the agent's own service count; max turns, aborts and execution
      // errors can come from the tool under test, so they stay tool failures.
      if (ev.terminal_reason === "api_error") resultReason = "api_error";
      const u = ev.usage ?? {};
      stats.inputTokens = u.input_tokens ?? 0;
      stats.outputTokens = u.output_tokens ?? 0;
      stats.cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
      stats.cacheReadTokens = u.cache_read_input_tokens ?? 0;
      // Calls Claude Code refused for lack of permission; the agent never ran them.
      for (const d of Array.isArray(ev.permission_denials) ? ev.permission_denials : []) {
        const name = typeof d?.tool_name === "string" ? d.tool_name : "unknown";
        stats.deniedCommands++;
        stats.deniedTools[name] = (stats.deniedTools[name] ?? 0) + 1;
      }
      continue;
    }
    const blocks = ev.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      if (b?.type === "tool_use") {
        uses.set(b.id, b);
        const file = b.input?.file_path;
        if (
          (b.name === "Write" || b.name === "Edit") &&
          typeof file === "string" &&
          tool.repairFile(file) &&
          failedSeen
        )
          stats.repairs++;
        const cmd = b.input?.command;
        if (b.name === "Bash" && typeof cmd === "string") {
          for (const seg of segments(cmd)) {
            const input = tool.inputOf(seg);
            if (input) stats.lastMakeInput = input;
          }
        }
      } else if (b?.type === "tool_result") {
        const use = uses.get(b.tool_use_id);
        const cmd = use?.input?.command;
        if (use?.name !== "Bash" || typeof cmd !== "string") continue;
        const verbs = tool.verbs(cmd);
        if (verbs.length === 0 || denied(b)) continue;
        const failed = b.is_error === true || /^Exit code [1-9]/.test(resultText(b.content));
        if (failed) {
          stats.failedCommands++;
          failedSeen = true;
        }
        if (verbs.includes(tool.firstVerb) && !firstMakeSeen) {
          firstMakeSeen = true;
          stats.firstTryOk = !failed;
        }
        if (tool.nativeVerb && verbs.includes(tool.nativeVerb)) stats.lastFinalizeOk = !failed;
      }
    }
  }
  const agentError = agentErrorReason(resultReason, syntheticText);
  if (agentError) stats.agentError = agentError;
  return stats;
}

/** Short reason ("api_error: Failed to authenticate...") when the agent failed itself, else null. */
function agentErrorReason(reason, syntheticText) {
  if (reason === null && syntheticText === null) return null;
  const text = (syntheticText ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const head = reason ?? "synthetic";
  return text ? `${head}: ${text}` : head;
}

/** Runs that count toward the rates: the ones where the agent did not fail itself. */
export function withoutAgentErrors(runs) {
  return runs.filter((r) => !r.agentError);
}

export function countAgentErrors(runs) {
  return runs.length - withoutAgentErrors(runs).length;
}

const SHELL_TOOLS = ["shell", "bash"];
const FILE_TOOLS = ["write", "edit", "multiedit"];

/**
 * Reads `opencode run --format json` output (v2.1.3), one JSON object per line. Shapes seen:
 * a tool call is ONE {type:"tool_use", part:{tool, state:{status, input, metadata:{metadata:{exit}}}}}
 * event; a refused call has state.status "error" ("Permission denied: <tool>"); a command that
 * ran has status "completed" and the exit code in metadata.metadata.exit. Tokens come from each
 * step_finish (part.tokens), output tokens include reasoning. There is no final result
 * event: the run is finished when the last event is a text or a step_finish that is not
 * "tool-calls" (the very last step_finish is sometimes missing). Fatal errors are {type:"error"}.
 */
export function parseOpencodeStream(text) {
  const stats = {
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
  };
  let failedSeen = false;
  let firstMakeSeen = false;
  let closing = false;
  for (const raw of text.split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let ev;
    try {
      ev = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== "object") continue;
    const part = ev.part ?? {};
    if (ev.type === "error") {
      stats.resultIsError = true;
      closing = true;
    } else if (ev.type === "text") {
      closing = true;
    } else if (ev.type === "step_finish") {
      const t = part.tokens ?? {};
      stats.inputTokens += t.input ?? 0;
      stats.outputTokens += (t.output ?? 0) + (t.reasoning ?? 0);
      stats.cacheCreationTokens += t.cache?.write ?? 0;
      stats.cacheReadTokens += t.cache?.read ?? 0;
      closing = part.reason !== "tool-calls";
    } else if (ev.type === "tool_use") {
      closing = false;
      const state = part.state ?? {};
      if (state.status === "error") continue; // refused: the tool never ran
      const tool = part.tool;
      if (FILE_TOOLS.includes(tool)) {
        const file = state.input?.path ?? state.input?.filePath ?? state.input?.file_path;
        if (typeof file === "string" && file.endsWith(".json") && failedSeen) stats.repairs++;
        continue;
      }
      const cmd = state.input?.command;
      if (!SHELL_TOOLS.includes(tool) || typeof cmd !== "string") continue;
      for (const seg of segments(cmd)) {
        const m = /^trazo\s+make\s+(\S+)/.exec(seg);
        if (m) stats.lastMakeInput = m[1];
      }
      const verbs = trazoVerbs(cmd);
      if (verbs.length === 0) continue;
      const exit = state.metadata?.metadata?.exit;
      const failed = typeof exit === "number" && exit !== 0;
      if (failed) {
        stats.failedCommands++;
        failedSeen = true;
      }
      if (verbs.includes("make") && !firstMakeSeen) {
        firstMakeSeen = true;
        stats.firstTryOk = !failed;
      }
    }
  }
  stats.hasResult = closing;
  return stats;
}

/** Issue kinds of a judge result with how many times each appears. */
export function countIssues(issues) {
  const counts = {};
  for (const i of issues) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return counts;
}

/**
 * Final and judge pass rates per tool, overall and per task type. A run the judge could not
 * evaluate (judgeOk not a boolean, e.g. no browser) is left out of the judge rate.
 */
export function judgeSummary(runs, typeOfTask) {
  const rates = (list) => {
    const judged = list.filter((r) => typeof r.judgeOk === "boolean");
    return {
      runs: list.length,
      finalRate: list.length ? list.filter((r) => r.finalOk).length / list.length : null,
      judged: judged.length,
      judgeRate: judged.length ? judged.filter((r) => r.judgeOk).length / judged.length : null,
    };
  };
  const byTool = {};
  for (const r of runs) (byTool[r.tool ?? "trazo"] ??= []).push(r);
  const out = {};
  for (const [tool, all] of Object.entries(byTool)) {
    const list = withoutAgentErrors(all);
    const byType = {};
    for (const r of list) (byType[typeOfTask[r.task] ?? "unknown"] ??= []).push(r);
    const denials = { runs: 0, commands: 0, tools: {} };
    for (const r of list) {
      if (!r.deniedCommands) continue;
      denials.runs++;
      denials.commands += r.deniedCommands;
      for (const [name, n] of Object.entries(r.deniedTools ?? {}))
        denials.tools[name] = (denials.tools[name] ?? 0) + n;
    }
    out[tool] = {
      overall: rates(list),
      denials,
      byType: Object.fromEntries(Object.entries(byType).map(([t, l]) => [t, rates(l)])),
      agentErrors: countAgentErrors(all),
    };
  }
  return out;
}
