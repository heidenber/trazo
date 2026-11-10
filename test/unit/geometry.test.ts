// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkGeometry } from "../../src/check/geometry.js";
import { check, make } from "../../src/index.js";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import type { Box, Scene, SceneEdge, SceneGroup, SceneNode } from "../../src/scene.js";

const text = (lines: string[], x = 0, y = 0) => ({
  lines,
  x,
  y,
  size: 13,
  weight: 600 as const,
  anchor: "start" as const,
});

function node(id: string, x: number, y: number, w = 100, h = 40, label = id): SceneNode {
  return { id, kind: "service", shape: "box", x, y, w, h, label: text([label]) };
}

function edge(
  id: string,
  from: string,
  to: string,
  points: [number, number][],
  label?: Box,
): SceneEdge {
  const out: SceneEdge = {
    id,
    from,
    to,
    points: points.map(([x, y]) => ({ x, y })),
    style: "sync",
  };
  if (label) out.label = { box: label, text: text(["l"]) };
  return out;
}

function group(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  variant: SceneGroup["variant"] = "group",
): SceneGroup {
  return { id, x, y, w, h, depth: 0, variant, label: text([id]) };
}

const scene = (parts: Partial<Scene>): Scene => ({
  type: "architecture",
  title: "T",
  theme: "light",
  width: 800,
  height: 600,
  groups: [],
  nodes: [],
  edges: [],
  ...parts,
});

const warn = (code: string, message: string, hint: string) => ({
  severity: "warning",
  code,
  path: "layout",
  message,
  hint,
});

describe("geometry/node-overlap", () => {
  it("reports two nodes that overlap", () => {
    const issues = checkGeometry(scene({ nodes: [node("b", 50, 0), node("a", 0, 0)] }));
    expect(issues).toEqual([
      warn(
        "geometry/node-overlap",
        'node "a" overlaps node "b"',
        "split the diagram or group related nodes",
      ),
    ]);
  });

  it("ignores boxes that only touch within the tolerance", () => {
    expect(
      checkGeometry(scene({ nodes: [node("a", 0, 0), node("b", 99.6, 0), node("c", 0, 39.8)] })),
    ).toEqual([]);
  });
});

describe("geometry/label-overlap", () => {
  const nodes = [node("a", 0, 0), node("b", 300, 0), node("c", 150, 100)];

  it("reports an edge label over a node", () => {
    const e = edge(
      "e0",
      "a",
      "b",
      [
        [100, 20],
        [300, 20],
      ],
      { x: 140, y: 90, w: 60, h: 30 },
    );
    expect(checkGeometry(scene({ nodes, edges: [e] }))).toEqual([
      warn("geometry/label-overlap", 'label of a -> b overlaps node "c"', "shorten the label"),
    ]);
  });

  it("reports two labels that overlap, once", () => {
    const e1 = edge(
      "e0",
      "c",
      "d",
      [
        [0, 300],
        [10, 300],
      ],
      { x: 400, y: 300, w: 60, h: 20 },
    );
    const e2 = edge(
      "e1",
      "a",
      "b",
      [
        [0, 400],
        [10, 400],
      ],
      { x: 430, y: 310, w: 60, h: 20 },
    );
    expect(checkGeometry(scene({ edges: [e1, e2] }))).toEqual([
      warn("geometry/label-overlap", "labels of a -> b and c -> d overlap", "shorten the label"),
    ]);
  });

  it("accepts labels that only touch", () => {
    const e1 = edge(
      "e0",
      "c",
      "d",
      [
        [0, 300],
        [10, 300],
      ],
      { x: 400, y: 300, w: 60, h: 20 },
    );
    const e2 = edge(
      "e1",
      "a",
      "b",
      [
        [0, 400],
        [10, 400],
      ],
      { x: 460.4, y: 300, w: 60, h: 20 },
    );
    expect(checkGeometry(scene({ edges: [e1, e2] }))).toEqual([]);
  });
});

describe("geometry/edge-through-node", () => {
  const nodes = [node("a", 0, 0), node("b", 400, 0), node("c", 200, 0)];

  it("reports a segment that enters a third node", () => {
    const e = edge("#m0", "a", "b", [
      [100, 20],
      [400, 20],
    ]);
    expect(checkGeometry(scene({ nodes, edges: [e] }))).toEqual([
      warn(
        "geometry/edge-through-node",
        'edge a -> b crosses node "c"',
        "try another direction or group related nodes",
      ),
    ]);
  });

  it("ignores a segment that only grazes a node edge", () => {
    const e = edge("e0", "a", "b", [
      [100, 40.3],
      [400, 40.3],
    ]);
    expect(checkGeometry(scene({ nodes, edges: [e] }))).toEqual([]);
  });

  it("ignores its own endpoints, self-calls and self-refs", () => {
    const self = edge("e0", "a", "a", [
      [100, 10],
      [130, 10],
      [130, 30],
      [100, 30],
      [50, 30],
    ]);
    const through = edge("e1", "a", "b", [
      [50, 20],
      [450, 20],
    ]);
    const issues = checkGeometry(
      scene({ nodes: [node("a", 0, 0), node("b", 400, 0)], edges: [self, through] }),
    );
    expect(issues).toEqual([]);
  });
});

