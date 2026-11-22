// The cancel signal of one AI run. The queue keeps one token per run; the process loop
// (`process.rs`) and the fake runner look at it and stop the run when it is set.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// A shared flag: every clone sees the same state. Once cancelled, it stays cancelled.
#[derive(Clone, Default, Debug)]
pub struct CancelToken(Arc<AtomicBool>);

impl CancelToken {
    /// Asks the run that holds this token to stop.
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }

    /// True once `cancel` was called on this token or any clone of it.
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_token_is_not_cancelled_and_a_clone_sees_the_cancel() {
        let token = CancelToken::default();
        let other = token.clone();
        assert!(!token.is_cancelled());
        other.cancel();
        assert!(token.is_cancelled());
        assert!(!CancelToken::default().is_cancelled());
    }
}
