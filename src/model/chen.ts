// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import type { Issue } from "../validate/issues.js";
import { IdRegistry } from "../validate/refs.js";
import { error_, idSchema, textSchema, themeSchema, warning, type ThemeName } from "./common.js";

export type ChenAttributeKind = "simple" | "key" | "partial" | "multivalued" | "derived";
export type Cardinality = "1" | "N" | "M";

export interface ChenAttribute {
  name: string;
  /** "simple" is a plain attribute; a composite is any attribute with children. */
  kind: ChenAttributeKind;
  children: ChenAttribute[];
}

export interface ChenEntity {
  id: string;
  label: string;
  weak: boolean;
  note?: string;
  /** Longer text for the viewer's detail card only; never drawn in the SVG. */
  detail?: string;
  attributes: ChenAttribute[];
}

export interface ChenParticipant {
  entity: string;
  cardinality: Cardinality;
  total: boolean;
}

export interface ChenRelationship {
  id: string;
  label: string;
  identifying: boolean;
  note?: string;
  attributes: ChenAttribute[];
  /** Always exactly two; a recursive relationship names the same entity twice. */
  participants: [ChenParticipant, ChenParticipant];
}

export interface Chen {
  type: "chen";
  title: string;
  description?: string;
  theme: ThemeName;
  entities: ChenEntity[];
  relationships: ChenRelationship[];
}

// ---------------------------------------------------------------------------
// Schema

const KINDS = ["key", "partial", "multivalued", "derived"] as const;
const CARDINALITIES = ["1", "N", "M"] as const;

interface RawAttribute {
  name: string;
  kind?: (typeof KINDS)[number] | undefined;
  children?: RawAttribute[] | undefined;
}

// A bare string is a simple attribute; both forms share one path through the rules.
const attributeSchema: z.ZodType<RawAttribute, unknown> = z.lazy(() =>
  z.preprocess(
    (value) => (typeof value === "string" ? { name: value } : value),
    z.strictObject({
      name: textSchema,
      kind: z.enum(KINDS).optional(),
      children: z.array(attributeSchema).min(1).optional(),
    }),
  ),
);

export const chenSchema = z.strictObject({
  type: z.literal("chen"),
  title: textSchema,
  description: textSchema.optional(),
  theme: themeSchema.optional(),
  entities: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        weak: z.boolean().optional(),
        note: textSchema.optional(),
        detail: textSchema.optional(),
        attributes: z.array(attributeSchema),
      }),
    )
    .min(1),
  relationships: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        identifying: z.boolean().optional(),
        note: textSchema.optional(),
        attributes: z.array(attributeSchema).optional(),
        participants: z.array(
          z.strictObject({
            entity: idSchema,
            cardinality: z.enum(CARDINALITIES),
            total: z.boolean().optional(),
          }),
        ),
      }),
    )
    .optional(),
});

type Parsed = z.output<typeof chenSchema>;

/** Composite attributes may nest this many levels of children. */
const MAX_DEPTH = 2;

type Owner = "entity" | "relationship";

interface Context {
  issues: Issue[];
  owner: Owner;
  /** Id of the entity or relationship that owns the attributes. */
  ownerId: string;
  weak: boolean;
}

function checkAttributes(list: RawAttribute[], path: string, depth: number, ctx: Context): void {
  const first = new Map<string, number>();
  list.forEach((attribute, i) => {
    const here = `${path}[${i}]`;
    const previous = first.get(attribute.name);
    if (previous === undefined) first.set(attribute.name, i);
    else {
      ctx.issues.push(
        error_(
          "chen/duplicate-attribute",
          here,
          `duplicate attribute "${attribute.name}"`,
          `first used at ${path}[${previous}]`,
        ),
      );
    }

    const { kind } = attribute;
    const composite = attribute.children !== undefined;
    if (kind === "partial" && ctx.owner === "entity" && depth === 0 && !composite) {
      if (!ctx.weak) {
        ctx.issues.push(
          error_(
            "chen/partial-key",
            `${here}.kind`,
            `partial key "${attribute.name}" needs a weak entity, and "${ctx.ownerId}" is not weak`,
            'mark the entity "weak": true, or use kind "key"',
          ),
        );
      }
    } else if (kind === "key" && ctx.owner === "entity" && depth === 0 && !composite) {
      if (ctx.weak) {
        ctx.issues.push(
          error_(
            "chen/key-on-weak",
            `${here}.kind`,
            `weak entity "${ctx.ownerId}" cannot have key attribute "${attribute.name}"`,
            'use kind "partial" for the attribute that tells its instances apart',
          ),
        );
      }
    } else if (composite && kind !== undefined && kind !== "multivalued") {
      ctx.issues.push(
        error_(
          "chen/attribute-kind",
          `${here}.kind`,
          `a composite attribute cannot have kind "${kind}"`,
          'only "multivalued" combines with children',
        ),
      );
    } else if ((kind === "key" || kind === "partial") && ctx.owner === "relationship") {
      ctx.issues.push(
        error_(
          "chen/attribute-kind",
          `${here}.kind`,
          `kind "${kind}" is not allowed on a relationship attribute`,
          'use a plain, "multivalued" or "derived" attribute',
        ),
      );
    } else if ((kind === "key" || kind === "partial") && depth > 0) {
      ctx.issues.push(
        error_(
          "chen/attribute-kind",
          `${here}.kind`,
          `kind "${kind}" is not allowed on a part of a composite attribute`,
          'use a plain, "multivalued" or "derived" attribute',
        ),
      );
    }

    if (attribute.children !== undefined) {
      if (depth >= MAX_DEPTH) {
        ctx.issues.push(
          error_(
            "chen/nesting",
            `${here}.children`,
            `composite attributes nest at most ${MAX_DEPTH} levels deep`,
            "flatten the parts",
          ),
        );
      } else {
        checkAttributes(attribute.children, `${here}.children`, depth + 1, ctx);
      }
    }
  });
}

