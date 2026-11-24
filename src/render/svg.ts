// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type {
  Box,
  EdgeEnd,
  Scene,
  SceneLegendItem,
  SceneLifeline,
  SceneEdge,
  SceneGroup,
  SceneNode,
  SceneRow,
  TextBlock,
} from "../scene.js";
import { INDEX_ROW, MAX_RELATIONS, overviewMetrics } from "../layout/overview.js";
import { lineHeight } from "../text/measure.js";
import { CHIP_PAD, CHIP_RADIUS, CHIP_SIZE, GLYPH_SIZE } from "./card.js";
import { chenCard, chenEdge, glyph, underline } from "./chen.js";
import { ICONS } from "./generated/icons.js";
import { familyOf, type Family } from "./families.js";
import {
  SHADOWED,
  SHADOW_ID,
  TABLE_RADIUS,
  laneMarkup,
  num,
  pathData,
  rect,
  shapeMarkup,
} from "./shapes.js";
import {
  CHEN_CSS,
  GROUPED_TABLE_CSS,
  LEGEND_CSS,
  NOTE_CSS,
  OVERVIEW_CSS,
  SEQUENCE_CSS,
  SHADOW_CSS,
  LANE_NOTE_CSS,
  SHAPE_CSS,
  SVG_CSS,
  TABLE_CSS,
  familyCss,
} from "./theme.js";

const GROUP_RADIUS = 16;
const FRAGMENT_RADIUS = 8;
const LEGEND_SWATCH_RADIUS = 5;
const LABEL_RADIUS = 11;
/** Shapes whose box takes the family tint; cards with a chip keep the card surface. */
const TINTED_SHAPES = ["pill", "end", "diamond"];

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
  return `<g class="t-group" data-id="${escapeXml(g.id)}">${rect(g, "t-group-box", GROUP_RADIUS)}${text(g.label, "t-group-title")}</g>`;
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
  return `<g class="t-fragment" data-id="${escapeXml(g.id)}">${rect(g, "t-frag", FRAGMENT_RADIUS)}${dividers}${tab}${tag}${guard}</g>`;
}

const lifeline = (l: SceneLifeline) =>
  `<line class="t-lifeline" data-id="${escapeXml(l.id)}" x1="${num(l.x)}" y1="${num(l.y1)}" x2="${num(l.x)}" y2="${num(l.y2)}"/>`;

// Inside a sequence scene these use the open arrowhead.
const OPEN_STYLES = ["async", "reply"];

// Set to false to drop the background-colored stroke under erd edges.
const EDGE_HALO = true;

const STYLES: SceneEdge["style"][] = ["sync", "async", "data", "reply"];

// One marker per style, so each head takes its edge's color. Sync keeps the original id.
const markerId = (style: SceneEdge["style"], open: boolean) =>
  open ? `t-arrowhead-open-${style}` : style === "sync" ? "t-arrowhead" : `t-arrowhead-${style}`;

const arrowClass = (style: SceneEdge["style"]) =>
  style === "sync" ? "t-arrow" : `t-arrow t-arrow-${style}`;

function edge(e: SceneEdge, seq: boolean): string {
  const d = pathData(e.points, undefined, e.ends !== undefined);
  const id = `data-edge="${escapeXml(e.id)}"`;
  const attrs = `class="t-edge t-edge-${e.style}" data-from="${escapeXml(e.from)}" data-to="${escapeXml(e.to)}" d="${d}"`;
  if (!e.ends)
    return `<path ${attrs} marker-end="url(#${markerId(e.style, seq && OPEN_STYLES.includes(e.style))})" ${id}/>`;
  const halo = EDGE_HALO ? `<path class="t-edge-halo" d="${d}" ${id}/>` : "";
  return `${halo}<path ${attrs} marker-start="url(#t-end-${e.ends.from})" marker-end="url(#t-end-${e.ends.to})" ${id}/>`;
}

