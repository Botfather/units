import React from "react";
import { renderUnits } from "../../../lib/units-runtime.js";
import { withShadcnComponents } from "../../../uikit/shadcn/index.js";
import uiAst from "./todo.ui";

export function App() {
  const [draft, setDraft] = React.useState("");
  const [todos, setTodos] = React.useState([
    { id: 1, text: "Ship Units demo", done: false },
    { id: 2, text: "Write docs", done: true },
  ]);
  const [theme, setTheme] = React.useState("default");

  React.useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const onDraft = (event) => setDraft(event.target?.value ?? "");

  const addTodo = () => {
    const text = draft.trim();
    if (!text) return;
    setTodos((prev) => [{ id: Date.now(), text, done: false }, ...prev]);
    setDraft("");
  };

  const toggleTodo = (id) => {
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const removeTodo = (id) => {
    setTodos((prev) => prev.filter((t) => t.id !== id));
  };

  const scope = {
    draft,
    todos,
    theme,
    onDraft,
    addTodo,
    toggleTodo,
    removeTodo,
    setThemeDefault: () => setTheme("default"),
    setThemeSlate: () => setTheme("slate"),
  };

  return renderUnits(uiAst, scope, withShadcnComponents());
}
