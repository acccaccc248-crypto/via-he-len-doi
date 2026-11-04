// relay.js — EulerStream Cloud WebSocket (relay MIỄN PHÍ vĩnh viễn, Community),
// bản cho Vỉa hè lên đời. Chép theo mẫu relay đã có, đổi tên
// theo game mới; logic nối/map message giữ nguyên.
//
// Kiến trúc: trang tĩnh KHÔNG cần server riêng. Trình duyệt mở thẳng
// WebSocket tới ws.eulerstream.com; server EulerStream giữ kết nối TikTok
// phía server, giải mã protobuf và gửi về client DẠNG JSON (bundle mặc
// định). Client chỉ cần JSON.parse + map field — KHÔNG cần SDK, KHÔNG
// protobuf trong trang. URL build tay đã đối chiếu với
// `createWebSocketUrl()` của @eulerstream/euler-websocket-sdk@1.1.0
// (02/11/2026): cùng host, cùng tên param, cùng default
// (features.bundleEvents=true, schemaVersion=v2, rawMessages=false).
//
// Auth: bắt buộc `apiKey` (dashboard key, gói Community) HOẶC `jwtKey`.
// Không key -> server đóng 4400; key sai -> đóng 4401 (đã kiểm chứng
// thật 02/11/2026 bằng WebSocket nối tới ws.eulerstream.com).
//
// Cấu hình (không commit key vào repo):
//   ?user=<tiktok-uniqueId>&apiKey=<eulerstream-api-key>
//   hoặc ?jwt=<jwtKey>. Key đọc xong sẽ bị XÓA khỏi thanh địa chỉ bằng
//   history.replaceState (tránh lộ key khi chia sẻ màn hình live).
//   Key dán qua URL được GHI NHỚ trong localStorage của trình duyệt (theo
//   origin) để lần sau mở đúng link là nối luôn, khỏi dán lại; `?forget-key=1`
//   để xóa key đã nhớ. Key không bao giờ nằm trong repo hay memory.
//   Không có key -> Relay ở trạng thái "needs-key", không nối, cảnh vẫn chạy.
//
// Giới hạn Community (đọc từ eulerstream.com/pricing 02/11/2026, free
// vĩnh viễn, KHÔNG cần thẻ): 2.500 request/ngày, 25 cloud WebSocket.
// Reconnect có backoff + giới hạn lần thử để không đốt quota.
//
// CHƯA kiểm chứng bằng event thật (cần key thật + kênh đang live):
//   1. Envelope JSON (bundle {messages:[...]} / single {type,data}) — suy từ
//      type ClientMessageBundle/DecodedData của SDK; code xử lý cả 2 dạng
//      và log mọi message lạ ở console.debug.
//   2. Follow heuristic: WebcastSocialMessage không có field follow riêng;
//      coi là follow khi followCount > 0 hoặc action/shareType chứa "follow".
//   3. Avatar: User.profilePicture.url[0] (Image.url là mảng).
//   4. Gift combo: repeatCount là streak tích lũy theo groupId; code chỉ
//      phát DELTA so với max đã thấy để không cộng trùng kim cương.
//
// Event nội bộ phát ra: giữ nguyên định dạng của js/events.js:
//   { type, user: { name, uniqueId, avatar }, text, giftName, diamonds, count }

import { CONFIG } from '../config.js';
import { StreetEvents } from './events.js';

const EULER_WS_BASE_URL = 'wss://ws.eulerstream.com';
const DEFAULT_USERNAME = 'meta.muse.ai1';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_CAP_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 12;

// Mã đóng KHÔNG thử lại (auth/cấu hình sai — thử lại cũng vô ích).
const TERMINAL_CLOSE_CODES = new Set([4400, 4401, 4403]);

const STATUS_TEXT = {
  'needs-key': 'Relay: chưa có key — thêm ?apiKey=... vào URL',
  'connecting': 'Relay: đang kết nối…',
  'connected': 'Relay: đã nối, chờ sự kiện…',
  'live': 'Relay: LIVE — đang nhận sự kiện',
  'reconnecting': 'Relay: mất nối, đang nối lại…',
  'offline': 'Relay: kênh đang offline, sẽ thử lại…',
  'ended': 'Relay: live đã kết thúc',
  'auth-error': 'Relay: key sai / không có quyền (4401) — kiểm tra key',
  'config-error': 'Relay: thiếu apiKey/jwtKey (4400)',
  'stopped': 'Relay: đã dừng thử lại — tải lại trang để nối lại',
  'disconnected': 'Relay: đã ngắt',
};

