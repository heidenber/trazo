// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { layoutArchitecture } from "../../src/layout/architecture.js";
import { validateDiagram } from "../../src/model/index.js";
import type { Architecture } from "../../src/model/architecture.js";
import type { Box, Point, Scene } from "../../src/scene.js";

function diagram(raw: object): Architecture {
  const { diagram, issues } = validateDiagram({ type: "architecture", title: "T", ...raw });
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  if (diagram?.type !== "architecture") throw new Error("expected an architecture diagram");
  return diagram;
}

const sample = diagram({
  nodes: [
    { id: "web", label: "Web App", kind: "client" },
    {
      id: "api",
      label: "Orders API",
      kind: "service",
      note: "Handles checkout",
      source: "src/api.ts:12",
    },
    { id: "db", label: "PostgreSQL", kind: "database" },
    { id: "queue", label: "Events", kind: "queue" },
  ],
  groups: [{ id: "vpc", label: "Production VPC", children: ["api", "db", "queue"] }],
  edges: ["web -> api: HTTPS", "api -> db: SQL", "api ~> queue: order.created"],
});

const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const onBorder = (p: Point, b: Box) => {
  const withinX = p.x >= b.x - 1 && p.x <= b.x + b.w + 1;
  const withinY = p.y >= b.y - 1 && p.y <= b.y + b.h + 1;
  const nearVertical = Math.abs(p.x - b.x) <= 1 || Math.abs(p.x - (b.x + b.w)) <= 1;
  const nearHorizontal = Math.abs(p.y - b.y) <= 1 || Math.abs(p.y - (b.y + b.h)) <= 1;
  return withinX && withinY && (nearVertical || nearHorizontal);
};

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function boxOf(scene: Scene, id: string): Box {
  const found = scene.nodes.find((n) => n.id === id) ?? scene.groups.find((g) => g.id === id);
  expect(found, id).toBeDefined();
  return found!;
}

