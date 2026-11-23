fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "workspace_snapshot",
            "workspace_action",
            "workspace_layout",
            "workspace_layout_begin",
        ]),
    ))
    .expect("Tauri build configuration must be valid");
}
