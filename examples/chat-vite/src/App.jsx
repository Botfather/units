import React from "react";
import { renderUnits } from "../../../lib/units-runtime.js";
import uiAst from "./chat.ui";

export function App() {
  const [draft, setDraft] = React.useState("");
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
    ];
  }

  const onDraft = (event) => setDraft(event.target?.value ?? "");

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

  const scope = {
    draft,
    messages,
    onDraft,
    sendMessage,
  };

  return renderUnits(uiAst, scope);
}
