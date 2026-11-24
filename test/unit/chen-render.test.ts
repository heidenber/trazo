// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { make } from "../../src/index.js";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { PALETTES } from "../../src/render/palettes.js";
import { renderSvg } from "../../src/render/svg.js";
import type { Point, Scene, SceneNode } from "../../src/scene.js";

const example = JSON.parse(readFileSync("examples/chen.json", "utf8")) as Record<string, unknown>;

async function sceneOf(input: unknown): Promise<Scene> {
  const { diagram, issues } = validateDiagram(input);
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return layoutDiagram(diagram!);
}

/** The group of one node, up to its closing tag. */
function nodeMarkup(svg: string, id: string): string {
  const m = new RegExp(`<g class="[^"]*" data-id="${id}"[^>]*>(.*?)</g>`, "s").exec(svg);
  expect(m, `node ${id}`).not.toBeNull();
  return m![0];
}

const count = (text: string, pattern: string) => text.split(pattern).length - 1;

/** Distance from a point to the outer border of a node's shape, measured independently of the layout. */
function borderDistance(n: SceneNode, p: Point): number {
  const cx = n.x + n.w / 2;
  const cy = n.y + n.h / 2;
  const x = Math.abs(p.x - cx);
  const y = Math.abs(p.y - cy);
  const hw = n.w / 2;
  const hh = n.h / 2;
  if (n.shape === "entity" || n.shape === "weak-entity") {
    const inside = x <= hw && y <= hh;
    return inside ? Math.min(hw - x, hh - y) : Math.hypot(Math.max(0, x - hw), Math.max(0, y - hh));
  }
  if (n.shape === "relationship" || n.shape === "identifying") {
    return Math.abs(x / hw + y / hh - 1) * ((hw * hh) / Math.hypot(hw, hh));
  }
  const f = (x / hw) ** 2 + (y / hh) ** 2 - 1;
  return Math.abs(f) / (2 * Math.hypot(x / hw ** 2, y / hh ** 2));
}

function strands(e: Scene["edges"][number]): Point[][] {
  return [e.points, ...(e.chen?.second ? [e.chen.second] : [])];
}

let scene: Scene;
let svg: string;
beforeAll(async () => {
  scene = await sceneOf(example);
  svg = renderSvg(scene);
});

describe("make", () => {
  it("draws examples/chen.json without issues", async () => {
    const result = await make(JSON.stringify(example));
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.html).toContain('class="diagram t-chen"');
  });
});

describe("shapes", () => {
  it("draws an entity as one rectangle and a weak entity as a double rectangle", () => {
    const strong = nodeMarkup(svg, "student");
    expect(count(strong, "<rect")).toBe(1);
    expect(strong).toContain("t-shape-entity");
    const weak = nodeMarkup(svg, "section");
    expect(count(weak, "<rect")).toBe(2);
    expect(weak).toContain("t-shape-weak-entity");
  });

  it("draws a relationship as a diamond and an identifying one as a double diamond", () => {
    const plain = nodeMarkup(svg, "enrolls");
    expect(count(plain, "<polygon")).toBe(1);
    expect(plain).toContain("t-shape-relationship");
    const identifying = nodeMarkup(svg, "has");
    expect(count(identifying, "<polygon")).toBe(2);
    expect(identifying).toContain("t-shape-identifying");
  });

  it("draws attributes as ovals: plain, multivalued double, derived dashed, composite with child ovals", () => {
    expect(count(nodeMarkup(svg, "student.birth_date"), "<ellipse")).toBe(1);
    const multi = nodeMarkup(svg, "student.emails");
    expect(count(multi, "<ellipse")).toBe(2);
    expect(multi).toContain("t-shape-multivalued");
    expect(nodeMarkup(svg, "student.age")).toContain("t-derived");
    expect(svg).toMatch(/\.t-derived \.t-node-box \{[^}]*stroke-dasharray/);
    expect(nodeMarkup(svg, "student.name.first")).toContain("<ellipse");
    expect(nodeMarkup(svg, "student.name.last")).toContain("<ellipse");
    const child = scene.edges.find((e) => e.from === "student.name.first");
    expect(child?.to).toBe("student.name");
  });

  it("gives every element of a kind its own family tint", () => {
    expect(nodeMarkup(svg, "student")).toContain("t-fam-compute");
    expect(nodeMarkup(svg, "enrolls")).toContain("t-fam-messaging");
    expect(nodeMarkup(svg, "student.name")).toContain("t-fam-data");
    expect(svg).not.toContain("color-mix");
  });
});

