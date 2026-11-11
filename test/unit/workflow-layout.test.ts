// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { assertStepsInLanes } from "../../src/layout/lanes.js";
import { layoutWorkflow } from "../../src/layout/workflow.js";
import { validateDiagram } from "../../src/model/index.js";
import type { Workflow } from "../../src/model/workflow.js";
import type { Box, Point, Scene, SceneNode } from "../../src/scene.js";
import { textWidth } from "../../src/text/measure.js";

function workflow(raw: object): Workflow {
  const { diagram, issues } = validateDiagram({ type: "workflow", title: "T", ...raw });
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  if (diagram?.type !== "workflow") throw new Error("expected a workflow");
  return diagram;
}

const plain = () =>
  workflow({
    steps: [
      { id: "s", kind: "start" },
      { id: "a", label: "Validate the incoming order" },
      { id: "d", label: "In stock?", kind: "decision" },
      { id: "w", label: "Wait for supplier", kind: "wait" },
      { id: "p", label: "Ship order", kind: "subprocess" },
      { id: "e", kind: "end" },
    ],
    edges: ["s -> a", "a -> d", "d -> p: yes", "d -> w: no", "w -> a: retry", "p -> e"],
  });

const refund = () =>
  workflow({
    lanes: [
      { id: "customer", label: "Customer", steps: ["start", "request", "end"] },
      { id: "support", label: "Support", steps: ["review", "reject", "notify"] },
      { id: "finance", label: "Finance operations", steps: ["approve", "ledger"] },
    ],
    steps: [
      { id: "start", kind: "start" },
      { id: "request", label: "Request refund" },
      { id: "review", label: "Within 30 days?", kind: "decision" },
      { id: "approve", label: "Issue refund" },
      { id: "reject", label: "Send rejection" },
      { id: "ledger", label: "Post to ledger" },
      { id: "notify", label: "Notify customer" },
      { id: "end", kind: "end" },
    ],
    edges: [
      "start -> request",
      "request -> review",
      "review -> approve: yes",
      "review -> reject: no",
      "approve -> ledger",
      "ledger -> notify",
      "reject -> notify",
      "notify -> end",
    ],
  });

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Box, outer: Box) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.w <= outer.x + outer.w &&
  inner.y + inner.h <= outer.y + outer.h;

/** Distance from p to the border of the node's shape, 0 when it lies on it. */
function borderDistance(p: Point, n: SceneNode): number {
  if (n.shape === "diamond") {
    const a = n.w / 2;
    const b = n.h / 2;
    const f = Math.abs(p.x - (n.x + a)) / a + Math.abs(p.y - (n.y + b)) / b;
    return Math.abs(f - 1) * Math.min(a, b);
  }
  const dx = Math.min(Math.abs(p.x - n.x), Math.abs(p.x - (n.x + n.w)));
  const dy = Math.min(Math.abs(p.y - n.y), Math.abs(p.y - (n.y + n.h)));
  const withinX = p.x >= n.x - 1 && p.x <= n.x + n.w + 1;
  const withinY = p.y >= n.y - 1 && p.y <= n.y + n.h + 1;
  return withinX && withinY ? Math.min(dx, dy) : Infinity;
}

const node = (scene: Scene, id: string) => scene.nodes.find((n) => n.id === id)!;
const canvas = (s: Scene): Box => ({ x: 0, y: 0, w: s.width, h: s.height });

function expectSound(scene: Scene) {
  for (const n of scene.nodes) expect(inside(n, canvas(scene)), n.id).toBe(true);
  for (let i = 0; i < scene.nodes.length; i++) {
    for (let j = i + 1; j < scene.nodes.length; j++) {
      expect(
        overlaps(scene.nodes[i]!, scene.nodes[j]!),
        `${scene.nodes[i]!.id}/${scene.nodes[j]!.id}`,
      ).toBe(false);
    }
  }
  for (const e of scene.edges) {
    expect(e.points.length, e.id).toBeGreaterThanOrEqual(2);
    expect(borderDistance(e.points[0]!, node(scene, e.from)), `${e.id} start`).toBeLessThanOrEqual(
      1,
    );
    expect(borderDistance(e.points.at(-1)!, node(scene, e.to)), `${e.id} end`).toBeLessThanOrEqual(
      1,
    );
  }
}

