// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import {
  error_,
  idSchema,
  parseEdge,
  customIssue,
  textSchema,
  themeSchema,
  warning,
} from "./common.js";
import type { ThemeName } from "./common.js";
import type { Issue } from "../validate/issues.js";
import { IdRegistry } from "../validate/refs.js";

export const STATE_KINDS = ["state", "initial", "final", "exception"] as const;
export type StateKind = (typeof STATE_KINDS)[number];

export interface StateNode {
  id: string;
  label: string;
  kind: StateKind;
  note?: string;
  /** Longer text for the viewer's detail card only; never drawn in the SVG. */
  detail?: string;
  source?: string;
}

export interface StateTransition {
  from: string;
  to: string;
  /** The event that fires the transition. */
  label?: string;
}

export interface State {
  type: "state";
  title: string;
  description?: string;
  theme: ThemeName;
  states: StateNode[];
  transitions: StateTransition[];
}

// "a -> b: event" or {from, to, label}; only the plain arrow means anything here.
const transitionSchema = z.preprocess(
  (value, ctx) => {
    if (typeof value !== "string") return value;
    const parsed = parseEdge(value);
    if (!parsed) {
      ctx.issues.push(
        customIssue(value, `cannot read ${JSON.stringify(value)}`, {
          code: "edge/syntax",
          hint: 'write "from -> to: event"',
        }),
      );
      return value;
    }
    if (parsed.arrow !== "->") {
      ctx.issues.push(
        customIssue(value, `arrow "${parsed.arrow}" is not available in state diagrams`, {
          code: "edge/arrow",
          hint: "use -> between two states",
        }),
      );
      return value;
    }
    return { from: parsed.from, to: parsed.to, ...(parsed.label ? { label: parsed.label } : {}) };
  },
  z.strictObject({ from: idSchema, to: idSchema, label: textSchema.optional() }),
);

export const stateSchema = z.strictObject({
  type: z.literal("state"),
  title: textSchema,
  description: textSchema.optional(),
  theme: themeSchema.optional(),
  states: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        kind: z.enum(STATE_KINDS).optional(),
        note: textSchema.optional(),
        detail: textSchema.optional(),
        source: textSchema.optional(),
      }),
    )
    .min(1),
  transitions: z.array(transitionSchema).optional(),
});

type Parsed = z.output<typeof stateSchema>;

const UNSUPPORTED_KINDS = new Set([
  "history",
  "shallow-history",
  "deep-history",
  "decision",
  "choice",
  "composite",
]);
const NESTING_FIELDS = ["children", "states", "regions", "parent"];

/**
 * Notation outside the basic scope, reported before the schema runs so the
 * author gets "not supported" instead of a generic unknown-field or enum error.
 */
export function checkUnsupported(raw: unknown): Issue[] {
  const issues: Issue[] = [];
  const states = (raw as { states?: unknown }).states;
  if (!Array.isArray(states)) return issues;
  states.forEach((state: unknown, i) => {
    if (typeof state !== "object" || state === null) return;
    const record = state as Record<string, unknown>;
    const kind = record.kind;
    if (typeof kind === "string" && UNSUPPORTED_KINDS.has(kind)) {
      issues.push(
        error_(
          "state/unsupported",
          `states[${i}].kind`,
          `"${kind}" states are not supported (basic notation only)`,
          "use kind initial, final, exception, or a plain state",
        ),
      );
    }
    for (const field of NESTING_FIELDS) {
      if (field in record) {
        issues.push(
          error_(
            "state/unsupported",
            `states[${i}].${field}`,
            "composite states and regions are not supported (basic notation only)",
            "flatten the states into one level",
          ),
        );
      }
    }
  });
  return issues;
}

