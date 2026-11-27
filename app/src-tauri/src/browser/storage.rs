//! Stores metadata only. No URLs, tabs, cookies, tokens or page titles are persisted here.
use super::{
    logic,
    model::{Account, AppError, Settings},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MAX_METADATA_BYTES: usize = 1_048_576;
const MAX_SETTINGS_BYTES: usize = 65_536;
const STAGED_PREFIX: &str = "pending-profile-delete-";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    version: u32,
    accounts: Vec<Account>,
}

pub(super) fn acquire_instance_lock(root: &Path) -> Result<fs::File, AppError> {
    ensure_directory(root)?;
    let path = root.join("instance.lock");
    reject_reparse(&path)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)
        .map_err(|_| AppError::storage())?;
    file.try_lock().map_err(|_| {
        AppError::new(
            "instance_already_running",
            "同一资料目录的工作台已经运行，请切回已有窗口",
        )
    })?;
    Ok(file)
}

pub(super) fn load(root: &Path) -> Result<Vec<Account>, AppError> {
    ensure_directory(root)?;
    let path = root.join("accounts.json");
    reject_reparse(&path)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(AppError::storage()),
    };
    let mut bytes = Vec::new();
    file.take((MAX_METADATA_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::storage())?;
    let data: Metadata = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
    if bytes.len() > MAX_METADATA_BYTES || data.version != 1 || !valid_accounts(&data.accounts) {
        return Err(corrupt());
    }
    Ok(data.accounts)
}

fn valid_accounts(accounts: &[Account]) -> bool {
    let mut ids = HashSet::new();
    accounts.len() <= 1000
        && accounts.iter().all(|a| {
            logic::canonical_id(&a.id)
                && ids.insert(a.id.as_str())
                && logic::account_name(&a.name).as_ref() == Ok(&a.name)
                && logic::account_note(&a.note).as_ref() == Ok(&a.note)
                && a.last_used_at <= 9_007_199_254_740_991
        })
}

pub(super) fn stage_profile_for_deletion(
    root: &Path,
    account: &str,
) -> Result<Option<PathBuf>, AppError> {
    validate_account(account)?;
    ensure_directory(root)?;
    if !load(root)?.iter().any(|saved| saved.id == account) {
        return Err(AppError::new(
            "account_not_found",
            "账号元数据不存在；未暂存资料",
        ));
    }
    let profiles = root.join("profiles");
    if !optional_directory(&profiles)? {
        return Ok(None);
    }
    if has_pending(root, account)? {
        return Err(pending_error());
    }
    let profile = profiles.join(account);
    if !optional_directory(&profile)? {
        return Ok(None);
    }
    let staged = root.join(staged_name(account, &Uuid::new_v4().to_string()));
    reject_reparse(&staged)?;
    fs::rename(profile, &staged).map_err(|_| AppError::storage())?;
    Ok(Some(staged))
}

pub(super) fn restore_staged_profile(
    root: &Path,
    account: &str,
    staged: &Path,
) -> Result<(), AppError> {
    validate_account(account)?;
    let staged_account = validate_staged(root, staged)?;
    if staged_account != account {
        return Err(AppError::storage());
    }
    let profiles = root.join("profiles");
    ensure_directory(&profiles)?;
    reject_reparse(&profiles)?;
    let profile = profiles.join(account);
    if exists_nofollow(&profile)? {
        return Err(AppError::new(
            "profile_restore_conflict",
            "原账号资料目录已存在；暂存资料未覆盖",
        ));
    }
    fs::rename(staged, profile).map_err(|_| AppError::storage())
}

pub(super) fn retry_all_staged_profile_deletions(root: &Path) -> Result<(), AppError> {
    if !exists_nofollow(&root.join("accounts.json"))? {
        return Err(corrupt());
    }
    let accounts = load(root)?;
    let registered = accounts
        .iter()
        .map(|account| account.id.as_str())
        .collect::<HashSet<_>>();
    let entries = fs::read_dir(root).map_err(|_| AppError::storage())?;
    let mut pending = HashSet::new();
    for entry in entries {
        let entry = entry.map_err(|_| AppError::storage())?;
        if !entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(STAGED_PREFIX))
        {
            continue;
        }
        let account = validate_staged(root, &entry.path())?;
        if !registered.contains(account.as_str()) {
            pending.insert(account);
        }
    }
    if pending.is_empty() {
        return Err(AppError::new(
            "profile_cleanup_not_found",
            "没有可重试的账号资料清理任务",
        ));
    }
    for account in pending {
        retry_staged_profile_deletion(root, &account)?;
    }
    Ok(())
}

