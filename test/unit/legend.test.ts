// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { make } from "../../src/index.js";
import { addLegend } from "../../src/layout/legend.js";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderSvg } from "../../src/render/svg.js";
import type { Scene } from "../../src/scene.js";

const example = (type: string) =>
  JSON.parse(readFileSync(new URL(`../../examples/${type}.json`, import.meta.url), "utf8"));

async function sceneOf(input: unknown): Promise<Scene> {
  const { diagram, issues } = validateDiagram(input);
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return layoutDiagram(diagram!);
}

const arch = (nodes: object[], edges: unknown[]) => ({
  type: "architecture",
  title: "t",
  nodes,
  edges,
});

const legendOf = (svg: string) => svg.slice(svg.indexOf('<g class="t-legend">'));
const labels = (svg: string) =>
  [...svg.matchAll(/<text class="t-text t-legend-label"[^>]*><tspan[^>]*>([^<]*)</g)].map(
    (m) => m[1],
  );

describe("legend entries", () => {
  it("lists the used families then the used styles in a fixed order", async () => {
    const scene = await sceneOf(
      arch(
        [
          { id: "q", kind: "queue" },
          { id: "c", kind: "client" },
          { id: "d", kind: "database" },
          { id: "s", kind: "service" },
        ],
        ["c -> s", "s ~> q", { from: "s", to: "d", style: "data" }],
      ),
    );
    expect(labels(renderSvg(scene))).toEqual([
      "Compute",
      "Data",
      "Messaging",
      "Client",
      "Sync",
      "Async",
      "Data flow",
    ]);
  });

  it("names workflow and sequence entries from their own families", async () => {
    const wf = labels(renderSvg(await sceneOf(example("workflow"))));
    expect(wf).toEqual(["Start", "End", "Decision", "Wait", "Task", "Sync", "Async"]);
    const seq = labels(renderSvg(await sceneOf(example("sequence"))));
    expect(seq).toEqual([
      "Compute",
      "Data",
      "Messaging",
      "Client",
      "External",
      "Sync",
      "Async",
      "Reply",
    ]);
  });

  it("omits the legend for one family and one style", async () => {
    const svg = renderSvg(await sceneOf(arch([{ id: "a" }, { id: "b" }], ["a -> b"])));
    expect(svg).not.toContain("t-legend");
  });

  it("omits the legend for an ERD", async () => {
    const scene = await sceneOf(example("erd"));
    expect(scene.legend).toBeUndefined();
    expect(renderSvg(scene)).not.toContain("t-legend");
  });

  it("shows the legend with one family and two styles, or two families and one style", async () => {
    const styles = renderSvg(await sceneOf(arch([{ id: "a" }, { id: "b" }], ["a -> b", "b ~> a"])));
    expect(labels(styles)).toEqual(["Compute", "Sync", "Async"]);
    const fams = renderSvg(
      await sceneOf(arch([{ id: "a" }, { id: "b", kind: "database" }], ["a -> b"])),
    );
    expect(labels(fams)).toEqual(["Compute", "Data", "Sync"]);
  });
});

describe("legend placement", () => {
  it("grows the scene below the diagram and keeps entries inside its width", async () => {
    for (const type of ["architecture", "workflow", "sequence"]) {
      const { diagram } = validateDiagram(example(type));
      const base = await layoutDiagram(diagram!);
      const { legend } = base;
      expect(legend, type).toBeDefined();
      for (const item of legend!) {
        expect(item.swatch.x, type).toBeGreaterThanOrEqual(0);
        expect(item.label.x + 1, type).toBeLessThan(base.width);
        expect(item.swatch.y, type).toBeGreaterThanOrEqual(
          Math.max(...base.nodes.map((n) => n.y + n.h)),
        );
        expect(item.swatch.y + item.swatch.h, type).toBeLessThanOrEqual(base.height);
      }
    }
  });

  it("wraps into rows within a narrow scene and adds the rows to the height", async () => {
    const plain = await sceneOf(
      arch(
        [{ id: "a" }, { id: "b", kind: "database" }, { id: "c", kind: "queue" }],
        ["a -> b", "b ~> c"],
      ),
    );
    const { legend: _l, ...bare } = plain;
    const wide = addLegend({ ...bare, width: 1000, height: 300 });
    const narrow = addLegend({ ...bare, width: 220, height: 300 });
    const rows = (s: Scene) => new Set(s.legend!.map((i) => i.swatch.y)).size;
    expect(rows(wide)).toBe(1);
    expect(rows(narrow)).toBeGreaterThan(1);
    expect(wide.height).toBeGreaterThan(300);
    expect(narrow.height).toBeGreaterThan(wide.height);
    for (const i of narrow.legend!) expect(i.label.x).toBeLessThan(220);
  });

  it("changes nothing when there is nothing to show", async () => {
    const plain = await sceneOf(arch([{ id: "a" }, { id: "b" }], ["a -> b"]));
    expect(addLegend(plain)).toEqual(plain);
  });

  it("is part of the viewBox", async () => {
    const scene = await sceneOf(example("architecture"));
    expect(renderSvg(scene)).toContain(`viewBox="0 0 ${scene.width} ${scene.height}"`);
  });
});

describe("legend markup", () => {
  it("never carries data-id or data-edge nor the node and edge classes the viewer dims", async () => {
    const svg = renderSvg(await sceneOf(example("architecture")));
    const legend = legendOf(svg);
    expect(legend).toContain("t-legend-item");
    expect(legend).not.toMatch(/data-id|data-edge|data-from|data-to|tabindex|<desc/);
    expect(legend).not.toMatch(/class="([^"]* )?t-(node|edge|lifeline)( [^"]*)?"/);
  });

  it("colors family swatches like nodes and style swatches like edges", async () => {
    const svg = renderSvg(await sceneOf(example("architecture")));
    expect(svg).toMatch(/<g class="t-legend-item t-fam-compute"><rect class="t-legend-swatch"/);
    expect(svg).toMatch(/<line class="t-legend-line t-legend-async"/);
    expect(svg).toContain(".t-legend-async { stroke: var(--t-edge-async");
  });

  it("stays out of diagrams without a legend", async () => {
    const svg = renderSvg(await sceneOf(example("erd")));
    expect(svg).not.toContain(".t-legend");
  });

  it("is byte-identical across runs and inside the page budget", async () => {
    for (const type of ["architecture", "workflow", "sequence"]) {
      const text = JSON.stringify(example(type));
      const a = await make(text);
      const b = await make(text);
      expect(a.html).toBe(b.html);
      expect(Buffer.byteLength(a.html!)).toBeLessThan(300 * 1024);
    }
  });
});
