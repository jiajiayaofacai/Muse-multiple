use crate::{authorize, browser::AppError};
use reqwest::{
    Client, RequestBuilder, Response, StatusCode, Url,
    header::{AUTHORIZATION, HeaderValue},
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Mutex, time::Duration};
use tauri::{Manager, State, Webview};

mod media;
#[cfg(test)]
mod tests;

const MAX_PROMPT_CHARS: usize = 4_000;
const MAX_TASK_RESPONSE_BYTES: usize = 1_048_576;

#[derive(Default)]
pub(super) struct StudioState {
    service: Mutex<Option<Service>>,
}

#[derive(Clone)]
struct Service {
    base_url: Url,
    api_key: HeaderValue,
    client: Client,
}

fn error(code: &'static str, message: &str, retryable: bool) -> AppError {
    AppError {
        code,
        safe_message: message.into(),
        retryable,
    }
}

fn validate_base_url(value: &str) -> Result<Url, AppError> {
    let invalid = || {
        error(
            "invalid_creative_service_url",
            "仅支持不带路径的本机地址，例如 http://127.0.0.1:18610。",
            false,
        )
    };
    let url = Url::parse(value.trim()).map_err(|_| invalid())?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    Ok(url)
}

fn validate_api_key(value: &str) -> Result<HeaderValue, AppError> {
    let invalid = || {
        error(
            "invalid_creative_api_key",
            "请输入有效的 Muse2API API Key。",
            false,
        )
    };
    let value = value.trim();
    if value.is_empty()
        || value.len() > 512
        || !value.is_ascii()
        || value.chars().any(char::is_control)
    {
        return Err(invalid());
    }
    let mut header = HeaderValue::from_str(&format!("Bearer {value}")).map_err(|_| invalid())?;
    header.set_sensitive(true);
    Ok(header)
}

#[derive(Clone, Copy)]
enum Resource {
    Api,
    Task,
    Media,
}

async fn send(request: RequestBuilder, resource: Resource) -> Result<Response, AppError> {
    let response = request.send().await.map_err(|err| {
        if err.is_timeout() {
            error("creative_timeout", "本机 Muse2API 响应超时。", true)
        } else {
            error(
                "creative_service_unavailable",
                "无法联系本机 Muse2API。请确认服务正在运行。",
                true,
            )
        }
    })?;
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    // Upstream detail may contain prompts, credentials or local paths. Never reflect it.
    Err(match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => error(
            "creative_auth_rejected",
            "Muse2API 拒绝访问。请核对 API Key 和服务权限。",
            false,
        ),
        StatusCode::NOT_FOUND => match resource {
            Resource::Task => error(
                "creative_task_not_found",
                "此任务不存在或已被 Muse2API 清理。",
                false,
            ),
            Resource::Media => error(
                "creative_media_not_found",
                "Muse2API 找不到此任务的媒体文件，可能已被清理。",
                false,
            ),
            Resource::Api => error(
                "creative_endpoint_missing",
                "本机服务没有所需的 Muse2API 接口，请核对地址和版本。",
                false,
            ),
        },
        StatusCode::TOO_MANY_REQUESTS => error(
            "creative_queue_full",
            "Muse2API 请求过多或队列已满，请稍后重试。",
            true,
        ),
        s if s.is_redirection() => error(
            "creative_redirect_rejected",
            "本机服务返回了重定向，工作台未跟随。",
            false,
        ),
        s if s.is_server_error() => error(
            "creative_service_error",
            "Muse2API 处理请求失败，请检查服务和账号池状态。",
            true,
        ),
        _ => error(
            "creative_request_rejected",
            "Muse2API 未接受请求，请核对生成参数。",
            false,
        ),
    })
}

fn read_error(_: reqwest::Error) -> AppError {
    error(
        "creative_read_failed",
        "Muse2API 响应读取中断或超时，请稍后重试。",
        true,
    )
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Image,
    Video,
}