/// Retries only a previously staged profile whose UUID is absent from committed metadata.
pub(super) fn retry_staged_profile_deletion(root: &Path, account: &str) -> Result<(), AppError> {
    validate_account(account)?;
    if !exists_nofollow(&root.join("accounts.json"))? {
        return Err(corrupt());
    }
    let saved = load(root)?;
    if saved
        .iter()
        .any(|saved_account| saved_account.id == account)
    {
        return Err(AppError::new(
            "account_still_registered",
            "账号仍在本机列表中；拒绝清理其浏览资料",
        ));
    }
    let entries = fs::read_dir(root).map_err(|_| AppError::storage())?;
    let prefix = format!("{STAGED_PREFIX}{account}-");
    let mut found = false;
    for entry in entries {
        let entry = entry.map_err(|_| AppError::storage())?;
        if !entry
            .file_name()
            .to_str()
            .is_some_and(|name| name.starts_with(&prefix))
        {
            continue;
        }
        let path = entry.path();
        if validate_staged(root, &path)? != account {
            return Err(AppError::storage());
        }
        found = true;
        finish_staged_profile_deletion(&path)?;
    }
    if found {
        Ok(())
    } else {
        Err(AppError::new(
            "profile_cleanup_not_found",
            "没有待重试的账号资料清理任务",
        ))
    }
}

pub(super) fn finish_staged_profile_deletion(staged: &Path) -> Result<(), AppError> {
    let root = staged.parent().ok_or_else(AppError::storage)?;
    validate_staged(root, staged)?;
    let metadata = fs::symlink_metadata(staged).map_err(|_| AppError::storage())?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err(AppError::storage());
    }
    fs::remove_dir_all(staged).map_err(|_| AppError::storage())
}

/// Returns the count of staged entries that could not safely be resolved.
pub(super) fn recover_pending_profile_deletions(root: &Path, accounts: &[Account]) -> usize {
    if ensure_directory(root).is_err() {
        return 1;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return 1;
    };
    let staged = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|s| s.starts_with(STAGED_PREFIX))
        })
        .collect::<Vec<_>>();
    if staged.is_empty() {
        return 0;
    }
    // No valid on-disk account record means no staged deletion is proven committed.
    if !exists_nofollow(&root.join("accounts.json")).unwrap_or(false) {
        return staged.len().max(1);
    }
    let Ok(saved) = load(root) else {
        return staged.len().max(1);
    };
    if !valid_accounts(accounts)
        || saved.len() != accounts.len()
        || saved.iter().any(|s| {
            !accounts.iter().any(|a| {
                a.id == s.id
                    && a.name == s.name
                    && a.note == s.note
                    && a.last_used_at == s.last_used_at
            })
        })
    {
        return staged.len().max(1);
    }
    let active = saved.iter().map(|a| a.id.as_str()).collect::<HashSet<_>>();
    let mut failures = 0;
    for entry in staged {
        let path = entry.path();
        let account = match validate_staged(root, &path) {
            Ok(id) => id,
            Err(_) => {
                failures += 1;
                continue;
            }
        };
        let result = if active.contains(account.as_str()) {
            restore_staged_profile(root, &account, &path)
        } else {
            finish_staged_profile_deletion(&path)
        };
        if result.is_err() {
            failures += 1;
        }
    }
    failures
}

