// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Fetches the pinned Archify release into the bench sandbox root, outside this repository, and prints
// the folder that holds its skill. Nothing from the clone is read or copied into the repo; the runner
// copies that folder into each sandbox. Needs git and network access.
//   node bench/stage-archify.mjs [--sandbox-root <dir>]
// Default root: <os tmp>/trazo-bench. The clone goes to <root>/_archify-v3.2.0 and is skipped if present.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIFY_REPO, ARCHIFY_VERSION, archifyCloneDir } from "./run-agent-lib.mjs";

const SKIP = new Set([".git", "node_modules"]);

/** Folder with a SKILL.md and a bin/archify.mjs inside the clone: the usual spots first, then a shallow walk. */
export function locateSkillDir(clone) {
  if (!existsSync(clone)) throw new Error(`${clone} not found`);
  const found = [];
  const walk = (dir, depth) => {
    if (existsSync(join(dir, "SKILL.md")) && existsSync(join(dir, "bin", "archify.mjs")))
      found.push(dir);
    if (depth === 0) return;
    for (const e of readdirSync(dir, { withFileTypes: true }))
      if (e.isDirectory() && !SKIP.has(e.name)) walk(join(dir, e.name), depth - 1);
  };
  walk(clone, 4);
  if (found.length === 0)
    throw new Error(`no skill folder (SKILL.md and bin/archify.mjs) in ${clone}`);
  if (found.length > 1) throw new Error(`several skill folders in ${clone}: ${found.join(", ")}`);
  return found[0];
}

function main() {
  const args = process.argv.slice(2);
  let home = join(tmpdir(), "trazo-bench");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--sandbox-root" && args[i + 1]) home = resolve(args[++i]);
    else {
      process.stderr.write(`error: unknown or incomplete option: ${args[i]}\n`);
      process.exit(2);
    }
  }
  const clone = archifyCloneDir(home);
  if (existsSync(clone)) console.log(`already staged: ${clone}`);
  else {
    const r = spawnSync(
      "git",
      ["clone", "--depth", "1", "--branch", ARCHIFY_VERSION, ARCHIFY_REPO, clone],
      { stdio: "inherit" },
    );
    if (r.status !== 0) {
      process.stderr.write("error: git clone failed\n");
      process.exit(1);
    }
  }
  try {
    console.log(locateSkillDir(clone));
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
