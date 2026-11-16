/**
 * Button that pauses or resumes remapping (spec §7.1). While paused, keys pass through unchanged.
 */
import { Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button.tsx";

type PauseToggleProps = {
  /** True when the engine is paused or released, so the button offers "Resume". */
  paused: boolean;
  /** No engine, or one that can't run: the button is greyed out. */
  disabled: boolean;
  onToggle: () => void;
};

export function PauseToggle({ paused, disabled, onToggle }: PauseToggleProps) {
  return (
    <Button variant="outline" size="sm" disabled={disabled} onClick={onToggle}>
      {/* data-icon: the shadcn button tightens its padding on the icon's side. */}
      {paused ? <Play data-icon="inline-start" /> : <Pause data-icon="inline-start" />}
      {paused ? "Resume" : "Pause"}
    </Button>
  );
}
