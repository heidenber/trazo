// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import type { Issue } from "../validate/issues.js";
import { IdRegistry } from "../validate/refs.js";
import {
  edgeSchema,
  error_,
  idSchema,
  textSchema,
  themeSchema,
  warning,
  type ThemeName,
} from "./common.js";

export const STEP_KINDS = ["task", "start", "end", "decision", "wait", "subprocess"] as const;

export type StepKind = (typeof STEP_KINDS)[number];
export type WorkflowEdgeStyle = "sync" | "async";

export interface WorkflowStep {
  id: string;
  label: string;
  kind: StepKind;
  note?: string;
  /** Longer text for the viewer's detail card only; never drawn in the SVG. */
  detail?: string;
  source?: string;
}

export interface WorkflowLane {
  id: string;
  label: string;
  note?: string;
  steps: string[];
}

export interface WorkflowEdge {
  from: string;
  to: string;
  label?: string;
  style: WorkflowEdgeStyle;
}

export interface Workflow {
  type: "workflow";
  title: string;
  description?: string;
  theme: ThemeName;
  /** "auto" (lanes without a direction): the layout keeps the orientation that fits the screen best. */
  direction: "right" | "down" | "auto";
  lanes: WorkflowLane[];
  steps: WorkflowStep[];
  edges: WorkflowEdge[];
}

export const workflowSchema = z.strictObject({
  type: z.literal("workflow"),
  title: textSchema,
  description: textSchema.optional(),
  theme: themeSchema.optional(),
  direction: z.enum(["down", "right"]).optional(),
  lanes: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        note: textSchema.optional(),
        steps: z.array(idSchema).min(1),
      }),
    )
    .optional(),
  steps: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        kind: z.enum(STEP_KINDS).optional(),
        note: textSchema.optional(),
        detail: textSchema.optional(),
        source: textSchema.optional(),
      }),
    )
    .min(1),
  edges: z.array(edgeSchema("workflow", ["->", "~>"], ["sync", "async"])).optional(),
});

type Parsed = z.output<typeof workflowSchema>;

const LARGE_WORKFLOW = 40;
const MAX_LANES = 6;

export function buildWorkflow(input: Parsed): { diagram?: Workflow; issues: Issue[] } {
  const issues: Issue[] = [];
  const lanes = input.lanes ?? [];
  const ids = new IdRegistry(issues, { noun: "step", code: "ref/unknown-step" });
  const stepIds = new Set(input.steps.map((step) => step.id));
  const kindOf = new Map(input.steps.map((step) => [step.id, step.kind ?? "task"]));

  input.steps.forEach((step, i) => ids.claim(step.id, `steps[${i}].id`));
  lanes.forEach((lane, i) => ids.claim(lane.id, `lanes[${i}].id`));

  let badRefs = false;
  const unknownStep = (id: string, path: string) => {
    const unknown = ids.unknown(id, path, stepIds);
    badRefs ||= unknown;
    return unknown;
  };

  const laneOf = new Map<string, string>();
  lanes.forEach((lane, l) => {
    lane.steps.forEach((step, s) => {
      const path = `lanes[${l}].steps[${s}]`;
      if (unknownStep(step, path)) return;
      const existing = laneOf.get(step);
      if (existing !== undefined) {
        issues.push(
          error_(
            "lane/multiple-lanes",
            path,
            `"${step}" is already in lane "${existing}"`,
            "a step belongs to one lane",
          ),
        );
        return;
      }
      laneOf.set(step, lane.id);
    });
  });
  if (lanes.length > 0) {
    input.steps.forEach((step, i) => {
      if (!laneOf.has(step.id)) {
        issues.push(
          error_(
            "lane/missing",
            `steps[${i}]`,
            `"${step.id}" is not in any lane`,
            "add it to a lane's steps",
          ),
        );
      }
    });
  }

  // Edges keep their input index so later rules can point at the source line.
  const edges: WorkflowEdge[] = [];
  const edgeIndex: number[] = [];
  const seen = new Map<string, number>();
  (input.edges ?? []).forEach((edge, i) => {
    const badFrom = unknownStep(edge.from, `edges[${i}].from`);
    const badTo = unknownStep(edge.to, `edges[${i}].to`);
    if (badFrom || badTo) return;
    const out: WorkflowEdge = { from: edge.from, to: edge.to, style: edge.style ?? "sync" };
    if (edge.label !== undefined) out.label = edge.label;
    const key = JSON.stringify([out.from, out.to, out.label ?? null, out.style]);
    const first = seen.get(key);
    if (first !== undefined)
      issues.push(warning("edge/duplicate", `edges[${i}]`, `same as edges[${first}]`));
    else seen.set(key, i);
    edges.push(out);
    edgeIndex.push(i);
  });

  if (!badRefs) checkFlow(input, edges, edgeIndex, kindOf, issues);

  if (input.steps.length > LARGE_WORKFLOW) {
    issues.push(
      warning(
        "size/large",
        "steps",
        `${input.steps.length} steps`,
        `workflows read best under ${LARGE_WORKFLOW} steps; consider splitting into subprocesses`,
      ),
    );
  }

  if (lanes.length > MAX_LANES) {
    issues.push(
      warning(
        "workflow/many-lanes",
        "lanes",
        `${lanes.length} lanes`,
        `workflows read best with ${MAX_LANES} lanes or fewer; consider splitting the process`,
      ),
    );
  }

  const direction = input.direction ?? (lanes.length > 0 ? "auto" : "down");

  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const diagram: Workflow = {
    type: "workflow",
    title: input.title,
    theme: input.theme ?? "light",
    direction,
    lanes: lanes.map((lane) => {
      const out: WorkflowLane = { id: lane.id, label: lane.label ?? lane.id, steps: lane.steps };
      if (lane.note !== undefined) out.note = lane.note;
      return out;
    }),
    steps: input.steps.map((step) => {
      const kind = step.kind ?? "task";
      const fallback = kind === "start" ? "Start" : kind === "end" ? "End" : step.id;
      const out: WorkflowStep = { id: step.id, label: step.label ?? fallback, kind };
      if (step.note !== undefined) out.note = step.note;
      if (step.detail !== undefined) out.detail = step.detail;
      if (step.source !== undefined) out.source = step.source;
      return out;
    }),
    edges,
  };
  if (input.description !== undefined) diagram.description = input.description;
  return { diagram, issues };
}

