// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { FONT_FAMILY } from "../text/measure.js";
import type { ThemeName } from "../model/common.js";
import { FAMILIES, type Family } from "./families.js";
import { CHROME_CSS } from "./chrome-css.js";
import { PALETTES, type Palette } from "./palettes.js";

// Kerning and ligatures are off because the layout measures glyph advances
// one by one; any shaping would make rendered text drift from those widths.
const TEXT_RESET = `font-family: "${FONT_FAMILY}", system-ui, -apple-system, "Segoe UI", sans-serif; font-kerning: none; font-variant-ligatures: none; font-feature-settings: "kern" 0, "liga" 0, "calt" 0;`;

/** Fallback colors in the CSS rules below: the light theme, so a standalone SVG stays readable. */
const FALLBACK = PALETTES.light;
const EDGE_LIGHT = FALLBACK.edge;

const themeBlock = (p: Palette): string =>
  [
    `color-scheme: ${p.mode};`,
    ...Object.entries(p.base).map(([name, value]) => `--t-${name}: ${value};`),
    `--t-edge: ${p.edge.sync}; --t-edge-async: ${p.edge.async}; --t-edge-data: ${p.edge.data}; --t-edge-reply: ${p.edge.reply};`,
    ...FAMILIES.map(
      (f) => `--t-fam-${f}-stroke: ${p.fam[f][0]}; --t-fam-${f}-fill: ${p.fam[f][1]};`,
    ),
  ].join("\n  ");

/** Appended for the families a scene actually uses. */
export function familyCss(used: Iterable<Family>): string {
  const set = new Set(used);
  return FAMILIES.filter((f) => set.has(f))
    .map((f) => {
      const [stroke, fill] = FALLBACK.fam[f];
      // The end shape keeps its inner ring unfilled so only the outer band is tinted.
      const ring = f === "end" ? "\n.t-fam-end .t-node-inner { fill: none; }" : "";
      // A wait card keeps the card surface and draws its outline dashed in the family color.
      const wait =
        f === "wait"
          ? `\n.t-fam-wait .t-node-box { stroke: var(--t-f-stroke, ${stroke}); stroke-width: 1.4; stroke-dasharray: 5 4; }`
          : "";
      return `.t-fam-${f} { --t-f-fill: var(--t-fam-${f}-fill, ${fill}); --t-f-stroke: var(--t-fam-${f}-stroke, ${stroke}); }${ring}${wait}
`;
    })
    .join("");
}

const B = FALLBACK.base;

/**
 * Rules for the diagram itself. Every variable carries its light value as a fallback, so a
 * standalone SVG stays readable. A family sets --t-f-fill and --t-f-stroke (see familyCss).
 */
