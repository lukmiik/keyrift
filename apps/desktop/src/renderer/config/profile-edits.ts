/**
 * Every change the GUI can make to a profile, as data (step 8). `applyEdit` turns a profile and an
 * edit into a new profile. It never changes the profile it gets: React only notices a change when
 * it gets a new object, and undo needs the old version intact.
 */
import type {
  ActionConfig,
  KeyName,
  LayerConfig,
  Profile,
  ShortcutConfig,
} from "@keyrift/config-types";

/** One change to a profile. A tagged union like the engine messages: `type` says which one. */
export type ProfileEdit =
  | { type: "setKey"; layerId: string; key: KeyName; action: ActionConfig }
  | { type: "clearKey"; layerId: string; key: KeyName }
  | { type: "addLayer"; id: string; name: string }
  | { type: "removeLayer"; layerId: string }
  | { type: "renameLayer"; layerId: string; layerName: string }
  | { type: "addShortcut"; shortcut: ShortcutConfig }
  /** Replaces the rule at `index`. */
  | { type: "setShortcut"; index: number; shortcut: ShortcutConfig }
  | { type: "removeShortcut"; index: number }
  /** Moves the rule at `index` to position `to`; the first matching rule wins (spec §5.5). */
  | { type: "moveShortcut"; index: number; to: number };

/** A profile's layers: at least one, the first is the base layer. */
type Layers = NonNullable<Profile["layers"]>;

/**
 * Returns the profile with `edit` applied. When the edit changes nothing (a layer that doesn't
 * exist, removing the base layer, …) it returns the **same** object, so callers can tell.
 */
export function applyEdit(profile: Profile, edit: ProfileEdit): Profile {
  switch (edit.type) {
    case "setKey":
      return updateLayer(profile, edit.layerId, (layer) => ({
        ...layer,
        keys: { ...layer.keys, [edit.key]: edit.action },
      }));

    case "clearKey":
      return updateLayer(profile, edit.layerId, (layer) => {
        if (layer.keys?.[edit.key] === undefined) {
          return layer;
        }
        // Copy first, then delete from the copy: the original keeps its key.
        const keys = { ...layer.keys };
        delete keys[edit.key];
        return { ...layer, keys };
      });

    case "addLayer": {
      const layers = profile.layers;
      if (layers === undefined || layers.some((layer) => layer.id === edit.id)) {
        return profile;
      }
      return { ...profile, layers: [...layers, { id: edit.id, name: edit.name, keys: {} }] };
    }

    case "removeLayer": {
      const layers = profile.layers;
      // The base layer (first) can't be removed: a profile always has one.
      if (layers === undefined || layers[0].id === edit.layerId) {
        return profile;
      }
      const [base, ...others] = layers;
      const kept = others.filter((layer) => layer.id !== edit.layerId);
      if (kept.length === others.length) {
        return profile;
      }
      // Keys that switched to the removed layer would point at nothing (the engine rejects that),
      // so they become transparent.
      const [newBase, ...rest] = [base, ...kept].map((layer) =>
        withoutReferences(layer, edit.layerId),
      );
      return { ...profile, layers: [newBase, ...rest] };
    }

    case "addShortcut":
      return { ...profile, shortcuts: [...(profile.shortcuts ?? []), edit.shortcut] };

    case "setShortcut": {
      const shortcuts = profile.shortcuts ?? [];
      if (edit.index < 0 || edit.index >= shortcuts.length) return profile;
      return {
        ...profile,
        shortcuts: shortcuts.map((s, i) => (i === edit.index ? edit.shortcut : s)),
      };
    }

    case "removeShortcut": {
      const shortcuts = profile.shortcuts ?? [];
      if (edit.index < 0 || edit.index >= shortcuts.length) return profile;
      // An empty list stays in the file (`"shortcuts": []`), like the baseline profile has it.
      return { ...profile, shortcuts: shortcuts.filter((_, i) => i !== edit.index) };
    }

    case "moveShortcut": {
      const shortcuts = profile.shortcuts ?? [];
      const rule = shortcuts[edit.index];
      if (
        rule === undefined ||
        edit.to === edit.index ||
        edit.to < 0 ||
        edit.to >= shortcuts.length
      ) {
        return profile;
      }
      const moved = shortcuts.filter((_, i) => i !== edit.index);
      moved.splice(edit.to, 0, rule);
      return { ...profile, shortcuts: moved };
    }

    case "renameLayer":
      // updateLayer only calls this for the layer with `layerId`.
      return updateLayer(profile, edit.layerId, (layer) =>
        layer.name === edit.layerName ? layer : { ...layer, name: edit.layerName },
      );
  }
}

/**
 * Returns the profile with layer `layerId` replaced by `change(layer)`. Returns the same profile
 * if there is no such layer or `change` returned the layer unchanged.
 */
function updateLayer(
  profile: Profile,
  layerId: string,
  change: (layer: LayerConfig) => LayerConfig,
): Profile {
  const layers = profile.layers;
  const index = layers?.findIndex((layer) => layer.id === layerId) ?? -1;
  if (layers === undefined || index === -1) {
    return profile;
  }
  const changed = change(layers[index]);
  if (changed === layers[index]) {
    return profile;
  }
  // A new array with one layer swapped; the other layers are shared with the old profile.
  const [base, ...others] = layers.map((layer, i) => (i === index ? changed : layer));
  const updated: Layers = [base, ...others];
  return { ...profile, layers: updated };
}

/** Whether `action` switches to layer `layerId`, also inside a tap-hold. */
function referencesLayer(action: ActionConfig, layerId: string): boolean {
  switch (action.type) {
    case "layer":
      return action.layer === layerId;
    case "tapHold":
      return referencesLayer(action.tap, layerId) || referencesLayer(action.hold, layerId);
    default:
      return false;
  }
}

/** Every key that switches to layer `layerId`: which layer it's on and which key. */
export function layerReferences(
  profile: Profile,
  layerId: string,
): { layerId: string; key: KeyName }[] {
  return (profile.layers ?? []).flatMap((layer) =>
    Object.entries(layer.keys ?? {})
      .filter(([, action]) => action !== undefined && referencesLayer(action, layerId))
      .map(([key]) => ({ layerId: layer.id, key: key as KeyName })),
  );
}

/** `layer` without the keys that switch to layer `layerId`; the same object if it has none. */
function withoutReferences(layer: LayerConfig, layerId: string): LayerConfig {
  const entries = Object.entries(layer.keys ?? {});
  const kept = entries.filter(
    ([, action]) => action === undefined || !referencesLayer(action, layerId),
  );
  return kept.length === entries.length ? layer : { ...layer, keys: Object.fromEntries(kept) };
}
