// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { ClassDiagram, ClassMember, ClassNode, ClassRelation } from "../model/class.js";
import { MARKER_HALF, MARKER_LENGTH } from "../render/class.js";
import type {
  Box,
  Point,
  Scene,
  SceneClass,
  SceneEdge,
  SceneLegendItem,
  SceneNode,
  TextBlock,
} from "../scene.js";
import { firstBaseline, lineHeight, textWidth } from "../text/measure.js";
import { layoutElk, type LayoutBox, type LayoutEdge } from "./elk.js";

// ELK places the classes in layers from left to right; the written order of a relation (the
// whole before the part, the user before the used) is the layer order, except that a parent or an
// interface sits before its children. ELK routes orthogonal lines; this file then moves every line
// end onto the flat part of a class side, spreads the ends, and places the texts next to the ends
// where nothing else is.

const NAME_SIZE = 13;
const STEREOTYPE_SIZE = 10.5;
const MEMBER_SIZE = 11.5;
const LABEL_SIZE = 12;
const MULT_SIZE = 11;
const HEAD = 30;
const HEAD_STEREOTYPE = 48;
const ROW = 17;
const COMPARTMENT_PAD = 8;
const MIN_WIDTH = 140;
const VISIBILITY_INDENT = 12;
/** A line end keeps this far from the corner of its side, so a marker never sits on the curve. */
const END_INSET = 14;
/** Closest two line ends may sit on one side: a multiplicity (14 px high) fits between two lines. */
const END_STEP = 28;
/** Run between a class and the first bend of a line: room for the longest marker, a corner and a stretch of line. */
const STUB = 50;
const LOOP_RISE = 52;
const LOOP_WIDTH = 28;
const LOOP_SLOT = 64;
const LOOP_EDGE = 24;
const TEXT_GAP = 4;
const PAD = 24;
const MIN_CANVAS = 420;
/** Two ends closer than this in height are joined by a straight line instead of a jog. */
const JOG = 20;

const even = (n: number) => Math.ceil(n / 2) * 2;

interface Sized {
  node: ClassNode;
  w: number;
  h: number;
  head: number;
  attributes: ClassMember[];
  methods: ClassMember[];
  /** Height reserved above the box for self-relations. */
  reserve: number;
  loops: number[];
}

const memberText = (m: ClassMember, method: boolean) =>
  `${m.name}${method ? `(${m.params ?? ""})` : ""}${m.type === undefined ? "" : `: ${m.type}`}`;

/** The member as the viewer card shows it: visibility mark, name and type. */
const memberLine = (m: ClassMember, method: boolean) =>
  `${m.visibility === undefined ? "" : `${m.visibility} `}${memberText(m, method)}`;

const memberWidth = (m: ClassMember, method: boolean) =>
  (m.visibility === undefined ? 0 : VISIBILITY_INDENT) +
  textWidth(memberText(m, method), MEMBER_SIZE, 400);

function size(node: ClassNode, loops: number[]): Sized {
  const stereotype = node.stereotype === undefined ? undefined : `«${node.stereotype}»`;
  const compartments = [node.attributes, node.methods].filter((c) => c.length > 0);
  const widest = Math.max(
    textWidth(node.id, NAME_SIZE, 600) + 32,
    stereotype === undefined ? 0 : textWidth(stereotype, STEREOTYPE_SIZE, 400) + 32,
    ...node.attributes.map((m) => memberWidth(m, false) + 26),
    ...node.methods.map((m) => memberWidth(m, true) + 26),
  );
  const rows = compartments.length === 0 ? 1 : compartments.reduce((n, c) => n + c.length, 0);
  const slots = loops.length * LOOP_SLOT + 8;
  return {
    node,
    w: Math.max(MIN_WIDTH, even(widest), loops.length > 0 ? slots : 0),
    h:
      (stereotype === undefined ? HEAD : HEAD_STEREOTYPE) +
      Math.max(1, compartments.length) * COMPARTMENT_PAD +
      rows * ROW,
    head: stereotype === undefined ? HEAD : HEAD_STEREOTYPE,
    attributes: node.attributes,
    methods: node.methods,
    reserve: loops.length > 0 ? Math.ceil(LOOP_RISE + lineHeight(LABEL_SIZE) + 8) : 0,
    loops,
  };
}

