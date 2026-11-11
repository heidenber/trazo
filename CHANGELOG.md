# Changelog

All notable changes to trazo are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). While trazo is in 0.x, a change that breaks the JSON input, the CLI or the library API bumps the minor version.

## [Unreleased]

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
