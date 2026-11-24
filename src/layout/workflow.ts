// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Workflow } from "../model/workflow.js";
import { LABEL_PAD_X } from "../render/card.js";
import type { Box, Point, Scene, SceneEdge, SceneGroup, SceneNode, TextBlock } from "../scene.js";
import { firstBaseline, lineHeight, textWidth, wrapText } from "../text/measure.js";
import {
  LAYER_SPACING,
  NODE_SPACING,
  layoutElk,
  type LayoutBox,
  type LayoutEdge,
  type LayoutPort,
  type LayoutResult,
} from "./elk.js";
import {
  BAND_PAD,
  assertStepsInLanes,
  buildBands,
  columnLabel,
  findBackEdges,
  headerHeight,
  headerWidth,
  planLanes,
} from "./lanes.js";
import { NOTE_SIZE, stackBaselines } from "./note.js";
import { loopUnder, straighten } from "./route.js";
import { ICON_TEXT_LEFT, clipToDiamond, sizeStep, type StepSize } from "./shapes.js";

const EDGE_LABEL_SIZE = 12;
const EDGE_WRAP = 140;
const EDGE_LABEL_PAD = 4;
/** Gap between two ranks of lane steps. */
const COLUMN_GAP = LAYER_SPACING + 20;
/** Space on each side of a label that sits between two ranks. */
const LABEL_MARGIN = 12;

const half = (v: number) => Math.round(v * 2) / 2;
const widest = (lines: string[], size: number, weight: 400 | 600) =>
  Math.max(0, ...lines.map((l) => textWidth(l, size, weight)));

function stepText(size: StepSize, box: Box): { label: TextBlock; subtitle?: TextBlock } {
  const at = stackBaselines(box.y, box.h, size.lines.length, size.fontSize, size.note);
  const centred = size.icon === undefined;
  const x = half(centred ? box.x + box.w / 2 : box.x + ICON_TEXT_LEFT);
  const anchor = centred ? "middle" : "start";
  const label: TextBlock = {
    lines: size.lines,
    x,
    y: half(at.label),
    size: size.fontSize,
    weight: 600,
    anchor,
  };
  if (size.note.length === 0) return { label };
  const subtitle: TextBlock = {
    lines: size.note,
    x,
    y: half(at.note),
    size: NOTE_SIZE,
    weight: 400,
    anchor,
  };
  return { label, subtitle };
}

/** Decisions take edges at the vertices facing the flow, not anywhere on their bounding box. */
function decisionPorts(id: string, size: StepSize, flow: "RIGHT" | "DOWN"): LayoutPort[] {
  const { width: w, height: h } = size;
  return flow === "RIGHT"
    ? [
        { id: `${id}:in`, side: "WEST", x: 0, y: h / 2 },
        { id: `${id}:out`, side: "EAST", x: w, y: h / 2 },
      ]
    : [
        { id: `${id}:in`, side: "NORTH", x: w / 2, y: 0 },
        { id: `${id}:out`, side: "SOUTH", x: w / 2, y: h },
      ];
}

/** Centres the label on the longest segment of the route. */
function labelOnRoute(points: Point[], lines: string[]): Box | undefined {
  let best: [Point, Point] | undefined;
  let bestLength = -1;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length > bestLength) {
      best = [a, b];
      bestLength = length;
    }
  }
  if (!best) return undefined;
  const w = Math.ceil(widest(lines, EDGE_LABEL_SIZE, 400)) + 2 * LABEL_PAD_X;
  const h = Math.ceil(lines.length * lineHeight(EDGE_LABEL_SIZE)) + 2 * EDGE_LABEL_PAD;
  return {
    x: half((best[0].x + best[1].x) / 2 - w / 2),
    y: half((best[0].y + best[1].y) / 2 - h / 2),
    w,
    h,
  };
}

/** Step between the positions tried for a label that collides with another. */
const NUDGE_STEP = 4;
/** Air kept between two labels. */
const LABEL_GAP = 2;

