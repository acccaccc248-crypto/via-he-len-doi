// main.js — wires the street scene + music + relay + game handlers
// together. The only live event source is the relay (js/relay.js);
// event -> effect handling lives in js/handlers.js (initGameHandlers).
// This file only builds the renderer/camera, the Start/music/FPS
// buttons, the render loop, and the label sync from CONFIG.labels.
//
// SINGLE RITUAL PATH (hard rule): schedule/demo -> handlers.onRitual
// -> scene. main.js NEVER calls scene hooks itself and has NO
// fallback adapter that calls them (a duplicate adapter once caused
// rituals to run twice). Rituals from the schedule arrive through
// initSchedule({ onRitual }); rituals from demo arrive as 'ritual'
// events on StreetEvents, which the game handlers route to the same
// handlers.onRitual. main.js subscribes to no events at all.
//
// Module loading: CONFIG, scene, audio, relay, events, TTS and demo
// use static imports (their names are fixed by contract). The game
// handlers live in js/handlers.js (initGameHandlers); js/game.js is
// the state engine and does NOT export initGameHandlers, so the
// loader below checks each candidate module for the named export
// instead of accepting the first module that merely loads. The
// schedule module is loaded the same way from './schedule.js'. A
// missing sibling module logs an error instead of killing the scene
// — the scene and music still render, and the wiring comes alive as
// soon as the sibling module lands. No fallback ritual timer is
// built here.

import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { createStreetScene } from './scene.js';
import { StreetAudio } from './audio.js';
import { Relay } from './relay.js';
import { StreetEvents } from './events.js';
import * as ttsModule from './tts.js';
import { maybeStartDemo } from './demo.js';

// TTS instance passed to handlers: handlers call
// tts.speakTemplate(key, vars) / tts.speakComment(text) on an
// instance, so main.js constructs the GameTTS class from js/tts.js
// (wired to duck the music while speaking) instead of passing the
// module namespace. If the class export is absent, fall back to a
// named `tts` export or the namespace — handlers guard the calls,
// so speech stays silent rather than crashing. The instance is built
// after `music` exists (ducking needs it); see below.
let tts = null;

const params = new URLSearchParams(window.location.search);
const fpsWanted = params.get('fps') === '1';

function cfgNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cfgArray(value, fallback) {
  return Array.isArray(value) && value.length === 3 ? value : fallback;
}

const rendererCfg = (CONFIG && CONFIG.renderer) || {};
const cameraCfg = (CONFIG && CONFIG.camera) || {};
const hudCfg = (CONFIG && CONFIG.hud) || {};
const musicCfg = (CONFIG && CONFIG.music) || {};

const container = document.getElementById('scene-container');
const renderer = new THREE.WebGLRenderer({
  antialias: rendererCfg.antialias === true,
  powerPreference: 'low-power',
});
renderer.setPixelRatio(Math.min(
  window.devicePixelRatio || 1,
  cfgNum(rendererCfg.pixelRatioCap, 1.25),
));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.shadowMap.enabled = rendererCfg.shadowsEnabled === true;
if (typeof rendererCfg.clearColor === 'number') {
  renderer.setClearColor(rendererCfg.clearColor);
}
container.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  cfgNum(cameraCfg.fov, 55),
  container.clientWidth / container.clientHeight,
  cfgNum(cameraCfg.near, 0.1),
  cfgNum(cameraCfg.far, 60),
);
camera.position.set(...cfgArray(cameraCfg.basePosition, [0, 3.2, 11]));
camera.lookAt(...cfgArray(cameraCfg.lookAt, [0, 1.2, 0]));

const streetScene = createStreetScene();
const sceneRoot = (streetScene && streetScene.scene) || streetScene;
const music = new StreetAudio();
if (typeof music.setConfig === 'function' && musicCfg && typeof musicCfg === 'object') {
  music.setConfig(musicCfg);
}