export const SVG_CSS = `
.t-text { ${TEXT_RESET} fill: var(--t-text, ${B.text}); }
.t-group-title { fill: var(--t-muted, ${B.muted}); }
.t-group-box { fill: var(--t-group-fill, ${B["group-fill"]}); stroke: var(--t-group-stroke, ${B["group-stroke"]}); stroke-width: 1; }
.t-node-box { fill: var(--t-card, ${B.card}); stroke: var(--t-card-stroke, ${B["card-stroke"]}); stroke-width: 1; stroke-linejoin: round; }
.t-tint .t-node-box { fill: var(--t-f-fill, ${B.card}); stroke: var(--t-f-stroke, ${B["node-stroke"]}); stroke-width: 1.5; }
.t-tint .t-node-rule { stroke: var(--t-f-stroke, ${B["node-stroke"]}); }
.t-chip { fill: var(--t-f-fill, ${B["group-fill"]}); stroke: var(--t-f-stroke, ${B["node-stroke"]}); stroke-opacity: 0.35; stroke-width: 1; }
.t-node:focus { outline: none; }
.t-node:focus-visible .t-node-box { stroke: var(--t-accent, ${B.accent}); stroke-width: 2.5; }
.t-icon { color: var(--t-f-stroke, var(--t-icon, ${B.icon})); }
.t-edge { fill: none; stroke: var(--t-edge, ${EDGE_LIGHT.sync}); stroke-width: 1.7; stroke-linejoin: round; stroke-linecap: round; }
.t-edge-async { stroke: var(--t-edge-async, ${EDGE_LIGHT.async}); }
.t-edge-data { stroke: var(--t-edge-data, ${EDGE_LIGHT.data}); }
.t-edge-reply { stroke: var(--t-edge-reply, ${EDGE_LIGHT.reply}); }
.t-edge-async { stroke-dasharray: 6 5; }
.t-edge-data { stroke-dasharray: 0.1 5.2; stroke-width: 2.4; }
.t-arrow { fill: var(--t-edge, ${EDGE_LIGHT.sync}); stroke: var(--t-edge, ${EDGE_LIGHT.sync}); stroke-width: 1.4; stroke-linejoin: round; }
.t-arrow-async { fill: var(--t-edge-async, ${EDGE_LIGHT.async}); stroke: var(--t-edge-async, ${EDGE_LIGHT.async}); }
.t-arrow-data { fill: var(--t-edge-data, ${EDGE_LIGHT.data}); stroke: var(--t-edge-data, ${EDGE_LIGHT.data}); }
.t-arrow-reply { fill: var(--t-edge-reply, ${EDGE_LIGHT.reply}); stroke: var(--t-edge-reply, ${EDGE_LIGHT.reply}); }
.t-label-bg { fill: var(--t-label-bg, ${B["label-bg"]}); stroke: var(--t-border, ${B.border}); stroke-width: 1; }
.t-label { fill: var(--t-muted, ${B.muted}); }
`;

/** Appended only when a shape uses the soft shadow, so the filter is defined once and only then. */
export const SHADOW_CSS = `
.t-shadow-near { flood-color: var(--t-shadow, ${B.shadow}); flood-opacity: 0.35; }
.t-shadow-far { flood-color: var(--t-shadow, ${B.shadow}); flood-opacity: 0.5; }
`;

/** Appended only when a scene uses non-box shapes or lanes, so architecture output stays unchanged. */
export const SHAPE_CSS = `
.t-node-inner { fill: none; }
.t-node-rule { stroke: var(--t-node-stroke, ${B["node-stroke"]}); stroke-width: 1.25; }
.t-lane-band { fill: var(--t-lane-fill, transparent); stroke: none; }
.t-lane-odd .t-lane-band { fill: var(--t-lane-fill-odd, ${B["lane-fill-odd"]}); }
.t-lane-header { fill: var(--t-lane-header, ${B["lane-header"]}); stroke: none; }
.t-lane-rule { stroke: var(--t-group-stroke, ${B["group-stroke"]}); stroke-width: 1; }
.t-lane-title { fill: var(--t-muted, ${B.muted}); }
`;

/** Appended only when a lane has a role line, so other diagrams keep their CSS byte for byte. */
export const LANE_NOTE_CSS = `.t-lane-note { fill: var(--t-muted, ${B.muted}); }
`;

/** Appended only when a scene has table nodes or edges with crow's foot ends. */
export const TABLE_CSS = `
.t-table { fill: var(--t-card, ${B.card}); stroke: var(--t-card-stroke, ${B["card-stroke"]}); stroke-width: 1; }
.t-table-head { fill: var(--t-table-head, ${B["table-head"]}); stroke: none; }
.t-row { stroke: var(--t-group-stroke, ${B["group-stroke"]}); stroke-width: 1; }
.t-col-type { fill: var(--t-muted, ${B.muted}); }
.t-col-marks { fill: var(--t-muted, ${B.muted}); }
.t-edge-halo { fill: none; stroke: var(--t-bg, ${B.bg}); stroke-width: 5; stroke-linejoin: round; }
.t-end { fill: none; stroke: var(--t-edge, ${EDGE_LIGHT.sync}); stroke-width: 1.5; stroke-linecap: round; }
.t-end-dot { fill: var(--t-bg, ${B.bg}); }
`;