function toAttribute(raw: RawAttribute): ChenAttribute {
  return {
    name: raw.name,
    kind: raw.kind ?? "simple",
    children: (raw.children ?? []).map(toAttribute),
  };
}

function hasKind(list: RawAttribute[], kind: string): boolean {
  return list.some((attribute) => attribute.kind === kind);
}

export function buildChen(input: Parsed): { diagram?: Chen; issues: Issue[] } {
  const issues: Issue[] = [];
  const relationships = input.relationships ?? [];

  const ids = new IdRegistry(issues, { noun: "entity", code: "ref/unknown-entity" });
  input.entities.forEach((entity, e) => ids.claim(entity.id, `entities[${e}].id`));
  relationships.forEach((relationship, r) => ids.claim(relationship.id, `relationships[${r}].id`));
  const entityIds = new Set(input.entities.map((entity) => entity.id));
  const weakIds = new Set(
    input.entities.filter((entity) => entity.weak).map((entity) => entity.id),
  );

  input.entities.forEach((entity, e) => {
    checkAttributes(entity.attributes, `entities[${e}].attributes`, 0, {
      issues,
      owner: "entity",
      ownerId: entity.id,
      weak: entity.weak === true,
    });
  });

  // Weak entities that some identifying relationship reaches with total participation.
  const identified = new Set<string>();
  relationships.forEach((relationship, r) => {
    const path = `relationships[${r}]`;
    checkAttributes(relationship.attributes ?? [], `${path}.attributes`, 0, {
      issues,
      owner: "relationship",
      ownerId: relationship.id,
      weak: false,
    });

    const count = relationship.participants.length;
    if (count > 2) {
      issues.push(
        error_(
          "chen/ternary",
          `${path}.participants`,
          `ternary relationships are not supported yet (found ${count} participants, expected 2)`,
          "use two participants, or model it as two binary relationships with an entity of its own",
        ),
      );
    } else if (count < 2) {
      issues.push(
        error_(
          "chen/participants",
          `${path}.participants`,
          `a relationship needs exactly 2 participants, found ${count}`,
          "name two entities; a recursive relationship may name the same entity twice",
        ),
      );
    }

    let known = true;
    relationship.participants.forEach((participant, p) => {
      if (ids.unknown(participant.entity, `${path}.participants[${p}].entity`, entityIds))
        known = false;
    });

    if (relationship.identifying === true && known && count === 2) {
      if (!relationship.participants.some((participant) => weakIds.has(participant.entity))) {
        issues.push(
          error_(
            "chen/identifying-no-weak",
            path,
            `identifying relationship "${relationship.id}" must involve a weak entity`,
            'mark an entity "weak": true, or remove "identifying"',
          ),
        );
      }
      for (const participant of relationship.participants) {
        if (participant.total === true && weakIds.has(participant.entity))
          identified.add(participant.entity);
      }
    }
  });

  input.entities.forEach((entity, e) => {
    const path = `entities[${e}]`;
    if (entity.weak === true) {
      if (!identified.has(entity.id)) {
        issues.push(
          error_(
            "chen/weak-not-identified",
            path,
            `weak entity "${entity.id}" must take part in an identifying relationship with total participation`,
            `add a relationship with "identifying": true and "total": true on "${entity.id}"`,
          ),
        );
      }
      if (!hasKind(entity.attributes, "partial")) {
        issues.push(
          warning(
            "chen/no-partial-key",
            path,
            `weak entity "${entity.id}" has no partial key`,
            'mark the attribute that tells its instances apart kind "partial"',
          ),
        );
      }
    } else if (!hasKind(entity.attributes, "key")) {
      issues.push(
        warning(
          "chen/no-key",
          path,
          `entity "${entity.id}" has no key attribute`,
          'mark one attribute kind "key"',
        ),
      );
    }
  });

  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const diagram: Chen = {
    type: "chen",
    title: input.title,
    theme: input.theme ?? "light",
    entities: input.entities.map((entity) => {
      const out: ChenEntity = {
        id: entity.id,
        label: entity.label ?? entity.id,
        weak: entity.weak ?? false,
        attributes: entity.attributes.map(toAttribute),
      };
      if (entity.note !== undefined) out.note = entity.note;
      if (entity.detail !== undefined) out.detail = entity.detail;
      return out;
    }),
    relationships: relationships.map((relationship) => {
      const [a, b] = relationship.participants.map((participant): ChenParticipant => ({
        entity: participant.entity,
        cardinality: participant.cardinality,
        total: participant.total ?? false,
      })) as [ChenParticipant, ChenParticipant];
      const out: ChenRelationship = {
        id: relationship.id,
        label: relationship.label ?? relationship.id,
        identifying: relationship.identifying ?? false,
        attributes: (relationship.attributes ?? []).map(toAttribute),
        participants: [a, b],
      };
      if (relationship.note !== undefined) out.note = relationship.note;
      return out;
    }),
  };
  if (input.description !== undefined) diagram.description = input.description;
  return { diagram, issues };
}
