//! Socket server (spec §8). One task per connection; method calls are forwarded to the
//! daemon loop, subscriptions are filtered per connection.

use std::collections::HashSet;

use serde_json::{Value, json};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::{UnixListener, UnixStream},
    sync::{broadcast, mpsc, oneshot},
};
use tracing::debug;

use crate::{
    daemon::Msg,
    protocol::{
        Event, PROTOCOL_VERSION, Request, Response, RpcError, ServerMessage, TOPICS, compatible,
    },
};

/// Request from a connection to the daemon loop.
pub enum IpcCommand {
    Call {
        conn: u64,
        method: String,
        params: Value,
        reply: oneshot::Sender<Result<Value, RpcError>>,
    },
    /// The connection's interest in the `tester` topic changed.
    Tester {
        conn: u64,
        subscribed: bool,
    },
    Disconnected {
        conn: u64,
    },
}

/// An event pushed to subscribers (`target` = only that connection).
#[derive(Clone, Debug)]
pub struct Broadcast {
    pub topic: String,
    pub target: Option<u64>,
    pub data: Value,
}

pub async fn serve(
    listener: UnixListener,
    tx: mpsc::UnboundedSender<Msg>,
    events: broadcast::Sender<Broadcast>,
) {
    let mut next_conn = 1u64;
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let conn = next_conn;
                next_conn += 1;
                tokio::spawn(connection(conn, stream, tx.clone(), events.subscribe()));
            }
            Err(e) => {
                tracing::warn!("socket accept failed: {e}");
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        }
    }
}

fn line(msg: &ServerMessage) -> String {
    let mut s = serde_json::to_string(msg).unwrap_or_default();
    s.push('\n');
    s
}

fn respond(id: u64, r: Result<Value, RpcError>) -> String {
    let (result, error) = match r {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e)),
    };
    line(&ServerMessage::Response(Response { id, result, error }))
}

async fn connection(
    conn: u64,
    stream: UnixStream,
    tx: mpsc::UnboundedSender<Msg>,
    mut events: broadcast::Receiver<Broadcast>,
) {
    let (rd, mut wr) = stream.into_split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        while let Some(l) = out_rx.recv().await {
            if wr.write_all(l.as_bytes()).await.is_err() {
                break;
            }
        }
    });
    let mut lines = BufReader::new(rd).lines();
    let mut topics: HashSet<String> = HashSet::new();
    let mut hello = false;
    loop {
        tokio::select! {
            l = lines.next_line() => {
                let Ok(Some(l)) = l else { break };
                if l.trim().is_empty() {
                    continue;
                }
                let req: Request = match serde_json::from_str(&l) {
                    Ok(r) => r,
                    Err(e) => {
                        let _ = out_tx.send(respond(0, Err(RpcError::new("parse_error", e.to_string()))));
                        continue;
                    }
                };
                let id = req.id;
                let r = handle(conn, req, &mut hello, &mut topics, &tx).await;
                let _ = out_tx.send(respond(id, r));
            }
            ev = events.recv() => match ev {
                Ok(b) => {
                    let wanted = match b.target {
                        Some(t) => t == conn,
                        None => topics.contains(&b.topic),
                    };
                    if wanted {
                        let _ = out_tx.send(line(&ServerMessage::Event(Event { event: b.topic, data: b.data })));
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => debug!("connection {conn} lagged by {n} events"),
                Err(broadcast::error::RecvError::Closed) => break,
            },
        }
    }
    let _ = tx.send(Msg::Ipc(IpcCommand::Disconnected { conn }));
    drop(out_tx);
    let _ = writer.await;
}

fn topic_list(params: &Value) -> Result<Vec<String>, RpcError> {
    let list = params
        .get("topics")
        .and_then(Value::as_array)
        .ok_or_else(|| RpcError::new("invalid_params", "expected {\"topics\": [..]}"))?;
    let mut out = Vec::new();
    for t in list {
        let t = t.as_str().unwrap_or_default();
        if !TOPICS.contains(&t) {
            return Err(RpcError::new(
                "invalid_params",
                format!("unknown topic `{t}`"),
            ));
        }
        out.push(t.to_owned());
    }
    Ok(out)
}

async fn handle(
    conn: u64,
    req: Request,
    hello: &mut bool,
    topics: &mut HashSet<String>,
    tx: &mpsc::UnboundedSender<Msg>,
) -> Result<Value, RpcError> {
    match req.method.as_str() {
        "hello" => {
            let v = req
                .params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("");
            if !compatible(v) {
                return Err(RpcError::new(
                    "incompatible_version",
                    format!(
                        "client protocol `{v}` is not compatible with engine protocol {PROTOCOL_VERSION}"
                    ),
                ));
            }
            *hello = true;
        }
        _ if !*hello => return Err(RpcError::new("hello_required", "send `hello` first")),
        "subscribe" | "unsubscribe" => {
            let list = topic_list(&req.params)?;
            let was_tester = topics.contains("tester");
            for t in list {
                if req.method == "subscribe" {
                    topics.insert(t);
                } else {
                    topics.remove(&t);
                }
            }
            let has_tester = topics.contains("tester");
            if was_tester != has_tester {
                let _ = tx.send(Msg::Ipc(IpcCommand::Tester {
                    conn,
                    subscribed: has_tester,
                }));
            }
            let mut v: Vec<&String> = topics.iter().collect();
            v.sort();
            return Ok(json!({ "topics": v }));
        }
        _ => {}
    }
    let (reply, rx) = oneshot::channel();
    tx.send(Msg::Ipc(IpcCommand::Call {
        conn,
        method: req.method,
        params: req.params,
        reply,
    }))
    .map_err(|_| RpcError::new("shutting_down", "engine is shutting down"))?;
    rx.await
        .map_err(|_| RpcError::new("shutting_down", "engine is shutting down"))?
}
