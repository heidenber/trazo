// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import {
  ADVANCES_400,
  ADVANCES_600,
  ASCENDER,
  DESCENDER,
  FIRST_CODE_POINT,
  UNITS_PER_EM,
} from "./generated/metrics.js";

export type Weight = 400 | 600;

export const FONT_FAMILY = "Inter";
export const LINE_HEIGHT = 1.3;

const average = (advances: readonly number[]) => {
  const lower = advances.slice(0x61 - FIRST_CODE_POINT, 0x7a - FIRST_CODE_POINT + 1);
  return lower.reduce((sum, w) => sum + w, 0) / lower.length;
};
const AVERAGE: Record<Weight, number> = { 400: average(ADVANCES_400), 600: average(ADVANCES_600) };

// Characters the embedded font lacks fall back to a system font in the
// browser. CJK and similar scripts are close to square; everything else is
// estimated with the average lowercase width.
const WIDE =
  /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{1f300}-\u{1faff}]/u;

function advance(char: string, weight: Weight): number {
  const table = weight === 600 ? ADVANCES_600 : ADVANCES_400;
  const known = table[char.codePointAt(0)! - FIRST_CODE_POINT];
  if (known) return known;
  return WIDE.test(char) ? UNITS_PER_EM : AVERAGE[weight];
}

export function textWidth(text: string, fontSize: number, weight: Weight = 400): number {
  let units = 0;
  for (const char of text) units += advance(char, weight);
  return (units * fontSize) / UNITS_PER_EM;
}

export function lineHeight(fontSize: number): number {
  return fontSize * LINE_HEIGHT;
}

/**
 * Distance from the top of a line box to its baseline, the way browsers
 * place it: half the leading above the ascender.
 */
export function firstBaseline(fontSize: number): number {
  const ascent = (ASCENDER / UNITS_PER_EM) * fontSize;
  const content = ((ASCENDER - DESCENDER) / UNITS_PER_EM) * fontSize;
  return (lineHeight(fontSize) - content) / 2 + ascent;
}

/** Greedy word wrap; words wider than the line are split by character. */
export function wrapText(
  text: string,
  maxWidth: number,
  fontSize: number,
  weight: Weight = 400,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, fontSize, weight) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const char of word) {
        if (line && textWidth(line + char, fontSize, weight) > maxWidth) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
