'use strict';
/**
 * 手机应用骨架 · 服务端
 * 零依赖 Node.js (>=18)，直接 `node server.js` 即可运行。
 *
 * 目录：
 *   server.js          路由 + 订单状态机 + 回调入口
 *   src/payments.js    支付渠道适配层（mock / 微信支付 / 支付宝）
 *   public/            前端（移动端 H5，可加到桌面）
 *
 * 支付主干：创建订单 -> 发起支付 -> 收银台 -> 异步回调 -> 幂等入账 -> 可退款
 * 状态机：created(待支付) -> pending(支付中) -> paid(已支付) -> refunded(已退款)
 *                                      \-> closed(已关闭)
 */

require('./src/env').loadEnv(); // 先载入 app/.env

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sign, signPayload, verify, getProvider, channelName } = require('./src/payments');
const { WechatPay } = require('./src/wechatpay');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

/** 微信支付客户端：凭据齐全时为实例，否则为 null（自动降级到模拟渠道） */
const wxClient = WechatPay.fromEnv();
const PROVIDER = (process.env.PAY_PROVIDER || (wxClient ? 'wechat' : 'mock')).toLowerCase();

/** 管理后台密码（.env 的 ADMIN_PASSWORD；不设置则后台不可登录） */
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

function adminToken(expMs) {
  const sig = crypto.createHmac('sha256', ADMIN_PASSWORD).update('admin|' + expMs).digest('base64url');
  return expMs.toString(36) + '.' + sig;
}

function checkAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const auth = String(req.headers['x-admin-token'] || '');
  const dot = auth.indexOf('.');
  if (dot < 1) return false;
  const exp = parseInt(auth.slice(0, dot), 36);
  if (!exp || exp < Date.now()) return false;
  const expect = crypto.createHmac('sha256', ADMIN_PASSWORD).update('admin|' + exp).digest('base64url');
  const got = auth.slice(dot + 1);
  return got.length === expect.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect));
}