export function buildState(input: Parsed): { diagram?: State; issues: Issue[] } {
  const issues: Issue[] = [];
  const ids = new IdRegistry(issues, { noun: "state", code: "ref/unknown-state" });
  const stateIds = new Set(input.states.map((state) => state.id));
  const kindOf = new Map(input.states.map((state) => [state.id, state.kind ?? "state"]));
  input.states.forEach((state, i) => ids.claim(state.id, `states[${i}].id`));

  const initials = input.states.filter((state) => state.kind === "initial");
  if (initials.length !== 1) {
    issues.push(
      error_(
        "state/initial-count",
        "states",
        `expected exactly 1 initial state, found ${initials.length}`,
        'mark one state kind "initial"',
      ),
    );
  }

  const transitions: StateTransition[] = [];
  const index: number[] = [];
  const seen = new Map<string, number>();
  let badRefs = false;
  (input.transitions ?? []).forEach((transition, i) => {
    const badFrom = ids.unknown(transition.from, `transitions[${i}].from`, stateIds);
    const badTo = ids.unknown(transition.to, `transitions[${i}].to`, stateIds);
    badRefs ||= badFrom || badTo;
    if (badFrom || badTo) return;
    const out: StateTransition = { from: transition.from, to: transition.to };
    if (transition.label !== undefined) out.label = transition.label;
    const key = JSON.stringify([out.from, out.to, out.label ?? null]);
    const first = seen.get(key);
    if (first !== undefined)
      issues.push(warning("edge/duplicate", `transitions[${i}]`, `same as transitions[${first}]`));
    else seen.set(key, i);
    transitions.push(out);
    index.push(i);
  });

  if (!badRefs) checkFlow(input, transitions, index, kindOf, initials.length === 1, issues);

  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const diagram: State = {
    type: "state",
    title: input.title,
    theme: input.theme ?? "light",
    states: input.states.map((state) => {
      const kind = state.kind ?? "state";
      const fallback =
        kind === "initial" ? "Initial state" : kind === "final" ? "Final state" : state.id;
      const out: StateNode = { id: state.id, label: state.label ?? fallback, kind };
      if (state.note !== undefined) out.note = state.note;
      if (state.detail !== undefined) out.detail = state.detail;
      if (state.source !== undefined) out.source = state.source;
      return out;
    }),
    transitions,
  };
  if (input.description !== undefined) diagram.description = input.description;
  return { diagram, issues };
}

function checkFlow(
  input: Parsed,
  transitions: readonly StateTransition[],
  index: readonly number[],
  kindOf: ReadonlyMap<string, StateKind>,
  oneInitial: boolean,
  issues: Issue[],
): void {
  const outgoing = new Map<string, string[]>();
  transitions.forEach((transition, n) => {
    const i = index[n]!;
    const list = outgoing.get(transition.from) ?? [];
    list.push(transition.to);
    outgoing.set(transition.from, list);
    if (kindOf.get(transition.to) === "initial") {
      issues.push(
        error_(
          "state/initial-incoming",
          `transitions[${i}]`,
          `"${transition.to}" is the initial state and cannot have incoming transitions`,
        ),
      );
    }
    if (kindOf.get(transition.from) === "final") {
      issues.push(
        error_(
          "state/final-outgoing",
          `transitions[${i}]`,
          `"${transition.from}" is a final state and cannot have outgoing transitions`,
        ),
      );
    }
    if (transition.label === undefined && kindOf.get(transition.from) !== "initial") {
      issues.push(
        warning(
          "state/no-event",
          `transitions[${i}]`,
          "transition has no event label",
          'name the event that fires it, e.g. "submit"',
        ),
      );
    }
  });

  input.states.forEach((state, i) => {
    const count = outgoing.get(state.id)?.length ?? 0;
    const kind = kindOf.get(state.id);
    if (kind === "initial" && count !== 1) {
      issues.push(
        error_(
          "state/initial-outgoing",
          `states[${i}]`,
          `the initial state "${state.id}" needs exactly 1 outgoing transition (has ${count})`,
        ),
      );
    }
    if (kind !== "final" && kind !== "initial" && count === 0) {
      issues.push(
        warning(
          "state/dead-end",
          `states[${i}]`,
          `"${state.id}" has no outgoing transitions`,
          'connect it or mark it as kind "final"',
        ),
      );
    }
  });

  if (!oneInitial) return;
  const start = input.states.find((state) => state.kind === "initial")!.id;
  const reached = new Set([start]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    for (const next of outgoing.get(queue[head]!) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  input.states.forEach((state, i) => {
    if (!reached.has(state.id)) {
      issues.push(
        warning(
          "state/unreachable",
          `states[${i}]`,
          `"${state.id}" cannot be reached from the initial state`,
        ),
      );
    }
  });
}
