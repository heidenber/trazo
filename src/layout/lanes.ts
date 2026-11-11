// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Workflow } from "../model/workflow.js";
import type { Box, SceneGroup } from "../scene.js";
import { firstBaseline, lineHeight, textWidth } from "../text/measure.js";

const LANE_LABEL_SIZE = 12;
const HEADER_PAD = 24;
const HEADER_MIN = 64;
const LABEL_X = 12;
/** Vertical margin between a lane's steps and its band edge. */
export const BAND_PAD = 24;
/** Extra room between lanes so edges can run between them. */
const LANE_GAP = 24;

const half = (v: number) => Math.round(v * 2) / 2;

/** Edge indices that close a cycle, found by DFS from the entry steps. */
export function findBackEdges(w: Workflow): Set<number> {
  const out = new Map<string, number[]>();
  w.edges.forEach((e, i) => out.set(e.from, [...(out.get(e.from) ?? []), i]));
  const hasIncoming = new Set(w.edges.map((e) => e.to));
  const starts = w.steps.filter((s) => s.kind === "start").map((s) => s.id);
  const entries =
    starts.length > 0 ? starts : w.steps.filter((s) => !hasIncoming.has(s.id)).map((s) => s.id);

  const back = new Set<number>();
  const state = new Map<string, "open" | "done">();
  const visit = (id: string) => {
    state.set(id, "open");
    for (const i of out.get(id) ?? []) {
      const to = w.edges[i]!.to;
      const s = state.get(to);
      if (s === "open") back.add(i);
      else if (s === undefined) visit(to);
    }
    state.set(id, "done");
  };
  for (const id of [...entries, ...w.steps.map((s) => s.id)]) if (!state.has(id)) visit(id);
  return back;
}

/** Longest-path rank of every step, ignoring back edges. */
export function rankSteps(w: Workflow, back: ReadonlySet<number>): Map<string, number> {
  const incoming = new Map<string, string[]>();
  w.edges.forEach((e, i) => {
    if (!back.has(i)) incoming.set(e.to, [...(incoming.get(e.to) ?? []), e.from]);
  });
  const rank = new Map<string, number>();
  const of = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    const r = Math.max(-1, ...(incoming.get(id) ?? []).map(of)) + 1;
    rank.set(id, r);
    return r;
  };
  for (const s of w.steps) of(s.id);
  return rank;
}

export interface LanePlan {
  /** Preset top-left of each step, relative to the content origin. */
  positions: Map<string, { x: number; y: number }>;
}

export function planLanes(
  w: Workflow,
  sizes: ReadonlyMap<string, { width: number; height: number }>,
  columnGap: number,
  rowGap: number,
): LanePlan {
  const rank = rankSteps(w, findBackEdges(w));
  const maxW = Math.max(...[...sizes.values()].map((s) => s.width));
  const maxH = Math.max(...[...sizes.values()].map((s) => s.height));
  const columnPitch = maxW + columnGap;
  const rowPitch = maxH + rowGap;

  const positions = new Map<string, { x: number; y: number }>();
  let top = 0;
  for (const lane of w.lanes) {
    const rowOf = new Map<number, number>();
    let rows = 0;
    for (const id of w.steps.map((s) => s.id).filter((id) => lane.steps.includes(id))) {
      const r = rank.get(id)!;
      const row = rowOf.get(r) ?? 0;
      rowOf.set(r, row + 1);
      rows = Math.max(rows, row + 1);
      const size = sizes.get(id)!;
      // Centre inside the cell so layering by centre position stays consistent.
      positions.set(id, {
        x: r * columnPitch + (maxW - size.width) / 2,
        y: top + row * rowPitch + (maxH - size.height) / 2,
      });
    }
    top += rows * rowPitch + LANE_GAP;
  }
  return { positions };
}

export function headerWidth(w: Workflow): number {
  const widest = Math.max(...w.lanes.map((l) => textWidth(l.label, LANE_LABEL_SIZE, 600)));
  return Math.max(HEADER_MIN, Math.ceil(widest + HEADER_PAD));
}

/**
 * Bands cover each lane's steps, and anything drawn under them (`reach`), plus
 * a margin. Neighbouring bands meet at the midpoint of the gap between them,
 * and the outer bands reach the canvas edge.
 */
export function buildBands(
  w: Workflow,
  boxes: ReadonlyMap<string, Box>,
  width: number,
  height: number,
  header: number,
  reach: ReadonlyMap<string, number> = new Map(),
): SceneGroup[] {
  const extents = w.lanes.map((lane) => {
    const bs = lane.steps.map((id) => boxes.get(id)!);
    const bottom = Math.max(reach.get(lane.id) ?? -Infinity, ...bs.map((b) => b.y + b.h));
    return { top: Math.min(...bs.map((b) => b.y)) - BAND_PAD, bottom: bottom + BAND_PAD };
  });
  const edges = [
    0,
    ...extents.slice(1).map((e, i) => half((extents[i]!.bottom + e.top) / 2)),
    height,
  ];

  return w.lanes.map((lane, i): SceneGroup => {
    const y = edges[i]!;
    const h = edges[i + 1]! - y;
    return {
      id: lane.id,
      x: 0,
      y,
      w: width,
      h,
      depth: 0,
      variant: "lane",
      header,
      label: {
        lines: [lane.label],
        x: LABEL_X,
        y: half(y + (h - lineHeight(LANE_LABEL_SIZE)) / 2 + firstBaseline(LANE_LABEL_SIZE)),
        size: LANE_LABEL_SIZE,
        weight: 600,
        anchor: "start",
      },
    };
  });
}

/** ELK should never move a step out of its lane; a diagram that lies about ownership is worse than an error. */
export function assertStepsInLanes(
  lanes: readonly { id: string; steps: readonly string[] }[],
  bands: readonly { id: string; y: number; h: number }[],
  boxes: ReadonlyMap<string, Box>,
): void {
  for (const lane of lanes) {
    const band = bands.find((b) => b.id === lane.id)!;
    for (const id of lane.steps) {
      const box = boxes.get(id)!;
      if (box.y < band.y || box.y + box.h > band.y + band.h) {
        throw new Error(`step "${id}" left its lane "${lane.id}"`);
      }
    }
  }
}
