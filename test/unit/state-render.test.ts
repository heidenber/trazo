// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkGeometry } from "../../src/check/geometry.js";
import { make } from "../../src/index.js";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderSvg } from "../../src/render/svg.js";
import type { Box, Point, Scene, SceneNode } from "../../src/scene.js";

const example = JSON.parse(readFileSync("examples/state.json", "utf8")) as Record<string, unknown>;

async function sceneOf(input: unknown): Promise<Scene> {
  const { diagram, issues } = validateDiagram(input);
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return layoutDiagram(diagram!);
}

const node = (scene: Scene, id: string): SceneNode => scene.nodes.find((n) => n.id === id)!;
const cy = (n: SceneNode) => n.y + n.h / 2;
const cx = (n: SceneNode) => n.x + n.w / 2;
const edgeOf = (scene: Scene, from: string, to: string) =>
  scene.edges.find((e) => e.from === from && e.to === to)!;

/** Distance from a point to the outline of a state, measured independently of the layout. */
function borderDistance(n: SceneNode, p: Point): number {
  const x = Math.abs(p.x - cx(n));
  const y = Math.abs(p.y - cy(n));
  if (n.shape !== "state") return Math.abs(Math.hypot(x, y) - n.w / 2);
  const hw = n.w / 2;
  const hh = n.h / 2;
  return x <= hw && y <= hh
    ? Math.min(hw - x, hh - y)
    : Math.hypot(Math.max(0, x - hw), Math.max(0, y - hh));
}

const touches = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

function hitsSegment(box: Box, a: Point, b: Point): boolean {
  const g = 1;
  const x0 = box.x - g;
  const x1 = box.x + box.w + g;
  const y0 = box.y - g;
  const y1 = box.y + box.h + g;
  // Routes are orthogonal; a general clip is not needed.
  if (Math.abs(a.y - b.y) < 1e-6)
    return a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  if (Math.abs(a.x - b.x) < 1e-6)
    return a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
  throw new Error(`diagonal segment ${JSON.stringify([a, b])}`);
}

/** Everything the layout promises about any state scene. */
function expectClean(scene: Scene, name: string): void {
  expect(checkGeometry(scene), name).toEqual([]);
  for (const e of scene.edges) {
    const from = node(scene, e.from);
    const to = node(scene, e.to);
    expect(borderDistance(from, e.points[0]!), `${name} ${e.id} start`).toBeLessThan(0.6);
    expect(borderDistance(to, e.points.at(-1)!), `${name} ${e.id} end`).toBeLessThan(0.6);
  }
  const labels = scene.edges.flatMap((e) => (e.label ? [{ e, box: e.label.box }] : []));
  for (const { e, box } of labels) {
    for (const n of scene.nodes)
      expect(touches(box, n), `${name} label ${e.id} on ${n.id}`).toBe(false);
    for (const other of scene.edges)
      other.points
        .slice(1)
        .forEach((p, i) =>
          expect(
            hitsSegment(box, other.points[i]!, p),
            `${name} label ${e.id} on the line of ${other.id}`,
          ).toBe(false),
        );
  }
  labels.forEach((a, i) =>
    labels
      .slice(i + 1)
      .forEach((b) =>
        expect(touches(a.box, b.box), `${name} labels ${a.e.id} and ${b.e.id}`).toBe(false),
      ),
  );
}

describe("make", () => {
  it("draws examples/state.json with no issues and no geometry warnings", async () => {
    const result = await make(JSON.stringify(example));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.html).toContain('class="diagram t-state"');
  });

  it("is byte-identical twice", async () => {
    const a = await make(JSON.stringify(example));
    const b = await make(JSON.stringify(example));
    expect(a.html).toBe(b.html);
  });

  it.each(["light", "dark", "lagoon", "dusk"] as const)(
    "renders in the %s theme",
    async (theme) => {
      const result = await make(JSON.stringify(example), { theme });
      expect(result.ok).toBe(true);
      expect(result.html).toContain(`data-theme="${theme}"`);
    },
  );

  it("still rejects an invalid state diagram before drawing", async () => {
    const result = await make(JSON.stringify({ ...example, states: [{ id: "a" }] }));
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain("state/initial-count");
  });
});

