// audio.js — street-game music: Mixkit Free License file tracks played
// in order + a WebAudio synth bed (bright pad + light pulse + faint
// street hum) running under the tracks. No licensed music is used.
//
// Interface for main.js / game handlers: constructor(), unlock(),
// start(), stop(), toggle(), playing, nextTrack(), playTrackIndex(),
// playTrack() (alias), setVolume(), startBed(), stopBed(),
// setDucked(), duckForSpeech() (alias), onTrackChange,
// currentTrackTitle(). One user tap is needed to unlock the
// AudioContext: main.js calls audio.unlock() in the "Start" handler.
// Nothing plays before unlock.
//
// Config: CONFIG.music when present, with safe fallbacks when
// config.js is not there yet (no static import of config.js — the
// file may not exist yet, and a static import would break this
// module). Order: (1) globalThis.CONFIG if set; (2) dynamic import
// of '../config.js' best-effort after unlock; (3) defaults below.
//   masterVolume 0.5, trackGain 0.8, bedVolume 0.22.

const DEFAULT_MUSIC_CONFIG = {
  masterVolume: 0.5,
  trackGain: 0.8,
  bedVolume: 0.22,
  duckLevel: 0.2,
  bedChordSeconds: 8,
  bedBpm: 96,
  manifestUrl: './audio/tracks.json',
};

// Bright pad chords (C — G — Am — F), Hz, changing about every
// 8 seconds. Soft, no harsh transient, stays under the voice lines.
const BED_CHORDS = [
  [261.63, 329.63, 392.0], // C
  [196.0, 246.94, 293.66], // G
  [220.0, 261.63, 329.63], // Am
  [174.61, 220.0, 261.63], // F
];

function _globalMusicConfig() {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    const cfg = g && g.CONFIG;
    if (cfg && typeof cfg === 'object' && cfg.music && typeof cfg.music === 'object') {
      return cfg.music;
    }
  } catch (err) {
    // Global CONFIG unreadable — defaults apply, no crash.
  }
  return {};
}

