import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import units from "@botfather/vite-plugin-units";
import unitsTools from "@botfather/vite-plugin-units-tools";

export default defineConfig({
  plugins: [unitsTools(), units(), react()],
});
