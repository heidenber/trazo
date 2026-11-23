// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { FONT_FAMILY } from "../text/measure.js";
import type { ThemeName } from "../model/common.js";
import { FAMILIES, type Family } from "./families.js";
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
      return `.t-fam-${f} .t-node-box { fill: var(--t-fam-${f}-fill, ${fill}); stroke: var(--t-fam-${f}-stroke, ${stroke}); }${ring}
.t-fam-${f} .t-node-rule { stroke: var(--t-fam-${f}-stroke, ${stroke}); }
.t-fam-${f} .t-icon { color: var(--t-fam-${f}-stroke, ${stroke}); }
`;
    })
    .join("");
}

/** Rules for the diagram itself. Fallbacks keep a standalone SVG readable. */
export const SVG_CSS = `
.t-text { ${TEXT_RESET} fill: var(--t-text, #1f2933); }
.t-group-title { fill: var(--t-muted, #52606d); }
.t-group-box { fill: var(--t-group-fill, #f5f7fa); stroke: var(--t-group-stroke, #cbd2d9); stroke-width: 1; }
.t-node-box { fill: var(--t-node-fill, #ffffff); stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1.25; }
.t-node:focus { outline: none; }
.t-node:focus-visible .t-node-box { stroke: var(--t-accent, #2f6fdb); stroke-width: 2.5; }
.t-icon { color: var(--t-icon, #52606d); }
.t-edge { fill: none; stroke: var(--t-edge, #2f6fdb); stroke-width: 1.5; stroke-linejoin: round; }
.t-edge-async { stroke: var(--t-edge-async, ${EDGE_LIGHT.async}); }
.t-edge-data { stroke: var(--t-edge-data, ${EDGE_LIGHT.data}); }
.t-edge-reply { stroke: var(--t-edge-reply, ${EDGE_LIGHT.reply}); }
.t-edge-async { stroke-dasharray: 7 5; }
.t-edge-data { stroke-dasharray: 1.5 4.5; stroke-linecap: round; }
.t-arrow { fill: var(--t-edge, #2f6fdb); }
.t-arrow-async { fill: var(--t-edge-async, ${EDGE_LIGHT.async}); }
.t-arrow-data { fill: var(--t-edge-data, ${EDGE_LIGHT.data}); }
.t-arrow-reply { fill: var(--t-edge-reply, ${EDGE_LIGHT.reply}); }
.t-label-bg { fill: var(--t-bg, #ffffff); stroke: none; }
.t-label { fill: var(--t-muted, #52606d); }
`;

/** Appended only when a scene uses non-box shapes or lanes, so architecture output stays unchanged. */
export const SHAPE_CSS = `
.t-node-inner { fill: none; }
.t-node-rule { stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1.25; }
.t-lane-band { fill: var(--t-lane-fill, transparent); stroke: none; }
.t-lane-odd .t-lane-band { fill: var(--t-lane-fill-odd, rgba(120, 130, 145, 0.08)); }
.t-lane-header { fill: var(--t-lane-header, rgba(120, 130, 145, 0.12)); stroke: none; }
.t-lane-rule { stroke: var(--t-group-stroke, #cbd2d9); stroke-width: 1; }
.t-lane-title { fill: var(--t-muted, #52606d); }
`;

/** Appended only when a scene has table nodes or edges with crow's foot ends. */
export const TABLE_CSS = `
.t-table { fill: var(--t-node-fill, #ffffff); stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1.25; }
.t-table-head { fill: var(--t-table-head, #eceff3); stroke: none; }
.t-row { stroke: var(--t-group-stroke, #cbd2d9); stroke-width: 1; }
.t-col-type { fill: var(--t-muted, #52606d); }
.t-col-marks { fill: var(--t-muted, #52606d); }
.t-edge-halo { fill: none; stroke: var(--t-bg, #ffffff); stroke-width: 5; stroke-linejoin: round; }
.t-end { fill: none; stroke: var(--t-edge, #2f6fdb); stroke-width: 1.5; stroke-linecap: round; }
.t-end-dot { fill: var(--t-bg, #ffffff); }
`;

/**
 * Appended only when a node shows its note, so diagrams without notes stay byte-identical.
 * Text at 75% keeps at least 5.8:1 on every family tint in both themes; --t-muted falls under 4.5:1 in dark.
 */
export const NOTE_CSS = `
.t-node-note { fill: var(--t-text, #1f2933); fill-opacity: 0.75; }
`;

