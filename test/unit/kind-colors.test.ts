// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderSvg } from "../../src/render/svg.js";
import { THEME_VARS, pageCss } from "../../src/render/theme.js";

const FAMILIES = [
  "compute",
  "data",
  "messaging",
  "client",
  "external",
  "start",
  "end",
  "decision",
  "wait",
  "task",
];
const EDGE_VARS = ["--t-edge", "--t-edge-async", "--t-edge-data", "--t-edge-reply"];

async function svgOf(input: unknown): Promise<string> {
  const { diagram, issues } = validateDiagram(input);
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return renderSvg(await layoutDiagram(diagram!));
}

const classOf = (svg: string, id: string) =>
  new RegExp(`<g class="([^"]*)" data-id="${id}"`).exec(svg)?.[1];

function block(css: string, head: string): Record<string, string> {
  const start = css.indexOf(head);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--t-[a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1]!, m[2]!]),
  );
}

const css = pageCss("", "");
const palettes = {
  light: block(css, ':root, [data-theme="light"]'),
  dark: block(css, '[data-theme="dark"]'),
  lagoon: block(css, '[data-theme="lagoon"]'),
  dusk: block(css, '[data-theme="dusk"]'),
};

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

describe("node families", () => {
  it("groups architecture kinds into five families, unknown kinds fall to compute", async () => {
    const kinds = [
      "service",
      "function",
      "database",
      "storage",
      "cache",
      "queue",
      "client",
      "user",
      "external",
      "gateway",
    ];
    const svg = await svgOf({
      type: "architecture",
      title: "k",
      nodes: kinds.map((k) => ({ id: k, label: k, kind: k })),
      edges: [],
    });
    const want: Record<string, string> = {
      service: "compute",
      function: "compute",
      database: "data",
      storage: "data",
      cache: "data",
      gateway: "compute",
      queue: "messaging",
      client: "client",
      user: "client",
      external: "external",
    };
    for (const [k, f] of Object.entries(want)) expect(classOf(svg, k)).toBe(`t-node t-fam-${f}`);
  });

  it("maps workflow steps to their own family, subprocess to task", async () => {
    const svg = await svgOf({
      type: "workflow",
      title: "w",
      steps: [
        { id: "s", kind: "start" },
        { id: "t", kind: "task" },
        { id: "d", kind: "decision" },
        { id: "w", kind: "wait" },
        { id: "p", kind: "subprocess" },
        { id: "e", kind: "end" },
      ],
      edges: ["s -> t", "t -> d: yes", "d -> w: no", "w -> p", "p -> e", "d -> e: skip"],
    });
    expect(classOf(svg, "s")).toContain("t-fam-start");
    expect(classOf(svg, "t")).toContain("t-fam-task");
    expect(classOf(svg, "d")).toContain("t-fam-decision");
    expect(classOf(svg, "w")).toContain("t-fam-wait");
    expect(classOf(svg, "p")).toContain("t-fam-task");
    expect(classOf(svg, "e")).toContain("t-fam-end");
  });

  it("reuses the architecture families for sequence participants and leaves notes alone", async () => {
    const svg = await svgOf({
      type: "sequence",
      title: "q",
      participants: [
        { id: "a", kind: "actor" },
        { id: "s", kind: "service" },
        { id: "d", kind: "database" },
        { id: "m", kind: "queue" },
        { id: "x", kind: "external" },
      ],
      messages: ["a -> s: go", "s -> d: q", "s -> m: e", "s -> x: h", { note: "hi", over: ["s"] }],
    });
    expect(classOf(svg, "a")).toContain("t-fam-client");
    expect(classOf(svg, "s")).toContain("t-fam-compute");
    expect(classOf(svg, "d")).toContain("t-fam-data");
    expect(classOf(svg, "m")).toContain("t-fam-messaging");
    expect(classOf(svg, "x")).toContain("t-fam-external");
    expect(svg).toContain('class="t-node t-shape-note"');
  });

  it("leaves ERD tables without a family", async () => {
    const svg = await svgOf({
      type: "erd",
      title: "e",
      tables: [
        { id: "a", columns: ["id int pk"] },
        { id: "b", columns: ["id int pk", "a_id int fk a.id"] },
      ],
    });
    expect(svg).not.toContain("t-fam-");
  });

  it("styles a family with stroke and tint variables and colors icons by family", async () => {
    const svg = await svgOf({
      type: "sequence",
      title: "q",
      participants: [{ id: "a", kind: "actor" }, { id: "s" }],
      messages: ["a -> s: go"],
    });
    expect(svg).toMatch(
      /\.t-fam-client \{ --t-f-fill: var\(--t-fam-client-fill, #[0-9a-f]{6}\); --t-f-stroke: var\(--t-fam-client-stroke, #[0-9a-f]{6}\); \}/,
    );
    expect(svg).toContain(".t-icon { color: var(--t-f-stroke, ");
    expect(svg).toContain(".t-chip { fill: var(--t-f-fill, ");
    expect(svg).not.toContain("t-fam-wait");
  });
});

describe("edge colors", () => {
  it("colors each style and matches the arrowhead", async () => {
    const svg = await svgOf({
      type: "architecture",
      title: "k",
      nodes: [{ id: "a" }, { id: "b" }],
      edges: ["a -> b", "a ~> b", { from: "a", to: "b", style: "data" }],
    });
    expect(svg).toContain(".t-edge-async { stroke: var(--t-edge-async, #");
    expect(svg).toContain(".t-edge-data { stroke: var(--t-edge-data, #");
    expect(svg).toContain(".t-edge-async { stroke-dasharray: 6 5; }");
    for (const s of ["async", "data"]) {
      expect(svg).toContain(`marker-end="url(#t-arrowhead-${s})"`);
      expect(svg).toContain(`<marker id="t-arrowhead-${s}"`);
      expect(svg).toContain(`.t-arrow-${s} { fill: var(--t-edge-${s}, #`);
    }
    expect(svg).toContain('marker-end="url(#t-arrowhead)"');
  });

  it("uses open heads in each style color inside sequences", async () => {
    const svg = await svgOf({
      type: "sequence",
      title: "q",
      participants: [{ id: "a" }, { id: "b" }],
      messages: ["a ~> b: x", "b --> a: y"],
    });
    expect(svg).toContain('marker-end="url(#t-arrowhead-open-async)"');
    expect(svg).toContain('marker-end="url(#t-arrowhead-open-reply)"');
    expect(svg).toContain(".t-arrow-open-reply { stroke: var(--t-edge-reply, #");
    expect(svg).toContain(".t-arrow-open-async { stroke: var(--t-edge-async, #");
  });
});

describe("palette", () => {
  const vars = [
    ...FAMILIES.flatMap((f) => [`--t-fam-${f}-stroke`, `--t-fam-${f}-fill`]),
    ...EDGE_VARS,
  ];

  it("defines every color variable in all four themes and exports them", () => {
    for (const v of vars) {
      for (const [theme, p] of Object.entries(palettes))
        expect(p[v], `${theme} ${v}`).toBeDefined();
      expect(THEME_VARS).toContain(v);
    }
  });

  it("uses no color-mix", () => {
    expect(css).not.toContain("color-mix");
  });

  it("keeps labels readable on every tint (>= 4.5:1)", () => {
    for (const [theme, p] of Object.entries(palettes))
      for (const f of FAMILIES)
        expect(
          ratio(p["--t-text"]!, p[`--t-fam-${f}-fill`]!),
          `${theme} ${f}`,
        ).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps strokes and edges visible on the background (>= 3:1)", () => {
    for (const [theme, p] of Object.entries(palettes)) {
      for (const f of FAMILIES)
        expect(
          ratio(p[`--t-fam-${f}-stroke`]!, p["--t-bg"]!),
          `${theme} ${f}`,
        ).toBeGreaterThanOrEqual(3);
      for (const v of EDGE_VARS)
        expect(ratio(p[v]!, p["--t-bg"]!), `${theme} ${v}`).toBeGreaterThanOrEqual(3);
    }
  });
});