describe("attribute marks", () => {
  it("underlines a key attribute and a partial key with a dashed underline", () => {
    expect(nodeMarkup(svg, "student.student_id")).toContain("t-u-key");
    expect(nodeMarkup(svg, "section.section_no")).toContain("t-u-partial");
    expect(nodeMarkup(svg, "student.birth_date")).not.toMatch(/t-u-(key|partial)/);
    expect(nodeMarkup(svg, "student.student_id")).toMatch(/<line class="t-chen-underline t-u-key"/);
    expect(svg).toMatch(/.t-u-partial {[^}]*stroke-dasharray/);
  });
});

describe("participation and cardinality", () => {
  const strandsOf = (edgeId: string) =>
    [...svg.matchAll(/<path class="t-edge [^"]*" [^>]*data-edge="([^"]+)"/g)].filter(
      (m) => m[1] === edgeId,
    ).length;

  it("draws total participation as a double line and partial as a single line", () => {
    expect(strandsOf("has.1")).toBe(2);
    expect(strandsOf("has.0")).toBe(1);
    expect(strandsOf("enrolls.0")).toBe(1);
    const total = scene.edges.find((e) => e.id === "has.1")!;
    const gap = Math.hypot(
      total.points[0]!.x - total.chen!.second![0]!.x,
      total.points[0]!.y - total.chen!.second![0]!.y,
    );
    expect(gap).toBeGreaterThan(3);
    expect(gap).toBeLessThan(8);
  });

  it("puts 1, N or M next to the line at each entity side", () => {
    const labels = new Map(
      [
        ...svg.matchAll(
          /<text class="t-text t-edge-label t-chen-card"[^>]*data-edge="([^"]+)"[^>]*x="([\d.-]+)" y="([\d.-]+)"[^>]*><tspan[^>]*>([^<]+)<\/tspan>/g,
        ),
      ].map((m) => [m[1]!, { x: Number(m[2]), y: Number(m[3]), text: m[4]! }]),
    );
    const want: Record<string, string> = {
      "enrolls.0": "N",
      "enrolls.1": "M",
      "has.0": "1",
      "has.1": "N",
      "teaches.0": "1",
      "belongs_to.0": "N",
      "offers.1": "N",
    };
    expect(labels.size).toBe(10);
    for (const [id, text] of Object.entries(want)) expect(labels.get(id)?.text, id).toBe(text);
    for (const e of scene.edges.filter((edge) => edge.chen?.role === "link")) {
      const label = labels.get(e.id)!;
      const entity = scene.nodes.find((n) => n.id === e.from)!;
      const d = Math.min(...[e.points[0]!].map((p) => Math.hypot(label.x - p.x, label.y - p.y)));
      expect(d, e.id).toBeLessThan(34);
      expect(borderDistance(entity, e.points[0]!)).toBeLessThan(0.5);
    }
    expect(svg).toMatch(/\.t-chen-card \{[^}]*stroke: var\(--t-bg/);
  });
});

