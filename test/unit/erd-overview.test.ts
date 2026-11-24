// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutDiagram } from "../../src/layout/index.js";
import { validateDiagram } from "../../src/model/index.js";
import { renderSvg } from "../../src/render/svg.js";
import { VIEWER_SCRIPT } from "../../src/render/viewer.js";

async function build(tables: object[]) {
  const { diagram, issues } = validateDiagram({ type: "erd", title: "Store", tables });
  expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  const scene = await layoutDiagram(diagram!);
  return { scene, out: renderSvg(scene) };
}
const svg = async (tables: object[]) => (await build(tables)).out;
const plain = (s: string) => s.replace(/<[^>]+>/g, "");

const tables = [
  { id: "users", note: "Accounts and profiles for every customer.", columns: ["id uuid pk"] },
  {
    id: "orders",
    note: "Purchases placed by customers.",
    columns: ["id uuid pk", "user_id uuid fk users.id null"],
  },
  { id: "payments", columns: ["id uuid pk", "order_id uuid fk orders.id"] },
];

describe("ERD overview", () => {
  it("draws counts, tiles, key relations and a table index below a multi-table ERD", async () => {
    const out = await svg(tables);
    expect(out).toContain('class="t-overview"');
    expect(out).toContain("3 tables · 5 columns · 2 relations");
    expect(out).toContain("KEY RELATIONS");
    expect(plain(out)).toContain("users 1:N orders · user_id (optional)");
    expect(plain(out)).toContain("orders 1:N payments · order_id");
    expect(out).toContain(">PK · FK</text>");
    expect(out).toContain(">3 · 2</text>");
    expect(out).toContain(">optional · self</text>");
    expect(out.match(/class="t-overview-tile"/g)).toHaveLength(5);
    expect(out).toContain("TABLE INDEX");
    expect(out).toContain("Accounts and profiles");
  });

  it("lists the referencing tables, not a count, and a dash when none", async () => {
    const out = await svg(tables);
    expect(out).toMatch(/t-overview-ref"[^>]*>orders<\/text>/);
    expect(out).toMatch(/t-overview-ref"[^>]*>payments<\/text>/);
    expect(out).toMatch(/t-overview-ref"[^>]*>—<\/text>/);
  });

  it("caps key relations at 6 with a +N more note", async () => {
    const chain = Array.from({ length: 9 }, (_, i) => ({
      id: `t${i}`,
      columns: i === 0 ? ["id int pk"] : [`id int pk`, `p int fk t${i - 1}.id`],
    }));
    const out = await svg(chain);
    expect(out).toContain("+2 more");
    expect(plain(out)).toContain("t0 1:N t1 · p");
    expect(plain(out)).not.toContain("t6 1:N t7");
    expect(await svg(tables)).not.toContain(" more<");
  });

  it("uses alternating soft rows instead of a rule under every row", async () => {
    const out = await svg(tables);
    expect(out.match(/class="t-overview-row"/g)).toHaveLength(1);
    expect(out).not.toContain('class="t-overview-rule" x1');
  });

  it("shows the Group column and family-order chips only when tables have groups", async () => {
    const none = await svg(tables);
    const grouped = await svg([
      { ...tables[0], group: "Identity" },
      { ...tables[1], group: "Commerce" },
      { ...tables[2], group: "Commerce" },
    ]);
    expect(none).not.toContain(">Group</text>");
    expect(none).not.toContain('class="t-overview-chip');
    expect(grouped).toContain(">Group</text>");
    expect(grouped).toContain('class="t-overview-chip t-fam-compute"');
    expect(grouped).toContain('class="t-overview-chip t-fam-data"');
    expect(grouped).toContain('class="t-node t-fam-compute t-shape-table t-tint"');
    // Group families are not node kinds: an ERD never gets a kind legend.
    expect(grouped).not.toContain("t-legend");
  });

  it("marks the header as an expandable viewer button with both heights", async () => {
    const out = await svg(tables);
    expect(out).toMatch(/data-overview-expanded-height="\d+(?:\.\d+)?"/);
    expect(out).toMatch(/data-overview-collapsed-height="\d+(?:\.\d+)?"/);
    expect(out).toMatch(/data-overview-panel-expanded="\d+/);
    expect(out).toMatch(/data-overview-panel-collapsed="\d+/);
    expect(out).toContain(
      'class="t-overview-control" role="button" tabindex="0" aria-expanded="true"',
    );
    expect(VIEWER_SCRIPT).toContain("data-overview-expanded-height");
    expect(VIEWER_SCRIPT).toContain("data-overview-panel-collapsed");
    expect(VIEWER_SCRIPT).toContain("aria-expanded");
    expect(VIEWER_SCRIPT).toContain("t-overview-body");
  });

  it("gives the header hit area an explicit transparent fill, not the SVG default black", async () => {
    const out = await svg(tables);
    expect(out).toContain('<rect class="t-overview-hit"');
    expect(out).toMatch(/\.t-overview-hit \{ fill: var\(--t-bg, #[0-9a-f]{6}\); fill-opacity: 0;/);
    expect(out).toMatch(/\.t-overview-control:hover \.t-overview-hit \{ fill-opacity: 0\.6;/);
    expect(out).toMatch(/\.t-overview-control:focus-visible \.t-overview-hit \{[^}]*stroke:/);
  });

  it("omits the overview for a single-table ERD", async () => {
    const out = await svg([{ id: "users", columns: ["id uuid pk"] }]);
    expect(out).not.toContain("t-overview");
    expect(out).not.toContain("TABLE INDEX");
  });

  it("stays compact: the example grows by at most 66% of the diagram height", async () => {
    const { diagram } = validateDiagram(
      JSON.parse(readFileSync(new URL("../../examples/erd.json", import.meta.url), "utf8")),
    );
    const scene = await layoutDiagram(diagram!);
    expect(scene.height - 498.5).toBeLessThanOrEqual(498.5 * 0.66);
  });
});
