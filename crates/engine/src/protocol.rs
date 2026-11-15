//! The engine's socket protocol (spec §8): newline-delimited JSON.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `major.minor`; clients with a different major version are rejected.
pub const PROTOCOL_VERSION: &str = "1.0";

/// Topics a client can subscribe to.
pub const TOPICS: [&str; 5] = ["status", "layer", "devices", "config", "tester"];

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Request {
    pub id: u64,
    pub method: String,
    #[serde(default, skip_serializing_if = "Value::is_null")]
    pub params: Value,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

impl RpcError {
    pub fn new(code: &str, message: impl Into<String>) -> RpcError {
        RpcError {
            code: code.to_owned(),
            message: message.into(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Response {
    pub id: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Event {
    pub event: String,
    pub data: Value,
}

/// Anything the server sends.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum ServerMessage {
    Response(Response),
    Event(Event),
}

/// Whether a client protocol version is compatible with ours (same major version).
pub fn compatible(version: &str) -> bool {
    let major = |v: &str| v.split('.').next().map(str::to_owned);
    major(version).is_some() && major(version) == major(PROTOCOL_VERSION)
}
