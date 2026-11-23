// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { ThemeName } from "../model/common.js";
import { LOGO_DARK, LOGO_LIGHT } from "./brand.js";
import { PALETTES } from "./palettes.js";
import { escapeXml } from "./svg.js";

/** Largest JSON source, in bytes, that is embedded in the page for "Copy JSON source". */
export const SOURCE_CAP = 64 * 1024;

/** Names shown in the theme menu. `light` and `dark` keep their ids and take the Porcelain and Graphite looks. */
export const THEME_LABELS: Record<ThemeName, string> = {
  light: "Porcelain",
  dark: "Graphite",
  lagoon: "Lagoon",
  dusk: "Dusk",
};

// 20 px grid line icons for the page chrome (the diagram keeps the Lucide set).
const UI: Record<string, string> = {
  minus: '<path d="M4 10h12"/>',
  plus: '<path d="M10 4v12M4 10h12"/>',
  fit: '<path d="M3 7V4a1 1 0 0 1 1-1h3M13 3h3a1 1 0 0 1 1 1v3M17 13v3a1 1 0 0 1-1 1h-3M7 17H4a1 1 0 0 1-1-1v-3"/>',
  full: '<path d="M12 3h5v5M8 17H3v-5M17 3l-5.5 5.5M3 17l5.5-5.5"/>',
  exit: '<path d="M8 3v4a1 1 0 0 1-1 1H3M12 3v4a1 1 0 0 0 1 1h4M17 12h-4a1 1 0 0 0-1 1v4M3 12h4a1 1 0 0 1 1 1v4"/>',
  download: '<path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 15.5h12"/>',
  search: '<circle cx="9" cy="9" r="5.2"/><path d="m13 13 3.8 3.8"/>',
  chev: '<path d="m5 8 5 5 5-5"/>',
  close: '<path d="M5 5l10 10M15 5 5 15"/>',
  image:
    '<rect x="3" y="4" width="14" height="12" rx="2.5"/><path d="m4 14 4-4 3 3 2-2 3 3"/><circle cx="13.5" cy="7.8" r="1"/>',
  vector:
    '<path d="M5 15 15 5"/><rect x="2.5" y="13" width="4" height="4" rx="1"/><rect x="13.5" y="3" width="4" height="4" rx="1"/>',
  print:
    '<path d="M6 7V3.5h8V7M6 14H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2"/><rect x="6" y="11" width="8" height="6" rx="1"/>',
  copy: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M13 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>',
  braces:
    '<path d="M7.5 3.5c-1.8 0-2.5.7-2.5 2.2v1.6c0 1-.6 1.7-2 2.7 1.4 1 2 1.7 2 2.7v1.6c0 1.5.7 2.2 2.5 2.2M12.5 3.5c1.8 0 2.5.7 2.5 2.2v1.6c0 1 .6 1.7 2 2.7-1.4 1-2 1.7-2 2.7v1.6c0 1.5-.7 2.2-2.5 2.2"/>',
};

const icon = (name: string, cls: string, size = 18) =>
  `<svg class="ui ${cls}" viewBox="0 0 20 20" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${UI[name]}</svg>`;

/** Small preview of a theme drawn with its own colors, whatever theme the page shows now. */
function swatch(name: ThemeName): string {
  const p = PALETTES[name];
  const [c, d] = [p.fam.compute, p.fam.data];
  return `<svg viewBox="0 0 120 56" width="60" height="28" aria-hidden="true"><rect width="120" height="56" rx="6" fill="${p.base.bg}"/><path d="M40 28h30" stroke="${p.edge.sync}" stroke-width="2" fill="none"/><path d="M68 24l6 4-6 4z" fill="${p.edge.sync}"/><rect x="12" y="16" width="30" height="24" rx="5" fill="${c[1]}" stroke="${c[0]}" stroke-width="1.5"/><rect x="76" y="16" width="32" height="24" rx="5" fill="${d[1]}" stroke="${d[0]}" stroke-width="1.5"/><rect x="18" y="26" width="18" height="3" rx="1.5" fill="${p.base.text}"/><rect x="82" y="26" width="20" height="3" rx="1.5" fill="${p.base.text}"/><rect x="18" y="32" width="12" height="2.5" rx="1.2" fill="${p.base.muted}"/></svg>`;
}

/** A JSON text that is safe inside a script element: no `<`, `>`, `&` or line separators survive. */
export function inertJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** The JSON to embed, or undefined when there is none or it is above SOURCE_CAP bytes. */
export function embeddedSource(source: unknown): string | undefined {
  if (source === undefined) return undefined;
  const text = JSON.stringify(source);
  if (text === undefined || Buffer.byteLength(text) > SOURCE_CAP) return undefined;
  return inertJson(source);
}

export interface ChromeInput {
  title: string;
  description?: string;
  theme: ThemeName;
  width: number;
  height: number;
  /** Output of embeddedSource. */
  source?: string;
  /** The diagram's svg markup. */
  svg: string;
}

const px = (n: number) => Math.round(n);

function exportItem(key: string, ic: string, name: string, hint: string, extra = ""): string {
  return `<button type="button" role="menuitem" data-export="${key}"${extra}>${icon(ic, "lead")}<span>${name}</span><small>${hint}</small></button>`;
}

