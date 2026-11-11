// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import { didYouMean, type Issue } from "../validate/issues.js";
import { IdRegistry } from "../validate/refs.js";
import { customIssue, error_, idSchema, textSchema, themeSchema, warning } from "./common.js";

export type End = "one" | "zero-or-one" | "many" | "zero-or-many";

export interface ErdColumn {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  nullable: boolean;
  fk?: { table: string; column: string };
  note?: string;
}

export interface ErdTable {
  id: string;
  label: string;
  note?: string;
  source?:string;
  columns: ErdColumn[];
}

export interface ErdRelation {
  /** "<table>.<column>" of the fk column; unique because column names are. */
  id: string;
  from: string;
  fromColumn: string;
  to: string;
  toColumn: string;
  fromEnd: End;
  toEnd: End;
}

export interface Erd {
  type: "erd";
  title: string;
  description?: string;
  theme: "light" | "dark";
  tables: ErdTable[];
  relations: ErdRelation[];
}

// ---------------------------------------------------------------------------
// Short column syntax: "name type [pk] [fk table.column] [unique] [null]"

const MARKS = ["pk", "fk", "unique", "null"] as const;
type Mark = (typeof MARKS)[number];

export interface ParsedColumn {
  name: string;
  type: string;
  pk: boolean;
  unique: boolean;
  nullable: boolean;
  fk?: { table: string; column: string };
}

export interface ColumnError {
  code: string;
  message: string;
  hint?: string;
}

export type ColumnResult = { column: ParsedColumn } | { error: ColumnError };

const SHAPE_HINT = 'write "name type [pk] [fk table.column] [unique] [null]"';

/** Splits "table.column" at the last dot, since table ids may contain dots ("public.users"). */
export function splitRef(ref: string): { table: string; column: string } | undefined {
  const dot = ref.lastIndexOf(".");
  if (dot <= 0 || dot === ref.length - 1) return undefined;
  return { table: ref.slice(0, dot), column: ref.slice(dot + 1) };
}

function isMark(word: string): word is Mark {
  return (MARKS as readonly string[]).includes(word);
}

// "uniq" is two edits from "unique", more than didYouMean allows, so a
// prefix of a mark also counts as a typo for it.
function markHint(word: string): string {
  const lower = word.toLowerCase();
  const prefix = lower.length >= 3 ? MARKS.find((mark) => mark.startsWith(lower)) : undefined;
  if (prefix !== undefined) return `did you mean "${prefix}"?`;
  return didYouMean(word, MARKS) ?? `use one of: ${MARKS.join(", ")}`;
}

function nearMark(word: string): boolean {
  return !markHint(word).startsWith("use one of");
}

export function parseColumn(text: string): ColumnResult {
  const fail = (code: string, message: string, hint?: string): { error: ColumnError } => {
    const error: ColumnError = { code, message };
    if (hint !== undefined) error.hint = hint;
    return { error };
  };
  const quoted = JSON.stringify(text);
  const words = text.trim().split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return fail("column/syntax", `cannot read ${quoted}`, SHAPE_HINT);

  const name = words[0]!;
  let i = 1;
  const typeWords: string[] = [];
  while (i < words.length && !isMark(words[i]!.toLowerCase())) typeWords.push(words[i++]!);

  // A typo'd mark right after the type ("text uniq") would otherwise be
  // swallowed as part of the type. The first type word is never checked.
  for (const word of typeWords.slice(1)) {
    if (nearMark(word)) return fail("column/unknown-mark", `unknown mark "${word}" in ${quoted}`, markHint(word));
  }
  if (typeWords.length === 0) {
    return fail("column/no-type", `column ${quoted} has no type`, 'write the type after the name, e.g. "id uuid pk"');
  }

  const column: ParsedColumn = { name, type: typeWords.join(" "), pk: false, unique: false, nullable: false };
  const seen = new Set<Mark>();
  while (i < words.length) {
    const word = words[i++]!;
    const mark = word.toLowerCase();
    if (!isMark(mark)) return fail("column/unknown-mark", `unknown mark "${word}" in ${quoted}`, markHint(word));
    if (seen.has(mark)) return fail("column/repeated-mark", `mark "${mark}" is repeated in ${quoted}`, `use "${mark}" once`);
    seen.add(mark);
    if (mark === "pk") column.pk = true;
    else if (mark === "unique") column.unique = true;
    else if (mark === "null") column.nullable = true;
    else {
      const target = words[i];
      if (target === undefined || isMark(target.toLowerCase())) {
        return fail("column/fk-target", `fk needs a target in ${quoted}`, 'write "fk table.column"');
      }
      i++;
      const ref = splitRef(target);
      if (ref === undefined) {
        return fail("column/fk-target", `"${target}" is not a table.column reference in ${quoted}`, 'write "fk table.column"');
      }
      column.fk = ref;
    }
  }
  return { column };
}

