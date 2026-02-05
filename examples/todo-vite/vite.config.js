import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import rdl from "../../lib/vite-plugin-rdl.js";
import rdlTools from "../../lib/vite-plugin-rdl-tools.js";

export default defineConfig({
  plugins: [rdlTools(), rdl(), react()],
});