const meets = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Whether the segment runs through the inside of the box (Liang-Barsky). */
function segmentCrosses(a: Point, b: Point, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const sides: [number, number][] = [
    [-dx, a.x - box.x],
    [dx, box.x + box.w - a.x],
    [-dy, a.y - box.y],
    [dy, box.y + box.h - a.y],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q <= 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 >= t1) return false;
  }
  return true;
}

const span = (a: Point, b: Point) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

/**
 * Edge labels are centred on their edge, so two edges that cross can put their
 * labels on the same spot, and one centred on a short run or on a loop's far
 * side can reach over the step it leaves. A label that meets an earlier one, or
 * a step, or sits on the line of another edge, slides along its own route,
 * longest segment first, nearest position first, to the first spot clear of
 * every placed label, of the steps and of the other edges' routes; failing
 * that, the first spot clear of labels and steps, then of labels only, else it
 * stays. Its own route is no obstacle. Order and steps are fixed, so the result
 * is deterministic.
 */
function separateLabels(
  routes: readonly Point[][],
  labels: readonly (Box | undefined)[],
  steps: readonly Box[],
): (Box | undefined)[] {
  const placed: Box[] = [];
  return labels.map((initial, i) => {
    if (!initial) return undefined;
    const clearOfLabels = (b: Box) => placed.every((o) => !meets(b, o, LABEL_GAP));
    const clearOfSteps = (b: Box) => steps.every((n) => !meets(b, n, 0));
    const clearOfLines = (b: Box) =>
      routes.every(
        (r, j) => j === i || r.every((p, k) => k === 0 || !segmentCrosses(r[k - 1]!, p, b)),
      );
    let chosen = initial;
    if (!clearOfLabels(initial) || !clearOfSteps(initial) || !clearOfLines(initial)) {
      const points = routes[i]!;
      const segments = points
        .slice(1)
        .map((b, k) => [points[k]!, b] as const)
        .sort((a, b) => span(b[0], b[1]) - span(a[0], a[1]));
      const spots: Box[] = [];
      for (const [a, b] of segments) {
        const length = span(a, b);
        if (length === 0) continue;
        const ux = Math.sign(b.x - a.x);
        const uy = Math.sign(b.y - a.y);
        for (let d = 0; d <= length / 2; d += NUDGE_STEP) {
          for (const t of d === 0 ? [length / 2] : [length / 2 - d, length / 2 + d]) {
            spots.push({
              ...initial,
              x: half(a.x + ux * t - initial.w / 2),
              y: half(a.y + uy * t - initial.h / 2),
            });
          }
        }
      }
      const free = spots.filter(clearOfLabels);
      const clearOfBoth = (b: Box) => clearOfSteps(b) && clearOfLines(b);
      chosen =
        free.find(clearOfBoth) ??
        free.find(clearOfSteps) ??
        (clearOfLabels(initial) ? initial : free[0]) ??
        initial;
    }
    placed.push(chosen);
    return chosen;
  });
}

function shift(layout: LayoutResult, dx: number): void {
  if (dx === 0) return;
  for (const box of layout.boxes.values()) box.x = half(box.x + dx);
  for (const edge of layout.edges.values()) {
    for (const p of edge.points) p.x = half(p.x + dx);
    if (edge.label) edge.label.x = half(edge.label.x + dx);
  }
}

/** The stage a diagram should fill on first view: 1440x826, 16:10 minus the page header. */
export const STAGE = { width: 1440, height: 826 } as const;

/** Factor that fits a scene on the stage; larger means more readable on first view. */
export function fitScale(scene: { width: number; height: number }): number {
  return Math.min(STAGE.width / scene.width, STAGE.height / scene.height);
}

function flip(p: { x: number; y: number }): void {
  const x = p.x;
  p.x = p.y;
  p.y = x;
}

function flipBox(b: Box): void {
  flip(b);
  const w = b.w;
  b.w = b.h;
  b.h = w;
}

/**
 * Lays a workflow out. With lanes and no direction both orientations are laid
 * out and the one that fits the stage better wins; a tie keeps lanes as rows.
 */
export async function layoutWorkflow(w: Workflow): Promise<Scene> {
  if (w.lanes.length === 0) return layoutFlow(w, false);
  if (w.direction === "auto") {
    const rows = await layoutFlow(w, false);
    const columns = await layoutFlow(w, true);
    return fitScale(columns) > fitScale(rows) ? columns : rows;
  }
  return layoutFlow(w, w.direction === "down");
}

