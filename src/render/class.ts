// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Box, Point, Scene, SceneEdge, SceneNode, SceneRelation } from "../scene.js";
import { escapeXml, text } from "./svg.js";
import { num, rect } from "./shapes.js";

export type RelationKind = SceneRelation["kind"];

/** Size of the marker drawn at the start (the whole end) and at the end of each relation kind. */
export const TRIANGLE = { len: 14, half: 7.5 };
export const DIAMOND = { len: 20, half: 6.5 };
export const ARROW = { len: 10, half: 5 };
/** Corner radius of a relation line. */
export const RELATION_CORNER = 7;

export const MARKER_LENGTH: Record<RelationKind, [start: number, end: number]> = {
  association: [0, 0],
  directed: [0, ARROW.len],
  composition: [DIAMOND.len, 0],
  aggregation: [DIAMOND.len, 0],
  generalization: [0, TRIANGLE.len],
  realization: [0, TRIANGLE.len],
  dependency: [0, ARROW.len],
};

/** Half width of the marker at an end: how far from a corner or a neighbouring line it must sit. */
export const MARKER_HALF: Record<RelationKind, [start: number, end: number]> = {
  association: [0, 0],
  directed: [0, ARROW.half],
  composition: [DIAMOND.half, 0],
  aggregation: [DIAMOND.half, 0],
  generalization: [0, TRIANGLE.half],
  realization: [0, TRIANGLE.half],
  dependency: [0, ARROW.half],
};

const unit = (a: Point, b: Point): Point => {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const at = (p: Point) => `${num(p.x)} ${num(p.y)}`;

/**
 * Line from the first to the last point with rounded corners, cut back at each end by the length of
 * its marker: the marker polygon starts where the line stops and its tip is on the class border.
 */
export function relationPath(points: Point[], kind: RelationKind): string {
  const [cut0, cut1] = MARKER_LENGTH[kind];
  const n = points.length;
  const q = points.map((p) => ({ ...p }));
  if (cut0 > 0) {
    const u = unit(points[0]!, points[1]!);
    q[0] = { x: points[0]!.x + u.x * cut0, y: points[0]!.y + u.y * cut0 };
  }
  if (cut1 > 0) {
    const u = unit(points[n - 2]!, points[n - 1]!);
    q[n - 1] = { x: points[n - 1]!.x - u.x * cut1, y: points[n - 1]!.y - u.y * cut1 };
  }
  let d = `M${at(q[0]!)}`;
  for (let i = 1; i < n - 1; i++) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const r = Math.min(
      RELATION_CORNER,
      Math.hypot(b.x - a.x, b.y - a.y) / 2,
      Math.hypot(c.x - b.x, c.y - b.y) / 2,
    );
    const u = unit(a, b);
    const v = unit(b, c);
    d += ` L${at({ x: b.x - u.x * r, y: b.y - u.y * r })} Q${at(b)} ${at({ x: b.x + v.x * r, y: b.y + v.y * r })}`;
  }
  return `${d} L${at(q[n - 1]!)}`;
}

// Each marker is drawn in the coordinates of its line end: the line stops at the origin and the
// marker extends along the line (triangle) or back toward the class (diamond), tip on the border.
const MARKERS: Record<RelationKind, string | undefined> = {
  association: undefined,
  generalization: `<path class="t-relm t-relm-generalization" d="M0 -${TRIANGLE.half}L${TRIANGLE.len} 0L0 ${TRIANGLE.half}z"/>`,
  realization: `<path class="t-relm t-relm-realization" d="M0 -${TRIANGLE.half}L${TRIANGLE.len} 0L0 ${TRIANGLE.half}z"/>`,
  composition: `<path class="t-relm t-relm-composition" d="M-${DIAMOND.len} 0L-${DIAMOND.len / 2} -${DIAMOND.half}L0 0L-${DIAMOND.len / 2} ${DIAMOND.half}z"/>`,
  aggregation: `<path class="t-relm t-relm-aggregation" d="M-${DIAMOND.len} 0L-${DIAMOND.len / 2} -${DIAMOND.half}L0 0L-${DIAMOND.len / 2} ${DIAMOND.half}z"/>`,
  directed: `<path class="t-relm t-relm-directed" d="M-${ARROW.len} -${ARROW.half}L0 0L-${ARROW.len} ${ARROW.half}"/>`,
  dependency: `<path class="t-relm t-relm-dependency" d="M-${ARROW.len} -${ARROW.half}L0 0L-${ARROW.len} ${ARROW.half}"/>`,
};

/** Room around the marker for its stroke. */
const MARGIN = 2;

