/**
 * React hook that keeps the engine's device list up to date (spec §7.3 Devices, `devices.list`).
 */
import { useEffect, useState } from "react";

import type { EngineApi } from "../../shared/api.ts";
import type { DeviceGroup } from "../../shared/protocol.ts";

/**
 * Returns every input device the engine sees, grouped by physical device, or null while the
 * engine isn't connected (or hasn't answered yet). Same pattern as useEngineStatus: on every
 * (re)connect subscribe and ask once; `devices` events keep the list current after that.
 */
export function useDevices(engine: EngineApi): DeviceGroup[] | null {
  const [devices, setDevices] = useState<DeviceGroup[] | null>(null);

  useEffect(() => {
    let active = true;

    async function refresh(): Promise<void> {
      // Subscribing adds a topic to the connection; it never removes the header's topics.
      await engine.call("subscribe", { topics: ["devices"] });
      const outcome = await engine.call("devices.list", {});
      if (active && outcome.ok) {
        setDevices(outcome.result.devices);
      }
    }

    const stopEvents = engine.onEvent((event) => {
      // The event carries the whole new list (spec §8.2), so no need to ask again.
      if (active && event.event === "devices") {
        setDevices(event.data.devices);
      }
    });
    const stopStateChanges = engine.onStateChange((state) => {
      if (!active) return;
      if (state.connected) {
        void refresh();
      } else {
        setDevices(null);
      }
    });
    void engine.state().then((state) => {
      if (active && state.connected) void refresh();
    });

    return () => {
      active = false;
      stopEvents();
      stopStateChanges();
    };
  }, [engine]);

  return devices;
}
