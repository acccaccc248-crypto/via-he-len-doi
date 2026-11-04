// demo.js — DEMO MODE, TEST ONLY. Off by default.
// Runs only when the URL has ?demo=1. Every button emits a FAKE
// event through StreetEvents (the same shape as js/events.js) so the
// game handlers and scene hooks can be previewed. Nothing here calls
// scene functions directly, touches the relay, or starts music.
//
// FORBIDDEN DURING A REAL BROADCAST: faking viewers during a live
// stream is interaction fraud. On a real broadcast the relay
// (js/relay.js) is the only event source. Use ?demo=1 only to preview
// or check behaviour while NOT broadcasting.
//
// When ?demo=1 is absent: return false at once, do nothing (no demo
// buttons, no fake events, no DOM changes for demo).
// main.js only calls maybeStartDemo(); this file builds and shows its
// own badge + panel when demo mode is on.

import { StreetEvents } from './events.js';

function demoUser(uniqueId) {
  return { name: 'Bạn Demo', uniqueId, avatar: '' };
}

function makeButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

export function maybeStartDemo() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') !== '1') return false;

  console.warn('[Demo] TEST-ONLY: emitting FAKE viewer events (?demo=1). Never use during a real broadcast.');

  // Badge: visible warning that demo mode is on.
  const badge = document.createElement('div');
  badge.id = 'demo-badge';
  badge.textContent = 'CHỈ THỬ — CẤM DÙNG LÚC LIVE THẬT';
  document.body.appendChild(badge);

  // Panel: one button per mechanism. Labels name the mechanism only;
  // no button text mentions effects as rewards or asks for anything.
  const panel = document.createElement('div');
  panel.id = 'demo-panel';
  document.body.appendChild(panel);

  const add = (label, fn) => panel.appendChild(makeButton(label, fn));

  // New viewer joining.
  add('Người mới vào', () => {
    StreetEvents.emit({ type: 'join', user: demoUser('demo_join') });
  });

  // Plain chat line.
  add('Bình luận', () => {
    StreetEvents.emit({
      type: 'chat',
      user: demoUser('demo_chat'),
      text: 'phố đêm nay đẹp quá',
    });
  });

  // Chat opening a stall: the "sell:" command the game parses.
  add('Bán trà đá', () => {
    StreetEvents.emit({
      type: 'chat',
      user: demoUser('demo_sell'),
      text: 'bán: trà đá',
    });
  });

  // Chat requesting a level-up: the upgrade command the game parses.
  add('Nâng cấp', () => {
    StreetEvents.emit({
      type: 'chat',
      user: demoUser('demo_upgrade'),
      text: 'nâng cấp',
    });
  });

  // Like bursts: 10 (one glow step) and 100 (a milestone burst).
  add('Tim ×10', () => {
    StreetEvents.emit({ type: 'like', user: demoUser('demo_like10'), count: 10 });
  });
  add('Tim ×100', () => {
    StreetEvents.emit({ type: 'like', user: demoUser('demo_like100'), count: 100 });
  });

  // Effect bursts, small and large. Button text names the effect tier
  // only; the event itself carries the standard effect payload.
  add('Hiệu ứng A (1💎)', () => {
    StreetEvents.emit({
      type: 'gift',
      user: demoUser('demo_effect_a'),
      giftName: 'Hoa hồng',
      diamonds: 1,
      count: 1,
    });
  });
  add('Hiệu ứng B (15💎)', () => {
    StreetEvents.emit({
      type: 'gift',
      user: demoUser('demo_effect_b'),
      giftName: 'Pháo giấy',
      diamonds: 15,
      count: 1,
    });
  });

  // New follower.
  add('Follow mới', () => {
    StreetEvents.emit({ type: 'follow', user: demoUser('demo_follow') });
  });

  // Votes: chat "1" / "2" while a vote window is open.
  add('Bình chọn 1', () => {
    StreetEvents.emit({
      type: 'chat',
      user: demoUser('demo_vote1'),
      text: '1',
    });
  });
  add('Bình chọn 2', () => {
    StreetEvents.emit({
      type: 'chat',
      user: demoUser('demo_vote2'),
      text: '2',
    });
  });

  // Rituals: fake 'ritual' events. On a real broadcast rituals run
  // from the schedule (js/schedule.js -> handlers.onRitual), never
  // from these buttons.
  const ritualKeys = [
    ['open', 'Nghi thức: Mở phiên'],
    ['vote1', 'Nghi thức: Bình chọn đợt 1'],
    ['rush', 'Nghi thức: Giờ cao điểm'],
    ['vote2', 'Nghi thức: Bình chọn đợt 2'],
    ['market', 'Nghi thức: Chợ đêm'],
    ['closing', 'Nghi thức: Kết phiên'],
  ];
  for (const [key, label] of ritualKeys) {
    add(label, () => {
      StreetEvents.emit({
        type: 'ritual',
        user: demoUser(`demo_ritual_${key}`),
        ritual: key,
      });
    });
  }

  return true;
}
