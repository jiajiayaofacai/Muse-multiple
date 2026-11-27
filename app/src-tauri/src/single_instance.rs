use winsafe::{HEVENT, SysResult, co, guard::CloseHandleGuard};

type Event = CloseHandleGuard<HEVENT>;

pub(super) fn claim(id: &str) -> SysResult<Option<(Event, Event)>> {
    // Local scopes both events to this Windows session. Create the wake event first
    // so a launch during startup can leave a signal before the window is ready.
    let wake = HEVENT::CreateEvent(None, false, false, Some(&format!(r"Local\{id}.wake")))?;
    let owner = HEVENT::CreateEvent(None, false, true, Some(&format!(r"Local\{id}.owner")))?;
    // An auto-reset event starts signalled only on creation. Exactly one caller
    // consumes that signal; keep its handle alive until the owner's process exits.
    if owner.WaitForSingleObject(Some(0))? == co::WAIT::TIMEOUT {
        wake.SetEvent()?;
        return Ok(None);
    }
    Ok(Some((owner, wake)))
}

pub(super) fn listen(wake: Event, app: tauri::AppHandle) -> std::io::Result<()> {
    std::thread::Builder::new()
        .name("workspace-activation".into())
        .spawn(move || {
            loop {
                if let Err(error) = wake.WaitForSingleObject(None) {
                    eprintln!("无法等待工作台唤醒：{error}");
                    break;
                }
                super::restore_window(&app);
            }
        })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_wakes_owner_even_before_listening_and_exit_allows_relaunch() {
        let id = format!("muse-multiple.test.{}", uuid::Uuid::new_v4());
        let (owner, wake) = claim(&id).unwrap().unwrap();
        assert_eq!(
            wake.WaitForSingleObject(Some(0)).unwrap(),
            co::WAIT::TIMEOUT
        );
        assert!(claim(&id).unwrap().is_none());
        assert_eq!(
            wake.WaitForSingleObject(Some(0)).unwrap(),
            co::WAIT::OBJECT_0
        );
        drop((owner, wake));
        assert!(claim(&id).unwrap().is_some());
    }
}
