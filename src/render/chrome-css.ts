// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

/**
 * Rules for the page around the diagram: header, toolbar, menus, minimap, detail card.
 * Colors come from the --t-* theme variables, so every theme restyles the page too.
 * Motion lives only in the no-preference block; the print block keeps only the diagram.
 */
export const CHROME_CSS = `
header.top { position: relative; z-index: 3; display: flex; align-items: center; gap: 20px; padding: 12px 20px 12px 24px; border-bottom: 1px solid var(--t-border); background: var(--t-surface); }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 600; letter-spacing: -0.01em; }
.logo { display: block; flex: none; }
.logo-dark { display: none; }
[data-theme="dark"] .logo-light, [data-theme="dusk"] .logo-light { display: none; }
[data-theme="dark"] .logo-dark, [data-theme="dusk"] .logo-dark { display: block; }
.sep { flex: none; width: 1px; height: 28px; background: var(--t-border); }
.heading { flex: 1; min-width: 0; }
h1 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -0.015em; line-height: 1.25; }
.desc { margin: 2px 0 0; max-width: 80ch; overflow: hidden; font-size: 12.5px; line-height: 1.4; color: var(--t-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
.group { display: flex; align-items: center; gap: 8px; }
:focus-visible { outline: 2px solid var(--t-accent); outline-offset: 2px; }
button { font: inherit; color: inherit; }
.tools button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 38px; min-width: 38px; padding: 0 12px; border: 1px solid var(--t-border); border-radius: 11px; background: var(--t-surface); color: var(--t-text); font-weight: 600; cursor: pointer; }
.tools button:hover { background: var(--t-group-fill); border-color: var(--t-group-stroke); }
.tools button:active { transform: translateY(1px); }
.tools button[aria-expanded="true"] { background: var(--t-group-fill); border-color: var(--t-accent); }
.tools button#export { background: var(--t-accent); border-color: var(--t-accent); color: var(--t-surface); }
.tools button#export:hover { filter: brightness(1.08); }
.tools .seg { gap: 0; height: 38px; overflow: hidden; border: 1px solid var(--t-border); border-radius: 12px; background: var(--t-surface); }
.seg button { height: 36px; padding: 0 9px; border: 0; border-radius: 0; background: transparent; }
.seg output { min-width: 52px; text-align: center; font-size: 13px; font-weight: 600; }
.ui { flex: none; }
.lead { color: var(--t-accent); }
.dot { width: 12px; height: 12px; border-radius: 50%; background: conic-gradient(var(--t-fam-compute-stroke), var(--t-fam-data-stroke), var(--t-fam-messaging-stroke), var(--t-fam-external-stroke), var(--t-fam-compute-stroke)); box-shadow: 0 0 0 2px var(--t-surface), 0 0 0 3px var(--t-border); }
.is-fullscreen .i-full, :root:not(.is-fullscreen) .i-exit { display: none; }
.search { position: relative; display: flex; align-items: center; }
.search .mag { position: absolute; left: 11px; color: var(--t-muted); pointer-events: none; }
.search input { width: 216px; height: 38px; padding: 0 42px 0 34px; border: 1px solid var(--t-border); border-radius: 11px; background: var(--t-bg); color: var(--t-text); font: inherit; }
.search input::placeholder { color: var(--t-muted); }
.search.has-query input { padding-right: 64px; }
.search kbd { position: absolute; right: 9px; padding: 3px 6px; border: 1px solid var(--t-border); border-radius: 6px; background: var(--t-surface); color: var(--t-muted); font: 600 11px/1 inherit; pointer-events: none; }
.search:focus-within kbd, .search.has-query kbd { display: none; }
.search output { position: absolute; right: 10px; color: var(--t-muted); font-size: 11.5px; font-weight: 600; pointer-events: none; }
[hidden] { display: none !important; }
main { flex: 1; min-height: 0; overflow: hidden; position: relative; background-color: var(--t-bg); background-image: radial-gradient(var(--t-group-stroke) 1px, transparent 1.3px); background-size: 22px 22px; }
.credit { padding: 6px 24px 8px; text-align: right; font-size: 11px; line-height: 1.4; }
.credit a { color: var(--t-muted); text-decoration: none; }
.credit a:hover { color: var(--t-text); text-decoration: underline; }
.credit a:focus-visible { border-radius: 2px; }
.stage { height: 100%; padding: 12px 24px; touch-action: none; cursor: grab; }
.stage.is-grabbing { cursor: grabbing; }
.stage:focus-visible { outline-offset: -3px; }
.stage svg.diagram { display: block; width: 100%; height: 100%; }
.diagram .t-node { cursor: pointer; }
.t-find :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline):not(.t-hit) { opacity: 0.2; }
.t-dim :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline):not(.t-near) { opacity: 0.25; }
.diagram :is(.t-pick, .t-cur) .t-node-box { stroke: var(--t-accent); stroke-width: 2.5; }
.minimap { position: absolute; left: 16px; bottom: 16px; z-index: 2; padding: 8px; border: 1px solid var(--t-border); border-radius: 14px; background: var(--t-surface); box-shadow: 0 10px 30px -14px var(--t-shadow); }
.minimap small { display: block; margin: 0 2px 6px; color: var(--t-muted); font-size: 11px; font-weight: 600; }
.minimap svg { display: block; cursor: pointer; touch-action: none; }
.mm-n { fill: var(--t-f-fill, var(--t-card)); stroke: var(--t-f-stroke, var(--t-muted)); stroke-width: 1px; vector-effect: non-scaling-stroke; }
.mm-g { fill: var(--t-group-fill); stroke: var(--t-group-stroke); stroke-width: 1px; vector-effect: non-scaling-stroke; }
.mm-e { fill: none; stroke: var(--t-muted); stroke-opacity: 0.55; stroke-width: 1px; vector-effect: non-scaling-stroke; }
.mm-v { fill: var(--t-accent); fill-opacity: 0.12; stroke: var(--t-accent); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
.detail { position: absolute; right: 16px; bottom: 16px; z-index: 2; width: 308px; max-height: calc(100% - 32px); overflow: auto; padding: 16px; border: 1px solid var(--t-border); border-radius: 16px; background: var(--t-surface); box-shadow: 0 20px 44px -18px var(--t-shadow); }
.detail:not(.pinned) { pointer-events: none; }
.detail.is-row :is(h3, ul) { display: none; }
.detail.top { bottom: auto; top: 16px; }
.detail header { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; }
.detail header > div { flex: 1; min-width: 0; }
.detail h2 { margin: 0; font-size: 15px; line-height: 1.25; overflow-wrap: anywhere; }
.fam { display: inline-flex; align-items: center; gap: 6px; color: var(--t-muted); font-size: 12px; font-weight: 600; }
.sw { width: 10px; height: 10px; border: 1.5px solid var(--t-f-stroke, var(--t-muted)); border-radius: 3px; background: var(--t-f-fill, var(--t-card)); }
.detail button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 1px solid var(--t-border); border-radius: 8px; background: transparent; color: var(--t-muted); cursor: pointer; }
.detail button:hover { color: var(--t-text); background: var(--t-group-fill); }
.detail .note { margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--t-border); border-radius: 10px; background: var(--t-bg); font-size: 13px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.detail .note:empty { display: none; }
.detail .src { margin: 0 0 6px; }
.detail code { padding: 3px 6px; border: 1px solid var(--t-border); border-radius: 6px; background: var(--t-bg); color: var(--t-muted); font: 600 11.5px/1.4 ui-monospace, "SFMono-Regular", Consolas, monospace; overflow-wrap: anywhere; }
.detail h3 { margin: 10px 0 4px; color: var(--t-muted); font-size: 11.5px; font-weight: 600; }
.detail ul { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
.detail li { display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: center; font-size: 12.5px; }
.detail li em { color: var(--t-muted); font-size: 12px; font-style: normal; }
.detail li.none { display: block; color: var(--t-muted); }
.detail li i { width: 8px; height: 8px; border-radius: 50%; background: var(--t-edge); }
.detail li i.s-async { background: var(--t-edge-async); }
.detail li i.s-data { background: var(--t-edge-data); }
.detail li i.s-reply { background: var(--t-edge-reply); }
.pop { position: fixed; inset: auto; margin: 0; width: min(330px, calc(100vw - 16px)); max-height: calc(100dvh - 80px); overflow: auto; padding: 8px; border: 1px solid var(--t-border); border-radius: 16px; background: var(--t-surface); color: var(--t-text); box-shadow: 0 24px 60px -16px var(--t-shadow), 0 2px 6px rgba(0, 0, 0, 0.08); }
#theme-menu { width: min(264px, calc(100vw - 16px)); }
.no-pop .pop { display: none; }
.no-pop .pop.open { display: block; }
.pop [role="group"] { padding: 4px 0; border-top: 1px solid var(--t-border); }
.pop [role="group"]:first-child { border-top: 0; }
.gt { display: block; margin: 6px 10px 2px; color: var(--t-muted); font-size: 11.5px; font-weight: 600; }
.pop button { display: grid; grid-template-columns: 20px 1fr auto; gap: 10px; align-items: center; width: 100%; padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; color: var(--t-text); font-weight: 600; text-align: left; cursor: pointer; }
.pop button:hover, .pop button:focus-visible { background: var(--t-group-fill); }
.pop button:focus-visible { outline-offset: -2px; }
.pop button:disabled { opacity: 0.55; cursor: not-allowed; }
.pop button small { color: var(--t-muted); font-size: 12px; font-weight: 400; }
#theme-menu button { grid-template-columns: 60px 1fr; }
#theme-menu button span { display: grid; }
#theme-menu button[aria-checked="true"] { outline: 2px solid var(--t-accent); outline-offset: -2px; }
#theme-menu svg { border: 1px solid var(--t-border); border-radius: 6px; }
.note-line { margin: 4px 10px; color: var(--t-muted); font-size: 12px; line-height: 1.4; }
.note-line:empty { display: none; }
.note-line.bad { color: var(--t-text); }
@media (prefers-reduced-motion: no-preference) {
  .diagram :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline) { transition: opacity 120ms; }
  .tools button { transition: background-color 0.15s, border-color 0.15s; }
  .pop { opacity: 0; translate: 0 -4px; transition: opacity 0.15s, translate 0.15s, display 0.15s allow-discrete, overlay 0.15s allow-discrete; }
  .pop:popover-open { opacity: 1; translate: 0 0; }
  @starting-style { .pop:popover-open { opacity: 0; translate: 0 -4px; } }
  .detail:not([hidden]), .minimap:not([hidden]) { animation: rise 0.16s ease-out; }
  @keyframes rise { from { opacity: 0; translate: 0 6px; } }
}
@media (max-width: 900px) {
  header.top { flex-wrap: wrap; gap: 10px 14px; padding: 12px; }
  .sep { display: none; }
  .heading { flex-basis: 60%; }
  .tools { flex: 1 1 100%; justify-content: flex-start; }
  .search { flex: 1 1 160px; }
  .search input { width: 100%; }
  .minimap { display: none; }
  .detail { left: 12px; right: 12px; bottom: 12px; width: auto; max-height: 45%; }
  #theme-name, #export span { display: none; }
  .stage { padding: 8px 12px; }
}
@media print {
  html, body { height: auto; background: #fff; }
  header, .minimap, .detail, .credit, .pop { display: none !important; }
  main { overflow: visible; background: none; }
  .stage { height: auto; padding: 0; }
  .stage svg.diagram { width: 100%; height: 100vh; }
  .t-dim :is(.t-node, .t-edge, .t-edge-halo, .t-edge-label, .t-lifeline) { opacity: 1 !important; }
}
`;