describe("geometry/outside-canvas", () => {
  const hint = "this is a layout defect in trazo; please report it";

  it("reports a node, a group and a label outside the canvas", () => {
    const e = edge(
      "e0",
      "a",
      "b",
      [
        [0, 0],
        [1, 1],
      ],
      { x: 780, y: 10, w: 60, h: 20 },
    );
    const issues = checkGeometry(
      scene({
        nodes: [node("a", -5, 0), node("b", 750, 560)],
        groups: [group("g", 0, 0, 900, 100)],
        edges: [e],
      }),
    );
    expect(issues.map((i) => [i.code, i.message, i.hint])).toEqual([
      ["geometry/outside-canvas", 'group "g" is outside the canvas', hint],
      ["geometry/outside-canvas", "label of a -> b is outside the canvas", hint],
      ["geometry/outside-canvas", 'node "a" is outside the canvas', hint],
      ["geometry/outside-canvas", 'node "b" is outside the canvas', hint],
    ]);
    expect(issues.every((i) => i.severity === "warning" && i.path === "layout")).toBe(true);
  });

  it("accepts a node that fills the canvas", () => {
    expect(checkGeometry(scene({ width: 100, height: 40, nodes: [node("a", 0, 0)] }))).toEqual([]);
  });
});

describe("geometry/outside-group", () => {
  it("reports a node that leaves its group", () => {
    const n = { ...node("a", 150, 10), parent: "g" };
    expect(checkGeometry(scene({ groups: [group("g", 0, 0, 200, 100)], nodes: [n] }))).toEqual([
      warn(
        "geometry/outside-group",
        'node "a" is outside group "g"',
        "this is a layout defect in trazo; please report it",
      ),
    ]);
  });

  it("accepts a node inside its group", () => {
    const n = { ...node("a", 10, 10), parent: "g" };
    expect(checkGeometry(scene({ groups: [group("g", 0, 0, 200, 100)], nodes: [n] }))).toEqual([]);
  });

  it("does not compare groups, lanes or fragments with nodes", () => {
    const groups = [
      group("g", 0, 0, 200, 100),
      group("l", 0, 0, 800, 100, "lane"),
      group("f", 0, 0, 300, 100, "fragment"),
    ];
    expect(checkGeometry(scene({ groups, nodes: [node("a", 10, 10)] }))).toEqual([]);
  });
});

describe("geometry/text-overflow", () => {
  it("reports a label line wider than the box minus padding", () => {
    const n = node("a", 0, 0, 40, 40, "A very long label indeed");
    expect(checkGeometry(scene({ nodes: [n] }))).toEqual([
      warn(
        "geometry/text-overflow",
        'label of node "a" is wider than its box',
        "shorten the label",
      ),
    ]);
  });

  it("accepts a label that fits and skips erd tables", () => {
    const table: SceneNode = {
      ...node("t", 300, 0, 20, 40, "A very long table name"),
      shape: "table",
    };
    expect(checkGeometry(scene({ nodes: [node("a", 0, 0, 100, 40, "Short"), table] }))).toEqual([]);
  });
});

describe("sequence exemptions", () => {
  it("does not check lifelines crossing fragments", () => {
    const s = scene({
      type: "sequence",
      groups: [group("f", 0, 100, 500, 200, "fragment")],
      nodes: [node("a", 0, 0), node("b", 300, 0)],
      lifelines: [{ id: "a", x: 50, y1: 40, y2: 500 }],
    });
    expect(checkGeometry(s)).toEqual([]);
  });
});

describe("ordering", () => {
  it("sorts by code then ids and reports each pair once", () => {
    const nodes = [
      node("z", 0, 0),
      node("y", 10, 0),
      node("b", 300, 300),
      node("a", 310, 300),
      node("long", 600, 0, 30, 40, "Way too wide"),
    ];
    const issues = checkGeometry(scene({ nodes }));
    expect(issues.map((i) => i.message)).toEqual([
      'node "a" overlaps node "b"',
      'node "y" overlaps node "z"',
      'label of node "long" is wider than its box',
    ]);
  });
});

describe("examples", () => {
  const files = readdirSync("examples").filter((f) => f.endsWith(".json"));

  it("finds the four examples", () => {
    expect(files.sort()).toEqual([
      "architecture.json",
      "erd.json",
      "sequence.json",
      "workflow.json",
    ]);
  });

  it.each(files)("%s has no geometry warnings", async (file) => {
    const input = readFileSync(`examples/${file}`, "utf8");
    const result = await make(input);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.code.startsWith("geometry/"))).toEqual([]);
    const { diagram } = validateDiagram(JSON.parse(input));
    expect(checkGeometry(await layoutDiagram(diagram!))).toEqual([]);
  });
});

describe("check", () => {
  it("never runs the layout, so it has no geometry codes", () => {
    const input = readFileSync("examples/architecture.json", "utf8");
    expect(check(input).issues.filter((i) => i.code.startsWith("geometry/"))).toEqual([]);
  });
});

describe("parent", () => {
  it("is unset in erd and sequence scenes", async () => {
    for (const file of ["erd.json", "sequence.json"]) {
      const { diagram } = validateDiagram(JSON.parse(readFileSync(`examples/${file}`, "utf8")));
      const scene = await layoutDiagram(diagram!);
      expect(scene.nodes.length).toBeGreaterThan(0);
      expect(
        scene.nodes.every((n) => !("parent" in n)),
        file,
      ).toBe(true);
    }
  });
});
