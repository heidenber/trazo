// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Family } from "./families.js";

/** Stroke and tint of a color family. */
export type Pair = readonly [stroke: string, fill: string];

export interface Palette {
  mode: "light" | "dark";
  /** Page and diagram surfaces; each key becomes the custom property --t-<key>. */
  base: Record<string, string>;
  fam: Record<Family, Pair>;
  edge: { sync: string; async: string; data: string; reply: string };
}

/**
 * The four themes, from the Studio Cards artboard (light = Porcelain, dark = Graphite, lagoon, dusk).
 * Explicit hex values, no color-mix, so an exported SVG renders anywhere. Every text and fill pair
 * reaches 4.5:1 and every stroke and edge 3:1 on its background (test/unit/themes.test.ts).
 */
export const PALETTES: Record<"light" | "dark" | "lagoon" | "dusk", Palette> = {
  light: {
    mode: "light",
    base: {
      bg: "#f4f6fb",
      surface: "#ffffff",
      text: "#151a2b",
      muted: "#5a6379",
      border: "#dde2ee",
      "group-fill": "#edf0f9",
      "group-stroke": "#d3d9ea",
      "node-fill": "#ffffff",
      "node-stroke": "#818694",
      accent: "#4457e8",
      icon: "#5a6379",
      "table-head": "#edf0f9",
      card: "#ffffff",
      "card-stroke": "#dde2ee",
      shadow: "rgba(30, 41, 80, 0.16)",
      "label-bg": "#ffffff",
      "lane-fill-odd": "#edf0f9",
      "lane-header": "#e9edf5",
      "note-fill": "#edf0f9",
    },
    fam: {
      compute: ["#2d36be", "#e6e7f9"],
      data: ["#249889", "#e6f9f7"],
      messaging: ["#be702d", "#f9efe6"],
      client: ["#259c4c", "#e6f9ed"],
      external: ["#be2d6c", "#f9e6ee"],
      start: ["#259c4c", "#e6f9ed"],
      end: ["#be362d", "#f9e7e6"],
      decision: ["#a48227", "#f9f4e6"],
      wait: ["#966f55", "#f4efeb"],
      task: ["#2d6cbe", "#e6eef9"],
    },
    edge: { sync: "#1b5eda", async: "#803bce", data: "#1a9386", reply: "#606e80" },
  },
  dark: {
    mode: "dark",
    base: {
      bg: "#0f1219",
      surface: "#171b25",
      text: "#e8ecf6",
      muted: "#b8bfd0",
      border: "#2a3144",
      "group-fill": "#141824",
      "group-stroke": "#2a3144",
      "node-fill": "#1c2130",
      "node-stroke": "#676d7d",
      accent: "#7c8cff",
      icon: "#b8bfd0",
      "table-head": "#141824",
      card: "#1c2130",
      "card-stroke": "#2a3144",
      shadow: "rgba(0, 0, 0, 0.55)",
      "label-bg": "#1c2130",
      "lane-fill-odd": "#141824",
      "lane-header": "#0a0c11",
      "note-fill": "#141824",
    },
    fam: {
      compute: ["#7078eb", "#272a53"],
      data: ["#70ebda", "#27534d"],
      messaging: ["#eba970", "#533c27"],
      client: ["#70eb99", "#275336"],
      external: ["#eb70a5", "#53273a"],
      start: ["#70eb99", "#275336"],
      end: ["#eb7870", "#532a27"],
      decision: ["#ebca70", "#534727"],
      wait: ["#c9a892", "#473b33"],
      task: ["#70a5eb", "#273a53"],
    },
    edge: { sync: "#5a9ef6", async: "#be8ef6", data: "#4bd2c0", reply: "#9aa6b6" },
  },
  lagoon: {
    mode: "light",
    base: {
      bg: "#eaf6f6",
      surface: "#f9ffff",
      text: "#0e2a2e",
      muted: "#46666b",
      border: "#c3dfdf",
      "group-fill": "#dbefef",
      "group-stroke": "#b6d9d9",
      "node-fill": "#ffffff",
      "node-stroke": "#6c888a",
      accent: "#0b7f86",
      icon: "#46666b",
      "table-head": "#dbefef",
      card: "#ffffff",
      "card-stroke": "#c3dfdf",
      shadow: "rgba(30, 41, 80, 0.16)",
      "label-bg": "#ffffff",
      "lane-fill-odd": "#dbefef",
      "lane-header": "#dceeee",
      "note-fill": "#dbefef",
    },
    fam: {
      compute: ["#252c93", "#dfe0f6"],
      data: ["#259384", "#dff6f3"],
      messaging: ["#935825", "#f6eadf"],
      client: ["#259349", "#dff6e7"],
      external: ["#932554", "#f6dfe9"],
      start: ["#259349", "#dff6e7"],
      end: ["#932c25", "#f6e0df"],
      decision: ["#937625", "#f6f0df"],
      wait: ["#755743", "#f0eae5"],
      task: ["#255493", "#dfe9f6"],
    },
    edge: { sync: "#0d7ca0", async: "#6d39c6", data: "#218352", reply: "#5c757a" },
  },
  dusk: {
    mode: "dark",
    base: {
      bg: "#17132b",
      surface: "#1f1a38",
      text: "#f1efff",
      muted: "#c6c1e6",
      border: "#3a3066",
      "group-fill": "#1c1736",
      "group-stroke": "#3a3066",
      "node-fill": "#261f46",
      "node-stroke": "#756d97",
      accent: "#b08cff",
      icon: "#c6c1e6",
      "table-head": "#1c1736",
      card: "#261f46",
      "card-stroke": "#3a3066",
      shadow: "rgba(0, 0, 0, 0.55)",
      "label-bg": "#261f46",
      "lane-fill-odd": "#1c1736",
      "lane-header": "#100d21",
      "note-fill": "#1c1736",
    },
    fam: {
      compute: ["#757df0", "#262a59"],
      data: ["#75f0df", "#265952"],
      messaging: ["#f0ae75", "#593e26"],
      client: ["#75f09e", "#265937"],
      external: ["#f075aa", "#59263c"],
      start: ["#75f09e", "#265937"],
      end: ["#f07d75", "#592a26"],
      decision: ["#f0cf75", "#594c26"],
      wait: ["#cead97", "#4b3d34"],
      task: ["#75aaf0", "#263c59"],
    },
    edge: { sync: "#5fc1f2", async: "#e78bf9", data: "#4edab7", reply: "#a9a0ba" },
  },
};
