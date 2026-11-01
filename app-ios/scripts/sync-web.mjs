/**
 * 把 app/public 的网页资源同步到 Capacitor 的 webDir（www/）。
 * 排除管理后台（只给浏览器用），其余原样拷贝。
 */
import { readdir, mkdir, rm, copyFile, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, '..', 'app', 'public');
const OUT = join(ROOT, 'www');
const SKIP = new Set(['admin.html', 'admin.js']);

async function walk(dir, list = []) {
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isDirectory()) await walk(full, list);
    else list.push(full);
  }
  return list;
}

const files = (await walk(SRC)).filter((f) => !SKIP.has(relative(SRC, f).replace(/\\/g, '/')));

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let bytes = 0;
for (const f of files) {
  const dest = join(OUT, relative(SRC, f));
  await mkdir(join(dest, '..'), { recursive: true });
  await copyFile(f, dest);
  bytes += (await stat(dest)).size;
}

// 校验：页面必须引入 native.js（原生壳里接口要靠它转成线上绝对地址）
const { readFile } = await import('node:fs/promises');
const html = await readFile(join(OUT, 'index.html'), 'utf8');
if (!html.includes('/native.js')) {
  console.error('[sync-web] 失败：index.html 缺少 native.js 引入');
  process.exit(1);
}

const kinds = [...new Set(files.map((f) => extname(f) || 'no-ext'))].sort();
console.log(`[sync-web] 已同步 ${files.length} 个文件，共 ${(bytes / 1024).toFixed(1)}KB → www/`);
console.log(`[sync-web] 类型：${kinds.join(' ')}`);