pub(super) fn load_settings(root: &Path) -> Result<Settings, AppError> {
    ensure_directory(root)?;
    let path = root.join("settings.json");
    reject_reparse(&path)?;
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Settings::default()),
        Err(_) => return Err(AppError::storage()),
    };
    let mut bytes = Vec::new();
    file.take((MAX_SETTINGS_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::storage())?;
    if bytes.len() > MAX_SETTINGS_BYTES {
        return Err(settings_invalid("设置文件过大；已保留原文件"));
    }
    let settings: Settings = serde_json::from_slice(&bytes)
        .map_err(|_| settings_invalid("设置文件格式无效；已保留原文件"))?;
    if !logic::valid_settings(&settings) {
        return Err(settings_invalid("设置值无效；已保留原文件"));
    }
    Ok(settings)
}

pub(super) fn save_settings(root: &Path, settings: &Settings) -> Result<(), AppError> {
    if !logic::valid_settings(settings) {
        return Err(AppError::new("invalid_settings", "设置值无效，未保存"));
    }
    if exists_nofollow(&root.join("settings.json"))? {
        load_settings(root)?;
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|_| AppError::storage())?;
    save_atomic(root, "settings.json", &bytes)
}

pub(super) fn save(root: &Path, accounts: &[Account]) -> Result<(), AppError> {
    if exists_nofollow(&root.join("accounts.json"))? {
        load(root)?;
    }
    if !valid_accounts(accounts) {
        return Err(corrupt());
    }
    let bytes = serde_json::to_vec_pretty(&Metadata {
        version: 1,
        accounts: accounts.to_vec(),
    })
    .map_err(|_| AppError::storage())?;
    if bytes.len() > MAX_METADATA_BYTES {
        return Err(AppError::new("metadata_limit", "账号元数据超过 M0 限额"));
    }
    save_atomic(root, "accounts.json", &bytes)
}

