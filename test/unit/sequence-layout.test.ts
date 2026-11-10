// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { LABEL_AIR } from "../../src/layout/sequence-columns.js";
import { validateDiagram } from "../../src/model/index.js";
import type { Box, Scene, SceneEdge, SceneNode } from "../../src/scene.js";
import { textWidth } from "../../src/text/measure.js";

async function layout(raw: object): Promise<Scene> {
  const { diagram, issues } = validateDiagram({ type: "sequence", title: "T", ...raw });
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  if (diagram?.type !== "sequence") throw new Error("expected a sequence");
  return layoutDiagram(diagram);
}

const participants = [
  { id: "customer", kind: "actor" },
  { id: "api", label: "Checkout API", kind: "service" },
  { id: "orders", kind: "service" },
  { id: "pg", label: "Orders database with a long name", kind: "database" },
  { id: "mail", kind: "queue" },
];

const checkout = () => ({
  participants,
  messages: [
    "customer -> api: POST /checkout with a very long description of the cart that keeps going past the label cap so it has to wrap",
    {
      loop: {
        when: "retry < 3",
        messages: [
          "api -> orders: create",
          {
            alt: [
              { when: "approved", messages: ["orders -> pg: save", "orders --> api: ok"] },
              {
                when: "declined, ask for another card and keep the cart",
                messages: ["orders -> orders: audit the decline", "orders ~> mail: failed"],
              },
            ],
          },
        ],
      },
    },
    { note: "Card data never touches the API", over: ["api"] },
    { note: "Both stores stay in sync", over: ["pg", "orders"] },
    { opt: { when: "wants receipt", messages: ["api ~> mail: receipt"] } },
    "api --> customer: done",
  ],
});

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (inner: Box, outer: Box, pad = 0) =>
  inner.x >= outer.x + pad &&
  inner.y >= outer.y + pad &&
  inner.x + inner.w <= outer.x + outer.w - pad &&
  inner.y + inner.h <= outer.y + outer.h - pad;

const text = (e: SceneEdge) => e.label?.text.lines.join(" ");
const edge = (s: Scene, label: string) =>
  s.edges.find((e) => text(e) === label || text(e)?.startsWith(label))!;
const node = (s: Scene, id: string) => s.nodes.find((n) => n.id === id)!;
const frag = (s: Scene, tag: string) =>
  s.groups.find((g) => g.variant === "fragment" && g.label.lines[0] === tag)!;
const lifeX = (s: Scene, id: string) => s.lifelines!.find((l) => l.id === id)!.x;
const centre = (n: Box) => n.x + n.w / 2;
const labelBoxes = (s: Scene) => s.edges.flatMap((e) => (e.label ? [e.label.box] : []));
const heads = (s: Scene) => s.nodes.filter((n) => n.kind !== "note");
const notes = (s: Scene): SceneNode[] => s.nodes.filter((n) => n.kind === "note");

