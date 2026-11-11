// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { renderSvg } from "../../src/render/svg.js";
import { ICONS } from "../../src/render/generated/icons.js";
import type { NodeShape, Scene, SceneGroup, SceneNode } from "../../src/scene.js";

const label = (x: number, y: number, anchor: "start" | "middle" = "middle") => ({
  lines: ["Step"],
  x,
  y,
  size: 13,
  weight: 600 as const,
  anchor,
});

const node = (id: string, shape: NodeShape, extra: Partial<SceneNode> = {}): SceneNode => ({
  id,
  kind: shape,
  shape,
  x: 10,
  y: 20,
  w: 120,
  h: 40,
  label: label(70, 44),
  ...extra,
});

const lane = (id: string, y: number): SceneGroup => ({
  id,
  x: 0,
  y,
  w: 400,
  h: 100,
  depth: 0,
  variant: "lane",
  header: 40,
  label: label(20, y + 50, "start"),
});

const scene = (nodes: SceneNode[], groups: SceneGroup[] = []): Scene => ({
  type: "workflow",
  title: "Flow",
  theme: "light",
  width: 400,
  height: 300,
  groups,
  nodes,
  edges: [],
});

const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const shapes: NodeShape[] = ["pill", "end", "diamond", "subprocess"];

describe("node shapes", () => {
  it("emits exactly one t-shape group per non-box shape", () => {
    const svg = renderSvg(scene(shapes.map((s) => node(s, s))));
    for (const s of shapes)
      expect(count(svg, new RegExp(`class="t-node t-shape-${s}"`, "g"))).toBe(1);
  });

  it("keeps the plain t-node group for box", () => {
    const svg = renderSvg(scene([node("b", "box")]));
    expect(count(svg, /class="t-node"/g)).toBe(1);
    expect(svg).toContain(
      '<rect class="t-node-box" x="10" y="20" width="120" height="40" rx="8"/>',
    );
  });

  it("draws the diamond through the edge midpoints", () => {
    const svg = renderSvg(scene([node("d", "diamond")]));
    expect(svg).toContain('<polygon class="t-node-box" points="70,20 130,40 70,60 10,40"/>');
  });

  it("rounds pills with rx = h/2", () => {
    const svg = renderSvg(scene([node("p", "pill")]));
    expect(svg).toContain('width="120" height="40" rx="20"/>');
  });

  it("draws end as two outlines", () => {
    const svg = renderSvg(scene([node("e", "end")]));
    expect(svg).toContain('x="10" y="20" width="120" height="40" rx="20"/>');
    expect(svg).toContain(
      'class="t-node-box t-node-inner" x="13" y="23" width="114" height="34" rx="17"/>',
    );
  });

  it("draws subprocess with two inner vertical lines", () => {
    const svg = renderSvg(scene([node("s", "subprocess")]));
    expect(count(svg, /class="t-node-rule"/g)).toBe(2);
    expect(svg).toContain('x1="18" y1="20" x2="18" y2="60"');
    expect(svg).toContain('x1="122" y1="20" x2="122" y2="60"');
  });

  it("supports centred and start anchored node text", () => {
    const svg = renderSvg(
      scene([node("p", "pill"), node("b", "box", { label: label(20, 44, "start") })]),
    );
    expect(count(svg, /text-anchor="middle"/g)).toBe(1);
  });

  it("emits no icon for a node without one", () => {
    expect(renderSvg(scene([node("p", "pill")]))).not.toContain('<svg class="t-icon');
  });

  it("includes clock markup only when a node uses it", () => {
    const clock = ICONS["clock"]!;
    expect(renderSvg(scene([node("p", "pill")]))).not.toContain(clock);
    const svg = renderSvg(scene([node("w", "box", { icon: "clock", kind: "wait" })]));
    expect(svg).toContain(clock);
    expect(svg).toContain("t-icon-wait");
  });
});

describe("lanes", () => {
  const svg = renderSvg(scene([node("p", "pill")], [lane("a", 0), lane("b", 100), lane("c", 200)]));

  it("draws one t-lane per lane group and marks every second one odd", () => {
    expect(count(svg, /class="t-lane(?: t-lane-odd)?"/g)).toBe(3);
    expect(count(svg, /t-lane-odd"/g)).toBe(1);
    expect(svg).toMatch(/class="t-lane t-lane-odd" data-id="b"/);
  });

  it("renders lanes before the first node and without group chrome", () => {
    expect(svg.lastIndexOf('t-lane"')).toBeLessThan(svg.indexOf('class="t-node'));
    expect(svg).not.toContain('class="t-group-box"');
  });

  it("puts the label, a bottom border and a header in each lane", () => {
    expect(count(svg, /class="t-text t-lane-title"/g)).toBe(3);
    expect(svg).toContain('class="t-lane-rule" x1="0" y1="100" x2="400" y2="100"');
    expect(count(svg, /class="t-lane-header"/g)).toBe(3);
  });

  it("keeps group variant rendering", () => {
    const g: SceneGroup = { ...lane("g", 0), variant: "group" };
    const out = renderSvg(scene([], [g]));
    expect(out).toContain('class="t-group"');
    expect(out).not.toContain('class="t-lane');
  });
});
