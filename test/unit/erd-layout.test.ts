// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import type { Erd } from "../../src/model/erd.js";
import { validateDiagram } from "../../src/model/index.js";
import type { Box, Point, Scene, SceneEdge, SceneNode } from "../../src/scene.js";

function erd(raw: object): Erd {
  const { diagram, issues } = validateDiagram({ type: "erd", title: "T", ...raw });
  expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  if (diagram?.type !== "erd") throw new Error("expected an erd");
  return diagram;
}

const shop = () =>
  erd({
    tables: [
      { id: "users", columns: ["id uuid pk", "email text unique", "name text null"] },
      { id: "orders", columns: ["id uuid pk", "user_id uuid fk users.id", "created_at timestamp with time zone"] },
      { id: "payments", columns: ["id uuid pk", "order_id uuid fk orders.id unique", "amount numeric(10, 2)"] },
      { id: "categories", columns: ["id int pk", "parent_id int fk categories.id null", "name text"] },
    ],
  });

// users.last_order_id closes a cycle with orders.user_id.
const cyclic = () =>
  erd({
    tables: [
      { id: "users", columns: ["id uuid pk", "last_order_id uuid fk orders.id null"] },
      { id: "orders", columns: ["id uuid pk", "user_id uuid fk users.id"] },
      { id: "items", columns: ["id uuid pk", "order_id uuid fk orders.id"] },
    ],
  });

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function rowCentre(node: SceneNode, column: string): number {
  const row = node.rows!.find((r) => r.name.lines[0] === column)!;
  return row.y + row.h / 2;
}

const byId = (scene: Scene, id: string) => scene.nodes.find((n) => n.id === id)!;
const edge = (scene: Scene, id: string) => scene.edges.find((e) => e.id === id)!;
const first = (e: SceneEdge): Point => e.points[0]!;
const last = (e: SceneEdge): Point => e.points[e.points.length - 1]!;

function onSide(p: Point, node: SceneNode): "left" | "right" | undefined {
  if (Math.abs(p.x - node.x) <= 1) return "left";
  if (Math.abs(p.x - (node.x + node.w)) <= 1) return "right";
  return undefined;
}

