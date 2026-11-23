# trazo benchmark

This folder holds the benchmark for trazo: what an agent must read before it can draw a diagram, how long a large diagram takes to build, and how often an agent gets a diagram right.

## What it measures

| Metric | Target | How |
|---|---|---|
| Reading cost per type | under 2,000 tokens | skill body + `trazo schema <type>` + `trazo example <type>`, estimated as characters / 4 |
| `make` time, 50 nodes | under 1,000 ms | synthetic architecture diagram, 5 runs after one warm-up, median; the target applies to the in-process time, the CLI time is reported alongside |
| HTML size | at most 300 KB | the four examples and the 50-node diagram |
| Determinism | byte-identical | two `make` runs on the same JSON |
| First-try success, repairs, tokens, seconds | no fixed target | real agent runs, see below |

The first four are deterministic and run from this repository. The last row needs an agent and is recorded by the agent runner.

## Run the deterministic part

```sh
npm run build
npm run bench
```

The script reads `dist/`, prints a table, and writes `bench/results/<YYYY-MM-DD>-deterministic.json`. Options:

- `--runs N` sets the number of timed runs (default 5).
- `--no-write` prints the table without writing a file.
- `--summary <file>` prints the per-condition summary of an agent result file.

The script exits with 1 if any output differs between two runs or any HTML file is over 300 KB. The time target is reported, not enforced, because timings depend on the machine.

The `make` target measures trazo itself: validation, layout and rendering, called in-process. The CLI time adds starting Node and loading the modules, close to one second on its own (elkjs alone takes about half of it), so a single CLI call stays above one second even for small diagrams. It is recorded so start-up regressions stay visible, but it is not held to the target.

## Agent runs

`tasks.json` lists 8 tasks, two per diagram type. Each task is run 3 times under two conditions, which gives 48 runs per agent and model:

- `skill`: the trazo skill is installed.
- `no-skill`: no skill; the agent only has `trazo --help`.

