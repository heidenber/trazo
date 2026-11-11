// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Architecture, ArchNode, NodeKind } from "../model/architecture.js";
import type { Box, Scene, SceneEdge, SceneGroup, SceneNode, TextBlock } from "../scene.js";
import { firstBaseline, lineHeight, textWidth, wrapText } from "../text/measure.js";
import { layoutElk, type LayoutBox } from "./elk.js";

const ICONS: Record<NodeKind, string> = {
  client: "monitor",
  user: "user",
  gateway: "network",
  service: "server",
  function: "zap",
  database: "database",
  cache: "layers",
  queue: "inbox",
  storage: "hard-drive",
  external: "globe",
};

const NODE_LABEL_SIZE = 14;
const NODE_WRAP = 150;
const ICON_SIZE = 20;
const ICON_PAD = 12;
const ICON_GAP = 10;
const RIGHT_PAD = 12;
const NODE_MIN_W = 120;
const NODE_MIN_H = 44;
const NODE_PAD_Y = 10;
const GROUP_TITLE_SIZE = 12;
const GROUP_TITLE_X = 12;
const GROUP_TITLE_TOP = 8;
const EDGE_LABEL_SIZE = 12;
const EDGE_WRAP = 140;
const EDGE_LABEL_PAD = 4;

const half = (v: number) => Math.round(v * 2) / 2;
const widest = (lines: string[], size: number, weight: 400 | 600) =>
  Math.max(0, ...lines.map((l) => textWidth(l, size, weight)));

function sizeNode(node: ArchNode): { width: number; height: number; lines: string[] } {
  const lines = wrapText(node.label, NODE_WRAP, NODE_LABEL_SIZE, 600);
  const textLeft = ICON_PAD + ICON_SIZE + ICON_GAP;
  const width = Math.max(
    NODE_MIN_W,
    Math.ceil(textLeft + widest(lines, NODE_LABEL_SIZE, 600) + RIGHT_PAD),
  );
  const height = Math.max(
    NODE_MIN_H,
    Math.ceil(lines.length * lineHeight(NODE_LABEL_SIZE) + 2 * NODE_PAD_Y),
  );
  return { width, height, lines };
}

export async function layoutArchitecture(d: Architecture): Promise<Scene> {
  const groupById = new Map(d.groups.map((g) => [g.id, g]));
  const sizes = new Map(d.nodes.map((n) => [n.id, sizeNode(n)]));
  const nested = new Set(d.groups.flatMap((g) => g.children));

  const build = (id: string): LayoutBox => {
    const group = groupById.get(id);
    if (group) {
      const minWidth = Math.ceil(widest([group.label], GROUP_TITLE_SIZE, 600) + 2 * GROUP_TITLE_X);
      return { id, width: minWidth, height: 0, minWidth, children: group.children.map(build) };
    }
    const size = sizes.get(id)!;
    return { id, width: size.width, height: size.height };
  };
  const roots = [...d.nodes.map((n) => n.id), ...d.groups.map((g) => g.id)].filter(
    (id) => !nested.has(id),
  );

  const edgeLabels = d.edges.map((e) =>
    e.label === undefined ? undefined : wrapText(e.label, EDGE_WRAP, EDGE_LABEL_SIZE, 400),
  );
  const layout = await layoutElk(
    roots.map(build),
    d.edges.map((e, i) => {
      const lines = edgeLabels[i];
      const edge = { id: `e${i}`, from: e.from, to: e.to };
      if (!lines) return edge;
      return {
        ...edge,
        label: {
          width: Math.ceil(widest(lines, EDGE_LABEL_SIZE, 400)) + 2 * EDGE_LABEL_PAD,
          height: Math.ceil(lines.length * lineHeight(EDGE_LABEL_SIZE)) + 2 * EDGE_LABEL_PAD,
        },
      };
    }),
    d.direction === "down" ? "DOWN" : "RIGHT",
  );

  const boxOf = (id: string): Box => layout.boxes.get(id)!;
  const parentOf = new Map(d.groups.flatMap((g) => g.children.map((c) => [c, g.id] as const)));

  const nodes: SceneNode[] = d.nodes.map((n) => {
    const box = boxOf(n.id);
    const size = sizes.get(n.id)!;
    const block = size.lines.length * lineHeight(NODE_LABEL_SIZE);
    const label: TextBlock = {
      lines: size.lines,
      x: half(box.x + ICON_PAD + ICON_SIZE + ICON_GAP),
      y: half(box.y + (box.h - block) / 2 + firstBaseline(NODE_LABEL_SIZE)),
      size: NODE_LABEL_SIZE,
      weight: 600,
      anchor: "start",
    };
    const out: SceneNode = {
      id: n.id,
      kind: n.kind,
      icon: ICONS[n.kind],
      shape: "box",
      ...box,
      label,
    };
    if (n.note !== undefined) out.note = n.note;
    if (n.source !== undefined) out.source = n.source;
    const parent = parentOf.get(n.id);
    if (parent !== undefined) out.parent = parent;
    return out;
  });

  const depths = new Map<string, number>();
  const walk = (id: string, depth: number) => {
    const group = groupById.get(id);
    if (!group) return;
    depths.set(id, depth);
    group.children.forEach((c) => walk(c, depth + 1));
  };
  roots.forEach((id) => walk(id, 0));
  const groups: SceneGroup[] = d.groups
    .map((g): SceneGroup => {
      const box = boxOf(g.id);
      return {
        id: g.id,
        ...box,
        depth: depths.get(g.id) ?? 0,
        variant: "group",
        label: {
          lines: [g.label],
          x: half(box.x + GROUP_TITLE_X),
          y: half(box.y + GROUP_TITLE_TOP + firstBaseline(GROUP_TITLE_SIZE)),
          size: GROUP_TITLE_SIZE,
          weight: 600,
          anchor: "start",
        },
      };
    })
    .sort((a, b) => a.depth - b.depth);

  const edges: SceneEdge[] = d.edges.map((e, i) => {
    const id = `e${i}`;
    const routed = layout.edges.get(id);
    const out: SceneEdge = {
      id,
      from: e.from,
      to: e.to,
      points: routed?.points ?? [],
      style: e.style,
    };
    const lines = edgeLabels[i];
    if (lines && routed?.label) {
      const box = routed.label;
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
    type: d.type,
    title: d.title,
    theme: d.theme,
    width: layout.width,
    height: layout.height,
    groups,
    nodes,
    edges,
  };
  if (d.description !== undefined) scene.description = d.description;
  return scene;
}
