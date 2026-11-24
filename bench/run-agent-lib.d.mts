// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

export interface Task {
  id: string;
  type: string;
  level: number;
  prompt: string;
  expect: string[];
}
export interface RunOptions {
  model: string;
  tasks: string[];
  conditions: ("skill" | "no-skill")[];
  runs: number;
  out: string;
  agentCmd: string;
  timeout: number;
  dryRun: boolean;
  resume: boolean;
  /** Set only with --rejudge. */
  rejudge?: boolean;
  sandboxRoot: string;
  tools: ToolName[];
  browser: string;
  effort: "" | "low" | "medium" | "high" | "xhigh" | "max";
}
export type ToolName = "trazo";
export interface ToolAdapter {
  name: ToolName;
  version: string | null;
  promptSuffix: string;
  bashRules: string[];
  skillName: string;
  env: Record<string, string>;
  shim: boolean;
  repairFile(file: string): boolean;
  verbs(cmd: string): string[];
  firstVerb: string;
  nativeVerb: string | null;
  inputOf(segment: string): string | null;
  nativeOk: ((stats: { lastFinalizeOk?: boolean | null }, htmlExists: boolean) => boolean) | null;
}
export interface RunPlan {
  tool?: ToolName;
  task: string;
  condition: "skill" | "no-skill";
  run: number;
}
export interface StreamStats {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  failedCommands: number;
  repairs: number;
  firstTryOk: boolean;
  hasResult: boolean;
  resultIsError: boolean;
  agentError?: string;
  lastMakeInput: string | null;
  deniedCommands?: number;
  deniedTools?: Record<string, number>;
  lastFinalizeOk?: boolean | null;
}
export const PROMPT_SUFFIX: string;
export function parseArgs(argv: string[], knownTasks: string[], today: string): RunOptions;
export function toolAdapter(name: string): ToolAdapter;
export function sandboxLayout(
  opts: { model: string; sandboxRoot: string; tools: string[]; agent: AgentName },
  repoRoot: string,
  tmpDir: string,
): { runs: string; profileHome: string };
export function buildPrompt(taskPrompt: string, tool?: ToolAdapter): string;
export function buildAgentArgs(
  prompt: string,
  model: string,
  agent?: AgentName,
  tool?: ToolAdapter,
  effort?: string,
): string[];
export function planRuns(
  taskIds: string[],
  conditions: string[],
  runs: number,
  tools?: string[],
): RunPlan[];
export function runName(plan: RunPlan): string;
export function modelDir(model: string): string;
export function parseStream(text: string, tool?: ToolAdapter): StreamStats;
export function parseOpencodeStream(text: string): StreamStats;
export function skillSegments(agent: AgentName, skillName?: string): string[];
export function defaultSandboxRoot(
  agent: AgentName,
  model: string,
  repoRoot: string,
  tmpDir: string,
): string;
export function opencodeConfig(condition: "skill" | "no-skill"): {
  $schema: string;
  permission: Record<string, unknown>;
};
export function opencodeEnv(
  baseEnv: Record<string, string | undefined>,
  binDir: string,
  stateDir: string,
  platform: string,
): Record<string, string | undefined>;
export function agentEnv(
  baseEnv: Record<string, string | undefined>,
  binDir: string,
  platform: string,
): Record<string, string | undefined>;
export function shimFiles(
  nodePath: string,
  distCli: string,
  platform: string,
): { name: string; content: string; executable: boolean }[];
export function formatCommandLine(cmd: string, args: string[]): string;
export function opencodeRunEnv(
  env: Record<string, string | undefined>,
  sandbox: string,
): Record<string, string | undefined>;
export function shellCommandLine(cmd: string, args: string[]): string;
export function shimExePath(text: string, shimDir: string): string | null;
export function countIssues(issues: { kind: string; detail?: string }[]): Record<string, number>;
export interface RateSummary {
  runs: number;
  finalRate: number | null;
  judged: number;
  judgeRate: number | null;
}
export function judgeSummary(
  runs: {
    task: string;
    tool?: string | undefined;
    finalOk: boolean;
    judgeOk?: boolean | null | undefined;
    agentError?: string | undefined;
    deniedCommands?: number | undefined;
    deniedTools?: Record<string, number> | undefined;
  }[],
  typeOfTask: Record<string, string>,
): Record<
  string,
  {
    overall: RateSummary;
    byType: Record<string, RateSummary>;
    agentErrors: number;
    denials: { runs: number; commands: number; tools: Record<string, number> };
  }
>;
export function withoutAgentErrors<T extends { agentError?: string | undefined }>(runs: T[]): T[];
export function countAgentErrors(runs: { agentError?: string | undefined }[]): number;
