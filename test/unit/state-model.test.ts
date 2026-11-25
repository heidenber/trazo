// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateDiagram } from "../../src/model/index.js";

const example: Record<string, any> = JSON.parse(
  readFileSync(new URL("../../examples/state.json", import.meta.url), "utf8"),
);

const lines = (raw: unknown) =>
  validateDiagram(raw).issues.map((i) => `${i.severity} ${i.code} ${i.path}: ${i.message}`);

const doc = (edit: (d: Record<string, any>) => void) => {
  const copy = structuredClone(example);
  edit(copy);
  return copy;
};

/** A tiny valid machine: initial -> a -> final. */
const small = (states: unknown[], transitions: unknown[]) => ({
  type: "state",
  title: "T",
  states,
  transitions,
});
const base = [{ id: "i", kind: "initial" }, { id: "a" }, { id: "f", kind: "final" }];

describe("state: accepted", () => {
  it("accepts the purchase order example with no issues and normalizes it", () => {
    const { diagram, issues } = validateDiagram(example);
    expect(issues).toEqual([]);
    expect(diagram).toMatchObject({ type: "state", theme: "light", title: "Purchase order" });
    const d = diagram as any;
    expect(d.states[0]).toEqual({ id: "start", label: "Initial state", kind: "initial" });
    expect(d.states[1]).toEqual({ id: "draft", label: "Draft", kind: "state" });
    expect(d.states[7].kind).toBe("exception");
    expect(d.states[9]).toEqual({ id: "end", label: "Final state", kind: "final" });
    expect(d.transitions[1]).toEqual({ from: "draft", to: "draft", label: "edit" });
  });

  it("accepts the object form of a transition", () => {
    const raw = small(base, [
      { from: "i", to: "a", label: "go" },
      { from: "a", to: "f", label: "stop" },
    ]);
    expect(lines(raw)).toEqual([]);
  });
});

describe("state: unsupported notation", () => {
  it.each(["history", "shallow-history", "deep-history", "decision", "choice", "composite"])(
    "rejects kind %s with state/unsupported",
    (kind) => {
      const raw = small([...base, { id: "h", kind }], ["i -> a: go", "a -> f: stop"]);
      expect(lines(raw)).toEqual([
        `error state/unsupported states[3].kind: "${kind}" states are not supported (basic notation only)`,
      ]);
      expect(validateDiagram(raw).issues[0]!.hint).toBe(
        "use kind initial, final, exception, or a plain state",
      );
    },
  );

  it.each(["children", "states", "regions", "parent"])(
    "rejects the field %s with state/unsupported",
    (field) => {
      const raw = small(
        [{ id: "i", kind: "initial" }, { id: "a", [field]: [] }, base[2]],
        ["i -> a: go", "a -> f: stop"],
      );
      expect(lines(raw)).toEqual([
        `error state/unsupported states[1].${field}: composite states and regions are not supported (basic notation only)`,
      ]);
    },
  );

  it("still reports an unknown kind as a schema error", () => {
    const raw = small([...base, { id: "h", kind: "bogus" }], ["i -> a", "a -> f"]);
    expect(lines(raw)[0]).toMatch(/^error schema\/enum states\[3\]\.kind/);
  });
});

describe("state: errors", () => {
  it("needs exactly one initial state", () => {
    expect(lines(small([{ id: "a" }, { id: "f", kind: "final" }], ["a -> f: x"]))).toEqual([
      "error state/initial-count states: expected exactly 1 initial state, found 0",
    ]);
    const two = small(
      [...base, { id: "j", kind: "initial" }],
      ["i -> a: x", "j -> a: y", "a -> f: z"],
    );
    expect(lines(two)).toEqual([
      "error state/initial-count states: expected exactly 1 initial state, found 2",
    ]);
  });

  it("rejects an incoming transition to the initial state", () => {
    expect(lines(small(base, ["i -> a: go", "a -> i: back", "a -> f: stop"]))).toEqual([
      'error state/initial-incoming transitions[1]: "i" is the initial state and cannot have incoming transitions',
    ]);
  });

  it("gives the initial state exactly one outgoing transition", () => {
    expect(lines(small(base, ["a -> f: stop"]))).toContain(
      'error state/initial-outgoing states[0]: the initial state "i" needs exactly 1 outgoing transition (has 0)',
    );
    expect(lines(small(base, ["i -> a: x", "i -> f: y", "a -> f: z"]))).toContain(
      'error state/initial-outgoing states[0]: the initial state "i" needs exactly 1 outgoing transition (has 2)',
    );
  });

  it("rejects an outgoing transition from a final state", () => {
    expect(lines(small(base, ["i -> a: go", "a -> f: stop", "f -> a: again"]))).toEqual([
      'error state/final-outgoing transitions[2]: "f" is a final state and cannot have outgoing transitions',
    ]);
  });

  it("reports unknown and duplicate ids", () => {
    expect(lines(small(base, ["i -> a: go", "a -> x: stop"]))).toContain(
      'error ref/unknown-state transitions[1].to: unknown state "x"',
    );
    expect(lines(small([...base, { id: "a" }], ["i -> a: go", "a -> f: stop"]))).toEqual([
      'error ref/duplicate-id states[3].id: duplicate id "a"',
    ]);
  });

  it("requires at least one state", () => {
    expect(lines({ type: "state", title: "T", states: [] })[0]).toMatch(/^error schema\//);
  });

  it("rejects the weighted arrows and a bad shorthand like workflow does", () => {
    expect(lines(small(base, ["i ~> a: go", "a -> f: stop"]))[0]).toMatch(/^error edge\/arrow/);
    expect(lines(small(base, ["i => a", "a -> f: stop"]))[0]).toMatch(/^error edge\/syntax/);
  });

  it("rejects an unknown field with a hint", () => {
    const issue = validateDiagram({ ...small(base, ["i -> a: go", "a -> f: s"]), stats: 1 })
      .issues[0]!;
    expect(issue).toMatchObject({ code: "schema/unknown-field", path: "stats" });
  });
});

describe("state: warnings", () => {
  it("warns about a transition without an event, except from the initial state", () => {
    expect(lines(small(base, ["i -> a", "a -> f"]))).toEqual([
      "warning state/no-event transitions[1]: transition has no event label",
    ]);
  });

  it("warns about a duplicate transition", () => {
    expect(lines(small(base, ["i -> a: go", "a -> f: stop", "a -> f: stop"]))).toEqual([
      "warning edge/duplicate transitions[2]: same as transitions[1]",
    ]);
  });

  it("warns about unreachable states and dead ends", () => {
    const raw = small([...base, { id: "z" }], ["i -> a: go", "a -> f: stop"]);
    expect(lines(raw)).toEqual([
      'warning state/dead-end states[3]: "z" has no outgoing transitions',
      'warning state/unreachable states[3]: "z" cannot be reached from the initial state',
    ]);
  });

  it("warns about a dead end that is not final, never about an exception it", () => {
    const raw = small(base, ["i -> a: go", "a -> f: stop"]);
    expect(lines(raw)).toEqual([]);
    expect(
      lines(small([...base, { id: "x" }], ["i -> a: go", "a -> f: stop", "a -> x: oops"])),
    ).toEqual(['warning state/dead-end states[3]: "x" has no outgoing transitions']);
  });

  it("is silent about a self-transition", () => {
    expect(lines(doc(() => {}))).toEqual([]);
  });
});
