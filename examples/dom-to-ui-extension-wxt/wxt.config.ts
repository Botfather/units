import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Units DOM to .ui",
    description: "Convert the current page DOM into Units .ui DSL.",
    permissions: ["activeTab", "tabs"],
    host_permissions: ["<all_urls>"],
    action: {
      default_title: "Convert DOM to .ui",
    },
  },
});
