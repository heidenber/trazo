// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { ThemeName } from "./model/common.js";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextBlock {
  lines: string[];
  x: number;
  /** Baseline of the first line. */
  y: number;
  size: number;
  weight: 400 | 600;
  anchor: "start" | "middle";
}

export type NodeShape = "box" | "pill" | "end" | "diamond" | "subprocess" | "table" | "note";

export type EdgeEnd = "one" | "zero-or-one" | "many" | "zero-or-many";

export interface SceneRow {
  /** Absolute top of the row, same space as the node. */
  y: number;
  h: number;
  name: TextBlock;
  type: TextBlock;
  marks?: TextBlock;
  note?: string;
  key: boolean;
}

export interface SceneNode extends Box {
  id: string;
  kind: string;
  /** Lucide icon name. */
  icon?: string;
  shape: NodeShape;
  label: TextBlock;
  /** Visible note below the label, cut to a few lines; `note` keeps the whole text for the tooltip. */
  subtitle?: TextBlock;
  note?: string;
  /** Viewer-only detail card text; the SVG never carries it. */
  detail?: string;
  source?: string;
  /** Id of the group or lane that directly contains the node. */
  parent?: string;
  /** Optional family tint chosen by a layout (ERD table groups). */
  family?: string;
  /** Table nodes only. */
  rows?: SceneRow[];
  /** Table header height. */
  header?: number;
}

export interface SceneGroup extends Box {
  id: string;
  label: TextBlock;
  depth: number;
  variant: "group" | "lane" | "fragment";
  /** Width of the label column at the left of a lane band, or height of the label row atop a lane column. */
  header?: number;
  /** Lane role line, muted, under the label. */
  note?: TextBlock;
  /** The lane is a column: steps flow down and its label sits in a row at the top. */
  columns?: true;
  /** Fragment tab box; `label` holds the operator (alt, opt, loop). The renderer does not measure text. */
  tab?: Box;
  /** Guard of the first branch. */
  guard?: TextBlock;
  /** Branch separators below the first branch. */
  dividers?: { y: number; guard: TextBlock }[];
}

export interface SceneEdge {
  id: string;
  from: string;
  to: string;
  points: Point[];
  style: "sync" | "async" | "data" | "reply";
  label?: { box: Box; text: TextBlock };
  /** Crow's foot symbols; an edge with ends has no arrowhead. */
  ends?: { from: EdgeEnd; to: EdgeEnd };
}

export interface SceneLifeline {
  id: string;
  x: number;
  y1: number;
  y2: number;
}

export interface SceneLegendItem {
  family?: string;
  style?: SceneEdge["style"];
  swatch: Box;
  label: TextBlock;
}

/** ERD-only summary rendered below the diagram when it has two or more tables. */
export interface SceneOverview {
  top: number;
  /** Panel height expanded and collapsed; the scene height adds the gaps around the panel. */
  panelHeight: number;
  collapsedPanelHeight: number;
  /** Scene height when the panel is collapsed. */
  collapsedHeight: number;
  tables: {
    id: string;
    label: string;
    note?: string;
    columns: number;
    group?: string;
    referencedBy: string[];
  }[];
  /** One per foreign key: `parent` is the referenced table, `child` holds the fk column. */
  relations: {
    id: string;
    parent: string;
    child: string;
    column: string;
    cardinality: "1:N" | "1:1";
    optional: boolean;
    self: boolean;
  }[];
  stats: { pk: number; fk: number; optional: number; self: number };
}

export interface Scene {
  type: string;
  title: string;
  description?: string;
  theme: ThemeName;
  width: number;
  height: number;
  /** Outer groups come before the groups they contain. */
  groups: SceneGroup[];
  nodes: SceneNode[];
  edges: SceneEdge[];
  /** Present only in sequence scenes. */
  lifelines?: SceneLifeline[];
  legend?: SceneLegendItem[];
  overview?: SceneOverview;
}
