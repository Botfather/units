# Contributing

Thanks for your interest in contributing to RDL.

## Ways to contribute
- Report bugs
- Suggest features
- Improve documentation
- Submit code changes

## Development setup
- Node.js 18+ recommended
- No dependencies required for the core parser

## Repo layout
- `parser.js`: core parser
- `react-runtime.js`: React renderer
- `custom-renderer.js`: custom renderer skeleton
- `tools/`: formatter, linter, manifest/emit tools
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
