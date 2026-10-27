// =========================================================================
// КОНСТАНТЫ И ХРАНИЛИЩЕ ПРОФИЛЯ
// =========================================================================
const STORAGE_KEY_ID = "rustholdem_player_id";
const STORAGE_KEY_NAME = "rustholdem_player_name";
const STORAGE_KEY_THEME = "rustholdem_theme";
const STORAGE_KEY_SCALE = "rustholdem_ui_scale";
const STORAGE_KEY_SOUND = "rustholdem_sound";
const STORAGE_KEY_CHAT_HIDDEN = "rustholdem_chat_hidden";
const STORAGE_KEY_AVATAR = "rustholdem_player_avatar";

let myPlayerId = localStorage.getItem(STORAGE_KEY_ID);
if (!myPlayerId) {
    myPlayerId = "p_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem(STORAGE_KEY_ID, myPlayerId);
}

let myPlayerName = localStorage.getItem(STORAGE_KEY_NAME) || "";
let myAvatarUrl = localStorage.getItem(STORAGE_KEY_AVATAR) || null;
let currentRoomId = null;
let ws = null;
let roomState = null;
let lastRenderedLogs = [];
let intentionalLeave = false;

// Отслеживание изменений для плавных анимаций, звуков и локальных таймеров
let prevHandNumber = 0;
let prevCommunityCount = 0;
let prevPot = 0;
let prevTurnSeat = null;
let prevStage = "waiting";
let prevMyHandName = null;
let prevAllInCount = 0;
const prevPlayerChips = new Map();
let unreadChatCount = 0;
let spotlightTimer = null;
let clientStateReceivedAt = 0;
let clientTurnInitialRem = 45;
let clientNextHandInitialRem = null;
let clientLevelInitialRem = null;
let lastTimerSoundKey = "";

// Преднажатие кнопок (предход)
let selectedPreAction = null; // "check_fold" | "check" | "fold" | "call_exact" | "call_any" | null
let preActionTargetBet = 0;
let preActionTimer = null;

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
    playChatNotify() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        [587.33, 880].forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, now + idx * 0.065);
            gain.gain.setValueAtTime(0.08, now + idx * 0.065);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.14);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.065);
            osc.stop(now + idx * 0.065 + 0.15);
        });
    },
    playAllIn() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(160, now);
        osc.frequency.exponentialRampToValueAtTime(580, now + 0.38);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.44);
    },
    playComboUpgrade() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        [659.25, 880, 1174.66].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, now + i * 0.055);
            gain.gain.setValueAtTime(0.08, now + i * 0.055);
            gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.22);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + i * 0.055);
            osc.stop(now + i * 0.055 + 0.23);
        });
    },
    playKnockout() {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;

        // 1. Мощный суб-басовый удар (Bass Drop)
        const sub = ctx.createOscillator();
        const subGain = ctx.createGain();
        sub.type = "sawtooth";
        sub.frequency.setValueAtTime(170, now);
        sub.frequency.exponentialRampToValueAtTime(32, now + 0.65);
        subGain.gain.setValueAtTime(0.24, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.68);
        sub.connect(subGain);
        subGain.connect(ctx.destination);
        sub.start(now);
        sub.stop(now + 0.7);

        // 2. Драматичный низкий гонг нокаута
        [220, 277.18, 329.63].forEach((freq) => {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = "triangle";
            osc.frequency.setValueAtTime(freq, now + 0.06);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.88, now + 0.75);
            g.gain.setValueAtTime(0.11, now + 0.06);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.78);
            osc.connect(g);
            g.connect(ctx.destination);
            osc.start(now + 0.06);
            osc.stop(now + 0.8);
        });
    },
    playComboWin(handName) {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        const h = handName || "";

        if (h === "Каре" || h === "Стрит-флеш" || h === "Роял-флеш") {
            // Эпичная джекпот-фанфара для монстр-комбинаций!
            const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0];
            notes.forEach((freq, idx) => {
                ["triangle", "sawtooth"].forEach((wave, wIdx) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = wave;
                    osc.frequency.setValueAtTime(freq * (wIdx === 1 ? 0.5 : 1), now + idx * 0.075);
                    gain.gain.setValueAtTime(wIdx === 1 ? 0.07 : 0.14, now + idx * 0.075);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.075 + 0.55);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(now + idx * 0.075);
                    osc.stop(now + idx * 0.075 + 0.56);
                });
            });
        } else if (h === "Фулл-хаус") {
            // Торжественный медный аккорд Фулл-хауса
            const seq = [
                { f: 392.0, t: 0 },
                { f: 523.25, t: 0.09 },
                { f: 659.25, t: 0.18 },
                { f: 783.99, t: 0.27 },
                { f: 1046.5, t: 0.38 }
            ];
            seq.forEach(({ f, t }) => {
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();
                osc1.type = "triangle";
                osc2.type = "sawtooth";
                osc1.frequency.setValueAtTime(f, now + t);
                osc2.frequency.setValueAtTime(f * 0.5, now + t);
                gain.gain.setValueAtTime(0.13, now + t);
                gain.gain.exponentialRampToValueAtTime(0.001, now + t + 0.45);
                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);
                osc1.start(now + t);
                osc2.start(now + t);
                osc1.stop(now + t + 0.46);
                osc2.stop(now + t + 0.46);
            });
        } else if (h === "Флеш") {
            // Переливающийся кристальный каскад для Флеша
            [587.33, 739.99, 880, 1174.66, 1479.98].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, now + idx * 0.06);
                gain.gain.setValueAtTime(0.13, now + idx * 0.06);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.42);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.06);
                osc.stop(now + idx * 0.06 + 0.43);
            });
        } else if (h === "Стрит") {
            // Восходящая ступенчатая гамма из 5 нот для Стрита
            [523.25, 587.33, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "triangle";
                osc.frequency.setValueAtTime(freq, now + idx * 0.065);
                gain.gain.setValueAtTime(0.13, now + idx * 0.065);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.065 + 0.32);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.065);
                osc.stop(now + idx * 0.065 + 0.33);
            });
        } else if (h === "Сет (Тройка)") {
            // Бодрый тройной импульс для Сета
            [659.25, 783.99, 987.77, 1318.51].forEach((freq, idx) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = "triangle";
                osc.frequency.setValueAtTime(freq, now + idx * 0.075);
                gain.gain.setValueAtTime(0.13, now + idx * 0.075);
                gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.075 + 0.34);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now + idx * 0.075);
                osc.stop(now + idx * 0.075 + 0.35);
            });
        } else {
            // Классический мягкий победный аккорд (Старшая карта, Пара, Две пары)
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
    },
    playTimerTick(secLeft, isMyTurn) {
        const ctx = getAudioCtx();
        if (!ctx) return;
        const now = ctx.currentTime;
        const urgent = secLeft <= 5;
        const baseFreq = urgent ? (isMyTurn ? 987.77 : 783.99) : (isMyTurn ? 740 : 587.33);
        const vol = isMyTurn ? (urgent ? 0.14 : 0.09) : (urgent ? 0.055 : 0.035);
        const pulses = urgent && isMyTurn ? [0, 0.11] : [0];
        pulses.forEach((offset, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = urgent ? "triangle" : "sine";
            osc.frequency.setValueAtTime(baseFreq * (idx === 1 ? 1.18 : 1), now + offset);
            gain.gain.setValueAtTime(vol, now + offset);
            gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.085);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + offset);
            osc.stop(now + offset + 0.09);
        });
    }
};

// =========================================================================
// ЭЛЕМЕНТЫ DOM
// =========================================================================
const lobbyScreen = document.getElementById("lobby-screen");
const gameScreen = document.getElementById("game-screen");
const playerNameInput = document.getElementById("player-name-input");
const lobbyAvatarBox = document.getElementById("lobby-avatar-box");
const lobbyAvatarImg = document.getElementById("lobby-avatar-img");
const lobbyAvatarLetter = document.getElementById("lobby-avatar-letter");
const lobbyUploadAvatarBtn = document.getElementById("lobby-upload-avatar-btn");
const lobbyClearAvatarBtn = document.getElementById("lobby-clear-avatar-btn");
const avatarFileInput = document.getElementById("avatar-file-input");
const tableUploadAvatarBtn = document.getElementById("table-upload-avatar-btn");

