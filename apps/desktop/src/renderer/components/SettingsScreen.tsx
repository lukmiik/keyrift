/**
 * The Settings screen (spec §7.3): settings.json's tap-hold defaults, emergency release, saved log
 * level and the GUI's theme, keyboard layout and layer notifications, plus whether the engine
 * starts with the desktop session (its systemd unit) and the versions. Every change is saved at once; the engine notices
 * the file change and applies it, the GUI applies the theme and layout itself.
 */
import type { KeyName, Settings } from "@keyrift/config-types";
import { Circle, Square } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";

import type {
  Autostart,
  ConfigApi,
  ConnectionState,
  EngineApi,
  KeyriftApi,
  SettingsChanges,
  SystemApi,
  Theme,
} from "../../shared/api.ts";
import type { LogLevel } from "../../shared/protocol.ts";
import { useRecorder } from "../engine/useRecorder.ts";
import { keyName } from "../keyboard/key-labels.ts";
import { LAYOUT_IDS, type LayoutId, layoutId } from "../keyboard/layouts.ts";
import { numberProblem, type Option } from "./inspector/fields.tsx";
import { ScreenTitle } from "./ScreenTitle.tsx";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Switch } from "./ui/switch.tsx";

type SettingsScreenProps = {
  config: ConfigApi;
  engine: EngineApi;
  system: SystemApi;
  /** The engine connection, for its version under About. */
  connection: ConnectionState | null;
  versions: KeyriftApi["versions"];
  /** Opens the setup wizard. */
  onRunSetup: () => void;
};

type Strategy = NonNullable<NonNullable<Settings["tapHold"]>["strategy"]>;

/** The engine's defaults (crates/config model.rs), shown when settings.json leaves a field out. */
const DEFAULTS = {
  timeoutMs: 200,
  strategy: "permissive-hold" as Strategy,
  emergencyEnabled: true,
  emergencyKeys: ["KEY_LEFTCTRL", "KEY_SPACE", "KEY_ESC"] as KeyName[],
  logLevel: "info" as LogLevel,
  theme: "dark" as Theme,
  notifyLayerToggle: true,
};
/** The engine's limit for tap-hold timeouts (MAX_TIMEOUT_MS in crates/config validate.rs). */
const MAX_TIMEOUT_MS = 10_000;

const THEMES: Option<Theme>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const LAYOUTS: Option<LayoutId>[] = LAYOUT_IDS.map((id) => ({ value: id, label: layoutLabel(id) }));

const STRATEGIES: Option<Strategy>[] = [
  { value: "permissive-hold", label: "Permissive hold" },
  { value: "hold-on-other-press", label: "Hold on other press" },
  { value: "timeout-only", label: "Timeout only" },
];

