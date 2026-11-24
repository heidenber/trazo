// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Scene, SceneNode } from "../scene.js";

export const FAMILIES = [
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
] as const;

export type Family = (typeof FAMILIES)[number];

const ARCHITECTURE: Record<string, Family> = {
  database: "data",
  storage: "data",
  cache: "data",
  queue: "messaging",
  client: "client",
  user: "client",
  external: "external",
};

// Sequence participants reuse the architecture families.
const SEQUENCE: Record<string, Family> = { ...ARCHITECTURE, actor: "client" };

const WORKFLOW: Record<string, Family> = {
  start: "start",
  end: "end",
  decision: "decision",
  wait: "wait",
};

// Chen: one family per element type, drawn from the same palette as the other diagrams.
const CHEN: Partial<Record<SceneNode["shape"], Family>> = {
  entity: "compute",
  "weak-entity": "compute",
  relationship: "messaging",
  identifying: "messaging",
  attribute: "data",
  multivalued: "data",
};

/** Color family of a node; notes and ERD tables have none. */
export function familyOf(scene: Scene, node: SceneNode): Family | undefined {
  if ((FAMILIES as readonly string[]).includes(node.family ?? "")) return node.family as Family;
  if (node.shape === "note" || node.shape === "table") return undefined;
  switch (scene.type) {
    case "chen":
      return CHEN[node.shape];
    case "workflow":
      return WORKFLOW[node.kind] ?? "task";
    case "sequence":
      return SEQUENCE[node.kind] ?? "compute";
    case "architecture":
      return ARCHITECTURE[node.kind] ?? "compute";
    default:
      return undefined;
  }
}
