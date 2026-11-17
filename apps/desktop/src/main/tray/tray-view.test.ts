import type { Profile } from "@keyrift/config-types";
import { describe, expect, it } from "vite-plus/test";

import type { Status } from "../../shared/protocol.ts";
import { layerChanges, layerNames, toggledLayers, trayView } from "./tray-view.ts";

/** An engine status, running on the base layer unless `fields` say otherwise. */
function fakeStatus(fields: Partial<Status> = {}): Status {
  return {
    state: "running",
    engineVersion: "0.1.0",
    pid: 1,
    profile: "daily",
    activeLayers: ["base"],
    configIssues: [],
    configPending: false,
    logLevel: "info",
    devices: { grabbed: 1, keyboards: 1, blocked: [] },
    outputDevice: null,
    recording: false,
    latency: { samples: 0 },
    ...fields,
  };
}

const CONNECTED = {
  connected: true as const,
  hello: { engineVersion: "0.1.0", protocolVersion: "1.0", state: "running" as const },
};
const NAMES = new Map([
  ["base", "Base"],
  ["nav", "Nav"],
]);

describe("trayView", () => {
  it("shows the profile and layers while running, with Pause", () => {
    const view = trayView(
      CONNECTED,
      fakeStatus({ profile: "daily", activeLayers: ["base", "nav"] }),
      NAMES,
    );
    expect(view).toEqual({
      icon: "running",
      tooltip: "Keyrift: Active · daily · Base → Nav",
      toggle: { label: "Pause remapping", method: "engine.pause" },
    });
  });

  it("shows the profile's display name when it has one", () => {
    const status = fakeStatus({ profile: "work-play", activeLayers: ["base"] });
    expect(trayView(CONNECTED, status, NAMES, "Work & play").tooltip).toBe(
      "Keyrift: Active · Work & play · Base",
    );
  });

  it("offers Resume when paused or released, nothing on error", () => {
    const view = (state: "paused" | "released" | "error") =>
      trayView(CONNECTED, fakeStatus({ state }), NAMES);
    expect(view("paused")).toMatchObject({ icon: "paused", toggle: { method: "engine.resume" } });
    expect(view("released")).toMatchObject({
      icon: "released",
      toggle: { method: "engine.resume" },
    });
    expect(view("error")).toMatchObject({ icon: "error", toggle: null });
  });

  it("is grey without an engine", () => {
    expect(trayView({ connected: false, reason: "not running" }, null, NAMES)).toEqual({
      icon: "paused",
      tooltip: "Keyrift: engine not running",
      toggle: null,
    });
  });
});

describe("layer notifications", () => {
  const PROFILE: Profile = {
    version: 1,
    layers: [
      {
        id: "base",
        name: "Base",
        keys: {
          KEY_F1: { type: "layer", layer: "games", mode: "toggle" },
          KEY_RIGHTALT: { type: "layer", layer: "nav", mode: "hold" },
          // Nav is also toggled, but it is held too: no notifications for it.
          KEY_F2: { type: "layer", layer: "nav", mode: "toggle" },
          KEY_CAPSLOCK: {
            type: "tapHold",
            tap: { type: "layer", layer: "num", mode: "toggle" },
            hold: { type: "key", key: "KEY_LEFTCTRL" },
          },
        },
      },
      { id: "games", name: "Games", keys: {} },
      { id: "nav", keys: {} },
      { id: "num", name: "Numbers", keys: {} },
    ],
  };

  it("watches layers that only toggle keys switch, also inside tap-hold", () => {
    expect([...toggledLayers(PROFILE)].sort()).toEqual(["games", "num"]);
  });

  it("finds the watched layers that turned on and off", () => {
    const watched = new Set(["games", "num"]);
    expect(layerChanges(["base"], ["base", "games", "nav"], watched)).toEqual({
      on: ["games"],
      off: [],
    });
    expect(layerChanges(["base", "games", "num"], ["base", "num"], watched)).toEqual({
      on: [],
      off: ["games"],
    });
  });

  it("names layers, by id when they have no name", () => {
    expect(layerNames(PROFILE).get("games")).toBe("Games");
    expect(layerNames(PROFILE).get("nav")).toBe("nav");
  });
});