function normalizeUniqueId(raw) {
  let id = String(raw || '').trim();
  id = id.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '');
  id = id.replace(/^@/, '').replace(/\/live\/?$/i, '').replace(/\/$/, '');
  return id.trim();
}

// Đọc param từ URL hiện tại (an toàn khi chạy ngoài trình duyệt: trả {}).
function readQueryParams() {
  try {
    if (typeof window === 'undefined' || !window.location) return {};
    return Object.fromEntries(new URLSearchParams(window.location.search));
  } catch {
    return {};
  }
}

// Xóa credential khỏi thanh địa chỉ sau khi đọc (chống lộ key khi share
// màn hình). Giữ lại các param vô hại (user, fps, demo...).
function stripCredentialParams() {
  try {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('apiKey') && !params.has('key') && !params.has('jwt')) return;
    params.delete('apiKey');
    params.delete('key');
    params.delete('jwt');
    const qs = params.toString();
    const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', next);
  } catch {
    // Không chặn kết nối chỉ vì không xóa được URL.
  }
}

// Ghi nhớ key trong trình duyệt CỦA USER (localStorage, theo từng origin)
// để lần sau mở đúng link này là nối luôn, khỏi dán lại. Key chỉ nằm ở bộ
// nhớ trình duyệt trên máy user — KHÔNG nằm trong repo, file hay memory
// của agent. `?forget-key=1` để xóa key đã nhớ.
const STORED_KEY_NAME = 'vihe.eulerApiKey';

function rememberKey(apiKey) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(STORED_KEY_NAME, apiKey);
  } catch {
    // Chế độ riêng tư / storage bị chặn: bỏ qua, lần sau dán lại.
  }
}

function readStoredKey() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(STORED_KEY_NAME) || '';
  } catch {
    // Bỏ qua, coi như chưa có key.
  }
  return '';
}

function forgetStoredKey() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(STORED_KEY_NAME);
  } catch {
    // Bỏ qua.
  }
}

function pickAvatar(user) {
  if (!user || typeof user !== 'object') return '';
  const candidates = [
    user.profilePicture,
    user.profilePictureLarge,
    user.profilePictureMedium,
    user.avatarThumb,
  ];
  for (const pic of candidates) {
    if (!pic) continue;
    if (typeof pic === 'string' && pic) return pic;
    if (Array.isArray(pic.url) && pic.url[0]) return pic.url[0];
    if (typeof pic.url === 'string' && pic.url) return pic.url;
  }
  return '';
}

function toInternalUser(user) {
  const u = user && typeof user === 'object' ? user : {};
  return {
    name: u.nickname || u.uniqueId || 'Khách',
    uniqueId: u.uniqueId || u.secUid || u.idStr || '',
    avatar: pickAvatar(u),
  };
}

// Theo dõi streak gift theo groupId để chỉ phát delta (chống cộng trùng).
const giftStreakMax = new Map(); // groupId -> max repeatCount đã thấy

function mapGift(data) {
  const gift = data.giftDetails && typeof data.giftDetails === 'object' ? data.giftDetails : {};
  const repeat = Number(data.repeatCount) || 1;
  const groupId = data.groupId ? String(data.groupId) : '';
  let count = repeat;
  if (groupId) {
    const prev = giftStreakMax.get(groupId) || 0;
    if (repeat <= prev) {
      // Streak lặp lại / reset không hợp lệ: bỏ qua để khỏi cộng trùng.
      if (repeat < prev) giftStreakMax.set(groupId, repeat);
      return null;
    }
    count = repeat - prev;
    giftStreakMax.set(groupId, repeat);
  }
  return {
    type: 'gift',
    user: toInternalUser(data.user),
    text: '',
    giftName: gift.giftName || (data.giftId ? `Gift #${data.giftId}` : ''),
    diamonds: Number(gift.diamondCount) || 0,
    count: Math.max(1, count),
  };
}

