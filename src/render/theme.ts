// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { FONT_FAMILY } from "../text/measure.js";

// Kerning and ligatures are off because the layout measures glyph advances
// one by one; any shaping would make rendered text drift from those widths.
const TEXT_RESET = `font-family: "${FONT_FAMILY}", system-ui, -apple-system, "Segoe UI", sans-serif; font-kerning: none; font-variant-ligatures: none; font-feature-settings: "kern" 0, "liga" 0, "calt" 0;`;

/** Rules for the diagram itself. Fallbacks keep a standalone SVG readable. */
export const SVG_CSS = `
.t-text { ${TEXT_RESET} fill: var(--t-text, #1f2933); }
.t-group-title { fill: var(--t-muted, #52606d); }
.t-group-box { fill: var(--t-group-fill, #f5f7fa); stroke: var(--t-group-stroke, #cbd2d9); stroke-width: 1; }
.t-node-box { fill: var(--t-node-fill, #ffffff); stroke: var(--t-node-stroke, #9aa5b1); stroke-width: 1.25; }
.t-node:focus { outline: none; }
.t-node:focus-visible .t-node-box { stroke: var(--t-accent, #2f6fdb); stroke-width: 2.5; }
.t-icon { color: var(--t-icon, #52606d); }
.t-icon-database, .t-icon-storage, .t-icon-cache { color: var(--t-icon-data, #2f6f6f); }
.t-icon-client, .t-icon-user, .t-icon-external { color: var(--t-icon-edge, #8a5a2b); }
.t-edge { fill: none; stroke: var(--t-edge, #2f6fdb); stroke-width: 1.5; stroke-linejoin: round; }
.t-edge-async { stroke-dasharray: 7 5; }
.t-edge-data { stroke-dasharray: 1.5 4.5; stroke-linecap: round; }
.t-arrow { fill: var(--t-edge, #2f6fdb); }
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
`;

const LIGHT = `--t-bg: #f4f5f7; --t-surface: #ffffff; --t-text: #1f2933; --t-muted: #52606d; --t-border: #d8dde3;
  --t-group-fill: #eceff3; --t-group-stroke: #c3cbd4; --t-node-fill: #ffffff; --t-node-stroke: #9aa5b1;
  --t-edge: #2f6fdb; --t-accent: #2f6fdb; --t-icon: #52606d; --t-icon-data: #2b7a6f; --t-icon-edge: #96602b; --t-table-head: #e4e8ee;`;

const DARK = `--t-bg: #14171c; --t-surface: #1b1f26; --t-text: #e6e9ed; --t-muted: #9aa5b1; --t-border: #2c333d;
  --t-group-fill: #1a1e25; --t-group-stroke: #343c48; --t-node-fill: #20252d; --t-node-stroke: #4a5361;
  --t-edge: #6ea2f5; --t-accent: #6ea2f5; --t-icon: #9aa5b1; --t-icon-data: #5fc2b2; --t-icon-edge: #d49a5f; --t-table-head: #2a303a;`;

/** Theme custom properties that an exported SVG needs to look the same outside the page. */
export const THEME_VARS: readonly string[] = [...LIGHT.matchAll(/--t-[a-z-]+(?=:)/g)].map(
  (m) => m[0],
);

export function pageCss(font400: string, font600: string): string {
  return `
/* Inter is embedded under the SIL Open Font License 1.1, Copyright 2016 The Inter Project Authors. */
@font-face { font-family: "${FONT_FAMILY}"; font-weight: 400; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${font400}) format("woff2"); }
@font-face { font-family: "${FONT_FAMILY}"; font-weight: 600; font-style: normal; font-display: swap; src: url(data:font/woff2;base64,${font600}) format("woff2"); }
:root, [data-theme="light"] { ${LIGHT} }
[data-theme="dark"] { ${DARK} }
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
[data-theme="dark"] .i-moon, :root:not([data-theme="dark"]) .i-sun { display: none; }
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
