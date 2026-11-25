use tauri::Manager;

fn kill_background_services() {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "whisper-server.exe"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .on_window_event(|window, event| {
            if window.label() == "overlay" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let _ = window.hide();
                    api.prevent_close();
                    return;
                }
            }
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed = event {
                    kill_background_services();
                    std::process::exit(0);
                }
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Khởi động background VieNeu/Edge Neural TTS Server nếu chưa chạy
            let node_path = if std::path::Path::new(r"C:\Program Files\nodejs\node.exe").exists() {
                r"C:\Program Files\nodejs\node.exe"
            } else {
                "node"
            };
            let script_path = std::path::Path::new(r"C:\dich\scripts\edge_tts_server.js");
            if script_path.exists() && std::net::TcpStream::connect("127.0.0.1:3005").is_err() {
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    const CREATE_NO_WINDOW: u32 = 0x08000000;
                    let _ = std::process::Command::new(node_path)
                        .arg(script_path)
                        .current_dir(r"C:\dich")
                        .creation_flags(CREATE_NO_WINDOW)
                        .spawn();
                }
            }

            // Khởi động LiveSub Engine ngầm bên trong tiến trình Tauri
            tauri::async_runtime::spawn(async move {
                let config = livesub_app::config::AppConfig::default();
                livesub_app::run_server(config).await;
            });

            // Lắng nghe tín hiệu toggle cửa sổ phụ đề nổi (Always-on-Top OS window)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut rx = livesub_app::get_overlay_sender().subscribe();
                while let Ok(_) = rx.recv().await {
                    if let Some(win) = app_handle.get_webview_window("overlay") {
                        let is_vis = win.is_visible().unwrap_or(false);
                        if is_vis {
                            let _ = win.hide();
                        } else {
                            let _ = win.show();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            let _ = win.set_always_on_top(true);
                        }
                    } else {
                        let win = tauri::WebviewWindowBuilder::new(
                            &app_handle,
                            "overlay",
                            tauri::WebviewUrl::External("http://localhost:3000/overlay".parse().unwrap()),
                        )
                        .title("LiveSub - Phụ Đề Nổi (PiP Always-on-Top)")
                        .inner_size(920.0, 150.0)
                        .min_inner_size(400.0, 80.0)
                        .always_on_top(true)
                        .decorations(true)
                        .resizable(true)
                        .transparent(true)
                        .build();

                        if let Ok(w) = win {
                            let _ = w.show();
                            let _ = w.set_always_on_top(true);
                        }
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit = event {
            kill_background_services();
            std::process::exit(0);
        }
    });
}
