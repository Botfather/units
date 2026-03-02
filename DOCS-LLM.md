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

7) **Inline interpolation is allowed**
Use `text 'Hello @{name}'` for small inserts. Prefer tags or `@expr` nodes for complex output.

8) **Always key loops**
```
#for (item in @items) {
  #key (@item.id)
  ItemRow (item=@item)
}
```

9) **Avoid side effects in expressions**
Expressions are evaluated with `Function` + `with(scope)` and should be **pure**.
Use event handlers for mutations.

10) **Use explicit handlers**
Prefer `!event { handler(@event) }` over inline logic.

11) **Never embed @ inside raw text**
`@` is reserved for expressions. If you need a literal `@`, use `text '@'`.

### Compact Syntax (Optional, Token-First)
The language also supports compact forms for stricter token budgets:
```
'Literal text'                 // shorthand for text 'Literal text'
#slot content                  // shorthand for #slot (content)
#if @cond { ... }              // shorthand for #if (@cond) { ... }
#for item in @items { ... }    // shorthand for #for (item in @items) { ... }
```

Use compact syntax only when token savings matter more than readability/diff stability.

## Canonical Formatting
Run the formatter on every save or commit:
```
units-format <file-or-dir>
```
This normalizes whitespace and prevents accidental drift.

## Minimal Grammar Subset (LLM Profile)
This is the recommended safe subset for agents:
```
Tag (props) { children }
Tag (props)
text 'literal'
text 'Hello @{name}'
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
1) **Parse**: `units-emit <file>`
2) **Format**: `units-format <file>`
3) **Lint**: `units-lint <file>`
4) **AST/manifest watch**: `units-watch <rootDir> <outFile>`

## LLM Benchmark Workflow
Use the benchmark harness to measure token usage and output quality per model.

Offline (estimated tokens from reference cases):
```
npm run bench:llm
```

Live (real model runs + provider usage tokens):
```
OPENAI_API_KEY=... npm run bench:llm:live
```

Inputs:
- Cases file: `bench/llm-cases.json`
- Reference DSL: `bench/cases/*.ui`
- Optional baselines: `bench/cases/*.jsx` (for DSL vs baseline token ratio)

Outputs:
- JSON metrics: `bench/results/*.json`
- Markdown report: `bench/results/*.md`

Quality checks per run:
- parse success (`parseUnits`)
- required syntax snippets present
- exact normalized match vs reference DSL (when available)

## React vs DSL Hypothesis Test
To validate whether Units DSL uses fewer tokens than direct React code:
```
npm run bench:react-vs-dsl
```

This benchmark runs:
- Curated React vs DSL equivalent pairs from `bench/cases/`
- Exhaustive synthetic matrix (depth, props, events, loops, conditions, text/interpolation, expression complexity)

Outputs:
- `bench/results/react-vs-dsl.json`
- `bench/results/react-vs-dsl.md`

Primary decision metric in report:
- lexical token approximation (`lexical`) with explicit hypothesis verdict

For exact provider tokenization (`usage.input_tokens`), run:
```
OPENAI_API_KEY=... npm run bench:react-vs-dsl:provider
```

To include both provider and approximation metrics in one report:
```
OPENAI_API_KEY=... npm run bench:react-vs-dsl:provider:both
```

To run the compact optimized DSL pair set:
```
OPENAI_API_KEY=... npm run bench:react-vs-dsl:provider:optimized
```

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
