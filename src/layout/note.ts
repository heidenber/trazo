// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { firstBaseline, lineHeight, textWidth, wrapText } from "../text/measure.js";

/** Notes read as a muted subtitle: smaller and lighter than the label. */
export const NOTE_SIZE = 12;
/** Space between the label and the note below it. */
export const NOTE_GAP = 2;
const MAX_LINES = 3;
const ELLIPSIS = "…";

/** Wraps a note to at most three lines; a longer note ends in an ellipsis. The tooltip keeps it whole. */
export function noteLines(note: string, maxWidth: number): string[] {
  const lines = wrapText(note, maxWidth, NOTE_SIZE, 400);
  if (lines.length <= MAX_LINES) return lines;
  let last = Array.from(lines[MAX_LINES - 1]!);
  while (last.length > 0 && textWidth(last.join("") + ELLIPSIS, NOTE_SIZE, 400) > maxWidth) {
    last = last.slice(0, -1);
  }
  return [...lines.slice(0, MAX_LINES - 1), last.join("").trimEnd() + ELLIPSIS];
}

/** Height a note adds below its label, gap included; nothing when there is no note. */
export function noteHeight(lines: string[]): number {
  return lines.length === 0 ? 0 : NOTE_GAP + lines.length * lineHeight(NOTE_SIZE);
}

/** Baselines of a label and the note below it, the pair centred vertically in the band. */
export function stackBaselines(
  top: number,
  height: number,
  labelLines: number,
  labelSize: number,
  note: string[],
): { label: number; note: number } {
  const label = labelLines * lineHeight(labelSize);
  const start = top + (height - label - noteHeight(note)) / 2;
  return {
    label: start + firstBaseline(labelSize),
    note: start + label + NOTE_GAP + firstBaseline(NOTE_SIZE),
  };
}
