// tts.js — giọng đọc máy tiếng Việt cho Vỉa hè lên đời.
// Dùng speechSynthesis của trình duyệt. NGUYÊN TẮC AN TOÀN:
// - Chỉ đọc khi có giọng lang bắt đầu bằng 'vi'. Không có giọng Việt
//   thì IM LẶNG: không gọi speechSynthesis.speak, chỉ cập nhật caption
//   ở #tts-caption. KHÔNG đọc tiếng Việt bằng giọng ngoại.
// - speechSynthesis có thể không tồn tại (Node/test, trình duyệt lạ)
//   → mọi hàm trả false, không crash.
// - Không đọc khi chưa unlock (autoplay policy): unlock() phải được gọi
//   từ thao tác của user trước. Caption vẫn cập nhật kể cả khi chưa đọc.
// - Caption ở #tts-caption (nếu có) LUÔN cập nhật với text sẽ đọc,
//   kể cả khi ở chế độ im lặng.
// - Không đọc chồng: hàng đợi tối đa 3, thừa thì bỏ.
// - Mọi lần đọc đều gọi duck callback trước (fn(true)) và trả lại sau
//   khi hết hàng đợi (fn(false)), để audio hạ nhạc khi có giọng đọc.
// - Chỉ đọc template CỐ ĐỊNH trong CONFIG.tts.templates + nguyên văn
//   đã lọc do handlers truyền vào qua speakComment. Không soạn lời mới.

import { CONFIG } from '../config.js';

const MAX_QUEUE = 3;
const CAPTION_ELEMENT_ID = 'tts-caption';

// Tốc độ đọc từ CONFIG.tts.rate (0.9).
function ttsRate() {
  const n = Number(CONFIG && CONFIG.tts && CONFIG.tts.rate);
  if (!Number.isFinite(n)) return 0.9;
  return Math.min(2, Math.max(0.1, n));
}

function ttsEnabled() {
  if (!CONFIG || !CONFIG.tts) return true;
  return CONFIG.tts.enabled !== false;
}

function preferredVoiceLang() {
  const lang = CONFIG && CONFIG.tts && CONFIG.tts.voiceLang;
  return typeof lang === 'string' && lang ? lang : 'vi-VN';
}

function commentMinIntervalMs() {
  const n = Number(CONFIG && CONFIG.tts && CONFIG.tts.commentMinIntervalSeconds);
  if (!Number.isFinite(n) || n <= 0) return 120000;
  return n * 1000;
}

function speechSynth() {
  try {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.speechSynthesis || null;
  } catch {
    return null;
  }
}

function pickVietnameseVoice() {
  const synth = speechSynth();
  if (!synth) return null;
  let voices = [];
  try {
    voices = synth.getVoices() || [];
  } catch {
    return null;
  }
  const preferred = preferredVoiceLang();
  const exact = voices.find((v) => v && v.lang === preferred);
  if (exact) return exact;
  return voices.find((v) => v && typeof v.lang === 'string'
    && v.lang.toLowerCase().startsWith('vi')) || null;
}

function utteranceCtor() {
  try {
    if (typeof globalThis === 'undefined') return null;
    return globalThis.SpeechSynthesisUtterance || null;
  } catch {
    return null;
  }
}

function setCaption(text) {
  try {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(CAPTION_ELEMENT_ID);
    if (el) el.textContent = text;
  } catch {
    // Chạy ngoài DOM (test Node): bỏ qua render.
  }
}

function fillTemplate(template, vars) {
  const v = vars && typeof vars === 'object' ? vars : {};
  return String(template).replace(/\{(name|tier|dish|count)\}/g, (_m, key) => {
    const val = v[key];
    return val === undefined || val === null ? '' : String(val);
  });
}

