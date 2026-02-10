import React from "react";
import { createUnitsEvaluator, renderUnits } from "../../../lib/units-runtime.js";
import { parseUnits } from "../../../lib/units-parser.js";
import { shadcnComponents, withShadcnComponents } from "../../../uikit/shadcn/index.js";
import uiAst from "./chat.ui";

const BASIC_TAGS = new Set([
  "div",
  "span",
  "p",
  "small",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "header",
  "footer",
  "section",
  "article",
  "nav",
  "main",
  "pre",
  "code",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "button",
  "input",
  "textarea",
  "img",
  "a",
]);

const BLOCKED_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "UnitsBubble",
]);

const ALLOWED_TAGS = new Set([...Object.keys(shadcnComponents), ...BASIC_TAGS]);
const ALLOWED_DIRECTIVES = new Set(["if", "for", "key"]);
const UNSAFE_EXPR = /(\\bwindow\\b|\\bdocument\\b|\\bglobalThis\\b|\\bFunction\\b|\\beval\\b|__proto__|constructor|prototype)/;
const embeddedEval = createUnitsEvaluator();

function isSafeExpression(raw) {
  if (!raw || typeof raw !== "string") return true;
  return !UNSAFE_EXPR.test(raw);
}

function extractInterpolations(text) {
  const matches = [];
  const regex = /@\\{([^}]+)\\}/g;
  let match = regex.exec(text);
  while (match) {
    matches.push(match[1]);
    match = regex.exec(text);
  }
  return matches;
}

function isSafeAst(node) {
  if (!node) return true;
  if (node.type === "document") {
    return (node.body || []).every(isSafeAst);
  }
  if (node.type === "text") {
    const pieces = extractInterpolations(node.value || "");
    return pieces.every(isSafeExpression);
  }
  if (node.type === "expr") {
    return isSafeExpression(node.value?.raw);
  }
  if (node.type === "directive") {
    if (!ALLOWED_DIRECTIVES.has(node.name)) return false;
    if (!isSafeExpression(node.args || "")) return false;
    return (node.children || []).every(isSafeAst);
  }
  if (node.type === "tag") {
    const name = node.name;
    if (BLOCKED_TAGS.has(name)) return false;
    if (!ALLOWED_TAGS.has(name)) return false;
    for (const prop of node.props || []) {
      if (prop.kind === "event") {
        if (!isSafeExpression(prop.expr?.raw)) return false;
        continue;
      }
      if ((prop.kind === "expr" || prop.kind === "bool") && !isSafeExpression(prop.expr?.raw)) {
        return false;
      }
    }
    return (node.children || []).every(isSafeAst);
  }
  return false;
}

function stripEventsAst(node, interactive) {
  if (!node || interactive) return node;
  if (node.type === "document") {
    return { ...node, body: (node.body || []).map((child) => stripEventsAst(child, interactive)) };
  }
  if (node.type === "directive") {
    return { ...node, children: (node.children || []).map((child) => stripEventsAst(child, interactive)) };
  }
  if (node.type === "tag") {
    const filteredProps = (node.props || []).filter((prop) => {
      if (prop.kind === "event") return false;
      if (prop.key && typeof prop.key === "string" && prop.key.startsWith("on")) return false;
      return true;
    });
    return {
      ...node,
      props: filteredProps,
      children: (node.children || []).map((child) => stripEventsAst(child, interactive)),
    };
  }
  return node;
}

function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (depth > 3) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeValue(item, depth + 1, seen))
      .filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      const safe = sanitizeValue(val, depth + 1, seen);
      if (safe !== undefined) out[key] = safe;
    }
    return out;
  }
  return undefined;
}

function sanitizeActions(actions) {
  if (!actions || typeof actions !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(actions)) {
    if (typeof value === "function") {
      out[key] = (...args) => {
        try {
          return value(...args);
        } catch (err) {
          return undefined;
        }
      };
    }
  }
  return out;
}

function buildSafeScope(outerScope, provided) {
  const safeOuter = outerScope && typeof outerScope === "object" ? outerScope : {};
  const base = {
    theme: safeOuter.theme || "default",
    draft: "",
    todos: [],
    items: [],
    list: [],
  };
  const extra = sanitizeValue(provided) || {};
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    return { ...base, ...extra };
  }
  return base;
}

function safeEvalExpr(raw, scope, locals) {
  try {
    return embeddedEval(raw, scope, locals);
  } catch (err) {
    return "";
  }
}

