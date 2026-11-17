/**
 * The whole window (spec §7.1): sidebar on the left with the profile at its bottom; on the right a
 * top bar (undo/redo, the engine's state) over the open screen. Gets the engine and config APIs as props instead of reading `window.keyrift`, so tests can
 * pass fakes.
 */
import { useEffect, useState } from "react";

import type {
  ConfigApi,
  EngineApi,
  KeyriftApi,
  LogsApi,
  SetupApi,
  SystemApi,
  UpdatesApi,
} from "../shared/api.ts";
import { DevicesScreen } from "./components/DevicesScreen.tsx";
import { KeymapScreen } from "./components/KeymapScreen.tsx";
import { LogsScreen } from "./components/LogsScreen.tsx";
import { ProfileMenu } from "./components/ProfileMenu.tsx";
import { ProfileToolbar } from "./components/ProfileToolbar.tsx";
import { SettingsScreen } from "./components/SettingsScreen.tsx";
import { SetupWizard } from "./components/SetupWizard.tsx";
import { TesterScreen } from "./components/TesterScreen.tsx";
import { ShortcutsScreen } from "./components/shortcuts/ShortcutsScreen.tsx";
import { type Screen, Sidebar } from "./components/Sidebar.tsx";
import { EngineControl } from "./components/EngineControl.tsx";
import { TopBar } from "./components/TopBar.tsx";
import { type ProfileEditor, useProfileEditor } from "./config/useProfileEditor.ts";
import { useProfiles } from "./config/useProfiles.ts";
import { useEngineStatus } from "./engine/useEngineStatus.ts";
import { useTheme } from "./useTheme.ts";
import { useUpdates } from "./useUpdates.ts";

type AppProps = {
  engine: EngineApi;
  config: ConfigApi;
  logs: LogsApi;
  system: SystemApi;
  setup: SetupApi;
  updates: UpdatesApi;
  // The versions object has no type name of its own, so take it from KeyriftApi.
  versions: KeyriftApi["versions"];
};

export function App({ engine, config, logs, system, setup, updates, versions }: AppProps) {
  useTheme(system);
  const update = useUpdates(updates);
  // Which screen is open. Lives here, above both the sidebar and the screen, because both need it.
  const [screen, setScreen] = useState<Screen>("keymap");
  // The open profile and its undo history. Here, not in KeymapScreen, so they survive switching
  // to another screen and back (a component's state is dropped when it leaves the page).
  const profiles = useProfiles(config);
  const editor = useProfileEditor(config, profiles.active);
  // Without a readable settings.json there is no active profile to load.
  const engineStatus = useEngineStatus(engine);
  const profile: ProfileEditor =
    profiles.problem !== null ? { status: "failed", problem: profiles.problem } : editor;

  // The setup wizard: shown on the first run or when a check fails (F-UI-7), and from Settings.
  // The app shows while main checks (a few milliseconds); the wizard replaces it if needed.
  const [showSetup, setShowSetup] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([setup.firstRun(), setup.checks()]).then(([first, checks]) => {
      if (active) setShowSetup(first || checks.some((check) => check.status === "fail"));
    });
    return () => {
      active = false;
    };
  }, [setup]);

  if (showSetup) {
    return <SetupWizard setup={setup} engine={engine} onClose={() => setShowSetup(false)} />;
  }

  return (
    // h-screen: the window's full height. The sidebar runs from top to bottom; the header and
    // the page share the rest, the header keeping its height and the page filling what's left.
    <div className="flex h-screen">
      <Sidebar
        current={screen}
        onSelect={setScreen}
        // A dot on Settings while an update waits there.
        notices={
          update !== null && ["available", "ready"].includes(update.state.status)
            ? { settings: "update available" }
            : {}
        }
        footer={
          <ProfileMenu
            config={config}
            profiles={profiles}
            saveFirst={() => (editor.status === "ready" ? editor.flush() : Promise.resolve(true))}
          />
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar>
          <ProfileToolbar profile={profile} />
          <EngineControl
            engine={engine}
            {...engineStatus}
            layers={editor.status === "ready" ? editor.editor.present.layers : undefined}
          />
        </TopBar>
        <main className="min-h-0 flex-1 overflow-auto p-6">
          {/* A centred column: as wide as the keyboard on Keymap and Tester (w-fit), at most 56rem elsewhere,
              so wide windows don't stretch forms and tables across the screen. */}
          <div
            className={
              screen === "keymap" || screen === "tester"
                ? "mx-auto w-fit max-w-full"
                : "mx-auto max-w-4xl"
            }
          >
            {screen === "keymap" && (
              <KeymapScreen profile={profile} config={config} engine={engine} />
            )}
            {screen === "shortcuts" && <ShortcutsScreen profile={profile} engine={engine} />}
            {screen === "devices" && <DevicesScreen engine={engine} config={config} />}
            {screen === "tester" && (
              <TesterScreen profile={profile} config={config} engine={engine} />
            )}
            {screen === "logs" && (
              <LogsScreen logs={logs} engine={engine} status={engineStatus.status} />
            )}
            {screen === "settings" && (
              <SettingsScreen
                config={config}
                engine={engine}
                system={system}
                connection={engineStatus.connection}
                versions={versions}
                updates={updates}
                update={update}
                onRunSetup={() => setShowSetup(true)}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
