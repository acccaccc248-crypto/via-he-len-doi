// events.js — event bus nội bộ của Vỉa hè lên đời.
// Mọi nguồn sự kiện (relay thật, demo test-only) đều emit qua đây với
// đúng 1 định dạng event, để logic cảnh không phụ thuộc nguồn dữ liệu.
// Chép theo mẫu bus đã có, đổi tên export thành StreetEvents.
// Tên export và định dạng event là API — KHÔNG đổi tên.
//
// Định dạng event:
//   { type: 'chat' | 'like' | 'follow' | 'gift' | 'join' | 'leave' | 'ritual',
//     user: { name: string, uniqueId: string, avatar: string },
//     text: string,            // chat: nội dung; các loại khác có thể rỗng
//     giftName: string,        // gift
//     diamonds: number,        // gift: kim cương / 1 món
//     count: number,           // like/gift: số lượng
//     ritual: string }         // ritual: khóa lịch trong CONFIG.schedule.rituals
// 'join' = người xem vừa vào phòng. 'leave' = người xem rời phòng
// (phố đêm không xóa nhân vật theo rời — scene bỏ qua).
// 'ritual' chỉ do demo test-only emit để thử nghi thức theo lịch;
// khi live thật, nghi thức chạy theo giờ trong lịch, không emit event này.

const listeners = new Map();

function normalizeEvent(evt) {
  const user = evt && evt.user ? evt.user : {};
  return {
    type: evt ? evt.type : '',
    user: {
      name: user.name || user.uniqueId || 'Khách',
      uniqueId: String(user.uniqueId || ''),
      avatar: user.avatar || '',
    },
    text: evt && evt.text ? String(evt.text) : '',
    giftName: evt && evt.giftName ? String(evt.giftName) : '',
    diamonds: Number(evt && evt.diamonds ? evt.diamonds : 0) || 0,
    count: Number(evt && evt.count ? evt.count : 1) || 1,
    ritual: evt && evt.ritual ? String(evt.ritual) : '',
  };
}

export const StreetEvents = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  },

  emit(rawEvt) {
    const evt = normalizeEvent(rawEvt);
    const fire = (set) => {
      if (!set) return;
      set.forEach((fn) => {
        try {
          fn(evt);
        } catch (err) {
          console.error('[StreetEvents] listener lỗi:', err);
        }
      });
    };
    fire(listeners.get(evt.type));
    fire(listeners.get('*'));
  },
};