describe("layoutWorkflow without lanes", () => {
  it("has no overlaps, keeps nodes on the canvas and edges on borders", async () => {
    expectSound(await layoutWorkflow(plain()));
  });

  it("flows down by default", async () => {
    const chain = workflow({
      steps: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: ["a -> b", "b -> c"],
    });
    const scene = await layoutWorkflow(chain);
    expect(node(scene, "a").y).toBeLessThan(node(scene, "b").y);
    expect(node(scene, "b").y).toBeLessThan(node(scene, "c").y);
    expect(scene.type).toBe("workflow");
    expect(scene.groups).toEqual([]);
  });

  it('flows right with direction "right"', async () => {
    const chain = workflow({
      direction: "right",
      steps: [{ id: "a" }, { id: "b" }, { id: "c" }],
      edges: ["a -> b", "b -> c"],
    });
    const scene = await layoutWorkflow(chain);
    expect(node(scene, "a").x).toBeLessThan(node(scene, "b").x);
    expect(node(scene, "b").x).toBeLessThan(node(scene, "c").x);
  });

  it("maps each kind to its shape, icon and label anchor", async () => {
    const scene = await layoutWorkflow(plain());
    expect(node(scene, "a").shape).toBe("box");
    expect(node(scene, "w").shape).toBe("box");
    expect(node(scene, "p").shape).toBe("subprocess");
    expect(node(scene, "s").shape).toBe("pill");
    expect(node(scene, "e").shape).toBe("end");
    expect(node(scene, "d").shape).toBe("diamond");
    expect(node(scene, "w").icon).toBe("clock");
    expect(node(scene, "w").label.anchor).toBe("start");
    for (const id of ["a", "p", "s", "e", "d"]) {
      expect(node(scene, id).icon, id).toBeUndefined();
      expect(node(scene, id).label.anchor, id).toBe("middle");
    }
    expect(node(scene, "s").label.lines).toEqual(["Start"]);
  });

  it("sizes pills at 36px high with a 72px minimum and the diamond about 2:1", async () => {
    const scene = await layoutWorkflow(plain());
    for (const id of ["s", "e"]) {
      expect(node(scene, id).h).toBe(36);
      expect(node(scene, id).w).toBeGreaterThanOrEqual(72);
    }
    const d = node(scene, "d");
    expect(d.w / d.h).toBeGreaterThan(1.5);
    expect(d.w / d.h).toBeLessThan(2.5);
  });

  it("clips edges that end at a diamond onto the rhombus", async () => {
    const scene = await layoutWorkflow(plain());
    const d = node(scene, "d");
    const touching = scene.edges.filter((e) => e.from === "d" || e.to === "d");
    expect(touching).toHaveLength(3);
    for (const e of touching) {
      const p = e.from === "d" ? e.points[0]! : e.points.at(-1)!;
      expect(borderDistance(p, d), e.id).toBeLessThanOrEqual(1);
    }
  });

  it("keeps labels, async style, note and source", async () => {
    const wf = workflow({
      steps: [{ id: "a", note: "first", source: "x.ts:1" }, { id: "b" }],
      edges: ["a ~> b: later"],
    });
    const scene = await layoutWorkflow(wf);
    expect(scene.edges[0]!.style).toBe("async");
    expect(scene.edges[0]!.label?.text.lines).toEqual(["later"]);
    expect(node(scene, "a").note).toBe("first");
    expect(node(scene, "a").source).toBe("x.ts:1");
  });

  it("is deterministic", async () => {
    expect(await layoutWorkflow(plain())).toEqual(await layoutWorkflow(plain()));
  });
});

