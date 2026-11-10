// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { validateDiagram } from "../../src/model/index.js";
import type { Architecture } from "../../src/model/architecture.js";
import type { Issue } from "../../src/validate/issues.js";

const base = {
  type: "architecture",
  title: "Checkout",
  nodes: [
    { id: "web", label: "Web App", kind: "client" },
    { id: "api", kind: "service" },
    { id: "db", kind: "database" },
    { id: "queue", kind: "queue" },
  ],
};

function errors(raw: unknown): Issue[] {
  return validateDiagram(raw).issues.filter((i) => i.severity === "error");
}

function only(raw: unknown): Issue {
  const found = errors(raw);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe("architecture: valid input", () => {
  it("applies defaults for label, kind and edge style", () => {
    const { diagram, issues } = validateDiagram({
      type: "architecture",
      title: "T",
      nodes: [{ id: "api" }, { id: "db", kind: "database" }],
      edges: ["api -> db"],
    });
    expect(issues).toEqual([]);
    expect(diagram).toEqual({
      type: "architecture",
      title: "T",
      theme: "light",
      direction: "right",
      nodes: [
        { id: "api", label: "api", kind: "service" },
        { id: "db", label: "db", kind: "database" },
      ],
      groups: [],
      edges: [{ from: "api", to: "db", style: "sync" }],
    });
  });

  it("reads the edge shorthand", () => {
    const { diagram, issues } = validateDiagram({
      ...base,
      edges: ["web -> api: HTTPS", "api ~> queue: order.created", "api->db:SQL"],
    });
    expect(issues).toEqual([]);
    expect((diagram as Architecture | undefined)?.edges).toEqual([
      { from: "web", to: "api", label: "HTTPS", style: "sync" },
      { from: "api", to: "queue", label: "order.created", style: "async" },
      { from: "api", to: "db", label: "SQL", style: "sync" },
    ]);
  });

  it("treats the shorthand and the object form the same way", () => {
    const short = validateDiagram({ ...base, edges: ["api ~> queue: event"] });
    const long = validateDiagram({
      ...base,
      edges: [{ from: "api", to: "queue", label: "event", style: "async" }],
    });
    expect(short).toEqual(long);
  });

  it("accepts ids with dashes in the shorthand", () => {
    const { diagram, issues } = validateDiagram({
      type: "architecture",
      title: "T",
      nodes: [{ id: "api-gw" }, { id: "auth-svc" }],
      edges: ["api-gw->auth-svc: verify"],
    });
    expect(issues).toEqual([]);
    expect((diagram as Architecture | undefined)?.edges[0]).toEqual({
      from: "api-gw",
      to: "auth-svc",
      label: "verify",
      style: "sync",
    });
  });

  it("accepts nested groups and edges that touch a group", () => {
    const { issues } = validateDiagram({
      ...base,
      groups: [
        { id: "vpc", label: "VPC", children: ["private"] },
        { id: "private", label: "Private subnet", children: ["api", "db"] },
      ],
      edges: ["web -> vpc: HTTPS"],
    });
    expect(issues).toEqual([]);
  });
});

describe("architecture: document level", () => {
  it("rejects input that is not an object", () => {
    expect(only([1, 2])).toEqual({
      severity: "error",
      code: "schema/type",
      path: "$",
      message: "expected an object, got array",
    });
  });

  it("requires a type", () => {
    expect(only({ title: "T", nodes: [] })).toEqual({
      severity: "error",
      code: "schema/required",
      path: "type",
      message: "missing",
      hint: "use one of: architecture, workflow, erd, sequence",
    });
  });

  it("suggests the closest diagram type", () => {
    expect(only({ ...base, type: "architecure" })).toEqual({
      severity: "error",
      code: "schema/enum",
      path: "type",
      message: 'unknown value "architecure"',
      hint: 'did you mean "architecture"?',
    });
  });
});

describe("architecture: schema", () => {
  it("rejects unknown fields and suggests the right one", () => {
    expect(only({ ...base, nodes: [{ id: "api", lable: "API" }] })).toEqual({
      severity: "error",
      code: "schema/unknown-field",
      path: "nodes[0].lable",
      message: "unknown field",
      hint: 'did you mean "label"?',
    });
  });

  it("lists the allowed fields when nothing is close", () => {
    expect(only({ ...base, color: "red" }).hint).toBe(
      "allowed: type, title, description, theme, direction, nodes, groups, edges",
    );
  });

  it("rejects an unknown kind and suggests the closest", () => {
    expect(only({ ...base, nodes: [{ id: "db", kind: "databse" }] })).toEqual({
      severity: "error",
      code: "schema/enum",
      path: "nodes[0].kind",
      message: 'unknown value "databse"',
      hint: 'did you mean "database"?',
    });
  });

  it("lists valid kinds when nothing is close", () => {
    expect(only({ ...base, nodes: [{ id: "x", kind: "spaceship" }] }).hint).toBe(
      "use one of: client, user, gateway, service, function, database, cache, queue, storage, external",
    );
  });

  it("requires the title", () => {
    const { title: _title, ...rest } = base;
    expect(only(rest)).toEqual({
      severity: "error",
      code: "schema/required",
      path: "title",
      message: "missing",
      hint: 'run "trazo example architecture" for a starting point',
    });
  });

  it("reports a wrong value type", () => {
    expect(only({ ...base, title: 42 })).toEqual({
      severity: "error",
      code: "schema/type",
      path: "title",
      message: "expected string, got number",
    });
  });

  it("rejects an empty node list", () => {
    expect(only({ ...base, nodes: [] })).toEqual({
      severity: "error",
      code: "schema/empty",
      path: "nodes",
      message: "must not be empty",
    });
  });

  it("rejects ids with spaces or punctuation", () => {
    expect(only({ ...base, nodes: [{ id: "web app" }] })).toEqual({
      severity: "error",
      code: "schema/id",
      path: "nodes[0].id",
      message: 'invalid id "web app"',
      hint: "start with a letter or _, then letters, digits, _, . or -",
    });
  });
});

describe("architecture: edge shorthand errors", () => {
  it("explains the expected syntax", () => {
    expect(only({ ...base, edges: ["web => api"] })).toEqual({
      severity: "error",
      code: "edge/syntax",
      path: "edges[0]",
      message: 'cannot read "web => api"',
      hint: 'write "from -> to: label" (-> sync, ~> async)',
    });
  });

  it("rejects the reply arrow outside sequence diagrams", () => {
    expect(only({ ...base, edges: ["api --> web"] })).toEqual({
      severity: "error",
      code: "edge/arrow",
      path: "edges[0]",
      message: 'arrow "-->" is not available in architecture diagrams',
      hint: "use -> for sync or ~> for async",
    });
  });
});

describe("architecture: references", () => {
  it("reports an unknown edge endpoint with a suggestion", () => {
    expect(only({ ...base, edges: ["api -> quee: publish"] })).toEqual({
      severity: "error",
      code: "ref/unknown-node",
      path: "edges[0].to",
      message: 'unknown node "quee"',
      hint: 'did you mean "queue"?',
    });
  });

  it("reports duplicate ids across nodes and groups", () => {
    expect(only({ ...base, groups: [{ id: "api", children: ["db"] }] })).toEqual({
      severity: "error",
      code: "ref/duplicate-id",
      path: "groups[0].id",
      message: 'duplicate id "api"',
      hint: "first used at nodes[1].id",
    });
  });

  it("reports an unknown group child", () => {
    expect(only({ ...base, groups: [{ id: "vpc", children: ["dbb"] }] })).toEqual({
      severity: "error",
      code: "ref/unknown-node",
      path: "groups[0].children[0]",
      message: 'unknown node "dbb"',
      hint: 'did you mean "db"?',
    });
  });

  it("rejects a node placed in two groups", () => {
    expect(
      only({
        ...base,
        groups: [
          { id: "a", children: ["db"] },
          { id: "b", children: ["db"] },
        ],
      }),
    ).toEqual({
      severity: "error",
      code: "group/multiple-parents",
      path: "groups[1].children[0]",
      message: '"db" is already inside group "a"',
      hint: "a node belongs to one group; nest groups instead",
    });
  });

  it("rejects groups that contain each other", () => {
    expect(
      only({
        ...base,
        groups: [
          { id: "a", children: ["b"] },
          { id: "b", children: ["a"] },
        ],
      }),
    ).toEqual({
      severity: "error",
      code: "group/cycle",
      path: "groups[1].children[0]",
      message: 'group "a" would end up inside itself',
    });
  });
});

describe("architecture: warnings", () => {
  it("warns about repeated edges without blocking", () => {
    const { diagram, issues } = validateDiagram({ ...base, edges: ["web -> api", "web -> api"] });
    expect(diagram).toBeDefined();
    expect(issues).toEqual([
      {
        severity: "warning",
        code: "edge/duplicate",
        path: "edges[1]",
        message: "same as edges[0]",
      },
    ]);
  });

  it("warns when the diagram is too large to read", () => {
    const nodes = Array.from({ length: 61 }, (_, i) => ({ id: `n${i}` }));
    const { diagram, issues } = validateDiagram({ type: "architecture", title: "T", nodes });
    expect(diagram).toBeDefined();
    expect(issues).toEqual([
      {
        severity: "warning",
        code: "size/large",
        path: "nodes",
        message: "61 nodes",
        hint: "diagrams read best under 60 nodes; consider splitting by area",
      },
    ]);
  });
});
