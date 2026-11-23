//! Stores metadata only. No URLs, tabs, cookies, tokens or page titles are persisted here.
use super::{
    logic,
    model::{Account, AppError},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Metadata {
    version: u32,
    accounts: Vec<Account>,
}

pub(super) fn acquire_instance_lock(root: &Path) -> Result<fs::File, AppError> {
    fs::create_dir_all(root).map_err(|_| AppError::storage())?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("instance.lock"))
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
    fs::create_dir_all(root).map_err(|_| AppError::storage())?;
    let file = match fs::File::open(root.join("accounts.json")) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(_) => return Err(AppError::storage()),
    };
    let mut bytes = Vec::new();
    file.take(1_048_577)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::storage())?;
    let data: Metadata = serde_json::from_slice(&bytes).map_err(|_| corrupt())?;
    if bytes.len() > 1_048_576 || data.version != 1 || data.accounts.len() > 1000 {
        return Err(corrupt());
    }
    let mut ids = HashSet::new();
    for a in &data.accounts {
        if !logic::canonical_id(&a.id)
            || !ids.insert(&a.id)
            || logic::account_name(&a.name).as_ref() != Ok(&a.name)
            || a.note.chars().count() > 2000
            || a.last_used_at > 9_007_199_254_740_991
        {
            return Err(corrupt());
        }
    }
    Ok(data.accounts)
}

fn corrupt() -> AppError {
    AppError::new(
        "metadata_invalid",
        "账号元数据损坏或版本不支持；已保留原文件，未重置浏览资料",
    )
}

pub(super) fn save(root: &Path, accounts: &[Account]) -> Result<(), AppError> {
    let bytes = serde_json::to_vec_pretty(&Metadata {
        version: 1,
        accounts: accounts.to_vec(),
    })
    .map_err(|_| AppError::storage())?;
    if bytes.len() > 1_048_576 {
        return Err(AppError::new("metadata_limit", "账号元数据超过 M0 限额"));
    }
    let temporary = root.join(format!("accounts-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, root.join("accounts.json"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|_: std::io::Error| AppError::storage())
}

pub(super) fn profile(root: &Path, account: &str) -> Result<PathBuf, AppError> {
    if !logic::canonical_id(account) {
        return Err(AppError::new("invalid_account_id", "账号 ID 非法"));
    }
    let directory = root.join("profiles").join(account);
    fs::create_dir_all(&directory).map_err(|_| AppError::storage())?;
    Ok(directory)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn same_data_root_is_exclusive_until_instance_exits() {
        let root = std::env::temp_dir().join(format!("muse-m0-lock-{}", Uuid::new_v4()));
        let first = acquire_instance_lock(&root).unwrap();
        assert!(acquire_instance_lock(&root).is_err());
        drop(first);
        assert!(acquire_instance_lock(&root).is_ok());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn metadata_roundtrip_stable_profiles_and_corruption() {
        // Synthetic metadata only; no WebView or real app data involved.
        let root = std::env::temp_dir().join(format!("muse-m0-test-{}", Uuid::new_v4()));
        let a = Account {
            id: Uuid::new_v4().to_string(),
            name: "测试".into(),
            note: String::new(),
            last_used_at: 1,
        };
        assert!(load(&root).expect("temporary root").is_empty());
        save(&root, std::slice::from_ref(&a)).expect("save synthetic metadata");
        let restored = load(&root).expect("restore synthetic metadata");
        assert_eq!(restored[0].id, a.id);
        let p = profile(&root, &a.id).expect("profile");
        assert_eq!(p, profile(&root, &restored[0].id).expect("same profile"));
        assert!(profile(&root, "../other").is_err());
        save(&root, std::slice::from_ref(&a)).expect("replace existing file on Windows");
        fs::write(root.join("accounts.json"), b"invalid").expect("synthetic corruption");
        assert_eq!(
            load(&root).expect_err("must not silently reset").code,
            "metadata_invalid"
        );
        fs::remove_dir_all(root).expect("remove synthetic test root only");
    }
}
