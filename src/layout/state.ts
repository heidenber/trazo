// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { State, StateKind } from "../model/state.js";
import { STATE_RADIUS } from "../render/shapes.js";
import type { Box, Point, Scene, SceneEdge, SceneLegendItem, SceneNode } from "../scene.js";
import { firstBaseline, lineHeight, textWidth } from "../text/measure.js";

// Rail layout: the happy path is one row, rework transitions run above it, cancel and failure
// transitions below it. Every coordinate is computed here (no ELK): routes are orthogonal with
// their ends on the outline of the states.

const STATE_W = 112;
const STATE_H = 40;
const INITIAL_R = 8;
const FINAL_R = 12;
const NAME_SIZE = 13;
const EVENT_SIZE = 12;
const MIN_GAP = 74;
const GAP_PAD = 28;
const LOOP_H = 26;
const LOOP_MIN_W = 30;
const LOOP_GAP = 8;
/** Distance from the happy path to its first lane, and between lanes. */
const ABOVE_LANE = 70;
const BELOW_LANE = 50;
const LANE_STEP = 26;
const TIER_STEP = 80;
const U_CLEAR = 60;
const LABEL_GAP = 4.5;
const PAD = 32;
const MIN_WIDTH = 360;

type Side = "l" | "r" | "t" | "b";

interface Item {
  id: string;
  kind: StateKind;
  label: string;
  w: number;
  h: number;
  round: boolean;
  /** 0 on the happy path, -1 above it, 1 below it. */
  side: -1 | 0 | 1;
  col: number;
  tier: number;
  cx: number;
  cy: number;
  loops: number[];
}

/** A line end on one side of a state; its offset along the side is decided once all ends are known. */
interface Att {
  item: Item;
  side: Side;
  key: number;
  fixed?: number;
  follow?: Att;
  /** Distance between the legs of a self-transition starting here. */
  loop?: number;
  off: number;
}

type Build = "straight" | "loop" | "lane" | "elbow" | "gutter";
interface Route {
  build: Build;
  a: Att;
  b: Att;
  y?: number;
}

const even = (n: number) => Math.ceil(n / 2) * 2;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)]!;

function pack(items: { id: number; lo: number; hi: number }[]): Map<number, number> {
  const rows: { lo: number; hi: number }[][] = [];
  const out = new Map<number, number>();
  for (const it of [...items].sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.id - b.id)) {
    let k = 0;
    while (rows[k]?.some((o) => it.lo <= o.hi && o.lo <= it.hi)) k++;
    (rows[k] ??= []).push(it);
    out.set(it.id, k);
  }
  return out;
}

function port(att: Att): Point {
  const { item: n, side, off } = att;
  if (n.round) {
    const r = n.w / 2;
    const d = Math.sqrt(Math.max(0, r * r - off * off));
    return side === "l"
      ? { x: n.cx - d, y: n.cy + off }
      : side === "r"
        ? { x: n.cx + d, y: n.cy + off }
        : side === "t"
          ? { x: n.cx + off, y: n.cy - d }
          : { x: n.cx + off, y: n.cy + d };
  }
  return side === "l"
    ? { x: n.cx - n.w / 2, y: n.cy + off }
    : side === "r"
      ? { x: n.cx + n.w / 2, y: n.cy + off }
      : side === "t"
        ? { x: n.cx + off, y: n.cy - n.h / 2 }
        : { x: n.cx + off, y: n.cy + n.h / 2 };
}

