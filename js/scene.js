// scene.js — cảnh PHỐ ĐÊM cho game "VỈA HÈ LÊN ĐỜI".
// Khung NGANG 16:9, tông đèn neon ấm + xanh đêm. Mọi chuyển động
// thường trực đều chậm (xem CONFIG.scene.maxSpeedMetersPerSecond),
// chỉ xu bay và pháo giấy là nhanh hơn. KHÔNG shadow map.
// Nhãn chữ chỉ dùng sprite 3D, không chạm tới giao diện trang.
// Canvas chỉ dùng để vẽ texture (mặt đất, mặt cười, bảng hiệu),
// không đọc hay sửa bất kỳ phần tử trang nào khác.

import * as THREE from 'three';
import { CONFIG } from '../config.js';

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clampInt(v, lo, hi) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

// Số giả ngẫu nhiên ổn định (mulberry32) để sao và người qua đường
// không nhảy vị trí mỗi lần tải lại trang.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

function toTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---- Atlas texture dùng chung cho mọi nhân vật ----
// Một canvas duy nhất chứa 3 vùng:
//  - vùng mặt (toàn bộ chiều ngang, dải v 0,10..0,70 sau khi nén):
//    nền trắng + mắt + miệng cười, vẽ ở quanh u = 0,25 (mặt trước
//    của hình cầu, hướng +Z về phía camera).
//  - dải chữ ở đỉnh canvas (v 0,78..0,95): nền bìa carton + dòng
//    chữ của bảng carton bậc 0.
//  - dải trắng ở đáy canvas: điểm trắng cho các mảnh dùng màu đỉnh.
// Mảnh "đầu" giữ nguyên u, nén v vào dải mặt. Mảnh "bảng" ánh xạ
// UV vào dải chữ. Mọi mảnh còn lại lấy điểm trắng, màu đỉnh quyết
// định màu hiện lên. Nhờ vậy mỗi nhân vật chỉ cần ĐÚNG 1 mesh.
function makeFaceAtlasTexture() {
  const W = 1024;
  const H = 512;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  // Dải chữ bìa carton ở đỉnh canvas.
  ctx.fillStyle = '#d9b36a';
  ctx.fillRect(0, 24, W, 90);
  ctx.strokeStyle = '#8a6a34';
  ctx.lineWidth = 4;
  ctx.strokeRect(6, 28, W - 12, 82);
  ctx.fillStyle = '#3a2410';
  ctx.font = '600 54px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BÁN HÀNG RONG', W / 2, 70);
  // Mặt cười: mắt + miệng, tâm ở u = 0,25 (x = 256).
  // Sau khi nén v (0,10 + v*0,60), tâm mặt ở canvas y ~ 0,60H,
  // mắt ở trên, miệng ở dưới, đúng chiều nhìn từ camera.
  const cx = W * 0.25;
  const eyeY = H * 0.55;
  const mouthY = H * 0.60;
  ctx.fillStyle = '#22242e';
  ctx.beginPath();
  ctx.ellipse(cx - 62, eyeY, 15, 21, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + 62, eyeY, 15, 21, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#22242e';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, mouthY - 18, 50, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  // Lông mày ngắn, cong nhẹ.
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(cx - 84, eyeY - 44);
  ctx.quadraticCurveTo(cx - 62, eyeY - 54, cx - 40, eyeY - 44);
  ctx.moveTo(cx + 40, eyeY - 44);
  ctx.quadraticCurveTo(cx + 62, eyeY - 54, cx + 84, eyeY - 44);
  ctx.stroke();
  return toTexture(canvas);
}

// Gộp nhiều hình khối thành MỘT geometry duy nhất, tô màu theo đỉnh.
// Mỗi mảnh: { geometry, x,y,z, rx,ry,rz, sx,sy,sz, color, uv }
// uv: 'head' (giữ u, nén v vào dải mặt), 'sign' (ánh xạ vào dải
// chữ), 'white' (điểm trắng, màu đỉnh quyết định).
function mergeParts(parts) {
  const prepared = [];
  let vertexCount = 0;
  let indexCount = 0;
  for (const p of parts) {
    const geo = p.geometry.clone();
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0),
      ),
      new THREE.Vector3(p.sx == null ? 1 : p.sx, p.sy == null ? 1 : p.sy, p.sz == null ? 1 : p.sz),
    );
    geo.applyMatrix4(matrix);
    prepared.push({ geo, color: new THREE.Color(p.color), uvMode: p.uvMode || 'white' });
    vertexCount += geo.attributes.position.count;
    indexCount += geo.index ? geo.index.count : geo.attributes.position.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const colors = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  let vBase = 0;
  let iBase = 0;
  for (const { geo, color, uvMode } of prepared) {
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const uv = geo.attributes.uv;
    positions.set(pos.array, vBase * 3);
    normals.set(nor.array, vBase * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const u = uv ? uv.getX(i) : 0;
      const v = uv ? uv.getY(i) : 0;
      if (uvMode === 'head') {
        uvs[(vBase + i) * 2] = u;
        uvs[(vBase + i) * 2 + 1] = 0.10 + v * 0.60;
      } else if (uvMode === 'sign') {
        uvs[(vBase + i) * 2] = 0.05 + u * 0.90;
        uvs[(vBase + i) * 2 + 1] = 0.78 + v * 0.17;
      } else {
        uvs[(vBase + i) * 2] = 0.5;
        uvs[(vBase + i) * 2 + 1] = 0.03;
      }
      colors[(vBase + i) * 3] = color.r;
      colors[(vBase + i) * 3 + 1] = color.g;
      colors[(vBase + i) * 3 + 2] = color.b;
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i += 1) {
        indices[iBase + i] = geo.index.getX(i) + vBase;
      }
      iBase += geo.index.count;
    } else {
      for (let i = 0; i < pos.count; i += 1) {
        indices[iBase + i] = vBase + i;
      }
      iBase += pos.count;
    }
    vBase += pos.count;
    geo.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

// Vẽ chữ xuống tối đa 2 dòng, vừa khung.
function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
  return lines.length;
}

function makeLabelTexture(text) {
  const W = 512;
  const H = 128;
  const { canvas, ctx } = makeCanvas(W, H);
  ctx.fillStyle = 'rgba(8, 12, 30, 0.66)';
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(8, 18, W - 16, H - 36, 26);
    ctx.fill();
  } else {
    ctx.fillRect(8, 18, W - 16, H - 36);
  }
  ctx.strokeStyle = 'rgba(255, 201, 120, 0.6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#ffedd0';
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  drawWrappedText(ctx, text, W / 2, H / 2, W - 48, 40, 2);
  return toTexture(canvas);
}

