// handlers.js — nối sự kiện live thật sang logic game + cảnh + âm thanh + giọng máy.
// Mọi hiệu ứng chỉ chạy từ sự kiện thật. Mọi gọi scene/audio/tts đều
// bọc riêng: lỗi một hiệu ứng không chặn các hiệu ứng khác.
// Không có DOM trong Node thì phần HUD tự bỏ qua, logic vẫn chạy.
//
// Quyết định API đã đơn giản hóa (ghi rõ theo hợp đồng):
//  (1) Tên người chơi: chỉ showWelcomeName() lúc vào phòng. Chat
//      thường KHÔNG gọi showWelcomeName() — sprite chào tái dùng
//      cho từng chat sẽ thành spam chào; chat chỉ có xu bay + HUD.
//  (2) Món hàng của lệnh bán: KHÔNG hiện chữ món lên cảnh (không có
//      API trạng thái sạp, và showVoteResult() là biểu ngữ bình
//      chọn, dùng sai nghĩa sẽ đè biểu ngữ bình chọn). Lệnh bán chỉ
//      cộng xu + xu bay + HUD.
//  (3) Bình chọn: không có API sáng phe trong cảnh, nên từng phiếu
//      chỉ ghi nhận im lặng; lúc chốt mới hiện showVoteResult().
//  (4) Tên bậc mới lấy từ CONFIG.tiers (label/name) qua game.

import { CONFIG } from '../config.js';
import { createGame } from './game.js';
import { filterComment } from './filter.js';

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stripDiacritics(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

const CFG = CONFIG || {};
const ECO = (CFG && CFG.economy) || {};
const TTS_CFG = (CFG && CFG.tts) || {};
const SCHEDULE_CFG = (CFG && CFG.schedule) || {};

const JOIN_BONUS = num(ECO.joinBonus, 5);
const RUSH_SECONDS = num(ECO.rushSeconds, 300);
const BIG_THRESHOLD = num(
  CFG.gifts && CFG.gifts.bigThresholdDiamonds, 10,
);
const COMMENT_INTERVAL_MS = num(TTS_CFG.commentMinIntervalSeconds, 120) * 1000;
const FOLLOW_INTERVAL_MS = num(TTS_CFG.followMinIntervalSeconds, 20) * 1000;
const TIER_TTS_INTERVAL_MS = FOLLOW_INTERVAL_MS;

const VOTE_DISHES = Array.isArray(ECO.voteDishes) && ECO.voteDishes.length >= 2
  ? ECO.voteDishes
  : [{ label: 'Món 1' }, { label: 'Món 2' }];

function dishLabel(idx) {
  const dish = VOTE_DISHES[idx];
  if (dish && typeof dish.label === 'string' && dish.label) return dish.label;
  return idx === 1 ? 'Món 2' : 'Món 1';
}

function ritualDef(key) {
  const list = Array.isArray(SCHEDULE_CFG.rituals) ? SCHEDULE_CFG.rituals : [];
  return list.find((r) => r && r.key === key) || null;
}

function ritualLine(key, fallback) {
  const def = ritualDef(key);
  if (def && typeof def.line === 'string' && def.line) return def.line;
  return fallback;
}

// Danh sách kiểm tra nội bộ cho TTS — không phải chuỗi hiển thị.
const TTS_BLOCKED_FORMS = new Set([
  'xin', 'thương', 'giúp', 'khổ', 'đói', 'cứu', 'làm ơn', 'tội nghiệp', 'hoàn cảnh', 'ăn xin',
].map(stripDiacritics));

function commentBlockedForTts(text) {
  const tokens = stripDiacritics(text).split(/[^a-z0-9]+/).filter(Boolean);
  for (const token of tokens) {
    if (TTS_BLOCKED_FORMS.has(token)) return true;
  }
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    if (TTS_BLOCKED_FORMS.has(`${tokens[i]} ${tokens[i + 1]}`)) return true;
  }
  return false;
}

function isSellCommand(text) {
  const t = String(text || '').trim().toLowerCase();
  return t.startsWith('bán:') || t.startsWith('ban:');
}

function sellDish(text) {
  const trimmed = String(text || '').trim();
  const idx = trimmed.indexOf(':');
  if (idx === -1) return '';
  return trimmed.slice(idx + 1).trim();
}

function isUpgradeCommand(text) {
  const t = stripDiacritics(String(text || '').trim());
  return t === 'nang cap';
}

