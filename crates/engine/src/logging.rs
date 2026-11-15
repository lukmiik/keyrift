//! Logging through `tracing` to stdout, which systemd forwards to journald (spec F-SYS-6).

use std::io::IsTerminal;

use keyrift_config::LogLevel;
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::{
    Registry,
    filter::LevelFilter,
    fmt::{self, FmtContext, FormatEvent, FormatFields, format::Writer},
    layer::SubscriberExt,
    registry::LookupSpan,
    reload,
    util::SubscriberInitExt,
};

/// Changes the log level at runtime.
#[derive(Clone)]
pub struct LogControl {
    handle: reload::Handle<LevelFilter, Registry>,
}

impl LogControl {
    pub fn set_level(&self, level: LogLevel) {
        let _ = self.handle.modify(|f| *f = filter(level));
    }

    pub fn level(&self) -> Option<String> {
        self.handle
            .with_current(|f| f.to_string().to_lowercase())
            .ok()
    }
}

fn filter(level: LogLevel) -> LevelFilter {
    match level {
        LogLevel::Error => LevelFilter::ERROR,
        LogLevel::Warn => LevelFilter::WARN,
        LogLevel::Info => LevelFilter::INFO,
        LogLevel::Debug => LevelFilter::DEBUG,
    }
}

/// Prefixes lines with `<N>` syslog priorities so journald records the right level.
struct JournalPrefix<F> {
    inner: F,
    enabled: bool,
}

impl<S, N, F> FormatEvent<S, N> for JournalPrefix<F>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    N: for<'a> FormatFields<'a> + 'static,
    F: FormatEvent<S, N>,
{
    fn format_event(
        &self,
        ctx: &FmtContext<'_, S, N>,
        mut writer: Writer<'_>,
        event: &Event<'_>,
    ) -> std::fmt::Result {
        if self.enabled {
            let p = match *event.metadata().level() {
                Level::ERROR => 3,
                Level::WARN => 4,
                Level::INFO => 6,
                Level::DEBUG | Level::TRACE => 7,
            };
            write!(writer, "<{p}>")?;
        }
        self.inner.format_event(ctx, writer, event)
    }
}

/// Install the global subscriber. Safe to call once per process.
pub fn init(level: LogLevel) -> LogControl {
    let (layer, handle) = reload::Layer::new(filter(level));
    let journal = std::env::var_os("JOURNAL_STREAM").is_some();
    let ansi = std::io::stdout().is_terminal();
    let fmt_layer = if journal {
        fmt::layer()
            .with_ansi(false)
            .event_format(JournalPrefix {
                inner: fmt::format().without_time().with_target(false),
                enabled: true,
            })
            .boxed()
    } else {
        fmt::layer()
            .with_ansi(ansi)
            .event_format(JournalPrefix {
                inner: fmt::format().with_target(false),
                enabled: false,
            })
            .boxed()
    };
    let _ = tracing_subscriber::registry()
        .with(layer)
        .with(fmt_layer)
        .try_init();
    LogControl { handle }
}

use tracing_subscriber::Layer as _;
