// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { beforeAll, describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { SOURCE_CAP, renderHtml } from "../../src/render/html.js";
import { PALETTES } from "../../src/render/palettes.js";
import { pageCss } from "../../src/render/theme.js";
import { VIEWER_SCRIPT } from "../../src/render/viewer.js";
import type { Scene } from "../../src/scene.js";

const input = {
  type: "architecture",
  title: "Checkout flow",
  description: "How an order travels.",
  nodes: [
    { id: "web", label: "Web", kind: "client" },
    { id: "api", label: "API", kind: "service", note: "Public API", source: "src/api.ts:12" },
  ],
  edges: ["web -> api"],
};

let scene: Scene;
let diagram: unknown;
let html: string;

beforeAll(async () => {
  const result = validateDiagram(input);
  diagram = result.diagram;
  scene = await layoutDiagram(result.diagram!);
  html = renderHtml(scene, { source: diagram });
});

/** The text inside the page's <style> element. */
const css = pageCss("", "");

/** Removes every top-level @media block whose header contains `needle`. */
function withoutMedia(text: string, needle: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = text.indexOf("@media", i);
    if (at < 0) break;
    const open = text.indexOf("{", at);
    if (!text.slice(at, open).includes(needle)) {
      out += text.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    out += text.slice(i, at);
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < text.length) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    i = j;
  }
  return out + text.slice(i);
}

