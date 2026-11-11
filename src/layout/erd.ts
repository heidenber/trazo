// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Erd, ErdColumn, ErdRelation, ErdTable } from "../model/erd.js";
import type { Box, Point, Scene, SceneEdge, SceneNode, SceneRow, TextBlock } from "../scene.js";
import { firstBaseline, lineHeight, textWidth } from "../text/measure.js";
import { ROOT_PADDING, layoutElk, type LayoutBox, type LayoutEdge, type LayoutPort } from "./elk.js";

const HEADER = 32;
const ROW = 24;
const PAD = 12;
const GAP = 12;
const MIN_W = 160;
const TITLE_SIZE = 14;
const NAME_SIZE = 13;
const TYPE_SIZE = 12;
const MARKS_SIZE = 11;
/** Distance from the table edge to the vertical run of its first self-reference loop. */
const LOOP_OUT = 36;
const LOOP_STEP = 8;
/** Straight run at each end of a relation, so the crow's foot never sits on a bend. */
const END_RUN = 20;
/** Room between table columns for both crow's feet and the vertical runs between them. */
const COLUMN_GAP = 90;

const half = (v: number) => Math.round(v * 2) / 2;

interface Column {
  name: string;
  type: string;
  marks?: string;
  key: boolean;
  note?: string;
}

interface Sized {
  table: ErdTable;
  columns: Column[];
  width: number;
  height: number;
  nameWidth: number;
}

function describeColumn(c: ErdColumn): Column {
  const marks = [c.pk && "PK", c.fk && "FK", c.unique && "UQ"].filter(Boolean).join(" ");
  const out: Column = { name: c.name, type: c.nullable ? `${c.type}?` : c.type, key: c.pk };
  if (marks) out.marks = marks;
  if (c.note !== undefined) out.note = c.note;
  return out;
}

function sizeTable(table: ErdTable): Sized {
  const columns = table.columns.map(describeColumn);
  const widest = (values: number[]) => Math.max(0, ...values);
  const nameWidth = widest(columns.map((c) => textWidth(c.name, NAME_SIZE, c.key ? 600 : 400)));
  const typeWidth = widest(columns.map((c) => textWidth(c.type, TYPE_SIZE, 400)));
  const marksWidth = widest(columns.map((c) => (c.marks ? textWidth(c.marks, MARKS_SIZE, 600) : 0)));
  const body = nameWidth + GAP + typeWidth + (marksWidth > 0 ? GAP + marksWidth : 0);
  const title = textWidth(table.label, TITLE_SIZE, 600);
  const width = Math.max(MIN_W, Math.ceil(Math.max(body, title) + 2 * PAD));
  return { table, columns, width, height: HEADER + columns.length * ROW, nameWidth };
}

const baseline = (top: number, height: number, size: number) =>
  half(top + (height - lineHeight(size)) / 2 + firstBaseline(size));

function block(text: string, x: number, y: number, size: number, weight: 400 | 600): TextBlock {
  return { lines: [text], x: half(x), y, size, weight, anchor: "start" };
}

function buildRows(sized: Sized, box: Box): SceneRow[] {
  const typeX = box.x + PAD + sized.nameWidth + GAP;
  return sized.columns.map((c, i) => {
    const y = box.y + HEADER + i * ROW;
    const row: SceneRow = {
      y,
      h: ROW,
      name: block(c.name, box.x + PAD, baseline(y, ROW, NAME_SIZE), NAME_SIZE, c.key ? 600 : 400),
      type: block(c.type, typeX, baseline(y, ROW, TYPE_SIZE), TYPE_SIZE, 400),
      key: c.key,
    };
    if (c.marks) {
      const x = box.x + box.w - PAD - textWidth(c.marks, MARKS_SIZE, 600);
      row.marks = block(c.marks, x, baseline(y, ROW, MARKS_SIZE), MARKS_SIZE, 600);
    }
    if (c.note !== undefined) row.note = c.note;
    return row;
  });
}

const port = (table: string, column: string, side: "W" | "E") => `${table}:${column}:${side}`;

function ports(sized: Sized): LayoutPort[] {
  return sized.columns.flatMap((c, i) => {
    const y = HEADER + i * ROW + ROW / 2;
    return [
      { id: port(sized.table.id, c.name, "W"), side: "WEST" as const, x: 0, y },
      { id: port(sized.table.id, c.name, "E"), side: "EAST" as const, x: sized.width, y },
    ];
  });
}

