// Types for what Vite lets the page import besides code: CSS files, images, import.meta.env.
/// <reference types="vite-plus/client" />

import type { KeyriftApi } from "../shared/api.ts";

declare global {
  interface Window {
    /** The API the preload script exposes (src/preload/preload.ts). */
    keyrift: KeyriftApi;
  }
}
