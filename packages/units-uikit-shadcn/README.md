# @botfather/units-uikit-shadcn

A complete UI component kit modeled after [shadcn/ui](https://ui.shadcn.com/), with every component authored as a Units `.ui` template. Drop-in shadcn-style components for any Units-based rendering pipeline — no JSX required.

## What is it?

This package ships ~260 pre-built components covering the full shadcn/ui component set: buttons, cards, dialogs, tables, forms, navigation, data display, and more. Each component is a Units `.ui` template that produces Tailwind-class-based markup. Behavioral concerns (Radix primitives, state, portals) are wired in the host application's renderer layer, keeping the templates pure and portable.

## Installation

```sh
npm install @botfather/units-uikit-shadcn @botfather/units react
```

Import the stylesheet once at your app entry point:

```js
import "@botfather/units-uikit-shadcn/shadcn.css";
```

## Usage

### Quick start with the React renderer

```js
import { renderUnits } from "@botfather/units/runtime";
import uiAst from "./app.ui"; // via vite-plugin-units
import { withShadcnComponents } from "@botfather/units-uikit-shadcn";
import "@botfather/units-uikit-shadcn/shadcn.css";

// withShadcnComponents() merges all ~260 components into renderUnits options
const element = renderUnits(uiAst, scope, withShadcnComponents());
```

### Selective import

```js
import { shadcnComponents } from "@botfather/units-uikit-shadcn";

renderUnits(ast, scope, {
  components: {
    Button: shadcnComponents.Button,
    Card: shadcnComponents.Card,
  },
});
```

### Wrapping a single component

```js
import { createUnitsComponent } from "@botfather/units-uikit-shadcn";
import { uiManifest } from "@botfather/units-uikit-shadcn/shadcn-manifest.js";

const Button = createUnitsComponent(uiManifest.Button);
// <Button variant="primary" className="...">Click me</Button>
```

## Component contract

- All components receive a `props` object in scope (e.g. `{ className, variant, size, ... }`).
- Children are passed as the `default` slot via `#slot (default)` in the template.
- Tailwind class composition is handled inside `@(...)` expressions within the templates.
- Behavioral wiring (Radix, state, portals) belongs in the host renderer or wrapper components.

## Available components

- Accordion
- Alert
- AlertDialog
- AspectRatio
- Avatar
- Badge
- Breadcrumb
- Button
- ButtonGroup
- Calendar
- Card
- Carousel
- Chart
- Checkbox
- Collapsible
- Combobox
- Command
- ContextMenu
- DataTable
- DatePicker
- Dialog
- Direction
- Drawer
- DropdownMenu
- Empty
- Field
- HoverCard
- Input
- InputGroup
- InputOTP
- Item
- Kbd
- Label
- Menubar
- NativeSelect
- NavigationMenu
- Pagination
- Popover
- Progress
- RadioGroup
- ResizablePanel
- ScrollArea
- Select
- Separator
- Sheet
- Sidebar
- Skeleton
- Slider
- Sonner
- Spinner
- Switch
- Table
- Tabs
- Textarea
- Toggle
- Tooltip
- Typography — H1, H2, H3, H4, P, Blockquote, List, Muted, Small, Large, Lead, InlineCode

## Package exports

| Export path | Description |
|---|---|
| `@botfather/units-uikit-shadcn` | `createUnitsComponent`, `shadcnComponents`, `withShadcnComponents` |
| `@botfather/units-uikit-shadcn/shadcn.css` | CSS custom properties and Tailwind base stylesheet |
| `@botfather/units-uikit-shadcn/shadcn-manifest.js` | Raw `uiManifest` — `Record<string, AST>` |
| `@botfather/units-uikit-shadcn/shadcn/*` | Individual `.ui` template files |

## License

MIT
