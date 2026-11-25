// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import { error_, idSchema, textSchema, themeSchema, warning } from "./common.js";
import type { ThemeName } from "./common.js";
import type { Issue } from "../validate/issues.js";
import { IdRegistry } from "../validate/refs.js";

export const CLASS_STEREOTYPES = ["abstract", "interface", "enum"] as const;
export type ClassStereotype = (typeof CLASS_STEREOTYPES)[number];

export const RELATION_KINDS = [
  "association",
  "directed",
  "composition",
  "aggregation",
  "generalization",
  "realization",
  "dependency",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export type Visibility = "+" | "-" | "#" | "~";

/** One attribute, method or enum constant, read from its UML string. */
export interface ClassMember {
  visibility?: Visibility;
  name: string;
  /** Attribute type, or the method's return type. */
  type?: string;
  /** Method parameters as written, without the parentheses; absent for attributes. */
  params?: string;
}

export interface ClassNode {
  id: string;
  /** Absent for a plain class. */
  stereotype?: ClassStereotype;
  attributes: ClassMember[];
  methods: ClassMember[];
  note?: string;
  /** Longer text for the viewer's detail card only; never drawn in the SVG. */
  detail?: string;
  source?: string;
}

/**
 * `from` is the left class of the written relation: the child of a
 * generalization or realization, the whole of a composition or aggregation,
 * the source of a directed association or dependency.
 */
export interface ClassRelation {
  from: string;
  to: string;
  kind: RelationKind;
  fromMultiplicity?: string;
  toMultiplicity?: string;
  label?: string;
}

export interface ClassDiagram {
  type: "class";
  title: string;
  description?: string;
  theme: ThemeName;
  classes: ClassNode[];
  relations: ClassRelation[];
}

export const classSchema = z.strictObject({
  type: z.literal("class"),
  title: textSchema,
  description: textSchema.optional(),
  theme: themeSchema.optional(),
  classes: z
    .array(
      z.strictObject({
        id: idSchema,
        stereotype: z.enum(CLASS_STEREOTYPES).optional(),
        attributes: z.array(textSchema).optional(),
        methods: z.array(textSchema).optional(),
        note: textSchema.optional(),
        detail: textSchema.optional(),
        source: textSchema.optional(),
      }),
    )
    .min(1),
  relations: z.array(textSchema).optional(),
});

type Parsed = z.output<typeof classSchema>;

const NAME = "[A-Za-z_][A-Za-z0-9_]*";
const ATTRIBUTE = new RegExp(`^([-+#~])?\\s*(${NAME})\\s*(?::\\s*(\\S.*))?$`);
const METHOD = new RegExp(`^([-+#~])?\\s*(${NAME})\\s*\\(([^()]*)\\)\\s*(?::\\s*(\\S.*))?$`);
const CONSTANT = new RegExp(`^${NAME}$`);

function parseMember(text: string, method: boolean): ClassMember | undefined {
  const match = (method ? METHOD : ATTRIBUTE).exec(text.trim());
  if (!match) return undefined;
  const member: ClassMember = { name: match[2]! };
  if (match[1]) member.visibility = match[1] as Visibility;
  if (method) {
    member.params = match[3]!.trim();
    if (match[4]) member.type = match[4].trim();
  } else if (match[3]) member.type = match[3].trim();
  return member;
}

const OPERATORS: Record<string, RelationKind> = {
  "--": "association",
  "-->": "directed",
  "*--": "composition",
  "o--": "aggregation",
  "--|>": "generalization",
  "..|>": "realization",
  "..>": "dependency",
};
const NO_MULTIPLICITY = new Set<RelationKind>(["generalization", "realization", "dependency"]);
const MULTIPLICITY = /^(\d+|\*)(?:\.\.(\d+|\*))?$/;
const CLASS_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const MULTIPLICITY_HINT = "write 1, 0..1, *, 1..* or 0..*";
const RELATION_EXAMPLE = '"Order 1 *-- 1..* OrderLine : has"';
const OPERATOR_LIST = Object.keys(OPERATORS).join(" ");

interface ParsedRelation extends ClassRelation {
  /** Set when the string is readable but wrong; reported by the caller. */
  problem?: { message: string; hint: string };
}

function parseRelation(text: string): ParsedRelation | undefined {
  const colon = text.indexOf(":");
  const head = colon < 0 ? text : text.slice(0, colon);
  const label = colon < 0 ? "" : text.slice(colon + 1).trim();
  const tokens = head.trim().split(/\s+/);
  // from [multiplicity] operator [multiplicity] to: the operator is token 1 or 2.
  const op = tokens[1]! in OPERATORS ? 1 : tokens[2]! in OPERATORS ? 2 : 0;
  if (op === 0 || tokens.length < op + 2 || tokens.length > op + 3) return undefined;
  const left = op === 2 ? tokens[1] : undefined;
  const right = tokens.length === op + 3 ? tokens[op + 1] : undefined;
  const from = tokens[0]!;
  const to = tokens[tokens.length - 1]!;
  if (!CLASS_ID.test(from) || !CLASS_ID.test(to)) return undefined;
  const kind = OPERATORS[tokens[op]!]!;
  const relation: ParsedRelation = { from, to, kind };
  for (const [side, value] of [
    ["fromMultiplicity", left],
    ["toMultiplicity", right],
  ] as const) {
    if (value === undefined) continue;
    const match = MULTIPLICITY.exec(value);
    if (!match) return undefined;
    const [low, high] = [match[1]!, match[2]];
    if (high !== undefined && low === "*") {
      relation.problem ??= {
        message: `multiplicity "${value}" cannot start at *`,
        hint: MULTIPLICITY_HINT,
      };
    } else if (high !== undefined && high !== "*" && Number(low) > Number(high)) {
      relation.problem ??= {
        message: `multiplicity "${value}" has its lower bound above its upper bound`,
        hint: MULTIPLICITY_HINT,
      };
    }
    relation[side] = value;
  }
  if (NO_MULTIPLICITY.has(kind) && (left !== undefined || right !== undefined)) {
    relation.problem ??= {
      message: `a ${kind} takes no multiplicity`,
      hint: `remove the numbers, e.g. "${from} ${tokens[op]} ${to}"`,
    };
  }
  if (label) relation.label = label;
  return relation;
}

function buildMembers(c: Parsed["classes"][number], i: number, node: ClassNode, issues: Issue[]) {
  const isEnum = c.stereotype === "enum";
  (c.attributes ?? []).forEach((text, j) => {
    const path = `classes[${i}].attributes[${j}]`;
    if (isEnum) {
      if (CONSTANT.test(text.trim())) node.attributes.push({ name: text.trim() });
      else
        issues.push(
          error_(
            "class/member-syntax",
            path,
            `cannot read enum constant ${JSON.stringify(text)}`,
            'write one name per constant, e.g. "PLACED"',
          ),
        );
      return;
    }
    const member = parseMember(text, false);
    if (member) node.attributes.push(member);
    else
      issues.push(
        error_(
          "class/member-syntax",
          path,
          `cannot read attribute ${JSON.stringify(text)}`,
          'write "+ id: UUID": visibility (+ - # ~), name, optional ": Type"; methods go in "methods"',
        ),
      );
  });
  if (isEnum && (c.methods ?? []).length > 0) {
    issues.push(
      error_(
        "class/enum-methods",
        `classes[${i}].methods`,
        `enum "${c.id}" cannot have methods`,
        'list its constants in "attributes", e.g. ["PLACED", "PAID"]',
      ),
    );
  } else {
    (c.methods ?? []).forEach((text, j) => {
      const member = parseMember(text, true);
      if (member) node.methods.push(member);
      else
        issues.push(
          error_(
            "class/member-syntax",
            `classes[${i}].methods[${j}]`,
            `cannot read method ${JSON.stringify(text)}`,
            'write "- total(): Money": visibility (+ - # ~), name(parameters), optional ": ReturnType"',
          ),
        );
    });
  }
  for (const key of ["attributes", "methods"] as const) {
    const seen = new Set<string>();
    (c[key] ?? []).forEach((text, j) => {
      const norm = text.trim().replace(/\s+/g, " ");
      if (seen.has(norm))
        issues.push(
          warning(
            "class/duplicate-member",
            `classes[${i}].${key}[${j}]`,
            `${JSON.stringify(text)} is listed twice in "${c.id}"`,
          ),
        );
      seen.add(norm);
    });
  }
}

export function buildClass(input: Parsed): { diagram?: ClassDiagram; issues: Issue[] } {
  const issues: Issue[] = [];
  const ids = new IdRegistry(issues, { noun: "class", code: "ref/unknown-class" });
  const stereotypes = new Map(input.classes.map((c) => [c.id, c.stereotype]));
  const classIds = new Set(stereotypes.keys());

  const classes: ClassNode[] = input.classes.map((c, i) => {
    ids.claim(c.id, `classes[${i}].id`);
    const node: ClassNode = { id: c.id, attributes: [], methods: [] };
    if (c.stereotype !== undefined) node.stereotype = c.stereotype;
    buildMembers(c, i, node, issues);
    if (c.note !== undefined) node.note = c.note;
    if (c.detail !== undefined) node.detail = c.detail;
    if (c.source !== undefined) node.source = c.source;
    return node;
  });

  const relations: ClassRelation[] = [];
  const parents = new Map<string, string[]>();
  const seen = new Map<string, number>();
  const used = new Set<string>();
  let badRefs = false;
  (input.relations ?? []).forEach((text, i) => {
    const path = `relations[${i}]`;
    const parsed = parseRelation(text);
    if (!parsed) {
      issues.push(
        error_(
          "class/relation-syntax",
          path,
          `cannot read relation ${JSON.stringify(text)}`,
          `write ${RELATION_EXAMPLE}; operators: ${OPERATOR_LIST}; multiplicities and ": label" are optional`,
        ),
      );
      return;
    }
    const { problem, ...relation } = parsed;
    if (problem) issues.push(error_("class/multiplicity", path, problem.message, problem.hint));
    const badFrom = ids.unknown(relation.from, path, classIds);
    const badTo = ids.unknown(relation.to, path, classIds);
    badRefs ||= badFrom || badTo;
    if (badFrom || badTo || problem) return;
    used.add(relation.from).add(relation.to);
    if (relation.kind === "realization" && stereotypes.get(relation.to) !== "interface") {
      issues.push(
        error_(
          "class/realization-target",
          path,
          `realization target "${relation.to}" is not an interface`,
          `mark "${relation.to}" with "stereotype": "interface", or use --|> for inheritance`,
        ),
      );
    }
    if (relation.kind === "generalization") {
      const chain = pathBetween(parents, relation.to, relation.from);
      if (chain) {
        issues.push(
          error_(
            "class/generalization-cycle",
            path,
            `generalization cycle: ${[relation.from, ...chain].join(" --|> ")}`,
            "a class cannot inherit from itself, directly or through its parents",
          ),
        );
        return;
      }
      parents.set(relation.from, [...(parents.get(relation.from) ?? []), relation.to]);
    }
    const key = JSON.stringify(relation);
    const first = seen.get(key);
    if (first !== undefined)
      issues.push(warning("edge/duplicate", path, `same as relations[${first}]`));
    else seen.set(key, i);
    relations.push(relation);
  });

  if (relations.length > 0 && !badRefs) {
    input.classes.forEach((c, i) => {
      if (!used.has(c.id))
        issues.push(warning("class/unused", `classes[${i}]`, `"${c.id}" is in no relation`));
    });
  }

  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const diagram: ClassDiagram = {
    type: "class",
    title: input.title,
    theme: input.theme ?? "light",
    classes,
    relations,
  };
  if (input.description !== undefined) diagram.description = input.description;
  return { diagram, issues };
}

/** Nodes from `start` to `goal` along the parent links, both included. */
function pathBetween(
  parents: ReadonlyMap<string, string[]>,
  start: string,
  goal: string,
): string[] | undefined {
  if (start === goal) return [start];
  for (const next of parents.get(start) ?? []) {
    const rest = pathBetween(parents, next, goal);
    if (rest) return [start, ...rest];
  }
  return undefined;
}
