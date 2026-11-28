use super::{
    AppError, Client, Mode, Resource, Response, StatusCode, Url, Value, error, read_error, send,
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{fs, io::Write, path::PathBuf, time::Duration};
use tauri::async_runtime;

const MAX_REFERENCE_BYTES: usize = 8 * 1024 * 1024;
const MAX_MEDIA_BYTES: u64 = 256 * 1024 * 1024;

pub(super) fn validate_reference(data_url: &str) -> Result<(), AppError> {
    let invalid = || {
        error(
            "invalid_creative_reference",
            "请选择 PNG、JPEG 或 WebP 参考图，文件头须与格式一致。",
            false,
        )
    };
    let too_large = || {
        error(
            "creative_reference_too_large",
            "单张参考图不能超过 8 MiB。",
            false,
        )
    };
    const MAX_BASE64: usize = MAX_REFERENCE_BYTES.div_ceil(3) * 4;
    if data_url.len() > MAX_BASE64 + "data:image/webp;base64,".len() {
        return Err(too_large());
    }
    let (header, payload) = data_url.split_once(',').ok_or_else(invalid)?;
    if !matches!(
        header,
        "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
    ) {
        return Err(invalid());
    }
    if payload.len() > MAX_BASE64 {
        return Err(too_large());
    }
    let bytes = STANDARD.decode(payload).map_err(|_| invalid())?;
    if bytes.len() > MAX_REFERENCE_BYTES {
        return Err(too_large());
    }
    let matches_header = match header {
        "data:image/png;base64" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "data:image/jpeg;base64" => bytes.starts_with(b"\xff\xd8\xff"),
        _ => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
    };
    if !matches_header {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn result_url(base: &Url, mode: Mode, value: &Value) -> Option<Url> {
    let name = if let Some(filename) = value
        .get("filename")
        .or_else(|| value.pointer("/result/filename"))
    {
        filename.as_str()?
    } else {
        let url = ["/url", "/result/url", "/video/url", "/data/0/url"]
            .iter()
            .find_map(|key| value.pointer(key)?.as_str())?;
        // Match the raw path, before URL parsing can normalize dot segments or backslashes.
        url.strip_prefix(base.as_str())
            .or_else(|| url.strip_prefix('/'))
            .unwrap_or(url)
            .strip_prefix("v1/media/")?
    };
    if name.len() > 255
        || name.starts_with('.')
        || name.contains("..")
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
    {
        return None;
    }
    let (stem, ext) = name.rsplit_once('.')?;
    let device = stem.split('.').next()?.to_ascii_uppercase();
    if matches!(
        device.as_bytes(),
        b"CON"
            | b"PRN"
            | b"AUX"
            | b"NUL"
            | [b'C', b'O', b'M', b'0'..=b'9']
            | [b'L', b'P', b'T', b'0'..=b'9']
    ) {
        return None;
    }
    match (mode, ext.to_ascii_lowercase().as_str()) {
        (Mode::Image, "png" | "jpg" | "jpeg" | "webp" | "gif")
        | (Mode::Video, "mp4" | "webm" | "mov") => base.join(&format!("v1/media/{name}")).ok(),
        _ => None,
    }
}

pub(super) async fn download(
    client: &Client,
    url: Url,
    downloads: PathBuf,
) -> Result<String, AppError> {
    let (_, extension) = url
        .path()
        .rsplit_once('.')
        .ok_or_else(|| error("creative_invalid_media", "媒体文件缺少扩展名。", false))?;
    let name = format!(
        "Muse-{}.{}",
        uuid::Uuid::new_v4(),
        extension.to_ascii_lowercase()
    );
    // This endpoint is unauthenticated. Never forward the API bearer or use Content-Disposition.
    let response = send(
        client.get(url).timeout(Duration::from_secs(120)),
        Resource::Media,
    )
    .await?;
    if response.status() != StatusCode::OK
        || response
            .headers()
            .contains_key(reqwest::header::CONTENT_RANGE)
    {
        return Err(error(
            "creative_incomplete_media",
            "Muse2API 未返回完整的媒体文件。",
            true,
        ));
    }
    async_runtime::spawn_blocking(move || {
        write_download(response, downloads, name, MAX_MEDIA_BYTES)
    })
    .await
    .map_err(|_| file_error())?
}

fn file_error() -> AppError {
    error(
        "creative_save_failed",
        "无法在系统下载目录保存文件，请检查空间和写入权限。",
        true,
    )
}

// Keep disk I/O on one blocking worker; pull the next network chunk only after its predecessor was written.
pub(super) fn write_download(
    mut response: Response,
    directory: PathBuf,
    name: String,
    limit: u64,
) -> Result<String, AppError> {
    let too_large = || {
        error(
            "creative_media_too_large",
            "媒体文件超过 256 MiB，未保存。",
            false,
        )
    };
    let expected = response.content_length();
    if expected.is_some_and(|size| size > limit) {
        return Err(too_large());
    }
    fs::create_dir_all(&directory).map_err(|_| file_error())?;
    let path = directory.join(&name);
    let mut file = fs::File::create_new(&path).map_err(|_| file_error())?;
    let result = (|| {
        let runtime = async_runtime::handle();
        let mut written = 0;
        while let Some(chunk) = runtime.block_on(response.chunk()).map_err(read_error)? {
            if chunk.len() as u64 > limit - written {
                return Err(too_large());
            }
            file.write_all(&chunk).map_err(|_| file_error())?;
            written += chunk.len() as u64;
        }
        if written == 0 || expected.is_some_and(|n| n != written) {
            return Err(error(
                "creative_incomplete_media",
                "媒体文件为空或传输不完整，未保存。",
                true,
            ));
        }
        file.sync_all().map_err(|_| file_error())
    })();
    drop(file);
    if let Err(cause) = result {
        fs::remove_file(path).map_err(|_| {
            error(
                "creative_cleanup_failed",
                "保存失败，下载目录中的不完整文件未能移除。",
                false,
            )
        })?;
        return Err(cause);
    }
    Ok(name)
}
