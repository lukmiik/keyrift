/**
 * Builds the three parts of the Electron app (spike: architecture §5 item 1):
 * - renderer: index.html + src/renderer → dist/ (normal Vite web build, React via plugin-react)
 * - main: src/main/main.ts → dist-electron/main.js
 * - preload: src/preload/preload.ts → dist-electron/preload.cjs
 *
 * `vp dev` serves the renderer, builds main + preload, and starts Electron (restarting it when main
 * changes). `vp build` builds all three for running without the dev server.
 */
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite-plus";
import electron from "vite-plugin-electron/simple";

/** The page's Content Security Policy, as written in index.html. */
const CSP = `content="default-src 'self'"`;

/**
 * In `vp dev` only, also allows inline styles: Vite injects CSS as `<style>` tags there, which the
 * strict policy blocks, leaving the page unstyled. The built app loads CSS as a file and keeps the
 * strict policy. Inline scripts stay blocked in both.
 */
function devStyleCsp(): Plugin {
  return {
    name: "keyrift:dev-style-csp",
    apply: "serve",
    transformIndexHtml(html) {
      if (!html.includes(CSP)) {
        throw new Error("index.html's CSP changed: update devStyleCsp in vite.config.ts");
      }
      return html.replace(CSP, `content="default-src 'self'; style-src 'self' 'unsafe-inline'"`);
    },
  };
}

export default defineConfig({
  resolve: {
    // `@/…` = src/renderer/…, the import style shadcn's generated components use. Must match
    // `paths` in tsconfig.json and tsconfig.web.json.
    alias: { "@": fileURLToPath(new URL("src/renderer", import.meta.url)) },
  },
  plugins: [
    // Tailwind: scans the source for class names and generates only the CSS they need.
    tailwindcss(),
    // Turns JSX into JavaScript and refreshes changed components in `vp dev` without a reload.
    react(),
    devStyleCsp(),
    electron({
      // In dev the plugin starts Electron with `--no-sandbox`. Ubuntu 24.04+ blocks the user
      // namespaces Chromium's OS sandbox needs, and the setuid helper in node_modules is not
      // root-owned, so with the sandbox Electron aborts at start. Dev only loads our own code from
      // localhost; the page still has no Node access. The installed app is handled at packaging
      // (architecture §5 item 1).
      main: { entry: "src/main/main.ts" },
      preload: {
        input: "src/preload/preload.ts",
        // A sandboxed preload must be CommonJS. The plugin builds CommonJS but would name it
        // `.mjs` in an ESM package, which Electron then refuses; `.cjs` says what it is.
        vite: { build: { rolldownOptions: { output: { entryFileNames: "[name].cjs" } } } },
      },
    }),
  ],
});
