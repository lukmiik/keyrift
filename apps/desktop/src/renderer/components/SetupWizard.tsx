/**
 * The setup wizard (spec §9.3, F-UI-7): shown on the first run, when a check fails, or from
 * Settings. Lists what Keyrift needs from the system with a mark per check, fixes what it can
 * (one password prompt for the system part), shows commands for the rest, and ends with "press any
 * key" to see that the engine really gets the keyboard.
 */
import { isKeyName } from "@keyrift/config-types/keys";
import { CircleAlert, CircleCheck, CircleX, Copy, Keyboard, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

import type { EngineApi, SetupApi, SetupCheck, SetupFix } from "../../shared/api.ts";
import { useRecorder } from "../engine/useRecorder.ts";
import { keyName } from "../keyboard/key-labels.ts";
import { Button } from "./ui/button.tsx";
import { Wordmark } from "./Wordmark.tsx";

type SetupWizardProps = {
  setup: SetupApi;
  engine: EngineApi;
  /** Closes the wizard (finished or skipped). */
  onClose: () => void;
};

/** What each fix button does, in the words shown on it and under it. */
const FIXES: Record<SetupFix, { label: string; help: string }> = {
  system: {
    label: "Fix with one password prompt",
    help: "Adds you to the input and uinput groups and installs Keyrift's udev rule and modules-load file.",
  },
  service: {
    label: "Install the engine service",
    help: "Installs the engine's systemd user service, starts it and starts it at every login.",
  },
};

export function SetupWizard({ setup, engine, onClose }: SetupWizardProps) {
  const [checks, setChecks] = useState<SetupCheck[] | null>(null);
  // Bumped to run the checks again (after a fix, or "Check again").
  const [round, setRound] = useState(0);
  const [running, setRunning] = useState<SetupFix | null>(null);
  const [fixError, setFixError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void setup.checks().then((result) => {
      if (active) setChecks(result);
    });
    return () => {
      active = false;
    };
  }, [setup, round]);

  async function fix(kind: SetupFix): Promise<void> {
    setRunning(kind);
    const outcome = await setup.fix(kind);
    setRunning(null);
    setFixError(outcome.ok ? null : outcome.message);
    setRound((n) => n + 1);
  }

  async function close(): Promise<void> {
    await setup.markDone();
    onClose();
  }

  // Each fix once, in the order its first check comes.
  const fixes = [...new Set((checks ?? []).flatMap((check) => check.fix ?? []))];
  const failing = (checks ?? []).some((check) => check.status === "fail");

  return (
    <div className="flex h-screen justify-center overflow-auto p-8">
      <section aria-label="Setup" className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Wordmark className="text-3xl" />
          <h1 className="text-xl font-medium">Set up Keyrift</h1>
          <p className="text-sm text-muted-foreground">
            Keyrift needs a few things from the system to read your keyboards and type for them.
          </p>
        </div>

        {checks === null ? (
          <p className="text-sm text-muted-foreground">Checking…</p>
        ) : (
          <ul aria-label="Checks" className="flex flex-col divide-y rounded-lg border">
            {checks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </ul>
        )}

        {fixError !== null && (
          <p role="alert" className="text-sm text-destructive">
            Couldn't fix it: {fixError}
          </p>
        )}

        {fixes.length > 0 && (
          <div className="flex flex-col gap-3">
            {fixes.map((kind) => (
              <div key={kind} className="flex items-center justify-between gap-6">
                <p className="text-sm text-muted-foreground">{FIXES[kind].help}</p>
                <Button
                  className="shrink-0"
                  disabled={running !== null}
                  onClick={() => void fix(kind)}
                >
                  {running === kind ? "Working…" : FIXES[kind].label}
                </Button>
              </div>
            ))}
          </div>
        )}

        <PressAnyKey engine={engine} />

        <div className="flex flex-col gap-3 border-t pt-4">
          {checks !== null && <p className="text-sm">{summary(checks)}</p>}
          <div className="flex items-center justify-between gap-4">
            <Button variant="outline" onClick={() => setRound((n) => n + 1)}>
              <RotateCw /> Check again
            </Button>
            <Button variant={failing ? "outline" : "default"} onClick={() => void close()}>
              {failing ? "Skip for now" : "Done"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

/** One line on what the checks add up to, so the end button's meaning is clear. */
export function summary(checks: SetupCheck[]): string {
  const failed = checks.filter((check) => check.status === "fail").length;
  const warned = checks.filter((check) => check.status === "warn").length;
  if (failed > 0) {
    return failed === 1
      ? "1 check failed: Keyrift can't work until it's fixed."
      : `${failed} checks failed: Keyrift can't work until they're fixed.`;
  }
  if (warned > 0) {
    const warnings = warned === 1 ? "1 warning" : `${warned} warnings`;
    return `Everything Keyrift needs is in place. ${warnings}: Keyrift works now, but may run into trouble later.`;
  }
  return "Everything Keyrift needs is in place.";
}

const MARKS = {
  ok: { Icon: CircleCheck, className: "text-emerald-500", label: "OK" },
  warn: { Icon: CircleAlert, className: "text-amber-500", label: "Needs attention" },
  fail: { Icon: CircleX, className: "text-destructive", label: "Failed" },
} as const;

function CheckRow({ check }: { check: SetupCheck }) {
  const mark = MARKS[check.status];
  return (
    <li aria-label={check.title} className="flex gap-3 px-4 py-3">
      <mark.Icon
        role="img"
        aria-label={mark.label}
        className={`mt-0.5 size-4 shrink-0 ${mark.className}`}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-sm font-medium">{check.title}</span>
        <p className="text-sm text-muted-foreground">{check.detail}</p>
        {check.commands.map((command) => (
          <Command key={command} command={command} />
        ))}
      </div>
    </li>
  );
}

/** A command to run in a terminal, with a button that copies it. */
function Command({ command }: { command: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md bg-muted px-2 py-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{command}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${command}`}
        onClick={() => void navigator.clipboard.writeText(command)}
      >
        <Copy />
      </Button>
    </div>
  );
}

/**
 * The last check: a key pressed now must reach the engine (`record.start` reports it), which
 * proves that it reads the keyboard. While waiting, keys pass through unmapped.
 */
function PressAnyKey({ engine }: { engine: EngineApi }) {
  const recorder = useRecorder(engine);
  const [pressed, setPressed] = useState<string | null>(null);
  const waiting = recorder.target === "setup";

  function start(): void {
    setPressed(null);
    void recorder.start("setup", {
      onKeys: (keys) => {
        const key = keys[0];
        if (key !== undefined) setPressed(isKeyName(key) ? keyName(key) : key);
        return true;
      },
    });
  }

  return (
    <div className="flex items-center justify-between gap-6 rounded-lg border px-4 py-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Try it</span>
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {recorder.error !== null
            ? `The engine can't listen: ${recorder.error}`
            : pressed !== null
              ? `The engine got ${pressed}. Keyrift works.`
              : waiting
                ? "Press any key on your keyboard…"
                : "Press a key to see that the engine gets it."}
        </p>
      </div>
      <Button variant="outline" disabled={waiting} onClick={start}>
        <Keyboard /> Press any key
      </Button>
    </div>
  );
}
