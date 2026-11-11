// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { REFERENCE } from "../../src/cli/reference.js";
import { architectureSchema } from "../../src/model/architecture.js";
import { erdSchema } from "../../src/model/erd.js";
import { DIAGRAM_TYPES, validateDiagram, type Diagram } from "../../src/model/index.js";
import { sequenceSchema } from "../../src/model/sequence.js";
import { workflowSchema } from "../../src/model/workflow.js";

type DiagramType = (typeof DIAGRAM_TYPES)[number];

const SCHEMAS: Record<DiagramType, z.ZodType> = {
  architecture: architectureSchema,
  workflow: workflowSchema,
  erd: erdSchema,
  sequence: sequenceSchema,
};

// ---------------------------------------------------------------------------
// Walking the JSON Schema

interface Collected {
  names: Set<string>;
  enums: Set<string>[];
}

function collect(node: unknown, out: Collected): Collected {
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, out));
  } else if (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.enum)) out.enums.push(new Set(record.enum.map(String)));
    const properties = record.properties;
    if (typeof properties === "object" && properties !== null) {
      for (const name of Object.keys(properties)) out.names.add(name);
    }
    Object.values(record).forEach((child) => collect(child, out));
  }
  return out;
}

function fromSchema(type: DiagramType): Collected {
  const json = z.toJSONSchema(SCHEMAS[type], { io: "input", unrepresentable: "any" });
  return collect(json, { names: new Set(), enums: [] });
}

