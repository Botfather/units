# Contributing

Thanks for your interest in contributing to Units.

## Ways to contribute
- Report bugs
- Suggest features
- Improve documentation
- Submit code changes

## Development setup
- Node.js 18+ recommended
- No dependencies required for the core parser

## Repo layout
- `packages/units/`: core parser, printer, runtime, custom renderer, incremental sketch
- `packages/vite-plugin-units/`: Vite plugin
- `packages/vite-plugin-units-tools/`: Vite dev tools (format/tokens/highlight)
- `packages/units-tools/`: formatter, linter, manifest/emit tools
- `packages/units-uikit-shadcn/`: Units ShadCN-style UI kit
- `examples/`: demos and sample apps

## Code style
- Keep parsing logic O(n)
- Avoid new dependencies unless clearly justified
- Prefer small, testable changes

## Pull requests
- Describe the problem and the fix
- Include tests or repro steps where possible
- Ensure `node --test` passes locally (CI runs the full suite).
- Ensure `pnpm -s test:coverage:gate` passes locally (CI enforces coverage minimums).
- Ensure `pnpm -C examples/todo-vite lint:ui` passes for the demo app

## Releases
- Use Changesets for all package version bumps.
- Run `pnpm changeset` and commit the generated file under `.changeset/`.
- On merge to `main`, GitHub Actions opens/updates a release PR with version updates.
- The VS Code extension package under `vscode/units-vscode` is intentionally private and not part of npm releases.

## Reporting issues
Open a GitHub issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (Node version, OS)
