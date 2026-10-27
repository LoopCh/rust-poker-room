// =========================================================================
// КОНСТАНТЫ И ХРАНИЛИЩЕ ПРОФИЛЯ
// =========================================================================
const STORAGE_KEY_ID = "rustholdem_player_id";
const STORAGE_KEY_NAME = "rustholdem_player_name";
const STORAGE_KEY_THEME = "rustholdem_theme";
const STORAGE_KEY_4COLOR = "rustholdem_4color";
const STORAGE_KEY_SOUND = "rustholdem_sound";

let myPlayerId = localStorage.getItem(STORAGE_KEY_ID);
if (!myPlayerId) {
    myPlayerId = "p_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(STORAGE_KEY_ID, myPlayerId);
}

let myPlayerName = localStorage.getItem(STORAGE_KEY_NAME) || "";
let currentRoomId = null;
let ws = null;
let roomState = null;
let lastLogCount = 0;
let intentionalLeave = false;

// Отслеживание изменений для плавных анимаций, звуков и локальных таймеров
let prevHandNumber = 0;
let prevCommunityCount = 0;
let prevPot = 0;
let prevTurnSeat = null;
let prevStage = "waiting";
let clientStateReceivedAt = 0;
let clientTurnInitialRem = 45;
let clientNextHandInitialRem = null;
let clientLevelInitialRem = null;

// =========================================================================
// ПРОЦЕДУРНЫЙ ЗВУКОВОЙ ДВИЖОК (Web Audio API — 0 КБ внешних файлов)
// =========================================================================
let soundEnabled = localStorage.getItem(STORAGE_KEY_SOUND) !== "0";
let audioCtx = null;

function getAudioCtx() {
    if (!soundEnabled) return null;
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}

const SoundFX = {
    playCard() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(320, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.065);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.07);
    },
    playChips() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        [1850, 2450].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, now + i * 0.035);
            gain.gain.setValueAtTime(0.09, now + i * 0.035);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.035 + 0.07);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.035);
            osc.stop(now + i * 0.035 + 0.08);
        });
    },
    playCheck() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        [0, 0.09].forEach((offset) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(135, now + offset);
            osc.frequency.exponentialRampToValueAtTime(55, now + offset + 0.055);
            gain.gain.setValueAtTime(0.2, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.065);
        });
    },
    playMyTurn() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        [523.25, 659.25].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, now + idx * 0.11);
            gain.gain.setValueAtTime(0.11, now + idx * 0.11);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.24);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.11);
            osc.stop(now + idx * 0.11 + 0.25);
        });
    },
    playWin() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, now + idx * 0.08);
            gain.gain.setValueAtTime(0.12, now + idx * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.35);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.08);
            osc.stop(now + idx * 0.08 + 0.36);
        });
    }
};

// =========================================================================
// ЭЛЕМЕНТЫ DOM
// =========================================================================
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const playerNameInput = document.getElementById("player-name-input");
const roomsListEl = document.getElementById("rooms-list");
const refreshRoomsBtn = document.getElementById("refresh-rooms-btn");
const createRoomBtn = document.getElementById("create-room-btn");
const presetSelect = document.getElementById("new-room-preset");
const sbInput = document.getElementById("new-room-sb");
const levelMinsGroup = document.getElementById("level-mins-group");
const levelMinsInput = document.getElementById("new-room-level-mins");
const chipsInput = document.getElementById("new-room-chips");

const leaveRoomBtn = document.getElementById("leave-room-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const kickOfflineBtn = document.getElementById("kick-offline-btn");
const sitOutBtn = document.getElementById("sit-out-btn");
const pauseGameBtn = document.getElementById("pause-game-btn");
const themeSelect = document.getElementById("theme-select");
const deckColorBtn = document.getElementById("deck-color-btn");
const toggleSoundBtn = document.getElementById("toggle-sound-btn");
const toggleCamBtn = document.getElementById("toggle-cam-btn");
const toggleMicBtn = document.getElementById("toggle-mic-btn");
const openDiagBtn = document.getElementById("open-diag-btn");
const rebuyBtn = document.getElementById("rebuy-btn");
const startHandBtn = document.getElementById("start-hand-btn");
const showCardsBtn = document.getElementById("show-cards-btn");

const mediaDiagModal = document.getElementById("media-diag-modal");
const closeDiagBtn = document.getElementById("close-diag-btn");
const runDiagTestBtn = document.getElementById("run-diag-test-btn");
const clearDiagLogBtn = document.getElementById("clear-diag-log-btn");
const diagSecureEl = document.getElementById("diag-secure");
const diagCamsEl = document.getElementById("diag-cams");
const diagMicsEl = document.getElementById("diag-mics");
const diagTracksEl = document.getElementById("diag-tracks");
const diagLogListEl = document.getElementById("diag-log-list");

const roomTitleEl = document.getElementById("room-title");
const roomBlindsBadge = document.getElementById("room-blinds-badge");
const roomLevelTimerEl = document.getElementById("room-level-timer");
const potContainerEl = document.getElementById("pot-container");
const potAmountEl = document.getElementById("pot-amount");
const communityCardsEl = document.getElementById("community-cards");
const tableStatusBanner = document.getElementById("table-status-banner");
const seatsContainer = document.getElementById("seats-container");

const chatMessagesEl = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");

const myStackBbLabel = document.getElementById("my-stack-bb-label");
const myHandRankEl = document.getElementById("my-hand-rank");
const actionControlsEl = document.getElementById("action-controls");
const actFoldBtn = document.getElementById("act-fold-btn");
const actCheckCallBtn = document.getElementById("act-check-call-btn");
const checkCallLabel = document.getElementById("check-call-label");
const actRaiseBtn = document.getElementById("act-raise-btn");
const raiseBtnLabel = document.getElementById("raise-btn-label");
const raiseSlider = document.getElementById("raise-slider");
const raiseInput = document.getElementById("raise-input");

const quickMinBtn = document.getElementById("quick-min-btn");
const quickHalfBtn = document.getElementById("quick-half-btn");
const quickPotBtn = document.getElementById("quick-pot-btn");
const quickAllinBtn = document.getElementById("quick-allin-btn");

// =========================================================================
// СИСТЕМА ЛОГИРОВАНИЯ И ДИАГНОСТИКИ КАМЕРЫ / МИКРОФОНА / WEBRTC
// =========================================================================
function logMediaDiag(level, message, showInSidebar = true) {
    const timeStr = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    const fullLine = `[${timeStr}] ${message}`;

    if (level === "error" || level === "warn") {
        console.warn("[МЕДИА-ДИАГНОСТИКА]", fullLine);
    } else {
        console.info("[МЕДИА-ДИАГНОСТИКА]", fullLine);
    }

    // 1. Запись в модальное окно диагностики
    if (diagLogListEl) {
        const entry = document.createElement("div");
        entry.className = `diag-log-entry ${level}`;
        entry.textContent = fullLine;
        diagLogListEl.appendChild(entry);
        diagLogListEl.scrollTop = diagLogListEl.scrollHeight;
    }

    // 2. Запись в боковую панель стола
    if (showInSidebar && chatMessagesEl) {
        const div = document.createElement("div");
        div.className = `msg-media ${level}`;
        div.textContent = `📹 ${message}`;
        chatMessagesEl.appendChild(div);
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    // 3. Отправка на сервер Rust для сохранения в логах VPS (journalctl)
    sendWs({
        type: "media_diag",
        level: level,
        message: message
    });

    refreshDiagSummary();
}

async function refreshDiagSummary() {
    const isSecure = window.isSecureContext;
    diagSecureEl.textContent = isSecure
        ? `✅ Да (${window.location.protocol}//${window.location.host})`
        : `❌ Нет (${window.location.protocol}) — браузер блокирует камеру по HTTP! Используйте https://${window.location.hostname}:8443`;
    diagSecureEl.style.color = isSecure ? "#6ee7b7" : "#fca5a5";

    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
        diagCamsEl.textContent = "Недоступно (нужен HTTPS)";
        diagMicsEl.textContent = "Недоступно (нужен HTTPS)";
    } else {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices.filter(d => d.kind === "videoinput");
            const mics = devices.filter(d => d.kind === "audioinput");
            diagCamsEl.textContent = cams.length > 0
                ? `${cams.length} шт. (${cams.map((c, i) => c.label || `Камера #${i + 1}`).join(", ")})`
                : "0 (Не найдено)";
            diagMicsEl.textContent = mics.length > 0
                ? `${mics.length} шт. (${mics.map((m, i) => m.label || `Микрофон #${i + 1}`).join(", ")})`
                : "0 (Не найдено)";
        } catch (e) {
            diagCamsEl.textContent = `Ошибка опроса: ${e.message}`;
        }
    }

    if (localStream && localStream.getTracks().length > 0) {
        const desc = localStream.getTracks().map(t => {
            const settings = t.getSettings ? t.getSettings() : {};
            const res = settings.width ? ` ${settings.width}x${settings.height}` : "";
            return `${t.kind}:${t.readyState}(en=${t.enabled}${res})`;
        }).join(", ");
        diagTracksEl.textContent = desc;
    } else {
        diagTracksEl.textContent = "Нет активных потоков";
    }
}

