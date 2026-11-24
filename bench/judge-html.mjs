// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Tool-neutral visual judge: opens an HTML file in headless Chrome/Edge over the
// DevTools protocol (Node built-ins only) and reports defects in the rendered text.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE =
  "usage: node bench/judge-html.mjs <file.html> [--expect term]... [--screenshot out.png] [--browser path] [--json]";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  const env = process.env.BENCH_BROWSER;
  if (env) return existsSync(env) ? env : null;
  const pf = process.env.ProgramFiles ?? "C:\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\Program Files (x86)";
  const local = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  const candidates =
    process.platform === "win32"
      ? [
          join(pf, "Google", "Chrome", "Application", "chrome.exe"),
          join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
          join(local, "Google", "Chrome", "Application", "chrome.exe"),
          join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
          join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/usr/bin/microsoft-edge-stable",
          ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

// Runs inside the page. Must be self-contained: it is sent as source text.
function inspectPage() {
  const TOL = 2;
  const clips = (v) => v === "hidden" || v === "clip";
  // Text that is clipped away completely is hidden on purpose (the screen-reader-only pattern), like display:none.
  const clippedAway = (el, rects) => {
    const left = Math.min(...rects.map((r) => r.left));
    const top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const box = a.getBoundingClientRect();
      if (/^inset\(\s*50%/.test(cs.clipPath)) return true;
      const m = /^rect\(([^)]*)\)$/.exec(cs.clip);
      if (m) {
        const [t, r, b, l] = m[1].split(",").map((v) => parseFloat(v));
        if (b - t <= TOL || r - l <= TOL) return true;
      }
      if (a instanceof SVGSVGElement) continue;
      if (clips(cs.overflowX) && Math.min(right, box.right) - Math.max(left, box.left) <= TOL) {
        return true;
      }
      if (clips(cs.overflowY) && Math.min(bottom, box.bottom) - Math.max(top, box.top) <= TOL) {
        return true;
      }
    }
    return false;
  };
  const texts = [];
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.nodeValue ?? "").replace(/\s+/g, " ").trim();
    const el = node.parentElement;
    if (!text || !el) continue;
    if (el.closest("script, style, noscript, template, head")) continue;
    if (!el.checkVisibility({ checkOpacity: true, checkVisibilityProperty: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (rects.length === 0 || clippedAway(el, rects)) continue;
    texts.push({ node, el, text, rects });
  }

  const issues = [];
  const label = (t) => `"${t.text.length > 40 ? t.text.slice(0, 40) + "..." : t.text}"`;
  const hits = (a, b) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOL &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOL;

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (a.rects.some((ra) => b.rects.some((rb) => hits(ra, rb)))) {
        issues.push({ kind: "text-overlap", detail: `${label(a)} overlaps ${label(b)}` });
      }
    }
  }

  const root = document.documentElement;
  const pageW = Math.max(root.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const pageH = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0);

  for (const t of texts) {
    const box = {
      left: Math.min(...t.rects.map((r) => r.left)),
      top: Math.min(...t.rects.map((r) => r.top)),
      right: Math.max(...t.rects.map((r) => r.right)),
      bottom: Math.max(...t.rects.map((r) => r.bottom)),
    };
    const past = (c) =>
      box.left < c.left - TOL ||
      box.top < c.top - TOL ||
      box.right > c.right + TOL ||
      box.bottom > c.bottom + TOL;

    let clipper = null;
    // The owning svg is one of the ancestors and clips only through its own overflow: with
    // overflow: visible, text drawn past the viewport is shown.
    for (let a = t.el; a && a !== document.body && a !== root; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if ((clips(cs.overflowX) || clips(cs.overflowY)) && past(a.getBoundingClientRect())) {
        clipper = a;
        break;
      }
    }
    if (clipper) {
      issues.push({
        kind: "text-clipped",
        detail: `${label(t)} extends past <${clipper.localName}>`,
      });
    }

    const x = window.scrollX;
    const y = window.scrollY;
    if (
      box.left + x < -TOL ||
      box.top + y < -TOL ||
      box.right + x > pageW + TOL ||
      box.bottom + y > pageH + TOL
    ) {
      issues.push({ kind: "outside-page", detail: `${label(t)} lies outside the page` });
    }
  }

  return { issues, texts: texts.map((t) => t.text), pageW, pageH };
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.next = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(`${msg.error.message}`));
        else p.resolve(msg.result);
      } else {
        for (const l of this.listeners) l(msg);
      }
    });
    ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("browser connection closed"));
      this.pending.clear();
    });
  }
  send(method, params = {}) {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) {
    this.listeners.push(fn);
  }
}

async function waitForPort(dir, child, timeoutMs) {
  const file = join(dir, "DevToolsActivePort");
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error("browser exited before it was ready");
    if (existsSync(file)) {
      try {
        const port = Number(readFileSync(file, "utf8").split(/\r?\n/)[0]);
        if (port > 0) return port;
      } catch {
        // The browser may still hold the file open; try again.
      }
    }
    await sleep(100);
  }
  throw new Error("browser did not open its debugging port in time");
}

/** Stops the browser and every helper process it started, then waits for it to exit. */
async function killTree(child) {
  if (child.pid === undefined) return;
  const exited =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise((done) => child.once("exit", done));
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    // Killing only the main process leaves helpers (zygote, crashpad) that keep writing the profile.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
  await Promise.race([exited, sleep(5_000)]);
}