const text = (
  value: string,
  size: number,
  weight: 400 | 600,
  x: number,
  top: number,
  anchor: TextBlock["anchor"] = "middle",
): TextBlock => ({
  lines: [value],
  x,
  y: top + firstBaseline(size),
  size,
  weight,
  anchor,
});

function sceneNode(s: Sized, x: number, y: number): SceneNode {
  const { node } = s;
  const cx = x + s.w / 2;
  const c: SceneClass = { rules: [y + s.head], members: [] };
  let nameTop = y + (s.head - lineHeight(NAME_SIZE)) / 2;
  if (node.stereotype !== undefined) {
    c.stereotype = text(`«${node.stereotype}»`, STEREOTYPE_SIZE, 400, cx, y + 8);
    nameTop = y + 8 + lineHeight(STEREOTYPE_SIZE) + 1;
  }
  if (node.stereotype === "abstract") c.abstract = true;
  let top = y + s.head;
  [s.attributes, s.methods]
    .filter((comp) => comp.length > 0)
    .forEach((comp, k) => {
      if (k > 0) c.rules.push(top);
      const method = comp === s.methods;
      comp.forEach((m, j) => {
        const rowTop = top + COMPARTMENT_PAD / 2 + j * ROW + (ROW - lineHeight(MEMBER_SIZE)) / 2;
        const bodyX = x + 12 + (m.visibility === undefined ? 0 : VISIBILITY_INDENT);
        c.members.push({
          ...(m.visibility === undefined
            ? {}
            : { vis: text(m.visibility, MEMBER_SIZE, 600, x + 12, rowTop, "start") }),
          text: text(memberText(m, method), MEMBER_SIZE, 400, bodyX, rowTop, "start"),
        });
      });
      top += COMPARTMENT_PAD + comp.length * ROW;
    });
  const out: SceneNode = {
    id: node.id,
    kind: node.stereotype ?? "class",
    shape: "class",
    x,
    y,
    w: s.w,
    h: s.h,
    label: text(node.id, NAME_SIZE, 600, cx, nameTop),
    class: c,
  };
  if (node.note !== undefined) out.note = node.note;
  if (node.source !== undefined) out.source = node.source;
  return out;
}

// ---- geometry helpers

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const rectOf = (b: Box): Rect => ({ x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h });
const near = (a: Rect, b: Rect, gap: number) =>
  a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap;
const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Drops repeated points and the middle point of a straight run. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (out.length === 0 || !same(out[out.length - 1]!, p)) out.push(p);
  return out.filter((p, i) => {
    const a = out[i - 1];
    const b = out[i + 1];
    if (a === undefined || b === undefined) return true;
    const cross = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x);
    return Math.abs(cross) > 1e-6;
  });
}

interface Route {
  rel: ClassRelation;
  points: Point[];
}

type SideName = "W" | "E";

const sideOf = (b: Box, p: Point): SideName | undefined =>
  Math.abs(p.x - b.x) < 0.5 ? "W" : Math.abs(p.x - (b.x + b.w)) < 0.5 ? "E" : undefined;

/** New heights for the line ends on one side: inside the flat part, END_STEP apart, in the old order. */
function spread(ys: number[], lo: number, hi: number): number[] {
  const step = ys.length > 1 ? Math.min(END_STEP, (hi - lo) / (ys.length - 1)) : 0;
  const out = ys.map((y) => Math.min(hi, Math.max(lo, y)));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]! + step);
  for (let i = out.length - 1; i >= 0; i--)
    out[i] = Math.min(out[i]!, i === out.length - 1 ? hi : out[i + 1]! - step);
  return out;
}

/** The height each class needs so that the line ends on its busiest side keep END_STEP apart. */
function sideHeights(routes: Route[], boxes: Map<string, Box>): Map<string, number> {
  const count = new Map<string, number>();
  for (const r of routes) {
    if (r.rel.from === r.rel.to) continue;
    for (const [id, p] of [
      [r.rel.from, r.points[0]!],
      [r.rel.to, r.points[r.points.length - 1]!],
    ] as const) {
      const side = sideOf(boxes.get(id)!, p);
      if (side !== undefined) count.set(`${id}:${side}`, (count.get(`${id}:${side}`) ?? 0) + 1);
    }
  }
  const need = new Map<string, number>();
  for (const [key, n] of count) {
    const id = key.slice(0, key.lastIndexOf(":"));
    need.set(id, Math.max(need.get(id) ?? 0, 2 * END_INSET + (n - 1) * END_STEP));
  }
  return need;
}