/** 商品表：内容暂空，先用示例商品把支付链路跑通，随时可删可改 */
const CATALOG = [
  { id: 'demo_001', title: '测试商品', desc: '验证支付链路用，可随时删除', amount: 1, tag: '示例' },
  { id: 'vip_month', title: '会员月卡', desc: '示例商品，替换成你的真实商品', amount: 1200, tag: '示例' },
  { id: 'coin_60', title: '60 金币', desc: '示例商品，替换成你的真实商品', amount: 600, tag: '示例' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/* ------------------------------------------------------------------ */
/* 数据层：WorkBuddy 云服务数据库（src/cloudstore.js）                  */
/* 订单与余额由服务端写入云端；浏览器没有写权限，伪造不了「已支付」        */
/* ------------------------------------------------------------------ */

const store = require('./src/cloudstore');
// 小程序云库只读客户端：管理后台查看小程序用户手机号（跨应用，独立云环境）
const mpstore = require('./src/mpstore');
// iOS App（PWA）图标与启动图生成：sharp 优先，纯 JS 兜底
const appicon = require('./src/appicon');

/** 内存缓存，写操作同步落库（云端为唯一事实来源） */
let db = {
  user: { id: 'demo-user', nickname: '游客', balance: 0 },
  orders: [],
  products: CATALOG,
};

/** 从云端加载状态；失败时抛错，由接口层明确告知用户，不做静默降级 */
async function loadState() {
  const state = await store.getState();
  db.user = state.account
    ? { id: state.account.id, nickname: state.account.nickname, balance: state.account.balance }
    : { id: 'demo-user', nickname: '游客', balance: 0 };
  db.orders = state.orders;
  db.products = state.products.length ? state.products : CATALOG;
  await loadSite();
  return db;
}

/** 写订单：把当前对象状态同步到云端 */
async function persistOrder(order) {
  await store.updateOrder(order);
}

/** 写余额 */
async function persistBalance() {
  await store.updateAccount({ balance: db.user.balance });
}

/** 后台改完商品后刷新内存商品表（只保留已上架的，结构与 app_get_state 一致） */
async function refreshProducts() {
  const all = await store.adminListProducts();
  db.products = all
    .filter((p) => p.active)
    .map(({ id, title, desc, amount, tag }) => ({ id, title, desc, amount, tag }));
  return all;
}

function newOrderId() {
  return 'O' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(3).toString('hex').toUpperCase();
}

/* ------------------------------------------------------------------ */
/* 应用外观：程序名称 + 图标（后台可改，存云库，重启不丢）                */
/* ------------------------------------------------------------------ */

let site = {
  name: process.env.APP_NAME || '手机App支付骨架',
  tagline: '',
  iconMime: null,
  iconData: null, // 纯 base64（不带 data: 前缀）
  iconThumb: null, // 96px 小图 dataURL，同步给小程序用
  iconVer: null,
  updatedAt: null,
};

/** 图标字节的内存缓存，按版本号命中，避免每次请求都 base64 解码 */
let iconCache = { ver: null, buf: null, mime: null };

async function loadSite() {
  const s = await store.getSettings();
  if (!s) return site;
  site = {
    name: s.name || site.name,
    tagline: s.tagline || '',
    iconMime: s.iconMime,
    iconData: s.iconData,
    iconThumb: s.iconThumb,
    iconVer: s.iconVer,
    updatedAt: s.updatedAt,
  };
  iconCache = { ver: null, buf: null, mime: null };
  return site;
}

/**
 * 把外观同步到小程序云库（小程序端公开只读）。
 * 小程序是独立云环境，读不到网页版的库，所以这里推一份过去。
 */
async function syncBrandToMiniProgram() {
  if (!mpstore.enabled) return { synced: false, message: '未配置小程序云库，跳过同步' };
  const thumb = site.iconThumb || null;
  try {
    await mpstore.saveBrand({
      name: site.name,
      tagline: site.tagline,
      iconAction: thumb ? 'set' : 'clear',
      iconData: thumb,
      iconVer: site.iconVer,
    });
    return { synced: true };
  } catch (e) {
    console.warn('[site] 同步到小程序失败:', e.message);
    return { synced: false, message: e.message };
  }
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

/** 没上传图标时的默认图标：渐变圆角方块 + 名称首字，随名称自动变 */
function defaultIcon() {
  const ch = escapeXml((site.name || 'A').trim().slice(0, 1) || 'A');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6b8bff"/><stop offset="1" stop-color="#4f6ef7"/></linearGradient></defs>
<rect width="128" height="128" rx="30" fill="url(#g)"/>
<text x="64" y="68" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif" font-size="62" font-weight="600" fill="#ffffff">${ch}</text>
</svg>`;
  const buf = Buffer.from(svg, 'utf8');
  return { buf, mime: 'image/svg+xml; charset=utf-8', etag: 'd' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12) };
}

function iconPayload() {
  if (site.iconData && site.iconMime) {
    if (iconCache.ver !== site.iconVer || !iconCache.buf) {
      const buf = Buffer.from(site.iconData, 'base64');
      if (buf.length) {
        iconCache = { ver: site.iconVer, buf, mime: site.iconMime };
        return { buf, mime: site.iconMime, etag: 'i' + (site.iconVer || '0') };
      }
    } else {
      return { buf: iconCache.buf, mime: iconCache.mime, etag: 'i' + (site.iconVer || '0') };
    }
  }
  return defaultIcon();
}

/** 对外暴露的外观信息（不含图片本体，只给地址） */
function publicSite() {
  const hasIcon = Boolean(site.iconData && site.iconMime);
  return {
    name: site.name,
    tagline: site.tagline || '',
    hasIcon,
    iconVer: hasIcon ? site.iconVer || '1' : 'default',
    iconUrl: '/api/brand/icon?v=' + encodeURIComponent(hasIcon ? site.iconVer || '1' : 'default'),
    updatedAt: site.updatedAt,
  };
}

const ICON_MAX_BYTES = 512 * 1024;
/** 同步给小程序的小图上限（base64 解码后字节数） */
const ICON_THUMB_MAX_BYTES = 200 * 1024;
const ICON_MIME_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** 解析前端传来的 data URL：data:image/png;base64,xxxx */
function parseDataUrl(s) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(s || ''));
  if (!m) return null;
  const data = m[2].replace(/\s+/g, '');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) return null;
  return { mime: m[1].toLowerCase(), data, bytes: buf.length };
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function sendJSON(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 保留原始报文的读取（微信支付回调验签必须用原始字节，不能先 parse 再 stringify） */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1e6) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket.remoteAddress || '').replace('::ffff:', '') || '127.0.0.1';
}

/** 对外输出订单时，补上展示用的字段 */
function publicOrder(order) {
  return {
    id: order.id,
    productId: order.productId,
    title: order.title,
    amount: order.amount,
    amountText: (order.amount / 100).toFixed(2),
    channel: order.channel,
    channelName: channelName(order.channel),
    status: order.status,
    createdAt: order.createdAt,
    paidAt: order.paidAt || null,
    refundedAt: order.refundedAt || null,
  };
}

/* ------------------------------------------------------------------ */
/* 订单业务                                                            */
/* ------------------------------------------------------------------ */

/** 幂等入账：重复回调不会重复加钱、不会覆盖已退款订单 */
function settleOrder(order, source) {
  if (order.status === 'paid') return { ok: true, duplicate: true };
  if (order.status === 'refunded') return { ok: false, message: '订单已退款，忽略回调' };
  if (order.status === 'closed') return { ok: false, message: '订单已关闭，忽略回调' };

  order.status = 'paid';
  order.paidAt = Date.now();
  order.settleSource = source;
  return { ok: true };
}

/** 退款：真实渠道先调渠道退款接口，站内渠道退回余额；落库失败会抛错由调用方回滚 */
async function refundOrder(order) {
  if (order.status !== 'paid') {
    const err = new Error('只有已支付订单可以退款');
    err.status = 409;
    throw err;
  }
  // 真实渠道：先调微信退款接口，成功后再改本地状态
  if (order.channel && order.channel !== 'mock' && order.channel !== 'balance') {
    const provider = getProvider(order.channel);
    if (provider.refund) {
      const outRefundNo = 'R' + order.id;
      const r = await provider.refund(order, outRefundNo);
      order.refundNo = outRefundNo;
      order.channelRefundId = r.refund_id || null;
    }
  }
  order.status = 'refunded';
  order.refundedAt = Date.now();
  if (order.channel === 'balance' || order.channel === 'mock') {
    db.user.balance += order.amount; // 站内渠道：退回余额
    await persistBalance();
  }
  await persistOrder(order);
}

/** 模拟渠道：延迟后向本机 notify 接口发一条带签名的异步通知 */
function scheduleMockNotify(order) {
  const provider = getProvider('mock');
  const payload = JSON.stringify({
    orderId: order.id,
    amount: order.amount,
    channel: order.channel,
    tradeNo: 'MOCK' + Date.now(),
    status: 'SUCCESS',
  });
  const signature = sign(signPayload(order));

  setTimeout(() => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: PORT,
        path: '/api/notify/mock',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-pay-sign': signature,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => res.resume()
    );
    req.on('error', (e) => console.error('[mock] 回调发送失败:', e.message));
    req.end(payload);
  }, provider.notifyDelay);
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  // 启动数据
  if (pathname === '/api/bootstrap' && method === 'GET') {
    if (!cloudReady) {
      return sendJSON(res, 503, {
        message: `云数据库暂不可用：${cloudError || '正在连接'}，请稍后重试`,
      });
    }
    return sendJSON(res, 200, {
      user: { id: db.user.id, nickname: db.user.nickname },
      balance: db.user.balance,
      provider: PROVIDER,
      payScene: (process.env.WX_PAY_SCENE || 'auto').toLowerCase(),
      wechatReady: !!wxClient,
      wxMchId: process.env.WX_MCHID || null,
      cloud: { ready: cloudReady, endpoint: store.endpoint || null },
      site: publicSite(),
      products: db.products,
      orders: db.orders.slice(-20).reverse().map(publicOrder),
    });
  }

  if (pathname === '/api/health' && method === 'GET') {
    return sendJSON(res, 200, {
      ok: cloudReady,
      provider: PROVIDER,
      cloudReady,
      orders: db.orders.length,
    });
  }

  // 程序图标（公开）：既给页面当 logo，也直接当 favicon / apple-touch-icon
  if (pathname === '/api/brand/icon' && method === 'GET') {
    const { buf, mime, etag } = iconPayload();
    if (req.headers['if-none-match'] === '"' + etag + '"') {
      res.writeHead(304, { ETag: '"' + etag + '"' }).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      ETag: '"' + etag + '"',
      'Cache-Control': 'public, max-age=600',
    });
    return res.end(buf);
  }

  // 程序名称等公开信息（静态页在 JS 起来之前也能先读到名称）
  if (pathname === '/api/appinfo' && method === 'GET') {
    return sendJSON(res, 200, publicSite());
  }

  /* ---------------- iOS App（PWA）资源 ---------------- */

  // PNG 图标：?size=180&mode=rounded|bleed|maskable|store&v=版本
  if (pathname === '/api/brand/icon.png' && method === 'GET') {
    const size = Number(url.searchParams.get('size') || 192);
    const mode = url.searchParams.get('mode') || 'rounded';
    const hasIcon = Boolean(site.iconData && site.iconMime);
    const ver = hasIcon ? site.iconVer || '1' : 'default';
    const etag = appicon.etagFor({ ver, size, mode, name: site.name, hasSource: hasIcon });
    if (req.headers['if-none-match'] === '"' + etag + '"') {
      res.writeHead(304, { ETag: '"' + etag + '"' }).end();
      return;
    }
    let buf;
    try {
      buf = await appicon.renderIcon({
        size,
        mode,
        name: site.name,
        source: hasIcon ? { buf: Buffer.from(site.iconData, 'base64'), mime: site.iconMime } : null,
      });
    } catch (e) {
      console.error('[appicon] 生成失败:', e.message);
      return sendJSON(res, 500, { message: '图标生成失败' });
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,
      ETag: '"' + etag + '"',
      'Cache-Control': 'public, max-age=600',
    });
    return res.end(buf);
  }

  // iOS 启动图：?w=1179&h=2556&v=版本（按设备像素尺寸生成）
  if (pathname === '/api/brand/splash' && method === 'GET') {
    const w = Number(url.searchParams.get('w') || 1290);
    const h = Number(url.searchParams.get('h') || 2796);
    const hasIcon = Boolean(site.iconData && site.iconMime);
    const ver = hasIcon ? site.iconVer || '1' : 'default';
    const etag = 's' + appicon.etagFor({ ver, size: w + 'x' + h, mode: 'splash', name: site.name, hasSource: hasIcon });
    if (req.headers['if-none-match'] === '"' + etag + '"') {
      res.writeHead(304, { ETag: '"' + etag + '"' }).end();
      return;
    }
    let buf;
    try {
      buf = await appicon.renderSplash({
        w,
        h,
        name: site.name,
        source: hasIcon ? { buf: Buffer.from(site.iconData, 'base64'), mime: site.iconMime } : null,
      });
    } catch (e) {
      console.error('[appicon] 启动图生成失败:', e.message);
      return sendJSON(res, 500, { message: '启动图生成失败' });
    }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': buf.length,
      ETag: '"' + etag + '"',
      'Cache-Control': 'public, max-age=600',
    });
    return res.end(buf);
  }

  // PWA 清单：动态注入名称 / 图标版本 / sharecode（装到桌面后启动地址要能过网关）
  if (pathname === '/manifest.webmanifest' && method === 'GET') {
    const hasIcon = Boolean(site.iconData && site.iconMime);
    const ver = hasIcon ? site.iconVer || '1' : 'default';
    const share = (url.searchParams.get('sharecode') || '').trim();
    const sq = share ? 'sharecode=' + encodeURIComponent(share) + '&' : '';
    const icon = (size, mode) =>
      `/api/brand/icon.png?${sq}size=${size}&mode=${mode}&v=${encodeURIComponent(ver)}`;
    const manifest = {
      name: site.name,
      short_name: site.name.slice(0, 12),
      description: site.tagline || site.name,
      start_url: '/' + (sq ? '?' + sq.replace(/&$/, '') : ''),
      scope: '/',
      display: 'standalone',
      orientation: 'portrait',
      background_color: '#f4f5f9',
      theme_color: '#f4f5f9',
      icons: [
        { src: icon(192, 'rounded'), sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: icon(512, 'bleed'), sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: icon(512, 'maskable'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    const body = JSON.stringify(manifest);
    res.writeHead(200, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-cache',
    });
    return res.end(body);
  }


  // 云服务连通性自检：真实读写一次数据库
  if (pathname === '/api/cloud/check' && method === 'GET') {
    try {
      const p = await store.ping();
      return sendJSON(res, 200, { ok: true, ...p, endpoint: store.endpoint });
    } catch (e) {
      return sendJSON(res, 503, { ok: false, message: e.message });
    }
  }

  // 创建订单
  if (pathname === '/api/orders' && method === 'POST') {
    const body = await readBody(req);
    const product = db.products.find((p) => p.id === body.productId);
    if (!product) return sendJSON(res, 400, { message: '商品不存在或已下架' });

    const order = {
      id: newOrderId(),
      userId: db.user.id,
      productId: product.id,
      title: product.title,
      amount: product.amount, // 金额一律取服务端商品表，绝不信前端传的金额
      channel: null,
      status: 'created',
      createdAt: Date.now(),
    };
    db.orders.push(order);
    try {
      await store.insertOrder(order); // 先落云库，再返回给前端
    } catch (e) {
      db.orders.pop();
      console.error('[order] 写入云库失败:', e.message);
      return sendJSON(res, 502, { message: '订单创建失败：' + e.message });
    }
    return sendJSON(res, 201, { order: publicOrder(order) });
  }

  // 订单列表
  if (pathname === '/api/orders' && method === 'GET') {
    return sendJSON(res, 200, { orders: db.orders.slice(-50).reverse().map(publicOrder) });
  }

  // 订单详情 / 收银台轮询
  const detailMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    const order = db.orders.find((o) => o.id === detailMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    return sendJSON(res, 200, { order: publicOrder(order) });
  }

  // 发起支付
  const payMatch = pathname.match(/^\/api\/orders\/([^/]+)\/pay$/);
  if (payMatch && method === 'POST') {
    const body = await readBody(req);
    const order = db.orders.find((o) => o.id === payMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    if (order.status === 'paid') return sendJSON(res, 409, { message: '订单已支付' });
    if (order.status === 'refunded' || order.status === 'closed') {
      return sendJSON(res, 409, { message: '订单已关闭' });
    }

    const channel = body.channel === 'balance' ? 'balance' : body.channel;
    if (channel === 'balance') {
      if (db.user.balance < order.amount) return sendJSON(res, 400, { message: '余额不足' });
      const prevBalance = db.user.balance;
      db.user.balance -= order.amount;
      order.channel = 'balance';
      settleOrder(order, 'balance');
      try {
        await persistBalance();
        await persistOrder(order);
      } catch (e) {
        db.user.balance = prevBalance;
        return sendJSON(res, 502, { message: '云端写入失败：' + e.message });
      }
      return sendJSON(res, 200, { mode: 'balance', order: publicOrder(order), balance: db.user.balance });
    }

    let provider;
    try {
      provider = getProvider(PROVIDER);
    } catch (e) {
      return sendJSON(res, 400, { message: e.message });
    }

    try {
      order.channel = provider.id;
      order.status = 'pending';
      const result = await provider.createPayment(order, {
        openid: body.openid,
        clientIp: clientIp(req),
        ua: req.headers['user-agent'] || '',
      });
      await persistOrder(order);
      return sendJSON(res, 200, {
        mode: result.mode,
        payUrl: result.payUrl || null,
        codeUrl: result.codeUrl || null,
        qrUrl: result.codeUrl ? `/api/qr?t=${encodeURIComponent(result.codeUrl)}` : null,
        payParams: result.payParams || null,
        order: publicOrder(order),
      });
    } catch (e) {
      order.status = 'created';
      order.channel = null;
      persistOrder(order).catch((err) => console.error('[pay] 回滚订单状态失败:', err.message));
      console.error('[pay] 下单失败:', e.message, e.detail ? JSON.stringify(e.detail) : '');
      return sendJSON(res, 502, { message: e.message, code: (e.detail && e.detail.code) || null });
    }
  }

  // 收银台：用户点「确认支付」（仅模拟渠道使用；真实渠道由微信侧完成支付）
  if (pathname === '/api/pay/confirm' && method === 'POST') {
    const body = await readBody(req);
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    if (order.channel !== 'mock') {
      return sendJSON(res, 409, { message: '该订单使用真实支付渠道，请在微信中完成支付' });
    }
    if (!verify(signPayload(order), body.sign)) {
      return sendJSON(res, 403, { message: '签名校验失败，金额或订单被篡改' });
    }
    if (order.status === 'paid') return sendJSON(res, 200, { ok: true, duplicate: true });
    if (order.status !== 'pending') return sendJSON(res, 409, { message: '订单状态不允许支付' });

    sendJSON(res, 200, { ok: true, message: '已提交，等待渠道回调' });
    scheduleMockNotify(order); // 关键：支付结果只认渠道回调，不认前端说了算
    return;
  }

  // 收银台：用户取消
  if (pathname === '/api/pay/cancel' && method === 'POST') {
    const body = await readBody(req);
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    if (order.status === 'pending') {
      order.status = 'closed';
      order.closedAt = Date.now();
      await persistOrder(order);
      // 真实渠道：尽力去关掉渠道侧订单，失败不影响本地状态
      if (order.channel && order.channel !== 'mock') {
        const p = getProvider(order.channel);
        if (p.closePayment) p.closePayment(order).catch((e) => console.warn('[pay] 关闭渠道订单失败:', e.message));
      }
    }
    return sendJSON(res, 200, { ok: true });
  }

  // 微信支付异步通知：验签 -> 解密 -> 幂等入账
  if (pathname === '/api/notify/wechat' && method === 'POST') {
    const raw = await readRawBody(req);
    if (!wxClient) {
      return sendJSON(res, 503, { code: 'FAIL', message: '微信支付未配置' });
    }
    let parsed;
    try {
      parsed = await wxClient.parseNotify(raw, req.headers);
    } catch (e) {
      console.warn('[notify/wechat] 验签或解密失败:', e.message);
      return sendJSON(res, 401, { code: 'FAIL', message: e.message });
    }

    const data = parsed.data || {};
    const order = db.orders.find((o) => o.id === data.out_trade_no);
    if (!order) {
      console.warn('[notify/wechat] 订单不存在:', data.out_trade_no);
      // 返回 SUCCESS 避免微信持续重推一个我们永远处理不了的订单
      return sendJSON(res, 200, { code: 'SUCCESS', message: '订单不存在，已忽略' });
    }

    if (data.trade_state === 'SUCCESS') {
      if (data.amount && data.amount.total !== order.amount) {
        console.warn('[notify/wechat] 金额不一致:', order.id, data.amount.total, order.amount);
        return sendJSON(res, 400, { code: 'FAIL', message: '金额不一致' });
      }
      order.transactionId = data.transaction_id;
      const result = settleOrder(order, 'notify');
      await persistOrder(order);
      console.log(
        `[notify/wechat] 订单 ${order.id} -> ${order.status}${
          result.duplicate ? '（重复通知，已幂等处理）' : ''
        } 微信交易号 ${data.transaction_id || '-'}`
      );
    } else {
      console.log(`[notify/wechat] 订单 ${order.id} 状态 ${data.trade_state}`);
    }
    return sendJSON(res, 200, { code: 'SUCCESS', message: '成功' });
  }

  // 渠道异步回调（mock 通道；接微信支付时换成 /api/notify/wechat 并做验签解密）
  if (pathname === '/api/notify/mock' && method === 'POST') {
    const body = await readBody(req);
    const order = db.orders.find((o) => o.id === body.orderId);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });

    // 验签：签名覆盖 订单号 + 金额 + 渠道
    if (!verify(signPayload(order), req.headers['x-pay-sign'])) {
      console.warn('[notify] 验签失败', order.id);
      return sendJSON(res, 401, { message: '验签失败' });
    }
    if (body.amount !== order.amount) {
      console.warn('[notify] 金额不一致', order.id);
      return sendJSON(res, 400, { message: '金额不匹配' });
    }

    const result = settleOrder(order, 'notify');
    await persistOrder(order);
    console.log(`[notify] 订单 ${order.id} -> ${order.status}${result.duplicate ? '（重复回调，已幂等处理）' : ''}`);
    return sendJSON(res, 200, { code: 'SUCCESS', message: 'OK' });
  }

  // 退款
  const refundMatch = pathname.match(/^\/api\/orders\/([^/]+)\/refund$/);
  if (refundMatch && method === 'POST') {
    const order = db.orders.find((o) => o.id === refundMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    try {
      await refundOrder(order);
    } catch (e) {
      return sendJSON(res, e.status || 502, { message: `退款失败：${e.message}` });
    }
    return sendJSON(res, 200, { order: publicOrder(order), balance: db.user.balance });
  }

  // 支付配置自检：告诉你还缺哪些凭据（不返回任何密钥内容）
  if (pathname === '/api/payconfig' && method === 'GET') {
    return sendJSON(res, 200, {
      provider: PROVIDER,
      scene: (process.env.WX_PAY_SCENE || 'auto').toLowerCase(),
      mchid: process.env.WX_MCHID || null,
      wechatReady: !!wxClient,
      missing: WechatPay.missingEnv(),
      notifyUrl: process.env.WX_NOTIFY_URL || null,
    });
  }

  // 把微信返回的 code_url 渲染成二维码图片（native 扫码支付用）
  if (pathname === '/api/qr' && method === 'GET') {
    const text = url.searchParams.get('t');
    if (!text) return sendJSON(res, 400, { message: '缺少参数 t' });
    try {
      const QR = require('qrcode');
      const buf = await QR.toBuffer(text, { width: 260, margin: 1, color: { dark: '#10131c', light: '#ffffff' } });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(buf);
    } catch (e) {
      return sendJSON(res, 500, { message: '二维码生成失败：' + e.message });
    }
  }

  /* ---------------- 管理后台 ---------------- */

  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readBody(req);
    if (!ADMIN_PASSWORD) {
      return sendJSON(res, 503, { message: '服务端未设置 ADMIN_PASSWORD，管理后台不可用' });
    }
    const ok =
      typeof body.password === 'string' &&
      body.password.length === ADMIN_PASSWORD.length &&
      crypto.timingSafeEqual(Buffer.from(body.password), Buffer.from(ADMIN_PASSWORD));
    if (!ok) return sendJSON(res, 401, { message: '密码错误' });
    return sendJSON(res, 200, { token: adminToken(Date.now() + 12 * 3600 * 1000), expiresIn: 12 * 3600 });
  }

  if (pathname.startsWith('/api/admin/') && pathname !== '/api/admin/login') {
    if (!checkAdmin(req)) return sendJSON(res, 401, { message: '未登录或登录已过期' });

    // 概览：统计 + 全部订单 + 全部商品 + 支付配置
    if (pathname === '/api/admin/overview' && method === 'GET') {
      const paid = db.orders.filter((o) => o.status === 'paid' || o.status === 'refunded');
      const refunded = db.orders.filter((o) => o.status === 'refunded');
      const gross = paid.reduce((s, o) => s + o.amount, 0);
      const refundSum = refunded.reduce((s, o) => s + o.amount, 0);
      let products;
      try {
        products = await store.adminListProducts();
      } catch (e) {
        return sendJSON(res, 502, { message: '读取商品失败：' + e.message });
      }
      return sendJSON(res, 200, {
        stats: {
          orders: db.orders.length,
          paidOrders: paid.length,
          pendingOrders: db.orders.filter((o) => o.status === 'created' || o.status === 'pending').length,
          gross, // 累计收款（含已退款）
          refundSum, // 累计退款
          net: gross - refundSum, // 净收入
          balance: db.user.balance,
        },
        orders: db.orders.slice(-100).reverse().map(publicOrder),
        products,
        site: publicSite(),
        mp: { ready: mpstore.enabled, endpoint: mpstore.endpoint || null },
        pay: {
          provider: PROVIDER,
          scene: (process.env.WX_PAY_SCENE || 'auto').toLowerCase(),
          mchid: process.env.WX_MCHID || null,
          wechatReady: !!wxClient,
          missing: WechatPay.missingEnv(),
          notifyUrl: process.env.WX_NOTIFY_URL || null,
          cloudReady,
        },
      });
    }

    // 小程序用户（手机号）：跨云环境只读，走 app_admin_list_users
    if (pathname === '/api/admin/users' && method === 'GET') {
      try {
        const users = await mpstore.listUsers();
        return sendJSON(res, 200, {
          ready: true,
          source: mpstore.endpoint || null,
          users: users.map((u) => ({
            id: u.id,
            phone: u.phone || '',
            nickname: u.nickname || '',
            createdAt: u.created_at ? new Date(u.created_at).getTime() : null,
            lastLoginAt: u.last_login_at ? new Date(u.last_login_at).getTime() : null,
            orderCount: Number(u.order_count || 0),
            paidAmount: Number(u.paid_amount || 0),
          })),
        });
      } catch (e) {
        return sendJSON(res, e.code === 'MP_NOT_CONFIGURED' ? 501 : 502, {
          ready: false,
          users: [],
          message: e.message || '读取小程序用户失败',
        });
      }
    }

    // 读取外观配置（名称 / 图标）
    if (pathname === '/api/admin/site' && method === 'GET') {
      return sendJSON(res, 200, { site: publicSite(), mp: { ready: mpstore.enabled } });
    }

    // 保存外观配置：程序名称、副标题、图标
    if (pathname === '/api/admin/site/save' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { message: '程序名称不能为空' });
      if ([...name].length > 24) return sendJSON(res, 400, { message: '程序名称最多 24 个字' });
      // 没传 tagline 时视为「不改动」，传空字符串才是清空
      const tagline = body.tagline === undefined ? null : String(body.tagline || '').trim().slice(0, 40);

      let iconAction = 'keep';
      let iconMime = null;
      let iconData = null;
      let iconThumb = null; // 小程序用的 96px 小图（dataURL）
      let iconVer = null;

      if (body.clearIcon === true) {
        iconAction = 'clear';
      } else if (body.icon) {
        const parsed = parseDataUrl(body.icon);
        if (!parsed) return sendJSON(res, 400, { message: '图片格式不正确，请上传 PNG / JPG / WEBP 图片' });
        if (!ICON_MIME_OK.includes(parsed.mime)) {
          return sendJSON(res, 400, { message: '图标仅支持 PNG / JPG / WEBP / GIF' });
        }
        if (parsed.bytes > ICON_MAX_BYTES) {
          return sendJSON(res, 400, { message: `图标太大（${Math.round(parsed.bytes / 1024)}KB），请压缩到 512KB 以内` });
        }
        iconAction = 'set';
        iconMime = parsed.mime;
        iconData = parsed.data;
        iconVer = crypto.createHash('sha256').update(parsed.data).digest('hex').slice(0, 12);

        // 小程序端用的小图：前端画布压好的 96px 版本优先，没给就用原图（够小的话）
        const t = body.iconThumb ? parseDataUrl(body.iconThumb) : null;
        if (t && ICON_MIME_OK.includes(t.mime) && t.bytes <= ICON_THUMB_MAX_BYTES) {
          iconThumb = String(body.iconThumb).trim();
        } else if (parsed.bytes <= ICON_THUMB_MAX_BYTES) {
          iconThumb = `data:${iconMime};base64,${iconData}`;
        }
      }

      let saved;
      try {
        saved = await store.adminSaveSettings({ name, tagline, iconAction, iconMime, iconData, iconThumb, iconVer });
      } catch (e) {
        return sendJSON(res, 502, { message: '保存失败：' + e.message });
      }

      site = {
        name: (saved && saved.name) || name,
        tagline: saved ? saved.tagline || '' : tagline,
        iconMime: iconAction === 'set' ? iconMime : iconAction === 'clear' ? null : site.iconMime,
        iconData: iconAction === 'set' ? iconData : iconAction === 'clear' ? null : site.iconData,
        iconThumb: iconAction === 'set' ? iconThumb : iconAction === 'clear' ? null : site.iconThumb,
        iconVer: iconAction === 'set' ? iconVer : iconAction === 'clear' ? null : site.iconVer,
        updatedAt: (saved && saved.updatedAt) || Date.now(),
      };
      iconCache = { ver: null, buf: null, mime: null };
      console.log(
        `[site] 已更新外观：名称「${site.name}」，图标 ${
          iconAction === 'set' ? '已替换' : iconAction === 'clear' ? '已恢复默认' : '未变'
        }`
      );

      // 顺带把名称/图标推给小程序云库（失败不影响网页版保存）
      const mp = await syncBrandToMiniProgram();
      return sendJSON(res, 200, { site: publicSite(), mp });
    }

    // 保存商品（新增或更新）
    if (pathname === '/api/admin/product/save' && method === 'POST') {
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      const amount = Number(body.amount);
      if (!title) return sendJSON(res, 400, { message: '商品名称不能为空' });
      if (!Number.isInteger(amount) || amount < 1 || amount > 100000000) {
        return sendJSON(res, 400, { message: '金额必须是 1 分 ~ 100 万元的整数（单位：分）' });
      }
      let id = String(body.id || '').trim();
      if (id && !/^[\w-]{1,32}$/.test(id)) return sendJSON(res, 400, { message: '商品 ID 只能是字母/数字/下划线/短横线' });
      if (!id) id = 'p' + Date.now().toString(36);
      try {
        const saved = await store.adminUpsertProduct({
          id,
          title,
          desc: String(body.desc || '').trim(),
          amount,
          tag: String(body.tag || '').trim().slice(0, 10),
          sort: Number.isInteger(body.sort) ? body.sort : 99,
          active: body.active !== false,
        });
        await refreshProducts();
        return sendJSON(res, 200, { product: saved });
      } catch (e) {
        await refreshProducts().catch(() => {});
        return sendJSON(res, 502, { message: '保存失败：' + e.message });
      }
    }

    // 删除商品
    if (pathname === '/api/admin/product/delete' && method === 'POST') {
      const body = await readBody(req);
      try {
        const removed = await store.adminDeleteProduct(String(body.id || ''));
        if (!removed) return sendJSON(res, 404, { message: '商品不存在' });
        await refreshProducts();
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        await refreshProducts().catch(() => {});
        return sendJSON(res, 502, { message: '删除失败：' + e.message });
      }
    }

    // 后台退款
    if (pathname === '/api/admin/order/refund' && method === 'POST') {
      const body = await readBody(req);
      const order = db.orders.find((o) => o.id === body.orderId);
      if (!order) return sendJSON(res, 404, { message: '订单不存在' });
      try {
        await refundOrder(order);
      } catch (e) {
        return sendJSON(res, e.status || 502, { message: `退款失败：${e.message}` });
      }
      return sendJSON(res, 200, { order: publicOrder(order), balance: db.user.balance });
    }

    // 关闭未支付订单
    if (pathname === '/api/admin/order/close' && method === 'POST') {
      const body = await readBody(req);
      const order = db.orders.find((o) => o.id === body.orderId);
      if (!order) return sendJSON(res, 404, { message: '订单不存在' });
      if (order.status === 'paid' || order.status === 'refunded') {
        return sendJSON(res, 409, { message: '已支付的订单不能关闭，请走退款' });
      }
      if (order.status !== 'closed') {
        order.status = 'closed';
        order.closedAt = Date.now();
        await persistOrder(order);
      }
      return sendJSON(res, 200, { order: publicOrder(order) });
    }

    return sendJSON(res, 404, { message: '接口不存在' });
  }

  return sendJSON(res, 404, { message: '接口不存在' });
}

/* ------------------------------------------------------------------ */
/* 静态资源                                                            */
/* ------------------------------------------------------------------ */

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname === '/cashier') pathname = '/cashier.html';
  if (pathname === '/admin') pathname = '/admin.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

/** 云端状态：启动时加载一次；失败则在接口层如实报错，不静默降级 */
let cloudReady = false;
let cloudError = null;
async function initCloud(retry = 0) {
  try {
    await loadState();
    cloudReady = true;
    cloudError = null;
    console.log(
      `[cloud] 已连接云数据库：商品 ${db.products.length} 个，订单 ${db.orders.length} 笔，余额 ${db.user.balance} 分`
    );
  } catch (e) {
    cloudReady = false;
    cloudError = e.message;
    console.error('[cloud] 连接失败:', e.message);
    if (retry < 3) setTimeout(() => initCloud(retry + 1), 1500 * (retry + 1));
  }
}

/**
 * CORS：iOS / Android 原生壳（Capacitor）里页面来自 capacitor://localhost，
 * 调线上接口属于跨域，需要显式放行；浏览器同源访问不带 Origin，行为不变。
 */
const CORS_ORIGINS = [
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
];

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  const allowed = CORS_ORIGINS.includes(origin) || process.env.CORS_ALLOW_ALL === '1';
  if (!allowed) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.setHeader('Access-Control-Max-Age', '86400');
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname.startsWith('/api/') || url.pathname === '/manifest.webmanifest') {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJSON(res, 500, { message: e.message || '服务器内部错误' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  手机应用骨架已启动`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log(`  支付渠道: ${PROVIDER}（PAY_PROVIDER 可切换）`);
  initCloud();
  console.log('');
});