impl Mode {
    fn parse(mode: &str) -> Result<Self, AppError> {
        match mode {
            "image" => Ok(Self::Image),
            "video" => Ok(Self::Video),
            _ => Err(error("invalid_creative_task", "任务类型无效。", false)),
        }
    }

    fn endpoint(self) -> &'static str {
        match self {
            Self::Image => "v1/images/tasks",
            Self::Video => "v1/videos",
        }
    }
}

impl Service {
    fn new(base_url: &str, api_key: &str) -> Result<Self, AppError> {
        let base_url = validate_base_url(base_url)?;
        let api_key = validate_api_key(api_key)?;
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(4))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| {
                error(
                    "creative_client_unavailable",
                    "无法初始化本机生成服务连接。",
                    false,
                )
            })?;
        Ok(Self {
            base_url,
            api_key,
            client,
        })
    }

    fn endpoint(&self, path: &str) -> Result<Url, AppError> {
        self.base_url
            .join(path)
            .map_err(|_| error("creative_service_unavailable", "Muse2API 地址无效。", false))
    }

    async fn json(&self, request: RequestBuilder, resource: Resource) -> Result<Value, AppError> {
        let mut response = send(
            request.header(AUTHORIZATION, self.api_key.clone()),
            resource,
        )
        .await?;
        let too_large = || {
            error(
                "creative_response_too_large",
                "Muse2API 返回的 JSON 超过 1 MiB。",
                false,
            )
        };
        if response
            .content_length()
            .is_some_and(|n| n > MAX_TASK_RESPONSE_BYTES as u64)
        {
            return Err(too_large());
        }
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(read_error)? {
            if chunk.len() > MAX_TASK_RESPONSE_BYTES - body.len() {
                return Err(too_large());
            }
            body.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&body).map_err(|_| {
            error(
                "creative_invalid_response",
                "Muse2API 返回了无法识别的 JSON。",
                false,
            )
        })
    }

    async fn check_models(&self) -> Result<(), AppError> {
        let value = self
            .json(self.client.get(self.endpoint("v1/models")?), Resource::Api)
            .await?;
        let invalid = || {
            error(
                "creative_invalid_models",
                "本机服务未返回有效的 Muse2API 模型列表，请核对地址。",
                false,
            )
        };
        let models = value["data"]
            .as_array()
            .filter(|_| value["object"] == "list")
            .ok_or_else(invalid)?;
        if !models.iter().all(|model| {
            model["id"].as_str().is_some_and(|id| !id.is_empty())
                && model.get("object").is_none_or(|kind| kind == "model")
        }) {
            return Err(invalid());
        }
        if !models
            .iter()
            .any(|model| matches!(model["id"].as_str(), Some("muse-image" | "muse-video")))
        {
            return Err(error(
                "creative_models_unavailable",
                "模型列表中没有 muse-image 或 muse-video，请检查服务版本。",
                false,
            ));
        }
        Ok(())
    }

    async fn generate(
        &self,
        mode: Mode,
        prompt: &str,
        option: &str,
        reference_image: Option<String>,
    ) -> Result<CreativeTask, AppError> {
        let prompt = validate_prompt(prompt)?;
        let mut request = self.client.post(self.endpoint(mode.endpoint())?);
        let mut body = match mode {
            Mode::Image => {
                if !matches!(option, "1024x1024" | "1536x1024" | "1024x1536") {
                    return Err(error(
                        "invalid_creative_options",
                        "请选择有效的图片比例。",
                        false,
                    ));
                }
                request = request.header("Idempotency-Key", uuid::Uuid::new_v4().to_string());
                json!({ "prompt": prompt, "size": option, "response_format": "url" })
            }
            Mode::Video => {
                if !matches!(option, "16:9" | "1:1" | "9:16") {
                    return Err(error(
                        "invalid_creative_options",
                        "请选择有效的视频比例。",
                        false,
                    ));
                }
                json!({ "prompt": prompt, "aspect_ratio": option })
            }
        };
        if let Some(image) = reference_image {
            media::validate_reference(&image)?;
            body["reference_image"] = Value::String(image);
        }
        let response = self.json(request.json(&body), Resource::Api).await?;
        self.task_from_response(mode, &response, None)
    }

    async fn get_task(&self, mode: Mode, task_id: &str) -> Result<CreativeTask, AppError> {
        let task_id = validate_task_id(task_id)?;
        let url = self.endpoint(&format!("{}/{task_id}", mode.endpoint()))?;
        let response = self.json(self.client.get(url), Resource::Task).await?;
        self.task_from_response(mode, &response, Some(task_id))
    }

    fn task_from_response(
        &self,
        mode: Mode,
        value: &Value,
        expected_id: Option<&str>,
    ) -> Result<CreativeTask, AppError> {
        let mismatch = || {
            error(
                "creative_task_mismatch",
                "Muse2API 返回的任务编号或类型与请求不符。",
                false,
            )
        };
        let id = value
            .get("id")
            .or_else(|| value.get("task_id"))
            .and_then(Value::as_str)
            .ok_or_else(|| {
                error(
                    "creative_invalid_response",
                    "Muse2API 未返回任务编号。",
                    false,
                )
            })?;
        validate_task_id(id)?;
        let (kind, object) = match mode {
            Mode::Image => ("image", "image.task"),
            Mode::Video => ("video", "video.task"),
        };
        if expected_id.is_some_and(|expected| expected != id)
            || value.get("task_id").is_some_and(|other| other != id)
            || value
                .get("object")
                .is_some_and(|tag| tag != "task" && tag != object)
            || ["/kind", "/mode", "/result/kind", "/data/0/kind"]
                .iter()
                .filter_map(|key| value.pointer(key))
                .any(|tag| tag != kind)
        {
            return Err(mismatch());
        }
        let status = match value["status"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str()
        {
            "queued" | "pending" => "queued",
            "processing" | "running" | "in_progress" => "processing",
            "failed" | "error" | "cancelled" | "canceled" => "failed",
            "completed" | "succeeded" | "success" | "done" => "completed",
            _ => {
                return Err(error(
                    "creative_unknown_task_status",
                    "Muse2API 返回了未知任务状态，已停止查询。",
                    false,
                ));
            }
        };
        let progress = value["progress"]
            .as_f64()
            .unwrap_or(0.0)
            .round()
            .clamp(0.0, 100.0) as u8;
        let media_url = (status == "completed")
            .then(|| media::result_url(&self.base_url, mode, value))
            .flatten();
        Ok(CreativeTask {
            id: id.to_owned(),
            mode,
            status,
            progress,
            media_url,
        })
    }

    async fn save_result(
        &self,
        mode: Mode,
        task_id: &str,
        downloads: PathBuf,
    ) -> Result<String, AppError> {
        let task = self.get_task(mode, task_id).await?;
        if task.status != "completed" {
            return Err(error(
                "creative_task_not_completed",
                "只能保存已完成任务的结果。",
                false,
            ));
        }
        let url = task.media_url.ok_or_else(|| {
            error(
                "creative_invalid_media",
                "任务没有可安全保存的本机媒体文件。",
                false,
            )
        })?;
        media::download(&self.client, url, downloads).await
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ConnectionStatus {
    connected: bool,
    base_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreativeTask {
    id: String,
    mode: Mode,
    status: &'static str,
    progress: u8,
    media_url: Option<Url>,
}

fn lock_service(
    state: &StudioState,
) -> Result<std::sync::MutexGuard<'_, Option<Service>>, AppError> {
    state.service.lock().map_err(|_| {
        error(
            "creative_state_unavailable",
            "创意台连接状态暂不可用，请重新启动工作台。",
            true,
        )
    })
}

fn current_service(state: &StudioState) -> Result<Service, AppError> {
    lock_service(state)?.clone().ok_or_else(|| {
        error(
            "creative_service_not_connected",
            "请先连接本机 Muse2API。",
            false,
        )
    })
}

#[tauri::command]
pub(super) async fn creative_status(
    webview: Webview,
    state: State<'_, StudioState>,
) -> Result<ConnectionStatus, AppError> {
    authorize(&webview)?;
    let service = lock_service(&state)?;
    Ok(ConnectionStatus {
        connected: service.is_some(),
        base_url: service.as_ref().map(|s| s.base_url.to_string()),
    })
}

#[tauri::command]
pub(super) async fn creative_connect(
    webview: Webview,
    state: State<'_, StudioState>,
    base_url: String,
    api_key: String,
) -> Result<ConnectionStatus, AppError> {
    authorize(&webview)?;
    let service = Service::new(&base_url, &api_key)?;
    service.check_models().await?;
    let status = ConnectionStatus {
        connected: true,
        base_url: Some(service.base_url.to_string()),
    };
    *lock_service(&state)? = Some(service);
    Ok(status)
}

#[tauri::command]
pub(super) async fn creative_disconnect(
    webview: Webview,
    state: State<'_, StudioState>,
) -> Result<(), AppError> {
    authorize(&webview)?;
    lock_service(&state)?.take();
    Ok(())
}

#[tauri::command]
pub(super) async fn creative_generate_image(
    webview: Webview,
    state: State<'_, StudioState>,
    prompt: String,
    size: String,
    reference_image: Option<String>,
) -> Result<CreativeTask, AppError> {
    authorize(&webview)?;
    current_service(&state)?
        .generate(Mode::Image, &prompt, &size, reference_image)
        .await
}

#[tauri::command]
pub(super) async fn creative_generate_video(
    webview: Webview,
    state: State<'_, StudioState>,
    prompt: String,
    aspect_ratio: String,
    reference_image: Option<String>,
) -> Result<CreativeTask, AppError> {
    authorize(&webview)?;
    current_service(&state)?
        .generate(Mode::Video, &prompt, &aspect_ratio, reference_image)
        .await
}

#[tauri::command]
pub(super) async fn creative_get_task(
    webview: Webview,
    state: State<'_, StudioState>,
    mode: String,
    task_id: String,
) -> Result<CreativeTask, AppError> {
    authorize(&webview)?;
    current_service(&state)?
        .get_task(Mode::parse(&mode)?, &task_id)
        .await
}

#[tauri::command]
pub(super) async fn creative_save_result(
    webview: Webview,
    state: State<'_, StudioState>,
    app: tauri::AppHandle,
    mode: String,
    task_id: String,
) -> Result<String, AppError> {
    authorize(&webview)?;
    let service = current_service(&state)?;
    let downloads = app.path().download_dir().map_err(|_| {
        error(
            "creative_downloads_unavailable",
            "无法定位系统下载目录。",
            false,
        )
    })?;
    service
        .save_result(Mode::parse(&mode)?, &task_id, downloads)
        .await
}

fn validate_prompt(prompt: &str) -> Result<&str, AppError> {
    let prompt = prompt.trim();
    let length = prompt.chars().count();
    if length == 0
        || length > MAX_PROMPT_CHARS
        || prompt
            .chars()
            .any(|ch| ch.is_control() && !matches!(ch, '\n' | '\r' | '\t'))
    {
        return Err(error(
            "invalid_creative_prompt",
            "请填写提示词（最多 4000 字），并移除不可见控制字符。",
            false,
        ));
    }
    Ok(prompt)
}

fn validate_task_id(task_id: &str) -> Result<&str, AppError> {
    if task_id.is_empty()
        || task_id.len() > 128
        || !task_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_'))
    {
        return Err(error("invalid_creative_task", "任务编号无效。", false));
    }
    Ok(task_id)
}
