// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { THEME_VARS } from "./theme.js";

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Zooms around (px, py) in SVG units. factor > 1 zooms in; scale stays within 0.25x to 8x of base. */
export function zoomAt(view: View, base: View, px: number, py: number, factor: number): View {
  const scale = Math.min(4, Math.max(1 / 8, view.w / base.w / factor));
  const k = (scale * base.w) / view.w;
  return { x: px - (px - view.x) * k, y: py - (py - view.y) * k, w: view.w * k, h: view.h * k };
}

/** Moves the view by (dx, dy) in SVG units. */
export function panBy(view: View, dx: number, dy: number): View {
  return { x: view.x + dx, y: view.y + dy, w: view.w, h: view.h };
}

// Runs in the page, so the pure functions above are embedded as source text.
export const VIEWER_SCRIPT = String.raw`(function () {
  var root = document.documentElement;
  var stage = document.querySelector(".stage");
  var svg = stage.querySelector("svg");
  var tip = document.getElementById("tip");
  var $ = function (id) { return document.getElementById(id); };
  var label = function (button, text) {
    button.setAttribute("aria-label", text);
    button.setAttribute("title", text);
  };
  ${zoomAt.toString()}
  ${panBy.toString()}
  var vb = svg.viewBox.baseVal;
  var base = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  var view = base;
  var show = function (v) {
    view = v;
    svg.setAttribute("viewBox", v.x + " " + v.y + " " + v.w + " " + v.h);
  };
  var toSvg = function (cx, cy) {
    return new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
  };
  var unit = function () { return 1 / svg.getScreenCTM().a; };
  var zoomMid = function (f) { show(zoomAt(view, base, view.x + view.w / 2, view.y + view.h / 2, f)); };
  var pan = function (fx, fy) { show(panBy(view, fx * view.w, fy * view.h)); };

  var near = function (node) {
    var id = node.dataset.id;
    var edges = new Set();
    var ends = new Set([id]);
    svg.querySelectorAll(".t-edge").forEach(function (e) {
      if (e.dataset.from !== id && e.dataset.to !== id) return;
      edges.add(e.dataset.edge);
      ends.add(e.dataset.from);
      ends.add(e.dataset.to);
    });
    svg.classList.add("t-dim");
    svg.querySelectorAll("[data-edge], [data-id]").forEach(function (el) {
      var on = el.dataset.edge ? edges.has(el.dataset.edge) : el.matches(".t-node, .t-lifeline") && ends.has(el.dataset.id);
      if (on) el.classList.add("t-near");
    });
  };
  var clear = function () {
    svg.classList.remove("t-dim");
    svg.querySelectorAll(".t-near").forEach(function (el) { el.classList.remove("t-near"); });
  };
  var holder = function (t) {
    for (var g = t.closest("g"); g; g = g.parentNode.closest ? g.parentNode.closest("g") : null) {
      if (g.firstElementChild && g.firstElementChild.localName === "desc") return g;
    }
    return null;
  };
  var shown = null;
  var hide = function () {
    tip.classList.remove("on");
    if (shown) shown.removeAttribute("aria-describedby");
    shown = null;
  };
  var showTip = function (g) {
    tip.textContent = g.firstElementChild.textContent;
    tip.classList.add("on");
    var r = g.getBoundingClientRect();
    var top = r.bottom + 8;
    if (top + tip.offsetHeight > innerHeight) top = r.top - tip.offsetHeight - 8;
    tip.style.top = Math.max(8, top) + "px";
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + "px";
    g.setAttribute("aria-describedby", "tip");
    shown = g;
  };
  var focusOn = function (t) {
    clear();
    hide();
    var n = t.closest(".t-node");
    if (n) near(n);
    var g = holder(t);
    if (g) showTip(g);
  };
  svg.addEventListener("pointerover", function (e) {
    if (e.pointerType !== "touch") focusOn(e.target);
  });
  svg.addEventListener("pointerleave", function () { clear(); hide(); });
  svg.addEventListener("focusin", function (e) { focusOn(e.target); });
  svg.addEventListener("focusout", function () { clear(); hide(); });

  var ptrs = new Map();
  var moved = 0;
  var downAt = null;
  var dist = function () {
    var p = Array.from(ptrs.values());
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  };
  stage.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (ptrs.size === 0) moved = 0;
    downAt = e.target;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("is-grabbing");
  });
  stage.addEventListener("pointermove", function (e) {
    var p = ptrs.get(e.pointerId);
    if (!p) return;
    var before = ptrs.size === 2 ? dist() : 0;
    var dx = e.clientX - p.x;
    var dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (moved < 4) return;
    hide();
    if (ptrs.size === 1) {
      var u = unit();
      show(panBy(view, -dx * u, -dy * u));
    } else if (ptrs.size === 2 && before > 0) {
      var q = Array.from(ptrs.values());
      var c = toSvg((q[0].x + q[1].x) / 2, (q[0].y + q[1].y) / 2);
      show(zoomAt(view, base, c.x, c.y, dist() / before));
    }
  });
  var lift = function (e) {
    if (!ptrs.delete(e.pointerId)) return;
    if (ptrs.size === 0) stage.classList.remove("is-grabbing");
    if (e.type === "pointerup" && e.pointerType === "touch" && moved < 4 && downAt) {
      focusOn(downAt);
    }
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    var p = toSvg(e.clientX, e.clientY);
    show(zoomAt(view, base, p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode ? 16 : 1) * 0.0015)));
  }, { passive: false });
  stage.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === "+" || k === "=") zoomMid(1.25);
    else if (k === "-" || k === "_") zoomMid(0.8);
    else if (k === "0") show(base);
    else if (k === "ArrowLeft") pan(-0.1, 0);
    else if (k === "ArrowRight") pan(0.1, 0);
    else if (k === "ArrowUp") pan(0, -0.1);
    else if (k === "ArrowDown") pan(0, 0.1);
    else if (k === "Escape") hide();
    else return;
    e.preventDefault();
  });
  $("zoom-in").addEventListener("click", function () { zoomMid(1.25); });
  $("zoom-out").addEventListener("click", function () { zoomMid(0.8); });
  $("fit").addEventListener("click", function () { show(base); });

  var vars = ${JSON.stringify(THEME_VARS)};
  var NS = "http://www.w3.org/2000/svg";
  var build = function () {
    var copy = svg.cloneNode(true);
    copy.setAttribute("viewBox", base.x + " " + base.y + " " + base.w + " " + base.h);
    copy.setAttribute("width", base.w);
    copy.setAttribute("height", base.h);
    copy.classList.remove("t-dim");
    copy.querySelectorAll(".t-near").forEach(function (el) { el.classList.remove("t-near"); });
    var cs = getComputedStyle(root);
    var css = "svg { " + vars.map(function (n) { return n + ": " + cs.getPropertyValue(n).trim() + ";"; }).join(" ") + " background: var(--t-bg); } ";
    Array.from(document.styleSheets).forEach(function (sheet) {
      Array.from(sheet.cssRules).forEach(function (r) {
        if (r instanceof CSSFontFaceRule) css += r.cssText + " ";
      });
    });
    var style = document.createElementNS(NS, "style");
    style.textContent = css;
    copy.insertBefore(style, copy.firstChild);
    var note = Array.from(document.childNodes).find(function (n) { return n.nodeType === 8; });
    if (note) copy.insertBefore(document.createComment(note.data), copy.firstChild);
    return new XMLSerializer().serializeToString(copy);
  };
  var slug = function () {
    var s = document.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
    return s || "diagram";
  };
  var save = function (blob, name) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  };
  $("save-svg").addEventListener("click", function () {
    save(new Blob([build()], { type: "image/svg+xml" }), slug() + ".svg");
  });
  $("save-png").addEventListener("click", function () {
    var url = URL.createObjectURL(new Blob([build()], { type: "image/svg+xml" }));
    var img = new Image();
    img.onload = function () {
      var c = document.createElement("canvas");
      c.width = base.w * 2;
      c.height = base.h * 2;
      var g = c.getContext("2d");
      g.fillStyle = getComputedStyle(root).getPropertyValue("--t-bg");
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(function (b) { save(b, slug() + ".png"); }, "image/png");
    };
    img.src = url;
  });

  var theme = $("theme");
  var full = $("fullscreen");
  theme.addEventListener("click", function () {
    var next = { light: "dark", dark: "light", lagoon: "dusk", dusk: "lagoon" }[root.getAttribute("data-theme")] || "dark";
    root.setAttribute("data-theme", next);
    label(theme, next === "dark" || next === "dusk" ? "Switch to light theme" : "Switch to dark theme");
  });
  if (!root.requestFullscreen) {
    full.hidden = true;
    return;
  }
  full.addEventListener("click", function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.requestFullscreen();
  });
  document.addEventListener("fullscreenchange", function () {
    var on = Boolean(document.fullscreenElement);
    root.classList.toggle("is-fullscreen", on);
    label(full, on ? "Exit full screen" : "Enter full screen");
  });
})();`;