function mapMessage(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
  const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
  switch (msg.type) {
    case 'WebcastChatMessage': {
      const text = typeof data.comment === 'string' ? data.comment : '';
      if (!text) return null;
      return { type: 'chat', user: toInternalUser(data.user), text, giftName: '', diamonds: 0, count: 1 };
    }
    case 'WebcastGiftMessage': {
      return mapGift(data);
    }
    case 'WebcastLikeMessage': {
      const count = Number(data.likeCount) || 1;
      return { type: 'like', user: toInternalUser(data.user), text: '', giftName: '', diamonds: 0, count };
    }
    case 'WebcastSocialMessage': {
      // Heuristic follow (CHƯA kiểm chứng event thật): followCount > 0 hoặc
      // action/shareType nhắc "follow". Còn lại là share -> bỏ qua.
      const haystack = `${data.action || ''} ${data.shareType || ''}`;
      const isFollow = (Number(data.followCount) || 0) > 0 || /follow/i.test(haystack);
      if (!isFollow) return null;
      return { type: 'follow', user: toInternalUser(data.user), text: '', giftName: '', diamonds: 0, count: 1 };
    }
    case 'WebcastMemberMessage': {
      // Người xem VÀO phòng: phát event 'join'.
      // Người xem RỜI phòng: phát event 'leave' (phố đêm bỏ qua,
      // không xóa nhân vật theo rời). Phòng thủ: bỏ qua message không có user
      // thật (tránh chào "Khách" trùng nhau).
      const user = toInternalUser(data.user);
      if (!user.uniqueId) return null;
      const action = String(data.action || data.actionId || '');
      if (/leave|left|exit/i.test(action)) {
        return { type: 'leave', user, text: '', giftName: '', diamonds: 0, count: 1 };
      }
      return { type: 'join', user, text: '', giftName: '', diamonds: 0, count: 1 };
    }
    case 'WebcastRoomUserSeqMessage':
      // Đếm viewer: không cần cho phố đêm.
      return null;
    case 'WebcastControlMessage':
      // Control (vd stream end) — server sẽ đóng socket kèm mã; chỉ log.
      return { type: '__control', data };
    default:
      return { type: '__unknown', rawType: msg.type, data };
  }
}

function buildWebSocketUrl({ baseUrl, username, apiKey, jwtKey }) {
  const base = (baseUrl || EULER_WS_BASE_URL).replace(/\/$/, '');
  const params = new URLSearchParams();
  params.set('uniqueId', normalizeUniqueId(username));
  if (apiKey) params.set('apiKey', apiKey);
  if (jwtKey) params.set('jwtKey', jwtKey);
  params.set('features.bundleEvents', 'true');
  params.set('features.schemaVersion', 'v2');
  return `${base}?${params.toString()}`;
}

