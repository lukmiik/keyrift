/**
 * The whole window (spec §7.1): status header on top, sidebar on the left, the open screen on the
 * right. Gets the engine and config APIs as props instead of reading `window.keyrift`, so tests can
 * pass fakes.
 */
import { useState } from "react";

import type { ConfigApi, EngineApi, KeyriftApi } from "../shared/api.ts";
import { DevicesScreen } from "./components/DevicesScreen.tsx";
import { KeymapScreen } from "./components/KeymapScreen.tsx";
import { ProfileMenu } from "./components/ProfileMenu.tsx";
import { ScreenPlaceholder } from "./components/ScreenPlaceholder.tsx";
import { type Screen, Sidebar } from "./components/Sidebar.tsx";
import { StatusHeader } from "./components/StatusHeader.tsx";
import { type ProfileEditor, useProfileEditor } from "./config/useProfileEditor.ts";
import { useProfiles } from "./config/useProfiles.ts";

type AppProps = {
  engine: EngineApi;
  config: ConfigApi;
  // The versions object has no type name of its own, so take it from KeyriftApi.
  versions: KeyriftApi["versions"];
};

export function App({ engine, config, versions }: AppProps) {
  // Which screen is open. Lives here, above both the sidebar and the screen, because both need it.
  const [screen, setScreen] = useState<Screen>("keymap");
  // The open profile and its undo history. Here, not in KeymapScreen, so they survive switching
  // to another screen and back (a component's state is dropped when it leaves the page).
  const profiles = useProfiles(config);
  const editor = useProfileEditor(config, profiles.active);
  // Without a readable settings.json there is no active profile to load.
  const profile: ProfileEditor =
    profiles.problem !== null ? { status: "failed", problem: profiles.problem } : editor;

  return (
    // h-screen: the window's full height; the header keeps its height and the rest fills it.
    <div className="flex h-screen flex-col">
      <StatusHeader engine={engine}>
        <ProfileMenu
          config={config}
          profiles={profiles}
          saveFirst={() => (editor.status === "ready" ? editor.flush() : Promise.resolve(true))}
        />
      </StatusHeader>
      <div className="flex min-h-0 flex-1">
        <Sidebar current={screen} onSelect={setScreen} />
        <main className="flex-1 overflow-auto p-6">
          {screen === "keymap" && <KeymapScreen profile={profile} />}
          {screen === "shortcuts" && <ScreenPlaceholder title="Shortcuts" comesIn="step 13" />}
          {screen === "devices" && <DevicesScreen engine={engine} config={config} />}
          {screen === "tester" && <ScreenPlaceholder title="Tester" comesIn="M5" />}
          {screen === "logs" && <ScreenPlaceholder title="Logs" comesIn="M5" />}
          {screen === "settings" && (
            <ScreenPlaceholder title="Settings" comesIn="M5">
              <p id="versions" className="text-sm text-muted-foreground">
                Electron {versions.electron} · Chrome {versions.chrome} · Node {versions.node} · V8{" "}
                {versions.v8}
              </p>
            </ScreenPlaceholder>
          )}
        </main>
      </div>
    </div>
  );
}