function isVoteText(text) {
  const t = String(text == null ? '' : text).trim();
  if (t === '1') return '1';
  if (t === '2') return '2';
  return null;
}

export function initGameHandlers({ scene, audio, events, tts } = {}) {
  const game = createGame();
  const sceneApi = scene || {};
  const audioApi = audio || null;
  const ttsApi = tts || null;

  let totalLikes = 0;
  let voteOpen = false;
  let lastCommentTtsAt = 0;
  let lastFollowTtsAt = 0;
  let lastTierTtsAt = 0;
  let bannerTimer = 0;

  function safe(fn) {
    try {
      const out = fn();
      if (out && typeof out.catch === 'function') out.catch(() => {});
      return out;
    } catch {
      return undefined;
    }
  }

  function callScene(name, ...args) {
    const fn = sceneApi && sceneApi[name];
    if (typeof fn !== 'function') return;
    safe(() => fn.apply(sceneApi, args));
  }

  function speakTemplate(key, vars) {
    if (!ttsApi || typeof ttsApi.speakTemplate !== 'function') return;
    safe(() => ttsApi.speakTemplate(key, vars || {}));
  }

  function speakCommentText(text) {
    if (!ttsApi || typeof ttsApi.speakComment !== 'function') return;
    safe(() => ttsApi.speakComment(text));
  }

  function docEl(id) {
    try {
      if (typeof document === 'undefined') return null;
      return document.getElementById(id);
    } catch {
      return null;
    }
  }

  function setText(el, text) {
    if (!el) return;
    try {
      el.textContent = text;
    } catch {
      /* bỏ qua */
    }
  }

  function refreshHud() {
    try {
      const board = docEl('leaderboard');
      if (board) {
        board.textContent = '';
        const top = game.leaderboard();
        if (!top.length) {
          setText(board, 'Chưa có người chơi.');
        } else {
          top.forEach((p, i) => {
            const row = document.createElement('div');
            row.textContent = `${i + 1}. ${p.name} — ${p.coins} xu · Bậc ${p.tier}`;
            board.appendChild(row);
          });
        }
      }
      const strip = docEl('session-strip');
      if (strip) {
        setText(strip, `${game.playerCount()} người · ${game.sessionCoins()} xu phiên`);
      }
    } catch {
      /* HUD lỗi không chặn logic game */
    }
  }

  function showBanner(text) {
    const el = docEl('ritual-banner');
    if (!el || !text) return;
    setText(el, text);
    try {
      el.hidden = false;
    } catch {
      /* bỏ qua */
    }
    try {
      if (bannerTimer) clearTimeout(bannerTimer);
    } catch {
      /* bỏ qua */
    }
    bannerTimer = setTimeout(() => {
      try {
        el.hidden = true;
      } catch {
        /* bỏ qua */
      }
    }, 30000);
  }

  function onRitual(key, info = {}) {
    if (!key) return;
    if (info && info.late === true) {
      callScene('setRitualState', key);
      return;
    }
    const nowMs = Date.now();
    if (key === 'open') {
      callScene('playOpenRitual', 60);
      speakTemplate('greeting', {});
      showBanner(ritualLine('open', 'Chào bạn, phố đêm mở cửa.'));
      refreshHud();
      return;
    }
    if (key === 'vote1' || key === 'vote2') {
      game.openVote(nowMs);
      voteOpen = true;
      const question = `Bình chọn: 1 = ${dishLabel(0)} · 2 = ${dishLabel(1)}`;
      showBanner(question);
      callScene('showVoteResult', question);
      return;
    }
    if (key === 'rush') {
      game.setRushUntil(nowMs + RUSH_SECONDS * 1000);
      callScene('pulseGlow');
      showBanner(ritualLine('rush', 'Cao điểm: mỗi mốc like cộng gấp đôi.'));
      return;
    }
    if (key === 'market') {
      callScene('setNightMarket', true);
      if (audioApi && typeof audioApi.playTrackIndex === 'function') {
        safe(() => audioApi.playTrackIndex(1));
      }
      showBanner(ritualLine('market', 'Chợ đêm lên đèn.'));
      return;
    }
    if (key === 'closing') {
      const result = game.closeVote();
      voteOpen = false;
      if (result && result.winner) {
        callScene('showVoteResult', `Món thắng: ${result.dish}`);
        speakTemplate('voteWin', { dish: result.dish });
      }
      callScene('playClosingRitual');
      speakTemplate('closing', { count: game.playerCount() });
      const top = game.leaderboard();
      const topText = top.length
        ? top.map((p, i) => `${i + 1}. ${p.name} ${p.coins} xu`).join(' · ')
        : 'Chưa có người chơi.';
      showBanner(`Kết phiên: ${topText}`);
      refreshHud();
      return;
    }
    if (key === 'end') {
      callScene('setNightMarket', false);
      showBanner(ritualLine('end', 'Hết giờ — hẹn tối mai.'));
      return;
    }
  }

  function handleEvent(evt) {
    if (!evt || typeof evt.type !== 'string') return;
    const user = evt.user || {};
    const uniqueId = String(user.uniqueId || user.name || '');
    const name = String(user.name || user.uniqueId || 'Khách');
    const nowMs = Date.now();

    if (evt.type === 'join') {
      if (!uniqueId) return;
      game.join(uniqueId, name);
      callScene('addPlayer', uniqueId, name);
      callScene('showWelcomeName', name);
      callScene('coinBurstFor', uniqueId, JOIN_BONUS);
      refreshHud();
      return;
    }

    if (evt.type === 'chat') {
      const rawText = String(evt.text || '');
      const trimmed = rawText.trim();
      if (!trimmed) return;
      const voteChoice = isVoteText(trimmed);
      if (voteChoice && voteOpen) {
        if (game.vote(voteChoice, uniqueId, nowMs)) return;
        voteOpen = false;
      }
      if (!filterComment(trimmed).ok) return;
      if (isUpgradeCommand(trimmed)) {
        const res = game.upgrade(uniqueId, nowMs);
        if (res && res.ok) {
          const player = game.getPlayer(uniqueId);
          const label = (player && player.tierLabel) || `Bậc ${res.tier}`;
          callScene('setPlayerTier', uniqueId, res.tier);
          callScene('showNewTier', name, label);
          callScene('coinBurstFor', uniqueId, 3);
          if (nowMs - lastTierTtsAt >= TIER_TTS_INTERVAL_MS) {
            lastTierTtsAt = nowMs;
            speakTemplate('tierUp', { name, tier: res.tier, tierLabel: label });
          }
          refreshHud();
        }
        return;
      }
      if (isSellCommand(trimmed)) {
        const dish = sellDish(trimmed);
        if (!dish) return;
        const gained = game.sell(uniqueId, name, dish, nowMs);
        if (gained > 0) {
          callScene('coinBurstFor', uniqueId, gained);
          refreshHud();
        }
        return;
      }
      const gained = game.chat(uniqueId, name, trimmed, nowMs);
      if (gained > 0) {
        callScene('coinBurstFor', uniqueId, gained);
        refreshHud();
      }
      if (
        gained >= 0
        && nowMs - lastCommentTtsAt >= COMMENT_INTERVAL_MS
        && !commentBlockedForTts(trimmed)
      ) {
        lastCommentTtsAt = nowMs;
        speakCommentText(trimmed);
      }
      return;
    }

    if (evt.type === 'like') {
      totalLikes += num(evt.count, 1);
      const res = game.likeTick(totalLikes, nowMs);
      if (res && res.milestones > 0) {
        callScene('pulseGlow');
        refreshHud();
      }
      return;
    }

    if (evt.type === 'gift') {
      const count = num(evt.count, 1);
      const diamonds = num(evt.diamonds, 0);
      const isBig = diamonds * count >= BIG_THRESHOLD;
      callScene('celebrateGift', isBig);
      return;
    }

    if (evt.type === 'follow') {
      if (!uniqueId || uniqueId === 'guest') return;
      if (nowMs - lastFollowTtsAt >= FOLLOW_INTERVAL_MS) {
        lastFollowTtsAt = nowMs;
        speakTemplate('follow', { name });
      }
      return;
    }

    if (evt.type === 'ritual') {
      if (evt.ritual) onRitual(evt.ritual, { late: false });
      return;
    }
  }

  let unsubscribe = null;
  if (events && typeof events.on === 'function') {
    try {
      unsubscribe = events.on('*', handleEvent) || null;
    } catch {
      unsubscribe = null;
    }
  }

  refreshHud();

  return {
    onRitual,
    game,
    stop() {
      try {
        if (bannerTimer) clearTimeout(bannerTimer);
      } catch {
        /* bỏ qua */
      }
      if (typeof unsubscribe === 'function') {
        try {
          unsubscribe();
        } catch {
          /* bỏ qua */
        }
      }
    },
  };
}
