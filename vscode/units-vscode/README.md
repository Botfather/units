# Units VS Code Extension

Syntax highlighting and snippets for the Units DSL (`.ui`).

## Features
- Syntax highlighting for tags, directives, expressions, events, and strings
- Snippets for common Units patterns
- Document formatter for `.ui` files
- Format on save (toggle with `units.formatOnSave`)

## Install (local)
1) Open VS Code
2) Run: `Developer: Install Extension from Location...`
3) Select this folder: `rdl/vscode/units-vscode`

## Build/Package
Use `vsce` if you want to publish:
```
npm i -g vsce
vsce package
```
