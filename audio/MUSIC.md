# Nhạc Vỉa Hè Lên Đời — bằng chứng giấy phép

Mọi track dưới đây đều là **Mixkit Stock Music Free License**, tải
trực tiếp từ CDN chính thức của Mixkit. Không dùng nhạc có bản
quyền, không YouTube rip, không nhạc VPop/cover, không Chillhop
Music. Ngày kiểm chứng: **04/11/2026**.

Trang giấy phép chính thức (đã đọc trực tiếp ngày 04/11/2026):
https://mixkit.co/license/ — bản đầy đủ điều khoản nhạc:
https://mixkit.co/license/modal/musicFree/ (nội dung modal đã đọc
trực tiếp, xem phần tóm tắt bên dưới). Trang danh mục Funk:
https://mixkit.co/free-stock-music/funk/ — HTTP 200 ngày 04/11/2026.

## Track

| Track | Tác giả | Mixkit id | Dài (trang Mixkit) | Dài ffprobe (gốc tải về) | Dài sau encode | Dung lượng sau encode |
|---|---|---|---|---|---|---|
| Midnight Funk | Michael Ramir C. | 1147 | 1:47 | 106,99 s ✓ | 106,99 s ✓ | 1.712.893 byte |
| Evolution | Michael Ramir C. | 1027 | 1:55 | 115,20 s ✓ | 115,20 s ✓ | 1.844.128 byte |
| Keep the Funk ON | Michael Ramir C. | 1003 | 2:31 | 150,93 s ✓ | 150,93 s ✓ | 2.415.904 byte |
| Blue Funk | Michael Ramir C. | 1054 | 2:23 | 142,66 s ✓ | 142,66 s ✓ | 2.283.822 byte |
| Simon Says | Michael Ramir C. | 1042 | 2:27 | 147,11 s ✓ | 147,11 s ✓ | 2.354.876 byte |
| Adone | Eugenio Mininni | 635 | 3:02 | 182,15 s ✓ | 182,15 s ✓ | 2.915.353 byte |
| **Tổng** | | | **14:05** | **845,04 s** | **845,04 s** | **13.526.976 byte (12,90 MiB) — dưới trần 15 MB** |

Thể loại ghi trong dữ liệu liệt kê của Mixkit: Funk cho 5 track;
Midnight Funk ghi genre Pop nhưng vẫn nằm trong trang danh mục Funk
(trang liệt kê 31 track Funk). Dòng tag thu được cho Midnight Funk:
"Funk Motivating Positive Bass Drums". Với 5 track còn lại, dữ liệu
liệt kê thu được chỉ có genre, tác giả, thời lượng và giấy phép,
không có dòng tag đầy đủ — vì vậy tính chất không lời chưa được xác
nhận bằng nghe thật; nợ nghe thử trước live đầu tiên (xem mục ghi
chú). Cả 6 track đều tươi, nhịp rõ, hợp không khí game phố đêm; không
track nào là piano solo chậm kiểu phòng trà.

Trang danh mục Mixkit nơi cả 6 track được liệt kê (cùng `url` trong
`tracks.json`):

- **Cả 6 track** — https://mixkit.co/free-stock-music/funk/