describe("layoutSequence", () => {
  it("is reachable through layoutDiagram and returns a sequence scene", async () => {
    const s = await layout(checkout());
    expect(s.type).toBe("sequence");
    expect(s.lifelines).toHaveLength(participants.length);
    expect(heads(s).map((n) => n.icon)).toEqual(["user", "server", "server", "database", "inbox"]);
  });

  it("orders participant columns by declaration and keeps headers apart", async () => {
    const s = await layout(checkout());
    const hs = heads(s);
    expect(hs.map((n) => n.id)).toEqual(participants.map((p) => p.id));
    const xs = hs.map(centre);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    for (let i = 1; i < hs.length; i++)
      expect(hs[i]!.x).toBeGreaterThanOrEqual(hs[i - 1]!.x + hs[i - 1]!.w + 24);
    expect(new Set(hs.map((n) => n.y)).size).toBe(1);
    expect(new Set(hs.map((n) => n.h)).size).toBe(1);
    hs.forEach((n) => expect(lifeX(s, n.id)).toBe(centre(n)));
  });

  it("puts message rows in strictly increasing y in document order", async () => {
    const s = await layout(checkout());
    const ys = s.edges.map((e) => e.points[0]!.y);
    expect(s.edges.map((e) => e.id)).toEqual(s.edges.map((_, i) => `#m${i}`));
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]!);
  });

  it("draws each message as a horizontal segment between the two lifelines, pointing at the target", async () => {
    const s = await layout(checkout());
    for (const e of s.edges.filter((m) => m.from !== m.to)) {
      expect(e.points).toHaveLength(2);
      expect(e.points[0]!.y).toBe(e.points[1]!.y);
      expect(Math.abs(e.points[0]!.x - lifeX(s, e.from))).toBeLessThanOrEqual(1);
      expect(Math.abs(e.points[1]!.x - lifeX(s, e.to))).toBeLessThanOrEqual(1);
    }
    expect(edge(s, "ok").points[1]!.x).toBeLessThan(edge(s, "ok").points[0]!.x);
    expect(edge(s, "ok").style).toBe("reply");
    expect(edge(s, "receipt").style).toBe("async");
  });

  it("loops a self-call to the right of its lifeline and returns lower", async () => {
    const s = await layout(checkout());
    const e = edge(s, "audit the decline");
    const x = lifeX(s, "orders");
    expect(e.points).toHaveLength(4);
    expect(e.points[0]!.x).toBe(x);
    expect(e.points[3]!.x).toBe(x);
    expect(e.points[1]!.x).toBeGreaterThan(x);
    expect(e.points[2]!.x).toBe(e.points[1]!.x);
    expect(e.points[3]!.y).toBeGreaterThan(e.points[0]!.y);
    expect(e.label!.box.x).toBeGreaterThan(e.points[1]!.x);
  });

  it("keeps a self-call label clear of the next lifeline", async () => {
    const s = await layout({
      participants: [{ id: "a" }, { id: "b" }],
      messages: ["a -> a: validate the whole request body before saving it", "a -> b: go"],
    });
    const box = edge(s, "validate").label!.box;
    expect(box.x + box.w + LABEL_AIR).toBeLessThanOrEqual(lifeX(s, "b"));
  });

  it("keeps message labels apart from each other, headers and notes", async () => {
    const s = await layout(checkout());
    const boxes = labelBoxes(s);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
      for (const other of [...heads(s), ...notes(s)])
        expect(overlaps(boxes[i]!, other)).toBe(false);
    }
    // the long label wraps instead of widening the diagram without limit
    expect(edge(s, "POST").label!.text.lines.length).toBeGreaterThan(1);
  });

  it("centres a single-participant note and spans a two-participant note", async () => {
    const s = await layout(checkout());
    const [one, two] = notes(s) as [SceneNode, SceneNode];
    expect(one.shape).toBe("note");
    expect(one.label.lines.join(" ")).toBe("Card data never touches the API");
    expect(Math.abs(centre(one) - lifeX(s, "api"))).toBeLessThanOrEqual(1);
    expect(Math.abs(two.x - (lifeX(s, "orders") - 40))).toBeLessThanOrEqual(1);
    expect(Math.abs(two.x + two.w - (lifeX(s, "pg") + 40))).toBeLessThanOrEqual(1);
    expect(two.y).toBeGreaterThan(one.y + one.h);
  });

  it("wraps each fragment around its messages, notes and loops", async () => {
    const s = await layout(checkout());
    const loop = frag(s, "loop");
    for (const label of ["create", "save", "ok", "audit the decline", "failed"]) {
      const e = edge(s, label);
      for (const p of e.points) {
        expect(p.x).toBeGreaterThan(loop.x);
        expect(p.x).toBeLessThan(loop.x + loop.w);
        expect(p.y).toBeGreaterThan(loop.y);
        expect(p.y).toBeLessThan(loop.y + loop.h);
      }
      expect(inside(e.label!.box, loop)).toBe(true);
    }
    const outside = [edge(s, "POST"), edge(s, "receipt"), edge(s, "done")];
    for (const e of outside)
      expect(e.points[0]!.y < loop.y || e.points[0]!.y > loop.y + loop.h).toBe(true);
    for (const n of notes(s)) expect(n.y >= loop.y + loop.h).toBe(true);
    const opt = frag(s, "opt");
    expect(inside(edge(s, "receipt").label!.box, opt)).toBe(true);
    expect(opt.y).toBeGreaterThan(loop.y + loop.h);
  });

  it("insets a nested fragment at least 12 px on every side and orders groups outer first", async () => {
    const s = await layout(checkout());
    const loop = frag(s, "loop");
    const alt = frag(s, "alt");
    expect(s.groups.indexOf(loop)).toBeLessThan(s.groups.indexOf(alt));
    expect(loop.depth).toBe(0);
    expect(alt.depth).toBe(1);
    expect(inside(alt, loop, 12)).toBe(true);
    expect(s.groups.every((g) => g.variant === "fragment")).toBe(true);
  });

  it("separates alt branches with dividers in y order and keeps guards plain", async () => {
    const s = await layout(checkout());
    const alt = frag(s, "alt");
    expect(alt.guard!.lines).toEqual(["approved"]);
    expect(alt.dividers).toHaveLength(1);
    const d = alt.dividers![0]!;
    expect(d.guard.lines).toEqual(["declined, ask for another card and keep the cart"]);
    expect(d.y).toBeGreaterThan(edge(s, "ok").points[0]!.y);
    expect(d.y).toBeLessThan(edge(s, "audit").points[0]!.y);
    expect(d.y).toBeGreaterThan(alt.y);
    expect(d.y).toBeLessThan(alt.y + alt.h);
    // the renderer adds the brackets, so the box has to be wide enough for them
    expect(alt.w).toBeGreaterThanOrEqual(textWidth(`[${d.guard.lines[0]}]`, 11, 400) + 16);
    expect(alt.tab!.x).toBe(alt.x);
    const wide = frag(s, "opt");
    expect(wide.dividers ?? []).toEqual([]);
  });

  it("fits the guard next to the tab even when it is wider than the messages", async () => {
    const guard = "a guard that is much wider than the single message inside it";
    const s = await layout({
      participants: [{ id: "a" }, { id: "b" }],
      messages: [{ opt: { when: guard, messages: ["a -> b: x"] } }],
    });
    const f = frag(s, "opt");
    expect(f.guard!.x).toBeGreaterThanOrEqual(f.tab!.x + f.tab!.w);
    expect(f.guard!.x + textWidth(`[${guard}]`, 11, 400)).toBeLessThanOrEqual(f.x + f.w);
  });

  it("spans lifelines from the header bottom past the last element, inside the canvas", async () => {
    const s = await layout(checkout());
    const bottom = heads(s)[0]!.y + heads(s)[0]!.h;
    const last = Math.max(
      ...s.edges.flatMap((e) => e.points.map((p) => p.y)),
      ...s.groups.map((g) => g.y + g.h),
      ...notes(s).map((n) => n.y + n.h),
    );
    for (const l of s.lifelines!) {
      expect(l.y1).toBe(bottom);
      expect(l.y2).toBeGreaterThan(last);
      expect(l.y2).toBeLessThanOrEqual(s.height);
    }
    const boxes: Box[] = [...s.nodes, ...s.groups, ...labelBoxes(s)];
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(s.width);
      expect(b.y + b.h).toBeLessThanOrEqual(s.height);
    }
    for (const p of s.edges.flatMap((e) => e.points)) expect(p.x).toBeLessThanOrEqual(s.width);
  });

  it("keeps a self-call on the last participant inside the canvas", async () => {
    const s = await layout({
      participants: [{ id: "a" }, { id: "b" }],
      messages: ["a -> b: go", "b -> b: think about it for a while"],
    });
    const e = edge(s, "think about it for a while");
    expect(e.label!.box.x + e.label!.box.w).toBeLessThanOrEqual(s.width);
  });

  it("is deterministic", async () => {
    expect(await layout(checkout())).toEqual(await layout(checkout()));
  });

  it("still lays out the other diagram types", async () => {
    const { diagram } = validateDiagram({
      type: "architecture",
      title: "T",
      nodes: [{ id: "a" }, { id: "b" }],
      edges: ["a -> b"],
    });
    const s = await layoutDiagram(diagram!);
    expect(s.type).toBe("architecture");
    expect(s.lifelines).toBeUndefined();
  });

  it("leaves air between a fragment and a note or fragment right after it", async () => {
    const scene = await layout({
      participants: [{ id: "a" }, { id: "b" }],
      messages: [
        { opt: { when: "first", messages: ["a -> b: one"] } },
        { opt: { when: "second", messages: ["a -> b: two"] } },
        { note: "after the boxes", over: ["a", "b"] },
      ],
    });
    const [first, second] = scene.groups;
    const note = scene.nodes.find((n) => n.shape === "note")!;
    expect(second!.y - (first!.y + first!.h)).toBeGreaterThanOrEqual(12);
    expect(note.y - (second!.y + second!.h)).toBeGreaterThanOrEqual(12);
  });
});