describe("joins", () => {
  it("ends every connector of examples/chen.json on the outer border of its shapes", () => {
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    for (const e of scene.edges) {
      for (const pts of strands(e)) {
        const a = byId.get(e.from)!;
        const b = byId.get(e.to)!;
        expect(borderDistance(a, pts[0]!), `${e.id} start`).toBeLessThan(0.5);
        expect(borderDistance(b, pts[pts.length - 1]!), `${e.id} end`).toBeLessThan(0.5);
      }
    }
  });

  it("draws the same end points in the svg", () => {
    const byId = new Map(scene.nodes.map((n) => [n.id, n]));
    const paths = [
      ...svg.matchAll(
        /<path class="t-edge [^"]*" data-from="([^"]+)" data-to="([^"]+)" d="([^"]+)"/g,
      ),
    ];
    expect(paths.length).toBe(
      scene.edges.length + scene.edges.filter((e) => e.chen?.second).length,
    );
    for (const [, from, to, d] of paths) {
      const nums = d!.match(/-?\d+(\.\d+)?/g)!.map(Number);
      const first = { x: nums[0]!, y: nums[1]! };
      const last = { x: nums[nums.length - 2]!, y: nums[nums.length - 1]! };
      expect(borderDistance(byId.get(from!)!, first), `${from} -> ${to}`).toBeLessThan(0.5);
      expect(borderDistance(byId.get(to!)!, last), `${from} -> ${to}`).toBeLessThan(0.5);
    }
  });
});

describe("legend", () => {
  const legendText = (s: string) =>
    [
      ...(
        /<g class="t-legend">(.*?)<\/g><\/g>\s*$/s.exec(s.replace(/<\/svg>\s*$/, ""))?.[1] ?? ""
      ).matchAll(/<tspan[^>]*>([^<]+)<\/tspan>/g),
    ].map((m) => m[1]);

  it("lists every notation element the example uses, below the diagram", () => {
    const labels = (scene.legend ?? []).map((i) => i.label.lines[0]);
    expect(labels).toEqual([
      "Entity",
      "Weak entity",
      "Relationship",
      "Identifying relationship",
      "Attribute",
      "Key attribute",
      "Partial key",
      "Multivalued",
      "Derived",
      "Composite",
      "Total participation",
      "Partial participation",
      "Cardinality: 1, N, M",
    ]);
    const lowest = Math.max(...scene.nodes.map((n) => n.y + n.h));
    for (const item of scene.legend!) expect(item.swatch.y).toBeGreaterThan(lowest);
    expect(scene.height).toBeGreaterThan(
      Math.max(...scene.legend!.map((i) => i.swatch.y + i.swatch.h)),
    );
    expect(legendText(svg)).toContain("Weak entity");
  });

  it("lists only the elements a diagram uses", async () => {
    const small = await sceneOf({
      type: "chen",
      title: "Small",
      entities: [
        { id: "a", attributes: ["x"] },
        { id: "b", attributes: [] },
      ],
      relationships: [
        {
          id: "r",
          participants: [
            { entity: "a", cardinality: "1" },
            { entity: "b", cardinality: "N" },
          ],
        },
      ],
    });
    expect((small.legend ?? []).map((i) => i.label.lines[0])).toEqual([
      "Entity",
      "Relationship",
      "Attribute",
      "Partial participation",
      "Cardinality: 1, N, M",
    ]);
  });
});

describe("viewer", () => {
  let html: string;
  beforeAll(async () => {
    html = (await make(JSON.stringify(example))).html!;
  });

  it("has no Flow toggle and no flow layer", () => {
    expect(html).not.toContain('id="flow"');
    expect(html).not.toContain('class="t-flow"');
  });

  it("gives every node a data-id the viewer can search, select and dim", () => {
    for (const id of ["student", "section", "enrolls", "has", "student.name", "enrolls.grade"]) {
      expect(html).toContain(`data-id="${id}"`);
    }
    expect(html).toContain('data-from="student"');
    expect(html).toContain('data-to="enrolls"');
  });

  it("puts the reading of a relationship and the entity detail in the card, never in the svg", () => {
    const detail = /<script type="application\/json" id="trazo-detail">(.*?)<\/script>/s.exec(
      html,
    )!;
    const map = JSON.parse(detail[1]!) as Record<string, string>;
    expect(map.has).toContain("Each Section is related to exactly one Course.");
    expect(map.has).toContain("Each Course is related to many Sections.");
    expect(map.has).toContain("Section: total participation");
    expect(map.has).toContain("Identifying relationship");
    expect(map.section!.startsWith("Identified only together with its course.")).toBe(true);
    expect(renderSvg(scene)).not.toContain("exactly one");
  });

  it("reads the lower bound from the participation of the entity that starts the sentence", async () => {
    const s = await sceneOf({
      type: "chen",
      title: "Lower bounds",
      entities: [
        { id: "dept", label: "Department", attributes: [{ name: "dept_id", kind: "key" }] },
        { id: "emp", label: "Employee", attributes: [{ name: "emp_id", kind: "key" }] },
      ],
      relationships: [
        {
          id: "works",
          label: "WORKS_IN",
          participants: [
            { entity: "dept", cardinality: "1", total: true },
            { entity: "emp", cardinality: "N" },
          ],
        },
      ],
    });
    const card = s.nodes.find((n) => n.id === "works")!.detail!;
    // Employee is partial: an employee may work in no department.
    expect(card).toContain("Each Employee is related to at most one Department.");
    // Department is total: every department has at least one employee.
    expect(card).toContain("Each Department is related to one or more Employees.");
  });

  it("shows detail before note", async () => {
    const s = await sceneOf({
      type: "chen",
      title: "T",
      entities: [{ id: "a", note: "short", detail: "long text", attributes: [] }],
    });
    expect(s.nodes.find((n) => n.id === "a")?.detail?.startsWith("long text")).toBe(true);
  });
});

describe("layout rules", () => {
  const boxHit = (a: Point, b: Point, n: SceneNode, margin: number) => {
    for (let k = 1; k < 50; k++) {
      const t = k / 50;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      if (x > n.x - margin && x < n.x + n.w + margin && y > n.y - margin && y < n.y + n.h + margin)
        return true;
    }
    return false;
  };

  const hard = {
    type: "chen",
    title: "Hard",
    entities: [
      {
        id: "emp",
        label: "Employee",
        attributes: [
          { name: "emp_id", kind: "key" },
          "name",
          { name: "address", children: ["street", { name: "city", children: ["zip", "town"] }] },
          { name: "phones", kind: "multivalued" },
          "hired",
          { name: "tenure", kind: "derived" },
          "salary",
          "grade",
          "mail",
          "office",
        ],
      },
      { id: "proj", label: "Project", attributes: [{ name: "pid", kind: "key" }, "title"] },
      { id: "loner", label: "Loner", attributes: [{ name: "lid", kind: "key" }] },
    ],
    relationships: [
      {
        id: "manages",
        label: "MANAGES",
        attributes: ["since", "level", "note1", "note2"],
        participants: [
          { entity: "emp", cardinality: "1" },
          { entity: "emp", cardinality: "N", total: true },
        ],
      },
      {
        id: "works",
        label: "WORKS_ON",
        participants: [
          { entity: "emp", cardinality: "M", total: true },
          { entity: "proj", cardinality: "N" },
        ],
      },
    ],
  };

  it("keeps recursive relationships, big columns and isolated entities clean", async () => {
    const s = await sceneOf(hard);
    const byId = new Map(s.nodes.map((n) => [n.id, n]));
    const overlaps: string[] = [];
    for (let i = 0; i < s.nodes.length; i++)
      for (let j = i + 1; j < s.nodes.length; j++) {
        const a = s.nodes[i]!;
        const b = s.nodes[j]!;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
          overlaps.push(`${a.id}/${b.id}`);
      }
    expect(overlaps).toEqual([]);
    for (const e of s.edges) {
      for (const pts of strands(e)) {
        expect(borderDistance(byId.get(e.from)!, pts[0]!), `${e.id} start`).toBeLessThan(0.5);
        expect(borderDistance(byId.get(e.to)!, pts[pts.length - 1]!), `${e.id} end`).toBeLessThan(
          0.5,
        );
        for (const n of s.nodes) {
          if (n.id === e.from || n.id === e.to) continue;
          for (let k = 1; k < pts.length; k++)
            expect(boxHit(pts[k - 1]!, pts[k]!, n, 0), `${e.id} through ${n.id}`).toBe(false);
        }
      }
    }
    const manages = s.edges.filter((e) => e.chen?.role === "link" && e.id.startsWith("manages."));
    expect(manages).toHaveLength(2);
    expect(manages.every((e) => e.from === "emp" && e.to === "manages")).toBe(true);
    expect(manages[0]!.points).not.toEqual(manages[1]!.points);
  });

  it("puts the attributes of a hub entity in a row on top when both sides are busy", async () => {
    const hub = {
      type: "chen",
      title: "Hub",
      entities: [
        { id: "x", label: "Xylophone", attributes: [{ name: "xid", kind: "key" }, "a1"] },
        { id: "a", label: "Alpha", attributes: [{ name: "aid", kind: "key" }, "p", "q", "r"] },
        { id: "b", label: "Beta", attributes: [{ name: "bid", kind: "key" }] },
        { id: "c", label: "Gamma", attributes: [{ name: "cid", kind: "key" }] },
        { id: "d", label: "Delta", attributes: [{ name: "did", kind: "key" }] },
      ],
      relationships: [
        {
          id: "r1",
          participants: [
            { entity: "x", cardinality: "1" },
            { entity: "a", cardinality: "N" },
          ],
        },
        {
          id: "r2",
          participants: [
            { entity: "x", cardinality: "1" },
            { entity: "b", cardinality: "N" },
          ],
        },
        {
          id: "r3",
          participants: [
            { entity: "x", cardinality: "1" },
            { entity: "c", cardinality: "N" },
          ],
        },
        {
          id: "r4",
          participants: [
            { entity: "a", cardinality: "M", total: true },
            { entity: "d", cardinality: "N" },
          ],
        },
      ],
    };
    const s = await sceneOf(hub);
    const alpha = s.nodes.find((n) => n.id === "a")!;
    for (const id of ["a.aid", "a.p", "a.q", "a.r"]) {
      const o = s.nodes.find((n) => n.id === id)!;
      expect(o.y + o.h).toBeLessThan(alpha.y);
    }
    // An entity with a free side keeps its column beside it.
    const delta = s.nodes.find((n) => n.id === "d")!;
    const did = s.nodes.find((n) => n.id === "d.did")!;
    expect(did.x).toBeGreaterThan(delta.x + delta.w);
  });
});

describe("themes", () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it.each(Object.keys(PALETTES) as (keyof typeof PALETTES)[])(
    "%s: labels read on every chen tint and lines read on the page",
    (name) => {
      const p = PALETTES[name];
      for (const family of ["compute", "messaging", "data"] as const) {
        expect(ratio(p.base.text!, p.fam[family][1])).toBeGreaterThanOrEqual(4.5);
        expect(ratio(p.fam[family][0], p.base.bg!)).toBeGreaterThanOrEqual(3);
      }
      expect(ratio(p.base.muted!, p.base.bg!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(p.base.text!, p.base.bg!)).toBeGreaterThanOrEqual(4.5);
    },
  );

  it("draws links in explicit theme variables", () => {
    expect(svg).toMatch(/\.t-chen-link \{[^}]*stroke: var\(--t-text, #/);
    expect(svg).toMatch(/\.t-chen-attr \{[^}]*stroke: var\(--t-muted, #/);
  });
});
