// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderHtml } from "../../src/render/html.js";
import { renderSvg } from "../../src/render/svg.js";

const wf = (over: object = {}) => ({
  type: "workflow",
  title: "T",
  lanes: [
    { id: "a", label: "Alpha", steps: ["s1"] },
    { id: "b", label: "Beta", steps: ["s2"] },
  ],
  steps: [{ id: "s1" }, { id: "s2" }],
  edges: ["s1 -> s2"],
  ...over,
});

const erd = (table: object = {}) => ({
  type: "erd",
  title: "E",
  tables: [{ id: "users", columns: ["id uuid pk"], ...table }],
});

const issues = (raw: unknown) => validateDiagram(raw).issues;
const errors = (raw: unknown) => issues(raw).filter((i) => i.severity === "error");

async function scene(raw: unknown) {
  const { diagram } = validateDiagram(raw);
  if (diagram === undefined) throw new Error("invalid");
  return layoutDiagram(diagram);
}

describe("T23.2 optional fields", () => {
  it("accepts detail, lane note and table group, and rejects wrong types", () => {
    const ok = wf({
      lanes: [{ id: "a", note: "Intake", steps: ["s1", "s2"] }],
      steps: [{ id: "s1", detail: "Long text" }, { id: "s2" }],
    });
    expect(errors(ok)).toEqual([]);
    expect(errors(erd({ detail: "More", group: "core" }))).toEqual([]);

    const bad = (code: string, path: string) => ({
      severity: "error",
      code,
      path,
      message: "expected string, got number",
    });
    expect(errors(wf({ steps: [{ id: "s1", detail: 1 }, { id: "s2" }] }))).toEqual([
      bad("schema/type", "steps[0].detail"),
    ]);
    expect(errors(wf({ lanes: [{ id: "a", note: 1, steps: ["s1", "s2"] }] }))).toEqual([
      bad("schema/type", "lanes[0].note"),
    ]);
    expect(errors(erd({ detail: 1 }))).toEqual([bad("schema/type", "tables[0].detail")]);
    expect(errors(erd({ group: 1 }))).toEqual([bad("schema/type", "tables[0].group")]);
  });

  it("keeps the values on the model", () => {
    const { diagram } = validateDiagram(erd({ detail: "More", group: "core" }));
    expect(diagram?.type === "erd" && diagram.tables[0]).toMatchObject({
      detail: "More",
      group: "core",
    });
  });
});

describe("T23.2 lane role line", () => {
  const lanes = (note?: string) => [
    { id: "a", label: "Alpha", ...(note ? { note } : {}), steps: ["s1"] },
    { id: "b", label: "Beta", steps: ["s2"] },
  ];

  for (const direction of ["right", "down"]) {
    it(`shows a lane note as a muted line (${direction})`, async () => {
      const svg = renderSvg(await scene(wf({ direction, lanes: lanes("Intake") })));
      expect(svg.match(/class="t-text t-lane-note"/g)).toHaveLength(1);
      expect(svg).toContain("Intake");
    });
  }

  it("clips a long lane note with an ellipsis", async () => {
    const long = "A very long role description that cannot fit in the lane header at all";
    const svg = renderSvg(await scene(wf({ direction: "right", lanes: lanes(long) })));
    expect(svg).not.toContain(long);
    expect(svg).toMatch(/t-lane-note"[^>]*><tspan[^>]*>[^<]*…</);
  });

  it("renders lanes without a note as before", async () => {
    const svg = renderSvg(await scene(wf({ direction: "right" })));
    expect(svg).not.toContain("t-lane-note");
    expect(renderSvg(await scene(wf({ direction: "right", lanes: lanes() })))).toBe(svg);
  });
});

describe("T23.2 detail stays in the viewer", () => {
  it("embeds detail for the card but never in the svg", async () => {
    const raw = wf({ steps: [{ id: "s1", note: "short", detail: "SECRET-DETAIL" }, { id: "s2" }] });
    const s = await scene(raw);
    expect(s.nodes.find((n) => n.id === "s1")?.detail).toBe("SECRET-DETAIL");
    expect(renderSvg(s)).not.toContain("SECRET-DETAIL");
    const html = renderHtml(s);
    expect(html).toContain(`<script type="application/json" id="trazo-detail">`);
    expect(html).toContain('{"s1":"SECRET-DETAIL"}');
    expect(html.slice(0, html.indexOf('id="trazo-detail">'))).not.toContain("SECRET-DETAIL");
    expect(renderHtml(await scene(wf()))).not.toContain(`id="trazo-detail">`);
  });

  it("covers ERD tables too", async () => {
    const s = await scene(erd({ detail: "Table detail" }));
    expect(renderSvg(s)).not.toContain("Table detail");
    expect(renderHtml(s)).toContain('{"users":"Table detail"}');
  });
});

describe("T23.2 many lanes", () => {
  const lanesOf = (n: number) => ({
    lanes: Array.from({ length: n }, (_, i) => ({ id: `l${i}`, steps: [`s${i}`] })),
    steps: Array.from({ length: n }, (_, i) => ({ id: `s${i}` })),
    edges: [],
  });
  it("warns above 6 lanes only", () => {
    expect(issues(wf(lanesOf(6))).map((i) => i.code)).not.toContain("workflow/many-lanes");
    expect(issues(wf(lanesOf(7))).filter((i) => i.code === "workflow/many-lanes")).toEqual([
      {
        severity: "warning",
        code: "workflow/many-lanes",
        path: "lanes",
        message: "7 lanes",
        hint: "workflows read best with 6 lanes or fewer; consider splitting the process",
      },
    ]);
  });
});

describe("T23.2 lane role line width", () => {
  it("grows the rows header so a short label keeps a readable role line", async () => {
    const note = "Reviews, 2 days";
    const lanes = [
      { id: "a", label: "Alpha", note, steps: ["s1"] },
      { id: "b", label: "Beta", steps: ["s2"] },
    ];
    const svg = renderSvg(await scene(wf({ direction: "right", lanes })));
    expect(svg).toContain(note);
    expect(svg).not.toMatch(/t-lane-note"[^>]*><tspan[^>]*>[^<]*…</);
  });
});
