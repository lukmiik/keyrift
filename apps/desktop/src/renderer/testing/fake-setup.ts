/**
 * A stand-in for `window.keyrift.setup` in component tests: the checks are set by the test, and
 * fixes are recorded (each one turns its checks to "ok", like a successful real fix).
 */
import type { SetupApi, SetupCheck, SetupFix, SystemOutcome } from "../../shared/api.ts";

/** A check that passed; `fields` change it. */
export function okCheck(fields: Partial<SetupCheck> & Pick<SetupCheck, "id">): SetupCheck {
  return { title: fields.id, status: "ok", detail: "Fine.", fix: null, commands: [], ...fields };
}

const ALL_OK: SetupCheck[] = (
  ["groups", "devices", "uinput-boot", "remappers", "service"] as const
).map((id) => okCheck({ id }));

export class FakeSetup implements SetupApi {
  checksResult: SetupCheck[];
  isFirstRun: boolean;
  /** Every fix run, in order. */
  readonly fixes: SetupFix[] = [];
  /** Set to make fixes fail with this message. */
  failWith: string | null = null;
  done = false;

  constructor(options: { checks?: SetupCheck[]; firstRun?: boolean } = {}) {
    this.checksResult = options.checks ?? ALL_OK;
    this.isFirstRun = options.firstRun ?? false;
  }

  checks(): Promise<SetupCheck[]> {
    return Promise.resolve(this.checksResult);
  }

  fix(kind: SetupFix): Promise<SystemOutcome<null>> {
    if (this.failWith !== null) return Promise.resolve({ ok: false, message: this.failWith });
    this.fixes.push(kind);
    this.checksResult = this.checksResult.map((check) =>
      check.fix === kind ? { ...check, status: "ok", fix: null } : check,
    );
    return Promise.resolve({ ok: true, value: null });
  }

  firstRun(): Promise<boolean> {
    return Promise.resolve(this.isFirstRun);
  }

  markDone(): Promise<void> {
    this.done = true;
    this.isFirstRun = false;
    return Promise.resolve();
  }
}
