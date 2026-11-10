// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { validateDiagram } from "../../src/model/index.js";
import type { Issue } from "../../src/validate/issues.js";

const refund = {
  type: "workflow",
  title: "Refund",
  lanes: [
    { id: "customer", label: "Customer", steps: ["begin", "request", "done"] },
    { id: "support", steps: ["review", "reject"] },
  ],
  steps: [
    { id: "begin", kind: "start" },
    { id: "request", label: "Request refund" },
    { id: "review", label: "Within 30 days?", kind: "decision" },
    { id: "reject", label: "Send rejection" },
    { id: "done", kind: "end" },
  ],
  edges: [
    "begin -> request",
    "request -> review",
    "review -> done: yes",
    "review -> reject: no",
    "reject -> done",
  ],
};

const simple = {
  type: "workflow",
  title: "T",
  steps: [{ id: "a" }, { id: "b" }],
  edges: ["a -> b"],
};

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

describe("workflow: valid input", () => {
  it("applies defaults", () => {
    const { diagram, issues } = validateDiagram({
      type: "workflow",
      title: "T",
      steps: [{ id: "s", kind: "start" }, { id: "a" }, { id: "e", kind: "end", label: "Finished" }],
      edges: ["s -> a", "a ~> e"],
    });
    expect(issues).toEqual([]);
    expect(diagram).toEqual({
      type: "workflow",
      title: "T",
      theme: "light",
      direction: "down",
      lanes: [],
      steps: [
        { id: "s", label: "Start", kind: "start" },
        { id: "a", label: "a", kind: "task" },
        { id: "e", label: "Finished", kind: "end" },
      ],
      edges: [
        { from: "s", to: "a", style: "sync" },
        { from: "a", to: "e", style: "async" },
      ],
    });
  });

  it("labels an unlabeled end step", () => {
    const { diagram } = validateDiagram({
      type: "workflow",
      title: "T",
      steps: [{ id: "x", kind: "end" }],
    });
    expect(diagram?.type === "workflow" && diagram.steps[0]?.label).toBe("End");
  });

  it("accepts a workflow without edges and without start or end", () => {
    expect(validateDiagram({ type: "workflow", title: "T", steps: [{ id: "a" }] }).issues).toEqual(
      [],
    );
  });

  it("accepts every step kind", () => {
    const kinds = ["task", "start", "end", "decision", "wait", "subprocess"];
    const { diagram } = validateDiagram({
      type: "workflow",
      title: "T",
      steps: kinds.map((kind) => ({ id: kind, kind, note: "n", source: "src/x.ts" })),
      edges: ["decision -> task: yes", "decision -> wait: no"],
    });
    expect(diagram?.type === "workflow" && diagram.steps.map((s) => s.kind)).toEqual(kinds);
  });

  it("keeps lanes, defaults their label and forces direction right", () => {
    const { diagram, issues } = validateDiagram(refund);
    expect(issues).toEqual([]);
    expect(diagram?.type === "workflow" && diagram.direction).toBe("right");
    expect(diagram?.type === "workflow" && diagram.lanes).toEqual([
      { id: "customer", label: "Customer", steps: ["begin", "request", "done"] },
      { id: "support", label: "support", steps: ["review", "reject"] },
    ]);
  });

  it("honors direction right and down without lanes", () => {
    const right = validateDiagram({ ...simple, direction: "right" }).diagram;
    const down = validateDiagram({ ...simple, direction: "down" }).diagram;
    expect(right?.type === "workflow" && right.direction).toBe("right");
    expect(down?.type === "workflow" && down.direction).toBe("down");
  });

  it("treats the shorthand and the object form the same way", () => {
    const short = validateDiagram({ ...simple, edges: ["a ~> b: later"] });
    const long = validateDiagram({
      ...simple,
      edges: [{ from: "a", to: "b", label: "later", style: "async" }],
    });
    expect(short).toEqual(long);
  });

  it("accepts cycles without issues", () => {
    const { issues } = validateDiagram({
      type: "workflow",
      title: "Retry",
      steps: [
        { id: "s", kind: "start" },
        { id: "try" },
        { id: "ok", kind: "decision" },
        { id: "e", kind: "end" },
      ],
      edges: ["s -> try", "try -> ok", "ok -> try: no", "ok -> e: yes"],
    });
    expect(issues).toEqual([]);
  });
});

