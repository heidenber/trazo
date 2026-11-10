// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { SeqItem, SeqParticipant, Sequence } from "../model/sequence.js";
import { lineHeight, textWidth, wrapText } from "../text/measure.js";
import { ICON_TEXT_LEFT } from "./shapes.js";

export const LABEL_SIZE = 13;
export const LABEL_WRAP = 260;
export const NOTE_SIZE = 12;
export const NOTE_WIDTH = 180;
export const SELF_LOOP = 28;
export const HEAD_GAP = 24;
/** Padding between a message label and its background box, on each side. */
export const LABEL_PAD = 4;
/** Gap from a self-call's loop to its label box. */
export const LOOP_LABEL_GAP = 8;
/** Free space a label box keeps from the lifelines around it, on each side. */
export const LABEL_AIR = 12;

const HEAD_SIZE = 13;
const HEAD_WRAP = 140;
const HEAD_MIN_W = 120;
const HEAD_MIN_H = 40;
const HEAD_PAD_RIGHT = 12;
/** Room a lone note asks for toward each neighbour: half its width plus air. */
const NOTE_REACH = NOTE_WIDTH / 2 + 16;

export const half = (v: number) => Math.round(v * 2) / 2;
const ceilHalf = (v: number) => Math.ceil(v * 2) / 2;

export const ICON_BY_KIND: Record<SeqParticipant["kind"], string> = {
  actor: "user",
  service: "server",
  database: "database",
  queue: "inbox",
  external: "globe",
};

export interface Headers {
  widths: number[];
  lines: string[][];
  height: number;
}

export function sizeHeaders(participants: SeqParticipant[]): Headers {
  const lines = participants.map((p) => wrapText(p.label, HEAD_WRAP, HEAD_SIZE, 600));
  const widths = lines.map((ls) => {
    const widest = Math.max(...ls.map((l) => textWidth(l, HEAD_SIZE, 600)));
    return Math.max(HEAD_MIN_W, Math.ceil(ICON_TEXT_LEFT + widest + HEAD_PAD_RIGHT));
  });
  const height = Math.max(
    HEAD_MIN_H,
    ...lines.map((ls) => Math.ceil(ls.length * lineHeight(HEAD_SIZE) + 20)),
  );
  return { widths, lines, height };
}

export interface LabelText {
  lines: string[];
  width: number;
}

export function sizeLabel(label: string | undefined): LabelText {
  if (label === undefined || label === "") return { lines: [], width: 0 };
  const lines = wrapText(label, LABEL_WRAP, LABEL_SIZE);
  return { lines, width: Math.ceil(Math.max(...lines.map((l) => textWidth(l, LABEL_SIZE)))) };
}

interface Rule {
  lo: number;
  hi: number;
  need: number;
}

/**
 * Centres of the participant columns. Rules are applied shortest span first,
 * in document order, and any shortfall is shared equally by the gaps the span
 * crosses; the order is fixed, so the result is too.
 */
export function solveColumns(seq: Sequence, widths: number[]): number[] {
  const at = new Map(seq.participants.map((p, i) => [p.id, i]));
  const gaps = widths.slice(0, -1).map((w, i) => (w + widths[i + 1]!) / 2 + HEAD_GAP);
  const rules: Rule[] = [];

  const visit = (items: SeqItem[]): void => {
    for (const item of items) {
      if (item.type === "fragment") {
        item.branches.forEach((branch) => visit(branch.items));
      } else if (item.type === "message") {
        const a = at.get(item.from)!;
        const b = at.get(item.to)!;
        const box = sizeLabel(item.label).width + 2 * LABEL_PAD;
        // A self-call label sits right of its loop and must clear the next lifeline;
        // a span label is centred between its two lifelines.
        if (a === b)
          rules.push({ lo: a, hi: a + 1, need: SELF_LOOP + LOOP_LABEL_GAP + box + LABEL_AIR });
        else rules.push({ lo: Math.min(a, b), hi: Math.max(a, b), need: box + 2 * LABEL_AIR });
      } else if (item.over.length === 1) {
        const i = at.get(item.over[0]!)!;
        rules.push({ lo: i - 1, hi: i, need: NOTE_REACH }, { lo: i, hi: i + 1, need: NOTE_REACH });
      }
    }
  };
  visit(seq.items);

  const ordered = rules
    .filter((r) => r.lo >= 0 && r.hi <= gaps.length)
    .sort((x, y) => x.hi - x.lo - (y.hi - y.lo));
  for (const { lo, hi, need } of ordered) {
    const have = gaps.slice(lo, hi).reduce((sum, g) => sum + g, 0);
    if (have >= need) continue;
    const extra = ceilHalf((need - have) / (hi - lo));
    for (let i = lo; i < hi; i++) gaps[i] = gaps[i]! + extra;
  }

  const centres = [widths[0]! / 2];
  gaps.forEach((g, i) => centres.push(centres[i]! + g));
  return centres;
}