describe("erd layout", () => {
  it("is reachable through layoutDiagram", async () => {
    const scene = await layoutDiagram(shop());
    expect(scene.type).toBe("erd");
    expect(scene.nodes.map((n) => n.id)).toEqual(["users", "orders", "payments", "categories"]);
    expect(scene.nodes.every((n) => n.shape === "table")).toBe(true);
  });

  it("keeps note and source on the table node", async () => {
    const scene = await layoutDiagram(
      erd({
        tables: [
          { id: "users", note: "people", source: "db/migrations/001_users.sql:1", columns: ["id uuid pk"] },
          { id: "orders", columns: ["id uuid pk"] },
        ],
      }),
    );
    expect(byId(scene, "users")).toMatchObject({ note: "people", source: "db/migrations/001_users.sql:1" });
    expect("source" in byId(scene, "orders")).toBe(false);
  });

  it("builds one row per column with type, nullable mark and key marks", async () => {
    const scene = await layoutDiagram(shop());
    const users = byId(scene, "users");
    expect(users.header).toBe(32);
    expect(users.h).toBe(32 + 3 * 24);
    expect(users.label.lines).toEqual(["users"]);
    const rows = users.rows!.map((r) => [r.name.lines[0], r.type.lines[0], r.marks?.lines[0], r.key]);
    expect(rows).toEqual([
      ["id", "uuid", "PK", true],
      ["email", "text", "UQ", false],
      ["name", "text?", undefined, false],
    ]);
    const payments = byId(scene, "payments");
    expect(payments.rows![1]!.marks?.lines[0]).toBe("FK UQ");
    expect(users.rows!.map((r) => r.y)).toEqual([users.y + 32, users.y + 56, users.y + 80]);
  });

  it("aligns names, types and marks in columns inside a table", async () => {
    const scene = await layoutDiagram(shop());
    const orders = byId(scene, "orders");
    const rows = orders.rows!;
    expect(new Set(rows.map((r) => r.name.x)).size).toBe(1);
    expect(new Set(rows.map((r) => r.type.x)).size).toBe(1);
    expect(rows.every((r) => r.type.x > r.name.x)).toBe(true);
  });

  it("keeps tables apart", async () => {
    const scene = await layoutDiagram(shop());
    for (const a of scene.nodes) for (const b of scene.nodes) if (a !== b) expect(overlaps(a, b)).toBe(false);
  });

  it("derives relation ids, ends and a crow's foot instead of an arrow", async () => {
    const scene = await layoutDiagram(shop());
    const e = edge(scene, "orders.user_id");
    expect([e.from, e.to]).toEqual(["orders", "users"]);
    expect(e.ends).toEqual({ from: "zero-or-many", to: "one" });
    expect(edge(scene, "payments.order_id").ends).toEqual({ from: "zero-or-one", to: "one" });
  });

  for (const [name, build] of [
    ["acyclic", shop],
    ["cyclic", cyclic],
  ] as const) {
    it(`starts and ends every relation at its rows (${name})`, async () => {
      const scene = await layoutDiagram(build());
      for (const e of scene.edges) {
        const [table, column] = e.id.split(".") as [string, string];
        const relation = build().relations.find((r) => r.id === e.id)!;
        const from = byId(scene, table);
        const to = byId(scene, relation.to);
        expect(Math.abs(first(e).y - rowCentre(from, column))).toBeLessThanOrEqual(1);
        expect(Math.abs(last(e).y - rowCentre(to, relation.toColumn))).toBeLessThanOrEqual(1);
        expect(onSide(first(e), from)).toBeDefined();
        expect(onSide(last(e), to)).toBeDefined();
      }
    });

    it(`ends every relation with straight runs of at least 20 px (${name})`, async () => {
      const scene = await layoutDiagram(build());
      for (const e of scene.edges) {
        const [a, b] = [e.points[0]!, e.points[1]!];
        const [c, d] = [e.points[e.points.length - 2]!, last(e)];
        expect(a.y).toBe(b.y);
        expect(c.y).toBe(d.y);
        expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(20);
        expect(Math.abs(c.x - d.x)).toBeGreaterThanOrEqual(20);
      }
    });

    it(`routes orthogonally without crossing a table (${name})`, async () => {
      const scene = await layoutDiagram(build());
      for (const e of scene.edges) {
        for (let i = 1; i < e.points.length; i++) {
          const [p, q] = [e.points[i - 1]!, e.points[i]!];
          expect(p.x === q.x || p.y === q.y).toBe(true);
          for (const n of scene.nodes) {
            const inside = {
              x: n.x + 1,
              y: n.y + 1,
              w: n.w - 2,
              h: n.h - 2,
            };
            const seg = { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), w: Math.abs(p.x - q.x), h: Math.abs(p.y - q.y) };
            expect(overlaps({ ...seg, w: Math.max(seg.w, 0.01), h: Math.max(seg.h, 0.01) }, inside), `${e.id} crosses ${n.id}`).toBe(false);
          }
        }
      }
    });
  }

  it("leaves from the side facing the referenced table, also on the reversed edge of a cycle", async () => {
    const scene = await layoutDiagram(cyclic());
    for (const e of scene.edges) {
      const from = byId(scene, e.from);
      const to = byId(scene, e.to);
      if (to.x >= from.x + from.w) {
        expect([onSide(first(e), from), onSide(last(e), to)]).toEqual(["right", "left"]);
      } else if (to.x + to.w <= from.x) {
        expect([onSide(first(e), from), onSide(last(e), to)]).toEqual(["left", "right"]);
      }
    }
    // The child is laid out left of the table it references.
    expect(byId(scene, "items").x).toBeLessThan(byId(scene, "orders").x);
  });

  it("draws a self-reference as a loop on the right side", async () => {
    const scene = await layoutDiagram(shop());
    const table = byId(scene, "categories");
    const e = edge(scene, "categories.parent_id");
    const right = table.x + table.w;
    expect(first(e)).toEqual({ x: right, y: rowCentre(table, "parent_id") });
    expect(last(e)).toEqual({ x: right, y: rowCentre(table, "id") });
    expect(Math.max(...e.points.map((p) => p.x))).toBeGreaterThanOrEqual(right + 20);
    expect(scene.width).toBeGreaterThan(Math.max(...e.points.map((p) => p.x)));
  });

  it("is deterministic", async () => {
    const a = await layoutDiagram(cyclic());
    const b = await layoutDiagram(cyclic());
    expect(a).toEqual(b);
  });
});
