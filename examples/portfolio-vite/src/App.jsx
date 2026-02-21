import React from "react";
import { renderUnits } from "../../../lib/units-runtime.js";
import { withShadcnComponents } from "../../../uikit/shadcn/index.js";
import uiAst from "./portfolio.ui";

export function App() {
  const scope = {
    features: [
      {
        title: "O(n) Parser",
        desc: "Single-pass linear-time parser. No backtracking, no lookahead. Predictable performance on any input size.",
      },
      {
        title: "Dependency-Free",
        desc: "Zero external dependencies. The parser is a single self-contained JavaScript module you can drop anywhere.",
      },
      {
        title: "AST-First Architecture",
        desc: "Every .ui file compiles to a clean JSON AST. Inspect it, transform it, cache it, serialize it.",
      },
      {
        title: "React Runtime",
        desc: "Built-in React renderer with expression evaluation, event handling, and component mapping out of the box.",
      },
      {
        title: "Custom Renderer API",
        desc: "Plug in any rendering target. The host interface is minimal: element, text, and fragment hooks.",
      },
      {
        title: "Vite Integration",
        desc: "First-class Vite plugin transforms .ui files at build time. HMR, dev tools, and formatting included.",
      },
      {
        title: "Dev Tools & Formatting",
        desc: "CLI tools for linting, formatting, and printing Units files. Keep your codebase consistent automatically.",
      },
      {
        title: "Incremental Parsing",
        desc: "Reference implementation for incremental re-parsing. Only reparse the changed subtree, reuse the rest.",
      },
      {
        title: "ShadCN UI Kit",
        desc: "Complete ShadCN component library rebuilt in Units DSL. Production-ready components, zero JSX needed.",
      },
    ],
    syntaxExamples: [
      {
        title: "Basic Tags",
        code: `Card {
  CardHeader {
    CardTitle {
      text 'Dashboard'
    }
  }
  CardContent {
    text 'Welcome back.'
  }
}`,
      },
      {
        title: "Props",
        code: `Button (variant:'outline' size:'sm') {
  text 'Click me'
}

Input (placeholder:'Search...' value=@query)`,
      },
      {
        title: "Expressions",
        code: `@user.name

text 'Hello @{user.name}'

Badge {
  @stats.count
}`,
      },
      {
        title: "Conditionals",
        code: `#if (@user.loggedIn) {
  Avatar {
    AvatarFallback {
      @user.initials
    }
  }
}`,
      },
      {
        title: "Loops",
        code: `#for (item, i in @items) {
  #key (@item.id)
  Card {
    CardTitle { @item.name }
    Badge { @item.status }
  }
}`,
      },
      {
        title: "Event Handlers",
        code: `Button (!click { set(selected:=@item.id) }) {
  text 'Select'
}

Input (!input {
  set(query:=event.target.value)
})`,
      },
    ],
    archSteps: [
      {
        number: "1",
        title: "Parse",
        desc: "The O(n) parser reads .ui source and produces a JSON AST in a single pass. No dependencies, no intermediate representations.",
      },
      {
        number: "2",
        title: "Transform",
        desc: "The AST is a plain data structure. Cache it, serialize it, transform it with plugins, or ship it as static JSON.",
      },
      {
        number: "3",
        title: "Render",
        desc: "The React runtime walks the AST, evaluates expressions against your scope, resolves components, and produces a React element tree.",
      },
    ],
    benefits: [
      {
        title: "Performance",
        desc: "Linear-time parsing, build-time compilation via Vite, and minimal runtime overhead. Your UI loads fast and stays fast.",
      },
      {
        title: "Simplicity",
        desc: "A small, learnable grammar with predictable rules. No JSX transpilation, no template compiler complexity.",
      },
      {
        title: "Flexibility",
        desc: "Works with React out of the box, but the renderer is pluggable. Target any framework or custom output.",
      },
      {
        title: "Extensibility",
        desc: "Add custom directives at the renderer layer without modifying the parser. The AST is open for tooling.",
      },
      {
        title: "Build-Time Parsing",
        desc: "The Vite plugin parses .ui files at build time and ships static AST. Zero parsing cost at runtime.",
      },
      {
        title: "Minimal Overhead",
        desc: "The runtime is a thin evaluation layer. No virtual DOM diff, no reactive proxy system. Just functions and data.",
      },
    ],
  };

  return renderUnits(uiAst, scope, withShadcnComponents());
}
