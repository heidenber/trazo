// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { FONT_FAMILY } from "../text/measure.js";
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

/** Height of the strip below the diagram that carries the credit in exports and print, in SVG units. */
export const CREDIT_STRIP = 28;

/** Font stack of the credit: the page's own (Inter, embedded in exports). */
export const CREDIT_FONT = `'${FONT_FAMILY}',system-ui,-apple-system,'Segoe UI',sans-serif`;

/** The viewBox of an export: the diagram box grown by the credit strip at the bottom. */
export function creditBox(base: View): View {
  return { x: base.x, y: base.y, w: base.w, h: base.h + CREDIT_STRIP };
}

/** The small muted credit, bottom right inside the strip below the diagram. Not part of the inline SVG. */
export function creditMarkup(base: View, font: string): string {
  const x = base.x + base.w - 12;
  const y = base.y + base.h + CREDIT_STRIP - 10;
  return `<text class="t-credit" x="${x}" y="${y}" text-anchor="end" font-size="11" style="fill:var(--t-muted);font-family:${font}">Made with trazo</text>`;
}

// Runs in the page, so the pure functions above are embedded as source text.
// Sections: view, minimap, hover and detail card, search, keys, menus, theme, export.
export const VIEWER_SCRIPT = String.raw`(function () {
  var root = document.documentElement;
  var stage = document.querySelector(".stage");
  var svg = stage.querySelector("svg");
  var $ = function (id) { return document.getElementById(id); };
  var set = function (el, text) { el.textContent = text; };
  var all = function (sel, from) { return Array.from((from || document).querySelectorAll(sel)); };
  var label = function (button, text) {
    button.setAttribute("aria-label", text);
    button.setAttribute("title", text);
  };
  ${zoomAt.toString()}
  ${panBy.toString()}
  var CREDIT_STRIP = ${CREDIT_STRIP};
  var CREDIT_FONT = ${JSON.stringify(CREDIT_FONT)};
  ${creditBox.toString()}
  ${creditMarkup.toString()}
  var NS = "http://www.w3.org/2000/svg";
  var vb = svg.viewBox.baseVal;
  var base = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
  var view = base;
  var vr = null;
  var toSvg = function (cx, cy) {
    return new DOMPoint(cx, cy).matrixTransform(svg.getScreenCTM().inverse());
  };
  var unit = function () { return 1 / svg.getScreenCTM().a; };
  var sync = function () {
    var m = svg.getScreenCTM();
    if (!m) return;
    set($("zoom-pct"), Math.round(m.a * 100) + "%");
    var r = svg.getBoundingClientRect();
    var a = toSvg(r.left, r.top);
    var b = toSvg(r.right, r.bottom);
    // The overview is only useful while some of the diagram is out of sight.
    var slack = Math.max(base.w, base.h) * 0.005;
    var fits = a.x <= base.x + slack && a.y <= base.y + slack && b.x >= base.x + base.w - slack && b.y >= base.y + base.h - slack;
    $("minimap").hidden = fits;
    if (!vr) return;
    vr.setAttribute("x", a.x);
    vr.setAttribute("y", a.y);
    vr.setAttribute("width", b.x - a.x);
    vr.setAttribute("height", b.y - a.y);
  };
  var show = function (v) {
    view = v;
    svg.setAttribute("viewBox", v.x + " " + v.y + " " + v.w + " " + v.h);
    sync();
  };
  var zoomMid = function (f) { show(zoomAt(view, base, view.x + view.w / 2, view.y + view.h / 2, f)); };
  var pan = function (fx, fy) { show(panBy(view, fx * view.w, fy * view.h)); };
  if (window.ResizeObserver) new ResizeObserver(sync).observe(stage);

  var minimap = function () {
    var k = Math.min(176 / base.w, 104 / base.h);
    var pad = Math.max(base.w, base.h) * 0.04;
    var m = document.createElementNS(NS, "svg");
    m.setAttribute("viewBox", [base.x - pad, base.y - pad, base.w + 2 * pad, base.h + 2 * pad].join(" "));
    m.setAttribute("width", Math.round((base.w + 2 * pad) * k));
    m.setAttribute("height", Math.round((base.h + 2 * pad) * k));
    var add = function (tag, cls, attrs) {
      var e = document.createElementNS(NS, tag);
      e.setAttribute("class", cls);
      for (var n in attrs) e.setAttribute(n, attrs[n]);
      m.appendChild(e);
    };
    var box = function (el, cls) {
      var b = el.getBBox();
      add("rect", cls, { x: b.x, y: b.y, width: b.width, height: b.height, rx: 4 / k });
    };
    all(".t-group-box, .t-lane-band").forEach(function (el) { box(el, "mm-g"); });
    all(".t-edge", svg).forEach(function (el) { add("path", "mm-e", { d: el.getAttribute("d") }); });
    all(".t-lifeline", svg).forEach(function (el) {
      var b = el.getBBox();
      add("path", "mm-e", { d: "M" + b.x + " " + b.y + "V" + (b.y + b.height) });
    });
    all(".t-node", svg).forEach(function (el) { box(el, "mm-n " + fams(el)); });
    vr = document.createElementNS(NS, "rect");
    vr.setAttribute("class", "mm-v");
    m.appendChild(vr);
    var drag = false;
    var go = function (e) {
      var p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.getScreenCTM().inverse());
      show({ x: p.x - view.w / 2, y: p.y - view.h / 2, w: view.w, h: view.h });
    };
    m.addEventListener("pointerdown", function (e) {
      drag = true;
      m.setPointerCapture(e.pointerId);
      go(e);
      e.preventDefault();
    });
    m.addEventListener("pointermove", function (e) { if (drag) go(e); });
    m.addEventListener("pointerup", function () { drag = false; });
    m.addEventListener("pointercancel", function () { drag = false; });
    $("minimap").appendChild(m);
    sync();
  };

  var fams = function (n) {
    return Array.from(n.classList).filter(function (c) { return c.indexOf("t-fam-") === 0; }).join(" ");
  };
  var textOf = function (el) {
    return all("tspan", el).map(function (t) { return t.textContent; }).join(" ");
  };
  var nodeName = function (n) {
    var t = n.querySelector(".t-node-label");
    return t ? textOf(t) : n.dataset.id;
  };
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

  var card = $("detail");
  var byId = {};
  var edgeText = {};
  all(".t-node", svg).forEach(function (n) { byId[n.dataset.id] = n; });
  all(".t-edge-label", svg).forEach(function (l) { edgeText[l.dataset.edge] = textOf(l); });
  var list = function (ul, rows) {
    ul.textContent = "";
    rows.slice(0, 8).forEach(function (r) {
      var li = document.createElement("li");
      var dot = document.createElement("i");
      var name = document.createElement("span");
      var via = document.createElement("em");
      dot.className = "s-" + r.style;
      set(name, r.name);
      set(via, r.via);
      li.append(dot, name, via);
      ul.append(li);
    });
    if (rows.length > 8) {
      var more = document.createElement("li");
      more.className = "none";
      set(more, "and " + (rows.length - 8) + " more");
      ul.append(more);
    }
    if (!rows.length) {
      var none = document.createElement("li");
      none.className = "none";
      set(none, "None");
      ul.append(none);
    }
  };
  var details = {};
  var detailEl = $("trazo-detail");
  if (detailEl) try { details = JSON.parse(detailEl.textContent); } catch (e) {}
  var fill = function (g) {
    var node = g.classList.contains("t-node");
    var desc = g.firstElementChild && g.firstElementChild.localName === "desc" ? g.firstElementChild.textContent : "";
    var src = g.dataset.source || "";
    if (src && desc.slice(-src.length) === src) desc = desc.slice(0, -src.length).replace(/\n$/, "");
    set($("d-title"), node ? nodeName(g) : textOf(g.querySelector("text")));
    set($("d-kind"), node ? g.dataset.kind || "node" : "column");
    $("d-sw").setAttribute("class", "sw " + (node ? fams(g) : ""));
    set($("d-note"), details[g.dataset.id] || desc);
    $("d-srcp").hidden = !src;
    set($("d-src"), src);
    var ins = [];
    var outs = [];
    if (node) {
      all(".t-edge", svg).forEach(function (e) {
        var style = (/t-edge-(async|data|reply)/.exec(e.getAttribute("class")) || [0, "sync"])[1];
        var via = edgeText[e.dataset.edge] || "";
        if (e.dataset.to === g.dataset.id && byId[e.dataset.from]) ins.push({ name: nodeName(byId[e.dataset.from]), via: via, style: style });
        if (e.dataset.from === g.dataset.id && byId[e.dataset.to]) outs.push({ name: nodeName(byId[e.dataset.to]), via: via, style: style });
      });
    }
    list($("d-in"), ins);
    list($("d-out"), outs);
    card.classList.toggle("is-row", !node);
  };
  var showCard = function (g, pinned) {
    fill(g);
    $("d-close").hidden = !pinned;
    card.classList.toggle("pinned", pinned);
    card.classList.remove("top");
    card.hidden = false;
    var a = g.getBoundingClientRect();
    var b = card.getBoundingClientRect();
    if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) card.classList.add("top");
  };
  var pinned = null;
  var settle = function () {
    clear();
    card.hidden = true;
    if (!pinned) return;
    near(pinned);
    showCard(pinned, true);
  };
  var focusOn = function (t) {
    clear();
    card.hidden = true;
    var n = t.closest(".t-node");
    var g = holder(t) || n;
    if (n) near(n);
    if (g) showCard(g, false);
  };
  var pick = function (t) {
    var n = t && t.closest && t.closest(".t-node");
    if (pinned) pinned.classList.remove("t-pick");
    pinned = n && n !== pinned ? n : null;
    if (pinned) pinned.classList.add("t-pick");
    settle();
  };
  svg.addEventListener("pointerover", function (e) {
    if (e.pointerType !== "touch") focusOn(e.target);
  });
  svg.addEventListener("pointerleave", settle);
  svg.addEventListener("focusin", function (e) { focusOn(e.target); });
  svg.addEventListener("focusout", settle);
  $("d-close").addEventListener("click", function () { pick(null); });

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
    settle();
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
    if (e.type === "pointerup" && ptrs.size === 0 && moved < 4 && downAt) pick(downAt);
  };
  stage.addEventListener("pointerup", lift);
  stage.addEventListener("pointercancel", lift);
  stage.addEventListener("wheel", function (e) {
    e.preventDefault();
    var p = toSvg(e.clientX, e.clientY);
    show(zoomAt(view, base, p.x, p.y, Math.exp(-e.deltaY * (e.deltaMode ? 16 : 1) * 0.0015)));
  }, { passive: false });
  $("zoom-in").addEventListener("click", function () { zoomMid(1.25); });
  $("zoom-out").addEventListener("click", function () { zoomMid(0.8); });
  $("fit").addEventListener("click", function () { show(base); });

  var search = $("search");
  var found = $("found");
  var hay = all(".t-node", svg).map(function (n) {
    var d = n.firstElementChild.localName === "desc" ? n.firstElementChild.textContent : "";
    return { el: n, text: norm(nodeName(n) + " " + d) };
  });
  function norm(s) { return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, ""); }
  var hits = [];
  var cur = -1;
  var fresh = false;
  var jump = function (i, zoom) {
    if (!hits.length) return;
    if (hits[cur]) hits[cur].classList.remove("t-cur");
    cur = (i + hits.length) % hits.length;
    var n = hits[cur];
    n.classList.add("t-cur");
    var b = n.getBBox();
    var cx = b.x + b.width / 2;
    var cy = b.y + b.height / 2;
    var v = view;
    if (zoom && svg.getScreenCTM().a < 0.9) v = zoomAt(v, base, cx, cy, 0.9 / svg.getScreenCTM().a);
    show({ x: cx - v.w / 2, y: cy - v.h / 2, w: v.w, h: v.h });
  };
  var find = function () {
    var q = norm(search.value.trim());
    all(".t-hit, .t-cur", svg).forEach(function (e) { e.classList.remove("t-hit", "t-cur"); });
    hits = q ? hay.filter(function (h) { return h.text.indexOf(q) >= 0; }).map(function (h) { return h.el; }) : [];
    hits.forEach(function (n) { n.classList.add("t-hit"); });
    svg.classList.toggle("t-find", Boolean(q));
    search.parentNode.classList.toggle("has-query", Boolean(q));
    set(found, !q ? "" : hits.length ? hits.length + "/" + hay.length : "None");
    cur = -1;
    fresh = true;
    jump(0, false);
  };
  search.addEventListener("input", find);
  var searchKey = function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      jump(fresh ? cur : cur + (e.shiftKey ? -1 : 1), true);
      fresh = false;
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (search.value) {
        search.value = "";
        find();
      } else search.blur();
    }
  };

  var noPop = !Object.prototype.hasOwnProperty.call(HTMLElement.prototype, "popover");
  if (noPop) root.classList.add("no-pop");
  var enter = false;
  var items = function (pop) { return all("button:not(:disabled)", pop); };
  var isOpen = function (pop) { return noPop ? pop.classList.contains("open") : pop.matches(":popover-open"); };
  var close = function (pop) {
    try {
      if (noPop) pop.classList.remove("open");
      else if (isOpen(pop)) pop.hidePopover();
    } catch (x) {}
  };
  var place = function (pop, b) {
    var r = b.getBoundingClientRect();
    var w = Math.min(Number(pop.dataset.w), innerWidth - 16);
    pop.style.top = r.bottom + 8 + "px";
    pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + "px";
  };
  var opened = function (pop, b, on) {
    b.setAttribute("aria-expanded", String(on));
    if (on && enter) (pop.querySelector('[aria-checked="true"]') || items(pop)[0]).focus();
    enter = false;
  };
  all("[commandfor]").forEach(function (b) {
    var pop = $(b.getAttribute("commandfor"));
    if (!noPop && !("commandForElement" in HTMLButtonElement.prototype)) b.setAttribute("popovertarget", pop.id);
    b.addEventListener("click", function (e) {
      enter = e.detail === 0;
      if (!noPop) return;
      var on = !isOpen(pop);
      pop.classList.toggle("open", on);
      place(pop, b);
      opened(pop, b, on);
    });
    b.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowDown") return;
      e.preventDefault();
      if (isOpen(pop)) items(pop)[0].focus();
      else b.click();
    });
    if (!noPop) {
      pop.addEventListener("beforetoggle", function (e) { if (e.newState === "open") place(pop, b); });
      pop.addEventListener("toggle", function (e) { opened(pop, b, e.newState === "open"); });
    }
    pop.addEventListener("keydown", function (e) {
      var l = items(pop);
      var i = l.indexOf(document.activeElement);
      var k = e.key;
      if (k === "Escape" && noPop) {
        close(pop);
        b.focus();
        return;
      }
      var n = k === "ArrowDown" ? (i + 1) % l.length : k === "ArrowUp" ? (i - 1 + l.length) % l.length : k === "Home" ? 0 : k === "End" ? l.length - 1 : -1;
      if (n < 0) return;
      e.preventDefault();
      l[n].focus();
    });
    pop.addEventListener("focusout", function (e) {
      var to = e.relatedTarget;
      if (to && !pop.contains(to) && to !== b) close(pop);
    });
  });
  document.addEventListener("click", function (e) {
    if (noPop && !e.target.closest(".pop, [commandfor]")) all(".pop").forEach(close);
  });

  var setTheme = function (id) {
    root.setAttribute("data-theme", id);
    var name = "";
    all("#theme-menu [data-set-theme]").forEach(function (b) {
      var on = b.dataset.setTheme === id;
      b.setAttribute("aria-checked", String(on));
      if (on) name = b.dataset.name;
    });
    set($("theme-name"), name);
    label($("theme"), "Change theme (current: " + name + ")");
  };
  $("theme-menu").addEventListener("click", function (e) {
    var b = e.target.closest("[data-set-theme]");
    if (b) setTheme(b.dataset.setTheme);
  });

  var vars = ${JSON.stringify(THEME_VARS)};
  var build = function (bg) {
    var copy = svg.cloneNode(true);
    var box = creditBox(base);
    copy.setAttribute("viewBox", box.x + " " + box.y + " " + box.w + " " + box.h);
    copy.setAttribute("width", box.w);
    copy.setAttribute("height", box.h);
    copy.classList.remove("t-dim", "t-find");
    all(".t-near, .t-hit, .t-pick, .t-cur", copy).forEach(function (el) {
      el.classList.remove("t-near", "t-hit", "t-pick", "t-cur");
    });
    var cs = getComputedStyle(root);
    var css = "svg { " + vars.map(function (n) { return n + ": " + cs.getPropertyValue(n).trim() + ";"; }).join(" ") + (bg ? " background: var(--t-bg);" : "") + " } ";
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
    return new XMLSerializer().serializeToString(copy).replace(/<\/svg>\s*$/, function (end) { return creditMarkup(base, CREDIT_FONT) + end; });
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
  var png = function (scale, bg) {
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(new Blob([build(bg)], { type: "image/svg+xml" }));
      var img = new Image();
      img.onload = function () {
        var box = creditBox(base);
        var k = Math.min(scale, 8192 / Math.max(box.w, box.h));
        var c = document.createElement("canvas");
        c.width = Math.round(box.w * k);
        c.height = Math.round(box.h * k);
        var g = c.getContext("2d");
        if (bg) {
          g.fillStyle = getComputedStyle(root).getPropertyValue("--t-bg");
          g.fillRect(0, 0, c.width, c.height);
        }
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : no(new Error("The PNG could not be created.")); }, "image/png");
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        no(new Error("The PNG could not be created."));
      };
      img.src = url;
    });
  };
  var copyText = function (text, what) {
    var done = function () { return what + " copied to the clipboard"; };
    var legacy = function () {
      var f = document.createElement("textarea");
      f.value = text;
      f.setAttribute("readonly", "");
      f.style.cssText = "position:fixed;top:0;opacity:0";
      document.body.appendChild(f);
      f.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (x) {}
      f.remove();
      if (!ok) throw new Error("Could not copy " + what + ": the browser blocked clipboard access. Use a download instead.");
      return done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(done, legacy);
    return Promise.resolve().then(legacy);
  };
  var copyImage = function () {
    var sorry = new Error("Could not copy the image. Browsers often block it on pages opened from a file; download the PNG instead.");
    if (!navigator.clipboard || !navigator.clipboard.write || !window.ClipboardItem) return Promise.reject(sorry);
    return Promise.resolve()
      .then(function () { return navigator.clipboard.write([new ClipboardItem({ "image/png": png(2, true) })]); })
      .then(function () { return "PNG copied to the clipboard"; }, function () { throw sorry; });
  };
  var source = $("trazo-source");
  var exportPop = $("export-menu");
  var actions = {
    png1: function () { return png(1, true).then(function (b) { save(b, slug() + ".png"); }); },
    png2: function () { return png(2, true).then(function (b) { save(b, slug() + "@2x.png"); }); },
    "png-alpha": function () { return png(2, false).then(function (b) { save(b, slug() + "-transparent.png"); }); },
    svg: function () { save(new Blob([build(true)], { type: "image/svg+xml" }), slug() + ".svg"); },
    pdf: function () {
      close(exportPop);
      setTimeout(function () { window.print(); }, 60);
    },
    "copy-png": copyImage,
    "copy-svg": function () { return copyText(build(true), "SVG"); },
    "copy-json": function () {
      if (!source) throw new Error("The source is too large to embed in this page.");
      return copyText(JSON.stringify(JSON.parse(source.textContent), null, 2), "JSON source");
    }
  };
  var noteLine = $("export-note");
  var noteTimer = 0;
  var say = function (text, bad) {
    set(noteLine, text);
    noteLine.classList.toggle("bad", Boolean(bad));
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { set(noteLine, ""); }, 6000);
  };
  exportPop.addEventListener("click", function (e) {
    var b = e.target.closest("[data-export]");
    if (!b || b.disabled) return;
    Promise.resolve()
      .then(actions[b.dataset.export])
      .then(function (m) { if (m) say(m, false); else close(exportPop); })
      .catch(function (err) { say(err && err.message ? err.message : "Export failed.", true); });
  });
  var restore = null;
  addEventListener("beforeprint", function () {
    restore = { v: view, t: root.getAttribute("data-theme") };
    show(base);
    // The credit joins the printed diagram only; the page footer is hidden in print.
    svg.insertAdjacentHTML("beforeend", creditMarkup(base, CREDIT_FONT));
    var grown = creditBox(base);
    svg.setAttribute("viewBox", grown.x + " " + grown.y + " " + grown.w + " " + grown.h);
    var light = { dark: "light", dusk: "lagoon" }[restore.t];
    if (light) root.setAttribute("data-theme", light);
  });
  addEventListener("afterprint", function () {
    if (!restore) return;
    all(".t-credit", svg).forEach(function (el) { el.remove(); });
    show(restore.v);
    root.setAttribute("data-theme", restore.t);
    restore = null;
  });

  var full = $("fullscreen");
  if (root.requestFullscreen) {
    full.addEventListener("click", function () {
      if (document.fullscreenElement) document.exitFullscreen();
      else root.requestFullscreen();
    });
    document.addEventListener("fullscreenchange", function () {
      var on = Boolean(document.fullscreenElement);
      root.classList.toggle("is-fullscreen", on);
      label(full, on ? "Exit full screen" : "Enter full screen");
    });
  } else full.hidden = true;

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    var t = e.target;
    if (t === search) return searchKey(e);
    if (t.matches && t.matches("input, textarea, select, [contenteditable]")) return;
    if (t.closest && t.closest("[popover]")) return;
    var inStage = stage.contains(t);
    if (k === "/") {
      search.focus();
      search.select();
    } else if (k === "+" || k === "=") zoomMid(1.25);
    else if (k === "-" || k === "_") zoomMid(0.8);
    else if (k === "0") show(base);
    else if (k === "Escape") {
      // No preventDefault: an open menu must still close on Escape.
      if (pinned) pick(null);
      else settle();
      return;
    } else if (inStage && k === "ArrowLeft") pan(-0.1, 0);
    else if (inStage && k === "ArrowRight") pan(0.1, 0);
    else if (inStage && k === "ArrowUp") pan(0, -0.1);
    else if (inStage && k === "ArrowDown") pan(0, 0.1);
    else if (inStage && (k === "Enter" || k === " ") && t.closest(".t-node")) pick(t);
    else return;
    e.preventDefault();
  });
  minimap();
  sync();
})();`;
