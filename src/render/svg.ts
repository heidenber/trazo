// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type {
  Box,
  EdgeEnd,
  Scene,
  SceneLifeline,
  SceneEdge,
  SceneGroup,
  SceneNode,
  SceneRow,
  TextBlock,
} from "../scene.js";
import { lineHeight } from "../text/measure.js";
import { ICONS } from "./generated/icons.js";
import { laneMarkup, num, rect, shapeMarkup } from "./shapes.js";
import { SEQUENCE_CSS, SHAPE_CSS, SVG_CSS, TABLE_CSS } from "./theme.js";

const ICON_SIZE = 20;
const ICON_PAD = 12;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function text(block: TextBlock, cls: string): string {
  const step = lineHeight(block.size);
  const spans = block.lines
    .map(
      (line, i) =>
        `<tspan x="${num(block.x)}" dy="${i === 0 ? 0 : num(step)}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const anchor = block.anchor === "middle" ? ' text-anchor="middle"' : "";
  return `<text class="t-text ${cls}" x="${num(block.x)}" y="${num(block.y)}" font-size="${block.size}" font-weight="${block.weight}"${anchor}>${spans}</text>`;
}

function group(g: SceneGroup): string {
  if (g.variant !== "group") return "";
  return `<g class="t-group" data-id="${escapeXml(g.id)}">${rect(g, "t-group-box")}${text(g.label, "t-group-title")}</g>`;
}

const bracket = (b: TextBlock): TextBlock => {
  const lines = [...b.lines];
  if (lines.length > 0) {
    lines[0] = `[${lines[0]}`;
    lines[lines.length - 1] += "]";
  }
  return { ...b, lines };
};

function fragment(g: SceneGroup): string {
  if (g.variant !== "fragment") return "";
  const t = g.tab ?? { x: g.x, y: g.y, w: 0, h: 0 };
  const cut = 6;
  const tab = `<path class="t-frag-tab" d="M${num(t.x)} ${num(t.y)}H${num(t.x + t.w)}V${num(t.y + t.h - cut)}L${num(t.x + t.w - cut)} ${num(t.y + t.h)}H${num(t.x)}z"/>`;
  const tag = text(g.label, "t-frag-tag");
  const guard = g.guard ? text(bracket(g.guard), "t-frag-guard") : "";
  const dividers = (g.dividers ?? [])
    .map(
      (d) =>
        `<line class="t-frag-divider" x1="${num(g.x)}" y1="${num(d.y)}" x2="${num(g.x + g.w)}" y2="${num(d.y)}"/>${text(bracket(d.guard), "t-frag-guard")}`,
    )
    .join("");
  return `<g class="t-fragment" data-id="${escapeXml(g.id)}">${rect(g, "t-frag", 4)}${dividers}${tab}${tag}${guard}</g>`;
}

const lifeline = (l: SceneLifeline) =>
  `<line class="t-lifeline" data-id="${escapeXml(l.id)}" x1="${num(l.x)}" y1="${num(l.y1)}" x2="${num(l.x)}" y2="${num(l.y2)}"/>`;

// Inside a sequence scene these use the open arrowhead.
const OPEN_STYLES = ["async", "reply"];

// Set to false to drop the background-colored stroke under erd edges.
const EDGE_HALO = true;

function edge(e: SceneEdge, seq: boolean): string {
  const d = e.points.map((p, i) => `${i === 0 ? "M" : "L"}${num(p.x)} ${num(p.y)}`).join(" ");
  const id = `data-edge="${escapeXml(e.id)}"`;
  const attrs = `class="t-edge t-edge-${e.style}" data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}" d="${d}"`;
  if (!e.ends)
    return `<path ${attrs} marker-end="url(#${seq && OPEN_STYLES.includes(e.style) ? "t-arrowhead-open" : "t-arrowhead"})" ${id}/>`;
  const halo = EDGE_HALO ? `<path class="t-edge-halo" d="${d}" ${id}/>` : "";
  return `${halo}<path ${attrs} marker-start="url(#t-end-${e.ends.from})" marker-end="url(#t-end-${e.ends.to})" ${id}/>`;
}

// Drawn for the end of the line (x = 20); auto-start-reverse mirrors it at the start.
const END_MARKERS: Record<EdgeEnd, string> = {
  one: `<path class="t-end" d="M14 1V11"/>`,
  "zero-or-one": `<circle class="t-end t-end-dot" cx="6" cy="6" r="3.5"/><path class="t-end" d="M14 1V11"/>`,
  many: `<path class="t-end" d="M20 1L10 6L20 11M10 6H20"/>`,
  "zero-or-many": `<circle class="t-end t-end-dot" cx="5" cy="6" r="3.5"/><path class="t-end" d="M20 1L10 6L20 11M10 6H20"/>`,
};

const endMarkers = () =>
  (Object.keys(END_MARKERS) as EdgeEnd[])
    .map(
      (k) =>
        `<marker id="t-end-${k}" viewBox="0 0 20 12" refX="20" refY="6" markerWidth="20" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">${END_MARKERS[k]}</marker>`,
    )
    .join("");

function edgeLabel(e: SceneEdge): string {
  if (!e.label) return "";
  return `<g class="t-edge-label" data-edge="${escapeXml(e.id)}">${rect(e.label.box, "t-label-bg", 3)}${text(e.label.text, "t-label")}</g>`;
}

function icon(node: SceneNode): string {
  const markup = node.icon === undefined ? undefined : ICONS[node.icon];
  if (markup === undefined) return "";
  const y = node.y + (node.h - ICON_SIZE) / 2;
  return `<svg class="t-icon t-icon-${escapeXml(node.kind)}" x="${num(node.x + ICON_PAD)}" y="${num(y)}" width="${ICON_SIZE}" height="${ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
}

function lanes(groups: SceneGroup[]): string[] {
  let i = 0;
  return groups
    .filter((g) => g.variant === "lane")
    .map((g) =>
      laneMarkup({ ...g, id: escapeXml(g.id) }, i++ % 2 === 1, text(g.label, "t-lane-title")),
    );
}

function tableBody(n: SceneNode): string {
  const head = n.header ?? 0;
  const r = 8;
  const right = n.x + n.w;
  const band = `<path class="t-table-head" d="M${num(n.x)} ${num(n.y + head)}V${num(n.y + r)}Q${num(n.x)} ${num(n.y)} ${num(n.x + r)} ${num(n.y)}H${num(right - r)}Q${num(right)} ${num(n.y)} ${num(right)} ${num(n.y + r)}V${num(n.y + head)}z"/>`;
  const rows = (n.rows ?? []).map((row: SceneRow) => {
    const tip = row.note ? `<desc>${escapeXml(row.note)}</desc>` : "";
    const sep = `<line class="t-row" x1="${num(n.x)}" y1="${num(row.y)}" x2="${num(right)}" y2="${num(row.y)}"/>`;
    const name = row.key ? { ...row.name, weight: 600 as const } : row.name;
    const marks = row.marks ? text(row.marks, "t-col-marks") : "";
    return `<g>${tip}${sep}${text(name, "t-col-name")}${text(row.type, "t-col-type")}${marks}</g>`;
  });
  return band + rows.join("");
}

function node(n: SceneNode): string {
  const tip = [n.note, n.source].filter((s): s is string => s !== undefined && s !== "").join("\n");
  const desc = tip ? `<desc>${escapeXml(tip)}</desc>` : "";
  return `<g class="${n.shape === "box" ? "t-node" : `t-node t-shape-${n.shape}`}" data-id="${escapeXml(n.id)}" data-kind="${escapeXml(n.kind)}" tabindex="0">${desc}${shapeMarkup(n.shape, n)}${n.shape === "table" ? tableBody(n) : icon(n)}${text(n.label, "t-node-label")}</g>`;
}

const needsShapeCss = (scene: Scene) =>
  scene.nodes.some((n) => n.shape !== "box") || scene.groups.some((g) => g.variant === "lane");

const needsTableCss = (scene: Scene) =>
  scene.nodes.some((n) => n.shape === "table") || scene.edges.some((e) => e.ends);

export function renderSvg(scene: Scene): string {
  const desc = scene.description ? `<desc id="t-desc">${escapeXml(scene.description)}</desc>` : "";
  const labelled = scene.description ? "t-title t-desc" : "t-title";
  const ends = scene.edges.some((e) => e.ends);
  const seq = scene.lifelines !== undefined;
  // Sequence async and reply messages use the open head; ERD edges with crow's-foot ends use none.
  const isOpen = (e: SceneEdge) => seq && OPEN_STYLES.includes(e.style);
  const needsOpen = scene.edges.some(isOpen);
  const needsFilled = scene.edges.some((e) => !e.ends && !isOpen(e));
  const open = needsOpen
    ? `<marker id="t-arrowhead-open" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="t-arrow-open" d="M1 1L9 5L1 9"/></marker>`
    : "";
  // Outside sequences the filled head is dropped only when every edge has its own ends.
  const dropFilled = !needsFilled && (seq || ends);
  const arrow = dropFilled
    ? ""
    : `<marker id="t-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto"><path class="t-arrow" d="M0 1L10 5L0 9z"/></marker>`;
  const css =
    (needsShapeCss(scene) ? SVG_CSS + SHAPE_CSS : SVG_CSS) +
    (needsTableCss(scene) ? TABLE_CSS : "") +
    (seq ? SEQUENCE_CSS : "");
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="${seq ? "diagram t-seq" : "diagram"}" viewBox="0 0 ${num(scene.width)} ${num(scene.height)}" role="img" aria-labelledby="${labelled}">`,
    `<title id="t-title">${escapeXml(scene.title)}</title>`,
    desc,
    `<defs>${arrow}${open}${ends ? endMarkers() : ""}</defs>`,
    `<style>${css}</style>`,
    ...(scene.lifelines ?? []).map(lifeline),
    ...lanes(scene.groups),
    ...scene.groups.map(group),
    ...scene.groups.map(fragment),
    ...scene.edges.map((e) => edge(e, seq)),
    ...scene.edges.map(edgeLabel),
    ...scene.nodes.map(node),
    "</svg>",
  ];
  return parts.filter(Boolean).join("\n");
}
