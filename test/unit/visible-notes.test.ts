// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderSvg } from "../../src/render/svg.js";
import type { Scene, SceneNode } from "../../src/scene.js";
import { textWidth } from "../../src/text/measure.js";

async function scene(raw: object): Promise<Scene> {
  const { diagram, issues } = validateDiagram({ title: "T", ...raw });
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  return layoutDiagram(diagram!);
}

const nodeOf = (s: Scene, id: string): SceneNode => s.nodes.find((n) => n.id === id)!;

/** The markup of one node group, from its opening tag to the next node. */
function nodeMarkup(svg: string, id: string): string {
  const start = svg.indexOf(`data-id="${id}" data-kind`);
  const end = svg.indexOf('<g class="t-node', start + 1);
  return svg.slice(start, end === -1 ? undefined : end);
}

const noteText = (markup: string) =>
  [...markup.matchAll(/<text class="t-text t-node-note"[^>]*>(.*?)<\/text>/g)].map((m) =>
    [...m[1]!.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((t) => t[1]),
  );

const LONG =
  "Validates the session token, applies the rate limits per tenant, rewrites legacy paths, and forwards every request to the matching internal service";

describe("visible notes", () => {
  it("shows an architecture note as a muted subtitle below the label, inside a taller box", async () => {
    const withNote = await scene({
      type: "architecture",
      nodes: [{ id: "api", label: "API", kind: "service", note: "Handles checkout" }],
      edges: [],
    });
    const without = await scene({
      type: "architecture",
      nodes: [{ id: "api", label: "API", kind: "service" }],
      edges: [],
    });
    const api = nodeOf(withNote, "api");
    expect(api.h).toBeGreaterThan(nodeOf(without, "api").h);
    expect(api.subtitle?.lines).toEqual(["Handles checkout"]);
    expect(api.subtitle!.size).toBeLessThan(api.label.size);
    expect(api.subtitle!.y).toBeGreaterThan(api.label.y);
    expect(api.subtitle!.y).toBeLessThan(api.y + api.h);
    expect(api.subtitle!.x).toBe(api.label.x);

    const svg = renderSvg(withNote);
    expect(noteText(nodeMarkup(svg, "api"))).toEqual([["Handles checkout"]]);
    expect(svg).toContain(".t-node-note { fill: var(--t-muted, #5a6379); }");
    expect(nodeMarkup(svg, "api")).toContain("<desc>Handles checkout</desc>");
  });

  it("cuts a long note at three lines ending in an ellipsis and keeps the whole note in the tooltip", async () => {
    const s = await scene({
      type: "architecture",
      nodes: [{ id: "gw", label: "Gateway", kind: "gateway", note: LONG }],
      edges: [],
    });
    const gw = nodeOf(s, "gw");
    const lines = gw.subtitle!.lines;
    expect(lines).toHaveLength(3);
    expect(lines[2]!.endsWith("…")).toBe(true);
    for (const line of lines) {
      const width = textWidth(line, gw.subtitle!.size, 400);
      expect(width).toBeLessThanOrEqual(150);
      expect(gw.subtitle!.x + width).toBeLessThanOrEqual(gw.x + gw.w);
    }
    expect(nodeMarkup(renderSvg(s), "gw")).toContain(`<desc>${LONG}</desc>`);
  });

  it("shows notes on workflow boxes but leaves decisions, start and end with the tooltip only", async () => {
    const s = await scene({
      type: "workflow",
      steps: [
        { id: "s", label: "Start", kind: "start", note: "start note" },
        { id: "t", label: "Review", note: "Manager checks the receipt" },
        { id: "w", label: "Wait", kind: "wait", note: "Up to two days" },
        { id: "d", label: "Approved?", kind: "decision", note: "decision note" },
        { id: "e", label: "Done", kind: "end", note: "end note" },
      ],
      edges: ["s -> t", "t -> w", "w -> d", "d -> e: yes", "d -> t: no"],
    });
    const svg = renderSvg(s);
    const task = nodeOf(s, "t");
    expect(task.subtitle?.lines).toEqual(["Manager checks the receipt"]);
    expect(task.subtitle!.anchor).toBe("middle");
    expect(noteText(nodeMarkup(svg, "t"))).toEqual([["Manager checks the receipt"]]);
    const wait = nodeOf(s, "w");
    expect(wait.subtitle?.anchor).toBe("start");
    expect(wait.subtitle!.x).toBe(wait.label.x);
    for (const id of ["s", "d", "e"]) {
      expect(nodeOf(s, id).subtitle, id).toBeUndefined();
      expect(noteText(nodeMarkup(svg, id)), id).toEqual([]);
      expect(nodeMarkup(svg, id), id).toContain(
        `<desc>${id === "s" ? "start" : id === "d" ? "decision" : "end"} note</desc>`,
      );
    }
  });

  it("shows an ERD table note under the title and moves the rows and relations down with it", async () => {
    const tables = (note?: string) => [
      {
        id: "users",
        columns: [{ name: "id", type: "int", pk: true }],
        ...(note === undefined ? {} : { note }),
      },
      {
        id: "posts",
        columns: [
          { name: "id", type: "int", pk: true },
          { name: "user_id", type: "int", fk: "users.id", note: "column note" },
        ],
      },
    ];
    const withNote = await scene({ type: "erd", tables: tables("Accounts that sign in") });
    const without = await scene({ type: "erd", tables: tables() });
    const users = nodeOf(withNote, "users");
    const plain = nodeOf(without, "users");
    expect(users.header).toBeGreaterThan(plain.header!);
    expect(users.h - plain.h).toBe(users.header! - plain.header!);
    expect(users.w).toBe(plain.w);
    expect(users.subtitle?.lines).toEqual(["Accounts that sign in"]);
    expect(users.subtitle!.y).toBeGreaterThan(users.label.y);
    expect(users.subtitle!.y).toBeLessThan(users.y + users.header!);
    expect(users.rows![0]!.y).toBe(users.y + users.header!);
    const rel = withNote.edges[0]!;
    const atUsers = [rel.points[0]!, rel.points.at(-1)!].find(
      (p) => Math.abs(p.x - users.x) < 1 || Math.abs(p.x - (users.x + users.w)) < 1,
    )!;
    expect(atUsers.y).toBe(users.rows![0]!.y + users.rows![0]!.h / 2);

    const svg = renderSvg(withNote);
    expect(noteText(nodeMarkup(svg, "users"))).toEqual([["Accounts that sign in"]]);
    expect(noteText(nodeMarkup(svg, "posts"))).toEqual([]);
    expect(nodeMarkup(svg, "posts")).toContain("<desc>column note</desc>");
  });

  it("keeps sequence participant notes in the tooltip only", async () => {
    const s = await scene({
      type: "sequence",
      participants: [{ id: "a", note: "participant note" }, { id: "b" }],
      messages: [{ from: "a", to: "b", label: "hi" }],
    });
    expect(nodeOf(s, "a").subtitle).toBeUndefined();
    const svg = renderSvg(s);
    expect(noteText(nodeMarkup(svg, "a"))).toEqual([]);
    expect(nodeMarkup(svg, "a")).toContain("<desc>participant note</desc>");
  });

  it("treats a whitespace-only note as no note: no subtitle line and no taller box", async () => {
    const s = await scene({
      type: "architecture",
      nodes: [{ id: "api", label: "API", kind: "service", note: "   " }],
      edges: [],
    });
    expect(nodeOf(s, "api").subtitle).toBeUndefined();
    expect(nodeOf(s, "api").h).toBe(48);
    expect(renderSvg(s)).not.toContain('t-node-note"');
  });

  it("renders nodes without a note exactly as before: no subtitle and no note markup", async () => {
    const s = await scene({
      type: "architecture",
      nodes: [{ id: "api", label: "API", kind: "service" }],
      edges: [],
    });
    expect(nodeOf(s, "api").subtitle).toBeUndefined();
    expect(nodeOf(s, "api").h).toBe(48);
    expect(renderSvg(s)).not.toContain('t-node-note"');
  });
});
