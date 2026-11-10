// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import { didYouMean, formatPath, type Issue } from "../validate/issues.js";

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

export const idSchema = z.string().regex(ID_PATTERN);
export const textSchema = z.string().min(1);
export const themeSchema = z.enum(["light", "dark"]);

/** Detail carried by custom issues so they survive the zod round trip. */
interface CustomParams {
  code: string;
  hint?: string;
}

export function customIssue(input: unknown, message: string, params: CustomParams) {
  return { code: "custom" as const, message, input, params };
}

// ---------------------------------------------------------------------------
// Edge shorthand: "from -> to: label"

export type Arrow = "->" | "~>" | "-->";

export interface ParsedEdge {
  from: string;
  to: string;
  arrow: Arrow;
  label?: string;
}

// Lazy ids so "api-gw->db" splits at the arrow and not at the first dash.
const EDGE_PATTERN = /^\s*(\S+?)\s*(-->|->|~>)\s*([^\s:]+)\s*(?::\s*(.*?))?\s*$/;

export function parseEdge(text: string): ParsedEdge | undefined {
  const match = EDGE_PATTERN.exec(text);
  if (!match) return undefined;
  const [, from, arrow, to, label] = match;
  if (!ID_PATTERN.test(from!) || !ID_PATTERN.test(to!)) return undefined;
  const edge: ParsedEdge = { from: from!, to: to!, arrow: arrow as Arrow };
  if (label) edge.label = label;
  return edge;
}

/**
 * Edge schema accepting the shorthand string or the object form. `arrows`
 * lists the shorthand arrows the diagram type supports; `styles` the values of
 * the object form's `style` field.
 */
export function edgeSchema<const S extends readonly [string, ...string[]]>(
  diagramType: string,
  arrows: readonly Arrow[],
  styles: S,
) {
  const edgeObject = z.strictObject({
    from: idSchema,
    to: idSchema,
    label: textSchema.optional(),
    style: z.enum(styles).optional(),
  });
  return z.preprocess((value, ctx) => {
    if (typeof value !== "string") return value;
    const parsed = parseEdge(value);
    if (!parsed) {
      ctx.issues.push(
        customIssue(value, `cannot read ${JSON.stringify(value)}`, {
          code: "edge/syntax",
          hint: `write "from -> to: label" (-> sync, ~> async${arrows.includes("-->") ? ", --> reply" : ""})`,
        }),
      );
      return value;
    }
    if (!arrows.includes(parsed.arrow)) {
      ctx.issues.push(
        customIssue(value, `arrow "${parsed.arrow}" is not available in ${diagramType} diagrams`, {
          code: "edge/arrow",
          hint: "use -> for sync or ~> for async",
        }),
      );
      return value;
    }
    const edge: Record<string, string> = {
      from: parsed.from,
      to: parsed.to,
      style: parsed.arrow === "~>" ? "async" : parsed.arrow === "-->" ? "reply" : "sync",
    };
    if (parsed.label !== undefined) edge.label = parsed.label;
    return edge;
  }, edgeObject);
}

// ---------------------------------------------------------------------------
// zod issues → trazo issues

type ZodIssue = z.core.$ZodIssue;

/** `base` prefixes every path, for schemas applied to a part of the document. */
export function fromZod(
  error: z.ZodError,
  schema: z.ZodType,
  base: readonly PropertyKey[] = [],
): Issue[] {
  const issues: Issue[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      const allowed = keysAt(schema, issue.path);
      for (const key of issue.keys) {
        const hint = didYouMean(key, allowed) ?? `allowed: ${allowed.join(", ")}`;
        issues.push(
          error_("schema/unknown-field", [...base, ...issue.path, key], "unknown field", hint),
        );
      }
      continue;
    }
    issues.push(convert(issue, base));
  }
  return issues;
}

function convert(issue: ZodIssue, base: readonly PropertyKey[]): Issue {
  const path = [...base, ...issue.path];
  const input = (issue as { input?: unknown }).input;
  switch (issue.code) {
    case "invalid_type":
      if (input === undefined) return error_("schema/required", path, "missing");
      return error_("schema/type", path, `expected ${issue.expected}, got ${describe(input)}`);
    case "invalid_value": {
      const values = issue.values.map(String);
      const hint = didYouMean(String(input), values) ?? `use one of: ${values.join(", ")}`;
      return error_("schema/enum", path, `unknown value ${JSON.stringify(input)}`, hint);
    }
    case "too_small":
      return error_("schema/empty", path, "must not be empty");
    case "invalid_format":
      return error_(
        "schema/id",
        path,
        `invalid id ${JSON.stringify(input)}`,
        "start with a letter or _, then letters, digits, _, . or -",
      );
    case "custom": {
      const params = issue.params as CustomParams | undefined;
      return error_(params?.code ?? "schema/invalid", path, issue.message, params?.hint);
    }
    default:
      return error_("schema/invalid", path, issue.message);
  }
}

export function error_(
  code: string,
  path: readonly PropertyKey[] | string,
  message: string,
  hint?: string,
): Issue {
  const issue: Issue = {
    severity: "error",
    code,
    path: typeof path === "string" ? path : formatPath(path),
    message,
  };
  if (hint !== undefined) issue.hint = hint;
  return issue;
}

export function warning(code: string, path: string, message: string, hint?: string): Issue {
  const issue: Issue = { severity: "warning", code, path, message };
  if (hint !== undefined) issue.hint = hint;
  return issue;
}

export function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Field names accepted by the object found at `path`, in declaration order.
 * Walks zod's internal definitions; only the wrappers we actually use are
 * handled.
 */
function keysAt(schema: z.ZodType, path: readonly PropertyKey[]): string[] {
  let node: unknown = schema;
  for (const key of path) {
    node = unwrap(node);
    const def = defOf(node);
    if (def?.type === "object" && typeof key === "string") node = def.shape?.[key];
    else if (def?.type === "array" && typeof key === "number") node = def.element;
    else return [];
  }
  const def = defOf(unwrap(node));
  return def?.type === "object" ? Object.keys(def.shape ?? {}) : [];
}

interface Def {
  type: string;
  shape?: Record<string, unknown>;
  element?: unknown;
  innerType?: unknown;
  out?: unknown;
}

function defOf(node: unknown): Def | undefined {
  return (node as { _zod?: { def?: Def } } | undefined)?._zod?.def;
}

function unwrap(node: unknown): unknown {
  for (;;) {
    const def = defOf(node);
    if (!def) return node;
    if (def.type === "optional" || def.type === "default" || def.type === "nullable")
      node = def.innerType;
    else if (def.type === "pipe") node = def.out;
    else return node;
  }
}
