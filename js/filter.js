// filter.js — lọc bình luận trước khi cộng xu, đọc giọng máy,
// hiện lên HUD. Bình luận dính lọc thì bỏ im lặng, không hiệu ứng.
//
// Kiểm tra KÉP giữ dấu + bỏ dấu (bài học từ chill-room):
// tiếng Việt bỏ dấu gây đồng âm giả: ngủ→ngu, các→cặc, cho→chó,
// bạn→bẩn, buổi→buồi, đi→đĩ, phố→phò. Vì vậy:
//  (1) token GIỮ DẤU so với danh sách đầy đủ;
//  (2) token BỎ DẤU chỉ so với danh sách RÚT GỌN gồm dạng không
//      mơ hồ (dit, vcl, dm, fuck...). Dạng mơ hồ (cac, cho, ngu,
//      buoi...) KHÔNG có trong danh sách rút gọn.
// Kiểm tra theo token và cụm 2 token, không chặn chuỗi con lành.
// Từ đơn "ngu" KHÔNG nằm trong bất kỳ danh sách chặn nào: chỉ chặn
// qua cụm ("đồ ngu", "thằng ngu", "con ngu", "mày ngu" có dấu;
// "thang ngu" không dấu). Nhờ đó "chuc ngu ngon" không dấu vẫn qua.
// Đánh đổi có chủ ý: chửi thề không dấu ở dạng mơ hồ có thể lọt;
// ưu tiên không chặn nhầm câu lành.
// Bộ lọc này chỉ chặn thô tục / link / số điện thoại / quảng cáo.
// Nó không chặn các từ thuộc luật chuỗi hiển thị của trang.

const MAX_CHARS = 200;

