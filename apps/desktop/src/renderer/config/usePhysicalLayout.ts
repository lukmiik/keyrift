/**
 * React hook: the physical layout from `settings.ui.physicalLayout` (chosen in Settings), for the
 * Keymap and Tester keyboards. ISO TKL until settings.json is read.
 */
import { useEffect, useState } from "react";

import type { ConfigApi } from "../../shared/api.ts";
import { DEFAULT_LAYOUT, type LayoutId, layoutId } from "../keyboard/layouts.ts";

export function usePhysicalLayout(config: ConfigApi): LayoutId {
  const [layout, setLayout] = useState<LayoutId>(DEFAULT_LAYOUT);
  useEffect(() => {
    let active = true;
    void config.readSettings().then((outcome) => {
      if (active && outcome.ok) setLayout(layoutId(outcome.value?.ui?.physicalLayout));
    });
    return () => {
      active = false;
    };
  }, [config]);
  return layout;
}
