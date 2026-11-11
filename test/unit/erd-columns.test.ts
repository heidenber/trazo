// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { endsOf, parseColumn, splitRef } from "../../src/model/erd.js";

function column(text: string) {
  const result = parseColumn(text);
  if (!("column" in result)) throw new Error(`expected a column, got ${JSON.stringify(result)}`);
  return result.column;
}
function error(text: string) {
  const result = parseColumn(text);
  if (!("error" in result)) throw new Error("expected an error");
  return result.error;
}

describe("parseColumn", () => {
  it("reads name and type with no marks", () => {
    expect(column("name text")).toEqual({
      name: "name",
      type: "text",
      pk: false,
      unique: false,
      nullable: false,
    });
  });

  it("keeps types with spaces and parentheses whole", () => {
    expect(column("created_at timestamp with time zone").type).toBe("timestamp with time zone");
    expect(column("amount numeric(10, 2) null").type).toBe("numeric(10, 2)");
  });

  it("reads every mark", () => {
    expect(column("order_id uuid fk orders.id unique null")).toEqual({
      name: "order_id",
      type: "uuid",
      pk: false,
      unique: true,
      nullable: true,
      fk: { table: "orders", column: "id" },
    });
    expect(column("id uuid pk").pk).toBe(true);
  });

  it("accepts marks in any order and any case", () => {
    expect(column("a int NULL Unique FK t.id")).toEqual(column("a int fk t.id unique null"));
  });

  it("splits the fk target at the last dot", () => {
    expect(column("u int fk public.users.id").fk).toEqual({ table: "public.users", column: "id" });
    expect(splitRef("users")).toBeUndefined();
    expect(splitRef(".id")).toBeUndefined();
    expect(splitRef("users.")).toBeUndefined();
  });

  it("rejects a blank column", () => {
    expect(error("   ")).toEqual({
      code: "column/syntax",
      message: 'cannot read "   "',
      hint: 'write "name type [pk] [fk table.column] [unique] [null]"',
    });
  });

  it("rejects a column without a type", () => {
    const expected = {
      code: "column/no-type",
      message: 'column "id" has no type',
      hint: 'write the type after the name, e.g. "id uuid pk"',
    };
    expect(error("id")).toEqual(expected);
    expect(error("id pk")).toEqual({ ...expected, message: 'column "id pk" has no type' });
  });

  it("rejects an unknown mark after a mark, suggesting the closest", () => {
    expect(error("email text pk uniq")).toEqual({
      code: "column/unknown-mark",
      message: 'unknown mark "uniq" in "email text pk uniq"',
      hint: 'did you mean "unique"?',
    });
    expect(error("email text pk bogus").hint).toBe("use one of: pk, fk, unique, null");
  });

  it("catches a typo'd mark that sits right after the type", () => {
    expect(error("email text uniq")).toEqual({
      code: "column/unknown-mark",
      message: 'unknown mark "uniq" in "email text uniq"',
      hint: 'did you mean "unique"?',
    });
    expect(error("id uuid pkk").hint).toBe('did you mean "pk"?');
  });

  it("rejects a repeated mark", () => {
    expect(error("id uuid pk PK")).toEqual({
      code: "column/repeated-mark",
      message: 'mark "pk" is repeated in "id uuid pk PK"',
      hint: 'use "pk" once',
    });
  });

  it("rejects an fk without a usable target", () => {
    const hint = 'write "fk table.column"';
    expect(error("a int fk")).toEqual({
      code: "column/fk-target",
      message: 'fk needs a target in "a int fk"',
      hint,
    });
    expect(error("a int fk unique")).toEqual({
      code: "column/fk-target",
      message: 'fk needs a target in "a int fk unique"',
      hint,
    });
    expect(error("a int fk users")).toEqual({
      code: "column/fk-target",
      message: '"users" is not a table.column reference in "a int fk users"',
      hint,
    });
  });
});

describe("endsOf", () => {
  it.each([
    [false, false, "zero-or-many", "one"],
    [false, true, "zero-or-many", "zero-or-one"],
    [true, false, "zero-or-one", "one"],
    [true, true, "zero-or-one", "zero-or-one"],
  ] as const)("unique=%s null=%s", (unique, nullable, from, to) => {
    expect(endsOf({ unique, nullable })).toEqual({ from, to });
  });
});
