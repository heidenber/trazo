// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Point } from "../scene.js";

/** Outer outline of a Chen element; `hw` and `hh` are the half sizes of its bounding box. */
export interface Shape {
  kind: "rect" | "diamond" | "ellipse";
  cx: number;
  cy: number;
  hw: number;
  hh: number;
}

const unit = (a: Point, b: Point): Point => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};

/** t >= 0 with p + t*u on the outline of `s`; p must be inside the shape. */
export function exitT(s: Shape, p: Point, u: Point): number {
  const x = p.x - s.cx;
  const y = p.y - s.cy;
  if (s.kind === "rect") {
    const tx = u.x > 0 ? (s.hw - x) / u.x : u.x < 0 ? (-s.hw - x) / u.x : Infinity;
    const ty = u.y > 0 ? (s.hh - y) / u.y : u.y < 0 ? (-s.hh - y) / u.y : Infinity;
    return Math.min(tx, ty);
  }
  if (s.kind === "diamond") {
    const hyp = Math.hypot(s.hw, s.hh);
    const d = (s.hw * s.hh) / hyp;
    let t = Infinity;
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        const n = { x: (sx * s.hh) / hyp, y: (sy * s.hw) / hyp };
        const nu = n.x * u.x + n.y * u.y;
        if (nu > 1e-9) t = Math.min(t, (d - (n.x * x + n.y * y)) / nu);
      }
    }
    return t;
  }
  const a = (u.x / s.hw) ** 2 + (u.y / s.hh) ** 2;
  const b = 2 * ((x * u.x) / s.hw ** 2 + (y * u.y) / s.hh ** 2);
  const c = (x / s.hw) ** 2 + (y / s.hh) ** 2 - 1;
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
}

/** The point where the ray from `from` (inside `s`) toward `toward` leaves `s`. */
export function leave(s: Shape, from: Point, toward: Point): Point {
  const u = unit(from, toward);
  const t = exitT(s, from, u);
  return { x: from.x + u.x * t, y: from.y + u.y * t };
}

/**
 * Moves the end of a polyline onto the outline of the shape it belongs to. The end line is
 * extended or cut along its own direction, so a straight run stays straight: the point is where
 * the line through the end segment crosses the outline.
 */
export function clipEnd(s: Shape, pts: Point[], atStart: boolean): void {
  const i = atStart ? 0 : pts.length - 1;
  const p = pts[i]!;
  const q = pts[atStart ? 1 : pts.length - 2]!;
  const u = unit(p, q);
  // The centre projected on the line is inside the shape whenever the line crosses it.
  const k = (s.cx - p.x) * u.x + (s.cy - p.y) * u.y;
  const inner = { x: p.x + u.x * k, y: p.y + u.y * k };
  const t = exitT(s, inner, u);
  pts[i] = { x: inner.x + u.x * t, y: inner.y + u.y * t };
}

/** The polyline shifted sideways by `d` (to its left), corners joined by the intersection of the shifted legs. */
export function offsetPolyline(pts: Point[], d: number): Point[] {
  const legs = pts.slice(1).map((b, i) => {
    const a = pts[i]!;
    const u = unit(a, b);
    return { a: { x: a.x + u.y * d, y: a.y - u.x * d }, u, len: Math.hypot(b.x - a.x, b.y - a.y) };
  });
  return pts.map((p, i) => {
    const prev = legs[i - 1];
    const next = legs[i];
    if (prev === undefined) return next!.a;
    if (next === undefined) {
      return { x: prev.a.x + prev.u.x * prev.len, y: prev.a.y + prev.u.y * prev.len };
    }
    const cross = prev.u.x * next.u.y - prev.u.y * next.u.x;
    if (Math.abs(cross) < 1e-9) return next.a;
    const t = ((next.a.x - prev.a.x) * next.u.y - (next.a.y - prev.a.y) * next.u.x) / cross;
    return { x: prev.a.x + prev.u.x * t, y: prev.a.y + prev.u.y * t };
  });
}
