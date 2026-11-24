// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Box, NodeShape, Point, SceneEdge } from "../scene.js";
import { textWidth } from "../text/measure.js";
import { escapeXml } from "./svg.js";
import { num, shapeMarkup } from "./shapes.js";

const poly = (pts: Point[]) =>
  pts.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");

/** Straight legs with sharp corners: the ends were placed on the outlines by the layout. */
export function chenEdge(e: SceneEdge): string {
  const role = e.chen!.role === "link" ? "t-chen-link" : "t-chen-attr";
  const ids = `data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}"`;
  const strands = [e.points, ...(e.chen!.second ? [e.chen!.second] : [])];
  return strands
    .map(
      (pts) =>
        `<path class="t-edge ${role}" ${ids} d="${poly(pts)}" data-edge="${escapeXml(e.id)}"/>`,
    )
    .join("");
}

/** The cardinality next to the entity end; the edge-label class lets the viewer dim and search it with its line. */
export function chenCard(e: SceneEdge): string {
  const card = e.chen?.card;
  if (!card) return "";
  const line = card.lines[0]!;
  return `<text class="t-text t-edge-label t-chen-card" data-edge="${escapeXml(e.id)}" x="${num(card.x)}" y="${num(card.y)}" font-size="${card.size}" font-weight="${card.weight}" text-anchor="middle"><tspan x="${num(card.x)}" dy="0">${escapeXml(line)}</tspan></text>`;
}

/** A key is underlined, a partial key dashed-underlined: a line, so exports without CSS text decoration keep it. */
export function underline(
  kind: "key" | "partial",
  cx: number,
  baseline: number,
  text: string,
  size: number,
  weight: 400 | 600,
): string {
  const half = textWidth(text, size, weight) / 2;
  const y = baseline + 3.5;
  return `<line class="t-chen-underline t-u-${kind}" x1="${num(cx - half)}" y1="${num(y)}" x2="${num(cx + half)}" y2="${num(y)}"/>`;
}

const line = (x1: number, y1: number, x2: number, y2: number) =>
  `<line class="t-chen-link" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`;

const glyphText = (cls: string, x: number, y: number, size: number, body: string) =>
  `<text class="t-text ${cls}" x="${num(x)}" y="${num(y)}" font-size="${size}" font-weight="600" text-anchor="middle">${body}</text>`;

/** A small drawing of one notation element inside the legend swatch box. */
export function glyph(name: string, s: Box): string {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const at = (shape: NodeShape, w: number, h: number, dy = 0, dx = 0) =>
    shapeMarkup(shape, { x: cx - w / 2 + dx, y: cy - h / 2 + dy, w, h });
  switch (name) {
    case "entity":
      return at("entity", 44, 22);
    case "weak-entity":
      return at("weak-entity", 48, 28);
    case "relationship":
      return at("relationship", 48, 26);
    case "identifying":
      return at("identifying", 52, 28);
    case "attribute":
      return at("attribute", 44, 22);
    case "key":
      return (
        at("attribute", 44, 22) +
        glyphText("", cx, cy + 3.6, 10, "id") +
        underline("key", cx, cy + 3.6, "id", 10, 600)
      );
    case "partial":
      return (
        at("attribute", 44, 22) +
        glyphText("", cx, cy + 3.6, 10, "no") +
        underline("partial", cx, cy + 3.6, "no", 10, 600)
      );
    case "multivalued":
      return at("multivalued", 48, 26);
    case "derived":
      return `<g class="t-derived">${at("attribute", 44, 22)}</g>`;
    case "composite":
      return (
        line(cx - 7, cy - 1, cx - 15, cy - 7) +
        line(cx + 7, cy - 1, cx + 15, cy - 7) +
        at("attribute", 14, 9, -9, -18) +
        at("attribute", 14, 9, -9, 18) +
        at("attribute", 28, 14, 6)
      );
    case "total":
      return (
        line(cx - 22, cy - 2.5, cx + 22, cy - 2.5) + line(cx - 22, cy + 2.5, cx + 22, cy + 2.5)
      );
    case "partial-participation":
      return line(cx - 22, cy, cx + 22, cy);
    default:
      return (
        line(cx - 22, cy + 4, cx + 22, cy + 4) +
        glyphText("t-chen-card", cx - 14, cy - 1, 11, "1") +
        glyphText("t-chen-card", cx + 14, cy - 1, 11, "N")
      );
  }
}
