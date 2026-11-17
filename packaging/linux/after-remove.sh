#!/bin/bash
# Runs as root after the package is removed (electron-builder.yml: afterRemove). First part:
# electron-builder's own after-remove script (electron-builder 26.18), unchanged. Second part:
# undoes Keyrift's part of after-install.sh. The groups stay: users may be in them for other
# reasons. A user's keyrift.service stays too (it's in their home); it fails to start until
# removed with `systemctl --user disable keyrift`.

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi
# --- Keyrift ---------------------------------------------------------------------------------

# Only our link, not a `keyrift` the user installed there some other way.
if [ "$(readlink /usr/bin/keyrift)" = '/opt/${sanitizedProductName}/resources/keyrift' ]; then
  rm -f /usr/bin/keyrift
fi
rm -f /etc/udev/rules.d/70-keyrift.rules /etc/modules-load.d/keyrift.conf
if hash udevadm 2>/dev/null; then
  udevadm control --reload || true
fi
