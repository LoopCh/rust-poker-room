mod poker;
mod room;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    response::{Html, IntoResponse, Json},
    routing::get,
    Router,
};
use dashmap::DashMap;
use futures_util::{SinkExt, StreamExt};
use room::{GamePreset, PlayerAction, PokerRoom, RoomStateView, RoomSummary};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::{mpsc, Mutex};
use tracing::{info, warn};

type Tx = mpsc::UnboundedSender<String>;

pub struct RoomHandle {
    pub room: Mutex<PokerRoom>,
    pub clients: DashMap<String, Tx>,
}

#[derive(Clone)]
pub struct AppState {
    pub rooms: Arc<DashMap<String, Arc<RoomHandle>>>,
}

#[derive(Deserialize)]
pub struct CreateRoomReq {
    pub room_name: String,
    pub preset: Option<GamePreset>,
    pub small_blind: Option<u64>,
    pub starting_chips: Option<u64>,
    pub level_mins: Option<u64>,
}

#[derive(Serialize)]
pub struct CreateRoomResp {
    pub room_id: String,
}

#[derive(Deserialize)]
pub struct WsQuery {
    pub player_id: String,
    pub name: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ClientWsMessage {
    StartHand,
    Action {
        #[serde(flatten)]
        action: PlayerAction,
    },
    Rebuy,
    Leave,
    KickOffline,
    TogglePause,
    ToggleSitOut,
    ShowCards,
    Reaction {
        emoji: String,
    },
    Chat {
        text: String,
    },
    MediaState {
        video: bool,
        audio: bool,
    },
    MediaDiag {
        level: String,
        message: String,
    },
    WebrtcSignal {
        target_id: String,
        signal_type: String,
        payload: serde_json::Value,
    },
    Ping,
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerWsMessage<'a> {
    RoomState {
        state: RoomStateView,
    },
    Chat {
        sender_id: &'a str,
        sender_name: &'a str,
        text: &'a str,
    },
    Reaction {
        player_id: &'a str,
        emoji: &'a str,
    },
    Error {
        message: &'a str,
    },
    WebrtcSignal {
        from_id: &'a str,
        signal_type: &'a str,
        payload: &'a serde_json::Value,
    },
    Pong,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "rust_poker_room=info,tower_http=info".into()),
        )
        .init();

    let state = AppState {
        rooms: Arc::new(DashMap::new()),
    };

    // Background 1-second ticker for:
    // - Turn timeouts (45s)
    // - Automatic next hand deal after Showdown (6s pause)
    // - Auto-kicking offline players (> 60s disconnected)
    // - Auto-closing empty rooms with no players
    let ticker_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            interval.tick().await;
            let mut rooms_to_remove = Vec::new();
            for entry in ticker_state.rooms.iter() {
                let room_id = entry.key().clone();
                let handle = entry.value().clone();
                let mut room = handle.room.lock().await;
                if room.check_timers() && !handle.clients.is_empty() {
                    broadcast_room_state(&room, &handle.clients);
                }
                if handle.clients.is_empty() && room.should_auto_close() {
                    rooms_to_remove.push((room_id, room.room_name.clone()));
                }
            }
            for (room_id, room_name) in rooms_to_remove {
                ticker_state.rooms.remove(&room_id);
                info!("🗑 Стол '{}' ({}) автоматически закрыт (нет игроков)", room_name, room_id);
            }
        }
    });

    let app = Router::new()
        .route("/", get(index_handler))
        .route("/style.css", get(css_handler))
        .route("/app.js", get(js_handler))
        .route("/api/rooms", get(list_rooms_handler).post(create_room_handler))
        .route("/ws/{room_id}", get(ws_handler))
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3000);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));

    info!("🃏 Покерный сервер запущен на http://localhost:{}", port);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn index_handler() -> impl IntoResponse {
    Html(include_str!("../static/index.html"))
}

