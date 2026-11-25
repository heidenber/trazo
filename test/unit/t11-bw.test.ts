// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderHtml } from "../../src/render/html.js";
import { THEME_VARS } from "../../src/render/theme.js";
import { renderSvg } from "../../src/render/svg.js";
import { VIEWER_SCRIPT, bwCss } from "../../src/render/viewer.js";

const INK = "#000000";
const PAPER = "#ffffff";
const examples = ["chen", "state", "class", "architecture", "workflow", "erd", "sequence"];

async function svgOf(name: string): Promise<{ svg: string; html: string }> {
  const input = JSON.parse(readFileSync(`examples/${name}.json`, "utf8")) as unknown;
  const { diagram } = validateDiagram(input);
  const scene = await layoutDiagram(diagram!);
  return { svg: renderSvg(scene), html: renderHtml(scene) };
}

/** Colors written as literals, outside the fallback of a var(). */
function literalColors(text: string): string[] {
  const noFallbacks = text.replace(/var\(--t-[a-z-]+,[^;}]*?\)(?=[;} ]|$)/g, "var()");
  return noFallbacks.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? [];
}

describe("black and white export", () => {
  it("offers PNG, SVG and print variants in the export popover, for every type", async () => {
    for (const name of examples) {
      const { html } = await svgOf(name);
      const keys = [...html.matchAll(/data-export="([a-z0-9-]+)"/g)].map((m) => m[1]);
      expect(keys, name).toEqual(expect.arrayContaining(["png-bw", "svg-bw", "pdf-bw"]));
      expect(html, name).toContain('aria-label="Black and white"');
    }
  });

  it("maps every theme variable to ink, white or transparent", () => {
    const css = bwCss(THEME_VARS);
    for (const name of THEME_VARS) expect(css).toContain(`${name}:`);
    const values = [...css.matchAll(/--t-[a-z-]+:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(values.length).toBe(THEME_VARS.length);
    for (const v of values) expect([INK, PAPER, "transparent"]).toContain(v);
    expect(css).toContain(`--t-text: ${INK}`);
    expect(css).toContain(`--t-edge-async: ${INK}`);
    expect(css).toContain(`--t-fam-data-fill: ${PAPER}`);
    expect(css).toContain(`--t-fam-data-stroke: ${INK}`);
    expect(css).toContain(`--t-card: ${PAPER}`);
  });

  it("leaves no colored paint in any diagram once the variables are mapped", async () => {
    const css = bwCss(THEME_VARS);
    const overridden = new Set([...css.matchAll(/(--t-[a-z-]+):/g)].map((m) => m[1]));
    const grey = css.replace(/--t-[a-z-]+:[^;]+;/g, "");
    for (const name of examples) {
      const { svg } = await svgOf(name);
      expect(literalColors(svg), name).toEqual([]);
      for (const m of svg.matchAll(/var\((--t-[a-z-]+)(?:,\s*([^;)}]*))?/g)) {
        const v = m[1]!;
        // The family variables are defined from --t-fam-*, which are overridden.
        if (v === "--t-f-fill" || v === "--t-f-stroke") continue;
        // A variable the themes never define keeps its fallback, which must not be a color.
        const ok = overridden.has(v) || ["transparent", "none"].includes((m[2] ?? "").trim());
        expect(ok, `${name} ${v}`).toBe(true);
      }
      expect(literalColors(grey)).toEqual([]);
    }
  });

  it("keeps dashes, double lines, underlines and markers: no rule drops them", () => {
    const css = bwCss(THEME_VARS);
    expect(css).not.toMatch(/dasharray|stroke-width|marker|text-decoration|display\s*:\s*none/);
    expect(css).toContain("fill-opacity: 1");
  });

  it("is applied to the cloned export only, never to the inline SVG", () => {
    const build = VIEWER_SCRIPT.slice(
      VIEWER_SCRIPT.indexOf("var build ="),
      VIEWER_SCRIPT.indexOf("var slug"),
    );
    expect(build).toContain("function (bg, bw)");
    expect(build).toContain("bwCss(vars)");
    expect(build).toContain("copy.setAttribute");
    expect(build).not.toMatch(/\bsvg\.(setAttribute|classList|style)/);
    const actions = VIEWER_SCRIPT.slice(VIEWER_SCRIPT.indexOf("var actions ="));
    expect(actions).toMatch(/"png-bw": function \(\) \{ return png\(1, true, true\)/);
    expect(actions).toMatch(/"svg-bw": function \(\) \{ save\(new Blob\(\[build\(true, true\)\]/);
    // The ordinary exports are untouched.
    expect(actions).toContain("png1: function () { return png(1, true)");
    expect(actions).toContain("svg: function () { save(new Blob([build(true)]");
  });

  it("prints in black and white only while the print dialog is open", () => {
    const before = VIEWER_SCRIPT.slice(
      VIEWER_SCRIPT.indexOf('addEventListener("beforeprint"'),
      VIEWER_SCRIPT.indexOf('addEventListener("afterprint"'),
    );
    expect(before).toContain("printBw");
    expect(before).toContain("bwCss(vars, ");
    const after = VIEWER_SCRIPT.slice(VIEWER_SCRIPT.indexOf('addEventListener("afterprint"'));
    expect(after.slice(0, 400)).toContain("t-bw");
    expect(after.slice(0, 400)).toContain("printBw = false");
  });
});
