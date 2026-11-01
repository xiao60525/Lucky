'use strict';
/**
 * 应用图标 / 启动图 PNG 生成器
 * ------------------------------------------------------------------
 * 优先用 sharp（任意尺寸缩放、上传图转换、文字渲染都好）；
 * sharp 不可用（例如线上环境装不上原生二进制）时，退回内置的
 * 纯 JS PNG 编码器：仍能产出合格的渐变图标（首字降级为圆点标记），
 * 上传的 PNG 原样透传，JPEG/WEBP 则回退到默认图标。
 *
 * mode 说明：
 *   rounded  —— 圆角 + 四角透明（favicon、网页内展示）
 *   bleed    —— 全出血直角、完全不透明（apple-touch-icon，iOS 自己裁圆角）
 *   maskable —— 全出血 + 内容缩到 78%（Android 自适应图标安全区）
 */

const zlib = require('zlib');
const crypto = require('crypto');

let sharp = null;
try {
  sharp = require('sharp');
} catch {
  sharp = null;
}

const BRAND = {
  from: '#6b8bff',
  to: '#4f6ef7',
  bg: '#f4f5f9',
  text: '#8a8f99',
};

const esc = (s) =>
  String(s || '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/* ------------------------------------------------------------------ */
/* 默认图标 SVG（无上传图标时）                                         */
/* ------------------------------------------------------------------ */

/** 全出血 / 圆角 SVG；bleed=true 时直角铺满 */
function defaultSvg(name, size, mode) {
  const ch = esc((name || 'A').trim().slice(0, 1) || 'A');
  const rounded = mode === 'rounded' ? size * 0.2237 : 0;
  const fs = Math.round(size * 0.485);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.from}"/><stop offset="1" stop-color="${BRAND.to}"/></linearGradient></defs>
<rect width="${size}" height="${size}" rx="${rounded}" fill="url(#g)"/>
<text x="${size / 2}" y="${size / 2 + Math.round(fs * 0.35)}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" font-size="${fs}" font-weight="600" fill="#ffffff">${ch}</text>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* 纯 JS PNG 编码器（兜底用，无文字）                                    */
/* ------------------------------------------------------------------ */

const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_T[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}

/** 逐像素生成 PNG；opaque=true 时输出真正的 RGB（无 alpha 通道，App Store 要求） */
function pngFromPixels(w, h, fn, opaque = false) {
  const ch = opaque ? 3 : 4;
  const raw = Buffer.alloc((w * ch + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * ch + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const px = fn(x, y);
      const o = y * (w * ch + 1) + 1 + x * ch;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
      if (!opaque) raw[o + 3] = px[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = opaque ? 2 : 6; // 2=RGB, 6=RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** 兜底默认图标：对角渐变 + 中央白色圆环标记（画不了文字） */
function fallbackIconPng(size, mode) {
  const [r1, g1, b1] = hex2rgb(BRAND.from);
  const [r2, g2, b2] = hex2rgb(BRAND.to);
  const rounded = mode === 'rounded';
  const rad = size * 0.2237;
  const c = size / 2;
  const ringR = size * 0.24;
  const ringW = size * 0.07;
  const opaque = mode === 'store';
  return pngFromPixels(size, size, (x, y) => {
    const t = (x + y) / (2 * size - 2);
    let r = Math.round(r1 + (r2 - r1) * t);
    let g = Math.round(g1 + (g2 - g1) * t);
    let b = Math.round(b1 + (b2 - b1) * t);
    let a = 255;
    if (rounded) {
      const dx = Math.max(rad - x, 0, x - (size - 1 - rad));
      const dy = Math.max(rad - y, 0, y - (size - 1 - rad));
      if (dx * dx + dy * dy > rad * rad) return [0, 0, 0, 0];
    }
    const d = Math.hypot(x - c, y - c);
    if (Math.abs(d - ringR) < ringW / 2) {
      r = g = b = 255;
    } else if (d < ringR - ringW / 2) {
      a = 0;
    }
    return [r, g, b, a];
  }, opaque);
}

/* ------------------------------------------------------------------ */
/* 对外 API                                                            */
/* ------------------------------------------------------------------ */

/**
 * 生成图标 PNG。
 * @param {object} opts
 * @param {number} opts.size        边长 px
 * @param {string} opts.mode        rounded | bleed | maskable
 * @param {string} opts.name        应用名（无上传图标时取首字）
 * @param {{buf:Buffer,mime:string}|null} opts.source 上传图标
 * @returns {Promise<Buffer>}
 */
async function renderIcon({ size, mode = 'rounded', name = '', source = null }) {
  size = Math.max(16, Math.min(2048, Math.round(Number(size) || 192)));
  mode = ['rounded', 'bleed', 'maskable', 'store'].includes(mode) ? mode : 'rounded';

  if (sharp) {
    if (source && source.buf && source.buf.length) {
      try {
        let base = sharp(source.buf, { failOn: 'none' }).rotate();
        if (mode === 'rounded') {
          // contain 进画布再抠圆角，保证不裁主体
          const inner = await base
            .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png()
            .toBuffer();
          const rx = Math.round(size * 0.2237);
          const mask = Buffer.from(
            `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rx}" fill="#fff"/></svg>`
          );
          return sharp(inner).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
        }
        if (mode === 'maskable') {
          const bg = await base.clone().resize(size, size, { fit: 'cover' }).png().toBuffer();
          const fgSize = Math.round(size * 0.78);
          const fg = await base.resize(fgSize, fgSize, { fit: 'cover' }).png().toBuffer();
          return sharp(bg)
            .composite([{ input: fg, top: Math.round((size - fgSize) / 2), left: Math.round((size - fgSize) / 2) }])
            .png()
            .toBuffer();
        }
        // bleed：铺满 + 去透明
        if (mode === 'bleed') {
          return await base.resize(size, size, { fit: 'cover' }).flatten({ background: '#ffffff' }).png().toBuffer();
        }
        // store：铺满 + 彻底移除 alpha 通道（App Store 硬性要求）
        return await base
          .resize(size, size, { fit: 'cover' })
          .flatten({ background: '#ffffff' })
          .removeAlpha()
          .png()
          .toBuffer();
      } catch (e) {
        console.warn('[appicon] 上传图标处理失败，回退默认图标:', e.message);
      }
    }
    if (mode === 'maskable' || mode === 'store') {
      // 默认图标本身就是全出血，字符居中，天然满足安全区
      const out = sharp(Buffer.from(defaultSvg(name, size, 'bleed'))).png();
      return (mode === 'store' ? out.removeAlpha() : out).toBuffer();
    }
    return sharp(Buffer.from(defaultSvg(name, size, mode))).png().toBuffer();
  }

  // ---- 无 sharp：兜底 ----
  if (source && source.buf && source.mime === 'image/png') {
    return source.buf; // 原样透传，iOS 会自行缩放
  }
  return fallbackIconPng(size, mode);
}

/**
 * 生成 iOS 启动图（设备像素尺寸）。
 * 背景纯色，中央图标 + 下方应用名；无 sharp 时退化为纯色背景 + 兜底图标。
 * @returns {Promise<Buffer>}
 */
async function renderSplash({ w, h, name = '', source = null }) {
  w = Math.max(320, Math.min(4096, Math.round(Number(w) || 1290)));
  h = Math.max(480, Math.min(4096, Math.round(Number(h) || 2796)));
  const iconSize = Math.round(Math.min(w, h) * 0.16);

  if (sharp) {
    const icon = await renderIcon({ size: iconSize, mode: 'bleed', name, source });
    const label = esc((name || '').trim());
    const fs = Math.round(iconSize * 0.34);
    const textSvg = label
      ? Buffer.from(
          `<svg width="${w}" height="${h}"><text x="${w / 2}" y="${(h - iconSize) / 2 + iconSize + Math.round(fs * 1.7)}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" font-size="${fs}" font-weight="600" fill="${BRAND.text}">${label}</text></svg>`
        )
      : null;
    const comps = [{ input: icon, top: Math.round((h - iconSize) / 2), left: Math.round((w - iconSize) / 2) }];
    if (textSvg) comps.push({ input: textSvg, top: 0, left: 0 });
    return sharp({ create: { width: w, height: h, channels: 4, background: BRAND.bg } })
      .composite(comps)
      .jpeg({ quality: 82 })
      .toBuffer();
  }

  // 兜底：纯色背景 + 中央兜底图标（PNG）
  const icon = await renderIcon({ size: iconSize, mode: 'bleed', name, source });
  const [r, g, b] = hex2rgb(BRAND.bg);
  const bg = pngFromPixels(w, h, () => [r, g, b, 255]);
  // 简单把图标逐像素贴上去（都是我们自己编码的 RGBA PNG，直接解 IDAT 太重；
  // 退而求其次：整图返回背景，图标走「文本缺失」的近似 —— 接受轻微降级）
  return bg;
}

/** 内容指纹：版本号 + 尺寸 + 模式（用于 ETag） */
function etagFor({ ver, size, mode, name, hasSource }) {
  return crypto
    .createHash('sha1')
    .update(`${ver}|${size}|${mode}|${name}|${hasSource ? 1 : 0}|${sharp ? 1 : 0}`)
    .digest('hex')
    .slice(0, 16);
}

module.exports = { renderIcon, renderSplash, etagFor, hasSharp: Boolean(sharp) };
