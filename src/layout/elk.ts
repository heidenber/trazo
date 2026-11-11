// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import ElkModule, { type ELK as ElkInstance } from "elkjs/lib/elk.bundled.js";
import type { Box, Point } from "../scene.js";

// NodeNext types the CJS default import as the module namespace, but at
// runtime it is the constructor itself.
const ELK = ElkModule as unknown as new () => ElkInstance;

export interface LayoutPort {
  id: string;
  side: "NORTH" | "SOUTH" | "EAST" | "WEST";
  /** Position relative to the box origin. */
  x: number;
  y: number;
}

export interface LayoutBox {
  id: string;
  width: number;
  height: number;
  children?: LayoutBox[];
  padding?: { top: number; left: number; bottom: number; right: number };
  minWidth?: number;
  minHeight?: number;
  /** Preset position, used only with the interactive strategies. */
  x?: number;
  y?: number;
  /** Fixed attachment points; edges refer to them through fromPort/toPort. */
  ports?: LayoutPort[];
}

export interface LayoutOptions {
  /** Keep the preset positions of the boxes as layering, ordering and placement hints. */
  interactive?: boolean;
  /** Gap between layers; defaults to LAYER_SPACING. */
  layerSpacing?: number;
  /** Minimum horizontal run between a box and the first bend of an edge in the gap next to it. */
  edgeNodeSpacing?: number;
}

export interface LayoutEdge {
  id: string;
  from: string;
  to: string;
  fromPort?: string;
  toPort?: string;
  label?: { width: number; height: number };
}

export interface LayoutResult {
  width: number;
  height: number;
  boxes: Map<string, Box>;
  edges: Map<string, { points: Point[]; label?: Box }>;
}

export const NODE_SPACING = 40;
export const LAYER_SPACING = 60;
export const ROOT_PADDING = 24;
export const GROUP_PADDING = { top: 36, left: 16, bottom: 16, right: 16 };

interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  edges?: ElkEdge[];
  layoutOptions?: Record<string, string>;
  ports?: ElkPort[];
}

interface ElkPort {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}

interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  container?: string;
  labels?: { id?: string; text?: string; x?: number; y?: number; width: number; height: number }[];
  sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[];
}

const half = (v: number) => Math.round(v * 2) / 2;

function toElk(box: LayoutBox): ElkNode {
  const node: ElkNode = { id: box.id, width: box.width, height: box.height };
  if (box.x !== undefined) node.x = box.x;
  if (box.y !== undefined) node.y = box.y;
  if (box.ports?.length) {
    node.ports = box.ports.map((port) => ({
      id: port.id,
      x: port.x,
      y: port.y,
      width: 0,
      height: 0,
      layoutOptions: { "elk.port.side": port.side },
    }));
    node.layoutOptions = { "elk.portConstraints": "FIXED_POS" };
  }
  if (box.children?.length) {
    const p = box.padding ?? GROUP_PADDING;
    node.children = box.children.map(toElk);
    node.layoutOptions = {
      ...node.layoutOptions,
      "elk.padding": `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`,
      "elk.nodeSize.constraints": "MINIMUM_SIZE",
      "elk.nodeSize.minimum": `(${box.minWidth ?? box.width},${box.minHeight ?? box.height})`,
    };
  }
  return node;
}

export async function layoutElk(
  boxes: LayoutBox[],
  edges: LayoutEdge[],
  direction: "RIGHT" | "DOWN",
  options: LayoutOptions = {},
): Promise<LayoutResult> {
  const root: ElkNode = {
    id: "root",
    children: boxes.map(toElk),
    edges: edges.map((e) => {
      const edge: ElkEdge = {
        id: e.id,
        sources: [e.fromPort ?? e.from],
        targets: [e.toPort ?? e.to],
      };
      // ELK skips placement for labels without text; the real text is drawn later.
      if (e.label)
        edge.labels = [
          { id: `${e.id}:label`, text: e.id, width: e.label.width, height: e.label.height },
        ];
      return edge;
    }),
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": direction,
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.randomSeed": "1",
      "elk.edgeLabels.inline": "true",
      "elk.spacing.nodeNode": String(NODE_SPACING),
      "elk.layered.spacing.nodeNodeBetweenLayers": String(options.layerSpacing ?? LAYER_SPACING),
      "elk.padding": `[top=${ROOT_PADDING},left=${ROOT_PADDING},bottom=${ROOT_PADDING},right=${ROOT_PADDING}]`,
    },
  };

  if (options.edgeNodeSpacing !== undefined) {
    root.layoutOptions!["elk.layered.spacing.edgeNodeBetweenLayers"] = String(
      options.edgeNodeSpacing,
    );
  }

  if (options.interactive) {
    // Layering and ordering follow the preset coordinates instead of the graph
    // alone; lane layouts rely on this to keep each step in its band.
    Object.assign(root.layoutOptions!, {
      "elk.layered.layering.strategy": "INTERACTIVE",
      "elk.layered.crossingMinimization.strategy": "INTERACTIVE",
      "elk.layered.nodePlacement.strategy": "INTERACTIVE",
      "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
    });
  }

  const laid = (await new ELK().layout(root as never)) as unknown as ElkNode;

  const result: LayoutResult = {
    width: half(laid.width ?? 0),
    height: half(laid.height ?? 0),
    boxes: new Map(),
    edges: new Map(),
  };
  const origin = new Map<string, Point>([["root", { x: 0, y: 0 }]]);

  // Child coordinates are relative to their parent.
  const place = (node: ElkNode, parent: Point) => {
    const abs = { x: parent.x + (node.x ?? 0), y: parent.y + (node.y ?? 0) };
    origin.set(node.id, abs);
    result.boxes.set(node.id, {
      x: half(abs.x),
      y: half(abs.y),
      w: half(node.width ?? 0),
      h: half(node.height ?? 0),
    });
    for (const child of node.children ?? []) place(child, abs);
  };
  for (const child of laid.children ?? []) place(child, origin.get("root")!);

  // ELK stores each edge on the lowest common ancestor of its endpoints, and
  // its sections and labels are relative to that container's origin.
  const collect = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      const base = origin.get(edge.container ?? node.id) ?? { x: 0, y: 0 };
      const section = edge.sections?.[0];
      const points: Point[] = section
        ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
            x: half(base.x + p.x),
            y: half(base.y + p.y),
          }))
        : [];
      const label = edge.labels?.[0];
      const entry: { points: Point[]; label?: Box } = { points };
      if (label && label.x !== undefined && label.y !== undefined) {
        entry.label = {
          x: half(base.x + label.x),
          y: half(base.y + label.y),
          w: half(label.width),
          h: half(label.height),
        };
      }
      result.edges.set(edge.id, entry);
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(laid);
  return result;
}