openDiagBtn.addEventListener("click", () => {
    mediaDiagModal.classList.remove("hidden");
    refreshDiagSummary();
});

closeDiagBtn.addEventListener("click", () => {
    mediaDiagModal.classList.add("hidden");
});

clearDiagLogBtn.addEventListener("click", () => {
    diagLogListEl.innerHTML = "";
});

runDiagTestBtn.addEventListener("click", async () => {
    logMediaDiag("info", "Запуск полной проверки медиа-устройств...", false);
    await refreshDiagSummary();
    if (!window.isSecureContext) {
        logMediaDiag(
            "error",
            `Страница открыта по незащищенному HTTP (${window.location.origin}). Для работы камеры по IP откройте https://${window.location.hostname}:8443`
        );
        return;
    }
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cams = devices.filter(d => d.kind === "videoinput");
        const mics = devices.filter(d => d.kind === "audioinput");
        logMediaDiag("ok", `Найдено устройств: видеокамер=${cams.length}, микрофонов=${mics.length}`, false);
        for (const [peerId, pc] of peerConnections.entries()) {
            const pName = getPeerName(peerId);
            logMediaDiag(
                "info",
                `P2P [${pName}]: signaling=${pc.signalingState}, ice=${pc.iceConnectionState}, conn=${pc.connectionState}`,
                false
            );
        }
    } catch (e) {
        logMediaDiag("error", `Ошибка перечисления устройств: ${e.name}: ${e.message}`);
    }
});

function explainMediaError(err, kindRu) {
    const name = err && err.name ? err.name : "UnknownError";
    const msg = err && err.message ? err.message : String(err);
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        return `Доступ к устройству (${kindRu}) запрещен (${name}). Разрешите камеру/микрофон по значку замка в адресной строке браузера.`;
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
        return `Устройство (${kindRu}) физически не обнаружено в системе (${name}). Проверьте подключение.`;
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
        return `Устройство (${kindRu}) занято другой программой (Zoom, Discord, OBS или другим браузером) [${name}: ${msg}].`;
    }
    if (name === "OverconstrainedError") {
        return `Запрошенные параметры (${kindRu}) не поддерживаются камерой (${name}).`;
    }
    if (name === "SecurityError" || !window.isSecureContext) {
        return `Браузер заблокировал ${kindRu}, так как страница открыта без HTTPS. Откройте https://${window.location.hostname}:8443`;
    }
    return `Ошибка ${kindRu} [${name}]: ${msg}`;
}

function getPeerName(peerId) {
    if (!roomState) return peerId;
    const p = roomState.players.find(x => x.id === peerId);
    return p ? p.name : peerId;
}

// =========================================================================
// ИНИЦИАЛИЗАЦИЯ И НАСТРОЙКИ UI
// =========================================================================
window.addEventListener("DOMContentLoaded", () => {
    playerNameInput.value = myPlayerName || `Игрок_${myPlayerId.slice(2, 5)}`;

    const savedTheme = localStorage.getItem(STORAGE_KEY_THEME) || "emerald";
    document.body.dataset.theme = savedTheme;
    themeSelect.value = savedTheme;

    const isFourColor = localStorage.getItem(STORAGE_KEY_4COLOR) === "1";
    document.body.classList.toggle("four-color-deck", isFourColor);
    deckColorBtn.textContent = isFourColor ? "🃏 4-цвет" : "🃏 2-цвет";
    deckColorBtn.classList.toggle("active", isFourColor);

    toggleSoundBtn.textContent = soundEnabled ? "🔊 Звук" : "🔇 Без звука";
    toggleSoundBtn.classList.toggle("active", soundEnabled);

    initSeatDOM();
    loadRooms();
    startClientTickers();

    const hash = window.location.hash;
    if (hash.startsWith("#room=")) {
        const targetRoom = decodeURIComponent(hash.replace("#room=", "").trim());
        if (targetRoom) {
            joinRoom(targetRoom);
        }
    }
});

