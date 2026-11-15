//! Input device discovery, classification and grouping (spec §4.1).

use std::{
    collections::HashMap,
    fs, io,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

use evdev::{Device, KeyCode, RelativeAxisCode};
use keyrift_config::{DeviceMatch, DeviceSettings};
use serde::Serialize;

/// Name prefix of Keyrift's own virtual keyboards; such devices are never grabbed.
pub const OUTPUT_NAME: &str = "Keyrift virtual keyboard";

const LETTERS: [KeyCode; 26] = [
    KeyCode::KEY_A,
    KeyCode::KEY_B,
    KeyCode::KEY_C,
    KeyCode::KEY_D,
    KeyCode::KEY_E,
    KeyCode::KEY_F,
    KeyCode::KEY_G,
    KeyCode::KEY_H,
    KeyCode::KEY_I,
    KeyCode::KEY_J,
    KeyCode::KEY_K,
    KeyCode::KEY_L,
    KeyCode::KEY_M,
    KeyCode::KEY_N,
    KeyCode::KEY_O,
    KeyCode::KEY_P,
    KeyCode::KEY_Q,
    KeyCode::KEY_R,
    KeyCode::KEY_S,
    KeyCode::KEY_T,
    KeyCode::KEY_U,
    KeyCode::KEY_V,
    KeyCode::KEY_W,
    KeyCode::KEY_X,
    KeyCode::KEY_Y,
    KeyCode::KEY_Z,
];

/// One `/dev/input/event*` node.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub path: PathBuf,
    pub name: String,
    pub phys: String,
    pub vendor: u16,
    pub product: u16,
    /// Reports `KEY_A`..`KEY_Z`, `KEY_SPACE` and `KEY_ENTER`.
    pub has_letters: bool,
    /// Reports any key.
    pub has_keys: bool,
    /// Reports relative X and Y (a pointer such as a mouse).
    pub is_pointer: bool,
}

impl Member {
    /// Read the capabilities of a device node.
    pub fn read(path: &Path) -> io::Result<Member> {
        let dev = Device::open(path)?;
        Ok(Member::from_device(path, &dev))
    }

    pub fn from_device(path: &Path, dev: &Device) -> Member {
        let keys = dev.supported_keys();
        let has_letters = keys.is_some_and(|k| {
            LETTERS.iter().all(|l| k.contains(*l))
                && k.contains(KeyCode::KEY_SPACE)
                && k.contains(KeyCode::KEY_ENTER)
        });
        let has_keys = keys.is_some_and(|k| k.iter().next().is_some());
        let is_pointer = dev.supported_relative_axes().is_some_and(|r| {
            r.contains(RelativeAxisCode::REL_X) && r.contains(RelativeAxisCode::REL_Y)
        });
        let id = dev.input_id();
        Member {
            path: path.to_path_buf(),
            name: dev.name().unwrap_or("").to_owned(),
            phys: dev.physical_path().unwrap_or("").to_owned(),
            vendor: id.vendor(),
            product: id.product(),
            has_letters,
            has_keys,
            is_pointer,
        }
    }

    /// Grouping key: the physical path without the trailing `/inputN` (same USB device),
    /// or the node path for devices without a physical path (e.g. virtual devices).
    pub fn group_key(&self) -> String {
        if self.phys.is_empty() {
            return self.path.display().to_string();
        }
        match self.phys.rsplit_once('/') {
            Some((prefix, last)) if last.starts_with("input") => prefix.to_owned(),
            _ => self.phys.clone(),
        }
    }

    pub fn is_own_output(&self) -> bool {
        self.name.starts_with(OUTPUT_NAME)
    }
}

/// List readable `/dev/input/event*` nodes, sorted by event number.
pub fn scan(dir: &Path) -> Vec<Member> {
    Scanner::default().scan(dir)
}

/// Scans `/dev/input`, remembering what it read per node.
///
/// Opening and especially closing an evdev node is slow (about 10 ms per `close`, measured on the
/// author's machine), so a full rescan on every hot-plug event would stall the event loop for a
/// quarter of a second. A node is re-read only when its inode or ctime changes (a new device or new
/// permissions).
#[derive(Default)]
pub struct Scanner {
    cache: HashMap<PathBuf, (u64, i64, i64, Member)>,
}

impl Scanner {
    pub fn scan(&mut self, dir: &Path) -> Vec<Member> {
        let Ok(entries) = fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut paths: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                p.file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with("event"))
            })
            .collect();
        paths.sort_by_key(|p| event_number(p));
        self.cache.retain(|p, _| paths.contains(p));
        let mut out = Vec::new();
        for p in paths {
            let Ok(meta) = fs::metadata(&p) else { continue };
            let stamp = (meta.ino(), meta.ctime(), meta.ctime_nsec());
            match self.cache.get(&p) {
                Some((ino, s, ns, m)) if (*ino, *s, *ns) == stamp => out.push(m.clone()),
                _ => {
                    if let Ok(m) = Member::read(&p) {
                        self.cache.insert(p, (stamp.0, stamp.1, stamp.2, m.clone()));
                        out.push(m);
                    } else {
                        self.cache.remove(&p);
                    }
                }
            }
        }
        out
    }
}

fn event_number(p: &Path) -> u32 {
    p.file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_prefix("event"))
        .and_then(|n| n.parse().ok())
        .unwrap_or(u32::MAX)
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GroupKind {
    Keyboard,
    /// A keyboard interface on a device that is also a pointer (F-DEV-3).
    ProbablyMouse,
    Other,
}