function themeMenu(current: ThemeName): string {
  const names = Object.keys(THEME_LABELS) as ThemeName[];
  return names
    .map(
      (id) =>
        `<button type="button" role="menuitemradio" aria-checked="${id === current}" data-set-theme="${id}" data-name="${THEME_LABELS[id]}">${swatch(id)}<span><b>${THEME_LABELS[id]}</b><small>${PALETTES[id].mode}</small></span></button>`,
    )
    .join("\n      ");
}

/** The header and toolbar, the stage with its viewer-only panels, and the two menus. */
export function chromeHtml(c: ChromeInput): string {
  const w1 = px(c.width);
  const h1 = px(c.height);
  const json =
    c.source === undefined
      ? exportItem("copy-json", "braces", "Copy JSON source", "too large to embed", " disabled")
      : exportItem("copy-json", "braces", "Copy JSON source", "the input as JSON");
  const label = THEME_LABELS[c.theme];
  const desc = c.description
    ? `\n    <p class="desc" title="${escapeXml(c.description)}">${escapeXml(c.description)}</p>`
    : "";
  return `<header class="top">
  <div class="brand" role="img" aria-label="trazo">${LOGO_LIGHT}${LOGO_DARK}</div><span class="sep"></span>
  <div class="heading">
    <h1>${escapeXml(c.title)}</h1>${desc}
  </div>
  <div class="tools" role="toolbar" aria-label="Diagram tools">
    <label class="search">${icon("search", "mag", 16)}<input id="search" type="search" placeholder="Find a node" aria-label="Find a node" autocomplete="off" spellcheck="false"><kbd>/</kbd><output id="found" aria-live="polite"></output></label>
    <div class="group seg" role="group" aria-label="Zoom">
      <button type="button" id="zoom-out" aria-label="Zoom out" title="Zoom out (-)">${icon("minus", "")}</button>
      <output id="zoom-pct" aria-label="Zoom level">100%</output>
      <button type="button" id="zoom-in" aria-label="Zoom in" title="Zoom in (+)">${icon("plus", "")}</button>
      <button type="button" id="fit" aria-label="Fit to screen" title="Fit to screen (0)">${icon("fit", "")}</button>
    </div>
    <div class="group" role="group" aria-label="View">
      <button type="button" id="fullscreen" aria-label="Enter full screen" title="Full screen">${icon("full", "i-full")}${icon("exit", "i-exit")}</button>
      <button type="button" id="theme" aria-label="Change theme (current: ${label})" title="Change theme" aria-haspopup="menu" aria-expanded="false" commandfor="theme-menu" command="toggle-popover"><span class="dot" aria-hidden="true"></span><span id="theme-name">${label}</span></button>
    </div>
    <button type="button" id="export" aria-label="Export diagram" aria-haspopup="menu" aria-expanded="false" commandfor="export-menu" command="toggle-popover">${icon("download", "")}<span>Export</span>${icon("chev", "", 14)}</button>
  </div>
</header>
<main>
  <div class="stage" tabindex="0" aria-label="Diagram, use arrow keys to pan and plus or minus to zoom">
${c.svg}
  </div>
  <div class="minimap" id="minimap" aria-hidden="true" hidden><small>Overview</small></div>
  <aside class="detail" id="detail" aria-label="Node details" hidden>
    <header><div><h2 id="d-title"></h2><span class="fam"><i class="sw" id="d-sw"></i><span id="d-kind"></span></span></div><button type="button" id="d-close" aria-label="Close details" hidden>${icon("close", "", 16)}</button></header>
    <p class="note" id="d-note"></p>
    <p class="src" id="d-srcp" hidden><code id="d-src"></code></p>
    <h3>Incoming</h3><ul id="d-in"></ul>
    <h3>Outgoing</h3><ul id="d-out"></ul>
  </aside>
</main>
<div class="pop" id="export-menu" popover="auto" data-w="330">
  <div role="menu" aria-label="Export formats">
    <div role="group" aria-label="Image"><span class="gt">Image</span>
      ${exportItem("png1", "image", "PNG", `${w1} × ${h1} px`)}
      ${exportItem("png2", "image", "PNG @2x", `${w1 * 2} × ${h1 * 2} px`)}
      ${exportItem("png-alpha", "image", "PNG, transparent background", `${w1 * 2} × ${h1 * 2} px`)}
    </div>
    <div role="group" aria-label="Vector and print"><span class="gt">Vector and print</span>
      ${exportItem("svg", "vector", "SVG, self-contained", "vector")}
      ${exportItem("pdf", "print", "PDF through the print dialog", "diagram only")}
    </div>
    <div role="group" aria-label="Copy"><span class="gt">Copy</span>
      ${exportItem("copy-png", "copy", "Copy PNG", "to the clipboard")}
      ${exportItem("copy-svg", "copy", "Copy SVG code", "to the clipboard")}
      ${json}
    </div>
  </div>
  <p class="note-line" id="export-note" role="status"></p>
</div>
<div class="pop" id="theme-menu" popover="auto" data-w="264">
  <div role="menu" aria-label="Theme">
      ${themeMenu(c.theme)}
  </div>
</div>${
    c.source === undefined
      ? ""
      : `\n<script type="application/json" id="trazo-source">${c.source}</script>`
  }`;
}