function marker(kind: RelationKind): string {
  const body = MARKERS[kind];
  if (body === undefined) return "";
  const [start, end] = MARKER_LENGTH[kind];
  const half = MARKER_HALF[kind][start > 0 ? 0 : 1] + MARGIN;
  const x0 =
    start > 0
      ? -start - MARGIN
      : -MARGIN - (kind === "directed" || kind === "dependency" ? end : 0);
  const x1 = start > 0 ? MARGIN : MARGIN + (kind === "directed" || kind === "dependency" ? 0 : end);
  return `<marker id="t-rel-${kind}" viewBox="${num(x0)} ${num(-half)} ${num(x1 - x0)} ${num(2 * half)}" refX="0" refY="0" markerWidth="${num(x1 - x0)}" markerHeight="${num(2 * half)}" markerUnits="userSpaceOnUse" orient="auto">${body}</marker>`;
}

/** The markers of the relation kinds a scene uses, for its defs. */
export function relationMarkers(scene: Scene): string {
  const kinds = new Set(scene.edges.flatMap((e) => (e.rel ? [e.rel.kind] : [])));
  return [...kinds].map(marker).join("");
}

const markerAttrs = (kind: RelationKind) => {
  const [start] = MARKER_LENGTH[kind];
  if (MARKERS[kind] === undefined) return "";
  return start > 0 ? ` marker-start="url(#t-rel-${kind})"` : ` marker-end="url(#t-rel-${kind})"`;
};

/** One relation: the line with its marker, ends exactly on the borders of the two classes. */
export function classEdge(e: SceneEdge): string {
  const kind = e.rel!.kind;
  return `<path class="t-edge t-rel t-rel-${kind}" data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}" d="${relationPath(e.points, kind)}"${markerAttrs(kind)} data-edge="${escapeXml(e.id)}"/>`;
}

/** The name and the multiplicities of a relation share one group, so the viewer dims and searches them with the line. */
export function relationTexts(e: SceneEdge): string {
  const parts = [
    e.rel?.fromMult && text(e.rel.fromMult.text, "t-class-text t-class-mult"),
    e.label && text(e.label.text, "t-class-text"),
    e.rel?.toMult && text(e.rel.toMult.text, "t-class-text t-class-mult"),
  ].filter((p): p is string => Boolean(p));
  return parts.length === 0
    ? ""
    : `<g class="t-edge-label" data-edge="${escapeXml(e.id)}">${parts.join("")}</g>`;
}

/** The rules, stereotype and member rows of a class box (the outline and name come from the node). */
export function classBody(n: SceneNode): string {
  const c = n.class!;
  const rules = c.rules.map(
    (y) =>
      `<line class="t-class-rule" x1="${num(n.x)}" y1="${num(y)}" x2="${num(n.x + n.w)}" y2="${num(y)}"/>`,
  );
  const members = c.members.map(
    (m) => (m.vis ? text(m.vis, "t-class-vis") : "") + text(m.text, "t-class-member"),
  );
  return (
    rules.join("") + (c.stereotype ? text(c.stereotype, "t-class-stereo") : "") + members.join("")
  );
}

/** A small drawing of one class-diagram element inside the legend swatch box. */
export function classGlyph(name: string, s: Box): string {
  const cy = s.y + s.h / 2;
  if (name === "class-box") {
    const b = { x: s.x + 4, y: s.y, w: s.w - 8, h: s.h };
    const rule = (y: number) =>
      `<line class="t-class-rule" x1="${num(b.x)}" y1="${num(y)}" x2="${num(b.x + b.w)}" y2="${num(y)}"/>`;
    return rect(b, "t-node-box", 4) + rule(b.y + b.h * 0.34) + rule(b.y + b.h * 0.67);
  }
  if (name === "class-mult" || name === "class-vis") {
    const label = name === "class-mult" ? "1..*" : "+ -";
    // The visibility glyph wears the class of the marks in the boxes, so every theme mutes it alike.
    const cls = name === "class-mult" ? "t-class-text t-class-mult" : "t-class-vis";
    return `<text class="t-text ${cls}" x="${num(s.x + s.w / 2)}" y="${num(cy + 4)}" font-size="11" font-weight="600" text-anchor="middle">${label}</text>`;
  }
  const kind = name.slice("class-rel-".length) as RelationKind;
  const pts = [
    { x: s.x, y: cy },
    { x: s.x + s.w, y: cy },
  ];
  return `<path class="t-legend-line t-rel t-rel-${kind}" d="${relationPath(pts, kind)}"${markerAttrs(kind)}/>`;
}