const avatarCropModal = document.getElementById("avatar-crop-modal");
const closeCropModalBtn = document.getElementById("close-crop-modal-btn");
const cropFitBtn = document.getElementById("crop-fit-btn");
const cropFillBtn = document.getElementById("crop-fill-btn");
const cropResetBtn = document.getElementById("crop-reset-btn");
const cropCanvasWrap = document.getElementById("crop-canvas-wrap");
const avatarCropCanvas = document.getElementById("avatar-crop-canvas");
const avatarZoomSlider = document.getElementById("avatar-zoom-slider");
const avatarZoomLabel = document.getElementById("avatar-zoom-label");
const deleteCurrentAvatarBtn = document.getElementById("delete-current-avatar-btn");
const cancelCropBtn = document.getElementById("cancel-crop-btn");
const saveCropBtn = document.getElementById("save-crop-btn");

const lastHandBtn = document.getElementById("last-hand-btn");
const lastHandModal = document.getElementById("last-hand-modal");
const lastHandTitleEl = document.getElementById("last-hand-title");
const closeLastHandBtn = document.getElementById("close-last-hand-btn");
const lastHandBodyEl = document.getElementById("last-hand-body");

const nicknameModal = document.getElementById("nickname-modal");
const closeNickModalBtn = document.getElementById("close-nick-modal-btn");
const cancelNickBtn = document.getElementById("cancel-nick-btn");
const nicknameForm = document.getElementById("nickname-form");
const nicknameModalInput = document.getElementById("nickname-modal-input");

const preActionBarEl = document.getElementById("pre-action-bar");
const preCheckFoldBtn = document.getElementById("pre-check-fold-btn");
const preCheckBtn = document.getElementById("pre-check-btn");
const preFoldBtn = document.getElementById("pre-fold-btn");
const preCallExactBtn = document.getElementById("pre-call-exact-btn");
const preCallExactLabel = document.getElementById("pre-call-exact-label");
const preCallAnyBtn = document.getElementById("pre-call-any-btn");
const roomsListEl = document.getElementById("rooms-list");
const refreshRoomsBtn = document.getElementById("refresh-rooms-btn");
const createRoomBtn = document.getElementById("create-room-btn");
const presetSelect = document.getElementById("new-room-preset");
const rebuyModeSelect = document.getElementById("new-room-rebuy-mode");
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
const uiScaleSelect = document.getElementById("ui-scale-select");
const toggleSoundBtn = document.getElementById("toggle-sound-btn");
const toggleCamBtn = document.getElementById("toggle-cam-btn");
const toggleMicBtn = document.getElementById("toggle-mic-btn");
const openDiagBtn = document.getElementById("open-diag-btn");
const toggleChatBtn = document.getElementById("toggle-chat-btn");
const chatUnreadBadge = document.getElementById("chat-unread-badge");
const closeSidebarBtn = document.getElementById("close-sidebar-btn");
const tableArenaEl = document.getElementById("table-arena");
const chatMiniPopupsEl = document.getElementById("chat-mini-popups");
const fxParticlesLayer = document.getElementById("fx-particles-layer");
const comboSpotlightBanner = document.getElementById("combo-spotlight-banner");
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

    const savedScale = localStorage.getItem(STORAGE_KEY_SCALE) || "1";
    document.documentElement.style.setProperty("--ui-seat-scale", savedScale);
    if (uiScaleSelect) {
        uiScaleSelect.value = savedScale;
    }

    const savedChatHidden = localStorage.getItem(STORAGE_KEY_CHAT_HIDDEN) === "1";
    setChatCollapsed(savedChatHidden);

    toggleSoundBtn.textContent = soundEnabled ? "🔊 Звук" : "🔇 Без звука";
    toggleSoundBtn.classList.toggle("active", soundEnabled);

    refreshAvatarUI();
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
        if (rebuyModeSelect) rebuyModeSelect.value = "manual";
    } else {
        levelMinsGroup.classList.remove("hidden");
        if (rebuyModeSelect) rebuyModeSelect.value = "freezeout";
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

if (uiScaleSelect) {
    uiScaleSelect.addEventListener("change", () => {
        const scale = uiScaleSelect.value || "1";
        document.documentElement.style.setProperty("--ui-seat-scale", scale);
        localStorage.setItem(STORAGE_KEY_SCALE, scale);
    });
}

function setChatCollapsed(collapsed) {
    if (!tableArenaEl || !toggleChatBtn) return;
    tableArenaEl.classList.toggle("chat-collapsed", collapsed);
    toggleChatBtn.classList.toggle("active", !collapsed);
    localStorage.setItem(STORAGE_KEY_CHAT_HIDDEN, collapsed ? "1" : "0");

    if (!collapsed) {
        unreadChatCount = 0;
        if (chatUnreadBadge) {
            chatUnreadBadge.textContent = "0";
            chatUnreadBadge.classList.add("hidden");
        }
        if (chatMiniPopupsEl) {
            chatMiniPopupsEl.innerHTML = "";
        }
        if (chatMessagesEl) {
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
        }
    }
}

if (toggleChatBtn) {
    toggleChatBtn.addEventListener("click", () => {
        const isCollapsed = tableArenaEl.classList.contains("chat-collapsed");
        setChatCollapsed(!isCollapsed);
    });
}

if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener("click", () => {
        setChatCollapsed(true);
    });
}

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
    refreshAvatarUI();
    return name;
}

playerNameInput.addEventListener("input", refreshAvatarUI);

function refreshAvatarUI() {
    const letter = (playerNameInput.value.trim() || myPlayerName || "И").charAt(0).toUpperCase();
    if (lobbyAvatarLetter) {
        lobbyAvatarLetter.textContent = letter;
    }
    const hasPhoto = Boolean(myAvatarUrl && myAvatarUrl.startsWith("data:image/"));
    if (lobbyAvatarImg && lobbyAvatarLetter) {
        if (hasPhoto) {
            lobbyAvatarImg.src = myAvatarUrl;
            lobbyAvatarImg.classList.remove("hidden");
            lobbyAvatarLetter.classList.add("hidden");
        } else {
            lobbyAvatarImg.removeAttribute("src");
            lobbyAvatarImg.classList.add("hidden");
            lobbyAvatarLetter.classList.remove("hidden");
        }
    }
    if (lobbyUploadAvatarBtn) {
        lobbyUploadAvatarBtn.textContent = hasPhoto ? "🖼 Сменить фото" : "🖼 Фото профиля";
    }
    if (lobbyClearAvatarBtn) {
        lobbyClearAvatarBtn.classList.toggle("hidden", !hasPhoto);
    }
    if (tableUploadAvatarBtn) {
        tableUploadAvatarBtn.textContent = hasPhoto ? "🖼 Сменить фото" : "🖼 Загрузить фото";
        tableUploadAvatarBtn.classList.toggle("active", hasPhoto);
    }
}

function triggerAvatarPicker() {
    if (avatarFileInput) {
        avatarFileInput.value = "";
        avatarFileInput.click();
    }
}

if (lobbyAvatarBox) lobbyAvatarBox.addEventListener("click", triggerAvatarPicker);
if (lobbyUploadAvatarBtn) lobbyUploadAvatarBtn.addEventListener("click", triggerAvatarPicker);
if (tableUploadAvatarBtn) {
    tableUploadAvatarBtn.addEventListener("click", triggerAvatarPicker);
    tableUploadAvatarBtn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (myAvatarUrl) {
            saveAndSyncAvatar(null);
            showToast("Фото профиля удалено");
        }
    });
}
if (lobbyClearAvatarBtn) {
    lobbyClearAvatarBtn.addEventListener("click", () => {
        saveAndSyncAvatar(null);
        showToast("Фото профиля удалено");
    });
}