describe("rail layout", () => {
  it("puts the happy path in one row, left to right", async () => {
    const scene = await sceneOf(example);
    const row = ["start", "draft", "submitted", "approved", "paid", "shipped", "delivered", "end"];
    const nodes = row.map((id) => node(scene, id));
    for (const n of nodes) expect(cy(n)).toBeCloseTo(cy(nodes[0]!), 6);
    for (let i = 1; i < nodes.length; i++) expect(cx(nodes[i]!)).toBeGreaterThan(cx(nodes[i - 1]!));
    for (let i = 1; i < row.length; i++) {
      const e = edgeOf(scene, row[i - 1]!, row[i]!);
      expect(e.points).toHaveLength(2);
      expect(e.points[0]!.y).toBeCloseTo(e.points[1]!.y, 6);
      expect(e.weight).toBe("main");
    }
  });

  it("puts rework above and cancel below, each under its own column", async () => {
    const scene = await sceneOf(example);
    const row = cy(node(scene, "draft"));
    expect(cy(node(scene, "rejected"))).toBeLessThan(row - 40);
    expect(cy(node(scene, "cancelled"))).toBeGreaterThan(row + 40);
    expect(cx(node(scene, "rejected"))).toBeCloseTo(cx(node(scene, "submitted")), 6);
    expect(cx(node(scene, "cancelled"))).toBeCloseTo(cx(node(scene, "submitted")), 6);
  });

  it("draws exceptional transitions dashed and the exception states in the end family", async () => {
    const scene = await sceneOf(example);
    for (const [from, to] of [
      ["submitted", "rejected"],
      ["rejected", "draft"],
      ["draft", "cancelled"],
      ["cancelled", "end"],
    ] as const)
      expect(edgeOf(scene, from, to).weight, `${from} -> ${to}`).toBe("exception");
    expect(edgeOf(scene, "draft", "submitted").weight).toBe("main");
    const svg = renderSvg(scene);
    expect(svg).toContain("t-st-exc");
    expect(svg).toMatch(/data-id="rejected"/);
    expect(svg).toMatch(/class="t-node t-fam-end t-shape-state t-tint" data-id="rejected"/);
  });

  it("draws a self-transition as a loop over the state, with its event above the loop", async () => {
    const scene = await sceneOf(example);
    const draft = node(scene, "draft");
    const loop = edgeOf(scene, "draft", "draft");
    expect(loop.points).toHaveLength(4);
    expect(loop.points[0]!.y).toBeCloseTo(draft.y, 6);
    expect(loop.points[3]!.y).toBeCloseTo(draft.y, 6);
    expect(Math.min(...loop.points.map((p) => p.y))).toBeLessThan(draft.y - 20);
    expect(loop.label!.box.y + loop.label!.box.h).toBeLessThanOrEqual(
      Math.min(...loop.points.map((p) => p.y)),
    );
  });

  it("writes every event above its horizontal line", async () => {
    const scene = await sceneOf(example);
    for (const e of scene.edges) {
      if (e.points.length !== 2 || e.points[0]!.y !== e.points[1]!.y) continue;
      const { box, text } = e.label!;
      expect(box.y + box.h, e.id).toBeLessThan(e.points[0]!.y);
      expect(text.lines).toEqual([e.label!.text.lines[0]]);
    }
    expect(edgeOf(scene, "draft", "submitted").label!.text.lines).toEqual(["submit"]);
  });

  it("ends every line on the border of its states", async () => {
    expectClean(await sceneOf(example), "example");
  });

  it("keeps no label on a node, a line or another label, with and without the example", async () => {
    const chain = {
      type: "state",
      title: "Skips and loops",
      states: [
        { id: "s", kind: "initial" },
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
        { id: "c", label: "Gamma" },
        { id: "d", label: "Delta" },
        { id: "f", kind: "final" },
        { id: "err", label: "Error", kind: "exception" },
      ],
      transitions: [
        "s -> a: begin",
        "a -> b: next",
        "b -> c: next",
        "c -> d: next",
        "d -> f: finish",
        "a -> a: tick",
        "a -> a: retry",
        "a -> d: shortcut",
        "d -> b: rework the thing",
        "c -> err: fail",
        "err -> a: recover",
        "b -> err: crash",
      ],
    };
    expectClean(await sceneOf(chain), "chain");
    const small = {
      type: "state",
      title: "Two",
      states: [
        { id: "s", kind: "initial" },
        { id: "f", kind: "final" },
      ],
      transitions: ["s -> f"],
    };
    expectClean(await sceneOf(small), "small");
  });
});

