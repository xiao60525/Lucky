/**
 * 生成 Android 启动图标。
 * 优先从线上取当前后台「外观」里配置的图标（与 iOS 的 make-icons.mjs 同源），
 * 取不到时用 assets/icon-1024.png 兜底；用 app 里的 sharp 缩放成各密度 mipmap。
 *
 *  - ic_launcher.png / ic_launcher_round.png：桌面图标（48~192px）
 *  - ic_launcher_foreground.png：自适应图标前景（108~432px，内容缩到 66% 留安全区）
 *  - splash.png：启动图（居中 448px 图标）
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require(join(fileURLToPath(new URL('../../app', import.meta.url)), 'node_modules', 'sharp'));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://mobile-app-pay-skeleton.app.workbuddy.host';
const SHARE = 'O53RMG5UQ2';

const url = `${ORIGIN}/api/brand/icon.png?size=1024&mode=store&sharecode=${SHARE}`;
let src = null;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length < 1000 || b.slice(1, 4).toString() !== 'PNG') throw new Error('返回内容不是 PNG');
  src = b;
  console.log(`[icons-android] 已从线上获取图标（${(b.length / 1024).toFixed(0)}KB）`);
} catch (e) {
  console.warn(`[icons-android] 线上获取失败（${e.message}），使用仓库兜底图标`);
  src = await readFile(join(ROOT, 'assets', 'icon-1024.png'));
}

const RES = join(ROOT, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = [
  ['mipmap-mdpi', 48, 108],
  ['mipmap-hdpi', 72, 162],
  ['mipmap-xhdpi', 96, 216],
  ['mipmap-xxhdpi', 144, 324],
  ['mipmap-xxxhdpi', 192, 432],
];

async function resizePng(buf, size) {
  return sharp(buf).resize(size, size, { fit: 'cover' }).png().toBuffer();
}

/** 自适应图标前景：图标本体只占 66%，四周留系统裁剪安全区 */
async function foregroundPng(buf, size) {
  const inner = Math.round(size * 0.66);
  const innerPng = await sharp(buf).resize(inner, inner, { fit: 'cover' }).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: innerPng, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }])
    .png()
    .toBuffer();
}

/** 启动图：纯白底 + 居中图标（与 iOS 启动图风格一致） */
async function splashPng(buf, width, height, iconSize) {
  const icon = await sharp(buf).resize(iconSize, iconSize, { fit: 'cover' }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
    .composite([{ input: icon, left: Math.round((width - iconSize) / 2), top: Math.round((height - iconSize) / 2) }])
    .png()
    .toBuffer();
}

for (const [dir, size, fgSize] of DENSITIES) {
  const out = join(RES, dir);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'ic_launcher.png'), await resizePng(src, size));
  await writeFile(join(out, 'ic_launcher_round.png'), await resizePng(src, size));
  await writeFile(join(out, 'ic_launcher_foreground.png'), await foregroundPng(src, fgSize));
  console.log(`[icons-android] ${dir}: launcher ${size}px, foreground ${fgSize}px`);
}

// 启动图（drawable 目录，portrait 各密度）
const SPLASH = [
  ['drawable', 480, 762, 96],
  ['drawable-mdpi', 480, 800, 96],
  ['drawable-hdpi', 800, 1280, 160],
  ['drawable-xhdpi', 960, 1600, 192],
  ['drawable-xxhdpi', 1440, 2560, 288],
];
for (const [dir, w, h, icon] of SPLASH) {
  const out = join(RES, dir);
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'splash.png'), await splashPng(src, w, h, icon));
}
console.log('[icons-android] 启动图已生成');