function makeMoonTexture(size) {
  const { canvas, ctx } = makeCanvas(size, size);
  const c = size / 2;
  const halo = ctx.createRadialGradient(c, c, size * 0.08, c, c, c);
  halo.addColorStop(0, 'rgba(230, 240, 255, 0.85)');
  halo.addColorStop(0.35, 'rgba(200, 220, 255, 0.35)');
  halo.addColorStop(1, 'rgba(200, 220, 255, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, size, size);
  const disc = ctx.createRadialGradient(c - size * 0.06, c - size * 0.06, size * 0.05, c, c, size * 0.24);
  disc.addColorStop(0, '#ffffff');
  disc.addColorStop(1, '#d9e4f5');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(170, 185, 210, 0.35)';
  ctx.beginPath();
  ctx.arc(c - size * 0.06, c + size * 0.03, size * 0.045, 0, Math.PI * 2);
  ctx.arc(c + size * 0.07, c - size * 0.05, size * 0.035, 0, Math.PI * 2);
  ctx.fill();
  return toTexture(canvas);
}

// ---- Số liệu riêng của cảnh (không thuộc CONFIG) ----
const LOCAL = {
  moon: { position: [-7.8, 6.4, -9.5], scale: 2.6, canvasSize: 256 },
  stars: { count: 140, areaX: 11, minY: 2.5, maxY: 8.5, z: -8.5, zVariation: 1.5, size: 0.035, seed: 20261104 },
  walkers: { count: 10, lanes: [0.15, 1.65], seed: 77 },
  coins: { max: 120, lifeSeconds: 1.4, riseSpeed: 0.9 },
  confetti: { max: 240, small: 120, lifeSeconds: 2.6, bigLifeSeconds: 3.2 },
  board: { position: [5.0, 1.45, -3.6], size: [5.4, 2.7, 0.16], dim: 0.35, bright: 1.0 },
  host: { position: [0.2, 0, 0.9] },
  label: { position: [0, 3.6, 1.8], scale: [3.4, 0.85, 1] },
  // Màu áo sặc sỡ theo bậc, từ bậc thấp tới bậc cao.
  tierOutfits: ['#19c2b8', '#ff9f1c', '#ff5d8f', '#7c5cff', '#22b573', '#ffb400'],
  tierHats: ['#ffd166', '#e94f64', '#2ec4b6', '#ffd166', '#ff5d8f', '#7c5cff'],
  skin: 0xf2c79b,
  hair: 0x2a1c14,
  dark: 0x2b2b3a,
};

// Đạo cụ + thân hình của một nhân vật ở bậc tier, gộp thành 1 mesh.
// Nhân vật tươi tắn, khỏe khoắn, không rách rưới, không gầy gò.
function buildChibiGeometry(tier) {
  const outfit = LOCAL.tierOutfits[tier] || LOCAL.tierOutfits[0];
  const hat = LOCAL.tierHats[tier] || LOCAL.tierHats[0];
  const parts = [
    // Chân.
    { geometry: new THREE.CylinderGeometry(0.07, 0.08, 0.22, 8), x: -0.10, y: 0.11, color: LOCAL.dark },
    { geometry: new THREE.CylinderGeometry(0.07, 0.08, 0.22, 8), x: 0.10, y: 0.11, color: LOCAL.dark },
    // Thân áo.
    { geometry: new THREE.CylinderGeometry(0.23, 0.27, 0.55, 12), y: 0.50, color: outfit },
    // Tay.
    { geometry: new THREE.CylinderGeometry(0.06, 0.055, 0.34, 8), x: -0.30, y: 0.55, rz: 0.35, color: outfit },
    { geometry: new THREE.CylinderGeometry(0.06, 0.055, 0.34, 8), x: 0.30, y: 0.55, rz: -0.35, color: outfit },
    // Đầu + tóc + mũ.
    { geometry: new THREE.SphereGeometry(0.21, 16, 12), y: 1.02, color: LOCAL.skin, uvMode: 'head' },
    { geometry: new THREE.SphereGeometry(0.215, 16, 12), x: 0, y: 1.12, z: -0.03, sy: 0.62, color: LOCAL.hair },
    { geometry: new THREE.CylinderGeometry(0.30, 0.30, 0.045, 16), y: 1.22, color: hat },
    { geometry: new THREE.ConeGeometry(0.20, 0.22, 16), y: 1.34, color: hat },
  ];

  if (tier === 0) {
    // Chiếu + giỏ + bảng carton.
    parts.push(
      { geometry: new THREE.BoxGeometry(0.95, 0.035, 0.75), y: 0.018, z: 0.05, color: 0xd9b36a },
      { geometry: new THREE.BoxGeometry(0.26, 0.18, 0.26), x: -0.42, y: 0.13, z: 0.32, color: 0x8a5a3a },
      { geometry: new THREE.SphereGeometry(0.09, 10, 8), x: -0.42, y: 0.27, z: 0.32, color: 0xff5d8f },
      { geometry: new THREE.PlaneGeometry(0.58, 0.30), x: 0.44, y: 0.48, z: 0.34, ry: -0.30, color: 0xffffff, uvMode: 'sign' },
    );
  } else if (tier === 1) {
    // Ghế đẩu + đàn.
    parts.push(
      { geometry: new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12), x: -0.44, y: 0.30, z: 0.28, color: 0x7a4a2a },
      { geometry: new THREE.CylinderGeometry(0.035, 0.045, 0.28, 8), x: -0.44, y: 0.15, z: 0.28, color: 0x4a3018 },
      { geometry: new THREE.BoxGeometry(0.26, 0.34, 0.05), x: 0.40, y: 0.58, z: 0.30, rz: 0.5, color: 0xb3543f },
      { geometry: new THREE.BoxGeometry(0.06, 0.30, 0.04), x: 0.53, y: 0.82, z: 0.30, rz: 0.5, color: 0x2b1c12 },
    );
  } else if (tier === 2) {
    // Sạp mái che + khay hàng + đèn dây (đèn là chấm sáng trên mái).
    parts.push(
      { geometry: new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), x: -0.55, y: 0.85, z: 0.30, color: 0x4a3018 },
      { geometry: new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), x: 0.55, y: 0.85, z: 0.30, color: 0x4a3018 },
      { geometry: new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), x: -0.55, y: 0.85, z: -0.30, color: 0x4a3018 },
      { geometry: new THREE.CylinderGeometry(0.03, 0.03, 1.7, 6), x: 0.55, y: 0.85, z: -0.30, color: 0x4a3018 },
      { geometry: new THREE.BoxGeometry(1.25, 0.05, 0.75), y: 1.72, color: 0xe84855 },
      { geometry: new THREE.BoxGeometry(0.95, 0.07, 0.45), y: 0.72, z: 0.42, color: 0x7a4a2a },
      { geometry: new THREE.SphereGeometry(0.07, 10, 8), x: -0.28, y: 0.82, z: 0.42, color: 0xff5d5d },
      { geometry: new THREE.SphereGeometry(0.07, 10, 8), y: 0.82, z: 0.42, color: 0x7bc950 },
      { geometry: new THREE.SphereGeometry(0.07, 10, 8), x: 0.28, y: 0.82, z: 0.42, color: 0xff9f1c },
      { geometry: new THREE.SphereGeometry(0.045, 8, 6), x: -0.30, y: 1.58, z: 0.30, color: 0xffd166 },
      { geometry: new THREE.SphereGeometry(0.045, 8, 6), x: 0.30, y: 1.58, z: 0.30, color: 0xffd166 },
    );
  } else if (tier === 3) {
    // Xe đẩy có mái + ô dù + hơi nóng bốc lên.
    parts.push(
      { geometry: new THREE.BoxGeometry(0.95, 0.45, 0.50), y: 0.42, z: 0.55, color: 0x2e8b8b },
      { geometry: new THREE.CylinderGeometry(0.14, 0.14, 0.05, 12), x: -0.50, y: 0.14, z: 0.55, rz: Math.PI / 2, color: 0x22242e },
      { geometry: new THREE.CylinderGeometry(0.14, 0.14, 0.05, 12), x: 0.50, y: 0.14, z: 0.55, rz: Math.PI / 2, color: 0x22242e },
      { geometry: new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), x: -0.42, y: 1.05, z: 0.55, color: 0x4a3018 },
      { geometry: new THREE.CylinderGeometry(0.03, 0.03, 1.2, 6), x: 0.42, y: 1.05, z: 0.55, color: 0x4a3018 },
      { geometry: new THREE.BoxGeometry(1.05, 0.05, 0.60), y: 1.68, z: 0.55, color: 0xff5d8f },
      { geometry: new THREE.ConeGeometry(0.42, 0.25, 14), y: 1.95, z: 0.55, color: 0xffd166 },
      { geometry: new THREE.SphereGeometry(0.06, 8, 6), x: 0.20, y: 1.85, z: 0.50, color: 0xe8eef8 },
      { geometry: new THREE.SphereGeometry(0.05, 8, 6), x: -0.15, y: 1.98, z: 0.55, color: 0xe8eef8 },
    );
  } else if (tier === 4) {
    // Mặt tiền quán + bàn ghế + bảng hiệu sáng.
    parts.push(
      { geometry: new THREE.BoxGeometry(1.25, 1.30, 0.10), y: 0.85, z: -0.55, color: 0x3a4a6b },
      { geometry: new THREE.BoxGeometry(1.25, 0.05, 0.45), y: 1.55, z: -0.28, rx: 0.35, color: 0xe84855 },
      { geometry: new THREE.BoxGeometry(1.00, 0.26, 0.06), y: 1.85, z: -0.52, color: 0xffd166 },
      { geometry: new THREE.CylinderGeometry(0.22, 0.22, 0.05, 12), x: 0.35, y: 0.42, z: 0.35, color: 0x7a4a2a },
      { geometry: new THREE.CylinderGeometry(0.035, 0.035, 0.40, 6), x: 0.35, y: 0.21, z: 0.35, color: 0x4a3018 },
      { geometry: new THREE.CylinderGeometry(0.15, 0.15, 0.05, 10), x: -0.38, y: 0.30, z: 0.35, color: 0x8a5a3a },
      { geometry: new THREE.CylinderGeometry(0.035, 0.035, 0.28, 6), x: -0.38, y: 0.15, z: 0.35, color: 0x4a3018 },
    );
  } else {
    // Cửa tiệm 2 tầng + biển neon + cây cảnh.
    parts.push(
      { geometry: new THREE.BoxGeometry(1.25, 2.40, 0.50), y: 1.20, z: -0.75, color: 0xe8dcc0 },
      { geometry: new THREE.BoxGeometry(1.35, 0.08, 0.60), y: 2.45, z: -0.75, color: 0x8a4a3a },
      { geometry: new THREE.BoxGeometry(0.22, 0.28, 0.03), x: -0.32, y: 2.00, z: -0.48, color: 0xffe9a8 },
      { geometry: new THREE.BoxGeometry(0.22, 0.28, 0.03), x: 0.32, y: 2.00, z: -0.48, color: 0xffe9a8 },
      { geometry: new THREE.BoxGeometry(0.22, 0.28, 0.03), x: -0.32, y: 1.50, z: -0.48, color: 0xffe9a8 },
      { geometry: new THREE.BoxGeometry(0.22, 0.28, 0.03), x: 0.32, y: 1.50, z: -0.48, color: 0xffe9a8 },
      { geometry: new THREE.BoxGeometry(0.34, 0.60, 0.04), y: 0.30, z: -0.48, color: 0x6b3a1f },
      { geometry: new THREE.BoxGeometry(0.16, 0.70, 0.06), x: 0.55, y: 1.90, z: -0.45, color: 0xff5da2 },
      { geometry: new THREE.CylinderGeometry(0.11, 0.09, 0.22, 10), x: 0.50, y: 0.11, z: 0.25, color: 0x8a5a3a },
      { geometry: new THREE.SphereGeometry(0.16, 10, 8), x: 0.50, y: 0.38, z: 0.25, color: 0x3aa655 },
    );
  }
  return mergeParts(parts);
}

