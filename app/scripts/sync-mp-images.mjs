// 同步商品图片：H5 云库 products.image -> 小程序云库
// 用法：cd app && node scripts/sync-mp-images.mjs
//
// 小程序云库的商品表对客户端只读，脚本无法直接 UPDATE，
// 所以这里生成一条条 UPDATE SQL（base64 文件），到 WorkBuddy
// 「云服务 → 数据库 → SQL 执行」（migrate 模式，应用选
// 小程序应用 wbapp_yRpSbkLI5B3qYWUzX9iyG3）逐条粘贴执行即可。
// 前提：先在网页版后台（/admin → 商品）给商品配好图片。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
for (const l of fs.readFileSync(path.join(here, '../.env'), 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('=');
  if (i > 0) process.env[l.slice(0, i)] = l.slice(i + 1);
}
const { createWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk');

const h5 = createWorkBuddyCloud({
  endpoint: process.env.CLOUD_ENDPOINT,
  publishableKey: process.env.CLOUD_PUBLISHABLE_KEY,
});

const { data: state, error } = await h5.database.rpc('app_get_state', {
  p_secret: process.env.CLOUD_DB_SECRET,
});
if (error) {
  console.error('读取 H5 商品失败', JSON.stringify(error));
  process.exit(1);
}

const withImage = (state.products || []).filter((p) => p.image);
if (!withImage.length) {
  console.log('H5 还没有商品配置图片。先到后台给商品传图，再运行本脚本。');
  process.exit(0);
}

const outDir = path.join(here, 'mp-image-sql');
fs.mkdirSync(outDir, { recursive: true });
for (const p of withImage) {
  const sql = `update public.products set image = '${String(p.image).replace(/'/g, "''")}' where id = '${p.id}';`;
  const file = path.join(outDir, `${p.id}.b64`);
  fs.writeFileSync(file, Buffer.from(sql, 'utf8').toString('base64'));
  console.log(`${p.id} (${p.title}) -> ${file}`);
}
console.log(`共 ${withImage.length} 条。把每个 .b64 解码出的 SQL 到小程序应用的云库（migrate 模式）执行即可。`);
