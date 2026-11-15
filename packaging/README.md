# Packaging files

| File                          | Installed to                             | Purpose                                     |
| ----------------------------- | ---------------------------------------- | ------------------------------------------- |
| `udev/70-keyrift.rules`       | `/etc/udev/rules.d/70-keyrift.rules`     | `uinput` + `event*` access for the groups   |
| `modules-load.d/keyrift.conf` | `/etc/modules-load.d/keyrift.conf`       | load `uinput` at boot                       |
| `systemd/keyrift.service`     | `~/.config/systemd/user/keyrift.service` | reference; `keyrift service install` writes |

Install the system files once (the user must also be in the `input` and `uinput` groups):

```sh
sudo install -m 644 packaging/udev/70-keyrift.rules /etc/udev/rules.d/ \
  && sudo install -m 644 packaging/modules-load.d/keyrift.conf /etc/modules-load.d/ \
  && sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=input --subsystem-match=misc
```

Then install and start the user unit: `keyrift service install`.