export function App() {
  const [draft, setDraft] = React.useState("");
  const [theme, setTheme] = React.useState("default");
  const [unitsModal, setUnitsModal] = React.useState({
    open: false,
    dsl: "",
    scope: null,
    interactive: true,
  });
  const [context] = React.useState({
    customer: "Aarav",
    orderId: "A-1042",
    eta: "Today 6:00 PM",
    tracking: "1Z 204 88X 990",
  });
  const [messages, setMessages] = React.useState(() => {
    return buildMessages(context);
  });

  function buildMessages(ctx) {
    return [
      {
        id: 1,
        from: "them",
        name: "Support",
        time: "09:41",
        parts: [
          { kind: "text", value: "Hi" },
          { kind: "ctx", label: "", value: ctx.customer },
          { kind: "text", value: ", your order " },
          { kind: "ctx", label: "#", value: ctx.orderId },
          { kind: "text", value: " is on the way." },
        ],
      },
      {
        id: 2,
        from: "them",
        name: "Support",
        time: "09:42",
        parts: [
          { kind: "text", value: "ETA: " },
          { kind: "ctx", label: "", value: ctx.eta },
          { kind: "text", value: " • Tracking " },
          { kind: "ctx", label: "", value: ctx.tracking },
        ],
      },
      {
        id: 3,
        from: "me",
        name: "You",
        time: "09:43",
        parts: [
          { kind: "text", value: "Thanks! Can you leave it at the door?" },
        ],
      },
      {
        id: 4,
        from: "them",
        name: "Support",
        time: "09:44",
        parts: [
          { kind: "text", value: "Absolutely. I added a " },
          { kind: "ctx", label: "note", value: "Leave at door" },
          { kind: "text", value: " for the courier." },
        ],
      },
      {
        id: 5,
        from: "them",
        name: "Support",
        time: "09:45",
        parts: [
          { kind: "text", value: "Here's a quick todo list:" },
          {
            kind: "units",
            value: `div (class:'app') {
  div (class:'header-row') {
    div (class:'title-stack') {
      h1 {
        text 'Todo'
      }
      p (class:'subtitle') {
        text 'Built with Units'
      }
    }
    div (class:'theme-switch') {
      Button (
        size:'sm',
        variant=@(theme == 'default' ? 'secondary' : 'outline'),
        onClick=@setThemeDefault
      ) {
        text 'Default'
      }
      Button (
        size:'sm',
        variant=@(theme == 'slate' ? 'secondary' : 'outline'),
        onClick=@setThemeSlate
      ) {
        text 'Slate'
      }
    }
  }
  div (class:'input-row') {
    Input (value=@draft, placeholder:'Add a todo', onInput=@onDraft)
    Button (disabled?=@draft.trim().length==0, onClick=@addTodo) {
      text 'Add'
    }
  }
  #if (@todos.length == 0) {
    p (class:'empty') {
      text 'No todos yet.'
    }
  }
  ul (class:'list') {
    #for (item, i in @todos) {
      li (class:'item') {
        Checkbox (checked?=@item.done, onCheckedChange=@(event => toggleTodo(@item.id)))
        span (class=@(item.done ? 'done' : '')) {
          @item.text
        }
        Button (variant:'ghost', size:'sm', onClick=@(event => removeTodo(@item.id))) {
          text 'Delete'
        }
      }
    }
  }
}`,
          },
        ],
      },
    ];
  }

  function UnitsBubble({ dsl, fallback, scope, actions, __scope, interactive }) {
    const safeScope = buildSafeScope(__scope, scope);
    const [draft, setDraft] = React.useState(() => safeScope.draft || "");
    const [todos, setTodos] = React.useState(() => (Array.isArray(safeScope.todos) ? safeScope.todos : []));
    const [localTheme, setLocalTheme] = React.useState(() => safeScope.theme || "default");
    const allowInteractive = interactive !== false;

    const onDraft = (event) => setDraft(event?.target?.value ?? "");
    const addTodo = () => {
      const text = String(draft || "").trim();
      if (!text) return;
      setTodos((prev) => [{ id: Date.now(), text, done: false }, ...prev]);
      setDraft("");
    };
    const toggleTodo = (id) => {
      setTodos((prev) => prev.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
    };
    const removeTodo = (id) => {
      setTodos((prev) => prev.filter((item) => item.id !== id));
    };

    const localScope = {
      ...safeScope,
      theme: localTheme,
      draft,
      todos,
      onDraft,
      addTodo,
      toggleTodo,
      removeTodo,
      setThemeDefault: () => setLocalTheme("default"),
      setThemeSlate: () => setLocalTheme("slate"),
      actions: {
        onDraft,
        addTodo,
        toggleTodo,
        removeTodo,
        setThemeDefault: () => setLocalTheme("default"),
        setThemeSlate: () => setLocalTheme("slate"),
        ...sanitizeActions(scope?.actions),
        ...sanitizeActions(actions),
      },
    };

    if (typeof dsl !== "string") return fallback ?? "";
    try {
      const ast = parseUnits(dsl);
      if (!isSafeAst(ast)) return fallback ?? dsl;
      const safeAst = stripEventsAst(ast, allowInteractive);
      return renderUnits(safeAst, localScope, { components: shadcnComponents, evalExpr: safeEvalExpr });
    } catch (err) {
      return fallback ?? dsl;
    }
  }

  const onDraft = (event) => {
    const nextValue = event?.target?.value ?? "";
    setDraft(nextValue);
    const el = event?.target;
    if (el && el.style) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    }
  };
  const onDraftKeydown = (event) => {
    if (event?.key === "Enter" && !event?.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const sendMessage = () => {
    const text = draft.trim();
    if (!text) return;
    const next = {
      id: Date.now(),
      from: "me",
      name: "You",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      parts: [{ kind: "text", value: text }],
    };
    setMessages((prev) => [...prev, next]);
    setDraft("");
  };

  const openUnitsModal = (dsl, scopeData, interactive) => {
    setUnitsModal({
      open: true,
      dsl: typeof dsl === "string" ? dsl : "",
      scope: scopeData && typeof scopeData === "object" ? scopeData : null,
      interactive: interactive !== false,
    });
  };

  const closeUnitsModal = () => {
    setUnitsModal((prev) => ({ ...prev, open: false }));
  };

  const scope = {
    draft,
    theme,
    messages,
    unitsModalOpen: unitsModal.open,
    unitsModalDsl: unitsModal.dsl,
    unitsModalScope: unitsModal.scope,
    unitsModalInteractive: unitsModal.interactive,
    onDraft,
    onDraftKeydown,
    sendMessage,
    setThemeDefault: () => setTheme("default"),
    setThemeSlate: () => setTheme("slate"),
    openUnitsModal,
    closeUnitsModal,
  };

  return renderUnits(
    uiAst,
    scope,
    withShadcnComponents({
      components: {
        UnitsBubble,
      },
    }),
  );
}
