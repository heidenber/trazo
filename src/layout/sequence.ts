// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { SeqFragment, SeqItem, SeqMessage, SeqNote, Sequence } from "../model/sequence.js";
import type { Box, Scene, SceneEdge, SceneGroup, SceneNode, TextBlock } from "../scene.js";
import { firstBaseline, lineHeight, textWidth, wrapText } from "../text/measure.js";
import {
  ICON_BY_KIND,
  LABEL_PAD,
  LABEL_SIZE,
  LOOP_LABEL_GAP,
  NOTE_SIZE,
  NOTE_WIDTH,
  SELF_LOOP,
  half,
  sizeHeaders,
  sizeLabel,
  solveColumns,
  type Headers,
} from "./sequence-columns.js";
import { ICON_TEXT_LEFT } from "./shapes.js";

const MARGIN = 24;
const MSG_ROW = 36;
const SELF_ROW = 40;
const LINE_ABOVE = 6;
const LABEL_LIFT = 3;
const LOOP_INSET = 8;
const NOTE_SPAN_PAD = 40;
const NOTE_PAD = 8;
const NOTE_AIR = 12;
const FRAG_OPEN = 26;
const FRAG_DIVIDER = 24;
const FRAG_CLOSE = 12;
const FRAG_TAB_H = 18;
const FRAG_SIZE = 11;
const FRAG_PAD = 16;
const FRAG_NEST_PAD = 12;
const TAB_PAD = 8;

interface Extent {
  lo: number;
  hi: number;
}

const grow = (e: Extent, lo: number, hi: number) => {
  e.lo = Math.min(e.lo, lo);
  e.hi = Math.max(e.hi, hi);
};

function block(
  lines: string[],
  x: number,
  top: number,
  size: number,
  weight: 400 | 600,
  anchor: "start" | "middle",
): TextBlock {
  return { lines, x: half(x), y: half(top + firstBaseline(size)), size, weight, anchor };
}

