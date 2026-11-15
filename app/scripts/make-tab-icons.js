#!/usr/bin/env node
/**
 * 生成小程序 tabBar 图标（81×81 PNG，微信官方推荐尺寸）。
 * 纯 Node 实现：几何图形 + 超采样抗锯齿 + 手写 PNG 编码，不引入任何依赖。
 * 用法：node scripts/make-tab-icons.js
 * 产物：miniprogram/images/tab-{home,help,mine}[-on].png
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 81; // 微信推荐 81×81
const SS = 4; // 每个像素 4×4 采样，边缘更顺
const STROKE = 5.4;
const HALF = STROKE / 2;

const NORMAL = [138, 143, 153]; // #8a8f99
const ACTIVE = [79, 110, 247]; // #4f6ef7

/* ---------------- 距离场基础函数 ---------------- */

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function polyDist(px, py, pts, closed) {
  let d = Infinity;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  if (closed) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    d = Math.min(d, segDist(px, py, a[0], a[1], b[0], b[1]));
  }
  return d;
}

function circleDist(px, py, cx, cy, r) {
  return Math.abs(Math.hypot(px - cx, py - cy) - r);
}

function arcDist(px, py, cx, cy, r, a0, a1) {
  const deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI;
  const norm = (a) => ((a % 360) + 360) % 360;
  const ang = norm(deg);
  const inRange = a0 < a1 ? ang >= a0 && ang <= a1 : ang >= a0 || ang <= a1;
  if (inRange) return Math.abs(Math.hypot(px - cx, py - cy) - r);
  const p0 = [cx + r * Math.cos((a0 * Math.PI) / 180), cy + r * Math.sin((a0 * Math.PI) / 180)];
  const p1 = [cx + r * Math.cos((a1 * Math.PI) / 180), cy + r * Math.sin((a1 * Math.PI) / 180)];
  return Math.min(Math.hypot(px - p0[0], py - p0[1]), Math.hypot(px - p1[0], py - p1[1]));
}

/** 圆角矩形轮廓：四段线 + 四个圆角 */
function roundRectDist(px, py, x, y, w, h, r) {
  const inner = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return Math.abs(outside + inside - r);
}

/* ---------------- 三个图标 ---------------- */

const SHAPES = {
  // 首页：房子轮廓
  home(p) {
    const [px, py] = p;
    return Math.min(
      polyDist(px, py, [[40.5, 17], [15, 37.5], [15, 64.5], [66, 64.5], [66, 37.5]], true)
    );
  },
  // 帮助：三行条目（FAQ 列表）
  help(p) {
    const [px, py] = p;
    return Math.min(
      roundRectDist(px, py, 20, 17, 41, 47, 8), // 外框
      segDist(px, py, 29, 31, 52, 31),
      segDist(px, py, 29, 40.5, 52, 40.5),
      segDist(px, py, 29, 50, 44, 50)
    );
  },
  // 我的：头像 + 肩线
  mine(p) {
    const [px, py] = p;
    return Math.min(circleDist(px, py, 40.5, 28.5, 11.5), arcDist(px, py, 40.5, 76, 24, 188, 352));
  },
};

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 绘制 ---------------- */

function render(shape, color) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const samples = SS * SS;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hit = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (shape([px, py]) <= HALF) hit++;
        }
      }
      const a = Math.round((hit / samples) * 255);
      const i = (y * SIZE + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = a;
    }
  }
  return encodePng(SIZE, SIZE, buf);
}

const outDir = path.resolve(__dirname, '../../miniprogram/images');
fs.mkdirSync(outDir, { recursive: true });

let count = 0;
for (const [name, shape] of Object.entries(SHAPES)) {
  for (const [suffix, color] of [['', NORMAL], ['-on', ACTIVE]]) {
    const file = path.join(outDir, `tab-${name}${suffix}.png`);
    const png = render(shape, color);
    fs.writeFileSync(file, png);
    console.log(`${path.basename(file)}  ${png.length} bytes`);
    count++;
  }
}
console.log(`生成完成：${count} 个图标 → ${outDir}`);
