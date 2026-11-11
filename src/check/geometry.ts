// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Box, Point, Scene, SceneEdge } from "../scene.js";
import { textWidth } from "../text/measure.js";
import type { Issue } from "../validate/issues.js";

/** Rounding slack of the layout: boxes that touch within it do not overlap. */
const EPS = 0.5;
/** Horizontal room a node label keeps from the box sides. */
const TEXT_PAD = 8;

const REPORT = "this is a layout defect in trazo; please report it";

function warning(code: string, message: string, hint: string): Issue {
  return { severity: "warning", code: `geometry/${code}`, path: "layout", message, hint };
}

function overlap(a: Box, b: Box): boolean {
  return (
    Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS &&
    Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS
  );
}

function within(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS
  );
}

/** Liang-Barsky clip of the segment against the box shrunk by EPS on every side. */
function segmentEntersBox(a: Point, b: Point, box: Box): boolean {
  const left = box.x + EPS;
  const right = box.x + box.w - EPS;
  const top = box.y + EPS;
  const bottom = box.y + box.h - EPS;
  if (left >= right || top >= bottom) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sides: [number, number][] = [
    [-dx, a.x - left],
    [dx, right - a.x],
    [-dy, a.y - top],
    [dy, bottom - a.y],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

const byIds = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

export function checkGeometry(scene: Scene): Issue[] {
  const issues: Issue[] = [];
  const canvas: Box = { x: 0, y: 0, w: scene.width, h: scene.height };
  // Edges are named by node ids: internal ids such as "#m0" mean nothing to the author.
  const name = (e: SceneEdge) => `${e.from} -> ${e.to}`;

  const { nodes } = scene;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (!overlap(nodes[i]!, nodes[j]!)) continue;
      const [a, b] = byIds(nodes[i]!.id, nodes[j]!.id);
      issues.push(
        warning(
          "node-overlap",
          `node "${a}" overlaps node "${b}"`,
          "split the diagram or group related nodes",
        ),
      );
    }
  }

  const labelled = scene.edges.filter((e) => e.label !== undefined);
  for (const e of labelled) {
    const box = e.label!.box;
    for (const n of nodes) {
      if (overlap(box, n))
        issues.push(
          warning(
            "label-overlap",
            `label of ${name(e)} overlaps node "${n.id}"`,
            "shorten the label",
          ),
        );
    }
  }
  for (let i = 0; i < labelled.length; i++) {
    for (let j = i + 1; j < labelled.length; j++) {
      if (!overlap(labelled[i]!.label!.box, labelled[j]!.label!.box)) continue;
      const [a, b] = byIds(name(labelled[i]!), name(labelled[j]!));
      issues.push(warning("label-overlap", `labels of ${a} and ${b} overlap`, "shorten the label"));
    }
  }

  for (const e of scene.edges) {
    for (const n of nodes) {
      if (n.id === e.from || n.id === e.to) continue;
      const hit = e.points.some((p, k) => k > 0 && segmentEntersBox(e.points[k - 1]!, p, n));
      if (hit)
        issues.push(
          warning(
            "edge-through-node",
            `edge ${name(e)} crosses node "${n.id}"`,
            "try another direction or group related nodes",
          ),
        );
    }
  }

  for (const n of nodes) {
    if (!within(n, canvas))
      issues.push(warning("outside-canvas", `node "${n.id}" is outside the canvas`, REPORT));
  }
  for (const g of scene.groups) {
    if (!within(g, canvas))
      issues.push(warning("outside-canvas", `group "${g.id}" is outside the canvas`, REPORT));
  }
  for (const e of labelled) {
    if (!within(e.label!.box, canvas))
      issues.push(warning("outside-canvas", `label of ${name(e)} is outside the canvas`, REPORT));
  }

  const groups = new Map(scene.groups.map((g) => [g.id, g]));
  for (const n of nodes) {
    const group = n.parent === undefined ? undefined : groups.get(n.parent);
    if (group && !within(n, group))
      issues.push(
        warning("outside-group", `node "${n.id}" is outside group "${group.id}"`, REPORT),
      );
  }

  for (const n of nodes) {
    if (n.shape === "table") continue;
    const widest = Math.max(
      0,
      ...n.label.lines.map((line) => textWidth(line, n.label.size, n.label.weight)),
    );
    if (widest > n.w - TEXT_PAD)
      issues.push(
        warning(
          "text-overflow",
          `label of node "${n.id}" is wider than its box`,
          "shorten the label",
        ),
      );
  }

  return unique(issues).sort((a, b) => compare(a.code, b.code) || compare(a.message, b.message));
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function unique(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.code}\u0000${i.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
