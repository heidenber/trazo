// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

/** Geometry of the ERD overview panel, shared by the layout (height) and the renderer (positions). */
export const OVERVIEW_GAP = 14;
export const OVERVIEW_BOTTOM = 8;
export const MAX_RELATIONS = 6;
/** Panel height while collapsed: just the header row. */
export const PANEL_COLLAPSED = 34;
export const INDEX_ROW = 18;

const REL_ROW0 = 96;
const REL_STEP = 15;

export function overviewMetrics(relations: number, tables: number) {
  const relRows = Math.max(1, Math.ceil(Math.min(relations, MAX_RELATIONS) / 2));
  const indexHead = REL_ROW0 + (relRows - 1) * REL_STEP + 20;
  const colHead = indexHead + 13;
  const line = colHead + 4;
  const rowTop = line + 3;
  return {
    relRow0: REL_ROW0,
    relStep: REL_STEP,
    indexHead,
    colHead,
    line,
    rowTop,
    panel: rowTop + tables * INDEX_ROW + 6,
  };
}
