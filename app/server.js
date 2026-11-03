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
const { sign, signPayload, verify, getProvider, channelName, providers } = require('./src/payments');
const { WechatPay } = require('./src/wechatpay');
const { Alipay } = require('./src/alipay');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');

/** 微信支付客户端：凭据齐全时为实例，否则为 null（自动降级到模拟渠道） */
const wxClient = WechatPay.fromEnv();
/** 支付宝客户端：凭据齐全时为实例，否则 null */
const alipayClient = Alipay.fromEnv();

/**
 * 手机网站支付（wap.pay）签约探测。
 * wap.pay 只返回一个签名 URL，构造阶段看不出权限问题，必须真实请求一次才知道。
 * 结果缓存 10 分钟：没签约时前端就只展示「支付宝扫码」，避免用户看到支付宝调试错误页。
 */
let alipayWapProbe = { ok: null, at: 0, code: null };
async function probeAlipayWap(force = false) {
  if (!alipayClient) return false;
  const fresh = alipayWapProbe.ok !== null && Date.now() - alipayWapProbe.at < 10 * 60 * 1000;
  if (!force && fresh) return alipayWapProbe.ok;
  try {
    const url = alipayClient.buildPagePayUrl({ outTradeNo: 'PROBE' + Date.now(), totalAmountFen: 1, subject: '签约探测', wap: true });
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile Safari/604.1' },
    });
    const html = new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
    const denied = /insufficient-isv-permissions|isv\.insufficient/i.test(html);
    alipayWapProbe = { ok: !denied, at: Date.now(), code: denied ? 'insufficient-isv-permissions' : null };
  } catch (e) {
    alipayWapProbe = { ok: false, at: Date.now(), code: 'probe-failed' };
    console.warn('[alipay] wap 探测失败:', e.message);
  }
  console.log(`[alipay] 手机网站支付${alipayWapProbe.ok ? '可用' : '不可用（自动走扫码渠道）'}`);
  return alipayWapProbe.ok;
}
// 启动后异步探一次，不阻塞服务起来
setTimeout(() => probeAlipayWap().catch(() => {}), 2000);
const PROVIDER = (
  process.env.PAY_PROVIDER || (alipayClient ? 'alipay' : wxClient ? 'wechat' : 'mock')
).toLowerCase();

/** 管理后台密码（.env 的 ADMIN_PASSWORD；不设置则后台不可登录） */
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || '').trim();

/**
 * 预览网关要求的 sharecode（.env 的 PUBLIC_SHARECODE）。
 * 网关会把 URL query 里的 sharecode 剥掉，服务端读不到，只能靠环境变量兜底，
 * 否则「添加到主屏幕」的 start_url 变成 /，点开就被网关 403 拦住。
 */
const PUBLIC_SHARECODE = (process.env.PUBLIC_SHARECODE || '').trim();

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
// 网页版用户体系：手机号 + 密码登录，资料 / 余额 / 订单存云库
const users = require('./src/userstore');
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
    .map(({ id, title, desc, amount, tag, memberDays }) => ({
      id,
      title,
      desc,
      amount,
      tag,
      memberDays: Number(memberDays) || 0,
    }));
  return all;
}

/** 从请求头取当前登录用户 id（令牌无效返回 null） */
/** 会话 Cookie：预览网关会剥掉认证请求头，Cookie 作为可靠传输通道 */
function setSessionCookie(res, token) {
  try {
    res.setHeader(
      'Set-Cookie',
      `ut=${encodeURIComponent(token)}; Path=/; Max-Age=${30 * 24 * 3600}; SameSite=Lax`
    );
  } catch {
    /* 忽略 */
  }
}

function currentUserId(req) {
  const h = req.headers || {};
  const cands = [];
  if (h['authorization']) cands.push(h['authorization']);
  if (h['x-user-token']) cands.push(h['x-user-token']);
  if (h['cookie']) {
    const m = String(h['cookie']).match(/(?:^|;\s*)(?:ut|token)=([^;]+)/);
    if (m) cands.push(decodeURIComponent(m[1]));
  }
  if (req._bodyToken) cands.push(req._bodyToken);
  if (req._url) {
    const t = req._url.searchParams.get('t');
    if (t) cands.push(t);
  }
  // 预览网关会注入它自己的 authorization 头，逐个尝试，取第一个能解出用户的
  for (const c of cands) {
    const uid = users.readToken(c);
    if (uid) return uid;
  }
  return null;
}

/** 渠道选择：优先用户选的渠道（必须已配置好），否则回落到默认渠道 */
function pickChannel(requested) {
  const id = String(requested || '').toLowerCase();
  const p = providers[id];
  if (p && p.id !== 'balance' && p.id !== 'mock' && (!p.isReady || p.isReady())) return id;
  return PROVIDER;
}

/** 手机号脱敏：199****3741 */
function maskPhone(phone) {
  const raw = String(phone || '').replace(/\D/g, '');
  if (raw.length < 7) return phone || '';
  return raw.slice(0, 3) + '****' + raw.slice(-4);
}

