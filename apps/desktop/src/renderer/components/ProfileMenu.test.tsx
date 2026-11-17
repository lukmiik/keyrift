// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { App } from "../App.tsx";
import { testProfile } from "../config/test-profile.ts";
import { FakeConfig } from "../testing/fake-config.ts";
import { FakeEngine } from "../testing/fake-engine.ts";
import { FakeLogs } from "../testing/fake-logs.ts";
import { FakeSystem } from "../testing/fake-system.ts";
import { FakeSetup } from "../testing/fake-setup.ts";
import { FakeUpdates } from "../testing/fake-updates.ts";

afterEach(cleanup);

const VERSIONS = { electron: "1", chrome: "1", node: "1", v8: "1" };

/** The whole app with profiles "Daily life" (active, daily.json) and "Work stuff" (work.json). */
async function renderApp() {
  const config = new FakeConfig({
    daily: { ...testProfile(), name: "Daily life" },
    work: { version: 1, name: "Work stuff", layers: [{ id: "base", name: "Work base" }] },
  });
  render(
    <App
      logs={new FakeLogs()}
      system={new FakeSystem()}
      setup={new FakeSetup()}
      updates={new FakeUpdates()}
      engine={new FakeEngine()}
      config={config}
      versions={VERSIONS}
    />,
  );
  const user = userEvent.setup();
  await screen.findByRole("button", { name: "Profile: Daily life" });
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
    // The menu lists what the user called each profile, not its file name.
    await user.click(screen.getByRole("menuitemradio", { name: "Work stuff" }));

    expect(await screen.findByRole("button", { name: "Profile: Work stuff" })).toBeDefined();
    expect(config.active).toBe("work");
    // The Keymap screen opened the other profile.
    expect(await screen.findByRole("tab", { name: "Work base" })).toBeDefined();
  });

  it("creates a profile and makes it active", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "New profile" }));
    await user.type(screen.getByLabelText("Name"), "Gaming & Fun");
    // The file name comes from the name, like a layer's id.
    expect(screen.getByText("Saved as profiles/gaming-fun.json")).toBeDefined();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("button", { name: "Profile: Gaming & Fun" })).toBeDefined();
    expect(config.profiles.get("gaming-fun")).toMatchObject({ name: "Gaming & Fun" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("asks for a name instead of creating a profile without one", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "New profile" }));
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
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByLabelText("Name");
    await user.clear(input);
    await user.type(input, "Daily{Enter}");

    await screen.findByRole("button", { name: "Profile: Daily" });
    expect([...config.profiles.keys()]).toEqual(["work", "daily"]);
    expect(config.profiles.get("daily")).toMatchObject({ name: "Daily" });
  });

  it("keeps the dialog open and says why a rename failed", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
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
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("can't be undone");
    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("button", { name: "Profile: Work stuff" })).toBeDefined();
    expect([...config.profiles.keys()]).toEqual(["work"]);
  });

  it("imports a profile and makes it active", async () => {
    const { config, user } = await renderApp();
    config.toImport = { version: 1, name: "Gaming", layers: [{ id: "base", name: "Game base" }] };

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Import" }));

    expect(await screen.findByRole("button", { name: "Profile: Gaming" })).toBeDefined();
    expect(config.active).toBe("gaming");
    expect(await screen.findByRole("tab", { name: "Game base" })).toBeDefined();
  });

  it("changes nothing when the import is cancelled", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Import" }));

    await screen.findByRole("button", { name: "Profile: Daily life" });
    expect([...config.profiles.keys()]).toEqual(["daily", "work"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("exports the active profile", async () => {
    const { config, user } = await renderApp();

    await openMenu(user);
    await user.click(screen.getByRole("menuitem", { name: "Export" }));

    await waitFor(() => expect(config.exports.map((e) => e.name)).toEqual(["daily"]));
    expect(config.exports[0]?.profile).toMatchObject({ name: "Daily life" });
  });
});