function _clamped01(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

export class StreetAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.fileGain = null;
    this.bedGain = null;
    this.noiseBuffer = null;
    this._playing = false;
    // Optional callback: onTrackChange(index, track) on track change.
    this.onTrackChange = null;
    // Effective config (defaults + CONFIG when present).
    this._cfg = { ...DEFAULT_MUSIC_CONFIG, ..._globalMusicConfig() };
    this._cfg.masterVolume = _clamped01(this._cfg.masterVolume, 0.5);
    this._cfg.trackGain = _clamped01(this._cfg.trackGain, 0.8);
    this._cfg.bedVolume = _clamped01(this._cfg.bedVolume, 0.22);
    this._cfg.duckLevel = _clamped01(this._cfg.duckLevel, 0.2);
    this._volumeTouched = false;
    this._configModuleTried = false;
    // Manifest + file tracks.
    this.tracks = [];
    this.trackBuffers = new Map();
    this.trackIndex = -1;
    this._order = [];
    this._orderPos = 0;
    this.trackSource = null;
    this.trackSourceGain = null;
    this._loadPromise = null;
    this._startToken = 0;
    // Synth bed.
    this.bedOn = false;
    this._bedNodes = null;
    this._chordTimerId = null;
    this._chordTimeoutId = null;
    this._pulseTimerId = null;
    this._chordIndex = 0;
    this._bedToken = 0;
    // Ducked while TTS speaks.
    this._ducked = false;
  }

  get playing() {
    return this._playing === true;
  }

  set playing(value) {
    this._playing = value === true;
  }

  // Manual config override (optional, for main.js when CONFIG only
  // exists as a module and globalThis does not see it). Not required:
  // without it, defaults + global CONFIG + dynamic import suffice.
  setConfig(musicConfig) {
    if (musicConfig && typeof musicConfig === 'object') {
      this._applyMusicConfig(musicConfig);
    }
    return this;
  }

  _applyMusicConfig(musicConfig) {
    if (!musicConfig || typeof musicConfig !== 'object') return;
    const next = { ...this._cfg };
    if (musicConfig.masterVolume !== undefined) {
      next.masterVolume = _clamped01(musicConfig.masterVolume, next.masterVolume);
    }
    if (musicConfig.trackGain !== undefined) {
      next.trackGain = _clamped01(musicConfig.trackGain, next.trackGain);
    }
    if (musicConfig.bedVolume !== undefined) {
      next.bedVolume = _clamped01(musicConfig.bedVolume, next.bedVolume);
    }
    if (musicConfig.duckLevel !== undefined) {
      next.duckLevel = _clamped01(musicConfig.duckLevel, next.duckLevel);
    }
    if (typeof musicConfig.bedChordSeconds === 'number' && musicConfig.bedChordSeconds > 0) {
      next.bedChordSeconds = musicConfig.bedChordSeconds;
    }
    if (typeof musicConfig.bedBpm === 'number' && musicConfig.bedBpm > 0) {
      next.bedBpm = musicConfig.bedBpm;
    }
    if (typeof musicConfig.manifestUrl === 'string' && musicConfig.manifestUrl.length > 0) {
      next.manifestUrl = musicConfig.manifestUrl;
    }
    // Key used by the config owner (config.js): tracksManifestUrl —
    // same default value; only used when manifestUrl was not set.
    if (next.manifestUrl === DEFAULT_MUSIC_CONFIG.manifestUrl
      && typeof musicConfig.tracksManifestUrl === 'string'
      && musicConfig.tracksManifestUrl.length > 0) {
      next.manifestUrl = musicConfig.tracksManifestUrl;
    }
    this._cfg = next;
    this._applyGains();
  }

  // Apply current gain levels to created nodes (respecting duck state
  // and any setVolume call by the user).
  _applyGains() {
    if (!this.ctx) return;
    const duck = this._ducked ? this._cfg.duckLevel : 1;
    if (this.master && !this._volumeTouched) {
      this._setGain(this.master.gain, this._cfg.masterVolume, 0.05);
    }
    if (this.fileGain) {
      this._setGain(this.fileGain.gain, this._cfg.trackGain * duck, 0.1);
    }
    if (this.bedGain) {
      this._setGain(this.bedGain.gain, this._cfg.bedVolume * duck, 0.1);
    }
  }

  _setGain(param, value, timeConstant) {
    if (!param) return;
    // 0 is valid (fully off); exponential fades need the 0.0001 floor
    // and use it directly at their call sites.
    const target = Math.max(0, value);
    try {
      if (typeof param.setTargetAtTime === 'function') {
        param.setTargetAtTime(target, this.ctx.currentTime, timeConstant || 0.1);
        return;
      }
    } catch (err) {
      // Fall through below.
    }
    try {
      param.value = target;
    } catch (err) {
      // Read-only param — keep the old level.
    }
  }

  _tryLoadConfigModule() {
    if (this._configModuleTried) return;
    this._configModuleTried = true;
    // config.js may not exist yet — an import error is normal here,
    // defaults + global CONFIG already cover it.
    import('../config.js').then((mod) => {
      if (mod && mod.CONFIG && mod.CONFIG.music) {
        this._applyMusicConfig(mod.CONFIG.music);
      }
    }).catch(() => {});
  }

  unlock() {
    // Re-read global CONFIG on each unlock (main.js may set it after
    // StreetAudio was constructed).
    this._applyMusicConfig(_globalMusicConfig());
    if (!this.ctx) {
      const AC = (typeof globalThis !== 'undefined' && (globalThis.AudioContext || globalThis.webkitAudioContext)) || null;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._volumeTouched
        ? this._masterVolumeValue()
        : this._cfg.masterVolume;
      this.master.connect(this.ctx.destination);
      this.fileGain = this.ctx.createGain();
      this.fileGain.gain.value = this._cfg.trackGain * (this._ducked ? this._cfg.duckLevel : 1);
      this.fileGain.connect(this.master);
      this.bedGain = this.ctx.createGain();
      this.bedGain.gain.value = this._cfg.bedVolume * (this._ducked ? this._cfg.duckLevel : 1);
      this.bedGain.connect(this.master);
      this.noiseBuffer = this._makeNoiseBuffer(2);
      // Load the manifest in the background right after unlock so a
      // tap on "Start" finds tracks ready; failure is silent here —
      // start() falls back to bed-only.
      this._ensureTracksLoaded().catch(() => {});
      this._tryLoadConfigModule();
    }
    if (this.ctx.state === 'suspended') {
      try {
        const resumed = this.ctx.resume();
        if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
      } catch (err) {
        // Resume failed (no gesture yet) — the context still exists,
        // the next tap retries. Not treated as an unlock error.
      }
    }
    return true;
  }

  _masterVolumeValue() {
    return typeof this._masterVolume === 'number' ? this._masterVolume : this._cfg.masterVolume;
  }

  _makeNoiseBuffer(seconds) {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * seconds, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  // ---- Play / stop ----

  start() {
    if (!this.unlock()) return;
    if (this.playing) return;
    const token = ++this._startToken;
    this.playing = true;
    this.startBed();
    this._ensureTracksLoaded().then(({ loaded }) => {
      if (token !== this._startToken || !this.playing) return;
      if (loaded === 0 || this.trackBuffers.size === 0) {
        // No tracks (empty manifest / load error): run the synth bed
        // only, no crash, no dead silence.
        return;
      }
      this._order = this._buildOrder();
      this._orderPos = 0;
      this._playFileIndex(this._order[this._orderPos]);
    }).catch(() => {
      // Load error after unlock — bed already runs, keep playing=true.
    });
  }

  stop() {
    // Bump the token so pending async paths (track load, chord change)
    // cancel. Every stop path goes through here + _stopFileSource.
    this._startToken += 1;
    this.playing = false;
    this._ducked = false;
    this._stopFileSource();
    this.stopBed();
  }

  toggle() {
    if (this.playing) this.stop();
    else this.start();
    return this.playing;
  }

  setVolume(v) {
    const value = _clamped01(v, this._masterVolumeValue());
    this._masterVolume = value;
    this._volumeTouched = true;
    if (this.master) this._setGain(this.master.gain, value, 0.05);
    return value;
  }

  // ---- File-track playlist: in order, auto-advance at track end ----

  _buildOrder() {
    const playable = [];
    for (let i = 0; i < this.tracks.length; i += 1) {
      if (this.trackBuffers.has(i)) playable.push(i);
    }
    return playable;
  }

  _ensureTracksLoaded() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = Promise.resolve().then(() => this.loadTracks());
    return this._loadPromise;
  }

  // Load manifest + decode every track (returns {loaded, failed}).
  // Empty manifest / fetch error / broken JSON all return loaded=0
  // without throwing — the caller falls back to bed-only.
  async loadTracks() {
    if (!this.unlock()) return { loaded: 0, failed: this.tracks.length };
    let manifest = [];
    try {
      const resp = await fetch(this._cfg.manifestUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const parsed = await resp.json();
      if (!Array.isArray(parsed)) throw new Error('manifest is not an array');
      manifest = parsed;
    } catch (err) {
      console.warn('[StreetAudio] manifest not loaded, bed-only mode:', err);
      this.tracks = [];
      return { loaded: 0, failed: 0 };
    }
    this.tracks = manifest;
    let loaded = 0;
    let failed = 0;
    for (let i = 0; i < manifest.length; i += 1) {
      if (this.trackBuffers.has(i)) {
        loaded += 1;
        continue;
      }
      try {
        const url = this._trackUrl(manifest[i]);
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(data);
        this.trackBuffers.set(i, buffer);
        loaded += 1;
      } catch (err) {
        failed += 1;
        console.warn('[StreetAudio] track failed to load', i, err);
      }
    }
    return { loaded, failed };
  }

  _trackUrl(entry) {
    const file = entry && typeof entry.file === 'string' ? entry.file : '';
    if (file.startsWith('http://') || file.startsWith('https://') || file.startsWith('/')) return file;
    if (file.startsWith('audio/') || file.startsWith('./audio/')) {
      return file.startsWith('./') ? file : `./${file}`;
    }
    return `./audio/${file}`;
  }

  _playFileIndex(index) {
    const buffer = this.trackBuffers.get(index);
    const track = this.tracks[index];
    if (!buffer || !track) {
      this._advance();
      return;
    }
    this._stopFileSource();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1, now + 0.6);
    src.connect(gain);
    gain.connect(this.fileGain);
    const token = this._startToken;
    src.onended = () => {
      if (token !== this._startToken || !this.playing) return;
      if (this.trackSource !== src) return;
      this._advance();
    };
    src.start(now + 0.05);
    this.trackSource = src;
    this.trackSourceGain = gain;
    this.trackIndex = index;
    if (typeof this.onTrackChange === 'function') {
      try {
        this.onTrackChange(index, track);
      } catch (err) {
        console.error('[StreetAudio] onTrackChange error:', err);
      }
    }
  }

  _advance() {
    if (this._order.length === 0) return;
    this._orderPos = (this._orderPos + 1) % this._order.length;
    this._playFileIndex(this._order[this._orderPos]);
  }

  nextTrack() {
    if (!this.playing || this._order.length === 0) return false;
    this._startToken += 1;
    this._advance();
    return true;
  }

  async playTrackIndex(index) {
    if (!Number.isInteger(index) || index < 0 || !this.tracks[index]) {
      // Manifest may not be loaded yet (called before start): try
      // loading once, then re-check before returning false.
      if (this.tracks.length === 0) {
        try {
          await this._ensureTracksLoaded();
        } catch (err) {
          return false;
        }
        if (!Number.isInteger(index) || index < 0 || !this.tracks[index]) return false;
      } else {
        return false;
      }
    }
    if (!this.unlock()) return false;
    await this._ensureTracksLoaded();
    if (!this.trackBuffers.has(index)) return false;
    this._startToken += 1;
    this.playing = true;
    this.startBed();
    this._order = this._buildOrder();
    this._orderPos = Math.max(0, this._order.indexOf(index));
    this._playFileIndex(index);
    return true;
  }

  // Alias kept for callers written against the older track API name.
  playTrack(index) {
    return this.playTrackIndex(index);
  }

  currentTrackTitle() {
    const track = this.tracks[this.trackIndex];
    if (track && typeof track.title === 'string') return track.title;
    return '';
  }

  _stopFileSource() {
    const src = this.trackSource;
    const gain = this.trackSourceGain;
    this.trackSource = null;
    this.trackSourceGain = null;
    if (src) {
      try {
        src.onended = null;
      } catch (err) {
        // Ignored.
      }
      try {
        src.stop();
      } catch (err) {
        // Already stopped — ignored.
      }
      try {
        src.disconnect();
      } catch (err) {
        // Ignored.
      }
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch (err) {
        // Ignored.
      }
    }
  }

  // ---- Synth bed: bright pad + light pulse + faint street hum,
  // running UNDER the file tracks ----

  startBed() {
    if (!this.unlock()) return false;
    if (this.bedOn && this._bedNodes) return true;
    const token = ++this._bedToken;
    const now = this.ctx.currentTime;
    // Pad: 3 oscillators (one note per chord tone), slight detune,
    // through a lowpass — soft, no harsh transient.
    const padFilter = this.ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = 900;
    padFilter.Q.value = 0.5;
    const padGain = this.ctx.createGain();
    padGain.gain.setValueAtTime(0.0001, now);
    padGain.gain.exponentialRampToValueAtTime(0.3, now + 1.5);
    padFilter.connect(padGain);
    padGain.connect(this.bedGain);
    const chord = BED_CHORDS[this._chordIndex % BED_CHORDS.length];
    const padOscs = chord.map((freq, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i === 2 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      osc.detune.value = i === 0 ? -4 : (i === 1 ? 4 : 0);
      osc.connect(padFilter);
      osc.start(now + 0.05);
      return osc;
    });
    // Faint street hum: noise loop through a lowpass, very low gain,
    // with a slow LFO — a distant backdrop, never louder than the pad.
    const humSrc = this.ctx.createBufferSource();
    humSrc.buffer = this.noiseBuffer;
    humSrc.loop = true;
    const humFilter = this.ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 500;
    humFilter.Q.value = 0.4;
    const humGain = this.ctx.createGain();
    humGain.gain.value = 0.06;
    humSrc.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(this.bedGain);
    humSrc.start(now + 0.05);
    const humLfo = this.ctx.createOscillator();
    humLfo.type = 'sine';
    humLfo.frequency.value = 0.08;
    const humLfoGain = this.ctx.createGain();
    humLfoGain.gain.value = 0.02;
    humLfo.connect(humLfoGain);
    humLfoGain.connect(humGain.gain);
    humLfo.start(now + 0.05);
    this._bedNodes = {
      padFilter, padGain, padOscs, humSrc, humFilter, humGain, humLfo, humLfoGain,
    };
    this.bedOn = true;
    this._scheduleChord(token);
    this._startPulse(token);
    return true;
  }

  // Light pulse: one short soft sine blip per beat at bedBpm. Gain is
  // low on purpose — a gentle forward motion under the pad, not a
  // drum kit. The timer restarts whenever the bed restarts.
  _startPulse(token) {
    if (this._pulseTimerId !== null) {
      clearInterval(this._pulseTimerId);
      this._pulseTimerId = null;
    }
    const bpm = (typeof this._cfg.bedBpm === 'number' && this._cfg.bedBpm > 0)
      ? this._cfg.bedBpm
      : 96;
    const intervalMs = (60 / bpm) * 1000;
    this._pulseTimerId = setInterval(() => {
      if (token !== this._bedToken || !this.bedOn || !this._bedNodes || !this.ctx) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 196;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        osc.connect(g);
        g.connect(this.bedGain);
        osc.start(t + 0.01);
        osc.stop(t + 0.25);
        osc.onended = () => {
          try { osc.disconnect(); } catch (err) { /* ignored */ }
          try { g.disconnect(); } catch (err) { /* ignored */ }
        };
      } catch (err) {
        // One missed blip never stops the bed.
      }
    }, intervalMs);
  }

  _scheduleChord(token) {
    if (this._chordTimerId !== null) {
      clearInterval(this._chordTimerId);
      this._chordTimerId = null;
    }
    const seconds = (typeof this._cfg.bedChordSeconds === 'number' && this._cfg.bedChordSeconds > 0)
      ? this._cfg.bedChordSeconds
      : 8;
    this._chordTimerId = setInterval(() => {
      if (token !== this._bedToken || !this.bedOn || !this._bedNodes || !this.ctx) return;
      this._changeChord(token);
    }, seconds * 1000);
  }

  _changeChord(token) {
    const nodes = this._bedNodes;
    if (!nodes || !this.ctx) return;
    const now = this.ctx.currentTime;
    // Fade the pad down, swap notes in the middle, fade back up — no click.
    try {
      nodes.padGain.gain.cancelScheduledValues(now);
      nodes.padGain.gain.setValueAtTime(Math.max(nodes.padGain.gain.value, 0.0001), now);
      nodes.padGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2);
    } catch (err) {
      // Gain already stopped — ignored.
    }
    if (this._chordTimeoutId !== null) {
      clearTimeout(this._chordTimeoutId);
      this._chordTimeoutId = null;
    }
    this._chordTimeoutId = setTimeout(() => {
      this._chordTimeoutId = null;
      if (token !== this._bedToken || !this.bedOn || !this._bedNodes || !this.ctx) return;
      this._chordIndex = (this._chordIndex + 1) % BED_CHORDS.length;
      const chord = BED_CHORDS[this._chordIndex];
      const t = this.ctx.currentTime;
      this._bedNodes.padOscs.forEach((osc, i) => {
        try {
          osc.frequency.setTargetAtTime(chord[i % chord.length], t, 0.4);
        } catch (err) {
          try {
            osc.frequency.value = chord[i % chord.length];
          } catch (err2) {
            // Ignored.
          }
        }
      });
      try {
        const g = this._bedNodes.padGain.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0.0001, t);
        g.exponentialRampToValueAtTime(0.3, t + 1.2);
      } catch (err) {
        // Ignored.
      }
    }, 1200);
  }

  stopBed() {
    this._bedToken += 1;
    this.bedOn = false;
    if (this._chordTimerId !== null) {
      clearInterval(this._chordTimerId);
      this._chordTimerId = null;
    }
    if (this._chordTimeoutId !== null) {
      clearTimeout(this._chordTimeoutId);
      this._chordTimeoutId = null;
    }
    if (this._pulseTimerId !== null) {
      clearInterval(this._pulseTimerId);
      this._pulseTimerId = null;
    }
    const nodes = this._bedNodes;
    this._bedNodes = null;
    if (!nodes) return false;
    const stoppers = [...nodes.padOscs, nodes.humSrc, nodes.humLfo];
    for (const node of stoppers) {
      try {
        node.stop();
      } catch (err) {
        // Already stopped — ignored.
      }
      try {
        node.disconnect();
      } catch (err) {
        // Ignored.
      }
    }
    for (const node of [nodes.padFilter, nodes.padGain, nodes.humFilter, nodes.humGain, nodes.humLfoGain]) {
      try {
        node.disconnect();
      } catch (err) {
        // Ignored.
      }
    }
    return true;
  }

  // ---- Duck while TTS speaks: tracks + bed drop, then come back ----

  setDucked(on) {
    this._ducked = on === true;
    if (this.ctx) this._applyGains();
    return this._ducked;
  }

  // Alias kept for callers written against the older ducking name.
  duckForSpeech(on) {
    return this.setDucked(on);
  }
}