function stripDiacritics(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

function tokenizeAccented(text) {
  return String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

function tokenizeStripped(text) {
  return stripDiacritics(text).split(/[^a-z0-9]+/).filter(Boolean);
}

// Từ đơn cấm, dạng có dấu (so khớp token giữ dấu). "ngu" vắng mặt
// ở đây theo đúng quy tắc ở đầu file — chỉ chặn qua cụm.
const BANNED_WORDS_ACCENTED = [
  'địt', 'đéo', 'lồn', 'cặc', 'buồi', 'dái', 'đĩ', 'điếm', 'cứt', 'ỉa',
  'dâm', 'sếch', 'phò', 'cave',
  'chó', 'đần', 'dốt', 'hãm', 'cút', 'khốn', 'tởm', 'bẩn',
  'điên', 'khùng', 'thần kinh',
  'fuck', 'shit', 'bitch', 'dick', 'pussy', 'asshole', 'damn', 'sex',
];

const BANNED_SHORTS = [
  'dm', 'dkm', 'cmm', 'dmm', 'dcm', 'clm', 'vcl', 'vl', 'cc', 'cl', 'vc', 'vcc',
];

// Từ đơn cấm, dạng bỏ dấu RÚT GỌN (chỉ dạng không mơ hồ).
// Cố tình vắng: cac, cho, di, ngu, dan, ban, tom, ham, diem, dam,
// khon, dien, khung, dai, deo, buoi, lon, pho — mỗi dạng đều là từ
// lành khi bỏ dấu. Chửi thề không dấu ở các dạng này chịu lọt.
const BANNED_WORDS_STRIPPED = [
  'dit', 'fuck', 'shit', 'bitch', 'dick', 'pussy', 'asshole', 'damn',
  'sex', 'cave', 'cut', ...BANNED_SHORTS,
];

// Cụm 2 từ xúc phạm, dạng có dấu (so khớp cụm giữ dấu).
const BANNED_PHRASES_ACCENTED = [
  'địt mẹ', 'địt con', 'địt cụ', 'óc chó', 'mất dạy', 'khốn nạn',
  'con chó', 'con đĩ', 'đồ ngu', 'thằng ngu', 'con ngu', 'chó chết',
  'đồ chó', 'mẹ mày', 'mẹ kiếp', 'bố mày', 'im mồm', 'ngậm mồm',
  'cút đi', 'đồ điên', 'đồ khùng', 'thằng điên', 'con điên',
  'đồ hãm', 'đồ tởm', 'mày ngu', 'óc lợn', 'óc bò', 'não chó',
  'chết tiệt', 'vô học', 'mất nết',
];

// Cụm 2 từ, dạng bỏ dấu RÚT GỌN. Cố tình vắng các cụm chứa từ mơ hồ
// ("do ngu", "con ngu", "oc cho"...) vì "đồ ngủ", "con đi ngủ",
// "ốc lớn" bỏ dấu thành đúng các cụm đó; dạng có dấu vẫn bị bắt.
const BANNED_PHRASES_STRIPPED = [
  'dit me', 'dit con', 'dit cu', 'mat day', 'khon nan',
  'thang ngu', 'con dien', 'me may', 'me kiep', 'bo may',
  'im mom', 'ngam mom', 'cut di', 'do tom', 'oc bo',
  'chet tiet', 'vo hoc', 'mat net',
];

// Dạng dính liền của các cụm. Chỉ kiểm tra TRONG từng token đơn,
// không gộp cả câu (gộp qua ranh giới từ sẽ chặn nhầm câu lành).
const BANNED_COMPACT = [
  'ditme', 'ditcon', 'ditcu', 'occho', 'matday', 'khonnan', 'concho',
  'condi', 'dongu', 'thangngu', 'conngu', 'chochet', 'docho', 'memay',
  'mekiep', 'bomay', 'immom', 'ngammom', 'cutdi', 'dodien', 'dokhung',
  'oclon', 'ocbo', 'naocho', 'chettiet', 'domatday', 'vohoc', 'matnet',
];

const ACCENTED_SINGLE_SET = new Set(
  [...BANNED_WORDS_ACCENTED, ...BANNED_SHORTS].map((w) => w.toLowerCase()),
);
const STRIPPED_SINGLE_SET = new Set(BANNED_WORDS_STRIPPED);
const ACCENTED_PHRASE_SET = new Set(BANNED_PHRASES_ACCENTED.map((w) => w.toLowerCase()));
const STRIPPED_PHRASE_SET = new Set(BANNED_PHRASES_STRIPPED);
const BANNED_COMPACT_SET = new Set(BANNED_COMPACT);

function hasBannedContent(accentedTokens, strippedTokens) {
  for (const token of accentedTokens) {
    if (ACCENTED_SINGLE_SET.has(token)) return true;
  }
  for (let i = 0; i + 1 < accentedTokens.length; i += 1) {
    if (ACCENTED_PHRASE_SET.has(`${accentedTokens[i]} ${accentedTokens[i + 1]}`)) return true;
  }
  for (const token of strippedTokens) {
    if (STRIPPED_SINGLE_SET.has(token)) return true;
  }
  for (let i = 0; i + 1 < strippedTokens.length; i += 1) {
    if (STRIPPED_PHRASE_SET.has(`${strippedTokens[i]} ${strippedTokens[i + 1]}`)) return true;
  }
  for (const token of strippedTokens) {
    for (const bad of BANNED_COMPACT_SET) {
      if (token.includes(bad)) return true;
    }
  }
  return false;
}

const LINK_RE = /(https?:\/\/|www\.|t\.me|telegram\.me|bit\.ly|tinyurl\.com|zalo\.me)/i;
const TLD_RE = /\.(com|vn|net|org|info|xyz|me|io|cc|top|shop|live|app|online)\b/i;
const EMAIL_RE = /\S+@\S+\.\S+/;
// Số điện thoại: dãy 8 chữ số trở lên, cho phép khoảng trắng / chấm /
// gạch nối chen giữa. Dấu ":" không tính là chen giữa, nên giờ
// dạng "21:30" không bị nhận nhầm thành số điện thoại.
const PHONE_RUN_RE = /(?:\d[\s.\-]{0,2}){8,}/;
const AD_PHRASE_RE = /\b(mua ngay|giam gia|khuyen mai|uu dai|quang cao)\b/;

const CONTACT_TOKENS = new Set([
  'zalo', 'telegram', 'tele', 'inbox', 'ib', 'shopee', 'lazada',
]);

function hasContactOrAd(strippedTokens, strippedText) {
  for (const token of strippedTokens) {
    if (CONTACT_TOKENS.has(token)) return true;
  }
  for (let i = 0; i + 1 < strippedTokens.length; i += 1) {
    if (`${strippedTokens[i]} ${strippedTokens[i + 1]}` === 'so dien thoai') return true;
  }
  if (strippedTokens.includes('sdt')) return true;
  return AD_PHRASE_RE.test(strippedText);
}

export const BANNED_PATTERNS = [LINK_RE, TLD_RE, EMAIL_RE, PHONE_RUN_RE, AD_PHRASE_RE];

export function filterComment(text) {
  const raw = text == null ? '' : String(text);
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };
  if ([...trimmed].length > MAX_CHARS) return { ok: false, reason: 'too_long' };
  if (LINK_RE.test(trimmed) || TLD_RE.test(trimmed) || EMAIL_RE.test(trimmed)) {
    return { ok: false, reason: 'link' };
  }
  if (PHONE_RUN_RE.test(trimmed)) return { ok: false, reason: 'phone' };
  const accentedTokens = tokenizeAccented(trimmed);
  const strippedTokens = tokenizeStripped(trimmed);
  const strippedText = stripDiacritics(trimmed);
  if (hasContactOrAd(strippedTokens, strippedText)) {
    return { ok: false, reason: 'advertising' };
  }
  if (hasBannedContent(accentedTokens, strippedTokens)) {
    return { ok: false, reason: 'profanity' };
  }
  return { ok: true, reason: '' };
}

// Hồi quy bắt buộc cho harness: câu lành phải qua, câu bẩn / link /
// số điện thoại phải chặn. "ngu" đứng một mình vẫn qua (xem đầu file).
export const REGRESSION_CASES = [
  { text: 'chúc ngủ ngon', ok: true },
  { text: 'chuc ngu ngon', ok: true },
  { text: 'chúc ngủ ngon nhé cả nhà', ok: true },
  { text: 'chuc ngu ngon nhe', ok: true },
  { text: 'ngủ ngon', ok: true },
  { text: 'các bạn ơi, buổi tối vui vẻ', ok: true },
  { text: 'cho mình hỏi món nào ngon', ok: true },
  { text: 'hay quá', ok: true },
  { text: 'bán: bánh mì', ok: true },
  { text: 'nâng cấp', ok: true },
  { text: '1', ok: true },
  { text: '2', ok: true },
  { text: '21:30 mở cửa nhé', ok: true },
  { text: 'ngu', ok: true },
  { text: 'địt mẹ', ok: false },
  { text: 'dit me', ok: false },
  { text: 'thằng ngu', ok: false },
  { text: 'thang ngu', ok: false },
  { text: 'đồ ngu', ok: false },
  { text: 'vcl', ok: false },
  { text: 'xem ở https://example.com nhé', ok: false },
  { text: 'vào www.pho.vn xem đi', ok: false },
  { text: 'vào t.me/pho nhé', ok: false },
  { text: '0901234567', ok: false },
  { text: '090 123 4567', ok: false },
  { text: 'gọi 0912345678 nhé', ok: false },
  { text: 'inbox zalo nhé', ok: false },
  { text: 'mua ngay, giảm giá 50%', ok: false },
  { text: '', ok: false },
  { text: '   ', ok: false },
  { text: 'a'.repeat(201), ok: false },
  { text: 'a'.repeat(200), ok: true },
];