// =========================================================================
// ИНТЕРАКТИВНЫЙ РЕДАКТОР ФОТО (БЕЗ ОБРЕЗКИ ИЛИ С РУЧНЫМ МАСШТАБИРОВАНИЕМ)
// =========================================================================
let cropSourceImg = null;
let cropMode = "fit"; // "fit" (вписать целиком без обрезки) | "fill" (заполнить 4:3)
let cropZoomPct = 100;
let cropPanX = 0;
let cropPanY = 0;
let isDraggingCrop = false;
let cropDragStartX = 0;
let cropDragStartY = 0;

function openAvatarCropModal(img) {
    cropSourceImg = img;
    cropMode = "fit"; // По умолчанию — без обрезки (вписать целиком)
    cropZoomPct = 100;
    cropPanX = 0;
    cropPanY = 0;
    if (avatarZoomSlider) avatarZoomSlider.value = "100";
    if (avatarZoomLabel) avatarZoomLabel.textContent = "100%";
    if (cropFitBtn) cropFitBtn.classList.add("active");
    if (cropFillBtn) cropFillBtn.classList.remove("active");
    if (deleteCurrentAvatarBtn) {
        deleteCurrentAvatarBtn.classList.toggle("hidden", !myAvatarUrl);
    }
    if (avatarCropModal) {
        avatarCropModal.classList.remove("hidden");
    }
    drawCropPreview();
}

function closeAvatarCropModal() {
    if (avatarCropModal) {
        avatarCropModal.classList.add("hidden");
    }
    cropSourceImg = null;
}

function drawImageOnCanvas(ctx, w, h, img) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#080d18";
    ctx.fillRect(0, 0, w, h);

    if (!img) return;

    // 1. Мягкий атмосферный фон из того же фото (чтобы при режиме "Без обрезки" края смотрелись стильно)
    const bgScale = Math.max(w / img.width, h / img.height) * 1.08;
    const bgW = img.width * bgScale;
    const bgH = img.height * bgScale;
    ctx.save();
    ctx.globalAlpha = 0.26;
    if ("filter" in ctx) {
        ctx.filter = "blur(7px)";
    }
    ctx.drawImage(img, (w - bgW) / 2, (h - bgH) / 2, bgW, bgH);
    ctx.restore();

    // 2. Основное изображение с учетом выбранного режима (fit / fill), масштаба и сдвига мышкой
    const baseScale =
        cropMode === "fit"
            ? Math.min(w / img.width, h / img.height)
            : Math.max(w / img.width, h / img.height);
    const finalScale = baseScale * (cropZoomPct / 100);
    const drawW = img.width * finalScale;
    const drawH = img.height * finalScale;

    const previewW = avatarCropCanvas ? avatarCropCanvas.width : 336;
    const ratio = w / previewW;
    const dx = (w - drawW) / 2 + cropPanX * ratio;
    const dy = (h - drawH) / 2 + cropPanY * ratio;

    ctx.drawImage(img, dx, dy, drawW, drawH);
}

function drawCropPreview() {
    if (!avatarCropCanvas || !cropSourceImg) return;
    const ctx = avatarCropCanvas.getContext("2d");
    drawImageOnCanvas(ctx, avatarCropCanvas.width, avatarCropCanvas.height, cropSourceImg);
}

if (cropFitBtn) {
    cropFitBtn.addEventListener("click", () => {
        cropMode = "fit";
        cropPanX = 0;
        cropPanY = 0;
        cropFitBtn.classList.add("active");
        if (cropFillBtn) cropFillBtn.classList.remove("active");
        drawCropPreview();
    });
}

if (cropFillBtn) {
    cropFillBtn.addEventListener("click", () => {
        cropMode = "fill";
        cropPanX = 0;
        cropPanY = 0;
        cropFillBtn.classList.add("active");
        if (cropFitBtn) cropFitBtn.classList.remove("active");
        drawCropPreview();
    });
}

if (cropResetBtn) {
    cropResetBtn.addEventListener("click", () => {
        cropZoomPct = 100;
        cropPanX = 0;
        cropPanY = 0;
        if (avatarZoomSlider) avatarZoomSlider.value = "100";
        if (avatarZoomLabel) avatarZoomLabel.textContent = "100%";
        drawCropPreview();
    });
}

if (avatarZoomSlider) {
    avatarZoomSlider.addEventListener("input", () => {
        cropZoomPct = parseInt(avatarZoomSlider.value, 10) || 100;
        if (avatarZoomLabel) avatarZoomLabel.textContent = `${cropZoomPct}%`;
        drawCropPreview();
    });
}

if (cropCanvasWrap) {
    cropCanvasWrap.addEventListener("pointerdown", (e) => {
        if (!cropSourceImg) return;
        isDraggingCrop = true;
        cropDragStartX = e.clientX - cropPanX;
        cropDragStartY = e.clientY - cropPanY;
        cropCanvasWrap.setPointerCapture(e.pointerId);
    });
    cropCanvasWrap.addEventListener("pointermove", (e) => {
        if (!isDraggingCrop || !cropSourceImg) return;
        cropPanX = e.clientX - cropDragStartX;
        cropPanY = e.clientY - cropDragStartY;
        drawCropPreview();
    });
    const stopDrag = () => {
        isDraggingCrop = false;
    };
    cropCanvasWrap.addEventListener("pointerup", stopDrag);
    cropCanvasWrap.addEventListener("pointercancel", stopDrag);

    cropCanvasWrap.addEventListener(
        "wheel",
        (e) => {
            if (!cropSourceImg) return;
            e.preventDefault();
            const delta = e.deltaY < 0 ? 8 : -8;
            cropZoomPct = Math.min(320, Math.max(100, cropZoomPct + delta));
            if (avatarZoomSlider) avatarZoomSlider.value = String(cropZoomPct);
            if (avatarZoomLabel) avatarZoomLabel.textContent = `${cropZoomPct}%`;
            drawCropPreview();
        },
        { passive: false }
    );
}

if (closeCropModalBtn) closeCropModalBtn.addEventListener("click", closeAvatarCropModal);
if (cancelCropBtn) cancelCropBtn.addEventListener("click", closeAvatarCropModal);

if (deleteCurrentAvatarBtn) {
    deleteCurrentAvatarBtn.addEventListener("click", () => {
        saveAndSyncAvatar(null);
        closeAvatarCropModal();
        showToast("Фото профиля удалено");
    });
}

if (saveCropBtn) {
    saveCropBtn.addEventListener("click", () => {
        if (!cropSourceImg) return;
        const outCanvas = document.createElement("canvas");
        outCanvas.width = 184;
        outCanvas.height = 138;
        const outCtx = outCanvas.getContext("2d");
        drawImageOnCanvas(outCtx, outCanvas.width, outCanvas.height, cropSourceImg);
        const dataUrl = outCanvas.toDataURL("image/jpeg", 0.80);
        saveAndSyncAvatar(dataUrl);
        closeAvatarCropModal();
        showToast("Фото профиля сохранено и обновлено за столом!");
    });
}

if (avatarFileInput) {
    avatarFileInput.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => showToast("Ошибка чтения файла изображения", true);
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => showToast("Выбранный файл не является изображением", true);
            img.onload = () => {
                openAvatarCropModal(img);
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });
}

function saveAndSyncAvatar(dataUrl) {
    myAvatarUrl = dataUrl;
    if (dataUrl) {
        localStorage.setItem(STORAGE_KEY_AVATAR, dataUrl);
    } else {
        localStorage.removeItem(STORAGE_KEY_AVATAR);
    }
    refreshAvatarUI();
    sendWs({
        type: "update_avatar",
        avatar_url: myAvatarUrl
    });
}

