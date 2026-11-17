# Packaging files

| File                          | Installed to                             | Purpose                                     |
| ----------------------------- | ---------------------------------------- | ------------------------------------------- |
| `udev/70-keyrift.rules`       | `/etc/udev/rules.d/70-keyrift.rules`     | `uinput` + `event*` access for the groups   |
| `modules-load.d/keyrift.conf` | `/etc/modules-load.d/keyrift.conf`       | load `uinput` at boot                       |
| `systemd/keyrift.service`     | `~/.config/systemd/user/keyrift.service` | reference; `keyrift service install` writes |
| `linux/after-install.sh`      | run by apt / pacman after installing     | see "Packages" below                        |
| `linux/after-remove.sh`       | run by apt / pacman after removing       | undoes after-install.sh, except the groups  |

Install the system files once (the user must also be in the `input` and `uinput` groups):

```sh
sudo install -m 644 packaging/udev/70-keyrift.rules /etc/udev/rules.d/ \
  && sudo install -m 644 packaging/modules-load.d/keyrift.conf /etc/modules-load.d/ \
  && sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=input --subsystem-match=misc
```

Then install and start the user unit: `keyrift service install`.

## Packages

`vp run package` in `apps/desktop` builds the engine (`cargo build --release`) and the app, then
electron-builder (`apps/desktop/electron-builder.yml`) writes to `apps/desktop/release/`:

| File                                  | For                    | Install                               |
| ------------------------------------- | ---------------------- | ------------------------------------- |
| `keyrift_<version>_amd64.deb`         | Debian, Ubuntu         | `sudo apt install ./keyrift_….deb`    |
| `keyrift-<version>-x86_64.pkg.tar.xz` | Arch, Omarchy          | `sudo pacman -U keyrift-….pkg.tar.xz` |
| `Keyrift-<version>.AppImage`          | any distribution (x64) | `chmod +x` and run it                 |

Building the pacman package needs `bsdtar` (Ubuntu: `sudo apt install libarchive-tools`).

The .deb and pacman packages put the app in `/opt/Keyrift` (the GUI is `keyrift-gui`) and their
install script, run as root, also:

- links the engine to `/usr/bin/keyrift`,
- creates the `input` and `uinput` groups and installs the udev rule and the modules-load file
  above (what the setup wizard's password prompt would do), then reloads udev.

Adding the user to the groups is left to the setup wizard: the package doesn't know who will use
Keyrift. The AppImage needs no root; the wizard does the system part with one password prompt, and
the app copies its engine to `~/.local/share/keyrift/bin` (spec §9.1).

Package checks:

- `dpkg-deb --contents release/keyrift_<version>_amd64.deb` lists the files.
- `KEYRIFT_APPIMAGE=release/Keyrift-<version>.AppImage vp test e2e/appimage` starts the AppImage with
  an empty HOME and connects it to its engine running as a test unit.
- `cargo test -p keyrift --test m5_update -- --ignored` replaces the engine binary while it runs
  and restarts the unit with a key held.

## Releases

`.github/workflows/release.yml` builds the packages on GitHub for every `v*` tag and attaches the
three files above to a GitHub Release for that tag, together with `latest-linux.yml`. To cut one:

1. Bump `version` in `apps/desktop/package.json` and in the root `Cargo.toml` (e.g. `0.3.0`), run
   `cargo build` to update `Cargo.lock`, and commit. The workflow fails when the tag doesn't match
   both versions.
2. Tag that commit: `git tag v0.3.0`.
3. Push the tag: `git push origin v0.3.0`.

### Updates

The app updates itself from these releases (Settings → Updates, electron-updater). It reads
`latest-linux.yml` from the latest release, downloads the file matching how it was installed and
installs it: `dpkg -i` or `pacman -U` behind one password prompt (pkexec) for the packages, or by
replacing the file for the AppImage. electron-builder writes `latest-linux.yml` next to the packages
and puts `app-update.yml` (where to look) and `package-type` (deb or pacman) into them, because
`publish` in `electron-builder.yml` names this repository; `--publish never` keeps it from uploading
anything itself. After a .deb or pacman update the new app restarts `keyrift.service` when the running
engine is older than the installed one. Version 0.1.0 had no updater: install 0.2.0 by hand once.

`.github/workflows/ci.yml` runs the Rust and TypeScript checks on every push and pull request.
GitHub's runners have no writable `/dev/uinput`, so the end-to-end and GUI tests skip themselves
there: run them locally.