export const Relay = {
  status: 'disconnected',
  url: '',
  username: '',
  _ws: null,
  _reconnectTimer: null,
  _reconnectAttempts: 0,
  _intentionalClose: false,
  _lastArgs: null,

  // Hook test (dùng trong Node/kiểm chứng): map message thô -> event nội bộ.
  mapMessage,
  buildWebSocketUrl,

  connect(opts = {}) {
    const query = readQueryParams();
    const cfg = (CONFIG && CONFIG.relay && typeof CONFIG.relay === 'object') ? CONFIG.relay : {};
    const username = opts.username || query.user || query.username || cfg.username || DEFAULT_USERNAME;
    let apiKey = opts.apiKey || query.apiKey || query.key || cfg.apiKey || '';
    const jwtKey = opts.jwtKey || query.jwt || cfg.jwtKey || '';
    const baseUrl = opts.url || query.ws || cfg.url || EULER_WS_BASE_URL;

    this.username = normalizeUniqueId(username);
    stripCredentialParams();

    // Key dán qua URL thì ghi nhớ vào trình duyệt để lần sau khỏi dán lại;
    // không có key mới thì đọc key đã nhớ (theo origin). ?forget-key=1 xóa.
    if (query['forget-key'] === '1') forgetStoredKey();
    else if (apiKey) rememberKey(apiKey);
    if (!apiKey && !jwtKey) apiKey = readStoredKey();

    if (!apiKey && !jwtKey) {
      this._setStatus('needs-key');
      return this.status;
    }
    if (this._ws) this.disconnect();

    this._lastArgs = { baseUrl, username: this.username, apiKey, jwtKey };
    this._intentionalClose = false;
    this._reconnectAttempts = 0;
    this._openSocket();
    return this.status;
  },

  disconnect() {
    this._intentionalClose = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ws) {
      try { this._ws.close(1000, 'client disconnect'); } catch { /* đã đóng */ }
      this._ws = null;
    }
    this._setStatus('disconnected');
  },

  _openSocket() {
    const args = this._lastArgs;
    if (!args) return;
    this.url = buildWebSocketUrl(args);
    this._setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      console.error('[relay] WebSocket construct failed:', err);
      this._scheduleReconnect('construct');
      return;
    }
    this._ws = ws;
    try { ws.binaryType = 'arraybuffer'; } catch { /* mặc định */ }

    ws.addEventListener('open', () => {
      this._reconnectAttempts = 0;
      this._setStatus('connected');
    });

    ws.addEventListener('message', (event) => {
      this._handlePayload(event.data);
    });

    ws.addEventListener('error', (event) => {
      console.warn('[relay] WebSocket error:', event);
    });

    ws.addEventListener('close', (event) => {
      this._ws = null;
      if (this._intentionalClose) {
        this._setStatus('disconnected');
        return;
      }
      const code = event.code || 0;
      if (TERMINAL_CLOSE_CODES.has(code)) {
        this._setStatus(code === 4400 ? 'config-error' : 'auth-error');
        return;
      }
      if (code === 4005 || code === 4404) {
        // Stream kết thúc / kênh offline: giữ vòng reconnect (user có thể
        // lên live sau), nhưng báo rõ trạng thái.
        this._setStatus(code === 4404 ? 'offline' : 'ended');
      }
      this._scheduleReconnect(`close-${code}`);
    });
  },

  _handlePayload(raw) {
    let payload = raw;
    if (typeof raw === 'string') {
      try {
        payload = JSON.parse(raw);
      } catch {
        console.debug('[relay] non-JSON text frame ignored:', String(raw).slice(0, 120));
        return;
      }
    } else {
      // Binary frame: không bật rawMessages nên không nên có; log + bỏ qua.
      console.debug('[relay] binary frame ignored (rawMessages off).');
      return;
    }

    // Dạng bundle: { timestamp, messages: [ {type, data}, ... ] }
    const messages = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.messages)
        ? payload.messages
        : [payload];

    for (const msg of messages) {
      this._handleDecoded(msg);
    }
  },

  _handleDecoded(msg) {
    if (!msg || typeof msg !== 'object') return;
    // CustomData của server (roomInfo, room.status, workerInfo...): không
    // phải Webcast* message, xử lý trạng thái rồi thôi.
    if (msg.type === 'roomInfo') {
      this._setStatus('live');
      return;
    }
    if (msg.type === 'room.status') {
      const state = msg.data?.state || msg.data?.status || '';
      if (/offline|ended/i.test(String(state))) this._setStatus('offline');
      else if (/connected|live/i.test(String(state))) this._setStatus('live');
      return;
    }
    if (msg.type === 'tiktok.connect') { this._setStatus('live'); return; }
    if (msg.type === 'tiktok.disconnect') { this._setStatus('offline'); return; }
    if (msg.type === 'workerInfo' || msg.type === 'decodeError' || msg.type === 'transcription') {
      console.debug('[relay] server info:', msg.type, msg.data || '');
      return;
    }

    const evt = mapMessage(msg);
    if (!evt) return;
    if (evt.type === '__control') {
      console.debug('[relay] control message:', evt.data);
      return;
    }
    if (evt.type === '__unknown') {
      console.debug('[relay] unknown message type:', evt.rawType);
      return;
    }
    if (this.status !== 'live') this._setStatus('live');
    StreetEvents.emit(evt);
  },

  _scheduleReconnect(reason) {
    if (this._intentionalClose) return;
    if (this._reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this._setStatus('stopped');
      console.warn(`[relay] reconnect exhausted after ${MAX_RECONNECT_ATTEMPTS} attempts (${reason}).`);
      return;
    }
    const delay = Math.min(
      RECONNECT_CAP_MS,
      RECONNECT_BASE_MS * 2 ** this._reconnectAttempts,
    ) + Math.floor(Math.random() * 500);
    this._reconnectAttempts += 1;
    this._setStatus('reconnecting');
    console.warn(`[relay] reconnect #${this._reconnectAttempts} in ${delay}ms (${reason}).`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._intentionalClose) this._openSocket();
    }, delay);
  },

  _setStatus(status) {
    this.status = status;
    try {
      if (typeof document !== 'undefined') {
        const el = document.getElementById('relay-status');
        if (el) {
          el.dataset.status = status;
          el.textContent = STATUS_TEXT[status] || `Relay: ${status}`;
        }
      }
    } catch {
      // Chạy ngoài DOM (test Node): bỏ qua render.
    }
  },
};
