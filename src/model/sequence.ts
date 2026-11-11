// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import { z } from "zod";
import { didYouMean, formatPath, type Issue } from "../validate/issues.js";
import { IdRegistry } from "../validate/refs.js";
import {
  customIssue,
  describe,
  edgeSchema,
  error_,
  fromZod,
  idSchema,
  textSchema,
  themeSchema,
  warning,
} from "./common.js";

export const PARTICIPANT_KINDS = ["actor", "service", "database", "queue", "external"] as const;

export type ParticipantKind = (typeof PARTICIPANT_KINDS)[number];
export type SeqStyle = "sync" | "async" | "reply";

export interface SeqParticipant {
  id: string;
  label: string;
  kind: ParticipantKind;
  note?: string;
  source?: string;
}

export interface SeqMessage {
  type: "message";
  from: string;
  to: string;
  label?: string;
  style: SeqStyle;
}

export interface SeqNote {
  type: "note";
  text: string;
  over: string[];
}

export interface SeqBranch {
  when: string;
  items: SeqItem[];
}

/** `opt` and `loop` have exactly one branch. */
export interface SeqFragment {
  type: "fragment";
  op: "alt" | "opt" | "loop";
  branches: SeqBranch[];
}

export type SeqItem = SeqMessage | SeqNote | SeqFragment;

export interface Sequence {
  type: "sequence";
  title: string;
  description?: string;
  theme: "light" | "dark";
  participants: SeqParticipant[];
  items: SeqItem[];
}

// Messages stay `unknown` here: a zod union would report a bare
// `invalid_union` with no useful path, so elements are dispatched by hand.
export const sequenceSchema = z.strictObject({
  type: z.literal("sequence"),
  title: textSchema,
  description: textSchema.optional(),
  theme: themeSchema.optional(),
  participants: z
    .array(
      z.strictObject({
        id: idSchema,
        label: textSchema.optional(),
        kind: z.enum(PARTICIPANT_KINDS).optional(),
        note: textSchema.optional(),
        source: textSchema.optional(),
      }),
    )
    .min(1),
  messages: z.array(z.unknown()).min(1),
});

type Parsed = z.output<typeof sequenceSchema>;

const messageSchema = edgeSchema("sequence", ["->", "~>", "-->"], ["sync", "async", "reply"]);
/**
 * `over` takes one id or a list of ids; a single id is read as a list of one.
 * Any other present value is reported here, naming both forms. A missing `over`
 * passes through so the array schema reports it as required, not as a wrong
 * type. An issue pushed here stops the pipe, so the array schema adds no second
 * type error.
 */
const overSchema = z.preprocess((v, ctx) => {
  if (typeof v === "string") return [v];
  if (v !== undefined && !Array.isArray(v)) {
    ctx.issues.push(
      customIssue(v, `expected an id or a list of ids, got ${describe(v)}`, {
        code: "schema/type",
      }),
    );
  }
  return v;
}, z.array(idSchema).min(1));
const noteSchema = z.strictObject({ note: textSchema, over: overSchema });
const branchSchema = z.strictObject({ when: textSchema, messages: z.array(z.unknown()).min(1) });

const FRAGMENT_OPS = ["alt", "opt", "loop"] as const;
type FragmentOp = (typeof FRAGMENT_OPS)[number];
const ELEMENT_KEYS = ["from", "to", "note", ...FRAGMENT_OPS];

const MAX_DEPTH = 2;
const LARGE_MESSAGES = 60;
const LARGE_PARTICIPANTS = 8;
const LONG_LABEL = 80;

type Path = readonly PropertyKey[];

class Walker {
  readonly used = new Set<string>();
  readonly warnings: Issue[] = [];
  messages = 0;
  private readonly requests = new Set<string>();

  constructor(
    private readonly issues: Issue[],
    private readonly ids: IdRegistry,
  ) {}

  list(raw: readonly unknown[], path: Path, depth: number): SeqItem[] {
    const items: SeqItem[] = [];
    raw.forEach((element, i) => {
      const item = this.element(element, [...path, i], depth);
      if (item) items.push(item);
    });
    return items;
  }

