// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { describe, expect, it } from "vitest";
import { formatIssues, formatPath, suggest, type Issue } from "../../src/validate/issues.js";
import { parseJson } from "../../src/parse.js";

describe("formatPath", () => {
  it("joins keys with dots and indexes with brackets", () => {
    expect(formatPath(["nodes", 3, "kind"])).toBe("nodes[3].kind");
    expect(formatPath(["edges", 0])).toBe("edges[0]");
    expect(formatPath([])).toBe("$");
  });
});

describe("suggest", () => {
  it("returns the closest candidate within the edit budget", () => {
    expect(suggest("databse", ["service", "database", "cache"])).toBe("database");
    expect(suggest("lable", ["id", "label", "kind"])).toBe("label");
  });

  it("returns undefined when nothing is close enough", () => {
    expect(suggest("zzz", ["service", "database"])).toBeUndefined();
  });

  it("is case-insensitive", () => {
    expect(suggest("Queue", ["queue", "cache"])).toBe("queue");
  });
});

describe("formatIssues", () => {
  const error: Issue = {
    severity: "error",
    code: "ref/unknown-node",
    path: "edges[2]",
    message: 'unknown node "quee"',
    hint: 'did you mean "queue"?',
  };

  it("renders one line per issue with severity, path, message and hint", () => {
    expect(formatIssues([error])).toBe(
      'error  edges[2]: unknown node "quee" → did you mean "queue"?',
    );
  });

  it("renders warnings without a hint", () => {
    const warning: Issue = {
      severity: "warning",
      code: "size/large",
      path: "nodes",
      message: "84 nodes",
    };
    expect(formatIssues([warning])).toBe("warn   nodes: 84 nodes");
  });

  it("caps the output and reports how many were left out", () => {
    const many = Array.from({ length: 23 }, () => error);
    const lines = formatIssues(many).split("\n");
    expect(lines).toHaveLength(21);
    expect(lines[20]).toBe("… and 3 more");
  });
});

describe("parseJson", () => {
  it("returns the parsed value", () => {
    expect(parseJson('{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("reports the line and column of a syntax error", () => {
    const result = parseJson('{\n  "a": 1,\n  "b": }');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([
      {
        severity: "error",
        code: "json/syntax",
        path: "$",
        message: "invalid JSON at line 3, column 8",
        hint: "look for a trailing comma, a missing quote or an unescaped character there",
      },
    ]);
  });

  it("points at the end of the text when the input is truncated", () => {
    const result = parseJson('{\n  "a": [1, 2');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toBe("invalid JSON at line 2, column 13");
  });

  it("ignores a leading byte order mark", () => {
    expect(parseJson('\uFEFF{"a": 1}')).toEqual({ ok: true, value: { a: 1 } });
  });
});
