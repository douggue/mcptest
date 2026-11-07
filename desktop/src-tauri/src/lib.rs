//! Tauri shell for MultiProfile.
//!
//! Responsibilities (everything else lives in the Python daemon):
//! * single instance: a second launch just focuses the existing window;
//! * start the bundled daemon as a sidecar on launch, kill an orphaned one first;
//! * tray icon with Show / Running profiles / Quit;
//! * on quit, ask the daemon to shut down cleanly (it stops running profiles);
//! * expose `daemon_info` (port + token) to the web view.

use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

const DEFAULT_PORT: u16 = 47821;

struct Daemon {
    child: Mutex<Option<CommandChild>>,
    port: u16,
    data_dir: PathBuf,
}

#[derive(Serialize, Clone)]
struct DaemonInfo {
    base_url: String,
    token: String,
}

fn data_dir() -> PathBuf {
    if let Ok(p) = std::env::var("MULTIPROFILE_DATA_DIR") {
        return PathBuf::from(p);
    }
    dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("MultiProfile")
}

fn port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{port}").parse().unwrap(),
        Duration::from_millis(300),
    )
    .is_ok()
}

fn read_token(dir: &PathBuf) -> String {
    fs::read_to_string(dir.join("api_token"))
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

/// A daemon left behind by a crashed app holds the port. Kill it by pid file.
fn kill_orphan(dir: &PathBuf, port: u16) {
    let pid_file = dir.join("daemon.pid");
    if !port_open(port) {
        let _ = fs::remove_file(&pid_file);
        return;
    }
    if let Ok(txt) = fs::read_to_string(&pid_file) {
        if let Ok(pid) = txt.trim().parse::<usize>() {
            let mut sys = sysinfo::System::new();
            sys.refresh_processes(sysinfo::ProcessesToUpdate::All);
            if let Some(proc_) = sys.process(sysinfo::Pid::from(pid)) {
                let name = proc_.name().to_string_lossy().to_lowercase();
                if name.contains("multiprofile") {
                    proc_.kill();
                    std::thread::sleep(Duration::from_millis(500));
                }
            }
        }
    }
    let _ = fs::remove_file(&pid_file);
}

fn spawn_daemon(app: &AppHandle, dir: &PathBuf, port: u16) -> Option<CommandChild> {
    let cmd = app
        .shell()
        .sidecar("multiprofile-daemon")
        .ok()?
        .env("MULTIPROFILE_DATA_DIR", dir.to_string_lossy().to_string())
        .env("MULTIPROFILE_PORT", port.to_string());
    let (mut rx, child) = cmd.spawn().ok()?;
    // Forward daemon output to our stderr for debugging.
    tauri::async_runtime::spawn(async move {
        while let Some(ev) = rx.recv().await {
            match ev {
                CommandEvent::Stdout(l) | CommandEvent::Stderr(l) => {
                    for line in BufReader::new(&l[..]).lines().flatten() {
                        eprintln!("[daemon] {line}");
                    }
                }
                CommandEvent::Terminated(t) => eprintln!("[daemon] exited: {:?}", t.code),
                _ => {}
            }
        }
    });
    Some(child)
}

fn wait_for_daemon(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if port_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

fn request_shutdown(dir: &PathBuf, port: u16) {
    let token = read_token(dir);
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build();
    if let Ok(client) = client {
        let _ = client
            .post(format!("http://127.0.0.1:{port}/shutdown"))
            .bearer_auth(token)
            .send();
    }
}

#[tauri::command]
fn daemon_info(state: State<Daemon>) -> DaemonInfo {
    DaemonInfo {
        base_url: format!("http://127.0.0.1:{}", state.port),
        token: read_token(&state.data_dir),
    }
}

#[tauri::command]
fn running_profiles(state: State<Daemon>) -> Vec<String> {
    let token = read_token(&state.data_dir);
    let url = format!("http://127.0.0.1:{}/profiles/running", state.port);
    let resp = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(token)
        .timeout(Duration::from_secs(5))
        .send();
    if let Ok(r) = resp {
        if let Ok(v) = r.json::<serde_json::Value>() {
            if let Some(arr) = v.as_array() {
                return arr
                    .iter()
                    .filter_map(|x| x.get("name").and_then(|n| n.as_str()).map(String::from))
                    .collect();
            }
        }
    }
    vec![]
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn quit(app: &AppHandle) {
    let state = app.state::<Daemon>();
    request_shutdown(&state.data_dir, state.port);
    let _ = wait_until_closed(state.port, Duration::from_secs(25));
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    app.exit(0);
}

fn wait_until_closed(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if !port_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let dir = data_dir();
    let _ = fs::create_dir_all(&dir);
    let port: u16 = std::env::var("MULTIPROFILE_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .manage(Daemon {
            child: Mutex::new(None),
            port,
            data_dir: dir.clone(),
        })
        .invoke_handler(tauri::generate_handler![daemon_info, running_profiles])
        .setup(move |app| {
            let handle = app.handle().clone();
            // 1. Daemon: reuse a healthy one started by hand, otherwise clean up and spawn.
            kill_orphan(&dir, port);
            if !port_open(port) {
                let child = spawn_daemon(&handle, &dir, port);
                *app.state::<Daemon>().child.lock().unwrap() = child;
                if !wait_for_daemon(port, Duration::from_secs(20)) {
                    eprintln!("daemon did not come up on port {port}");
                }
            }
            // 2. Tray.
            let show = MenuItem::with_id(app, "show", "Show MultiProfile", true, None::<&str>)?;
            let running = MenuItem::with_id(app, "running", "Running: (checking…)", false, None::<&str>)?;
            let stop_all = MenuItem::with_id(app, "stop_all", "Stop all profiles", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show, &running, &stop_all, &PredefinedMenuItem::separator(app)?, &quit_item],
            )?;
            let running_item = running.clone();
            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .tooltip("MultiProfile")
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "stop_all" => {
                        let st = app.state::<Daemon>();
                        let token = read_token(&st.data_dir);
                        let port = st.port;
                        std::thread::spawn(move || {
                            let client = reqwest::blocking::Client::new();
                            if let Ok(r) = client
                                .get(format!("http://127.0.0.1:{port}/profiles/running"))
                                .bearer_auth(&token)
                                .send()
                            {
                                if let Ok(v) = r.json::<serde_json::Value>() {
                                    for p in v.as_array().cloned().unwrap_or_default() {
                                        if let Some(id) = p.get("profile_id").and_then(|x| x.as_str()) {
                                            let _ = client
                                                .post(format!("http://127.0.0.1:{port}/profiles/{id}/stop"))
                                                .bearer_auth(&token)
                                                .send();
                                        }
                                    }
                                }
                            }
                        });
                    }
                    "quit" => quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            let _ = tray;
            // Refresh the "Running: …" line every few seconds.
            let h2 = handle.clone();
            std::thread::spawn(move || loop {
                let names = running_profiles(h2.state::<Daemon>());
                let text = if names.is_empty() {
                    "Running: none".to_string()
                } else {
                    format!("Running: {}", names.join(", "))
                };
                let _ = running_item.set_text(text);
                std::thread::sleep(Duration::from_secs(5));
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides to tray; Quit in the tray really exits.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<Daemon>();
                request_shutdown(&state.data_dir, state.port);
                if let Some(child) = state.child.lock().unwrap().take() {
                    let _ = wait_until_closed(state.port, Duration::from_secs(25));
                    let _ = child.kill();
                }
            }
        });
}
