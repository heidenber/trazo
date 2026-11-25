// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDiagram } from "../../src/model/index.js";

const example: Record<string, any> = JSON.parse(
  readFileSync(new URL("../../examples/class.json", import.meta.url), "utf8"),
);

const lines = (raw: unknown) =>
  validateDiagram(raw).issues.map((i) => `${i.severity} ${i.code} ${i.path}: ${i.message}`);

/** Classes A, B and the interface I, plus any extra classes. */
const small = (relations: unknown[], classes: unknown[] = []) => ({
  type: "class",
  title: "T",
  classes: [{ id: "A" }, { id: "B" }, { id: "I", stereotype: "interface" }, ...classes],
  relations,
});

describe("class: accepted", () => {
  it("accepts the online store example with no issues and normalizes it", () => {
    const { diagram, issues } = validateDiagram(example);
    expect(issues).toEqual([]);
    expect(diagram).toMatchObject({ type: "class", theme: "light", title: "Online store" });
    const d = diagram as any;
    expect(d.classes).toHaveLength(9);
    expect(d.classes[0]).toMatchObject({ id: "Person", stereotype: "abstract" });
    expect(d.classes[0].attributes[0]).toEqual({ visibility: "+", name: "name", type: "String" });
    expect(d.classes[2].methods[0]).toEqual({
      visibility: "+",
      name: "total",
      params: "",
      type: "Money",
    });
    expect(d.classes[5].methods[0]).toEqual({
      visibility: "+",
      name: "pay",
      params: "amount: Money",
      type: "Receipt",
    });
    expect(d.classes[8].attributes[0]).toEqual({ name: "PLACED" });
    expect(d.classes[1].stereotype).toBeUndefined();
    expect(d.relations).toHaveLength(8);
    expect(d.relations[0]).toEqual({ from: "Customer", to: "Person", kind: "generalization" });
    expect(d.relations[3]).toEqual({
      from: "Customer",
      to: "Order",
      kind: "association",
      fromMultiplicity: "1",
      toMultiplicity: "0..*",
      label: "places",
    });
    expect(d.relations[5]).toMatchObject({ kind: "directed", fromMultiplicity: "*" });
    expect(d.relations.map((r: any) => r.kind)).toEqual([
      "generalization",
      "realization",
      "realization",
      "association",
      "composition",
      "directed",
      "aggregation",
      "dependency",
    ]);
  });

  it("reads members without visibility or type, and multiplicity on one side", () => {
    const raw = small(
      ["A 1 -- B", "A -- 0..1 B"],
      [
        {
          id: "C",
          attributes: ["count", "- x: List<int>"],
          methods: ["run()", "# go(a, b): void"],
        },
      ],
    );
    const { diagram, issues } = validateDiagram(raw);
    expect(issues.map((i) => i.code)).toEqual(["class/unused", "class/unused"]);
    const c = (diagram as any).classes[3];
    expect(c.attributes).toEqual([
      { name: "count" },
      { visibility: "-", name: "x", type: "List<int>" },
    ]);
    expect(c.methods).toEqual([
      { name: "run", params: "" },
      { visibility: "#", name: "go", params: "a, b", type: "void" },
    ]);
    expect((diagram as any).relations[1]).toEqual({
      from: "A",
      to: "B",
      kind: "association",
      toMultiplicity: "0..1",
    });
  });

  it.each([
    ["--", "association"],
    ["-->", "directed"],
    ["*--", "composition"],
    ["o--", "aggregation"],
    ["--|>", "generalization"],
    ["..|>", "realization"],
    ["..>", "dependency"],
  ])("reads the operator %s as %s", (op, kind) => {
    const target = kind === "realization" ? "I" : "B";
    const { diagram } = validateDiagram(small([`A ${op} ${target}`, "B -- I"]));
    expect((diagram as any).relations[0].kind).toBe(kind);
  });

  it.each(["1", "0..1", "*", "1..*", "0..*", "2..5"])("accepts the multiplicity %s", (m) => {
    expect(lines(small([`A ${m} -- ${m} B`, "A -- I"]))).toEqual([]);
  });

  it("allows a self association", () => {
    expect(lines(small(["A 0..1 -- * A : manages", "A -- B", "B -- I"]))).toEqual([]);
  });
});

