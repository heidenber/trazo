// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Heidenber Palacio Garzón

export class UsageError extends Error {}

export const USAGE = `trazo: semantic JSON in, laid-out interactive HTML out

Usage:
  trazo make <input> [-o, --out <file>] [--theme light|dark] [--json]
  trazo check <input> [--json]
  trazo schema <type>
  trazo example <type>
  trazo skill install --agent claude|pi|codex

Commands:
  make     validate, lay out and write a self-contained HTML file
  check    validate only; writes nothing
  schema   print the compact field reference for a diagram type
  example  print a complete example diagram, valid input for make
  skill    install the trazo skill for an agent in your home directory
           (Claude Code, Pi or Codex); an existing copy is updated

Options:
  -o, --out <file>   output path (default: <input> with .html, or stdout when <input> is "-"; "-" forces stdout)
      --theme <t>    light or dark; overrides the diagram's theme
      --json         print one JSON line instead of plain text
      --agent <a>    claude, pi or codex (skill install only)
  -h, --help         show this help
  -v, --version      print the version

<input> is a JSON file, or "-" to read stdin.
<type> is architecture, workflow, erd or sequence.
Exit codes: 0 ok, 1 invalid input, 2 usage error, 3 internal error.

Find trazo useful? Star it on GitHub: https://github.com/heidenber/trazo
`;