describe("workflow: schema", () => {
  it("requires at least one step", () => {
    expect(only({ type: "workflow", title: "T", steps: [] })).toEqual({
      severity: "error",
      code: "schema/empty",
      path: "steps",
      message: "must not be empty",
    });
  });

  it("requires lanes to have steps", () => {
    expect(only({ ...simple, lanes: [{ id: "l", steps: [] }] })).toMatchObject({
      code: "schema/empty",
      path: "lanes[0].steps",
    });
  });

  it("lists workflow fields for an unknown top-level field", () => {
    expect(only({ ...simple, lane: [] })).toEqual({
      severity: "error",
      code: "schema/unknown-field",
      path: "lane",
      message: "unknown field",
      hint: 'did you mean "lanes"?',
    });
    expect(only({ ...simple, zzzzzzzz: 1 }).hint).toBe(
      "allowed: type, title, description, theme, direction, lanes, steps, edges",
    );
  });

  it("lists the step kinds in order", () => {
    expect(only({ ...simple, steps: [{ id: "a", kind: "qqqqqqqq" }] })).toEqual({
      severity: "error",
      code: "schema/enum",
      path: "steps[0].kind",
      message: 'unknown value "qqqqqqqq"',
      hint: "use one of: task, start, end, decision, wait, subprocess",
    });
  });

  it("rejects the reply arrow", () => {
    expect(only({ ...simple, edges: ["a --> b"] })).toEqual({
      severity: "error",
      code: "edge/arrow",
      path: "edges[0]",
      message: 'arrow "-->" is not available in workflow diagrams',
      hint: "use -> for sync or ~> for async",
    });
  });

  it("rejects the data edge style", () => {
    expect(only({ ...simple, edges: [{ from: "a", to: "b", style: "data" }] })).toMatchObject({
      code: "schema/enum",
      path: "edges[0].style",
      hint: "use one of: sync, async",
    });
  });

  it("rejects unreadable shorthand", () => {
    expect(only({ ...simple, edges: ["a b"] })).toMatchObject({
      code: "edge/syntax",
      path: "edges[0]",
    });
  });
});

describe("workflow: references", () => {
  it("reports an unknown step in an edge with a suggestion", () => {
    const unknown = { ...simple, steps: [{ id: "a" }, { id: "review" }] };
    expect(only({ ...unknown, edges: ["a -> reveiw"] })).toEqual({
      severity: "error",
      code: "ref/unknown-step",
      path: "edges[0].to",
      message: 'unknown step "reveiw"',
      hint: 'did you mean "review"?',
    });
    expect(only({ ...unknown, edges: ["zzzzzz -> a"] })).toEqual({
      severity: "error",
      code: "ref/unknown-step",
      path: "edges[0].from",
      message: 'unknown step "zzzzzz"',
    });
  });

  it("reports an unknown step in a lane", () => {
    expect(only({ ...simple, lanes: [{ id: "l", steps: ["a", "b", "bb"] }] })).toEqual({
      severity: "error",
      code: "ref/unknown-step",
      path: "lanes[0].steps[2]",
      message: 'unknown step "bb"',
      hint: 'did you mean "b"?',
    });
  });

  it("reports duplicate ids across steps and lanes", () => {
    expect(only({ ...simple, lanes: [{ id: "a", steps: ["a", "b"] }] })).toEqual({
      severity: "error",
      code: "ref/duplicate-id",
      path: "lanes[0].id",
      message: 'duplicate id "a"',
      hint: "first used at steps[0].id",
    });
  });
});

describe("workflow: lanes", () => {
  it("rejects a step in two lanes", () => {
    expect(
      only({
        ...simple,
        lanes: [
          { id: "l1", steps: ["a", "b"] },
          { id: "l2", steps: ["b"] },
        ],
      }),
    ).toEqual({
      severity: "error",
      code: "lane/multiple-lanes",
      path: "lanes[1].steps[0]",
      message: '"b" is already in lane "l1"',
      hint: "a step belongs to one lane",
    });
  });

  it("requires every step to be in a lane when lanes exist", () => {
    expect(only({ ...simple, lanes: [{ id: "l", steps: ["a"] }] })).toEqual({
      severity: "error",
      code: "lane/missing",
      path: "steps[1]",
      message: '"b" is not in any lane',
      hint: "add it to a lane's steps",
    });
  });

  it("warns when direction down is combined with lanes", () => {
    const result = validateDiagram({ ...refund, direction: "down" });
    expect(result.issues).toEqual([
      {
        severity: "warning",
        code: "workflow/lanes-direction",
        path: "direction",
        message: "lanes always flow right",
      },
    ]);
    expect(result.diagram?.type === "workflow" && result.diagram.direction).toBe("right");
  });
});