function build(
  seq: Sequence,
  heads: Headers,
  base: number[],
  dx: number,
): { scene: Scene; minX: number } {
  const c = base.map((v) => v + dx);
  const at = new Map(seq.participants.map((p, i) => [p.id, i]));
  const col = (id: string) => c[at.get(id)!]!;
  const nodes: SceneNode[] = [];
  const edges: SceneEdge[] = [];
  const groups: SceneGroup[] = [];
  const counts = { m: 0, n: 0, f: 0 };
  const seen: Extent = { lo: Infinity, hi: -Infinity };
  const lh = lineHeight(LABEL_SIZE);

  seq.participants.forEach((p, i) => {
    const w = heads.widths[i]!;
    const box: Box = { x: c[i]! - w / 2, y: MARGIN, w, h: heads.height };
    const lines = heads.lines[i]!;
    const top = box.y + (box.h - lines.length * lh) / 2;
    const node: SceneNode = {
      id: p.id,
      kind: p.kind,
      icon: ICON_BY_KIND[p.kind],
      shape: "box",
      ...box,
      label: block(lines, box.x + ICON_TEXT_LEFT, top, LABEL_SIZE, 600, "start"),
    };
    if (p.note !== undefined) node.note = p.note;
    if (p.source !== undefined) node.source = p.source;
    nodes.push(node);
    grow(seen, box.x, box.x + w);
  });

  function message(m: SeqMessage, y: number, ext: Extent): number {
    const { lines, width } = sizeLabel(m.label);
    const textH = lines.length * lh;
    const boxW = width + 2 * LABEL_PAD;
    const boxH = Math.ceil(textH + LABEL_PAD);
    const a = col(m.from);
    const b = col(m.to);
    const self = m.from === m.to;
    const h = self ? Math.max(SELF_ROW, textH + 16) : Math.max(MSG_ROW, textH + 14);
    const edge: SceneEdge = {
      id: `#m${counts.m++}`,
      from: m.from,
      to: m.to,
      style: m.style,
      points: [],
    };
    let lo = Math.min(a, b);
    let hi = Math.max(a, b);

    if (self) {
      const x = a + SELF_LOOP;
      edge.points = [
        { x: a, y: y + LOOP_INSET },
        { x, y: y + LOOP_INSET },
        { x, y: y + h - LOOP_INSET },
        { x: a, y: y + h - LOOP_INSET },
      ];
      hi = x;
      if (lines.length > 0) {
        const box = { x: x + LOOP_LABEL_GAP, y: half(y + (h - boxH) / 2), w: boxW, h: boxH };
        edge.label = {
          box,
          text: block(lines, box.x + LABEL_PAD, box.y + LABEL_PAD / 2, LABEL_SIZE, 400, "start"),
        };
        hi = box.x + box.w;
      }
    } else {
      const line = y + h - LINE_ABOVE;
      edge.points = [
        { x: a, y: line },
        { x: b, y: line },
      ];
      if (lines.length > 0) {
        const box = {
          x: half((a + b) / 2 - boxW / 2),
          y: half(line - LABEL_LIFT - boxH),
          w: boxW,
          h: boxH,
        };
        edge.label = {
          box,
          text: block(lines, box.x + boxW / 2, box.y + LABEL_PAD / 2, LABEL_SIZE, 400, "middle"),
        };
      }
    }
    edges.push(edge);
    grow(ext, lo - FRAG_PAD, hi + FRAG_PAD);
    grow(seen, lo, hi);
    return y + h;
  }

  function note(n: SeqNote, y: number, ext: Extent): number {
    const idx = n.over.map((id) => at.get(id)!);
    const lo = c[Math.min(...idx)]!;
    const hi = c[Math.max(...idx)]!;
    const single = n.over.length === 1;
    const x = single ? lo - NOTE_WIDTH / 2 : lo - NOTE_SPAN_PAD;
    const w = single ? NOTE_WIDTH : hi - lo + 2 * NOTE_SPAN_PAD;
    const lines = wrapText(n.text, w - 2 * NOTE_PAD, NOTE_SIZE);
    const h = Math.ceil(lines.length * lineHeight(NOTE_SIZE) + 2 * NOTE_PAD);
    const label = block(lines, x + NOTE_PAD, y + NOTE_PAD, NOTE_SIZE, 400, "start");
    nodes.push({ id: `#n${counts.n++}`, kind: "note", shape: "note", x, y, w, h, label });
    grow(ext, x - FRAG_PAD, x + w + FRAG_PAD);
    grow(seen, x, x + w);
    return y + h + NOTE_AIR;
  }

  function fragment(f: SeqFragment, y: number, depth: number, ext: Extent): number {
    const tag = f.op;
    // Taken before the walk so outer fragments keep lower ids and draw under inner ones.
    const id = `#f${counts.f++}`;
    const at = groups.length;

    const mine: Extent = { lo: Infinity, hi: -Infinity };
    const splits: { y: number; when: string }[] = [];
    let cursor = y + FRAG_OPEN;
    f.branches.forEach((branch, i) => {
      if (i > 0) {
        splits.push({ y: cursor, when: branch.when });
        cursor += FRAG_DIVIDER;
      }
      cursor = walk(branch.items, cursor, depth + 1, mine);
    });
    cursor += FRAG_CLOSE;

    const guardW = (when: string) => textWidth(`[${when}]`, FRAG_SIZE, 400);
    const tabW = Math.ceil(textWidth(tag, FRAG_SIZE, 600)) + 2 * TAB_PAD;
    const needed = Math.max(
      tabW + TAB_PAD + guardW(f.branches[0]!.when) + TAB_PAD,
      ...splits.map((s) => guardW(s.when) + 2 * TAB_PAD),
    );
    const x = mine.lo;
    const tab: Box = { x, y, w: tabW, h: FRAG_TAB_H };
    const textTop = (top: number) => top + (FRAG_TAB_H - lineHeight(FRAG_SIZE)) / 2;
    const group: SceneGroup = {
      id,
      x,
      y,
      w: Math.ceil(Math.max(mine.hi - mine.lo, needed)),
      h: cursor - y,
      label: block([tag], tab.x + TAB_PAD, textTop(y), FRAG_SIZE, 600, "start"),
      depth,
      variant: "fragment",
      tab,
      guard: block(
        [f.branches[0]!.when],
        tab.x + tabW + TAB_PAD,
        textTop(y),
        FRAG_SIZE,
        400,
        "start",
      ),
      dividers: splits.map((s) => ({
        y: s.y,
        guard: block([s.when], x + TAB_PAD, s.y + 4, FRAG_SIZE, 400, "start"),
      })),
    };
    groups.splice(at, 0, group);

    grow(ext, group.x - FRAG_NEST_PAD, group.x + group.w + FRAG_NEST_PAD);
    grow(seen, group.x, group.x + group.w);
    return cursor;
  }

  function walk(items: SeqItem[], start: number, depth: number, ext: Extent): number {
    let y = start;
    let previous: SeqItem["type"] | undefined;
    for (const item of items) {
      // Box borders would touch the next box or note; message rows carry their own top space.
      if (previous === "fragment" && item.type !== "message") y += NOTE_AIR;
      previous = item.type;
      if (item.type === "message") y = message(item, y, ext);
      else if (item.type === "note") y = note(item, y, ext);
      else y = fragment(item, y, depth, ext);
    }
    return y;
  }

  const headBottom = MARGIN + heads.height;
  const end = walk(seq.items, headBottom + MARGIN, 0, { lo: Infinity, hi: -Infinity });
  const y2 = end + FRAG_CLOSE;

  const scene: Scene = {
    type: "sequence",
    title: seq.title,
    theme: seq.theme,
    width: seen.hi + MARGIN,
    height: y2 + MARGIN,
    groups,
    nodes,
    edges,
    lifelines: seq.participants.map((p, i) => ({ id: p.id, x: c[i]!, y1: headBottom, y2 })),
  };
  if (seq.description !== undefined) scene.description = seq.description;
  return { scene, minX: seen.lo };
}

export function layoutSequence(seq: Sequence): Scene {
  const heads = sizeHeaders(seq.participants);
  const base = solveColumns(seq, heads.widths);
  // Boxes and loops can reach left of the first column; the second pass
  // shifts every x so the leftmost one sits on the margin.
  const probe = build(seq, heads, base, 0);
  return build(seq, heads, base, MARGIN - probe.minX).scene;
}
