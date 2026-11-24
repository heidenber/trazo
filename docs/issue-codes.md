# Validation issue codes

Use the `code` field to identify an issue in `trazo check --json` or the library API.
Errors block rendering. Warnings flag problems in a diagram that can still render.
Use `path` to locate the problem in the input or layout and `hint`, when present,
for a suggested fix.

| Code | Severity | Meaning |
| --- | --- | --- |
| `chen/attribute-kind` | Error | An attribute kind is not allowed there: a composite attribute with a kind other than `multivalued`, `key` or `partial` on a relationship attribute, or `key` or `partial` on a part of a composite. |
| `chen/duplicate-attribute` | Error | Two sibling attributes of one entity, relationship or composite have the same name. |
| `chen/identifying-no-weak` | Error | An identifying relationship has no weak entity among its participants. |
| `chen/key-on-weak` | Error | A weak entity has a `key` attribute; it takes a `partial` key instead. |
| `chen/nesting` | Error | Composite attributes nest more than 2 levels deep. |
| `chen/no-key` | Warning | A strong entity has no `key` attribute. |
| `chen/no-partial-key` | Warning | A weak entity has no `partial` key attribute. |
| `chen/partial-key` | Error | A `partial` key attribute sits on an entity that is not weak. |
| `chen/participants` | Error | A relationship has fewer than 2 participants. |
| `chen/ternary` | Error | A relationship has 3 or more participants; ternary relationships are not supported yet. |
| `chen/weak-not-identified` | Error | A weak entity is in no identifying relationship where it takes part with `total` participation. |
| `column/duplicate` | Error | Two columns in the same table have the same name. |
| `column/fk-target` | Error | A foreign key lacks a valid `table.column` target. |
| `column/no-type` | Error | A column declaration has no type. |
| `column/repeated-mark` | Error | A column mark appears more than once. |
| `column/self-reference` | Error | A foreign key points to its own column. |
| `column/syntax` | Error | A column declaration has invalid syntax. |
| `column/unknown-mark` | Error | A column mark is unrecognised. |
| `edge/arrow` | Error | An edge uses an unsupported arrow. |
| `edge/duplicate` | Warning | An edge repeats an earlier edge. |
| `edge/syntax` | Error | An edge cannot be parsed from its declaration. |
| `fk/target-not-key` | Warning | A foreign key points to a column that is neither primary nor unique. |
| `fk/type-mismatch` | Warning | The source and target columns of a foreign key have different types. |
| `geometry/edge-through-node` | Warning | A routed edge crosses an unrelated node. |
| `geometry/label-overlap` | Warning | An edge label overlaps a node or another edge label. |
| `geometry/node-overlap` | Warning | Two laid-out nodes overlap. |
| `geometry/outside-canvas` | Warning | A node, group, or edge label extends past the canvas. |
| `geometry/outside-group` | Warning | A node extends past its containing group. |
| `geometry/text-overflow` | Warning | A node label is wider than its box. |
| `group/cycle` | Error | Group nesting would place a group inside itself. |
| `group/multiple-parents` | Error | A node or group belongs to more than one parent group. |
| `json/syntax` | Error | The input is malformed JSON. |
| `lane/missing` | Error | A workflow with lanes has a step outside all lanes. |
| `lane/multiple-lanes` | Error | A workflow step is listed in more than one lane. |
| `ref/duplicate-id` | Error | An identifier is declared more than once. |
| `ref/unknown-column` | Error | A foreign key refers to a column that does not exist. |
| `ref/unknown-entity` | Error | A participant names an entity that is not declared (relationship ids do not count). |
| `ref/unknown-node` | Error | A reference names an undeclared architecture node or group. |
| `ref/unknown-participant` | Error | A sequence element references an undeclared participant. |
| `ref/unknown-step` | Error | A workflow reference names an undeclared step. |
| `ref/unknown-table` | Error | A foreign key refers to a table that does not exist. |
| `schema/empty` | Error | A field that requires content is empty. |
| `schema/enum` | Error | A value is outside the field's allowed choices. |
| `schema/id` | Error | An identifier contains invalid characters or starts with an invalid character. |
| `schema/invalid` | Error | A schema rule failed without a more specific issue code. |
| `schema/required` | Error | A required field is missing. |
| `schema/type` | Error | A value has the wrong type. |
| `schema/unknown-field` | Error | An object contains a field the schema does not recognise. |
| `sequence/alt-branches` | Error | An `alt` fragment has fewer than two branches. |
| `sequence/element` | Error | An element is unrecognised or combines multiple element kinds. |
| `sequence/long-label` | Warning | A sequence message label exceeds the recommended length. |
| `sequence/nesting` | Error | A sequence fragment exceeds the nesting limit. |
| `sequence/note-over` | Error | A note lists too many participants or repeats one. |
| `sequence/orphan-reply` | Warning | A reply has no earlier request in the opposite direction. |
| `sequence/self-reply` | Error | A participant sends a reply to itself. |
| `sequence/unused-participant` | Warning | A declared participant never appears in a message or note. |
| `size/large` | Warning | The diagram or table exceeds a recommended size. |
| `table/no-pk` | Warning | A table has no primary key. |
| `workflow/dead-end` | Warning | A non-end step has no outgoing edges in a workflow that has edges. |
| `workflow/decision-label` | Warning | An edge leaving a decision step has no label. |
| `workflow/decision-outputs` | Error | A decision step has fewer than two outgoing edges. |
| `workflow/end-outgoing` | Error | An end step has an outgoing edge. |
| `workflow/many-lanes` | Warning | A workflow has more than 6 lanes. |
| `workflow/start-incoming` | Error | A start step has an incoming edge. |
| `workflow/unreachable` | Warning | A step cannot be reached from any start step. |
