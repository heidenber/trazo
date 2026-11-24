// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDiagram } from "../../src/model/index.js";

const example: Record<string, any> = JSON.parse(
  readFileSync(new URL("../../examples/chen.json", import.meta.url), "utf8"),
);

/** The example with `edit` applied to a fresh copy. */
function doc(edit: (d: Record<string, any>) => void): unknown {
  const copy = structuredClone(example);
  edit(copy);
  return copy;
}

const lines = (raw: unknown) =>
  validateDiagram(raw).issues.map((i) => `${i.severity} ${i.code} ${i.path}: ${i.message}`);
const hints = (raw: unknown) => validateDiagram(raw).issues.map((i) => i.hint);

const small = (entities: unknown[], relationships: unknown[] = []) => ({
  type: "chen",
  title: "T",
  entities,
  relationships,
});
const strong = (id: string, ...attributes: unknown[]) => ({
  id,
  attributes: attributes.length > 0 ? attributes : [{ name: "k", kind: "key" }],
});
const two = (a: string, b: string) => [
  { entity: a, cardinality: "1" },
  { entity: b, cardinality: "N" },
];

describe("chen: accepted", () => {
  it("accepts the University example with no issues and normalizes it", () => {
    const { diagram, issues } = validateDiagram(example);
    expect(issues).toEqual([]);
    expect(diagram).toMatchObject({ type: "chen", title: "University", theme: "light" });
    const chen = diagram as any;
    expect(chen.entities[0].attributes).toEqual([
      { name: "student_id", kind: "key", children: [] },
      {
        name: "name",
        kind: "simple",
        children: [
          { name: "first", kind: "simple", children: [] },
          { name: "last", kind: "simple", children: [] },
        ],
      },
      { name: "emails", kind: "multivalued", children: [] },
      { name: "birth_date", kind: "simple", children: [] },
      { name: "age", kind: "derived", children: [] },
    ]);
    expect(chen.entities[2]).toMatchObject({ id: "section", label: "Section", weak: true });
    expect(chen.entities[0]).toMatchObject({ weak: false });
    expect(chen.relationships[1]).toMatchObject({ id: "has", identifying: true });
    expect(chen.relationships[1].participants[1]).toEqual({
      entity: "section",
      cardinality: "N",
      total: true,
    });
    expect(chen.relationships[0].participants[0].total).toBe(false);
    expect(chen.relationships[0].attributes[0].name).toBe("grade");
  });

  it("accepts a recursive relationship naming the same entity twice", () => {
    const raw = small(
      [strong("person")],
      [{ id: "manages", label: "MANAGES", participants: two("person", "person") }],
    );
    expect(lines(raw)).toEqual([]);
  });

  it("accepts a multivalued composite attribute", () => {
    const raw = small([
      strong(
        "p",
        { name: "k", kind: "key" },
        { name: "phones", kind: "multivalued", children: ["a"] },
      ),
    ]);
    expect(lines(raw)).toEqual([]);
  });
});

describe("chen: references and ids", () => {
  it("rejects an unknown entity in a participant, with a hint", () => {
    const raw = doc((d) => (d.relationships[0].participants[0].entity = "studnt"));
    expect(lines(raw)).toEqual([
      'error ref/unknown-entity relationships[0].participants[0].entity: unknown entity "studnt"',
    ]);
    expect(hints(raw)).toEqual(['did you mean "student"?']);
  });

  it("rejects duplicate ids across entities and relationships", () => {
    const raw = doc((d) => (d.relationships[0].id = "course"));
    expect(lines(raw)).toEqual([
      'error ref/duplicate-id relationships[0].id: duplicate id "course"',
    ]);
    expect(hints(raw)).toEqual(["first used at entities[1].id"]);
  });

  it("rejects a relationship named as a participant", () => {
    const raw = doc((d) => (d.relationships[0].participants[0].entity = "has"));
    expect(lines(raw)).toEqual([
      'error ref/unknown-entity relationships[0].participants[0].entity: unknown entity "has"',
    ]);
  });

  it("rejects a duplicate attribute name among siblings", () => {
    const raw = doc((d) => d.entities[1].attributes.push("title"));
    expect(lines(raw)).toEqual([
      'error chen/duplicate-attribute entities[1].attributes[3]: duplicate attribute "title"',
    ]);
    expect(hints(raw)).toEqual(["first used at entities[1].attributes[1]"]);
  });
});

describe("chen: participants", () => {
  it("rejects fewer than 2 participants", () => {
    const raw = doc((d) => d.relationships[0].participants.pop());
    expect(lines(raw)).toEqual([
      "error chen/participants relationships[0].participants: a relationship needs exactly 2 participants, found 1",
    ]);
  });

  it("rejects 3 or more as ternary, not supported yet", () => {
    const raw = doc((d) =>
      d.relationships[0].participants.push({ entity: "course", cardinality: "M" }),
    );
    expect(lines(raw)).toEqual([
      "error chen/ternary relationships[0].participants: ternary relationships are not supported yet (found 3 participants, expected 2)",
    ]);
    expect(hints(raw)).toEqual([
      "use two participants, or model it as two binary relationships with an entity of its own",
    ]);
  });

  it("rejects a cardinality outside 1, N and M", () => {
    const raw = doc((d) => (d.relationships[0].participants[0].cardinality = "n"));
    expect(lines(raw)).toEqual([
      'error schema/enum relationships[0].participants[0].cardinality: unknown value "n"',
    ]);
    expect(hints(raw)).toEqual(['did you mean "N"?']);
  });
});

