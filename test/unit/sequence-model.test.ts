// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { validateDiagram } from "../../src/model/index.js";
import type { Sequence } from "../../src/model/sequence.js";
import type { Issue } from "../../src/validate/issues.js";

const participants = [
  { id: "client", kind: "actor" },
  { id: "api" },
  { id: "pg", label: "PostgreSQL", kind: "database" },
];

function seq(messages: unknown[], list: unknown[] = participants) {
  return { type: "sequence", title: "T", participants: list, messages };
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

describe("sequence model: valid input", () => {
  const full = {
    type: "sequence",
    title: "Cache miss",
    participants,
    messages: [
      "client -> api: GET /product/42",
      { note: "TTL 60 s", over: ["api", "pg"] },
      {
        alt: [
          { when: "hit", messages: ["api --> client: 200 cached"] },
          {
            when: "miss",
            messages: ["api -> pg: SELECT", "pg --> api: row", "api -> api: serialize"],
          },
        ],
      },
      { loop: { when: "per retry", messages: ["api ~> pg: ping"] } },
      "api --> client: 200",
    ],
  };

  it("builds the diagram with defaults", () => {
    const result = validateDiagram(full);
    expect(result.issues).toEqual([]);
    const diagram = result.diagram as Sequence;
    expect(diagram.type).toBe("sequence");
    expect(diagram.theme).toBe("light");
    expect(diagram.participants).toEqual([
      { id: "client", label: "client", kind: "actor" },
      { id: "api", label: "api", kind: "service" },
      { id: "pg", label: "PostgreSQL", kind: "database" },
    ]);
    expect(diagram.items).toHaveLength(5);
    expect(diagram.items[0]).toEqual({
      type: "message",
      from: "client",
      to: "api",
      label: "GET /product/42",
      style: "sync",
    });
    expect(diagram.items[1]).toEqual({ type: "note", text: "TTL 60 s", over: ["api", "pg"] });
    expect(diagram.items[2]).toMatchObject({ type: "fragment", op: "alt" });
    expect(diagram.items[3]).toEqual({
      type: "fragment",
      op: "loop",
      branches: [
        {
          when: "per retry",
          items: [{ type: "message", from: "api", to: "pg", label: "ping", style: "async" }],
        },
      ],
    });
  });

  it("maps the three arrows to sync, async and reply", () => {
    const diagram = validateDiagram(
      seq(["client -> api: a", "client ~> api: b", "api --> client: c"]),
    ).diagram as Sequence;
    expect(diagram.items.map((item) => (item as { style: string }).style)).toEqual([
      "sync",
      "async",
      "reply",
    ]);
  });

  it("treats the short form and the object form alike", () => {
    const short = validateDiagram(seq(["client -> api: hi", "api --> client: ok", "api ~> pg"]));
    const long = validateDiagram(
      seq([
        { from: "client", to: "api", label: "hi" },
        { from: "api", to: "client", label: "ok", style: "reply" },
        { from: "api", to: "pg", style: "async" },
      ]),
    );
    expect(short.issues).toEqual([]);
    expect(long.issues).toEqual([]);
    expect(long.diagram).toEqual(short.diagram);
  });

  it("accepts opt and loop with a single branch", () => {
    const result = validateDiagram(
      seq([
        "client -> api",
        { opt: { when: "logged in", messages: ["api -> pg"] } },
        { loop: { when: "retry", messages: ["api -> api"] } },
      ]),
    );
    expect(result.issues).toEqual([]);
  });

  it("accepts two levels of fragments", () => {
    const inner = { opt: { when: "b", messages: ["api -> pg"] } };
    const result = validateDiagram(
      seq(["client -> api", { loop: { when: "a", messages: [inner, "api -> pg"] } }]),
    );
    expect(result.issues).toEqual([]);
  });
});

describe("sequence model: structure", () => {
  it("requires participants and messages", () => {
    expect(only({ type: "sequence", title: "T", messages: ["a -> b"] })).toEqual({
      severity: "error",
      code: "schema/required",
      path: "participants",
      message: "missing",
      hint: 'run "trazo example sequence" for a starting point',
    });
    expect(only(seq(["a -> b"], []))).toMatchObject({ code: "schema/empty", path: "participants" });
    expect(only(seq([]))).toMatchObject({ code: "schema/empty", path: "messages" });
  });

  it("reports an unknown top-level field with a suggestion", () => {
    expect(only({ ...seq(["client -> api"]), mesages: [] })).toEqual({
      severity: "error",
      code: "schema/unknown-field",
      path: "mesages",
      message: "unknown field",
      hint: 'did you mean "messages"?',
    });
  });

  it("rejects an unknown participant kind", () => {
    expect(only(seq(["a -> b"], [{ id: "a", kind: "servce" }, { id: "b" }]))).toEqual({
      severity: "error",
      code: "schema/enum",
      path: "participants[0].kind",
      message: 'unknown value "servce"',
      hint: 'did you mean "service"?',
    });
  });

  it("reports duplicate participant ids", () => {
    expect(
      only(seq(["client -> api"], [{ id: "client" }, { id: "api" }, { id: "client" }])),
    ).toEqual({
      severity: "error",
      code: "ref/duplicate-id",
      path: "participants[2].id",
      message: 'duplicate id "client"',
      hint: "first used at participants[0].id",
    });
  });
});

describe("sequence model: messages", () => {
  it("reports an unknown participant in the short form at the element path", () => {
    expect(only(seq(["client -> api", "api -> pgg: x"]))).toEqual({
      severity: "error",
      code: "ref/unknown-participant",
      path: "messages[1]",
      message: 'unknown participant "pgg"',
      hint: 'did you mean "pg"?',
    });
  });

  it("reports an unknown participant in the object form at the field path", () => {
    expect(only(seq([{ from: "api", to: "pgg" }]))).toMatchObject({
      code: "ref/unknown-participant",
      path: "messages[0].to",
      message: 'unknown participant "pgg"',
    });
  });

  it("explains unreadable shorthand with the three arrows", () => {
    expect(only(seq(["api => pg"]))).toEqual({
      severity: "error",
      code: "edge/syntax",
      path: "messages[0]",
      message: 'cannot read "api => pg"',
      hint: 'write "from -> to: label" (-> sync, ~> async, --> reply)',
    });
  });

  it("rejects a reply to itself", () => {
    expect(only(seq(["client -> api", "api --> api: nope"]))).toEqual({
      severity: "error",
      code: "sequence/self-reply",
      path: "messages[1]",
      message: '"api --> api" replies to itself',
      hint: 'a self-call has no reply; use "api -> api" or drop it',
    });
  });

  it("rejects an unknown style in the object form", () => {
    expect(only(seq([{ from: "api", to: "pg", style: "syn" }]))).toEqual({
      severity: "error",
      code: "schema/enum",
      path: "messages[0].style",
      message: 'unknown value "syn"',
      hint: 'did you mean "sync"?',
    });
  });

  it("rejects an unknown field in a message with the full path", () => {
    expect(only(seq(["client -> api", { from: "api", to: "pg", lable: "x" }]))).toEqual({
      severity: "error",
      code: "schema/unknown-field",
      path: "messages[1].lable",
      message: "unknown field",
      hint: 'did you mean "label"?',
    });
  });
});

describe("sequence model: dispatch", () => {
  it("rejects an element that is none of the three kinds", () => {
    expect(only(seq([{ text: "x" }]))).toEqual({
      severity: "error",
      code: "sequence/element",
      path: "messages[0]",
      message: "cannot read element, expected a message, a note or a fragment",
      hint: 'use "from" and "to", "note", "alt", "opt" or "loop"',
    });
  });

  it("suggests the closest element key", () => {
    expect(only(seq([{ nte: "x", over: ["api"] }]))).toMatchObject({
      code: "sequence/element",
      path: "messages[0]",
      hint: 'did you mean "note"?',
    });
  });

  it("rejects an element that is not a string or an object", () => {
    expect(only(seq([42]))).toMatchObject({ code: "sequence/element", path: "messages[0]" });
  });

  it("rejects an element that mixes two kinds", () => {
    expect(only(seq([{ note: "x", over: ["api"], alt: [] }]))).toEqual({
      severity: "error",
      code: "sequence/element",
      path: "messages[0]",
      message: 'element mixes "note" and "alt"',
      hint: "split it into separate elements",
    });
  });
});

describe("sequence model: notes", () => {
  it("reports an unknown participant in over", () => {
    expect(only(seq([{ note: "x", over: ["api", "pgg"] }]))).toEqual({
      severity: "error",
      code: "ref/unknown-participant",
      path: "messages[0].over[1]",
      message: 'unknown participant "pgg"',
      hint: 'did you mean "pg"?',
    });
  });

  it("accepts a single id string for over", () => {
    const result = validateDiagram(seq(["client -> api", "api -> pg", { note: "x", over: "api" }]));
    expect(result.issues).toEqual([]);
    expect((result.diagram as Sequence).items[2]).toEqual({
      type: "note",
      text: "x",
      over: ["api"],
    });
  });

  it("points an unknown id in the string form of over at over", () => {
    expect(only(seq([{ note: "x", over: "pgg" }]))).toMatchObject({
      code: "ref/unknown-participant",
      path: "messages[0].over",
    });
  });

  it("names both accepted forms when over has the wrong type", () => {
    expect(only(seq([{ note: "x", over: 5 }]))).toEqual({
      severity: "error",
      code: "schema/type",
      path: "messages[0].over",
      message: "expected an id or a list of ids, got number",
    });
  });

  it.each([
    [null, "null"],
    [true, "boolean"],
    [{ id: "api" }, "object"],
  ])("names both accepted forms once when over is %j", (over, got) => {
    expect(only(seq([{ note: "x", over }]))).toEqual({
      severity: "error",
      code: "schema/type",
      path: "messages[0].over",
      message: `expected an id or a list of ids, got ${got}`,
    });
  });

  it("reports a missing over as missing, not as a wrong type", () => {
    expect(only(seq([{ note: "x" }]))).toEqual({
      severity: "error",
      code: "schema/required",
      path: "messages[0].over",
      message: "missing",
    });
  });

  it("points an invalid id in the string form of over at over", () => {
    expect(only(seq([{ note: "x", over: "Bad Id!" }]))).toMatchObject({
      code: "schema/id",
      path: "messages[0].over",
    });
  });

  it("requires a non-empty over", () => {
    expect(only(seq([{ note: "x", over: [] }]))).toMatchObject({
      code: "schema/empty",
      path: "messages[0].over",
    });
  });

  it("rejects more than two participants", () => {
    expect(only(seq([{ note: "x", over: ["client", "api", "pg"] }]))).toEqual({
      severity: "error",
      code: "sequence/note-over",
      path: "messages[0].over",
      message: "over takes 1 or 2 participants, got 3",
      hint: "split the note or pick the two that matter",
    });
  });

  it("rejects repeated participants", () => {
    expect(only(seq([{ note: "x", over: ["api", "api"] }]))).toEqual({
      severity: "error",
      code: "sequence/note-over",
      path: "messages[0].over[1]",
      message: 'over repeats "api"',
      hint: "list each participant once",
    });
  });
});

describe("sequence model: fragments", () => {
  it("rejects an alt with a single branch", () => {
    expect(only(seq([{ alt: [{ when: "a", messages: ["api -> pg"] }] }]))).toEqual({
      severity: "error",
      code: "sequence/alt-branches",
      path: "messages[0].alt",
      message: "alt needs at least 2 branches (has 1)",
      hint: 'use "opt" for a single condition',
    });
  });

  it("reports an empty alt as empty", () => {
    expect(only(seq([{ alt: [] }]))).toMatchObject({
      code: "schema/empty",
      path: "messages[0].alt",
    });
  });

  it("requires when on every branch", () => {
    const raw = seq([
      { alt: [{ when: "a", messages: ["api -> pg"] }, { messages: ["api -> pg"] }] },
    ]);
    expect(only(raw)).toEqual({
      severity: "error",
      code: "schema/required",
      path: "messages[0].alt[1].when",
      message: "missing",
    });
  });

  it("rejects a branch without messages", () => {
    expect(only(seq([{ opt: { when: "a", messages: [] } }]))).toMatchObject({
      code: "schema/empty",
      path: "messages[0].opt.messages",
    });
  });

  it("reports an unknown field inside a branch with the full path", () => {
    const raw = seq([
      "client -> api",
      "api -> pg",
      {
        alt: [
          { when: "a", messages: ["api -> pg"] },
          { when: "b", messages: [{ from: "api", to: "pg", lable: "x" }] },
        ],
      },
    ]);
    expect(only(raw)).toMatchObject({
      code: "schema/unknown-field",
      path: "messages[2].alt[1].messages[0].lable",
      hint: 'did you mean "label"?',
    });
  });

  it("reports a nested unknown participant with the full path", () => {
    const raw = seq([
      "client -> api",
      "api -> pg",
      {
        alt: [
          { when: "a", messages: ["api -> pg"] },
          { when: "b", messages: ["api -> pgg"] },
        ],
      },
    ]);
    expect(only(raw)).toEqual({
      severity: "error",
      code: "ref/unknown-participant",
      path: "messages[2].alt[1].messages[0]",
      message: 'unknown participant "pgg"',
      hint: 'did you mean "pg"?',
    });
  });

  it("rejects a fragment nested three levels deep", () => {
    const deepest = { opt: { when: "c", messages: ["api -> pg"] } };
    const middle = { opt: { when: "b", messages: [deepest] } };
    const raw = seq([{ loop: { when: "a", messages: [middle] } }]);
    expect(only(raw)).toEqual({
      severity: "error",
      code: "sequence/nesting",
      path: "messages[0].loop.messages[0].opt.messages[0]",
      message: "fragment nested 3 levels deep, limit is 2",
      hint: "move the inner block out or split the diagram",
    });
  });

  it("rejects an unknown field next to the fragment key", () => {
    expect(only(seq([{ opt: { when: "a", messages: ["api -> pg"] }, extra: 1 }]))).toMatchObject({
      code: "schema/unknown-field",
      path: "messages[0].extra",
    });
  });
});

describe("sequence model: warnings", () => {
  it("warns about a reply without an earlier request and still builds", () => {
    const raw = seq(["client -> api", "pg --> api: row", "api -> pg"]);
    const result = validateDiagram(raw);
    expect(result.diagram).toBeDefined();
    expect(onlyWarning(raw)).toEqual({
      severity: "warning",
      code: "sequence/orphan-reply",
      path: "messages[1]",
      message: '"pg --> api" has no earlier request api -> pg',
      hint: "send the request before replying",
    });
  });

  it("counts a request inside an earlier branch", () => {
    const raw = seq([
      "client -> api",
      { opt: { when: "x", messages: ["api -> pg"] } },
      "pg --> api",
    ]);
    expect(validateDiagram(raw).issues).toEqual([]);
  });

  it("warns about a participant that never appears", () => {
    expect(onlyWarning(seq(["client -> api"]))).toEqual({
      severity: "warning",
      code: "sequence/unused-participant",
      path: "participants[2]",
      message: 'participant "pg" never appears in a message or note',
      hint: "remove it or add a message",
    });
  });

  it("counts a note as an appearance", () => {
    expect(warnings(seq(["client -> api", { note: "x", over: ["pg"] }]))).toEqual([]);
  });

  it("warns above 60 messages, counting fragment messages", () => {
    const many = Array.from({ length: 59 }, () => "client -> api");
    const raw = seq([...many, { opt: { when: "x", messages: ["api -> pg", "api -> pg"] } }]);
    expect(onlyWarning(raw)).toEqual({
      severity: "warning",
      code: "size/large",
      path: "messages",
      message: "61 messages",
      hint: "diagrams read best under 60 messages; consider splitting into several",
    });
    expect(warnings(seq([...many, "api -> pg"]))).toEqual([]);
  });

  it("warns above 8 participants", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}` }));
    const chain = nine.slice(1).map((p, i) => `p${i} -> ${p.id}`);
    expect(onlyWarning(seq(chain, nine))).toEqual({
      severity: "warning",
      code: "size/large",
      path: "participants",
      message: "9 participants",
      hint: "diagrams read best under 8 participants; consider splitting into several",
    });
  });

  it("warns about labels over 80 characters", () => {
    const label = "x".repeat(95);
    expect(
      onlyWarning(seq(["client -> api", `api -> pg: ${label}`, { note: "n", over: ["pg"] }])),
    ).toEqual({
      severity: "warning",
      code: "sequence/long-label",
      path: "messages[1]",
      message: "label is 95 characters",
      hint: "keep message labels under 80; move detail to a note",
    });
  });
});

describe("sequence model: other diagram types keep their behavior", () => {
  const arch = {
    type: "architecture",
    title: "T",
    nodes: [{ id: "a" }, { id: "b" }],
    edges: ["a --> b"],
  };
  const flow = {
    type: "workflow",
    title: "T",
    steps: [{ id: "a" }, { id: "b" }],
    edges: ["a --> b"],
  };

  it("architecture still rejects the reply arrow", () => {
    expect(only(arch)).toEqual({
      severity: "error",
      code: "edge/arrow",
      path: "edges[0]",
      message: 'arrow "-->" is not available in architecture diagrams',
      hint: "use -> for sync or ~> for async",
    });
  });

  it("workflow still rejects the reply arrow", () => {
    expect(only(flow)).toEqual({
      severity: "error",
      code: "edge/arrow",
      path: "edges[0]",
      message: 'arrow "-->" is not available in workflow diagrams',
      hint: "use -> for sync or ~> for async",
    });
  });

  it("architecture and workflow keep the two-arrow syntax hint", () => {
    const hint = 'write "from -> to: label" (-> sync, ~> async)';
    expect(only({ ...arch, edges: ["a => b"] })).toMatchObject({ code: "edge/syntax", hint });
    expect(only({ ...flow, edges: ["a => b"] })).toMatchObject({ code: "edge/syntax", hint });
  });

  it("lists the four types for an unknown type", () => {
    expect(only({ type: "sequnce", title: "T" })).toMatchObject({
      code: "schema/enum",
      path: "type",
      hint: 'did you mean "sequence"?',
    });
    expect(only({ type: "zzzzzz", title: "T" }).hint).toBe(
      "use one of: architecture, workflow, erd, sequence",
    );
  });
});
