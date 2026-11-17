/**
 * Renderer entry: the web page inside the window. React draws <App> into `<div id="root">`.
 * The page has no Node access; everything system-related goes through `window.keyrift`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.tsx";
import "./index.css";

const root = document.querySelector("#root");
if (root === null) {
  throw new Error("index.html has no #root element");
}
// StrictMode (dev only) runs each effect twice (start, clean up, start) to expose missing cleanup.
createRoot(root).render(
  <StrictMode>
    <App
      engine={window.keyrift.engine}
      config={window.keyrift.config}
      logs={window.keyrift.logs}
      system={window.keyrift.system}
      setup={window.keyrift.setup}
      updates={window.keyrift.updates}
      versions={window.keyrift.versions}
    />
  </StrictMode>,
);
