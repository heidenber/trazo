// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { make } from "../../src/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderSvg } from "../../src/render/svg.js";

const text = readFileSync(new URL("../../examples/architecture.json", import.meta.url), "utf8");

describe("examples/architecture.json", () => {
  it("validates with no issues", () => {
    const { issues } = validateDiagram(JSON.parse(text));
    expect(issues).toEqual([]);
  });

  it("renders the expected SVG", async () => {
    const { diagram } = validateDiagram(JSON.parse(text));
    const svg = renderSvg(await layoutDiagram(diagram!));
    await expect(svg).toMatchFileSnapshot("../__snapshots__/architecture.svg");
  });

  it("makes byte-identical html twice and stays small", async () => {
    const first = await make(text);
    const second = await make(text);
    expect(first.ok).toBe(true);
    expect(first.html).toBe(second.html);
    expect(Buffer.byteLength(first.html!)).toBeLessThan(300 * 1024);
  });
});

const workflowText = readFileSync(new URL("../../examples/workflow.json", import.meta.url), "utf8");

describe("examples/workflow.json", () => {
  it("validates with no issues", () => {
    const { issues } = validateDiagram(JSON.parse(workflowText));
    expect(issues).toEqual([]);
  });

  it("renders the expected SVG", async () => {
    const { diagram } = validateDiagram(JSON.parse(workflowText));
    const svg = renderSvg(await layoutDiagram(diagram!));
    await expect(svg).toMatchFileSnapshot("../__snapshots__/workflow.svg");
  });

  it("makes byte-identical html twice and stays small", async () => {
    const first = await make(workflowText);
    const second = await make(workflowText);
    expect(first.ok).toBe(true);
    expect(first.html).toBe(second.html);
    expect(Buffer.byteLength(first.html!)).toBeLessThan(300 * 1024);
  });
});

const erdText = readFileSync(new URL("../../examples/erd.json", import.meta.url), "utf8");

describe("examples/erd.json", () => {
  it("validates with no issues", () => {
    const { issues } = validateDiagram(JSON.parse(erdText));
    expect(issues).toEqual([]);
  });

  it("renders the expected SVG", async () => {
    const { diagram } = validateDiagram(JSON.parse(erdText));
    const svg = renderSvg(await layoutDiagram(diagram!));
    await expect(svg).toMatchFileSnapshot("../__snapshots__/erd.svg");
  });

  it("makes byte-identical html twice and stays small", async () => {
    const first = await make(erdText);
    const second = await make(erdText);
    expect(first.ok).toBe(true);
    expect(first.html).toBe(second.html);
    expect(Buffer.byteLength(first.html!)).toBeLessThan(300 * 1024);
  });
});

const sequenceText = readFileSync(new URL("../../examples/sequence.json", import.meta.url), "utf8");

describe("examples/sequence.json", () => {
  it("validates with no issues", () => {
    const { issues } = validateDiagram(JSON.parse(sequenceText));
    expect(issues).toEqual([]);
  });

  it("renders the expected SVG", async () => {
    const { diagram } = validateDiagram(JSON.parse(sequenceText));
    const svg = renderSvg(await layoutDiagram(diagram!));
    await expect(svg).toMatchFileSnapshot("../__snapshots__/sequence.svg");
  });

  it("makes byte-identical html twice and stays small", async () => {
    const first = await make(sequenceText);
    const second = await make(sequenceText);
    expect(first.ok).toBe(true);
    expect(first.html).toBe(second.html);
    expect(Buffer.byteLength(first.html!)).toBeLessThan(300 * 1024);
  });
});

const chenText = readFileSync(new URL("../../examples/chen.json", import.meta.url), "utf8");

describe("examples/chen.json", () => {
  it("validates with no issues", () => {
    const { issues } = validateDiagram(JSON.parse(chenText));
    expect(issues).toEqual([]);
  });

  it("renders the expected SVG", async () => {
    const { diagram } = validateDiagram(JSON.parse(chenText));
    const svg = renderSvg(await layoutDiagram(diagram!));
    await expect(svg).toMatchFileSnapshot("../__snapshots__/chen.svg");
  });

  it("makes byte-identical html twice and stays small", async () => {
    const first = await make(chenText);
    const second = await make(chenText);
    expect(first.ok).toBe(true);
    expect(first.html).toBe(second.html);
    expect(Buffer.byteLength(first.html!)).toBeLessThan(300 * 1024);
  });
});
