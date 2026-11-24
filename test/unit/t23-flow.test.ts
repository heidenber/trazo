// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderHtml } from "../../src/render/html.js";
import { pageCss } from "../../src/render/theme.js";
import { VIEWER_SCRIPT } from "../../src/render/viewer.js";

async function page(name: string): Promise<string> {
  const raw = JSON.parse(readFileSync(`examples/${name}.json`, "utf8"));
  const { diagram } = validateDiagram(raw);
  return renderHtml(await layoutDiagram(diagram!));
}

const css = pageCss("", "");
const toggle = /<button[^>]*id="flow"[^>]*>/;

describe("Flow toggle", () => {
  it.each(["workflow", "architecture", "sequence"])("is in the toolbar of a %s", async (name) => {
    const html = await page(name);
    const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
    const button = toggle.exec(header)![0];
    expect(button).toContain('type="button"');
    expect(button).toContain("aria-pressed=");
    expect(header).toMatch(/id="flow"[^>]*>[\s\S]*?Flow<\/span>/);
  });

  it("is absent from an ERD page", async () => {
    const html = await page("erd");
    expect(html).not.toMatch(toggle);
    expect(html).not.toContain("Flow</span>");
  });

  it("starts on", async () => {
    expect(toggle.exec(await page("workflow"))![0]).toContain('aria-pressed="true"');
  });

  it("starts off under prefers-reduced-motion, and the user can still turn it on", () => {
    expect(VIEWER_SCRIPT).toContain("(prefers-reduced-motion: reduce)");
    expect(VIEWER_SCRIPT).toMatch(/setFlow\(!?[\w.()" :-]*matches/);
    expect(VIEWER_SCRIPT).toContain('flow.addEventListener("click"');
  });
});

describe("Flow beads", () => {
  it("are made by the viewer script, never by the diagram markup", async () => {
    const html = await page("workflow");
    const svg = html.slice(
      html.indexOf("<svg", html.indexOf('class="stage"')),
      html.indexOf("</svg>\n  </div>"),
    );
    expect(svg).not.toContain("t-flow");
    expect(svg).not.toContain("t-bead");
    expect(VIEWER_SCRIPT).toContain("animateMotion");
  });

  it("are stripped from every export and hidden in print", () => {
    const build = VIEWER_SCRIPT.slice(VIEWER_SCRIPT.indexOf("var build = "));
    expect(build.slice(0, build.indexOf("var slug"))).toContain('all(".t-flow", copy)');
    expect(css).toMatch(/@media print \{[^@]*\.t-flow[^}]*display: none/);
  });

  it("are bounded per edge, run on SMIL and pause with the page", () => {
    expect(VIEWER_SCRIPT).toContain("Math.min(3");
    expect(VIEWER_SCRIPT).toContain("visibilitychange");
    expect(VIEWER_SCRIPT).toContain("pauseAnimations");
    expect(VIEWER_SCRIPT).not.toContain("requestAnimationFrame");
  });
});
