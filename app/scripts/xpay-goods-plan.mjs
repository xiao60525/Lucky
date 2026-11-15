// 微信虚拟支付（xpay）商品上架清单
// 用法：cd app && node scripts/xpay-goods-plan.mjs
//
// 只生成清单，不调用任何支付/商品接口。
// 平台侧支付凭证（OfferID / AppKey）未配置时，wechatVirtualGoods.startUpload /
// startPublish 属于禁用范围，所以这里先把你需要上传的商品和硬性要求列清楚。
//
// 微信商品硬性要求（上传时会被平台校验，猜错直接 18300）：
//   · 图片必须是 PNG 或 JPG，且精确 200×200，小于 200KB
//   · 每个商品需要 productId（与小程序云库 products.id 保持一致最省事）
//   · startPublish 成功后约 10 分钟才能购买，提前付款会 -15014
//   · goodsPrice 单位是分，必须与发布价一致，否则真机 -15013
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

const mp = createWorkBuddyCloud({
  endpoint: process.env.MP_CLOUD_ENDPOINT,
  publishableKey: process.env.MP_CLOUD_PUBLISHABLE_KEY,
});

const { data, error } = await mp.database
  .from('products')
  .select('id, title, amount, tag, image, active')
  .order('sort', { ascending: true });

if (error) {
  console.error('读取小程序商品失败', JSON.stringify(error));
  process.exit(1);
}

const rows = (data || []).filter((p) => p.active !== false);
const plan = rows.map((p) => {
  const image = p.image || '';
  let imageNote = '缺图：需要 200×200 PNG/JPG，<200KB';
  if (image.startsWith('data:image/png')) imageNote = 'PNG（待核对尺寸与体积）';
  else if (image.startsWith('data:image/jpeg') || image.startsWith('data:image/jpg')) imageNote = 'JPG（待核对尺寸与体积）';
  else if (image.startsWith('http')) imageNote = '外链，需确认是公网可直连的 PNG/JPG';
  else if (image.startsWith('data:image/')) imageNote = '格式不支持（微信只收 PNG/JPG）';

  return {
    productId: p.id,
    title: p.title,
    goodsPrice: Number(p.amount || 0), // 分
    buyQuantity: 1,
    remark: p.tag || '小程序商品',
    image: imageNote,
    hasImage: Boolean(image),
  };
});

console.log('待上架微信虚拟商品：', plan.length, '个\n');
for (const r of plan) {
  console.log(
    `- ${r.productId}  ${r.title}  ¥${(r.goodsPrice / 100).toFixed(2)}  ${r.hasImage ? '' : '⚠ 无图'} ${r.image}`
  );
}
console.log('\n提醒：goodsPrice 必须与微信侧发布价完全一致；发布后等约 10 分钟再测支付。');

const out = path.join(here, 'xpay-goods-plan.json');
fs.writeFileSync(out, JSON.stringify(plan, null, 2));
console.log('清单已写入', out);