const LOG_LEVELS: Option<LogLevel>[] = [
  { value: "error", label: "Error" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug (every key press)" },
];

/** What each strategy does when another key is pressed while a tap-hold key is down. */
const STRATEGY_HELP: Record<Strategy, string> = {
  "permissive-hold": "Hold when another key is pressed and released while it is down.",
  "hold-on-other-press": "Hold as soon as another key is pressed while it is down.",
  "timeout-only": "Hold only when it is held longer than the timeout.",
};

export function SettingsScreen({
  config,
  engine,
  system,
  connection,
  versions,
  onRunSetup,
}: SettingsScreenProps) {
  // undefined: not read yet; null: no settings.json (the engine's defaults apply).
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined);
  const [readError, setReadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void config.readSettings().then((outcome) => {
      if (!active) return;
      if (outcome.ok) setSettings(outcome.value);
      else setReadError(`${outcome.problem.file}: ${outcome.problem.message}`);
    });
    return () => {
      active = false;
    };
  }, [config]);

  /** Saves `changes`, then reads the file back so the screen shows what was written. */
  async function save(changes: SettingsChanges): Promise<void> {
    const outcome = await config.updateSettings(changes);
    if (!outcome.ok) {
      setSaveError(`${outcome.problem.file}: ${outcome.problem.message}`);
      return;
    }
    setSaveError(null);
    const read = await config.readSettings();
    if (read.ok) setSettings(read.value);
  }

  if (readError !== null) {
    return (
      <section className="flex flex-col gap-4">
        <ScreenTitle title="Settings" />
        <p role="alert" className="text-sm text-destructive">
          Couldn't read the settings: {readError}
        </p>
      </section>
    );
  }
  if (settings === undefined) return <ScreenTitle title="Settings" />;

  const tapHold = settings?.tapHold;
  const emergency = settings?.emergencyRelease;
  const strategy = tapHold?.strategy ?? DEFAULTS.strategy;

  return (
    <section className="flex flex-col gap-8">
      <ScreenTitle title="Settings" />
      {saveError !== null && (
        <p role="alert" className="text-sm text-destructive">
          Couldn't save: {saveError}
        </p>
      )}

      <Group title="General">
        <Row label="Theme">
          {(id) => (
            <Choice
              id={id}
              value={settings?.ui?.theme ?? DEFAULTS.theme}
              options={THEMES}
              onChange={(theme) => void save({ ui: { theme } })}
            />
          )}
        </Row>
        <Row label="Keyboard layout" help="The shape of the keyboard on Keymap and Tester.">
          {(id) => (
            <Choice
              id={id}
              value={layoutId(settings?.ui?.physicalLayout)}
              options={LAYOUTS}
              onChange={(physicalLayout) => void save({ ui: { physicalLayout } })}
            />
          )}
        </Row>
        <AutostartRow system={system} />
        <Row
          label="Layer notifications"
          help="Show a notification when a layer that a key toggles turns on or off."
        >
          {(id) => (
            <Switch
              id={id}
              checked={settings?.ui?.notifyLayerToggle ?? DEFAULTS.notifyLayerToggle}
              onCheckedChange={(notifyLayerToggle) => void save({ ui: { notifyLayerToggle } })}
            />
          )}
        </Row>
      </Group>

      <Group
        title="Tap-hold"
        description="For keys that do one thing when tapped and another when held, unless the key sets its own."
      >
        <Row label="Timeout" help="Held longer than this, the key counts as held.">
          {(id) => (
            <TimeoutInput
              id={id}
              value={tapHold?.timeoutMs ?? DEFAULTS.timeoutMs}
              onChange={(timeoutMs) => void save({ tapHold: { timeoutMs } })}
            />
          )}
        </Row>
        <Row label="Strategy" help={STRATEGY_HELP[strategy]}>
          {(id) => (
            <Choice
              id={id}
              value={strategy}
              options={STRATEGIES}
              onChange={(next) => void save({ tapHold: { strategy: next } })}
            />
          )}
        </Row>
      </Group>

      <Group title="Safety">
        <Row
          label="Emergency release"
          help="Holding these keys together lets go of every keyboard, in case a mapping locks you out. Resume from the top bar."
        >
          {(id) => (
            <Switch
              id={id}
              checked={emergency?.enabled ?? DEFAULTS.emergencyEnabled}
              onCheckedChange={(enabled) => void save({ emergencyRelease: { enabled } })}
            />
          )}
        </Row>
        <EmergencyKeys
          engine={engine}
          keys={(emergency?.keys as KeyName[] | undefined) ?? DEFAULTS.emergencyKeys}
          onChange={(keys) => void save({ emergencyRelease: { keys } })}
        />
      </Group>

      <Group title="Logging">
        <Row
          label="Log level"
          help="What the engine writes to its log (see Logs). Debug writes every key you press, so keep it for chasing a problem."
        >
          {(id) => (
            <Choice
              id={id}
              value={settings?.logLevel ?? DEFAULTS.logLevel}
              options={LOG_LEVELS}
              onChange={(logLevel) => void save({ logLevel })}
            />
          )}
        </Row>
      </Group>

      <Group title="System">
        <Row
          label="Setup"
          help="Check again that the system gives Keyrift what it needs: groups, device access, no other remapper, the engine service."
        >
          {() => (
            <Button variant="outline" onClick={onRunSetup}>
              Run setup again
            </Button>
          )}
        </Row>
      </Group>

      <Group title="About">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 px-4 py-3 text-sm">
          <dt className="text-muted-foreground">Engine</dt>
          <dd>
            {connection?.connected === true
              ? `${connection.hello.engineVersion} (protocol ${connection.hello.protocolVersion})`
              : "not connected"}
          </dd>
          <dt className="text-muted-foreground">Electron</dt>
          <dd>
            {versions.electron} · Chrome {versions.chrome} · Node {versions.node} · V8 {versions.v8}
          </dd>
        </dl>
      </Group>
    </section>
  );
}

/**
 * A titled group of settings: the title (and a line about all of them) above a bordered box, the
 * settings inside it as rows, so a title can't be taken for a setting.
 */
function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{title}</h2>
        {description !== undefined && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex flex-col divide-y rounded-lg border">{children}</div>
    </section>
  );
}

/**
 * One setting: its name and a short explanation on the left, the control on the right. The
 * control gets the label's id (`children(id)`), so it is named by the label.
 */
