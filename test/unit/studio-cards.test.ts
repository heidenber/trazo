// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { pathData } from "../../src/render/shapes.js";
import { renderSvg } from "../../src/render/svg.js";

async function sceneOf(input: unknown) {
  const { diagram, issues } = validateDiagram(input);
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return layoutDiagram(diagram!);
}
const r = (v: number) => Math.round(v * 100) / 100;
const svgOf = async (input: unknown) => renderSvg(await sceneOf(input));

const arch = {
  type: "architecture",
  title: "Shop",
  nodes: [
    { id: "web", label: "Web", kind: "client" },
    { id: "api", label: "API", note: "Handles requests" },
    { id: "db", label: "DB", kind: "database" },
  ],
  edges: ["web -> api: call", "api -> db"],
};

describe("pathData", () => {
  const p = (...xy: number[][]) => xy.map(([x, y]) => ({ x: x!, y: y! }));

  it("keeps a straight edge as one line", () => {
    expect(pathData(p([0, 0], [100, 0]))).toBe("M0 0 L100 0");
  });

  it("rounds a right-angle corner with a quadratic curve that ends on the same points", () => {
    expect(pathData(p([0, 0], [100, 0], [100, 100]), 10)).toBe("M0 0 L90 0 Q100 0 100 10 L100 100");
  });

  it("keeps collinear and repeated points as lines", () => {
    expect(pathData(p([0, 0], [50, 0], [100, 0]), 10)).toBe("M0 0 L50 0 L100 0");
    expect(pathData(p([0, 0], [50, 0], [50, 0], [50, 40]), 10)).not.toContain("NaN");
  });

  it("shrinks the radius to half of a short segment", () => {
    expect(pathData(p([0, 0], [100, 0], [100, 8], [200, 8]), 10)).toContain("Q100 0 100 4");
  });

  it("leaves room for the arrowhead on the last leg", () => {
    expect(pathData(p([0, 0], [100, 0], [100, 12]), 10)).toBe("M0 0 L97 0 Q100 0 100 3 L100 12");
  });
});

