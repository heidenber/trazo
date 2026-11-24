// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { beforeAll, describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderHtml } from "../../src/render/html.js";
import {
  CREDIT_FONT,
  CREDIT_STRIP,
  VIEWER_SCRIPT,
  creditBox,
  creditMarkup,
} from "../../src/render/viewer.js";
import type { Scene } from "../../src/scene.js";

let html: string;
let scene: Scene;

beforeAll(async () => {
  const { diagram } = validateDiagram({
    type: "architecture",
    title: "Checkout flow",
    nodes: [
      { id: "web", label: "Web", kind: "client" },
      { id: "api", label: "API", kind: "service" },
    ],
    edges: ["web -> api"],
  });
  scene = await layoutDiagram(diagram!);
  html = renderHtml(scene);
});

const base = { x: 0, y: 0, w: 800, h: 400 };

describe("header symbol", () => {
  it("uses the symbol-small in both color variants and no horizontal logo", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain('<svg class="logo logo-light" viewBox="0 0 256 256" height="24"');
    expect(header).toContain('<svg class="logo logo-dark" viewBox="0 0 256 256" height="24"');
    for (const c of ["#1f2933", "#2f6fdb", "#ffffff", "#6ea2f5"]) expect(header).toContain(c);
    expect(header).not.toContain("763.22");
    expect(header).not.toContain("761.08");
    expect(header).toContain('role="img" aria-label="trazo"');
  });
});

describe("export credit", () => {
  it("grows the export box by a strip below the content", () => {
    const box = creditBox(base);
    expect(box).toEqual({ x: 0, y: 0, w: 800, h: 400 + CREDIT_STRIP });
  });

  it("puts a muted Made with trazo at the bottom right, inside the strip", () => {
    const m = creditMarkup(base, CREDIT_FONT);
    expect(m).toContain(">Made with trazo</text>");
    expect(m).toContain('text-anchor="end"');
    expect(m).toContain("var(--t-muted)");
    expect(m).toContain("Inter");
    const x = Number(/ x="([\d.]+)"/.exec(m)![1]);
    const y = Number(/ y="([\d.]+)"/.exec(m)![1]);
    expect(x).toBeLessThanOrEqual(800);
    expect(x).toBeGreaterThan(700);
    expect(y).toBeGreaterThan(400 + 11 / 2);
    expect(y).toBeLessThanOrEqual(400 + CREDIT_STRIP);
  });

  it("is added in the export build, which feeds every SVG and PNG export", () => {
    const build = VIEWER_SCRIPT.slice(VIEWER_SCRIPT.indexOf("var build ="));
    const end = build.indexOf("var slug");
    expect(build.slice(0, end)).toContain("creditBox(base)");
    expect(build.slice(0, end)).toContain("creditMarkup(base, CREDIT_FONT)");
    const png = build.slice(build.indexOf("var png ="), build.indexOf("var copyText"));
    expect(png).toContain("creditBox(base)");
    // Copy JSON is not an image.
    const json = VIEWER_SCRIPT.slice(
      VIEWER_SCRIPT.indexOf('"copy-json": function'),
      VIEWER_SCRIPT.indexOf("var noteLine"),
    );
    expect(json).not.toContain("creditMarkup");
    expect(json).not.toContain("build(");
  });
});

describe("inline SVG and print", () => {
  it("keeps the credit out of the inline diagram SVG", () => {
    const start = html.indexOf('<svg xmlns="http://www.w3.org/2000/svg" class="diagram');
    const svg = html.slice(start, html.indexOf('<div class="minimap"'));
    expect(svg).not.toContain("Made with trazo");
    expect(svg).not.toContain("t-credit");
  });

  it("prints the credit once: the footer is hidden and the printed diagram gets it", () => {
    const print = html.slice(html.indexOf("@media print"));
    expect(/\.credit[^{}]*\{ display: none !important; \}/.test(print)).toBe(true);
    const before = VIEWER_SCRIPT.slice(
      VIEWER_SCRIPT.indexOf('addEventListener("beforeprint"'),
      VIEWER_SCRIPT.indexOf('addEventListener("afterprint"'),
    );
    expect(before.match(/creditMarkup\(base, CREDIT_FONT\)/g)).toHaveLength(1);
    expect(VIEWER_SCRIPT.slice(VIEWER_SCRIPT.indexOf('addEventListener("afterprint"'))).toContain(
      ".t-credit",
    );
    const rule = /@page \{ size: ([\d.]+)px ([\d.]+)px; margin: (\d+)px; \}/.exec(html)!;
    expect(Number(rule[2]) - 2 * Number(rule[3])).toBe(Math.ceil(scene.height) + CREDIT_STRIP);
    expect(html.match(/<footer class="credit">/g)).toHaveLength(1);
  });
});
