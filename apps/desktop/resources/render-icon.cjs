/**
 * Renders resources/icon.svg to PNGs with Electron's own Chromium, the engine that shows the icon,
 * so the PNGs match the SVG exactly (ImageMagick draws its clip paths wrong). Run after changing
 * the SVG: `vp run icon`.
 *
 * - icon.png: the app icon, 512 × 512 with transparent corners.
 * - tray-<state>.png: 64 × 64 tray icons, one per engine state (main/tray.ts): running is the
 *   icon itself; paused and offline are grey (nothing is remapped); released and error add an
 *   amber or red dot in the corner.
 *
 * CommonJS (.cjs) because Electron runs it directly as its main script, without a build.
 */
const { join } = require("node:path");
const { readFileSync, writeFileSync } = require("node:fs");
const { app, BrowserWindow } = require("electron");

const svg = readFileSync(join(__dirname, "icon.svg"), "utf8");

/** The icon in greys: the white top half and the blue bottom half both muted. */
const grey = (text) =>
  text.replace('fill="#fafafa"', 'fill="#a1a1aa"').replace('fill="#38bdf8"', 'fill="#52525b"');
/** The icon with a dot in the bottom right corner, ringed in the icon's background colour. */
const dot = (text, colour) =>
  text.replace(
    "</svg>",
    `<circle cx="400" cy="400" r="104" fill="${colour}" stroke="#0a0a0a" stroke-width="24"/></svg>`,
  );

const OUTPUTS = [
  { file: "icon.png", size: 512, svg },
  { file: "tray-running.png", size: 64, svg },
  { file: "tray-paused.png", size: 64, svg: grey(svg) },
  { file: "tray-released.png", size: 64, svg: dot(svg, "#f59e0b") },
  { file: "tray-error.png", size: 64, svg: dot(svg, "#ef4444") },
];

/** Draws `text` (an SVG document) and returns it as a size × size PNG. */
async function render(text, size) {
  // Offscreen and transparent: the page is drawn without a window, and keeps its alpha channel.
  // Drawn at 512 and scaled down, so small sizes are smoothed like the large one.
  const window = new BrowserWindow({
    width: 512,
    height: 512,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await window.loadURL(`data:image/svg+xml;base64,${Buffer.from(text).toString("base64")}`);
  // Give the first frame time to be drawn before capturing it.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const image = await window.webContents.capturePage();
  window.destroy();
  return image.resize({ width: size, height: size, quality: "best" }).toPNG();
}

// Each icon closes its window; without this Electron would quit after the first one.
app.on("window-all-closed", () => {});

void app.whenReady().then(async () => {
  for (const output of OUTPUTS) {
    const path = join(__dirname, output.file);
    writeFileSync(path, await render(output.svg, output.size));
    console.log(`wrote ${path}`);
  }
  app.quit();
});
