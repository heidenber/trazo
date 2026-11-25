// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkGeometry } from "../../src/check/geometry.js";
import { make } from "../../src/index.js";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderSvg } from "../../src/render/svg.js";
import type { Box, Point, Scene, SceneEdge, SceneNode } from "../../src/scene.js";

const example = JSON.parse(readFileSync("examples/class.json", "utf8")) as {
  classes: Record<string, unknown>[];
  relations: string[];
};

async function sceneOf(input: unknown): Promise<Scene> {
  const { diagram, issues } = validateDiagram(input);
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return layoutDiagram(diagram!);
}

const node = (scene: Scene, id: string): SceneNode => scene.nodes.find((n) => n.id === id)!;
const edgeOf = (scene: Scene, from: string, to: string): SceneEdge =>
  scene.edges.find((e) => e.from === from && e.to === to)!;

/** Distance from a point to the outline of a rounded box, measured independently of the layout. */
function borderDistance(n: SceneNode, p: Point): number {
  const r = 6;
  const x = Math.abs(p.x - (n.x + n.w / 2)) - (n.w / 2 - r);
  const y = Math.abs(p.y - (n.y + n.h / 2)) - (n.h / 2 - r);
  return Math.abs(Math.hypot(Math.max(x, 0), Math.max(y, 0)) + Math.min(Math.max(x, y), 0) - r);
}

/** Length along the side from the nearest corner: a marker must sit on the flat part. */
const fromCorner = (n: SceneNode, p: Point) =>
  Math.abs(p.x - n.x) < 0.01 || Math.abs(p.x - (n.x + n.w)) < 0.01
    ? Math.min(p.y - n.y, n.y + n.h - p.y)
    : Math.min(p.x - n.x, n.x + n.w - p.x);

const LENGTH: Record<string, [number, number]> = {
  association: [0, 0],
  directed: [0, 10],
  composition: [20, 0],
  aggregation: [20, 0],
  generalization: [0, 14],
  realization: [0, 14],
  dependency: [0, 10],
};

const legs = (pts: Point[]) =>
  pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));

function inside(b: Box, p: Point, gap = 0): boolean {
  return p.x > b.x - gap && p.x < b.x + b.w + gap && p.y > b.y - gap && p.y < b.y + b.h + gap;
}

/** Orthogonal polylines only: every leg is horizontal or vertical. */
function hitsBox(box: Box, a: Point, b: Point, gap: number): boolean {
  const x0 = box.x - gap;
  const x1 = box.x + box.w + gap;
  const y0 = box.y - gap;
  const y1 = box.y + box.h + gap;
  if (Math.abs(a.y - b.y) < 1e-6)
    return a.y > y0 && a.y < y1 && Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1;
  if (Math.abs(a.x - b.x) < 1e-6)
    return a.x > x0 && a.x < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1;
  throw new Error(`diagonal leg ${JSON.stringify([a, b])}`);
}