async fn css_handler() -> impl IntoResponse {
    (
        [(axum::http::header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../static/style.css"),
    )
}

async fn js_handler() -> impl IntoResponse {
    (
        [(
            axum::http::header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        include_str!("../static/app.js"),
    )
}

async fn list_rooms_handler(State(state): State<AppState>) -> Json<Vec<RoomSummary>> {
    let mut summaries = Vec::new();
    for entry in state.rooms.iter() {
        let room = entry.value().room.lock().await;
        summaries.push(room.summary());
    }
    summaries.sort_by(|a, b| a.room_name.cmp(&b.room_name));
    Json(summaries)
}

async fn create_room_handler(
    State(state): State<AppState>,
    Json(req): Json<CreateRoomReq>,
) -> Json<CreateRoomResp> {
    let room_id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let room_name = if req.room_name.trim().is_empty() {
        format!("Стол #{}", &room_id[..4])
    } else {
        req.room_name.trim().chars().take(36).collect()
    };

    let preset = req.preset.unwrap_or_default();
    let config = preset.build_config(req.small_blind, req.starting_chips, req.level_mins);

    let room = PokerRoom::new_with_preset(room_id.clone(), room_name, config);
    state.rooms.insert(
        room_id.clone(),
        Arc::new(RoomHandle {
            room: Mutex::new(room),
            clients: DashMap::new(),
        }),
    );

    Json(CreateRoomResp { room_id })
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Path(room_id): Path<String>,
    Query(query): Query<WsQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, room_id, query, state))
}

async fn handle_socket(
    socket: WebSocket,
    room_id: String,
    query: WsQuery,
    state: AppState,
) {
    let room_handle = match state.rooms.get(&room_id) {
        Some(h) => h.value().clone(),
        None => {
            let cfg = GamePreset::SngStandard.build_config(Some(10), Some(1500), Some(5));
            let new_room = PokerRoom::new_with_preset(
                room_id.clone(),
                format!("Стол {}", &room_id),
                cfg,
            );
            let handle = Arc::new(RoomHandle {
                room: Mutex::new(new_room),
                clients: DashMap::new(),
            });
            state.rooms.insert(room_id.clone(), handle.clone());
            handle
        }
    };

    let player_id = query.player_id.trim().to_string();
    let player_name: String = if query.name.trim().is_empty() {
        "Игрок".to_string()
    } else {
        query.name.trim().chars().take(20).collect()
    };

    let (mut ws_sender, mut ws_receiver) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    let send_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if ws_sender.send(Message::Text(msg.into())).await.is_err() {
                break;
            }
        }
    });

    room_handle.clients.insert(player_id.clone(), tx.clone());
    {
        let mut room = room_handle.room.lock().await;
        if let Err(err) = room.add_or_reconnect_player(player_id.clone(), player_name.clone()) {
            let err_msg = serde_json::to_string(&ServerWsMessage::Error { message: &err }).unwrap();
            let _ = tx.send(err_msg);
        }
        broadcast_room_state(&room, &room_handle.clients);
    }

    let mut left_explicitly = false;

    while let Some(Ok(msg)) = ws_receiver.next().await {
        if let Message::Text(text) = msg {
            let parsed: Result<ClientWsMessage, _> = serde_json::from_str(&text);
            match parsed {
                Ok(ClientWsMessage::StartHand) => {
                    let mut room = room_handle.room.lock().await;
                    if let Err(err) = room.start_new_hand() {
                        send_error(&tx, &err);
                    } else {
                        broadcast_room_state(&room, &room_handle.clients);
                    }
                }
                Ok(ClientWsMessage::Action { action }) => {
                    let mut room = room_handle.room.lock().await;
                    if let Err(err) = room.handle_action(&player_id, action) {
                        send_error(&tx, &err);
                    } else {
                        broadcast_room_state(&room, &room_handle.clients);
                    }
                }
                Ok(ClientWsMessage::Rebuy) => {
                    let mut room = room_handle.room.lock().await;
                    if let Err(err) = room.rebuy(&player_id) {
                        send_error(&tx, &err);
                    } else {
                        broadcast_room_state(&room, &room_handle.clients);
                    }
                }
                Ok(ClientWsMessage::TogglePause) => {
                    let mut room = room_handle.room.lock().await;
                    if let Err(err) = room.toggle_pause(&player_id) {
                        send_error(&tx, &err);
                    } else {
                        broadcast_room_state(&room, &room_handle.clients);
                    }
                }
                Ok(ClientWsMessage::ToggleSitOut) => {
                    let mut room = room_handle.room.lock().await;
                    if let Err(err) = room.toggle_sit_out(&player_id) {
                        send_error(&tx, &err);
                    } else {
                        broadcast_room_state(&room, &room_handle.clients);
                    }
                }
                Ok(ClientWsMessage::ShowCards) => {
                    let mut room = room_handle.room.lock().await;
                    if let Err(err) = room.reveal_my_cards(&player_id) {
                        send_error(&tx, &err);
                    } else {
                        broadcast_room_state(&room, &room_handle.clients);
                    }
                }
                Ok(ClientWsMessage::Leave) => {
                    left_explicitly = true;
                    let mut room = room_handle.room.lock().await;
                    room.leave_player(&player_id);
                    broadcast_room_state(&room, &room_handle.clients);
                    break;
                }
                Ok(ClientWsMessage::KickOffline) => {
                    let mut room = room_handle.room.lock().await;
                    if let Err(err) = room.kick_offline_players() {
                        send_error(&tx, &err);
                    } else {
                        broadcast_room_state(&room, &room_handle.clients);
                    }
                }
                Ok(ClientWsMessage::Reaction { emoji }) => {
                    let clean_emoji: String = emoji.trim().chars().take(4).collect();
                    if !clean_emoji.is_empty() {
                        let msg_json = serde_json::to_string(&ServerWsMessage::Reaction {
                            player_id: &player_id,
                            emoji: &clean_emoji,
                        })
                        .unwrap();
                        for client in room_handle.clients.iter() {
                            let _ = client.value().send(msg_json.clone());
                        }
                    }
                }
                Ok(ClientWsMessage::MediaState { video, audio }) => {
                    info!(
                        "[МЕДИА] Комната={} Игрок={} ({}) -> video={}, audio={}",
                        room_id, player_name, player_id, video, audio
                    );
                    let mut room = room_handle.room.lock().await;
                    room.update_media_state(&player_id, video, audio);
                    broadcast_room_state(&room, &room_handle.clients);
                }
                Ok(ClientWsMessage::MediaDiag { level, message }) => {
                    let clean_msg: String = message.chars().take(300).collect();
                    if level == "error" || level == "warn" {
                        warn!(
                            "[МЕДИА-ДИАГНОСТИКА] Комната={} Игрок={} ({}): {}",
                            room_id, player_name, player_id, clean_msg
                        );
                    } else {
                        info!(
                            "[МЕДИА-ДИАГНОСТИКА] Комната={} Игрок={} ({}): {}",
                            room_id, player_name, player_id, clean_msg
                        );
                    }
                }
                Ok(ClientWsMessage::Chat { text }) => {
                    let clean: String = text.trim().chars().take(240).collect();
                    if !clean.is_empty() {
                        let chat_json = serde_json::to_string(&ServerWsMessage::Chat {
                            sender_id: &player_id,
                            sender_name: &player_name,
                            text: &clean,
                        })
                        .unwrap();
                        for client in room_handle.clients.iter() {
                            let _ = client.value().send(chat_json.clone());
                        }
                    }
                }
                Ok(ClientWsMessage::WebrtcSignal {
                    target_id,
                    signal_type,
                    payload,
                }) => {
                    if let Some(target_tx) = room_handle.clients.get(&target_id) {
                        let sig_json = serde_json::to_string(&ServerWsMessage::WebrtcSignal {
                            from_id: &player_id,
                            signal_type: &signal_type,
                            payload: &payload,
                        })
                        .unwrap();
                        let _ = target_tx.value().send(sig_json);
                    }
                }
                Ok(ClientWsMessage::Ping) => {
                    let pong = serde_json::to_string(&ServerWsMessage::Pong).unwrap();
                    let _ = tx.send(pong);
                }
                Err(e) => {
                    warn!("Invalid WS message from {}: {}", player_id, e);
                }
            }
        }
    }

    room_handle.clients.remove(&player_id);
    send_task.abort();
    let should_remove_room = {
        let mut room = room_handle.room.lock().await;
        if !left_explicitly {
            room.set_player_disconnected(&player_id);
            broadcast_room_state(&room, &room_handle.clients);
        }
        room_handle.clients.is_empty() && room.should_auto_close()
    };
    if should_remove_room {
        state.rooms.remove(&room_id);
        info!("🗑 Стол '{}' закрыт после выхода последнего игрока", room_id);
    }
}

fn send_error(tx: &Tx, msg: &str) {
    if let Ok(json) = serde_json::to_string(&ServerWsMessage::Error { message: msg }) {
        let _ = tx.send(json);
    }
}

fn broadcast_room_state(room: &PokerRoom, clients: &DashMap<String, Tx>) {
    for entry in clients.iter() {
        let pid = entry.key();
        let view = room.view_for_player(pid);
        if let Ok(json) = serde_json::to_string(&ServerWsMessage::RoomState { state: view }) {
            let _ = entry.value().send(json);
        }
    }
}