describe("layoutWorkflow with lanes", () => {
  const bandOf = (scene: Scene, id: string) => scene.groups.find((g) => g.id === id)!;

  it("has no overlaps and edges on borders", async () => {
    expectSound(await layoutWorkflow(refund()));
  });

  it("puts every step inside its lane band, in declaration order", async () => {
    const wf = refund();
    const scene = await layoutWorkflow(wf);
    expect(scene.groups.map((g) => g.id)).toEqual(["customer", "support", "finance"]);
    for (const g of scene.groups) {
      expect(g.variant).toBe("lane");
      expect(g.depth).toBe(0);
    }
    for (const lane of wf.lanes) {
      const band = bandOf(scene, lane.id);
      for (const id of lane.steps) {
        const n = node(scene, id);
        expect(n.y, id).toBeGreaterThanOrEqual(band.y);
        expect(n.y + n.h, id).toBeLessThanOrEqual(band.y + band.h);
      }
    }
  });

  it("draws full-width contiguous bands", async () => {
    const scene = await layoutWorkflow(refund());
    for (const g of scene.groups) {
      expect(g.x).toBe(0);
      expect(g.w).toBe(scene.width);
    }
    for (let i = 0; i + 1 < scene.groups.length; i++) {
      const a = scene.groups[i]!;
      expect(a.y + a.h).toBe(scene.groups[i + 1]!.y);
    }
  });

  it("sizes the header column from the widest lane label", async () => {
    const scene = await layoutWorkflow(refund());
    const header = scene.groups[0]!.header!;
    expect(header).toBeGreaterThanOrEqual(64);
    for (const g of scene.groups) {
      expect(g.header).toBe(header);
      expect(g.label.anchor).toBe("start");
      expect(g.label.x).toBe(12);
    }
    const widest = Math.max(...scene.groups.map((g) => textWidth(g.label.lines[0]!, 12, 600)));
    expect(header).toBeGreaterThanOrEqual(widest + 24);
    for (const n of scene.nodes) expect(n.x).toBeGreaterThanOrEqual(header);
  });

  it("orders a chain left to right across lanes", async () => {
    const scene = await layoutWorkflow(refund());
    const xs = ["start", "request", "review", "approve", "ledger", "notify", "end"].map(
      (id) => node(scene, id).x,
    );
    for (let i = 0; i + 1 < xs.length; i++) expect(xs[i]!, `${i}`).toBeLessThan(xs[i + 1]!);
  });

  it("stacks steps sharing lane and rank in sub-rows inside one band", async () => {
    const wf = workflow({
      lanes: [
        { id: "ops", label: "Ops", steps: ["s", "x", "y"] },
        { id: "qa", label: "QA", steps: ["z"] },
      ],
      steps: [{ id: "s", kind: "start" }, { id: "x" }, { id: "y" }, { id: "z" }],
      edges: ["s -> x", "s -> y", "x -> z", "y -> z"],
    });
    const scene = await layoutWorkflow(wf);
    const x = node(scene, "x");
    const y = node(scene, "y");
    expect(overlaps(x, y)).toBe(false);
    expect(x.y).not.toBe(y.y);
    const band = bandOf(scene, "ops");
    for (const n of [x, y]) {
      expect(n.y).toBeGreaterThanOrEqual(band.y);
      expect(n.y + n.h).toBeLessThanOrEqual(band.y + band.h);
    }
    expectSound(scene);
  });

  it("keeps a retry cycle inside the bands and routes the back edge", async () => {
    const wf = workflow({
      lanes: [
        { id: "a", label: "Author", steps: ["s", "w", "e"] },
        { id: "b", label: "Bot", steps: ["t"] },
      ],
      steps: [
        { id: "s", kind: "start" },
        { id: "w", label: "Write" },
        { id: "t", label: "Test" },
        { id: "e", kind: "end" },
      ],
      edges: ["s -> w", "w -> t", "t -> w: fail", "t -> e: pass"],
    });
    const scene = await layoutWorkflow(wf);
    for (const lane of wf.lanes) {
      const band = bandOf(scene, lane.id);
      for (const id of lane.steps) {
        const n = node(scene, id);
        expect(n.y >= band.y && n.y + n.h <= band.y + band.h, id).toBe(true);
      }
    }
    const back = scene.edges.find((e) => e.from === "t" && e.to === "w")!;
    expect(back.points.length).toBeGreaterThanOrEqual(2);
    expectSound(scene);
  });

  it("is deterministic", async () => {
    expect(await layoutWorkflow(refund())).toEqual(await layoutWorkflow(refund()));
  });
});

const purchase = () =>
  workflow({
    lanes: [
      { id: "req", label: "Requester", steps: ["start", "submit", "end"] },
      {
        id: "proc",
        label: "Procurement",
        steps: ["check", "reject", "vendor", "order", "delivery"],
      },
      { id: "fin", label: "Finance", steps: ["pay", "paid"] },
    ],
    steps: [
      { id: "start", kind: "start" },
      { id: "submit", label: "Submit request" },
      { id: "check", label: "Within budget?", kind: "decision" },
      { id: "reject", label: "Notify rejection" },
      { id: "vendor", label: "Vendor onboarding", kind: "subprocess" },
      { id: "order", label: "Place order" },
      { id: "delivery", label: "Wait for delivery", kind: "wait" },
      { id: "pay", label: "Send payment" },
      { id: "paid", label: "Bank accepted?", kind: "decision" },
      { id: "end", kind: "end" },
    ],
    edges: [
      "start -> submit",
      "submit -> check",
      "check -> vendor: in budget",
      "check -> reject: over budget",
      "reject -> end",
      "vendor -> order",
      "order -> delivery",
      "order ~> pay: invoice",
      "delivery -> pay",
      "pay -> paid",
      "paid -> pay: retry",
      "paid -> end: settled",
    ],
  });

