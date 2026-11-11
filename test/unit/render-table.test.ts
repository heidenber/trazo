// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { renderSvg } from "../../src/render/svg.js";
import type { EdgeEnd, Scene, SceneEdge, SceneNode, SceneRow, TextBlock } from "../../src/scene.js";

const block = (text: string, x: number, y: number, size = 13, weight: 400 | 600 = 400, anchor: "start" | "middle" = "start"): TextBlock => ({
  lines: [text],
  x,
  y,
  size,
  weight,
  anchor,
});

const row = (i: number, name: string, type: string, marks?: string, note?: string): SceneRow => ({
  y: 52 + i * 24,
  h: 24,
  name: block(name, 12, 52 + i * 24 + 16),
  type: block(type, 90, 52 + i * 24 + 16, 12),
  ...(marks === undefined ? {} : { marks: block(marks, 168, 52 + i * 24 + 16, 11, 600, "start") }),
  ...(note === undefined ? {} : { note }),
  key: marks !== undefined,
});

const table = (id: string, x: number, note?: string, source?: string): SceneNode => ({
  id,
  kind: "table",
  shape: "table",
  x,
  y: 20,
  w: 180,
  h: 32 + 48,
  header: 32,
  label: block(id, x + 12, 40, 14, 600),
  ...(note === undefined ? {} : { note }),
  ...(source === undefined ? {} : { source }),
  rows: [row(0, "id", "uuid", "PK"), row(1, "email", "text?", undefined, "Login address")],
});

const edge = (ends?: { from: EdgeEnd; to: EdgeEnd }): SceneEdge => ({
  id: "e1",
  from: "users",
  to: "orders",
  points: [
    { x: 200, y: 70 },
    { x: 300, y: 70 },
  ],
  style: "sync",
  ...(ends === undefined ? {} : { ends }),
});

const scene = (edges: SceneEdge[], nodes: SceneNode[] = [table("users", 20), table("orders", 300, "Customer orders")]): Scene => ({
  type: "erd",
  title: "Shop",
  theme: "light",
  width: 600,
  height: 200,
  groups: [],
  nodes,
  edges,
});

describe("table render", () => {
  it("draws header, rows, types and right-hand marks", () => {
    const svg = renderSvg(scene([]));
    expect(svg).toContain('class="t-node t-shape-table"');
    expect(svg).toContain('class="t-table"');
    expect(svg).toContain('class="t-table-head"');
    expect(svg).toContain("t-node-label");
    expect(svg.match(/class="t-row"/g)).toHaveLength(4);
    expect(svg).toContain('class="t-text t-col-type"');
    expect(svg).toContain('class="t-text t-col-marks"');
    expect(svg).toContain(">PK</tspan>");
  });

  it("prints the type text as given, including the nullable mark", () => {
    expect(renderSvg(scene([]))).toContain(">text?</tspan>");
  });

  it("puts row and table notes in desc elements", () => {
    const svg = renderSvg(scene([]));
    expect(svg).toContain("<desc>Login address</desc>");
    expect(svg).toContain("<desc>Customer orders</desc>");
    expect(svg.match(/<title/g)).toHaveLength(1);
  });

  it("puts the table note and source together in the table tooltip", () => {
    const svg = renderSvg(scene([], [table("orders", 20, "Customer orders", "src/models/order.ts:8")]));
    const tip = /<desc>([^<]*)<\/desc>/.exec(svg.slice(svg.indexOf('data-id="orders"')))![1]!;
    expect(tip).toBe("Customer orders\nsrc/models/order.ts:8");
  });

  it("shows a table source even without a note", () => {
    const svg = renderSvg(scene([], [table("orders", 20, undefined, "src/models/order.ts:8")]));
    expect(svg).toContain("<desc>src/models/order.ts:8</desc>");
  });

  it("uses the end marker that matches each side of the edge", () => {
    const svg = renderSvg(scene([edge({ from: "one", to: "zero-or-many" })]));
    expect(svg).toContain('marker-start="url(#t-end-one)"');
    expect(svg).toContain('marker-end="url(#t-end-zero-or-many)"');
    for (const id of ["one", "zero-or-one", "many", "zero-or-many"]) {
      expect(svg).toContain(`<marker id="t-end-${id}"`);
    }
    expect(svg).toContain('orient="auto-start-reverse"');
  });

  it("does not reference the arrowhead on edges with ends", () => {
    const svg = renderSvg(scene([edge({ from: "many", to: "zero-or-one" })]));
    expect(svg).not.toContain("t-arrowhead");
    expect(svg).toContain('class="t-edge-halo"');
    expect(svg).toMatch(/<path class="t-edge-halo" d="[^"]*" data-edge="e1"\/>/);
    expect(svg).toMatch(/<path class="t-edge [^>]*data-edge="e1"/);
  });

  it("keeps non-erd output free of table and marker rules", () => {
    const plain: SceneNode = { id: "a", kind: "service", shape: "box", x: 0, y: 0, w: 100, h: 40, label: block("A", 50, 24, 13, 600, "middle") };
    const svg = renderSvg(scene([{ ...edge(), points: edge().points }], [plain]));
    expect(svg).toContain('marker-end="url(#t-arrowhead)"');
    for (const s of ["t-table", "t-row", "t-col-", "t-end-", "t-edge-halo"]) expect(svg).not.toContain(s);
  });
});
