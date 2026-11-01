/**
 * 生成 iOS App 图标（1024×1024，App Store 要求不透明、无 alpha 通道）。
 * 优先从线上取当前后台「外观」里配置的图标（mode=store 输出不透明 PNG）；
 * 取不到（断网 / 服务未部署）时用仓库里提交好的 assets/icon-1024.png 兜底。
 */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ORIGIN = 'https://mobile-app-pay-skeleton.app.workbuddy.host';
const SHARE = 'O53RMG5UQ2';

const url = `${ORIGIN}/api/brand/icon.png?size=1024&mode=store&sharecode=${SHARE}`;
const fallback = join(ROOT, 'assets', 'icon-1024.png');
const iconSet = join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');

let buf = null;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length < 1000 || b.slice(1, 4).toString() !== 'PNG') throw new Error('返回内容不是 PNG');
  buf = b;
  console.log(`[icons] 已从线上获取图标（${(b.length / 1024).toFixed(0)}KB）`);
} catch (e) {
  console.warn(`[icons] 线上获取失败（${e.message}），使用仓库兜底图标`);
  buf = await readFile(fallback);
}

// 兜底文件也更新一份，方便离线构建
await mkdir(join(ROOT, 'assets'), { recursive: true });
if (buf !== null) await writeFile(fallback, buf);

// 写进 Xcode 资源目录（单尺寸 1024，Xcode 14+ 自动生成其余尺寸）
await mkdir(iconSet, { recursive: true });
await writeFile(join(iconSet, 'AppIcon-512@2x.png'), buf);
await writeFile(
  join(iconSet, 'Contents.json'),
  JSON.stringify(
    {
      images: [{ filename: 'AppIcon-512@2x.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
      info: { author: 'xcode', version: 1 },
    },
    null,
    2
  ) + '\n'
);
console.log('[icons] 已写入 Assets.xcassets/AppIcon.appiconset');