describe("legend", () => {
  it("lists in English only the elements the diagram uses, below it", async () => {
    const scene = await sceneOf(example);
    const labels = scene.legend!.map((i) => i.label.lines[0]);
    expect(labels).toEqual([
      "Initial state",
      "Final state",
      "State",
      "Exceptional state (dashed)",
      "Transition, event above the line",
      "Exceptional transition (dashed)",
      "Self-transition",
    ]);
    const bottom = Math.max(...scene.nodes.map((n) => n.y + n.h));
    const lines = scene.edges.flatMap((e) => e.points.map((p) => p.y));
    for (const item of scene.legend!) {
      expect(item.swatch.y).toBeGreaterThan(Math.max(bottom, ...lines));
      expect(item.swatch.y + item.swatch.h).toBeLessThanOrEqual(scene.height);
    }
    const svg = renderSvg(scene);
    expect(svg).toContain('class="t-legend"');
    expect(svg).toContain("Exceptional state (dashed)");
  });

  it("omits exceptional and self-transition entries when none is used", async () => {
    const scene = await sceneOf({
      type: "state",
      title: "Plain",
      states: [{ id: "s", kind: "initial" }, { id: "a" }, { id: "f", kind: "final" }],
      transitions: ["s -> a: go", "a -> f: stop"],
    });
    expect(scene.legend!.map((i) => i.label.lines[0])).toEqual([
      "Initial state",
      "Final state",
      "State",
      "Transition, event above the line",
    ]);
  });
});

describe("viewer", () => {
  it("has no Flow toggle and no animation layer", async () => {
    const html = (await make(JSON.stringify(example))).html!;
    expect(html).not.toContain('id="flow"');
    expect(html).not.toContain("<animateMotion");
  });

  it("gives each state a plain-language reading in the detail card", async () => {
    const scene = await sceneOf(example);
    expect(node(scene, "submitted").detail).toBe(
      "Reached from Draft on submit.\nMoves to Approved on approve, Rejected on reject, Cancelled on cancel.",
    );
    expect(node(scene, "draft").detail).toContain("Stays here on edit.");
    expect(node(scene, "start").detail).toBe("Start of the diagram. Moves to Draft on create.");
    const html = (await make(JSON.stringify(example))).html!;
    expect(html).toContain("Reached from Draft on submit.");
  });

  it("keeps the author's detail before the reading", async () => {
    const scene = await sceneOf({
      ...example,
      states: (example.states as { id: string }[]).map((s) =>
        s.id === "paid" ? { ...s, detail: "Money received." } : s,
      ),
    });
    expect(node(scene, "paid").detail!.startsWith("Money received.\n")).toBe(true);
  });

  it("marks edges and labels so the card can list events", async () => {
    const svg = renderSvg(await sceneOf(example));
    expect(svg).toMatch(
      /<path class="t-edge t-edge-sync t-st-main"[^>]*data-from="draft" data-to="submitted"/,
    );
    expect(svg).toMatch(/<g class="t-edge-label" data-edge="[^"]+"><text[^>]*>[^]*?submit/);
  });
});