function build(route: Route): Point[] {
  const pa = port(route.a);
  const pb = port(route.b);
  switch (route.build) {
    case "straight":
      return Math.abs(pa.x - pb.x) < 0.01 || Math.abs(pa.y - pb.y) < 0.01
        ? [pa, pb]
        : [pa, { x: pa.x, y: (pa.y + pb.y) / 2 }, { x: pb.x, y: (pa.y + pb.y) / 2 }, pb];
    case "loop": {
      const down = route.a.side === "b";
      const y = pa.y + (down ? LOOP_H : -LOOP_H);
      const x2 = pa.x + route.a.loop!;
      return [pa, { x: pa.x, y }, { x: x2, y }, { x: x2, y: pa.y }];
    }
    case "lane":
      return [pa, { x: pa.x, y: route.y! }, { x: pb.x, y: route.y! }, pb];
    case "elbow": {
      const vertical = route.a.side === "t" || route.a.side === "b";
      return vertical ? [pa, { x: pa.x, y: pb.y }, pb] : [pa, { x: pb.x, y: pa.y }, pb];
    }
    case "gutter": {
      const x = route.a.side === route.b.side ? Math.max(pa.x, pb.x) + 24 : (pa.x + pb.x) / 2;
      return [pa, { x, y: pa.y }, { x, y: pb.y }, pb];
    }
  }
}

const rectOf = (n: Item): Box => ({ x: n.cx - n.w / 2, y: n.cy - n.h / 2, w: n.w, h: n.h });

function overlaps(a: Box, b: Box, gap: number): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

/** Routes are orthogonal, so a segment is an axis-aligned thin box. */
function crosses(box: Box, a: Point, b: Point): boolean {
  const gap = 1.5;
  return overlaps(
    box,
    {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    },
    gap,
  );
}

function reading(
  item: Item,
  name: (id: string) => string,
  ins: { from: string; label?: string }[],
  outs: { to: string; label?: string }[],
  self: (string | undefined)[],
): string[] {
  const on = (label?: string) => (label === undefined ? "" : ` on ${label}`);
  const list = (xs: string[]) => xs.join(", ");
  const inLine =
    ins.length > 0
      ? `Reached from ${list(ins.map((x) => name(x.from) + on(x.label)))}.`
      : undefined;
  const outLine =
    outs.length > 0 ? `Moves to ${list(outs.map((x) => name(x.to) + on(x.label)))}.` : undefined;
  const selfLine =
    self.length > 0 ? `Stays here${on(list(self.filter((s) => s !== undefined)))}.` : undefined;
  if (item.kind === "initial")
    return [["Start of the diagram.", outLine].filter(Boolean).join(" ")];
  if (item.kind === "final") return [["End of the diagram.", inLine].filter(Boolean).join(" ")];
  const head = item.kind === "exception" ? "Exceptional state, off the main path." : undefined;
  return [head, inLine, selfLine, outLine].filter((s): s is string => s !== undefined);
}

