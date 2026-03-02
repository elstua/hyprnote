fn ensure_permission_files_exist() {
    // Handle missing permission files referenced by DEP_* env vars
    for (key, value) in std::env::vars_os() {
        let key_str = key.to_string_lossy();
        if key_str.starts_with("DEP_")
            && (key_str.ends_with("_PERMISSION_FILES_PATH")
                || key_str.ends_with("_GLOBAL_SCOPE_SCHEMA_PATH"))
        {
            let path = std::path::PathBuf::from(&value);
            if !path.exists() {
                if let Some(parent) = path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if key_str.ends_with("_PERMISSION_FILES_PATH") {
                    let _ = std::fs::write(&path, "[]");
                } else {
                    let _ = std::fs::write(&path, "{}");
                }
            }
        }
    }

    // Also scan the build directory for stale tauri outputs with missing permission files.
    // This handles cases where folder renames invalidate cached build artifacts.
    let out_dir = match std::env::var("OUT_DIR") {
        Ok(d) => std::path::PathBuf::from(d),
        Err(_) => return,
    };
    let build_dir = match out_dir.parent().and_then(|p| p.parent()) {
        Some(d) => d.to_path_buf(),
        None => return,
    };
    let entries = match std::fs::read_dir(&build_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if !name_str.starts_with("tauri-") || name_str.starts_with("tauri-build-") {
            continue;
        }
        let out_subdir = entry.path().join("out");
        if !out_subdir.is_dir() {
            continue;
        }
        // Find expected permission files by checking if the out dir is nearly empty
        let has_permission_file = std::fs::read_dir(&out_subdir)
            .map(|rd| {
                rd.flatten().any(|e| {
                    e.file_name()
                        .to_string_lossy()
                        .ends_with("permission-files")
                })
            })
            .unwrap_or(false);
        if !has_permission_file {
            // Remove stale build directory to force cargo to re-run the build script
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

fn main() {
    #[cfg(target_os = "macos")]
    println!("cargo:rustc-link-arg=-fapple-link-rtlib");

    ensure_permission_files_exist();
    tauri_build::build()
}
