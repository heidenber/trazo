// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { checkGeometry } from "./check/geometry.js";
import { layoutDiagram } from "./layout/index.js";
import { validateDiagram, type Diagram } from "./model/index.js";
import { parseJson } from "./parse.js";
import { renderHtml } from "./render/html.js";
import { hasErrors, type Issue } from "./validate/issues.js";

export type { Issue } from "./validate/issues.js";
export { VERSION } from "./version.js";

export interface CheckResult {
  ok: boolean;
  issues: Issue[];
}

export interface MakeOptions {
  theme?: "light" | "dark";
}

export interface MakeResult extends CheckResult {
  html?: string;
}

interface Validated {
  diagram?: Diagram;
  issues: Issue[];
}

/** A string is JSON text; any other value is treated as already parsed. */
function validate(input: unknown): Validated {
  if (typeof input !== "string") return validateDiagram(input);
  const parsed = parseJson(input);
  return parsed.ok ? validateDiagram(parsed.value) : { issues: parsed.issues };
}

export function check(input: string | unknown): CheckResult {
  const { issues } = validate(input);
  return { ok: !hasErrors(issues), issues };
}

export async function make(
  input: string | unknown,
  options: MakeOptions = {},
): Promise<MakeResult> {
  const { diagram, issues } = validate(input);
  if (hasErrors(issues) || diagram === undefined) return { ok: false, issues };
  const scene = await layoutDiagram(diagram);
  const html = renderHtml(options.theme === undefined ? scene : { ...scene, theme: options.theme });
  return { ok: true, html, issues: [...issues, ...checkGeometry(scene)] };
}