/** Appended only when an ERD table has a group-family tint. */
export const GROUPED_TABLE_CSS = `.t-tint .t-table-head { fill: var(--t-f-fill, ${B["table-head"]}); }
`;

/**
 * Appended only when a node shows its note, so diagrams without notes stay byte-identical.
 * The muted color is checked at 4.5:1 on every card, tint and table header in every theme.
 */
export const NOTE_CSS = `
.t-node-note { fill: var(--t-muted, ${B.muted}); }
`;

/** Appended only to ERDs with an overview panel. The hit rect needs its own fill rule: an SVG rect defaults to black. */
export const OVERVIEW_CSS = `
.t-overview-panel { fill: var(--t-group-fill, ${B["group-fill"]}); fill-opacity: 0.62; stroke: var(--t-group-stroke, ${B["group-stroke"]}); stroke-width: 1; }
.t-overview-tile { fill: var(--t-bg, ${B.bg}); stroke: var(--t-border, ${B.border}); stroke-width: 1; }
.t-overview-row { fill: var(--t-bg, ${B.bg}); fill-opacity: 0.7; stroke: none; }
.t-overview-title, .t-overview-value, .t-overview-cell { fill: var(--t-text, ${B.text}); }
.t-overview-muted, .t-overview-heading { fill: var(--t-muted, ${B.muted}); }
.t-overview-heading { letter-spacing: 0.04em; }
.t-overview-line { stroke: var(--t-group-stroke, ${B["group-stroke"]}); stroke-width: 1; }
.t-overview-chip { fill: var(--t-f-stroke, ${B["node-stroke"]}); stroke: none; }
.t-overview-chevron { fill: none; stroke: var(--t-muted, ${B.muted}); stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.t-overview-body[hidden] { display: none; }
.t-overview-hit { fill: var(--t-bg, ${B.bg}); fill-opacity: 0; stroke: none; }
.t-overview-control { cursor: pointer; outline: none; }
.t-overview-control:hover .t-overview-hit { fill-opacity: 0.6; }
.t-overview-control:focus-visible .t-overview-hit { fill-opacity: 0.6; stroke: var(--t-accent, ${B.accent}); stroke-width: 2; }
.t-overview-control[aria-expanded="false"] .t-overview-chevron { transform: rotate(-90deg); transform-box: fill-box; transform-origin: center; }
`;

/**
 * Appended only to Chen diagrams. Every color is a theme variable with its light fallback;
 * links have butt ends because the layout placed them exactly on the outlines.
 */
export const CHEN_CSS = `
.t-chen .t-node-box { stroke-width: 1.8; }
.t-chen .t-node-inner { fill: none; }
.t-chen .t-shape-attribute .t-node-box, .t-chen .t-shape-multivalued .t-node-box { stroke-width: 1.5; }
.t-chen .t-shape-relationship .t-node-box, .t-chen .t-shape-identifying .t-node-box { stroke-linejoin: miter; }
.t-derived .t-node-box { stroke-dasharray: 5.5 3.5; }
.t-chen-link, .t-chen-attr { fill: none; stroke-linecap: butt; stroke-linejoin: miter; }
.t-chen-link { stroke: var(--t-text, ${B.text}); stroke-width: 1.7; }
.t-chen-attr { stroke: var(--t-muted, ${B.muted}); stroke-width: 1.25; }
.t-chen-underline { stroke: var(--t-text, ${B.text}); stroke-width: 1.5; stroke-linecap: butt; }
.t-u-partial { stroke-dasharray: 3.5 2.5; }
.t-chen-card { fill: var(--t-text, ${B.text}); paint-order: stroke; stroke: var(--t-bg, ${B.bg}); stroke-width: 4px; stroke-linejoin: round; }
`;