// =========================================================================
// СМЕНА НИКНЕЙМА ПРЯМО В ИГРЕ (ПО КЛИКУ НА СВОЙ НИК)
// =========================================================================
function openNicknameModal() {
    if (!nicknameModal || !nicknameModalInput) return;
    nicknameModalInput.value = myPlayerName || playerNameInput.value.trim() || "";
    nicknameModal.classList.remove("hidden");
    setTimeout(() => {
        nicknameModalInput.focus();
        nicknameModalInput.select();
    }, 30);
}

function closeNicknameModal() {
    if (nicknameModal) {
        nicknameModal.classList.add("hidden");
    }
}

if (closeNickModalBtn) closeNickModalBtn.addEventListener("click", closeNicknameModal);
if (cancelNickBtn) cancelNickBtn.addEventListener("click", closeNicknameModal);

if (nicknameForm) {
    nicknameForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const newName = (nicknameModalInput.value || "").trim().slice(0, 20);
        if (!newName) {
            showToast("Никнейм не может быть пустым", true);
            return;
        }
        myPlayerName = newName;
        playerNameInput.value = newName;
        localStorage.setItem(STORAGE_KEY_NAME, newName);
        refreshAvatarUI();
        sendWs({
            type: "update_name",
            name: newName
        });
        closeNicknameModal();
        showToast(`Ваш никнейм изменен на «${newName}»`);
    });
}

// =========================================================================
// ПРОСМОТР ИТОГОВ ПРОШЛОЙ РАЗДАЧИ (КАРТЫ, ПОБЕДИТЕЛИ, ЛОГ)
// =========================================================================
function openLastHandModal() {
    if (!lastHandModal) return;
    renderLastHandModal(roomState ? roomState.last_hand_summary : null);
    lastHandModal.classList.remove("hidden");
}

function closeLastHandModal() {
    if (lastHandModal) {
        lastHandModal.classList.add("hidden");
    }
}

if (lastHandBtn) lastHandBtn.addEventListener("click", openLastHandModal);
if (closeLastHandBtn) closeLastHandBtn.addEventListener("click", closeLastHandModal);