/** Appended only to scenes with a legend. */
export const LEGEND_CSS = `
.t-legend-label { fill: var(--t-muted, #52606d); }
.t-legend-line { fill: none; stroke: var(--t-edge, #2f6fdb); stroke-width: 1.5; stroke-linecap: round; }
.t-legend-async { stroke: var(--t-edge-async, ${EDGE_LIGHT.async}); }
.t-legend-data { stroke: var(--t-edge-data, ${EDGE_LIGHT.data}); }
.t-legend-reply { stroke: var(--t-edge-reply, ${EDGE_LIGHT.reply}); }
.t-legend-async { stroke-dasharray: 7 5; }
.t-legend-data { stroke-dasharray: 1.5 4.5; }
.t-legend-reply { stroke-dasharray: 5 4; }
`;

/** Appended only to scenes with lifelines (sequence). */
export const SEQUENCE_CSS = `
.t-lifeline { stroke: var(--t-group-stroke, #cbd2d9); stroke-width: 1; stroke-dasharray: 4 4; }
.t-frag { fill: none; stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1; }
.t-frag-tab { fill: var(--t-bg, #ffffff); stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1; }
.t-frag-divider { stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1; stroke-dasharray: 5 4; }
.t-frag-tag { fill: var(--t-text, #1f2933); }
.t-frag-guard { fill: var(--t-muted, #52606d); }
.t-note { fill: var(--t-note-fill, var(--t-group-fill, #f5f7fa)); }
.t-note-fold { fill: none; stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1.25; stroke-linejoin: round; }
.t-edge-reply { stroke-dasharray: 5 4; }
.t-seq .t-edge-async { stroke-dasharray: none; }
.t-arrow-open { fill: none; stroke: var(--t-edge, #2f6fdb); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
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
const DARK_NAMES = THEME_NAMES.filter((n) => PALETTES[n].mode === "dark");
const themeRules = THEME_NAMES.map(
  (name) =>
    `${name === "light" ? ':root, [data-theme="light"]' : `[data-theme="${name}"]`} { ${themeBlock(PALETTES[name])} }`,
).join("\n");
const darkAttrs = DARK_NAMES.map((n) => `[data-theme="${n}"]`);

export function pageCss(font400: string, font600: string): string {
  return `
/* Inter is embedded under the SIL Open Font License 1.1, Copyright 2016 The Inter Project Authors. */
@font-face { font-family: "${FONT_FAMILY}"; font-weight: 400; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${font400}) format("woff2"); }
@font-face { font-family: "${FONT_FAMILY}"; font-weight: 600; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${font600}) format("woff2"); }
${themeRules}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { ${TEXT_RESET} background: var(--t-bg); color: var(--t-text); height: 100vh; display: flex; flex-direction: column; }
header { display: flex; align-items: flex-start; gap: 16px; padding: 16px 24px 12px; border-bottom: 1px solid var(--t-border); background: var(--t-surface); }
.heading { flex: 1; min-width: 0; }
h1 { margin: 0; font-size: 18px; font-weight: 600; line-height: 1.3; }
.desc { margin: 4px 0 0; font-size: 13px; line-height: 1.4; color: var(--t-muted); max-width: 80ch; }
.actions { display: flex; gap: 12px; }
.group { display: flex; gap: 8px; }
button { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; border: 1px solid var(--t-border); border-radius: 8px; background: var(--t-surface); color: var(--t-muted); cursor: pointer; }
button:hover { color: var(--t-text); border-color: var(--t-muted); }
button:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
button svg { width: 18px; height: 18px; }
${darkAttrs.map((a) => `${a} .i-moon`).join(", ")}, :root:not(${darkAttrs.join(", ")}) .i-sun { display: none; }
.is-fullscreen .i-maximize, :root:not(.is-fullscreen) .i-minimize { display: none; }
main { flex: 1; min-height: 0; overflow: hidden; padding: 16px 24px 8px; }
.credit { padding: 0 24px 10px; text-align: right; font-size: 11px; line-height: 1.4; }
.credit a { color: var(--t-muted); text-decoration: none; }
.credit a:hover { color: var(--t-text); text-decoration: underline; }
.credit a:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; border-radius: 2px; }
.stage { height: 100%; touch-action: none; cursor: grab; border-radius: 8px; }
.stage.is-grabbing { cursor: grabbing; }
.stage:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
.stage svg.diagram { display: block; width: 100%; height: 100%; }
.diagram :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline) { transition: opacity 120ms; }
.t-dim :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline):not(.t-near) { opacity: 0.25; }
.tip { position: fixed; z-index: 10; max-width: 320px; padding: 6px 10px; border: 1px solid var(--t-border); border-radius: 6px; background: var(--t-surface); color: var(--t-text); font-size: 12px; line-height: 1.4; white-space: pre-line; pointer-events: none; visibility: hidden; }
.tip.on { visibility: visible; }
`;
}
