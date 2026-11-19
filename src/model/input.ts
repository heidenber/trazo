// SPDX-License-Identifier: Apache-2.0

import type { z } from "zod";
import type { architectureSchema, EdgeStyle } from "./architecture.js";
import type { erdSchema } from "./erd.js";
import type { sequenceSchema, SeqStyle } from "./sequence.js";
import type { workflowSchema, WorkflowEdgeStyle } from "./workflow.js";

// Preprocessed fields accept short strings or objects. Describe their input
// forms explicitly rather than exposing the schemas' unknown input types.
type EdgeInput<Style extends string> =
  | string
  | { from: string; to: string; label?: string; style?: Style };

export type ArchitectureInput = Omit<z.input<typeof architectureSchema>, "edges"> & {
  edges?: EdgeInput<EdgeStyle>[];
};

export type WorkflowInput = Omit<z.input<typeof workflowSchema>, "edges"> & {
  edges?: EdgeInput<WorkflowEdgeStyle>[];
};

type ColumnInput =
  | string
  | {
      name: string;
      type: string;
      pk?: boolean;
      unique?: boolean;
      nullable?: boolean;
      fk?: string;
      note?: string;
    };

type TableInput = Omit<z.input<typeof erdSchema>["tables"][number], "columns"> & {
  columns: ColumnInput[];
};

export type ErdInput = Omit<z.input<typeof erdSchema>, "tables"> & {
  tables: TableInput[];
};

type BranchInput = { when: string; messages: SequenceElementInput[] };

type SequenceElementInput =
  | EdgeInput<SeqStyle>
  | { note: string; over: string | string[] }
  | { opt: BranchInput }
  | { loop: BranchInput }
  | { alt: BranchInput[] };

export type SequenceInput = Omit<z.input<typeof sequenceSchema>, "messages"> & {
  messages: SequenceElementInput[];
};

/** Parsed JSON input before validation and default values are applied. */
export type DiagramInput = ArchitectureInput | WorkflowInput | ErdInput | SequenceInput;