/** Every `a | b | c` run in the text, as a set. */
function groupsIn(text: string): Set<string>[] {
  const found = text.match(/[A-Za-z0-9_-]+(?: \| [A-Za-z0-9_-]+)+/g) ?? [];
  return found.map((run) => new Set(run.split(" | ")));
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((v) => b.has(v));
const word = (text: string, name: string) =>
  new RegExp(`(^|[^A-Za-z0-9_])${name}($|[^A-Za-z0-9_])`).test(text);

// ---------------------------------------------------------------------------
// Behavior helpers

function errorCodes(raw: unknown): string[] {
  return validateDiagram(raw)
    .issues.filter((i) => i.severity === "error")
    .map((i) => i.code);
}
function allCodes(raw: unknown): string[] {
  return validateDiagram(raw).issues.map((i) => i.code);
}
function build(raw: unknown): Diagram {
  const result = validateDiagram(raw);
  expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  return result.diagram!;
}

const arch = (edges: unknown[]) => ({
  type: "architecture",
  title: "T",
  nodes: [{ id: "a" }, { id: "b" }],
  edges,
});
const flow = (edges: unknown[]) => ({
  type: "workflow",
  title: "T",
  steps: [{ id: "a" }, { id: "b" }],
  edges,
});
const seq = (messages: unknown[]) => ({
  type: "sequence",
  title: "T",
  participants: [{ id: "a" }, { id: "b" }],
  messages,
});
const erd = (...columns: unknown[]) => ({
  type: "erd",
  title: "T",
  tables: [
    { id: "users", columns: ["id uuid pk"] },
    { id: "posts", columns: ["id uuid pk", ...columns] },
  ],
});
const erdColumn = (column: string) => {
  const diagram = build(erd(column)) as Extract<Diagram, { type: "erd" }>;
  return diagram.tables[1]!.columns[1]!;
};

// ---------------------------------------------------------------------------
// MANUAL: what Zod cannot see, checked by behavior. `set` is a `a | b | c`
// group the text may use; `check` proves each value works and a made-up one fails.

interface Manual {
  type: DiagramType;
  what: string;
  set?: string[];
  check: () => void;
}

const styleCheck =
  (make: (edges: unknown[]) => unknown, styles: string[], resolve: (d: Diagram) => string[]) =>
  () => {
    for (const style of styles) {
      expect(resolve(build(make([{ from: "a", to: "b", style }])))).toEqual([style]);
    }
    expect(errorCodes(make([{ from: "a", to: "b", style: "bogus" }]))).toContain("schema/enum");
  };
const edgeStyles = (d: Diagram) => (d as { edges: { style: string }[] }).edges.map((e) => e.style);

const MANUAL: Manual[] = [
  {
    type: "architecture",
    what: "edge style",
    set: ["sync", "async", "data"],
    check: styleCheck(arch, ["sync", "async", "data"], edgeStyles),
  },
  {
    type: "architecture",
    what: "edge shorthand arrows",
    check: () => {
      expect(edgeStyles(build(arch(["a -> b: x"])))).toEqual(["sync"]);
      expect(edgeStyles(build(arch(["a ~> b: x"])))).toEqual(["async"]);
      expect(errorCodes(arch(["a --> b"]))).toEqual(["edge/arrow"]);
    },
  },
  {
    type: "workflow",
    what: "edge style",
    set: ["sync", "async"],
    check: styleCheck(flow, ["sync", "async"], edgeStyles),
  },
  {
    type: "workflow",
    what: "edge shorthand arrows",
    check: () => {
      expect(edgeStyles(build(flow(["a -> b"])))).toEqual(["sync"]);
      expect(edgeStyles(build(flow(["a ~> b"])))).toEqual(["async"]);
      expect(errorCodes(flow(["a --> b"]))).toEqual(["edge/arrow"]);
    },
  },
  {
    type: "erd",
    what: "column marks",
    check: () => {
      expect(erdColumn("x int pk")).toMatchObject({ pk: true, unique: false, nullable: false });
      expect(erdColumn("x int unique")).toMatchObject({ unique: true });
      expect(erdColumn("x int null")).toMatchObject({ nullable: true });
      expect(erdColumn("x uuid fk users.id")).toMatchObject({
        fk: { table: "users", column: "id" },
      });
      expect(erdColumn("x numeric(10, 2)")).toMatchObject({ type: "numeric(10, 2)" });
      expect(erdColumn("x int PK")).toMatchObject({ pk: true });
      expect(errorCodes(erd("x int pk bogus"))).toEqual(["column/unknown-mark"]);
      expect(errorCodes(erd("x int pk pk"))).toEqual(["column/repeated-mark"]);
      expect(errorCodes(erd("x"))).toEqual(["column/no-type"]);
    },
  },
  {
    type: "erd",
    what: "object column form",
    check: () => {
      expect(erdColumn("x int")).toMatchObject({
        name: "x",
        pk: false,
        unique: false,
        nullable: false,
      });
      const object = {
        name: "x",
        type: "uuid",
        unique: true,
        nullable: true,
        fk: "users.id",
        note: "n",
      };
      const diagram = build(erd(object)) as Extract<Diagram, { type: "erd" }>;
      expect(diagram.tables[1]!.columns[1]).toMatchObject({
        unique: true,
        nullable: true,
        fk: { table: "users", column: "id" },
      });
    },
  },
  {
    type: "erd",
    what: "cardinality deduced from marks",
    check: () => {
      const ends = (column: string) => {
        const diagram = build(erd(column)) as Extract<Diagram, { type: "erd" }>;
        const { fromEnd, toEnd } = diagram.relations[0]!;
        return [fromEnd, toEnd];
      };
      expect(ends("x uuid fk users.id")).toEqual(["zero-or-many", "one"]);
      expect(ends("x uuid fk users.id unique")).toEqual(["zero-or-one", "one"]);
      expect(ends("x uuid fk users.id null")).toEqual(["zero-or-many", "zero-or-one"]);
    },
  },
  {
    type: "sequence",
    what: "message style",
    set: ["sync", "async", "reply"],
    check: () => {
      const styles = (d: Diagram) =>
        (d as { items: { style: string }[] }).items.map((i) => i.style);
      for (const style of ["sync", "async", "reply"]) {
        const messages =
          style === "reply"
            ? ["a -> b", { from: "b", to: "a", style }]
            : [{ from: "a", to: "b", style }];
        expect(styles(build(seq(messages))).at(-1)).toBe(style);
      }
      expect(errorCodes(seq([{ from: "a", to: "b", style: "bogus" }]))).toContain("schema/enum");
    },
  },
  {
    type: "sequence",
    what: "message shorthand arrows",
    check: () => {
      const styles = (d: Diagram) =>
        (d as { items: { style: string }[] }).items.map((i) => i.style);
      expect(styles(build(seq(["a -> b: x", "a ~> b: y", "b --> a: z"])))).toEqual([
        "sync",
        "async",
        "reply",
      ]);
      expect(errorCodes(seq(["a => b"]))).toEqual(["edge/syntax"]);
    },
  },
  {
    type: "sequence",
    what: "fragments",
    check: () => {
      const branch = { when: "w", messages: ["a -> b"] };
      expect(errorCodes(seq([{ opt: branch }]))).toEqual([]);
      expect(errorCodes(seq([{ loop: branch }]))).toEqual([]);
      expect(errorCodes(seq([{ alt: [branch, branch] }]))).toEqual([]);
      expect(errorCodes(seq([{ alt: [branch] }]))).toEqual(["sequence/alt-branches"]);
      expect(errorCodes(seq([{ opt: [branch] }]))).not.toEqual([]);
      expect(errorCodes(seq([{ foo: branch }]))).toEqual(["sequence/element"]);
    },
  },
  {
    type: "sequence",
    what: "note over 1 or 2 participants",
    check: () => {
      expect(
        errorCodes(
          seq([
            { note: "n", over: ["a"] },
            { note: "n", over: ["a", "b"] },
          ]),
        ),
      ).toEqual([]);
      expect(errorCodes(seq([{ note: "n", over: ["a", "b", "a"] }]))).toEqual([
        "sequence/note-over",
      ]);
    },
  },
  {
    type: "sequence",
    what: "nesting limit of 2",
    check: () => {
      const wrap = (child: unknown) => ({ opt: { when: "w", messages: [child] } });
      expect(errorCodes(seq([wrap(wrap("a -> b"))]))).toEqual([]);
      expect(errorCodes(seq([wrap(wrap(wrap("a -> b")))]))).toEqual(["sequence/nesting"]);
    },
  },
];

// Rules the texts state, each proven by the code it produces.
const RULES: {
  type: DiagramType;
  code: string;
  severity: "error" | "warning";
  doc: () => unknown;
}[] = [
  {
    type: "architecture",
    code: "group/multiple-parents",
    severity: "error",
    doc: () => ({
      type: "architecture",
      title: "T",
      nodes: [{ id: "a" }],
      groups: [
        { id: "g1", children: ["a"] },
        { id: "g2", children: ["a"] },
      ],
    }),
  },
  {
    type: "architecture",
    code: "group/cycle",
    severity: "error",
    doc: () => ({
      type: "architecture",
      title: "T",
      nodes: [{ id: "a" }],
      groups: [
        { id: "g1", children: ["g2"] },
        { id: "g2", children: ["g1"] },
      ],
    }),
  },
  {
    type: "architecture",
    code: "ref/unknown-node",
    severity: "error",
    doc: () => arch(["a -> zz"]),
  },
  {
    type: "architecture",
    code: "size/large",
    severity: "warning",
    doc: () => ({
      type: "architecture",
      title: "T",
      nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}` })),
    }),
  },
  {
    type: "workflow",
    code: "workflow/start-incoming",
    severity: "error",
    doc: () => ({ ...flow(["b -> a"]), steps: [{ id: "a", kind: "start" }, { id: "b" }] }),
  },
  {
    type: "workflow",
    code: "workflow/end-outgoing",
    severity: "error",
    doc: () => ({ ...flow(["a -> b"]), steps: [{ id: "a", kind: "end" }, { id: "b" }] }),
  },
  {
    type: "workflow",
    code: "workflow/decision-outputs",
    severity: "error",
    doc: () => ({ ...flow(["a -> b"]), steps: [{ id: "a", kind: "decision" }, { id: "b" }] }),
  },
  {
    type: "workflow",
    code: "workflow/decision-label",
    severity: "warning",
    doc: () => ({
      ...flow(["a -> b", "a -> a"]),
      steps: [{ id: "a", kind: "decision" }, { id: "b" }],
    }),
  },
  {
    type: "workflow",
    code: "lane/missing",
    severity: "error",
    doc: () => ({ ...flow([]), lanes: [{ id: "l", steps: ["a"] }] }),
  },
  {
    type: "workflow",
    code: "lane/multiple-lanes",
    severity: "error",
    doc: () => ({
      ...flow([]),
      lanes: [
        { id: "l1", steps: ["a", "b"] },
        { id: "l2", steps: ["a"] },
      ],
    }),
  },
  {
    type: "workflow",
    code: "workflow/lanes-direction",
    severity: "warning",
    doc: () => ({ ...flow([]), direction: "down", lanes: [{ id: "l", steps: ["a", "b"] }] }),
  },
  {
    type: "workflow",
    code: "size/large",
    severity: "warning",
    doc: () => ({
      type: "workflow",
      title: "T",
      steps: Array.from({ length: 41 }, (_, i) => ({ id: `s${i}` })),
    }),
  },
  {
    type: "erd",
    code: "ref/unknown-table",
    severity: "error",
    doc: () => erd("x uuid fk nope.id"),
  },
  {
    type: "erd",
    code: "ref/unknown-column",
    severity: "error",
    doc: () => erd("x uuid fk users.nope"),
  },
  { type: "erd", code: "column/duplicate", severity: "error", doc: () => erd("id int") },
  {
    type: "erd",
    code: "fk/type-mismatch",
    severity: "warning",
    doc: () => erd("x int fk users.id"),
  },
  {
    type: "erd",
    code: "fk/target-not-key",
    severity: "warning",
    doc: () => ({
      ...erd("x text fk users.name"),
      tables: [
        { id: "users", columns: ["id uuid pk", "name text"] },
        { id: "posts", columns: ["id uuid pk", "x text fk users.name"] },
      ],
    }),
  },
  {
    type: "erd",
    code: "table/no-pk",
    severity: "warning",
    doc: () => ({ type: "erd", title: "T", tables: [{ id: "t", columns: ["x int"] }] }),
  },
  {
    type: "sequence",
    code: "sequence/alt-branches",
    severity: "error",
    doc: () => seq([{ alt: [{ when: "w", messages: ["a -> b"] }] }]),
  },
  {
    type: "sequence",
    code: "sequence/nesting",
    severity: "error",
    doc: () => {
      const leaf = { opt: { when: "w", messages: ["a -> b"] } };
      return seq([{ opt: { when: "w", messages: [{ opt: { when: "w", messages: [leaf] } }] } }]);
    },
  },
  {
    type: "sequence",
    code: "sequence/note-over",
    severity: "error",
    doc: () => seq([{ note: "n", over: ["a", "b", "a"] }]),
  },
  { type: "sequence", code: "sequence/self-reply", severity: "error", doc: () => seq(["a --> a"]) },
  {
    type: "sequence",
    code: "sequence/orphan-reply",
    severity: "warning",
    doc: () => seq(["a --> b"]),
  },
  {
    type: "sequence",
    code: "ref/unknown-participant",
    severity: "error",
    doc: () => seq(["a -> zz"]),
  },
];

// Field words of sequence messages, notes and branches: Zod types them as unknown.
const SEQUENCE_WORDS = [
  "from",
  "to",
  "label",
  "style",
  "note",
  "over",
  "when",
  "messages",
  "alt",
  "opt",
  "loop",
];

// ---------------------------------------------------------------------------

describe("REFERENCE shape", () => {
  it("has exactly the diagram types", () => {
    expect(Object.keys(REFERENCE).sort()).toEqual([...DIAGRAM_TYPES].sort());
  });

  describe.each(DIAGRAM_TYPES)("%s", (type) => {
    const text = REFERENCE[type];

    it("fits the size cap", () => {
      expect(text.endsWith("\n")).toBe(true);
      expect(text.trimEnd().split("\n").length).toBeLessThanOrEqual(45);
      expect(Math.ceil(text.length / 4)).toBeLessThanOrEqual(700);
      expect(text).not.toMatch(/\r/);
    });

    it("starts with the type name and avoids emoji", () => {
      expect(text.startsWith(`${type}:`)).toBe(true);
      expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    });
  });
});

describe("REFERENCE follows the Zod schemas", () => {
  describe.each(DIAGRAM_TYPES)("%s", (type) => {
    const text = REFERENCE[type];
    const { names, enums } = fromSchema(type);

    it("names every schema property", () => {
      expect(names.size).toBeGreaterThan(0);
      for (const name of names) expect(word(text, name), `property "${name}"`).toBe(true);
    });

    it("names every schema enum value", () => {
      for (const set of enums)
        for (const value of set) expect(word(text, value), `enum value "${value}"`).toBe(true);
    });

    it("writes every a | b | c group as a known set", () => {
      const known = [
        ...enums,
        ...MANUAL.filter((m) => m.type === type && m.set).map((m) => new Set(m.set)),
      ];
      for (const group of groupsIn(text)) {
        expect(
          known.some((set) => sameSet(set, group)),
          `group ${[...group].join(" | ")}`,
        ).toBe(true);
      }
    });

    it("writes each enum of the schema as one group", () => {
      const groups = groupsIn(text);
      for (const set of enums) {
        if (set.size < 2) continue;
        expect(
          groups.some((group) => sameSet(group, set)),
          `enum ${[...set].join(" | ")}`,
        ).toBe(true);
      }
    });
  });

  it("names the sequence words Zod cannot see", () => {
    for (const field of SEQUENCE_WORDS) expect(word(REFERENCE.sequence, field), field).toBe(true);
  });
});

describe("REFERENCE MANUAL table", () => {
  for (const entry of MANUAL) {
    it(`${entry.type}: ${entry.what}`, () => {
      entry.check();
      if (entry.set) {
        const groups = groupsIn(REFERENCE[entry.type]);
        expect(
          groups.some((group) => sameSet(group, new Set(entry.set))),
          `group ${entry.set.join(" | ")}`,
        ).toBe(true);
      }
    });
  }

  it("documents each shorthand in the text", () => {
    expect(REFERENCE.architecture).toContain("a -> b: label");
    expect(REFERENCE.architecture).toContain("a ~> b: label");
    expect(REFERENCE.workflow).toContain("a -> b: label");
    expect(REFERENCE.workflow).toContain("a ~> b: label");
    expect(REFERENCE.erd).toContain('"name type [pk] [fk table.column] [unique] [null]"');
    expect(REFERENCE.sequence).toContain("a --> b: label");
  });
});

describe("REFERENCE rules", () => {
  for (const rule of RULES) {
    it(`${rule.type}: ${rule.code} is a ${rule.severity}`, () => {
      const issues = validateDiagram(rule.doc()).issues;
      expect(issues.filter((i) => i.severity === rule.severity).map((i) => i.code)).toContain(
        rule.code,
      );
    });
  }

  it("a valid minimal document has no issues of its own", () => {
    expect(allCodes(arch(["a -> b"]))).toEqual([]);
  });
});

describe("examples still match the reference", () => {
  it.each(DIAGRAM_TYPES)("examples/%s.json validates with no issues", (type) => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL(`../../examples/${type}.json`, import.meta.url), "utf8"),
    );
    expect(validateDiagram(raw).issues).toEqual([]);
  });
});
