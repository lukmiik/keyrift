# Keyrift

Keyboard remapper for Linux/X11: a Rust engine (daemon + CLI) and, later, an Electron GUI.
Specs live in `docs/`, which is kept locally and not committed (start with
`docs/03-project-specification.md`); only `docs/images/` is in git. Phase 1 (milestones M0–M3)
is Rust only.

# Rust (Cargo workspace)

- Crates: `crates/core` (pure remapping logic, no I/O), `crates/config` (config types + JSON Schema),
  `crates/engine` (daemon: evdev, uinput, hot-plug, IPC), `crates/cli` (the `keyrift` binary).
- Toolchain is pinned in `rust-toolchain.toml`; lints in the root `Cargo.toml` (`[workspace.lints]`)
  and `clippy.toml`; formatting in `rustfmt.toml`; dependency policy in `deny.toml`.

## Verify after every Rust change

Run all of these and fix every failure before considering the change done:

1. `cargo build --workspace --all-targets` – builds
2. `cargo fmt --all` – formats (CI-style check: `cargo fmt-check`)
3. `cargo lint` – clippy on all targets, warnings are errors
4. `cargo test --workspace` – tests pass
5. `cargo deny check` – only when dependencies were added or updated

# TypeScript / Vite+

The TS side uses Vite+ (`vp`), a single CLI wrapping Vite, Vitest, Oxlint and Oxfmt.

- `vp <name>` runs a built-in command; `vp run <name>` runs a `package.json` script or `vite.config.ts` task.
- Run TS/JS scripts with `vpx <file>` (no `tsx`/`ts-node`).
- Docs: `node_modules/vite-plus/docs` or https://viteplus.dev/guide/.

## Verify after every TS or docs change

1. `vp install` – after pulling changes
2. `vp check` – format, lint, type check (also formats Markdown; `vp check --fix` to apply)
3. `vp test` – tests
