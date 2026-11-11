// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { DIAGRAM_TYPES } from "../model/index.js";

// Written by hand to stay small; test/unit/reference.test.ts checks it against the Zod schemas.

const architecture = `architecture: boxes (services, stores, queues, people) and the arrows between them.

Top level
  type          "architecture"
  title         text
  description?  text
  theme?        light | dark
  direction?    right | down
  nodes         node[], at least 1
  groups?       group[]
  edges?        edge[]

node
  id            unique; letters, digits, _ . -; starts with a letter or _
  label?        shown text; defaults to id
  kind?         client | user | gateway | service | function | database | cache | queue | storage | external
  note?         hover text
  source?       "path/file.ts:line", shown on hover

group (a box around nodes or other groups)
  id            unique among nodes and groups
  label?        shown text; defaults to id
  children      ids of nodes or groups, at least 1

edge
  "a -> b: label"              sync call
  "a ~> b: label"              async: events, queues, jobs
  {from, to, label?, style?}   style: sync | async | data

defaults
  theme light, direction right, kind service, style sync

rules
  ids are unique across nodes and groups
  a node or group sits in one group only
  a group cannot contain itself, directly or not
  edges need existing node or group ids
  no coordinates, sizes or colors
  more than 60 nodes warns: split the diagram by area
  texts must not be empty
`;

const workflow = `workflow: steps joined by arrows, optionally in lanes (one row per actor or team).

Top level
  type          "workflow"
  title         text
  description?  text
  theme?        light | dark
  direction?    down | right
  steps         step[], at least 1
  lanes?        lane[]
  edges?        edge[]

step
  id            unique; letters, digits, _ . -; starts with a letter or _
  label?        shown text; defaults to id ("Start" or "End" for those kinds)
  kind?         task | start | end | decision | wait | subprocess
  note?         hover text
  source?       "path/file.ts:line", shown on hover

lane
  id            unique among steps and lanes
  label?        shown text; defaults to id
  steps         ids of steps, at least 1

edge
  "a -> b: label"              next step
  "a ~> b: label"              async handoff
  {from, to, label?, style?}   style: sync | async

defaults
  theme light, kind task, style sync, direction down (right with lanes)

rules
  start has no incoming edges; end has no outgoing edges
  decision needs at least 2 outgoing edges; label each with its answer
  with lanes, every step is in exactly one lane; lanes always flow right
  edges need existing step ids
  more than 40 steps warns: split into subprocesses
  texts must not be empty
`;

const erd = `erd: tables with typed columns; each foreign key draws a relation.

Top level
  type          "erd"
  title         text
  description?  text
  theme?        light | dark
  tables        table[], at least 1

table
  id            unique; letters, digits, _ . -; may contain dots (public.users)
  label?        shown text; defaults to id
  note?         hover text
  source?       "path/file.ts:line", shown on hover
  columns       column[], at least 1

column, short form (a string)
  "name type [pk] [fk table.column] [unique] [null]"
  "id uuid pk"   "author_id uuid fk users.id"   "email text unique"   "bio text null"
  type is everything between the name and the first mark: "numeric(10, 2)"
  marks may come in any order, once each, in any letter case

column, object form
  {name, type, pk?, unique?, nullable?, fk?, note?}   fk: "table.column"

defaults
  theme light; pk, unique and nullable false

relation ends, deduced from the fk column
  not unique: many rows here per parent; unique: at most one
  null: the parent is optional

rules
  column names are unique within a table
  fk targets one existing column, never a list (no composite keys)
  the target should be pk or unique and have the same type, or it warns
  a table without pk warns
  more than 40 tables, or 30 columns in a table, warns
  texts must not be empty
`;

const sequence = `sequence: participants and the messages between them, in time order.

Top level
  type          "sequence"
  title         text
  description?  text
  theme?        light | dark
  participants  participant[], at least 1
  messages      element[], at least 1

participant
  id            unique; letters, digits, _ . -; starts with a letter or _
  label?        shown text; defaults to id
  kind?         actor | service | database | queue | external
  note?         hover text
  source?       "path/file.ts:line", shown on hover

element: one of these in messages
  "a -> b: label"                 sync call
  "a ~> b: label"                 async
  "a --> b: label"                reply
  {from, to, label?, style?}      style: sync | async | reply
  {note, over}                    over: an id or a list of 1 or 2 ids
  {opt: {when, messages}}         runs only if when holds
  {loop: {when, messages}}        repeats while when holds
  {alt: [{when, messages}, ...]}  one branch per case, at least 2

defaults
  theme light, kind service, style sync

rules
  a message needs existing participant ids; "a -> a" is a self-call
  a reply to itself is an error; a reply with no earlier request warns
  opt, loop and alt nest at most 2 levels
  more than 8 participants or 60 messages warns
  texts must not be empty
`;

export const REFERENCE: Record<(typeof DIAGRAM_TYPES)[number], string> = { architecture, workflow, erd, sequence };