export function createStreetScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.scene.groundBottomColor);

  const slotCount = CONFIG.stalls.slotCount;
  const slotStartX = CONFIG.stalls.slotStartX;
  const slotSpacing = CONFIG.stalls.slotSpacing;
  const slotZ = CONFIG.stalls.slotZ;
  const tierCount = Array.isArray(CONFIG.tiers) ? CONFIG.tiers.length : 6;

  function slotX(index) {
    return slotStartX + index * slotSpacing;
  }

  // ---- Ánh sáng: trăng mờ + 2 điểm neon ấm, không shadow ----
  const ambient = new THREE.AmbientLight(
    CONFIG.lights.ambientColor,
    CONFIG.lights.ambientIntensity,
  );
  scene.add(ambient);

  const moonLight = new THREE.DirectionalLight(
    CONFIG.lights.moonColor,
    CONFIG.lights.moonIntensity,
  );
  moonLight.position.set(...CONFIG.lights.moonPosition);
  scene.add(moonLight);

  const neonA = new THREE.PointLight(
    CONFIG.lights.neonColor,
    CONFIG.lights.neonIntensity,
    CONFIG.lights.neonDistance,
  );
  neonA.position.set(5.0, 2.4, -2.4);
  scene.add(neonA);

  const neonB = new THREE.PointLight(
    CONFIG.lights.neonColor,
    CONFIG.lights.neonIntensity * 0.8,
    CONFIG.lights.neonDistance,
  );
  neonB.position.set(-4.5, 2.2, 2.6);
  scene.add(neonB);

  // Đèn rọi lúc kết màn, chỉ bật khi nghi thức kết màn chạy.
  const closingSpot = new THREE.PointLight(0xffe9a8, 0, 6);
  closingSpot.position.set(slotX(0), 4.2, slotZ);
  scene.add(closingSpot);

  const baseIntensities = {
    ambient: CONFIG.lights.ambientIntensity,
    moon: CONFIG.lights.moonIntensity,
    neonA: CONFIG.lights.neonIntensity,
    neonB: CONFIG.lights.neonIntensity * 0.8,
  };
  const neonColorNormal = new THREE.Color(CONFIG.lights.neonColor);
  const neonColorWarm = new THREE.Color(0xffcf8a);

  // ---- Mặt đất phố đêm: 1 mặt phẳng, vệt sáng + vạch ô vẽ sẵn ----
  const groundSize = CONFIG.scene.groundSize;
  const groundPosition = CONFIG.scene.groundPosition;
  function worldToCanvas(x, z) {
    const u = (x - (groundPosition[0] - groundSize[0] / 2)) / groundSize[0];
    const localY = groundPosition[2] - z;
    const v = (localY + groundSize[1] / 2) / groundSize[1];
    return [u * 1024, (1 - v) * 600];
  }
  function makeGroundTexture() {
    const W = 1024;
    const H = 600;
    const { canvas, ctx } = makeCanvas(W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, CONFIG.scene.groundTopColor);
    grad.addColorStop(1, CONFIG.scene.groundBottomColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    // Vệt sáng ấm quanh dãy ô và quanh khu bảng.
    const glowAt = (x, z, r, alpha) => {
      const [cx, cy] = worldToCanvas(x, z);
      const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
      g.addColorStop(0, `rgba(255, 180, 94, ${alpha})`);
      g.addColorStop(1, 'rgba(255, 180, 94, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    };
    glowAt(-1, slotZ, 260, 0.20);
    glowAt(5.0, -3.6, 200, 0.16);
    // Vạch ô vỉa hè cho từng slot.
    ctx.strokeStyle = 'rgba(255, 180, 94, 0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i < slotCount; i += 1) {
      const [cx, cy] = worldToCanvas(slotX(i), slotZ);
      const w = (1.15 / groundSize[0]) * W;
      const h = (0.85 / groundSize[1]) * H;
      ctx.fillStyle = 'rgba(255, 180, 94, 0.07)';
      ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
      ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
    }
    // Vạch đứt giữa phố.
    ctx.strokeStyle = 'rgba(255, 180, 94, 0.35)';
    ctx.lineWidth = 4;
    ctx.setLineDash([30, 24]);
    const [, dashY] = worldToCanvas(0, 2.05);
    ctx.beginPath();
    ctx.moveTo(20, dashY);
    ctx.lineTo(W - 20, dashY);
    ctx.stroke();
    ctx.setLineDash([]);
    // Chấm sáng li ti như ánh đèn phản chiếu.
    const rng = mulberry32(4242);
    ctx.fillStyle = 'rgba(255, 220, 160, 0.25)';
    for (let i = 0; i < 90; i += 1) {
      ctx.fillRect(rng() * W, H * 0.45 + rng() * H * 0.55, 2, 2);
    }
    return toTexture(canvas);
  }
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize[0], groundSize[1]),
    new THREE.MeshLambertMaterial({ map: makeGroundTexture() }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(groundPosition[0], groundPosition[1], groundPosition[2]);
  scene.add(ground);

  // ---- Trăng (sprite) ----
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeMoonTexture(LOCAL.moon.canvasSize),
    transparent: true,
    depthWrite: false,
  }));
  moonSprite.scale.set(LOCAL.moon.scale, LOCAL.moon.scale, 1);
  moonSprite.position.set(...LOCAL.moon.position);
  scene.add(moonSprite);

  // ---- Sao: InstancedMesh, nhấp nháy nhẹ bằng opacity chung ----
  const starMat = new THREE.MeshBasicMaterial({
    color: 0xcfe0ff,
    transparent: true,
    opacity: 0.75,
  });
  const stars = new THREE.InstancedMesh(
    new THREE.SphereGeometry(LOCAL.stars.size, 6, 5),
    starMat,
    LOCAL.stars.count,
  );
  {
    const rng = mulberry32(LOCAL.stars.seed);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < LOCAL.stars.count; i += 1) {
      dummy.position.set(
        (rng() * 2 - 1) * LOCAL.stars.areaX,
        LOCAL.stars.minY + rng() * (LOCAL.stars.maxY - LOCAL.stars.minY),
        LOCAL.stars.z + (rng() * 2 - 1) * LOCAL.stars.zVariation,
      );
      dummy.updateMatrix();
      stars.setMatrixAt(i, dummy.matrix);
    }
    stars.instanceMatrix.needsUpdate = true;
  }
  stars.frustumCulled = false;
  scene.add(stars);

  // ---- Người qua lại TRANG TRÍ: InstancedMesh thân + đầu ----
  // Chỉ đi bộ chậm qua lại ở mặt phố, không rơi xu, không mang tên,
  // không tương tác với bất kỳ ai.
  const walkerPalette = [0x4a6b8a, 0x8a4a6b, 0x3a7a5a, 0xb07a2a, 0x6b5a8a, 0x2a8a8a];
  const walkerSkin = [0xf2c79b, 0xe0ac82, 0xc98a5e];
  const walkerBodies = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.20, 0.24, 0.62, 8),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    LOCAL.walkers.count,
  );
  const walkerHeads = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.17, 10, 8),
    new THREE.MeshLambertMaterial({ color: 0xffffff }),
    LOCAL.walkers.count,
  );
  const walkers = [];
  {
    const rng = mulberry32(LOCAL.walkers.seed);
    for (let i = 0; i < LOCAL.walkers.count; i += 1) {
      walkers.push({
        x: -11 + rng() * 22,
        z: LOCAL.walkers.lanes[i % LOCAL.walkers.lanes.length],
        dir: rng() < 0.5 ? -1 : 1,
        speed: 0.03 + rng() * 0.02,
        phase: rng() * Math.PI * 2,
      });
      walkerBodies.setColorAt(i, new THREE.Color(walkerPalette[i % walkerPalette.length]));
      walkerHeads.setColorAt(i, new THREE.Color(walkerSkin[i % walkerSkin.length]));
    }
    walkerBodies.instanceColor.needsUpdate = true;
    walkerHeads.instanceColor.needsUpdate = true;
  }
  walkerBodies.frustumCulled = false;
  walkerHeads.frustumCulled = false;
  scene.add(walkerBodies);
  scene.add(walkerHeads);
  const walkerDummy = new THREE.Object3D();

  // ---- Đèn sạp: InstancedMesh, 1 đèn trên mỗi ô ----
  const stallLamps = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.07, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
    slotCount,
  );
  const lampDummy = new THREE.Object3D();
  const occupiedSlots = new Array(slotCount).fill(false);
  let nightMarket = false;
  function refreshLamps() {
    const bright = new THREE.Color(0xffd9a0);
    const lit = new THREE.Color(0xc98a3e);
    const dim = new THREE.Color(0x6a4a26);
    for (let i = 0; i < slotCount; i += 1) {
      lampDummy.position.set(slotX(i), 1.62, slotZ - 0.5);
      lampDummy.scale.set(1, 1, 1);
      lampDummy.rotation.set(0, 0, 0);
      lampDummy.updateMatrix();
      stallLamps.setMatrixAt(i, lampDummy.matrix);
      stallLamps.setColorAt(i, nightMarket ? bright : (occupiedSlots[i] ? lit : dim));
    }
    stallLamps.instanceMatrix.needsUpdate = true;
    stallLamps.instanceColor.needsUpdate = true;
  }
  stallLamps.frustumCulled = false;
  scene.add(stallLamps);

  // ---- Khu bảng lớn bên phải: 1 hộp, chữ vẽ sẵn trên texture ----
  function makeBoardTexture() {
    const W = 1024;
    const H = 512;
    const { canvas, ctx } = makeCanvas(W, H);
    ctx.fillStyle = '#101a38';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb45e';
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.fillStyle = '#ffd9a0';
    ctx.font = '700 76px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VỈA HÈ LÊN ĐỜI', W / 2, 78);
    ctx.fillStyle = '#9fb4dd';
    ctx.font = '500 32px system-ui, sans-serif';
    ctx.fillText('PHỐ ĐÊM  ·  XU ẢO  ·  GAME HƯ CẤU', W / 2, 140);
    // 6 bậc, 2 cột, lấy đúng nhãn + giá từ CONFIG.tiers.
    const tiers = Array.isArray(CONFIG.tiers) ? CONFIG.tiers : [];
    ctx.font = '600 34px system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let i = 0; i < 6; i += 1) {
      const t = tiers[i] || { label: `Bậc ${i + 1}`, cost: 0 };
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 70 + col * 500;
      const y = 215 + row * 78;
      ctx.fillStyle = LOCAL.tierOutfits[i] || '#ffffff';
      ctx.beginPath();
      ctx.arc(x - 24, y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffedd0';
      ctx.fillText(`${t.label} · ${t.cost} xu`, x, y);
    }
    ctx.fillStyle = '#9fb4dd';
    ctx.font = '500 28px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('19:30 – 22:00', W / 2, 466);
    return toTexture(canvas);
  }
  const boardMat = new THREE.MeshBasicMaterial({ map: makeBoardTexture() });
  boardMat.color.setScalar(LOCAL.board.dim);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(LOCAL.board.size[0], LOCAL.board.size[1], LOCAL.board.size[2]),
    boardMat,
  );
  board.position.set(...LOCAL.board.position);
  board.rotation.y = -0.08;
  scene.add(board);
  let boardBrightness = LOCAL.board.dim;
  let openAnim = null; // { from, start, duration }

  // ---- Vật liệu + texture dùng chung cho mọi nhân vật ----
  const faceAtlas = makeFaceAtlasTexture();
  const chibiMat = new THREE.MeshLambertMaterial({ map: faceAtlas, vertexColors: true });

  // ---- Nhân vật "chủ phố": đứng giữa phố, vẫy tay + giơ bảng ----
  function makeHostSignTexture() {
    const W = 512;
    const H = 288;
    const { canvas, ctx } = makeCanvas(W, H);
    ctx.fillStyle = '#141428';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#ffb45e';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, W - 20, H - 20);
    ctx.fillStyle = '#ffd9a0';
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('VỈA HÈ LÊN ĐỜI', W / 2, 96);
    ctx.fillStyle = '#ffedd0';
    ctx.font = '500 30px system-ui, sans-serif';
    ctx.fillText('XU ẢO · GAME HƯ CẤU', W / 2, 178);
    return toTexture(canvas);
  }
  const hostGroup = new THREE.Group();
  hostGroup.position.set(...LOCAL.host.position);
  const hostOutfit = 0x3a86ff;
  const hostBodyGeo = mergeParts([
    { geometry: new THREE.CylinderGeometry(0.07, 0.08, 0.22, 8), x: -0.10, y: 0.11, color: LOCAL.dark },
    { geometry: new THREE.CylinderGeometry(0.07, 0.08, 0.22, 8), x: 0.10, y: 0.11, color: LOCAL.dark },
    { geometry: new THREE.CylinderGeometry(0.23, 0.27, 0.55, 12), y: 0.50, color: hostOutfit },
    { geometry: new THREE.CylinderGeometry(0.06, 0.055, 0.34, 8), x: -0.30, y: 0.55, rz: 0.35, color: hostOutfit },
    { geometry: new THREE.SphereGeometry(0.21, 16, 12), y: 1.02, color: LOCAL.skin, uvMode: 'head' },
    { geometry: new THREE.SphereGeometry(0.215, 16, 12), y: 1.12, z: -0.03, sy: 0.62, color: LOCAL.hair },
    { geometry: new THREE.CylinderGeometry(0.30, 0.30, 0.045, 16), y: 1.22, color: 0xffd166 },
    { geometry: new THREE.CylinderGeometry(0.19, 0.21, 0.16, 16), y: 1.32, color: 0xffd166 },
    // Cán bảng cầm ở tay trái.
    { geometry: new THREE.CylinderGeometry(0.025, 0.025, 0.70, 6), x: -0.34, y: 1.15, z: 0.28, color: 0x7a4a2a },
  ]);
  const hostBody = new THREE.Mesh(hostBodyGeo, chibiMat);
  hostGroup.add(hostBody);
  // Tay phải vẫy: mesh riêng quay quanh vai.
  const hostArmGeo = new THREE.CylinderGeometry(0.06, 0.055, 0.36, 8);
  hostArmGeo.translate(0, -0.18, 0);
  const hostArm = new THREE.Mesh(
    hostArmGeo,
    new THREE.MeshLambertMaterial({ color: hostOutfit }),
  );
  const hostShoulder = new THREE.Group();
  hostShoulder.position.set(0.31, 0.92, 0);
  hostShoulder.add(hostArm);
  hostGroup.add(hostShoulder);
  const hostSign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.53),
    new THREE.MeshBasicMaterial({ map: makeHostSignTexture(), side: THREE.DoubleSide }),
  );
  hostSign.position.set(-0.34, 1.66, 0.28);
  hostGroup.add(hostSign);
  scene.add(hostGroup);

  // ---- Vương miện vàng lúc kết màn (ẩn khi không dùng) ----
  const crownGeo = mergeParts([
    { geometry: new THREE.CylinderGeometry(0.15, 0.19, 0.12, 8), color: 0xffd166 },
    { geometry: new THREE.ConeGeometry(0.05, 0.10, 6), x: -0.11, y: 0.10, color: 0xffd166 },
    { geometry: new THREE.ConeGeometry(0.05, 0.13, 6), y: 0.12, color: 0xffd166 },
    { geometry: new THREE.ConeGeometry(0.05, 0.10, 6), x: 0.11, y: 0.10, color: 0xffd166 },
  ]);
  const crown = new THREE.Mesh(crownGeo, new THREE.MeshLambertMaterial({ color: 0xffd166 }));
  crown.visible = false;
  scene.add(crown);
  let closingActive = false;

  // ---- Nhãn chữ nổi dùng chung (tái dùng 1 sprite) ----
  const labelSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    transparent: true,
    depthWrite: false,
  }));
  labelSprite.scale.set(...LOCAL.label.scale);
  labelSprite.position.set(...LOCAL.label.position);
  labelSprite.visible = false;
  scene.add(labelSprite);
  let labelUntil = 0;

  function showLabel(text, seconds) {
    const clean = String(text == null ? '' : text).slice(0, 60);
    if (!clean) return;
    const old = labelSprite.material.map;
    labelSprite.material.map = makeLabelTexture(clean);
    labelSprite.material.needsUpdate = true;
    if (old) old.dispose();
    labelSprite.visible = true;
    labelUntil = clockSeconds + Math.min(10, Math.max(3, seconds));
  }

  // ---- Xu bay: InstancedMesh đĩa vàng, tối đa 120 cùng lúc ----
  const coinGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12);
  coinGeo.rotateX(Math.PI / 2);
  const coins = new THREE.InstancedMesh(
    coinGeo,
    new THREE.MeshBasicMaterial({ color: 0xffd166 }),
    LOCAL.coins.max,
  );
  coins.frustumCulled = false;
  scene.add(coins);
  const coinDummy = new THREE.Object3D();
  const coinData = [];
  for (let i = 0; i < LOCAL.coins.max; i += 1) {
    coinData.push({
      active: false, age: 0, life: LOCAL.coins.lifeSeconds,
      pos: new THREE.Vector3(0, -10, 0), vel: new THREE.Vector3(), spin: 0,
    });
    coinDummy.position.set(0, -10, 0);
    coinDummy.scale.set(0.001, 0.001, 0.001);
    coinDummy.updateMatrix();
    coins.setMatrixAt(i, coinDummy.matrix);
  }
  coins.instanceMatrix.needsUpdate = true;
  let coinCursor = 0;

  // ---- Pháo giấy: 1 Points tái dùng ----
  const confettiGeo = new THREE.BufferGeometry();
  const confettiPositions = new Float32Array(LOCAL.confetti.max * 3);
  const confettiColors = new Float32Array(LOCAL.confetti.max * 3);
  {
    const rng = mulberry32(991);
    const palette = [
      new THREE.Color(0xff5d8f), new THREE.Color(0xffd166),
      new THREE.Color(0x7bc950), new THREE.Color(0x7c5cff),
      new THREE.Color(0xff9f1c), new THREE.Color(0x4ecdc4),
    ];
    for (let i = 0; i < LOCAL.confetti.max; i += 1) {
      const c = palette[Math.floor(rng() * palette.length)];
      confettiColors[i * 3] = c.r;
      confettiColors[i * 3 + 1] = c.g;
      confettiColors[i * 3 + 2] = c.b;
      confettiPositions[i * 3 + 1] = -10;
    }
  }
  confettiGeo.setAttribute('position', new THREE.BufferAttribute(confettiPositions, 3));
  confettiGeo.setAttribute('color', new THREE.BufferAttribute(confettiColors, 3));
  const confetti = new THREE.Points(confettiGeo, new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  confetti.visible = false;
  confetti.frustumCulled = false;
  scene.add(confetti);
  const confettiVel = new Float32Array(LOCAL.confetti.max * 3);
  let confettiAge = 0;
  let confettiLife = 0;
  let confettiCount = 0;

  // ---- Trạng thái toàn cảnh ----
  let clockSeconds = 0;
  let glowUntil = 0;
  let ritualState = '';

  function applyLights() {
    const boost = clockSeconds < glowUntil ? CONFIG.lights.glowBoost : 1;
    ambient.intensity = baseIntensities.ambient * boost;
    moonLight.intensity = baseIntensities.moon * boost;
    neonA.intensity = baseIntensities.neonA * boost * (nightMarket ? 1.25 : 1);
    neonB.intensity = baseIntensities.neonB * boost * (nightMarket ? 1.25 : 1);
  }

  function setClosingVisual(on) {
    closingActive = on;
    closingSpot.intensity = on ? 18 : 0;
    if (!on) crown.visible = false;
  }

  function topPlayer() {
    for (const p of players.values()) {
      if (p.slotIndex === 0) return p;
    }
    return null;
  }

  // ---- Người chơi: map id -> bản ghi, mỗi người 1 group + 1 mesh ----
  const players = new Map();
  const usedSlots = new Set();

  function addPlayer(uniqueId, name) {
    const id = String(uniqueId == null ? '' : uniqueId);
    if (!id || players.has(id)) return;
    if (players.size >= slotCount) return;
    let slotIndex = -1;
    for (let i = 0; i < slotCount; i += 1) {
      if (!usedSlots.has(i)) { slotIndex = i; break; }
    }
    if (slotIndex < 0) return;
    const displayName = String(name == null ? '' : name).slice(0, 24) || 'Người chơi';
    const group = new THREE.Group();
    group.position.set(slotX(slotIndex), 0, slotZ);
    const body = new THREE.Mesh(buildChibiGeometry(0), chibiMat);
    group.add(body);
    scene.add(group);
    usedSlots.add(slotIndex);
    occupiedSlots[slotIndex] = true;
    refreshLamps();
    players.set(id, {
      id, name: displayName, group, body, tier: 0, slotIndex,
      phase: Math.random() * Math.PI * 2,
    });
  }

  function setPlayerTier(uniqueId, tierIndex) {
    const id = String(uniqueId == null ? '' : uniqueId);
    const player = players.get(id);
    if (!player) return;
    const raw = Number(tierIndex);
    if (!Number.isFinite(raw)) return;
    if (tierCount <= 0) return;
    const tier = clampInt(raw, 0, tierCount - 1);
    if (tier === player.tier) return;
    player.tier = tier;
    const oldGeo = player.body.geometry;
    player.body.geometry = buildChibiGeometry(tier);
    oldGeo.dispose();
  }

  function coinBurstFor(uniqueId, n) {
    const id = String(uniqueId == null ? '' : uniqueId);
    const player = players.get(id);
    if (!player) return;
    const count = clampInt(n, 0, 40);
    if (count <= 0) return;
    const origin = new THREE.Vector3(slotX(player.slotIndex), 0.6, slotZ);
    for (let k = 0; k < count; k += 1) {
      const coin = coinData[coinCursor];
      coinCursor = (coinCursor + 1) % LOCAL.coins.max;
      coin.active = true;
      coin.age = 0;
      coin.life = LOCAL.coins.lifeSeconds * (0.85 + Math.random() * 0.3);
      coin.pos.copy(origin);
      coin.pos.x += (Math.random() - 0.5) * 0.3;
      coin.pos.z += (Math.random() - 0.5) * 0.2;
      coin.vel.set(
        (Math.random() - 0.5) * 0.35,
        LOCAL.coins.riseSpeed * (0.85 + Math.random() * 0.3),
        (Math.random() - 0.5) * 0.2,
      );
      coin.spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3);
    }
  }

  function pulseGlow() {
    glowUntil = Math.max(glowUntil, clockSeconds + 10);
  }

  function setNightMarket(on) {
    nightMarket = on === true;
    if (nightMarket) {
      neonA.color.copy(neonColorWarm);
      neonB.color.copy(neonColorWarm);
    } else {
      neonA.color.copy(neonColorNormal);
      neonB.color.copy(neonColorNormal);
    }
    refreshLamps();
  }

  function setRitualState(key) {
    const k = String(key == null ? '' : key).trim();
    if (k !== 'open' && k !== 'vote1' && k !== 'rush' && k !== 'vote2' && k !== 'market' && k !== 'closing') return;
    ritualState = k;
    openAnim = null;
    if (k === 'open') {
      boardBrightness = LOCAL.board.bright;
      boardMat.color.setScalar(boardBrightness);
      setClosingVisual(false);
    } else if (k === 'vote1' || k === 'vote2') {
      boardBrightness = 0.8;
      boardMat.color.setScalar(boardBrightness);
      setClosingVisual(false);
    } else if (k === 'rush') {
      boardBrightness = LOCAL.board.bright;
      boardMat.color.setScalar(boardBrightness);
      setClosingVisual(false);
    } else if (k === 'market') {
      boardBrightness = 0.9;
      boardMat.color.setScalar(boardBrightness);
      setClosingVisual(false);
      setNightMarket(true);
    } else if (k === 'closing') {
      boardBrightness = LOCAL.board.bright;
      boardMat.color.setScalar(boardBrightness);
      setClosingVisual(true);
    }
  }

  function playOpenRitual(seconds) {
    const duration = Number(seconds);
    if (!Number.isFinite(duration) || duration <= 0) {
      openAnim = null;
      boardBrightness = LOCAL.board.bright;
      boardMat.color.setScalar(boardBrightness);
      ritualState = 'open';
      return;
    }
    openAnim = { from: boardBrightness, start: clockSeconds, duration };
    ritualState = 'open';
  }

  function playClosingRitual() {
    ritualState = 'closing';
    setClosingVisual(true);
  }

  function showWelcomeName(name) {
    const clean = String(name == null ? '' : name).slice(0, 24);
    if (clean) showLabel(`Chào mừng ${clean}`, 5);
  }

  function showVoteResult(text) {
    showLabel(text, 8);
  }

  function showNewTier(name, tierLabel) {
    const cleanName = String(name == null ? '' : name).slice(0, 24);
    const cleanTier = String(tierLabel == null ? '' : tierLabel).slice(0, 24);
    if (cleanName && cleanTier) showLabel(`${cleanName} lên ${cleanTier}`, 6);
  }

  function celebrateGift(big) {
    const count = big === true ? LOCAL.confetti.max : LOCAL.confetti.small;
    confettiCount = count;
    confettiAge = 0;
    confettiLife = big === true ? LOCAL.confetti.bigLifeSeconds : LOCAL.confetti.lifeSeconds;
    for (let i = 0; i < count; i += 1) {
      confettiPositions[i * 3] = (Math.random() - 0.5) * 0.6;
      confettiPositions[i * 3 + 1] = 3.0 + Math.random() * 0.4;
      confettiPositions[i * 3 + 2] = 1.2 + (Math.random() - 0.5) * 0.6;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * (big === true ? 1.1 : 0.7);
      confettiVel[i * 3] = Math.cos(angle) * speed;
      confettiVel[i * 3 + 1] = 0.6 + Math.random() * 0.8;
      confettiVel[i * 3 + 2] = Math.sin(angle) * speed * 0.5;
    }
    confettiGeo.setDrawRange(0, count);
    confettiGeo.attributes.position.needsUpdate = true;
    confetti.visible = true;
    if (big === true) {
      glowUntil = Math.max(glowUntil, clockSeconds + 5);
    }
  }

  function getDrawCallEstimate() {
    // Đếm thật từ code: 12 lệnh vẽ cố định (mặt đất, trăng, sao,
    // người qua đường ×2, đèn sạp, bảng, chủ phố ×3, nhãn, xu)
    // + 1 mesh cho mỗi người chơi + lúc cao điểm thêm pháo giấy
    // và vương miện. Mốc typical = 5 người chơi.
    const base = 12;
    return {
      typical: base + 5,
      peak: base + slotCount + 2,
    };
  }

  function getPlayerCount() {
    return players.size;
  }

  refreshLamps();

  // ================= Vòng cập nhật =================
  function update(dt, elapsed) {
    const rawDt = Number(dt);
    const safeDt = Number.isFinite(rawDt) && rawDt > 0
      ? Math.min(rawDt, CONFIG.renderer.maxDeltaSeconds)
      : 0;
    if (Number.isFinite(Number(elapsed))) {
      clockSeconds = Number(elapsed);
    } else {
      clockSeconds += safeDt;
    }
    const now = clockSeconds;

    applyLights();

    // Bảng hiệu sáng dần lúc khai trương.
    if (openAnim) {
      const p = clamp01((now - openAnim.start) / openAnim.duration);
      boardBrightness = openAnim.from + (LOCAL.board.bright - openAnim.from) * p;
      boardMat.color.setScalar(boardBrightness);
      if (p >= 1) openAnim = null;
    }

    // Sao nhấp nháy nhẹ, chung một nhịp.
    starMat.opacity = 0.65 + Math.sin(now * 0.35) * 0.12;

    // Người qua lại: đi chậm qua lại, vòng lại đầu bên kia.
    // Tốc độ dài luôn dưới trần của CONFIG.scene.
    const maxSpeed = CONFIG.scene.maxSpeedMetersPerSecond;
    for (let i = 0; i < walkers.length; i += 1) {
      const w = walkers[i];
      w.x += w.dir * Math.min(w.speed, maxSpeed) * safeDt;
      if (w.x > 11.5) { w.x = 11.5; w.dir = -1; }
      if (w.x < -11.5) { w.x = -11.5; w.dir = 1; }
      const bob = Math.abs(Math.sin(now * 2.2 + w.phase)) * 0.02;
      walkerDummy.position.set(w.x, 0.45 + bob, w.z);
      walkerDummy.rotation.set(0, 0, 0);
      walkerDummy.scale.set(1, 1, 1);
      walkerDummy.updateMatrix();
      walkerBodies.setMatrixAt(i, walkerDummy.matrix);
      walkerDummy.position.y = 0.95 + bob;
      walkerDummy.updateMatrix();
      walkerHeads.setMatrixAt(i, walkerDummy.matrix);
    }
    walkerBodies.instanceMatrix.needsUpdate = true;
    walkerHeads.instanceMatrix.needsUpdate = true;

    // Người chơi nhún nhảy nhẹ tại chỗ.
    for (const player of players.values()) {
      player.group.position.y = Math.abs(Math.sin(now * 1.2 + player.phase)) * 0.02;
      player.group.rotation.y = Math.sin(now * 0.4 + player.phase) * 0.06;
    }

    // Chủ phố: vẫy tay chậm, giơ bảng, đu đưa nhẹ.
    hostShoulder.rotation.z = -0.25 + Math.sin(now * 0.9) * 0.45;
    hostSign.position.y = 1.66 + Math.sin(now * 0.9 + 1) * 0.04;
    hostGroup.rotation.y = Math.sin(now * 0.3) * 0.08;
    hostGroup.position.y = Math.abs(Math.sin(now * 1.1)) * 0.015;

    // Vương miện lúc kết màn: đậu trên đầu người ở ô đầu tiên.
    if (closingActive) {
      const top = topPlayer();
      if (top) {
        crown.visible = true;
        crown.position.set(
          top.group.position.x,
          top.group.position.y + 1.78,
          top.group.position.z,
        );
        crown.rotation.y += safeDt * 0.3;
      } else {
        crown.visible = false;
      }
    }

    // Xu bay: bay lên mũ rồi nhỏ dần và biến mất.
    for (let i = 0; i < coinData.length; i += 1) {
      const coin = coinData[i];
      if (!coin.active) continue;
      coin.age += safeDt;
      if (coin.age >= coin.life) {
        coin.active = false;
        coinDummy.position.set(0, -10, 0);
        coinDummy.scale.set(0.001, 0.001, 0.001);
        coinDummy.rotation.set(0, 0, 0);
      } else {
        coin.vel.y -= 0.55 * safeDt;
        coin.pos.addScaledVector(coin.vel, safeDt);
        const fade = coin.age > coin.life - 0.3
          ? Math.max(0.001, (coin.life - coin.age) / 0.3)
          : 1;
        coinDummy.position.copy(coin.pos);
        coinDummy.scale.set(fade, fade, fade);
        coinDummy.rotation.set(0, 0, coin.age * coin.spin);
      }
      coinDummy.updateMatrix();
      coins.setMatrixAt(i, coinDummy.matrix);
    }
    coins.instanceMatrix.needsUpdate = true;

    // Pháo giấy: tung lên rồi rơi chậm, hết đời thì ẩn hẳn.
    if (confetti.visible) {
      confettiAge += safeDt;
      if (confettiAge >= confettiLife) {
        confetti.visible = false;
      } else {
        for (let i = 0; i < confettiCount; i += 1) {
          confettiVel[i * 3 + 1] -= 0.35 * safeDt;
          confettiPositions[i * 3] += confettiVel[i * 3] * safeDt;
          confettiPositions[i * 3 + 1] += confettiVel[i * 3 + 1] * safeDt;
          confettiPositions[i * 3 + 2] += confettiVel[i * 3 + 2] * safeDt;
        }
        confettiGeo.attributes.position.needsUpdate = true;
      }
    }

    // Nhãn dùng chung: hết hạn thì ẩn.
    if (labelSprite.visible && now >= labelUntil) {
      labelSprite.visible = false;
    }
  }

  return {
    scene,
    update,
    addPlayer,
    setPlayerTier,
    coinBurstFor,
    pulseGlow,
    setNightMarket,
    setRitualState,
    playOpenRitual,
    playClosingRitual,
    showWelcomeName,
    showVoteResult,
    showNewTier,
    celebrateGift,
    getDrawCallEstimate,
    getPlayerCount,
  };
}