presetSelect.addEventListener("change", () => {
    const preset = presetSelect.value;
    const sb = parseInt(sbInput.value, 10) || 10;
    if (preset === "cash") {
        levelMinsGroup.classList.add("hidden");
        chipsInput.value = sb * 100;
    } else {
        levelMinsGroup.classList.remove("hidden");
        if (preset === "sng_standard") {
            levelMinsInput.value = 5;
            chipsInput.value = sb * 150;
        } else if (preset === "sng_turbo") {
            levelMinsInput.value = 3;
            chipsInput.value = sb * 150;
        } else if (preset === "hyper_turbo") {
            levelMinsInput.value = 2;
            chipsInput.value = sb * 50;
        } else if (preset === "deepstack_ante") {
            levelMinsInput.value = 6;
            chipsInput.value = sb * 300;
        }
    }
});

themeSelect.addEventListener("change", () => {
    const theme = themeSelect.value;
    document.body.dataset.theme = theme;
    localStorage.setItem(STORAGE_KEY_THEME, theme);
});

deckColorBtn.addEventListener("click", () => {
    const enabled = !document.body.classList.contains("four-color-deck");
    document.body.classList.toggle("four-color-deck", enabled);
    localStorage.setItem(STORAGE_KEY_4COLOR, enabled ? "1" : "0");
    deckColorBtn.textContent = enabled ? "🃏 4-цвет" : "🃏 2-цвет";
    deckColorBtn.classList.toggle("active", enabled);
});

toggleSoundBtn.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem(STORAGE_KEY_SOUND, soundEnabled ? "1" : "0");
    toggleSoundBtn.textContent = soundEnabled ? "🔊 Звук" : "🔇 Без звука";
    toggleSoundBtn.classList.toggle("active", soundEnabled);
    if (soundEnabled) SoundFX.playChips();
});

function showToast(msg, isError = false) {
    const container = document.getElementById("toast-container");
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4200);
}

function getAndSavePlayerName() {
    let name = playerNameInput.value.trim();
    if (!name) {
        name = `Игрок_${myPlayerId.slice(2, 5)}`;
        playerNameInput.value = name;
    }
    myPlayerName = name;
    localStorage.setItem(STORAGE_KEY_NAME, name);
    return name;
}

// =========================================================================
// ЛОББИ И КОМНАТЫ
// =========================================================================
async function loadRooms() {
    try {
        const res = await fetch("/api/rooms");
        const rooms = await res.json();
        roomsListEl.innerHTML = "";
        if (rooms.length === 0) {
            roomsListEl.innerHTML = `<div class="empty-rooms">Нет активных комнат. Создайте первую!</div>`;
            return;
        }
        for (const r of rooms) {
            const item = document.createElement("div");
            item.className = "room-item";
            const anteText = r.ante > 0 ? ` (Анте ${r.ante})` : "";
            item.innerHTML = `
                <div>
                    <div class="room-item-title">${escapeHtml(r.room_name)}</div>
                    <div class="room-item-meta">${escapeHtml(r.preset_name)} • Блайнды: ${r.small_blind}/${r.big_blind}${anteText} • Игроков: ${r.player_count}/${r.max_players}</div>
                </div>
                <button class="btn btn-primary btn-sm">Сесть за стол →</button>
            `;
            item.querySelector("button").addEventListener("click", () => joinRoom(r.room_id));
            roomsListEl.appendChild(item);
        }
    } catch (e) {
        roomsListEl.innerHTML = `<div class="empty-rooms">Ошибка загрузки списка комнат</div>`;
    }
}

refreshRoomsBtn.addEventListener("click", loadRooms);

createRoomBtn.addEventListener("click", async () => {
    getAndSavePlayerName();
    const roomName = document.getElementById("new-room-name").value.trim() || "Вечерний покер";
    const preset = presetSelect.value;
    const sb = parseInt(sbInput.value, 10) || 10;
    const levelMins = parseInt(levelMinsInput.value, 10) || 5;
    const chips = parseInt(chipsInput.value, 10) || 1500;

    try {
        const res = await fetch("/api/rooms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                room_name: roomName,
                preset: preset,
                small_blind: sb,
                starting_chips: chips,
                level_mins: levelMins
            })
        });
        const data = await res.json();
        joinRoom(data.room_id);
    } catch (e) {
        showToast("Не удалось создать комнату", true);
    }
});

// =========================================================================
// WEBSOCKET ПОДКЛЮЧЕНИЕ И АВТО-РЕКОННЕКТ
// =========================================================================
function joinRoom(roomId) {
    const name = getAndSavePlayerName();
    currentRoomId = roomId;
    intentionalLeave = false;
    window.location.hash = `room=${encodeURIComponent(roomId)}`;

    lobbyScreen.classList.remove("active");
    gameScreen.classList.add("active");
    chatMessagesEl.innerHTML = "";
    lastLogCount = 0;
    prevHandNumber = 0;
    prevCommunityCount = 0;
    prevPot = 0;

    connectWebSocket(roomId, name);
}

function connectWebSocket(roomId, name) {
    if (ws) {
        ws.onclose = null;
        ws.close();
    }

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/ws/${encodeURIComponent(roomId)}?player_id=${encodeURIComponent(myPlayerId)}&name=${encodeURIComponent(name)}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        if (videoEnabled || audioEnabled) {
            sendWs({ type: "media_state", video: videoEnabled, audio: audioEnabled });
        }
    };

    ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "room_state") {
            handleRoomStateUpdate(msg.state);
        } else if (msg.type === "chat") {
            appendChatMessage(msg.sender_name, msg.text);
        } else if (msg.type === "reaction") {
            showSeatReaction(msg.player_id, msg.emoji);
        } else if (msg.type === "error") {
            showToast(msg.message, true);
        } else if (msg.type === "webrtc_signal") {
            await handleWebrtcSignal(msg.from_id, msg.signal_type, msg.payload);
        }
    };

    ws.onclose = () => {
        if (!intentionalLeave && currentRoomId === roomId) {
            setTimeout(() => {
                if (!intentionalLeave && currentRoomId === roomId) {
                    connectWebSocket(roomId, name);
                }
            }, 1500);
        }
    };
}

leaveRoomBtn.addEventListener("click", () => {
    intentionalLeave = true;
    sendWs({ type: "leave" });
    stopLocalMedia();
    cleanupAllPeers();
    if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
    }
    currentRoomId = null;
    roomState = null;
    window.location.hash = "";
    gameScreen.classList.remove("active");
    lobbyScreen.classList.add("active");
    loadRooms();
});

copyLinkBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
        showToast("Ссылка на стол скопирована! Отправьте её друзьям.");
    });
});

kickOfflineBtn.addEventListener("click", () => {
    sendWs({ type: "kick_offline" });
});

sitOutBtn.addEventListener("click", () => {
    sendWs({ type: "toggle_sit_out" });
});

