use std::borrow::Cow;
use std::fs::File;
use std::io::{Read, Write};
use std::mem::MaybeUninit;
use std::net::SocketAddr;
use std::path::{Component, Path};
use std::sync::mpsc::TrySendError;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::handler::HandlerWithoutStateExt;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use hwinfo::ReadError;
use serde::{Deserialize, Deserializer, Serialize};
use tokio::net::TcpListener;
use tokio::runtime::Builder;
use tokio::signal;
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use windows_sys::Win32::{
    Foundation::SYSTEMTIME,
    System::{Console::SetConsoleTitleW, SystemInformation::GetLocalTime},
};

mod hwinfo;

fn main() {
    let title = concat!("Jonitor v", env!("CARGO_PKG_VERSION"));
    log(title);

    let w_title = title.encode_utf16().chain(Some(0)).collect::<Vec<_>>();

    if unsafe { SetConsoleTitleW(w_title.as_ptr()) } == 0 {
        log("Failed to set console title");
    }

    let mut hwinfo = match hwinfo::SharedMemory::init() {
        Ok(x) => x,
        Err(e) => {
            if let ReadError::Os(err) = e {
                log(format!("Error: {err}"));
                wait_for_enter();
            }

            return;
        }
    };

    // store the latest values read from HWiNFO so they are always available when requested
    let latest_sensors = Arc::new(RwLock::new(String::with_capacity(0)));
    let latest_sensors_clone = latest_sensors.clone();

    let latest_data = Arc::new(RwLock::new(Vec::with_capacity(0)));
    let latest_data_clone = latest_data.clone();

    match hwinfo.read() {
        Ok((data, json)) => {
            match json {
                Some(x) => *latest_sensors.blocking_write() = x,
                None => {
                    log("Failed to get sensors from HWiNFO");
                    wait_for_enter();

                    return;
                }
            }

            *latest_data.blocking_write() = data;
        }
        Err(e) => {
            match e {
                ReadError::Os(err) | ReadError::Other(err) => log(format!("Error: {err}")),
                ReadError::HwinfoClosed => log("Failed to read data from HWiNFO. HWiNFO is closed"),
            }

            wait_for_enter();

            return;
        }
    }

    let exe_path = match std::env::current_exe() {
        Ok(x) => x,
        Err(e) => {
            log(format!("Failed to get the current executable path: {e}"));
            wait_for_enter();

            return;
        }
    };

    let config;

    let mut config_path = exe_path.clone();
    config_path.pop();
    config_path.push("config.json");

    if config_path.exists() && config_path.is_file() {
        let content = match std::fs::read_to_string(config_path) {
            Ok(x) => x,
            Err(e) => {
                log(format!("Failed to read the configuration file: {e}",));
                wait_for_enter();

                return;
            }
        };

        match serde_json::from_str::<Config>(&content) {
            Ok(x) => config = x,
            Err(e) => {
                log(format!("Failed to parse the configuration file. Delete config.json to re-create the file with default values. Error: {e}"));
                wait_for_enter();

                return;
            }
        }
    } else {
        let mut file = match File::create(config_path) {
            Ok(x) => x,
            Err(e) => {
                log(format!("Failed to create the configuration file: {e}"));
                wait_for_enter();

                return;
            }
        };

        config = Config {
            ip: String::from("127.0.0.1"),
            port: 10110,
            polling_interval: 2000,
        };

        // indent using 4 spaces
        let formatter = serde_json::ser::PrettyFormatter::with_indent(b"    ");
        let mut serializer =
            serde_json::Serializer::with_formatter(Vec::with_capacity(100), formatter);
        if let Err(e) = config.serialize(&mut serializer) {
            log(format!(
                "Failed to serialize configuration file content: {e}"
            ));
            wait_for_enter();

            return;
        }

        if let Err(e) = file.write_all(&serializer.into_inner()) {
            log(format!("Failed to write the configuration file: {e}"));
            wait_for_enter();

            return;
        }

        if let Err(e) = file.sync_all() {
            log(format!("Failed to save the configuration file: {e}"));
            wait_for_enter();

            return;
        }

        log("Configuration file created");
    }

    let addr: SocketAddr = match format!("{}:{}", config.ip, config.port).parse() {
        Ok(x) => x,
        Err(e) => {
            log(format!(
                "Invalid IP address `{}:{}`: {e}",
                config.ip, config.port
            ));
            wait_for_enter();

            return;
        }
    };

    let polling_interval = u64::from(config.polling_interval);
    if polling_interval < 1000 {
        log(format!("Error: the minimum polling interval should be 1000 milliseconds. Current value of polling_interval in config.json is `{polling_interval}`"));
        wait_for_enter();

        return;
    }

    let mut public_dir_path = exe_path;
    public_dir_path.pop();
    public_dir_path.push("public");

    let mut serve_static_files = true;

    if !public_dir_path.exists() || !public_dir_path.is_dir() {
        serve_static_files = false;

        log("`public` folder does not exist. Static files are not served");
    }

    // notify the hwinfo thread to read data from HWiNFO(true), or stop the hwinfo thread(false)
    let (timer_tx, timer_rx) = std::sync::mpsc::sync_channel::<bool>(1);
    let timer_tx_clone = timer_tx.clone();
    let timer_tx_clone_2 = timer_tx.clone();

    // broadcast websocket messages from hwinfo thread to websocket send tasks
    let (message_tx, _) = tokio::sync::broadcast::channel(10);
    let message_tx_clone = message_tx.clone();

    // notify axum server to shutdown when the hwinfo thread is stopped
    let (hwinfo_stopped_tx, hwinfo_stopped_rx) = tokio::sync::oneshot::channel::<()>();

    let hwinfo_thread = match thread::Builder::new()
        .name(String::from("hwinfo"))
        .spawn(move || loop {
            let is_running = timer_rx.recv().expect("Timer sender disconnected");

            if is_running {
                match hwinfo.read() {
                    Ok((data, json)) => {
                        if data.is_empty() {
                            // the reading values have not changed
                            continue;
                        }

                        if let Some(str) = json {
                            // the list of sensors/readings has changed
                            *latest_sensors.blocking_write() = str;
                        }

                        latest_data.blocking_write().clone_from(&data);

                        let _ = message_tx.send(Message::Binary(data));
                    }
                    Err(e) => {
                        match e {
                            ReadError::Os(err) | ReadError::Other(err) => {
                                log(format!("Error: {err}"));
                                let _ = message_tx.send(Message::Close(Some(CloseFrame {
                                    code: 3000,
                                    reason: Cow::from("Error while reading data from HWiNFO"),
                                })));
                            }
                            ReadError::HwinfoClosed => {
                                log("Failed to read data from HWiNFO. HWiNFO is closed");
                                let _ = message_tx.send(Message::Close(Some(CloseFrame {
                                    code: 3000,
                                    reason: Cow::from("HWiNFO is closed"),
                                })));
                            }
                        }

                        let _ = hwinfo_stopped_tx.send(());
                        return true;
                    }
                }
            } else {
                let _ = message_tx.send(Message::Close(Some(CloseFrame {
                    code: 3000,
                    reason: Cow::from("Jonitor is closed"),
                })));

                return false;
            }
        }) {
        Ok(x) => x,
        Err(e) => {
            log(format!("Failed to spawn the hwinfo thread: {e}"));
            wait_for_enter();

            return;
        }
    };

    if let Err(e) = thread::Builder::new()
        .name(String::from("timer"))
        .spawn(move || loop {
            thread::sleep(Duration::from_millis(polling_interval));

            if let Err(TrySendError::Disconnected(_)) = timer_tx.try_send(true) {
                break;
            }
        })
    {
        log(format!("Failed to spawn the timer thread: {e}"));
        wait_for_enter();

        return;
    }

    let runtime = match Builder::new_current_thread().enable_io().build() {
        Ok(x) => x,
        Err(e) => {
            log(format!("Failed to create a Tokio runtime: {e}"));
            wait_for_enter();

            return;
        }
    };

    runtime.block_on(async {
        let listener = match TcpListener::bind(addr).await {
            Ok(x) => x,
            Err(e) => {
                let _ = timer_tx_clone.send(false); // stop the hwinfo thread

                log(format!("Failed to bind to {:?}: {e}", addr));
                wait_for_enter();

                return;
            }
        };

        log(format!("Starting web server on http://{}", addr));

        let mut configs_dir_path = public_dir_path.clone();
        configs_dir_path.push("configs");

        let app_state = AppState {
            configs_dir_path,
            latest_sensors: latest_sensors_clone,
            latest_data: latest_data_clone,
            message_tx: message_tx_clone,
        };

        let mut router = axum::Router::new()
            .route("/sensors", get(sensors_route))
            .route("/data", get(data_route));

        async fn handle_404() -> (StatusCode, &'static str) {
            (StatusCode::NOT_FOUND, "Not Found")
        }

        if serve_static_files {
            log(format!(
                "Serving files from {}",
                public_dir_path.to_string_lossy()
            ));

            let service_404 = handle_404.into_service();

            // GET /configs/:name is not handled by ServeDir as the file content needs to be validated
            router = router
                .route("/configs/:name", get(configs_route))
                .fallback_service(ServeDir::new(public_dir_path).fallback(service_404));
        } else {
            router = router.fallback(handle_404);
        }

        if let Err(e) = axum::serve(
            listener,
            router
                .with_state(app_state)
                .into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(shutdown_signal(timer_tx_clone, hwinfo_stopped_rx))
        .await
        {
            log(format!("Server error: {e}"));

            let _ = timer_tx_clone_2.send(false); // stop the hwinfo thread
        }
    });

    // wait for the hwinfo thread to stop
    if let Ok(has_error) = hwinfo_thread.join() {
        if has_error {
            wait_for_enter();
        }
    }
}

async fn sensors_route(State(state): State<AppState>) -> impl IntoResponse {
    let json = state.latest_sensors.read().await;

    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        (*json).clone(),
    )
}

