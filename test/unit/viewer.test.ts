// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { THEME_VARS } from "../../src/render/theme.js";
import { VIEWER_SCRIPT, panBy, zoomAt } from "../../src/render/viewer.js";

const base = { x: 0, y: 0, w: 800, h: 400 };
const scale = (v: { w: number }) => v.w / base.w;

describe("zoomAt", () => {
  it("keeps the point under the cursor fixed", () => {
    const view = { x: 100, y: 50, w: 400, h: 200 };
    const px = 300;
    const py = 120;
    const next = zoomAt(view, base, px, py, 2);
    expect(next.w).toBeCloseTo(200);
    expect(next.h).toBeCloseTo(100);
    expect((px - next.x) / next.w).toBeCloseTo((px - view.x) / view.w);
    expect((py - next.y) / next.h).toBeCloseTo((py - view.y) / view.h);
  });

  it("zooms out by a factor below one", () => {
    const next = zoomAt(base, base, 400, 200, 0.5);
    expect(next.w).toBeCloseTo(1600);
    expect(next.x).toBeCloseTo(-400);
  });

  it("stops at 8x in", () => {
    let v = base;
    for (let i = 0; i < 20; i++) v = zoomAt(v, base, 400, 200, 2);
    expect(scale(v)).toBeCloseTo(1 / 8);
    expect(v.h / base.h).toBeCloseTo(1 / 8);
  });

  it("stops at 0.25x out", () => {
    let v = base;
    for (let i = 0; i < 20; i++) v = zoomAt(v, base, 400, 200, 0.5);
    expect(scale(v)).toBeCloseTo(4);
  });

  it("keeps the cursor point fixed even when it clamps", () => {
    let v = base;
    for (let i = 0; i < 20; i++) v = zoomAt(v, base, 100, 50, 2);
    expect((100 - v.x) / v.w).toBeCloseTo(100 / base.w);
  });

  it("does not mutate its input", () => {
    const view = { ...base };
    zoomAt(view, base, 10, 10, 2);
    expect(view).toEqual(base);
  });
});

describe("panBy", () => {
  it("moves the origin and keeps the size", () => {
    expect(panBy({ x: 10, y: 20, w: 300, h: 100 }, 5, -7)).toEqual({
      x: 15,
      y: 13,
      w: 300,
      h: 100,
    });
  });
});

describe("VIEWER_SCRIPT", () => {
  it("stays under the byte budget", () => {
    expect(Buffer.byteLength(VIEWER_SCRIPT)).toBeLessThan(10240);
  });

  it("compiles", () => {
    expect(() => new Function(VIEWER_SCRIPT)).not.toThrow();
  });

  it("embeds the pure view functions", () => {
    expect(VIEWER_SCRIPT).toContain(zoomAt.toString());
    expect(VIEWER_SCRIPT).toContain(panBy.toString());
  });

  it("keeps the theme toggle and Fullscreen API", () => {
    expect(VIEWER_SCRIPT).toContain("requestFullscreen");
    expect(VIEWER_SCRIPT).toContain("Switch to light theme");
    expect(VIEWER_SCRIPT).toContain("Switch to dark theme");
  });

  it("embeds the theme variable list used for export", () => {
    for (const name of THEME_VARS) expect(VIEWER_SCRIPT).toContain(name);
  });

  it("derives download names from the title", () => {
    expect(VIEWER_SCRIPT).toContain("diagram");
    expect(VIEWER_SCRIPT).toContain("image/svg+xml");
    expect(VIEWER_SCRIPT).toContain("image/png");
  });
});
