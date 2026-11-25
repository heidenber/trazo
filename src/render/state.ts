// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Box } from "../scene.js";
import { num, rect, shapeMarkup } from "./shapes.js";

const ARROW = 9;
const HALF = 4.4;

const path = (cls: string, d: string) => `<path class="${cls}" d="${d}"/>`;

/** Arrowhead with its tip at (x, y), pointing along (dx, dy). */
function head(cls: string, x: number, y: number, dx: number, dy: number): string {
  const bx = x - dx * ARROW;
  const by = y - dy * ARROW;
  const pts = [
    [x, y],
    [bx - dy * HALF, by + dx * HALF],
    [bx + dy * HALF, by - dx * HALF],
  ];
  return `<polygon class="${cls}" points="${pts.map(([px, py]) => `${num(px!)},${num(py!)}`).join(" ")}"/>`;
}

/** A small drawing of one state-diagram element inside the legend swatch box. */
export function stateGlyph(name: string, s: Box): string {
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const exc = name === "state-exception-transition";
  const line = exc ? "t-legend-line t-st-exc" : "t-legend-line t-st-main";
  const tip = exc ? "t-arrow t-arrow-exception" : "t-arrow";
  switch (name) {
    case "state-initial":
      return shapeMarkup("initial", { x: cx - 8, y: cy - 8, w: 16, h: 16 });
    case "state-final":
      return `<circle class="t-state-ring" cx="${num(cx)}" cy="${num(cy)}" r="10"/><circle class="t-state-dot" cx="${num(cx)}" cy="${num(cy)}" r="5.4"/>`;
    case "state-state":
    case "state-exception":
      return rect(s, "t-node-box", 8);
    case "state-self": {
      const x1 = cx - 9;
      const x2 = cx + 9;
      const top = s.y + 3;
      const base = s.y + s.h - 4;
      return (
        path(
          "t-legend-line",
          `M${num(x1)} ${num(base)}V${num(top)}H${num(x2)}V${num(base - ARROW + 0.5)}`,
        ) + head("t-arrow", x2, base, 0, 1)
      );
    }
    default: {
      const x2 = s.x + s.w;
      return (
        path(line, `M${num(s.x)} ${num(cy)}H${num(x2 - ARROW + 0.5)}`) + head(tip, x2, cy, 1, 0)
      );
    }
  }
}