describe("edges", () => {
  it("round the corners of an orthogonal route and leave straight ones alone", async () => {
    const scene = await sceneOf({
      ...arch,
      nodes: [...arch.nodes, { id: "q", label: "Queue", kind: "queue" }],
      edges: ["web -> api", "api -> db", "web -> q", "q -> db"],
    });
    const svg = renderSvg(scene);
    const bent = scene.edges.filter((e) => e.points.length > 2);
    expect(bent.length).toBeGreaterThan(0);
    for (const e of scene.edges) {
      const d = new RegExp(`class="t-edge [^"]*" [^>]* d="([^"]+)"[^>]*data-edge="${e.id}"`).exec(
        svg,
      )?.[1];
      expect(d, e.id).toBeDefined();
      expect(d!.startsWith(`M${r(e.points[0]!.x)} ${r(e.points[0]!.y)}`)).toBe(true);
      expect(d!.endsWith(`L${r(e.points.at(-1)!.x)} ${r(e.points.at(-1)!.y)}`)).toBe(true);
      expect(d!.includes("Q"), e.id).toBe(e.points.length > 2);
    }
  });

  it("draw the label as a pill with a border", async () => {
    const svg = await svgOf(arch);
    expect(svg).toMatch(/<rect class="t-label-bg" [^>]*rx="(?:[\d.]+)"/);
    expect(svg).toContain(
      ".t-label-bg { fill: var(--t-label-bg, #ffffff); stroke: var(--t-border, ",
    );
  });

  it("use a rounded arrowhead", async () => {
    const svg = await svgOf(arch);
    expect(svg).toContain('<path class="t-arrow" d="M1.8 1.8L8.4 5L1.8 8.2z"/>');
    expect(svg).toMatch(
      /\.t-arrow \{ fill: var\(--t-edge, #[0-9a-f]{6}\); stroke: var\(--t-edge, /,
    );
  });
});

describe("cards", () => {
  it("draw a node as a rounded card with a tinted chip and the icon on it", async () => {
    const scene = await sceneOf(arch);
    const svg = renderSvg(scene);
    const n = scene.nodes.find((x) => x.id === "api")!;
    expect(svg).toContain(
      `<rect class="t-node-box" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="12" filter="url(#t-shadow)"/>`,
    );
    const chipY = n.y + (n.h - 30) / 2;
    expect(svg).toContain(
      `<rect class="t-chip" x="${n.x + 12}" y="${chipY}" width="30" height="30" rx="9"/>`,
    );
    expect(svg).toMatch(
      new RegExp(
        `<svg class="t-icon t-icon-service" x="${n.x + 19}" y="${chipY + 7}" width="16" height="16"`,
      ),
    );
    expect(n.label.x).toBe(n.x + 52);
    expect(n.subtitle!.x).toBe(n.x + 52);
  });

  it("colors the chip and the icon by family", async () => {
    const svg = await svgOf(arch);
    expect(svg).toMatch(
      /\.t-fam-data \{ --t-f-fill: var\(--t-fam-data-fill, #[0-9a-f]{6}\); --t-f-stroke: var\(--t-fam-data-stroke, #[0-9a-f]{6}\); \}/,
    );
    expect(svg).toContain(".t-chip { fill: var(--t-f-fill");
    expect(svg).toContain(".t-icon { color: var(--t-f-stroke");
  });

  it("defines the soft shadow once, only when a shape uses it", async () => {
    const svg = await svgOf(arch);
    expect(svg.match(/<filter id="t-shadow"/g)).toHaveLength(1);
    expect(svg.match(/<feDropShadow/g)).toHaveLength(2);
    expect(svg).toContain(".t-shadow-near { flood-color: var(--t-shadow, ");
    const pills = await svgOf({
      type: "workflow",
      title: "p",
      steps: [
        { id: "s", kind: "start" },
        { id: "e", kind: "end" },
      ],
      edges: ["s -> e"],
    });
    expect(pills).not.toContain("<filter");
    expect(pills).not.toContain("filter=");
    expect(pills).not.toContain("t-shadow-near");
  });

  it("gives tables, diamonds and subprocess boxes the shadow too", async () => {
    const erd = await svgOf({
      type: "erd",
      title: "e",
      tables: [
        { id: "a", columns: ["id int pk"] },
        { id: "b", columns: ["a_id int fk a.id"] },
      ],
    });
    expect(erd).toContain('class="t-table"');
    expect(erd).toMatch(/<rect class="t-table" [^>]*rx="10" filter="url\(#t-shadow\)"\/>/);
    const wf = await svgOf({
      type: "workflow",
      title: "w",
      steps: [
        { id: "s", kind: "start" },
        { id: "d", kind: "decision", label: "ok?" },
        { id: "p", kind: "subprocess" },
        { id: "w", kind: "wait" },
      ],
      edges: ["s -> d", "d -> p: yes", "d -> w: no"],
    });
    expect(wf).toMatch(/<polygon class="t-node-box" [^>]*filter="url\(#t-shadow\)"\/>/);
    expect(wf.match(/filter="url\(#t-shadow\)"/g)).toHaveLength(3);
  });

  it("tints pills, diamonds and plain task boxes, and gives chip cards the card surface", async () => {
    const wf = await svgOf({
      type: "workflow",
      title: "w",
      steps: [
        { id: "s", kind: "start" },
        { id: "t", kind: "task" },
        { id: "d", kind: "decision" },
        { id: "w", kind: "wait" },
        { id: "e", kind: "end" },
      ],
      edges: ["s -> t", "t -> d", "d -> w: no", "d -> e: yes", "w -> e"],
    });
    const cls = (id: string) => new RegExp(`<g class="([^"]*)" data-id="${id}"`).exec(wf)?.[1];
    expect(cls("s")).toContain("t-tint");
    expect(cls("t")).toContain("t-tint");
    expect(cls("d")).toContain("t-tint");
    expect(cls("w")).not.toContain("t-tint");
    expect(wf).toContain('class="t-chip"');
    expect(wf).toContain(".t-tint .t-node-box { fill: var(--t-f-fill");
    expect(wf).toContain(".t-fam-wait .t-node-box { stroke: var(--t-f-stroke");
  });

  it("keeps every color variable with a fallback so a standalone SVG stays readable", async () => {
    const svg = await svgOf(arch);
    const css = /<style>([\s\S]*?)<\/style>/.exec(svg)![1]!;
    const bare = [...css.matchAll(/var\((--t-[a-z-]+)\)/g)].map((m) => m[1]);
    expect(bare).toEqual([]);
  });
});

describe("groups and legend", () => {
  it("round the group box and the legend swatches", async () => {
    const svg = await svgOf({
      ...arch,
      groups: [{ id: "g", label: "Core", children: ["api", "db"] }],
    });
    expect(svg).toMatch(/<rect class="t-group-box" [^>]*rx="16"/);
    expect(svg).toMatch(/<rect class="t-legend-swatch" [^>]*rx="5"/);
    expect(svg).toContain(".t-legend-item .t-legend-swatch { fill: var(--t-f-fill");
  });
});