/**
 * Moves the ends of every line onto the flat part of its class sides and keeps them apart, then
 * straightens the jogs that ELK leaves between ends that are almost level.
 */
function settleEnds(routes: Route[], boxes: Map<string, Box>) {
  type End = { route: Route; start: boolean; y: number };
  const groups = new Map<string, { box: Box; ends: End[] }>();
  const add = (route: Route, start: boolean, id: string) => {
    const p = start ? route.points[0]! : route.points[route.points.length - 1]!;
    const box = boxes.get(id)!;
    const side = sideOf(box, p);
    const q = route.points[start ? 1 : route.points.length - 2];
    if (side === undefined || q === undefined || Math.abs(q.y - p.y) > 1e-6) return;
    const key = `${id}:${side}`;
    const g = groups.get(key) ?? { box, ends: [] };
    g.ends.push({ route, start, y: p.y });
    groups.set(key, g);
  };
  for (const r of routes) {
    if (r.rel.from === r.rel.to) continue;
    add(r, true, r.rel.from);
    add(r, false, r.rel.to);
  }
  const target = new Map<End, number>();
  const respread = () => {
    for (const g of groups.values()) {
      const sorted = [...g.ends].sort((a, b) => a.y - b.y);
      const ys = spread(
        sorted.map((e) => e.y),
        g.box.y + END_INSET,
        g.box.y + g.box.h - END_INSET,
      );
      sorted.forEach((e, i) => {
        e.y = ys[i]!;
        target.set(e, ys[i]!);
      });
    }
  };
  respread();
  // A jog shorter than JOG looks like a wobble: its two ends meet at one height instead, as far as
  // the spacing of their neighbours allows.
  for (let round = 0; round < 6; round++) {
    let moved = false;
    for (const r of routes) {
      const n = r.points.length;
      const ends = [...target.keys()].filter((e) => e.route === r);
      if (ends.length !== 2 || (n !== 2 && n !== 4)) continue;
      const gap = Math.abs(ends[0]!.y - ends[1]!.y);
      if (gap < 1e-6 || gap >= JOG) continue;
      const mid = (ends[0]!.y + ends[1]!.y) / 2;
      for (const e of ends) e.y = mid;
      moved = true;
    }
    if (!moved) break;
    respread();
  }
  for (const r of routes) {
    const n = r.points.length;
    const ends = [...target.keys()].filter((e) => e.route === r);
    const first = ends.find((e) => e.start);
    const last = ends.find((e) => !e.start);
    const y0 = first === undefined ? undefined : target.get(first)!;
    const y1 = last === undefined ? undefined : target.get(last)!;
    const clear = (pts: Point[]) =>
      !pts.slice(1).some((q, i) => {
        for (const [id, box] of boxes)
          if (id !== r.rel.from && id !== r.rel.to && crosses(pts[i]!, q, box)) return true;
        return false;
      });
    // Moving the ends along their own legs is enough when the legs stay clear of every class.
    const shifted = r.points.map((p) => ({ ...p }));
    if (n === 2) {
      const [p, q] = r.points as [Point, Point];
      const a = y0 ?? p.y;
      const b = y1 ?? q.y;
      const mx = (p.x + q.x) / 2;
      shifted.splice(
        0,
        2,
        { x: p.x, y: a },
        ...(Math.abs(a - b) > 1e-6
          ? [
              { x: mx, y: a },
              { x: mx, y: b },
            ]
          : []),
        { x: q.x, y: b },
      );
    } else {
      if (y0 !== undefined) shifted[0]!.y = shifted[1]!.y = y0;
      if (y1 !== undefined) shifted[n - 1]!.y = shifted[n - 2]!.y = y1;
    }
    // A long leg may run past other classes: keep it where ELK put it and jog next to the class.
    r.points = simplify(clear(shifted) ? shifted : withJogs(r.points, y0, y1));
  }
}

/** Both orthogonal legs and diagonal ones are tested by their bounding box, a little inside the class. */
function crosses(a: Point, b: Point, box: Box): boolean {
  const gap = 6;
  return (
    Math.max(a.x, b.x) > box.x - gap &&
    Math.min(a.x, b.x) < box.x + box.w + gap &&
    Math.max(a.y, b.y) > box.y - gap &&
    Math.min(a.y, b.y) < box.y + box.h + gap
  );
}