function renderLastHandModal(summary) {
    if (!lastHandBodyEl) return;
    if (!summary) {
        if (lastHandTitleEl) lastHandTitleEl.textContent = "📜 Итоги прошлой раздачи";
        lastHandBodyEl.innerHTML = `<div class="empty-rooms">За этим столом ещё не завершена ни одна раздача.</div>`;
        return;
    }

    if (lastHandTitleEl) {
        lastHandTitleEl.textContent = `📜 Итоги раздачи #${summary.hand_number}`;
    }

    lastHandBodyEl.innerHTML = "";

    // 1. Шапка: Банк и победители
    const headerEl = document.createElement("div");
    headerEl.className = "lh-summary-header";

    const potEl = document.createElement("div");
    potEl.className = "lh-pot-badge";
    potEl.textContent = `🪙 Общий банк: ${summary.pot}`;
    headerEl.appendChild(potEl);

    const winnersWrap = document.createElement("div");
    winnersWrap.className = "lh-winners-list";
    for (const w of summary.winners || []) {
        const pill = document.createElement("div");
        pill.className = "lh-winner-pill";
        pill.textContent = `🏆 ${w.player_name} +${w.amount} (${w.hand_name})`;
        winnersWrap.appendChild(pill);
    }
    headerEl.appendChild(winnersWrap);
    lastHandBodyEl.appendChild(headerEl);

    // 2. Общие карты стола (Борд)
    const boardSection = document.createElement("div");
    boardSection.className = "lh-board-section";
    const boardLabel = document.createElement("div");
    boardLabel.className = "lh-board-label";
    boardLabel.textContent =
        summary.community_cards && summary.community_cards.length > 0
            ? "Общие карты на столе (Борд)"
            : "Раздача завершилась на префлопе (без открытия общих карт)";
    boardSection.appendChild(boardLabel);

    const boardCardsRow = document.createElement("div");
    boardCardsRow.className = "lh-board-cards";
    if (summary.community_cards && summary.community_cards.length > 0) {
        for (const c of summary.community_cards) {
            boardCardsRow.appendChild(renderCardElement(c, false, false, 0, null));
        }
    } else {
        for (let i = 0; i < 5; i++) {
            const slot = document.createElement("div");
            slot.className = "card-slot";
            boardCardsRow.appendChild(slot);
        }
    }
    boardSection.appendChild(boardCardsRow);
    lastHandBodyEl.appendChild(boardSection);

    // 3. Карты и результаты всех участников раздачи
    const playersGrid = document.createElement("div");
    playersGrid.className = "lh-players-grid";

    for (const p of summary.players || []) {
        const pCard = document.createElement("div");
        const isWin = p.won_amount > 0;
        pCard.className = `lh-player-card${isWin ? " is-winner" : ""}${p.folded ? " is-folded" : ""}`;

        const topRow = document.createElement("div");
        topRow.className = "lh-player-top";
        const nameSpan = document.createElement("span");
        nameSpan.textContent = `${p.name}${p.id === myPlayerId ? " (Вы)" : ""}`;
        const statusSpan = document.createElement("span");
        if (isWin) {
            statusSpan.style.color = "#6ee7b7";
            statusSpan.textContent = `🏆 +${p.won_amount}`;
        } else if (p.folded) {
            statusSpan.style.color = "#94a3b8";
            statusSpan.textContent = "Пас";
        } else {
            statusSpan.style.color = "#cbd5e1";
            statusSpan.textContent = "Вскрытие";
        }
        topRow.appendChild(nameSpan);
        topRow.appendChild(statusSpan);
        pCard.appendChild(topRow);

        const cardsRow = document.createElement("div");
        cardsRow.className = "lh-player-cards-row";

        const holeWrap = document.createElement("div");
        holeWrap.className = "lh-player-hole";
        for (const hc of p.hole_cards || []) {
            holeWrap.appendChild(renderCardElement(hc, true, false, 0, null));
        }
        cardsRow.appendChild(holeWrap);

        const metaWrap = document.createElement("div");
        metaWrap.className = "lh-player-meta";
        if (p.hand_name) {
            const comboEl = document.createElement("div");
            comboEl.className = "lh-combo-name";
            comboEl.textContent = p.hand_name;
            metaWrap.appendChild(comboEl);
        }
        const betInfo = document.createElement("div");
        betInfo.textContent = `В банк: ${p.total_bet} 🪙`;
        metaWrap.appendChild(betInfo);
        const stackInfo = document.createElement("div");
        stackInfo.textContent = `Стек после: ${p.chips_after} 🪙`;
        metaWrap.appendChild(stackInfo);

        cardsRow.appendChild(metaWrap);
        pCard.appendChild(cardsRow);
        playersGrid.appendChild(pCard);
    }
    lastHandBodyEl.appendChild(playersGrid);

    // 4. Пошаговый лог прошлой раздачи
    if (summary.actions_log && summary.actions_log.length > 0) {
        const logTitle = document.createElement("div");
        logTitle.className = "diag-section-title";
        logTitle.textContent = "Пошаговая хронология раздачи:";
        lastHandBodyEl.appendChild(logTitle);

        const logBox = document.createElement("div");
        logBox.className = "lh-log-box";
        for (const line of summary.actions_log) {
            const item = document.createElement("div");
            item.textContent = line;
            logBox.appendChild(item);
        }
        lastHandBodyEl.appendChild(logBox);
    }
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
    const rebuyMode = rebuyModeSelect ? rebuyModeSelect.value : undefined;
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
                rebuy_mode: rebuyMode,
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
    lastRenderedLogs = [];
    selectedPreAction = null;
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
        if (myAvatarUrl) {
            sendWs({ type: "update_avatar", avatar_url: myAvatarUrl });
        }
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
                <div class="seat-timer-countdown hidden" id="seat-timer-sec-${pos}">⏱ 10с</div>
                <div class="seat-emoji-layer" id="seat-emoji-${pos}"></div>
                <div class="seat-main-row">
                    <div class="seat-media-wrap" id="seat-media-wrap-${pos}" title="Нажмите, чтобы увеличить или уменьшить камеру/фото этого игрока">
                        <video class="seat-video" id="seat-video-${pos}" autoplay playsinline></video>
                        <img class="seat-avatar-img hidden" id="seat-avatar-img-${pos}" alt="">
                        <div class="seat-avatar-placeholder" id="seat-avatar-${pos}">?</div>
                        <div class="seat-zoom-hint">⛶</div>
                    </div>
                    <div class="seat-cards-panel">
                        <div class="seat-hole-cards" id="seat-cards-${pos}"></div>
                    </div>
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
        const mediaWrapEl = document.getElementById(`seat-media-wrap-${pos}`);
        if (mediaWrapEl) {
            mediaWrapEl.addEventListener("click", () => {
                seatEl.classList.toggle("cam-expanded");
            });
        }
        const nameEl = document.getElementById(`seat-name-${pos}`);
        if (nameEl) {
            nameEl.addEventListener("click", () => {
                if (nameEl.classList.contains("editable-nick")) {
                    openNicknameModal();
                }
            });
        }
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

const COMBO_POWER_RANK = {
    "Старшая карта": 1,
    "Пара": 2,
    "Две пары": 3,
    "Сет (Тройка)": 4,
    "Стрит": 5,
    "Флеш": 6,
    "Фулл-хаус": 7,
    "Каре": 8,
    "Стрит-флеш": 9,
    "Роял-флеш": 10
};

function showComboSpotlight(text, styleType = "") {
    if (!comboSpotlightBanner) return;
    if (spotlightTimer) clearTimeout(spotlightTimer);
    comboSpotlightBanner.className = "combo-spotlight-banner" + (styleType ? ` ${styleType}` : "");
    comboSpotlightBanner.textContent = text;
    void comboSpotlightBanner.offsetWidth;
    spotlightTimer = setTimeout(() => {
        comboSpotlightBanner.classList.add("hidden");
    }, 3600);
}

function spawnParticlesAt(xPct, yPct, count, kindClass) {
    if (!fxParticlesLayer) return;
    for (let i = 0; i < count; i++) {
        const p = document.createElement("div");
        p.className = `fx-particle ${kindClass}`;
        p.style.left = `${xPct}%`;
        p.style.top = `${yPct}%`;
        const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
        const dist = 55 + Math.random() * 115;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        const rot = Math.round((Math.random() - 0.5) * 520);
        p.style.setProperty("--dx", `${dx}px`);
        p.style.setProperty("--dy", `${dy}px`);
        p.style.setProperty("--rot", `${rot}deg`);
        fxParticlesLayer.appendChild(p);
        setTimeout(() => p.remove(), 1700);
    }
}

function triggerSeatKnockout(pos, playerName) {
    const seatEl = document.getElementById(`seat-slot-${pos}`);
    if (!seatEl) return;

    seatEl.classList.remove("knockout-anim");
    void seatEl.offsetWidth;
    seatEl.classList.add("knockout-anim");
    setTimeout(() => seatEl.classList.remove("knockout-anim"), 1400);

    const stamp = document.createElement("div");
    stamp.className = "knockout-stamp";
    stamp.textContent = "💥 ВЫБИТ!";
    seatEl.appendChild(stamp);
    setTimeout(() => stamp.remove(), 2650);

    const seatCoords = [
        [50, 92],
        [10, 75],
        [10, 25],
        [50, 8],
        [90, 25],
        [90, 75]
    ];
    const [sx, sy] = seatCoords[pos] || [50, 50];
    spawnParticlesAt(sx, sy, 18, "spark");
    showToast(`💥 НОКАУТ! Игрок ${playerName} потерял весь стек!`);
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

    const currentAllInCount = state.players.filter(p => p.all_in).length;
    const someoneJustWentAllIn =
        !isNewHand &&
        state.stage !== "waiting" &&
        state.stage !== "showdown" &&
        currentAllInCount > prevAllInCount;

    if (isNewHand || state.stage === "waiting") {
        for (const p of state.players) {
            if (p.chips > 0 || p.bet_in_round > 0) {
                prevPlayerChips.set(p.id, p.chips + p.bet_in_round);
            }
        }
    }

    if (isShowdownTransition && state.winners.length > 0) {
        let bestComboName = "";
        let bestRank = 0;
        for (const w of state.winners) {
            const r = COMBO_POWER_RANK[w.hand_name] || 1;
            if (r > bestRank) {
                bestRank = r;
                bestComboName = w.hand_name;
            }
        }

        // Проверяем, выбили ли кого-то в этой раздаче (НОКАУТ)
        const knockedOutNames = [];
        for (const p of state.players) {
            const hadChips = prevPlayerChips.get(p.id) || 0;
            if (hadChips > 0 && p.chips === 0) {
                knockedOutNames.push(p.name);
                const pos = (p.seat - mySeatOffset + 6) % 6;
                triggerSeatKnockout(pos, p.name);
            }
            prevPlayerChips.set(p.id, p.chips);
        }

        if (knockedOutNames.length > 0) {
            SoundFX.playKnockout();
            setTimeout(() => SoundFX.playComboWin(bestComboName), 280);
            showComboSpotlight(`💥 НОКАУТ: ${knockedOutNames.join(", ")}!`, "knockout");
        } else {
            SoundFX.playComboWin(bestComboName);
            if (bestRank >= 8) {
                showComboSpotlight(`👑 МОНСТР-КОМБИНАЦИЯ: ${bestComboName}!`, "monster");
                spawnParticlesAt(50, 48, 28, "gold");
            } else if (bestRank >= 4) {
                showComboSpotlight(`🔥 ${bestComboName}! (${state.winners[0].player_name})`);
                if (bestRank >= 6) {
                    spawnParticlesAt(50, 48, 18, "gold");
                }
            }
        }
    } else if (someoneJustWentAllIn) {
        SoundFX.playAllIn();
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
    pauseGameBtn.textContent = state.paused ? "⏸ Авто-раздача: ВЫКЛ" : "🔁 Авто-раздача: ВКЛ";
    pauseGameBtn.classList.toggle("active", !state.paused);

    if (lastHandBtn) {
        if (state.last_hand_summary) {
            lastHandBtn.textContent = `📜 Прошлая раздача (#${state.last_hand_summary.hand_number})`;
            lastHandBtn.classList.add("active");
            if (lastHandModal && !lastHandModal.classList.contains("hidden")) {
                renderLastHandModal(state.last_hand_summary);
            }
        } else {
            lastHandBtn.textContent = "📜 Прошлая раздача";
            lastHandBtn.classList.remove("active");
        }
    }

    // Сброс преднажатий при смене раздачи или улицы (префлоп -> флоп -> тёрн -> ривер)
    if (isNewHand || state.stage !== prevStage || state.stage === "waiting" || state.stage === "showdown") {
        setPreAction(null, 0);
    }

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
    const withChipsReadyCount = state.players.filter(p => p.connected && !p.sitting_out && p.chips > 0).length;
    const offlineCount = state.players.filter(p => !p.connected).length;
    const isIdleStage = state.stage === "waiting" || state.stage === "showdown";
    const isFreezeout = state.rebuy_mode === "freezeout";
    const isTournamentFinished = isFreezeout && state.hand_number > 0 && withChipsReadyCount < 2 && activeReadyCount >= 2;

    if (isIdleStage && activeReadyCount >= 2) {
        startHandBtn.classList.remove("hidden");
        if (state.hand_number === 0) {
            startHandBtn.textContent = "🃏 Начать игру";
        } else if (isTournamentFinished) {
            startHandBtn.textContent = "🏆 Новый турнир (сбросить стеки)";
        } else {
            startHandBtn.textContent = "🃏 Раздать сейчас";
        }
    } else {
        startHandBtn.classList.add("hidden");
    }

    showCardsBtn.classList.toggle("hidden", !state.can_show_cards);
    kickOfflineBtn.classList.toggle("hidden", !(isIdleStage && offlineCount > 0));
    rebuyBtn.classList.toggle("hidden", !(me && isIdleStage && !isFreezeout && me.chips < state.starting_chips));

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
        if (player.id === myPlayerId) {
            nameEl.textContent = `${player.name} (Вы) ✎`;
            nameEl.classList.add("editable-nick");
            nameEl.title = "Нажмите, чтобы изменить свой никнейм";
        } else {
            nameEl.textContent = player.name;
            nameEl.classList.remove("editable-nick");
            nameEl.removeAttribute("title");
        }

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
        const timerSecBadge = document.getElementById(`seat-timer-sec-${pos}`);
        if (timerSecBadge && !isTurn) {
            timerSecBadge.classList.add("hidden");
        }

        const betEl = document.getElementById(`seat-bet-${pos}`);
        if (player.bet_in_round > 0) {
            betEl.textContent = `🪙 ${player.bet_in_round}`;
            betEl.classList.remove("hidden");
        } else {
            betEl.classList.add("hidden");
        }

        const cardsContainer = document.getElementById(`seat-cards-${pos}`);
        cardsContainer.innerHTML = "";
        if (player.hole_cards.length === 0) {
            const emptyHint = document.createElement("div");
            emptyHint.className = "seat-cards-empty";
            if (player.chips === 0 && isFreezeout && state.hand_number > 0) {
                emptyHint.textContent = "💀 Выбыл\nиз турнира";
            } else {
                emptyHint.textContent = player.folded ? "Пас" : "Ожидание\nраздачи";
            }
            cardsContainer.appendChild(emptyHint);
        } else {
            player.hole_cards.forEach((c, idx) => {
                const animateHole =
                    isNewHand ||
                    ((state.stage === "showdown" || state.all_in_runout) &&
                        player.id !== myPlayerId &&
                        c !== null);
                cardsContainer.appendChild(renderCardElement(c, true, animateHole, idx * 70, winningCardKeys));
            });
        }

        const videoEl = document.getElementById(`seat-video-${pos}`);
        const avatarImgEl = document.getElementById(`seat-avatar-img-${pos}`);
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

        const showLiveVideo = Boolean(streamToAttach && player.video_enabled);

        if (streamToAttach && (player.video_enabled || player.audio_enabled)) {
            if (videoEl.srcObject !== streamToAttach) {
                videoEl.srcObject = streamToAttach;
                videoEl.play().catch((err) => {
                    logMediaDiag("warn", `Автовоспроизведение потока от ${player.name} задержано браузером: ${err.message}`, false);
                });
            }
            videoEl.classList.toggle("active", showLiveVideo);
        } else {
            if (videoEl.srcObject) {
                videoEl.srcObject = null;
            }
            videoEl.classList.remove("active");
        }

        if (showLiveVideo) {
            if (avatarImgEl) avatarImgEl.classList.add("hidden");
            avatarEl.classList.add("hidden");
        } else if (player.avatar_url) {
            if (avatarImgEl) {
                if (avatarImgEl.getAttribute("src") !== player.avatar_url) {
                    avatarImgEl.src = player.avatar_url;
                }
                avatarImgEl.classList.remove("hidden");
            }
            avatarEl.classList.add("hidden");
        } else {
            if (avatarImgEl) {
                avatarImgEl.removeAttribute("src");
                avatarImgEl.classList.add("hidden");
            }
            avatarEl.classList.remove("hidden");
        }
    }

    if (me) {
        const bbCount = state.big_blind > 0 ? Math.round(me.chips / state.big_blind) : 0;
        myStackBbLabel.textContent = `Ваша комбинация • Стек: ${bbCount} BB`;
        const newHandName =
            me.hand_name || (me.hole_cards.length === 2 && !me.folded ? "Карманные карты" : "—");
        myHandRankEl.textContent = newHandName;

        // Звуковая и визуальная подсветка, когда ваша собственная комбинация усилилась на флопе/тёрне/ривере
        const oldRank = COMBO_POWER_RANK[prevMyHandName] || 0;
        const curRank = COMBO_POWER_RANK[me.hand_name] || 0;
        if (
            !isShowdownTransition &&
            state.stage !== "waiting" &&
            curRank > oldRank &&
            curRank >= 3
        ) {
            SoundFX.playComboUpgrade();
            myHandRankEl.classList.remove("combo-upgrade-pulse");
            void myHandRankEl.offsetWidth;
            myHandRankEl.classList.add("combo-upgrade-pulse");
            setTimeout(() => myHandRankEl.classList.remove("combo-upgrade-pulse"), 900);
        }
        prevMyHandName = me.hand_name || null;

        updateActionControls(state, me);
    }

    syncNewSystemLogs(state.log || []);

    prevHandNumber = state.hand_number;
    prevCommunityCount = state.community_cards.length;
    prevPot = state.pot;
    prevTurnSeat = state.current_turn_seat;
    prevStage = state.stage;
    prevAllInCount = currentAllInCount;

    syncWebrtcPeers(state.players);
}

// Надежная синхронизация системного лога даже после достижения лимита в 60 строк на сервере
function syncNewSystemLogs(serverLogs) {
    if (!serverLogs || serverLogs.length === 0) return;
    if (lastRenderedLogs.length === 0) {
        for (const entry of serverLogs) {
            appendSystemLog(entry);
        }
        lastRenderedLogs = serverLogs.slice();
        return;
    }

    // Ищем максимальное перекрытие конца lastRenderedLogs с началом serverLogs
    let overlap = 0;
    const maxCheck = Math.min(lastRenderedLogs.length, serverLogs.length);
    for (let k = maxCheck; k >= 1; k--) {
        let match = true;
        for (let i = 0; i < k; i++) {
            if (lastRenderedLogs[lastRenderedLogs.length - k + i] !== serverLogs[i]) {
                match = false;
                break;
            }
        }
        if (match) {
            overlap = k;
            break;
        }
    }

    const newEntries = serverLogs.slice(overlap);
    for (const entry of newEntries) {
        appendSystemLog(entry);
    }
    lastRenderedLogs = serverLogs.slice();
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

        const survivors = roomState.players.filter(p => p.connected && !p.sitting_out && p.chips > 0);
        const hasEliminated = roomState.players.some(p => p.chips === 0);
        if (roomState.rebuy_mode === "freezeout" && survivors.length === 1 && hasEliminated) {
            tableStatusBanner.textContent = `🏆🎉 ЧЕМПИОН ТУРНИРА: ${survivors[0].name} (${survivors[0].chips} 🪙)! Нажмите «🏆 Новый турнир» для новой партии.`;
        } else if (clientNextHandInitialRem !== null && clientNextHandInitialRem !== undefined && !roomState.paused) {
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

        const secCeil = Math.ceil(remaining);
        const timerSecBadge = document.getElementById(`seat-timer-sec-${pos}`);
        if (secCeil <= 10 && secCeil > 0) {
            if (timerSecBadge) {
                timerSecBadge.textContent = `⏱ ${secCeil}с`;
                timerSecBadge.classList.remove("hidden");
            }
            const tickKey = `${roomState.hand_number}_${roomState.stage}_${roomState.current_turn_seat}_${secCeil}`;
            if (tickKey !== lastTimerSoundKey) {
                lastTimerSoundKey = tickKey;
                const isMyTurn = Boolean(me && roomState.current_turn_seat === me.seat);
                SoundFX.playTimerTick(secCeil, isMyTurn);
            }
        } else if (timerSecBadge) {
            timerSecBadge.classList.add("hidden");
        }
    }, 200);
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
// ПРЕДНАЖАТИЕ КНОПОК (ПРЕДХОД) И УПРАВЛЕНИЕ СТАВКАМИ
// =========================================================================
function setPreAction(mode, targetBet = 0) {
    if (preActionTimer) {
        clearTimeout(preActionTimer);
        preActionTimer = null;
    }
    selectedPreAction = mode;
    preActionTargetBet = targetBet;
    refreshPreActionButtonsUI();
}

function refreshPreActionButtonsUI() {
    const buttons = [preCheckFoldBtn, preCheckBtn, preFoldBtn, preCallExactBtn, preCallAnyBtn];
    for (const btn of buttons) {
        if (!btn) continue;
        const isAct = btn.dataset.pre === selectedPreAction;
        btn.classList.toggle("active", isAct);
        const iconEl = btn.querySelector(".pre-check-icon");
        if (iconEl) {
            iconEl.textContent = isAct ? "☑" : "☐";
        }
    }
}

[preCheckFoldBtn, preCheckBtn, preFoldBtn, preCallExactBtn, preCallAnyBtn].forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
        const mode = btn.dataset.pre;
        if (selectedPreAction === mode) {
            setPreAction(null, 0);
        } else {
            const curBet = roomState ? roomState.current_bet : 0;
            setPreAction(mode, curBet);
            SoundFX.playCard();
        }
    });
});

