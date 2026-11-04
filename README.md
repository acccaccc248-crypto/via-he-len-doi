# VỈA HÈ LÊN ĐỜI — Game giả tưởng trên TikTok LIVE

Phố đêm 3D, khung **ngang 16:9** cho live TikTok. Ai vào phòng cũng
thành một nhân vật trong thế giới ảo: bình luận để nhân vật di
chuyển, mở sạp, tích **xu ảo chỉ trong phiên**, lên bậc từ vỉa hè tới
cửa tiệm. Không có tiền thật trong game, không đổi xu ảo ra tiền.

Cơ chế (logic đầy đủ do con game lo, xem `js/game.js`):

- **Bình luận** → nhân vật phản ứng, tên hiện trên phố.
- **Bình luận `bán: …`** → mở sạp với món vừa nêu.
- **Bình luận `nâng cấp`** → lên bậc khi đủ xu ảo trong phiên.
- **Thả tim** → sáng phố theo mốc trong phiên.
- **Hiệu ứng 💎** (sự kiện `gift` trong event bus) → hiệu ứng trên
  phố, 1💎 và 15💎 khác nhau; hiệu ứng không tính điểm, không thưởng.
- **Follow** → chào tên bằng giọng đọc máy (câu cố định).
- **Bình chọn** → nhắn `1` hoặc `2` trong cửa sổ bình chọn.
- **Bảng top phiên** → top 5 trong phiên đang chạy; hết phiên là hết,
  không nhớ qua đêm (relay phi trạng thái).
- **Giọng đọc máy** (tiếng Việt, `speechSynthesis`): chỉ đọc câu cố
  định, chữ do chủ phòng duyệt trước khi live. Không có giọng Việt
  thì trang chạy chỉ bằng chữ.

Nhãn thường trực trên màn hình gồm 3 dòng, nội dung lấy từ
`CONFIG.labels` trong `config.js` (dòng 2 là nhãn an toàn bắt buộc,
không viết lại nội dung của nó ở đây hay trong HTML — `js/main.js`
đồng bộ từ CONFIG). Dòng 3 hiện ngay khi mở trang 30 giây rồi ẩn,
lặp lại mỗi `CONFIG.labels.explainRepeatMinutes` phút.

Giờ giấc, nghi thức và ngưỡng nằm trong `config.js`
(`CONFIG.schedule`, `CONFIG.game`…): các mốc nghi thức là
`open`, `vote1`, `rush`, `vote2`, `market`, `closing`. Khung giờ
thiết kế theo bản khảo sát là buổi tối; giờ chính xác do config
quy định — README này không ghi giờ riêng để khỏi lệch với config.
Mở trang sau một mốc thì trạng thái cuối của mốc đó được đặt ngay,
không chạy lại nghi thức (con lịch + con game lo, qua đúng một đường:
schedule/demo → `handlers.onRitual` → cảnh).

Trang tĩnh, không cần server riêng lúc live: trình duyệt nối thẳng
tới relay qua WebSocket (xem `js/relay.js`, con relay lo nối thật).
Không có key relay thì cảnh và nhạc vẫn chạy, relay báo chưa kết nối.

## Chạy local

Bất kỳ static server nào cũng được, ví dụ từ thư mục này:

```sh
python3 -m http.server 8000
```

Mở `http://localhost:8000/` (bấm **Bắt đầu** để bật nhạc — trình
duyệt cần 1 chạm mới cho phát tiếng; nút Bắt đầu đồng thời mở toàn
màn hình). Thêm `?fps=1` để hiện bộ đếm FPS.

Kiểm tra cú pháp toàn bộ JavaScript (danh sách file khớp đúng repo
cuối cùng, xem `package.json`):

```sh
npm run check
```

## Chế độ demo — CHỈ KHI KHÔNG LIVE