// Drawn for the end of the line (x = 20, the table border); auto-start-reverse
// mirrors it at the start. The outer bar sits 3 px from the border, flush like
// the crow's foot tip; exactly one is a double bar.
const END_MARKERS: Record<EdgeEnd, string> = {
  one: `<path class="t-end" d="M13 1V11M17 1V11"/>`,
  "zero-or-one": `<circle class="t-end t-end-dot" cx="9" cy="6" r="3.5"/><path class="t-end" d="M17 1V11"/>`,
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

// Two layers: a tight contact shadow and a wide soft one. The region is generous because the
// blur of the far layer reaches well past a short card.
const shadowFilter = () =>
  `<filter id="${SHADOW_ID}" x="-30%" y="-40%" width="160%" height="220%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="1" stdDeviation="1" class="t-shadow-near"/><feDropShadow dx="0" dy="6" stdDeviation="8" class="t-shadow-far"/></filter>`;

function edgeLabel(e: SceneEdge): string {
  if (!e.label) return "";
  return `<g class="t-edge-label" data-edge="${escapeXml(e.id)}">${rect(e.label.box, "t-label-bg", Math.min(e.label.box.h / 2, LABEL_RADIUS))}${text(e.label.text, "t-label")}</g>`;
}

const hasChip = (node: SceneNode) =>
  node.icon !== undefined && ICONS[node.icon] !== undefined && node.shape !== "table";

/** A tinted chip on the left of the card with the kind's icon on it. */
function chip(node: SceneNode): string {
  const markup = node.icon === undefined ? undefined : ICONS[node.icon];
  if (markup === undefined) return "";
  const x = node.x + CHIP_PAD;
  const y = node.y + (node.h - CHIP_SIZE) / 2;
  const inset = (CHIP_SIZE - GLYPH_SIZE) / 2;
  const box: Box = { x, y, w: CHIP_SIZE, h: CHIP_SIZE };
  return `${rect(box, "t-chip", CHIP_RADIUS)}<svg class="t-icon t-icon-${escapeXml(node.kind)}" x="${num(x + inset)}" y="${num(y + inset)}" width="${GLYPH_SIZE}" height="${GLYPH_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
}

function legend(items: SceneLegendItem[]): string {
  const entries = items.map((item) => {
    const s = item.swatch;
    const mid = s.y + s.h / 2;
    const mark = item.glyph
      ? glyph(item.glyph, s)
      : item.family
        ? rect(s, "t-legend-swatch", LEGEND_SWATCH_RADIUS)
        : `<line class="t-legend-line t-legend-${item.style}" x1="${num(s.x)}" y1="${num(mid)}" x2="${num(s.x + s.w)}" y2="${num(mid)}"/>`;
    const cls = item.family
      ? `t-legend-item t-fam-${item.family}${item.glyph ? " t-tint" : ""}`
      : "t-legend-item";
    return `<g class="${cls}">${mark}${text(item.label, "t-legend-label")}</g>`;
  });
  return `<g class="t-legend">${entries.join("")}</g>`;
}

function lanes(groups: SceneGroup[]): string[] {
  let i = 0;
  return groups
    .filter((g) => g.variant === "lane")
    .map((g) =>
      laneMarkup(
        { ...g, id: escapeXml(g.id) },
        i++ % 2 === 1,
        text(g.label, "t-lane-title") + (g.note ? text(g.note, "t-lane-note") : ""),
      ),
    );
}

function tableBody(n: SceneNode): string {
  const head = n.header ?? 0;
  const r = TABLE_RADIUS;
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

function node(n: SceneNode, family: Family | undefined): string {
  const tip = [n.note, n.source].filter((s): s is string => s !== undefined && s !== "").join("\n");
  const desc = tip ? `<desc>${escapeXml(tip)}</desc>` : "";
  const tint = family !== undefined && (TINTED_SHAPES.includes(n.shape) || !hasChip(n));
  const cls = [
    "t-node",
    family && `t-fam-${family}`,
    n.shape !== "box" && `t-shape-${n.shape}`,
    tint && "t-tint",
    n.mark === "derived" && "t-derived",
  ];
  return `<g class="${cls.filter(Boolean).join(" ")}" data-id="${escapeXml(n.id)}" data-kind="${escapeXml(n.kind)}"${n.source ? ` data-source="${escapeXml(n.source)}"` : ""} tabindex="0">${desc}${shapeMarkup(n.shape, n)}${n.shape === "table" ? tableBody(n) : chip(n)}${text(n.label, "t-node-label")}${n.mark === "key" || n.mark === "partial" ? underline(n.mark, n.label.x, n.label.y, n.label.lines[0]!, n.label.size, n.label.weight) : ""}${n.subtitle ? text(n.subtitle, "t-node-note") : ""}</g>`;
}

function short(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

const OVERVIEW_FAMILIES = ["compute", "data", "messaging", "client", "external"] as const;
const CHAR = 5.4;

/** The summary panel below an ERD: header button, tiles, key relations and the table index. */
function overview(scene: Scene): string {
  const o = scene.overview;
  if (!o) return "";
  const m = overviewMetrics(o.relations.length, o.tables.length);
  const x = 16;
  const w = scene.width - x * 2;
  const top = o.top;
  const px = x + 12;
  const groups = [...new Set(o.tables.flatMap((t) => (t.group ? [t.group] : [])))];
  const grouped = groups.length > 0;
  const family = (group: string) => OVERVIEW_FAMILIES[groups.indexOf(group) % 5]!;
  const cols = o.tables.reduce((sum, t) => sum + t.columns, 0);
  const label = (
    cls: string,
    lx: number,
    y: number,
    size: number,
    weight: number,
    body: string,
    extra = "",
  ) =>
    `<text class="t-text ${cls}" x="${num(lx)}" y="${num(y)}" font-size="${size}" font-weight="${weight}"${extra}>${body}</text>`;

  const tileW = (w - 24 - 4 * 8) / 5;
  const tiles = [
    [o.tables.length, "tables"],
    [cols, "columns"],
    [o.relations.length, "relations"],
    [`${o.stats.pk} · ${o.stats.fk}`, "PK · FK"],
    [`${o.stats.optional} · ${o.stats.self}`, "optional · self"],
  ]
    .map(([value, name], i) => {
      const tx = px + i * (tileW + 8);
      const ty = top + 32;
      return `<rect class="t-overview-tile" x="${num(tx)}" y="${num(ty)}" width="${num(tileW)}" height="34" rx="9"/>${label("t-overview-value", tx + 10, ty + 15, 14, 600, String(value))}${label("t-overview-muted", tx + 10, ty + 28, 10, 400, String(name))}`;
    })
    .join("");

  const shown = o.relations.slice(0, MAX_RELATIONS);
  const more = o.relations.length - shown.length;
  const colX = [px + 4, px + 4 + (w - 24) / 2];
  const rels =
    o.relations.length === 0
      ? label("t-overview-muted", colX[0]!, top + m.relRow0, 10.5, 400, "No relations")
      : shown
          .map((r, i) => {
            const note = r.self
              ? r.optional
                ? " (self, optional)"
                : " (self)"
              : r.optional
                ? " (optional)"
                : "";
            const body = `<tspan font-weight="600">${escapeXml(short(r.parent, 18))}</tspan> <tspan class="t-overview-muted">${r.cardinality}</tspan> <tspan font-weight="600">${escapeXml(short(r.child, 18))}</tspan><tspan class="t-overview-muted"> · ${escapeXml(short(r.column, 20))}${note}</tspan>`;
            return label(
              "t-overview-cell",
              colX[i % 2]!,
              top + m.relRow0 + Math.floor(i / 2) * m.relStep,
              10.5,
              400,
              body,
            );
          })
          .join("");
  const moreNote =
    more > 0
      ? label(
          "t-overview-muted",
          x + w - 14,
          top + 82,
          10,
          400,
          `+${more} more`,
          ' text-anchor="end"',
        )
      : "";

  // Column offsets from the panel's inner left edge; the description takes the rest of the width.
  const at = grouped
    ? { table: 16, group: 128, cols: 268, ref: 282, desc: 420 }
    : { table: 16, cols: 170, ref: 184, desc: 330 };
  const descX = px + at.desc;
  const refChars = Math.floor((at.desc - at.ref - 10) / CHAR);
  const descChars = Math.max(8, Math.floor((x + w - 12 - descX) / CHAR));
  const heads = [
    ["Table", at.table, ""],
    ...(grouped ? [["Group", (at as { group: number }).group, ""]] : []),
    ["Columns", at.cols, ' text-anchor="end"'],
    ["Referenced by", at.ref, ""],
    ["Description", at.desc, ""],
  ] as [string, number, string][];
  const head = heads
    .map(([name, off, extra]) =>
      label("t-overview-heading", px + off, top + m.colHead, 10, 600, name, extra),
    )
    .join("");
  const rows = o.tables
    .map((t, i) => {
      const y = top + m.rowTop + i * INDEX_ROW;
      const base = y + 12;
      const band =
        i % 2 === 1
          ? `<rect class="t-overview-row" x="${px - 2}" y="${num(y)}" width="${num(w - 20)}" height="${INDEX_ROW}" rx="5"/>`
          : "";
      const dot = t.group
        ? `<g class="t-overview-chip t-fam-${family(t.group)}"><circle cx="${px + 7}" cy="${num(y + 9)}" r="3.6"/></g>`
        : "";
      const nameChars = grouped ? 14 : 22;
      const parts = [
        label(
          "t-overview-cell",
          px + at.table,
          base,
          11,
          600,
          escapeXml(short(t.label, nameChars)),
        ),
        t.group
          ? label(
              "t-overview-muted",
              px + (at as { group: number }).group,
              base,
              10.5,
              400,
              escapeXml(short(t.group, 16)),
            )
          : "",
        label(
          "t-overview-cell",
          px + at.cols,
          base,
          11,
          400,
          String(t.columns),
          ' text-anchor="end"',
        ),
        label(
          "t-overview-muted t-overview-ref",
          px + at.ref,
          base,
          10.5,
          400,
          escapeXml(t.referencedBy.length ? short(t.referencedBy.join(", "), refChars) : "—"),
        ),
        label(
          "t-overview-muted",
          descX,
          base,
          10.5,
          400,
          escapeXml(short(t.note ?? "—", descChars)),
        ),
      ];
      return `${band}${dot}${parts.join("")}`;
    })
    .join("");

  const heading = (name: string, hy: number) =>
    label("t-overview-heading", px + 4, hy, 10, 600, name);
  return `<g class="t-overview" data-overview-expanded-height="${num(scene.height)}" data-overview-collapsed-height="${num(o.collapsedHeight)}" data-overview-panel-expanded="${num(o.panelHeight)}" data-overview-panel-collapsed="${num(o.collapsedPanelHeight)}"><rect class="t-overview-panel" x="${x}" y="${num(top)}" width="${num(w)}" height="${num(o.panelHeight)}" rx="12"/><g class="t-overview-control" role="button" tabindex="0" aria-expanded="true"><rect class="t-overview-hit" x="${x + 4}" y="${num(top + 3)}" width="${num(w - 8)}" height="24" rx="8"/>${label("t-overview-title", x + 32, top + 19, 11, 600, "Overview")}${label("t-overview-muted", x + 100, top + 19, 10.5, 400, `${o.tables.length} tables · ${cols} columns · ${o.relations.length} relations`)}<path class="t-overview-chevron" data-viewer-only="true" d="M${x + 12} ${num(top + 11)}l5 5 5-5"/></g><g class="t-overview-body">${tiles}${heading("KEY RELATIONS", top + 82)}${moreNote}${rels}${heading("TABLE INDEX", top + m.indexHead)}${head}<line class="t-overview-line" x1="${px}" y1="${num(top + m.line)}" x2="${x + w - 12}" y2="${num(top + m.line)}"/>${rows}</g></g>`;
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
  const heads = STYLES.flatMap((style) => {
    const own = scene.edges.filter((e) => !e.ends && !e.chen && e.style === style);
    const filled = own.some((e) => !isOpen(e))
      ? `<marker id="${markerId(style, false)}" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path class="${arrowClass(style)}" d="M1.8 1.8L8.4 5L1.8 8.2z"/></marker>`
      : "";
    const open = own.some(isOpen)
      ? `<marker id="${markerId(style, true)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto"><path class="t-arrow-open t-arrow-open-${style}" d="M1 1L9 5L1 9"/></marker>`
      : "";
    return [filled, open];
  });
  const families = scene.nodes.map((n) => familyOf(scene, n));
  const shadowed = scene.nodes.some((n) => SHADOWED.includes(n.shape));
  const overviewGroups = [
    ...new Set(scene.overview?.tables.flatMap((t) => (t.group ? [t.group] : [])) ?? []),
  ];
  const overviewFamilies = overviewGroups.map(
    (_, i) => ["compute", "data", "messaging", "client", "external"][i % 5] as Family,
  );
  const css =
    (needsShapeCss(scene) ? SVG_CSS + SHAPE_CSS : SVG_CSS) +
    (shadowed ? SHADOW_CSS : "") +
    familyCss([
      ...families.filter((f): f is Family => f !== undefined),
      ...(scene.legend ?? []).flatMap((i) => (i.family ? [i.family as Family] : [])),
      ...overviewFamilies,
    ]) +
    (scene.overview ? OVERVIEW_CSS : "") +
    (scene.legend ? LEGEND_CSS : "") +
    (scene.groups.some((g) => g.note) ? LANE_NOTE_CSS : "") +
    (scene.type === "chen" ? CHEN_CSS : "") +
    (needsTableCss(scene) ? TABLE_CSS : "") +
    (scene.nodes.some((n) => n.shape === "table" && n.family) ? GROUPED_TABLE_CSS : "") +
    (scene.nodes.some((n) => n.subtitle) ? NOTE_CSS : "") +
    (seq ? SEQUENCE_CSS : "");
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" class="${seq ? "diagram t-seq" : scene.type === "chen" ? "diagram t-chen" : "diagram"}" viewBox="0 0 ${num(scene.width)} ${num(scene.height)}" role="img" aria-labelledby="${labelled}">`,
    `<title id="t-title">${escapeXml(scene.title)}</title>`,
    desc,
    `<defs>${heads.join("")}${ends ? endMarkers() : ""}${shadowed ? shadowFilter() : ""}</defs>`,
    `<style>${css}</style>`,
    ...(scene.lifelines ?? []).map(lifeline),
    ...lanes(scene.groups),
    ...scene.groups.map(group),
    ...scene.groups.map(fragment),
    ...scene.edges.map((e) => (e.chen ? chenEdge(e) : edge(e, seq))),
    ...scene.edges.map((e) => (e.chen ? chenCard(e) : edgeLabel(e))),
    ...scene.nodes.map((n, i) => node(n, families[i])),
    ...(scene.legend ? [legend(scene.legend)] : []),
    overview(scene),
    "</svg>",
  ];
  return parts.filter(Boolean).join("\n");
}