Runs are driven by `bench/run-agent.mjs`, which drives an agent CLI in headless mode: Claude Code (default) or OpenCode (`--agent opencode`, see [OpenCode runs](#opencode-runs)). A real run spends model quota, so it is never part of `npm test` or CI.

Pilot (one task, skill condition, one run):

```sh
npm run build
node bench/run-agent.mjs --model claude-sonnet-5-5 --task arch-shop --condition skill --runs 1
```

Preview the exact command lines without running anything by adding `--dry-run`. Full set (8 tasks x 2 conditions x 3 runs = 48 runs):

```sh
node bench/run-agent.mjs --model claude-sonnet-5-5
```

Options:

- `--model <id>` is required.
- `--task <id>` can be repeated; the default is every task in `tasks.json`.
- `--condition skill|no-skill|both` (default `both`) and `--runs N` (default 3).
- `--out <file>` (default `bench/results/<YYYY-MM-DD>-agent-<agent>.json`). An existing file must hold the same agent and model, or the runner stops.
- `--agent-cmd <path>` replaces the `claude` command; a `.mjs` or `.js` path is run with Node. Tests use it to inject a fake agent.
- `--timeout <seconds>` per run (default 600). A run that times out is recorded with a note.
- `--resume` skips runs already in the output file. Each run is written to the file as soon as it ends, so an interrupted session keeps its results.
- `--sandbox-root <dir>` moves the sandboxes (default `tmp/bench-runs/<model>`, where `<model>` is the `--model` value with characters outside `A-Za-z0-9._-` replaced by `-`).

What is isolated, for every run:

- A new sandbox directory `tmp/bench-runs/<model>/<task>-<condition>-<n>/` is the working directory. It is deleted and recreated if it already exists.
- The agent is started with `--setting-sources project`, so user and local settings and skills are not loaded, and with `--strict-mcp-config`, so no MCP server is available.
- `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` are set, because `--setting-sources` does not stop the user's own `~/.claude/CLAUDE.md` or auto memory from loading. `--bare` would also skip them, but it only accepts an API key, not a signed-in account.
- `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1` is set, because the sandboxes sit inside this repository: without it the agent sees the trazo repo's git status and history in its system prompt.
- The only tools are `Read`, `Write`, `Edit` and `Bash(trazo:*)`: Bash can run `trazo` and nothing else.
- `trazo` is a small shim on `PATH` that runs `dist/cli/main.js` from this checkout.
- Condition `skill`: `skill/SKILL.md` is copied to `.claude/skills/trazo/SKILL.md` in the sandbox. Condition `no-skill`: nothing is added; the prompt only says that `trazo` exists and that `trazo --help` explains it.
- The prompt is the task text from `tasks.json` plus one fixed sentence asking for `diagram.html` in the current directory. It is the same for both conditions.

Each sandbox keeps `stream.jsonl` (the raw agent output, for audit) and `stderr.log`. The runner fills the record itself: tokens from the final `result` message, failed commands and repairs from the tool calls, `seconds` from the wall clock, and `finalOk` by running `trazo check` on the final JSON after the agent ends.

The runner saves the runs as `bench/results/<YYYY-MM-DD>-agent-<agent>.json`:

```json
{
  "kind": "agent",
  "date": "2026-01-01",
  "trazoVersion": "0.1.0",
  "agent": "name of the agent",
  "model": "name of the model",
  "runsPerTask": 3,
  "runs": [
    {
      "task": "arch-shop",
      "condition": "skill",
      "run": 1,
      "inputTokens": 0,
      "outputTokens": 0,
      "cacheCreationTokens": 0,
      "cacheReadTokens": 0,
      "failedCommands": 0,
      "repairs": 0,
      "firstTryOk": true,
      "finalOk": true,
      "seconds": 0,
      "notes": "optional"
    }
  ]
}
```

- `failedCommands`: number of `check` or `make` calls that exited with a non-zero code.
- `repairs`: number of edits to the JSON after the first failure.
- `deniedCommands`, `deniedTools`: calls Claude Code refused for lack of permission and their count per tool name (see "Permission denials").
- `firstTryOk`: the first `make` exited with 0. A chained call such as `trazo check x && trazo make x` counts as that `make`. A call the sandbox refused (an error without `Exit code N`) is not counted, because trazo never ran.
- `finalOk`: `diagram.html` exists and `trazo check` passes on the final JSON.
- `cacheCreationTokens` and `cacheReadTokens` are reported separately from `inputTokens` and are 0 if the agent does not report them. With prompt caching `inputTokens` is only the uncached part, a few dozen tokens; the summary also gives the median total input (uncached + cache creation + cache read), which is what a run actually read.

Run `node scripts/bench.mjs --summary <file>` to get, per condition, the number of runs, the first-try and final success rates, and the medians of repairs, uncached and total input tokens, output tokens and seconds.

## Comparing tools (trazo and Archify)

`--tool trazo|archify` picks the tool under test. It can be repeated or given as a comma list (`--tool trazo,archify`); the default is `trazo` and nothing else about a trazo-only run changes. `--browser <path>` sets the Chrome or Edge that Archify uses (default: `BENCH_BROWSER`, then the usual install paths). `--tool archify` needs `--agent claude-code`, and Archify only runs in the `skill` condition.

`--effort low|medium|high|xhigh|max` is passed to Claude Code as `--effort <level>` for every run of the matrix, so both tools get the same level. Without it nothing is passed and the agent uses its own default. It is rejected with `--agent opencode`. Every run record and the results header carry `effort` (`null` when unset); `--out` refuses to mix levels in one file.

Archify is pinned to v3.2.0 and staged once, outside this repository:

```sh
node bench/stage-archify.mjs [--sandbox-root <dir>]
```

It runs `git clone --depth 1 --branch v3.2.0 https://github.com/tt-a1i/archify` into `<root>/_archify-v3.2.0` (skipped when present) and prints the folder that holds the skill. It needs git and network access. Nothing from the clone is read or copied into this repo.

What changes when `archify` is in `--tool`:

- The sandbox root defaults to `<os tmp>/trazo-bench` (on Windows `%TEMP%\trazo-bench`) and runs live at `<root>/<model>/<task>-<tool>-<condition>-<n>`. `--sandbox-root` replaces the root and keeps the `<model>` folder. The clone is `<root>/_archify-v3.2.0`.
- With `--tool`, run names carry the tool (`arch-shop-archify-skill-1`); without it they stay `arch-shop-skill-1`.
- With several tools the order flips on the parity of task index plus run index (both counted from 0): the given order when the sum is even, reversed when it is odd. Across the matrix each tool goes first in half of the runs.
- The staged skill folder is copied into `<sandbox>/.claude/skills/archify/`. Only that folder is copied, without `.git` and `node_modules`. The allowed tools are `Read`, `Write`, `Edit` and `Bash` rules for `node <sandbox>/.claude/skills/archify/bin/archify.mjs` (forward slashes, also on Windows) and for the relative `.claude/skills/archify/bin/archify.mjs` (with and without `./`), each plain and in double quotes. The environment adds `ARCHIFY_UPDATE_CHECK_DISABLED=1` and, when a browser is found, `ARCHIFY_CHROME=<browser path>`.
- The prompt asks for the `archify` skill and for `diagram.html` in the current directory, and states the exact command (`node <sandbox>/.claude/skills/archify/bin/archify.mjs <command> <file>`). The trazo prompt keeps naming `trazo`. There is no `trazo` shim for Archify-only runs.
- Native success (`finalOk`) is `diagram.html` exists and the last `finalize` call exited 0. Failed commands count every `archify.mjs` call that failed; `firstTryOk` is the first `finalize`; repairs are edits to a `.json` or `.html` file after a failure.
- Each run records `tool`, `toolVersion` (`v3.2.0` for Archify, the package version for trazo) and `agentVersion` (the first line of `claude --version`, or `unknown`). Tokens keep four separate classes: `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheCreationTokens`. `--resume` matches on tool as well.

### First try per tool

`firstTryOk` means the first call of the tool's own build step exited with 0, and the two tools are not the same step:

- trazo: the first `trazo make`.
- archify: the first `finalize`.

Compare it across tools with that in mind: `finalize` also runs Archify's own checks.

A refused call is not counted, so a run whose first `finalize` was refused has `firstTryOk: false` until a later `finalize` runs, and then that later call is the one that counts. In the first Haiku run (invalid, see below) `firstTryOk` was false in 18 of 18 Archify runs without agent error, and the parser was right: in 12 the first `finalize` that ran exited 1 on schema validation (for example `/boundaries/0/kind ... must be equal to one of the allowed values`, or `/nodes/7 ... must NOT have additional properties`), and in 6 no `finalize` ever ran because every call was refused (PowerShell, see below). So the figure measures the tool as it is: Archify's strict schema rejects the first spec the agent writes.

### Permission denials

On Windows, Claude Code offers a `PowerShell` tool next to `Bash`. The runner's `--allowedTools` rules only cover `Bash(...)`, so PowerShell calls were refused without a visible error, and the agent often stopped asking for approval. Both tools were hit (Archify in 15 of 24 runs, trazo in 5 of 24 in the invalid run).

- Claude Code runs now pass `--disallowedTools PowerShell` for every tool, so the agent uses Bash as on Linux and macOS. OpenCode runs are unchanged.
- Each run records `deniedCommands` (the number of entries in the final result's `permission_denials`) and `deniedTools` (count per tool name, for example `{"Bash": 1}`). The summary shows, per tool, `denials`: runs with any denial, total commands and counts per tool name. A run with denials that failed still counts as a tool failure; the denials only make the cause visible. Denials do not appear for OpenCode runs (`0` and `{}`).
- Other Bash denials seen in the invalid run: output redirection (`trazo example x > diagram.json`, which Claude Code asks about because it writes a file; the agent has `Write`), PowerShell syntax pasted into Bash, and Archify calls spelled with Windows backslashes, as `/c/...` Git Bash paths, or with a `../..` relative path after a `cd`. The Git Bash spelling of the exact allowed path is now allowed too. Backslash paths cannot be written as rules (`\` escapes in a rule), and the prompt already names the exact command, so they stay refused for both tools. Redirection and shell scripts are not a use of the tool under test and stay refused.

### Judge

After every run, whatever the tool, the runner opens `<sandbox>/diagram.html` in headless Chrome or Edge with `bench/judge-html.mjs` and writes `<sandbox>/diagram.png`. The judge knows nothing about either tool: it only looks at the visible text. Each task in `tasks.json` has an `expect` list with the names its prompt states (entities, steps, participants) and nothing else; `erd-payments` has none because its prompt names no table.

Each run record gets `judgeOk`, `judgeIssues` (issue kind to count) and `screenshot` (path). A run with no `diagram.html` is `judgeOk: false` with `{"no-html": 1}`. If the browser cannot be started the run gets `judgeOk: null` and `judgeError`, and is left out of the judge rate. A browser failure never counts against the tool.

Issue kinds:

- `content-missing`: an expected term (case-insensitive, whitespace-normalized, whole word or phrase) is not in the visible text.
- `text-overlap`: the boxes of two different text nodes overlap by more than 2 px on both axes.
- `text-clipped`: a text box extends past an ancestor with `overflow: hidden` or `clip`. The owning `<svg>` counts as such an ancestor only through its own `overflow`: text past the viewport of an svg with `overflow: visible` is drawn in full and is not reported.
- `outside-page`: a text box has negative coordinates or lies beyond the document size.
- `js-error`: an uncaught exception or a console error while loading.
- `render-empty`: there is no visible text.

### Judging again

`--rejudge` judges the runs of an existing results file again, for example after a judge fix or a change to a task's `expect` list. No agent runs: it needs `--out <results.json>`, `--model` (and `--sandbox-root` or `--tool archify` when the original run used them, so the sandboxes are found), and it reads each `<sandbox>/diagram.html`.

```
node bench/run-agent.mjs --model claude-haiku-4-5 --out bench/results/<file>.json --rejudge
```

Each run gets new `judgeOk`, `judgeIssues` and `screenshot` values, using the task's current `expect`. A missing `diagram.html` stays `no-html`; runs with `agentError` are not touched. Nothing else in the record changes. The file is rewritten and the summary is printed.

### Author preference rating

`bench/rate-pairs.mjs` builds a rating page from a results file: one pair per task (the lowest run where both tools produced a final diagram, else run 1, flagged), screenshots side by side with the tool names, a preference (trazo, Archify or tie), a 1-5 score per tool and a note. **Export JSON** downloads the ratings with `"blind": false`: the rater knows which tool made each diagram, so publish these ratings as the author's preference, never as a blind evaluation.

```sh
node bench/rate-pairs.mjs bench/results/<file>.json --sandbox-root <root>
```

The page is written to `<root>/_rating/index.html` (default root `<os tmpdir>/trazo-bench`, `--out` overrides the file) and reads the screenshots from the run sandboxes, so it stays outside the repo.

### Agent errors

When the agent fails before doing the task (for example Claude Code with an expired login: the stream's final `result` has `terminal_reason: api_error`, or Claude Code wrote a synthetic `<synthetic>` assistant message). Max turns, aborts and execution errors are not agent errors: the tool under test can cause them, so they count as tool failures, the run records `agentError: "<short reason>"` and keeps the raw fields. It is not judged, a warning is printed, and it is left out of every rate (`finalRate`, `judgeRate`, `firstTryRate` and the medians). The summary counts them apart as `agentErrors` per tool. `--resume` runs them again instead of skipping them.

The summary printed at the end of a run adds, per tool and per task type, `finalRate` next to `judged` and `judgeRate`.

Hidden on purpose: text with no visible area left after clipping counts as invisible, like `display:none`. It is not counted, not checked and does not satisfy an `expect` term. That covers the screen-reader-only pattern: a box of at most 2 px, `clip: rect(0 0 0 0)`, `clip-path: inset(50%)`, or text entirely outside an `overflow: hidden` container. Text that is partly visible and partly cut off is still reported as `text-clipped`. The `<svg>` viewport is not part of this rule, so SVG text past it stays `text-clipped`.

Limits: the judge sees text, not lines, colors or shapes, so a diagram with crossing edges or a wrong structure can still pass. An `expect` term matches whole words or phrases only (word boundaries on both ends, `_` counts as part of a word), so `app` does not match inside `application` and `api` not inside `rapid`, while `post_tags` matches itself. An agent that writes `DB` for `database` still fails `content-missing` even though the diagram is right. The browser profiles go to `<root>/_judge-*` (the sandbox root, not the system temp folder) and are removed after each judgement.

## OpenCode runs

`--agent opencode` runs free OpenCode models (for example `opencode/deepseek-v4.1-flash-free`, no API key needed) with `opencode run --standalone -m <model> --format json <prompt>`. The harness is OpenCode, not Claude Code, so a result is labeled `"agent": "opencode"` with its `agentVersion` (the output of `opencode --version`) and is **not comparable 1:1 with a Claude Code run**: the system prompt, tools and context handling differ as well as the model. Compare an OpenCode result with the other conditions of the same agent and model. It spends free-model quota; run a pilot first:

```sh
node bench/run-agent.mjs --agent opencode --model opencode/deepseek-v4.1-flash-free --task arch-shop --condition skill --runs 1 --out tmp/pilot.json
```

**Which binary runs.** On Windows `opencode` is usually a `.cmd` shim, and `cmd.exe` cuts a command line at the first newline, which would drop everything after the first line of the prompt (including the instruction to save `diagram.html`). So the runner never passes a prompt through `cmd.exe`: it goes through the `where` results in order and takes the first that is an `.exe`, or a `.cmd`/`.bat` shim whose launch line is a quoted `%dp0%\...\opencode.exe` (the npm shim) that exists; a `.cmd` wrapper that does not reference an `.exe` is skipped. It spawns that `.exe` directly, prints `agent binary: <path>` at start and saves it as `agentBin` in the results file, so a run can be audited. If nothing qualifies it stops with an error; pass `--agent-cmd <path to opencode.exe>`. As a guard, a shell spawn with a newline in an argument throws instead of truncating it.

What differs from the Claude Code runs:

- **Sandbox outside the repository.** The default root is `<os temp dir>/trazo-bench-runs/<model>/`. OpenCode sees the git repository around its working directory (its snapshots hold the repo tree), so a sandbox inside this checkout would leak it. An explicit `--sandbox-root` still wins; keep it outside any repository.
- **Working directory.** OpenCode takes its project directory from `$PWD`, not from the spawn directory. The runner sets `PWD` to the sandbox on every run (and drops `INIT_CWD` and `OLDPWD`); without it the agent works in the folder the runner was launched from and ignores the sandbox's `opencode.json`.
- **Permissions.** Each sandbox gets an `opencode.json` with `"*": "deny"`, then `read` and `edit` (which covers `write`) allowed, `external_directory` denied, and the shell allowed only for `trazo *`. A call that does not match (`ls`, `bash -c 'trazo ...'`, `trazo check x && rm x`) is refused at once with `Permission denied` instead of waiting for approval. Skills are denied except `trazo`, and only in the `skill` condition. There is no glob, grep, list or web tool.
- **Isolation.** `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `HOME` and `USERPROFILE` point to `<sandbox root>/_opencode/`, so the user's OpenCode config, plugins, MCP servers, auth and sessions are not read. `OPENCODE_DISABLE_CLAUDE_CODE=1` stops it from loading `~/.claude` skills and CLAUDE.md. Other `OPENCODE_*` variables of the user are dropped. `--standalone` gives each run a private server instead of the shared background service. On the machine used to build this, OpenCode still found skills under the real `~/.agents/skills` whatever the environment said; the skill permission rules hide them (the agent saw only `trazo`).
- **Skill.** Condition `skill` copies `skill/SKILL.md` to `.opencode/skills/trazo/SKILL.md`; `no-skill` adds nothing.
- **Parser.** `parseOpencodeStream` reads the JSONL: a tool call is one `tool_use` event; a shell command that ran has `state.status: "completed"` and its exit code in `state.metadata.metadata.exit`; a refused call has `state.status: "error"` and is not counted. Failed commands, repairs and `firstTryOk` follow the definitions above. OpenCode has no final result message: a run counts as finished when the last event is a `text` or a `step_finish` other than `tool-calls` (an `error` event marks it as errored).
- **Tokens.** They come from each `step_finish` event (`part.tokens`) and are summed over the steps: `inputTokens` is the uncached input, `cacheReadTokens` and `cacheCreationTokens` are `cache.read` and `cache.write`, and `outputTokens` is `output` plus `reasoning`. OpenCode sometimes omits the last `step_finish`, so a run can undercount its final step; a run with no `step_finish` at all shows 0 tokens.

## Results

This table is filled only with measured runs, each row naming the agent, the model and the date.

| Agent | Model | Date | Condition | Runs | First-try rate | Final success | Median repairs | Median total input tokens | Median output tokens | Median seconds |
|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code 2.1.308 | claude-sonnet-5-5 | 2026-10-31 | skill | 24 | 100% | 100% | 0 | 106,483 | 1,658 | 22.1 |
| Claude Code 2.1.308 | claude-sonnet-5-5 | 2026-10-31 | no-skill | 24 | 100% | 100% | 0 | 105,205 | 1,693 | 22.7 |

| Claude Code 2.1.308 | claude-haiku-4-5 | 2026-10-31 | skill | 24 | 71% | 88% | 0 | 158,490 | 2,461 | 30.3 |
| Claude Code 2.1.308 | claude-haiku-4-5 | 2026-10-31 | no-skill | 24 | 71% | 92% | 0 | 139,241 | 1,988 | 25.8 |

The task prompts were reworded as requests ("Draw a sequence diagram of ...") after the Haiku 4.5 runs, so the four rows above used the earlier wording. The rows below were run after that change and after the CLI and schema hints (milestone H7):

| Agent | Model | Date | Condition | Runs | First-try rate | Final success | Median repairs | Median total input tokens | Median output tokens | Median seconds |
|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code 2.1.308 | claude-sonnet-5-5 | 2026-10-31 | skill | 24 | 100% | 100% | 0 | 114,992 | 1,381 | 20.5 |
| Claude Code 2.1.308 | claude-sonnet-5-5 | 2026-10-31 | no-skill | 24 | 100% | 100% | 0 | 123,700 | 1,669 | 22.3 |
| Claude Code 2.1.308 | claude-haiku-4-5 | 2026-10-31 | skill | 24 | 96% | 100% | 0 | 152,209 | 2,551 | 30.4 |
| Claude Code 2.1.308 | claude-haiku-4-5 | 2026-10-31 | no-skill | 24 | 92% | 100% | 0 | 127,893 | 1,997 | 24.9 |

Raw runs: `bench/results/2026-10-31-agent-claude-code.json` (Sonnet) and `bench/results/2026-10-31-agent-claude-code-haiku-4-5.json` (Haiku) for the first rows; `bench/results/2026-10-31-agent-claude-code-sonnet-5-5-rerun.json` and `bench/results/2026-10-31-agent-claude-code-haiku-4-5-rerun.json` for the rerun.

What this says: with this model, `trazo --help`, `trazo schema` and `trazo example` are enough to get a valid diagram on the first `make`, with or without the skill. No run failed a `trazo` command. The skill did not make runs cheaper or faster; the two conditions are within about 1% on tokens and seconds. Its value is that the agent knows trazo exists and when to reach for it, which these tasks do not measure, because the prompt already names the command.

With Haiku 4.5 the numbers drop below the v1 target of 90% first-try success, again with no gain from the skill. Reading every failed run, the misses fall in four groups:

- The agent never started (4 runs, all `seq-oauth`): it read the task as context and asked what to draw. The task prompts are short descriptions, not requests; Sonnet took them as requests, Haiku did not always.
- `trazo <file>` without `make` (5 runs): the CLI answers `unknown command`, and the agent fixes it on the next call.
- Guessed sequence fields (5 runs): `actors` and `interactions` instead of `participants` and `messages`, and `over` as a string instead of a list (2 runs). The error messages name the allowed fields, and every one of these runs recovered.
- Workflow lanes (4 runs): a step left out of every lane or listed in two. The message says what to do and one edit fixed it.

One skill run wrote its JSON inside the skill's own folder, which the sandbox refused, and ended without a diagram.

After H7 (request-worded prompts, `trazo <file>` and `--output` hints, a hint for a missing top-level field, `over` accepted as a string), Haiku 4.5 reaches 96% first-try success with the skill and 92% without, and every run ends with a valid diagram. Three runs missed the first `make` (`arch-monorepo` skill, `wf-expenses` no-skill, `seq-oauth` no-skill); each failed one command and recovered with one edit. Their `stream.jsonl` files are gone: the Sonnet rerun used the same sandbox directories right after, so the cause of these three misses was not recorded. Sonnet 5.5 stays at 100%. The skill still makes runs neither cheaper nor more successful on these tasks.

On 2026-11-02 the skill gained a step about content (read the code first and draw only what you found, one level of detail, ask when the scope is unclear, `source` as `path:line`). Haiku 4.5 was rerun on the skill condition only, since the no-skill condition did not change:

| Agent | Model | Date | Condition | Runs | First-try rate | Final success | Median repairs | Median total input tokens | Median output tokens | Median seconds |
|---|---|---|---|---|---|---|---|---|---|---|
| Claude Code 2.1.308 | claude-haiku-4-5 | 2026-11-02 | skill | 24 | 92% | 100% | 0 | 132,770 | 2,575 | 28.9 |

Raw runs: `bench/results/2026-11-02-agent-claude-code-haiku-4-5-skill-content.json`. That is 22 of 24 against 23 of 24 before, a difference of one run, within the spread of three runs per task. No run asked a question instead of drawing. Both misses wrote the JSON without running `trazo example`: `arch-monorepo` never loaded the skill and used an edge arrow that does not exist (`<-~>`); `erd-blog` loaded it and guessed `kind`, `name` and `fields` instead of `type`, `id` and `columns`. Each recovered from the error messages. These tasks give the content in the prompt, so they check that the longer skill does not hurt the format; they do not measure whether diagrams of real code get better.

Two no-skill runs were first recorded with `firstTryOk: false`: the agent chained `trazo make` with an `rm` that the sandbox refused, then ran `make` again and it passed. The parser was fixed to skip refused calls only, and every run was recomputed from its `stream.jsonl`; only those two values changed.

Deterministic results are in `bench/results/*-deterministic.json`.

## trazo across agents

trazo only, same 8 tasks. First-try is the share of runs whose first `make` exited with 0; final is the share that ended with a valid diagram. The Claude Code rows are the reruns after H7 (detailed tables in [Results](#results)); the Codex rows are runs with trazo 0.1.1 from npm.

| Agent | Model | trazo | Condition | Runs | First-try | Final |
|---|---|---|---|---|---|---|
| Claude Code 2.1.308 | claude-sonnet-5-5 | 0.1.0 | skill | 24 | 100% | 100% |
| Claude Code 2.1.308 | claude-sonnet-5-5 | 0.1.0 | no-skill | 24 | 100% | 100% |
| Claude Code 2.1.308 | claude-haiku-4-5 | 0.1.0 | skill | 24 | 96% | 100% |
| Claude Code 2.1.308 | claude-haiku-4-5 | 0.1.0 | no-skill | 24 | 92% | 100% |
| Codex CLI 0.166.0 | gpt-6-luna | 0.1.1 | skill | 23 | 100% (23/23) | 100% (23/23) |
| Codex CLI 0.166.0 | gpt-6-luna | 0.1.1 | no-skill | 23 | 100% (23/23) | 100% (23/23) |

The Codex runs were driven by a local manual harness, not by `bench/run-agent.mjs`, and are summarized in `bench/results/2026-11-04-baseline-codex-gpt-6-luna.json`. Two of the 48 Codex trazo runs (`wf-expenses-skill-2`, `erd-payments-no-skill-2`) are excluded: Codex could not start a shell, so trazo never ran. The two harnesses differ in system prompt, tools and context handling, so Codex and Claude Code rows are not comparable 1:1.

## Baseline: trazo vs hand-written SVG vs Mermaid

The question: what does an agent get without trazo?

### Method

- Same 8 tasks and the same task prompts as above, 3 runs per task and condition, Codex CLI 0.166.0 with `gpt-6-luna`, run on 2026-11-04.
- Conditions:
  - `trazo`: the agent uses trazo 0.1.1. `no-skill` is the main reference; `skill` is shown too.
  - `svg`: the agent writes one self-contained `diagram.html` with inline SVG and runs no shell commands.
  - `mermaid`: the agent writes `diagram.mmd` and may run only `mmdc` (11.17.1) to render it.
- Final success: a diagram was produced and rendered without a page script error (for trazo, `trazo check` also passes on the final JSON).
- First try: the first `make` (trazo) or the first `mmdc` call (mermaid) exited with 0. Not applicable to svg, which has no command to run.
- Text checklist: each task has a short list of labels that must appear in the rendered text (for example `web`, `api`, `database`, `queue`, `payment` for `arch-shop`). The same lists apply to every condition. It is a text match, so it does not judge the layout.
- Layout defects: every output is opened in headless Chromium and measured by one detector for all conditions. It counts 5 kinds: text overlapping text, text outside the canvas, text overflowing its node, an edge crossing a node it does not connect, and two nodes overlapping. A run has a defect if the detector reports at least one.
- Render determinism: the same source is rendered twice and the outputs are compared byte by byte.
- Tokens and seconds come from the Codex session log; the table gives medians per run.

### Results

| | trazo no-skill | trazo skill | svg | mermaid |
|---|---|---|---|---|
| Runs (excluded as infrastructure failures) | 23 (1) | 23 (1) | 24 | 24 |
| Final success | 23/23 | 23/23 | 23/24 | 24/24 |
| First try | 23/23 | 23/23 | n/a | 19/24 |
| Text checklist | 21/23 | 22/23 | 21/24 | 21/24 |
| Runs with layout defects | 0/23 | 0/23 | 20/24 | 7/24 |
| Total defects | 0 | 0 | 113 | 14 |
| Render determinism | 23/23 | 23/23 | static file | 13/24 |
| Median input tokens | 72.7k | 106.3k | 44.0k | 56.1k |
| Median cached input tokens | 65.5k | 97.0k | 36.5k | 52.4k |
| Median output tokens | 0.9k | 1.1k | 3.6k | 0.5k |
| Median seconds | 45.2 | 58.7 | 85.0 | 40.0 |

Notes on the table:

- The detector found 8 runs with defects in Mermaid (15 defects). One report was a false positive: in `wf-expenses-mermaid-2` it flagged two nodes as overlapping, but a screenshot shows nothing overlapping. The table counts 7 runs and 14 defects. Two other Mermaid reports (edges through nodes in `arch-monorepo-mermaid-1`, a note whose text passes its box in `seq-checkout-retry-mermaid-1`) and one svg run (`wf-onboarding-svg-1`) were checked in screenshots and are real. The remaining reports were not all checked by hand.
- Defects by kind: svg 24 text overlap, 45 text overflowing a node, 22 edges through a node, 22 overlapping nodes; mermaid (after the correction) 4 text overflowing a node, 10 edges through a node. The trazo outputs had none of the 5 kinds.
- Median input tokens include cached input. The 5 Mermaid runs that did not pass on the first `mmdc` call fixed a syntax error and ran it again; all 24 ended with a rendered diagram.
- One svg run (`wf-expenses-svg-3`) ended with a script error in the page (a negative rect height) and counts as a failure.
- Shell commands outside the allowed set (mostly `Get-Location`) appeared in 9 svg and 7 mermaid runs; they changed nothing and the runs are kept.

### Token cost

Cached input is billed at a lower rate than uncached input, and output at a higher one, so the three are kept apart. Relative cost per run, from the medians above:

`cost = (input - cached) + 0.1 * cached + w * output`, in thousands of token-equivalents, with `w = 4` and `w = 8` for output.

| Condition | Uncached input | Cached input | Output | Cost, w = 4 | Cost, w = 8 |
|---|---|---|---|---|---|
| mermaid | 3.8k | 52.4k | 0.5k | about 11 | about 13 |
| trazo no-skill | 7.2k | 65.5k | 0.9k | about 17 | about 21 |
| trazo skill | 9.3k | 97.0k | 1.1k | about 23 | about 28 |
| svg | 7.5k | 36.5k | 3.6k | about 26 | about 40 |

Against trazo without the skill, Mermaid costs 38% less at `w = 4` and 40% less at `w = 8`, and hand-written SVG costs more (47% more at `w = 4`, 90% more at `w = 8`). The weights are assumptions, not a price list; the ranking of mermaid, trazo no-skill and svg holds for both. These are medians of different runs, so the figures are not a sum over the table rows.

### What the numbers do not show

- The 13/24 Mermaid render determinism is a byte comparison. In a spot check of two runs that differ, one rendered the same pixels twice and the other did not; how much the visible layout changes was not measured.
- The svg runs read no help and no examples and still used a median of 44k input tokens, so most of the input in every condition is context the agent carries in every run. On tasks this small it dominates.
- The trazo `skill` condition costs more than `no-skill` here, with the same final success. With Claude Code it cost more with Haiku 4.5 and less with Sonnet 5.5.

### Limits

- One model and one harness for the baseline. Results may differ with another model or agent.
- 8 small tasks and 3 runs each; the rates are a trend, not a guarantee.
- The layout detector is a heuristic with one confirmed false positive, and it cannot see problems it does not measure (for example a diamond whose text leaves a corner but stays inside its bounding box).
- This bench was made by the author of the tool.
- The scripts that drive Codex and analyze the sessions are local and are not part of this repository, which is why the numbers come with a summary file instead of a command. To reproduce: run the 8 prompts from `tasks.json` three times per condition in Codex CLI 0.166.0 with `gpt-6-luna`, a clean work folder and no user instructions or skills, allow only the commands named above, then open each output in headless Chromium and count the 5 defect kinds.
- The summary and per-run numbers are in `bench/results/2026-11-04-baseline-codex-gpt-6-luna.json`.

## Limits

- Each model gets its own sandbox folder under the default `--sandbox-root`, so a second model does not replace the first model's `stream.jsonl` files. An explicit `--sandbox-root` is used as given, with no model folder; reusing it for another model replaces the earlier sandboxes.
- Agents are not deterministic. Three runs per task and condition show a trend, not a guarantee.
- Timings depend on the machine, the Node version and background load. Compare numbers from the same machine only.
- Token counts in the deterministic part are estimates (characters / 4), not a real tokenizer.
