//! For tests that read what the crate's own log lines print.

use std::cell::RefCell;
use std::io;
use std::sync::{Arc, Mutex, Once};
use tracing::subscriber::Interest;
use tracing_subscriber::filter::DynFilterFn;
use tracing_subscriber::prelude::*;

thread_local! {
    /// Where the lines logged on this thread go, while a test on it captures them.
    static CAPTURING: RefCell<Option<CapturedLogs>> = const { RefCell::new(None) };
}

/// Every line this crate logs on the current thread, at every level, while the guard that
/// `start` returns lives. A `#[tokio::test]` runs its tasks on its own thread, so the lines of
/// the tasks it spawns are captured too.
#[derive(Clone, Default)]
pub(crate) struct CapturedLogs(Arc<Mutex<Vec<u8>>>);

/// Ends the capture of the current thread's lines when dropped.
pub(crate) struct Capturing(());

impl Drop for Capturing {
    fn drop(&mut self) {
        CAPTURING.with(|capturing| capturing.borrow_mut().take());
    }
}

impl CapturedLogs {
    pub(crate) fn start() -> (Self, Capturing) {
        static ROUTE_LINES_TO_CAPTURES: Once = Once::new();
        ROUTE_LINES_TO_CAPTURES.call_once(|| {
            // One subscriber for the whole test binary, set once. A subscriber set per test
            // registers a dispatcher each time, and a line first logged on another thread at
            // that moment can keep the interest it had before and never reach the capture.
            // Interest is `sometimes`, so that each line asks whether its own thread captures,
            // and the filter is the whole subscriber's, so that a thread that does not formats
            // none of the line's arguments.
            let captured_lines = DynFilterFn::new(|metadata, _| {
                metadata.target().starts_with("domcorder_server")
                    && CAPTURING.with(|capturing| capturing.borrow().is_some())
            })
            .with_callsite_filter(|_| Interest::sometimes());
            let subscriber = tracing_subscriber::registry().with(captured_lines).with(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_writer(|| {
                        CAPTURING
                            .with(|capturing| capturing.borrow().clone())
                            .expect("only the lines of a capturing thread are written")
                    }),
            );
            tracing::subscriber::set_global_default(subscriber)
                .expect("no other subscriber is the test binary's global default");
        });
        let logs = Self::default();
        CAPTURING.with(|capturing| *capturing.borrow_mut() = Some(logs.clone()));
        // A line first logged on another thread while the subscriber was being set may have
        // kept the interest it had before it
        tracing::callsite::rebuild_interest_cache();
        (logs, Capturing(()))
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
    }

    pub(crate) fn assert_shows(&self, part: &str) {
        let text = self.text();
        assert!(text.contains(part), "no line shows {part}:\n{text}");
    }

    pub(crate) fn assert_never_shows(&self, part: &str) {
        let text = self.text();
        assert!(!text.contains(part), "a line shows {part}:\n{text}");
    }
}

impl io::Write for CapturedLogs {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