async fn data_route(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_websocket(state, socket, addr))
}

async fn handle_websocket(state: AppState, mut ws: WebSocket, addr: SocketAddr) {
    log(format!("{:?} connected", addr));

    // send the last read data immediately
    {
        let lock = state.latest_data.read().await;
        let data = (*lock).clone();
        if let Err(e) = ws.send(Message::Binary(data)).await {
            log(format!("Failed to send websocket message: {e}"));
            log(format!("{:?} disconnected", addr));

            return;
        }
    }

    let mut rx = state.message_tx.subscribe();

    let (mut sender, mut receiver) = ws.split();

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if let Err(e) = sender.send(msg).await {
                log(format!("Failed to send websocket message: {e}"));
                break;
            }
        }
    });

    let mut receive_task = tokio::spawn(async move {
        loop {
            // ignore any message sent by client
            // the receiver fails when the client disconnects
            let msg = receiver.next().await;
            if msg.is_none() {
                break;
            }

            if msg.unwrap().is_err() {
                break;
            }
        }
    });

    tokio::select! {
        _ = (&mut send_task) => receive_task.abort(),
        _ = (&mut receive_task) => send_task.abort(),
    }

    log(format!("{:?} disconnected", addr));
}

async fn configs_route(
    State(state): State<AppState>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> impl IntoResponse {
    let name_with_ext = format!("{name}.json");
    let path = Path::new(&name_with_ext);

    let mut components = path.components();

    if let Some(component) = components.next() {
        match component {
            Component::Prefix(_)
            | Component::RootDir
            | Component::CurDir
            | Component::ParentDir => {
                // the path component should not be a directory
                return (StatusCode::NOT_FOUND, "Not Found").into_response();
            }
            Component::Normal(comp) => {
                // check for paths like `/foo/c:/bar/baz` (see https://github.com/tower-rs/tower-http/pull/204)
                if !Path::new(&comp)
                    .components()
                    .all(|c| matches!(c, Component::Normal(_)))
                {
                    return (StatusCode::NOT_FOUND, "Not Found").into_response();
                }
            }
        }
    } else {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    // the path should only have 1 component
    if components.next().is_some() {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    let mut file_path = state.configs_dir_path.clone();
    file_path.push(path);

    if !file_path.exists() || !file_path.is_file() {
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }

    match file_path.metadata() {
        Ok(metadata) => {
            // hardcoded to 5 megabytes
            if metadata.len() > 5000000 {
                log(format!(
                    "The size of the charts config file `{name_with_ext}` exceeds 5 megabytes"
                ));

                return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error")
                    .into_response();
            }
        }
        Err(e) => {
            log(format!("Failed to get metadata of a config file: {e}"));

            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };

    let task_result = tokio::task::spawn_blocking(move || std::fs::read_to_string(file_path)).await;

    let read_file_result = match task_result {
        Ok(x) => x,
        Err(e) => {
            log(format!("Failed to complete the read file task: {e}"));

            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };

    let file_content = match read_file_result {
        Ok(x) => x,
        Err(e) => {
            log(format!(
                "Failed to read the charts config file `{name_with_ext}`: {e}"
            ));

            return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
        }
    };

    // validate the file content
    if let Err(e) = serde_json::from_str::<Vec<ChartGroupConfig>>(&file_content) {
        log(format!(
            "Failed to parse the charts config file `{name_with_ext}`: {e}"
        ));

        return (StatusCode::INTERNAL_SERVER_ERROR, "Internal Server Error").into_response();
    }

    (
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        file_content,
    )
        .into_response()
}

async fn shutdown_signal(
    timer_tx: std::sync::mpsc::SyncSender<bool>,
    hwinfo_stopped_rx: tokio::sync::oneshot::Receiver<()>,
) {
    let ctrl_c = signal::windows::ctrl_c();
    let ctrl_close = signal::windows::ctrl_close();

    if ctrl_c.is_ok() && ctrl_close.is_ok() {
        let mut ctrl_c = ctrl_c.unwrap();
        let mut ctrl_close = ctrl_close.unwrap();

        tokio::select! {
            _ = ctrl_c.recv() => {},
            _ = ctrl_close.recv() => {},
            _ = hwinfo_stopped_rx => {},
        }
    } else {
        // if ctrl_c() fails, ctrl_close() will fail since one handler is used for all ctrl_* events

        log("Unable to set console control handler");

        let _ = hwinfo_stopped_rx.await;
    }

    log("Stopping Jonitor...");

    let _ = timer_tx.send(false); // stop the hwinfo thread
}

fn log<S: AsRef<str>>(msg: S) {
    let mut time: MaybeUninit<SYSTEMTIME> = MaybeUninit::uninit();

    let time = unsafe {
        GetLocalTime(time.as_mut_ptr());

        time.assume_init()
    };

    println!(
        "[{:02}:{:02}:{:02}]: {}",
        time.wHour,
        time.wMinute,
        time.wSecond,
        msg.as_ref()
    );
}

fn wait_for_enter() {
    if !std::env::args().any(|s| s == "--close-on-error") {
        println!("\nPress Enter to exit");
        std::io::stdin()
            .read_exact(&mut [0u8])
            .expect("Failed to read from stdin");
    }
}

#[derive(Clone)]
struct AppState {
    // path to the public\configs folder
    configs_dir_path: std::path::PathBuf,
    // the latest sensors json read from HWiNFO
    latest_sensors: Arc<RwLock<String>>,
    // the latest data read from HWiNFO
    latest_data: Arc<RwLock<Vec<u8>>>,
    // used for creating receiver part of the broadcast channel
    message_tx: tokio::sync::broadcast::Sender<Message>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Config {
    ip: String,
    port: u16,
    polling_interval: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ChartGroupConfig {
    grid_breakpoints: ChartGridBreakpoints,
    #[serde(deserialize_with = "no_empty_array")]
    chart_configs: Vec<ChartConfig>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ChartGridBreakpoints {
    small_columns: u16,
    small_width: u16,
    medium_columns: u16,
    medium_width: u16,
    large_columns: u16,
    large_width: u16,
    extra_large_columns: u16,
    extra_large_width: u16,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ChartConfig {
    #[serde(deserialize_with = "no_empty_string")]
    title: String,
    #[serde(deserialize_with = "no_invalid_chart")]
    chart_type: String,
    data_count: u32,
    #[serde(deserialize_with = "no_negative_float")]
    maximum_value: f32,
    height: u16,
    animation_duration: u16,
    show_legend: bool,
    show_labels: bool,
    auto_colors: bool,
    #[serde(deserialize_with = "no_empty_array")]
    datasets: Vec<ChartDataset>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct ChartDataset {
    sensor_id: u32,
    sensor_instance: u32,
    reading_id: u32,
    label: String,
    #[serde(deserialize_with = "no_empty_string")]
    unit: String,
    #[serde(deserialize_with = "no_empty_string")]
    color: String,
}

fn no_empty_array<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    let vec = <Vec<T>>::deserialize(deserializer)?;

    if vec.is_empty() {
        return Err(serde::de::Error::custom("unexpected empty array"));
    }

    Ok(vec)
}

fn no_empty_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let str = String::deserialize(deserializer)?;

    if str.trim().is_empty() {
        return Err(serde::de::Error::custom("unexpected empty string"));
    }

    Ok(str)
}

fn no_invalid_chart<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let str = String::deserialize(deserializer)?;

    if str != "bar" && str != "line" && str != "gauge" && str != "table" {
        return Err(serde::de::Error::invalid_value(
            serde::de::Unexpected::Str(&str),
            &r#""bar", "line", "gauge" or "table""#,
        ));
    }

    Ok(str)
}

fn no_negative_float<'de, D>(deserializer: D) -> Result<f32, D::Error>
where
    D: Deserializer<'de>,
{
    let num = f32::deserialize(deserializer)?;

    if num < 0.0 {
        return Err(serde::de::Error::invalid_value(
            serde::de::Unexpected::Float(f64::from(num)),
            &"0 or a positive floating point number",
        ));
    }

    Ok(num)
}
