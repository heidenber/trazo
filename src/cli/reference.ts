// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

import type { DIAGRAM_TYPES } from "../model/index.js";

// Written by hand to stay small; test/unit/reference.test.ts checks it against the Zod schemas.

const architecture = `architecture: boxes (services, stores, queues, people) and the arrows between them.

Top level
  type          "architecture"
  title         text
  description?  text
  theme?        light | dark | lagoon | dusk
  direction?    right | down
  nodes         node[], at least 1
  groups?       group[]
  edges?        edge[]

node
  id            unique; letters, digits, _ . -; starts with a letter or _
  label?        shown text; defaults to id
  kind?         client | user | gateway | service | function | database | cache | queue | storage | external
  note?         shown under the label, up to 3 lines; whole on hover
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

const workflow = `workflow: steps joined by arrows, optionally in lanes (one row or column per actor or team).

Top level
  type          "workflow"
  title         text
  description?  text
  theme?        light | dark | lagoon | dusk
  direction?    down | right
  steps         step[], at least 1
  lanes?        lane[]
  edges?        edge[]

step
  id            unique; letters, digits, _ . -; starts with a letter or _
  label?        shown text; defaults to id ("Start" or "End" for those kinds)
  kind?         task | start | end | decision | wait | subprocess
  note?         shown under the label in task, wait and subprocess boxes, up to 3 lines; whole on hover
  detail?       longer text for the viewer's detail card only (not in the SVG); the card falls back to note
  source?       "path/file.ts:line", shown on hover

lane
  id            unique among steps and lanes
  label?        shown text; defaults to id
  note?         role line under the lane name, one line, clipped with "…"
  steps         ids of steps, at least 1

edge
  "a -> b: label"              next step
  "a ~> b: label"              async handoff
  {from, to, label?, style?}   style: sync | async

defaults
  theme light, kind task, style sync, direction down (with lanes: whichever fits the screen best)

rules
  start has no incoming edges; end has no outgoing edges
  decision needs at least 2 outgoing edges; label each with its answer
  with lanes, every step is in exactly one lane; direction right makes lanes rows, down makes them columns
  edges need existing step ids
  more than 40 steps warns: split into subprocesses
  texts must not be empty
`;

const erd = `erd: tables with typed columns; each foreign key draws a relation.

Top level
  type          "erd"
  title         text
  description?  text
  theme?        light | dark | lagoon | dusk
  tables        table[], at least 1

table
  id            unique; letters, digits, _ . -; may contain dots (public.users)
  label?        shown text; defaults to id
  note?         shown under the title, up to 3 lines; whole on hover
  detail?       longer text for the viewer's detail card only (not in the SVG); the card falls back to note
  group?        name that groups related tables (stored for now; the overview uses it later)
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
  theme?        light | dark | lagoon | dusk
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

const chen = `chen: Chen entity-relationship diagram: entities, attributes and binary relationships.

Top level
  type            "chen"
  title           text
  description?    text
  theme?          light | dark | lagoon | dusk
  entities        entity[], at least 1
  relationships?  relationship[]

entity
  id          unique among entities and relationships; letters, digits, _ . -
  label?      shown text; defaults to id
  weak?       true for a weak entity
  note?       hover text
  detail?     longer text for the viewer's detail card only
  attributes  attribute[]

relationship
  id            unique among entities and relationships
  label?        shown text; defaults to id (write it in capitals: ENROLLS)
  identifying?  true when it identifies a weak entity
  note?         hover text
  attributes?   attribute[]
  participants  participant[], exactly 2

participant
  {entity, cardinality, total?}   cardinality: 1 | N | M; total: true for total participation

attribute: a string (plain attribute) or an object
  {name, kind?, children?}   kind: key | partial | multivalued | derived
  children = a composite attribute: attribute[], at least 1, up to 2 levels

defaults: theme light; weak, identifying and total false

rules
  participants name existing entities; a recursive relationship names one twice
  3 or more participants (ternary) are rejected for now
  a weak entity needs an identifying relationship with total on its side
  an identifying relationship needs a weak entity
  partial only on weak entities, key never on weak; neither on relationships or in children
  a composite takes no kind except multivalued
  an entity without key (or weak without partial) warns
  attribute names are unique among siblings
  texts must not be empty
`;

const state = `state: UML state diagram, basic notation: states and transitions with an event.

Top level
  type         "state"
  title        text
  description? text
  theme?       light | dark | lagoon | dusk
  states       state[], at least 1
  transitions? transition[]

state
  id       unique; letters, digits, _ . -
  label?   shown text; defaults to id ("Initial state" and "Final state" for those kinds)
  kind?    state | initial | final | exception
  note?    hover text
  detail?  longer text for the viewer's detail card only
  source?  "path/file.ts:line"

transition: a string or an object
  "from -> to: event"   the only arrow is ->; ": event" is optional
  {from, to, label?}    label = the event; from = to is a self-transition

defaults: theme light; kind state

rules
  exactly 1 initial state, with exactly 1 outgoing and no incoming transition
  a final state has no outgoing transition; there may be several
  exception is a plain state drawn off the main path (rejected, cancelled)
  transitions name existing states; a transition without an event warns
  composite states, history, decision (choice) pseudostates and regions are not supported
  texts must not be empty
`;

const classDiagram = `class: UML class diagram, basic notation: classes with members, and relations.

Top level
  type         "class"
  title        text
  description? text
  theme?       light | dark | lagoon | dusk
  classes      class[], at least 1
  relations?   string[]

class
  id           unique; letters, digits, _ . -
  stereotype?  abstract | interface | enum
  attributes?  string[]: "+ id: UUID"; an enum lists its constants: "PLACED"
  methods?     string[]: "- total(): Money"; not allowed on an enum
  note?        hover text
  detail?      longer text for the viewer's detail card only
  source?      "path/file.ts:line"

member: [visibility] name[: Type] or [visibility] name(params)[: Type]
  visibility   + public, - private, # protected, ~ package; optional

relation: "A [m] op [m] B [: label]"
  op           --  association        -->  directed association
               *-- composition (A is the whole)   o--  aggregation (A is the whole)
               --|> generalization (A inherits B)  ..|> realization (A implements B)
               ..> dependency
  m            1, 0..1, *, 1..*, 0..*, n..m; not on --|>, ..|> or ..>
  example      "Order 1 *-- 1..* OrderLine : has"

defaults: theme light; no stereotype = plain class

rules
  relations name existing classes; no packages, generics or nested classes
  a realization targets an interface; generalizations cannot form a cycle
  texts must not be empty
`;

export const REFERENCE: Record<(typeof DIAGRAM_TYPES)[number], string> = {
  architecture,
  workflow,
  erd,
  sequence,
  chen,
  state,
  class: classDiagram,
};