function updateActionControls(state, me) {
    const inActiveHand =
        state.stage !== "waiting" &&
        state.stage !== "showdown" &&
        !state.all_in_runout &&
        !me.folded &&
        !me.all_in;

    const isMyTurn = inActiveHand && state.current_turn_seat === me.seat;
    const toCall = Math.max(0, state.current_bet - me.bet_in_round);

    // Если игрок не в активной раздаче — сбрасываем предход и прячем панель предхода
    if (!inActiveHand) {
        setPreAction(null, 0);
        if (preActionBarEl) preActionBarEl.classList.add("hidden");
        actionControlsEl.classList.remove("hidden");
        actionControlsEl.classList.add("disabled");
        return;
    }

    // Проверяем, не устарел ли предход из-за чужого рейза
    if (selectedPreAction === "check" && toCall > 0) {
        setPreAction(null, 0);
        showToast("Предход «Чек» отменен: соперник сделал ставку");
    } else if (selectedPreAction === "call_exact" && state.current_bet > preActionTargetBet) {
        setPreAction(null, 0);
        showToast("Предход «Колл» отменен: ставка была повышена");
    }

    // Когда ход у другого игрока — показываем панель преднажатия (предход)
    if (!isMyTurn) {
        if (preActionBarEl) {
            preActionBarEl.classList.remove("hidden");
            if (preCheckBtn) {
                preCheckBtn.classList.toggle("hidden", toCall > 0);
            }
            if (preCallExactBtn && preCallExactLabel) {
                if (toCall > 0) {
                    const callAmt = Math.min(me.chips, toCall);
                    preCallExactLabel.textContent = callAmt >= me.chips ? `Олл-ин (${callAmt})` : `Колл (${callAmt})`;
                    preCallExactBtn.classList.remove("hidden");
                } else {
                    preCallExactBtn.classList.add("hidden");
                }
            }
            refreshPreActionButtonsUI();
        }
        actionControlsEl.classList.add("hidden");
        actionControlsEl.classList.add("disabled");
        return;
    }

    // Сейчас НАШ ХОД: прячем панель предхода, показываем основные кнопки
    if (preActionBarEl) preActionBarEl.classList.add("hidden");
    actionControlsEl.classList.remove("hidden");

    // Если был выбран предход — автоматически выполняем его!
    if (selectedPreAction) {
        const chosen = selectedPreAction;
        setPreAction(null, 0);
        let autoAction = null;
        if (chosen === "check_fold") {
            autoAction = toCall === 0 ? "check" : "fold";
        } else if (chosen === "check") {
            if (toCall === 0) autoAction = "check";
        } else if (chosen === "fold") {
            autoAction = "fold";
        } else if (chosen === "call_exact") {
            if (state.current_bet <= preActionTargetBet) {
                autoAction = toCall === 0 ? "check" : "call";
            }
        } else if (chosen === "call_any") {
            autoAction = toCall === 0 ? "check" : "call";
        }

        if (autoAction) {
            actionControlsEl.classList.add("disabled");
            preActionTimer = setTimeout(() => {
                preActionTimer = null;
                if (autoAction === "check") SoundFX.playCheck();
                else if (autoAction === "fold") SoundFX.playCard();
                sendWs({ type: "action", action: autoAction });
            }, 180);
            return;
        }
    }

    actionControlsEl.classList.remove("disabled");

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

    // Если боковая панель чата скрыта — показываем счетчик и компактное всплывающее уведомление
    if (tableArenaEl && tableArenaEl.classList.contains("chat-collapsed")) {
        unreadChatCount++;
        if (chatUnreadBadge) {
            chatUnreadBadge.textContent = unreadChatCount > 99 ? "99+" : String(unreadChatCount);
            chatUnreadBadge.classList.remove("hidden");
        }
        SoundFX.playChatNotify();

        if (chatMiniPopupsEl) {
            const popup = document.createElement("div");
            popup.className = "chat-mini-popup";
            popup.innerHTML = `
                <div><span class="popup-author">💬 ${escapeHtml(author)}:</span>${escapeHtml(text)}</div>
                <span class="popup-hint">Нажмите, чтобы открыть чат</span>
            `;
            popup.addEventListener("click", () => {
                setChatCollapsed(false);
            });
            chatMiniPopupsEl.appendChild(popup);
            while (chatMiniPopupsEl.children.length > 3) {
                chatMiniPopupsEl.firstElementChild.remove();
            }
            setTimeout(() => {
                if (popup.parentNode) popup.remove();
            }, 4800);
        }
    }
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
const peerRetryCounts = new Map();
const MAX_P2P_RETRIES = 3;

function buildRtcConfig() {
    const turnHost = window.location.hostname || "poker.vikhr.online";
    const servers = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ];
    // Если открыто на сервере (не localhost), добавляем встроенный coturn TURN-сервер на порту 3478
    // WebRTC всегда сначала выбирает прямое соединение P2P (приоритет srflx > relay),
    // и автоматически включает ретрансляцию через coturn ТОЛЬКО если прямой P2P заблокирован NAT/файрволом!
    if (turnHost && turnHost !== "localhost" && turnHost !== "127.0.0.1") {
        servers.push({
            urls: [
                `stun:${turnHost}:3478`,
                `turn:${turnHost}:3478?transport=udp`,
                `turn:${turnHost}:3478?transport=tcp`
            ],
            username: "poker",
            credential: "rustholdem_turn_2026"
        });
    }
    return {
        iceServers: servers,
        iceCandidatePoolSize: 2
    };
}