pauseGameBtn.addEventListener("click", () => {
    sendWs({ type: "toggle_pause" });
});

showCardsBtn.addEventListener("click", () => {
    sendWs({ type: "show_cards" });
});

function sendWs(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
    }
}

// =========================================================================
// ИНИЦИАЛИЗАЦИЯ И ОТРИСОВКА СТОЛА И 6 МЕСТ
// =========================================================================
function initSeatDOM() {
    seatsContainer.innerHTML = "";
    for (let pos = 0; pos < 6; pos++) {
        const seatEl = document.createElement("div");
        seatEl.className = `seat seat-pos-${pos} hidden`;
        seatEl.id = `seat-slot-${pos}`;
        seatEl.innerHTML = `
            <div class="seat-box">
                <div class="seat-badges">
                    <div class="dealer-button hidden" id="seat-dealer-${pos}" title="Дилер (Баттон)">D</div>
                    <div class="blind-badge hidden" id="seat-blind-${pos}">SB</div>
                </div>
                <div class="seat-emoji-layer" id="seat-emoji-${pos}"></div>
                <div class="seat-media-wrap">
                    <video class="seat-video" id="seat-video-${pos}" autoplay playsinline></video>
                    <div class="seat-avatar-placeholder" id="seat-avatar-${pos}">?</div>
                    <div class="seat-hole-cards" id="seat-cards-${pos}"></div>
                </div>
                <div class="seat-info-row">
                    <span class="seat-name" id="seat-name-${pos}">Игрок</span>
                    <span class="seat-chips" id="seat-chips-${pos}">0</span>
                </div>
                <div class="seat-action-tag hidden" id="seat-action-${pos}"></div>
                <div class="seat-timer-wrap hidden" id="seat-timer-wrap-${pos}">
                    <div class="seat-timer-bar" id="seat-timer-bar-${pos}"></div>
                </div>
            </div>
            <div class="seat-bet-bubble hidden" id="seat-bet-${pos}">0</div>
        `;
        seatsContainer.appendChild(seatEl);
    }
}

function cardKey(c) {
    return c ? `${c.rank}_${c.suit}` : "back";
}