// Build the TTS instance (needs `music` for the duck callback).
try {
  const TTSClass = (ttsModule && (ttsModule.GameTTS || ttsModule.default)) || null;
  if (typeof TTSClass === 'function') {
    const duckFn = (on) => {
      try { music.setDucked(on); } catch (err) { /* duck failure never blocks speech */ }
    };
    tts = new TTSClass({ onDuck: duckFn });
    if (tts && typeof tts.setDuckCallback === 'function') {
      tts.setDuckCallback(duckFn);
    }
  }
} catch (err) {
  console.error('[main] TTS instance error:', err);
  tts = null;
}
if (!tts) {
  tts = (ttsModule && ttsModule.tts) || ttsModule;
}

// ---- Permanent labels: sync all 3 lines from CONFIG.labels ----
// Line 3 shows at once for a short while, then repeats on a timer
// (same pattern as the tea-note in the chill-room build). Lines 1+2
// stay visible at all times. No label text is hardcoded here: HTML
// placeholders are replaced only when CONFIG provides the strings.
function readLabelLines() {
  const labels = CONFIG && CONFIG.labels;
  if (!labels) return [];
  if (Array.isArray(labels)) {
    return labels.filter((s) => typeof s === 'string').slice(0, 3);
  }
  if (Array.isArray(labels.lines)) {
    return labels.lines.filter((s) => typeof s === 'string').slice(0, 3);
  }
  if (typeof labels === 'object') {
    return [
      labels.line1 ?? labels.first ?? labels.title ?? '',
      labels.line2 ?? labels.second ?? labels.safety ?? '',
      labels.line3 ?? labels.third ?? labels.explain ?? labels.explainLine ?? '',
    ];
  }
  return [];
}

try {
  const lines = readLabelLines();
  const els = [
    document.getElementById('label-line-1'),
    document.getElementById('label-line-2'),
    document.getElementById('label-line-3'),
  ];
  els.forEach((el, i) => {
    if (el && typeof lines[i] === 'string' && lines[i].length > 0) {
      el.textContent = lines[i];
    }
  });
  const line3El = els[2];
  const labelsObj = (CONFIG && CONFIG.labels && !Array.isArray(CONFIG.labels)
    && typeof CONFIG.labels === 'object') ? CONFIG.labels : {};
  if (line3El) {
    const showMs = cfgNum(
      labelsObj.explainShowSeconds ?? labelsObj.showSeconds, 30,
    ) * 1000;
    const repeatMs = cfgNum(
      labelsObj.explainRepeatMinutes ?? labelsObj.repeatMinutes, 12,
    ) * 60 * 1000;
    const showLine3 = () => { line3El.hidden = false; };
    const hideLine3 = () => { line3El.hidden = true; };
    showLine3();
    setTimeout(hideLine3, showMs);
    setInterval(() => {
      showLine3();
      setTimeout(hideLine3, showMs);
    }, repeatMs);
  }
} catch (err) {
  // Label sync failing must not block music or the scene.
  console.error('[main] label sync error:', err);
}

// ---- Game systems: handlers, schedule, relay, demo ----
// Order matters: handlers subscribe to StreetEvents before the relay
// connects and before demo mode emits anything.
async function loadInitFunction(candidates, exportName) {
  for (const path of candidates) {
    try {
      const mod = await import(path);
      const fn = mod[exportName] || mod.default;
      if (typeof fn === 'function') return fn;
      // Module loaded but without the named export (e.g. js/game.js
      // has no initGameHandlers) — keep looking at the next candidate.
    } catch (err) {
      // Module missing or broken — try the next candidate.
    }
  }
  return null;
}

