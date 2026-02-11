import React from "react";
import { renderUnits } from "../../../lib/units-runtime.js";
import { withShadcnComponents } from "../../../uikit/shadcn/index.js";
import uiAst from "./portfolio.ui";

export function App() {
  const scope = {
    profile: {
      name: "Zom Nom",
      role: "Product Designer",
      location: "Ghata, Usa",
      initials: "RP",
    }
  };

  return renderUnits(uiAst, scope, withShadcnComponents());
}