fn save_atomic(root: &Path, name: &str, bytes: &[u8]) -> Result<(), AppError> {
    ensure_directory(root)?;
    let target = root.join(name);
    reject_reparse(&target)?;
    let temporary = root.join(format!("{name}-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, &target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result.map_err(|_| AppError::storage())
}

pub(super) fn profile(root: &Path, account: &str) -> Result<PathBuf, AppError> {
    validate_account(account)?;
    ensure_directory(root)?;
    if has_pending(root, account)? {
        return Err(pending_error());
    }
    let profiles = root.join("profiles");
    ensure_directory(&profiles)?;
    reject_reparse(&profiles)?;
    let directory = profiles.join(account);
    if exists_nofollow(&directory)? {
        ensure_directory(&directory)?;
        reject_reparse(&directory)?;
    } else {
        fs::create_dir(&directory).map_err(|_| AppError::storage())?;
    }
    Ok(directory)
}

fn validate_account(id: &str) -> Result<(), AppError> {
    if logic::canonical_id(id) {
        Ok(())
    } else {
        Err(AppError::new("invalid_account_id", "账号 ID 非法"))
    }
}
fn staged_name(account: &str, nonce: &str) -> String {
    format!("{STAGED_PREFIX}{account}-{nonce}")
}
fn validate_staged(root: &Path, staged: &Path) -> Result<String, AppError> {
    ensure_directory(root)?;
    let name = staged
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(AppError::storage)?;
    let tail = name
        .strip_prefix(STAGED_PREFIX)
        .ok_or_else(AppError::storage)?;
    let account = tail.get(..36).ok_or_else(AppError::storage)?;
    let separator = tail.get(36..37).ok_or_else(AppError::storage)?;
    let nonce = tail.get(37..).ok_or_else(AppError::storage)?;
    let parsed = Uuid::parse_str(nonce).map_err(|_| AppError::storage())?;
    if !logic::canonical_id(account)
        || separator != "-"
        || parsed.to_string() != nonce
        || name != staged_name(account, nonce)
        || staged.parent() != Some(root)
    {
        return Err(AppError::storage());
    }
    let metadata = fs::symlink_metadata(staged).map_err(|_| AppError::storage())?;
    if !metadata.is_dir() || is_reparse(&metadata) {
        return Err(AppError::storage());
    }
    Ok(account.to_owned())
}
fn has_pending(root: &Path, account: &str) -> Result<bool, AppError> {
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(AppError::storage()),
    };
    let prefix = format!("{STAGED_PREFIX}{account}-");
    for entry in entries {
        let entry = entry.map_err(|_| AppError::storage())?;
        if entry
            .file_name()
            .to_str()
            .is_some_and(|s| s.starts_with(&prefix))
        {
            return Ok(true);
        }
    }
    Ok(false)
}
fn optional_directory(path: &Path) -> Result<bool, AppError> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() && !is_reparse(&m) => Ok(true),
        Ok(_) => Err(AppError::storage()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(AppError::storage()),
    }
}
fn ensure_directory(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() && !is_reparse(&m) => Ok(()),
        Ok(_) => Err(AppError::storage()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path).map_err(|_| AppError::storage())?;
            let m = fs::symlink_metadata(path).map_err(|_| AppError::storage())?;
            if m.is_dir() && !is_reparse(&m) {
                Ok(())
            } else {
                Err(AppError::storage())
            }
        }
        Err(_) => Err(AppError::storage()),
    }
}
fn exists_nofollow(path: &Path) -> Result<bool, AppError> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(AppError::storage()),
    }
}
fn reject_reparse(path: &Path) -> Result<(), AppError> {
    if exists_nofollow(path)? {
        let m = fs::symlink_metadata(path).map_err(|_| AppError::storage())?;
        if is_reparse(&m) {
            return Err(AppError::storage());
        }
    }
    Ok(())
}
#[cfg(windows)]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}
fn pending_error() -> AppError {
    AppError::new(
        "profile_cleanup_pending",
        "账号资料删除或恢复仍待处理；资料已保留，请重试",
    )
}
fn corrupt() -> AppError {
    AppError::new(
        "metadata_invalid",
        "账号元数据损坏或版本不支持；已保留原文件，未重置浏览资料",
    )
}
fn settings_invalid(message: &'static str) -> AppError {
    AppError::new("settings_invalid", message)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_and_profile_deletion_recover_by_committed_metadata() {
        let root = std::env::temp_dir().join(format!("muse-storage-{}", Uuid::new_v4()));
        let account = Account {
            id: Uuid::new_v4().to_string(),
            name: "测试".into(),
            note: String::new(),
            last_used_at: 0,
        };
        save(&root, std::slice::from_ref(&account)).unwrap();
        let profile_path = profile(&root, &account.id).unwrap();
        fs::write(profile_path.join("synthetic"), b"only").unwrap();
        stage_profile_for_deletion(&root, &account.id)
            .unwrap()
            .unwrap();
        assert!(profile(&root, &account.id).is_err());
        assert_eq!(
            recover_pending_profile_deletions(&root, std::slice::from_ref(&account)),
            0
        );
        assert!(profile_path.join("synthetic").exists());
        let staged = stage_profile_for_deletion(&root, &account.id)
            .unwrap()
            .unwrap();
        save(&root, &[]).unwrap();
        assert_eq!(recover_pending_profile_deletions(&root, &[]), 0);
        assert!(!staged.exists());
        let _ = staged;
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cleanup_retry_requires_committed_metadata_and_skips_registered_profiles() {
        let root = std::env::temp_dir().join(format!("muse-cleanup-{}", Uuid::new_v4()));
        let account = Account {
            id: Uuid::new_v4().to_string(),
            name: "测试".into(),
            note: String::new(),
            last_used_at: 0,
        };
        let staged = root.join(staged_name(&account.id, &Uuid::new_v4().to_string()));
        fs::create_dir_all(&staged).unwrap();
        assert!(retry_all_staged_profile_deletions(&root).is_err());
        assert!(staged.exists());
        save(&root, std::slice::from_ref(&account)).unwrap();
        assert!(retry_all_staged_profile_deletions(&root).is_err());
        assert!(staged.exists());
        save(&root, &[]).unwrap();
        retry_all_staged_profile_deletions(&root).unwrap();
        assert!(!staged.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn malformed_settings_are_not_overwritten() {
        let root = std::env::temp_dir().join(format!("muse-settings-{}", Uuid::new_v4()));
        ensure_directory(&root).unwrap();
        let original = b"invalid";
        fs::write(root.join("settings.json"), original).unwrap();
        assert!(save_settings(&root, &Settings::default()).is_err());
        assert_eq!(fs::read(root.join("settings.json")).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }
}
