#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tokio::main]
async fn main() {
    let config = livesub_app::config::AppConfig::default();
    livesub_app::run_server(config).await;
}
