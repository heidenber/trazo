// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { renderSvg } from "../../src/render/svg.js";
import { SEQUENCE_CSS } from "../../src/render/theme.js";
import type { Scene, SceneEdge, SceneNode, TextBlock } from "../../src/scene.js";

const block = (
  text: string,
  x: number,
  y: number,
  size = 13,
  weight: 400 | 600 = 400,
): TextBlock => ({
  lines: [text],
  x,
  y,
  size,
  weight,
  anchor: "start",
});

const head = (id: string, x: number): SceneNode => ({
  id,
  kind: "service",
  icon: "server",
  shape: "box",
  x,
  y: 24,
  w: 120,
  h: 40,
  label: block(id, x + 44, 49, 13, 600),
});

const msg = (id: string, style: SceneEdge["style"], y: number): SceneEdge => ({
  id,
  from: "a",
  to: "b",
  points: [
    { x: 84, y },
    { x: 304, y },
  ],
  style,
});

function scene(edges: SceneEdge[], extra: Partial<Scene> = {}): Scene {
  return {
    type: "sequence",
    title: "Seq",
    theme: "light",
    width: 400,
    height: 300,
    groups: [],
    nodes: [head("a", 24), head("b", 244)],
    edges,
    lifelines: [
      { id: "a", x: 84, y1: 64, y2: 260 },
      { id: "b", x: 304, y1: 64, y2: 260 },
    ],
    ...extra,
  };
}

const fragment = (): Scene["groups"][number] => ({
  id: "#f0",
  label: block("alt", 48, 103, 11),
  depth: 0,
  variant: "fragment",
  x: 40,
  y: 90,
  w: 300,
  h: 120,
  tab: { x: 40, y: 90, w: 40, h: 18 },
  guard: block("paid", 88, 103, 11),
  dividers: [{ y: 150, guard: block("declined", 48, 166, 11) }],
});

describe("sequence render", () => {
  it("draws lifelines before nodes and edges", () => {
    const svg = renderSvg(scene([msg("#m0", "sync", 100)]));
    expect(svg).toContain('class="diagram t-seq"');
    expect(svg).toContain(
      '<line class="t-lifeline" data-id="a" x1="84" y1="64" x2="84" y2="260"/>',
    );
    const life = svg.indexOf("t-lifeline");
    expect(life).toBeGreaterThan(-1);
    expect(life).toBeLessThan(svg.indexOf('class="t-edge'));
    expect(life).toBeLessThan(svg.indexOf('class="t-node"'));
    expect(svg).toContain(SEQUENCE_CSS);
  });

  it("renders a fragment with tab, tag, guard and dashed dividers", () => {
    const svg = renderSvg(scene([msg("#m0", "sync", 100)], { groups: [fragment()] }));
    expect(svg).toContain('class="t-fragment" data-id="#f0"');
    expect(svg).toContain('class="t-frag"');
    expect(svg).toContain('class="t-frag-tab"');
    expect(svg).toMatch(/t-frag-tag[^>]*>.*alt/);
    expect(svg).toContain("[paid]");
    expect(svg).toContain("[declined]");
    expect(svg).toContain('<line class="t-frag-divider" x1="40" y1="150" x2="340" y2="150"/>');
    expect(svg).not.toContain('class="t-group"');
    expect(svg.indexOf("t-lifeline")).toBeLessThan(svg.indexOf("t-fragment"));
    expect(svg.indexOf("t-fragment")).toBeLessThan(svg.indexOf('class="t-edge'));
  });

  it("renders a note with a folded corner", () => {
    const note: SceneNode = {
      id: "#n0",
      kind: "note",
      shape: "note",
      x: 60,
      y: 120,
      w: 180,
      h: 30,
      label: { ...block("remember", 68, 140, 12), lines: ["remember"] },
    };
    const svg = renderSvg(scene([], { nodes: [head("a", 24), note] }));
    expect(svg).toContain("t-shape-note");
    expect(svg).toContain(
      '<polygon class="t-node-box t-note" points="60,120 230,120 240,130 240,150 60,150"/>',
    );
    expect(svg).toContain('<path class="t-note-fold" d="M230 120V130H240"/>');
  });

  it("draws reply dashed with an open arrowhead", () => {
    const svg = renderSvg(scene([msg("#m0", "reply", 100)]));
    expect(svg).toContain('class="t-edge t-edge-reply"');
    expect(svg).toContain('marker-end="url(#t-arrowhead-open)"');
    expect(svg).toContain('<marker id="t-arrowhead-open"');
    expect(svg).toContain(".t-edge-reply { stroke-dasharray: 5 4; }");
    expect(svg).not.toContain('id="t-arrowhead"');
  });

  it("draws async with an open arrowhead and a solid line", () => {
    const svg = renderSvg(scene([msg("#m0", "async", 100), msg("#m1", "sync", 120)]));
    expect(svg).toContain(
      'class="t-edge t-edge-async" data-from="a" data-to="b" d="M84 100 L304 100" marker-end="url(#t-arrowhead-open)"',
    );
    expect(svg).toContain(".t-seq .t-edge-async { stroke-dasharray: none; }");
    expect(svg).toContain('d="M84 120 L304 120" marker-end="url(#t-arrowhead)"');
    expect(svg).toContain('<marker id="t-arrowhead"');
  });

  it("emits no sequence markup for scenes without lifelines", () => {
    const plain: Scene = {
      type: "architecture",
      title: "Arch",
      theme: "light",
      width: 300,
      height: 100,
      groups: [],
      nodes: [head("a", 24), head("b", 160)],
      edges: [
        {
          ...msg("e1", "async", 50),
          points: [
            { x: 144, y: 50 },
            { x: 160, y: 50 },
          ],
        },
      ],
    };
    const svg = renderSvg(plain);
    expect(svg).toContain('class="diagram"');
    expect(svg).not.toContain("t-seq");
    expect(svg).not.toContain("t-lifeline");
    expect(svg).not.toContain("t-arrowhead-open");
    expect(svg).not.toContain(SEQUENCE_CSS);
    expect(svg).toContain('marker-end="url(#t-arrowhead)"');
    expect(svg).toContain(".t-edge-async { stroke-dasharray: 7 5; }");
  });
});
