// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type {
  Chen,
  ChenAttribute,
  ChenEntity,
  ChenParticipant,
  ChenRelationship,
} from "../model/chen.js";
import type {
  Box,
  ChenMark,
  NodeShape,
  Point,
  Scene,
  SceneEdge,
  SceneLegendItem,
  SceneNode,
  TextBlock,
} from "../scene.js";
import { DOUBLE_GAP } from "../render/shapes.js";
import { textWidth } from "../text/measure.js";
import { clipEnd, leave, offsetPolyline, type Shape } from "./chen-geometry.js";
import {
  ROOT_PADDING,
  layoutElk,
  type LayoutBox,
  type LayoutEdge,
  type LayoutPort,
} from "./elk.js";

// Sizes follow the chosen artboard (design/t10-chen/02-columns.html).
const FS_ENTITY = 15;
const FS_REL = 12.5;
const FS_ATTR = 12.5;
const FS_CARD = 13.5;
const ENTITY_H = 46;
const ENTITY_MIN_W = 112;
const REL_B = 31;
const REL_MIN_A = 52;
const ATTR_RY = 16;
const ATTR_MIN_RX = 32;
/** Gap between the two outlines of a double shape and between the strands of a double line. */
const DBL = DOUBLE_GAP;
/** Distance between two relationship ports on one entity side. */
const PORT_STEP = 24;
const COLUMN_GAP = 56;
const ROW_GAP = 40;
const REL_ROW_GAP = 26;
const LEVEL_GAP = 38;
const OVAL_GAP = 10;
/** Room under a recursive relationship's entity for the line that goes around. */
const LOOP_ROOM = 50;
const LOOP_STEP = 12;
const LAYER_GAP = 84;
const END_RUN = 34;

type Side = "W" | "E" | "N" | "S";

interface Item {
  id: string;
  shape: NodeShape;
  kind: string;
  mark?: ChenMark;
  label: string;
  size: number;
  weight: 400 | 600;
  /** Centre inside the pod, then absolute once the pod is placed. */
  cx: number;
  cy: number;
  /** Half sizes of the outer border. */
  hw: number;
  hh: number;
  note?: string;
  detail?: string;
}

interface Oval {
  attr: ChenAttribute;
  item: Item;
  kids: Oval[];
}

interface Line {
  from: Item;
  to: Item;
  a: Point;
  b: Point;
}

const kindOf = (item: Pick<Item, "shape">): Shape["kind"] =>
  item.shape === "entity" || item.shape === "weak-entity"
    ? "rect"
    : item.shape === "relationship" || item.shape === "identifying"
      ? "diamond"
      : "ellipse";

const shapeOf = (item: Item): Shape => ({
  kind: kindOf(item),
  cx: item.cx,
  cy: item.cy,
  hw: item.hw,
  hh: item.hh,
});

// ---------------------------------------------------------------------------
// Sizing

function entityItem(e: ChenEntity, ports: number): Item {
  const w = Math.max(ENTITY_MIN_W, textWidth(e.label, FS_ENTITY, 600) + 40);
  const h = Math.max(ENTITY_H, (ports - 1) * PORT_STEP + 30);
  const grow = e.weak ? 2 * DBL : 0;
  const item: Item = {
    id: e.id,
    shape: e.weak ? "weak-entity" : "entity",
    kind: e.weak ? "weak entity" : "entity",
    label: e.label,
    size: FS_ENTITY,
    weight: 600,
    cx: 0,
    cy: 0,
    hw: (w + grow) / 2,
    hh: (h + grow) / 2,
  };
  if (e.note !== undefined) item.note = e.note;
  return item;
}

function relationshipItem(r: ChenRelationship): Item {
  const b = REL_B;
  const a = Math.max(
    REL_MIN_A,
    textWidth(r.label, FS_REL, 600) / 2 / (0.86 - (0.36 * FS_REL) / b) + 4,
  );
  // An identifying relationship's outer diamond keeps its edges parallel, DBL away from the inner.
  const hyp = Math.hypot(a, b);
  const item: Item = {
    id: r.id,
    shape: r.identifying ? "identifying" : "relationship",
    kind: r.identifying ? "identifying relationship" : "relationship",
    label: r.label,
    size: FS_REL,
    weight: 600,
    cx: 0,
    cy: 0,
    hw: r.identifying ? a + (DBL * hyp) / b : a,
    hh: r.identifying ? b + (DBL * hyp) / a : b,
  };
  if (r.note !== undefined) item.note = r.note;
  return item;
}