const bends = (points: Point[]) => Math.max(0, points.length - 2);

/** True when an axis-aligned segment enters the interior of the box. */
function crosses(a: Point, b: Point, box: Box): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x0 < box.x + box.w && x1 > box.x && y0 < box.y + box.h && y1 > box.y;
}

describe("lane routing", () => {
  const edge = (scene: Scene, from: string, to: string) =>
    scene.edges.find((e) => e.from === from && e.to === to)!;

  it("is sound", async () => {
    expectSound(await layoutWorkflow(purchase()));
    expectDecisionPorts(await layoutWorkflow(purchase()), "right");
  });

  it("leaves room for every edge label clear of the steps", async () => {
    const scene = await layoutWorkflow(purchase());
    for (const e of scene.edges) {
      if (!e.label) continue;
      for (const n of scene.nodes)
        expect(overlaps(e.label.box, n), `${e.id} label / ${n.id}`).toBe(false);
    }
  });

  it("runs a long edge across lanes with at most two bends", async () => {
    const scene = await layoutWorkflow(purchase());
    expect(bends(edge(scene, "reject", "end").points)).toBeLessThanOrEqual(2);
    expect(bends(edge(scene, "order", "pay").points)).toBeLessThanOrEqual(2);
  });

  it("draws a straight edge between neighbours that share a row", async () => {
    const scene = await layoutWorkflow(purchase());
    expect(bends(edge(scene, "order", "delivery").points)).toBe(0);
  });

  it("never routes an edge through a step", async () => {
    const scene = await layoutWorkflow(purchase());
    for (const e of scene.edges) {
      for (const n of scene.nodes.filter((n) => n.id !== e.from && n.id !== e.to)) {
        for (let i = 0; i + 1 < e.points.length; i++) {
          expect(crosses(e.points[i]!, e.points[i + 1]!, n), `${e.id} through ${n.id}`).toBe(false);
        }
      }
    }
  });

  it("keeps a retry loop from pushing its steps off their row", async () => {
    const scene = await layoutWorkflow(purchase());
    const pay = node(scene, "pay");
    const paid = node(scene, "paid");
    expect(pay.y + pay.h / 2).toBe(paid.y + paid.h / 2);
  });

  it("loops a same-lane back edge under its row, inside the lane band", async () => {
    const scene = await layoutWorkflow(purchase());
    const band = scene.groups.find((g) => g.id === "fin")!;
    const retry = edge(scene, "paid", "pay");
    const bottom = Math.max(
      node(scene, "pay").y + node(scene, "pay").h,
      node(scene, "paid").y + node(scene, "paid").h,
    );
    expect(Math.max(...retry.points.map((p) => p.y))).toBeGreaterThan(bottom);
    for (const p of retry.points)
      expect(p.y >= band.y && p.y <= band.y + band.h, `${p.x},${p.y}`).toBe(true);
    const label = retry.label!.box;
    expect(label.y >= band.y && label.y + label.h <= band.y + band.h).toBe(true);
  });

  it("keeps a back edge loop in a middle lane out of the next band", async () => {
    const wf = workflow({
      lanes: [
        { id: "a", label: "A", steps: ["s"] },
        { id: "b", label: "B", steps: ["w", "t"] },
        { id: "c", label: "C", steps: ["x", "e"] },
      ],
      steps: [
        { id: "s", kind: "start" },
        { id: "w", label: "Write" },
        { id: "t", label: "Test" },
        { id: "x", label: "Ship" },
        { id: "e", kind: "end" },
      ],
      edges: ["s -> w", "w -> t", "t -> w: fail", "t -> x", "x -> e"],
    });
    const scene = await layoutWorkflow(wf);
    const band = scene.groups.find((g) => g.id === "b")!;
    const back = edge(scene, "t", "w");
    for (const p of back.points) expect(p.y <= band.y + band.h, `${p.x},${p.y}`).toBe(true);
    expect(back.label!.box.y + back.label!.box.h).toBeLessThanOrEqual(band.y + band.h);
    expectSound(scene);
  });

  it("is deterministic", async () => {
    expect(await layoutWorkflow(purchase())).toEqual(await layoutWorkflow(purchase()));
  });
});