Mở trang với `?demo=1` để hiện panel nút thử: người mới vào, bình
luận, bán trà đá, nâng cấp, tim ×10 / ×100, hiệu ứng A (1💎) / hiệu
ứng B (15💎), follow mới, bình chọn 1 / 2, và 6 nghi thức
(mở phiên, bình chọn đợt 1, giờ cao điểm, bình chọn đợt 2, chợ đêm,
kết phiên). Các nút chỉ emit event giả qua event bus nội bộ để xem
trước hiệu ứng; nút nghi thức emit event `ritual` để con game chạy
đúng đường `handlers.onRitual` như lịch thật.

> ⚠️ **CẤM dùng `?demo=1` khi đang phát sóng.** Giả lập người xem khi
> live là gian lận tương tác, vi phạm chính sách TikTok. Khi live
> thật, relay thật là nguồn sự kiện duy nhất. Xem ghi chú đầu
> `js/demo.js`.

## Nhạc

Engine nhạc và danh sách track nằm trong `js/audio.js` và
`audio/tracks.json`; bằng chứng giấy phép và cách nén file xem
[`audio/MUSIC.md`](audio/MUSIC.md). Nhạc gồm track Mixkit Free
License (funk tươi, không lời) phát tuần tự + synth bed tự tổng hợp
(pad sáng + nhịp nhẹ + tiếng phố rất nhỏ) chạy dưới track. Nếu
manifest rỗng hoặc tải lỗi, chỉ synth bed chạy. Không nhạc có bản
quyền, không YouTube rip. Chưa nghe thật toàn bộ từng track trên
trình duyệt — xem nợ trong `audio/MUSIC.md`.

## Luật cứng của game

- **Game giả tưởng, xu ảo:** mọi con số chỉ tồn tại trong phiên,
  không đổi ra tiền, không nhớ qua đêm.
- **Không giả lập người xem** khi live (không `?demo=1`, không seed
  event giả dưới mọi hình thức).
- **Không tôn giáo:** không khung cảnh, nghi thức hay lời lẽ tôn giáo.
- **Không nhắm vào trẻ em:** game dành cho đối tượng chung, thân
  thiện gia đình; không thiết kế vòng lặp câu kéo trẻ em, không đọc
  tên/bình luận của trẻ em lên sóng.
- **Không nhạc có bản quyền** trên live; chỉ track trong `audio/` và
  synth bed tự tổng hợp.
- **Nhãn 3 dòng luôn hiện đúng nội dung CONFIG.labels** (dòng 1+2
  thường trực, dòng 3 lặp theo nhịp config). Không sửa chữ nhãn trong
  HTML.
- **Một đường nghi thức duy nhất:** schedule/demo →
  `handlers.onRitual` → cảnh. Không adapter dự phòng nào trong
  `js/main.js` được gọi hook cảnh trực tiếp.

## Cấu trúc

| File | Vai trò |
|---|---|
| `index.html`, `css/style.css` | Khung trang, HUD, nhãn, bảng lịch / top phiên |
| `js/main.js` | Dựng renderer/camera, đồng bộ nhãn, nút Bắt đầu / nhạc / FPS, vòng lặp; nối handlers + lịch + relay + demo |
| `js/audio.js`, `audio/` | Engine nhạc (`StreetAudio`) + track |
| `js/demo.js` | Demo test-only (`?demo=1`) |
| `config.js` | Mọi ngưỡng / số liệu, duy nhất một nơi (con config lo) |
| `js/scene.js` | Cảnh phố đêm 3D (con cảnh lo) |
| `js/events.js` | Event bus nội bộ `StreetEvents` (con sự kiện lo) |
| `js/game.js` | Sự kiện → hiệu ứng, xu ảo, bảng top, bình chọn (con game lo) |
| `js/schedule.js` | Lịch + đếm ngược, gọi `onRitual` đúng mốc (con lịch lo) |
| `js/relay.js` | Nối relay sự kiện live (con relay lo) |
| `js/tts.js` | Giọng đọc máy tiếng Việt (con giọng đọc lo) |

Phân công theo phần: xem [`OWNERS.md`](OWNERS.md). Deploy (hosting
tĩnh + URL công khai) do điều phối viên lo sau khi tích hợp — repo
này chưa gắn URL nào.
