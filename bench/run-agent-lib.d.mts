// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

export interface Task {
  id: string;
  type: string;
  level: number;
  prompt: string;
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
  sandboxRoot: string;
}
export interface RunPlan {
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
  lastMakeInput: string | null;
}
export const PROMPT_SUFFIX: string;
export function parseArgs(argv: string[], knownTasks: string[], today: string): RunOptions;
export function buildPrompt(taskPrompt: string): string;
export function buildAgentArgs(prompt: string, model: string, agent?: AgentName): string[];
export function planRuns(taskIds: string[], conditions: string[], runs: number): RunPlan[];
export function runName(plan: RunPlan): string;
export function modelDir(model: string): string;
export function parseStream(text: string): StreamStats;
export function parseOpencodeStream(text: string): StreamStats;
export function skillSegments(agent: AgentName): string[];
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
