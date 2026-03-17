import React from "react";
import { renderUnits } from "@botfather/units";
import uiAst from "./learn.ui";

export function App() {
  const [count, setCount] = React.useState(0);
  const [draft, setDraft] = React.useState("");
  const [todos, setTodos] = React.useState([
    { id: 1, text: "Read the grammar section", done: false },
    { id: 2, text: "Compare JSX vs Units", done: false },
    { id: 3, text: "Build something with .ui files", done: false },
  ]);

  const scope = {
    count,
    draft,
    todos,
    increment: () => setCount((c) => c + 1),
    decrement: () => setCount((c) => c - 1),
    reset: () => setCount(0),
    onDraft: (event) => setDraft(event.target?.value ?? ""),
    addTodo: () => {
      const text = draft.trim();
      if (!text) return;
      setTodos((prev) => [...prev, { id: Date.now(), text, done: false }]);
      setDraft("");
    },
    toggleTodo: (id) =>
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t))
      ),
    removeTodo: (id) =>
      setTodos((prev) => prev.filter((t) => t.id !== id)),
  };

  return renderUnits(uiAst, scope);
}
