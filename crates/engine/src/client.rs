//! Blocking client for the engine socket, used by the CLI and tests.

use std::{
    io::{self, BufRead, BufReader, Write},
    os::unix::net::UnixStream,
    path::Path,
    time::Duration,
};

use serde_json::{Value, json};

use crate::protocol::{Event, PROTOCOL_VERSION, Request, RpcError, ServerMessage};

pub struct Client {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
    next_id: u64,
    /// Events received while waiting for a response.
    queued: Vec<Event>,
}

#[derive(Debug)]
pub enum ClientError {
    Io(io::Error),
    Rpc(RpcError),
    Protocol(String),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientError::Io(e) => write!(f, "{e}"),
            ClientError::Rpc(e) => write!(f, "{} ({})", e.message, e.code),
            ClientError::Protocol(e) => write!(f, "protocol error: {e}"),
        }
    }
}

impl std::error::Error for ClientError {}

impl From<io::Error> for ClientError {
    fn from(e: io::Error) -> Self {
        ClientError::Io(e)
    }
}

impl Client {
    /// Connect and perform the `hello` handshake.
    pub fn connect(socket: &Path, client_name: &str) -> Result<(Client, Value), ClientError> {
        let stream = UnixStream::connect(socket)?;
        stream.set_read_timeout(Some(Duration::from_secs(10)))?;
        let writer = stream.try_clone()?;
        let mut c = Client {
            reader: BufReader::new(stream),
            writer,
            next_id: 1,
            queued: Vec::new(),
        };
        let hello = c.call(
            "hello",
            json!({ "protocolVersion": PROTOCOL_VERSION, "client": client_name }),
        )?;
        Ok((c, hello))
    }

    /// Send a request and wait for its response (events received meanwhile are queued).
    pub fn call(&mut self, method: &str, params: Value) -> Result<Value, ClientError> {
        let id = self.next_id;
        self.next_id += 1;
        let mut line = serde_json::to_string(&Request {
            id,
            method: method.to_owned(),
            params,
        })
        .map_err(|e| ClientError::Protocol(e.to_string()))?;
        line.push('\n');
        self.writer.write_all(line.as_bytes())?;
        loop {
            match self.read_message()? {
                ServerMessage::Response(r) if r.id == id => {
                    return match (r.result, r.error) {
                        (_, Some(e)) => Err(ClientError::Rpc(e)),
                        (Some(v), None) => Ok(v),
                        (None, None) => Ok(Value::Null),
                    };
                }
                ServerMessage::Response(_) => {}
                ServerMessage::Event(e) => self.queued.push(e),
            }
        }
    }

    /// Wait for the next pushed event.
    pub fn next_event(&mut self, timeout: Option<Duration>) -> Result<Event, ClientError> {
        if !self.queued.is_empty() {
            return Ok(self.queued.remove(0));
        }
        self.reader.get_ref().set_read_timeout(timeout)?;
        let r = loop {
            match self.read_message() {
                Ok(ServerMessage::Event(e)) => break Ok(e),
                Ok(ServerMessage::Response(_)) => {}
                Err(e) => break Err(e),
            }
        };
        self.reader
            .get_ref()
            .set_read_timeout(Some(Duration::from_secs(10)))?;
        r
    }

    fn read_message(&mut self) -> Result<ServerMessage, ClientError> {
        let mut line = String::new();
        if self.reader.read_line(&mut line)? == 0 {
            return Err(ClientError::Io(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "engine closed the connection",
            )));
        }
        serde_json::from_str(&line).map_err(|e| ClientError::Protocol(format!("{e}: {line}")))
    }
}