  private element(raw: unknown, path: Path, depth: number): SeqItem | undefined {
    if (typeof raw === "string") return this.message(raw, path);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw))
      return this.unreadable(raw, path);

    const keys = Object.keys(raw);
    const kinds: string[] = [];
    if (keys.includes("from") || keys.includes("to")) kinds.push("from");
    for (const key of ["note", ...FRAGMENT_OPS]) if (keys.includes(key)) kinds.push(key);

    if (kinds.length === 0) return this.unreadable(raw, path);
    if (kinds.length > 1) {
      this.fail(
        "sequence/element",
        path,
        `element mixes "${kinds[0]}" and "${kinds[1]}"`,
        "split it into separate elements",
      );
      return undefined;
    }
    if (kinds[0] === "from") return this.message(raw, path);
    if (kinds[0] === "note") return this.note(raw, path);
    return this.fragment(raw, kinds[0] as FragmentOp, path, depth + 1);
  }

  private unreadable(raw: unknown, path: Path): undefined {
    let hint = 'use "from" and "to", "note", "alt", "opt" or "loop"';
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      for (const key of Object.keys(raw)) {
        const guess = didYouMean(key, ELEMENT_KEYS);
        if (guess !== undefined) {
          hint = guess;
          break;
        }
      }
    }
    this.fail(
      "sequence/element",
      path,
      "cannot read element, expected a message, a note or a fragment",
      hint,
    );
    return undefined;
  }

  private message(raw: unknown, path: Path): SeqMessage | undefined {
    const parsed = messageSchema.safeParse(raw, { reportInput: true });
    if (!parsed.success) {
      this.issues.push(...fromZod(parsed.error, messageSchema, path));
      return undefined;
    }
    const { from, to, label, style } = parsed.data as {
      from: string;
      to: string;
      label?: string;
      style?: SeqStyle;
    };
    // Short form has no field to point at, so refs report at the element.
    const short = typeof raw === "string";
    const badFrom = this.ids.unknown(from, formatPath(short ? path : [...path, "from"]));
    const badTo = this.ids.unknown(to, formatPath(short ? path : [...path, "to"]));
    if (badFrom || badTo) return undefined;

    const out: SeqMessage = { type: "message", from, to, style: style ?? "sync" };
    if (label !== undefined) out.label = label;
    this.messages++;
    this.used.add(from);
    this.used.add(to);

    if (out.style === "reply") {
      if (from === to) {
        this.fail(
          "sequence/self-reply",
          path,
          `"${from} --> ${to}" replies to itself`,
          `a self-call has no reply; use "${from} -> ${to}" or drop it`,
        );
        return undefined;
      }
      if (!this.requests.has(`${to}>${from}`)) {
        this.warnings.push(
          warning(
            "sequence/orphan-reply",
            formatPath(path),
            `"${from} --> ${to}" has no earlier request ${to} -> ${from}`,
            "send the request before replying",
          ),
        );
      }
    } else {
      this.requests.add(`${from}>${to}`);
    }
    if (label !== undefined && label.length > LONG_LABEL) {
      this.warnings.push(
        warning(
          "sequence/long-label",
          formatPath(short ? path : [...path, "label"]),
          `label is ${label.length} characters`,
          `keep message labels under ${LONG_LABEL}; move detail to a note`,
        ),
      );
    }
    return out;
  }

  private note(raw: object, path: Path): SeqNote | undefined {
    // The string form has no list index to point at, so its issues report at `over`.
    const single = typeof (raw as { over?: unknown }).over === "string";
    const parsed = noteSchema.safeParse(raw, { reportInput: true });
    if (!parsed.success) {
      const written = formatPath([...path, "over"]);
      for (const issue of fromZod(parsed.error, noteSchema, path)) {
        if (single && issue.path === `${written}[0]`) issue.path = written;
        this.issues.push(issue);
      }
      return undefined;
    }
    const { note, over } = parsed.data;
    let ok = true;
    if (over.length > 2) {
      this.fail(
        "sequence/note-over",
        [...path, "over"],
        `over takes 1 or 2 participants, got ${over.length}`,
        "split the note or pick the two that matter",
      );
      ok = false;
    } else if (over.length === 2 && over[0] === over[1]) {
      this.fail(
        "sequence/note-over",
        [...path, "over", 1],
        `over repeats "${over[1]}"`,
        "list each participant once",
      );
      ok = false;
    }
    over.forEach((id, i) => {
      if (this.ids.unknown(id, formatPath(single ? [...path, "over"] : [...path, "over", i])))
        ok = false;
    });
    if (!ok) return undefined;
    over.forEach((id) => this.used.add(id));
    return { type: "note", text: note, over };
  }

  private fragment(
    raw: object,
    op: FragmentOp,
    path: Path,
    depth: number,
  ): SeqFragment | undefined {
    if (depth > MAX_DEPTH) {
      this.fail(
        "sequence/nesting",
        path,
        `fragment nested ${depth} levels deep, limit is ${MAX_DEPTH}`,
        "move the inner block out or split the diagram",
      );
      return undefined;
    }
    const shape = op === "alt" ? z.array(z.unknown()).min(1) : z.unknown();
    const outer = z.strictObject({ [op]: shape });
    const parsed = outer.safeParse(raw, { reportInput: true });
    if (!parsed.success) {
      this.issues.push(...fromZod(parsed.error, outer, path));
      return undefined;
    }
    const value = (parsed.data as Record<string, unknown>)[op];
    const rawBranches = op === "alt" ? (value as unknown[]) : [value];
    const branchPath = (i: number): Path => (op === "alt" ? [...path, op, i] : [...path, op]);

    let ok = true;
    if (op === "alt" && rawBranches.length < 2) {
      this.fail(
        "sequence/alt-branches",
        [...path, op],
        `alt needs at least 2 branches (has ${rawBranches.length})`,
        'use "opt" for a single condition',
      );
      ok = false;
    }
    const branches: SeqBranch[] = [];
    rawBranches.forEach((rawBranch, i) => {
      const where = branchPath(i);
      const branch = branchSchema.safeParse(rawBranch, { reportInput: true });
      if (!branch.success) {
        this.issues.push(...fromZod(branch.error, branchSchema, where));
        ok = false;
        return;
      }
      const items = this.list(branch.data.messages, [...where, "messages"], depth);
      branches.push({ when: branch.data.when, items });
    });
    return ok ? { type: "fragment", op, branches } : undefined;
  }

  private fail(code: string, path: Path, message: string, hint?: string): void {
    this.issues.push(error_(code, path, message, hint));
  }
}

