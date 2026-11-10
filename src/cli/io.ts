// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { UsageError } from "./usage.js";

export function readInput(input: string): string {
  let bytes: Buffer;
  try {
    bytes = readFileSync(input === "-" ? 0 : input);
  } catch {
    throw new UsageError(input === "-" ? "cannot read stdin" : `cannot read "${input}"`);
  }
  return decode(bytes);
}

// Windows PowerShell 5.1 `>` writes UTF-16LE with a BOM, so honor the BOM.
function decode(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString("utf16le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = Buffer.from(bytes.subarray(2));
    return body
      .subarray(0, body.length - (body.length % 2))
      .swap16()
      .toString("utf16le");
  }
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return bytes.subarray(3).toString("utf8");
  return bytes.toString("utf8");
}

/**
 * A failed write of `shown`: a system error from the OS (it carries both a code
 * such as EACCES and the failing syscall) becomes a usage error naming the path
 * and the cause; anything else, including Node's own ERR_* programming errors,
 * is a defect and passes through unchanged, so it stays an internal error.
 */
export function writeError(err: unknown, shown: string): Error {
  const { code, syscall } = (err ?? {}) as { code?: unknown; syscall?: unknown };
  if (err instanceof Error && typeof code === "string" && typeof syscall === "string") {
    return new UsageError(`cannot write "${shown}" (${code})`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Temp file in the target directory so the rename never crosses a device. */
export function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, content);
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing was written
    }
    throw err;
  }
}
