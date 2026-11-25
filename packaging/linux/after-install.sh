#!/bin/bash
# Runs as root after the .deb or pacman package is installed (electron-builder.yml: afterInstall).
# electron-builder fills in ${...} (so shell variables here are written without braces).
#
# First part: electron-builder's own after-install script (app-builder-lib templates/linux,
# electron-builder 26.18), unchanged: links the GUI to /usr/bin, sets up Chromium's sandbox and
# installs its AppArmor profile. Second part: Keyrift's system setup.

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' '/opt/${sanitizedProductName}/${executable}' 100 || ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
else
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Check if user namespaces are supported by the kernel and working with a quick test:
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    # Use SUID chrome-sandbox only on systems without user namespaces:
    chmod 4755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
else
    chmod 0755 '/opt/${sanitizedProductName}/chrome-sandbox' || true
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Install apparmor profile. (Ubuntu 24+)
# First check if the version of AppArmor running on the device supports our profile.
# This is in order to keep backwards compatibility with Ubuntu 22.04 which does not support abi/4.0.
# In that case, we just skip installing the profile since the app runs fine without it on 22.04.
#
# Those apparmor_parser flags are akin to performing a dry run of loading a profile.
# https://wiki.debian.org/AppArmor/HowToUse#Dumping_profiles
#
# Unfortunately, at the moment AppArmor doesn't have a good story for backwards compatibility.
# https://askubuntu.com/questions/1517272/writing-a-backwards-compatible-apparmor-profile
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE='/opt/${sanitizedProductName}/resources/apparmor-profile'
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Updating the current AppArmor profile is not possible and probably not meaningful in a chroot'ed environment.
    # Use cases are for example environments where images for clients are maintained.
    # There, AppArmor might correctly be installed, but live updating makes no sense.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      # Extra flags taken from dh_apparmor:
      # > By using '-W -T' we ensure that any abstraction updates are also pulled in.
      # https://wiki.debian.org/AppArmor/Contribute/FirstTimeProfileImport
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# --- Keyrift ---------------------------------------------------------------------------------

RESOURCES='/opt/${sanitizedProductName}/resources'

# The engine as `keyrift` on PATH (the GUI is `${executable}`). `keyrift service install` resolves
# this link, so the user unit points at the packaged binary, which upgrades replace.
ln -sf "$RESOURCES/keyrift" /usr/bin/keyrift

# What the setup wizard's "Fix with one password prompt" does (spec §9.2–9.3), minus adding the
# user to the groups: the package doesn't know which user will run Keyrift, so the wizard still
# asks for that.
groupadd -f input || true
groupadd -f uinput || true
# Re-applying the rule makes Xorg unplug and replug the devices it touches, which resets
# per-device settings (mouse speed set with xinput, …). So only when the rule changed (first
# install, or a release that changes it), and only for keyboards and uinput, never mice.
RULE=/etc/udev/rules.d/70-keyrift.rules
RULE_CHANGED=1
cmp -s "$RESOURCES/packaging/70-keyrift.rules" "$RULE" && RULE_CHANGED=0
install -m 644 "$RESOURCES/packaging/70-keyrift.rules" "$RULE"
install -m 644 "$RESOURCES/packaging/keyrift.conf" /etc/modules-load.d/keyrift.conf
modprobe uinput || true
if [ "$RULE_CHANGED" = 1 ] && hash udevadm 2>/dev/null; then
  udevadm control --reload || true
  udevadm trigger --subsystem-match=misc --sysname-match=uinput || true
  udevadm trigger --subsystem-match=input --property-match=ID_INPUT_KEYBOARD=1 || true
fi
