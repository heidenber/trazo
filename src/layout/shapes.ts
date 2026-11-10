// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { StepKind, WorkflowStep } from "../model/workflow.js";
import type { NodeShape, Point } from "../scene.js";
import { lineHeight, textWidth, wrapText } from "../text/measure.js";

const BOX_SIZE = 14;
const BOX_WRAP = 160;
const BOX_MIN_W = 96;
const BOX_MIN_H = 44;
const BOX_PAD_X = 20;
const BOX_PAD_Y = 10;
const ICON_SIZE = 20;
const ICON_PAD = 12;
const ICON_GAP = 10;
const RIGHT_PAD = 12;
const PILL_SIZE = 13;
const PILL_HEIGHT = 36;
const PILL_MIN_W = 72;
const PILL_PAD_X = 16;
const DIAMOND_SIZE = 13;
const DIAMOND_WRAP = 120;
const DIAMOND_PAD_X = 4;
const DIAMOND_PAD_Y = 2;
/** Width-to-height proportion of the rhombus. */
const DIAMOND_K = 2;

export interface StepSize {
  width: number;
  height: number;
  lines: string[];
  shape: NodeShape;
  fontSize: number;
  icon?: string;
}

const SHAPES: Record<StepKind, NodeShape> = {
  task: "box",
  wait: "box",
  subprocess: "subprocess",
  start: "pill",
  end: "end",
  decision: "diamond",
};

export const ICON_TEXT_LEFT = ICON_PAD + ICON_SIZE + ICON_GAP;

const widest = (lines: string[], size: number) =>
  Math.max(0, ...lines.map((l) => textWidth(l, size, 600)));

export function sizeStep(step: WorkflowStep): StepSize {
  const shape = SHAPES[step.kind];
  if (shape === "pill" || shape === "end") {
    const lines = [step.label];
    const width = Math.max(PILL_MIN_W, Math.ceil(widest(lines, PILL_SIZE) + 2 * PILL_PAD_X));
    return { width, height: PILL_HEIGHT, lines, shape, fontSize: PILL_SIZE };
  }
  if (shape === "diamond") {
    const lines = wrapText(step.label, DIAMOND_WRAP, DIAMOND_SIZE, 600);
    // The padded text rectangle has half-sides p and q; these semi-axes keep
    // its corners inside the rhombus (p/a + q/b <= 1).
    const p = (widest(lines, DIAMOND_SIZE) + 2 * DIAMOND_PAD_X) / 2;
    const q = (lines.length * lineHeight(DIAMOND_SIZE) + 2 * DIAMOND_PAD_Y) / 2;
    const a = p + q * DIAMOND_K;
    const b = q + p / DIAMOND_K;
    return {
      width: Math.ceil(2 * a),
      height: Math.ceil(2 * b),
      lines,
      shape,
      fontSize: DIAMOND_SIZE,
    };
  }
  const lines = wrapText(step.label, BOX_WRAP, BOX_SIZE, 600);
  const icon = step.kind === "wait" ? "clock" : undefined;
  const textWidthPx = widest(lines, BOX_SIZE);
  const width =
    icon === undefined
      ? Math.max(BOX_MIN_W, Math.ceil(textWidthPx + 2 * BOX_PAD_X))
      : Math.max(BOX_MIN_W, Math.ceil(ICON_TEXT_LEFT + textWidthPx + RIGHT_PAD));
  const height = Math.max(
    BOX_MIN_H,
    Math.ceil(lines.length * lineHeight(BOX_SIZE) + 2 * BOX_PAD_Y),
  );
  const size: StepSize = { width, height, lines, shape, fontSize: BOX_SIZE };
  if (icon !== undefined) size.icon = icon;
  return size;
}

/**
 * ELK ends edges on the rectangle around a diamond. Slide the endpoint along
 * its own segment, in either direction, onto the rhombus border.
 */
export function clipToDiamond(
  points: Point[],
  end: "start" | "end",
  box: { x: number; y: number; w: number; h: number },
): void {
  if (points.length < 2) return;
  const i = end === "start" ? 0 : points.length - 1;
  const p = points[i]!;
  const q = points[end === "start" ? 1 : points.length - 2]!;
  const a = box.w / 2;
  const b = box.h / 2;
  const cx = box.x + a;
  const cy = box.y + b;
  const dx = q.x - p.x;
  const dy = q.y - p.y;

  // |x|/a + |y|/b = 1 is piecewise linear; solve each quadrant's edge and keep
  // the root nearest to p.
  let best: number | undefined;
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const k = (sx * dx) / a + (sy * dy) / b;
      if (k === 0) continue;
      const t = (1 - (sx * (p.x - cx)) / a - (sy * (p.y - cy)) / b) / k;
      const x = p.x + t * dx - cx;
      const y = p.y + t * dy - cy;
      if (x * sx < -1e-6 || y * sy < -1e-6) continue;
      if (best === undefined || Math.abs(t) < Math.abs(best)) best = t;
    }
  }
  if (best === undefined) return;
  points[i] = { x: p.x + best * dx, y: p.y + best * dy };
}