export function layoutState(d: State): Scene {
  const ts = d.transitions;
  const evW = (i: number) =>
    ts[i]!.label === undefined ? 0 : textWidth(ts[i]!.label!, EVENT_SIZE, 400);

  // ---- items
  const items = new Map<string, Item>();
  for (const s of d.states) {
    const round = s.kind === "initial" || s.kind === "final";
    const r = s.kind === "initial" ? INITIAL_R : FINAL_R;
    items.set(s.id, {
      id: s.id,
      kind: s.kind,
      label: s.label,
      w: round ? 2 * r : Math.max(STATE_W, even(textWidth(s.label, NAME_SIZE, 600) + 32)),
      h: round ? 2 * r : STATE_H,
      round,
      side: 0,
      col: 0,
      tier: 0,
      cx: 0,
      cy: 0,
      loops: [],
    });
  }
  const item = (id: string) => items.get(id)!;
  const loopW = (i: number) => Math.max(LOOP_MIN_W, Math.ceil(evW(i) + 12));
  ts.forEach((t, i) => {
    if (t.from === t.to) item(t.from).loops.push(i);
  });
  for (const n of items.values()) {
    if (n.loops.length === 0) continue;
    const total = n.loops.reduce((sum, i) => sum + loopW(i), 0) + (n.loops.length - 1) * LOOP_GAP;
    n.w = Math.max(n.w, even(total + 52));
  }

  // ---- the happy path: the longest chain of ordinary states from the initial one
  const start = d.states.find((s) => s.kind === "initial")!.id;
  const out = new Map<string, string[]>();
  ts.forEach((t) => {
    if (t.from !== t.to) out.set(t.from, [...(out.get(t.from) ?? []), t.to]);
  });
  const ordinary = (id: string) => item(id).kind !== "exception";
  const mark = new Map<string, 1 | 2>();
  const dag = new Map<string, string[]>();
  const walk = (u: string) => {
    mark.set(u, 1);
    const next: string[] = [];
    for (const v of out.get(u) ?? []) {
      if (!ordinary(v) || mark.get(v) === 1 || next.includes(v)) continue;
      next.push(v);
      if (!mark.has(v)) walk(v);
    }
    dag.set(u, next);
    mark.set(u, 2);
  };
  walk(start);
  const best = new Map<string, string[]>();
  const longest = (u: string): string[] => {
    const known = best.get(u);
    if (known) return known;
    let tail: string[] = [];
    for (const v of dag.get(u) ?? []) {
      const path = longest(v);
      if (path.length > tail.length) tail = path;
    }
    const path = [u, ...tail];
    best.set(u, path);
    return path;
  };
  const spine = longest(start);
  spine.forEach((id, col) => {
    item(id).col = col;
  });
  const onSpine = (id: string) => spine.includes(id);
  const rank = (id: string) => item(id).col;

  // ---- states off the path: above when they lead back to it, below otherwise
  const stack = new Map<string, number>();
  const settle = (n: Item, side: -1 | 1, col: number) => {
    const key = `${col}:${side}`;
    n.side = side;
    n.col = col;
    n.tier = (stack.get(key) ?? 0) + 1;
    stack.set(key, n.tier);
  };
  let pending = d.states.map((s) => s.id).filter((id) => !onSpine(id));
  const placed = new Set<string>();
  while (pending.length > 0) {
    const before = placed.size;
    for (const id of pending) {
      const n = item(id);
      const ins = ts.filter((t) => t.to === id && t.from !== id && onSpine(t.from));
      const outs = ts.filter((t) => t.from === id && t.to !== id && onSpine(t.to));
      if (ins.length > 0 || outs.length > 0) {
        const inRanks = ins.map((t) => rank(t.from));
        const outRanks = outs.map((t) => rank(t.to));
        const col = median(inRanks.length > 0 ? inRanks : outRanks);
        const back = inRanks.length > 0 && outRanks.some((r) => r <= Math.max(...inRanks));
        settle(n, back ? -1 : 1, col);
        placed.add(id);
        continue;
      }
      const near = ts
        .map((t) => (t.from === id ? t.to : t.to === id ? t.from : undefined))
        .find((o) => o !== undefined && placed.has(o));
      if (near !== undefined) {
        settle(n, item(near).side as -1 | 1, item(near).col);
        placed.add(id);
      }
    }
    pending = pending.filter((id) => !placed.has(id));
    if (placed.size === before && pending.length > 0) {
      // Not connected to anything placed: park the first one below the end of the path.
      settle(item(pending[0]!), 1, spine.length - 1);
      placed.add(pending[0]!);
      pending = pending.slice(1);
    }
  }

  // ---- columns
  const cols = spine.length;
  const half = Array.from({ length: cols }, () => 0);
  for (const n of items.values()) half[n.col] = Math.max(half[n.col]!, n.w / 2);
  const primary = new Map<number, number>();
  for (let c = 0; c + 1 < cols; c++) {
    const i = ts.findIndex((t) => t.from === spine[c] && t.to === spine[c + 1]);
    primary.set(i, c);
  }
  const colX: number[] = [0];
  for (let c = 0; c + 1 < cols; c++) {
    const i = [...primary].find(([, col]) => col === c)![0];
    const gap = Math.max(MIN_GAP, Math.ceil(evW(i) + GAP_PAD));
    colX.push(colX[c]! + half[c]! + gap + half[c + 1]!);
  }

  // ---- lanes between states of the path, then the rows of states off it
  const laneIdx: number[] = [];
  ts.forEach((t, i) => {
    if (t.from !== t.to && onSpine(t.from) && onSpine(t.to) && !primary.has(i)) laneIdx.push(i);
  });
  const backs = laneIdx.filter((i) => rank(ts[i]!.to) < rank(ts[i]!.from));
  const aheads = laneIdx.filter((i) => rank(ts[i]!.to) > rank(ts[i]!.from));
  const span = (i: number) => ({
    id: i,
    lo: Math.min(rank(ts[i]!.from), rank(ts[i]!.to)),
    hi: Math.max(rank(ts[i]!.from), rank(ts[i]!.to)),
  });
  const backK = pack(backs.map(span));
  const aheadK = pack(aheads.map(span));
  const topLane = -(ABOVE_LANE + LANE_STEP * Math.max(0, ...backK.values()));
  const bottomLane = BELOW_LANE + LANE_STEP * Math.max(0, ...aheadK.values());
  for (const n of items.values()) {
    n.cx = colX[n.col]!;
    n.cy =
      n.side === 0
        ? 0
        : n.side === -1
          ? topLane - 50 - (n.tier - 1) * TIER_STEP
          : bottomLane + 100 + (n.tier - 1) * TIER_STEP;
  }
  const aboveTop = Math.min(
    0,
    ...[...items.values()].filter((n) => n.side === -1).map((n) => n.cy - n.h / 2),
  );
  const belowBottom = Math.max(
    0,
    ...[...items.values()].filter((n) => n.side === 1).map((n) => n.cy + n.h / 2),
  );

  // ---- routes
  const atts = new Map<string, Att[]>();
  const attach = (n: Item, side: Side, key: number, extra: Partial<Att> = {}): Att => {
    const a: Att = { item: n, side, key, off: 0, ...extra };
    const k = `${n.id}:${side}`;
    atts.set(k, [...(atts.get(k) ?? []), a]);
    return a;
  };
  const near = (n: Item): Side => (n.side === -1 ? "b" : "t");
  const far = (n: Item): Side => (n.side === -1 ? "t" : "b");
  const routes: (Route | undefined)[] = ts.map(() => undefined);
  const claimed = new Set<string>();
  const ulanes: { i: number; lo: number; hi: number; up: boolean }[] = [];

  const incomingFirst = ts
    .map((_, i) => i)
    .sort((x, y) => {
      const rx = item(ts[x]!.to).side !== 0 ? 0 : 1;
      const ry = item(ts[y]!.to).side !== 0 ? 0 : 1;
      return rx - ry || x - y;
    });
  for (const i of incomingFirst) {
    const t = ts[i]!;
    const F = item(t.from);
    const T = item(t.to);
    if (F === T) {
      const down = F.side === 1;
      const own = attach(F, down ? "b" : "t", F.cx, { loop: loopW(i) });
      routes[i] = { build: "loop", a: own, b: own };
      continue;
    }
    if (F.side === 0 && T.side === 0) {
      if (primary.has(i)) {
        routes[i] = {
          build: "straight",
          a: attach(F, "r", 0, { fixed: 0 }),
          b: attach(T, "l", 0, { fixed: 0 }),
        };
      } else if (T.col < F.col) {
        routes[i] = {
          build: "lane",
          a: attach(F, "t", T.cx),
          b: attach(T, "t", F.cx),
          y: -(ABOVE_LANE + LANE_STEP * backK.get(i)!),
        };
      } else {
        routes[i] = {
          build: "lane",
          a: attach(F, "b", T.cx),
          b: attach(T, "b", F.cx),
          y: BELOW_LANE + LANE_STEP * aheadK.get(i)!,
        };
      }
      continue;
    }
    if (F.side === 0 || T.side === 0) {
      const S = F.side === 0 ? F : T;
      const N = F.side === 0 ? T : F;
      const sSide: Side = N.side === -1 ? "t" : "b";
      const rev = (a: Att, b: Att) => (F === S ? { a, b } : { a: b, b: a });
      if (Math.abs(N.cx - S.cx) < 0.5) {
        const sa = attach(S, sSide, N.cx);
        const na = attach(N, near(N), S.cx, { follow: sa });
        routes[i] = { build: "straight", ...rev(sa, na) };
        continue;
      }
      const facing: Side = S.cx < N.cx ? "l" : "r";
      const distance = Math.abs(N.cx - S.cx);
      const key = N.side === -1 ? -distance : distance;
      if (T === N || !claimed.has(`${N.id}:${facing}`)) {
        const sa = attach(S, sSide, N.cx);
        const na = attach(N, facing, key);
        if (T === N) claimed.add(`${N.id}:${facing}`);
        routes[i] = { build: "elbow", ...rev(sa, na) };
        continue;
      }
      // The side facing the path is taken by lines coming in: leave from the far side and go around.
      const sa = attach(S, sSide, N.cx);
      const na = attach(N, far(N), S.cx);
      routes[i] = { build: "lane", ...rev(sa, na) };
      ulanes.push({ i, lo: Math.min(N.cx, S.cx), hi: Math.max(N.cx, S.cx), up: N.side === -1 });
      continue;
    }
    // Both off the path.
    const sameRow = Math.abs(F.cy - T.cy) < 0.5;
    if (F.col === T.col) {
      if (F.side === T.side) {
        const [inner, outer] = F.tier < T.tier ? [F, T] : [T, F];
        const ia = attach(inner, far(inner), outer.cx);
        const oa = attach(outer, near(outer), inner.cx, { follow: ia });
        routes[i] = { build: "straight", ...(inner === F ? { a: ia, b: oa } : { a: oa, b: ia }) };
      } else {
        routes[i] = { build: "gutter", a: attach(F, "r", T.cx), b: attach(T, "r", F.cx) };
      }
      continue;
    }
    const fSide: Side = T.cx > F.cx ? "r" : "l";
    const tSide: Side = T.cx > F.cx ? "l" : "r";
    if (F.side !== T.side) {
      routes[i] = { build: "gutter", a: attach(F, fSide, T.cy), b: attach(T, tSide, F.cy) };
    } else if (sameRow) {
      routes[i] = {
        build: "straight",
        a: attach(F, fSide, 0, { fixed: 0 }),
        b: attach(T, tSide, 0, { fixed: 0 }),
      };
    } else {
      const [inner, outer] = F.tier < T.tier ? [F, T] : [T, F];
      const ia = attach(inner, far(inner), outer.cx);
      const oa = attach(outer, outer.cx < inner.cx ? "r" : "l", 0);
      routes[i] = { build: "elbow", ...(inner === F ? { a: ia, b: oa } : { a: oa, b: ia }) };
    }
  }

  // Lines that go around a state off the path run beyond the farthest row, one lane each when they overlap.
  for (const up of [true, false]) {
    const own = ulanes.filter((u) => u.up === up);
    const k = pack(own.map((u) => ({ id: u.i, lo: u.lo - 10, hi: u.hi + 10 })));
    for (const u of own)
      routes[u.i]!.y = up
        ? Math.min(aboveTop, topLane) - U_CLEAR - LANE_STEP * k.get(u.i)!
        : Math.max(belowBottom, bottomLane) + U_CLEAR + LANE_STEP * k.get(u.i)!;
  }

  // ---- where each line meets its state
  for (const list of atts.values()) {
    const n = list[0]!.item;
    const side = list[0]!.side;
    const along = side === "t" || side === "b" ? n.w / 2 : n.h / 2;
    const flat = n.round ? 0.6 * along : Math.max(0, along - STATE_RADIUS);
    const loops = list.filter((a) => a.loop !== undefined);
    const total =
      loops.reduce((sum, a) => sum + a.loop!, 0) + Math.max(0, loops.length - 1) * LOOP_GAP;
    let x = flat - total;
    for (const a of loops) {
      a.off = x;
      x += a.loop! + LOOP_GAP;
    }
    const free = list.filter(
      (a) => a.loop === undefined && a.follow === undefined && a.fixed === undefined,
    );
    free.sort((p, q) => p.key - q.key);
    const lo = -flat;
    const hi = Math.max(lo, loops.length > 0 ? flat - total - 12 : flat);
    free.forEach((a, k) => {
      a.off = free.length === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * k) / (free.length - 1);
    });
    for (const a of list) if (a.fixed !== undefined) a.off = a.fixed;
  }
  for (const list of atts.values()) for (const a of list) if (a.follow) a.off = a.follow.off;
  const points = routes.map((r) => build(r!));

  // ---- event labels: above the line, moved along or below it when something is in the way
  const boxes = [...items.values()].map(rectOf);
  const labels = new Map<number, Box>();
  const order = ts
    .map((_, i) => i)
    .sort((x, y) => Number(!primary.has(x)) - Number(!primary.has(y)) || x - y);
  const h = lineHeight(EVENT_SIZE);
  for (const i of order) {
    const text = ts[i]!.label;
    if (text === undefined) continue;
    const w = evW(i);
    const pts = points[i]!;
    const segs = pts
      .slice(1)
      .map((p, k) => ({ a: pts[k]!, b: p }))
      .map((s) => ({
        ...s,
        len: Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y),
        flat: Math.abs(s.a.y - s.b.y) < 1e-6,
      }));
    const runs = [
      ...segs.filter((s) => s.flat && s.len >= w + 8).sort((p, q) => q.len - p.len),
      ...segs.filter((s) => !s.flat).sort((p, q) => q.len - p.len),
      ...segs.filter((s) => s.flat && s.len < w + 8).sort((p, q) => q.len - p.len),
    ];
    const candidates: Box[] = [];
    for (const s of runs) {
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const x = s.a.x + (s.b.x - s.a.x) * t;
        const y = s.a.y + (s.b.y - s.a.y) * t;
        if (s.flat) {
          candidates.push({ x: x - w / 2, y: y - LABEL_GAP - h, w, h });
          candidates.push({ x: x - w / 2, y: y + LABEL_GAP, w, h });
        } else {
          candidates.push({ x: x + 8, y: y - h / 2, w, h });
          candidates.push({ x: x - 8 - w, y: y - h / 2, w, h });
        }
      }
    }
    const free = (box: Box) =>
      !boxes.some((b) => overlaps(box, b, 2)) &&
      ![...labels.values()].some((b) => overlaps(box, b, 2)) &&
      !points.some((p) => p.some((q, k) => k > 0 && crosses(box, p[k - 1]!, q)));
    labels.set(i, candidates.find(free) ?? candidates[0]!);
  }

  // ---- bounds, then everything moves so the drawing starts at PAD
  const all: Point[] = [
    ...boxes.flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]),
    ...points.flat(),
    ...[...labels.values()].flatMap((b) => [
      { x: b.x, y: b.y },
      { x: b.x + b.w, y: b.y + b.h },
    ]),
  ];
  const dx = PAD - Math.min(...all.map((p) => p.x));
  const dy = PAD - Math.min(...all.map((p) => p.y));
  const width = Math.max(MIN_WIDTH, Math.ceil(Math.max(...all.map((p) => p.x)) + dx + PAD));
  const bottom = Math.max(...all.map((p) => p.y)) + dy;
  const shift = (p: Point): Point => ({ x: p.x + dx, y: p.y + dy });

  const nodes: SceneNode[] = d.states.map((s) => {
    const n = item(s.id);
    const ins = ts.flatMap((t) =>
      t.to === s.id && t.from !== s.id
        ? [{ from: t.from, ...(t.label === undefined ? {} : { label: t.label }) }]
        : [],
    );
    const outs = ts.flatMap((t) =>
      t.from === s.id && t.to !== s.id
        ? [{ to: t.to, ...(t.label === undefined ? {} : { label: t.label }) }]
        : [],
    );
    const self = n.loops.map((i) => ts[i]!.label);
    const text = [s.detail ?? s.note, ...reading(n, (id) => item(id).label, ins, outs, self)]
      .filter((x): x is string => x !== undefined)
      .join("\n");
    const node: SceneNode = {
      id: s.id,
      kind: s.kind,
      shape: s.kind === "initial" ? "initial" : s.kind === "final" ? "final" : "state",
      x: n.cx - n.w / 2 + dx,
      y: n.cy - n.h / 2 + dy,
      w: n.w,
      h: n.h,
      label: {
        lines: n.round ? [] : [n.label],
        x: n.cx + dx,
        y: n.cy + dy - lineHeight(NAME_SIZE) / 2 + firstBaseline(NAME_SIZE),
        size: NAME_SIZE,
        weight: 600,
        anchor: "middle",
      },
      detail: text,
    };
    if (s.note !== undefined) node.note = s.note;
    if (s.source !== undefined) node.source = s.source;
    return node;
  });

  const edges: SceneEdge[] = ts.map((t, i) => {
    const edge: SceneEdge = {
      id: `t${i}`,
      from: t.from,
      to: t.to,
      points: points[i]!.map(shift),
      style: "sync",
    };
    const box = labels.get(i);
    if (box !== undefined) {
      const b = { ...box, x: box.x + dx, y: box.y + dy };
      edge.label = {
        box: b,
        text: {
          lines: [t.label!],
          x: b.x + b.w / 2,
          y: b.y + firstBaseline(EVENT_SIZE),
          size: EVENT_SIZE,
          weight: 400,
          anchor: "middle",
        },
      };
    }
    if (item(t.from).kind === "exception" || item(t.to).kind === "exception")
      edge.weight = "exception";
    else if (primary.has(i)) edge.weight = "main";
    return edge;
  });

  // ---- legend: only the elements this diagram uses
  const kinds = new Set(d.states.map((s) => s.kind));
  const used: { glyph: string; label: string; family?: string }[] = [
    { glyph: "state-initial", label: "Initial state" },
    ...(kinds.has("final") ? [{ glyph: "state-final", label: "Final state" }] : []),
    ...(kinds.has("state") ? [{ glyph: "state-state", label: "State", family: "task" }] : []),
    ...(kinds.has("exception")
      ? [{ glyph: "state-exception", label: "Exceptional state (dashed)", family: "end" }]
      : []),
    ...(ts.length > 0
      ? [{ glyph: "state-transition", label: "Transition, event above the line" }]
      : []),
    ...(edges.some((e) => e.weight === "exception")
      ? [{ glyph: "state-exception-transition", label: "Exceptional transition (dashed)" }]
      : []),
    ...(ts.some((t) => t.from === t.to) ? [{ glyph: "state-self", label: "Self-transition" }] : []),
  ];
  const SWATCH_W = 44;
  const SWATCH_H = 22;
  const ROW_H = 28;
  const top = bottom + 28;
  const legend: SceneLegendItem[] = [];
  let x = PAD;
  let row = 0;
  for (const u of used) {
    const w = SWATCH_W + 8 + textWidth(u.label, 12, 400);
    if (x > PAD && x + w > width - PAD) {
      x = PAD;
      row++;
    }
    const y = top + row * ROW_H;
    legend.push({
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

  const scene: Scene = {
    type: d.type,
    title: d.title,
    theme: d.theme,
    width,
    height: top + (row + 1) * ROW_H + 12,
    groups: [],
    nodes,
    edges,
    legend,
  };
  if (d.description !== undefined) scene.description = d.description;
  return scene;
}
