// schedule.js — lịch nghi thức theo giờ Asia/Ho_Chi_Minh.
// Tick 5 giây bằng Intl.DateTimeFormat. Mỗi nghi thức bắn đúng
// một lần trong ngày. Mở trang sau mốc thì chỉ gọi onRitual với
// late:true (trừ mốc end) để bên nhận đặt trạng thái cuối, không
// chạy lại animation hay giọng máy. Không crash khi thiếu DOM.

import { CONFIG } from '../config.js';

const CFG = CONFIG || {};
const SCHEDULE_CFG = (CFG && CFG.schedule) || {};
const TIMEZONE = (SCHEDULE_CFG && SCHEDULE_CFG.timezone) || 'Asia/Ho_Chi_Minh';

const FALLBACK_RITUALS = [
  { key: 'open', time: '19:30', label: 'Mở phiên', line: 'Chào bạn, phố đêm mở cửa.' },
  { key: 'vote1', time: '20:00', label: 'Bình chọn 1', line: 'Bình chọn món: nhắn 1 hoặc 2.' },
  { key: 'rush', time: '20:30', label: 'Giờ cao điểm', line: 'Cao điểm: mỗi mốc like cộng gấp đôi.' },
  { key: 'vote2', time: '21:00', label: 'Bình chọn 2', line: 'Bình chọn món: nhắn 1 hoặc 2.' },
  { key: 'market', time: '21:30', label: 'Chợ đêm', line: 'Chợ đêm lên đèn.' },
  { key: 'closing', time: '21:45', label: 'Kết phiên', line: 'Kết phiên — tổng kết top 5.' },
  { key: 'end', time: '22:00', label: 'Hết giờ', line: 'Hết giờ — hẹn tối mai.' },
];

function ritualList() {
  const list = SCHEDULE_CFG && Array.isArray(SCHEDULE_CFG.rituals)
    ? SCHEDULE_CFG.rituals : null;
  if (list && list.length) {
    return list.map((r, i) => ({
      key: String((r && r.key) || FALLBACK_RITUALS[i]?.key || `ritual${i}`),
      time: String((r && r.time) || FALLBACK_RITUALS[i]?.time || '19:30'),
      label: String((r && r.label) || FALLBACK_RITUALS[i]?.label || ''),
      line: String((r && r.line) || FALLBACK_RITUALS[i]?.line || ''),
      hook: (r && r.hook) || null,
    }));
  }
  return FALLBACK_RITUALS.map((r) => ({ ...r, hook: null }));
}

export function parseHHMM(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesInTimezone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || TIMEZONE,
    hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return get('hour') * 60 + get('minute');
}

function timezoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || TIMEZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUTC - Math.floor(date.getTime() / 1000) * 1000;
}

function ritualInstantMs(date, hhmm, timeZone) {
  const mins = parseHHMM(hhmm);
  if (mins === null) return null;
  const tz = timeZone || TIMEZONE;
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const wallUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Math.floor(mins / 60), mins % 60, 0,
  );
  return wallUTC - timezoneOffsetMs(date, tz);
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  return `${h}:${m}`;
}

export function initSchedule({ onRitual, nowFn } = {}) {
  const rituals = ritualList();
  const fired = new Set();
  const nowSupplier = typeof nowFn === 'function' ? nowFn : () => new Date();

  function fire(key, late, def) {
    fired.add(key);
    if (typeof onRitual !== 'function') return;
    try {
      onRitual(key, { late, ritual: def, label: def.label, line: def.line, time: def.time });
    } catch {
      /* lịch lỗi không giết tick */
    }
  }

  function docEl(id) {
    try {
      if (typeof document === 'undefined') return null;
      return document.getElementById(id);
    } catch {
      return null;
    }
  }

  function updateHud(now) {
    try {
      const board = docEl('schedule-board');
      if (board) {
        board.textContent = '';
        const nowMin = minutesInTimezone(now, TIMEZONE);
        let nextIdx = rituals.findIndex((r) => {
          const start = parseHHMM(r.time);
          return start !== null && nowMin < start;
        });
        if (nextIdx === -1) nextIdx = rituals.length;
        rituals.forEach((def, i) => {
          const start = parseHHMM(def.time);
          const row = document.createElement('div');
          let suffix = '';
          if (start !== null && nowMin >= start) suffix = ' — xong';
          else if (i === nextIdx) suffix = ' — tiếp theo';
          row.textContent = `${def.time} ${def.label}${suffix}`;
          board.appendChild(row);
        });
      }
      const cdEl = docEl('countdown');
      if (cdEl) {
        let targetMs = null;
        let targetDef = null;
        for (const def of rituals) {
          const ms = ritualInstantMs(now, def.time, TIMEZONE);
          if (ms !== null && ms > now.getTime()) {
            targetMs = ms;
            targetDef = def;
            break;
          }
        }
        if (targetMs === null) {
          const first = ritualInstantMs(now, rituals[0].time, TIMEZONE);
          targetMs = (first === null ? now.getTime() : first) + 24 * 3600 * 1000;
          targetDef = rituals[0];
        }
        cdEl.textContent = `Còn ${formatCountdown(targetMs - now.getTime())} tới ${targetDef.label}`;
      }
    } catch {
      /* HUD lỗi không giết lịch */
    }
  }

  function tick() {
    let now;
    try {
      now = nowSupplier();
    } catch {
      return;
    }
    const nowMin = minutesInTimezone(now, TIMEZONE);
    for (const def of rituals) {
      const start = parseHHMM(def.time);
      if (start !== null && nowMin >= start && !fired.has(def.key)) {
        fire(def.key, false, def);
      }
    }
    updateHud(now);
  }

  // Khởi tạo: mốc đã qua thì báo late (trừ end), đánh dấu đã bắn
  // để tick sau không bắn lại.
  try {
    const now0 = nowSupplier();
    const nowMin0 = minutesInTimezone(now0, TIMEZONE);
    for (const def of rituals) {
      const start = parseHHMM(def.time);
      if (start !== null && nowMin0 >= start) {
        fired.add(def.key);
        if (def.key !== 'end') fire(def.key, true, def);
      }
    }
    updateHud(now0);
  } catch {
    /* tick 5 giây sẽ thử lại */
  }

  const timer = setInterval(tick, 5000);

  return {
    stop() {
      try {
        clearInterval(timer);
      } catch {
        /* bỏ qua */
      }
    },
    tick,
  };
}
