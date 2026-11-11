// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Box, NodeShape, SceneGroup } from "../scene.js";

const CORNER = 8;
const END_INSET = 3;
const SUBPROCESS_INSET = 8;
const NOTE_FOLD = 10;

export const num = (n: number) => String(Math.round(n * 100) / 100);

export const rect = (b: Box, cls: string, rx = CORNER) =>
  `<rect class="${cls}" x="${num(b.x)}" y="${num(b.y)}" width="${num(b.w)}" height="${num(b.h)}" rx="${num(rx)}"/>`;

const line = (x1: number, y1: number, x2: number, y2: number, cls: string) =>
  `<line class="${cls}" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"/>`;

export function shapeMarkup(shape: NodeShape, b: Box): string {
  const cls = "t-node-box";
  switch (shape) {
    case "box":
      return rect(b, cls);
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
      return `<polygon class="${cls}" points="${pts.join(" ")}"/>`;
    }
    case "table":
      return rect(b, "t-table");
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
        rect(b, cls) +
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
  const bottom = g.y + g.h;
  const band = `<rect class="t-lane-band" x="${num(g.x)}" y="${num(g.y)}" width="${num(g.w)}" height="${num(g.h)}"/>`;
  const header = `<rect class="t-lane-header" x="${num(g.x)}" y="${num(g.y)}" width="${num(g.header ?? 0)}" height="${num(g.h)}"/>`;
  return `<g class="${cls}" data-id="${g.id}">${band}${header}${line(g.x, bottom, g.x + g.w, bottom, "t-lane-rule")}${label}</g>`;
}
