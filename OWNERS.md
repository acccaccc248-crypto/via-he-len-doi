# OWNERS.md — Ai phụ trách phần nào (Vỉa Hè Lên Đời)

Mỗi phần một owner, sau này gặp lỗi fix cho lẹ. Quy tắc chung cho
mọi owner: chỉ sửa file của phần mình; không chạm điện thoại/live;
trước khi push phải `git pull --rebase`, chạy `npm run check` +
kiểm chứng của phần mình; đụng độ file với owner khác thì DỪNG và
báo về điều phối viên, không tự merge đè. CẤM `git add -A` — chỉ
add file đích danh sau khi xem `git status`.

| Phần | Owner | File | Kiểm chứng |
|---|---|---|---|
| Vỏ trang + nhạc + demo | agent-shell | `index.html`, `css/style.css`, `js/main.js`, `js/audio.js`, `js/demo.js`, `audio/tracks.json`, `audio/MUSIC.md`, `audio/*.mp3`, `package.json`, `README.md`, `OWNERS.md`, `.gitignore` | `node --check` từng file JS của phần mình, grep sạch chuỗi cấm trong UI, tổng audio ≤ 15 MB |
| Cấu hình | agent-config | `config.js` | `node --check config.js`, khớp tên khóa với hợp đồng dưới đây |
| Cảnh | agent-scene | `js/scene.js` | `npm run check`, chụp màn hình build |
| Sự kiện + relay | agent-relay | `js/events.js`, `js/relay.js` | `npm run check`, nối relay thật |
| Logic game | agent-game | `js/game.js`, `js/handlers.js`, `js/filter.js` | `npm run check`, bấm demo `?demo=1` |
| Lịch | agent-schedule | `js/schedule.js` | `npm run check`, đếm ngược + nghi thức đúng giờ |
| Giọng đọc | agent-tts | `js/tts.js` | `npm run check`, thử giọng Việt trên thiết bị thật |

Ghi chú hợp đồng (phần vỏ trang đã dựng theo đúng các tên này —
owner khác đổi tên thì báo agent-shell sửa `js/main.js` cùng lúc,
không để lệch):

- `config.js` export `CONFIG` với: `three.version` = `'0.160.0'`
  (khớp import map trong `index.html`); `renderer` (antialias,
  shadowsEnabled, pixelRatioCap, maxDeltaSeconds, clearColor);
  `camera` (fov, near, far, basePosition, lookAt); `music`
  (tracksManifestUrl, startOnUnlock, masterVolume, trackGain,
  bedVolume, duckLevel, bedChordSeconds, bedBpm); `labels`
  (3 dòng + explainShowSeconds + explainRepeatMinutes); `schedule`
  (timezone + rituals với key `open/vote1/rush/vote2/market/closing`);
  `hud.fpsUpdateIntervalMs`.
- `js/scene.js` export `createStreetScene()` trả về object có
  `.scene` (THREE.Scene) và `.update(dt, elapsed)`; hook cảnh do con
  game gọi qua object này, `js/main.js` KHÔNG gọi hook cảnh.
- `js/events.js` export `StreetEvents` với `.on(type, fn)` và
  `.emit(evt)`; định dạng event: `{type, user:{name,uniqueId,avatar},
  text, giftName, diamonds, count, ritual}`; `ritual` nhận key
  `open/vote1/rush/vote2/market/closing`.
- `js/game.js` là state engine (export `createGame()`), KHÔNG export
  `initGameHandlers`. `js/handlers.js` export
  `initGameHandlers({scene, audio, events, tts})` trả về object có
  `.onRitual(key, info)`; đây là nơi duy nhất gọi hook cảnh.
  `js/main.js` đọc động `./game.js` rồi `./handlers.js` và chỉ nhận
  module nào có đúng export `initGameHandlers` — owner game đổi tên
  file/export thì báo agent-shell để cập nhật đường đọc, không đổi
  tên lặng lẽ.
- `js/schedule.js` export `initSchedule({onRitual})`; `onRitual` là
  đường nghi thức duy nhất từ lịch. Không owner nào khác dựng timer
  nghi thức riêng. Lịch XÂY LẠI toàn bộ nội dung trong
  `#schedule-board` mỗi tick, vì vậy `#countdown` nằm NGOÀI
  `#schedule-board` trong `index.html` (lịch đọc riêng phần tử `#countdown`
  riêng sau khi xây lại board) — không đưa `#countdown` vào trong
  board.
- `js/relay.js` export `Relay` với `.connect({})`; trạng thái hiện ở
  `#relay-status`.
- `js/tts.js` export class `GameTTS` với `speakTemplate(key, vars)`,
  `speakComment(text)`, `unlock()`, `setDuckCallback(fn)`.
  `js/main.js` tạo MỘT instance `GameTTS` (nối duck vào
  `StreetAudio.setDucked`), mở khóa instance ở nút Bắt đầu / nút
  nhạc, rồi truyền instance đó vào handlers dưới tên `tts`. Owner
  giọng đọc giữ các hàm đọc câu cố định, không đọc chồng, không có
  giọng Việt thì im lặng nhưng vẫn cập nhật caption ở `#tts-caption`.
- `js/audio.js` export class `StreetAudio` (xem file): `unlock()`,
  `start()`, `toggle()`, `playing`, `playTrackIndex(i)`,
  `setDucked(on)` (+ alias cũ `playTrack` / `duckForSpeech`).
- Demo (`js/demo.js`, `?demo=1`) CẤM dùng khi live thật — chỉ xem
  trước / kiểm tra khi không phát sóng. Panel demo do `js/demo.js`
  tự tạo, không cần id demo trong `index.html`.
- Không hardcode API key trong bất kỳ file nào; key chỉ đi qua URL
  và localStorage của trình duyệt (xem `js/relay.js`).
- `package.json` liệt kê EXPLICIT từng file JS trong `scripts.check`;
  owner nào thêm file JS mới (ví dụ `js/filter.js`) thì báo
  agent-shell thêm tên file vào check script, không dùng glob.
- Chuỗi cấm trong mọi file UI/code/doc của repo: xem luật trong
  `README.md` — dòng nhãn 2 chỉ tồn tại trong `CONFIG.labels`,
  không viết lại ở file nào khác.
