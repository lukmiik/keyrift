//! Pure remapping logic for Keyrift.
//!
//! This crate is a state machine with no I/O: input events and the current time go in,
//! output events and timer requests come out. That keeps it fully testable with
//! simulated, timestamped input (see `docs/03-project-specification.md`, §5.1).
#![forbid(unsafe_code)]