/** Port sides facing the other table; tables sharing a column connect on their right. */
function sides(from: Box, to: Box): ["W" | "E", "W" | "E"] {
  if (to.x >= from.x + from.w) return ["E", "W"];
  if (to.x + to.w <= from.x) return ["W", "E"];
  return ["E", "E"];
}

function assertColumnsKept(before: Map<string, Box>, after: Map<string, Box>): void {
  for (const [a, boxA] of before) {
    for (const [b, boxB] of before) {
      if (boxA.x + boxA.w > boxB.x) continue;
      const movedA = after.get(a)!;
      const movedB = after.get(b)!;
      if (movedA.x + movedA.w > movedB.x) {
        throw new Error(`erd layout moved "${a}" out of its column relative to "${b}"`);
      }
    }
  }
}

function selfLoop(table: Box, fromY: number, toY: number, index: number): Point[] {
  const right = table.x + table.w;
  const out = right + LOOP_OUT + index * LOOP_STEP;
  return [
    { x: right, y: fromY },
    { x: out, y: fromY },
    { x: out, y: toY },
    { x: right, y: toY },
  ];
}

export async function layoutErd(d: Erd): Promise<Scene> {
  const sized = new Map(d.tables.map((t) => [t.id, sizeTable(t)]));
  const linked = d.relations.filter((r) => r.from !== r.to);
  const boxes = (at?: Map<string, Box>): LayoutBox[] =>
    d.tables.map((t) => {
      const s = sized.get(t.id)!;
      const box: LayoutBox = { id: t.id, width: s.width, height: s.height, ports: ports(s) };
      const placed = at?.get(t.id);
      if (placed) Object.assign(box, { x: placed.x, y: placed.y });
      return box;
    });
  const edge = (r: ErdRelation, [a, b]: ["W" | "E", "W" | "E"]): LayoutEdge => ({
    id: r.id,
    from: r.from,
    to: r.to,
    fromPort: port(r.from, r.fromColumn, a),
    toPort: port(r.to, r.toColumn, b),
  });

  // The first pass only decides columns: a reversed edge of a cycle still
  // points the wrong way and is routed around everything. The second pass
  // keeps those columns and lets each edge leave on the side facing its target.
  const options = { edgeNodeSpacing: END_RUN, layerSpacing: COLUMN_GAP };
  const first = await layoutElk(boxes(), linked.map((r) => edge(r, ["E", "W"])), "RIGHT", options);
  const layout = await layoutElk(
    boxes(first.boxes),
    linked.map((r) => edge(r, sides(first.boxes.get(r.from)!, first.boxes.get(r.to)!))),
    "RIGHT",
    { ...options, interactive: true },
  );
  assertColumnsKept(first.boxes, layout.boxes);

  const nodes: SceneNode[] = d.tables.map((t) => {
    const s = sized.get(t.id)!;
    const box = layout.boxes.get(t.id)!;
    const node: SceneNode = {
      id: t.id,
      kind: "table",
      shape: "table",
      ...box,
      header: HEADER,
      label: block(t.label, box.x + PAD, baseline(box.y, HEADER, TITLE_SIZE), TITLE_SIZE, 600),
      rows: buildRows(s, box),
    };
    if (t.note !== undefined) node.note = t.note;
    if (t.source !== undefined) node.source = t.source;
    return node;
  });
  const nodeOf = new Map(nodes.map((n) => [n.id, n]));
  const rowCentre = (table: string, column: string) => {
    const index = sized.get(table)!.columns.findIndex((c) => c.name === column);
    return nodeOf.get(table)!.y + HEADER + index * ROW + ROW / 2;
  };

  const loops = new Map<string, number>();
  const edges: SceneEdge[] = d.relations.map((r) => {
    let points: Point[];
    if (r.from === r.to) {
      const index = loops.get(r.from) ?? 0;
      loops.set(r.from, index + 1);
      points = selfLoop(nodeOf.get(r.from)!, rowCentre(r.from, r.fromColumn), rowCentre(r.to, r.toColumn), index);
    } else {
      points = layout.edges.get(r.id)?.points ?? [];
    }
    return {
      id: r.id,
      from: r.from,
      to: r.to,
      points: points.map((p) => ({ x: half(p.x), y: half(p.y) })),
      style: "sync",
      ends: { from: r.fromEnd, to: r.toEnd },
    };
  });

  const reach = Math.max(0, ...edges.flatMap((e) => e.points.map((p) => p.x)));
  const width = half(Math.max(layout.width, reach + ROOT_PADDING));
  const scene: Scene = { type: d.type, title: d.title, theme: d.theme, width, height: layout.height, groups: [], nodes, edges };
  if (d.description !== undefined) scene.description = d.description;
  return scene;
}
