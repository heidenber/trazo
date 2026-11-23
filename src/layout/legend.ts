// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { FAMILIES, familyOf } from "../render/families.js";
import type { Scene, SceneEdge, SceneLegendItem } from "../scene.js";
import { firstBaseline, lineHeight, textWidth } from "../text/measure.js";

const PAD = 24;
const SIZE = 12;
const SWATCH_W = 24;
const SWATCH_H = 14;
const TEXT_GAP = 8;
const ITEM_GAP = 20;
const ROW_H = 20;
const ROW_GAP = 6;
const TOP_GAP = 16;
const BOTTOM = 16;

const FAMILY_LABELS: Record<string, string> = {
  compute: "Compute",
  data: "Data",
  messaging: "Messaging",
  client: "Client",
  external: "External",
  start: "Start",
  end: "End",
  decision: "Decision",
  wait: "Wait",
  task: "Task",
};

const STYLES: { style: SceneEdge["style"]; label: string }[] = [
  { style: "sync", label: "Sync" },
  { style: "async", label: "Async" },
  { style: "data", label: "Data flow" },
  { style: "reply", label: "Reply" },
];

/**
 * Adds a legend below the diagram: one entry per node family and edge style the
 * scene uses, families first. Shown only when there is something to tell apart
 * (more than one family or more than one style); grows the scene's height.
 */
export function addLegend(scene: Scene): Scene {
  const usedFamilies = new Set(scene.nodes.map((n) => familyOf(scene, n)));
  const usedStyles = new Set(scene.edges.map((e) => e.style));
  const families = FAMILIES.filter((f) => usedFamilies.has(f));
  const styles = STYLES.filter((s) => usedStyles.has(s.style));
  if (families.length <= 1 && styles.length <= 1) return scene;

  const entries = [
    ...families.map((f) => ({ family: f as string, label: FAMILY_LABELS[f]! })),
    ...styles.map((s) => ({ style: s.style, label: s.label })),
  ];

  const top = scene.height + TOP_GAP;
  const right = scene.width - PAD;
  const legend: SceneLegendItem[] = [];
  let x = PAD;
  let row = 0;
  for (const entry of entries) {
    const w = SWATCH_W + TEXT_GAP + textWidth(entry.label, SIZE, 400);
    if (x > PAD && x + w > right) {
      x = PAD;
      row++;
    }
    const y = top + row * (ROW_H + ROW_GAP);
    const textX = x + SWATCH_W + TEXT_GAP;
    legend.push({
      ...("family" in entry ? { family: entry.family } : { style: entry.style }),
      swatch: { x, y: y + (ROW_H - SWATCH_H) / 2, w: SWATCH_W, h: SWATCH_H },
      label: {
        lines: [entry.label],
        x: textX,
        y: y + (ROW_H - lineHeight(SIZE)) / 2 + firstBaseline(SIZE),
        size: SIZE,
        weight: 400,
        anchor: "start",
      },
    });
    x += w + ITEM_GAP;
  }
  return { ...scene, legend, height: top + (row + 1) * ROW_H + row * ROW_GAP + BOTTOM };
}
