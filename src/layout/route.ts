// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Box, Point } from "../scene.js";

/** Minimum distance between a rerouted segment and an unrelated step. */
const CLEARANCE = 6;
/** Horizontal run out of a decision vertex before a loop turns. */
const LOOP_STUB = 16;
/** Distance between the lowest step a loop passes and its bottom run. */
const LOOP_GAP = 20;

interface Shaped extends Box {
  shape: string;
}

function hits(a: Point, b: Point, box: Box): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return (
    x0 < box.x + box.w + CLEARANCE &&
    x1 > box.x - CLEARANCE &&
    y0 < box.y + box.h + CLEARANCE &&
    y1 > box.y - CLEARANCE
  );
}

const clearOf = (points: Point[], obstacles: readonly Box[]) =>
  points.every((p, i) => i === 0 || obstacles.every((box) => !hits(points[i - 1]!, p, box)));

/**
 * Preset positions keep steps in their lanes, but ELK then places the dummy
 * nodes of long edges one layer at a time, which turns them into staircases.
 * Swap such a route for a straight line or a single Z when either is clear.
 */
export function straighten(
  points: Point[],
  from: Shaped,
  to: Shaped,
  obstacles: readonly Box[],
): Point[] {
  if (points.length <= 2) return points;
  const s = points[0]!;
  const e = points.at(-1)!;
  const eastToWest = Math.abs(s.x - (from.x + from.w)) < 1 && Math.abs(e.x - to.x) < 1 && s.x < e.x;
  if (!eastToWest) return points;

  const candidates: Point[][] = [];
  // Decisions own fixed vertices, so only a box end may slide along its side.
  if (from.shape !== "diamond" && e.y > from.y && e.y < from.y + from.h)
    candidates.push([{ x: s.x, y: e.y }, e]);
  if (to.shape !== "diamond" && s.y > to.y && s.y < to.y + to.h)
    candidates.push([s, { x: e.x, y: s.y }]);
  if (points.length > 4) {
    for (let i = 1; i + 2 < points.length; i++) {
      const x = points[i]!.x;
      if (x === points[i + 1]!.x && x > s.x && x < e.x) {
        candidates.push([s, { x, y: s.y }, { x, y: e.y }, e]);
      }
    }
  }
  return candidates.find((c) => clearOf(c, obstacles)) ?? points;
}

/**
 * Routes a back edge between two steps of one lane under that lane's row:
 * down from the source, back along the bottom, up into the target.
 */
export function loopUnder(from: Shaped, to: Shaped, laneSteps: readonly Box[]): Point[] {
  const cy = (b: Box) => b.y + b.h / 2;
  const exit =
    from.shape === "diamond"
      ? [
          { x: from.x + from.w, y: cy(from) },
          { x: from.x + from.w + LOOP_STUB, y: cy(from) },
        ]
      : [{ x: from.x + from.w / 2, y: from.y + from.h }];
  const entry =
    to.shape === "diamond"
      ? [
          { x: to.x - LOOP_STUB, y: cy(to) },
          { x: to.x, y: cy(to) },
        ]
      : [{ x: to.x + to.w / 2, y: to.y + to.h }];
  const xa = exit.at(-1)!.x;
  const xb = entry[0]!.x;
  const lo = Math.min(xa, xb);
  const hi = Math.max(xa, xb);
  const under = laneSteps.filter((b) => b.x <= hi && b.x + b.w >= lo);
  const y = Math.max(...[from, to, ...under].map((b) => b.y + b.h)) + LOOP_GAP;
  return [...exit, { x: xa, y }, { x: xb, y }, ...entry];
}
