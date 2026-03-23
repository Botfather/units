# Units VS Code Extension

Syntax highlighting and snippets for the Units DSL (`.ui`).

## Features
- Syntax highlighting for tags, directives, expressions, events, and strings
- Snippets for common Units patterns
- Document formatter for `.ui` files
- Format on save (toggle with `units.formatOnSave`)

## Enable Units Icons
After installing the extension, enable the bundled file icon theme:

1) Open Command Palette
2) Run: `Preferences: File Icon Theme`
3) Select: `Units Icons`

You can also set it directly in settings:

```json
{
	"workbench.iconTheme": "units-icons"
}
```

## Icon Preview

| Extension | Plugin | .ui File |
|---|---|---|
| ![Units extension icon](./media/icon-pack/extension-128.png) | ![Units plugin icon](./media/icon-pack/plugin-128.png) | ![Units .ui file icon](./media/icon-pack/file-ui-128.png) |

## Install (local)
1) Open VS Code
2) Run: `Developer: Install Extension from Location...`
3) Select this folder: `vscode/units-vscode`

## Build/Package
Use `vsce` if you want to publish:
```
npm i -g vsce
vsce package
```
