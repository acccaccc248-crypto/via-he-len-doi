// config.js — DUY NHẤT nơi chứa mọi ngưỡng / số liệu của Vỉa hè lên đời.
// Mọi file js khác chỉ đọc CONFIG, không hardcode số. Sửa behaviour = sửa file này.
// Game giả tưởng trên phố đêm: tông xanh đêm + vàng ấm ở đèn, chuyển động
// chậm (≤ 0,05 m/s), không nhạc có bản quyền.
// Lưu ý: labels.line2 là nhãn an toàn bắt buộc theo brief gốc, ngoại lệ duy nhất
// trong repo này. Mọi chuỗi còn lại đều tránh các từ nhạy cảm theo brief.

export const CONFIG = {
  // Three.js ghim cố định — import map trong index.html phải khớp version này.
  three: {
    version: '0.160.0',
    cdnUrl: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  },

  renderer: {
    // Máy yếu (Redmi Note 9): KHÔNG antialias, KHÔNG shadow map.
    antialias: false,
    shadowsEnabled: false,
    pixelRatioCap: 1.25,
    clearColor: 0x0a1024, // đêm
    // Delta tối đa mỗi frame (giây) — tránh nhảy cóc khi tab bị nền / lag.
    maxDeltaSeconds: 0.05,
  },

  // Camera cho khung NGANG 16:9: nhìn từ trước, hơi cao, bao trọn phố đêm.
  camera: {
    fov: 55,
    near: 0.1,
    far: 60,
    basePosition: [0, 3.4, 11.5],
    lookAt: [0, 1.0, 0],
  },

  // Ánh sáng: ánh trăng mờ + điểm sáng ấm ở đèn phố. KHÔNG shadow.
  lights: {
    ambientColor: 0x2a3550,
    ambientIntensity: 0.5,
    moonColor: 0xbfd4ff,
    moonIntensity: 0.55,
    moonPosition: [-4.5, 6.5, -6],
    neonColor: 0xffb45e,
    neonIntensity: 10,
    neonDistance: 8,
    // pulseGlow: độ sáng toàn cảnh tăng thêm tỉ lệ này trong X giây.
    glowBoost: 1.1, // +10%
  },

  // Cảnh chung: MỌI chuyển động thường trực đều ≤ tốc độ này (m/giây).
  scene: {
    groundSize: [24, 14],
    groundPosition: [0, 0, -1],
    groundTopColor: '#141428',
    groundBottomColor: '#0a1024',
    maxSpeedMetersPerSecond: 0.05,
  },

  // Vị trí các sạp dọc phố: 12 slot thẳng hàng trước mặt camera.
  stalls: {
    slotCount: 12,
    slotStartX: -7.5,
    slotSpacing: 1.35,
    slotZ: 2.6,
  },

  // 6 bậc lên đời: bậc sau đắt hơn bậc trước, mua bằng xu ảo trong phiên.
  tiers: [
    { key: 'sidewalk', label: 'Vỉa hè', cost: 0 },
    { key: 'vendor', label: 'Hàng rong', cost: 50 },
    { key: 'stall', label: 'Sạp nhỏ', cost: 150 },
    { key: 'cart', label: 'Xe đẩy', cost: 400 },
    { key: 'shop', label: 'Quán cóc', cost: 1000 },
    { key: 'store', label: 'Cửa tiệm', cost: 2500 },
  ],

  // Kinh tế xu ảo trong phiên: chỉ chạy bằng hành động miễn phí, xu về 0
  // khi hết phiên, không đổi ra tiền, không có giá trị thật.
  economy: {
    joinBonus: 5,
    chatCoin: 1,
    chatCooldownSeconds: 10,
    sellCoin: 5,
    sellCooldownSeconds: 30,
    likeStep: 10,
    likeCoin: 2,
    likeMaxMilestonesPer30Min: 5,
    rushMultiplier: 2,
    rushSeconds: 600,
    voteCoin: 10,
    voteWindowMinutes: 5,
    voteTimes: ['20:00', '21:00'],
    voteDishes: [
      { label: 'Trà đá' },
      { label: 'Bánh mì' },
    ],
  },

  // Ngưỡng hiệu ứng lớn theo kim cương của một món quà tặng trong live.
  gifts: {
    bigThresholdDiamonds: 10,
  },

  // Chữ hiển thị thường trực + dòng giải thích lặp lại trong phiên.
  labels: {
    title: 'VỈA HÈ LÊN ĐỜI',
    line1: '🎮 GAME HƯ CẤU — XU ẢO, KHÔNG CÓ GIÁ TRỊ THẬT',
    line2: 'KHÔNG XIN TIỀN THẬT — KHÔNG ĐỔI XU RA TIỀN',
    line3: 'Nhân vật là hư cấu. Không ai ở đây cần hỗ trợ thật.',
    explainRepeatMinutes: 15,
    explainShowSeconds: 30,
  },

  // Lịch phố đêm: giờ theo Asia/Ho_Chi_Minh. Nghi thức chạy theo giờ;
  // hook là tên hàm cảnh trong CONFIG.game.sceneHooks (null = không hook).
  schedule: {
    timezone: 'Asia/Ho_Chi_Minh',
    rituals: [
      {
        key: 'open',
        time: '19:30',
        label: 'KHAI TRƯƠNG',
        line: 'Phố đêm mở hàng — đây là game hư cấu, xu ảo không có giá trị thật.',
        hook: 'openRitual',
      },
      {
        key: 'vote1',
        time: '20:00',
        label: 'BÌNH CHỌN 1',
        line: 'Bình chọn món bán chạy: bình luận 1 hoặc 2.',
        hook: 'openVote',
      },
      {
        key: 'rush',
        time: '20:30',
        label: 'GIỜ CAO ĐIỂM X2',
        line: 'Giờ cao điểm: mốc thả tim cho xu gấp đôi trong 10 phút.',
        hook: 'startRush',
      },
      {
        key: 'vote2',
        time: '21:00',
        label: 'BÌNH CHỌN 2',
        line: 'Bình chọn lần 2: bình luận 1 hoặc 2.',
        hook: 'openVote',
      },
      {
        key: 'market',
        time: '21:30',
        label: 'CHỢ ĐÊM',
        line: 'Chợ đêm: tất cả sạp sáng đèn.',
        hook: 'nightMarket',
      },
      {
        key: 'closing',
        time: '21:45',
        label: 'KẾT MÀN',
        line: 'Đóng bán — công bố top 5 phiên.',
        hook: 'closingRitual',
      },
      {
        key: 'end',
        time: '22:00',
        label: 'HẾT GIỜ',
        line: 'Hết giờ — hẹn tối mai mở hàng lại từ đầu.',
        hook: null,
      },
    ],
  },

  // Tên hook cảnh do phần cảnh cung cấp; code gọi hook LUÔN kiểm tra
  // tồn tại trước nên hook chưa có thì trang vẫn chạy, không crash.
  // Tên hook ở đây là nguồn duy nhất — đừng hardcode tên hook ở file khác.
  game: {
    sceneHooks: {
      addPlayer: 'addPlayer',
      setTier: 'setPlayerTier',
      coinBurst: 'coinBurstFor',
      glow: 'pulseGlow',
      nightMarket: 'setNightMarket',
      welcome: 'showWelcomeName',
      voteResult: 'showVoteResult',
      newTier: 'showNewTier',
      giftCelebrate: 'celebrateGift',
      ritualState: 'setRitualState',
      openRitual: 'playOpenRitual',
      closingRitual: 'playClosingRitual',
    },
  },

  // Giọng đọc máy (con sự kiện lo TTS thật; scene không phát tiếng).
  // Template CỐ ĐỊNH — chỉ đọc đúng các chuỗi dưới đây, không soạn lời mới.
  tts: {
    enabled: true,
    voiceLang: 'vi-VN',
    rate: 0.9,
    commentMinIntervalSeconds: 120,
    followMinIntervalSeconds: 20,
    templates: {
      greeting: 'Chào bạn, phố đêm mở hàng. Đây là game hư cấu, xu ảo không có giá trị thật.',
      closing: 'Cảm ơn {count} bạn đã ghé phố tối nay. Xu ảo về 0, hẹn tối mai mở hàng lại từ đầu.',
      tierUp: '{name} vừa lên đời, bậc {tier}.',
      topPlayer: 'Đại gia phiên tối nay là {name}.',
      voteWin: 'Món thắng là {dish}.',
      follow: 'Chào bạn {name} vừa ghé phố.',
    },
  },

  // Relay sự kiện live (con sự kiện lo nối thật; không hardcode key ở đây).
  relay: {
    username: 'meta.muse.ai1',
    url: 'wss://ws.eulerstream.com',
  },

  // Nhạc: con nhạc lo engine + manifest; main.js chỉ đọc các cờ dưới đây.
  music: {
    startOnUnlock: true,
    masterVolume: 0.5,
    trackGain: 0.8,
    bedVolume: 0.25,
    tracksManifestUrl: './audio/tracks.json',
    tracks: [],
  },

  hud: {
    fpsUpdateIntervalMs: 500,
  },

  // Demo test-only. Mặc định TẮT; chỉ bật khi URL có ?demo=1.
  // CẤM dùng khi live thật (không giả lập người xem).
  demo: {},
};