const overlaps = (a: Box, b: Box, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Boxes of the texts a relation draws next to its line. */
function textBoxes(e: SceneEdge): Box[] {
  return [e.label?.box, e.rel?.fromMult?.box, e.rel?.toMult?.box].filter(
    (b): b is Box => b !== undefined,
  );
}

/** Everything the layout promises about any class scene. */
function expectClean(scene: Scene, name: string): void {
  expect(checkGeometry(scene), name).toEqual([]);
  for (const e of scene.edges) {
    const from = node(scene, e.from);
    const to = node(scene, e.to);
    const where = `${name}: ${e.from} -> ${e.to}`;
    const a = e.points[0]!;
    const b = e.points[e.points.length - 1]!;
    expect(borderDistance(from, a), `${where} start`).toBeLessThan(0.01);
    expect(borderDistance(to, b), `${where} end`).toBeLessThan(0.01);
    // The flat part of a side: markers never sit on a rounded corner.
    expect(fromCorner(from, a), `${where} start corner`).toBeGreaterThanOrEqual(12);
    expect(fromCorner(to, b), `${where} end corner`).toBeGreaterThanOrEqual(12);
    // Room for the marker, the rounded corner and a visible stretch of line.
    const [t0, t1] = LENGTH[e.rel!.kind]!;
    const ls = legs(e.points);
    ls.forEach((len, i) => {
      // Only the legs at the ends carry a marker; a jog in the middle just must not be degenerate.
      if (i > 0 && i < ls.length - 1) return;
      const need =
        (i === 0 ? t0 : 0) + (i === ls.length - 1 ? t1 : 0) + (ls.length > 1 ? 7 : 0) + 6;
      expect(len, `${where} leg ${i}`).toBeGreaterThanOrEqual(need - 0.01);
    });
    // No line crosses a class: only its own two classes may touch it, and only at the ends.
    e.points.slice(1).forEach((p, i) => {
      const q = e.points[i]!;
      for (const n of scene.nodes) {
        if (n.id === e.from || n.id === e.to) continue;
        expect(hitsBox(n, q, p, 4), `${where} passes ${n.id}`).toBe(false);
      }
    });
    for (const n of [from, to]) {
      const mid = e.points.slice(1, -1);
      for (const p of mid) expect(inside(n, p), `${where} bend inside ${n.id}`).toBe(false);
    }
  }
  // Texts: clear of every class, every line and each other.
  const all = scene.edges.flatMap((e) => textBoxes(e).map((box) => ({ e, box })));
  for (const { e, box } of all) {
    for (const n of scene.nodes)
      expect(overlaps(box, n, 3), `${name}: text of ${e.from}->${e.to} touches ${n.id}`).toBe(
        false,
      );
    for (const f of scene.edges)
      f.points.slice(1).forEach((p, i) => {
        expect(
          hitsBox(box, f.points[i]!, p, 2),
          `${name}: text of ${e.from}->${e.to} on line ${f.from}->${f.to}`,
        ).toBe(false);
      });
  }
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      expect(overlaps(all[i]!.box, all[j]!.box, 2), `${name}: texts ${i} and ${j}`).toBe(false);
}

describe("class layout, the example", () => {
  it("is clean: ends on the outlines, room for markers, nothing crossing a class", async () => {
    expectClean(await sceneOf(example), "example");
  });

  it("reads left to right: the order flow in one direction, each hierarchy at its edge", async () => {
    const s = await sceneOf(example);
    const x = (id: string) => node(s, id).x;
    expect(x("Person")).toBeLessThan(x("Customer"));
    expect(x("Customer")).toBeLessThan(x("Order"));
    expect(x("Order")).toBeLessThan(x("OrderLine"));
    expect(x("OrderLine")).toBeLessThan(x("Product"));
    expect(x("Payment")).toBeLessThan(x("CardPayment"));
    expect(x("Payment")).toBeLessThan(x("PayPalPayment"));
    expect(x("Order")).toBeLessThan(x("Payment"));
  });

  it("has no wobble: every middle leg of a line is a real step, at least a corner and a half long", async () => {
    const s = await sceneOf(example);
    for (const e of s.edges) {
      const ls = legs(e.points);
      for (const len of ls.slice(1, -1))
        expect(len, `${e.from} -> ${e.to}`).toBeGreaterThanOrEqual(14);
    }
  });

  it("keeps the written direction: the line runs from the written left class to the right one", async () => {
    const s = await sceneOf(example);
    for (const [from, to, kind] of [
      ["Customer", "Person", "generalization"],
      ["CardPayment", "Payment", "realization"],
      ["Order", "OrderLine", "composition"],
      ["OrderLine", "Product", "directed"],
      ["Order", "Payment", "aggregation"],
      ["Order", "OrderStatus", "dependency"],
      ["Customer", "Order", "association"],
    ] as const) {
      const e = edgeOf(s, from, to);
      expect(e.rel!.kind).toBe(kind);
      expect(borderDistance(node(s, from), e.points[0]!)).toBeLessThan(0.01);
      expect(borderDistance(node(s, to), e.points[e.points.length - 1]!)).toBeLessThan(0.01);
    }
  });

  it("carries multiplicities and the label next to the ends", async () => {
    const s = await sceneOf(example);
    const e = edgeOf(s, "Customer", "Order");
    expect(e.label!.text.lines).toEqual(["places"]);
    expect(e.rel!.fromMult!.text.lines).toEqual(["1"]);
    expect(e.rel!.toMult!.text.lines).toEqual(["0..*"]);
    expect(edgeOf(s, "Customer", "Person").rel!.fromMult).toBeUndefined();
    expect(edgeOf(s, "Order", "OrderLine").label).toBeUndefined();
  });

  it("draws a class as header, attributes and methods, tinted by kind", async () => {
    const s = await sceneOf(example);
    const order = node(s, "Order");
    expect(order.shape).toBe("class");
    expect(order.label.lines).toEqual(["Order"]);
    expect(order.class!.rules).toHaveLength(2);
    expect(order.class!.members.map((m) => m.text.lines[0])).toEqual([
      "id: UUID",
      "status: OrderStatus",
      "placedAt: Date",
      "total(): Money",
      "cancel(): void",
    ]);
    expect(node(s, "Product").class!.rules).toHaveLength(1);
    expect(node(s, "Payment").class!.stereotype!.lines).toEqual(["«interface»"]);
    expect(node(s, "OrderStatus").class!.stereotype!.lines).toEqual(["«enum»"]);
    expect(node(s, "Person").class!.abstract).toBe(true);
    const svg = renderSvg(s);
    for (const [id, fam] of [
      ["Customer", "compute"],
      ["Person", "decision"],
      ["Payment", "messaging"],
      ["OrderStatus", "data"],
    ] as const)
      expect(svg).toMatch(new RegExp(`<g class="t-node t-fam-${fam}[^"]*" data-id="${id}"`));
  });
});

describe("class layout, any valid diagram", () => {
  const cls = (id: string, extra: Record<string, unknown> = {}) => ({ id, ...extra });
  const diagram = (classes: unknown[], relations: string[]) => ({
    type: "class",
    title: "T",
    classes,
    relations,
  });

  it("lays out a single class with no relations", async () => {
    const s = await sceneOf(diagram([cls("Solo")], []));
    expectClean(s, "solo");
    expect(s.edges).toEqual([]);
    expect(node(s, "Solo").h).toBeGreaterThan(40);
  });

  it("handles a cycle, parallel relations and unconnected classes", async () => {
    const s = await sceneOf(
      diagram(
        [
          cls("A", { attributes: ["+ a: int"] }),
          cls("B", { methods: ["+ f(): void"] }),
          cls("C"),
          cls("D"),
          cls("E"),
        ],
        ["A -- B : one", "B --> C", "C --> A", "A ..> B : two", "D --|> E"],
      ),
    );
    expectClean(s, "cycle");
  });

  it("draws a self-relation as a loop on top with both ends on the class", async () => {
    const s = await sceneOf(
      diagram(
        [cls("Employee", { attributes: ["+ name: String"] }), cls("Team")],
        ["Employee 1 -- * Employee : manages", "Team 1 o-- * Employee", "Employee 1 *-- 1 Team"],
      ),
    );
    expectClean(s, "loop");
    const loop = edgeOf(s, "Employee", "Employee");
    expect(loop.points.length).toBe(4);
    expect(loop.label!.text.lines).toEqual(["manages"]);
  });

  it("two loops on one class stay apart", async () => {
    const s = await sceneOf(diagram([cls("N")], ["N 1 -- * N : children", "N ..> N : refs"]));
    expectClean(s, "two loops");
  });

  it("an empty class still has room for its line ends", async () => {
    const s = await sceneOf(
      diagram([cls("A"), cls("B"), cls("C")], ["A --> B", "C --> B", "A --> C"]),
    );
    expectClean(s, "empty");
  });

  it("a hub with many relations on both sides", async () => {
    const names = ["P", "Q", "R", "S", "T", "U", "V"];
    const rels = names.flatMap((n, i) => [
      i % 2 ? `Hub 1 *-- 1..* ${n}` : `${n} * --> 1 Hub : uses`,
    ]);
    const s = await sceneOf(
      diagram(
        [
          cls("Hub", { attributes: ["+ id: int"], methods: ["+ go(): void"] }),
          ...names.map((n) => cls(n)),
        ],
        rels,
      ),
    );
    expectClean(s, "hub");
  });

  it("long names and long members widen the box and stay inside it", async () => {
    const s = await sceneOf(
      diagram(
        [
          cls("AVeryLongClassNameForAnAggregateRoot", {
            stereotype: "interface",
            methods: ["+ computeTheTotalAmountWithTaxesAndDiscounts(items: List<Item>): Money"],
          }),
          cls("B"),
        ],
        ["B ..|> AVeryLongClassNameForAnAggregateRoot"],
      ),
    );
    expectClean(s, "long");
    const n = node(s, "AVeryLongClassNameForAnAggregateRoot");
    expect(n.w).toBeGreaterThan(300);
  });

  it("keeps every promise on generated diagrams of 3 to 12 classes", async () => {
    // A small seeded generator: the same diagrams on every run.
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return Math.floor((seed / 4294967296) * n);
    };
    const ops = ["--", "-->", "*--", "o--", "--|>", "..>"];
    const mults = ["", "1 ", "* ", "0..1 ", "1..* "];
    for (let k = 0; k < 40; k++) {
      const n = 3 + rnd(10);
      const ids = Array.from({ length: n }, (_, i) => `C${i}`);
      const classes = ids.map((id) =>
        cls(id, {
          attributes: Array.from({ length: rnd(4) }, (_, i) => `+ a${i}: int`),
          methods: Array.from({ length: rnd(3) }, (_, i) => `+ m${i}(): void`),
        }),
      );
      const relations: string[] = [];
      for (let i = 0; i < n + rnd(n); i++) {
        const a = rnd(n);
        const b = rnd(n);
        const op = ops[rnd(ops.length)]!;
        const bare = op === "--|>" || op === "..>";
        // A generalization cycle is invalid; point inheritance from a higher to a lower index.
        if (op === "--|>" && a <= b) continue;
        const label = rnd(3) === 0 ? " : rel" + i : "";
        relations.push(
          bare
            ? `${ids[a]} ${op} ${ids[b]}${label}`
            : `${ids[a]} ${mults[rnd(5)]}${op} ${mults[rnd(5)]}${ids[b]}${label}`,
        );
      }
      expectClean(
        await sceneOf(diagram(classes, relations)),
        `random ${k}: ${relations.join(" | ")}`,
      );
    }
  });

  it("is deterministic", async () => {
    const a = renderSvg(await sceneOf(example));
    const b = renderSvg(await sceneOf(example));
    expect(a).toBe(b);
  });
});

