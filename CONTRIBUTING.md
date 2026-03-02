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
- Ensure `npm run lint:ui` passes for the demo app

## Reporting issues
Open a GitHub issue with:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment details (Node version, OS)
