import React from "react";
import { renderUnits } from "../../../lib/units-runtime.js";
import { withShadcnComponents } from "../../../uikit/shadcn/index.js";
import uiAst from "./gallery.ui";

export function App() {
  const scope = {
    user: {
      name: "Alex Rivera",
      role: "Design Systems",
    },
    userInitial: "A",
    email: "alex@acme.co",
    notifications: true,
    progress: 64,
    stats: [
      { label: "Active users", value: "1,284", trend: "+6%" },
      { label: "Conversion", value: "4.3%", trend: "+0.4%" },
      { label: "Churn", value: "1.1%", trend: "-0.2%" },
    ],
  };

  return renderUnits(uiAst, scope, withShadcnComponents());
}