/**
 * Lanes as columns are laid out as rows in a transposed frame (x and y, widths
 * and heights swapped) and flipped back, so one lane algorithm serves both
 * orientations. Text is placed after the flip, in real coordinates.
 */
async function layoutFlow(w: Workflow, columns: boolean): Promise<Scene> {
  const sizes = new Map(w.steps.map((s) => [s.id, sizeStep(s)]));
  const frameSizes = new Map(
    [...sizes].map(([id, s]) => [id, columns ? { ...s, width: s.height, height: s.width } : s]),
  );
  const lanes = w.lanes.length > 0;

  const edgeLabels = w.edges.map((e) =>
    e.label === undefined ? undefined : wrapText(e.label, EDGE_WRAP, EDGE_LABEL_SIZE, 400),
  );
  const plan = lanes ? planLanes(w, frameSizes, COLUMN_GAP, NODE_SPACING) : undefined;
  const labelBox = (lines: string[]) => ({
    width: Math.ceil(widest(lines, EDGE_LABEL_SIZE, 400)) + 2 * LABEL_PAD_X,
    height: Math.ceil(lines.length * lineHeight(EDGE_LABEL_SIZE)) + 2 * EDGE_LABEL_PAD,
  });

  // A back edge inside one lane is drawn as a loop beside its steps. Left to
  // ELK, its dummy nodes push the steps of the cycle onto different rows.
  const laneOf = new Map(w.lanes.flatMap((l) => l.steps.map((id) => [id, l.id] as const)));
  const loops = new Set(
    lanes
      ? [...findBackEdges(w)].filter(
          (i) => laneOf.get(w.edges[i]!.from) === laneOf.get(w.edges[i]!.to),
        )
      : [],
  );

  const flow = lanes || w.direction === "right" ? "RIGHT" : "DOWN";
  const boxes: LayoutBox[] = w.steps.map((s) => {
    const size = frameSizes.get(s.id)!;
    const box: LayoutBox = { id: s.id, width: size.width, height: size.height };
    const at = plan?.positions.get(s.id);
    if (at) Object.assign(box, at);
    if (size.shape === "diamond") box.ports = decisionPorts(s.id, size, flow);
    return box;
  });
  const isDecision = new Set(w.steps.filter((s) => s.kind === "decision").map((s) => s.id));
  // With lanes the labels are placed after routing: ELK would put a label node
  // in the preset-free gap between layers and drag the edge with it. The gap
  // is widened instead, so a label fits between two ranks.
  const labelRoom = Math.max(
    0,
    ...edgeLabels.map((lines) => {
      if (!lines) return 0;
      const b = labelBox(lines);
      return columns ? b.height : b.width;
    }),
  );
  const layout = await layoutElk(
    boxes,
    w.edges.flatMap((e, i) => {
      if (loops.has(i)) return [];
      const lines = edgeLabels[i];
      const edge: LayoutEdge = { id: `e${i}`, from: e.from, to: e.to };
      if (isDecision.has(e.from)) edge.fromPort = `${e.from}:out`;
      if (isDecision.has(e.to)) edge.toPort = `${e.to}:in`;
      return [!lines || lanes ? edge : { ...edge, label: labelBox(lines) }];
    }),
    flow,
    lanes
      ? { interactive: true, layerSpacing: Math.max(LAYER_SPACING, labelRoom + 2 * LABEL_MARGIN) }
      : {},
  );

  // Geometry in the frame: steps, routes, then the lane bands.
  let width = layout.width;
  let height = layout.height;
  let header = 0;
  if (lanes) {
    header = columns ? headerHeight(w.lanes.some((l) => l.note !== undefined)) : headerWidth(w);
    shift(layout, header);
    width = half(layout.width + header);
  }
  const frame = new Map(
    w.steps.map((s) => [s.id, { ...layout.boxes.get(s.id)!, shape: sizes.get(s.id)!.shape }]),
  );
  const routes = w.edges.map((e, i) => {
    const from = frame.get(e.from)!;
    const to = frame.get(e.to)!;
    let points = layout.edges.get(`e${i}`)?.points ?? [];
    if (loops.has(i)) {
      const laneSteps = w.steps
        .filter((s) => laneOf.get(s.id) === laneOf.get(e.from))
        .map((s) => frame.get(s.id)!);
      points = loopUnder(from, to, laneSteps);
    } else if (lanes) {
      points = straighten(
        points,
        from,
        to,
        [...frame.values()].filter((n) => n !== from && n !== to),
      );
    }
    if (from.shape === "diamond") clipToDiamond(points, "start", from);
    if (to.shape === "diamond") clipToDiamond(points, "end", to);
    for (const p of points) {
      p.x = half(p.x);
      p.y = half(p.y);
      if (columns) flip(p);
    }
    return points;
  });
  // Edge labels are real text, so they are placed on the real route.
  const stepBoxes = [...frame.values()].map((b) => {
    const real: Box = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (columns) flipBox(real);
    return real;
  });
  const labels = separateLabels(
    routes,
    w.edges.map((_, i) => {
      const lines = edgeLabels[i];
      if (!lines) return undefined;
      return lanes ? labelOnRoute(routes[i]!, lines) : layout.edges.get(`e${i}`)?.label;
    }),
    stepBoxes,
  );

  let groups: SceneGroup[] = [];
  if (lanes) {
    // How far each lane's loops and their labels reach past its steps, in the frame.
    const reach = new Map<string, number>();
    for (const i of loops) {
      const label = labels[i];
      const far = columns
        ? Math.max(...routes[i]!.map((p) => p.x), label ? label.x + label.w : -Infinity)
        : Math.max(...routes[i]!.map((p) => p.y), label ? label.y + label.h : -Infinity);
      const lane = laneOf.get(w.edges[i]!.from)!;
      reach.set(lane, Math.max(reach.get(lane) ?? -Infinity, far));
    }
    height = half(Math.max(height, ...[...reach.values()].map((v) => v + BAND_PAD)));
    groups = buildBands(w, layout.boxes, width, height, header, reach);
    assertStepsInLanes(w.lanes, groups, layout.boxes);
  }

  if (columns) {
    for (const box of layout.boxes.values()) flipBox(box);
    for (const g of groups) {
      flipBox(g);
      g.columns = true;
      g.label = columnLabel(g, header, w.lanes.find((l) => l.id === g.id)?.note);
    }
    [width, height] = [height, width];
  }

  const nodes: SceneNode[] = w.steps.map((s) => {
    const size = sizes.get(s.id)!;
    const box = layout.boxes.get(s.id)!;
    const { label, subtitle } = stepText(size, box);
    const node: SceneNode = { id: s.id, kind: s.kind, shape: size.shape, ...box, label };
    if (subtitle !== undefined) node.subtitle = subtitle;
    if (size.icon !== undefined) node.icon = size.icon;
    if (s.note !== undefined) node.note = s.note;
    if (s.detail !== undefined) node.detail = s.detail;
    if (s.source !== undefined) node.source = s.source;
    const lane = laneOf.get(s.id);
    if (lane !== undefined) node.parent = lane;
    return node;
  });

  const edges: SceneEdge[] = w.edges.map((e, i) => {
    const out: SceneEdge = {
      id: `e${i}`,
      from: e.from,
      to: e.to,
      points: routes[i]!,
      style: e.style,
    };
    const lines = edgeLabels[i];
    const box = labels[i];
    if (lines && box) {
      out.label = {
        box,
        text: {
          lines,
          x: half(box.x + box.w / 2),
          y: half(box.y + EDGE_LABEL_PAD + firstBaseline(EDGE_LABEL_SIZE)),
          size: EDGE_LABEL_SIZE,
          weight: 400,
          anchor: "middle",
        },
      };
    }
    return out;
  });

  const scene: Scene = {
    type: w.type,
    title: w.title,
    theme: w.theme,
    width,
    height,
    groups,
    nodes,
    edges,
  };
  if (w.description !== undefined) scene.description = w.description;
  return scene;
}