function ovalOf(attr: ChenAttribute, id: string): Oval {
  const sq = Math.sqrt(0.86 - ((0.36 * FS_ATTR) / ATTR_RY) ** 2);
  const rx = Math.max(ATTR_MIN_RX, textWidth(attr.name, FS_ATTR, 400) / 2 / sq + 4);
  const multi = attr.kind === "multivalued";
  const composite = attr.children.length > 0;
  const mark: ChenMark | undefined =
    attr.kind === "key" || attr.kind === "partial" || attr.kind === "derived"
      ? attr.kind
      : undefined;
  const kind =
    attr.kind === "key"
      ? "key attribute"
      : attr.kind === "partial"
        ? "partial key"
        : multi
          ? "multivalued attribute"
          : attr.kind === "derived"
            ? "derived attribute"
            : composite
              ? "composite attribute"
              : "attribute";
  const item: Item = {
    id,
    shape: multi ? "multivalued" : "attribute",
    kind,
    label: attr.name,
    size: FS_ATTR,
    weight: 400,
    cx: 0,
    cy: 0,
    hw: rx + (multi ? DBL : 0),
    hh: ATTR_RY + (multi ? DBL : 0),
  };
  if (mark !== undefined) item.mark = mark;
  return { attr, item, kids: attr.children.map((c) => ovalOf(c, `${id}.${c.name}`)) };
}

// ---------------------------------------------------------------------------
// Attributes around an owner

const ORIENTATION: Record<Side, { u: Point; v: Point }> = {
  W: { u: { x: -1, y: 0 }, v: { x: 0, y: 1 } },
  E: { u: { x: 1, y: 0 }, v: { x: 0, y: 1 } },
  N: { u: { x: 0, y: -1 }, v: { x: 1, y: 0 } },
  S: { u: { x: 0, y: 1 }, v: { x: 1, y: 0 } },
};

const flat = (ovals: Oval[]): Oval[] => ovals.flatMap((o) => [o, ...flat(o.kids)]);

function clear(lines: Line[], ovals: Oval[]): boolean {
  for (const line of lines) {
    for (const o of ovals) {
      if (o.item === line.from || o.item === line.to) continue;
      const i = o.item;
      for (let k = 1; k < 40; k++) {
        const t = k / 40;
        const x = line.a.x + (line.b.x - line.a.x) * t;
        const y = line.a.y + (line.b.y - line.a.y) * t;
        if (Math.abs(x - i.cx) < i.hw + 3 && Math.abs(y - i.cy) < i.hh + 3) return false;
      }
    }
  }
  return true;
}

/**
 * Stacks the ovals in a column (side W or E) or a row (N or S) beside the owner, whose centre is
 * the origin. Composite parts sit one column further out. Every line goes to the owner: to a point
 * spread along a rectangle's side so the fan never crosses itself, or to the centre of a diamond.
 * The gap grows until no line touches another oval.
 */
