// Windows connector callbacks run on the UI thread. Retain rejected tasks until
// the outer event loop returns from native callbacks; do not destroy COM views inline.
use std::cell::{Cell, RefCell};
type Task = Box<dyn FnOnce() + Send>;
thread_local! {
  static PENDING: RefCell<Vec<Task>> = const { RefCell::new(Vec::new()) };
  static DRAINING: Cell<bool> = const { Cell::new(false) };
}

pub(super) fn defer(task: Task) {
  PENDING.with(|tasks| tasks.borrow_mut().push(task));
}

struct DrainGuard;
impl Drop for DrainGuard {
  fn drop(&mut self) {
    DRAINING.with(|active| active.set(false));
  }
}

pub(super) fn drain() {
  if DRAINING.with(|active| active.replace(true)) {
    return;
  }
  let _guard = DrainGuard;
  let tasks = PENDING.with(|tasks| std::mem::take(&mut *tasks.borrow_mut()));
  for task in tasks {
    task();
  }
}

pub(super) fn discard() {
  PENDING.with(|tasks| tasks.borrow_mut().clear());
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::{Arc, Mutex};
  #[test]
  fn tasks_wait_for_drain_and_keep_order() {
    let events = Arc::new(Mutex::new(Vec::new()));
    for n in [1, 2] {
      let events = events.clone();
      defer(Box::new(move || events.lock().unwrap().push(n)));
    }
    assert!(events.lock().unwrap().is_empty());
    drain();
    assert_eq!(*events.lock().unwrap(), vec![1, 2]);
  }
  #[test]
  fn reentrant_drain_does_not_run_nested_work_inside_the_current_task() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let outer = events.clone();
    defer(Box::new(move || {
      outer.lock().unwrap().push(1);
      let inner = outer.clone();
      defer(Box::new(move || inner.lock().unwrap().push(3)));
      drain();
      outer.lock().unwrap().push(2);
    }));
    drain();
    assert_eq!(*events.lock().unwrap(), vec![1, 2]);
    drain();
    assert_eq!(*events.lock().unwrap(), vec![1, 2, 3]);
  }
  #[test]
  fn shutdown_discards_jobs_without_running_them() {
    let events = Arc::new(Mutex::new(Vec::new()));
    let saved = events.clone();
    defer(Box::new(move || saved.lock().unwrap().push(1)));
    discard();
    drain();
    assert!(events.lock().unwrap().is_empty());
  }
}