export function buildSequence(input: Parsed): { diagram?: Sequence; issues: Issue[] } {
  const issues: Issue[] = [];
  const ids = new IdRegistry(issues, { noun: "participant", code: "ref/unknown-participant" });
  input.participants.forEach((participant, i) =>
    ids.claim(participant.id, `participants[${i}].id`),
  );

  const walker = new Walker(issues, ids);
  const items = walker.list(input.messages, ["messages"], 0);

  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const warnings = walker.warnings;
  input.participants.forEach((participant, i) => {
    if (!walker.used.has(participant.id)) {
      warnings.push(
        warning(
          "sequence/unused-participant",
          `participants[${i}]`,
          `participant "${participant.id}" never appears in a message or note`,
          "remove it or add a message",
        ),
      );
    }
  });
  if (walker.messages > LARGE_MESSAGES) {
    warnings.push(
      warning(
        "size/large",
        "messages",
        `${walker.messages} messages`,
        `diagrams read best under ${LARGE_MESSAGES} messages; consider splitting into several`,
      ),
    );
  }
  if (input.participants.length > LARGE_PARTICIPANTS) {
    warnings.push(
      warning(
        "size/large",
        "participants",
        `${input.participants.length} participants`,
        `diagrams read best under ${LARGE_PARTICIPANTS} participants; consider splitting into several`,
      ),
    );
  }

  const diagram: Sequence = {
    type: "sequence",
    title: input.title,
    theme: input.theme ?? "light",
    participants: input.participants.map((participant) => {
      const out: SeqParticipant = {
        id: participant.id,
        label: participant.label ?? participant.id,
        kind: participant.kind ?? "service",
      };
      if (participant.note !== undefined) out.note = participant.note;
      if (participant.source !== undefined) out.source = participant.source;
      return out;
    }),
    items,
  };
  if (input.description !== undefined) diagram.description = input.description;
  return { diagram, issues: warnings };
}