function formatMmSs(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = Math.floor(totalSec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function handleRoomStateUpdate(state) {
    const isNewHand = state.hand_number !== prevHandNumber && state.hand_number > 0;
    const isNewCards = state.community_cards.length > prevCommunityCount || isNewHand;
    const isPotIncreased = state.pot > prevPot;
    const isShowdownTransition = state.stage === "showdown" && prevStage !== "showdown";

    const me = state.players.find(p => p.id === myPlayerId);
    const mySeatOffset = me ? me.seat : 0;
    const isMyTurnNow =
        me &&
        !state.all_in_runout &&
        state.current_turn_seat === me.seat &&
        state.stage !== "waiting" &&
        state.stage !== "showdown" &&
        !me.folded &&
        !me.all_in;

    if (isShowdownTransition && state.winners.length > 0) {
        SoundFX.playWin();
    } else if (isNewCards) {
        SoundFX.playCard();
    } else if (isPotIncreased) {
        SoundFX.playChips();
    }

    if (isMyTurnNow && prevTurnSeat !== state.current_turn_seat) {
        SoundFX.playMyTurn();
    }

    if (isPotIncreased) {
        potContainerEl.classList.remove("pot-pulse");
        void potContainerEl.offsetWidth;
        potContainerEl.classList.add("pot-pulse");
        setTimeout(() => potContainerEl.classList.remove("pot-pulse"), 320);
    }

    clientStateReceivedAt = performance.now();
    clientTurnInitialRem = state.turn_remaining_secs ?? 45;
    clientNextHandInitialRem = state.next_hand_remaining_secs;
    clientLevelInitialRem = state.level_remaining_secs;

    roomState = state;
    roomTitleEl.textContent = state.room_name;

    const antePart = state.ante > 0 ? ` • Анте ${state.ante}` : "";
    roomBlindsBadge.textContent = `Ур. ${state.current_level} • ${state.small_blind}/${state.big_blind}${antePart}`;
    potAmountEl.textContent = state.pot;

    if (me) {
        sitOutBtn.textContent = me.sitting_out ? "☕ Вернуться за стол" : "☕ Отойти";
        sitOutBtn.classList.toggle("active", me.sitting_out);
    }
    pauseGameBtn.textContent = state.paused ? "▶️ Продолжить" : "⏸ Авто-раздача";
    pauseGameBtn.classList.toggle("active", !state.paused);

    const winningCardKeys = new Set();
    if (state.stage === "showdown" && state.winners.length > 0) {
        for (const w of state.winners) {
            if (w.winning_cards) {
                for (const wc of w.winning_cards) {
                    winningCardKeys.add(cardKey(wc));
                }
            }
        }
    }

    communityCardsEl.innerHTML = "";
    for (let i = 0; i < 5; i++) {
        if (i < state.community_cards.length) {
            const c = state.community_cards[i];
            const shouldAnimate = isNewHand || i >= prevCommunityCount;
            const el = renderCardElement(c, false, shouldAnimate, (i - prevCommunityCount) * 85, winningCardKeys);
            communityCardsEl.appendChild(el);
        } else {
            const slot = document.createElement("div");
            slot.className = "card-slot";
            communityCardsEl.appendChild(slot);
        }
    }

    const activeReadyCount = state.players.filter(p => p.connected && !p.sitting_out).length;
    const offlineCount = state.players.filter(p => !p.connected).length;
    const isIdleStage = state.stage === "waiting" || state.stage === "showdown";

    if (isIdleStage && activeReadyCount >= 2) {
        startHandBtn.classList.remove("hidden");
        startHandBtn.textContent = state.hand_number === 0 ? "🃏 Начать игру" : "🃏 Раздать сейчас";
    } else {
        startHandBtn.classList.add("hidden");
    }

    showCardsBtn.classList.toggle("hidden", !state.can_show_cards);
    kickOfflineBtn.classList.toggle("hidden", !(isIdleStage && offlineCount > 0));
    rebuyBtn.classList.toggle("hidden", !(me && isIdleStage && me.chips < state.starting_chips));

    updateCenterBannerText();

    const winnerIds = new Set(state.winners.map(w => w.player_id));

    for (let pos = 0; pos < 6; pos++) {
        const actualSeat = (mySeatOffset + pos) % 6;
        const player = state.players.find(p => p.seat === actualSeat);
        const seatEl = document.getElementById(`seat-slot-${pos}`);

        if (!player) {
            seatEl.classList.add("hidden");
            continue;
        }

        const isTurn = !state.all_in_runout && state.current_turn_seat === actualSeat && !isIdleStage;
        const isWinner = state.stage === "showdown" && winnerIds.has(player.id);

        seatEl.classList.remove("hidden");
        seatEl.classList.toggle("active-turn", isTurn);
        seatEl.classList.toggle("folded", player.folded);
        seatEl.classList.toggle("winner", isWinner);

        const dealerEl = document.getElementById(`seat-dealer-${pos}`);
        dealerEl.classList.toggle("hidden", state.dealer_seat !== actualSeat);

        const blindEl = document.getElementById(`seat-blind-${pos}`);
        if (state.small_blind_seat === actualSeat && !isIdleStage) {
            blindEl.textContent = "SB";
            blindEl.className = "blind-badge sb";
        } else if (state.big_blind_seat === actualSeat && !isIdleStage) {
            blindEl.textContent = "BB";
            blindEl.className = "blind-badge bb";
        } else {
            blindEl.className = "blind-badge hidden";
        }

        const nameEl = document.getElementById(`seat-name-${pos}`);
        nameEl.textContent = player.id === myPlayerId ? `${player.name} (Вы)` : player.name;

        const chipsEl = document.getElementById(`seat-chips-${pos}`);
        chipsEl.textContent = `${player.chips} 🪙`;

        // Тег действия / Победителя / Шанса на банк ТОЛЬКО при Олл-ин разыгровке!
        const actionEl = document.getElementById(`seat-action-${pos}`);
        actionEl.classList.remove("tag-win", "tag-equity");

        if (!player.connected) {
            actionEl.textContent = "Оффлайн";
            actionEl.classList.remove("hidden");
        } else if (player.sitting_out) {
            actionEl.textContent = "Отошел ☕";
            actionEl.classList.remove("hidden");
        } else if (isWinner) {
            const winInfo = state.winners.find(w => w.player_id === player.id);
            actionEl.textContent = `🏆 +${winInfo.amount} (${winInfo.hand_name})`;
            actionEl.classList.add("tag-win");
            actionEl.classList.remove("hidden");
        } else if (
            state.all_in_runout &&
            player.win_probability !== null &&
            player.win_probability !== undefined
        ) {
            // Шанс на банк показывается ТОЛЬКО когда никто уже не может поставить (идет разыгровка)
            const comboPart = player.hand_name ? ` • ${player.hand_name}` : "";
            actionEl.textContent = `🎲 Шанс: ${player.win_probability.toFixed(1)}%${comboPart}`;
            actionEl.classList.add("tag-equity");
            actionEl.classList.remove("hidden");
        } else if (player.hand_name && state.stage === "showdown") {
            actionEl.textContent = player.hand_name;
            actionEl.classList.remove("hidden");
        } else if (player.last_action) {
            actionEl.textContent = player.last_action;
            actionEl.classList.remove("hidden");
        } else {
            actionEl.classList.add("hidden");
        }

        const timerWrap = document.getElementById(`seat-timer-wrap-${pos}`);
        timerWrap.classList.toggle("hidden", !isTurn);

        const betEl = document.getElementById(`seat-bet-${pos}`);
        if (player.bet_in_round > 0) {
            betEl.textContent = `🪙 ${player.bet_in_round}`;
            betEl.classList.remove("hidden");
        } else {
            betEl.classList.add("hidden");
        }

        const cardsContainer = document.getElementById(`seat-cards-${pos}`);
        cardsContainer.innerHTML = "";
        player.hole_cards.forEach((c, idx) => {
            const animateHole =
                isNewHand ||
                ((state.stage === "showdown" || state.all_in_runout) &&
                    player.id !== myPlayerId &&
                    c !== null);
            cardsContainer.appendChild(renderCardElement(c, true, animateHole, idx * 70, winningCardKeys));
        });

        const videoEl = document.getElementById(`seat-video-${pos}`);
        const avatarEl = document.getElementById(`seat-avatar-${pos}`);
        avatarEl.textContent = player.name.charAt(0).toUpperCase();

        let streamToAttach = null;
        if (player.id === myPlayerId) {
            videoEl.muted = true;
            if ((videoEnabled || audioEnabled) && localStream) {
                streamToAttach = localStream;
            }
        } else {
            videoEl.muted = false;
            streamToAttach = remoteStreams.get(player.id) || null;
        }

        if (streamToAttach && (player.video_enabled || player.audio_enabled)) {
            if (videoEl.srcObject !== streamToAttach) {
                videoEl.srcObject = streamToAttach;
                videoEl.play().catch((err) => {
                    logMediaDiag("warn", `Автовоспроизведение потока от ${player.name} задержано браузером: ${err.message}`, false);
                });
            }
            videoEl.classList.toggle("active", player.video_enabled);
            avatarEl.classList.toggle("hidden", player.video_enabled);
        } else {
            if (videoEl.srcObject) {
                videoEl.srcObject = null;
            }
            videoEl.classList.remove("active");
            avatarEl.classList.remove("hidden");
        }
    }

    if (me) {
        const bbCount = state.big_blind > 0 ? Math.round(me.chips / state.big_blind) : 0;
        myStackBbLabel.textContent = `Ваша комбинация • Стек: ${bbCount} BB`;
        myHandRankEl.textContent =
            me.hand_name || (me.hole_cards.length === 2 && !me.folded ? "Карманные карты" : "—");
        updateActionControls(state, me);
    }

    if (state.log.length > lastLogCount) {
        const newLogs = state.log.slice(lastLogCount);
        for (const entry of newLogs) {
            appendSystemLog(entry);
        }
        lastLogCount = state.log.length;
    }

    prevHandNumber = state.hand_number;
    prevCommunityCount = state.community_cards.length;
    prevPot = state.pot;
    prevTurnSeat = state.current_turn_seat;
    prevStage = state.stage;

    syncWebrtcPeers(state.players);
}

function updateCenterBannerText() {
    if (!roomState) return;
    const elapsedSec = (performance.now() - clientStateReceivedAt) / 1000;
    const activeReadyCount = roomState.players.filter(p => p.connected && !p.sitting_out).length;

    const stageNames = {
        preflop: "Префлоп",
        flop: "Флоп",
        turn: "Тёрн",
        river: "Ривер",
        showdown: "Вскрытие"
    };
    const stageRu = stageNames[roomState.stage] || roomState.stage;

    if (roomState.stage === "waiting") {
        tableStatusBanner.textContent = activeReadyCount < 2
            ? "Ожидание друзей (нужно минимум 2 игрока)... Нажмите «🔗 Пригласить» сверху!"
            : "Все за столом! Нажмите «🃏 Начать игру».";
    } else if (roomState.all_in_runout) {
        tableStatusBanner.textContent = `🔥 ОЛЛ-ИН РАЗЫГРОВКА (${stageRu}) • Карты и шансы на банк открыты!`;
    } else if (roomState.stage === "showdown") {
        const winText = roomState.winners
            .map(w => `🏆 ${w.player_name} +${w.amount} (${w.hand_name})`)
            .join("  •  ");

        if (clientNextHandInitialRem !== null && clientNextHandInitialRem !== undefined && !roomState.paused) {
            const rem = Math.max(0, Math.ceil(clientNextHandInitialRem - elapsedSec));
            tableStatusBanner.textContent = `${winText}   |   ⏳ Следующая раздача через ${rem}с...`;
        } else if (roomState.paused) {
            tableStatusBanner.textContent = `${winText}   |   ⏸ Игра на паузе`;
        } else {
            tableStatusBanner.textContent = winText;
        }
    } else {
        const turnPlayer = roomState.players.find(p => p.seat === roomState.current_turn_seat);
        tableStatusBanner.textContent = turnPlayer
            ? `${stageRu} • Ход игрока: ${turnPlayer.name}`
            : stageRu;
    }
}

function renderCardElement(card, isSmall, animate, delayMs, winningCardKeys) {
    const el = document.createElement("div");
    if (!card) {
        el.className = `playing-card card-back${isSmall ? " card-sm" : ""}${animate ? " card-enter" : ""}`;
        if (animate && delayMs > 0) el.style.animationDelay = `${delayMs}ms`;
        return el;
    }

    const key = cardKey(card);
    let highlightClass = "";
    if (winningCardKeys && winningCardKeys.size > 0) {
        highlightClass = winningCardKeys.has(key) ? " winning-card" : " dimmed-card";
    }

    el.className = `playing-card suit-${card.suit}${isSmall ? " card-sm" : ""}${animate ? " card-enter" : ""}${highlightClass}`;
    if (animate && delayMs > 0) {
        el.style.animationDelay = `${delayMs}ms`;
    }
    el.innerHTML = `
        <div class="card-top">${card.label}${card.suit_symbol}</div>
        <div class="card-center-suit">${card.suit_symbol}</div>
    `;
    return el;
}

function startClientTickers() {
    setInterval(() => {
        if (!roomState) return;
        const elapsedSec = (performance.now() - clientStateReceivedAt) / 1000;

        if (clientLevelInitialRem !== null && clientLevelInitialRem !== undefined && roomState.next_small_blind) {
            const rem = Math.max(0, clientLevelInitialRem - elapsedSec);
            const nextAnte = roomState.next_ante > 0 ? `+${roomState.next_ante}` : "";
            roomLevelTimerEl.classList.remove("hidden");
            if (rem > 0) {
                roomLevelTimerEl.textContent = `⏱ ${formatMmSs(rem)} → ${roomState.next_small_blind}/${roomState.next_big_blind}${nextAnte}`;
            } else {
                roomLevelTimerEl.textContent = `📈 След. раздача: ${roomState.next_small_blind}/${roomState.next_big_blind}${nextAnte}`;
            }
        } else {
            roomLevelTimerEl.classList.add("hidden");
        }

        if (roomState.stage === "showdown") {
            updateCenterBannerText();
            return;
        }

        if (roomState.all_in_runout || roomState.current_turn_seat === null || roomState.current_turn_seat === undefined) {
            return;
        }
        if (roomState.stage === "waiting") return;

        const me = roomState.players.find(p => p.id === myPlayerId);
        const mySeatOffset = me ? me.seat : 0;
        const pos = (roomState.current_turn_seat - mySeatOffset + 6) % 6;
        const barEl = document.getElementById(`seat-timer-bar-${pos}`);
        if (!barEl) return;

        const remaining = Math.max(0, clientTurnInitialRem - elapsedSec);
        const total = roomState.turn_total_secs || 45;
        const pct = Math.min(100, Math.max(0, (remaining / total) * 100));

        barEl.style.width = `${pct}%`;
        barEl.classList.toggle("urgent", remaining <= 10);
    }, 250);
}

function showSeatReaction(playerId, emoji) {
    if (!roomState) return;
    const me = roomState.players.find(p => p.id === myPlayerId);
    const mySeatOffset = me ? me.seat : 0;
    const target = roomState.players.find(p => p.id === playerId);
    if (!target) return;

    const pos = (target.seat - mySeatOffset + 6) % 6;
    const layer = document.getElementById(`seat-emoji-${pos}`);
    if (!layer) return;

    const el = document.createElement("div");
    el.className = "floating-emoji";
    el.textContent = emoji;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2100);
}

document.querySelectorAll(".emoji-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const emoji = btn.dataset.emoji;
        if (emoji) {
            sendWs({ type: "reaction", emoji });
        }
    });
});