/** Appended only to scenes with a legend. */
export const LEGEND_CSS = `
.t-legend-label { fill: var(--t-muted, ${B.muted}); }
.t-legend-item .t-legend-swatch { fill: var(--t-f-fill, ${B["group-fill"]}); stroke: var(--t-f-stroke, ${B["node-stroke"]}); stroke-width: 1.25; }
.t-legend-line { fill: none; stroke: var(--t-edge, ${EDGE_LIGHT.sync}); stroke-width: 1.7; stroke-linecap: round; }
.t-legend-async { stroke: var(--t-edge-async, ${EDGE_LIGHT.async}); }
.t-legend-data { stroke: var(--t-edge-data, ${EDGE_LIGHT.data}); }
.t-legend-reply { stroke: var(--t-edge-reply, ${EDGE_LIGHT.reply}); }
.t-legend-async { stroke-dasharray: 6 5; }
.t-legend-data { stroke-dasharray: 0.1 5.2; stroke-width: 2.4; }
.t-legend-reply { stroke-dasharray: 5 4; }
`;

/** Appended only to scenes with lifelines (sequence). */
export const SEQUENCE_CSS = `
.t-lifeline { stroke: var(--t-node-stroke, ${B["node-stroke"]}); stroke-opacity: 0.55; stroke-width: 1; stroke-dasharray: 4 4; }
.t-frag { fill: none; stroke: var(--t-node-stroke, ${B["node-stroke"]}); stroke-width: 1; }
.t-frag-tab { fill: var(--t-group-fill, ${B["group-fill"]}); stroke: var(--t-node-stroke, ${B["node-stroke"]}); stroke-width: 1; stroke-linejoin: round; }
.t-frag-divider { stroke: var(--t-node-stroke, ${B["node-stroke"]}); stroke-width: 1; stroke-dasharray: 5 4; }
.t-frag-tag { fill: var(--t-text, ${B.text}); }
.t-frag-guard { fill: var(--t-muted, ${B.muted}); }
.t-note { fill: var(--t-note-fill, ${B["note-fill"]}); }
.t-note-fold { fill: none; stroke: var(--t-node-stroke, ${B["node-stroke"]}); stroke-width: 1.25; stroke-linejoin: round; }
.t-edge-reply { stroke-dasharray: 5 4; }
.t-seq .t-edge-async { stroke-dasharray: none; }
.t-arrow-open { fill: none; stroke: var(--t-edge, ${EDGE_LIGHT.sync}); stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.t-seq .t-legend-async { stroke-dasharray: none; }
.t-arrow-open-async { stroke: var(--t-edge-async, ${EDGE_LIGHT.async}); }
.t-arrow-open-reply { stroke: var(--t-edge-reply, ${EDGE_LIGHT.reply}); }
`;

const LIGHT = themeBlock(PALETTES.light);

/** Theme custom properties that an exported SVG needs to look the same outside the page. */
export const THEME_VARS: readonly string[] = [...LIGHT.matchAll(/--t-[a-z-]+(?=:)/g)].map(
  (m) => m[0],
);

const THEME_NAMES = Object.keys(PALETTES) as ThemeName[];
const themeRules = THEME_NAMES.map(
  (name) =>
    `${name === "light" ? ':root, [data-theme="light"]' : `[data-theme="${name}"]`} { ${themeBlock(PALETTES[name])} }`,
).join("\n");

export function pageCss(font400: string, font600: string): string {
  return `
/* Inter is embedded under the SIL Open Font License 1.1, Copyright 2016 The Inter Project Authors. */
@font-face { font-family: "${FONT_FAMILY}"; font-weight: 400; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${font400}) format("woff2"); }
@font-face { font-family: "${FONT_FAMILY}"; font-weight: 600; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${font600}) format("woff2"); }
${themeRules}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { ${TEXT_RESET} background: var(--t-bg); color: var(--t-text); height: 100vh; height: 100dvh; display: flex; flex-direction: column; }
${CHROME_CSS}
`;
}
