/**
 * The whole window (spec §7.1): status header on top, sidebar on the left, the open screen on the
 * right. Gets the engine as a prop instead of reading `window.keyrift`, so tests can pass a fake.
 */
import { useState } from "react";

import type { EngineApi, KeyriftApi } from "../shared/api.ts";
import { ScreenPlaceholder } from "./components/ScreenPlaceholder.tsx";
import { type Screen, Sidebar } from "./components/Sidebar.tsx";
import { StatusHeader } from "./components/StatusHeader.tsx";

type AppProps = {
  engine: EngineApi;
  // The versions object has no type name of its own, so take it from KeyriftApi.
  versions: KeyriftApi["versions"];
};

export function App({ engine, versions }: AppProps) {
  // Which screen is open. Lives here, above both the sidebar and the screen, because both need it.
  const [screen, setScreen] = useState<Screen>("keymap");

  return (
    // h-screen: the window's full height; the header keeps its height and the rest fills it.
    <div className="flex h-screen flex-col">
      <StatusHeader engine={engine} />
      <div className="flex min-h-0 flex-1">
        <Sidebar current={screen} onSelect={setScreen} />
        <main className="flex-1 overflow-auto p-6">
          {screen === "keymap" && <ScreenPlaceholder title="Keymap" comesIn="step 11" />}
          {screen === "shortcuts" && <ScreenPlaceholder title="Shortcuts" comesIn="step 13" />}
          {screen === "devices" && <ScreenPlaceholder title="Devices" comesIn="step 9" />}
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