function checkFlow(
  input: Parsed,
  edges: readonly WorkflowEdge[],
  edgeIndex: readonly number[],
  kindOf: ReadonlyMap<string, StepKind>,
  issues: Issue[],
): void {
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge, n) => {
    const i = edgeIndex[n]!;
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
    if (kindOf.get(edge.to) === "start") {
      issues.push(
        error_(
          "workflow/start-incoming",
          `edges[${i}]`,
          `"${edge.to}" is a start step and cannot have incoming edges`,
        ),
      );
    }
    if (kindOf.get(edge.from) === "end") {
      issues.push(
        error_(
          "workflow/end-outgoing",
          `edges[${i}]`,
          `"${edge.from}" is an end step and cannot have outgoing edges`,
        ),
      );
    }
    if (kindOf.get(edge.from) === "decision" && edge.label === undefined) {
      issues.push(
        warning(
          "workflow/decision-label",
          `edges[${i}]`,
          "decision branch has no label",
          'label it with the answer, e.g. "yes"',
        ),
      );
    }
  });

  input.steps.forEach((step, i) => {
    const count = outgoing.get(step.id)?.length ?? 0;
    const kind = kindOf.get(step.id);
    if (kind === "decision" && count < 2) {
      issues.push(
        error_(
          "workflow/decision-outputs",
          `steps[${i}]`,
          `decision needs at least 2 outgoing edges (has ${count})`,
        ),
      );
    }
    if (kind !== "end" && count === 0 && edges.length > 0) {
      issues.push(
        warning(
          "workflow/dead-end",
          `steps[${i}]`,
          `"${step.id}" has no outgoing edges`,
          'connect it or mark it as kind "end"',
        ),
      );
    }
  });

  const starts = input.steps
    .filter((step) => kindOf.get(step.id) === "start")
    .map((step) => step.id);
  if (starts.length === 0) return;
  const reached = new Set(starts);
  const queue = [...starts];
  for (let head = 0; head < queue.length; head++) {
    for (const next of outgoing.get(queue[head]!) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  input.steps.forEach((step, i) => {
    if (!reached.has(step.id)) {
      issues.push(
        warning(
          "workflow/unreachable",
          `steps[${i}]`,
          `"${step.id}" cannot be reached from a start step`,
        ),
      );
    }
  });
}