describe("header and toolbar", () => {
  it("has a labelled toolbar with every control and its aria label", () => {
    expect(html).toContain('role="toolbar" aria-label="Diagram tools"');
    for (const [id, label] of [
      ["zoom-out", "Zoom out"],
      ["zoom-in", "Zoom in"],
      ["fit", "Fit to screen"],
      ["fullscreen", "Enter full screen"],
    ]) {
      expect(html, id).toContain(`id="${id}" aria-label="${label}"`);
    }
    expect(html).toContain('id="search" type="search"');
    expect(html).toContain('aria-label="Find a node"');
    expect(html).toContain('<output id="zoom-pct"');
    expect(html).toContain('id="theme" aria-label="Change theme');
    expect(html).toContain('id="export" aria-label="Export diagram"');
  });

  it("shows the title and the description in the header", () => {
    expect(html).toMatch(/<header class="top">[\s\S]*<h1>Checkout flow<\/h1>/);
    expect(html).toContain('<p class="desc"');
    expect(html).toContain("How an order travels.");
  });

  it("groups the zoom controls and the page controls", () => {
    expect(html).toContain('<div class="group seg" role="group" aria-label="Zoom">');
    expect(html.match(/class="group/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps a visible focus ring on every control", () => {
    expect(css).toMatch(/:focus-visible \{ outline: 2px solid var\(--t-accent\)/);
  });

  it("wraps the toolbar on narrow screens and drops the minimap", () => {
    const narrow = css.slice(css.indexOf("@media (max-width: 900px)"));
    expect(narrow).toContain(".minimap { display: none; }");
    expect(narrow).toContain("flex-wrap: wrap");
  });

  it("uses an accent button label that reads on the accent in all four themes", () => {
    expect(css).toContain("color: var(--t-surface)");
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const [name, p] of Object.entries(PALETTES)) {
      const [a, b] = [lum(p.base.accent!), lum(p.base.surface!)].sort((x, y) => y - x);
      expect((a! + 0.05) / (b! + 0.05), name).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("brand", () => {
  it("shows the trazo logo in the header, the reversed one on dark themes", () => {
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    expect(header).toContain('<svg class="logo logo-light"');
    expect(header).toContain('<svg class="logo logo-dark"');
    expect(header).toContain('fill="#2f6fdb"');
    expect(header).toContain('fill="#6ea2f5"');
    expect(header).not.toContain("<title>");
    expect(header).toContain('aria-label="trazo"');
    const page = pageCss("", "");
    expect(page).toContain(".logo-dark { display: none; }");
    // No later rule may show the reversed logo again on light themes.
    const after = page.slice(page.indexOf(".logo-dark { display: none; }"));
    expect(after).not.toMatch(/(^|\n)\.logo \{[^}]*display/);
    for (const t of ["dark", "dusk"]) {
      expect(page).toContain(`[data-theme="${t}"] .logo-light`);
      expect(page).toContain(`[data-theme="${t}"] .logo-dark`);
    }
  });

  it("sets an SVG favicon that switches to the light mark in a dark browser", () => {
    const link =
      /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]+)">/.exec(html);
    expect(link).not.toBeNull();
    const svg = decodeURIComponent(link![1]!);
    expect(svg).toContain("prefers-color-scheme: dark");
    expect(svg).toContain("#2f6fdb");
  });
});

describe("theme switcher", () => {
  it("lists the four themes and marks the current one", () => {
    for (const [id, name] of [
      ["light", "Porcelain"],
      ["dark", "Graphite"],
      ["lagoon", "Lagoon"],
      ["dusk", "Dusk"],
    ]) {
      expect(html, id).toMatch(
        new RegExp(
          `role="menuitemradio" aria-checked="(true|false)" data-set-theme="${id}"[^>]*>[\\s\\S]*?<b>${name}</b>`,
        ),
      );
    }
    expect(html.match(/data-set-theme="[a-z]+"/g)?.length).toBeGreaterThanOrEqual(4);
    const dusk = renderHtml({ ...scene, theme: "dusk" });
    expect(dusk).toContain('<html lang="en" data-theme="dusk">');
    expect(dusk).toContain('aria-checked="true" data-set-theme="dusk"');
    expect(dusk).toContain('aria-checked="false" data-set-theme="light"');
  });

  it("changes data-theme on the page and sends nothing anywhere", () => {
    expect(VIEWER_SCRIPT).toContain('root.setAttribute("data-theme"');
    expect(VIEWER_SCRIPT).not.toMatch(/localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
  });
});

describe("export menu", () => {
  it("offers the eight formats in order", () => {
    const keys = [...html.matchAll(/data-export="([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual([
      "png1",
      "png2",
      "png-alpha",
      "svg",
      "pdf",
      "copy-png",
      "copy-svg",
      "copy-json",
    ]);
    expect(html).toContain('id="export-menu" popover="auto"');
    expect(html).toContain('role="menu" aria-label="Export formats"');
    expect(html).toContain('id="export-note" role="status"');
  });

  it("states the pixel size of the PNG formats", () => {
    expect(html).toMatch(/data-export="png1"[\s\S]*?<small>\d+ × \d+ px<\/small>/);
    expect(html).toMatch(/data-export="png2"[\s\S]*?<small>\d+ × \d+ px<\/small>/);
  });

  it("feature-detects the clipboard and reports failures without throwing", () => {
    expect(VIEWER_SCRIPT).toContain("navigator.clipboard");
    expect(VIEWER_SCRIPT).toContain("ClipboardItem");
    expect(VIEWER_SCRIPT).toContain("execCommand");
    expect(VIEWER_SCRIPT).toContain("Could not copy the image");
    expect(VIEWER_SCRIPT).toContain(".catch(");
  });

  it("prints only the diagram", () => {
    const print = css.slice(css.indexOf("@media print"));
    const hidden = /([^{}]+)\{ display: none !important; \}/.exec(print)?.[1] ?? "";
    for (const part of ["header", ".minimap", ".detail", ".credit", ".pop"]) {
      expect(hidden, part).toContain(part);
    }
    expect(VIEWER_SCRIPT).toContain("beforeprint");
    expect(VIEWER_SCRIPT).toContain("afterprint");
  });

  it("builds exports from the diagram only, with no viewer-only element", () => {
    for (const cls of ["t-find", "t-hit", "t-pick", "t-cur", "t-dim", "t-near"]) {
      expect(VIEWER_SCRIPT, cls).toContain(cls);
    }
    expect(VIEWER_SCRIPT).toContain('stage.querySelector("svg")');
    const stage = html.slice(html.indexOf('<div class="stage"'), html.indexOf("</main>"));
    const svg = stage.slice(0, stage.indexOf("</svg>") + 6);
    for (const viewerOnly of [
      "Made with trazo",
      "minimap",
      'id="search"',
      "export-menu",
      "detail",
    ]) {
      expect(svg, viewerOnly).not.toContain(viewerOnly);
    }
  });
});

describe("embedded JSON source", () => {
  it("embeds the normalized input as inert JSON", () => {
    const m = html.match(/<script type="application\/json" id="trazo-source">([^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual(JSON.parse(JSON.stringify(diagram)));
    expect(html).toMatch(/data-export="copy-json"(?![^>]*disabled)/);
  });

  it("cannot be broken out of by script or comment markers in the content", () => {
    const evil = { title: "</script><script>alert(1)</script><!--", note: "\u2028\u2029&" };
    const out = renderHtml(scene, { source: evil });
    const m = out.match(/id="trazo-source">([^<]*)<\/script>/);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual(evil);
    expect(m![1]).not.toMatch(/[<>\u2028\u2029]/);
    expect(out.match(/<script/g)).toHaveLength(2);
  });

  it("is left out above the cap and the item says so", () => {
    const big = { text: "x".repeat(SOURCE_CAP) };
    const out = renderHtml(scene, { source: big });
    expect(out).not.toContain('id="trazo-source"');
    expect(out).toMatch(
      /data-export="copy-json" disabled[\s\S]*?<small>[^<]*too large[^<]*<\/small>/,
    );
    expect(SOURCE_CAP).toBe(64 * 1024);
  });

  it("is left out when no source is given", () => {
    const out = renderHtml(scene);
    expect(out).not.toContain('id="trazo-source"');
    expect(out).toMatch(/data-export="copy-json" disabled/);
  });
});

describe("search, minimap and detail card", () => {
  it("has the search field with its shortcut hint and a result count", () => {
    expect(html).toContain("<kbd>/</kbd>");
    expect(html).toContain('<output id="found"');
    for (const key of ['"/"', '"Escape"', '"Enter"']) expect(VIEWER_SCRIPT).toContain(key);
  });

  it("shows the minimap only while part of the diagram is off screen", () => {
    // It starts hidden in the markup and sync() decides after every view change.
    expect(html).toContain('id="minimap" aria-hidden="true" hidden>');
    expect(VIEWER_SCRIPT).toContain('$("minimap").hidden = fits');
    expect(VIEWER_SCRIPT).toContain("var fits = ");
    // Building the minimap must not reveal it on its own.
    expect(VIEWER_SCRIPT).not.toContain('$("minimap").hidden = false');
    expect(css).toContain(".minimap { display: none; }");
  });

  it("places the minimap and the detail card beside the diagram, not in it", () => {
    expect(html).toContain('<div class="minimap" id="minimap" aria-hidden="true" hidden>');
    expect(html).toContain('<aside class="detail" id="detail" aria-label="Node details" hidden>');
    expect(html.indexOf('id="minimap"')).toBeGreaterThan(html.indexOf("</svg>"));
    expect(html.indexOf('id="detail"')).toBeGreaterThan(html.indexOf("</svg>"));
  });

  it("tags nodes with their source so the card can tell it from the note", () => {
    expect(html).toContain('data-source="src/api.ts:12"');
    expect(html).not.toContain('data-source=""');
  });
});

describe("motion", () => {
  it("runs no transition or animation unless the reader allows motion", () => {
    const rest = withoutMedia(css, "prefers-reduced-motion: no-preference");
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(rest).not.toMatch(/transition\s*:|animation\s*:/);
  });
});

describe("existing viewer behavior still holds", () => {
  it("keeps pan, zoom, the hover highlight and the exports in the script", () => {
    for (const part of ["zoomAt", "panBy", "wheel", "pointerdown", "t-dim", "t-near"]) {
      expect(VIEWER_SCRIPT, part).toContain(part);
    }
    expect(VIEWER_SCRIPT).toContain("image/svg+xml");
    expect(VIEWER_SCRIPT).toContain("image/png");
    expect(css).toContain(
      ".t-dim :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline):not(.t-near)",
    );
  });

  it("opens fitted: the view starts at the diagram's own viewBox", () => {
    expect(VIEWER_SCRIPT).toContain("var view = base;");
  });
});