describe("chen: weak entities and identifying relationships", () => {
  const WEAK =
    'error chen/weak-not-identified entities[2]: weak entity "section" must take part in an identifying relationship with total participation';

  it("requires a weak entity to be identified with total participation", () => {
    const raw = doc((d) => delete d.relationships[1].participants[1].total);
    expect(lines(raw)).toEqual([WEAK]);
    expect(hints(raw)).toEqual([
      'add a relationship with "identifying": true and "total": true on "section"',
    ]);
  });

  it("does not count a non-identifying relationship for a weak entity", () => {
    const raw = doc((d) => delete d.relationships[1].identifying);
    expect(lines(raw)).toEqual([WEAK]);
  });

  it("requires an identifying relationship to involve a weak entity", () => {
    const raw = doc((d) => (d.relationships[3].identifying = true));
    expect(lines(raw)).toEqual([
      'error chen/identifying-no-weak relationships[3]: identifying relationship "belongs_to" must involve a weak entity',
    ]);
    expect(hints(raw)).toEqual(['mark an entity "weak": true, or remove "identifying"']);
  });
});

describe("chen: attribute kinds", () => {
  it("allows partial keys only on weak entities", () => {
    const raw = doc((d) => (d.entities[1].attributes[1] = { name: "title", kind: "partial" }));
    expect(lines(raw)).toEqual([
      'error chen/partial-key entities[1].attributes[1].kind: partial key "title" needs a weak entity, and "course" is not weak',
    ]);
    expect(hints(raw)).toEqual(['mark the entity "weak": true, or use kind "key"']);
  });

  it("rejects a key attribute on a weak entity", () => {
    const raw = doc((d) => (d.entities[2].attributes[1] = { name: "term", kind: "key" }));
    expect(lines(raw)).toEqual([
      'error chen/key-on-weak entities[2].attributes[1].kind: weak entity "section" cannot have key attribute "term"',
    ]);
    expect(hints(raw)).toEqual([
      'use kind "partial" for the attribute that tells its instances apart',
    ]);
  });

  it.each(["key", "partial", "derived"])("rejects kind %s on a composite attribute", (kind) => {
    const raw = doc((d) => (d.entities[0].attributes[1] = { name: "name", kind, children: ["a"] }));
    const found = lines(raw).filter((l) => l.includes("chen/attribute-kind"));
    expect(found).toEqual([
      `error chen/attribute-kind entities[0].attributes[1].kind: a composite attribute cannot have kind "${kind}"`,
    ]);
  });

  it("rejects key and partial kinds on the parts of a composite attribute", () => {
    const raw = doc(
      (d) => (d.entities[0].attributes[1].children[0] = { name: "first", kind: "key" }),
    );
    expect(lines(raw)).toEqual([
      'error chen/attribute-kind entities[0].attributes[1].children[0].kind: kind "key" is not allowed on a part of a composite attribute',
    ]);
  });

  it("rejects key and partial kinds on a relationship attribute", () => {
    const raw = doc((d) => (d.relationships[0].attributes[0] = { name: "grade", kind: "key" }));
    expect(lines(raw)).toEqual([
      'error chen/attribute-kind relationships[0].attributes[0].kind: kind "key" is not allowed on a relationship attribute',
    ]);
  });

  it("rejects an unknown kind and empty children", () => {
    expect(lines(doc((d) => (d.entities[0].attributes[3] = { name: "x", kind: "keyy" })))).toEqual([
      'error schema/enum entities[0].attributes[3].kind: unknown value "keyy"',
    ]);
    expect(lines(doc((d) => (d.entities[0].attributes[3] = { name: "x", children: [] })))).toEqual([
      "error schema/empty entities[0].attributes[3].children: must not be empty",
    ]);
  });

  it("rejects composite attributes nested deeper than 2 levels", () => {
    const deep = {
      name: "a",
      children: [{ name: "b", children: [{ name: "c", children: ["d"] }] }],
    };
    const raw = doc((d) => d.entities[1].attributes.push(deep));
    expect(lines(raw)).toEqual([
      "error chen/nesting entities[1].attributes[3].children[0].children[0].children: composite attributes nest at most 2 levels deep",
    ]);
  });

  it("flags unknown fields on nested attributes with a hint", () => {
    const raw = doc((d) => (d.entities[0].attributes[1].childrn = ["x"]));
    expect(lines(raw)).toEqual([
      "error schema/unknown-field entities[0].attributes[1].childrn: unknown field",
    ]);
    expect(hints(raw)).toEqual(['did you mean "children"?']);
  });
});

describe("chen: warnings", () => {
  it("warns about a strong entity without a key and still validates", () => {
    const raw = small(
      [strong("a", "x"), strong("b")],
      [{ id: "r", label: "R", participants: two("a", "b") }],
    );
    const { diagram, issues } = validateDiagram(raw);
    expect(lines(raw)).toEqual([
      'warning chen/no-key entities[0]: entity "a" has no key attribute',
    ]);
    expect(issues[0]!.hint).toBe('mark one attribute kind "key"');
    expect(diagram).toBeDefined();
  });

  it("warns about a weak entity without a partial key", () => {
    const raw = doc((d) => (d.entities[2].attributes = ["term"]));
    const { diagram, issues } = validateDiagram(raw);
    expect(lines(raw)).toEqual([
      'warning chen/no-partial-key entities[2]: weak entity "section" has no partial key',
    ]);
    expect(issues[0]!.hint).toBe(
      'mark the attribute that tells its instances apart kind "partial"',
    );
    expect(diagram).toBeDefined();
  });

  it("does not warn about the number of attributes", () => {
    const many = Array.from({ length: 25 }, (_, i) => `a${i}`);
    const raw = small([strong("a", { name: "k", kind: "key" }, ...many)]);
    expect(lines(raw)).toEqual([]);
  });
});
