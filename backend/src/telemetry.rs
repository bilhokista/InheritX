use axum::{
    extract::Request,
    http::{HeaderName, HeaderValue},
    middleware::Next,
    response::Response,
};
use tracing::Instrument;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

/// Output format for console log lines.
///
/// Controlled by the `LOG_FORMAT` environment variable:
/// - `"json"`    – machine-readable JSON (default; ideal for log aggregators)
/// - `"pretty"`  – colourised, human-friendly multi-line output (local dev)
/// - `"compact"` – single-line human-readable without ANSI colours
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LogFormat {
    #[default]
    Json,
    Pretty,
    Compact,
}

impl LogFormat {
    /// Parse from the `LOG_FORMAT` environment variable.
    /// Falls back to [`LogFormat::Json`] for any unrecognised value.
    pub fn from_env() -> Self {
        match std::env::var("LOG_FORMAT")
            .unwrap_or_default()
            .to_lowercase()
            .as_str()
        {
            "pretty" => Self::Pretty,
            "compact" => Self::Compact,
            _ => Self::Json,
        }
    }
}

/// Initialise the global `tracing` subscriber.
///
/// The log level is controlled by `RUST_LOG` (defaults to `inheritx_backend=info,info`).
/// The output format is controlled by `LOG_FORMAT` (defaults to `json`).
pub fn init_tracing() -> Result<(), anyhow::Error> {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "inheritx_backend=info,info".into());

    let format = LogFormat::from_env();

    match format {
        LogFormat::Json => {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(tracing_subscriber::fmt::layer().json())
                .init();
        }
        LogFormat::Pretty => {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(tracing_subscriber::fmt::layer().pretty())
                .init();
        }
        LogFormat::Compact => {
            tracing_subscriber::registry()
                .with(env_filter)
                .with(tracing_subscriber::fmt::layer().compact())
                .init();
        }
    }

    Ok(())
}

// ── Request correlation ────────────────────────────────────────────────────

/// Header carrying the correlation id, in and out.
pub const REQUEST_ID_HEADER: &str = "x-request-id";

/// Longest inbound id we will adopt.
///
/// An id arrives from the caller, so it is untrusted input that ends up in
/// every log line for the request. A cap keeps a hostile client from bloating
/// the logs one request at a time.
const MAX_REQUEST_ID_LEN: usize = 128;

/// Whether an inbound `x-request-id` is safe to adopt as our own.
///
/// Restricted to ASCII alphanumerics, `-` and `_`. This is not cosmetic: an id
/// is interpolated into log output, and permitting whitespace or control
/// characters would let a caller inject newlines and forge log entries. Values
/// that fail are replaced with a generated id rather than rejected outright —
/// a malformed header is not a reason to fail an otherwise valid request.
pub fn is_valid_request_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_REQUEST_ID_LEN
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The id to use for a request: the caller's if usable, otherwise a fresh one.
///
/// Reusing a valid inbound id is the point of the header — it is what lets a
/// single trace be followed across the proxy, this service and anything it
/// calls. Generating one unconditionally would produce ids that correlate with
/// nothing upstream.
pub fn resolve_request_id(incoming: Option<&str>) -> String {
    match incoming {
        Some(value) if is_valid_request_id(value) => value.to_string(),
        _ => Uuid::new_v4().to_string(),
    }
}

/// Attaches a correlation id to every log line emitted while handling a request.
///
/// The id is put on a span that wraps the whole handler, so it appears on all
/// nested events without any of them naming it, and is echoed back on the
/// response so a client can quote it in a bug report.
pub async fn request_id_middleware(mut request: Request, next: Next) -> Response {
    let incoming = request
        .headers()
        .get(REQUEST_ID_HEADER)
        .and_then(|v| v.to_str().ok());

    let request_id = resolve_request_id(incoming);

    // Put it back on the request so handlers and anything downstream that
    // forwards headers propagate the same id rather than starting a new trace.
    if let Ok(header_value) = HeaderValue::from_str(&request_id) {
        request
            .headers_mut()
            .insert(HeaderName::from_static(REQUEST_ID_HEADER), header_value);
    }

    let span = tracing::info_span!(
        "http_request",
        request_id = %request_id,
        method = %request.method(),
        path = %request.uri().path(),
    );

    let mut response = next.run(request).instrument(span).await;

    // `is_valid_request_id` already excludes anything illegal in a header
    // value, so this cannot realistically fail; it is checked rather than
    // unwrapped so a future change to the charset cannot panic in a handler.
    if let Ok(header_value) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static(REQUEST_ID_HEADER), header_value);
    }

    response
}

#[cfg(test)]
mod request_id_tests {
    use super::*;

    #[test]
    fn accepts_a_well_formed_inbound_id() {
        assert!(is_valid_request_id("abc123"));
        assert!(is_valid_request_id("7f3a9c2e-1b4d-4e8f-9a0c-2d5e6f7a8b9c"));
        assert!(is_valid_request_id("trace_id-42"));
    }

    #[test]
    fn rejects_ids_that_could_forge_log_lines() {
        // The id lands in log output, so a newline would let a caller write
        // what looks like a separate log entry.
        assert!(!is_valid_request_id("abc\ndef"));
        assert!(!is_valid_request_id("abc\rdef"));
        assert!(!is_valid_request_id("abc def"));
        assert!(!is_valid_request_id("abc\t"));
        assert!(!is_valid_request_id("abc\0def"));
    }

    #[test]
    fn rejects_empty_and_oversized_ids() {
        assert!(!is_valid_request_id(""));
        assert!(is_valid_request_id(&"a".repeat(MAX_REQUEST_ID_LEN)));
        assert!(!is_valid_request_id(&"a".repeat(MAX_REQUEST_ID_LEN + 1)));
    }

    #[test]
    fn rejects_non_ascii_and_punctuation() {
        assert!(!is_valid_request_id("café"));
        assert!(!is_valid_request_id("id/with/slashes"));
        assert!(!is_valid_request_id("id;drop"));
    }

    #[test]
    fn reuses_a_valid_inbound_id_so_traces_join_up() {
        assert_eq!(resolve_request_id(Some("upstream-123")), "upstream-123");
    }

    #[test]
    fn generates_an_id_when_none_is_usable() {
        for incoming in [None, Some(""), Some("bad id"), Some("a\nb")] {
            let id = resolve_request_id(incoming);
            assert!(
                is_valid_request_id(&id),
                "generated id {id:?} should itself be valid"
            );
            assert_ne!(Some(id.as_str()), incoming);
        }
    }

    #[test]
    fn generated_ids_are_unique() {
        assert_ne!(resolve_request_id(None), resolve_request_id(None));
    }
}