describe("workflow: rules", () => {
  const decision = (edges: unknown[]) => ({
    type: "workflow",
    title: "T",
    steps: [{ id: "q", kind: "decision" }, { id: "a" }, { id: "b" }],
    edges,
  });

  it("requires two outgoing edges on a decision", () => {
    expect(only(decision(["q -> a: yes"]))).toEqual({
      severity: "error",
      code: "workflow/decision-outputs",
      path: "steps[0]",
      message: "decision needs at least 2 outgoing edges (has 1)",
    });
    expect(only(decision(["a -> b"])).message).toBe(
      "decision needs at least 2 outgoing edges (has 0)",
    );
  });

  it("rejects incoming edges on a start step", () => {
    const raw = {
      type: "workflow",
      title: "T",
      steps: [{ id: "s", kind: "start" }, { id: "a" }],
      edges: ["s -> a", "a -> s"],
    };
    expect(only(raw)).toEqual({
      severity: "error",
      code: "workflow/start-incoming",
      path: "edges[1]",
      message: '"s" is a start step and cannot have incoming edges',
    });
  });

  it("rejects outgoing edges on an end step", () => {
    const raw = {
      type: "workflow",
      title: "T",
      steps: [{ id: "e", kind: "end" }, { id: "a" }],
      edges: ["e -> a"],
    };
    expect(only(raw)).toEqual({
      severity: "error",
      code: "workflow/end-outgoing",
      path: "edges[0]",
      message: '"e" is an end step and cannot have outgoing edges',
    });
  });

  it("warns about steps unreachable from a start", () => {
    const raw = {
      type: "workflow",
      title: "T",
      steps: [{ id: "s", kind: "start" }, { id: "a" }, { id: "x" }, { id: "e", kind: "end" }],
      edges: ["s -> a", "a -> e", "x -> e"],
    };
    expect(warnings(raw)).toEqual([
      {
        severity: "warning",
        code: "workflow/unreachable",
        path: "steps[2]",
        message: '"x" cannot be reached from a start step',
      },
    ]);
  });

  it("does not check reachability without a start step", () => {
    const raw = {
      ...simple,
      steps: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: ["a -> b", "c -> b"],
    };
    expect(warnings(raw).map((w) => w.code)).toEqual(["workflow/dead-end"]);
  });

  it("warns about dead ends only when there are edges", () => {
    expect(warnings({ type: "workflow", title: "T", steps: [{ id: "a" }, { id: "b" }] })).toEqual(
      [],
    );
    expect(warnings(simple)).toEqual([
      {
        severity: "warning",
        code: "workflow/dead-end",
        path: "steps[1]",
        message: '"b" has no outgoing edges',
        hint: 'connect it or mark it as kind "end"',
      },
    ]);
  });

  it("warns about unlabeled decision branches", () => {
    expect(warnings(decision(["q -> a: yes", "q -> b"]))).toContainEqual({
      severity: "warning",
      code: "workflow/decision-label",
      path: "edges[1]",
      message: "decision branch has no label",
      hint: 'label it with the answer, e.g. "yes"',
    });
  });

  it("warns about duplicate edges", () => {
    expect(
      warnings({ ...simple, edges: ["a -> b", "a -> b"] }).map((w) => [w.code, w.path, w.message]),
    ).toEqual([
      ["edge/duplicate", "edges[1]", "same as edges[0]"],
      ["workflow/dead-end", "steps[1]", '"b" has no outgoing edges'],
    ]);
  });

  it("warns when the workflow is too large", () => {
    const steps = Array.from({ length: 41 }, (_, i) => ({ id: `n${i}` }));
    expect(warnings({ type: "workflow", title: "T", steps })).toEqual([
      {
        severity: "warning",
        code: "size/large",
        path: "steps",
        message: "41 steps",
        hint: "workflows read best under 40 steps; consider splitting into subprocesses",
      },
    ]);
  });

  it("does not report graph rules on top of reference errors", () => {
    const found = errors(decision(["q -> zz: yes"]));
    expect(found.map((i) => i.code)).toEqual(["ref/unknown-step"]);
  });
});