/// Sub-devices of one physical device (F-DEV-2).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub key: String,
    pub name: String,
    pub vendor_id: String,
    pub product_id: String,
    pub kind: GroupKind,
    pub members: Vec<Member>,
}

impl Group {
    /// Members that are grabbed when the group is remapped: everything with keys except pointers.
    pub fn grab_members(&self) -> impl Iterator<Item = &Member> {
        self.members.iter().filter(|m| m.has_keys && !m.is_pointer)
    }

    fn matches(&self, m: &DeviceMatch) -> bool {
        let hex = |s: &str| u16::from_str_radix(s.trim_start_matches("0x"), 16).ok();
        let (v, p) = (self.members[0].vendor, self.members[0].product);
        hex(&m.vendor_id) == Some(v) && hex(&m.product_id) == Some(p) && m.name == self.name
    }
}

/// Group members by physical device and classify the groups. Keyrift's own output devices
/// are left out.
pub fn group(members: Vec<Member>) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    for m in members.into_iter().filter(|m| !m.is_own_output()) {
        let key = m.group_key();
        if let Some(g) = groups.iter_mut().find(|g| g.key == key) {
            g.members.push(m);
        } else {
            groups.push(Group {
                key,
                name: String::new(),
                vendor_id: format!("0x{:04x}", m.vendor),
                product_id: format!("0x{:04x}", m.product),
                kind: GroupKind::Other,
                members: vec![m],
            });
        }
    }
    for g in &mut groups {
        let keyboard = g.members.iter().any(|m| m.has_letters);
        let pointer = g.members.iter().any(|m| m.is_pointer);
        g.kind = match (keyboard, pointer) {
            (true, false) => GroupKind::Keyboard,
            (true, true) => GroupKind::ProbablyMouse,
            _ => GroupKind::Other,
        };
        let primary = g
            .members
            .iter()
            .find(|m| m.has_letters)
            .unwrap_or(&g.members[0]);
        g.name = primary.name.clone();
    }
    groups
}

/// Whether and why a group is (not) remapped.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Decision {
    Grab,
    Excluded,
    Hidden,
    NotKeyboard,
    /// Not matching the `--only-device` test filter.
    Filtered,
}

pub fn decide(g: &Group, settings: &DeviceSettings, only: Option<&str>) -> Decision {
    if let Some(only) = only
        && !g.members.iter().any(|m| m.name.contains(only))
    {
        return Decision::Filtered;
    }
    if settings.excluded.iter().any(|m| g.matches(m)) {
        return Decision::Excluded;
    }
    match g.kind {
        GroupKind::Keyboard => Decision::Grab,
        GroupKind::ProbablyMouse if settings.included.iter().any(|m| g.matches(m)) => {
            Decision::Grab
        }
        GroupKind::ProbablyMouse => Decision::Hidden,
        GroupKind::Other => Decision::NotKeyboard,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(event: u32, name: &str, phys: &str, letters: bool, pointer: bool) -> Member {
        Member {
            path: PathBuf::from(format!("/dev/input/event{event}")),
            name: name.to_owned(),
            phys: phys.to_owned(),
            vendor: 0x1532,
            product: 0x008c,
            has_letters: letters,
            has_keys: true,
            is_pointer: pointer,
        }
    }

    #[test]
    fn groups_by_usb_device_and_detects_mouse_keyboard_interfaces() {
        let groups = group(vec![
            m(8, "HyperX", "usb-0000:00:14.0-3.3/input0", true, false),
            m(
                9,
                "HyperX Consumer Control",
                "usb-0000:00:14.0-3.3/input1",
                false,
                false,
            ),
            m(11, "Razer", "usb-0000:00:14.0-3.4/input0", false, true),
            m(14, "Razer", "usb-0000:00:14.0-3.4/input2", true, false),
            m(20, "Keyrift virtual keyboard", "", true, false),
            m(21, "keyrift-test-a", "", true, false),
        ]);
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].kind, GroupKind::Keyboard);
        assert_eq!(groups[0].members.len(), 2);
        assert_eq!(groups[0].name, "HyperX");
        assert_eq!(groups[1].kind, GroupKind::ProbablyMouse);
        assert_eq!(
            groups[1].grab_members().count(),
            1,
            "the pointer interface is never grabbed"
        );
        assert_eq!(groups[2].key, "/dev/input/event21");
        let s = DeviceSettings::default();
        assert_eq!(decide(&groups[0], &s, None), Decision::Grab);
        assert_eq!(decide(&groups[1], &s, None), Decision::Hidden);
        assert_eq!(
            decide(&groups[0], &s, Some("keyrift-test")),
            Decision::Filtered
        );
        assert_eq!(decide(&groups[2], &s, Some("keyrift-test")), Decision::Grab);
    }

    #[test]
    fn exclusion_and_inclusion_match_vendor_product_and_name() {
        let groups = group(vec![
            m(8, "Kbd", "usb-1/input0", true, false),
            m(11, "Mouse", "usb-2/input0", false, true),
            m(12, "Mouse Keyboard", "usb-2/input1", true, false),
        ]);
        let dm = |name: &str| DeviceMatch {
            vendor_id: "0x1532".into(),
            product_id: "0x008C".into(),
            name: name.into(),
        };
        let s = DeviceSettings {
            excluded: vec![dm("Kbd")],
            included: vec![dm("Mouse Keyboard")],
        };
        assert_eq!(decide(&groups[0], &s, None), Decision::Excluded);
        assert_eq!(decide(&groups[1], &s, None), Decision::Grab);
    }
}
