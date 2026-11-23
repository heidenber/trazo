// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { beforeAll, describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderHtml } from "../../src/render/html.js";
import type { Scene } from "../../src/scene.js";

let html: string;

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
  const scene: Scene = await layoutDiagram(diagram!);
  html = renderHtml(scene);
});

const BUTTONS = [
  ["zoom-out", "Zoom out"],
  ["zoom-in", "Zoom in"],
  ["fit", "Fit to screen"],
  ["fullscreen", "Enter full screen"],
  ["export", "Export diagram"],
];

describe("toolbar", () => {
  it("lists the buttons with their labels", () => {
    for (const [id, label] of BUTTONS) {
      expect(html, id).toContain(`id="${id}" aria-label="${label}"`);
    }
  });

  it("has no emoji", () => {
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("stage", () => {
  it("is a focusable, labelled region with a fixed height", () => {
    expect(html).toContain(
      '<div class="stage" tabindex="0" aria-label="Diagram, use arrow keys to pan and plus or minus to zoom">',
    );
    expect(html).not.toMatch(/class="stage" style=/);
    expect(html).toContain("main { flex: 1; min-height: 0; overflow: hidden;");
    expect(html).toContain("touch-action: none");
    expect(html).toContain("cursor: grab");
  });

  it("styles the dimming and shows details in a card", () => {
    expect(html).toContain(
      ".t-dim :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline):not(.t-near)",
    );
    expect(html).toContain('<aside class="detail" id="detail"');
  });
});

describe("credit", () => {
  it("links to the project in a footer after the diagram", () => {
    expect(html).toContain(
      '<footer class="credit"><a href="https://github.com/heidenber/trazo" target="_blank" rel="noopener noreferrer">Made with trazo</a></footer>',
    );
    expect(html.indexOf('<footer class="credit">')).toBeGreaterThan(html.indexOf("</main>"));
    expect(html).toContain(".credit {");
  });

  it("stays out of the diagram, so exported SVG and PNG carry no credit", () => {
    const start = html.indexOf('<svg xmlns="http://www.w3.org/2000/svg" class="diagram');
    const svg = html.slice(start, html.indexOf('<div class="minimap"'));
    expect(svg).toMatch(/^<svg [\s\S]*<\/svg>\s*<\/div>\s*$/);
    expect(svg).not.toContain("Made with trazo");
  });
});

describe("output", () => {
  it("is deterministic and small", async () => {
    expect(renderHtml(await sameScene())).toBe(html);
    expect(Buffer.byteLength(html)).toBeLessThan(300 * 1024);
  });
});

async function sameScene(): Promise<Scene> {
  const { diagram } = validateDiagram({
    type: "architecture",
    title: "Checkout flow",
    nodes: [
      { id: "web", label: "Web", kind: "client" },
      { id: "api", label: "API", kind: "service" },
    ],
    edges: ["web -> api"],
  });
  return layoutDiagram(diagram!);
}
