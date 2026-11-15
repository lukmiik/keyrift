//! A uinput keyboard created with raw ioctls, for tests that need a physical path (`phys`).
//!
//! evdev 0.13.2 declares `UI_SET_PHYS` with an argument size of 1 instead of a pointer, so the
//! kernel rejects it with EINVAL; this sets up the device by hand instead.
#![allow(unsafe_code)]

use std::{
    ffi::CString,
    fs::{File, OpenOptions},
    io::Write,
    os::fd::AsRawFd,
    path::PathBuf,
    thread,
    time::Duration,
};

const UI_SET_EVBIT: libc::Ioctl = 0x4004_5564;
const UI_SET_KEYBIT: libc::Ioctl = 0x4004_5565;
const UI_SET_PHYS: libc::Ioctl = 0x4008_556c;
const UI_DEV_SETUP: libc::Ioctl = 0x405c_5503;
const UI_DEV_CREATE: libc::Ioctl = 0x5501;
const UI_DEV_DESTROY: libc::Ioctl = 0x5502;
const UI_GET_SYSNAME_64: libc::Ioctl = 0x8040_552c;
const EV_SYN: u16 = 0;
const EV_KEY: u16 = 1;

#[repr(C)]
struct UinputSetup {
    bustype: u16,
    vendor: u16,
    product: u16,
    version: u16,
    name: [u8; 80],
    ff_effects_max: u32,
}

#[repr(C)]
struct InputEvent {
    time: libc::timeval,
    kind: u16,
    code: u16,
    value: i32,
}

pub struct RawSource {
    file: File,
    pub node: PathBuf,
}

fn check(r: libc::c_int, what: &str) {
    assert!(r >= 0, "{what}: {}", std::io::Error::last_os_error());
}

impl RawSource {
    pub fn new(name: &str, phys: &str) -> RawSource {
        let file = OpenOptions::new().write(true).open("/dev/uinput").unwrap();
        let fd = file.as_raw_fd();
        let phys = CString::new(phys).unwrap();
        let mut setup = UinputSetup {
            bustype: 0x03,
            vendor: 0x1234,
            product: 0x5679,
            version: 1,
            name: [0; 80],
            ff_effects_max: 0,
        };
        setup.name[..name.len()].copy_from_slice(name.as_bytes());
        let mut sysname = [0u8; 64];
        // SAFETY: plain uinput ioctls on a fd we own, with correctly sized arguments.
        unsafe {
            check(
                libc::ioctl(fd, UI_SET_EVBIT, libc::c_int::from(EV_KEY)),
                "UI_SET_EVBIT",
            );
            for code in 1..560 {
                check(libc::ioctl(fd, UI_SET_KEYBIT, code), "UI_SET_KEYBIT");
            }
            check(libc::ioctl(fd, UI_SET_PHYS, phys.as_ptr()), "UI_SET_PHYS");
            check(
                libc::ioctl(fd, UI_DEV_SETUP, &raw const setup),
                "UI_DEV_SETUP",
            );
            check(libc::ioctl(fd, UI_DEV_CREATE), "UI_DEV_CREATE");
            check(
                libc::ioctl(fd, UI_GET_SYSNAME_64, sysname.as_mut_ptr()),
                "UI_GET_SYSNAME",
            );
        }
        let sys = String::from_utf8_lossy(&sysname)
            .trim_end_matches('\0')
            .to_owned();
        let dir = PathBuf::from(format!("/sys/devices/virtual/input/{sys}"));
        let node = super::wait_until(Duration::from_secs(3), || {
            let ev = std::fs::read_dir(&dir)
                .ok()?
                .filter_map(Result::ok)
                .find(|e| e.file_name().to_string_lossy().starts_with("event"))?;
            let node = PathBuf::from("/dev/input").join(ev.file_name());
            node.exists().then_some(node)
        })
        .expect("raw source node");
        RawSource { file, node }
    }

    fn write(&mut self, kind: u16, code: u16, value: i32) {
        let ev = InputEvent {
            time: libc::timeval {
                tv_sec: 0,
                tv_usec: 0,
            },
            kind,
            code,
            value,
        };
        // SAFETY: InputEvent is a plain repr(C) struct; we view its bytes for the write.
        let bytes = unsafe {
            std::slice::from_raw_parts((&raw const ev).cast::<u8>(), size_of::<InputEvent>())
        };
        self.file.write_all(bytes).unwrap();
    }

    pub fn send(&mut self, name: &str, pressed: bool) {
        self.write(EV_KEY, super::key(name).code(), i32::from(pressed));
        self.write(EV_SYN, 0, 0);
        thread::sleep(Duration::from_millis(2));
    }

    pub fn tap(&mut self, name: &str) {
        self.send(name, true);
        self.send(name, false);
    }

    pub fn grab_self(&self) -> Option<evdev::Device> {
        let mut d = evdev::Device::open(&self.node).ok()?;
        d.grab().ok()?;
        Some(d)
    }
}

impl Drop for RawSource {
    fn drop(&mut self) {
        // SAFETY: destroying the device we created on our own fd.
        unsafe {
            libc::ioctl(self.file.as_raw_fd(), UI_DEV_DESTROY);
        }
    }
}
