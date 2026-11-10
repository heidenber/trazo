// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Workflow } from "../model/workflow.js";
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
  findBackEdges,
  headerWidth,
  planLanes,
} from "./lanes.js";
import { loopUnder, straighten } from "./route.js";
import { ICON_TEXT_LEFT, clipToDiamond, sizeStep, type StepSize } from "./shapes.js";

const EDGE_LABEL_SIZE = 12;
const EDGE_WRAP = 140;
const EDGE_LABEL_PAD = 4;
/** Room for an edge label between two lane columns. */
const COLUMN_GAP = LAYER_SPACING + 20;
/** Space on each side of a label that sits between two lane columns. */
const LABEL_MARGIN = 12;

const half = (v: number) => Math.round(v * 2) / 2;
const widest = (lines: string[], size: number, weight: 400 | 600) =>
  Math.max(0, ...lines.map((l) => textWidth(l, size, weight)));

function stepLabel(size: StepSize, box: Box): TextBlock {
  const block = size.lines.length * lineHeight(size.fontSize);
  const y = half(box.y + (box.h - block) / 2 + firstBaseline(size.fontSize));
  const centred = size.icon === undefined;
  return {
    lines: size.lines,
    x: half(centred ? box.x + box.w / 2 : box.x + ICON_TEXT_LEFT),
    y,
    size: size.fontSize,
    weight: 600,
    anchor: centred ? "middle" : "start",
  };
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
  const w = Math.ceil(widest(lines, EDGE_LABEL_SIZE, 400)) + 2 * EDGE_LABEL_PAD;
  const h = Math.ceil(lines.length * lineHeight(EDGE_LABEL_SIZE)) + 2 * EDGE_LABEL_PAD;
  return {
    x: half((best[0].x + best[1].x) / 2 - w / 2),
    y: half((best[0].y + best[1].y) / 2 - h / 2),
    w,
    h,
  };
}

function shift(layout: LayoutResult, dx: number): void {
  if (dx === 0) return;
  for (const box of layout.boxes.values()) box.x = half(box.x + dx);
  for (const edge of layout.edges.values()) {
    for (const p of edge.points) p.x = half(p.x + dx);
    if (edge.label) edge.label.x = half(edge.label.x + dx);
  }
}

export async function layoutWorkflow(w: Workflow): Promise<Scene> {
  const sizes = new Map(w.steps.map((s) => [s.id, sizeStep(s)]));
  const lanes = w.lanes.length > 0;

  const edgeLabels = w.edges.map((e) =>
    e.label === undefined ? undefined : wrapText(e.label, EDGE_WRAP, EDGE_LABEL_SIZE, 400),
  );
  const plan = lanes ? planLanes(w, sizes, COLUMN_GAP, NODE_SPACING) : undefined;
  const labelBox = (lines: string[]) => ({
    width: Math.ceil(widest(lines, EDGE_LABEL_SIZE, 400)) + 2 * EDGE_LABEL_PAD,
    height: Math.ceil(lines.length * lineHeight(EDGE_LABEL_SIZE)) + 2 * EDGE_LABEL_PAD,
  });

  // A back edge inside one lane is drawn as a loop under its row. Left to ELK,
  // its dummy nodes push the steps of the cycle onto different rows.
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
    const size = sizes.get(s.id)!;
    const box: LayoutBox = { id: s.id, width: size.width, height: size.height };
    const at = plan?.positions.get(s.id);
    if (at) Object.assign(box, at);
    if (size.shape === "diamond") box.ports = decisionPorts(s.id, size, flow);
    return box;
  });
  const isDecision = new Set(w.steps.filter((s) => s.kind === "decision").map((s) => s.id));
  // With lanes the labels are placed after routing: ELK would put a label node
  // in the preset-free gap between layers and drag the edge with it. The gap
  // is widened instead, so a label fits between two columns.
  const widestLabel = Math.max(
    0,
    ...edgeLabels.map((lines) => (lines ? labelBox(lines).width : 0)),
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
      ? { interactive: true, layerSpacing: Math.max(LAYER_SPACING, widestLabel + 2 * LABEL_MARGIN) }
      : {},
  );

  let width = layout.width;
  let header = 0;
  if (lanes) {
    header = headerWidth(w);
    shift(layout, header);
    width = half(layout.width + header);
  }

  const nodes: SceneNode[] = w.steps.map((s) => {
    const size = sizes.get(s.id)!;
    const box = layout.boxes.get(s.id)!;
    const node: SceneNode = {
      id: s.id,
      kind: s.kind,
      shape: size.shape,
      ...box,
      label: stepLabel(size, box),
    };
    if (size.icon !== undefined) node.icon = size.icon;
    if (s.note !== undefined) node.note = s.note;
    if (s.source !== undefined) node.source = s.source;
    const lane = laneOf.get(s.id);
    if (lane !== undefined) node.parent = lane;
    return node;
  });
  const shapeOf = new Map(nodes.map((n) => [n.id, n]));

  const edges: SceneEdge[] = w.edges.map((e, i) => {
    const id = `e${i}`;
    const routed = layout.edges.get(id);
    const from = shapeOf.get(e.from)!;
    const to = shapeOf.get(e.to)!;
    let points = routed?.points ?? [];
    if (loops.has(i)) {
      const laneSteps = nodes.filter((n) => laneOf.get(n.id) === laneOf.get(e.from));
      points = loopUnder(from, to, laneSteps);
    } else if (lanes) {
      points = straighten(
        points,
        from,
        to,
        nodes.filter((n) => n !== from && n !== to),
      );
    }
    if (from.shape === "diamond") clipToDiamond(points, "start", from);
    if (to.shape === "diamond") clipToDiamond(points, "end", to);
    for (const p of points) {
      p.x = half(p.x);
      p.y = half(p.y);
    }
    const out: SceneEdge = { id, from: e.from, to: e.to, points, style: e.style };
    const lines = edgeLabels[i];
    const box = lines && lanes ? labelOnRoute(points, lines) : routed?.label;
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

  let groups: SceneGroup[] = [];
  let height = layout.height;
  if (lanes) {
    // How far each lane's loops and their labels reach below its steps.
    const reach = new Map<string, number>();
    for (const i of loops) {
      const e = edges[i]!;
      const bottom = Math.max(
        ...e.points.map((p) => p.y),
        e.label ? e.label.box.y + e.label.box.h : -Infinity,
      );
      const lane = laneOf.get(e.from)!;
      reach.set(lane, Math.max(reach.get(lane) ?? -Infinity, bottom));
    }
    height = half(Math.max(height, ...[...reach.values()].map((y) => y + BAND_PAD)));
    groups = buildBands(w, layout.boxes, width, height, header, reach);
    assertStepsInLanes(w.lanes, groups, layout.boxes);
  }

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
