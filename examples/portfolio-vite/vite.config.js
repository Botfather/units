import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import units from "../../lib/vite-plugin-units.js";
import unitsTools from "../../lib/vite-plugin-units-tools.js";

export default defineConfig({
  plugins: [unitsTools(), units(), react()],
});