function Row({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} id={`${id}-label`} className="text-sm font-medium">
          {label}
        </label>
        {help !== undefined && <p className="text-sm text-muted-foreground">{help}</p>}
      </div>
      <div className="shrink-0">{children(id)}</div>
    </div>
  );
}

/** A dropdown named by the row's label (`id` is the label's `for`). */
function Choice<T extends string>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  const items = Object.fromEntries(options.map((option) => [option.value, option.label]));
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next !== null && next !== value) onChange(next);
      }}
    >
      <SelectTrigger id={id} aria-labelledby={`${id}-label`} className="w-56">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The tap-hold timeout in ms, saved when the box loses focus or Enter is pressed. */
function TimeoutInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: number;
  onChange: (ms: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Show a new value from outside (e.g. after the file was read again).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value));
  }
  const problem = numberProblem(text, 1, MAX_TIMEOUT_MS, false);
  const commit = () => {
    if (problem === null && Number(text) !== value) onChange(Number(text));
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          inputMode="numeric"
          className="w-24 text-right"
          value={text}
          aria-invalid={problem !== null}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
        <span className="text-sm text-muted-foreground">ms</span>
      </div>
      {problem !== null && <p className="text-xs text-destructive">{problem}</p>}
    </div>
  );
}

/**
 * The emergency combo: shown as key names; "Record" asks the engine for the next keys pressed
 * (they pass through unmapped meanwhile), "Done" saves them. At least two keys, so a single key
 * pressed by accident can't release the keyboards.
 */
function EmergencyKeys({
  engine,
  keys,
  onChange,
}: {
  engine: EngineApi;
  keys: KeyName[];
  onChange: (keys: KeyName[]) => void;
}) {
  const recorder = useRecorder(engine);
  const recording = recorder.target === "emergency";
  // Each key once, in the order first pressed (a key pressed twice is still one key of the combo).
  const recorded = [...new Set(recorder.keys)];

  async function done(): Promise<void> {
    const pressed = [...new Set(await recorder.stop())];
    if (pressed.length >= 2) onChange(pressed);
  }

  return (
    <div className="flex items-center justify-between gap-6 px-4 py-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Keys</span>
        <p aria-label="Emergency keys" className="text-sm">
          {(recording ? recorded : keys).map(keyName).join(" + ") ||
            (recording ? "Press the keys…" : "None")}
        </p>
        {recording && (
          <p className="text-sm text-muted-foreground">
            Press each key of the new combo, then Done. At least two keys.
          </p>
        )}
        {recorder.error !== null && (
          <p role="alert" className="text-sm text-destructive">
            Couldn't record: {recorder.error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-2">
        {recording ? (
          <>
            <Button variant="outline" onClick={() => void recorder.stop()}>
              Cancel
            </Button>
            <Button disabled={recorded.length < 2} onClick={() => void done()}>
              <Square /> Done
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => void recorder.start("emergency")}>
            <Circle /> Record
          </Button>
        )}
      </div>
    </div>
  );
}

/** Whether the engine starts with the desktop session: its systemd unit, enabled or not. */
function AutostartRow({ system }: { system: SystemApi }) {
  const [state, setState] = useState<Autostart | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void system.autostart().then((outcome) => {
      if (!active) return;
      if (outcome.ok) setState(outcome.value);
      else setError(outcome.message);
    });
    return () => {
      active = false;
    };
  }, [system]);

  async function set(enabled: boolean): Promise<void> {
    const outcome = await system.setAutostart(enabled);
    if (outcome.ok) {
      setState(outcome.value);
      setError(null);
    } else {
      setError(outcome.message);
    }
  }

  const help =
    state === "not-installed"
      ? "The engine's service isn't installed. Run `keyrift service install` first."
      : "Start the engine when you log in (its systemd user service).";
  return (
    <Row label="Start at login" help={error === null ? help : `Couldn't change it: ${error}`}>
      {(id) =>
        // Until systemctl answered, an empty space of the switch's size: a switch shown off and
        // then turned on would slide across when the screen opens.
        state === null ? (
          <div className="h-5 w-9" />
        ) : (
          <Switch
            id={id}
            checked={state === "enabled"}
            disabled={state === "not-installed"}
            onCheckedChange={(enabled) => void set(enabled)}
          />
        )
      }
    </Row>
  );
}

/** "iso-tkl" → "ISO, TKL (no numpad)". */
export function layoutLabel(id: LayoutId): string {
  const [standard = "", size = ""] = id.split("-");
  const sizes: Record<string, string> = {
    full: "full size",
    tkl: "TKL (no numpad)",
    "75": "75 %",
    "60": "60 %",
  };
  return `${standard.toUpperCase()}, ${sizes[size] ?? size}`;
}
