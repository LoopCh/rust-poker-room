use crate::poker::{
    calculate_all_in_equities, create_shuffled_deck, evaluate_hand, Card, EvaluatedHand,
};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::time::Instant;

pub const MAX_SEATS: usize = 6;
pub const TURN_TIMEOUT_SECS: u64 = 45;
pub const AUTO_DEAL_DELAY_SECS: u64 = 6;
pub const RUNOUT_STREET_DELAY_SECS: u64 = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameStage {
    Waiting,
    Preflop,
    Flop,
    Turn,
    River,
    Showdown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GamePreset {
    Cash,
    SngStandard,
    SngTurbo,
    HyperTurbo,
    DeepstackAnte,
}

impl Default for GamePreset {
    fn default() -> Self {
        GamePreset::SngStandard
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BlindLevel {
    pub level: usize,
    pub small_blind: u64,
    pub big_blind: u64,
    pub ante: u64,
}

pub struct PresetConfig {
    pub preset: GamePreset,
    pub preset_name: String,
    pub starting_chips: u64,
    pub level_duration_secs: Option<u64>,
    pub levels: Vec<BlindLevel>,
    pub allow_rebuy: bool,
}

impl GamePreset {
    pub fn build_config(
        self,
        custom_sb: Option<u64>,
        custom_chips: Option<u64>,
        custom_level_mins: Option<u64>,
    ) -> PresetConfig {
        let base_sb = custom_sb.unwrap_or(10).max(1);
        let raw_ladder: &[(u64, u64, u64)] = match self {
            GamePreset::Cash => &[(10, 20, 0)],
            GamePreset::DeepstackAnte => &[
                (10, 20, 2),
                (15, 30, 3),
                (20, 40, 5),
                (30, 60, 8),
                (50, 100, 12),
                (75, 150, 20),
                (100, 200, 25),
                (150, 300, 40),
                (200, 400, 50),
                (300, 600, 75),
                (500, 1000, 125),
                (1000, 2000, 250),
            ],
            _ => &[
                (10, 20, 0),
                (15, 30, 0),
                (20, 40, 5),
                (30, 60, 5),
                (50, 100, 10),
                (75, 150, 15),
                (100, 200, 25),
                (150, 300, 35),
                (200, 400, 50),
                (300, 600, 75),
                (500, 1000, 100),
                (1000, 2000, 200),
            ],
        };

        let levels: Vec<BlindLevel> = raw_ladder
            .iter()
            .enumerate()
            .map(|(idx, &(sb_m, bb_m, ante_m))| {
                let sb = (sb_m * base_sb / 10).max(1);
                let bb = (bb_m * base_sb / 10).max(sb * 2);
                let ante = ante_m * base_sb / 10;
                BlindLevel {
                    level: idx + 1,
                    small_blind: sb,
                    big_blind: bb,
                    ante,
                }
            })
            .collect();

        let (default_chips, default_mins, name, allow_rebuy) = match self {
            GamePreset::Cash => (base_sb * 100, None, "💵 Кэш-игра", true),
            GamePreset::SngStandard => (base_sb * 150, Some(5), "🏆 Турнир Sit & Go", true),
            GamePreset::SngTurbo => (base_sb * 150, Some(3), "⚡ Турбо Sit & Go", true),
            GamePreset::HyperTurbo => (base_sb * 50, Some(2), "🔥 Гипер-Турбо (Spin)", true),
            GamePreset::DeepstackAnte => (base_sb * 300, Some(6), "👑 Хайроллер с Анте", true),
        };

        let level_duration_secs = match self {
            GamePreset::Cash => None,
            _ => Some(custom_level_mins.or(default_mins).unwrap_or(5).max(1) * 60),
        };

        PresetConfig {
            preset: self,
            preset_name: name.to_string(),
            starting_chips: custom_chips.unwrap_or(default_chips).max(base_sb * 20),
            level_duration_secs,
            levels,
            allow_rebuy,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Player {
    pub id: String,
    pub name: String,
    pub seat: usize,
    pub chips: u64,
    pub bet_in_round: u64,
    pub total_bet_in_hand: u64,
    pub hole_cards: Vec<Card>,
    pub folded: bool,
    pub all_in: bool,
    pub connected: bool,
    pub sitting_out: bool,
    pub left_voluntarily: bool,
    pub video_enabled: bool,
    pub audio_enabled: bool,
    pub last_action: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WinnerInfo {
    pub player_id: String,
    pub player_name: String,
    pub amount: u64,
    pub hand_name: String,
    pub winning_cards: Vec<Card>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicPlayerView {
    pub id: String,
    pub name: String,
    pub seat: usize,
    pub chips: u64,
    pub bet_in_round: u64,
    pub total_bet_in_hand: u64,
    pub hole_cards: Vec<Option<Card>>,
    pub card_count: usize,
    pub folded: bool,
    pub all_in: bool,
    pub connected: bool,
    pub sitting_out: bool,
    pub video_enabled: bool,
    pub audio_enabled: bool,
    pub last_action: Option<String>,
    pub hand_name: Option<String>,
    pub win_probability: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomStateView {
    pub room_id: String,
    pub room_name: String,
    pub preset_name: String,
    pub host_id: String,
    pub stage: GameStage,
    pub all_in_runout: bool,
    pub pot: u64,
    pub current_bet: u64,
    pub min_raise: u64,
    pub current_level: usize,
    pub small_blind: u64,
    pub big_blind: u64,
    pub ante: u64,
    pub next_small_blind: Option<u64>,
    pub next_big_blind: Option<u64>,
    pub next_ante: Option<u64>,
    pub level_remaining_secs: Option<u64>,
    pub starting_chips: u64,
    pub dealer_seat: usize,
    pub small_blind_seat: Option<usize>,
    pub big_blind_seat: Option<usize>,
    pub current_turn_seat: Option<usize>,
    pub turn_remaining_secs: Option<u64>,
    pub turn_total_secs: u64,
    pub auto_deal: bool,
    pub paused: bool,
    pub next_hand_remaining_secs: Option<u64>,
    pub can_show_cards: bool,
    pub community_cards: Vec<Card>,
    pub players: Vec<PublicPlayerView>,
    pub winners: Vec<WinnerInfo>,
    pub hand_number: u64,
    pub log: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoomSummary {
    pub room_id: String,
    pub room_name: String,
    pub preset_name: String,
    pub player_count: usize,
    pub max_players: usize,
    pub small_blind: u64,
    pub big_blind: u64,
    pub ante: u64,
    pub stage: GameStage,
}

pub struct PokerRoom {
    pub room_id: String,
    pub room_name: String,
    pub preset_name: String,
    pub host_id: String,
    pub stage: GameStage,
    pub all_in_runout: bool,
    pub dramatic_runout: bool,
    pub runout_step_started_at: Option<Instant>,
    pub win_probabilities: HashMap<String, f32>,
    pub pot: u64,
    pub current_bet: u64,
    pub min_raise: u64,
    pub current_level_idx: usize,
    pub levels: Vec<BlindLevel>,
    pub level_duration_secs: Option<u64>,
    pub level_started_at: Option<Instant>,
    pub small_blind: u64,
    pub big_blind: u64,
    pub ante: u64,
    pub starting_chips: u64,
    pub dealer_seat: usize,
    pub small_blind_seat: Option<usize>,
    pub big_blind_seat: Option<usize>,
    pub current_turn_seat: Option<usize>,
    pub turn_started_at: Option<Instant>,
    pub auto_deal: bool,
    pub paused: bool,
    pub showdown_started_at: Option<Instant>,
    pub deck: Vec<Card>,
    pub community_cards: Vec<Card>,
    pub players: Vec<Player>,
    pub acted_seats: HashSet<usize>,
    pub winners: Vec<WinnerInfo>,
    pub revealed_hands: HashMap<String, EvaluatedHand>,
    pub voluntarily_revealed: HashSet<String>,
    pub hand_number: u64,
    pub log: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum PlayerAction {
    Fold,
    Check,
    Call,
    Raise { amount: u64 },
    AllIn,
}

impl PokerRoom {
    pub fn new_with_preset(room_id: String, room_name: String, config: PresetConfig) -> Self {
        let first = config.levels[0];
        let mode_desc = if let Some(secs) = config.level_duration_secs {
            format!("{} (рост блайндов каждые {} мин)", config.preset_name, secs / 60)
        } else {
            config.preset_name.clone()
        };

        Self {
            room_id,
            room_name,
            preset_name: config.preset_name,
            host_id: String::new(),
            stage: GameStage::Waiting,
            all_in_runout: false,
            dramatic_runout: true,
            runout_step_started_at: None,
            win_probabilities: HashMap::new(),
            pot: 0,
            current_bet: 0,
            min_raise: first.big_blind,
            current_level_idx: 0,
            levels: config.levels,
            level_duration_secs: config.level_duration_secs,
            level_started_at: None,
            small_blind: first.small_blind,
            big_blind: first.big_blind,
            ante: first.ante,
            starting_chips: config.starting_chips,
            dealer_seat: 0,
            small_blind_seat: None,
            big_blind_seat: None,
            current_turn_seat: None,
            turn_started_at: None,
            auto_deal: true,
            paused: false,
            showdown_started_at: None,
            deck: Vec::new(),
            community_cards: Vec::new(),
            players: Vec::new(),
            acted_seats: HashSet::new(),
            winners: Vec::new(),
            revealed_hands: HashMap::new(),
            voluntarily_revealed: HashSet::new(),
            hand_number: 0,
            log: vec![format!("Стол создан: {}. Ожидание игроков...", mode_desc)],
        }
    }

    #[allow(dead_code)]
    pub fn new(
        room_id: String,
        room_name: String,
        small_blind: u64,
        big_blind: u64,
        starting_chips: u64,
    ) -> Self {
        let mut config = GamePreset::Cash.build_config(Some(small_blind), Some(starting_chips), None);
        config.levels[0].big_blind = big_blind;
        let mut room = Self::new_with_preset(room_id, room_name, config);
        room.dramatic_runout = false;
        room
    }

    pub fn push_log(&mut self, msg: impl Into<String>) {
        self.log.push(msg.into());
        if self.log.len() > 60 {
            self.log.remove(0);
        }
    }

    fn set_turn_seat(&mut self, seat: Option<usize>) {
        self.current_turn_seat = seat;
        self.turn_started_at = seat.map(|_| Instant::now());
    }

    pub fn summary(&self) -> RoomSummary {
        RoomSummary {
            room_id: self.room_id.clone(),
            room_name: self.room_name.clone(),
            preset_name: self.preset_name.clone(),
            player_count: self.players.iter().filter(|p| p.connected).count(),
            max_players: MAX_SEATS,
            small_blind: self.small_blind,
            big_blind: self.big_blind,
            ante: self.ante,
            stage: self.stage,
        }
    }

    pub fn add_or_reconnect_player(&mut self, player_id: String, name: String) -> Result<usize, String> {
        if let Some(existing) = self.players.iter_mut().find(|p| p.id == player_id) {
            existing.connected = true;
            existing.left_voluntarily = false;
            existing.name = name.clone();
            let seat = existing.seat;
            self.push_log(format!("{} вернулся за стол (место #{})", name, seat + 1));
            self.ensure_valid_host();
            return Ok(seat);
        }

        if self.players.len() >= MAX_SEATS
            && matches!(self.stage, GameStage::Waiting | GameStage::Showdown)
        {
            self.players.retain(|p| p.connected);
        }

        let used_seats: HashSet<usize> = self.players.iter().map(|p| p.seat).collect();
        let free_seat = (0..MAX_SEATS)
            .find(|s| !used_seats.contains(s))
            .ok_or_else(|| "За столом нет свободных мест (максимум 6 игроков)".to_string())?;

        let in_active_hand = !matches!(self.stage, GameStage::Waiting | GameStage::Showdown);

        let player = Player {
            id: player_id.clone(),
            name: name.clone(),
            seat: free_seat,
            chips: self.starting_chips,
            bet_in_round: 0,
            total_bet_in_hand: 0,
            hole_cards: Vec::new(),
            folded: in_active_hand,
            all_in: false,
            connected: true,
            sitting_out: false,
            left_voluntarily: false,
            video_enabled: false,
            audio_enabled: false,
            last_action: if in_active_hand {
                Some("Ждет раздачи".to_string())
            } else {
                None
            },
        };

        self.players.push(player);
        self.players.sort_by_key(|p| p.seat);
        self.ensure_valid_host();

        self.push_log(format!("{} сел за стол (место #{})", name, free_seat + 1));
        Ok(free_seat)
    }

    fn ensure_valid_host(&mut self) {
        if self.host_id.is_empty()
            || !self.players.iter().any(|p| p.id == self.host_id && p.connected)
        {
            if let Some(next_host) = self.players.iter().find(|p| p.connected) {
                self.host_id = next_host.id.clone();
            } else {
                self.host_id.clear();
            }
        }
    }

    pub fn leave_player(&mut self, player_id: &str) {
        let in_active_hand = !matches!(self.stage, GameStage::Waiting | GameStage::Showdown);
        if !in_active_hand {
            if let Some(idx) = self.players.iter().position(|p| p.id == player_id) {
                let removed = self.players.remove(idx);
                self.push_log(format!("{} покинул стол", removed.name));
            }
            if self.active_eligible_count() < 2 {
                self.stage = GameStage::Waiting;
                self.showdown_started_at = None;
                self.set_turn_seat(None);
            }
            self.ensure_valid_host();
        } else {
            if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
                p.left_voluntarily = true;
            }
            self.set_player_disconnected(player_id);
        }
    }

    pub fn toggle_sit_out(&mut self, player_id: &str) -> Result<bool, String> {
        let mut was_turn = false;
        let now_sitting_out;
        let p_name;

        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.sitting_out = !p.sitting_out;
            now_sitting_out = p.sitting_out;
            p_name = p.name.clone();
            if now_sitting_out && self.current_turn_seat == Some(p.seat) {
                was_turn = true;
            }
        } else {
            return Err("Игрок не за столом".to_string());
        }

        if now_sitting_out {
            self.push_log(format!("☕ {} отошел от стола (пропускает раздачи)", p_name));
            if was_turn {
                let _ = self.handle_action(player_id, PlayerAction::Fold);
            }
        } else {
            self.push_log(format!("👋 {} вернулся в игру", p_name));
        }
        Ok(now_sitting_out)
    }

    pub fn toggle_pause(&mut self, player_id: &str) -> Result<bool, String> {
        let name = self
            .players
            .iter()
            .find(|p| p.id == player_id)
            .map(|p| p.name.clone())
            .unwrap_or_else(|| "Игрок".to_string());

        self.paused = !self.paused;
        if self.paused {
            self.push_log(format!("⏸ {} поставил авто-раздачу на паузу", name));
        } else {
            if self.stage == GameStage::Showdown {
                self.showdown_started_at = Some(Instant::now());
            }
            self.push_log(format!("▶️ {} возобновил авто-раздачу", name));
        }
        Ok(self.paused)
    }

    pub fn reveal_my_cards(&mut self, player_id: &str) -> Result<(), String> {
        if self.stage != GameStage::Showdown {
            return Err("Показать карты можно только по завершении раздачи".to_string());
        }
        if self.voluntarily_revealed.contains(player_id) {
            return Ok(());
        }
        let p = self
            .players
            .iter()
            .find(|p| p.id == player_id)
            .ok_or_else(|| "Игрок не найден".to_string())?;

        if p.hole_cards.len() != 2 {
            return Err("У вас нет карт в этой раздаче".to_string());
        }

        let c1 = format!("{}{}", p.hole_cards[0].label, p.hole_cards[0].suit_symbol);
        let c2 = format!("{}{}", p.hole_cards[1].label, p.hole_cards[1].suit_symbol);
        let name = p.name.clone();

        self.voluntarily_revealed.insert(player_id.to_string());
        self.push_log(format!("👁 {} показывает свои карты столу: [{} {}]", name, c1, c2));
        Ok(())
    }

    pub fn kick_offline_players(&mut self) -> Result<usize, String> {
        if !matches!(self.stage, GameStage::Waiting | GameStage::Showdown) {
            return Err("Удалить оффлайн-игроков можно только между раздачами".to_string());
        }
        let before = self.players.len();
        self.players.retain(|p| p.connected);
        let removed = before.saturating_sub(self.players.len());
        if removed > 0 {
            self.push_log(format!("🧹 Удалено оффлайн-игроков: {}", removed));
        }
        self.ensure_valid_host();
        Ok(removed)
    }

    pub fn set_player_disconnected(&mut self, player_id: &str) {
        let mut was_turn = false;
        let mut player_seat = None;
        let mut player_name = String::new();

        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            if !p.connected {
                return;
            }
            p.connected = false;
            p.video_enabled = false;
            p.audio_enabled = false;
            player_seat = Some(p.seat);
            player_name = p.name.clone();
            if self.current_turn_seat == Some(p.seat) {
                was_turn = true;
            }
        }

        if !player_name.is_empty() {
            self.push_log(format!("{} отключился", player_name));
        }

        self.ensure_valid_host();

        if was_turn {
            let _ = self.handle_action(player_id, PlayerAction::Fold);
        } else if let Some(seat) = player_seat {
            if !matches!(self.stage, GameStage::Waiting | GameStage::Showdown) {
                if let Some(p) = self.players.iter_mut().find(|p| p.seat == seat) {
                    if !p.folded && !p.all_in {
                        p.folded = true;
                        p.last_action = Some("Пас (вышел)".to_string());
                    }
                }
                self.check_hand_progress();
            }
        }
    }

    pub fn active_eligible_count(&self) -> usize {
        self.players
            .iter()
            .filter(|p| p.connected && !p.sitting_out)
            .count()
    }

    fn update_all_in_equities(&mut self) {
        let contenders: Vec<(String, [Card; 2])> = self
            .players
            .iter()
            .filter(|p| !p.folded && p.hole_cards.len() == 2)
            .map(|p| (p.id.clone(), [p.hole_cards[0], p.hole_cards[1]]))
            .collect();

        self.win_probabilities = calculate_all_in_equities(&contenders, &self.community_cards);

        let mut parts = Vec::new();
        for p in &self.players {
            if let Some(&pct) = self.win_probabilities.get(&p.id) {
                parts.push(format!("{}: {:.1}%", p.name, pct));
            }
        }
        if !parts.is_empty() {
            self.push_log(format!("🎲 Шансы на банк: {}", parts.join(" • ")));
        }
    }

    /// Periodic 1-second check for:
    /// 1) Dramatic street-by-street All-In Runout (every 2s)
    /// 2) Turn inactivity timeout (45s)
    /// 3) Auto-starting the next hand after Showdown (6s pause)
    pub fn check_timers(&mut self) -> bool {
        // 1. Dramatic street-by-street All-In Runout when nobody can bet anymore
        if self.all_in_runout && !matches!(self.stage, GameStage::Waiting | GameStage::Showdown) {
            if let Some(step_at) = self.runout_step_started_at {
                if step_at.elapsed().as_secs() >= RUNOUT_STREET_DELAY_SECS {
                    self.advance_single_runout_street();
                    return true;
                }
            }
            return false;
        }

        // 2. Check active turn timeout
        if !matches!(self.stage, GameStage::Waiting | GameStage::Showdown) {
            if let Some(started) = self.turn_started_at {
                if started.elapsed().as_secs() >= TURN_TIMEOUT_SECS {
                    if let Some(turn_seat) = self.current_turn_seat {
                        if let Some(p) = self.players.iter().find(|p| p.seat == turn_seat) {
                            let pid = p.id.clone();
                            let can_check = p.bet_in_round >= self.current_bet;
                            let default_action = if can_check {
                                PlayerAction::Check
                            } else {
                                PlayerAction::Fold
                            };
                            self.push_log(format!("⏰ Время хода {} истекло", p.name));
                            return self.handle_action(&pid, default_action).is_ok();
                        }
                    }
                }
            }
            return false;
        }

        // 3. Check automatic next hand deal after Showdown
        if self.stage == GameStage::Showdown && self.auto_deal && !self.paused {
            if let Some(showdown_at) = self.showdown_started_at {
                if showdown_at.elapsed().as_secs() >= AUTO_DEAL_DELAY_SECS {
                    if self.active_eligible_count() >= 2 {
                        return self.start_new_hand().is_ok();
                    } else {
                        self.showdown_started_at = None;
                    }
                }
            }
        }

        false
    }

    fn advance_single_runout_street(&mut self) {
        match self.stage {
            GameStage::Preflop => {
                self.stage = GameStage::Flop;
                self.community_cards.push(self.deck.pop().unwrap());
                self.community_cards.push(self.deck.pop().unwrap());
                self.community_cards.push(self.deck.pop().unwrap());
                self.push_log("🃏 Флоп открыт (Олл-ин разыгровка)".to_string());
                self.update_all_in_equities();
                self.runout_step_started_at = Some(Instant::now());
            }
            GameStage::Flop => {
                self.stage = GameStage::Turn;
                self.community_cards.push(self.deck.pop().unwrap());
                self.push_log("🃏 Тёрн открыт (Олл-ин разыгровка)".to_string());
                self.update_all_in_equities();
                self.runout_step_started_at = Some(Instant::now());
            }
            GameStage::Turn => {
                self.stage = GameStage::River;
                self.community_cards.push(self.deck.pop().unwrap());
                self.push_log("🃏 Ривер открыт (Олл-ин разыгровка)".to_string());
                self.resolve_showdown();
            }
            GameStage::River => {
                self.resolve_showdown();
            }
            _ => {}
        }
    }

    fn check_and_advance_blind_level(&mut self) {
        let Some(duration_secs) = self.level_duration_secs else {
            return;
        };
        let Some(started_at) = self.level_started_at else {
            self.level_started_at = Some(Instant::now());
            return;
        };

        let elapsed = started_at.elapsed().as_secs();
        if elapsed >= duration_secs && self.current_level_idx + 1 < self.levels.len() {
            let steps = (elapsed / duration_secs) as usize;
            let new_idx = (self.current_level_idx + steps).min(self.levels.len() - 1);
            if new_idx > self.current_level_idx {
                self.current_level_idx = new_idx;
                let lvl = self.levels[new_idx];
                self.small_blind = lvl.small_blind;
                self.big_blind = lvl.big_blind;
                self.ante = lvl.ante;
                self.level_started_at = Some(Instant::now());

                if self.ante > 0 {
                    self.push_log(format!(
                        "📈 Уровень #{}! Блайнды {}/{}, Анте {}",
                        lvl.level, lvl.small_blind, lvl.big_blind, lvl.ante
                    ));
                } else {
                    self.push_log(format!(
                        "📈 Уровень #{}! Блайнды выросли до {}/{}",
                        lvl.level, lvl.small_blind, lvl.big_blind
                    ));
                }
            }
        }
    }

    pub fn update_media_state(&mut self, player_id: &str, video: bool, audio: bool) {
        if let Some(p) = self.players.iter_mut().find(|p| p.id == player_id) {
            p.video_enabled = video;
            p.audio_enabled = audio;
        }
    }

    pub fn rebuy(&mut self, player_id: &str) -> Result<(), String> {
        if !matches!(self.stage, GameStage::Waiting | GameStage::Showdown) {
            return Err("Докупка фишек возможна только между раздачами".to_string());
        }
        let p = self
            .players
            .iter_mut()
            .find(|p| p.id == player_id)
            .ok_or_else(|| "Игрок не найден".to_string())?;
        if p.chips >= self.starting_chips {
            return Err("У вас уже полный стартовый стек".to_string());
        }
        p.chips = self.starting_chips;
        let name = p.name.clone();
        let amount = self.starting_chips;
        self.push_log(format!("🪙 {} пополнил стек до {} фишек", name, amount));
        Ok(())
    }

    pub fn start_new_hand(&mut self) -> Result<(), String> {
        self.players.retain(|p| !p.left_voluntarily);

        for p in &mut self.players {
            if p.connected && !p.sitting_out && p.chips == 0 {
                p.chips = self.starting_chips;
                let name = p.name.clone();
                let chips = self.starting_chips;
                self.log.push(format!("🪙 Авто-ребай для {}: +{} фишек", name, chips));
            }
        }

        let eligible_seats: Vec<usize> = self
            .players
            .iter()
            .filter(|p| p.connected && !p.sitting_out && p.chips > 0)
            .map(|p| p.seat)
            .collect();

        if eligible_seats.len() < 2 {
            return Err("Для начала раздачи нужно минимум 2 активных игрока за столом".to_string());
        }

        self.check_and_advance_blind_level();

        self.hand_number += 1;
        self.stage = GameStage::Preflop;
        self.all_in_runout = false;
        self.runout_step_started_at = None;
        self.win_probabilities.clear();
        self.showdown_started_at = None;
        self.pot = 0;
        self.current_bet = 0;
        self.min_raise = self.big_blind;
        self.community_cards.clear();
        self.winners.clear();
        self.revealed_hands.clear();
        self.voluntarily_revealed.clear();
        self.acted_seats.clear();
        self.deck = create_shuffled_deck();

        self.dealer_seat = Self::next_seat_in_list(&eligible_seats, self.dealer_seat);

        for p in &mut self.players {
            p.bet_in_round = 0;
            p.total_bet_in_hand = 0;
            p.hole_cards.clear();
            p.all_in = false;
            p.last_action = None;
            if eligible_seats.contains(&p.seat) {
                p.folded = false;
                p.hole_cards.push(self.deck.pop().unwrap());
                p.hole_cards.push(self.deck.pop().unwrap());
            } else {
                p.folded = true;
                if p.sitting_out {
                    p.last_action = Some("Отошел ☕".to_string());
                }
            }
        }

        if self.ante > 0 {
            for &seat in &eligible_seats {
                if let Some(p) = self.players.iter_mut().find(|p| p.seat == seat) {
                    let actual_ante = p.chips.min(self.ante);
                    p.chips -= actual_ante;
                    p.total_bet_in_hand += actual_ante;
                    self.pot += actual_ante;
                    if p.chips == 0 {
                        p.all_in = true;
                        p.last_action = Some(format!("Анте {} (Олл-ин)", actual_ante));
                    }
                }
            }
        }

        let (sb_seat, bb_seat, nominal_first_seat) = if eligible_seats.len() == 2 {
            let sb = self.dealer_seat;
            let bb = Self::next_seat_in_list(&eligible_seats, sb);
            (sb, bb, sb)
        } else {
            let sb = Self::next_seat_in_list(&eligible_seats, self.dealer_seat);
            let bb = Self::next_seat_in_list(&eligible_seats, sb);
            let utg = Self::next_seat_in_list(&eligible_seats, bb);
            (sb, bb, utg)
        };

        self.small_blind_seat = Some(sb_seat);
        self.big_blind_seat = Some(bb_seat);

        let sb_amount = self.post_blind(sb_seat, self.small_blind, "МБ");
        let bb_amount = self.post_blind(bb_seat, self.big_blind, "ББ");

        self.current_bet = bb_amount.max(sb_amount);
        self.min_raise = self.big_blind;

        let lvl_num = self.levels[self.current_level_idx].level;
        if self.ante > 0 {
            self.push_log(format!(
                "--- Раздача #{} (Ур. {}: Блайнды {}/{}, Анте {}) ---",
                self.hand_number, lvl_num, self.small_blind, self.big_blind, self.ante
            ));
        } else {
            self.push_log(format!(
                "--- Раздача #{} (Ур. {}: Блайнды {}/{}) ---",
                self.hand_number, lvl_num, self.small_blind, self.big_blind
            ));
        }

        let can_act_seats: Vec<usize> = self
            .players
            .iter()
            .filter(|p| !p.folded && !p.all_in)
            .map(|p| p.seat)
            .collect();

        if can_act_seats.is_empty()
            || (can_act_seats.len() == 1
                && self
                    .players
                    .iter()
                    .filter(|p| !p.folded && !p.all_in)
                    .all(|p| p.bet_in_round == self.current_bet))
        {
            self.advance_stage();
        } else {
            let first_seat = if can_act_seats.contains(&nominal_first_seat) {
                nominal_first_seat
            } else {
                Self::next_seat_in_list(&can_act_seats, nominal_first_seat)
            };
            self.set_turn_seat(Some(first_seat));
        }

        Ok(())
    }

    fn post_blind(&mut self, seat: usize, blind_amount: u64, label: &str) -> u64 {
        if let Some(p) = self.players.iter_mut().find(|p| p.seat == seat) {
            let actual = p.chips.min(blind_amount);
            p.chips -= actual;
            p.bet_in_round += actual;
            p.total_bet_in_hand += actual;
            self.pot += actual;
            if p.chips == 0 {
                p.all_in = true;
            }
            p.last_action = Some(format!("{} {}", label, actual));
            actual
        } else {
            0
        }
    }

    fn next_seat_in_list(seats: &[usize], current: usize) -> usize {
        for &s in seats {
            if s > current {
                return s;
            }
        }
        seats[0]
    }

    pub fn handle_action(&mut self, player_id: &str, action: PlayerAction) -> Result<(), String> {
        if matches!(self.stage, GameStage::Waiting | GameStage::Showdown) || self.all_in_runout {
            return Err("Сейчас нет активного раунда торговли".to_string());
        }

        let current_seat = self
            .current_turn_seat
            .ok_or_else(|| "Ход не определен".to_string())?;

        let p_idx = self
            .players
            .iter()
            .position(|p| p.id == player_id)
            .ok_or_else(|| "Игрок не за столом".to_string())?;

        if self.players[p_idx].seat != current_seat {
            return Err("Сейчас ход другого игрока".to_string());
        }

        let player_name = self.players[p_idx].name.clone();
        let player_chips = self.players[p_idx].chips;
        let player_bet = self.players[p_idx].bet_in_round;
        let to_call = self.current_bet.saturating_sub(player_bet);

        match action {
            PlayerAction::Fold => {
                self.players[p_idx].folded = true;
                self.players[p_idx].last_action = Some("Пас".to_string());
                self.acted_seats.insert(current_seat);
                self.push_log(format!("{}: Пас", player_name));
            }
            PlayerAction::Check => {
                if to_call > 0 {
                    return Err(format!("Нельзя сказать Чек, нужно уравнять {}", to_call));
                }
                self.players[p_idx].last_action = Some("Чек".to_string());
                self.acted_seats.insert(current_seat);
                self.push_log(format!("{}: Чек", player_name));
            }
            PlayerAction::Call => {
                if to_call == 0 {
                    self.players[p_idx].last_action = Some("Чек".to_string());
                    self.acted_seats.insert(current_seat);
                    self.push_log(format!("{}: Чек", player_name));
                } else {
                    let actual = player_chips.min(to_call);
                    self.players[p_idx].chips -= actual;
                    self.players[p_idx].bet_in_round += actual;
                    self.players[p_idx].total_bet_in_hand += actual;
                    self.pot += actual;
                    if self.players[p_idx].chips == 0 {
                        self.players[p_idx].all_in = true;
                        self.players[p_idx].last_action =
                            Some(format!("Олл-ин {}", self.players[p_idx].bet_in_round));
                        self.push_log(format!("{}: Олл-ин ({})", player_name, actual));
                    } else {
                        self.players[p_idx].last_action = Some(format!("Колл {}", actual));
                        self.push_log(format!("{}: Колл {}", player_name, actual));
                    }
                    self.acted_seats.insert(current_seat);
                }
            }
            PlayerAction::Raise { amount } => {
                let max_total_bet = player_bet + player_chips;
                let target_bet = amount.min(max_total_bet);

                if target_bet <= self.current_bet {
                    return Err(format!(
                        "Ставка должна быть больше текущей ({})",
                        self.current_bet
                    ));
                }

                let raise_diff = target_bet - self.current_bet;
                if raise_diff < self.min_raise && target_bet < max_total_bet {
                    return Err(format!(
                        "Минимальное повышение до {}",
                        self.current_bet + self.min_raise
                    ));
                }

                let added = target_bet - player_bet;
                let was_zero_bet = self.current_bet == 0;
                self.players[p_idx].chips -= added;
                self.players[p_idx].bet_in_round = target_bet;
                self.players[p_idx].total_bet_in_hand += added;
                self.pot += added;

                if raise_diff >= self.min_raise {
                    self.min_raise = raise_diff;
                }
                self.current_bet = target_bet;

                self.acted_seats.clear();
                self.acted_seats.insert(current_seat);

                if self.players[p_idx].chips == 0 {
                    self.players[p_idx].all_in = true;
                    self.players[p_idx].last_action = Some(format!("Олл-ин {}", target_bet));
                    self.push_log(format!("{}: Олл-ин до {}", player_name, target_bet));
                } else if was_zero_bet {
                    self.players[p_idx].last_action = Some(format!("Бет {}", target_bet));
                    self.push_log(format!("{}: Бет {}", player_name, target_bet));
                } else {
                    self.players[p_idx].last_action = Some(format!("Рейз {}", target_bet));
                    self.push_log(format!("{}: Рейз до {}", player_name, target_bet));
                }
            }
            PlayerAction::AllIn => {
                if player_chips == 0 {
                    return Err("Нет фишек для олл-ина".to_string());
                }
                let added = player_chips;
                let new_bet = player_bet + added;
                self.players[p_idx].chips = 0;
                self.players[p_idx].bet_in_round = new_bet;
                self.players[p_idx].total_bet_in_hand += added;
                self.players[p_idx].all_in = true;
                self.pot += added;

                if new_bet > self.current_bet {
                    let raise_diff = new_bet - self.current_bet;
                    if raise_diff >= self.min_raise {
                        self.min_raise = raise_diff;
                    }
                    self.current_bet = new_bet;
                    self.acted_seats.clear();
                }
                self.acted_seats.insert(current_seat);
                self.players[p_idx].last_action = Some(format!("Олл-ин {}", new_bet));
                self.push_log(format!("{}: Олл-ин ({})", player_name, new_bet));
            }
        }

        self.check_hand_progress();
        Ok(())
    }

    fn refund_uncalled_bets(&mut self) {
        let max_active_bet = self
            .players
            .iter()
            .filter(|p| !p.folded)
            .map(|p| p.total_bet_in_hand)
            .max()
            .unwrap_or(0);

        if max_active_bet == 0 {
            return;
        }

        let count_at_max = self
            .players
            .iter()
            .filter(|p| p.total_bet_in_hand >= max_active_bet)
            .count();

        if count_at_max == 1 {
            let second_max = self
                .players
                .iter()
                .filter(|p| p.total_bet_in_hand < max_active_bet)
                .map(|p| p.total_bet_in_hand)
                .max()
                .unwrap_or(0);

            let uncalled = max_active_bet.saturating_sub(second_max);
            if uncalled > 0 {
                if let Some(p) = self
                    .players
                    .iter_mut()
                    .find(|p| !p.folded && p.total_bet_in_hand == max_active_bet)
                {
                    p.chips += uncalled;
                    p.total_bet_in_hand -= uncalled;
                    p.bet_in_round = p.bet_in_round.saturating_sub(uncalled);
                    self.pot = self.pot.saturating_sub(uncalled);
                    let name = p.name.clone();
                    self.push_log(format!(
                        "↩️ {} получает возврат неуравненной ставки: {}",
                        name, uncalled
                    ));
                }
            }
        }
    }

    fn finish_hand_cleanup(&mut self) {
        self.set_turn_seat(None);
        self.all_in_runout = false;
        self.runout_step_started_at = None;
        self.win_probabilities.clear();
        self.showdown_started_at = Some(Instant::now());
        for p in &mut self.players {
            p.bet_in_round = 0;
        }
        self.players.retain(|p| !p.left_voluntarily);
        self.ensure_valid_host();
    }

    fn check_hand_progress(&mut self) {
        let active_count = self.players.iter().filter(|p| !p.folded).count();
        if active_count == 1 {
            self.refund_uncalled_bets();
            let winner = self.players.iter().find(|p| !p.folded).unwrap();
            let winner_id = winner.id.clone();
            let winner_name = winner.name.clone();
            let win_amount = self.pot;
            if let Some(w) = self.players.iter_mut().find(|p| p.id == winner_id) {
                w.chips += win_amount;
            }
            self.winners = vec![WinnerInfo {
                player_id: winner_id,
                player_name: winner_name.clone(),
                amount: win_amount,
                hand_name: "Соперники сбросили карты".to_string(),
                winning_cards: Vec::new(),
            }];
            self.stage = GameStage::Showdown;
            self.push_log(format!(
                "🏆 {} забирает банк {} (все сбросили)",
                winner_name, win_amount
            ));
            self.finish_hand_cleanup();
            return;
        }

        let can_act_seats: Vec<usize> = self
            .players
            .iter()
            .filter(|p| !p.folded && !p.all_in)
            .map(|p| p.seat)
            .collect();

        let all_matched_and_acted = self
            .players
            .iter()
            .filter(|p| !p.folded && !p.all_in)
            .all(|p| p.bet_in_round == self.current_bet && self.acted_seats.contains(&p.seat));

        let lone_actor_covered = can_act_seats.len() == 1
            && self
                .players
                .iter()
                .filter(|p| !p.folded && !p.all_in)
                .all(|p| p.bet_in_round >= self.current_bet)
            && self
                .players
                .iter()
                .filter(|p| !p.folded && p.all_in)
                .all(|p| p.bet_in_round <= self.current_bet);

        if can_act_seats.is_empty() || all_matched_and_acted || lone_actor_covered {
            self.advance_stage();
        } else if let Some(curr) = self.current_turn_seat {
            let next = Self::next_seat_in_list(&can_act_seats, curr);
            self.set_turn_seat(Some(next));
        } else {
            self.set_turn_seat(can_act_seats.first().copied());
        }
    }

    fn advance_stage(&mut self) {
        self.refund_uncalled_bets();

        for p in &mut self.players {
            p.bet_in_round = 0;
            if !p.folded && !p.all_in {
                p.last_action = None;
            }
        }
        self.current_bet = 0;
        self.min_raise = self.big_blind;
        self.acted_seats.clear();

        let can_act_seats: Vec<usize> = self
            .players
            .iter()
            .filter(|p| !p.folded && !p.all_in)
            .map(|p| p.seat)
            .collect();

        // Check if nobody can bet anymore (All-In Runout) and we have streets remaining before Showdown
        if can_act_seats.len() <= 1 && self.stage != GameStage::River {
            self.all_in_runout = true;
            self.set_turn_seat(None);
            self.update_all_in_equities();

            if self.dramatic_runout {
                // Pause on the current street so players see the flipped cards and live Win % before next street deals
                self.runout_step_started_at = Some(Instant::now());
                return;
            }
        }

        loop {
            match self.stage {
                GameStage::Preflop => {
                    self.stage = GameStage::Flop;
                    self.community_cards.push(self.deck.pop().unwrap());
                    self.community_cards.push(self.deck.pop().unwrap());
                    self.community_cards.push(self.deck.pop().unwrap());
                    self.push_log("🃏 Флоп открыт".to_string());
                }
                GameStage::Flop => {
                    self.stage = GameStage::Turn;
                    self.community_cards.push(self.deck.pop().unwrap());
                    self.push_log("🃏 Тёрн открыт".to_string());
                }
                GameStage::Turn => {
                    self.stage = GameStage::River;
                    self.community_cards.push(self.deck.pop().unwrap());
                    self.push_log("🃏 Ривер открыт".to_string());
                }
                GameStage::River => {
                    self.resolve_showdown();
                    return;
                }
                _ => return,
            }

            if can_act_seats.len() <= 1 {
                continue;
            } else {
                let first_seat = Self::next_seat_in_list(&can_act_seats, self.dealer_seat);
                self.set_turn_seat(Some(first_seat));
                break;
            }
        }
    }

    fn resolve_showdown(&mut self) {
        self.stage = GameStage::Showdown;
        self.winners.clear();
        self.revealed_hands.clear();

        for p in &self.players {
            if !p.folded && p.hole_cards.len() == 2 {
                let mut seven = self.community_cards.clone();
                seven.extend_from_slice(&p.hole_cards);
                let eval = evaluate_hand(&seven);
                self.revealed_hands.insert(p.id.clone(), eval);
            }
        }

        let mut levels: Vec<u64> = self
            .players
            .iter()
            .filter(|p| p.total_bet_in_hand > 0)
            .map(|p| p.total_bet_in_hand)
            .collect();
        levels.sort_unstable();
        levels.dedup();

        let mut prev_level = 0u64;
        let mut payouts: HashMap<String, (u64, String, Vec<Card>)> = HashMap::new();

        for level in levels {
            let slice = level - prev_level;
            if slice == 0 {
                continue;
            }

            let contributors = self
                .players
                .iter()
                .filter(|p| p.total_bet_in_hand >= level)
                .count() as u64;
            let sub_pot = slice * contributors;

            let mut contenders: Vec<&Player> = self
                .players
                .iter()
                .filter(|p| !p.folded && p.total_bet_in_hand >= level)
                .collect();

            if contenders.is_empty() {
                contenders = self.players.iter().filter(|p| !p.folded).collect();
            }

            if !contenders.is_empty() {
                let best_eval = contenders
                    .iter()
                    .filter_map(|p| self.revealed_hands.get(&p.id))
                    .max()
                    .unwrap()
                    .clone();

                let mut sub_winners: Vec<&Player> = contenders
                    .into_iter()
                    .filter(|p| self.revealed_hands.get(&p.id) == Some(&best_eval))
                    .collect();

                sub_winners.sort_by_key(|p| p.seat);

                let share = sub_pot / (sub_winners.len() as u64);
                let mut remainder = sub_pot % (sub_winners.len() as u64);

                for w in sub_winners {
                    let extra = if remainder > 0 {
                        remainder -= 1;
                        1
                    } else {
                        0
                    };
                    let total_win = share + extra;
                    let entry = payouts.entry(w.id.clone()).or_insert((
                        0,
                        best_eval.name.clone(),
                        best_eval.best_five.clone(),
                    ));
                    entry.0 += total_win;
                }
            }

            prev_level = level;
        }

        let mut sorted_payouts: Vec<(String, (u64, String, Vec<Card>))> =
            payouts.into_iter().collect();
        sorted_payouts.sort_by_key(|(pid, _)| {
            self.players
                .iter()
                .find(|p| &p.id == pid)
                .map(|p| p.seat)
                .unwrap_or(99)
        });

        for (pid, (amount, hand_name, winning_cards)) in sorted_payouts {
            if amount > 0 {
                if let Some(p) = self.players.iter_mut().find(|p| p.id == pid) {
                    p.chips += amount;
                    let name = p.name.clone();
                    self.winners.push(WinnerInfo {
                        player_id: pid,
                        player_name: name.clone(),
                        amount,
                        hand_name: hand_name.clone(),
                        winning_cards,
                    });
                    self.push_log(format!(
                        "🏆 {} выигрывает {} ({})",
                        name, amount, hand_name
                    ));
                }
            }
        }

        self.finish_hand_cleanup();
    }

    pub fn view_for_player(&self, viewer_id: &str) -> RoomStateView {
        let is_full_showdown = self.stage == GameStage::Showdown && self.revealed_hands.len() > 1;

        let turn_remaining_secs =
            if !matches!(self.stage, GameStage::Waiting | GameStage::Showdown) && !self.all_in_runout
            {
                self.turn_started_at
                    .map(|t| TURN_TIMEOUT_SECS.saturating_sub(t.elapsed().as_secs()))
            } else {
                None
            };

        let next_hand_remaining_secs = if self.stage == GameStage::Showdown
            && self.auto_deal
            && !self.paused
            && self.active_eligible_count() >= 2
        {
            self.showdown_started_at
                .map(|t| AUTO_DEAL_DELAY_SECS.saturating_sub(t.elapsed().as_secs()))
        } else {
            None
        };

        let current_level = self.levels[self.current_level_idx].level;
        let next_level = self.levels.get(self.current_level_idx + 1);
        let level_remaining_secs = match (self.level_duration_secs, self.level_started_at) {
            (Some(dur), Some(started)) if next_level.is_some() => {
                Some(dur.saturating_sub(started.elapsed().as_secs()))
            }
            (Some(dur), None) if next_level.is_some() => Some(dur),
            _ => None,
        };

        let can_show_cards = self.stage == GameStage::Showdown
            && !self.voluntarily_revealed.contains(viewer_id)
            && self.players.iter().any(|p| {
                p.id == viewer_id && p.hole_cards.len() == 2 && (p.folded || !is_full_showdown)
            });

        let players_view = self
            .players
            .iter()
            .map(|p| {
                // Cards are visible if:
                // 1) It's the viewer's own hand
                // 2) Nobody can bet anymore (all_in_runout) and player is not folded
                // 3) Showdown with >= 2 contenders and player is not folded
                // 4) Player voluntarily clicked "Show Cards"
                let can_see_cards = p.id == viewer_id
                    || (self.all_in_runout && !p.folded)
                    || (is_full_showdown && !p.folded)
                    || (self.stage == GameStage::Showdown
                        && self.voluntarily_revealed.contains(&p.id));

                let hole_cards = if can_see_cards {
                    p.hole_cards.iter().copied().map(Some).collect()
                } else {
                    vec![None; p.hole_cards.len()]
                };
                let hand_name = if can_see_cards {
                    if let Some(eval) = self.revealed_hands.get(&p.id) {
                        Some(eval.name.clone())
                    } else if p.hole_cards.len() == 2 && self.community_cards.len() >= 3 {
                        let mut cards = self.community_cards.clone();
                        cards.extend_from_slice(&p.hole_cards);
                        Some(evaluate_hand(&cards).name)
                    } else {
                        None
                    }
                } else {
                    None
                };

                // Win probability is ONLY exposed during All-In Runout (when nobody can bet anymore)
                let win_probability = if self.all_in_runout && !p.folded {
                    self.win_probabilities.get(&p.id).copied()
                } else {
                    None
                };

                PublicPlayerView {
                    id: p.id.clone(),
                    name: p.name.clone(),
                    seat: p.seat,
                    chips: p.chips,
                    bet_in_round: p.bet_in_round,
                    total_bet_in_hand: p.total_bet_in_hand,
                    hole_cards,
                    card_count: p.hole_cards.len(),
                    folded: p.folded,
                    all_in: p.all_in,
                    connected: p.connected,
                    sitting_out: p.sitting_out,
                    video_enabled: p.video_enabled,
                    audio_enabled: p.audio_enabled,
                    last_action: p.last_action.clone(),
                    hand_name,
                    win_probability,
                }
            })
            .collect();

        RoomStateView {
            room_id: self.room_id.clone(),
            room_name: self.room_name.clone(),
            preset_name: self.preset_name.clone(),
            host_id: self.host_id.clone(),
            stage: self.stage,
            all_in_runout: self.all_in_runout,
            pot: self.pot,
            current_bet: self.current_bet,
            min_raise: self.min_raise,
            current_level,
            small_blind: self.small_blind,
            big_blind: self.big_blind,
            ante: self.ante,
            next_small_blind: next_level.map(|l| l.small_blind),
            next_big_blind: next_level.map(|l| l.big_blind),
            next_ante: next_level.map(|l| l.ante),
            level_remaining_secs,
            starting_chips: self.starting_chips,
            dealer_seat: self.dealer_seat,
            small_blind_seat: self.small_blind_seat,
            big_blind_seat: self.big_blind_seat,
            current_turn_seat: self.current_turn_seat,
            turn_remaining_secs,
            turn_total_secs: TURN_TIMEOUT_SECS,
            auto_deal: self.auto_deal,
            paused: self.paused,
            next_hand_remaining_secs,
            can_show_cards,
            community_cards: self.community_cards.clone(),
            players: players_view,
            winners: self.winners.clone(),
            hand_number: self.hand_number,
            log: self.log.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::poker::{Rank, Suit};

    #[test]
    fn test_heads_up_hand_flow() {
        let mut room = PokerRoom::new("test".into(), "Test Room".into(), 10, 20, 1000);
        room.add_or_reconnect_player("p1".into(), "Alice".into())
            .unwrap();
        room.add_or_reconnect_player("p2".into(), "Bob".into())
            .unwrap();

        room.start_new_hand().unwrap();
        assert_eq!(room.stage, GameStage::Preflop);
        assert_eq!(room.pot, 30);

        // During normal betting, win_probability MUST be None
        let view = room.view_for_player("p1");
        assert!(view.players.iter().all(|p| p.win_probability.is_none()));

        let turn_seat = room.current_turn_seat.unwrap();
        let active_id = room
            .players
            .iter()
            .find(|p| p.seat == turn_seat)
            .unwrap()
            .id
            .clone();

        room.handle_action(&active_id, PlayerAction::Call).unwrap();
        assert_eq!(room.stage, GameStage::Preflop);

        let next_seat = room.current_turn_seat.unwrap();
        let next_id = room
            .players
            .iter()
            .find(|p| p.seat == next_seat)
            .unwrap()
            .id
            .clone();
        room.handle_action(&next_id, PlayerAction::Check).unwrap();

        assert_eq!(room.stage, GameStage::Flop);
        assert_eq!(room.community_cards.len(), 3);
    }

    #[test]
    fn test_dramatic_all_in_runout_shows_equities_only_when_betting_closed() {
        let cfg = GamePreset::SngStandard.build_config(Some(10), Some(1000), Some(5));
        let mut room = PokerRoom::new_with_preset("runout".into(), "Runout Room".into(), cfg);
        room.add_or_reconnect_player("p1".into(), "Alice".into())
            .unwrap();
        room.add_or_reconnect_player("p2".into(), "Bob".into())
            .unwrap();

        room.start_new_hand().unwrap();
        // Before all-in, win_probability is None
        assert!(!room.all_in_runout);
        assert!(room
            .view_for_player("p1")
            .players
            .iter()
            .all(|p| p.win_probability.is_none()));

        // Player 1 goes All-In, Player 2 calls
        let s1 = room.current_turn_seat.unwrap();
        let id1 = room
            .players
            .iter()
            .find(|p| p.seat == s1)
            .unwrap()
            .id
            .clone();
        room.handle_action(&id1, PlayerAction::AllIn).unwrap();

        let s2 = room.current_turn_seat.unwrap();
        let id2 = room
            .players
            .iter()
            .find(|p| p.seat == s2)
            .unwrap()
            .id
            .clone();
        room.handle_action(&id2, PlayerAction::Call).unwrap();

        // Now nobody can bet anymore -> all_in_runout is active on Preflop!
        assert!(room.all_in_runout);
        assert_eq!(room.stage, GameStage::Preflop);
        let view = room.view_for_player("p1");
        // Both players' cards are revealed and win_probability is populated!
        for p in &view.players {
            assert!(p.hole_cards[0].is_some());
            assert!(p.win_probability.is_some());
        }

        // Advance through Flop -> Turn -> River/Showdown via timer
        room.runout_step_started_at =
            Some(Instant::now() - std::time::Duration::from_secs(RUNOUT_STREET_DELAY_SECS + 1));
        assert!(room.check_timers());
        assert_eq!(room.stage, GameStage::Flop);

        room.runout_step_started_at =
            Some(Instant::now() - std::time::Duration::from_secs(RUNOUT_STREET_DELAY_SECS + 1));
        assert!(room.check_timers());
        assert_eq!(room.stage, GameStage::Turn);

        room.runout_step_started_at =
            Some(Instant::now() - std::time::Duration::from_secs(RUNOUT_STREET_DELAY_SECS + 1));
        assert!(room.check_timers());
        assert_eq!(room.stage, GameStage::Showdown);
        assert!(!room.all_in_runout);
    }

    #[test]
    fn test_antes_and_blind_level_progression() {
        let config = GamePreset::DeepstackAnte.build_config(Some(10), Some(1000), Some(1));
        let mut room = PokerRoom::new_with_preset("sng".into(), "SNG Room".into(), config);
        room.add_or_reconnect_player("p1".into(), "Alice".into())
            .unwrap();
        room.add_or_reconnect_player("p2".into(), "Bob".into())
            .unwrap();

        room.start_new_hand().unwrap();
        assert_eq!(room.small_blind, 10);
        assert_eq!(room.big_blind, 20);
        assert_eq!(room.ante, 2);
        assert_eq!(room.pot, 34);

        room.level_started_at = Some(Instant::now() - std::time::Duration::from_secs(65));
        room.start_new_hand().unwrap();
        assert_eq!(room.current_level_idx, 1);
        assert_eq!(room.small_blind, 15);
        assert_eq!(room.big_blind, 30);
        assert_eq!(room.ante, 3);
        assert_eq!(room.pot, 51);
    }

    #[test]
    fn test_auto_next_hand_and_show_cards() {
        let mut room = PokerRoom::new("test".into(), "AutoDeal Test".into(), 10, 20, 1000);
        room.add_or_reconnect_player("p1".into(), "Alice".into())
            .unwrap();
        room.add_or_reconnect_player("p2".into(), "Bob".into())
            .unwrap();

        room.start_new_hand().unwrap();
        let turn_seat = room.current_turn_seat.unwrap();
        let active_id = room
            .players
            .iter()
            .find(|p| p.seat == turn_seat)
            .unwrap()
            .id
            .clone();

        room.handle_action(&active_id, PlayerAction::Fold).unwrap();
        assert_eq!(room.stage, GameStage::Showdown);
        assert_eq!(room.hand_number, 1);

        let winner_id = room.winners[0].player_id.clone();
        room.reveal_my_cards(&winner_id).unwrap();
        let viewer_state = room.view_for_player(&active_id);
        let winner_view = viewer_state
            .players
            .iter()
            .find(|p| p.id == winner_id)
            .unwrap();
        assert!(winner_view.hole_cards[0].is_some());

        room.showdown_started_at =
            Some(Instant::now() - std::time::Duration::from_secs(AUTO_DEAL_DELAY_SECS + 1));
        assert!(room.check_timers());
        assert_eq!(room.stage, GameStage::Preflop);
        assert_eq!(room.hand_number, 2);
    }

    #[test]
    fn test_uncalled_bet_instant_refund_and_chip_conservation() {
        let mut room = PokerRoom::new("test".into(), "Uncalled Test".into(), 10, 20, 1000);
        room.add_or_reconnect_player("p1".into(), "Rich".into())
            .unwrap();
        room.add_or_reconnect_player("p2".into(), "Short".into())
            .unwrap();

        room.players.iter_mut().find(|p| p.id == "p1").unwrap().chips = 1000;
        room.players.iter_mut().find(|p| p.id == "p2").unwrap().chips = 200;

        room.start_new_hand().unwrap();

        let first_seat = room.current_turn_seat.unwrap();
        let first_id = room
            .players
            .iter()
            .find(|p| p.seat == first_seat)
            .unwrap()
            .id
            .clone();
        room.handle_action(&first_id, PlayerAction::AllIn).unwrap();

        let second_seat = room.current_turn_seat.unwrap();
        let second_id = room
            .players
            .iter()
            .find(|p| p.seat == second_seat)
            .unwrap()
            .id
            .clone();
        room.handle_action(&second_id, PlayerAction::Call).unwrap();

        assert_eq!(room.stage, GameStage::Showdown);
        assert_eq!(room.pot, 400);
        let total_chips: u64 = room.players.iter().map(|p| p.chips).sum();
        assert_eq!(total_chips, 1200);
        let won_sum: u64 = room.winners.iter().map(|w| w.amount).sum();
        assert_eq!(won_sum, 400);
    }

    #[test]
    fn test_three_way_side_pots_exact_distribution() {
        let mut room = PokerRoom::new("test".into(), "SidePot Test".into(), 10, 20, 1000);
        room.add_or_reconnect_player("p1".into(), "Short100".into())
            .unwrap();
        room.add_or_reconnect_player("p2".into(), "Mid300".into())
            .unwrap();
        room.add_or_reconnect_player("p3".into(), "Deep1000".into())
            .unwrap();

        room.players[0].chips = 100;
        room.players[1].chips = 300;
        room.players[2].chips = 1000;

        room.start_new_hand().unwrap();

        while room.stage != GameStage::Showdown {
            let turn_seat = room.current_turn_seat.unwrap();
            let pid = room
                .players
                .iter()
                .find(|p| p.seat == turn_seat)
                .unwrap()
                .id
                .clone();
            room.handle_action(&pid, PlayerAction::AllIn).unwrap();
        }

        room.players[0].chips = 0;
        room.players[0].total_bet_in_hand = 100;
        room.players[0].hole_cards = vec![
            Card::new(Rank::Ace, Suit::Spades),
            Card::new(Rank::King, Suit::Spades),
        ];

        room.players[1].chips = 0;
        room.players[1].total_bet_in_hand = 300;
        room.players[1].hole_cards = vec![
            Card::new(Rank::Ace, Suit::Hearts),
            Card::new(Rank::Ace, Suit::Diamonds),
        ];

        room.players[2].chips = 700;
        room.players[2].total_bet_in_hand = 300;
        room.players[2].hole_cards = vec![
            Card::new(Rank::Two, Suit::Clubs),
            Card::new(Rank::Seven, Suit::Diamonds),
        ];

        room.community_cards = vec![
            Card::new(Rank::Queen, Suit::Spades),
            Card::new(Rank::Jack, Suit::Spades),
            Card::new(Rank::Ten, Suit::Spades),
            Card::new(Rank::Ace, Suit::Clubs),
            Card::new(Rank::Two, Suit::Hearts),
        ];

        room.resolve_showdown();

        assert_eq!(room.players[0].chips, 300);
        assert_eq!(room.players[1].chips, 400);
        assert_eq!(room.players[2].chips, 700);
        assert_eq!(room.players.iter().map(|p| p.chips).sum::<u64>(), 1400);
    }

    #[test]
    fn test_voluntary_leave_vs_reconnect() {
        let mut room = PokerRoom::new("test".into(), "Leave Test".into(), 10, 20, 1000);
        room.add_or_reconnect_player("p1".into(), "Alice".into())
            .unwrap();
        room.add_or_reconnect_player("p2".into(), "Bob".into())
            .unwrap();

        room.set_player_disconnected("p2");
        assert_eq!(room.players.len(), 2);
        assert!(!room.players[1].connected);

        room.add_or_reconnect_player("p2".into(), "Bob".into())
            .unwrap();
        assert!(room.players[1].connected);

        room.leave_player("p2");
        assert_eq!(room.players.len(), 1);
    }
}