describe("class svg", () => {
  it("ends the line at the marker base and puts each marker on the right end", async () => {
    const svg = renderSvg(await sceneOf(example));
    expect(svg).toContain('class="diagram t-class"');
    // hollow triangle: generalization (solid) and realization (dashed); diamonds at the whole end
    expect(svg).toMatch(/t-rel-generalization[^>]*marker-end="url\(#t-rel-generalization\)"/);
    expect(svg).toMatch(/t-rel-realization[^>]*marker-end="url\(#t-rel-realization\)"/);
    expect(svg).toMatch(/t-rel-composition[^>]*marker-start="url\(#t-rel-composition\)"/);
    expect(svg).toMatch(/t-rel-aggregation[^>]*marker-start="url\(#t-rel-aggregation\)"/);
    expect(svg).toMatch(/t-rel-directed[^>]*marker-end="url\(#t-rel-directed\)"/);
    expect(svg).toMatch(/t-rel-dependency[^>]*marker-end="url\(#t-rel-dependency\)"/);
    expect(svg).toMatch(/\.t-rel-realization[^}]*stroke-dasharray/);
    expect(svg).toMatch(/\.t-rel-dependency[^}]*stroke-dasharray/);
    // only the markers in use are defined
    const assoc = {
      type: "class",
      title: "T",
      classes: [{ id: "A" }, { id: "B" }],
      relations: ["A -- B"],
    };
    const plain = renderSvg(await sceneOf(assoc));
    expect(plain).not.toContain("<marker");
  });

  it("draws the italic name of an abstract class and the stereotype line", async () => {
    const svg = renderSvg(await sceneOf(example));
    expect(svg).toMatch(/class="t-node[^"]*t-class-abstract[^"]*" data-id="Person"/);
    expect(svg).toContain("«interface»");
    expect(svg).toContain("«enum»");
    expect(svg).toMatch(/\.t-class-abstract[^}]*font-style: italic/);
  });

  it("draws the legend below the diagram, in English, only with what is used", async () => {
    const s = await sceneOf(example);
    const labels = s.legend!.map((i) => i.label.lines[0]);
    expect(labels).toEqual([
      "Class",
      "Interface",
      "Abstract (italic name)",
      "Enum",
      "Association",
      "Directed association",
      "Aggregation",
      "Composition",
      "Generalization (extends)",
      "Realization (implements)",
      "Dependency (uses)",
      "Multiplicity",
      "Visibility: + public, - private",
    ]);
    const lowest = Math.max(...s.nodes.map((n) => n.y + n.h));
    for (const item of s.legend!) expect(item.swatch.y).toBeGreaterThan(lowest);
    const small = await sceneOf({
      type: "class",
      title: "T",
      classes: [{ id: "A", attributes: ["x"] }, { id: "B" }],
      relations: ["A --|> B"],
    });
    expect(small.legend!.map((i) => i.label.lines[0])).toEqual([
      "Class",
      "Generalization (extends)",
    ]);
  });

  it("works in the black-and-white export: every color is a theme variable", async () => {
    const svg = renderSvg(await sceneOf(example));
    expect(svg.replace(/var\(--t-[a-z-]+,[^;}]*?\)/g, "var()")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("class viewer", () => {
  it("has no Flow toggle and no animation layer", async () => {
    const r = await make(JSON.stringify(example));
    expect(r.ok).toBe(true);
    expect(r.html).not.toContain('id="flow"');
  });

  it("reads a class in the detail card: stereotype, attributes, methods, relations", async () => {
    const r = await make(JSON.stringify(example));
    const raw = /<script type="application\/json" id="trazo-detail">([^<]*)<\/script>/.exec(
      r.html!,
    )![1]!;
    const detail = JSON.parse(raw.replace(/\\u003c/g, "<")) as Record<string, string>;
    expect(detail.Payment).toContain("Interface.");
    expect(detail.Payment).toContain("Methods: + pay(amount: Money): Receipt; + refund(): void");
    expect(detail.Payment).toContain("Implemented by CardPayment.");
    expect(detail.Payment).toContain("Implemented by PayPalPayment.");
    expect(detail.Payment).toContain("Aggregated by Order (1).");
    expect(detail.Order).toContain(
      "Attributes: + id: UUID; - status: OrderStatus; + placedAt: Date",
    );
    expect(detail.Order).toContain("Is composed of OrderLine (1..*).");
    expect(detail.Order).toContain("Aggregates Payment (0..*).");
    expect(detail.Order).toContain("Linked from Customer (1).");
    expect(detail.Customer).toContain("Places Order (0..*).");
    expect(detail.Person).toContain("Abstract class.");
    expect(detail.Person).toContain("Extended by Customer.");
    expect(detail.OrderStatus).toContain("Enum.");
    expect(detail.OrderStatus).toContain("Attributes: PLACED; PAID; SHIPPED; CANCELLED");
    expect(detail.Customer).toContain("Class.");
  });
});
