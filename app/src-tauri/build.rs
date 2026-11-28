fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "workspace_snapshot",
            "workspace_action",
            "workspace_layout",
            "workspace_layout_begin",
            "creative_status",
            "creative_connect",
            "creative_disconnect",
            "creative_generate_image",
            "creative_generate_video",
            "creative_get_task",
            "creative_save_result",
        ]),
    ))
    .expect("Tauri build configuration must be valid");
}
