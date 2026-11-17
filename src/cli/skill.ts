// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { suggest } from "../validate/issues.js";
import { writeAtomic, writeError } from "./io.js";
import { UsageError } from "./usage.js";

/** Documented user-level skill locations, relative to the home directory. */
const LOCATIONS = {
  claude: [".claude", "skills", "trazo"],
  pi: [".pi", "agent", "skills", "trazo"],
  codex: [".agents", "skills", "trazo"],
} as const;

const AGENTS = Object.keys(LOCATIONS);
const ACTIONS = ["install"];

/** `trazo skill install --agent <agent>`: copy SKILL.md, overwriting an older copy. */
export function skill(args: string[], agent: string | undefined): string {
  const [action, ...extra] = args;
  if (action === undefined) throw new UsageError(`missing <action> (use ${ACTIONS.join(", ")})`);
  if (!ACTIONS.includes(action)) {
    const guess = suggest(action, ACTIONS);
    throw new UsageError(
      `unknown skill action "${action}"${guess ? ` (did you mean "${guess}"?)` : ""}`,
    );
  }
  if (extra.length > 0) throw new UsageError(`unexpected argument "${extra[0]}"`);
  if (agent === undefined)
    throw new UsageError(`missing --agent (use one of: ${AGENTS.join(", ")})`);
  if (!AGENTS.includes(agent)) {
    const guess = suggest(agent, AGENTS);
    throw new UsageError(
      `unknown agent "${agent}" ${guess ? `(did you mean "${guess}"?)` : `(use one of: ${AGENTS.join(", ")})`}`,
    );
  }

  const target = join(homedir(), ...LOCATIONS[agent as keyof typeof LOCATIONS], "SKILL.md");
  const source = fileURLToPath(new URL("../../skill/SKILL.md", import.meta.url));
  let content: string;
  try {
    content = readFileSync(source, "utf8");
  } catch (err) {
    // A broken install, not a usage mistake: stays an internal error, but says what to do.
    const code = (err as { code?: unknown }).code;
    throw new Error(
      `cannot read the bundled skill "${source}"${typeof code === "string" ? ` (${code})` : ""}; reinstall @heidenber/trazo`,
    );
  }
  const existed = existsSync(target);
  try {
    writeAtomic(target, content);
  } catch (err) {
    throw writeError(err, target);
  }
  return `${existed ? "updated" : "installed"} ${target}\n`;
}
