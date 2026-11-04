// game.js — logic thuần của trò chơi phiên live.
// Chỉ import CONFIG. Không dùng window/document, không dùng THREE.
// Mọi hàm nhận nowMs tường minh để kiểm chứng được bằng harness.
//
// Trạng thái người chơi: { uniqueId, name, coins, tier }.
// tier 0 là bậc mở đầu; tier 5 là bậc cao nhất. Chi phí lên bậc
// kế tiếp đọc từ CONFIG.tiers (bậc đích): khi CONFIG.tiers có
// 6 phần tử thì chi phí lên bậc k là tiers[k].cost; khi chỉ có
// 5 phần tử thì chi phí lên bậc k là tiers[k - 1].cost.
// Vốn mở hàng chỉ cộng một lần qua join() trong phiên. chat/bán/
// bình chọn/nâng cấp gặp người chưa có trong map thì tạo mới
// với 0 xu, không cộng vốn mở hàng. reset() xóa toàn bộ.
// Giờ cao điểm chỉ nhân đôi phần cộng xu của mốc like.

import { CONFIG } from '../config.js';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const CFG = CONFIG || {};
const ECO = (CFG && CFG.economy) || {};
const TIERS = Array.isArray(CFG.tiers) ? CFG.tiers : [];

const JOIN_BONUS = num(ECO.joinBonus, 5);
const CHAT_COIN = num(ECO.chatCoin, 1);
const CHAT_COOLDOWN_MS = num(ECO.chatCooldownSeconds, 10) * 1000;
const SELL_COIN = num(ECO.sellCoin, 5);
const SELL_COOLDOWN_MS = num(ECO.sellCooldownSeconds, 30) * 1000;
const LIKE_STEP = num(ECO.likeStep, 10);
const LIKE_COIN = num(ECO.likeCoin, 2);
const LIKE_MAX_PER_30MIN = num(ECO.likeMaxMilestonesPer30Min, 5);
const RUSH_MULTIPLIER = num(ECO.rushMultiplier, 2);
const RUSH_SECONDS = num(ECO.rushSeconds, 300);
const VOTE_COIN = num(ECO.voteCoin, 10);
const VOTE_WINDOW_MS = num(ECO.voteWindowMinutes, 5) * 60 * 1000;
const MAX_TIER = 5;
const THIRTY_MIN_MS = 30 * 60 * 1000;

const VOTE_DISHES = Array.isArray(ECO.voteDishes) && ECO.voteDishes.length >= 2
  ? ECO.voteDishes
  : [{ label: 'Món 1' }, { label: 'Món 2' }];

function tierCost(nextTier) {
  if (!TIERS.length) return Infinity;
  const entry = TIERS.length > MAX_TIER ? TIERS[nextTier] : TIERS[nextTier - 1];
  if (!entry) return Infinity;
  return num(entry.cost, Infinity);
}

function tierLabel(tier) {
  const entry = TIERS.length > MAX_TIER ? TIERS[tier] : TIERS[tier - 1];
  if (entry && typeof entry.label === 'string' && entry.label) return entry.label;
  if (entry && typeof entry.name === 'string' && entry.name) return entry.name;
  return `Bậc ${tier}`;
}

function dishLabel(choice) {
  const idx = choice === '2' ? 1 : 0;
  const dish = VOTE_DISHES[idx];
  if (dish && typeof dish.label === 'string' && dish.label) return dish.label;
  return idx === 1 ? 'Món 2' : 'Món 1';
}

function nowOrDateNow(nowMs) {
  const n = Number(nowMs);
  return Number.isFinite(n) ? n : Date.now();
}

