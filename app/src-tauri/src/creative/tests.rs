use super::*;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::TcpListener,
    thread,
};
use tauri::async_runtime::block_on;

const PNG: &str = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tm0YAAAAASUVORK5CYII=";

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let path =
            std::env::temp_dir().join(format!("muse-creative-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn is_empty(&self) -> bool {
        self.0.read_dir().unwrap().next().is_none()
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Request {
    headers: String,
    body: Vec<u8>,
}
fn serve(replies: Vec<Vec<u8>>) -> (Service, thread::JoinHandle<Vec<Request>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let worker = thread::spawn(move || {
        replies
            .into_iter()
            .map(|reply| {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(&stream);
                let mut headers = String::new();
                while !headers.ends_with("\r\n\r\n") {
                    assert!(reader.read_line(&mut headers).unwrap() > 0 && headers.len() < 8192);
                }
                let headers = headers.to_ascii_lowercase();
                let size = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .map_or(0, |size| size.parse().unwrap());
                assert!(size < 8192);
                let mut body = vec![0; size];
                reader.read_exact(&mut body).unwrap();
                // A capped client may close the connection before a large reply finishes.
                let _ = stream.write_all(&reply);
                Request { headers, body }
            })
            .collect()
    });
    (Service::new(&base, "unit-test-key").unwrap(), worker)
}

fn response(status: &str, body: &[u8]) -> Vec<u8> {
    let mut bytes = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    bytes.extend_from_slice(body);
    bytes
}
fn json_reply(value: Value) -> Vec<u8> {
    response("200 OK", value.to_string().as_bytes())
}
fn chunked(chunks: &[&[u8]]) -> Vec<u8> {
    let mut out =
        b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n".to_vec();
    for chunk in chunks {
        write!(out, "{:x}\r\n", chunk.len()).unwrap();
        out.extend_from_slice(chunk);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"0\r\n\r\n");
    out
}

#[test]
fn service_address_is_loopback_http_only() {
    assert_eq!(
        validate_base_url(" http://127.0.0.1:18610 ")
            .unwrap()
            .as_str(),
        "http://127.0.0.1:18610/"
    );
    for url in [
        "https://127.0.0.1:18610/",
        "http://localhost:18610/",
        "http://192.168.1.2:18610/",
        "http://127.0.0.1.evil.example:18610/",
        "http://user@127.0.0.1:18610/",
        "http://127.0.0.1:18610/admin",
    ] {
        assert!(validate_base_url(url).is_err(), "accepted {url}");
    }
}

#[test]
fn api_key_and_task_id_reject_header_or_path_injection() {
    assert!(validate_api_key("key-1").is_ok());
    assert!(validate_api_key("bad\r\nheader").is_err());
    assert!(validate_task_id("task-abc_123").is_ok());
    assert!(validate_task_id("../other-task").is_err());
}

#[test]
fn models_check_requires_a_supported_model_and_does_not_echo_server_details() {
    let (service, server) = serve(vec![
        json_reply(json!({"object":"list","data":[{"id":"muse-image","object":"model"}]})),
        json_reply(json!({"object":"list","data":[{"id":"muse-video"}]})),
        json_reply(json!({"data":[{"id":"muse-video"}]})),
        json_reply(json!({"object":"list","data":[{"id":"muse-image","object":"task"}]})),
        json_reply(json!({"object":"list","data":[{"id":"muse-spark"}]})),
        response("401 Unauthorized", b"private-upstream-detail"),
    ]);
    for _ in 0..2 {
        block_on(service.check_models()).unwrap();
    }
    for code in [
        "creative_invalid_models",
        "creative_invalid_models",
        "creative_models_unavailable",
        "creative_auth_rejected",
    ] {
        let err = block_on(service.check_models()).unwrap_err();
        assert_eq!(err.code, code);
        assert!(!err.safe_message.contains("private-upstream-detail"));
        assert!(!err.safe_message.contains("unit-test-key"));
    }
    for request in server.join().unwrap() {
        assert!(request.headers.starts_with("get /v1/models http/1.1"));
        assert!(
            request
                .headers
                .contains("authorization: bearer unit-test-key\r\n")
        );
    }
}

#[test]
fn api_redirect_is_rejected_without_contacting_location() {
    let target = TcpListener::bind("127.0.0.1:0").unwrap();
    target.set_nonblocking(true).unwrap();
    let reply = format!(
        "HTTP/1.1 302 Found\r\nLocation: http://{}/elsewhere\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        target.local_addr().unwrap()
    );
    let (service, server) = serve(vec![reply.into_bytes()]);
    assert_eq!(
        block_on(service.check_models()).unwrap_err().code,
        "creative_redirect_rejected"
    );
    assert_eq!(
        target.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert_eq!(server.join().unwrap().len(), 1);
}

#[test]
fn json_limit_applies_to_chunked_bodies_without_content_length() {
    let full = vec![b' '; MAX_TASK_RESPONSE_BYTES];
    let (service, server) = serve(vec![chunked(&[&full, b"!"])]);
    assert_eq!(
        block_on(service.check_models()).unwrap_err().code,
        "creative_response_too_large"
    );
    server.join().unwrap();
}

#[test]
fn reference_requires_standard_base64_matching_magic_and_decoded_size() {
    media::validate_reference(PNG).unwrap();
    media::validate_reference(&format!(
        "data:image/jpeg;base64,{}",
        STANDARD.encode(b"\xff\xd8\xff\xe0")
    ))
    .unwrap();
    media::validate_reference(&format!(
        "data:image/webp;base64,{}",
        STANDARD.encode(b"RIFF\x04\0\0\0WEBP")
    ))
    .unwrap();
    for value in [
        "http://127.0.0.1/image.png",
        r"C:\image.jpg",
        "data:image/png;base64,",
        "data:image/png;base64,_AAA",
        "data:image/jpeg;base64,/9j/\n",
        "data:image/png;base64,iVBORw0KGgo",
        "data:image/png;base64,/9j/",
        "data:image/gif;base64,R0lGODlh",
        "data:image/webp;base64,UklGRg==",
        "data:image/svg+xml;base64,PHN2Zz4=",
    ] {
        assert!(media::validate_reference(value).is_err());
    }
    let mut image = vec![0u8; 8 * 1024 * 1024];
    image[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
    let encode = |image: &[u8]| format!("data:image/png;base64,{}", STANDARD.encode(image));
    media::validate_reference(&encode(&image)).unwrap();
    image.push(0); // Same base64 length as an 8 MiB image; a bound on encoded size alone misses it.
    assert_eq!(
        media::validate_reference(&encode(&image)).unwrap_err().code,
        "creative_reference_too_large"
    );
}

#[test]
fn image_and_video_send_one_named_reference_only_when_selected() {
    for (mode, option, object) in [
        (Mode::Image, "1024x1024", "image.task"),
        (Mode::Video, "16:9", "video.task"),
    ] {
        let queued = json_reply(json!({"task_id":"t1", "object":object, "status":"queued"}));
        let (service, server) = serve(vec![queued.clone(), queued]);
        assert!(
            block_on(service.generate(mode, "fixture", option, Some("/path/image.png".into())))
                .is_err()
        );
        for reference in [Some(PNG.into()), None] {
            let task = block_on(service.generate(mode, "fixture", option, reference)).unwrap();
            assert_eq!(task.id, "t1");
            assert_eq!(task.status, "queued");
        }
        for (i, request) in server.join().unwrap().into_iter().enumerate() {
            assert!(
                request
                    .headers
                    .starts_with(&format!("post /{} http/1.1", mode.endpoint()))
            );
            assert!(
                request
                    .headers
                    .contains("authorization: bearer unit-test-key\r\n")
            );
            let mut expected = match mode {
                Mode::Image => {
                    assert!(request.headers.contains("idempotency-key: "));
                    json!({"prompt":"fixture", "size":option, "response_format":"url"})
                }
                Mode::Video => json!({"prompt":"fixture", "aspect_ratio":option}),
            };
            if i == 0 {
                expected["reference_image"] = json!(PNG);
            }
            assert_eq!(
                serde_json::from_slice::<Value>(&request.body).unwrap(),
                expected
            );
        }
    }
}

#[test]
fn unknown_state_and_nested_media_are_not_accepted() {
    let service = Service::new("http://127.0.0.1:18610", "test-key").unwrap();
    let unknown = json!({"id":"task_a", "status":"not-a-state"});
    assert!(
        service
            .task_from_response(Mode::Image, &unknown, None)
            .is_err()
    );
    let nested = json!({"id":"task_a", "status":"completed", "url":"/v1/media/sub/result.png"});
    assert!(
        service
            .task_from_response(Mode::Image, &nested, None)
            .unwrap()
            .media_url
            .is_none()
    );
}

#[test]
fn task_result_only_creates_loopback_media_urls_for_safe_names() {
    let base = validate_base_url("http://127.0.0.1:18610").unwrap();
    let result = json!({"result":{"filename":"image-123.png"}});
    assert_eq!(
        media::result_url(&base, Mode::Image, &result)
            .unwrap()
            .as_str(),
        "http://127.0.0.1:18610/v1/media/image-123.png"
    );
    for name in [
        "../secret.png",
        ".png",
        "bad.exe",
        "script.svg",
        "clip.mp4",
        "AUX.png",
        "a:stream.png",
        "dir\\picture.png",
    ] {
        assert!(
            media::result_url(&base, Mode::Image, &json!({"result":{"filename":name}})).is_none()
        );
    }
    for url in [
        "https://example.invalid/v1/media/x.png",
        "http://127.0.0.1:18611/v1/media/x.png",
        "//127.0.0.1:18610/v1/media/x.png",
        "http://user@127.0.0.1:18610/v1/media/x.png",
        "/v1/media/../media/x.png",
        "/v1/media/%2e%2e%2fx.png",
        "/v1/media/x.png?q=1",
        "/v1/media/x.png#x",
        "/admin/x.png",
    ] {
        assert!(
            media::result_url(&base, Mode::Image, &json!({"url":url})).is_none(),
            "accepted {url}"
        );
    }
    assert!(
        media::result_url(
            &base,
            Mode::Video,
            &json!({"video":{"url":"http://127.0.0.1:18610/v1/media/clip.webm"}})
        )
        .is_some()
    );
}

#[test]
fn polling_binds_both_task_ids_and_kind_and_reports_missing_tasks() {
    let (service, server) = serve(vec![
        json_reply(json!({"id":"other","status":"completed"})),
        json_reply(json!({"id":"t1","task_id":"other","status":"queued"})),
        json_reply(json!({"id":"t1","object":"image.task","status":"queued"})),
        json_reply(json!({"id":"t1","object":"task","kind":"image","status":"queued"})),
        json_reply(
            json!({"id":"t1","kind":"video","result":{"kind":"image"},"status":"completed"}),
        ),
        response("404 Not Found", b"private-upstream-detail"),
        json_reply(
            json!({"id":"t1","object":"task","kind":"video","status":"processing","progress":142}),
        ),
    ]);
    for code in ["creative_task_mismatch"; 5]
        .into_iter()
        .chain(["creative_task_not_found"])
    {
        assert_eq!(
            block_on(service.get_task(Mode::Video, "t1"))
                .err()
                .unwrap()
                .code,
            code
        );
    }
    let task = block_on(service.get_task(Mode::Video, "t1")).unwrap();
    assert_eq!(
        serde_json::to_value(task).unwrap(),
        json!({"id":"t1","mode":"video","status":"processing","progress":100,"mediaUrl":null})
    );
    assert!(
        server
            .join()
            .unwrap()
            .iter()
            .all(|r| r.headers.starts_with("get /v1/videos/t1 http/1.1"))
    );
}

#[test]
fn save_requeries_task_and_streams_raw_media_without_bearer_to_unique_files() {
    let dir = TempDir::new();
    let completed = json_reply(
        json!({"id":"t1","kind":"image","status":"completed","result":{"filename":"result.png","kind":"image"}}),
    );
    let raw = STANDARD.decode(PNG.split_once(',').unwrap().1).unwrap();
    let image = chunked(&[&raw[..8], &raw[8..]]);
    let (service, server) = serve(vec![completed.clone(), image.clone(), completed, image]);
    let mut names = Vec::new();
    for _ in 0..2 {
        let name = block_on(service.save_result(Mode::Image, "t1", dir.0.clone())).unwrap();
        assert!(name.starts_with("Muse-") && name.ends_with(".png"));
        assert_eq!(std::path::Path::new(&name).components().count(), 1);
        assert_eq!(fs::read(dir.0.join(&name)).unwrap(), raw);
        names.push(name);
    }
    assert_ne!(names[0], names[1]);
    for pair in server.join().unwrap().chunks_exact(2) {
        assert!(
            pair[0]
                .headers
                .starts_with("get /v1/images/tasks/t1 http/1.1")
        );
        assert!(
            pair[0]
                .headers
                .contains("authorization: bearer unit-test-key\r\n")
        );
        assert!(
            pair[1]
                .headers
                .starts_with("get /v1/media/result.png http/1.1")
        );
        assert!(!pair[1].headers.contains("authorization:"));
    }
}

#[test]
fn save_refuses_noncompleted_mismatched_or_unsafe_tasks_before_media_request() {
    let dir = TempDir::new();
    let (service, server) = serve(vec![
        json_reply(json!({"id":"t1","status":"queued","filename":"clip.mp4"})),
        json_reply(json!({"id":"other","status":"completed","filename":"clip.mp4"})),
        json_reply(json!({"id":"t1","kind":"image","status":"completed","filename":"clip.mp4"})),
        json_reply(json!({"id":"t1","status":"completed","filename":"evil.html"})),
        json_reply(
            json!({"id":"t1","status":"completed","url":"https://example.invalid/v1/media/clip.mp4"}),
        ),
    ]);
    for code in [
        "creative_task_not_completed",
        "creative_task_mismatch",
        "creative_task_mismatch",
        "creative_invalid_media",
        "creative_invalid_media",
    ] {
        assert_eq!(
            block_on(service.save_result(Mode::Video, "t1", dir.0.clone()))
                .unwrap_err()
                .code,
            code
        );
        assert!(dir.is_empty());
    }
    assert!(
        server
            .join()
            .unwrap()
            .iter()
            .all(|r| r.headers.starts_with("get /v1/videos/t1 http/1.1"))
    );
}

#[test]
fn failed_or_partial_media_never_leaves_a_file() {
    let dir = TempDir::new();
    let completed = json_reply(
        json!({"id":"t1","object":"task","kind":"video","status":"completed","video":{"url":"/v1/media/clip.mp4"}}),
    );
    for (media, code) in [
        (
            "HTTP/1.1 200 OK\r\nContent-Length: 12\r\nConnection: close\r\n\r\nshort",
            "creative_read_failed",
        ),
        (
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nshort\r\n",
            "creative_read_failed",
        ),
        (
            "HTTP/1.1 200 OK\r\nContent-Length: 268435457\r\nConnection: close\r\n\r\n",
            "creative_media_too_large",
        ),
        (
            "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "creative_incomplete_media",
        ),
        (
            "HTTP/1.1 206 Partial Content\r\nContent-Length: 2\r\nConnection: close\r\n\r\nab",
            "creative_incomplete_media",
        ),
        (
            "HTTP/1.1 302 Found\r\nLocation: /admin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "creative_redirect_rejected",
        ),
        (
            "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            "creative_media_not_found",
        ),
    ] {
        let (service, server) = serve(vec![completed.clone(), media.as_bytes().to_vec()]);
        assert_eq!(
            block_on(service.save_result(Mode::Video, "t1", dir.0.clone()))
                .unwrap_err()
                .code,
            code
        );
        assert!(dir.is_empty());
        assert_eq!(server.join().unwrap().len(), 2);
    }
}

#[test]
fn chunked_media_cannot_cross_limit_or_overwrite_existing_file() {
    let dir = TempDir::new();
    let (service, server) = serve(vec![
        chunked(&[b"1234", b"5678"]),
        response("200 OK", b"data"),
    ]);
    let get = || {
        block_on(async {
            service
                .client
                .get(service.endpoint("v1/media/image.png").unwrap())
                .send()
                .await
                .unwrap()
        })
    };
    assert_eq!(
        media::write_download(get(), dir.0.clone(), "fixture.png".into(), 5)
            .unwrap_err()
            .code,
        "creative_media_too_large"
    );
    assert!(dir.is_empty());
    fs::write(dir.0.join("fixture.png"), b"keep").unwrap();
    assert!(media::write_download(get(), dir.0.clone(), "fixture.png".into(), 5).is_err());
    assert_eq!(fs::read(dir.0.join("fixture.png")).unwrap(), b"keep");
    server.join().unwrap();
}
