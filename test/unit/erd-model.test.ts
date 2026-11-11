// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import type { Erd } from "../../src/model/erd.js";
import { validateDiagram } from "../../src/model/index.js";
import type { Issue } from "../../src/validate/issues.js";

const shop = {
  type: "erd",
  title: "Shop",
  tables: [
    { id: "users", columns: ["id uuid pk", "email text unique", "name text"] },
    { id: "orders", columns: ["id uuid pk", "user_id uuid fk users.id", "created_at timestamp with time zone"] },
    { id: "payments", columns: ["id uuid pk", "order_id uuid fk orders.id unique", "amount numeric(10, 2)"] },
    { id: "categories", columns: ["id int pk", "parent_id int fk categories.id null", "name text"] },
  ],
};

function tables(...list: unknown[]) {
  return { type: "erd", title: "T", tables: list };
}
function errors(raw: unknown): Issue[] {
  return validateDiagram(raw).issues.filter((i) => i.severity === "error");
}
function warnings(raw: unknown): Issue[] {
  return validateDiagram(raw).issues.filter((i) => i.severity === "warning");
}
function only(raw: unknown): Issue {
  const found = errors(raw);
  expect(found).toHaveLength(1);
  return found[0]!;
}
function onlyWarning(raw: unknown): Issue {
  const found = warnings(raw);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("erd model", () => {
  it("keeps an optional table source and leaves it out when absent", () => {
    const raw = (table: object) => ({ type: "erd", title: "T", tables: [{ id: "u", columns: ["id int pk"], ...table }] });
    const withSource = validateDiagram(raw({ source: "prisma/schema.prisma:12" }));
    expect(withSource.issues).toEqual([]);
    expect((withSource.diagram as Erd).tables[0]!.source).toBe("prisma/schema.prisma:12");
    const without = (validateDiagram(raw({})).diagram as Erd).tables[0]!;
    expect("source" in without).toBe(false);
  });

  it("rejects an empty table source", () => {
    const { issues } = validateDiagram({ type: "erd", title: "T", tables: [{ id: "u", source: "", columns: ["id int pk"] }] });
    expect(issues.some((i) => i.severity === "error" && i.path === "tables[0].source")).toBe(true);
  });

  it("accepts the shop example without issues", () => {
    const result = validateDiagram(shop);
    expect(result.issues).toEqual([]);
    const erd = result.diagram as Erd;
    expect(erd.type).toBe("erd");
    expect(erd.theme).toBe("light");
    expect(erd.tables.map((t) => t.label)).toEqual(["users", "orders", "payments", "categories"]);
    expect(erd.tables[1]!.columns[1]).toEqual({
      name: "user_id",
      type: "uuid",
      pk: false,
      unique: false,
      nullable: false,
      fk: { table: "users", column: "id" },
    });
    expect(erd.tables[1]!.columns[2]!.type).toBe("timestamp with time zone");
  });

  it("derives one relation per fk, with ends from the marks", () => {
    const erd = validateDiagram(shop).diagram as Erd;
    expect(erd.relations).toEqual([
      { id: "orders.user_id", from: "orders", fromColumn: "user_id", to: "users", toColumn: "id", fromEnd: "zero-or-many", toEnd: "one" },
      { id: "payments.order_id", from: "payments", fromColumn: "order_id", to: "orders", toColumn: "id", fromEnd: "zero-or-one", toEnd: "one" },
      { id: "categories.parent_id", from: "categories", fromColumn: "parent_id", to: "categories", toColumn: "id", fromEnd: "zero-or-many", toEnd: "zero-or-one" },
    ]);
  });

  it.each([
    ["fk a.id", "zero-or-many", "one"],
    ["fk a.id null", "zero-or-many", "zero-or-one"],
    ["fk a.id unique", "zero-or-one", "one"],
    ["fk a.id unique null", "zero-or-one", "zero-or-one"],
  ])("cardinality of %s", (marks, fromEnd, toEnd) => {
    const raw = tables({ id: "a", columns: ["id int pk"] }, { id: "b", columns: ["id int pk", `a_id int ${marks}`] });
    const result = validateDiagram(raw);
    expect(result.issues).toEqual([]);
    const relation = (result.diagram as Erd).relations[0]!;
    expect([relation.fromEnd, relation.toEnd]).toEqual([fromEnd, toEnd]);
  });

  it("gives the short and object forms the same result", () => {
    const short = tables(
      { id: "users", columns: ["id uuid pk"] },
      { id: "orders", columns: ["id uuid pk", "user_id uuid fk users.id unique null"] },
    );
    const object = tables(
      { id: "users", columns: [{ name: "id", type: "uuid", pk: true }] },
      {
        id: "orders",
        columns: [
          { name: "id", type: "uuid", pk: true },
          { name: "user_id", type: "uuid", fk: "users.id", unique: true, nullable: true },
        ],
      },
    );
    const a = validateDiagram(short);
    const b = validateDiagram(object);
    expect(a.issues).toEqual([]);
    expect(b.issues).toEqual([]);
    expect(b.diagram).toEqual(a.diagram);
  });

  it("keeps note, label, theme and description", () => {
    const raw = {
      type: "erd",
      title: "T",
      description: "d",
      theme: "dark",
      tables: [{ id: "u", label: "Users", note: "people", columns: [{ name: "id", type: "int", pk: true, note: "key" }] }],
    };
    const erd = validateDiagram(raw).diagram as Erd;
    expect(erd.description).toBe("d");
    expect(erd.theme).toBe("dark");
    expect(erd.tables[0]).toMatchObject({ label: "Users", note: "people" });
    expect(erd.tables[0]!.columns[0]!.note).toBe("key");
  });

  it("allows a self-referencing table", () => {
    expect(validateDiagram(shop).issues).toEqual([]);
  });

  it("rejects a column that references itself", () => {
    expect(only(tables({ id: "t", columns: ["id int pk fk t.id"] }))).toEqual({
      severity: "error",
      code: "column/self-reference",
      path: "tables[0].columns[0]",
      message: '"t.id" cannot reference itself',
      hint: "point it at another column",
    });
  });

  it("rejects an fk to an unknown table, with a suggestion", () => {
    const raw = tables({ id: "users", columns: ["id int pk"] }, { id: "o", columns: ["id int pk", "u int fk usrs.id"] });
    expect(only(raw)).toEqual({
      severity: "error",
      code: "ref/unknown-table",
      path: "tables[1].columns[1]",
      message: 'unknown table "usrs"',
      hint: 'did you mean "users"?',
    });
  });

  it("rejects an fk to an unknown column, with a suggestion", () => {
    const raw = tables({ id: "users", columns: ["id int pk"] }, { id: "o", columns: ["id int pk", "u int fk users.idd"] });
    expect(only(raw)).toEqual({
      severity: "error",
      code: "ref/unknown-column",
      path: "tables[1].columns[1]",
      message: 'unknown column "users.idd"',
      hint: 'did you mean "users.id"?',
    });
  });

  it("rejects duplicate table ids", () => {
    expect(only(tables({ id: "a", columns: ["id int pk"] }, { id: "a", columns: ["id int pk"] }))).toEqual({
      severity: "error",
      code: "ref/duplicate-id",
      path: "tables[1].id",
      message: 'duplicate id "a"',
      hint: "first used at tables[0].id",
    });
  });

  it("rejects duplicate column names inside a table", () => {
    expect(only(tables({ id: "a", columns: ["id int pk", "x text", "x int"] }))).toEqual({
      severity: "error",
      code: "column/duplicate",
      path: "tables[0].columns[2]",
      message: 'duplicate column "x"',
      hint: "first used at tables[0].columns[1]",
    });
  });

  it("allows the same column name in different tables", () => {
    expect(errors(tables({ id: "a", columns: ["id int pk"] }, { id: "b", columns: ["id int pk"] }))).toEqual([]);
  });

  it("rejects a table without columns", () => {
    expect(only(tables({ id: "a", columns: [] }))).toEqual({
      severity: "error",
      code: "schema/empty",
      path: "tables[0].columns",
      message: "must not be empty",
    });
  });

  it("reports grammar errors at the column path", () => {
    expect(only(tables({ id: "a", columns: ["id int pk", "email text pk uniq"] }))).toEqual({
      severity: "error",
      code: "column/unknown-mark",
      path: "tables[0].columns[1]",
      message: 'unknown mark "uniq" in "email text pk uniq"',
      hint: 'did you mean "unique"?',
    });
    expect(only(tables({ id: "a", columns: ["id"] })).code).toBe("column/no-type");
    expect(only(tables({ id: "a", columns: ["id int pk pk"] })).code).toBe("column/repeated-mark");
    expect(only(tables({ id: "a", columns: ["id int fk"] })).code).toBe("column/fk-target");
  });

  it("rejects a malformed fk in the object form", () => {
    expect(only(tables({ id: "a", columns: [{ name: "x", type: "int", fk: "users" }] }))).toEqual({
      severity: "error",
      code: "column/fk-target",
      path: "tables[0].columns[0].fk",
      message: "not a table.column reference",
      hint: 'write "table.column"',
    });
  });

  it("rejects unknown fields in the object form", () => {
    expect(only(tables({ id: "a", columns: [{ name: "x", type: "int", nullabel: true }] }))).toMatchObject({
      code: "schema/unknown-field",
      path: "tables[0].columns[0].nullabel",
      hint: 'did you mean "nullable"?',
    });
  });

  it("warns when an fk targets a column that is neither pk nor unique", () => {
    const raw = tables({ id: "u", columns: ["id int pk", "name text"] }, { id: "o", columns: ["id int pk", "n text fk u.name"] });
    expect(onlyWarning(raw)).toEqual({
      severity: "warning",
      code: "fk/target-not-key",
      path: "tables[1].columns[1]",
      message: '"o.n" references "u.name", which is not a primary key or unique',
      hint: 'mark the target "pk" or "unique"',
    });
  });

  it("does not warn when the fk targets a unique column", () => {
    const raw = tables({ id: "u", columns: ["id int pk", "code text unique"] }, { id: "o", columns: ["id int pk", "c text fk u.code"] });
    expect(warnings(raw)).toEqual([]);
  });

  it("warns when the fk type differs from the referenced type", () => {
    const raw = tables({ id: "u", columns: ["id int pk"] }, { id: "o", columns: ["id int pk", "u uuid fk u.id"] });
    expect(onlyWarning(raw)).toEqual({
      severity: "warning",
      code: "fk/type-mismatch",
      path: "tables[1].columns[1]",
      message: '"o.u" is uuid but "u.id" is int',
      hint: "use the same type on both sides",
    });
  });

  it.each([
    ["integer", "int"],
    ["int4", "INT"],
    ["serial", "integer"],
    ["int8", "bigserial"],
    ["int2", "smallserial"],
    ["Timestamp  With Time Zone", "timestamp with time zone"],
  ])("treats %s and %s as the same type", (parent, child) => {
    const raw = tables({ id: "u", columns: [`id ${parent} pk`] }, { id: "o", columns: ["id int pk", `u ${child} fk u.id`] });
    expect(warnings(raw).filter((w) => w.code === "fk/type-mismatch")).toEqual([]);
  });

  it("still warns for int against bigint", () => {
    const raw = tables({ id: "u", columns: ["id bigint pk"] }, { id: "o", columns: ["id int pk", "u int fk u.id"] });
    expect(onlyWarning(raw).code).toBe("fk/type-mismatch");
  });

  it("warns about a table without a primary key", () => {
    expect(onlyWarning(tables({ id: "logs", columns: ["line text"] }))).toEqual({
      severity: "warning",
      code: "table/no-pk",
      path: "tables[0]",
      message: '"logs" has no primary key',
      hint: 'mark a column "pk"',
    });
  });

  it("warns about more than 40 tables", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ id: `t${i}`, columns: ["id int pk"] }));
    expect(onlyWarning(tables(...many))).toEqual({
      severity: "warning",
      code: "size/large",
      path: "tables",
      message: "41 tables",
      hint: "diagrams read best under 40 tables; consider splitting into several",
    });
  });

  it("warns about more than 30 columns in a table", () => {
    const columns = ["id int pk", ...Array.from({ length: 30 }, (_, i) => `c${i} text`)];
    expect(onlyWarning(tables({ id: "wide", columns }))).toEqual({
      severity: "warning",
      code: "size/large",
      path: "tables[0].columns",
      message: "31 columns",
      hint: "tables read best under 30 columns; consider splitting it",
    });
  });

  it("returns no diagram when there are errors", () => {
    expect(validateDiagram(tables({ id: "a", columns: ["id"] })).diagram).toBeUndefined();
  });
});