// =========================================================================
// УПРАВЛЕНИЕ СТАВКАМИ (БЕЗ ПОДСКАЗОК ШАНСОВ ВО ВРЕМЯ ТОРГОВЛИ)
// =========================================================================
function updateActionControls(state, me) {
    const isMyTurn =
        !state.all_in_runout &&
        state.current_turn_seat === me.seat &&
        state.stage !== "waiting" &&
        state.stage !== "showdown" &&
        !me.folded &&
        !me.all_in;

    actionControlsEl.classList.toggle("disabled", !isMyTurn);
    if (!isMyTurn) return;

    const toCall = Math.max(0, state.current_bet - me.bet_in_round);
    if (toCall === 0) {
        checkCallLabel.textContent = "Чек";
        actCheckCallBtn.dataset.mode = "check";
    } else if (toCall >= me.chips) {
        checkCallLabel.textContent = `Олл-ин (${me.chips})`;
        actCheckCallBtn.dataset.mode = "call";
    } else {
        checkCallLabel.textContent = `Колл (${toCall})`;
        actCheckCallBtn.dataset.mode = "call";
    }

    raiseBtnLabel.textContent = state.current_bet === 0 ? "Бет" : "Рейз";

    const maxTotalBet = me.bet_in_round + me.chips;
    const minRaiseTotal = Math.min(maxTotalBet, state.current_bet + state.min_raise);

    raiseSlider.min = minRaiseTotal;
    raiseSlider.max = maxTotalBet;
    raiseSlider.step = Math.max(1, state.small_blind);
    raiseSlider.value = minRaiseTotal;

    raiseInput.min = minRaiseTotal;
    raiseInput.max = maxTotalBet;
    raiseInput.value = minRaiseTotal;

    const canRaise = maxTotalBet > state.current_bet;
    actRaiseBtn.disabled = !canRaise;
    raiseSlider.disabled = !canRaise;
    raiseInput.disabled = !canRaise;
}

startHandBtn.addEventListener("click", () => sendWs({ type: "start_hand" }));
rebuyBtn.addEventListener("click", () => sendWs({ type: "rebuy" }));

