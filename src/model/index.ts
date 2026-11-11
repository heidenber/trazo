// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { didYouMean, type Issue } from "../validate/issues.js";
import { architectureSchema, buildArchitecture, type Architecture } from "./architecture.js";
import { describe, error_, fromZod } from "./common.js";
import { buildErd, erdSchema, type Erd } from "./erd.js";
import { buildSequence, sequenceSchema, type Sequence } from "./sequence.js";
import { buildWorkflow, workflowSchema, type Workflow } from "./workflow.js";

export type Diagram = Architecture | Workflow | Erd | Sequence;

export const DIAGRAM_TYPES = ["architecture", "workflow", "erd", "sequence"] as const;

export interface ValidationResult {
  diagram?: Diagram;
  issues: Issue[];
}

export function validateDiagram(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { issues: [error_("schema/type", "$", `expected an object, got ${describe(raw)}`)] };
  }
  const type = (raw as { type?: unknown }).type;
  const types: readonly string[] = DIAGRAM_TYPES;
  if (type === undefined) {
    return {
      issues: [error_("schema/required", "type", "missing", `use one of: ${types.join(", ")}`)],
    };
  }
  if (typeof type !== "string" || !types.includes(type)) {
    const hint =
      (typeof type === "string" && didYouMean(type, types)) || `use one of: ${types.join(", ")}`;
    return {
      issues: [error_("schema/enum", "type", `unknown value ${JSON.stringify(type)}`, hint)],
    };
  }

  if (type === "sequence") {
    const parsed = sequenceSchema.safeParse(raw, { reportInput: true });
    if (!parsed.success)
      return { issues: withStartHint(fromZod(parsed.error, sequenceSchema), type) };
    return buildSequence(parsed.data);
  }
  if (type === "erd") {
    const parsed = erdSchema.safeParse(raw, { reportInput: true });
    if (!parsed.success) return { issues: withStartHint(fromZod(parsed.error, erdSchema), type) };
    return buildErd(parsed.data);
  }
  if (type === "workflow") {
    const parsed = workflowSchema.safeParse(raw, { reportInput: true });
    if (!parsed.success)
      return { issues: withStartHint(fromZod(parsed.error, workflowSchema), type) };
    return buildWorkflow(parsed.data);
  }
  const parsed = architectureSchema.safeParse(raw, { reportInput: true });
  if (!parsed.success)
    return { issues: withStartHint(fromZod(parsed.error, architectureSchema), type) };
  return buildArchitecture(parsed.data);
}

/** A missing top-level field points at the example; nested paths keep their own hints. */
function withStartHint(issues: Issue[], type: string): Issue[] {
  return issues.map((issue) =>
    issue.code === "schema/required" && issue.hint === undefined && !/[.[]/.test(issue.path)
      ? { ...issue, hint: `run "trazo example ${type}" for a starting point` }
      : issue,
  );
}
