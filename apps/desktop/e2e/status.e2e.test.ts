/**
 * GUI tests: the real app (built, hidden window) against a private engine.
 */
import { afterEach, describe, expect, it } from "vite-plus/test";

import { TestApp } from "../test/test-app.ts";
import { TestEngine } from "../test/test-engine.ts";

// Everything a test starts, stopped after it even when it fails.
let cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const step of cleanup.reverse()) {
    await step();
  }
  cleanup = [];
});

/** Starts a private engine and the app pointed at it. */
async function startAppWithEngine(): Promise<{ app: TestApp; engine: TestEngine }> {
  const engine = await TestEngine.start();
  cleanup.push(() => engine.stop());
  const app = await TestApp.start({ socketPath: engine.socketPath });
  cleanup.push(() => app.close());
  return { app, engine };
}

describe("status header", () => {
  it("shows the engine's state and profile", { timeout: 300_000 }, async () => {
    const { app } = await startAppWithEngine();
    const header = app.window.locator("header");

    // Playwright waits (up to 5 s) until the element has this text: the app needs a moment to
    // connect and ask for the status.
    await header.getByRole("status").getByText("Running").waitFor({ timeout: 5000 });
    await header.getByText("Profile: test").waitFor({ timeout: 5000 });
    expect(await header.textContent()).toContain("0 input devices grabbed");
    // The Tailwind CSS loaded: the page's CSP lets the built stylesheet through.
    // (Through the element's own window: this file is type-checked without browser types.)
    const border = await header.evaluate(
      (h) => h.ownerDocument.defaultView?.getComputedStyle(h).borderBottomWidth,
    );
    expect(border).toBe("1px");
  });

  it("pauses and resumes the real engine", async () => {
    const { app, engine } = await startAppWithEngine();
    const pill = app.window.getByRole("status");
    await pill.getByText("Running").waitFor({ timeout: 5000 });

    await app.window.getByRole("button", { name: "Pause" }).click();
    await pill.getByText("Paused").waitFor({ timeout: 5000 });
    // Ask the engine itself, not the page: is it really paused?
    const client = await engine.connect();
    expect(await client.call("status.get", {})).toMatchObject({ state: "paused" });
    await client.close();

    await app.window.getByRole("button", { name: "Resume" }).click();
    await pill.getByText("Running").waitFor({ timeout: 5000 });
  });

  it("follows the engine: paused from outside, stopped", async () => {
    const { app, engine } = await startAppWithEngine();
    const pill = app.window.getByRole("status");
    await pill.getByText("Running").waitFor({ timeout: 5000 });

    // Change the engine from outside the app; the status event must reach the page.
    const client = await engine.connect();
    await client.call("engine.pause", {});
    await client.close();
    await pill.getByText("Paused").waitFor({ timeout: 5000 });

    await engine.stop();
    await pill.getByText("Not connected").waitFor({ timeout: 5000 });
  });
});

describe("versions line", () => {
  it("shows the Electron version from the preload", async () => {
    const { app } = await startAppWithEngine();

    // The versions live on the Settings screen.
    await app.window.getByRole("button", { name: "Settings" }).click();
    const versions = app.window.locator("#versions");

    await versions.getByText("Electron").waitFor({ timeout: 5000 });
    // Any version number, so the test survives Electron upgrades.
    expect(await versions.textContent()).toMatch(/Electron \d+\.\d+\.\d+/);
  });
});