function arrange(owner: Item, top: Oval[], side: Side, base: number): Line[] {
  const { u, v } = ORIENTATION[side];
  const lateral = side === "W" || side === "E";
  const uExt = (i: Item) => (lateral ? 2 * i.hw : 2 * i.hh);
  const vExt = (i: Item) => (lateral ? 2 * i.hh : 2 * i.hw);
  const space = lateral ? OVAL_GAP : OVAL_GAP + 2;
  const block = (o: Oval): number =>
    Math.max(
      vExt(o.item),
      o.kids.reduce((sum, k) => sum + block(k), 0) + space * Math.max(0, o.kids.length - 1),
    );
  const span = (list: Oval[]) =>
    list.reduce((sum, o) => sum + block(o), 0) + space * Math.max(0, list.length - 1);

  const levels: number[] = [];
  const measure = (list: Oval[], depth: number) => {
    for (const o of list) {
      levels[depth] = Math.max(levels[depth] ?? 0, uExt(o.item));
      measure(o.kids, depth + 1);
    }
  };
  measure(top, 0);

  const lines: Line[] = [];
  const all = flat(top);
  const reach = lateral ? owner.hw : owner.hh;
  const rect = owner.shape === "entity" || owner.shape === "weak-entity";
  const usable = lateral ? 2 * owner.hh - 22 : 2 * owner.hw - 28;
  const step = top.length > 1 ? Math.min(lateral ? 7 : 24, usable / (top.length - 1)) : 0;

  for (let gap = base; gap < base + 240; gap += 8) {
    const centre: number[] = [];
    levels.forEach((size, l) => {
      centre[l] =
        l === 0
          ? reach + gap + size / 2
          : centre[l - 1]! + levels[l - 1]! / 2 + LEVEL_GAP + size / 2;
    });
    const put = (o: Oval, depth: number, vc: number) => {
      o.item.cx = owner.cx + u.x * centre[depth]! + v.x * vc;
      o.item.cy = owner.cy + u.y * centre[depth]! + v.y * vc;
      let at = vc - span(o.kids) / 2;
      for (const k of o.kids) {
        put(k, depth + 1, at + block(k) / 2);
        at += block(k) + space;
      }
    };
    let at = -span(top) / 2;
    for (const o of top) {
      put(o, 0, at + block(o) / 2);
      at += block(o) + space;
    }

    lines.length = 0;
    top.forEach((o, i) => {
      const t = (i - (top.length - 1) / 2) * step;
      const target: Point = rect
        ? {
            x: owner.cx + (lateral ? u.x * owner.hw : t),
            y: owner.cy + (lateral ? t : u.y * owner.hh),
          }
        : { x: owner.cx, y: owner.cy };
      const from = { x: o.item.cx, y: o.item.cy };
      lines.push({
        from: o.item,
        to: owner,
        a: leave(shapeOf(o.item), from, target),
        b: rect ? target : leave(shapeOf(owner), { x: owner.cx, y: owner.cy }, from),
      });
    });
    for (const parent of all) {
      for (const kid of parent.kids) {
        const pc = { x: parent.item.cx, y: parent.item.cy };
        const kc = { x: kid.item.cx, y: kid.item.cy };
        lines.push({
          from: kid.item,
          to: parent.item,
          a: leave(shapeOf(kid.item), kc, pc),
          b: leave(shapeOf(parent.item), pc, kc),
        });
      }
    }
    if (clear(lines, all)) break;
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Pods: an owner and everything attached to it, laid out as one rigid box

interface Pod {
  id: string;
  /** Items with centres inside the pod box. */
  items: Item[];
  lines: Line[];
  owner: Item;
  w: number;
  h: number;
  /** Entity side that holds the attribute column, or "N" for a row on top. */
  side?: Side;
}

function bounds(items: Item[]): Box {
  const x0 = Math.min(...items.map((i) => i.cx - i.hw));
  const y0 = Math.min(...items.map((i) => i.cy - i.hh));
  const x1 = Math.max(...items.map((i) => i.cx + i.hw));
  const y1 = Math.max(...items.map((i) => i.cy + i.hh));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function podOf(owner: Item, groups: [Oval[], Side, number][], room = 0): Pod {
  const lines = groups.flatMap(([list, side, gap]) => arrange(owner, list, side, gap));
  const items = [owner, ...groups.flatMap(([list]) => flat(list).map((o) => o.item))];
  const box = bounds(items);
  const shift = { x: -box.x, y: -box.y };
  for (const item of items) {
    item.cx += shift.x;
    item.cy += shift.y;
  }
  for (const l of lines) {
    for (const p of [l.a, l.b]) {
      p.x += shift.x;
      p.y += shift.y;
    }
  }
  return { id: owner.id, items, lines, owner, w: box.w, h: box.h + room };
}

// ---------------------------------------------------------------------------
// Connectors

interface Link {
  id: string;
  relationship: ChenRelationship;
  index: 0 | 1;
  participant: ChenParticipant;
  /** Set for the second line of a recursive relationship, which goes around the entity. */
  around?: number;
}

const half = (n: number) => Math.round(n * 2) / 2;

function dedupe(pts: Point[]): Point[] {
  return pts.filter(
    (p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 0.01,
  );
}

function plural(label: string): string {
  return label.endsWith("s") ? label : `${label}s`;
}

function reading(r: ChenRelationship, name: (id: string) => string, weak: Set<string>): string[] {
  const [p, q] = r.participants;
  // "Each <subject> is related to <how many> <other>": the other end's
  // cardinality is the upper bound, the subject's participation the lower one.
  const howMany = (subject: ChenParticipant, other: ChenParticipant) =>
    other.cardinality === "1"
      ? subject.total
        ? "exactly one"
        : "at most one"
      : subject.total
        ? "one or more"
        : "many";
  const noun = (x: ChenParticipant) =>
    x.cardinality === "1" ? name(x.entity) : plural(name(x.entity));
  const out = [
    `Each ${name(q.entity)} is related to ${howMany(q, p)} ${noun(p)}.`,
    `Each ${name(p.entity)} is related to ${howMany(p, q)} ${noun(q)}.`,
  ];
  for (const x of [p, q]) {
    const e = name(x.entity);
    out.push(
      x.total
        ? `${e}: total participation, every ${e} takes part.`
        : `${e}: partial participation, some ${plural(e)} may not take part.`,
    );
  }
  if (r.identifying) {
    const owned = weak.has(q.entity) ? q : p;
    const other = owned === q ? p : q;
    out.push(
      `Identifying relationship: a ${name(owned.entity)} is identified through its ${name(other.entity)}.`,
    );
  }
  return out;
}

function describe(attr: ChenAttribute, owner: string): string {
  const base: Record<string, string> = {
    key: `Key: uniquely identifies each ${owner}.`,
    partial: `Partial key: tells apart the ${plural(owner)} of one owner; unique only together with it.`,
    multivalued: `Multivalued: may hold several values for one ${owner}.`,
    derived: `Derived: computed from other data, not stored.`,
    simple: `Describes ${owner}.`,
  };
  const parts =
    attr.children.length > 0
      ? ` Composite: made of ${attr.children.map((c) => c.name).join(", ")}.`
      : "";
  return `${base[attr.kind]!}${parts}`;
}

// ---------------------------------------------------------------------------
// Legend

interface Glyph {
  glyph: string;
  label: string;
  family?: string;
}

function glyphsFor(d: Chen): Glyph[] {
  const all = [
    ...d.entities.flatMap((e) => e.attributes),
    ...d.relationships.flatMap((r) => r.attributes),
  ];
  const walk = (list: ChenAttribute[]): ChenAttribute[] =>
    list.flatMap((a) => [a, ...walk(a.children)]);
  const attrs = walk(all);
  const participants = d.relationships.flatMap((r) => r.participants);
  const has = (test: (a: ChenAttribute) => boolean) => attrs.some(test);
  const out: (Glyph & { on: boolean })[] = [
    { glyph: "entity", label: "Entity", family: "compute", on: d.entities.some((e) => !e.weak) },
    {
      glyph: "weak-entity",
      label: "Weak entity",
      family: "compute",
      on: d.entities.some((e) => e.weak),
    },
    {
      glyph: "relationship",
      label: "Relationship",
      family: "messaging",
      on: d.relationships.some((r) => !r.identifying),
    },
    {
      glyph: "identifying",
      label: "Identifying relationship",
      family: "messaging",
      on: d.relationships.some((r) => r.identifying),
    },
    { glyph: "attribute", label: "Attribute", family: "data", on: has((a) => a.kind === "simple") },
    { glyph: "key", label: "Key attribute", family: "data", on: has((a) => a.kind === "key") },
    {
      glyph: "partial",
      label: "Partial key",
      family: "data",
      on: has((a) => a.kind === "partial"),
    },
    {
      glyph: "multivalued",
      label: "Multivalued",
      family: "data",
      on: has((a) => a.kind === "multivalued"),
    },
    { glyph: "derived", label: "Derived", family: "data", on: has((a) => a.kind === "derived") },
    {
      glyph: "composite",
      label: "Composite",
      family: "data",
      on: has((a) => a.children.length > 0),
    },
    { glyph: "total", label: "Total participation", on: participants.some((p) => p.total) },
    {
      glyph: "partial-participation",
      label: "Partial participation",
      on: participants.some((p) => !p.total),
    },
    { glyph: "cardinality", label: "Cardinality: 1, N, M", on: participants.length > 0 },
  ];
  return out.filter((g) => g.on).map(({ on: _on, ...g }) => g);
}

const LEGEND = {
  pad: 24,
  w: 52,
  h: 28,
  gap: 8,
  between: 24,
  row: 32,
  top: 16,
  bottom: 16,
  size: 12,
};

function legendFor(
  d: Chen,
  width: number,
  top: number,
): { items: SceneLegendItem[]; height: number } {
  const items: SceneLegendItem[] = [];
  let x = LEGEND.pad;
  let row = 0;
  for (const g of glyphsFor(d)) {
    const w = LEGEND.w + LEGEND.gap + textWidth(g.label, LEGEND.size, 400);
    if (x > LEGEND.pad && x + w > width - LEGEND.pad) {
      x = LEGEND.pad;
      row++;
    }
    const y = top + row * LEGEND.row;
    items.push({
      ...(g.family === undefined ? {} : { family: g.family }),
      glyph: g.glyph,
      swatch: { x, y, w: LEGEND.w, h: LEGEND.h },
      label: {
        lines: [g.label],
        x: x + LEGEND.w + LEGEND.gap,
        y: y + LEGEND.h / 2 + 0.36 * LEGEND.size + 0.5,
        size: LEGEND.size,
        weight: 400,
        anchor: "start",
      },
    });
    x += w + LEGEND.between;
  }
  return { items, height: (row + 1) * LEGEND.row };
}

// ---------------------------------------------------------------------------
// Layout

/** Breadth-first levels over entities and relationships, so every connector points the same way. */
function levelsOf(d: Chen): Map<string, number> {
  const adjacent = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    adjacent.set(a, [...(adjacent.get(a) ?? []), b]);
    adjacent.set(b, [...(adjacent.get(b) ?? []), a]);
  };
  for (const e of d.entities) adjacent.set(e.id, []);
  for (const r of d.relationships) {
    adjacent.set(r.id, []);
    for (const p of new Set(r.participants.map((x) => x.entity))) link(p, r.id);
  }
  const level = new Map<string, number>();
  const byDegree = [...d.entities].sort(
    (a, b) => adjacent.get(b.id)!.length - adjacent.get(a.id)!.length,
  );
  for (const root of byDegree) {
    if (level.has(root.id)) continue;
    level.set(root.id, 0);
    const queue = [root.id];
    for (const id of queue) {
      for (const next of adjacent.get(id)!) {
        if (level.has(next)) continue;
        level.set(next, level.get(id)! + 1);
        queue.push(next);
      }
    }
  }
  return level;
}

const baselineOf = (cy: number, size: number) => cy + 0.36 * size;

export async function layoutChen(d: Chen): Promise<Scene> {
  const level = levelsOf(d);
  const entity = new Map(d.entities.map((e) => [e.id, e]));
  const name = (id: string) => entity.get(id)!.label;

  // Connectors. A recursive relationship sends its first line through the layout and routes
  // the second one around its entity.
  const links: Link[] = d.relationships.flatMap((r) =>
    r.participants.map((participant, i): Link => {
      const base = { id: `${r.id}.${i}`, relationship: r, index: i as 0 | 1, participant };
      return i === 1 && r.participants[0].entity === participant.entity
        ? { ...base, around: 0 }
        : base;
    }),
  );
  const loops = new Map<string, number>();
  for (const l of links) {
    if (l.around === undefined) continue;
    const n = loops.get(l.participant.entity) ?? 0;
    l.around = n;
    loops.set(l.participant.entity, n + 1);
  }
  const routed = links.filter((l) => l.around === undefined);
  const srcIsEntity = (l: Link) => level.get(l.participant.entity)! < level.get(l.relationship.id)!;

  // Sides of every entity in use: lower-level entities leave on the right, higher ones arrive on the left.
  const used = new Map<string, { W: Link[]; E: Link[] }>(
    d.entities.map((e) => [e.id, { W: [], E: [] }]),
  );
  for (const l of routed) used.get(l.participant.entity)![srcIsEntity(l) ? "E" : "W"].push(l);

  // Room under an entity and under its recursive diamonds for the lines that go around.
  const loopRoom = (entityId: string) =>
    loops.has(entityId) ? LOOP_ROOM + LOOP_STEP * (loops.get(entityId)! - 1) : 0;
  const pods = new Map<string, Pod>();
  const relOf = new Map(d.relationships.map((r) => [r.id, r]));
  for (const e of d.entities) {
    const u = used.get(e.id)!;
    const item = entityItem(e, Math.max(u.W.length, u.E.length));
    const side: Side = u.W.length > 0 && u.E.length > 0 ? "N" : u.E.length > 0 ? "W" : "E";
    const ovals = e.attributes.map((a) => ovalOf(a, `${e.id}.${a.name}`));
    const room = loopRoom(e.id);
    const pod = podOf(
      item,
      [
        [
          ovals,
          side,
          side === "N" ? ROW_GAP : COLUMN_GAP + (ovals.some((o) => o.kids.length > 0) ? 14 : 0),
        ],
      ],
      room,
    );
    pod.side = side;
    pods.set(e.id, pod);
  }
  for (const r of d.relationships) {
    const item = relationshipItem(r);
    const ovals = r.attributes.map((a) => ovalOf(a, `${r.id}.${a.name}`));
    const recursive = r.participants[0].entity === r.participants[1].entity;
    const above =
      recursive || ovals.length <= 2 ? ovals : ovals.slice(0, Math.ceil(ovals.length / 2));
    const below = above.length === ovals.length ? [] : ovals.slice(above.length);
    pods.set(
      r.id,
      podOf(
        item,
        [
          [above, "N", REL_ROW_GAP],
          [below, "S", REL_ROW_GAP],
        ],
        recursive ? loopRoom(r.participants[0].entity) : 0,
      ),
    );
  }

  // ELK places pods; ports keep each connector on the free sides. Port order along a side follows
  // the vertical order of the other end, so the layout reruns until the two agree.
  const order = new Map<string, string[]>();
  const keyOf = (l: Link) => l.id;
  const sideLinks = (id: string, side: "W" | "E"): Link[] => {
    if (relOf.has(id))
      return routed.filter(
        (l) => l.relationship.id === id && (srcIsEntity(l) ? side === "W" : side === "E"),
      );
    return used.get(id)![side];
  };
  for (const [id] of pods) {
    for (const side of ["W", "E"] as const)
      order.set(`${id}:${side}`, sideLinks(id, side).map(keyOf));
  }
  const portY = (pod: Pod, id: string, side: "W" | "E", l: Link) => {
    if (relOf.has(id)) return pod.owner.cy;
    const list = order.get(`${id}:${side}`)!;
    return pod.owner.cy + (list.indexOf(keyOf(l)) - (list.length - 1) / 2) * PORT_STEP;
  };
  const elkEdges: LayoutEdge[] = routed.map((l) => {
    const e = l.participant.entity;
    const r = l.relationship.id;
    const fromEntity = srcIsEntity(l);
    const entPort = `${e}:${fromEntity ? "E" : "W"}:${l.id}`;
    const relPort = `${r}:${fromEntity ? "W" : "E"}:${l.id}`;
    return {
      id: l.id,
      from: fromEntity ? e : r,
      to: fromEntity ? r : e,
      fromPort: fromEntity ? entPort : relPort,
      toPort: fromEntity ? relPort : entPort,
    };
  });
  const boxes = (at?: Map<string, Box>): LayoutBox[] =>
    [...pods.values()].map((pod) => {
      const ports: LayoutPort[] = [];
      for (const side of ["W", "E"] as const) {
        for (const l of sideLinks(pod.id, side)) {
          ports.push({
            id: `${pod.id}:${side}:${l.id}`,
            side: side === "W" ? "WEST" : "EAST",
            x: side === "W" ? 0 : pod.w,
            y: portY(pod, pod.id, side, l),
          });
        }
      }
      const box: LayoutBox = { id: pod.id, width: pod.w, height: pod.h, ports };
      const placed = at?.get(pod.id);
      if (placed) Object.assign(box, { x: placed.x, y: placed.y });
      return box;
    });
  const options = { edgeNodeSpacing: END_RUN, layerSpacing: LAYER_GAP, edgeSpacing: 16 };
  let layout = await layoutElk(boxes(), elkEdges, "RIGHT", options);
  for (let pass = 0; pass < 3; pass++) {
    let changed = false;
    for (const [id] of pods) {
      for (const side of ["W", "E"] as const) {
        if (relOf.has(id)) continue;
        const list = order.get(`${id}:${side}`)!;
        const other = (l: Link) => {
          const box = layout.boxes.get(l.relationship.id)!;
          return box.y + box.h / 2;
        };
        const sorted = [...sideLinks(id, side)].sort((a, b) => other(a) - other(b)).map(keyOf);
        if (sorted.join() !== list.join()) {
          order.set(`${id}:${side}`, sorted);
          changed = true;
        }
      }
    }
    if (!changed) break;
    layout = await layoutElk(boxes(layout.boxes), elkEdges, "RIGHT", {
      ...options,
      interactive: true,
    });
  }

  // Absolute positions.
  const nodes: SceneNode[] = [];
  const itemById = new Map<string, Item>();
  const detailOf = new Map<string, string>();
  const weak = new Set(d.entities.filter((e) => e.weak).map((e) => e.id));
  const sceneEdges: SceneEdge[] = [];
  for (const pod of pods.values()) {
    const at = layout.boxes.get(pod.id)!;
    for (const item of pod.items) {
      item.cx += at.x;
      item.cy += at.y;
      itemById.set(item.id, item);
    }
    for (const l of pod.lines) {
      for (const p of [l.a, l.b]) {
        p.x += at.x;
        p.y += at.y;
      }
    }
  }

  for (const e of d.entities) {
    const rels = d.relationships.filter((r) => r.participants.some((p) => p.entity === e.id));
    const lines = [
      e.detail ?? e.note,
      e.attributes.length > 0
        ? `Attributes: ${e.attributes.map((a) => a.name).join(", ")}`
        : undefined,
      rels.length > 0 ? `Relationships: ${rels.map((r) => r.label).join(", ")}` : undefined,
    ];
    detailOf.set(e.id, lines.filter((s): s is string => s !== undefined).join("\n"));
    if (e.weak)
      detailOf.set(
        e.id,
        `${detailOf.get(e.id)!}\nWeak entity: identified only together with the entity that owns it.`,
      );
  }
  for (const r of d.relationships) {
    detailOf.set(
      r.id,
      [r.note, ...reading(r, name, weak)].filter((s): s is string => s !== undefined).join("\n"),
    );
  }
  const walkAttrs = (list: ChenAttribute[], prefix: string, owner: string) => {
    for (const a of list) {
      const id = `${prefix}.${a.name}`;
      detailOf.set(id, describe(a, owner));
      walkAttrs(a.children, id, a.name);
    }
  };
  for (const e of d.entities) walkAttrs(e.attributes, e.id, e.label);
  for (const r of d.relationships) walkAttrs(r.attributes, r.id, r.label);

  const order2 = [...d.entities.map((e) => e.id), ...d.relationships.map((r) => r.id)];
  for (const id of order2) {
    const pod = pods.get(id)!;
    for (const item of pod.items) {
      const label: TextBlock = {
        lines: [item.label],
        x: item.cx,
        y: baselineOf(item.cy, item.size),
        size: item.size,
        weight: item.weight,
        anchor: "middle",
      };
      const node: SceneNode = {
        id: item.id,
        kind: item.kind,
        shape: item.shape,
        x: item.cx - item.hw,
        y: item.cy - item.hh,
        w: 2 * item.hw,
        h: 2 * item.hh,
        label,
      };
      if (item.mark !== undefined) node.mark = item.mark;
      if (item.note !== undefined) node.note = item.note;
      const detail = detailOf.get(item.id);
      if (detail !== undefined) node.detail = detail;
      nodes.push(node);
    }
    for (const l of pod.lines) {
      sceneEdges.push({
        id: `${l.from.id}~`,
        from: l.from.id,
        to: l.to.id,
        points: [l.a, l.b],
        style: "sync",
        chen: { role: "attribute" },
      });
    }
  }

  // Relationship lines: ELK's orthogonal route, with both ends moved onto the outlines.
  const cardOf = (pts: Point[], total: boolean, text: string): TextBlock => {
    const end = pts[0]!;
    const u = { x: pts[1]!.x - end.x, y: pts[1]!.y - end.y };
    const len = Math.hypot(u.x, u.y);
    u.x /= len;
    u.y /= len;
    const horizontal = Math.abs(u.x) > Math.abs(u.y);
    const along = 15 + FS_CARD * 0.15;
    const side = (total ? DBL / 2 : 0) + FS_CARD * 0.62;
    const x = end.x + u.x * along + (horizontal ? 0 : side);
    const y = end.y + u.y * along + (horizontal ? -side : 0);
    return {
      lines: [text],
      x,
      y: baselineOf(y, FS_CARD),
      size: FS_CARD,
      weight: 600,
      anchor: "middle",
    };
  };
  const loopCount = new Map<string, number>();
  for (const l of links) {
    const ent = itemById.get(l.participant.entity)!;
    const rel = itemById.get(l.relationship.id)!;
    const entShape = shapeOf(ent);
    const relShape = shapeOf(rel);
    let centre: Point[];
    if (l.around === undefined) {
      const route = layout.edges.get(l.id)?.points ?? [];
      const pts = dedupe(srcIsEntity(l) ? route : [...route].reverse());
      centre =
        pts.length >= 2
          ? pts
          : [
              { x: ent.cx, y: ent.cy },
              { x: rel.cx, y: rel.cy },
            ];
    } else {
      const n = loopCount.get(ent.id) ?? 0;
      loopCount.set(ent.id, n + 1);
      // Below both shapes, clear of the cardinality under the entity, inside the room the pods reserve.
      const down =
        Math.max(ent.cy + ent.hh, rel.cy + rel.hh) + 38 + LOOP_STEP * (loops.get(ent.id)! - 1 - n);
      const slot = n === 0 ? 0 : (n % 2 === 1 ? -1 : 1) * 18 * Math.ceil(n / 2);
      centre = [
        { x: ent.cx + slot, y: ent.cy },
        { x: ent.cx + slot, y: down },
        { x: rel.cx, y: down },
        { x: rel.cx, y: rel.cy },
      ];
    }
    const finish = (pts: Point[]): Point[] => {
      const out = pts.map((p) => ({ ...p }));
      clipEnd(entShape, out, true);
      clipEnd(relShape, out, false);
      return out;
    };
    const total = l.participant.total;
    const strands = total
      ? [finish(offsetPolyline(centre, DBL / 2)), finish(offsetPolyline(centre, -DBL / 2))]
      : [finish(centre)];
    const main = finish(centre);
    sceneEdges.push({
      id: l.id,
      from: ent.id,
      to: rel.id,
      points: strands[0]!,
      style: "sync",
      chen: {
        role: "link",
        ...(strands[1] === undefined ? {} : { second: strands[1] }),
        card: cardOf(main, total, l.participant.cardinality),
      },
    });
  }

  const reach = Math.max(
    0,
    ...nodes.map((n) => n.x + n.w),
    ...sceneEdges.flatMap((e) => e.points.map((p) => p.x)),
  );
  const bottom = Math.max(
    0,
    ...nodes.map((n) => n.y + n.h),
    ...sceneEdges.flatMap((e) => e.points.map((p) => p.y)),
  );
  const width = half(Math.max(layout.width, reach + ROOT_PADDING));
  const diagramHeight = half(Math.max(layout.height, bottom + ROOT_PADDING));
  const legend = legendFor(d, width, diagramHeight + LEGEND.top);
  const scene: Scene = {
    type: d.type,
    title: d.title,
    theme: d.theme,
    width,
    height: diagramHeight + LEGEND.top + legend.height + LEGEND.bottom,
    groups: [],
    nodes,
    edges: sceneEdges,
  };
  if (legend.items.length > 0) scene.legend = legend.items;
  if (d.description !== undefined) scene.description = d.description;
  return scene;
}