describe("class: errors", () => {
  it("reports an unknown class with a hint and the relation path", () => {
    const raw = small(["A -- Bb", "A -- I", "B -- I"]);
    expect(lines(raw)).toEqual(['error ref/unknown-class relations[0]: unknown class "Bb"']);
    expect(validateDiagram(raw).issues[0]!.hint).toBe('did you mean "B"?');
  });

  it("reports a duplicate id", () => {
    expect(lines(small(["A -- B", "A -- I"], [{ id: "A" }]))).toEqual([
      'error ref/duplicate-id classes[3].id: duplicate id "A"',
    ]);
  });

  it.each(["A <> B", "A B", "A -- ", "A 1 2 -- B", "A -- 1x B", "A ==> B", "-- B", "A -- B -- I"])(
    "rejects the malformed relation %j with an example",
    (text) => {
      const { issues } = validateDiagram(small([text]));
      expect(issues[0]).toMatchObject({
        severity: "error",
        code: "class/relation-syntax",
        path: "relations[0]",
        message: `cannot read relation ${JSON.stringify(text)}`,
        hint: 'write "Order 1 *-- 1..* OrderLine : has"; operators: -- --> *-- o-- --|> ..|> ..>; multiplicities and ": label" are optional',
      });
    },
  );

  it("rejects a malformed attribute and a malformed method", () => {
    const raw = small(
      ["A -- B", "A -- I", "A -- C"],
      [{ id: "C", attributes: ["id UUID", "+ run()"], methods: ["total", "+ f(: x"] }],
    );
    const { issues } = validateDiagram(raw);
    expect(issues.map((i) => `${i.code} ${i.path}`)).toEqual([
      "class/member-syntax classes[3].attributes[0]",
      "class/member-syntax classes[3].attributes[1]",
      "class/member-syntax classes[3].methods[0]",
      "class/member-syntax classes[3].methods[1]",
    ]);
    expect(issues[0]).toMatchObject({
      message: 'cannot read attribute "id UUID"',
      hint: 'write "+ id: UUID": visibility (+ - # ~), name, optional ": Type"; methods go in "methods"',
    });
    expect(issues[2]).toMatchObject({
      message: 'cannot read method "total"',
      hint: 'write "- total(): Money": visibility (+ - # ~), name(parameters), optional ": ReturnType"',
    });
  });

  it("rejects an enum constant that is not a plain name", () => {
    const raw = small(
      ["A -- B"],
      [{ id: "E", stereotype: "enum", attributes: ["OK", "+ x: int"] }],
    );
    const { issues } = validateDiagram(raw);
    expect(issues.find((i) => i.code === "class/member-syntax")).toMatchObject({
      path: "classes[3].attributes[1]",
      message: 'cannot read enum constant "+ x: int"',
      hint: 'write one name per constant, e.g. "PLACED"',
    });
  });

  it("rejects methods on an enum", () => {
    const raw = small(["A -- B"], [{ id: "E", stereotype: "enum", methods: ["+ f(): int"] }]);
    const { issues } = validateDiagram(raw);
    expect(issues.find((i) => i.code === "class/enum-methods")).toMatchObject({
      severity: "error",
      path: "classes[3].methods",
      message: 'enum "E" cannot have methods',
      hint: 'list its constants in "attributes", e.g. ["PLACED", "PAID"]',
    });
  });

  it("requires a realization to target an interface", () => {
    const issue = validateDiagram(small(["A ..|> B", "A -- I", "B -- I"])).issues[0]!;
    expect(issue).toMatchObject({
      severity: "error",
      code: "class/realization-target",
      path: "relations[0]",
      message: 'realization target "B" is not an interface',
      hint: 'mark "B" with "stereotype": "interface", or use --|> for inheritance',
    });
  });

  it("rejects a generalization cycle, direct or through parents", () => {
    expect(lines(small(["A --|> A", "B -- I"]))).toContain(
      "error class/generalization-cycle relations[0]: generalization cycle: A --|> A",
    );
    const raw = small(["A --|> B", "B --|> I", "I --|> A"]);
    const issue = validateDiagram(raw).issues.find((i) => i.code === "class/generalization-cycle")!;
    expect(issue).toMatchObject({
      path: "relations[2]",
      message: "generalization cycle: I --|> A --|> B --|> I",
      hint: "a class cannot inherit from itself, directly or through its parents",
    });
  });

  it("rejects multiplicity out of order, starting at *, or on an inheritance line", () => {
    const first = (text: string) => validateDiagram(small([text, "A -- B", "B -- I"])).issues[0]!;
    expect(first("A 3..1 -- I")).toMatchObject({
      code: "class/multiplicity",
      message: 'multiplicity "3..1" has its lower bound above its upper bound',
      hint: "write 1, 0..1, *, 1..* or 0..*",
    });
    expect(first("A *..3 -- I").message).toBe('multiplicity "*..3" cannot start at *');
    expect(first("A 1 --|> B")).toMatchObject({
      code: "class/multiplicity",
      message: "a generalization takes no multiplicity",
      hint: 'remove the numbers, e.g. "A --|> B"',
    });
  });

  it("requires a class and rejects unknown fields and stereotypes", () => {
    expect(lines({ type: "class", title: "T", classes: [] })[0]).toMatch(/^error schema\//);
    expect(lines(small([], [{ id: "X", stereotype: "record" }]))[0]).toMatch(
      /^error schema\/enum classes\[3\]\.stereotype/,
    );
    expect(validateDiagram({ ...small(["A -- B"]), packages: {} }).issues[0]).toMatchObject({
      code: "schema/unknown-field",
      path: "packages",
    });
  });
});

describe("class: warnings", () => {
  it("warns about a class in no relation, only when there are relations", () => {
    expect(lines(small(["A -- B"]))).toEqual([
      'warning class/unused classes[2]: "I" is in no relation',
    ]);
    expect(lines(small([]))).toEqual([]);
  });

  it("warns about a duplicate relation and a repeated member", () => {
    const raw = small(
      ["A -- B", "A -- B", "B -- I", "A -- I"],
      [{ id: "C", attributes: ["+ id: int", "+ id:  int"] }],
    );
    expect(lines(raw)).toEqual([
      'warning class/duplicate-member classes[3].attributes[1]: "+ id:  int" is listed twice in "C"',
      "warning edge/duplicate relations[1]: same as relations[0]",
      'warning class/unused classes[3]: "C" is in no relation',
    ]);
  });
});