/** Throwaway browser profile under `root` (default: the OS temp dir), named _judge-*. */
export function createProfileDir(root = tmpdir()) {
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, "_judge-"));
}

async function removeDir(dir) {
  // Chrome releases profile files a moment after it dies, mostly on Windows.
  for (let i = 0; i < 30; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      // A helper that was still exiting can recreate files; only an absent directory counts.
      if (!existsSync(dir)) return;
    } catch {}
    await sleep(200);
  }
}

/**
 * True when `term` appears in `visible` as a whole word or phrase: case-insensitive, whitespace-normalized,
 * and not glued to a letter, digit or underscore on either side (so "app" is not in "application").
 */
export function containsTerm(visible, term) {
  const needle = term.replace(/\s+/g, " ").trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu");
  return re.test(visible.replace(/\s+/g, " "));
}

export async function judgeHtml(
  htmlPath,
  {
    expectedTerms = [],
    browserPath,
    screenshotPath,
    viewport = { width: 1440, height: 900 },
    settleMs = 1500,
    profileRoot,
  } = {},
) {
  const file = resolve(htmlPath);
  if (!existsSync(file)) throw new Error(`file not found: ${htmlPath}`);
  const browser = browserPath ?? findBrowser();
  if (!browser || !existsSync(browser)) {
    throw new Error("no browser found: set BENCH_BROWSER or pass a browser path (Chrome or Edge)");
  }

  const profile = createProfileDir(profileRoot);
  const child = spawn(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    // On POSIX the browser gets its own process group, so killTree can stop its helpers too.
    { stdio: "ignore", detached: process.platform !== "win32" },
  );
  let spawnError = null;
  child.on("error", (e) => {
    spawnError = e;
  });

  let cdp = null;
  try {
    // A cold browser start on a loaded CI runner can take more than 20 s.
    const port = await waitForPort(profile, child, 45_000).catch((e) => {
      throw spawnError ?? e;
    });
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("browser opened no page target");
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("cannot connect to the browser")), {
        once: true,
      });
    });
    cdp = new Cdp(ws);

    const jsErrors = [];
    let loaded;
    const loadedP = new Promise((r) => (loaded = r));
    cdp.on((msg) => {
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        jsErrors.push(d.exception?.description?.split("\n")[0] ?? d.text);
      } else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        const args = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
        jsErrors.push(`console.error: ${args}`);
      } else if (msg.method === "Page.loadEventFired") {
        loaded();
      }
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url: pathToFileURL(file).href });
    let loadTimer;
    await Promise.race([
      loadedP,
      new Promise((_, rej) => {
        loadTimer = setTimeout(() => rej(new Error("page did not finish loading in 30 s")), 30_000);
      }),
    ]).finally(() => clearTimeout(loadTimer));
    await sleep(settleMs);

    const evaluated = await cdp.send("Runtime.evaluate", {
      expression: `(${inspectPage.toString()})()`,
      returnByValue: true,
    });
    if (evaluated.exceptionDetails) {
      throw new Error(`judge script failed: ${evaluated.exceptionDetails.text}`);
    }
    const { issues: pageIssues, texts } = evaluated.result.value;

    const issues = jsErrors.map((detail) => ({ kind: "js-error", detail }));
    const visible = texts.join(" ");
    for (const term of expectedTerms) {
      if (!containsTerm(visible, term)) {
        issues.push({ kind: "content-missing", detail: `expected "${term}" not in visible text` });
      }
    }
    if (texts.length === 0) {
      issues.push({ kind: "render-empty", detail: "the page has no visible text" });
    }
    issues.push(...pageIssues);

    let screenshot = null;
    if (screenshotPath) {
      const m = await cdp.send("Page.getLayoutMetrics");
      const size = m.cssContentSize ?? m.contentSize;
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.ceil(size.width),
          height: Math.ceil(size.height),
          scale: 1,
        },
      });
      writeFileSync(screenshotPath, Buffer.from(shot.data, "base64"));
      screenshot = screenshotPath;
    }

    return { ok: issues.length === 0, issues, textCount: texts.length, screenshot };
  } finally {
    try {
      cdp?.ws.close();
    } catch {}
    await killTree(child);
    await removeDir(profile);
  }
}

function parseArgs(argv) {
  const opts = { expectedTerms: [], json: false };
  let file = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`option "${a}" needs a value`);
      return v;
    };
    if (a === "--expect") opts.expectedTerms.push(value());
    else if (a === "--screenshot") opts.screenshotPath = value();
    else if (a === "--browser") opts.browserPath = value();
    else if (a === "--json") opts.json = true;
    else if (a.startsWith("--")) throw new Error(`unknown option "${a}"`);
    else if (file === null) file = a;
    else throw new Error(`unexpected argument "${a}"`);
  }
  if (file === null) throw new Error("missing <file.html>");
  return { file, opts };
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e.message}\n${USAGE}\n`);
    return 2;
  }
  const { json, ...options } = parsed.opts;
  try {
    const result = await judgeHtml(parsed.file, options);
    if (json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else if (result.ok) {
      process.stdout.write(`ok (${result.textCount} text nodes)\n`);
    } else {
      for (const i of result.issues) process.stdout.write(`${i.kind}: ${i.detail}\n`);
    }
    return result.ok ? 0 : 1;
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main();
}