Giấy phép từng track: Mixkit Free License
(https://mixkit.co/license/) — kiểm chứng 04/11/2026. Dữ liệu liệt
kê của trang danh mục ghi rõ cho từng track:
`copyrightNotice: "Mixkit Stock Music Free License"` và
`license: "https://mixkit.co/license/#musicFree"`.

## Cách kiểm chứng danh tính từng file (không đoán)

Nguồn tải: `https://assets.mixkit.co/music/<id>/<id>.mp3` — mẫu URL
đã được xác nhận từ dữ liệu liệt kê JSON-LD của chính trang danh mục
Funk (mỗi track là một `MusicRecording` với `name`, `byArtist`,
`duration`, `url`, `license`, `copyrightNotice`). Mỗi track được
nhận khi đủ **hai neo độc lập**:

1. **Chuỗi id trong dữ liệu liệt kê:** URL CDN của từng track nằm
   ngay trong bản ghi `MusicRecording` mang đúng tên + tác giả của
   track đó trên trang danh mục Funk.
2. **Thời lượng ffprobe khớp thời lượng trang Mixkit trong 1 giây:**
   lệch lớn nhất là 0,34 s (Blue Funk: 142,66 s so với 143 s);
   cả 6 đều khớp (bảng trên).

File gốc không mang tag title/artist (chỉ có tag encoder ở một số
file) nên thời lượng + bản ghi liệt kê là bằng chứng danh tính — đã
nêu rõ ở đây thay vì giả vờ có bằng chứng khác.

## Nén lại để vừa trần 15 MB (ffmpeg 8.1.2, giữ chất lượng nền)

File gốc Mixkit đều ~256 kbps, tổng 6 track = 27.052.400 byte —
vượt trần. Đã encode lại toàn bộ bằng ffmpeg, **chỉ đổi bitrate,
không cắt, không chuẩn hóa, không đổi thời lượng**, và gắn tag
title/artist đúng tên track:

```sh
ffmpeg -i <goc>.mp3 -codec:a libmp3lame -b:a 128k -ar 44100 -ac 2 \
  -metadata title="<Tên>" -metadata artist="<Tác giả>" <file>.mp3
```

Sau encode, ffprobe từng file: thời lượng giữ nguyên tới 0,01 s,
bitrate ~128 kbps, 44.100 Hz stereo, giải mã toàn bộ không lỗi
(`ffmpeg -f null -` — cả 6 file đều "decode OK"). 128 kbps cho nhạc
nền funk qua loa điện thoại + nén của TikTok là đủ.

## BPM

`bpm: null` cho cả 6 track trong `tracks.json`. Không đo BPM trong
đợt này (máy không có công cụ đo BPM đáng tin; tag ID3 từng bị phát
hiện sai ở dự án khác nên không dùng tag). `js/audio.js` không đọc
BPM của track — nhịp nhẹ của synth bed lấy từ `CONFIG.music.bedBpm`
(tốc độ pulse, không phải BPM track). Không bịa số BPM.

## Tóm tắt điều khoản Mixkit Stock Music Free License (đã đọc 04/11/2026)

Theo trang https://mixkit.co/license/modal/musicFree/ (đọc trực tiếp):

- **Được phép:** dùng miễn phí cho dự án có doanh thu và dự án
  không có doanh thu; tải về, sao chép, sửa đổi, phân phối và biểu
  diễn công khai trên mọi nền tảng web/mạng xã hội, gồm dịch vụ
  video theo yêu cầu trên internet, podcast và quảng cáo. Trang liệt
  kê "Allowed": Podcasts, Social Media video posts, Online marketing
  ads, Educational Purposes, YouTube videos.
- **Không được phép:** dùng trong CD/DVD, video game, phát thanh/
  truyền hình; remix (hoặc đưa vào track chỉ có nhạc); nhận là của
  mình; đăng ký lên bất kỳ dịch vụ quản lý quyền nào (Content ID…).
  Có giới hạn khác trong User Terms của Mixkit.
- Nếu nhận khiếu nại bản quyền khi dùng đúng giấy phép: gửi chi tiết
  tới team@mixkit.co để được phía Mixkit xử lý.

**Ranh giới cần điều phối viên xác nhận trước live đầu tiên:** điều
khoản cấm dùng trong "video game". Dự án này dùng track CHỈ làm nhạc
nền cho buổi phát trực tiếp trên mạng xã hội (nhóm "Social Media
video posts" được phép), không phân phối track dưới dạng tài sản
game, không bán/phân phối lại file gốc, không remix, không đăng ký
quyền, không nhận là của mình. Nếu cách đọc này bị bác, phương án dự
phòng đã có sẵn: `js/audio.js` chạy synth-bed-only khi manifest rỗng
— chỉ cần rút track khỏi `tracks.json` là nhạc nền vẫn chạy bằng
synth tự tổng hợp, rủi ro bản quyền bằng 0.

## Ghi chú trung thực / giới hạn kiểm chứng

1. **Chưa nghe thật toàn bộ từng track.** Kiểm chứng là siêu dữ liệu
   + thời lượng + bản ghi liệt kê; không phát hiện được lỗi nội dung
   (ví dụ file bị câm một đoạn, hoặc có giọng hát). Nên nghe thử 30
   giây đầu mỗi track trên trang Mixkit trước buổi live đầu tiên nếu
   có điều kiện, và xác nhận tính chất không lời lúc đó.
2. **5/6 track cùng một tác giả** (Michael Ramir C.), cùng thể loại
   Funk — độ đa dạng tác giả thấp, chấp nhận vì cả 6 đều kiểm chứng
   chắc; track thứ 6 (Adone, Eugenio Mininni) là track dài nhất và
   khác tác giả. Nếu đợt sau tìm thêm được track tươi kiểm chứng
   chắc của tác giả khác, thay 1–2 track vẫn vừa trần dung lượng
   (dư ~1,47 MB).
3. **URL trang track riêng lẻ:** Mixkit không lộ link tới trang
   riêng từng track (trang danh mục chỉ lộ link CDN qua dữ liệu
   liệt kê); `url` trong `tracks.json` là trang danh mục Mixkit nơi
   track được liệt kê, kèm `mixkitId` để đối chiếu. Không bịa URL
   trang riêng. Khi khiếu nại với TikTok, dùng kết hợp: tên track +
   tác giả + trang danh mục + trang giấy phép + file này.
4. **File gốc không giữ trong repo** (chỉ còn bản sao tạm ở /tmp,
   tải lại được từ đúng chuỗi id CDN trong bảng trên).
5. Synth bed trong `js/audio.js` (pad sáng + nhịp nhẹ + tiếng phố
   rất nhỏ, tự tổng hợp bằng WebAudio, không dùng sample ghi âm) có
   rủi ro bản quyền bằng 0 và chạy độc lập khi không có track nào;
   API phát nhạc/ducking cho giọng đọc giữ nguyên. Lớp tiếng phố
   nối vào bedGain nên ducking và setVolume áp dụng như bed; gain
   chỉ 0,06, không át track hay giọng đọc.