/** The same line with its first and last leg moved to y0 and y1 through a short jog at the class. */
function withJogs(points: Point[], y0?: number, y1?: number): Point[] {
  const pts = points.map((p) => ({ ...p }));
  const jog = (at: number, next: number, y: number | undefined, out: Point[], index: number) => {
    const p = pts[at]!;
    if (y === undefined || Math.abs(y - p.y) < 1e-6) return;
    const q = pts[next]!;
    const len = Math.abs(q.x - p.x);
    // Room for the longest marker before the jog, and for a corner after it.
    const x = p.x + Math.sign(q.x - p.x) * (len < 47 ? len / 2 : Math.min(STUB - 10, len - 14));
    out.splice(
      index,
      1,
      ...(at === 0
        ? [
            { x: p.x, y },
            { x, y },
            { x, y: p.y },
          ]
        : [
            { x, y: p.y },
            { x, y },
            { x: p.x, y },
          ]),
    );
  };
  const out = pts.map((p) => p);
  jog(pts.length - 1, pts.length - 2, y1, out, out.length - 1);
  jog(0, 1, y0, out, 0);
  return out;
}

/** A loop on top of the class: up from one slot, across, and down into the next. */
function loopPoints(b: Box, slot: number): Point[] {
  const right = b.x + b.w - LOOP_EDGE - slot * LOOP_SLOT;
  const left = right - LOOP_WIDTH;
  return [
    { x: left, y: b.y },
    { x: left, y: b.y - LOOP_RISE },
    { x: right, y: b.y - LOOP_RISE },
    { x: right, y: b.y },
  ];
}

// ---- texts

interface Placed {
  box: Box;
  text: TextBlock;
}

function placeText(value: string, size: number, weight: 400 | 600, box: Box): Placed {
  return { box, text: text(value, size, weight, box.x + box.w / 2, box.y) };
}

