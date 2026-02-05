# RDL VS Code Extension

Syntax highlighting and snippets for the RDL DSL (`.ui`).

## Features
- Syntax highlighting for tags, directives, expressions, events, and strings
- Snippets for common RDL patterns
- Document formatter for `.ui` files
- Format on save (toggle with `rdl.formatOnSave`)

## Install (local)
1) Open VS Code
2) Run: `Developer: Install Extension from Location...`
3) Select this folder: `rdl/vscode/rdl-vscode`

## Build/Package
Use `vsce` if you want to publish:
```
npm i -g vsce
vsce package
```
