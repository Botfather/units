# Units Documentation

Units is a minimal DSL for rendering interactive UI trees with React or a custom renderer. It is designed for fast parsing (single pass, O(n)), low token count, and easy extensibility.

## 1) Quick Start

```js
import { parseUnits } from "./lib/units-parser.js";
import { renderUnits } from "./lib/units-runtime.js";

const dsl = `
App {
  Header (title:'Dashboard')
  #if (@user.loggedIn) {
    List {
      #for (item, i in @items) {
        Card (key:@item.id) {
          text 'Item: '
          @item.name
          Button (label:'Select' !click { set(selected:=@item.id) })
        }
      }
    }
  }
  #slot (footer)
}
`;

const ast = parseUnits(dsl);
const element = renderUnits(ast, {
  user: { loggedIn: true },
  items: [{ id: 1, name: "One" }, { id: 2, name: "Two" }],
  set: (path, value) => console.log("set", path, value),
});
```

## 2) Design Goals

- Fast parsing: O(n), no dependencies, minimal allocations.
- Low token count: short syntax with predictable rules.
- Extensible: directives can be added without changing the parser.
- Render-agnostic: React renderer and custom renderer provided.

## 3) Grammar Summary

```
Document   := Node*
Node       := TagNode | TextNode | ExprNode | Directive
TagNode    := Ident Props? Children?
Props      := "(" Prop (","? Prop)* ")"
Prop       := Ident (":" Value | "=" Expr | "?=" Expr) | Event
Event      := "!" Ident "{" Expr "}" | Ident ":" "{" Expr "}"
Children   := "{" Node* "}"
TextNode   := "text" String
ExprNode   := "@" Expr
Directive  := "#" Ident ("(" Args ")")? Children?
Value      := String | Number | true | false | null
Expr       := Raw JS until delimiter
```

Expressions are not parsed by the DSL. They are kept as raw strings for the renderer to evaluate.

## 4) Syntax Details

### 4.1 Tags
```
Button (label:'Click')
Card { text 'Hello' }
Row (gap:8) { Col { text 'A' } Col { text 'B' } }
```

### 4.2 Text
```
text 'Literal text'
@user.name
```

### 4.3 Props
```
key:'string'
count:123
enabled:true
value=@expr
visible?=@expr
```

Props may be inline (without parentheses):
```
Button label:'OK' disabled?=@isBusy
```

### 4.4 Events
```
!click { set(selected:=@item.id) }
on:input={ set(text:=event.target.value) }
```

`!event` is shorthand for `on:event`.

### 4.5 Directives
```
#if (@user.loggedIn) { ... }
#for (item, i in @items) { ... }
#slot (footer) { ... }
#key (@item.id)
```

## 5) Rendering Model

### 5.1 React Renderer
`renderUnits(ast, scope, options)`

- `scope`: data model; can include `set`.
- `options.components`: map tag names to React components.
- `options.slots`: named slot values or functions.
- `options.set`: override `set`.

The React renderer evaluates expressions with a cached `Function` and uses `with(scope)` for simplicity.

### 5.2 Custom Renderer
Use `createRenderer(host)` in `custom-renderer.js`. The host must provide:

```
const host = {
  element: (name, props, events, children) => ..., // create a node
  text: (value) => ...,                           // create text
  fragment: (children) => ...,                    // group children
};
```

## 6) Data Binding

Units uses one-way bindings by default for performance. For interactivity, use event handlers:

```
!click { set(selected:=@item.id) }
```

The React runtime transforms `set(x:=expr)` into `set('x', expr)`.

## 7) Extending the DSL

Add custom directives at the renderer layer without modifying the parser. Example:

```
#memo (@key) { ... }
#portal (@target) { ... }
#animate (@config) { ... }
```

## 8) Performance Notes

- Parsing is linear time O(n).
- Expressions are not parsed; only sliced.
- AST nodes include `start/end` offsets for caching or incremental parsing.
- If rendering frequently, memoize parsed ASTs and only update `scope`.

## 9) Incremental Parsing Sketch

See `incremental.js` for a reference strategy:

1) Compute changed range between old and new source.
2) Find smallest AST node that encloses the change.
3) Reparse only that slice and splice the new subtree.
4) Adjust parent offsets and reuse unchanged nodes.

A safe fallback is to reparse the whole document.

## 10) Security and Sandbox Considerations

Expressions are raw JS evaluated with `Function` and `with`. This is powerful but not sandboxed. For untrusted input:

- Provide a restricted evaluator that only exposes safe helpers.
- Avoid `with` and use a small expression parser instead.
- Run evaluation in a sandboxed environment.

## 11) Error Handling

The parser throws an error with a character offset and a snippet of context. You can wrap `parseUnits` and surface friendly errors.

## 12) Demo App

- Vite: `examples/todo-vite`

This demo renders a todo list using only `.ui` files for UI structure.

## 13) Best Practices

- Keep expressions short and focused.
- Prefer `#for` + `#key` to keep list rendering stable.
- Memoize `parseUnits` results.
- Provide a controlled `set` function.

## 14) FAQ

**Why not parse expressions?**
Speed and extensibility. The DSL stays small and delegates semantics to the renderer.

**Can I add new directives?**
Yes. The parser treats them generically. Implement behavior in your renderer.

**How do I support custom components?**
Map tag names in `options.components` for React, or map in your custom host.
