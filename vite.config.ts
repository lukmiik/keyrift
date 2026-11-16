import { defineConfig } from "vite-plus";

export default defineConfig({
  // `vp test` from the root runs each package with its own config (aliases, React plugin).
  test: { projects: ["apps/*", "packages/*"] },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    overrides: [
      {
        // The page (and code shared with it) runs in a sandboxed renderer without Node. Node or
        // Electron imports there can't work, and type imports from main/preload drag their Node
        // types into the page's type check. Only the preload may hand the page system access.
        files: ["apps/desktop/src/renderer/**", "apps/desktop/src/shared/**"],
        // React's rules: hooks only at the top of a component, and effects list what they use.
        plugins: ["react"],
        rules: {
          "react/rules-of-hooks": "error",
          "react/exhaustive-deps": "error",
          "no-restricted-imports": [
            "error",
            {
              patterns: [
                {
                  group: ["node:*", "electron", "electron/*", "**/main/**", "**/preload/**"],
                  message:
                    "The page has no Node/Electron access: get it through window.keyrift (src/preload).",
                },
              ],
            },
          ],
        },
      },
    ],
  },
});
