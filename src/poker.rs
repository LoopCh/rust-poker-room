use rand::seq::SliceRandom;
use rand::thread_rng;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Suit {
    Spades,
    Hearts,
    Diamonds,
    Clubs,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[repr(u8)]
pub enum Rank {
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9,
    Ten = 10,
    Jack = 11,
    Queen = 12,
    King = 13,
    Ace = 14,
}

impl Rank {
    pub fn value(self) -> u8 {
        self as u8
    }

    pub fn symbol(self) -> &'static str {
        match self {
            Rank::Two => "2",
            Rank::Three => "3",
            Rank::Four => "4",
            Rank::Five => "5",
            Rank::Six => "6",
            Rank::Seven => "7",
            Rank::Eight => "8",
            Rank::Nine => "9",
            Rank::Ten => "10",
            Rank::Jack => "J",
            Rank::Queen => "Q",
            Rank::King => "K",
            Rank::Ace => "A",
        }
    }
}

impl Suit {
    pub fn symbol(self) -> &'static str {
        match self {
            Suit::Spades => "♠",
            Suit::Hearts => "♥",
            Suit::Diamonds => "♦",
            Suit::Clubs => "♣",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
pub struct Card {
    pub rank: u8,
    pub suit: Suit,
    pub label: &'static str,
    pub suit_symbol: &'static str,
}

impl Card {
    pub fn new(rank: Rank, suit: Suit) -> Self {
        Self {
            rank: rank.value(),
            suit,
            label: rank.symbol(),
            suit_symbol: suit.symbol(),
        }
    }
}

pub fn create_ordered_deck() -> Vec<Card> {
    let suits = [Suit::Spades, Suit::Hearts, Suit::Diamonds, Suit::Clubs];
    let ranks = [
        Rank::Two,
        Rank::Three,
        Rank::Four,
        Rank::Five,
        Rank::Six,
        Rank::Seven,
        Rank::Eight,
        Rank::Nine,
        Rank::Ten,
        Rank::Jack,
        Rank::Queen,
        Rank::King,
        Rank::Ace,
    ];
    let mut deck = Vec::with_capacity(52);
    for &suit in &suits {
        for &rank in &ranks {
            deck.push(Card::new(rank, suit));
        }
    }
    deck
}

pub fn create_shuffled_deck() -> Vec<Card> {
    let mut deck = create_ordered_deck();
    let mut rng = thread_rng();
    deck.shuffle(&mut rng);
    deck
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum HandCategory {
    HighCard = 1,
    OnePair = 2,
    TwoPair = 3,
    ThreeOfAKind = 4,
    Straight = 5,
    Flush = 6,
    FullHouse = 7,
    FourOfAKind = 8,
    StraightFlush = 9,
}

impl HandCategory {
    pub fn name_ru(&self) -> &'static str {
        match self {
            HandCategory::HighCard => "Старшая карта",
            HandCategory::OnePair => "Пара",
            HandCategory::TwoPair => "Две пары",
            HandCategory::ThreeOfAKind => "Сет (Тройка)",
            HandCategory::Straight => "Стрит",
            HandCategory::Flush => "Флеш",
            HandCategory::FullHouse => "Фулл-хаус",
            HandCategory::FourOfAKind => "Каре",
            HandCategory::StraightFlush => "Стрит-флеш",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct EvaluatedHand {
    pub category: HandCategory,
    pub tiebreakers: Vec<u8>,
    pub best_five: Vec<Card>,
    pub name: String,
}

impl PartialOrd for EvaluatedHand {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for EvaluatedHand {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.category.cmp(&other.category) {
            Ordering::Equal => self.tiebreakers.cmp(&other.tiebreakers),
            ord => ord,
        }
    }
}

/// Evaluates a 5-to-7 card Texas Hold'em hand and returns the best 5-card hand
pub fn evaluate_hand(cards: &[Card]) -> EvaluatedHand {
    assert!(cards.len() >= 5, "Need at least 5 cards to evaluate hand");
    let n = cards.len();
    let mut best: Option<EvaluatedHand> = None;

    for i in 0..n {
        for j in (i + 1)..n {
            for k in (j + 1)..n {
                for l in (k + 1)..n {
                    for m in (l + 1)..n {
                        let five = [cards[i], cards[j], cards[k], cards[l], cards[m]];
                        let eval = evaluate_five(&five);
                        if best.as_ref().map_or(true, |b| eval > *b) {
                            best = Some(eval);
                        }
                    }
                }
            }
        }
    }

    best.unwrap()
}

fn evaluate_five(cards: &[Card; 5]) -> EvaluatedHand {
    let is_flush = cards.iter().all(|c| c.suit == cards[0].suit);

    let mut ranks: Vec<u8> = cards.iter().map(|c| c.rank).collect();
    ranks.sort_unstable_by(|a, b| b.cmp(a));

    let is_wheel = ranks == vec![14, 5, 4, 3, 2];
    let is_normal_straight = ranks.windows(2).all(|w| w[0] == w[1] + 1);
    let is_straight = is_wheel || is_normal_straight;
    let straight_high = if is_wheel { 5 } else { ranks[0] };

    let mut counts = [0u8; 15];
    for &r in &ranks {
        counts[r as usize] += 1;
    }

    let mut groups: Vec<(u8, u8)> = (2..=14)
        .filter(|&r| counts[r as usize] > 0)
        .map(|r| (counts[r as usize], r))
        .collect();
    groups.sort_unstable_by(|a, b| b.cmp(a));

    let (category, tiebreakers) = if is_straight && is_flush {
        (HandCategory::StraightFlush, vec![straight_high])
    } else if groups[0].0 == 4 {
        (HandCategory::FourOfAKind, vec![groups[0].1, groups[1].1])
    } else if groups[0].0 == 3 && groups[1].0 == 2 {
        (HandCategory::FullHouse, vec![groups[0].1, groups[1].1])
    } else if is_flush {
        (HandCategory::Flush, ranks.clone())
    } else if is_straight {
        (HandCategory::Straight, vec![straight_high])
    } else if groups[0].0 == 3 {
        (
            HandCategory::ThreeOfAKind,
            vec![groups[0].1, groups[1].1, groups[2].1],
        )
    } else if groups[0].0 == 2 && groups[1].0 == 2 {
        (
            HandCategory::TwoPair,
            vec![groups[0].1, groups[1].1, groups[2].1],
        )
    } else if groups[0].0 == 2 {
        (
            HandCategory::OnePair,
            vec![groups[0].1, groups[1].1, groups[2].1, groups[3].1],
        )
    } else {
        (HandCategory::HighCard, ranks.clone())
    };

    let name = if category == HandCategory::StraightFlush && straight_high == 14 {
        "Роял-флеш".to_string()
    } else {
        category.name_ru().to_string()
    };

    EvaluatedHand {
        category,
        tiebreakers,
        best_five: cards.to_vec(),
        name,
    }
}

/// Zero-allocation fast 5-card evaluator returning a packed u32 score for rapid All-In equity calculation
#[inline]
fn evaluate_five_fast(cards: &[Card; 5]) -> u32 {
    let s0 = cards[0].suit;
    let is_flush = cards[1].suit == s0
        && cards[2].suit == s0
        && cards[3].suit == s0
        && cards[4].suit == s0;

    let mut r = [
        cards[0].rank,
        cards[1].rank,
        cards[2].rank,
        cards[3].rank,
        cards[4].rank,
    ];
    r.sort_unstable_by(|a, b| b.cmp(a));

    let is_wheel = r == [14, 5, 4, 3, 2];
    let is_normal_straight =
        r[0] == r[1] + 1 && r[1] == r[2] + 1 && r[2] == r[3] + 1 && r[3] == r[4] + 1;
    let is_straight = is_wheel || is_normal_straight;
    let straight_high = if is_wheel { 5 } else { r[0] };

    if is_straight && is_flush {
        return (9 << 20) | ((straight_high as u32) << 16);
    }

    let mut counts = [0u8; 15];
    for &rank in &r {
        counts[rank as usize] += 1;
    }

    // Collect up to 5 (count, rank) pairs on the stack
    let mut groups = [(0u8, 0u8); 5];
    let mut g_len = 0usize;
    for rank in (2..=14).rev() {
        let c = counts[rank as usize];
        if c > 0 {
            groups[g_len] = (c, rank);
            g_len += 1;
        }
    }
    groups[..g_len].sort_unstable_by(|a, b| b.cmp(a));

    let pack = |cat: u32, t0: u8, t1: u8, t2: u8, t3: u8, t4: u8| -> u32 {
        (cat << 20)
            | ((t0 as u32) << 16)
            | ((t1 as u32) << 12)
            | ((t2 as u32) << 8)
            | ((t3 as u32) << 4)
            | (t4 as u32)
    };

    if groups[0].0 == 4 {
        pack(8, groups[0].1, groups[1].1, 0, 0, 0)
    } else if groups[0].0 == 3 && groups[1].0 == 2 {
        pack(7, groups[0].1, groups[1].1, 0, 0, 0)
    } else if is_flush {
        pack(6, r[0], r[1], r[2], r[3], r[4])
    } else if is_straight {
        pack(5, straight_high, 0, 0, 0, 0)
    } else if groups[0].0 == 3 {
        pack(4, groups[0].1, groups[1].1, groups[2].1, 0, 0)
    } else if groups[0].0 == 2 && groups[1].0 == 2 {
        pack(3, groups[0].1, groups[1].1, groups[2].1, 0, 0)
    } else if groups[0].0 == 2 {
        pack(2, groups[0].1, groups[1].1, groups[2].1, groups[3].1, 0)
    } else {
        pack(1, r[0], r[1], r[2], r[3], r[4])
    }
}

#[inline]
fn evaluate_seven_fast(c: &[Card; 7]) -> u32 {
    let mut best = 0u32;
    for i in 0..7 {
        for j in (i + 1)..7 {
            for k in (j + 1)..7 {
                for l in (k + 1)..7 {
                    for m in (l + 1)..7 {
                        let score = evaluate_five_fast(&[c[i], c[j], c[k], c[l], c[m]]);
                        if score > best {
                            best = score;
                        }
                    }
                }
            }
        }
    }
    best
}

/// Calculates each active player's win/tie equity percentage (0.0..=100.0)
/// when everyone is All-In and no further betting is possible.
pub fn calculate_all_in_equities(
    contenders: &[(String, [Card; 2])],
    community: &[Card],
) -> HashMap<String, f32> {
    let mut result = HashMap::new();
    if contenders.is_empty() {
        return result;
    }
    if contenders.len() == 1 {
        result.insert(contenders[0].0.clone(), 100.0);
        return result;
    }

    // Build remaining deck excluding known hole cards and community cards
    let full_deck = create_ordered_deck();
    let remaining: Vec<Card> = full_deck
        .into_iter()
        .filter(|card| {
            !community.contains(card)
                && !contenders
                    .iter()
                    .any(|(_, hole)| hole[0] == *card || hole[1] == *card)
        })
        .collect();

    let n_players = contenders.len();
    let mut equity_shares = vec![0.0f64; n_players];
    let mut total_trials = 0u32;

    let mut eval_board = |board: &[Card; 5]| {
        let mut best_score = 0u32;
        let mut scores = [0u32; 6];
        for (idx, (_, hole)) in contenders.iter().enumerate() {
            let seven = [
                board[0], board[1], board[2], board[3], board[4], hole[0], hole[1],
            ];
            let s = evaluate_seven_fast(&seven);
            scores[idx] = s;
            if s > best_score {
                best_score = s;
            }
        }
        let winners_count = scores[..n_players]
            .iter()
            .filter(|&&s| s == best_score)
            .count();
        let share = 1.0 / (winners_count as f64);
        for idx in 0..n_players {
            if scores[idx] == best_score {
                equity_shares[idx] += share;
            }
        }
        total_trials += 1;
    };

    match community.len() {
        5 => {
            let board = [
                community[0],
                community[1],
                community[2],
                community[3],
                community[4],
            ];
            eval_board(&board);
        }
        4 => {
            // Exact enumeration of all remaining river cards (~44 cards)
            for &river in &remaining {
                let board = [
                    community[0],
                    community[1],
                    community[2],
                    community[3],
                    river,
                ];
                eval_board(&board);
            }
        }
        3 => {
            // Exact enumeration of all remaining (turn, river) pairs (~990 pairs)
            for i in 0..remaining.len() {
                for j in (i + 1)..remaining.len() {
                    let board = [
                        community[0],
                        community[1],
                        community[2],
                        remaining[i],
                        remaining[j],
                    ];
                    eval_board(&board);
                }
            }
        }
        _ => {
            // Preflop (0 cards): 900 Monte Carlo rollouts
            let mut rng = thread_rng();
            let needed = 5usize.saturating_sub(community.len());
            for _ in 0..900 {
                let sampled: Vec<Card> = remaining
                    .choose_multiple(&mut rng, needed)
                    .copied()
                    .collect();
                let mut board = [ sampled[0]; 5 ];
                for (i, &c) in community.iter().enumerate() {
                    board[i] = c;
                }
                for (i, &c) in sampled.iter().enumerate() {
                    board[community.len() + i] = c;
                }
                eval_board(&board);
            }
        }
    }

    if total_trials > 0 {
        for (idx, (pid, _)) in contenders.iter().enumerate() {
            let pct = ((equity_shares[idx] / (total_trials as f64)) * 1000.0).round() as f32 / 10.0;
            result.insert(pid.clone(), pct);
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hand_evaluation_order() {
        let royal = evaluate_hand(&[
            Card::new(Rank::Ace, Suit::Spades),
            Card::new(Rank::King, Suit::Spades),
            Card::new(Rank::Queen, Suit::Spades),
            Card::new(Rank::Jack, Suit::Spades),
            Card::new(Rank::Ten, Suit::Spades),
            Card::new(Rank::Two, Suit::Hearts),
            Card::new(Rank::Three, Suit::Clubs),
        ]);
        assert_eq!(royal.category, HandCategory::StraightFlush);
        assert_eq!(royal.name, "Роял-флеш");

        let wheel = evaluate_hand(&[
            Card::new(Rank::Ace, Suit::Spades),
            Card::new(Rank::Two, Suit::Hearts),
            Card::new(Rank::Three, Suit::Diamonds),
            Card::new(Rank::Four, Suit::Clubs),
            Card::new(Rank::Five, Suit::Spades),
            Card::new(Rank::King, Suit::Hearts),
            Card::new(Rank::Nine, Suit::Clubs),
        ]);
        assert_eq!(wheel.category, HandCategory::Straight);
        assert_eq!(wheel.tiebreakers, vec![5]);
        assert!(royal > wheel);
    }

    #[test]
    fn test_full_house_vs_flush() {
        let fh = evaluate_hand(&[
            Card::new(Rank::King, Suit::Spades),
            Card::new(Rank::King, Suit::Hearts),
            Card::new(Rank::King, Suit::Diamonds),
            Card::new(Rank::Ten, Suit::Clubs),
            Card::new(Rank::Ten, Suit::Spades),
            Card::new(Rank::Two, Suit::Hearts),
            Card::new(Rank::Three, Suit::Clubs),
        ]);
        let fl = evaluate_hand(&[
            Card::new(Rank::Ace, Suit::Hearts),
            Card::new(Rank::Queen, Suit::Hearts),
            Card::new(Rank::Nine, Suit::Hearts),
            Card::new(Rank::Six, Suit::Hearts),
            Card::new(Rank::Two, Suit::Hearts),
            Card::new(Rank::King, Suit::Spades),
            Card::new(Rank::Ten, Suit::Clubs),
        ]);
        assert!(fh > fl);
    }

    #[test]
    fn test_all_in_equity_calculation_turn_exact() {
        // Player 1 has Nut Flush Draw (9 outs on river out of 44 remaining cards = 9/44 = 20.5%)
        // Player 2 has Set of Kings (35/44 = 79.5%)
        let contenders = vec![
            (
                "p1".to_string(),
                [
                    Card::new(Rank::Ace, Suit::Hearts),
                    Card::new(Rank::Queen, Suit::Hearts),
                ],
            ),
            (
                "p2".to_string(),
                [
                    Card::new(Rank::King, Suit::Spades),
                    Card::new(Rank::King, Suit::Diamonds),
                ],
            ),
        ];
        let board = vec![
            Card::new(Rank::King, Suit::Clubs),
            Card::new(Rank::Seven, Suit::Hearts),
            Card::new(Rank::Two, Suit::Hearts),
            Card::new(Rank::Nine, Suit::Clubs),
        ];

        let eq = calculate_all_in_equities(&contenders, &board);
        let p1_eq = *eq.get("p1").unwrap();
        let p2_eq = *eq.get("p2").unwrap();
        // 8 hearts left that don't pair the board (7h, 2h on board; Kh is one of 9 hearts, wait: 9c and Kc on board, so 9h and Kh would give P2 a Full House! So 7 clean heart outs = 7/44 = 15.9%)
        assert!((p1_eq + p2_eq - 100.0).abs() < 0.2);
        assert!((p1_eq - 15.9).abs() < 0.5);
    }
}