export class GameTTS {
  constructor(opts = {}) {
    this._unlocked = false;
    this._onDuck = opts && typeof opts.onDuck === 'function' ? opts.onDuck : null;
    this._queue = []; // { text, resolve }
    this._speaking = false;
    this._lastCommentAt = 0;
    // Đánh thức danh sách giọng ở một số trình duyệt (Chrome nạp giọng
    // bất đồng bộ, getVoices() ban đầu có thể rỗng). Chỉ đăng ký nghe,
    // không tự đọc gì.
    try {
      const synth = speechSynth();
      if (synth && typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', () => {
          try { synth.getVoices(); } catch { /* bỏ qua */ }
        });
      } else if (synth && 'onvoiceschanged' in synth) {
        synth.onvoiceschanged = () => {
          try { synth.getVoices(); } catch { /* bỏ qua */ }
        };
      }
    } catch {
      // Bỏ qua — lần đọc kiểm tra lại giọng.
    }
  }

  // Gọi từ thao tác của user (click / chạm) để trình duyệt cho phép đọc.
  unlock() {
    this._unlocked = true;
    try {
      const synth = speechSynth();
      if (synth) synth.getVoices();
    } catch {
      // Bỏ qua.
    }
    return true;
  }

  setDuckCallback(fn) {
    this._onDuck = typeof fn === 'function' ? fn : null;
  }

  // Đọc 1 template CỐ ĐỊNH trong CONFIG.tts.templates, thay các
  // placeholder {name} / {tier} / {dish} / {count} bằng vars.
  // Key lạ hoặc template rỗng → Promise<false>, không đọc, không caption.
  // Trả Promise<boolean>: true nếu đã đọc xong, false nếu bỏ qua
  // (chưa unlock, tắt TTS, không có giọng Việt, hàng đợi đầy).
  speakTemplate(key, vars = {}) {
    const templates = CONFIG && CONFIG.tts && CONFIG.tts.templates;
    const tpl = templates && typeof templates === 'object' ? templates[key] : undefined;
    if (typeof tpl !== 'string' || !tpl.trim()) return Promise.resolve(false);
    return this._enqueue(fillTemplate(tpl, vars));
  }

  // Đọc nguyên văn bình luận đã lọc do handlers truyền vào.
  // Giới hạn nội bộ: tối đa 1 lần đọc trong commentMinIntervalSeconds
  // (mặc định 120 giây). Lần vượt giới hạn vẫn cập nhật caption nhưng
  // không đọc thành tiếng. Chỉ đọc khi đã unlock.
  speakComment(text) {
    const clean = String(text == null ? '' : text).trim();
    if (!clean) return Promise.resolve(false);
    setCaption(clean);
    if (!ttsEnabled()) return Promise.resolve(false);
    if (!this._unlocked) return Promise.resolve(false);
    const now = Date.now();
    if (now - this._lastCommentAt < commentMinIntervalMs()) {
      return Promise.resolve(false);
    }
    this._lastCommentAt = now;
    return this._enqueue(clean);
  }

  _duck(on) {
    try {
      if (this._onDuck) this._onDuck(on === true);
    } catch {
      // Duck lỗi thì giọng vẫn đọc — không chặn TTS vì duck.
    }
  }

  _canSpeak() {
    if (!ttsEnabled()) return false;
    if (!speechSynth()) return false;
    if (!pickVietnameseVoice()) return false;
    if (!utteranceCtor()) return false;
    return true;
  }

  _enqueue(text) {
    const clean = String(text == null ? '' : text).trim();
    if (!clean) return Promise.resolve(false);
    setCaption(clean);
    if (!ttsEnabled()) return Promise.resolve(false);
    if (!this._unlocked) return Promise.resolve(false);
    if (this._queue.length >= MAX_QUEUE) return Promise.resolve(false);
    return new Promise((resolve) => {
      this._queue.push({ text: clean, resolve });
      this._pump();
    });
  }

  _pump() {
    if (this._speaking) return;
    const item = this._queue.shift();
    if (!item) {
      this._duck(false);
      return;
    }
    // Chưa có giọng Việt / không có synth: chế độ im lặng — chỉ caption
    // (đã cập nhật ở _enqueue), không gọi speak, không duck.
    if (!this._canSpeak()) {
      try { item.resolve(false); } catch { /* bỏ qua */ }
      this._pump();
      return;
    }
    this._speaking = true;
    this._duck(true);
    const started = this._startUtterance(item.text, (ok) => {
      this._speaking = false;
      try { item.resolve(ok === true); } catch { /* bỏ qua */ }
      this._pump();
    });
    if (!started) {
      // _startUtterance trả false chỉ khi kiểm tra đầu vào thất bại và
      // chưa gọi done — giọng có thể vừa biến mất giữa chừng.
      this._speaking = false;
      try { item.resolve(false); } catch { /* bỏ qua */ }
      this._pump();
    }
  }

  // Phát 1 utterance, gọi done(true/false) đúng 1 lần. Trả false nếu
  // không phát được ở bước kiểm tra đầu vào (done chưa gọi); trả true
  // khi đã gọi speak (done sẽ tới qua onend/onerror/hẹn giờ an toàn).
  _startUtterance(text, done) {
    const synth = speechSynth();
    if (!synth) return false;
    const voice = pickVietnameseVoice();
    if (!voice) return false;
    const UtteranceCtor = utteranceCtor();
    if (!UtteranceCtor) return false;
    let utterance;
    try {
      utterance = new UtteranceCtor(text);
    } catch {
      return false;
    }
    let settled = false;
    // Hẹn giờ an toàn: nếu onend/onerror không bao giờ tới (lỗi
    // trình duyệt), hàng đợi không kẹt quá 60 giây.
    const safetyMs = Math.min(60000, Math.max(10000, text.length * 150));
    const safetyTimer = setTimeout(() => finish(false), safetyMs);
    function finish(ok) {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      done(ok);
    }
    try {
      utterance.voice = voice;
      utterance.lang = voice.lang || preferredVoiceLang();
      utterance.rate = ttsRate();
      utterance.pitch = 1;
      utterance.volume = 0.9;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      synth.speak(utterance);
    } catch {
      finish(false);
    }
    return true;
  }
}
