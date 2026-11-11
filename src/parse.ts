// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { Issue } from "./validate/issues.js";

export type ParseResult = { ok: true; value: unknown } | { ok: false; issues: Issue[] };

export function parseJson(text: string): ParseResult {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  try {
    return { ok: true, value: JSON.parse(source) };
  } catch {
    // V8 does not always report an offset, and its wording changes between
    // Node releases. A small scanner finds the first bad character instead.
    const { line, column } = lineAndColumn(source, findSyntaxError(source));
    return {
      ok: false,
      issues: [
        {
          severity: "error",
          code: "json/syntax",
          path: "$",
          message: `invalid JSON at line ${line}, column ${column}`,
          hint: "look for a trailing comma, a missing quote or an unescaped character there",
        },
      ],
    };
  }
}

class Stop {
  constructor(readonly offset: number) {}
}

/** Offset of the first character that makes the text invalid JSON. */
export function findSyntaxError(text: string): number {
  let i = 0;
  const fail = (): never => {
    throw new Stop(i);
  };
  const space = () => {
    while (i < text.length && " \t\n\r".includes(text[i]!)) i++;
  };
  const literal = (word: string) => {
    for (const ch of word) {
      if (text[i] !== ch) fail();
      i++;
    }
  };
  const string = () => {
    i++;
    while (i < text.length) {
      const ch = text[i]!;
      if (ch === '"') {
        i++;
        return;
      }
      if (ch < " ") fail();
      if (ch === "\\") {
        i++;
        const esc = text[i];
        if (esc === "u") {
          for (let k = 1; k <= 4; k++)
            if (!/[0-9a-fA-F]/.test(text[i + k] ?? "")) ((i += k), fail());
          i += 5;
          continue;
        }
        if (esc === undefined || !'"\\/bfnrt'.includes(esc)) fail();
      }
      i++;
    }
    fail();
  };
  const number = () => {
    const match = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!match || match[0] === "" || match[0] === "-") fail();
    i += match![0].length;
  };
  const value = (): void => {
    space();
    const ch = text[i];
    if (ch === "{") return object();
    if (ch === "[") return array();
    if (ch === '"') return string();
    if (ch === "t") return literal("true");
    if (ch === "f") return literal("false");
    if (ch === "n") return literal("null");
    if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) return number();
    fail();
  };
  const object = () => {
    i++;
    space();
    if (text[i] === "}") return void i++;
    for (;;) {
      space();
      if (text[i] !== '"') fail();
      string();
      space();
      if (text[i] !== ":") fail();
      i++;
      value();
      space();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") return void i++;
      fail();
    }
  };
  const array = () => {
    i++;
    space();
    if (text[i] === "]") return void i++;
    for (;;) {
      value();
      space();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") return void i++;
      fail();
    }
  };
  try {
    value();
    space();
    if (i < text.length) fail();
  } catch (stop) {
    if (stop instanceof Stop) return Math.min(stop.offset, text.length);
    throw stop;
  }
  return text.length;
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}
