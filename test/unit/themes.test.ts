// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REFERENCE } from "../../src/cli/reference.js";
import { make } from "../../src/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { THEME_VARS, pageCss } from "../../src/render/theme.js";

const THEMES = ["light", "dark", "lagoon", "dusk"] as const;
const TYPES = ["architecture", "workflow", "erd", "sequence"] as const;

const example = (type: string): Record<string, unknown> =>
  JSON.parse(readFileSync(`examples/${type}.json`, "utf8")) as Record<string, unknown>;

const head = (theme: string) =>
  theme === "light" ? ':root, [data-theme="light"]' : `[data-theme="${theme}"]`;

function vars(css: string, theme: string): Record<string, string> {
  const start = css.indexOf(head(theme));
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--t-[a-z-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

describe("theme values", () => {
  it.each(TYPES.flatMap((t) => THEMES.map((th) => [t, th] as const)))(
    "the %s model accepts theme %s",
    (type, theme) => {
      const { diagram, issues } = validateDiagram({ ...example(type), theme });
      expect(issues.filter((i) => i.severity === "error")).toEqual([]);
      expect(diagram?.theme).toBe(theme);
    },
  );

  it.each(TYPES)("the %s model still rejects an unknown theme", (type) => {
    const { diagram, issues } = validateDiagram({ ...example(type), theme: "blue" });
    expect(diagram).toBeUndefined();
    expect(issues.map((i) => i.path)).toContain("theme");
  });

  it.each(THEMES)(
    "make renders data-theme %s from the option and from the JSON field",
    async (theme) => {
      const viaOption = await make(example("architecture"), { theme });
      expect(viaOption.html).toContain(`<html lang="en" data-theme="${theme}">`);
      const viaField = await make({ ...example("workflow"), theme });
      expect(viaField.html).toContain(`<html lang="en" data-theme="${theme}">`);
    },
  );
});

describe("theme variables", () => {
  const css = pageCss("", "");
  const light = vars(css, "light");

  it.each(THEMES)("%s defines every exported variable", (theme) => {
    const own = vars(css, theme);
    for (const name of THEME_VARS) expect(own[name], `${theme} ${name}`).toBeDefined();
    expect(Object.keys(own).sort()).toEqual(Object.keys(light).sort());
  });

  it("gives every theme its own look", () => {
    const seen = new Set(THEMES.map((t) => vars(css, t)["--t-bg"]));
    expect(seen.size).toBe(THEMES.length);
  });

  it("defines one rule per theme for the page", () => {
    for (const name of THEMES) {
      expect(css).toContain(`[data-theme="${name}"] {`);
    }
  });
});

describe("schema reference", () => {
  it.each(TYPES)("lists the four themes for %s", (type) => {
    expect(REFERENCE[type]).toContain("theme?        light | dark | lagoon | dusk");
  });
});

describe("theme contrast", () => {
  const css = pageCss("", "");
  const lum = (hex: string) => {
    const c = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const FAMILIES = [
    "compute",
    "data",
    "messaging",
    "client",
    "external",
    "start",
    "end",
    "decision",
    "wait",
    "task",
  ];

  it.each(THEMES)("%s: every text reaches 4.5:1 on its fill", (theme) => {
    const p = vars(css, theme);
    const fills = [
      "--t-bg",
      "--t-surface",
      "--t-card",
      "--t-node-fill",
      "--t-group-fill",
      "--t-table-head",
      "--t-label-bg",
      "--t-lane-fill-odd",
      "--t-lane-header",
      "--t-note-fill",
      ...FAMILIES.map((f) => `--t-fam-${f}-fill`),
    ];
    for (const fill of fills) {
      expect(ratio(p["--t-text"]!, p[fill]!), `${theme} text on ${fill}`).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(ratio(p["--t-muted"]!, p[fill]!), `${theme} muted on ${fill}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it.each(THEMES)("%s: strokes, edges and icons reach 3:1", (theme) => {
    const p = vars(css, theme);
    const against = (name: string, fg: string, bgs: string[]) => {
      for (const bg of bgs)
        expect(ratio(p[fg]!, p[bg]!), `${theme} ${name} on ${bg}`).toBeGreaterThanOrEqual(3);
    };
    for (const f of FAMILIES)
      against(`${f} stroke`, `--t-fam-${f}-stroke`, ["--t-bg", "--t-card", `--t-fam-${f}-fill`]);
    for (const e of ["--t-edge", "--t-edge-async", "--t-edge-data", "--t-edge-reply"])
      against(e, e, ["--t-bg", "--t-label-bg", "--t-group-fill"]);
    against("node stroke", "--t-node-stroke", ["--t-bg", "--t-card", "--t-group-fill"]);
    against("accent", "--t-accent", ["--t-bg", "--t-surface"]);
  });
});
