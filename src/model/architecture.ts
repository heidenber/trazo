// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import type { Issue } from "../validate/issues.js";
import { IdRegistry } from "../validate/refs.js";
import { edgeSchema, error_, idSchema, textSchema, themeSchema, warning } from "./common.js";

export const NODE_KINDS = [
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
] as const;

export type NodeKind = (typeof NODE_KINDS)[number];
export type EdgeStyle = "sync" | "async" | "data";

export interface ArchNode {
  id: string;
  label: string;
  kind: NodeKind;
  note?: string;
  source?: string;
}

export interface ArchGroup {
  id: string;
  label: string;
  children: string[];
}

export interface ArchEdge {
  from: string;
  to: string;
  label?: string;
  style: EdgeStyle;
}

export interface Architecture {
  type: "architecture";
  title: string;
  description?: string;
  theme: "light" | "dark";
  direction: "right" | "down";
  nodes: ArchNode[];
  groups: ArchGroup[];
  edges: ArchEdge[];
}

const archEdge = edgeSchema("architecture", ["->", "~>"], ["sync", "async", "data"]);

export const architectureSchema = z.strictObject({
  type: z.literal("architecture"),
  title: textSchema,
  description: textSchema.optional(),
  theme: themeSchema.optional(),
  direction: z.enum(["right", "down"]).optional(),
  nodes: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        kind: z.enum(NODE_KINDS).optional(),
        note: textSchema.optional(),
        source: textSchema.optional(),
      }),
    )
    .min(1),
  groups: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        children: z.array(idSchema).min(1),
      }),
    )
    .optional(),
  edges: z.array(archEdge).optional(),
});

type Parsed = z.output<typeof architectureSchema>;

const LARGE_DIAGRAM = 60;

export function buildArchitecture(input: Parsed): { diagram?: Architecture; issues: Issue[] } {
  const issues: Issue[] = [];
  const ids = new IdRegistry(issues, { noun: "node", code: "ref/unknown-node" });
  const groupIds = new Set<string>();

  input.nodes.forEach((node, i) => ids.claim(node.id, `nodes[${i}].id`));
  (input.groups ?? []).forEach((group, i) => {
    ids.claim(group.id, `groups[${i}].id`);
    groupIds.add(group.id);
  });

  const unknownNode = (id: string, path: string) => ids.unknown(id, path);

  // A child keeps its first parent; walking up from the new parent tells us
  // whether adopting a group would close a loop.
  const parentOf = new Map<string, string>();
  (input.groups ?? []).forEach((group, g) => {
    group.children.forEach((child, c) => {
      const path = `groups[${g}].children[${c}]`;
      if (unknownNode(child, path)) return;
      const existing = parentOf.get(child);
      if (existing !== undefined) {
        issues.push(
          error_(
            "group/multiple-parents",
            path,
            `"${child}" is already inside group "${existing}"`,
            "a node belongs to one group; nest groups instead",
          ),
        );
        return;
      }
      if (groupIds.has(child)) {
        for (let up: string | undefined = group.id; up !== undefined; up = parentOf.get(up)) {
          if (up === child) {
            issues.push(error_("group/cycle", path, `group "${child}" would end up inside itself`));
            return;
          }
        }
      }
      parentOf.set(child, group.id);
    });
  });

  const edges: ArchEdge[] = [];
  const seen = new Map<string, number>();
  (input.edges ?? []).forEach((edge, i) => {
    const badFrom = unknownNode(edge.from, `edges[${i}].from`);
    const badTo = unknownNode(edge.to, `edges[${i}].to`);
    if (badFrom || badTo) return;
    const out: ArchEdge = { from: edge.from, to: edge.to, style: edge.style ?? "sync" };
    if (edge.label !== undefined) out.label = edge.label;
    const key = JSON.stringify([out.from, out.to, out.label ?? null, out.style]);
    const first = seen.get(key);
    if (first !== undefined)
      issues.push(warning("edge/duplicate", `edges[${i}]`, `same as edges[${first}]`));
    else seen.set(key, i);
    edges.push(out);
  });

  if (input.nodes.length > LARGE_DIAGRAM) {
    issues.push(
      warning(
        "size/large",
        "nodes",
        `${input.nodes.length} nodes`,
        `diagrams read best under ${LARGE_DIAGRAM} nodes; consider splitting by area`,
      ),
    );
  }

  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const diagram: Architecture = {
    type: "architecture",
    title: input.title,
    theme: input.theme ?? "light",
    direction: input.direction ?? "right",
    nodes: input.nodes.map((node) => {
      const out: ArchNode = {
        id: node.id,
        label: node.label ?? node.id,
        kind: node.kind ?? "service",
      };
      if (node.note !== undefined) out.note = node.note;
      if (node.source !== undefined) out.source = node.source;
      return out;
    }),
    groups: (input.groups ?? []).map((group) => ({
      id: group.id,
      label: group.label ?? group.id,
      children: group.children,
    })),
    edges,
  };
  if (input.description !== undefined) diagram.description = input.description;
  return { diagram, issues };
}