/** 对外输出用户资料（含脱敏手机号、余额、积分、优惠券、地址、订单） */
async function publicViewer(userId) {
  const data = await users.getUser(userId);
  if (!data) return null;
  const p = data.profile;
  return {
    id: p.id,
    nickname: p.nickname,
    phone: p.phone,
    phoneMasked: maskPhone(p.phone),
    initial: String(p.nickname || '用').trim().slice(0, 1),
    avatar: p.avatar || null,
    points: p.points,
    coupons: p.coupons,
    address: p.address,
    balance: data.balance,
    memberLevel: p.memberLevel || null,
    memberExpire: p.memberExpire || null,
    isMember: users.isMember(p),
    autoRenew: Boolean(p.autoRenew),
    createdAt: p.createdAt,
    orders: data.orders.map((o) => ({
      id: o.id,
      productId: o.product_id,
      title: o.title,
      amount: o.amount,
      channel: o.channel,
      status: o.status,
      createdAt: o.created_at ? new Date(o.created_at).getTime() : null,
      paidAt: o.paid_at ? new Date(o.paid_at).getTime() : null,
    })),
  };
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
  notice: '', // 首页公告（后台可改）
  enableRegister: true, // 是否开放注册
  showMock: true, // 是否向用户展示模拟收银台
  showBalance: true, // 是否向用户展示余额支付
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
    notice: s.notice || '',
    enableRegister: s.enableRegister !== false,
    showMock: s.showMock !== false,
    showBalance: s.showBalance !== false,
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
    notice: site.notice || '',
    enableRegister: site.enableRegister !== false,
    showMock: site.showMock !== false,
    showBalance: site.showBalance !== false,
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
/** 用户头像：前端压到 192px 的 JPEG，正常 8~20KB，留足余量 */
const AVATAR_MAX_BYTES = 256 * 1024;
/** 首页内容配图：前端压到 720px，限制 400KB */
const CONTENT_IMAGE_MAX_BYTES = 400 * 1024;

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

async function readBody(req) {
  if (req._bodyParsed) return req._bodyParsed;
  req._bodyParsed = await new Promise((resolve, reject) => {
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
  return req._bodyParsed;
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
    transactionId: order.transactionId || null,
  };
}

/** 用户表 30 秒缓存：后台订单列表附带买家信息用 */
let userMapCache = { at: 0, map: null };
async function userMap() {
  if (!users.enabled) return {};
  const now = Date.now();
  if (userMapCache.map && now - userMapCache.at < 30000) return userMapCache.map;
  try {
    const list = await users.listUsers();
    const map = {};
    for (const u of list) map[u.id] = { phone: u.phone || '', nickname: u.nickname || '' };
    userMapCache = { at: now, map };
    return map;
  } catch {
    return userMapCache.map || {};
  }
}

/** 后台订单视图：在 publicOrder 基础上附买家（手机号/昵称） */
function adminOrder(order, map) {
  const buyer = (order.userId && map && map[order.userId]) || null;
  return { ...publicOrder(order), userId: order.userId || null, buyer };
}

/* ------------------------------------------------------------------ */
/* 订单业务                                                            */
/* ------------------------------------------------------------------ */

/** 幂等入账：重复回调不会重复加钱、不会覆盖已退款订单 */
function settleOrder(order, source) {
  if (order.status === 'paid') {
    order._dup = true; // 标记重复入账，会员开通等后续步骤据此跳过
    return { ok: true, duplicate: true };
  }
  if (order.status === 'refunded') return { ok: false, message: '订单已退款，忽略回调' };
  if (order.status === 'closed') return { ok: false, message: '订单已关闭，忽略回调' };

  order.status = 'paid';
  order.paidAt = Date.now();
  order.settleSource = source;
  return { ok: true };
}

/** 会员权益：会员商品（memberDays > 0）支付成功后自动开通/续费会员，并写流水。
 *  充值订单（order.recharge）入账后自动加余额。 */
async function grantMembershipForOrder(order) {
  // 充值订单：入账即加余额（app_user_balance_add 内部写余额流水）
  if (order.recharge) {
    if (order._dup) return null;
    if (!users.enabled || !order.userId || order.status !== 'paid') return null;
    try {
      const balance = await users.adjustUserBalance(order.userId, order.amount, 'recharge', order.id);
      console.log(`[recharge] 订单 ${order.id} 充值 ¥${(order.amount / 100).toFixed(2)} 到余额 -> ¥${(balance / 100).toFixed(2)}`);
      return balance;
    } catch (e) {
      console.error('[recharge] 充值入账失败:', order.id, e.message);
      return null;
    }
  }
  // 重复回调/重复查单不重复开通（settleOrder 会标记 _dup）
  if (order._dup) return null;
  if (!users.enabled || !order.userId || order.status !== 'paid') return null;
  const p = db.products.find((x) => x.id === order.productId);
  const days = p ? Number(p.memberDays || 0) : 0;
  if (!days) return null;
  const autoRenew = order.settleSource === 'autorenew';
  try {
    const expire = await users.grantMember(order.userId, days, order.productId);
    console.log(`[member] 订单 ${order.id} 开通会员 ${days} 天 -> 到期 ${expire ? new Date(expire).toLocaleString() : '-'}`);
    await users.appendMemberLog({
      userId: order.userId,
      action: autoRenew ? 'autorenew' : 'purchase',
      source: 'user',
      days,
      productId: order.productId || '',
      orderId: order.id,
      amount: autoRenew ? order.amount : 0, // 自动续费走余额扣款，记录扣了多少钱；用户主动购买金额在订单里
      note: autoRenew ? '到期自动续费（余额扣款）' : '',
      expireAfter: expire ? new Date(expire).toISOString() : '',
    });
    return expire;
  } catch (e) {
    // 入账已完成，会员开通失败只记日志，不影响支付结果
    console.error('[member] 会员开通失败（订单已入账）:', order.id, e.message);
    return null;
  }
}

/**
 * 会员自动续费：到期前 24 小时内，对开启自动续费的用户
 * 从余额扣除续费商品的金额，自动续一个周期。
 * 余额不足则记录 autorenew_fail 流水并跳过（下个周期再试，不重复扣）。
 */
async function autoRenewMemberTick() {
  if (!users.enabled) return { checked: 0, renewed: 0 };
  const DAY = 86400000;
  const now = Date.now();
  let list;
  try {
    list = await users.listUsers();
  } catch (e) {
    return { checked: 0, renewed: 0, error: e.message };
  }
  const targets = list.filter((u) => {
    if (!u.auto_renew) return false;
    const expire = u.member_expire ? new Date(u.member_expire).getTime() : null;
    return expire && expire - now < DAY && expire - now > -DAY; // 到期前 24h ~ 过期后 24h
  });
  let renewed = 0;
  for (const u of targets) {
    try {
      const productId = u.member_product_id || '';
      let product = db.products.find((p) => p.id === productId && p.active !== false && Number(p.memberDays) > 0);
      if (!product) {
        // 找不到原商品（下架/删除）时，退回最便宜的生效会员商品
        product = db.products
          .filter((p) => Number(p.memberDays) > 0 && p.active !== false)
          .sort((a, b) => a.amount - b.amount)[0];
      }
      if (!product) continue; // 没有可续费的会员商品
      const balance = await users.getUserBalance(u.id);
      if (balance < product.amount) {
        await users.appendMemberLog({
          userId: u.id,
          action: 'autorenew_fail',
          source: 'system',
          days: 0,
          productId: product.id,
          amount: product.amount,
          note: `余额不足（需 ¥${(product.amount / 100).toFixed(2)}，现有 ¥${(balance / 100).toFixed(2)}）`,
        });
        continue;
      }
      await users.adjustUserBalance(u.id, -product.amount, 'autorenew', '');
      // 生成续费订单（余额渠道，直接已支付）
      const order = {
        id: newOrderId(),
        userId: u.id,
        productId: product.id,
        title: product.title + '（自动续费）',
        amount: product.amount,
        channel: 'balance',
        status: 'paid',
        settleSource: 'autorenew',
        createdAt: Date.now(),
        paidAt: Date.now(),
      };
      await store.insertOrder(order);
      db.orders.push(order);
      const expire = await grantMembershipForOrder(order);
      renewed += 1;
      console.log(`[autorenew] 用户 ${u.id} 自动续费 ${product.title} ¥${(product.amount / 100).toFixed(2)} -> 到期 ${expire ? new Date(expire).toLocaleString() : '-'}`);
    } catch (e) {
      console.error('[autorenew] 用户续费失败:', u.id, e.message);
    }
  }
  return { checked: targets.length, renewed };
}

/** 会员自动续费定时器：每 30 分钟扫一轮 */
function startMemberAutoRenewSweeper() {
  setInterval(() => autoRenewMemberTick().catch(() => {}), 30 * 60 * 1000);
  setTimeout(() => autoRenewMemberTick().catch(() => {}), 20 * 1000);
}

/**
 * 主动同步：向支付宝查单，确认已付款就入账。
 * 异步通知可能延迟/丢失（公司网络、网关限流、notify_url 未生效等），
 * 这里是兜底通道——用户点「我已完成支付」、页面轮询、后台对账都走它。
 */
const SYNC_INTERVAL_MS = 4000; // 同一订单最小查单间隔，避免轮询打爆支付宝接口
async function syncOrderFromChannel(order, { force = false } = {}) {
  if (!order) return { order, checked: false, reason: 'noorder' };
  if (order.status !== 'pending') return { order, checked: false, reason: 'notpending' };
  const isAlipay = order.channel === 'alipay' || order.channel === 'alipay_qr';
  if (!isAlipay || !alipayClient) return { order, checked: false, reason: 'nochannel' };

  const now = Date.now();
  if (!force && order.lastSyncAt && now - order.lastSyncAt < SYNC_INTERVAL_MS) {
    return { order, checked: false, reason: 'throttled' };
  }
  order.lastSyncAt = now;

  try {
    const q = await alipayClient.query(order.id);
    const tradeStatus = q.trade_status || q.tradeStatus || '';
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(tradeStatus)) {
      return { order, checked: true, paid: false, tradeStatus: tradeStatus || 'WAIT_BUYER_PAY' };
    }
    const fen = Math.round(Number(q.total_amount || q.totalAmount || 0) * 100);
    if (fen && fen !== order.amount) {
      console.warn('[sync] 金额不一致，拒绝入账', order.id, fen, order.amount);
      return { order, checked: true, paid: false, reason: 'amountmismatch', tradeStatus };
    }
    order.transactionId = q.trade_no || q.tradeNo || order.transactionId || null;
    settleOrder(order, 'query');
    await persistOrder(order);
    await grantMembershipForOrder(order);
    console.log(`[sync] 订单 ${order.id} 主动查单确认已支付，交易号 ${order.transactionId || '-'}`);
    return { order, checked: true, paid: true, tradeStatus };
  } catch (e) {
    const code = (e.detail && (e.detail.subCode || e.detail.code)) || e.code || null;
    // ACQ.TRADE_NOT_EXIST：买家还没扫码，属正常情况
    return { order, checked: true, paid: false, error: code || e.message, tradeStatus: 'WAIT_BUYER_PAY' };
  }
}

/** 后台补偿：定时把「待支付但实际已付」的支付宝订单补记入账 */
function startPendingSyncSweeper() {
  const tick = async () => {
    if (!alipayClient) return;
    const now = Date.now();
    const targets = db.orders
      .filter(
        (o) =>
          o.status === 'pending' &&
          (o.channel === 'alipay' || o.channel === 'alipay_qr') &&
          now - (o.createdAt || 0) > 60 * 1000 &&
          now - (o.createdAt || 0) < 60 * 60 * 1000
      )
      .slice(-5);
    for (const o of targets) {
      try {
        const r = await syncOrderFromChannel(o, { force: true });
        if (r.paid) console.log(`[sweeper] 补记订单 ${o.id}`);
      } catch (e) {
        /* 单笔失败不影响下一轮 */
      }
    }
  };
  setInterval(() => tick().catch(() => {}), 60 * 1000);
  setTimeout(() => tick().catch(() => {}), 15 * 1000);
}

/** 退款：真实渠道先调渠道退款接口，站内渠道退回余额；落库失败会抛错由调用方回滚 */
async function refundOrder(order) {
  if (order.status !== 'paid') {
    const err = new Error('只有已支付订单可以退款');
    err.status = 409;
    throw err;
  }
  if (order.recharge) {
    const err = new Error('充值订单不支持退款，请联系商家处理');
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
  let refundedBalance = null;
  if (order.channel === 'balance' || order.channel === 'mock') {
    // 站内渠道：退回下单用户自己的余额；没有归属的老订单退回全局账户
    if (order.userId && users.enabled) {
      refundedBalance = await users.adjustUserBalance(order.userId, order.amount, 'refund', order.id);
    } else {
      db.user.balance += order.amount;
      await persistBalance();
      refundedBalance = db.user.balance;
    }
  }
  await persistOrder(order);
  return { ok: true, balance: refundedBalance };
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
  req._url = url;
  const { pathname } = url;
  const method = req.method;

  // 需要签名的报文（微信支付回调）必须保留原始字节，不能提前解析
  const rawNeeded = /\/notify\//.test(pathname);

  // 预览网关会剥掉 authorization / Cookie 之外的认证通道，先把 body 里的令牌取出来备用
  if (!rawNeeded && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    try {
      const b = await readBody(req);
      if (b && typeof b.__token === 'string') req._bodyToken = b.__token;
    } catch {
      /* 非法 JSON 交给后续路由报错 */
    }
  }

  // 诊断：预览网关到底放行了哪些通道（只回头名，不含任何值）
  if (pathname === '/api/_echo') {
    const body = method === 'POST' ? await readBody(req).catch(() => ({})) : {};
    return sendJSON(res, 200, {
      method,
      headerNames: Object.keys(req.headers || {}).sort(),
      hasAuthorization: Boolean(req.headers.authorization),
      hasUserToken: Boolean(req.headers['x-user-token']),
      hasCookie: Boolean(req.headers.cookie),
      queryKeys: [...url.searchParams.keys()],
      hasQueryToken: Boolean(url.searchParams.get('t')),
      bodyKeys: Object.keys(body || {}),
      hasBodyToken: Boolean(body && body.__token),
    });
  }

  // 启动数据
  if (pathname === '/api/bootstrap' && method === 'GET') {
    if (!cloudReady) {
      return sendJSON(res, 503, {
        message: `云数据库暂不可用：${cloudError || '正在连接'}，请稍后重试`,
      });
    }
    const uid = currentUserId(req);
    // 登录用户：余额与订单都用他自己的；游客不返回订单
    let balance = db.user.balance;
    let recentOrders = [];
    if (uid) {
      try {
        balance = await users.getUserBalance(uid);
      } catch (e) {
        console.error('[bootstrap] 读取用户余额失败:', e.message);
      }
      recentOrders = db.orders.filter((o) => o.userId === uid).slice(-20).reverse();
    }
    const alipayWap = alipayClient ? await probeAlipayWap() : false;
    // 首页内容（后台可增删改）；读不到不影响页面主体
    let contents = [];
    try {
      contents = await store.listContents();
    } catch (e) {
      console.warn('[bootstrap] 读取首页内容失败:', e.message);
    }
    return sendJSON(res, 200, {
      user: { id: db.user.id, nickname: db.user.nickname },
      loggedIn: Boolean(uid),
      balance,
      provider: PROVIDER,
      payScene: (process.env.WX_PAY_SCENE || 'auto').toLowerCase(),
      wechatReady: !!wxClient,
      alipayReady: !!alipayClient,
      channels: { wechat: !!wxClient, alipay: !!alipayClient && alipayWap, alipayQr: !!alipayClient, mock: true },
      wxMchId: process.env.WX_MCHID || null,
      cloud: { ready: cloudReady, endpoint: store.endpoint || null },
      site: publicSite(),
      products: db.products,
      contents,
      orders: recentOrders.map(publicOrder),
    });
  }

  /* ---------------- 用户：注册 / 登录 / 我的 ---------------- */

  if (pathname === '/api/auth/register' && method === 'POST') {
    if (site.enableRegister === false) {
      return sendJSON(res, 403, { message: '当前未开放注册，请联系商家开通账号' });
    }
    const body = await readBody(req);
    const phone = String(body.phone || '').replace(/\D/g, '');
    const password = String(body.password || '');
    const nickname = String(body.nickname || '').trim().slice(0, 16);
    if (!/^1[3-9]\d{9}$/.test(phone)) return sendJSON(res, 400, { message: '请输入正确的 11 位手机号' });
    if (password.length < 6) return sendJSON(res, 400, { message: '密码至少 6 位' });
    if (password.length > 32) return sendJSON(res, 400, { message: '密码最多 32 位' });
    try {
      const out = await users.register({ phone, password, nickname });
      setSessionCookie(res, out.token);
      return sendJSON(res, 201, { token: out.token, viewer: await publicViewer(out.profile.id) });
    } catch (e) {
      const status = e.code === 'PHONE_EXISTS' ? 409 : 502;
      return sendJSON(res, status, { message: e.message || '注册失败' });
    }
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const phone = String(body.phone || '').replace(/\D/g, '');
    const password = String(body.password || '');
    if (!phone || !password) return sendJSON(res, 400, { message: '请输入手机号和密码' });
    try {
      const out = await users.login({ phone, password });
      setSessionCookie(res, out.token);
      return sendJSON(res, 200, { token: out.token, viewer: await publicViewer(out.profile.id) });
    } catch (e) {
      const status = e.code === 'NO_USER' || e.code === 'BAD_PASSWORD' ? 401 : 502;
      return sendJSON(res, status, { message: e.message || '登录失败' });
    }
  }

  // 余额流水：登录用户查看自己的余额变动记录
  if (pathname === '/api/balance/logs' && method === 'GET') {
    const uid = currentUserId(req);
    if (!uid) return sendJSON(res, 401, { message: '请先登录' });
    if (!users.enabled) return sendJSON(res, 501, { message: '未接入用户云库' });
    const url = new URL(req.url, 'http://x');
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    try {
      const logs = await users.listBalanceLogs(uid, limit);
      return sendJSON(res, 200, {
        logs: logs.map((l) => ({
          id: l.id,
          delta: Number(l.delta || 0),
          kind: l.kind || '',
          ref: l.ref || '',
          balanceAfter: Number(l.balance_after || 0),
          createdAt: l.created_at ? new Date(l.created_at).getTime() : null,
        })),
      });
    } catch (e) {
      return sendJSON(res, 502, { message: '读取余额流水失败：' + e.message });
    }
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const uid = currentUserId(req);
    if (!uid) return sendJSON(res, 401, { message: '未登录' });
    try {
      const viewer = await publicViewer(uid);
      if (!viewer) return sendJSON(res, 401, { message: '账号不存在' });
      return sendJSON(res, 200, { viewer });
    } catch (e) {
      return sendJSON(res, 502, { message: e.message || '读取用户信息失败' });
    }
  }

  if (pathname === '/api/auth/profile' && method === 'POST') {
    const uid = currentUserId(req);
    if (!uid) return sendJSON(res, 401, { message: '未登录' });
    const body = await readBody(req);
    const patch = {};
    if (body.nickname !== undefined) {
      const nickname = String(body.nickname || '').trim().slice(0, 16);
      if (!nickname) return sendJSON(res, 400, { message: '昵称不能为空' });
      patch.nickname = nickname;
    }
    if (body.address !== undefined) {
      const a = body.address || {};
      patch.address = {
        name: String(a.name || '').trim().slice(0, 20),
        phone: String(a.phone || '').replace(/\D/g, '').slice(0, 11),
        detail: String(a.detail || '').trim().slice(0, 120),
      };
    }
    if (body.autoRenew !== undefined) {
      // 会员自动续费开关：到期前自动从余额扣款续费
      try {
        await users.setAutoRenew(uid, Boolean(body.autoRenew));
      } catch (e) {
        return sendJSON(res, 502, { message: '自动续费设置失败：' + e.message });
      }
      if (!Object.keys(patch).length) return sendJSON(res, 200, { viewer: await publicViewer(uid) });
    }
    if (body.avatar !== undefined) {
      // 头像是前端画布压好的方形小图（data URL）；空字符串表示恢复默认头像
      const raw = String(body.avatar || '').trim();
      if (!raw) {
        patch.avatar = '';
      } else {
        const parsed = parseDataUrl(raw);
        if (!parsed) return sendJSON(res, 400, { message: '头像格式不正确，请重新选择图片' });
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(parsed.mime)) {
          return sendJSON(res, 400, { message: '头像仅支持 PNG / JPG / WEBP' });
        }
        if (parsed.bytes > AVATAR_MAX_BYTES) {
          return sendJSON(res, 400, { message: '头像太大，请换一张小一点的图片' });
        }
        patch.avatar = raw;
      }
    }
    if (!Object.keys(patch).length) return sendJSON(res, 400, { message: '没有要保存的内容' });
    try {
      await users.updateProfile(uid, patch);
      return sendJSON(res, 200, { viewer: await publicViewer(uid) });
    } catch (e) {
      return sendJSON(res, 502, { message: e.message || '保存失败' });
    }
  }

  if (pathname === '/api/auth/password' && method === 'POST') {
    const uid = currentUserId(req);
    if (!uid) return sendJSON(res, 401, { message: '未登录' });
    const body = await readBody(req);
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!oldPassword) return sendJSON(res, 400, { message: '请输入原密码' });
    if (newPassword.length < 6) return sendJSON(res, 400, { message: '新密码至少 6 位' });
    try {
      await users.changePassword(uid, oldPassword, newPassword);
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      const status = e.code === 'BAD_PASSWORD' ? 400 : 502;
      return sendJSON(res, status, { message: e.message || '修改密码失败' });
    }
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
    const share = (url.searchParams.get('sharecode') || PUBLIC_SHARECODE).trim();
    const sq = share ? 'sharecode=' + encodeURIComponent(share) + '&' : '';
    const icon = (size, mode) =>
      `/api/brand/icon.png?${sq}size=${size}&mode=${mode}&v=${encodeURIComponent(ver)}`;
    const manifest = {
      id: '/',
      name: site.name,
      short_name: site.name.slice(0, 12),
      description: site.tagline || site.name,
      start_url: '/' + (sq ? '?' + sq.replace(/&$/, '') : ''),
      scope: '/',
      display: 'standalone',
      display_override: ['standalone', 'minimal-ui'],
      orientation: 'portrait',
      lang: 'zh-CN',
      dir: 'ltr',
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
    const uid = currentUserId(req);
    if (!uid) return sendJSON(res, 401, { message: '请先登录后再下单' });
    const body = await readBody(req);

    // 余额充值订单：body.recharge 为充值金额（分）
    if (body.recharge !== undefined) {
      const amount = Math.floor(Number(body.recharge));
      if (!Number.isFinite(amount) || amount < 100 || amount > 100000 || amount % 100 !== 0) {
        return sendJSON(res, 400, { message: '充值金额需在 ¥1 ~ ¥1000 之间的整数元' });
      }
      const order = {
        id: newOrderId(),
        userId: uid,
        productId: 'recharge',
        recharge: true,
        title: `余额充值 ¥${(amount / 100).toFixed(2)}`,
        amount,
        channel: null,
        status: 'created',
        createdAt: Date.now(),
      };
      db.orders.push(order);
      try {
        await store.insertOrder(order);
      } catch (e) {
        db.orders.pop();
        return sendJSON(res, 502, { message: '订单创建失败：' + e.message });
      }
      return sendJSON(res, 201, { order: publicOrder(order) });
    }

    const product = db.products.find((p) => p.id === body.productId);
    if (!product) return sendJSON(res, 400, { message: '商品不存在或已下架' });

    const order = {
      id: newOrderId(),
      userId: uid,
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

  // 订单列表：登录后只看自己的
  if (pathname === '/api/orders' && method === 'GET') {
    const uid = currentUserId(req);
    const list = uid ? db.orders.filter((o) => o.userId === uid) : db.orders.filter((o) => !o.userId);
    return sendJSON(res, 200, { orders: list.slice(-50).reverse().map(publicOrder) });
  }

  // 订单详情 / 收银台轮询
  const detailMatch = pathname.match(/^\/api\/orders\/([^/]+)$/);
  if (detailMatch && method === 'GET') {
    const order = db.orders.find((o) => o.id === detailMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    // 待支付的支付宝订单：顺带向支付宝查一次单（内部有 4 秒节流），
    // 这样即使异步通知丢了，用户轮询/点「我已完成支付」也能自动变已支付
    if (order.status === 'pending') await syncOrderFromChannel(order).catch(() => {});
    return sendJSON(res, 200, { order: publicOrder(order) });
  }

  // 主动同步订单状态（「我已完成支付」按钮走这里）：强制查单，不受节流限制
  const syncMatch = pathname.match(/^\/api\/orders\/([^/]+)\/sync$/);
  if (syncMatch && method === 'POST') {
    const order = db.orders.find((o) => o.id === syncMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    // 只能同步自己的订单（后台令牌不受限）
    if (order.userId && currentUserId(req) !== order.userId && !checkAdmin(req)) {
      return sendJSON(res, 403, { message: '无权操作该订单' });
    }
    const r = await syncOrderFromChannel(order, { force: true }).catch((e) => ({
      order,
      checked: false,
      error: e.message,
    }));
    return sendJSON(res, 200, {
      order: publicOrder(order),
      paid: order.status === 'paid',
      checked: Boolean(r.checked),
      tradeStatus: r.tradeStatus || null,
      reason: r.reason || r.error || null,
    });
  }

  // 发起支付
  const payMatch = pathname.match(/^\/api\/orders\/([^/]+)\/pay$/);
  if (payMatch && method === 'POST') {
    const body = await readBody(req);
    const order = db.orders.find((o) => o.id === payMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    if (order.userId && currentUserId(req) !== order.userId && !checkAdmin(req)) {
      return sendJSON(res, 403, { message: '无权操作该订单' });
    }
    if (order.status === 'paid') return sendJSON(res, 409, { message: '订单已支付' });
    if (order.status === 'refunded' || order.status === 'closed') {
      return sendJSON(res, 409, { message: '订单已关闭' });
    }
    // 上次可能已经付成功、只是回调没到：先查一次，确认已付就直接回成功，避免重复下单收款
    if (order.status === 'pending') {
      await syncOrderFromChannel(order).catch(() => {});
      if (order.status === 'paid') {
        return sendJSON(res, 200, { mode: 'already_paid', order: publicOrder(order) });
      }
    }

    const channel = body.channel === 'balance' ? 'balance' : body.channel;
    if (channel === 'balance' && order.recharge) {
      return sendJSON(res, 400, { message: '充值订单不能用余额支付' });
    }
    if (channel === 'balance') {
      // 余额是每个用户自己的账户（accounts 表按 userId 一行），不是全局账户
      const uid = currentUserId(req);
      if (!uid) return sendJSON(res, 401, { message: '请先登录后再使用余额支付' });
      let newBalance;
      try {
        newBalance = await users.adjustUserBalance(uid, -order.amount, 'pay', order.id);
      } catch (e) {
        if (e.code === 'INSUFFICIENT_BALANCE') return sendJSON(res, 400, { message: '余额不足' });
        console.error('[pay] 余额扣减失败:', e.message);
        return sendJSON(res, 502, { message: '余额账户读写失败：' + e.message });
      }
      order.channel = 'balance';
      settleOrder(order, 'balance');
      try {
        await persistOrder(order);
      } catch (e) {
        // 落库失败要回滚扣款
        await users.adjustUserBalance(uid, order.amount, 'refund', order.id).catch(() => {});
        return sendJSON(res, 502, { message: '云端写入失败：' + e.message });
      }
      await grantMembershipForOrder(order);
      return sendJSON(res, 200, { mode: 'balance', order: publicOrder(order), balance: newBalance });
    }

    let provider;
    try {
      let channelId = pickChannel(body.channel);
      // 手机网站支付未生效时自动降级为扫码收款，避免用户看到支付宝调试错误页
      if (channelId === 'alipay' && alipayClient && !(await probeAlipayWap())) {
        channelId = 'alipay_qr';
      }
      provider = getProvider(channelId);
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
        channel: order.channel,
        channelName: channelName(order.channel),
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

  // 支付宝异步通知：验签 -> 校验金额 -> 幂等入账（支付宝要求返回纯文本 success，否则会重试）
  if (pathname === '/api/notify/alipay' && method === 'POST') {
    const raw = await readRawBody(req);
    const params = Object.fromEntries(new URLSearchParams(raw || ''));
    const reply = (text) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(text);
    };
    const client = Alipay.fromEnv();
    if (!client) {
      console.warn('[notify/alipay] 支付宝未配置');
      return reply('failure');
    }
    if (!client.verifyNotify(params)) {
      console.warn('[notify/alipay] 验签失败', params.out_trade_no || '-');
      return reply('failure');
    }
    if (params.app_id && params.app_id !== client.appId) {
      console.warn('[notify/alipay] app_id 不匹配');
      return reply('failure');
    }
    const order = db.orders.find((o) => o.id === params.out_trade_no);
    if (!order) {
      console.warn('[notify/alipay] 未知订单', params.out_trade_no || '-');
      return reply('success');
    }
    if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(params.trade_status)) {
      console.log('[notify/alipay] 非成功状态', order.id, params.trade_status);
      return reply('success');
    }
    const fen = Math.round(Number(params.total_amount || 0) * 100);
    if (fen !== order.amount) {
      console.warn('[notify/alipay] 金额不一致', order.id, fen, order.amount);
      return reply('failure');
    }
    order.transactionId = params.trade_no || null;
    const result = settleOrder(order, 'notify');
    await persistOrder(order);
    await grantMembershipForOrder(order);
    console.log(
      `[notify/alipay] 订单 ${order.id} -> ${order.status}${result.duplicate ? '（重复通知，已幂等处理）' : ''} 支付宝交易号 ${params.trade_no || '-'}`
    );
    return reply('success');
  }

  // 支付宝同步跳回：同步参数不可信，主动查询确认后才入账
  if (pathname === '/api/alipay/return' && method === 'GET') {
    const params = Object.fromEntries(url.searchParams);
    const client = Alipay.fromEnv();
    const orderId = params.out_trade_no || '';
    let paid = false;
    let reason = '';
    if (!client) {
      reason = 'noconfig';
    } else if (!orderId) {
      reason = 'noorder';
    } else {
      try {
        const q = await client.query(orderId);
        const okTrade = ['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(q.trade_status);
        const fen = Math.round(Number(q.total_amount || 0) * 100);
        const order = db.orders.find((o) => o.id === orderId);
        if (okTrade && order && fen === order.amount) {
          order.transactionId = q.trade_no || null;
          settleOrder(order, 'query');
          await persistOrder(order);
          await grantMembershipForOrder(order);
          paid = true;
          console.log(`[alipay/return] 订单 ${order.id} 查询确认已支付`);
        } else if (!order) {
          reason = 'noorder';
        } else {
          reason = String(q.trade_status || 'unpaid').toLowerCase();
        }
      } catch (e) {
        console.warn('[alipay/return] 查询失败:', e.message);
        reason = 'queryfail';
      }
    }
    const qs = new URLSearchParams({ result: paid ? 'paid' : 'cancel' });
    if (orderId) qs.set('orderId', orderId);
    if (reason) qs.set('reason', reason);
    if (PUBLIC_SHARECODE) qs.set('sharecode', PUBLIC_SHARECODE);
    res.writeHead(302, { Location: '/?' + qs.toString() });
    return res.end();
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
      await grantMembershipForOrder(order);
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
    await grantMembershipForOrder(order);
    console.log(`[notify] 订单 ${order.id} -> ${order.status}${result.duplicate ? '（重复回调，已幂等处理）' : ''}`);
    return sendJSON(res, 200, { code: 'SUCCESS', message: 'OK' });
  }

  // 退款
  const refundMatch = pathname.match(/^\/api\/orders\/([^/]+)\/refund$/);
  if (refundMatch && method === 'POST') {
    const order = db.orders.find((o) => o.id === refundMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    let result;
    try {
      result = await refundOrder(order);
    } catch (e) {
      return sendJSON(res, e.status || 502, { message: `退款失败：${e.message}` });
    }
    return sendJSON(res, 200, {
      order: publicOrder(order),
      balance: result && result.balance != null ? result.balance : db.user.balance,
    });
  }

  // 后台：手动同步单笔订单（对账用，强制向支付宝查单）
  const adminSyncMatch = pathname.match(/^\/api\/admin\/orders\/([^/]+)\/sync$/);
  if (adminSyncMatch && method === 'POST') {
    if (!checkAdmin(req)) return sendJSON(res, 401, { message: '登录已过期，请重新登录' });
    const order = db.orders.find((o) => o.id === adminSyncMatch[1]);
    if (!order) return sendJSON(res, 404, { message: '订单不存在' });
    const r = await syncOrderFromChannel(order, { force: true }).catch((e) => ({ checked: false, error: e.message }));
    return sendJSON(res, 200, {
      order: publicOrder(order),
      paid: order.status === 'paid',
      checked: Boolean(r.checked),
      tradeStatus: r.tradeStatus || null,
      reason: r.reason || r.error || null,
    });
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
      alipay: {
        ready: !!alipayClient,
        appId: process.env.ALIPAY_APP_ID || null,
        sandbox: String(process.env.ALIPAY_SANDBOX || '') === '1',
        notifyUrl: process.env.ALIPAY_NOTIFY_URL || null,
        missing: Alipay.missingEnv(),
      },
    });
  }

  // 支付连通性自检：真实请求支付宝，告诉你哪些能力已签约生效
  if (pathname === '/api/admin/pay-check' && method === 'POST') {
    if (!checkAdmin(req)) return sendJSON(res, 401, { message: '登录已过期，请重新登录' });
    const client = Alipay.fromEnv();
    if (!client) {
      return sendJSON(res, 200, { alipay: { ready: false, missing: Alipay.missingEnv().map((m) => m.key) } });
    }
    const out = { alipay: { ready: true, appId: client.appId, sandbox: !!client.sandbox, query: null, wap: null, qr: null } };
    const subOf = (e) => (e.detail && (e.detail.subCode || e.detail.code)) || e.code || 'unknown';
    // ① 基础接口（不需要产品签约）
    try {
      await client.query('CHECK' + Date.now());
      out.alipay.query = { ok: true };
    } catch (e) {
      const code = subOf(e);
      out.alipay.query = { ok: code === 'ACQ.TRADE_NOT_EXIST', code, message: (e.detail && e.detail.subMsg) || e.message };
    }
    // ② 手机网站支付：生成链接后真实请求一次，看支付宝是否拒绝
    const testNo = 'WAPCHECK' + Date.now();
    try {
      const url = client.buildPagePayUrl({ outTradeNo: testNo, totalAmountFen: 1, subject: '签约检测', wap: true });
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Mobile Safari/604.1' },
      });
      const html = new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
      const denied = /insufficient-isv-permissions|isv\.insufficient/i.test(html);
      out.alipay.wap = { ok: !denied, code: denied ? 'insufficient-isv-permissions' : null, message: denied ? '手机网站支付未签约或未生效' : '收银台可正常打开' };
      alipayWapProbe = { ok: !denied, at: Date.now(), code: denied ? 'insufficient-isv-permissions' : null };
    } catch (e) {
      out.alipay.wap = { ok: false, code: subOf(e), message: e.message };
    }
    // ③ 当面付扫码：预下单拿二维码，成功后立即关单
    const qrNo = 'QRCHECK' + Date.now();
    try {
      const codeUrl = await client.precreate({ outTradeNo: qrNo, totalAmountFen: 1, subject: '扫码检测', timeoutExpress: '5m' });
      out.alipay.qr = { ok: !!codeUrl, code: null, message: codeUrl ? '扫码支付可用' : '未返回二维码' };
      client.close(qrNo).catch(() => {});
    } catch (e) {
      out.alipay.qr = { ok: false, code: subOf(e), message: (e.detail && e.detail.subMsg) || e.message };
    }
    console.log('[pay-check]', JSON.stringify(out.alipay));
    return sendJSON(res, 200, out);
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
      let contents = [];
      try {
        contents = await store.adminListContents();
      } catch (e) {
        console.warn('[admin] 读取首页内容失败:', e.message);
      }
      const umap = await userMap();
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
        orders: db.orders.slice(-200).reverse().map((o) => adminOrder(o, umap)),
        products,
        contents,
        site: publicSite(),
        mp: { ready: mpstore.enabled, endpoint: mpstore.endpoint || null },
        pay: {
          provider: PROVIDER,
          scene: (process.env.WX_PAY_SCENE || 'auto').toLowerCase(),
          mchid: process.env.WX_MCHID || null,
          wechatReady: !!wxClient,
          missing: WechatPay.missingEnv(),
          notifyUrl: process.env.WX_NOTIFY_URL || null,
          alipay: {
            ready: !!alipayClient,
            appId: process.env.ALIPAY_APP_ID || null,
            sandbox: String(process.env.ALIPAY_SANDBOX || '') === '1',
            notifyUrl: process.env.ALIPAY_NOTIFY_URL || null,
            missing: Alipay.missingEnv(),
          },
          cloudReady,
        },
      });
    }

    // 小程序用户（手机号）：跨云环境只读，走 app_admin_list_users
    if (pathname === '/api/admin/users' && method === 'GET') {
      // 两个来源合并：网页版 / PWA 用户（本应用云库）+ 小程序用户（独立云环境）
      let webUsers = [];
      let webError = null;
      try {
        webUsers = (await users.listUsers()).map((u) => ({
          id: u.id,
          phone: u.phone || '',
          nickname: u.nickname || '',
          points: Number(u.points || 0),
          balance: Number(u.balance || 0),
          memberLevel: u.member_level || null,
          memberExpire: u.member_expire ? new Date(u.member_expire).getTime() : null,
          isMember: Boolean(u.member_expire && new Date(u.member_expire).getTime() > Date.now()),
          autoRenew: Boolean(u.auto_renew),
          memberProductId: u.member_product_id || '',
          source: 'web',
          createdAt: u.created_at ? new Date(u.created_at).getTime() : null,
          lastLoginAt: u.last_login_at ? new Date(u.last_login_at).getTime() : null,
          orderCount: Number(u.order_count || 0),
          paidAmount: 0,
        }));
      } catch (e) {
        webError = e.message || '读取网页用户失败';
      }

      try {
        const mp = await mpstore.listUsers();
        return sendJSON(res, 200, {
          ready: true,
          source: mpstore.endpoint || null,
          webError,
          users: [
            ...webUsers,
            ...mp.map((u) => ({
              id: u.id,
              phone: u.phone || '',
              nickname: u.nickname || '',
              points: 0,
              balance: 0,
              source: 'mp',
              createdAt: u.created_at ? new Date(u.created_at).getTime() : null,
              lastLoginAt: u.last_login_at ? new Date(u.last_login_at).getTime() : null,
              orderCount: Number(u.order_count || 0),
              paidAmount: Number(u.paid_amount || 0),
            })),
          ],
        });
      } catch (e) {
        // 小程序库不可用时，至少把网页用户返回出来
        return sendJSON(res, 200, {
          ready: true,
          source: null,
          webError,
          mpError: e.message || '读取小程序用户失败',
          users: webUsers,
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
      const notice = body.notice === undefined ? null : String(body.notice || '').trim().slice(0, 200);
      const enableRegister = body.enableRegister === undefined ? undefined : Boolean(body.enableRegister);
      const showMock = body.showMock === undefined ? undefined : Boolean(body.showMock);
      const showBalance = body.showBalance === undefined ? undefined : Boolean(body.showBalance);

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
        saved = await store.adminSaveSettings({
          name,
          tagline,
          notice,
          enableRegister,
          showMock,
          showBalance,
          iconAction,
          iconMime,
          iconData,
          iconThumb,
          iconVer,
        });
      } catch (e) {
        return sendJSON(res, 502, { message: '保存失败：' + e.message });
      }

      site = {
        name: (saved && saved.name) || name,
        tagline: saved ? saved.tagline || '' : tagline,
        notice: saved ? saved.notice || '' : notice,
        enableRegister: saved ? saved.enableRegister !== false : enableRegister !== false,
        showMock: saved ? saved.showMock !== false : showMock !== false,
        showBalance: saved ? saved.showBalance !== false : showBalance !== false,
        iconMime: iconAction === 'set' ? iconMime : iconAction === 'clear' ? null : site.iconMime,
        iconData: iconAction === 'set' ? iconData : iconAction === 'clear' ? null : site.iconData,
        iconThumb: iconAction === 'set' ? iconThumb : iconAction === 'clear' ? null : site.iconThumb,
        iconVer: iconAction === 'set' ? iconVer : iconAction === 'clear' ? null : site.iconVer,
        updatedAt: (saved && saved.updatedAt) || Date.now(),
      };
      iconCache = { ver: null, buf: null, mime: null };
      console.log(
        `[site] 已更新外观：名称「${site.name}」，公告${site.notice ? '已设置' : '为空'}，注册${
          site.enableRegister ? '开放' : '关闭'
        }，图标 ${iconAction === 'set' ? '已替换' : iconAction === 'clear' ? '已恢复默认' : '未变'}`
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
          memberDays: Math.max(0, Math.floor(Number(body.memberDays)) || 0),
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

    // 保存首页内容（新增或更新）
    if (pathname === '/api/admin/content/save' && method === 'POST') {
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      if (!title) return sendJSON(res, 400, { message: '标题不能为空' });
      if ([...title].length > 40) return sendJSON(res, 400, { message: '标题最多 40 个字' });
      let id = String(body.id || '').trim();
      if (id && !/^[\w-]{1,32}$/.test(id)) return sendJSON(res, 400, { message: '内容 ID 只能包含字母/数字/下划线/短横线' });
      if (!id) id = 'c' + Date.now().toString(36);

      let image = null;
      if (body.image) {
        const parsed = parseDataUrl(body.image);
        if (!parsed) return sendJSON(res, 400, { message: '配图格式不正确，请重新上传' });
        if (!ICON_MIME_OK.includes(parsed.mime)) return sendJSON(res, 400, { message: '配图仅支持 PNG / JPG / WEBP' });
        if (parsed.bytes > CONTENT_IMAGE_MAX_BYTES) {
          return sendJSON(res, 400, { message: `配图太大（${Math.round(parsed.bytes / 1024)}KB），请换一张或压缩后再传` });
        }
        image = String(body.image).trim();
      }

      const link = String(body.link || '').trim();
      if (link && !/^(https?:\/\/|\/)/i.test(link)) {
        return sendJSON(res, 400, { message: '跳转地址要以 http(s):// 或 / 开头' });
      }
      try {
        const saved = await store.adminUpsertContent({
          id,
          title,
          desc: String(body.desc || '').trim().slice(0, 200),
          tag: String(body.tag || '').trim().slice(0, 10),
          image,
          link,
          sort: Number.isInteger(body.sort) ? body.sort : 100,
          active: body.active !== false,
        });
        return sendJSON(res, 200, { content: saved });
      } catch (e) {
        return sendJSON(res, 502, { message: '保存失败：' + e.message });
      }
    }

    // 删除首页内容
    if (pathname === '/api/admin/content/delete' && method === 'POST') {
      const body = await readBody(req);
      try {
        const removed = await store.adminDeleteContent(String(body.id || ''));
        if (!removed) return sendJSON(res, 404, { message: '内容不存在' });
        return sendJSON(res, 200, { ok: true });
      } catch (e) {
        return sendJSON(res, 502, { message: '删除失败：' + e.message });
      }
    }

    // 后台退款
    if (pathname === '/api/admin/order/refund' && method === 'POST') {
      const body = await readBody(req);
      const order = db.orders.find((o) => o.id === body.orderId);
      if (!order) return sendJSON(res, 404, { message: '订单不存在' });
      let result;
      try {
        result = await refundOrder(order);
      } catch (e) {
        return sendJSON(res, e.status || 502, { message: `退款失败：${e.message}` });
      }
      return sendJSON(res, 200, {
        order: publicOrder(order),
        balance: result && result.balance != null ? result.balance : db.user.balance,
      });
    }

    // 会员管理：开通 / 续费（天数累加，重复操作安全）
    if (pathname === '/api/admin/member/grant' && method === 'POST') {
      const body = await readBody(req);
      if (!users.enabled) return sendJSON(res, 501, { message: '未接入用户云库，无法管理会员' });
      const days = Math.floor(Number(body.days));
      if (!body.userId || !Number.isFinite(days) || days <= 0) {
        return sendJSON(res, 400, { message: '参数错误：需要 userId 和大于 0 的天数' });
      }
      if (days > 3650) return sendJSON(res, 400, { message: '单次最多 3650 天' });
      try {
        const expire = await users.grantMember(body.userId, days);
        await users.appendMemberLog({
          userId: body.userId,
          action: 'grant',
          source: 'admin',
          days,
          note: String(body.note || '后台开通/续费'),
          expireAfter: expire ? new Date(expire).toISOString() : '',
        });
        return sendJSON(res, 200, { ok: true, expire });
      } catch (e) {
        return sendJSON(res, 502, { message: '开通失败：' + e.message });
      }
    }

    // 会员管理：取消会员
    if (pathname === '/api/admin/member/revoke' && method === 'POST') {
      const body = await readBody(req);
      if (!users.enabled) return sendJSON(res, 501, { message: '未接入用户云库，无法管理会员' });
    if (!body.userId) return sendJSON(res, 400, { message: '缺少 userId' });
    try {
      await users.revokeMember(body.userId);
      await users.appendMemberLog({
        userId: body.userId,
        action: 'revoke',
        source: 'admin',
        days: 0,
        note: String(body.note || '后台取消会员'),
      });
      return sendJSON(res, 200, { ok: true });
    } catch (e) {
      return sendJSON(res, 502, { message: '取消失败：' + e.message });
    }
  }

  // 会员流水：后台查看每个会员是自购 / 自动续费 / 赠送
  if (pathname === '/api/admin/member/logs' && method === 'GET') {
    if (!users.enabled) return sendJSON(res, 501, { message: '未接入用户云库' });
    const url = new URL(req.url, 'http://x');
    const uid = url.searchParams.get('userId') || '';
    try {
      const logs = await users.listMemberLogs(uid, Math.min(Number(url.searchParams.get('limit')) || 200, 500));
      return sendJSON(res, 200, { logs });
    } catch (e) {
      return sendJSON(res, 502, { message: '读取流水失败：' + e.message });
    }
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
  // 拆分布署：前端页面放在自己的备案域名上，接口仍在本服务
  // 在 .env 里写 CORS_EXTRA_ORIGINS=https://pay.example.com,https://www.example.com
  ...String(process.env.CORS_EXTRA_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
];

function applyCors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin) return false;
  const allowed = CORS_ORIGINS.includes(origin) || process.env.CORS_ALLOW_ALL === '1';
  if (!allowed) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, Authorization, X-User-Token');
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
  startPendingSyncSweeper(); // 兜底：每分钟把「已付但状态没变」的支付宝订单补记入账
  startMemberAutoRenewSweeper(); // 会员自动续费：每 30 分钟扫一遍到期用户
  console.log('');
});