export function createGame() {
  const players = new Map();
  let joinOrder = 0;
  let lastTotalLikes = 0;
  let likeRemainder = 0;
  let milestoneTimes = [];
  let voteState = null;
  let rushUntil = 0;

  function publicPlayer(rec) {
    return {
      uniqueId: rec.uniqueId,
      name: rec.name,
      coins: rec.coins,
      tier: rec.tier,
      tierLabel: tierLabel(rec.tier),
    };
  }

  function ensurePlayer(uniqueId, name) {
    const id = String(uniqueId || '');
    if (!id) return null;
    let rec = players.get(id);
    if (!rec) {
      rec = {
        uniqueId: id,
        name: String(name || id),
        coins: 0,
        tier: 0,
        lastChatAt: -Infinity,
        lastSellAt: -Infinity,
        order: joinOrder,
      };
      joinOrder += 1;
      players.set(id, rec);
    } else if (name) {
      rec.name = String(name);
    }
    return rec;
  }

  function join(uniqueId, name) {
    const id = String(uniqueId || '');
    if (!id) return null;
    const existing = players.get(id);
    if (existing) {
      if (name) existing.name = String(name);
      return publicPlayer(existing);
    }
    const rec = {
      uniqueId: id,
      name: String(name || id),
      coins: JOIN_BONUS,
      tier: 0,
      lastChatAt: -Infinity,
      lastSellAt: -Infinity,
      order: joinOrder,
    };
    joinOrder += 1;
    players.set(id, rec);
    return publicPlayer(rec);
  }

  function chat(uniqueId, name, text, nowMs) {
    void text;
    const rec = ensurePlayer(uniqueId, name);
    if (!rec) return 0;
    const now = nowOrDateNow(nowMs);
    if (now - rec.lastChatAt < CHAT_COOLDOWN_MS) return 0;
    rec.lastChatAt = now;
    rec.coins += CHAT_COIN;
    return CHAT_COIN;
  }

  function sell(uniqueId, name, dish, nowMs) {
    const cleanDish = String(dish == null ? '' : dish).trim();
    if (!cleanDish) return 0;
    const rec = ensurePlayer(uniqueId, name);
    if (!rec) return 0;
    const now = nowOrDateNow(nowMs);
    if (now - rec.lastSellAt < SELL_COOLDOWN_MS) return 0;
    rec.lastSellAt = now;
    rec.coins += SELL_COIN;
    return SELL_COIN;
  }

  function likeTick(totalLikes, nowMs) {
    const total = Math.max(0, num(totalLikes, 0));
    const now = nowOrDateNow(nowMs);
    let delta;
    if (total >= lastTotalLikes) {
      delta = total - lastTotalLikes;
    } else {
      delta = total;
    }
    lastTotalLikes = total;
    if (LIKE_STEP <= 0) return { milestones: 0, coinsPerPlayer: 0 };
    likeRemainder += delta;
    const crossed = Math.floor(likeRemainder / LIKE_STEP);
    likeRemainder -= crossed * LIKE_STEP;
    if (crossed <= 0) return { milestones: 0, coinsPerPlayer: 0 };
    milestoneTimes = milestoneTimes.filter((t) => now - t < THIRTY_MIN_MS);
    const perMilestone = LIKE_COIN * (now < rushUntil ? RUSH_MULTIPLIER : 1);
    let awarded = 0;
    for (let i = 0; i < crossed; i += 1) {
      if (milestoneTimes.length >= LIKE_MAX_PER_30MIN) break;
      milestoneTimes.push(now);
      awarded += 1;
    }
    if (awarded > 0) {
      const gain = awarded * perMilestone;
      for (const rec of players.values()) rec.coins += gain;
      return { milestones: awarded, coinsPerPlayer: gain };
    }
    return { milestones: 0, coinsPerPlayer: 0 };
  }

  function openVote(nowMs) {
    voteState = {
      openedAt: nowOrDateNow(nowMs),
      votes: new Map(),
      counts: { 1: 0, 2: 0 },
    };
    return { open: true, openedAt: voteState.openedAt };
  }

  function normalizeChoice(choice) {
    if (choice === 1 || choice === '1' || choice === 'A' || choice === 'a') return '1';
    if (choice === 2 || choice === '2' || choice === 'B' || choice === 'b') return '2';
    return null;
  }

  function isVoteOpen(nowMs) {
    if (!voteState) return false;
    return nowOrDateNow(nowMs) - voteState.openedAt < VOTE_WINDOW_MS;
  }

  function vote(choice, uniqueId, nowMs) {
    if (!voteState) return false;
    const now = nowOrDateNow(nowMs);
    if (now - voteState.openedAt >= VOTE_WINDOW_MS) return false;
    const picked = normalizeChoice(choice);
    if (!picked) return false;
    const rec = ensurePlayer(uniqueId, null);
    if (!rec) return false;
    const prev = voteState.votes.get(rec.uniqueId);
    if (prev === picked) return true;
    if (prev) voteState.counts[prev] -= 1;
    voteState.votes.set(rec.uniqueId, picked);
    voteState.counts[picked] += 1;
    return true;
  }

  function closeVote() {
    if (!voteState) return null;
    const counts = { 1: voteState.counts[1], 2: voteState.counts[2] };
    let winner = null;
    if (counts[1] !== counts[2]) winner = counts[1] > counts[2] ? '1' : '2';
    let awarded = 0;
    if (winner) {
      for (const [id, picked] of voteState.votes.entries()) {
        if (picked === winner) {
          const rec = players.get(id);
          if (rec) {
            rec.coins += VOTE_COIN;
            awarded += 1;
          }
        }
      }
    }
    const result = {
      winner,
      dish: winner ? dishLabel(winner) : null,
      counts,
      awarded,
    };
    voteState = null;
    return result;
  }

  function upgrade(uniqueId, nowMs) {
    void nowMs;
    const rec = ensurePlayer(uniqueId, null);
    if (!rec) return { ok: false, tier: 0, coins: 0 };
    if (rec.tier >= MAX_TIER) {
      return { ok: false, tier: rec.tier, coins: rec.coins };
    }
    const cost = tierCost(rec.tier + 1);
    if (!Number.isFinite(cost) || rec.coins < cost) {
      return { ok: false, tier: rec.tier, coins: rec.coins };
    }
    rec.coins -= cost;
    rec.tier += 1;
    return { ok: true, tier: rec.tier, coins: rec.coins, tierLabel: tierLabel(rec.tier) };
  }

  function leaderboard() {
    return [...players.values()]
      .sort((a, b) => b.coins - a.coins || a.order - b.order)
      .slice(0, 5)
      .map(publicPlayer);
  }

  function getPlayer(uniqueId) {
    const rec = players.get(String(uniqueId || ''));
    return rec ? publicPlayer(rec) : null;
  }

  function playerCount() {
    return players.size;
  }

  function sessionCoins() {
    let total = 0;
    for (const rec of players.values()) total += rec.coins;
    return total;
  }

  function reset() {
    players.clear();
    joinOrder = 0;
    lastTotalLikes = 0;
    likeRemainder = 0;
    milestoneTimes = [];
    voteState = null;
    rushUntil = 0;
  }

  function setRushUntil(ms) {
    rushUntil = num(ms, 0);
  }

  function isRush(nowMs) {
    return nowOrDateNow(nowMs) < rushUntil;
  }

  return {
    join,
    chat,
    sell,
    likeTick,
    openVote,
    vote,
    closeVote,
    upgrade,
    leaderboard,
    getPlayer,
    playerCount,
    reset,
    setRushUntil,
    isRush,
    sessionCoins,
    isVoteOpen,
    rushSeconds: RUSH_SECONDS,
  };
}