// ---------------------------------------------------------------------------
// Cardinality, deduced from the marks of the fk column

export function endsOf(column: Pick<ErdColumn, "unique" | "nullable">): { from: End; to: End } {
  return {
    from: column.unique ? "zero-or-one" : "zero-or-many",
    to: column.nullable ? "zero-or-one" : "one",
  };
}

// ---------------------------------------------------------------------------
// Schema

const fkSchema = z.string().refine((value) => splitRef(value) !== undefined, {
  message: "not a table.column reference",
  params: { code: "column/fk-target", hint: 'write "table.column"' },
});

const columnObject = z.strictObject({
  name: textSchema,
  type: textSchema,
  pk: z.boolean().optional(),
  unique: z.boolean().optional(),
  nullable: z.boolean().optional(),
  fk: fkSchema.optional(),
  note: textSchema.optional(),
});

// Short strings become the object form here, so both forms share one path
// through the rules below.
const columnSchema = z.preprocess((value, ctx) => {
  if (typeof value !== "string") return value;
  const result = parseColumn(value);
  if ("error" in result) {
    const { code, message, hint } = result.error;
    ctx.issues.push(customIssue(value, message, hint === undefined ? { code } : { code, hint }));
    return value;
  }
  const { column } = result;
  const out: Record<string, unknown> = {
    name: column.name,
    type: column.type,
    pk: column.pk,
    unique: column.unique,
    nullable: column.nullable,
  };
  if (column.fk) out.fk = `${column.fk.table}.${column.fk.column}`;
  return out;
}, columnObject);

export const erdSchema = z.strictObject({
  type: z.literal("erd"),
  title: textSchema,
  description: textSchema.optional(),
  theme: themeSchema.optional(),
  tables: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        note: textSchema.optional(),
        source: textSchema.optional(),
        columns: z.array(columnSchema).min(1),
      }),
    )
    .min(1),
});

type Parsed = z.output<typeof erdSchema>;

const MAX_TABLES = 40;
const MAX_COLUMNS = 30;

// Spellings that mean the same type in real schemas; anything else compares as written.
const TYPE_ALIASES: Record<string, string> = {
  integer: "int",
  int4: "int",
  serial: "int",
  int8: "bigint",
  bigserial: "bigint",
  int2: "smallint",
  smallserial: "smallint",
};

function normalizeType(type: string): string {
  const flat = type.toLowerCase().split(/\s+/).join(" ");
  return TYPE_ALIASES[flat] ?? flat;
}

