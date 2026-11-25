# Changelog

All notable changes to trazo are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While trazo is in 0.x, a change that breaks the JSON input, the CLI or the library API bumps the minor version.

## [Unreleased]

### Added

- New diagram type `class` (UML class diagram, basic notation), first part: the JSON model and validation. `classes` (`stereotype`: `abstract`, `interface` or `enum`; `attributes` and `methods` as UML strings such as `"+ id: UUID"` and `"- total(): Money"`; an enum lists its constants in `attributes`) and `relations` as one-line strings such as `"Order 1 *-- 1..* OrderLine : has"` with the operators `--`, `-->`, `*--`, `o--`, `--|>`, `..|>` and `..>` and optional multiplicities (`1`, `0..1`, `*`, `1..*`, `0..*`, `n..m`) and label. New codes: `class/member-syntax`, `class/relation-syntax`, `class/multiplicity`, `class/enum-methods`, `class/realization-target`, `class/generalization-cycle`, `class/render-unavailable`, `ref/unknown-class` and the warnings `class/unused` and `class/duplicate-member`. `trazo schema class`, `trazo example class` (online store) and `trazo check` work; `trazo make` fails with `class diagrams cannot be rendered yet` (exit 1) until layout and rendering land.
- New diagram type `state` (UML state diagram, basic notation). `states` (`kind`: `initial`, `final`, `exception` or a plain state) and `transitions` written as `"from -> to: event"` or `{from, to, label}`; self-transitions are allowed. `trazo make` draws it as a rail: the happy path (the longest chain of ordinary states from the initial one) is one thick row from left to right, transitions that lead back to it run above, cancel and failure transitions run below and are dashed with their exception states tinted in the failure color, event names sit above the lines, a self-transition is a loop over its state, and the initial pseudostate (dot) and final state (ring) are drawn. A legend of the elements used (English) is drawn inside the SVG below the diagram; the viewer has no Flow toggle and its detail card reads each state in plain language ("Reached from Draft on submit.", "Moves to Approved on approve."). It works in the four themes and in the black-and-white export. Composite states, history and decision pseudostates and regions are rejected with `state/unsupported`. New codes: `state/unsupported`, `state/initial-count`, `state/initial-incoming`, `state/initial-outgoing`, `state/final-outgoing`, `ref/unknown-state` and the warnings `state/no-event`, `state/dead-end` and `state/unreachable`. `trazo schema state` and `trazo example state` (purchase order) print the reference and the example.
- Black-and-white exports in the viewer: the Export menu gains PNG, SVG and PDF (print dialog) variants that draw any diagram in ink on white, with no family tints, shadows or edge colors while dashes, double lines, underlines and markers stay. They apply to the exported copy only; the page and the inline SVG are unchanged, and the credit strip is drawn in ink too.
- New diagram type `chen` (Chen entity-relationship notation, for teaching). `trazo make` draws it: each entity and its attributes form one block that ELK places with the relationship diamonds between entities, attributes stack in a column on the entity's free side (a row on top when both sides are busy) with composite parts one column further out, relationship attributes hang from their diamond, and a recursive relationship goes around. Shapes: entity, weak entity (double rectangle), relationship, identifying relationship (double diamond), attribute oval, key (underlined), partial key (dashed underline), multivalued (double oval), derived (dashed), composite; total participation is a double line, and 1, N or M sits next to the line at each entity with a halo. Every line ends exactly on the outline of its shapes. A notation legend (English, only the elements used) is drawn below the diagram; the viewer has no Flow toggle, and its detail card shows `detail` (else `note`) and a plain-language reading of a relationship ("Each Section is related to exactly one Course."). The JSON model: entities (`weak`), binary relationships (`identifying`, `participants` with `cardinality` `1`, `N` or `M` and `total`), and attributes that are a string or `{name, kind, children}` (`kind`: `key`, `partial`, `multivalued`, `derived`; `children` makes it composite). Ternary relationships are rejected with `chen/ternary` for now; a weak entity needs an identifying relationship with total participation; partial keys only on weak entities. New codes: `chen/ternary`, `chen/participants`, `chen/identifying-no-weak`, `chen/weak-not-identified`, `chen/partial-key`, `chen/key-on-weak`, `chen/attribute-kind`, `chen/nesting`, `chen/duplicate-attribute`, `ref/unknown-entity` and the warnings `chen/no-key` and `chen/no-partial-key`. `trazo schema chen` and `trazo example chen` (University) print the reference and the example.
- Flow animation in the viewer: small beads travel every edge from source to target in workflow, architecture and sequence diagrams, on when the page opens, with a Flow toggle in the toolbar (`aria-pressed`, keyboard accessible). ERDs have neither. With `prefers-reduced-motion: reduce` it starts off and stays off until the reader presses Flow. At most three beads per edge, driven by SVG animation (no script loop) and paused while the page is hidden. The beads live in a viewer-only layer created at runtime: they are removed from every export and hidden in print, and the diagram SVG inside the page is unchanged.
- Multi-table ERDs now carry an Overview panel inside the SVG, below the diagram: counts, derived key relations and a table index with column and reference counts plus clipped table notes. It is softly tinted and framed in every theme. When tables use the optional `group`, the index adds a Group column with a chip from the existing family palette in group order; authors still write no colors. The Overview defaults open in the viewer, is keyboard-collapsible, shrinks the SVG when closed, and every export keeps the state currently on screen. Single-table ERDs stay unchanged.
- A small muted "Made with trazo" at the bottom right of every viewer export (PNG 1x and 2x, transparent PNG, SVG, copy PNG, copy SVG and the printed PDF), in a strip added below the diagram so it never covers the legend or any node. The page footer stays, and the diagram SVG inside the page is unchanged; copying the JSON source adds nothing.
- Optional JSON fields: `detail` on workflow steps and ERD tables (longer text for the viewer's detail card, which falls back to `note`; it is never drawn in the SVG, so exports do not carry it), `note` on workflow lanes (a muted role line under the lane name, clipped with "…" to the header width) and `group` on ERD tables (stored and validated; rendered later). The on-canvas note keeps its 3-line cap. Wrong types are rejected with the usual `schema/type` error.
- A workflow with more than 6 lanes gets the `workflow/many-lanes` warning (non-fatal).

- The trazo logo in the viewer header (the reversed logo on the dark and dusk themes) and an SVG favicon that switches to the light mark in a dark browser. The READMEs show the logo, with a reversed version in dark mode.

- Two new themes, `lagoon` (light, teal) and `dusk` (dark, violet), next to `light` and `dark`: accepted by the JSON `theme` field of every diagram type, by `--theme` and by `make(…, { theme })`. `light` and `dark` keep their names and take new palettes. All four reach WCAG AA (4.5:1 for text on its fill, 3:1 for strokes and edges). The in-page toggle flips light and dark, and lagoon and dusk. A bad `--theme` now reads `invalid --theme "x" (use light, dark, lagoon or dusk)`.
- `trazo skill install --agent claude|pi|codex` copies the skill to the agent's user-level location (`~/.claude/skills/trazo`, `~/.pi/agent/skills/trazo`, `~/.agents/skills/trazo`) in any shell and prints `installed <path>` or `updated <path>`. It replaces the per-shell copy commands in the README; trazo still installs nothing on its own.
- A legend below every diagram that uses more than one node kind family or more than one edge style: one entry per family and per style actually used, in a fixed order, wrapped into rows within the diagram width. It lives inside the SVG, so the PNG and SVG exports include it; an ERD, or a diagram with a single family and a single style, has none.
- New viewer page (Studio Cards): a header with the title and description over a toolbar of grouped icon buttons, and a dot-grid canvas that follows the active theme. Zoom out, zoom level, zoom in and fit; `+`, `-`, `0`, `/` and Esc work from the keyboard; every control has an aria label and a visible focus ring. The diagram still opens fitted. Motion (fades, the menu and card entrance) runs only when the reader has not asked for reduced motion.
- Search: type in the search field (or press `/`) to highlight the nodes whose label or note matches and dim the rest, with a match count; Enter and Shift+Enter cycle through the matches, centring each one, and Esc clears.
- A minimap with the visible area as a rectangle (click or drag to move; hidden on screens 900 px wide or narrower) and a detail card that replaces the tooltip: hover, focus or click a node to see its label, kind, whole note, source and incoming and outgoing connections. Both live in the page only, never in an exported or printed diagram.
- A theme menu to switch between Porcelain (`light`), Graphite (`dark`), Lagoon and Dusk inside the page. The choice lasts until the page closes and nothing is stored or sent. Exports use the theme on screen.
- An Export menu with eight formats, all in the browser: PNG (1x, 2x and transparent, with their pixel sizes), SVG, PDF through the print dialog (the printed page takes the diagram's own size, so "Save as PDF" gives one page with the whole diagram and a 24 px margin in Chrome and Edge; a print stylesheet hides everything but the diagram, and a dark theme prints in its light sibling), copy PNG, copy SVG and copy JSON source. When the browser blocks the clipboard (image copy often fails on pages opened from a file), the menu shows a clear message instead of failing; text copies fall back to `execCommand`.
- The page embeds the normalized input as `<script type="application/json" id="trazo-source">` for "Copy JSON source", only when it is at most 64 KB (the item is disabled otherwise). `<`, `>`, `&` and the line separators are escaped, so content cannot close the script. It holds what the page already shows (labels, notes, sources, types), so treat the HTML like the input when you share it.
- A node with a `source` now carries it in a `data-source` attribute, which the detail card uses to show it apart from the note.

### Changed

- The viewer header shows the trazo symbol (the small variant, 24 px; recolored on the dark and dusk themes) instead of the horizontal logo. The READMEs keep the horizontal logo.
- The viewer script is no longer limited to 10 KB: the cap is now 40 KB (it is about 24 KB). The HTML of each example stays well under 300 KB. The separate SVG and PNG download buttons and the light and dark toggle are replaced by the Export and theme menus; the PNG that used to download at 2x is now "PNG @2x".
- New look for the diagram (Studio Cards): nodes are rounded cards with a soft layered shadow and a tinted icon chip in the kind's color, start, end and decision shapes and plain workflow tasks take a tinted fill and outline, edges turn their corners with small curves, arrowheads are rounded, edge labels are bordered pills, and groups, lanes, fragments, tables and the legend follow. The shadow is one SVG filter, defined only when a diagram uses it, and every color keeps an explicit fallback so an exported SVG or PNG looks the same as the page. Cards are a little wider (the chip takes 52 px before the text) and a little taller (48 px minimum), and a workflow loop keeps 28 px from its steps so its label clears them. Notes are drawn in the muted text color.
- Nodes are colored by kind: a border in the kind's color over a soft tint of it, in five families for architecture (compute, data, messaging, client, external) and five for workflow (start, end, decision, wait, task); sequence participants reuse the architecture families. Edges are colored by style (sync blue, async violet, data teal, reply grey), dash patterns stay, and each arrowhead matches its edge. Notes and ERD tables keep the neutral look; icons take their family color. Colors are explicit variables in both themes, so exported SVG and PNG look the same.
- Notes are visible on the canvas: an architecture node's or a workflow task, wait or subprocess step's `note` is shown under its label in smaller muted text, and an ERD table's `note` under its title. A note longer than three lines is cut with an ellipsis; the tooltip keeps the whole note and the source. Decisions, start and end steps, sequence participants and ERD columns keep the note in the tooltip only. Diagrams without notes render exactly as before.
- Workflow lanes can be columns: with `direction: "down"` each lane is a column with its label in a row at the top and steps flow down; `direction: "right"` keeps lanes as rows. Without a direction, trazo lays a laned workflow out both ways and keeps the one that fits a 1440x826 screen better, so wide workflows with several lanes are no longer drawn at half size or less. The `workflow/lanes-direction` warning is gone: an explicit direction is honored.

### Fixed

- ERD: the "one" and "zero or one" relation ends now sit flush with the table border, like the crow's foot. Exactly one is a double bar.
- Edge labels in workflows no longer sit on another edge's line. A label moved off a step or another label could land on the route of a different edge (in the expense approval workflow, the "approved" and "rejected" labels of the second decision sat on the Notify Rejection -> Rejected run); a label now also slides along its own route to the nearest spot clear of the other edges' lines, trying positions every 4 px, and the edge's own line is no obstacle. Labels already clear keep their place.
- Edge labels in workflows no longer sit on a step. A label centred on a short run just below a decision, or on the far side of a self-loop, reached over the node it leaves and `make` warned `label of … overlaps node …`. A label that meets a step now slides along its own route to the nearest spot clear of the steps and the other labels; labels already clear keep their place, and the warning stays as a safety net.
- Edge labels no longer overlap each other in workflows. In column lanes the label of a loop edge (for example "retry") could land on the label of a decision's branch ("passed") where the two edges cross; a label that meets an earlier one now slides along its own edge to the nearest free spot, clear of the steps. The same rule applies to row lanes and to workflows without lanes.

## [0.1.4] - 2026-11-09

### Added

- `docs/issue-codes.md` lists every validation and geometry issue code with its severity and meaning, linked from both READMEs. Thanks to @jeelthacker1 for the first outside contribution (#32).
- ERD tables take an optional `source` ("path/file.ts:line"), shown on hover after the note, the same as architecture nodes, workflow steps and sequence participants. `trazo schema erd`, the example and the skill now include it.

### Changed

- `trazo --help` ends with a line inviting you to star the project on GitHub. Nothing else prints it.
- The README lists the bench comparison (hand-written SVG, Mermaid, trazo) as points instead of one paragraph.
- New CONTRIBUTING.md, issue templates and a pull request template, linked from both READMEs.

## [0.1.3] - 2026-11-05

### Added

- The HTML page ends with a small "Made with trazo" link to the project, in the muted text color of the theme. It is outside the diagram, so exported SVG and PNG files do not include it, and it loads nothing until clicked.
- A quick start in the README for people who use an agent: install trazo with one command, optionally install the skill (or ask the agent to), then ask the agent for a diagram with an example prompt.

### Fixed

- The PowerShell commands that install the skill pointed at `trazo\skill` instead of `@heidenber\trazo\skill` under the global npm folder, so `Copy-Item` failed.

## [0.1.2] - 2026-11-04

### Changed

- The README explains why an agent should use trazo instead of drawing the diagram itself, with numbers from a new bench baseline that compares trazo with hand-written SVG and with Mermaid (layout defects, first-try success, tokens and time). No change to the CLI, the JSON input or the library.

## [0.1.1] - 2026-11-04

### Fixed

- `make` and `check` read input saved as UTF-16 with a byte order mark, which is what `>` writes in Windows PowerShell 5.1 (for example `trazo example erd > diagram.json`). Before, such a file failed with `invalid JSON at line 1, column 1`.

## [0.1.0] - 2026-11-02

First release. Needs Node 22 or later.

### Added

- Four diagram types, written as semantic JSON with no coordinates: `architecture` (components grouped in boxes), `workflow` (steps and decisions, optionally in lanes), `erd` (tables, columns and column-level foreign keys with crow's foot ends) and `sequence` (messages, notes and `alt`, `opt` and `loop` fragments).
- CLI with four commands: `trazo make` writes one self-contained HTML file, `trazo check` validates without writing, `trazo schema <type>` prints the field reference and `trazo example <type>` prints a complete example. `make` and `check` accept `--json`; exit codes are 0 ok, 1 invalid input, 2 usage error, 3 internal error.
- Validation errors that name the exact path in the JSON and carry a hint, and geometry warnings (for example overlapping labels or an edge crossing a node) that do not fail the run.
- Interactive HTML output with no server and no network requests: pan, zoom, hover or focus a node to see its note and highlight its connections, light and dark themes (`--theme`), export to SVG or PNG.
- Deterministic output: the same JSON always gives the same HTML, byte for byte.
- Library API: `check` and `make`, which accept JSON text or a parsed object.
- An agent skill for Claude Code and Pi (`skill/SKILL.md`) and the same text for Codex (`skill/AGENTS.md`).

[Unreleased]: https://github.com/heidenber/trazo/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/heidenber/trazo/releases/tag/v0.1.4
[0.1.3]: https://github.com/heidenber/trazo/releases/tag/v0.1.3
[0.1.2]: https://github.com/heidenber/trazo/releases/tag/v0.1.2
[0.1.1]: https://github.com/heidenber/trazo/releases/tag/v0.1.1
[0.1.0]: https://github.com/heidenber/trazo/releases/tag/v0.1.0
