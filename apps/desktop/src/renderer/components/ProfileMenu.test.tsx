// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../App.tsx";
import { testProfile } from "../config/test-profile.ts";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

/** The whole app with profiles "daily" (active) and "work". */
async function renderApp() {
  const config = new FakeConfig({ daily: testProfile(), work: { version: 1, name: "work" } });
  render(<App engine={new FakeEngine()} config={config} versions={VERSIONS} />);
  const user = userEvent.setup();
  await screen.findByRole("button", { name: /Profile: daily/ });
  return { config, user };
}

/** Opens the profile menu. */
async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Profile: / }));
  return screen.findByRole("menu");
}

describe("ProfileMenu", () => {
  it("switches the active profile", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitemradio", { name: "work" }));

    expect(await screen.findByRole("button", { name: /Profile: work/ })).toBeDefined();
    expect(config.active).toBe("work");
    // The Keymap screen opened the other profile.
    expect(await screen.findByText("profiles/work.json", { exact: false })).toBeDefined();
  });

  it("creates a profile and makes it active", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "New profile…" }));
    await user.type(screen.getByLabelText("Name"), "Gaming & Fun");
    // The file name comes from the name, like a layer's id.
    expect(screen.getByText("Saved as profiles/gaming-fun.json")).toBeDefined();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("button", { name: /Profile: gaming-fun/ })).toBeDefined();
    expect(config.profiles.get("gaming-fun")).toMatchObject({ name: "Gaming & Fun" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for a name instead of creating a profile without one", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "New profile…" }));
    const input = screen.getByLabelText("Name");
    await user.type(input, "   {Enter}");

    expect(screen.getByRole("alert").textContent).toBe("Enter a name");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect([...config.profiles.keys()]).toEqual(["daily", "work"]);

    // Typing again clears the message.
    await user.type(input, "x");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("renames only the name when the file name stays the same", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Daily{Enter}");

    await screen.findByRole("button", { name: /Profile: daily/ });
    expect([...config.profiles.keys()]).toEqual(["work", "daily"]);
    expect(config.profiles.get("daily")).toMatchObject({ name: "Daily" });
  });

  it("keeps the dialog open and says why a rename failed", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Rename…" }));
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "work{Enter}");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "profiles/work.json: already exists",
    );
    expect(config.active).toBe("daily");
  });

  it("deletes the active profile after asking, and switches to another", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("can't be undone");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("button", { name: /Profile: work/ })).toBeDefined();
    expect([...config.profiles.keys()]).toEqual(["work"]);
  });
});