export function buildErd(input: Parsed): { diagram?: Erd; issues: Issue[] } {
  const issues: Issue[] = [];
  const ids = new IdRegistry(issues, { noun: "table", code: "ref/unknown-table" });
  input.tables.forEach((table, t) => ids.claim(table.id, `tables[${t}].id`));

  const tables = new Map<string, Parsed["tables"][number]>();
  for (const table of input.tables) if (!tables.has(table.id)) tables.set(table.id, table);

  input.tables.forEach((table, t) => {
    const first = new Map<string, number>();
    table.columns.forEach((column, c) => {
      const previous = first.get(column.name);
      if (previous === undefined) first.set(column.name, c);
      else {
        issues.push(
          error_(
            "column/duplicate",
            `tables[${t}].columns[${c}]`,
            `duplicate column "${column.name}"`,
            `first used at tables[${t}].columns[${previous}]`,
          ),
        );
      }
    });
  });

  const relations: ErdRelation[] = [];
  input.tables.forEach((table, t) => {
    table.columns.forEach((column, c) => {
      if (column.fk === undefined) return;
      const path = `tables[${t}].columns[${c}]`;
      const ref = splitRef(column.fk)!;
      if (ids.unknown(ref.table, path, new Set(tables.keys()))) return;
      const target = tables.get(ref.table)!;
      const targetColumn = target.columns.find((other) => other.name === ref.column);
      if (targetColumn === undefined) {
        const hint = didYouMean(column.fk, target.columns.map((other) => `${ref.table}.${other.name}`));
        issues.push(error_("ref/unknown-column", path, `unknown column "${column.fk}"`, hint));
        return;
      }
      if (ref.table === table.id && ref.column === column.name) {
        issues.push(error_("column/self-reference", path, `"${column.fk}" cannot reference itself`, "point it at another column"));
        return;
      }
      const here = `${table.id}.${column.name}`;
      if (!targetColumn.pk && !targetColumn.unique) {
        issues.push(
          warning(
            "fk/target-not-key",
            path,
            `"${here}" references "${column.fk}", which is not a primary key or unique`,
            'mark the target "pk" or "unique"',
          ),
        );
      }
      if (normalizeType(column.type) !== normalizeType(targetColumn.type)) {
        issues.push(
          warning(
            "fk/type-mismatch",
            path,
            `"${here}" is ${column.type} but "${column.fk}" is ${targetColumn.type}`,
            "use the same type on both sides",
          ),
        );
      }
      const ends = endsOf({ unique: column.unique ?? false, nullable: column.nullable ?? false });
      relations.push({
        id: here,
        from: table.id,
        fromColumn: column.name,
        to: ref.table,
        toColumn: ref.column,
        fromEnd: ends.from,
        toEnd: ends.to,
      });
    });

    if (!table.columns.some((column) => column.pk)) {
      issues.push(warning("table/no-pk", `tables[${t}]`, `"${table.id}" has no primary key`, 'mark a column "pk"'));
    }
    if (table.columns.length > MAX_COLUMNS) {
      issues.push(
        warning(
          "size/large",
          `tables[${t}].columns`,
          `${table.columns.length} columns`,
          `tables read best under ${MAX_COLUMNS} columns; consider splitting it`,
        ),
      );
    }
  });

  if (input.tables.length > MAX_TABLES) {
    issues.push(
      warning(
        "size/large",
        "tables",
        `${input.tables.length} tables`,
        `diagrams read best under ${MAX_TABLES} tables; consider splitting into several`,
      ),
    );
  }

  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const diagram: Erd = {
    type: "erd",
    title: input.title,
    theme: input.theme ?? "light",
    tables: input.tables.map((table) => {
      const out: ErdTable = {
        id: table.id,
        label: table.label ?? table.id,
        columns: table.columns.map((column) => {
          const col: ErdColumn = {
            name: column.name,
            type: column.type,
            pk: column.pk ?? false,
            unique: column.unique ?? false,
            nullable: column.nullable ?? false,
          };
          if (column.fk !== undefined) col.fk = splitRef(column.fk)!;
          if (column.note !== undefined) col.note = column.note;
          return col;
        }),
      };
      if (table.note !== undefined) out.note = table.note;
      if (table.source !== undefined) out.source = table.source;
      return out;
    }),
    relations,
  };
  if (input.description !== undefined) diagram.description = input.description;
  return { diagram, issues };
}