async function bootGameSystems() {
  let handlers = null;
  const initGameHandlers = await loadInitFunction(
    ['./game.js', './handlers.js'], 'initGameHandlers',
  );
  if (typeof initGameHandlers === 'function') {
    try {
      handlers = initGameHandlers({
        scene: streetScene,
        audio: music,
        events: StreetEvents,
        tts,
      });
    } catch (err) {
      console.error('[main] game handlers init error:', err);
    }
  } else {
    console.error('[main] game handlers unavailable: no initGameHandlers export');
  }

  // The single ritual path: schedule -> handlers.onRitual -> scene.
  // Nothing else in this file routes rituals anywhere.
  const initSchedule = await loadInitFunction(['./schedule.js'], 'initSchedule');
  if (typeof initSchedule === 'function') {
    try {
      initSchedule({
        onRitual: (key, info) => {
          if (handlers && typeof handlers.onRitual === 'function') {
            handlers.onRitual(key, info);
          }
        },
      });
    } catch (err) {
      console.error('[main] schedule init error:', err);
    }
  } else {
    console.error('[main] schedule unavailable: no initSchedule export');
  }

  // Relay: live connection (see js/relay.js).
  try {
    Relay.connect({});
  } catch (err) {
    console.error('[main] relay connect error:', err);
  }

  // Demo test-only (?demo=1) — off by default, see js/demo.js.
  try {
    maybeStartDemo();
  } catch (err) {
    console.error('[main] demo error:', err);
  }
}

bootGameSystems().catch((err) => {
  console.error('[main] boot error:', err);
});

// ---- Music / FPS / Start buttons (audio unlock) ----
const musicBtn = document.getElementById('btn-music');
const fpsBtn = document.getElementById('btn-fps');
const fpsEl = document.getElementById('fps-counter');
const startOverlay = document.getElementById('start-overlay');
const startBtn = document.getElementById('btn-start');

let fpsVisible = fpsWanted;
function applyFpsVisibility() {
  fpsEl.hidden = !fpsVisible;
  fpsBtn.setAttribute('aria-pressed', String(fpsVisible));
}
applyFpsVisibility();
fpsBtn.addEventListener('click', () => {
  fpsVisible = !fpsVisible;
  applyFpsVisibility();
});

function refreshMusicButton() {
  musicBtn.textContent = music.playing ? '🔊 Nhạc: Bật' : '🔇 Nhạc: Tắt';
  musicBtn.setAttribute('aria-pressed', String(music.playing));
}
refreshMusicButton();
musicBtn.addEventListener('click', () => {
  music.unlock();
  if (tts && typeof tts.unlock === 'function') {
    try { tts.unlock(); } catch (err) { /* ignored */ }
  }
  music.toggle();
  refreshMusicButton();
});

startBtn.addEventListener('click', () => {
  music.unlock();
  if (tts && typeof tts.unlock === 'function') {
    try { tts.unlock(); } catch (err) { /* ignored */ }
  }
  if (musicCfg.startOnUnlock !== false && !music.playing) music.start();
  refreshMusicButton();
  startOverlay.hidden = true;
  // Fullscreen for the live frame: hides the address bar + status bar
  // so the scene is as large as possible. If it cannot be granted,
  // music and the scene still run normally (never blocking).
  try {
    const p = document.documentElement.requestFullscreen
      && document.documentElement.requestFullscreen();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* ignored */ }
});

// ---- Resize: landscape frame, camera follows the viewport ratio ----
function onResize() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', onResize);
document.addEventListener('fullscreenchange', () => window.setTimeout(onResize, 100));
window.addEventListener('orientationchange', () => window.setTimeout(onResize, 300));

// ---- Animation loop: delta clamp + FPS debug ----
const clock = new THREE.Clock();
let elapsed = 0;
let frames = 0;
let fpsLastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), cfgNum(rendererCfg.maxDeltaSeconds, 0.05));
  elapsed += dt;

  if (streetScene && typeof streetScene.update === 'function') {
    streetScene.update(dt, elapsed);
  }
  renderer.render(sceneRoot, camera);

  // FPS debug.
  frames += 1;
  const nowMs = performance.now();
  if (nowMs - fpsLastTime >= cfgNum(hudCfg.fpsUpdateIntervalMs, 500)) {
    const fps = Math.round((frames * 1000) / (nowMs - fpsLastTime));
    frames = 0;
    fpsLastTime = nowMs;
    if (fpsVisible) fpsEl.textContent = `${fps} FPS`;
  }
}
animate();