export async function layoutClass(d: ClassDiagram): Promise<Scene> {
  const loopsOf = new Map<string, number[]>(d.classes.map((c) => [c.id, []]));
  d.relations.forEach((r, i) => {
    if (r.from === r.to) loopsOf.get(r.from)!.push(i);
  });
  const sized = new Map(d.classes.map((c) => [c.id, size(c, loopsOf.get(c.id)!)]));
  const widest = Math.max(
    0,
    ...d.relations.map((r) => (r.label === undefined ? 0 : textWidth(r.label, LABEL_SIZE, 400))),
  );

  // Parents and interfaces come first, so each hierarchy opens at the left edge of its group.
  const parentFirst = (r: ClassRelation) => r.kind === "generalization" || r.kind === "realization";
  const layoutEdges: LayoutEdge[] = [];
  d.relations.forEach((r, i) => {
    if (r.from === r.to) return;
    layoutEdges.push(
      parentFirst(r)
        ? { id: `r${i}`, from: r.to, to: r.from }
        : { id: `r${i}`, from: r.from, to: r.to },
    );
  });

  let boxes = new Map<string, Box>();
  let routes: Route[] = [];
  // A class with many lines on one side needs a taller side: grow it and lay out once more.
  for (let pass = 0; pass < 2; pass++) {
    const layoutBoxes: LayoutBox[] = [...sized.values()].map((s) => ({
      id: s.node.id,
      width: s.w,
      height: s.h + s.reserve,
    }));
    const laid = await layoutElk(layoutBoxes, layoutEdges, "RIGHT", {
      layerSpacing: Math.max(130, Math.ceil(widest) + 90),
      edgeNodeSpacing: STUB,
      edgeSpacing: 14,
    });
    boxes = new Map();
    for (const s of sized.values()) {
      const b = laid.boxes.get(s.node.id)!;
      boxes.set(s.node.id, { x: b.x, y: b.y + s.reserve, w: s.w, h: s.h });
    }
    routes = d.relations.map((rel, i) => {
      if (rel.from === rel.to) {
        const slot = loopsOf.get(rel.from)!.indexOf(i);
        return { rel, points: loopPoints(boxes.get(rel.from)!, slot) };
      }
      const points = laid.edges.get(`r${i}`)!.points;
      return { rel, points: parentFirst(rel) ? [...points].reverse() : points };
    });
    let grew = false;
    for (const [id, need] of sideHeights(routes, boxes)) {
      const s = sized.get(id)!;
      if (need > s.h) {
        s.h = need;
        grew = true;
      }
    }
    if (!grew) break;
  }
  settleEnds(routes, boxes);

  // ---- multiplicities and names, placed where no class, line, marker or other text is
  const obstacles: { r: Rect; gap: number }[] = [];
  for (const b of boxes.values()) obstacles.push({ r: rectOf(b), gap: TEXT_GAP });
  const legsOf = (r: Route) => r.points.slice(1).map((p, i) => [r.points[i]!, p] as const);
  for (const r of routes)
    for (const [a, b] of legsOf(r))
      obstacles.push({
        r: {
          x0: Math.min(a.x, b.x),
          y0: Math.min(a.y, b.y),
          x1: Math.max(a.x, b.x),
          y1: Math.max(a.y, b.y),
        },
        gap: 3,
      });
  const dir = (a: Point, b: Point): Point => {
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  for (const r of routes) {
    const n = r.points.length;
    ([0, 1] as const).forEach((end) => {
      const len = MARKER_LENGTH[r.rel.kind][end];
      if (len === 0) return;
      const p = end === 0 ? r.points[0]! : r.points[n - 1]!;
      const u = end === 0 ? dir(p, r.points[1]!) : dir(p, r.points[n - 2]!);
      const half = MARKER_HALF[r.rel.kind][end];
      const q = { x: p.x + u.x * len, y: p.y + u.y * len };
      obstacles.push({
        r: {
          x0: Math.min(p.x, q.x) - Math.abs(u.y) * half,
          y0: Math.min(p.y, q.y) - Math.abs(u.x) * half,
          x1: Math.max(p.x, q.x) + Math.abs(u.y) * half,
          y1: Math.max(p.y, q.y) + Math.abs(u.x) * half,
        },
        gap: 1,
      });
    });
  }
  const free = (box: Box) => {
    const r = rectOf(box);
    return !obstacles.some((o) => near(r, o.r, o.gap));
  };
  const take = (box: Box) => {
    obstacles.push({ r: rectOf(box), gap: TEXT_GAP });
    return box;
  };
  const firstFree = (candidates: Box[]) => take(candidates.find(free) ?? candidates[0]!);

  /** Candidate boxes for a multiplicity next to the end at p; u points along the line away from the class. */
  const multCandidates = (w: number, h: number, p: Point, u: Point, half: number): Box[] => {
    const gap = Math.max(half, 1.6) + 3;
    const out: Box[] = [];
    for (const along of [0, 14, 28, 42]) {
      if (Math.abs(u.x) > 0.5) {
        const x = u.x > 0 ? p.x + 4 + along : p.x - 4 - along - w;
        out.push({ x, y: p.y - gap - h, w, h }, { x, y: p.y + gap, w, h });
      } else {
        const y = u.y < 0 ? p.y - 3 - along - h : p.y + 3 + along;
        out.push({ x: p.x + gap, y, w, h }, { x: p.x - gap - w, y, w, h });
      }
    }
    return out;
  };

  const edgeTexts = routes.map((r) => {
    const n = r.points.length;
    const found: { fromMult?: Placed; toMult?: Placed } = {};
    const ends = [
      ["fromMult", r.rel.fromMultiplicity, r.points[0]!, r.points[1]!, 0],
      ["toMult", r.rel.toMultiplicity, r.points[n - 1]!, r.points[n - 2]!, 1],
    ] as const;
    for (const [key, value, p, q, end] of ends) {
      if (value === undefined) continue;
      const w = textWidth(value, MULT_SIZE, 600);
      const h = lineHeight(MULT_SIZE);
      const box = firstFree(multCandidates(w, h, p, dir(p, q), MARKER_HALF[r.rel.kind][end]));
      found[key] = placeText(value, MULT_SIZE, 600, box);
    }
    return found;
  });

  const names = routes.map((r) => {
    if (r.rel.label === undefined) return undefined;
    const w = textWidth(r.rel.label, LABEL_SIZE, 400);
    const h = lineHeight(LABEL_SIZE);
    const legs = legsOf(r)
      .map(([a, b]) => ({ a, b, len: Math.hypot(b.x - a.x, b.y - a.y) }))
      .sort(
        (p, q) =>
          Number(Math.abs(q.a.y - q.b.y) < 1e-6) - Number(Math.abs(p.a.y - p.b.y) < 1e-6) ||
          q.len - p.len,
      );
    const candidates: Box[] = [];
    for (const f of [0.5, 0.3, 0.7, 0.15, 0.85])
      for (const { a, b } of legs) {
        const x = a.x + (b.x - a.x) * f;
        const y = a.y + (b.y - a.y) * f;
        if (Math.abs(a.y - b.y) < 1e-6)
          candidates.push(
            { x: x - w / 2, y: y - TEXT_GAP - h, w, h },
            { x: x - w / 2, y: y + TEXT_GAP, w, h },
          );
        else
          candidates.push(
            { x: x + TEXT_GAP + 2, y: y - h / 2, w, h },
            { x: x - TEXT_GAP - 2 - w, y: y - h / 2, w, h },
          );
      }
    return placeText(r.rel.label, LABEL_SIZE, 400, firstFree(candidates));
  });

  // ---- scene: shift so that everything starts at PAD
  const all: Point[] = [
    ...[...boxes.values()].flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]),
    ...routes.flatMap((r) => r.points),
    ...[...edgeTexts.flatMap((t) => [t.fromMult, t.toMult]), ...names].flatMap((p) =>
      p === undefined
        ? []
        : [
            { x: p.box.x, y: p.box.y },
            { x: p.box.x + p.box.w, y: p.box.y + p.box.h },
          ],
    ),
  ];
  const dx = PAD - Math.min(...all.map((p) => p.x));
  const dy = PAD - Math.min(...all.map((p) => p.y));
  const width = Math.max(MIN_CANVAS, Math.ceil(Math.max(...all.map((p) => p.x)) + dx + PAD));
  const bottom = Math.max(...all.map((p) => p.y)) + dy;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });
  const moved = (p: Placed | undefined): Placed | undefined =>
    p === undefined
      ? undefined
      : {
          box: { ...p.box, x: p.box.x + dx, y: p.box.y + dy },
          text: { ...p.text, x: p.text.x + dx, y: p.text.y + dy },
        };

  const nodes: SceneNode[] = d.classes.map((c) => {
    const b = boxes.get(c.id)!;
    const n = sceneNode(sized.get(c.id)!, b.x + dx, b.y + dy);
    const detail = describe(c, d.relations);
    n.detail = detail;
    return n;
  });

  const edges: SceneEdge[] = routes.map((r, i) => {
    const edge: SceneEdge = {
      id: `r${i}`,
      from: r.rel.from,
      to: r.rel.to,
      points: r.points.map(shift),
      style: "sync",
      rel: { kind: r.rel.kind },
    };
    const fromMult = moved(edgeTexts[i]!.fromMult);
    const toMult = moved(edgeTexts[i]!.toMult);
    if (fromMult) edge.rel!.fromMult = fromMult;
    if (toMult) edge.rel!.toMult = toMult;
    const name = moved(names[i]);
    if (name) edge.label = name;
    return edge;
  });

  const scene: Scene = {
    type: d.type,
    title: d.title,
    theme: d.theme,
    width,
    height: bottom,
    groups: [],
    nodes,
    edges,
  };
  if (d.description !== undefined) scene.description = d.description;
  return legend(scene, d, bottom, width);
}