/** The two vertices where edges may meet a decision for a flow direction. */
function ports(n: SceneNode, flow: "right" | "down"): Point[] {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  return flow === "right"
    ? [
        { x: n.x, y: cy },
        { x: n.x + n.w, y: cy },
      ]
    : [
        { x: cx, y: n.y },
        { x: cx, y: n.y + n.h },
      ];
}

function expectDecisionPorts(scene: Scene, flow: "right" | "down") {
  const decisions = scene.nodes.filter((n) => n.shape === "diamond");
  expect(decisions.length).toBeGreaterThan(0);
  for (const e of scene.edges) {
    for (const d of decisions) {
      const [input, output] = ports(d, flow) as [Point, Point];
      if (e.to === d.id)
        expect(
          Math.hypot(e.points.at(-1)!.x - input.x, e.points.at(-1)!.y - input.y),
          `${e.id} in`,
        ).toBeLessThanOrEqual(1);
      if (e.from === d.id)
        expect(
          Math.hypot(e.points[0]!.x - output.x, e.points[0]!.y - output.y),
          `${e.id} out`,
        ).toBeLessThanOrEqual(1);
    }
  }
}

describe("decision ports", () => {
  it("connects plain flows at the north and south vertices", async () => {
    expectDecisionPorts(await layoutWorkflow(plain()), "down");
  });

  it("connects right-flowing plain workflows at the west and east vertices", async () => {
    const wf = workflow({
      direction: "right",
      steps: [{ id: "a" }, { id: "d", label: "Ok?", kind: "decision" }, { id: "b" }, { id: "c" }],
      edges: ["a -> d", "d -> b: yes", "d -> c: no", "c -> a: again"],
    });
    expectDecisionPorts(await layoutWorkflow(wf), "right");
  });

  it("connects lane flows at the west and east vertices", async () => {
    expectDecisionPorts(await layoutWorkflow(refund()), "right");
  });

  it("does not route decision edges through unrelated lanes", async () => {
    const wf = refund();
    const scene = await layoutWorkflow(wf);
    const laneOf = (id: string) => wf.lanes.find((l) => l.steps.includes(id))!.id;
    for (const e of scene.edges.filter((e) => e.from === "review")) {
      const a = scene.groups.find((g) => g.id === laneOf(e.from))!;
      const b = scene.groups.find((g) => g.id === laneOf(e.to))!;
      const top = Math.min(a.y, b.y);
      const bottom = Math.max(a.y + a.h, b.y + b.h);
      for (const p of e.points) {
        expect(p.y, `${e.id} y`).toBeGreaterThanOrEqual(top);
        expect(p.y, `${e.id} y`).toBeLessThanOrEqual(bottom);
      }
    }
  });
});

describe("assertStepsInLanes", () => {
  const lanes = [{ id: "one", steps: ["a"] }];
  const bands = [{ id: "one", y: 0, h: 100 }];

  it("accepts steps inside their band", () => {
    const boxes = new Map([["a", { x: 0, y: 10, w: 50, h: 40 }]]);
    expect(() => assertStepsInLanes(lanes, bands, boxes)).not.toThrow();
  });

  it("throws naming the step and its lane", () => {
    const boxes = new Map([["a", { x: 0, y: 80, w: 50, h: 40 }]]);
    expect(() => assertStepsInLanes(lanes, bands, boxes)).toThrow('step "a" left its lane "one"');
  });
});

describe("layoutWorkflow parent", () => {
  it("sets the lane of each step", async () => {
    const scene = await layoutWorkflow(refund());
    const parents = Object.fromEntries(scene.nodes.map((n) => [n.id, n.parent]));
    expect(parents).toMatchObject({
      start: "customer",
      review: "support",
      ledger: "finance",
      end: "customer",
    });
  });

  it("leaves parent unset without lanes", async () => {
    const scene = await layoutWorkflow(plain());
    expect(scene.nodes.every((n) => !("parent" in n))).toBe(true);
  });
});
