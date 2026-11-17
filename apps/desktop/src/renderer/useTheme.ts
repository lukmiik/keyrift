/**
 * Light or dark (spec §7.3 Settings): main works out which from the theme setting and, for
 * "system", the desktop (main/system/theme.ts). shadcn's colours switch on the `dark` class
 * (index.css), so this keeps that class on <html> in step with main's answer.
 */
import { useEffect } from "react";

import type { SystemApi } from "../shared/api.ts";

export function useTheme(system: SystemApi): void {
  useEffect(() => {
    let active = true;
    const apply = (dark: boolean) => document.documentElement.classList.toggle("dark", dark);
    const stop = system.onDarkChange(apply);
    void system.dark().then((dark) => {
      if (active) apply(dark);
    });
    return () => {
      active = false;
      stop();
    };
  }, [system]);
}
