// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Box, NodeShape, Point, SceneGroup } from "../scene.js";
import { CARD_RADIUS } from "./card.js";

const CORNER = 8;
export const TABLE_RADIUS = 10;
/** Corner radius of an orthogonal edge. */
const EDGE_RADIUS = 10;
/** The last leg keeps this much straight line for the arrowhead. */
const ARROW_LEG = 9;
/** Crow's foot symbols are 20 px long and sit at both ends. */
const END_LEG = 20;
const END_INSET = 3;
const SUBPROCESS_INSET = 8;
const NOTE_FOLD = 10;

export const num = (n: number) => String(Math.round(n * 100) / 100);

export const rect = (b: Box, cls: string, rx = CORNER, extra = "") =>
  `<rect class="${cls}" x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="${num(rx)}"${extra}/>`;

/** Shapes drawn with the soft shadow; the filter is defined once when one of them is present. */
export const SHADOWED: readonly NodeShape[] = ["box", "subprocess", "diamond", "table"];
export const SHADOW_ID = "t-shadow";
const SHADOW = ` filter="url(#${SHADOW_ID})"`;

/**
 * Path of an edge: straight legs joined by small quadratic corners. Each corner is cut back by
 * at most half of its shorter leg, and the last corner leaves a straight run for the arrowhead
 * (both ends leave one for crow's foot symbols).
 */
export function pathData(points: Point[], radius = EDGE_RADIUS, ends = false): string {
  const [first, ...rest] = points;
  if (first === undefined) return "";
  const parts = [`M${num(first.x)} ${num(first.y)}`];
  rest.forEach((cur, k) => {
    const prev = points[k]!;
    const next = points[k + 2];
    if (next === undefined) return void parts.push(`L${num(cur.x)} ${num(cur.y)}`);
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const straight =
      Math.abs((cur.x - prev.x) * (next.y - cur.y) - (cur.y - prev.y) * (next.x - cur.x)) < 1e-6;
    const last = points[k + 3] === undefined;
    const r = Math.min(
      radius,
      l1 / 2,
      l2 / 2,
      last ? l2 - (ends ? END_LEG : ARROW_LEG) : Infinity,
      ends && k === 0 ? l1 - END_LEG : Infinity,
    );
    if (straight || r < 1) return void parts.push(`L${num(cur.x)} ${num(cur.y)}`);
    const a = { x: cur.x - ((cur.x - prev.x) / l1) * r, y: cur.y - ((cur.y - prev.y) / l1) * r };
    const b = { x: cur.x + ((next.x - cur.x) / l2) * r, y: cur.y + ((next.y - cur.y) / l2) * r };
    parts.push(`L${num(a.x)} ${num(a.y)}`, `Q${num(cur.x)} ${num(cur.y)} ${num(b.x)} ${num(b.y)}`);
  });
  return parts.join(" ");
}

const line = (x1: number, y1: number, x2: number, y2: number, cls: string) =>
  `<line class="${cls}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`;

export function shapeMarkup(shape: NodeShape, b: Box): string {
  const cls = "t-node-box";
  switch (shape) {
    case "box":
      return rect(b, cls, CARD_RADIUS, SHADOW);
    case "pill":
      return rect(b, cls, b.h / 2);
    case "end": {
      const inner: Box = {
        x: b.x + END_INSET,
        y: b.y + END_INSET,
        w: b.w - 2 * END_INSET,
        h: b.h - 2 * END_INSET,
      };
      return rect(b, cls, b.h / 2) + rect(inner, `${cls} t-node-inner`, inner.h / 2);
    }
    case "diamond": {
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const pts = [
        `${num(cx)},${num(b.y)}`,
        `${num(b.x + b.w)},${num(cy)}`,
        `${num(cx)},${num(b.y + b.h)}`,
        `${num(b.x)},${num(cy)}`,
      ];
      return `<polygon class="${cls}" points="${pts.join(" ")}"${SHADOW}/>`;
    }
    case "table":
      return rect(b, "t-table", TABLE_RADIUS, SHADOW);
    case "note": {
      const r = b.x + b.w;
      const pts = [
        `${num(b.x)},${num(b.y)}`,
        `${num(r - NOTE_FOLD)},${num(b.y)}`,
        `${num(r)},${num(b.y + NOTE_FOLD)}`,
        `${num(r)},${num(b.y + b.h)}`,
        `${num(b.x)},${num(b.y + b.h)}`,
      ];
      return `<polygon class="${cls} t-note" points="${pts.join(" ")}"/><path class="t-note-fold" d="M${num(r - NOTE_FOLD)} ${num(b.y)}V${num(b.y + NOTE_FOLD)}H${num(r)}"/>`;
    }
    case "subprocess":
      return (
        rect(b, cls, CARD_RADIUS, SHADOW) +
        line(b.x + SUBPROCESS_INSET, b.y, b.x + SUBPROCESS_INSET, b.y + b.h, "t-node-rule") +
        line(
          b.x + b.w - SUBPROCESS_INSET,
          b.y,
          b.x + b.w - SUBPROCESS_INSET,
          b.y + b.h,
          "t-node-rule",
        )
      );
  }
}

export function laneMarkup(g: SceneGroup, odd: boolean, label: string): string {
  const cls = odd ? "t-lane t-lane-odd" : "t-lane";
  const band = `<rect class="t-lane-band" x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.h)}"/>`;
  if (g.columns) {
    const right = g.x + g.w;
    const top = `<rect class="t-lane-header" x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.header ?? 0)}"/>`;
    return `<g class="${cls}" data-id="${g.id}">${band}${top}${line(right, g.y, right, g.y + g.h, "t-lane-rule")}${label}</g>`;
  }
  const bottom = g.y + g.h;
  const header = `<rect class="t-lane-header" x="${num(g.x)}" y="${num(g.y)}" width="${num(g.header ?? 0)}" height="${num(g.h)}"/>`;
  return `<g class="${cls}" data-id="${g.id}">${band}${header}${line(g.x, bottom, g.x + g.w, bottom, "t-lane-rule")}${label}</g>`;
}
