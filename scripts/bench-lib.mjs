// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

// Pure helpers for scripts/bench.mjs: no I/O, no clock, no randomness.

const NODE_KINDS = [
  "client",
  "user",
  "gateway",
  "service",
  "function",
  "database",
  "cache",
  "queue",
  "storage",
  "external",
];

export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

export function median(numbers) {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** A fixed architecture diagram of n nodes in 5 groups, the same on every call. */
export function synthArchitecture(n = 50) {
  const size = Math.floor(n / 5);
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: `n${i}`, label: `Node ${i}`, kind: NODE_KINDS[i % NODE_KINDS.length] });
  }
  const groups = [];
  for (let g = 0; g < 5; g++) {
    const children = [];
    const end = g === 4 ? n : (g + 1) * size;
    for (let i = g * size; i < end; i++) children.push(`n${i}`);
    groups.push({ id: `g${g}`, label: `Group ${g}`, children });
  }
  const pairs = [];
  const seen = new Set();
  const add = (from, to) => {
    if (from === to || from >= n || to >= n || seen.has(`${from}>${to}`)) return;
    seen.add(`${from}>${to}`);
    pairs.push([from, to]);
  };
  for (const group of groups) {
    const ids = group.children.map((c) => Number(c.slice(1)));
    for (let k = 0; k + 1 < ids.length; k++) add(ids[k], ids[k + 1]);
  }
  for (let k = 0; k < 4; k++) add(size * k + size - 1, size * (k + 1));
  for (let i = 0; i < n; i += 4) add(i, (7 * i + 3) % n);
  const edges = pairs.map(([from, to], idx) =>
    idx % 5 === 0 ? `n${from} -> n${to}: call ${idx}` : `n${from} -> n${to}`,
  );
  return {
    type: "architecture",
    title: `Synthetic architecture, ${n} nodes`,
    theme: "light",
    nodes,
    groups,
    edges,
  };
}

/** Groups agent runs by condition and reduces each group to its headline numbers. */
export function summarize(runs) {
  const byCondition = {};
  for (const run of runs) (byCondition[run.condition] ??= []).push(run);
  const out = {};
  for (const [condition, list] of Object.entries(byCondition)) {
    out[condition] = {
      runs: list.length,
      firstTryRate: list.filter((r) => r.firstTryOk).length / list.length,
      finalRate: list.filter((r) => r.finalOk).length / list.length,
      medianRepairs: median(list.map((r) => r.repairs)),
      medianInputTokens: median(list.map((r) => r.inputTokens)),
      // Uncached input is tiny with prompt caching; the total is what the run actually read.
      medianTotalInputTokens: median(
        list.map((r) => r.inputTokens + (r.cacheCreationTokens ?? 0) + (r.cacheReadTokens ?? 0)),
      ),
      medianOutputTokens: median(list.map((r) => r.outputTokens)),
      medianSeconds: median(list.map((r) => r.seconds)),
    };
  }
  return out;
}