actFoldBtn.addEventListener("click", () => {
    SoundFX.playCard();
    sendWs({ type: "action", action: "fold" });
});

actCheckCallBtn.addEventListener("click", () => {
    const mode = actCheckCallBtn.dataset.mode || "check";
    if (mode === "check") SoundFX.playCheck();
    sendWs({ type: "action", action: mode });
});

raiseSlider.addEventListener("input", () => {
    raiseInput.value = raiseSlider.value;
});

raiseInput.addEventListener("input", () => {
    raiseSlider.value = raiseInput.value;
});

actRaiseBtn.addEventListener("click", () => {
    const val = parseInt(raiseInput.value, 10);
    if (!isNaN(val)) {
        sendWs({ type: "action", action: "raise", amount: val });
    }
});

quickMinBtn.addEventListener("click", () => {
    raiseInput.value = raiseSlider.min;
    raiseSlider.value = raiseSlider.min;
});

quickHalfBtn.addEventListener("click", () => {
    if (!roomState) return;
    const target = Math.min(
        parseInt(raiseSlider.max, 10),
        Math.max(parseInt(raiseSlider.min, 10), roomState.current_bet + Math.floor(roomState.pot / 2))
    );
    raiseInput.value = target;
    raiseSlider.value = target;
});

quickPotBtn.addEventListener("click", () => {
    if (!roomState) return;
    const target = Math.min(
        parseInt(raiseSlider.max, 10),
        Math.max(parseInt(raiseSlider.min, 10), roomState.current_bet + roomState.pot)
    );
    raiseInput.value = target;
    raiseSlider.value = target;
});

quickAllinBtn.addEventListener("click", () => {
    raiseInput.value = raiseSlider.max;
    raiseSlider.value = raiseSlider.max;
});

window.addEventListener("keydown", (e) => {
    if (
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT")
    ) {
        return;
    }
    if (actionControlsEl.classList.contains("disabled")) return;

    const key = e.key.toLowerCase();
    if (key === "f" || key === "а") {
        e.preventDefault();
        actFoldBtn.click();
    } else if (key === "c" || key === "с" || key === " ") {
        e.preventDefault();
        actCheckCallBtn.click();
    } else if (key === "r" || key === "к") {
        e.preventDefault();
        if (!actRaiseBtn.disabled) actRaiseBtn.click();
    } else if (key === "a" || key === "ф") {
        e.preventDefault();
        sendWs({ type: "action", action: "all_in" });
    }
});

// =========================================================================
// ЧАТ И ЛОГ СОБЫТИЙ
// =========================================================================
chatForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    sendWs({ type: "chat", text });
    chatInput.value = "";
});

function appendSystemLog(text) {
    const div = document.createElement("div");
    div.className = "msg-system";
    div.textContent = text;
    chatMessagesEl.appendChild(div);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function appendChatMessage(author, text) {
    const div = document.createElement("div");
    div.className = "msg-chat";
    div.innerHTML = `<span class="author">${escapeHtml(author)}:</span>${escapeHtml(text)}`;
    chatMessagesEl.appendChild(div);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// =========================================================================
// P2P WebRTC ВИДЕО И АУДИО С ПОДРОБНЫМ ЛОГИРОВАНИЕМ ДИАГНОСТИКИ
// =========================================================================
let localStream = null;
let videoEnabled = false;
let audioEnabled = false;
const peerConnections = new Map();
const peerStates = new Map();
const remoteStreams = new Map();

const RTC_CONFIG = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
};

async function acquireTrack(kind) {
    const kindRu = kind === "video" ? "веб-камера" : "микрофон";

    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg = `Браузер заблокировал доступ к устройству (${kindRu}): страница открыта без HTTPS (${window.location.origin}). Для работы камеры по IP откройте https://${window.location.hostname}:8443`;
        logMediaDiag("error", msg, true);
        showToast(msg, true);
        return false;
    }

    if (!localStream) {
        localStream = new MediaStream();
    }
    const existing = kind === "video" ? localStream.getVideoTracks() : localStream.getAudioTracks();
    if (existing.length > 0) {
        existing.forEach(t => (t.enabled = true));
        logMediaDiag("ok", `Возобновлен существующий трек (${kindRu}): ${existing[0].label || "default"}`);
        return true;
    }

    logMediaDiag("info", `Запрос разрешения браузера на устройство: ${kindRu}...`, false);

    try {
        const constraints =
            kind === "video"
                ? { video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 } } }
                : { audio: { echoCancellation: true, noiseSuppression: true } };

        let tempStream;
        try {
            tempStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (firstErr) {
            if (kind === "video" && (firstErr.name === "OverconstrainedError" || firstErr.name === "ConstraintNotSatisfiedError")) {
                logMediaDiag("warn", `Камера не поддержала 320x240 (${firstErr.name}), пробуем стандартный видеорежим...`);
                tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            } else {
                throw firstErr;
            }
        }

        tempStream.getTracks().forEach((track) => {
            const settings = track.getSettings ? track.getSettings() : {};
            const resInfo = settings.width ? ` (${settings.width}x${settings.height})` : "";
            logMediaDiag("ok", `Успешно подключено устройство [${kindRu}]: "${track.label || "Устройство по умолчанию"}"${resInfo}`);

            track.onended = () => {
                logMediaDiag("error", `Трек [${kindRu}] "${track.label}" неожиданно завершился (устройство отключено или перехвачено системой).`);
            };
            track.onmute = () => {
                logMediaDiag("warn", `Трек [${kindRu}] "${track.label}" временно заглушен системой (onmute).`, false);
            };
            track.onunmute = () => {
                logMediaDiag("info", `Трек [${kindRu}] "${track.label}" снова активен (onunmute).`, false);
            };

            localStream.addTrack(track);
        });
        return true;
    } catch (err) {
        const detailed = explainMediaError(err, kindRu);
        logMediaDiag("error", detailed, true);
        showToast(detailed, true);
        return false;
    }
}

function updateMediaButtonsUI() {
    toggleCamBtn.textContent = videoEnabled ? "📷 Камера: ВКЛ" : "📷 Камера: ВЫКЛ";
    toggleCamBtn.classList.toggle("active", videoEnabled);

    toggleMicBtn.textContent = audioEnabled ? "🎤 Микрофон: ВКЛ" : "🎤 Микрофон: ВЫКЛ";
    toggleMicBtn.classList.toggle("active", audioEnabled);
}