describe("layoutArchitecture", () => {
  it("places every node inside the canvas without overlaps", async () => {
    const scene = await layoutArchitecture(sample);
    const canvas = { x: 0, y: 0, w: scene.width, h: scene.height };
    expect(scene.nodes).toHaveLength(4);
    for (const node of scene.nodes) expect(inside(node, canvas), node.id).toBe(true);
    for (const a of scene.nodes)
      for (const b of scene.nodes)
        if (a !== b) expect(overlaps(a, b), `${a.id}/${b.id}`).toBe(false);
  });

  it("keeps group members inside their group, below its title", async () => {
    const scene = await layoutArchitecture(sample);
    const vpc = scene.groups.find((g) => g.id === "vpc")!;
    expect(vpc.label.lines).toEqual(["Production VPC"]);
    for (const id of ["api", "db", "queue"]) {
      const node = boxOf(scene, id);
      expect(inside(node, vpc), id).toBe(true);
      expect(node.y).toBeGreaterThan(vpc.label.y);
    }
    expect(inside(boxOf(scene, "web"), vpc)).toBe(false);
  });

  it("starts and ends every edge on the border of its endpoints", async () => {
    const scene = await layoutArchitecture(sample);
    expect(scene.edges).toHaveLength(3);
    for (const edge of scene.edges) {
      expect(edge.points.length).toBeGreaterThanOrEqual(2);
      expect(onBorder(edge.points[0]!, boxOf(scene, edge.from)), `${edge.id} start`).toBe(true);
      expect(onBorder(edge.points.at(-1)!, boxOf(scene, edge.to)), `${edge.id} end`).toBe(true);
    }
  });

  it("routes edges that touch a group", async () => {
    const scene = await layoutArchitecture(
      diagram({
        nodes: [{ id: "web" }, { id: "api" }],
        groups: [{ id: "vpc", children: ["api"] }],
        edges: ["web -> vpc"],
      }),
    );
    const edge = scene.edges[0]!;
    expect(onBorder(edge.points.at(-1)!, boxOf(scene, "vpc"))).toBe(true);
  });

  it("carries edge style and a label box that fits its text", async () => {
    const scene = await layoutArchitecture(sample);
    const async = scene.edges.find((e) => e.to === "queue")!;
    expect(async.style).toBe("async");
    expect(async.label?.text.lines).toEqual(["order.created"]);
    const canvas = { x: 0, y: 0, w: scene.width, h: scene.height };
    expect(inside(async.label!.box, canvas)).toBe(true);
  });

  it("places each edge label next to its own edge", async () => {
    const scene = await layoutArchitecture(sample);
    for (const edge of scene.edges.filter((e) => e.label)) {
      const { box } = edge.label!;
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const distance = Math.min(
        ...edge.points
          .slice(1)
          .map((b, i) => distanceToSegment({ x: cx, y: cy }, edge.points[i]!, b)),
      );
      expect(distance, edge.id).toBeLessThanOrEqual(box.h);
    }
  });

  it("maps kinds to icons and keeps note and source as tooltip data", async () => {
    const scene = await layoutArchitecture(sample);
    const api = scene.nodes.find((n) => n.id === "api")!;
    expect(api.icon).toBe("server");
    expect(api.note).toBe("Handles checkout");
    expect(api.source).toBe("src/api.ts:12");
    expect(scene.nodes.find((n) => n.id === "db")!.icon).toBe("database");
  });

  it("flows left to right by default and top to bottom when asked", async () => {
    const chain = { nodes: [{ id: "a" }, { id: "b" }, { id: "c" }], edges: ["a -> b", "b -> c"] };
    const right = await layoutArchitecture(diagram(chain));
    const xs = ["a", "b", "c"].map((id) => boxOf(right, id).x);
    expect(xs[0]).toBeLessThan(xs[1]!);
    expect(xs[1]).toBeLessThan(xs[2]!);

    const down = await layoutArchitecture(diagram({ ...chain, direction: "down" }));
    const ys = ["a", "b", "c"].map((id) => boxOf(down, id).y);
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
  });

  it("grows a node to fit a long label instead of overflowing", async () => {
    const scene = await layoutArchitecture(
      diagram({
        nodes: [
          { id: "a", label: "Payment authorization and fraud screening service" },
          { id: "b" },
        ],
      }),
    );
    const a = boxOf(scene, "a");
    const node = scene.nodes.find((n) => n.id === "a")!;
    expect(node.label.lines.length).toBeGreaterThan(1);
    expect(a.h).toBeGreaterThan(boxOf(scene, "b").h);
  });

  it("produces the same scene for the same input", async () => {
    const first = await layoutArchitecture(sample);
    const second = await layoutArchitecture(sample);
    expect(second).toEqual(first);
  });

  it("rounds coordinates to half pixels", async () => {
    const scene = await layoutArchitecture(sample);
    const values = [
      ...scene.nodes.flatMap((n) => [n.x, n.y, n.w, n.h]),
      ...scene.edges.flatMap((e) => e.points.flatMap((p) => [p.x, p.y])),
    ];
    for (const v of values) expect(Number.isInteger(v * 2), String(v)).toBe(true);
  });
});

describe("layoutArchitecture parent", () => {
  it("sets the direct group and leaves ungrouped nodes without one", async () => {
    const nested = diagram({
      nodes: [{ id: "web" }, { id: "api" }, { id: "db" }],
      groups: [
        { id: "outer", label: "Outer", children: ["inner", "db"] },
        { id: "inner", label: "Inner", children: ["api"] },
      ],
      edges: ["web -> api", "api -> db"],
    });
    const scene = await layoutArchitecture(nested);
    const parent = (id: string) => scene.nodes.find((n) => n.id === id)!.parent;
    expect(parent("api")).toBe("inner");
    expect(parent("db")).toBe("outer");
    expect(parent("web")).toBeUndefined();
    expect("parent" in scene.nodes.find((n) => n.id === "web")!).toBe(false);
  });
});