const RTC_CONFIG = buildRtcConfig();

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
    peerRetryCounts.clear();

    if (!videoEnabled && !audioEnabled) {
        logMediaDiag("info", "Камера и микрофон выключены пользователем.");
        stopLocalMedia();
        for (const [peerId, pc] of peerConnections.entries()) {
            for (const sender of pc.getSenders()) {
                if (sender.track) {
                    try {
                        pc.removeTrack(sender);
                    } catch (_) {}
                }
            }
            await negotiateWithPeer(peerId, pc);
        }
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
    peerStates.set(peerId, {
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingCandidates: [],
        disconnectTimer: null
    });

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
        const state = peerStates.get(peerId);

        if (st === "connected" || st === "completed") {
            peerRetryCounts.set(peerId, 0);
            if (state && state.disconnectTimer) {
                clearTimeout(state.disconnectTimer);
                state.disconnectTimer = null;
            }
            if (typeof pc.getStats === "function") {
                pc.getStats()
                    .then((stats) => {
                        let usedRelay = false;
                        stats.forEach((report) => {
                            if (report.type === "candidate-pair" && report.state === "succeeded" && report.nominated) {
                                const localCand = stats.get(report.localCandidateId);
                                const remoteCand = stats.get(report.remoteCandidateId);
                                if (
                                    (localCand && localCand.candidateType === "relay") ||
                                    (remoteCand && remoteCand.candidateType === "relay")
                                ) {
                                    usedRelay = true;
                                }
                            }
                        });
                        const modeStr = usedRelay ? "через TURN-сервер (coturn ретранслятор)" : "напрямую (P2P)";
                        logMediaDiag("ok", `Видео/аудио канал с "${pName}" установлен [${modeStr}]!`, false);
                    })
                    .catch(() => {
                        logMediaDiag("ok", `Видео/аудио канал с "${pName}" успешно установлен (${st})!`, false);
                    });
            } else {
                logMediaDiag("ok", `Видео/аудио канал с "${pName}" успешно установлен (${st})!`, false);
            }
        } else if (st === "disconnected") {
            if (state && !state.disconnectTimer) {
                state.disconnectTimer = setTimeout(() => {
                    if (!peerConnections.has(peerId)) return;
                    const cur = pc.iceConnectionState;
                    if (cur === "disconnected" || cur === "failed") {
                        resetPeerConnection(peerId, true);
                    }
                }, 4500);
            }
        } else if (st === "failed") {
            resetPeerConnection(peerId, true);
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

function resetPeerConnection(peerId, notifyRemote = false) {
    const retries = (peerRetryCounts.get(peerId) || 0) + 1;
    peerRetryCounts.set(peerId, retries);
    closePeer(peerId);

    const pName = getPeerName(peerId);
    if (retries > MAX_P2P_RETRIES) {
        logMediaDiag(
            "warn",
            `Прямое P2P-видео с "${pName}" недоступно из-за закрытого NAT провайдера (${retries - 1} попытки). Игра и камеры других участников работают в штатном режиме.`
        );
        return;
    }

    logMediaDiag("info", `Перезапуск P2P-канала с "${pName}" (попытка ${retries}/${MAX_P2P_RETRIES})...`, false);
    if (notifyRemote) {
        sendWs({
            type: "webrtc_signal",
            target_id: peerId,
            signal_type: "reset",
            payload: {}
        });
    }
    if (roomState) {
        setTimeout(() => {
            if (roomState) syncWebrtcPeers(roomState.players);
        }, 350);
    }
}

function attachLocalTracksToPc(pc) {
    if (!localStream) return;
    const senders = pc.getSenders();
    for (const track of localStream.getTracks()) {
        const alreadySent = senders.some(s => s.track === track);
        if (!alreadySent) {
            const sender = pc.addTrack(track, localStream);
            // Ограничиваем битрейт видео до 160 Кбит/с и 15 FPS, чтобы при 4-6 игроках не нагружать CPU
            if (track.kind === "video" && sender && typeof sender.getParameters === "function") {
                try {
                    const params = sender.getParameters();
                    if (!params.encodings || params.encodings.length === 0) {
                        params.encodings = [{}];
                    }
                    params.encodings[0].maxBitrate = 160000;
                    params.encodings[0].maxFramerate = 15;
                    sender.setParameters(params).catch(() => {});
                } catch (_) {}
            }
        }
    }
}

async function negotiateWithPeer(peerId, pc) {
    const state = peerStates.get(peerId);
    if (!state || state.makingOffer || state.isSettingRemoteAnswerPending) return;
    if (pc.signalingState !== "stable") return;

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

    for (const peerId of Array.from(peerConnections.keys())) {
        if (!activeIds.has(peerId)) {
            closePeer(peerId);
        }
    }

    const myHasMedia = videoEnabled || audioEnabled;

    for (const p of players) {
        if (p.id === myPlayerId || !p.connected) continue;
        const peerHasMedia = p.video_enabled || p.audio_enabled;
        const shouldConnect = myHasMedia || peerHasMedia;

        if (!shouldConnect) {
            peerRetryCounts.delete(p.id);
            if (peerConnections.has(p.id)) {
                closePeer(p.id);
            }
            continue;
        }

        if ((peerRetryCounts.get(p.id) || 0) > MAX_P2P_RETRIES) {
            continue;
        }

        if (!peerConnections.has(p.id)) {
            // Чтобы оба браузера не слали Offer одновременно (и пустой Offer без треков не ломал DTLS SSL role):
            // 1. Если медиа включено только у нас — создаем соединение и отправляем Offer мы.
            // 2. Если медиа включено у обоих — инициатором выступает только один (myPlayerId > p.id).
            // 3. Если медиа включено только у собеседника — мы ждем входящий Offer от него в handleWebrtcSignal.
            const iAmInitiator =
                (myHasMedia && !peerHasMedia) ||
                (myHasMedia && peerHasMedia && myPlayerId > p.id);

            if (iAmInitiator) {
                const pc = getOrCreatePeerConnection(p.id);
                negotiateWithPeer(p.id, pc);
            }
        }
    }
}

async function flushPendingCandidates(peerId, pc, state) {
    if (!state || !state.pendingCandidates.length || !pc.remoteDescription) return;
    const queue = state.pendingCandidates.splice(0, state.pendingCandidates.length);
    for (const cand of queue) {
        try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (_) {}
    }
}

async function handleWebrtcSignal(fromId, signalType, payload) {
    if (signalType === "reset") {
        closePeer(fromId);
        if (roomState && (videoEnabled || audioEnabled)) {
            setTimeout(() => {
                if (roomState) syncWebrtcPeers(roomState.players);
            }, 300);
        }
        return;
    }

    const pc = getOrCreatePeerConnection(fromId);
    const state = peerStates.get(fromId);
    const polite = myPlayerId < fromId;

    try {
        if (signalType === "offer") {
            const description = new RTCSessionDescription(payload);
            const readyForOffer =
                !state.makingOffer &&
                (pc.signalingState === "stable" || state.isSettingRemoteAnswerPending);
            const offerCollision = !readyForOffer;

            state.ignoreOffer = !polite && offerCollision;
            if (state.ignoreOffer) {
                return;
            }

            if (offerCollision) {
                await pc.setLocalDescription({ type: "rollback" });
            }
            await pc.setRemoteDescription(description);
            await flushPendingCandidates(fromId, pc, state);

            attachLocalTracksToPc(pc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWs({
                type: "webrtc_signal",
                target_id: fromId,
                signal_type: "answer",
                payload: pc.localDescription
            });
        } else if (signalType === "answer") {
            if (pc.signalingState !== "have-local-offer") {
                // Игнорируем устаревший/дублирующий Answer, чтобы не вызывать ошибку DTLS SSL role
                return;
            }
            const description = new RTCSessionDescription(payload);
            state.isSettingRemoteAnswerPending = true;
            try {
                await pc.setRemoteDescription(description);
            } finally {
                state.isSettingRemoteAnswerPending = false;
            }
            await flushPendingCandidates(fromId, pc, state);
        } else if (signalType === "ice") {
            if (payload) {
                if (!pc.remoteDescription || !pc.remoteDescription.type) {
                    state.pendingCandidates.push(payload);
                } else {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(payload));
                    } catch (err) {
                        if (!state.ignoreOffer) {
                            logMediaDiag("warn", `Предупреждение ICE от "${getPeerName(fromId)}": ${err.message}`, false);
                        }
                    }
                }
            }
        }
    } catch (e) {
        logMediaDiag("warn", `Перезапуск P2P-канала с "${getPeerName(fromId)}" после рассинхронизации SDP (${e.message})`, false);
        resetPeerConnection(fromId, true);
    }
}

function closePeer(peerId) {
    const state = peerStates.get(peerId);
    if (state && state.disconnectTimer) {
        clearTimeout(state.disconnectTimer);
    }
    const pc = peerConnections.get(peerId);
    if (pc) {
        pc.onicecandidate = null;
        pc.oniceconnectionstatechange = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
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
