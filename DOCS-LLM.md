# Units LLM/Agent Optimization Guide

This document describes a **machine-friendly authoring profile** for Units. It is fully compatible with the current parser/runtime, but narrows style choices so LLMs and coding agents produce predictable, compact, and easily diffable `.ui` files.

## Goals
- **Deterministic output**: small edits produce small diffs.
- **Low token cost**: minimal syntax while staying unambiguous.
- **Fast parsing**: avoids ambiguous patterns and heavy expressions.
- **Agent-friendly**: simple rules, stable conventions, easy validation.

## LLM Authoring Profile (Recommended)
Use these rules for all LLM/agent-generated `.ui` files:

1) **Always use parentheses for props**
```
Button (label:'Save')
Card (class:'panel') { ... }
```
Avoid inline props without parentheses.

2) **Always comma-separate props**
```
Input (
  value=@draft,
  placeholder:'Add item',
  !input { onDraft(@event) }
)
```
No trailing comma on the last prop.

3) **One node per line**
Each tag, `text`, and `@expr` gets its own line. Avoid combining text and expressions on a single line.

4) **Use single quotes for strings**
Single quotes reduce escaping and improve token stability.

5) **No implicit text**
Always use `text '...'` for string literals.

6) **Prefer short expressions**
Move complex JS into scope variables. Use `@simple` or `@(simple)` only.

7) **Always key loops**
```
#for (item in @items) {
  #key (@item.id)
  ItemRow (item=@item)
}
```

8) **Avoid side effects in expressions**
Expressions are evaluated with `Function` + `with(scope)` and should be **pure**.
Use event handlers for mutations.

9) **Use explicit handlers**
Prefer `!event { handler(@event) }` over inline logic.

10) **Never embed @ inside raw text**
`@` is reserved for expressions. If you need a literal `@`, use `text '@'`.

## Canonical Formatting
Run the formatter on every save or commit:
```
node tools/units-format.mjs <file-or-dir>
```
This normalizes whitespace and prevents accidental drift.

## Minimal Grammar Subset (LLM Profile)
This is the recommended safe subset for agents:
```
Tag (props) { children }
Tag (props)
text 'literal'
@expr
#if (@cond) { ... }
#for (item, i in @list) { ... }
#slot (name) { ... }
#key (@expr)
```
Props:
```
key:'value'
key:@expr
key?:@expr
!event { handler(@event) }
on:event={ handler(@event) }
```

## Expression Guidelines
- Treat expressions as **raw JS strings** evaluated at runtime.
- Prefer **variables and helpers** in `scope` for complex logic.
- Use `@( ... )` if you need operator precedence.
- Avoid multiline expressions.

## Agent-Friendly Component Contracts
When generating components, include a short contract in comments or docs:
```
Component: Button
Props: label (string), tone (string), onClick (fn)
Slots: default
```
This helps LLMs stay consistent and reduces prop drift.

## Example (LLM Profile)
```
App {
  Header (title:'Tasks')
  InputRow (
    value=@draft,
    !input { onDraft(@event) },
    !click { addTask() }
  )
  #if (@items.length == 0) {
    text 'Nothing here yet.'
  }
  List {
    #for (item in @items) {
      #key (@item.id)
      TaskRow (
        item=@item,
        !toggle { toggleTask(@item.id) },
        !remove { removeTask(@item.id) }
      )
    }
  }
}
```

## Validation Workflow
Recommended pipeline for agents:
1) **Parse**: `node tools/units-emit.mjs <file>`
2) **Format**: `node tools/units-format.mjs <file>`
3) **Lint**: `node tools/units-lint.mjs <file>`
4) **AST/manifest watch**: `node tools/units-watch.mjs <rootDir> <outFile>`

## LLM Prompt Template (Suggested)
```
You are editing a Units .ui file.
Use the LLM Authoring Profile from DOCS-LLM.md.
- Always include props in parentheses.
- Always use commas between props.
- Use single quotes.
- One node per line.
Return only the updated .ui file contents.
```

## Rationale
The LLM profile reduces ambiguity for parsers and agents, improves diff quality, and minimizes token usage while preserving expressiveness. It is designed to work with the existing Units parser and runtime without any code changes.
