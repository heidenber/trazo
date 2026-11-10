# Contributing to trazo

Thanks for taking the time. Bug reports, small fixes, docs and examples are all welcome. For anything bigger, open an issue first so we can agree on the shape before you write code.

Looking for a place to start? See the issues labeled [good first issue](https://github.com/heidenber/trazo/labels/good%20first%20issue).

## Before you start

- **Bugs:** open an issue with the trazo version, the JSON input (or the command), what happened and what you expected. The bug template asks for exactly that.
- **New features or diagram types:** open an issue first. trazo keeps the input small on purpose, so every new field or type is weighed against what an agent has to read.
- **Security problems:** do not open a public issue. Follow [SECURITY.md](SECURITY.md).

## Setup

You need Node 22 or later and npm.

```sh
git clone https://github.com/heidenber/trazo.git
cd trazo
npm ci
npm test
```

`npm test` builds `dist/` before the CLI tests run, so you do not need a separate build step. To try your change by hand:

```sh
npm run build
node dist/cli/main.js example erd > diagram.json
node dist/cli/main.js make diagram.json -o diagram.html
```

## Checks

CI runs these on Node 22 and 24 for every pull request. Run them before you push:

```sh
npm run format:check
npm run gen:check
npm run typecheck
npm test
```

## Formatting

[Prettier](https://prettier.io/) formats the code, with the settings in `.prettierrc.json`. Run `npm run format` before you commit, or let your editor format on save; it picks up the project settings. Markdown, JSON, generated files and snapshots are left as written (see `.prettierignore`). `.editorconfig` sets indentation and line endings for editors that do not use Prettier.

The whole codebase is already formatted, so `npm run format` only changes the lines you wrote. CI fails if `npm run format:check` does.

The commit that first formatted the codebase is listed in `.git-blame-ignore-revs`. To skip it in `git blame`, run once:

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

GitHub skips it automatically.

## Generated files

Some files are built by scripts in `scripts/` and must not be edited by hand:

| File | Source | Script |
|---|---|---|
| `skill/AGENTS.md` | `skill/SKILL.md` | `gen-skill.mjs` |
| `THIRD_PARTY_NOTICES.md` | installed package licenses | `gen-notices.mjs` |
| font metrics, icons and the embedded font | `@fontsource/inter` and the icon list | `gen-metrics.mjs`, `gen-icons.mjs`, `gen-font.mjs` |

Change the source, then run `npm run gen`. `npm run gen:check` fails if a generated file is out of date.

## Snapshots

The example diagrams are compared with SVG snapshots in `test/__snapshots__/`. If your change is meant to alter the output, update them with:

```sh
npx vitest run -u
```

Then open the changed SVG files and check the difference is the one you intended. Say in the pull request why the output changed.

## Pull requests

- One topic per pull request. Small ones get reviewed faster.
- Add or update tests for any change in behavior. The output must stay deterministic: the same JSON gives the same HTML, byte for byte.
- If you change a command, option, field or error message, update the help text, `trazo schema`, the README (both `README.md` and `README_ES.md` when you can) and `CHANGELOG.md` under an `Unreleased` heading.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages, for example `fix(erd): keep self-reference labels inside the canvas`.
- Write your own code. Do not copy code, schemas or text from other diagram tools or agent skills; trazo was written from scratch and should stay that way. Dependencies with compatible licenses are fine, discuss new ones in the issue first.
- Comments only where the code would otherwise confuse the reader.

## License

trazo is licensed under [Apache-2.0](LICENSE). By opening a pull request you agree that your contribution is licensed under the same terms (section 5 of the license).