// ---- the card text

const KIND_LINE: Record<string, string> = {
  class: "Class.",
  abstract: "Abstract class.",
  interface: "Interface.",
  enum: "Enum.",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const mult = (m?: string) => (m === undefined ? "" : ` (${m})`);

function describe(c: ClassNode, relations: ClassRelation[]): string {
  const lines = [
    c.detail ?? c.note,
    KIND_LINE[c.stereotype ?? "class"],
    c.attributes.length > 0
      ? `Attributes: ${c.attributes.map((m) => memberLine(m, false)).join("; ")}.`
      : undefined,
    c.methods.length > 0
      ? `Methods: ${c.methods.map((m) => memberLine(m, true)).join("; ")}.`
      : undefined,
  ];
  for (const r of relations) {
    const label = r.label === undefined ? undefined : cap(r.label);
    if (r.from === c.id) {
      const out = {
        generalization: `Extends ${r.to}.`,
        realization: `Implements ${r.to}.`,
        association: `${label ?? "Linked to"} ${r.to}${mult(r.toMultiplicity)}.`,
        directed: `${label ?? "Refers to"} ${r.to}${mult(r.toMultiplicity)}.`,
        composition: `Is composed of ${r.to}${mult(r.toMultiplicity)}.`,
        aggregation: `Aggregates ${r.to}${mult(r.toMultiplicity)}.`,
        dependency: `Depends on ${r.to}.`,
      }[r.kind];
      lines.push(out);
    }
    if (r.to === c.id && r.from !== c.id) {
      const back = {
        generalization: `Extended by ${r.from}.`,
        realization: `Implemented by ${r.from}.`,
        association: `Linked from ${r.from}${mult(r.fromMultiplicity)}.`,
        directed: `Referred to by ${r.from}${mult(r.fromMultiplicity)}.`,
        composition: `Part of ${r.from}${mult(r.fromMultiplicity)}.`,
        aggregation: `Aggregated by ${r.from}${mult(r.fromMultiplicity)}.`,
        dependency: `Used by ${r.from}.`,
      }[r.kind];
      lines.push(back);
    }
  }
  return lines.filter((l): l is string => l !== undefined).join("\n");
}

// ---- legend: only the kinds, relations and notation this diagram uses

const KIND_ITEMS = [
  { kind: "class", label: "Class", family: "compute" },
  { kind: "interface", label: "Interface", family: "messaging" },
  { kind: "abstract", label: "Abstract (italic name)", family: "decision" },
  { kind: "enum", label: "Enum", family: "data" },
];

const RELATION_ITEMS = [
  ["association", "Association"],
  ["directed", "Directed association"],
  ["aggregation", "Aggregation"],
  ["composition", "Composition"],
  ["generalization", "Generalization (extends)"],
  ["realization", "Realization (implements)"],
  ["dependency", "Dependency (uses)"],
] as const;

const VISIBILITY_NAMES = { "+": "public", "-": "private", "#": "protected", "~": "package" };

function legend(scene: Scene, d: ClassDiagram, bottom: number, width: number): Scene {
  const kinds = new Set<string>(d.classes.map((c) => c.stereotype ?? "class"));
  const marks = new Set(
    d.classes.flatMap((c) => [...c.attributes, ...c.methods].flatMap((m) => m.visibility ?? [])),
  );
  const used: { glyph: string; label: string; family?: string }[] = [
    ...KIND_ITEMS.filter((k) => kinds.has(k.kind)).map((k) => ({
      glyph: "class-box",
      label: k.label,
      family: k.family,
    })),
    ...RELATION_ITEMS.filter(([kind]) => d.relations.some((r) => r.kind === kind)).map(
      ([kind, label]) => ({ glyph: `class-rel-${kind}`, label }),
    ),
    ...(d.relations.some((r) => r.fromMultiplicity !== undefined || r.toMultiplicity !== undefined)
      ? [{ glyph: "class-mult", label: "Multiplicity" }]
      : []),
    ...(marks.size > 0
      ? [
          {
            glyph: "class-vis",
            label: `Visibility: ${(["+", "-", "#", "~"] as const)
              .filter((m) => marks.has(m))
              .map((m) => `${m} ${VISIBILITY_NAMES[m]}`)
              .join(", ")}`,
          },
        ]
      : []),
  ];
  const SWATCH_W = 52;
  const SWATCH_H = 22;
  const ROW_H = 28;
  const top = bottom + 28;
  const items: SceneLegendItem[] = [];
  let x = PAD;
  let row = 0;
  for (const u of used) {
    const w = SWATCH_W + 8 + textWidth(u.label, 12, 400);
    if (x > PAD && x + w > width - PAD) {
      x = PAD;
      row++;
    }
    const y = top + row * ROW_H;
    items.push({
      glyph: u.glyph,
      ...(u.family === undefined ? {} : { family: u.family }),
      swatch: { x, y: y + (ROW_H - SWATCH_H) / 2, w: SWATCH_W, h: SWATCH_H },
      label: {
        lines: [u.label],
        x: x + SWATCH_W + 8,
        y: y + (ROW_H - lineHeight(12)) / 2 + firstBaseline(12),
        size: 12,
        weight: 400,
        anchor: "start",
      },
    });
    x += w + 24;
  }
  return { ...scene, legend: items, height: top + (row + 1) * ROW_H + 12 };
}