async function syncLocalMediaAndRenegotiate() {
    updateMediaButtonsUI();

    if (!videoEnabled && !audioEnabled) {
        logMediaDiag("info", "Камера и микрофон выключены пользователем.");
        stopLocalMedia();
    } else if (localStream) {
        localStream.getVideoTracks().forEach(t => (t.enabled = videoEnabled));
        localStream.getAudioTracks().forEach(t => (t.enabled = audioEnabled));

        for (const [peerId, pc] of peerConnections.entries()) {
            attachLocalTracksToPc(pc);
            await negotiateWithPeer(peerId, pc);
        }
    }

    sendWs({
        type: "media_state",
        video: videoEnabled,
        audio: audioEnabled
    });

    if (roomState) {
        handleRoomStateUpdate(roomState);
    }
}

toggleCamBtn.addEventListener("click", async () => {
    if (!videoEnabled) {
        const ok = await acquireTrack("video");
        if (!ok) return;
        videoEnabled = true;
    } else {
        videoEnabled = false;
    }
    await syncLocalMediaAndRenegotiate();
});

toggleMicBtn.addEventListener("click", async () => {
    if (!audioEnabled) {
        const ok = await acquireTrack("audio");
        if (!ok) return;
        audioEnabled = true;
    } else {
        audioEnabled = false;
    }
    await syncLocalMediaAndRenegotiate();
});

function stopLocalMedia() {
    if (localStream) {
        for (const track of localStream.getTracks()) {
            track.stop();
        }
        localStream = null;
    }
    videoEnabled = false;
    audioEnabled = false;
    updateMediaButtonsUI();
    refreshDiagSummary();
}

function getOrCreatePeerConnection(peerId) {
    if (peerConnections.has(peerId)) {
        return peerConnections.get(peerId);
    }

    const peerName = getPeerName(peerId);
    logMediaDiag("info", `Создание P2P-соединения с игроком "${peerName}"...`, false);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnections.set(peerId, pc);
    peerStates.set(peerId, { makingOffer: false, ignoreOffer: false });

    attachLocalTracksToPc(pc);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWs({
                type: "webrtc_signal",
                target_id: peerId,
                signal_type: "ice",
                payload: event.candidate
            });
        }
    };

    pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        const pName = getPeerName(peerId);
        if (st === "connected" || st === "completed") {
            logMediaDiag("ok", `P2P видео/аудио канал с "${pName}" успешно установлен (${st})!`, false);
        } else if (st === "failed" || st === "disconnected") {
            logMediaDiag(
                "warn",
                `P2P соединение с "${pName}" перешло в статус "${st}". Пробуем перезапустить ICE...`
            );
            if (typeof pc.restartIce === "function") {
                pc.restartIce();
                negotiateWithPeer(peerId, pc);
            }
        }
    };

    pc.ontrack = (event) => {
        const pName = getPeerName(peerId);
        logMediaDiag("ok", `Получен входящий медиа-трек (${event.track.kind}) от игрока "${pName}".`, false);

        let stream = event.streams && event.streams[0];
        if (!stream) {
            stream = remoteStreams.get(peerId) || new MediaStream();
            stream.addTrack(event.track);
        }
        remoteStreams.set(peerId, stream);
        if (roomState) {
            handleRoomStateUpdate(roomState);
        }
    };

    pc.onconnectionstatechange = () => {
        if (pc.connectionState === "closed") {
            closePeer(peerId);
        }
    };

    return pc;
}

function attachLocalTracksToPc(pc) {
    if (!localStream) return;
    const senders = pc.getSenders();
    for (const track of localStream.getTracks()) {
        const alreadySent = senders.some(s => s.track === track);
        if (!alreadySent) {
            pc.addTrack(track, localStream);
        }
    }
}

async function negotiateWithPeer(peerId, pc) {
    const state = peerStates.get(peerId);
    if (!state || state.makingOffer) return;
    try {
        state.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== "stable") return;
        await pc.setLocalDescription(offer);
        sendWs({
            type: "webrtc_signal",
            target_id: peerId,
            signal_type: "offer",
            payload: pc.localDescription
        });
    } catch (e) {
        logMediaDiag("error", `Ошибка согласования P2P (Offer) с "${getPeerName(peerId)}": ${e.message}`);
    } finally {
        state.makingOffer = false;
    }
}

function syncWebrtcPeers(players) {
    const activeIds = new Set(players.filter(p => p.connected && p.id !== myPlayerId).map(p => p.id));

    for (const peerId of peerConnections.keys()) {
        if (!activeIds.has(peerId)) {
            closePeer(peerId);
        }
    }

    for (const p of players) {
        if (p.id === myPlayerId || !p.connected) continue;
        const shouldConnect = videoEnabled || audioEnabled || p.video_enabled || p.audio_enabled;
        if (shouldConnect && !peerConnections.has(p.id)) {
            const pc = getOrCreatePeerConnection(p.id);
            if (myPlayerId < p.id || videoEnabled || audioEnabled) {
                negotiateWithPeer(p.id, pc);
            }
        }
    }
}

async function handleWebrtcSignal(fromId, signalType, payload) {
    const pc = getOrCreatePeerConnection(fromId);
    const state = peerStates.get(fromId);
    const polite = myPlayerId < fromId;

    try {
        if (signalType === "offer" || signalType === "answer") {
            const description = new RTCSessionDescription(payload);
            const offerCollision =
                signalType === "offer" &&
                (state.makingOffer || pc.signalingState !== "stable");

            state.ignoreOffer = !polite && offerCollision;
            if (state.ignoreOffer) {
                logMediaDiag("info", `Разрешение коллизии Offer с "${getPeerName(fromId)}" (impolite peer).`, false);
                return;
            }

            await pc.setRemoteDescription(description);
            if (signalType === "offer") {
                attachLocalTracksToPc(pc);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                sendWs({
                    type: "webrtc_signal",
                    target_id: fromId,
                    signal_type: "answer",
                    payload: pc.localDescription
                });
            }
        } else if (signalType === "ice") {
            if (payload) {
                try {
                    await pc.addIceCandidate(new RTCIceCandidate(payload));
                } catch (err) {
                    if (!state.ignoreOffer) {
                        logMediaDiag("warn", `Предупреждение ICE от "${getPeerName(fromId)}": ${err.message}`, false);
                    }
                }
            }
        }
    } catch (e) {
        logMediaDiag("error", `Ошибка обработки WebRTC сигнала (${signalType}) от "${getPeerName(fromId)}": ${e.message}`);
    }
}

function closePeer(peerId) {
    const pc = peerConnections.get(peerId);
    if (pc) {
        pc.close();
        peerConnections.delete(peerId);
    }
    peerStates.delete(peerId);
    remoteStreams.delete(peerId);
}

function cleanupAllPeers() {
    for (const peerId of Array.from(peerConnections.keys())) {
        closePeer(peerId);
    }
}
