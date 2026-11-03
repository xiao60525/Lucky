'use strict';
/* ------------------------------------------------------------------
   手机应用骨架 · 前端
   纯原生 JS，无构建、无依赖。
------------------------------------------------------------------ */

const $ = (s) => document.querySelector(s);
// 拆分布署：页面放在自己的备案域名上、接口跑在别处时，
// 在 index.html 的 app.js 之前注入 window.__API_BASE__ = 'https://接口域名'
const API_BASE = String(window.__API_BASE__ || '').replace(/\/+$/, '');
const view = $('#view');
const sheetEl = $('#sheet');
const maskEl = $('#mask');
const toastEl = $('#toast');

const state = {
  user: null,
  viewer: null, // 登录后的用户资料（手机号 / 积分 / 优惠券 / 地址 / 余额 / 订单）
  balance: 0,
  provider: 'mock',
  payScene: 'native',
  wechatReady: false,
  alipayReady: false,
  channels: { wechat: false, alipay: false, mock: true },
  wxMchId: '',
  site: { name: 'App', tagline: '', iconUrl: null, hasIcon: false },
  products: [],
  contents: [],
  orders: [],
  tab: 'home',
  loaded: false,
};

const sheetState = { type: null, product: null, order: null, channel: 'wechat' };

const STATUS_TEXT = {
  created: '待支付',
  pending: '支付中',
  paid: '已支付',
  closed: '已关闭',
  refunded: '已退款',
};

const ICON = {
  box: '<svg viewBox="0 0 24 24"><path d="M12 3 3 7.5v9L12 21l9-4.5v-9z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>',
  wechat: '<svg viewBox="0 0 24 24"><path d="M9.2 4C5.4 4 2.4 6.6 2.4 9.8c0 1.8 1 3.4 2.6 4.5l-.6 1.9 2.2-1.1c.8.2 1.7.4 2.6.4h.6a5 5 0 0 1-.2-1.4c0-3.1 2.9-5.6 6.5-5.6h.5C16.1 5.9 12.9 4 9.2 4m-2.4 3.2a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8m4.8 0a.9.9 0 1 1 0 1.8.9.9 0 0 1 0-1.8"/><path d="M21.6 14.1c0-2.6-2.6-4.7-5.7-4.7s-5.7 2.1-5.7 4.7 2.6 4.7 5.7 4.7c.7 0 1.3-.1 1.9-.3l1.8.9-.5-1.6c1.5-.9 2.5-2.2 2.5-3.7m-7.6-1.4a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6m3.9 0a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6"/></svg>',
  alipay:
    '<svg viewBox="0 0 24 24"><path d="M19.4 15.9c1.4.5 2.9 1 4.6 1.4V22c-4.7-.5-8.6-1.7-11.6-3.5-2 2-5 3.4-8.2 3.4H4V3h5.6v5H6.2v2.4h3.4v3.4H6.2v2.4h3.4v4.1c1.5-.4 2.8-1.2 3.8-2.2-1.9-1.6-3.3-3.7-3.6-6h3.1c.3 1.5 1.1 2.9 2.3 4 1.6-1.2 2.7-2.7 3.3-4.6H3.5V3h16.9v2.4h-6.3v2.5h5.1v2.4h-5.1v1.9c1.9.9 3.7 2.1 5.3 3.7"/></svg>',
  balance:
    '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="13" rx="3"/><circle cx="17" cy="12.5" r="1.6" fill="#ff9f0a"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 13 4.5 4.5L19 7"/></svg>',
};

/* ---------------- 基础工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function yuan(cents) {
  return '¥' + (cents / 100).toFixed(2);
}

function timeText(ts) {
  if (!ts) return '--';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/* ---------------- 登录态 ---------------- */

const TOKEN_KEY = 'user_token_v1';

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (e) {
    /* 无痕模式忽略 */
  }
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  let url = API_BASE + path;
  if (token) {
    headers.Authorization = 'Bearer ' + token;
    headers['x-user-token'] = token;
    // 预览网关会剥掉认证相关请求头，URL 参数作为兜底通道
    url += (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(token);
  }
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    body:
      token && options.body && typeof options.body === 'string' && /^(POST|PUT|PATCH)$/i.test(options.method || '')
        ? (() => {
            try {
              return JSON.stringify({ ...JSON.parse(options.body), __token: token });
            } catch {
              return options.body;
            }
          })()
        : options.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `请求失败(${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** 拉取当前登录用户；令牌失效自动清掉 */
async function loadViewer() {
  if (!getToken()) {
    state.viewer = null;
    return null;
  }
  try {
    const { viewer } = await api('/api/auth/me');
    state.viewer = viewer;
    return viewer;
  } catch (e) {
    if (e.status === 401) setToken('');
    state.viewer = null;
    return null;
  }
}

let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}

/* ---------------- 弹层 ---------------- */

function openSheet(html) {
  sheetEl.innerHTML = `<div class="sheet-handle"></div>${html}`;
  requestAnimationFrame(() => {
    maskEl.classList.add('show');
    sheetEl.classList.add('show');
  });
}

function closeSheet() {
  maskEl.classList.remove('show');
  sheetEl.classList.remove('show');
  sheetState.type = null;
}

/* ---------------- 品牌（名称 / 图标，来自后台） ---------------- */

/** 预览域名需要 sharecode 才能取到接口资源，从地址栏取出并透传 */
const SHARECODE =
  new URLSearchParams(location.search).get('sharecode') ||
  (window.__NATIVE__ && window.__NATIVE__.sharecode) ||
  null;

/**
 * 补全资源地址：
 * 1) 原生 App（Capacitor）里页面来自 capacitor://localhost，图片等资源要指向线上域名；
 * 2) 预览域名需要 sharecode 才放行，统一附上。
 */
function withShare(p) {
  if (!p) return p;
  let out = p;
  if (window.__NATIVE__ && p.charAt(0) === '/') out = window.__NATIVE__.origin + p;
  // 外部链接（如支付宝网关）绝对不能追加参数，会破坏对方的签名
  const isExternal = /^https?:\/\//i.test(out) && !/workbuddy\.host/i.test(out);
  if (isExternal) return out;
  if (!SHARECODE) return out;
  if (/[?&]sharecode=/.test(out)) return out;
  return out + (out.includes('?') ? '&' : '?') + 'sharecode=' + encodeURIComponent(SHARECODE);
}

/** 图标节点：有自定义图标用图，否则用「名称首字」占位 */
function logoHTML(cls) {
  const s = state.site || {};
  if (s.hasIcon && s.iconUrl) {
    return `<span class="${cls}"><img src="${esc(withShare(s.iconUrl))}" alt="${esc(s.name)}" /></span>`;
  }
  return `<span class="${cls}">${esc((s.name || 'A').trim().slice(0, 1) || 'A')}</span>`;
}

/** 把名称、图标应用到标题栏 / 浏览器标题 / favicon */
function applySite() {
  const s = state.site || {};
  const name = (s.name || 'App').trim() || 'App';
  document.title = name;

  const nameEl = $('#brandName');
  if (nameEl) nameEl.textContent = name;
  const logoEl = $('#brandLogo');
  if (logoEl) {
    logoEl.innerHTML =
      s.hasIcon && s.iconUrl
        ? `<img src="${esc(withShare(s.iconUrl))}" alt="${esc(name)}" />`
        : esc(name.slice(0, 1));
  }
  const brandEl = $('#topbarBrand');
  if (brandEl) brandEl.title = name;

  // favicon / 主屏图标：只有在后台设了自定义图标时才覆盖，否则保留服务端默认
  const href = withShare(s.iconUrl || '/api/brand/icon');
  const icon = $('#appIcon');
  if (icon) icon.href = href;
  applyIosApp();
}

/* ---------------- iOS App（添加到主屏幕） ---------------- */

/** 是否已从主屏幕图标打开（iOS 是 navigator.standalone，Chrome 看 display-mode） */
function isStandalone() {
  return (
    window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}

function isIOS() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** 图标 / 清单 / 启动图按当前名称与图标版本刷新 */
function applyIosApp() {
  const s = state.site || {};
  const ver = encodeURIComponent(s.iconVer || 'default');

  // iOS 主屏图标：只认 PNG，用服务端生成的全出血图（iOS 自己裁圆角）
  const apple = $('#appleIcon');
  if (apple) apple.href = withShare(`/api/brand/icon.png?size=180&mode=bleed&v=${ver}`);

  // 启动图 / 清单补 sharecode（预览网关要求）
  document.querySelectorAll('link[rel="apple-touch-startup-image"]').forEach((l) => {
    if (!SHARECODE || /[?&]sharecode=/.test(l.getAttribute('href') || '')) return;
    l.setAttribute('href', withShare(l.getAttribute('href')));
  });

  const m = $('#manifestLink');
  if (m && !/sharecode=/.test(m.getAttribute('href') || '')) m.setAttribute('href', withShare(m.getAttribute('href')));

  const t = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (t) t.content = s.name || 'App';
}

/** 注册 Service Worker（离线可用 + 桌面图标体验）；原生壳内不支持，跳过 */
function registerSW() {
  if (window.__NATIVE__) return;
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname)) return;
  navigator.serviceWorker.register(withShare('/sw.js')).catch(() => {
    /* 注册失败不影响正常使用 */
  });
}

/** iOS Safari 里提示「添加到主屏幕」，从主屏打开后不再出现 */
function maybeShowInstallHint() {
  if (isStandalone() || !isIOS()) return;
  try {
    if (localStorage.getItem('a2hs_dismissed') === '1') return;
  } catch {
    /* 无痕模式读不了 storage，照样展示 */
  }
  const name = (state.site && state.site.name) || '本应用';
  const el = document.createElement('div');
  el.className = 'a2hs';
  el.innerHTML = `
    <img class="a2hs-icon" src="${esc(withShare(`/api/brand/icon.png?size=96&mode=bleed&v=${encodeURIComponent(state.site.iconVer || 'default')}`))}" alt="" />
    <div class="a2hs-main">
      <b>把「${esc(name)}」装到桌面</b>
      <span>点 Safari 底部 <i class="a2hs-share"></i> 分享，再选「添加到主屏幕」，即可全屏打开。</span>
    </div>
    <button class="a2hs-close" type="button" aria-label="关闭">✕</button>`;
  el.querySelector('.a2hs-close').onclick = () => {
    el.remove();
    try {
      localStorage.setItem('a2hs_dismissed', '1');
    } catch {
      /* ignore */
    }
  };
  document.body.appendChild(el);
}

/* ---------------- 渲染：首页 ---------------- */

/** 头像：有图用图，没图用昵称首字 */
function avatarHTML(v, cls) {
  const src = v && v.avatar;
  const initial = (v && (v.initial || v.nickname)) || '用';
  if (src) return `<span class="${cls} has-img"><img src="${esc(src)}" alt="头像" /></span>`;
  return `<span class="${cls}">${esc(String(initial).trim().slice(0, 1) || '用')}</span>`;
}

/** 商品缩略图标：没有商品图时用一组中性 emoji 轮换，看起来不至于太空 */
const GOODS_ICONS = ['🧩', '💎', '🪙', '🎟️', '🎁', '⭐'];

function contentCardHTML(c, big = false) {
  const thumb = c.image
    ? `<span class="content-thumb"><img src="${esc(c.image)}" alt="${esc(c.title)}" /></span>`
    : `<span class="content-thumb is-blank"><span>${esc((c.title || '内').trim().slice(0, 1))}</span></span>`;
  const body = `
    ${thumb}
    <span class="content-main">
      <span class="content-title">${esc(c.title)}${c.tag ? `<span class="tag tag-blue">${esc(c.tag)}</span>` : ''}</span>
      ${c.desc ? `<span class="content-desc">${esc(c.desc)}</span>` : ''}
    </span>`;
  const cls = 'content-card' + (big ? ' is-big' : '');
  if (c.link) {
    return `<a class="${cls}" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
  }
  return `<div class="${cls}">${body}</div>`;
}

function renderHome() {
  const s = state.site || {};
  const v = state.viewer;
  const paidCount = state.orders.filter((o) => o.status === 'paid').length;
  const title = s.tagline ? esc(s.tagline) : '选一件商品，走一遍完整支付';
  const channelName = state.channels.wechat
    ? '微信支付'
    : state.channels.alipay
      ? '支付宝'
      : state.channels.alipayQr
        ? '支付宝扫码'
        : '模拟收银台';
  const noticeHTML = s.notice
    ? `<div class="notice-bar"><span class="notice-icon">📢</span><span class="notice-text">${esc(s.notice)}</span></div>`
    : '';
  const contents = state.contents || [];
  const goods = state.products || [];

  return `
    <div class="hero">
      <div class="hero-top">
        <div class="hero-brand">
          ${logoHTML('hero-logo')}
          <span class="hero-appname">${esc(s.name || 'App')}</span>
        </div>
        <button class="hero-avatar" data-act="${v ? 'go-mine' : 'go-login'}" aria-label="${v ? '我的' : '登录'}">
          ${v ? avatarHTML(v, 'avatar-sm') : '<span class="avatar-sm">游</span>'}
        </button>
      </div>
      <div class="hero-greet">${greeting()}，${v ? esc(v.nickname) : '欢迎光临'}</div>
      <div class="hero-title">${title}</div>
      <div class="hero-meta">
        <span class="hero-chip">${channelName}</span>
        <span class="hero-chip">已支付 ${paidCount} 笔</span>
        ${v ? `<span class="hero-chip">余额 ${yuan(state.balance)}</span>` : ''}
      </div>
    </div>
    ${noticeHTML}

    <div class="section-head"><h2>在售商品</h2><span>${goods.length} 件</span></div>
    ${
      goods.length
        ? `<div class="goods-grid">${goods
            .map(
              (p, i) => `
        <button class="goods-card" data-act="buy" data-id="${esc(p.id)}">
          <span class="goods-emoji">${GOODS_ICONS[i % GOODS_ICONS.length]}</span>
          <span class="goods-name">${esc(p.title)}</span>
          ${p.desc ? `<span class="goods-desc">${esc(p.desc)}</span>` : ''}
          <span class="goods-foot">
            <b>${yuan(p.amount)}</b>
            <em>${esc(p.tag || '购买')}</em>
          </span>
        </button>`
            )
            .join('')}</div>`
        : `<div class="card"><div class="empty" style="padding:22px 8px"><p>后台还没有上架商品</p></div></div>`
    }

    <div class="section-head">
      <h2>精选内容</h2>
      <span>${contents.length ? contents.length + ' 条' : '待添加'}</span>
    </div>
    ${
      contents.length
        ? `<div class="content-list">${contents.slice(0, 4).map((c) => contentCardHTML(c)).join('')}</div>
           ${
             contents.length > 4
               ? `<button class="more-link" data-act="go-content">查看全部 ${contents.length} 条 ›</button>`
               : ''
           }`
        : `<div class="card">
             <div class="empty" style="padding:22px 10px">
               <div class="empty-icon">${ICON.box}</div>
               <h3>还没有内容</h3>
               <p>在后台「首页内容」里加几条，这里就会显示</p>
             </div>
           </div>`
    }
  `;
}

/* ---------------- 渲染：内容 ---------------- */

function renderContent() {
  const contents = state.contents || [];
  if (!contents.length) {
    return `
      <div class="section-head" style="margin-top:14px"><h2>内容</h2><span>0 条</span></div>
      <div class="card">
        <div class="empty">
          <div class="empty-icon">${ICON.box}</div>
          <h3>还没有内容</h3>
          <p>在后台「首页内容」里添加图文，<br/>这里会自动同步显示</p>
        </div>
      </div>`;
  }
  return `
    <div class="section-head" style="margin-top:14px"><h2>内容</h2><span>${contents.length} 条</span></div>
    <div class="content-list">${contents.map((c) => contentCardHTML(c, true)).join('')}</div>`;
}

/* ---------------- 渲染：我的 ---------------- */

/** 分享链接：已装到桌面 / 直接转发都用它 */
function shareUrl() {
  const base = location.origin + '/';
  return SHARECODE ? base + '?sharecode=' + encodeURIComponent(SHARECODE) : base;
}

function couponText(c) {
  return '¥' + (Number(c.amount || 0) / 100).toFixed(0);
}

/** 未登录：手机号 + 密码 */
function renderLogin() {
  const s = state.site || {};
  return `
    <div class="card auth" style="margin-top:10px">
      <div class="auth-head">
        ${logoHTML('auth-logo')}
        <h2>登录后使用</h2>
        <p>手机号 + 密码登录，可下单、查看订单、领优惠券</p>
      </div>
      <label class="field">
        <span>手机号</span>
        <input id="authPhone" type="tel" inputmode="numeric" maxlength="11" placeholder="请输入 11 位手机号" autocomplete="tel" />
      </label>
      <label class="field">
        <span>密码</span>
        <input id="authPwd" type="password" maxlength="32" placeholder="至少 6 位" autocomplete="current-password" />
      </label>
      <label class="field">
        <span>昵称（注册时选填）</span>
        <input id="authNick" maxlength="16" placeholder="怎么称呼你" autocomplete="nickname" />
      </label>
      <button class="btn-primary" data-act="login" style="margin-top:14px">登录</button>
      ${state.site && state.site.enableRegister === false
        ? '<p class="auth-tip" style="color:#e5484d">暂未开放注册，如需账号请联系商家</p>'
        : '<button class="btn-ghost" data-act="register" style="margin-top:10px">没有账号？注册新用户</button>'}
      <p class="auth-tip">${esc(s.name || '本应用')} · 手机号仅用于登录与订单联系</p>
    </div>`;
}

/** 我的页订单筛选（内存态） */
let mineOrderFilter = 'all';

function mineChannelName(o) {
  if (o.channelName) return o.channelName;
  const names = { wechat: '微信支付', alipay: '支付宝', alipay_qr: '支付宝扫码', balance: '余额', mock: '模拟收银台' };
  return names[o.channel] || '';
}

/** 待支付 / 支付中：都还能继续付款 */
function isUnpaid(o) {
  return Boolean(o) && (o.status === 'created' || o.status === 'pending');
}

function mineOrderRow(o) {
  const meta = [esc(o.id), timeText(o.createdAt)].join(' · ');
  const ch = mineChannelName(o);
  const chTag = ch && o.status !== 'created' ? `<span class="tag tag-blue" style="margin-left:6px">${esc(ch)}</span>` : '';
  // 没付完的订单给一个明确入口，点整行就直接进支付界面
  const cta = isUnpaid(o) ? `<span class="order-cta">继续支付 ›</span>` : '';
  return `
    <button class="order-row" data-act="order" data-id="${esc(o.id)}">
      <span class="order-main">
        <span class="order-title">${esc(o.title)}${chTag}</span>
        <span class="order-meta">${meta}</span>
      </span>
      <span class="order-right">
        <span class="order-amount">${yuan(o.amount)}</span>
        <span class="status ${esc(o.status)}">${STATUS_TEXT[o.status] || o.status}</span>
        ${cta}
      </span>
    </button>`;
}

/** 订单筛选：待支付把 created / pending 合并成一类 */
const ORDER_FILTERS = {
  all: { label: '全部', match: () => true },
  unpaid: { label: '待支付', match: (o) => isUnpaid(o) },
  paid: { label: '已支付', match: (o) => o.status === 'paid' },
  refunded: { label: '已退款', match: (o) => o.status === 'refunded' },
};

function mineOrderList(orders) {
  if (!orders.length) {
    return `<div class="empty" style="padding:26px 8px">
      <h3>还没有订单</h3>
      <p>去首页挑个商品试试</p>
    </div>`;
  }
  const chips = Object.entries(ORDER_FILTERS)
    .map(([k, f]) => ({ k, label: f.label, n: orders.filter(f.match).length }))
    .filter((x) => x.k === 'all' || x.n > 0)
    .map(
      (x) =>
        `<button class="mchip ${mineOrderFilter === x.k ? 'on' : ''}" data-act="mine-filter" data-f="${x.k}">${x.label} ${x.n}</button>`
    )
    .join('');
  const filter = ORDER_FILTERS[mineOrderFilter] || ORDER_FILTERS.all;
  const list = orders.filter(filter.match);
  return `
    <div class="mchips">${chips}</div>
    ${list.length ? list.map(mineOrderRow).join('') : '<div class="empty" style="padding:20px 8px"><p>该状态下暂无订单</p></div>'}`;
}

/** 已登录：头像 / 昵称 / 手机号 / 余额 / 积分 / 优惠券 / 地址 / 订单 / 分享 / 设置 */
/** 会员是否生效 */
function isMemberActive(v) {
  return Boolean(v && v.memberExpire && v.memberExpire > Date.now());
}

/** 「我的」页会员卡：生效中显示到期时间，否则引导开通 */
function memberBannerHTML(v) {
  const active = isMemberActive(v);
  const hasGoods = state.products.some((p) => Number(p.memberDays) > 0);
  const expire = active ? new Date(v.memberExpire).toLocaleDateString('zh-CN') : '';
  const daysLeft = active ? Math.max(1, Math.ceil((v.memberExpire - Date.now()) / 86400000)) : 0;
  const renewTag = active && v.autoRenew ? '<span class="tag tag-gold">自动续费已开启</span>' : '';
  return `
    <button class="member-card ${active ? 'is-member' : ''}" data-act="open-member">
      <span class="member-crown">👑</span>
      <span class="member-main">
        <b>${active ? '会员生效中' : hasGoods ? '开通会员' : '会员中心'}</b>
        <i>${active ? `有效期至 ${expire} · 剩 ${daysLeft} 天 ${renewTag}` : hasGoods ? '专属权益 · 点此开通' : '敬请期待'}</i>
      </span>
      <span class="member-arrow">›</span>
    </button>`;
}

/** 会员中心弹层：展示会员商品 + 自动续费开关 */
function memberSheet() {
  const v = state.viewer;
  const active = isMemberActive(v);
  const goods = state.products.filter((p) => Number(p.memberDays) > 0);
  const renewOn = Boolean(v.autoRenew);
  openSheet(`
    <h3>会员中心</h3>
    <div class="member-status ${active ? 'on' : ''}">
      <b>${active ? '👑 会员生效中' : '当前不是会员'}</b>
      <i>${active ? `有效期至 ${new Date(v.memberExpire).toLocaleDateString('zh-CN')}` : '开通后立享会员专属权益'}</i>
    </div>
    ${
      goods.length
        ? `<div class="member-goods">${goods
            .map(
              (p) => `
        <div class="member-item">
          <span class="member-item-main">
            <b>${esc(p.title)}</b>
            <i>送 ${p.memberDays} 天会员${p.desc ? ' · ' + esc(p.desc) : ''}</i>
          </span>
          <button class="member-buy" data-act="buy" data-id="${esc(p.id)}">¥${(p.amount / 100).toFixed(2)}</button>
        </div>`
            )
            .join('')}</div>`
        : '<p class="sheet-sub">商家还没有上架会员商品，敬请期待</p>'
    }
    <button class="autorenew-row ${renewOn ? 'on' : ''}" data-act="toggle-autorenew">
      <span class="autorenew-main">
        <b>🔄 自动续费</b>
        <i>${renewOn ? '到期前自动从余额扣款续费，随时可关' : '开启后到期自动续费，不再断档'}</i>
      </span>
      <span class="switch ${renewOn ? 'on' : ''}"><span class="knob"></span></span>
    </button>
    <p class="cashier-note">购买会员商品支付成功后自动开通，重复购买到期时间自动顺延${renewOn ? '；自动续费将从余额扣款，请保持余额充足' : ''}</p>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>
  `);
}

/** 开/关会员自动续费 */
async function toggleAutoRenew() {
  const next = !state.viewer.autoRenew;
  if (next && isMemberActive(state.viewer) && state.viewer.balance < 100) {
    toast('开启前请先确认余额充足，续费将从余额扣款');
  }
  try {
    await api('/api/auth/profile', { method: 'POST', body: JSON.stringify({ autoRenew: next }) });
    state.viewer.autoRenew = next;
    toast(next ? '已开启自动续费' : '已关闭自动续费');
    memberSheet();
    render();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------------- 余额中心：余额流水 + 充值 ---------------- */

const BALANCE_KIND_TEXT = {
  recharge: '充值',
  pay: '消费',
  refund: '退款',
  autorenew: '会员自动续费',
  admin: '后台调整',
};

function balKindText(l) {
  const t = BALANCE_KIND_TEXT[l.kind] || '余额变动';
  return l.ref ? `${t} · ${l.ref}` : t;
}

/** 余额中心弹层：当前余额 + 充值入口 + 流水列表 */
function balanceSheet() {
  openSheet(`
    <h3>余额中心</h3>
    <div class="member-status on">
      <b>¥${((state.viewer.balance || 0) / 100).toFixed(2)}</b>
      <i>余额可用于下单支付、会员自动续费</i>
    </div>
    <button class="btn-primary" data-act="recharge" style="margin-top:12px">充值到余额</button>
    <div class="bal-log-head">余额流水</div>
    <div id="balLogs"><p class="sheet-sub">加载中…</p></div>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>
  `);
  loadBalanceLogs();
}

async function loadBalanceLogs() {
  try {
    const r = await api('/api/balance/logs?limit=50');
    const rows = r.logs || [];
    const box = window.document.querySelector('#balLogs');
    if (!box) return;
    box.innerHTML = rows.length
      ? `<div class="bal-logs">${rows
          .map((l) => {
            const delta = Number(l.delta || 0);
            const t = l.createdAt ? new Date(l.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
            return `<div class="bal-row">
          <span class="bal-main"><b>${esc(balKindText(l))}</b><i>${t}</i></span>
          <span class="bal-delta ${delta >= 0 ? 'plus' : 'minus'}">${delta >= 0 ? '+' : '-'}¥${(Math.abs(delta) / 100).toFixed(2)}</span>
        </div>`;
          })
          .join('')}</div>`
      : '<p class="sheet-sub">还没有流水，充值后这里会显示记录</p>';
  } catch (e) {
    const box = window.document.querySelector('#balLogs');
    if (box) box.innerHTML = `<p class="sheet-sub" style="color:#d4523c">${esc(e.message)}</p>`;
  }
}

/** 充值弹层：选金额 → 确认支付（走真实渠道） */
function rechargeSheet() {
  const presets = [1000, 3000, 5000, 10000];
  const cur = sheetState.rechargeAmount || 0;
  openSheet(`
    <h3>余额充值</h3>
    <p class="sheet-sub">充值后用于下单支付、会员自动续费</p>
    <div class="rchip-row">
      ${presets.map((a) => `<button class="rchip ${cur === a ? 'on' : ''}" data-act="recharge-pick" data-a="${a}">¥${a / 100}</button>`).join('')}
      <button class="rchip ${cur && !presets.includes(cur) ? 'on' : ''}" data-act="recharge-custom">自定义</button>
    </div>
    ${cur && !presets.includes(cur) ? '<label class="field"><span>金额（元）</span><input id="rcAmount" type="number" min="1" max="1000" step="1" value="' + (cur / 100) + '" /></label>' : ''}
    <button class="btn-primary" data-act="recharge-go" style="margin-top:12px">去支付${cur ? ' ' + yuan(cur) : ''}</button>
    <button class="btn-ghost" data-act="open-balance" style="margin-top:10px">返回余额中心</button>
  `);
}

function rechargeGo() {
  const amount = Number(sheetState.rechargeAmount || 0);
  if (!amount || amount < 100 || amount > 100000 || amount % 100 !== 0) {
    return toast('请选择或输入充值金额');
  }
  const customInput = $('#rcAmount');
  let finalAmount = amount;
  if (customInput && customInput.value) {
    const yuan2 = Math.floor(Number(customInput.value));
    if (!Number.isFinite(yuan2) || yuan2 < 1 || yuan2 > 1000) return toast('金额需在 ¥1 ~ ¥1000 之间');
    finalAmount = yuan2 * 100;
  }
  sheetState.product = {
    id: 'recharge',
    recharge: true,
    title: '余额充值',
    desc: `充值 ¥${(finalAmount / 100).toFixed(2)} 到余额`,
    amount: finalAmount,
  };
  const firstChannel = channelList().find((c) => c.id !== 'balance');
  sheetState.channel = sheetState.channel === 'balance' || !sheetState.channel ? (firstChannel ? firstChannel.id : 'alipay') : sheetState.channel;
  confirmSheet();
}

function renderUserCenter() {  const v = state.viewer;
  const addr = v.address || {};
  const orders = v.orders || [];
  const coupons = v.coupons || [];
  const hasAddr = Boolean(addr.detail || addr.name);
  const paidSum = orders
    .filter((o) => o.status === 'paid' || o.status === 'refunded')
    .reduce((s, o) => s + (Number(o.amount) || 0), 0);

  return `
    <div class="card user-hero">
      <div class="profile">
        <button class="avatar-btn" data-act="edit-avatar" aria-label="更换头像">
          ${avatarHTML(v, 'avatar')}
          <span class="avatar-badge">📷</span>
        </button>
        <div class="profile-body">
          <div class="profile-name">
            ${esc(v.nickname)}
            <button class="mini-btn" data-act="edit-nickname">修改</button>
          </div>
          <div class="profile-sub">${esc(v.phoneMasked)} · ID ${esc(v.id.slice(0, 10))}</div>
        </div>
      </div>
      <div class="stat-row">
        <button class="stat stat-btn" data-act="open-balance" aria-label="余额中心">
          <b>${yuan(v.balance)}</b><span>余额 ›</span>
        </button>
        <div class="stat"><b>${v.points}</b><span>积分</span></div>
        <div class="stat"><b>${coupons.length}</b><span>优惠券</span></div>
      </div>
    </div>

    ${memberBannerHTML(v)}

    <div class="section-head">
      <h2>收货地址</h2>
      <button class="mini-btn" data-act="edit-address">${hasAddr ? '编辑' : '去填写'}</button>
    </div>
    <div class="card addr-card">
      ${
        hasAddr
          ? `<div class="addr-name">${esc(addr.name || '未填姓名')} <span>${esc(
              (addr.phone || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
            )}</span></div>
             <div class="addr-detail">${esc(addr.detail || '未填写详细地址')}</div>`
          : `<div class="empty" style="padding:16px 4px"><p>还没有收货地址，点右上角填写</p></div>`
      }
    </div>

    <div class="section-head"><h2>我的优惠券</h2><span>${coupons.length} 张</span></div>
    <div class="card">
      ${
        coupons.length
          ? `<div class="coupon-list">${coupons
              .map(
                (c) => `<div class="coupon">
                  <div class="coupon-amount">${couponText(c)}<i>元</i></div>
                  <div class="coupon-main">
                    <div class="coupon-title">${esc(c.title || '优惠券')}</div>
                    <div class="coupon-sub">有效期至 ${new Date(c.expiresAt || Date.now()).toLocaleDateString('zh-CN')}</div>
                  </div>
                </div>`
              )
              .join('')}</div>`
          : `<div class="empty" style="padding:22px 8px"><p>暂无优惠券</p></div>`
      }
    </div>

    <div class="section-head">
      <h2>我的订单</h2>
      <span>${orders.length} 条${paidSum ? ` · 累计消费 ¥${yuan(paidSum)}` : ''}</span>
    </div>
    <div class="card">
      ${mineOrderList(orders)}
    </div>

    <div class="section-head"><h2>分享给好友</h2></div>
    <div class="card share-card">
      <p class="share-tip">把「${esc((state.site && state.site.name) || '本应用')}」转发给朋友，对方用浏览器打开即可添加到桌面，像 App 一样使用。</p>
      <div class="share-btns">
        <button class="share-btn" data-act="share-copy"><span>复制链接</span></button>
        <button class="share-btn" data-act="share-more"><span>分享给朋友</span></button>
        <button class="share-btn" data-act="share-qr"><span>二维码</span></button>
      </div>
    </div>

    <div class="section-head"><h2>设置</h2></div>
    <div class="card set-list">
      <button class="set-row" data-act="change-password"><span>修改密码</span><i>›</i></button>
      <button class="set-row" data-act="refresh"><span>刷新数据</span><i>›</i></button>
      <button class="set-row" data-act="clear-cache"><span>清除缓存</span><i>›</i></button>
      <button class="set-row" data-act="about"><span>关于</span><i>›</i></button>
      <button class="set-row danger" data-act="logout"><span>退出登录</span><i>›</i></button>
    </div>
    <p class="mine-foot">${esc(v.phoneMasked)} · 注册于 ${v.createdAt ? new Date(v.createdAt).toLocaleDateString('zh-CN') : '--'}</p>
  `;
}

function renderMine() {
  if (!state.viewer) return renderLogin();
  return renderUserCenter();
}

/* ---------------- 用户操作：登录 / 资料 / 分享 / 设置 ---------------- */

/** 登录或注册 */
async function doAuth(isRegister) {
  const phone = (($('#authPhone') || {}).value || '').replace(/\D/g, '');
  const password = (($('#authPwd') || {}).value || '').trim();
  const nickname = (($('#authNick') || {}).value || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) return toast('请输入正确的 11 位手机号');
  if (password.length < 6) return toast('密码至少 6 位');

  const btn = document.querySelector(`[data-act="${isRegister ? 'register' : 'login'}"]`);
  if (btn) btn.disabled = true;
  try {
    const out = await api(isRegister ? '/api/auth/register' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password, nickname }),
    });
    setToken(out.token);
    state.viewer = out.viewer;
    state.balance = Number(out.viewer.balance) || 0; // 余额支付弹层用自己账户的余额
    const { orders } = await api('/api/orders');
    state.orders = orders;
    state.viewer.orders = orders;
    toast(isRegister ? '注册成功，已登录' : '登录成功');
    render();
  } catch (e) {
    toast(e.message);
    if (btn) btn.disabled = false;
  }
}

/** 重新拉一次用户与订单 */
async function refreshMe() {
  const v = await loadViewer();
  if (!v) {
    render();
    return null;
  }
  const { orders } = await api('/api/orders');
  state.orders = orders;
  state.viewer.orders = orders;
  render();
  return state.viewer;
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
  } finally {
    ta.remove();
  }
  return Promise.resolve();
}

async function doShareCopy() {
  try {
    await copyText(shareUrl());
    toast('链接已复制，发给朋友即可');
  } catch (e) {
    toast('复制失败，请长按链接手动复制');
  }
}

async function doShareMore() {
  const url = shareUrl();
  const name = (state.site && state.site.name) || 'App';
  if (navigator.share) {
    try {
      await navigator.share({ title: name, text: `推荐你用「${name}」，用浏览器打开就能装到桌面`, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
  }
  await doShareCopy();
}

function shareQrSheet() {
  const url = shareUrl();
  openSheet(`
    <h3 class="sheet-title">扫码打开</h3>
    <div class="qr-wrap"><img class="qr-img" src="${esc(withShare('/api/qr?t=' + encodeURIComponent(url)))}" alt="二维码" /></div>
    <p class="qr-tip">用手机相机或微信扫一扫，即可打开并安装到桌面</p>
    <button class="btn-primary" data-act="share-copy">复制链接</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>
  `);
}

function nicknameSheet() {
  const v = state.viewer;
  openSheet(`
    <h3 class="sheet-title">修改昵称</h3>
    <label class="field"><span>昵称</span><input id="nickInput" maxlength="16" value="${esc(v.nickname)}" placeholder="最多 16 个字" /></label>
    <button class="btn-primary" data-act="save-nickname" style="margin-top:14px">保存</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
  `);
}

/* ---------------- 头像 ---------------- */

/** 头像弹层：可换图，也可恢复默认（昵称首字） */
function avatarSheet() {
  const v = state.viewer;
  if (!v) return toast('请先登录');
  openSheet(`
    <h3 class="sheet-title">我的头像</h3>
    <div class="avatar-preview">${avatarHTML(v, 'avatar-xg')}</div>
    <p class="sheet-sub" style="text-align:center">选一张方形照片，系统会自动裁成圆形</p>
    <button class="btn-primary" data-act="pick-avatar">从相册选择</button>
    ${
      v.avatar
        ? `<button class="btn-ghost" data-act="clear-avatar" style="margin-top:10px">恢复默认头像</button>`
        : ''
    }
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
  `);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('图片读取失败，换一张试试'));
    r.readAsDataURL(file);
  });
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败，换一张试试'));
    img.src = src;
  });
}

/** 选图后本地压成 192px 方形 JPEG（十来个 KB），再上传，省流量也省库 */
async function compressAvatar(file) {
  if (!/^image\//.test(file.type)) throw new Error('请选择图片文件');
  if (file.size > 8 * 1024 * 1024) throw new Error('图片太大，请选 8MB 以内的');
  const dataUrl = await readFileAsDataURL(file);
  const img = await loadImageEl(dataUrl);
  const side = Math.min(img.width, img.height);
  if (!side) throw new Error('图片读取失败，换一张试试');
  const size = 192;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  cv.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
  let out = cv.toDataURL('image/jpeg', 0.86);
  if (out.length > 180 * 1024) out = cv.toDataURL('image/jpeg', 0.68);
  return out;
}

function pickAvatarFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    toast('正在处理头像…');
    try {
      const avatar = await compressAvatar(f);
      await saveAvatar(avatar);
    } catch (e) {
      toast(e.message || '头像处理失败');
    }
  };
  input.click();
}

async function saveAvatar(avatar) {
  try {
    const { viewer } = await api('/api/auth/profile', { method: 'POST', body: JSON.stringify({ avatar }) });
    state.viewer = viewer;
    state.viewer.orders = state.orders;
    toast(avatar ? '头像已更新' : '已恢复默认头像');
    render();
    closeSheet();
  } catch (e) {
    toast(e.message || '保存失败');
  }
}

function addressSheet() {
  const a = (state.viewer && state.viewer.address) || {};
  openSheet(`
    <h3 class="sheet-title">收货地址</h3>
    <label class="field"><span>收货人</span><input id="addrName" maxlength="20" value="${esc(a.name || '')}" placeholder="姓名" /></label>
    <label class="field"><span>手机号</span><input id="addrPhone" type="tel" inputmode="numeric" maxlength="11" value="${esc(a.phone || '')}" placeholder="11 位手机号" /></label>
    <label class="field"><span>详细地址</span><input id="addrDetail" maxlength="120" value="${esc(a.detail || '')}" placeholder="省市区 + 街道门牌" /></label>
    <button class="btn-primary" data-act="save-address" style="margin-top:14px">保存</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
  `);
}

function passwordSheet() {
  openSheet(`
    <h3 class="sheet-title">修改密码</h3>
    <label class="field"><span>原密码</span><input id="pwdOld" type="password" maxlength="32" placeholder="当前密码" /></label>
    <label class="field"><span>新密码</span><input id="pwdNew" type="password" maxlength="32" placeholder="至少 6 位" /></label>
    <button class="btn-primary" data-act="save-password" style="margin-top:14px">确认修改</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
  `);
}

function aboutSheet() {
  const s = state.site || {};
  openSheet(`
    <h3 class="sheet-title">关于</h3>
    <div class="about-box">
      ${logoHTML('about-logo')}
      <div class="about-name">${esc(s.name || 'App')}</div>
      <div class="about-sub">${esc(s.tagline || '手机应用')}</div>
      <div class="about-meta">版本 1.0.0 · 网页版 / PWA</div>
      <div class="about-meta">${state.provider === 'wechat' && state.wechatReady ? '支付渠道：微信支付' : '支付渠道：模拟收银台（沙箱）'}</div>
    </div>
    <button class="btn-primary" data-act="close" style="margin-top:14px">知道了</button>
  `);
}

function logout() {
  setToken('');
  state.viewer = null;
  state.orders = [];
  state.balance = 0; // 游客没有余额概念，避免残留上一个用户的数字
  toast('已退出登录');
  render();
}

/* ---------------- 渲染入口 ---------------- */

const TITLES = { home: '首页', content: '内容', mine: '我的' };

function render() {
  // 「我的」页与首页共用同一份订单：付款成功、刷新后立刻同步，避免刚付完看不到新订单
  if (state.viewer) state.viewer.orders = state.orders;
  $('#topbarTitle').textContent = TITLES[state.tab];
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.tab === state.tab);
  });
  if (!state.loaded) {
    view.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    return;
  }
  view.innerHTML =
    state.tab === 'home' ? renderHome() : state.tab === 'content' ? renderContent() : renderMine();
  view.scrollTop = 0;
}

/* ---------------- 支付流程 ---------------- */

const SCENE_TEXT = {
  auto: '自动适配',
  native: '扫码支付',
  jsapi: '微信内支付',
  h5: '手机浏览器支付',
};

/** 当前可用的支付方式：真实微信支付就绪时展示微信支付，否则展示模拟收银台 */
function channelList() {
  const list = [];
  const ch = state.channels || {};
  // 微信内置浏览器打不开支付宝手机网站支付，这种情况把扫码放前面
  const inWechat = /MicroMessenger/i.test(navigator.userAgent);
  if (ch.wechat) {
    list.push({
      id: 'wechat',
      name: '微信支付',
      cls: 'wechat',
      icon: ICON.wechat,
      extra: SCENE_TEXT[state.payScene] || '推荐',
    });
  }
  if (ch.alipay && !inWechat) {
    list.push({ id: 'alipay', name: '支付宝', cls: 'alipay', icon: ICON.alipay, extra: '手机网站支付' });
  }
  if (ch.alipayQr) {
    list.push({ id: 'alipay_qr', name: '支付宝扫码', cls: 'alipay', icon: ICON.alipay, extra: '扫码付' });
  }
  if (ch.alipay && inWechat) {
    list.push({ id: 'alipay', name: '支付宝', cls: 'alipay', icon: ICON.alipay, extra: '手机网站支付' });
  }
  // 有真实渠道时不再展示「模拟收银台」：服务端 pickChannel 会把它落到真实渠道，容易被误会成沙箱
  const hasReal = ch.wechat || ch.alipay || ch.alipayQr;
  if (!hasReal) {
    list.push({ id: 'mock', name: '模拟收银台', cls: 'wechat', icon: ICON.wechat, extra: '沙箱环境' });
  }
  list.push({ id: 'balance', name: '余额支付', cls: 'balance', icon: ICON.balance, extra: yuan(state.balance) });
  // 后台开关：模拟收银台 / 余额支付可整体隐藏
  if (state.site && state.site.showBalance === false) {
    list = list.filter((c) => c.id !== 'balance');
  }
  if (state.site && state.site.showMock === false) {
    list = list.filter((c) => c.id !== 'mock');
  }
  return list;
}

function channelItemsHTML(selected) {
  // 充值订单不能用余额支付，过滤掉余额渠道
  const list = channelList().filter((c) => !(sheetState.product && sheetState.product.recharge && c.id === 'balance'));
  return list
    .map(
      (c) => `
        <button class="pay-item ${selected === c.id ? 'selected' : ''}" data-act="channel" data-id="${c.id}">
          <span class="pay-icon ${c.cls}">${c.icon}</span>
          <span class="pay-name">${c.name}</span>
          <span class="pay-extra">${c.id === 'balance' && state.balance < (sheetState.product ? sheetState.product.amount : 0) ? '余额不足' : c.extra}</span>
          <span class="radio"></span>
        </button>`
    )
    .join('');
}

function confirmSheet() {
  const p = sheetState.product;
  const ch = sheetState.channel;
  const balanceEnough = state.balance >= p.amount;

  const html = `
    <h3>确认订单</h3>
    <p class="sheet-sub">${p.title} · ${p.desc}</p>
    <div class="amount-box">
      <div class="amount-label">支付金额</div>
      <div class="amount-big"><small>¥</small>${(p.amount / 100).toFixed(2)}</div>
    </div>
    <div class="pay-list">
      ${channelItemsHTML(ch)}
    </div>
    <button class="btn-primary" id="payBtn" data-act="pay" ${ch === 'balance' && !balanceEnough ? 'disabled' : ''}>
      ${ch === 'balance' && !balanceEnough ? '余额不足' : '确认支付 ' + yuan(p.amount)}
    </button>
    <p class="cashier-note">${
      state.channels.wechat || state.channels.alipay || state.channels.alipayQr
        ? '真实支付渠道 · 会真实扣款，请用小额测试'
        : '沙箱环境，不会产生真实扣款'
    }</p>
  `;
  openSheet(html);
}

/** 微信内置浏览器调起支付（JSAPI） */
function invokeWechatPay(payParams) {
  return new Promise((resolve, reject) => {
    const run = () => {
      if (typeof WeixinJSBridge === 'undefined') {
        reject(new Error('当前不在微信内，无法调起微信支付'));
        return;
      }
      WeixinJSBridge.invoke('getBrandWCPayRequest', payParams, (res) => {
        const msg = res.err_msg || '';
        if (msg === 'get_brand_wcpay_request:ok') resolve(true);
        else if (msg === 'get_brand_wcpay_request:cancel') reject(new Error('已取消支付'));
        else reject(new Error('支付失败：' + msg));
      });
    };
    if (typeof WeixinJSBridge !== 'undefined') run();
    else {
      document.addEventListener('WeixinJSBridgeReady', run, { once: true });
      setTimeout(run, 1200);
    }
  });
}

/** 扫码支付弹层：展示二维码并轮询订单状态 */
function qrSheet(order, qrUrl, channel) {
  sheetState.type = 'qr';
  // 兼容 'alipay' / 'alipay_qr' 两种写法；再兜底看二维码域名，避免文案串到微信
  const ch = String(channel || (order && order.channel) || '');
  const isAlipay = /^alipay/i.test(ch) || /qr\.alipay\.com/i.test(String(qrUrl || ''));
  const appName = isAlipay ? '支付宝' : '微信';
  openSheet(`
    <h3>${appName}扫码支付</h3>
    <p class="sheet-sub">${order.title} · ${yuan(order.amount)}</p>
    <div style="text-align:center;padding:6px 0 2px">
      <img src="${qrUrl}" alt="支付二维码" style="width:236px;height:236px;border-radius:14px;border:1px solid var(--line)" />
      <p style="font-size:12.5px;color:var(--muted);margin:12px 0 0">打开${appName}「扫一扫」完成支付</p>
      ${
        isAlipay
          ? `<p style="font-size:12px;color:var(--muted);margin:6px 0 0">手机上可直接长按识别二维码</p>`
          : ''
      }
      <p class="qr-status" data-qr-status style="font-size:12px;color:#2f6bff;margin:8px 0 0">支付成功后本页会自动刷新，无需操作</p>
    </div>
    <button class="btn-primary" data-act="check-order" data-id="${order.id}">我已完成支付</button>
    <button class="btn-ghost" data-act="close">稍后支付</button>
  `);
  // 后台轮询，付完自动关闭弹层
  pollOrder(order.id, 120, 1500).then((o) => {
    if (o && o.status === 'paid' && sheetState.type === 'qr') {
      upsertOrder(o);
      showSuccess(o);
      render();
      return;
    }
    // 3 分钟仍未付：停止自动刷新，提示手动确认
    const s = document.querySelector('[data-qr-status]');
    if (!o && s && sheetState.type === 'qr') {
      s.textContent = '已停止自动刷新，付款后请点下方「我已完成支付」';
      s.style.color = '#7a8194';
    }
  });
}

/** 订单入列表：已存在就替换，避免继续支付后出现两行相同订单 */
function upsertOrder(order) {
  if (!order || !order.id) return;
  const idx = state.orders.findIndex((o) => o.id === order.id);
  if (idx > -1) state.orders[idx] = { ...state.orders[idx], ...order };
  else state.orders.unshift(order);
  if (state.viewer) state.viewer.orders = state.orders;
}

/** 把服务端返回的支付模式落到界面：余额 / 跳转 / 微信内调起 / 扫码 / 已付过 */
async function applyPayResult(res) {
  if (res.mode === 'already_paid') {
    // 上次其实已经付成功了，只是回调没到，直接给成功反馈，不重复收款
    upsertOrder(res.order);
    showSuccess(res.order);
    render();
    return;
  }

  if (res.mode === 'balance') {
    state.balance = res.balance;
    upsertOrder(res.order);
    showSuccess(res.order);
    render();
    return;
  }

  if (res.mode === 'redirect' || res.mode === 'h5') {
    upsertOrder(res.order);
    location.href = withShare(res.payUrl); // 跳收银台 / 微信 H5 收银台，回来后轮询状态
    return;
  }

  if (res.mode === 'jsapi') {
    closeSheet();
    try {
      await invokeWechatPay(res.payParams);
      const o = await pollOrder(res.order.id, 40, 800);
      const paid = o || (await api(`/api/orders/${res.order.id}`)).order;
      upsertOrder(paid);
      showSuccess(paid);
      render();
    } catch (e) {
      toast(e.message);
      render();
    }
    return;
  }

  if (res.mode === 'native') {
    if (!res.qrUrl) throw new Error('未取到二维码链接');
    upsertOrder(res.order);
    qrSheet(res.order, res.qrUrl, res.channel || (res.order && res.order.channel));
    render();
    return;
  }

  throw new Error('未知支付模式：' + res.mode);
}

async function doPay() {
  const btn = $('#payBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '正在创建订单…';
  }
  try {
    const created = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(sheetState.product.recharge ? { recharge: sheetState.product.amount } : { productId: sheetState.product.id }),
    });
    const res = await api(`/api/orders/${created.order.id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ channel: sheetState.channel }),
    });
    await applyPayResult(res);
  } catch (e) {
    toast(e.message);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '确认支付 ' + yuan(sheetState.product.amount);
    }
  }
}

function showSuccess(order) {
  // 会员商品支付成功后，静默刷新一次用户信息，让会员状态立即生效
  const p = state.products.find((x) => x.id === order.productId);
  if ((p && Number(p.memberDays) > 0) || order.recharge) refreshMe().catch(() => {});
  sheetState.type = 'success';
  openSheet(`
    <div class="success-wrap">
      <div class="success-icon">${ICON.check}</div>
      <div class="success-title">支付成功</div>
      <div class="success-amount">${yuan(order.amount)}</div>
      <p class="sheet-sub" style="margin-top:10px">${order.title} · ${order.channelName}</p>
    </div>
    <button class="btn-primary" data-act="close">完成</button>
    <button class="btn-ghost" data-act="order" data-id="${order.id}">查看订单详情</button>
  `);
}

function orderSheet(order) {
  sheetState.type = 'order';
  sheetState.order = order;
  const canQueryPay = /^alipay/i.test(String(order.channel || ''));
  // 详情页点「继续支付」时沿用原渠道（渠道还能用的话）
  if (order.channel && channelList().some((c) => c.id === order.channel)) sheetState.channel = order.channel;

  let actions;
  if (isUnpaid(order)) {
    actions = `
      <button class="btn-primary" data-act="pay-order" data-id="${order.id}">继续支付 ${yuan(order.amount)}</button>
      ${
        canQueryPay
          ? `<button class="btn-ghost" data-act="check-order" data-id="${order.id}" style="margin-top:10px">我已完成支付，查询结果</button>`
          : ''
      }
      <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>`;
  } else if (order.status === 'paid') {
    actions = `<button class="btn-ghost" data-act="refund" data-id="${order.id}" style="color:#f05252">申请退款</button>`;
  } else {
    actions = `<button class="btn-primary" data-act="close">知道了</button>`;
  }

  openSheet(`
    <h3>订单详情</h3>
    <p class="sheet-sub">${STATUS_TEXT[order.status]}</p>
    ${
      isUnpaid(order)
        ? `<div class="keep-note">${order.status === 'pending' ? '这笔订单还没收到付款，可继续完成支付' : '订单已创建，还没有付款'}</div>`
        : ''
    }
    <div class="detail-list">
      <div class="detail-row"><span class="k">商品</span><span class="v">${order.title}</span></div>
      <div class="detail-row"><span class="k">金额</span><span class="v">${yuan(order.amount)}</span></div>
      <div class="detail-row"><span class="k">支付方式</span><span class="v">${order.channelName}</span></div>
      <div class="detail-row"><span class="k">订单号</span><span class="v">${order.id}</span></div>
      <div class="detail-row"><span class="k">创建时间</span><span class="v">${timeText(order.createdAt)}</span></div>
      ${
        order.paidAt
          ? `<div class="detail-row"><span class="k">支付时间</span><span class="v">${timeText(order.paidAt)}</span></div>`
          : ''
      }
      ${
        order.refundedAt
          ? `<div class="detail-row"><span class="k">退款时间</span><span class="v">${timeText(order.refundedAt)}</span></div>`
          : ''
      }
    </div>
    ${actions}
  `);
}

/**
 * 继续支付：订单已经创建过（created / pending），不再新建订单，直接对这笔订单重新拉起收银台。
 * 收银台未关闭时用户又点了一次二维码支付，也能从这里重新打开二维码。
 */
function continuePaySheet(order) {
  const channels = channelList();
  const prev = sheetState.type === 'continue' && sheetState.order && sheetState.order.id === order.id ? sheetState.channel : null;
  const sameChannel = channels.find((c) => c.id === order.channel);

  sheetState.type = 'continue';
  sheetState.order = order;
  sheetState.product = { id: order.productId || order.id, title: order.title, amount: order.amount, desc: '' };
  sheetState.channel = channels.some((c) => c.id === prev) ? prev : sameChannel ? sameChannel.id : channels[0].id;

  const ch = sheetState.channel;
  const balanceEnough = state.balance >= order.amount;
  const canQueryPay = /^alipay/i.test(String(order.channel || ''));

  openSheet(`
    <h3>继续支付</h3>
    <p class="sheet-sub">${esc(order.title)} · 订单 ${esc(order.id)}</p>
    <div class="amount-box">
      <div class="amount-label">还需支付</div>
      <div class="amount-big"><small>¥</small>${(order.amount / 100).toFixed(2)}</div>
    </div>
    <div class="keep-note">${
      order.status === 'pending' ? '上次支付没有完成，选个支付方式继续付款即可' : '这笔订单还没有付款'
    }</div>
    <div class="pay-list">${channelItemsHTML(ch)}</div>
    <button class="btn-primary" id="payBtn" data-act="pay-order" data-id="${esc(order.id)}" ${
      ch === 'balance' && !balanceEnough ? 'disabled' : ''
    }>
      ${ch === 'balance' && !balanceEnough ? '余额不足' : '立即支付 ' + yuan(order.amount)}
    </button>
    ${
      canQueryPay
        ? `<button class="btn-ghost" data-act="check-order" data-id="${esc(order.id)}" style="margin-top:10px">已经付过了？查询结果</button>`
        : ''
    }
    <button class="btn-ghost" data-act="order-detail" data-id="${esc(order.id)}" style="margin-top:10px">查看订单详情</button>
  `);
}

/** 点订单行：没付完的直接进支付界面，其他看详情 */
function openOrder(order) {
  if (!order) return;
  if (isUnpaid(order)) continuePaySheet(order);
  else orderSheet(order);
}

/* ---------------- 事件 ---------------- */

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    render();
  });
});

maskEl.addEventListener('click', closeSheet);

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  /* 用户相关 */
  if (act === 'login') return doAuth(false);
  if (act === 'register') return doAuth(true);
  if (act === 'logout') return logout();
  if (act === 'edit-nickname') return nicknameSheet();
  if (act === 'edit-avatar') return avatarSheet();
  if (act === 'go-mine' || act === 'go-login') {
    state.tab = 'mine';
    return render();
  }
  if (act === 'go-content') {
    state.tab = 'content';
    return render();
  }
  if (act === 'edit-address') return addressSheet();
  if (act === 'change-password') return passwordSheet();
  if (act === 'about') return aboutSheet();
  if (act === 'share-copy') return doShareCopy();
  if (act === 'share-more') return doShareMore();
  if (act === 'share-qr') return shareQrSheet();
  if (act === 'refresh') {
    toast('刷新中…');
    await refreshMe();
    return toast('已刷新');
  }
  if (act === 'clear-cache') {
    try {
      localStorage.clear();
    } catch (err) {
      /* ignore */
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    toast('缓存已清除，正在刷新');
    setTimeout(() => location.reload(), 700);
    return;
  }

  if (act === 'open-member') return memberSheet();
  if (act === 'toggle-autorenew') return toggleAutoRenew();
  if (act === 'open-balance') return balanceSheet();

  if (act === 'buy') {
    if (!state.viewer) {
      state.tab = 'mine';
      render();
      return toast('请先登录再下单');
    }
    const p = state.products.find((x) => x.id === el.dataset.id);
    if (!p) return;
    sheetState.type = 'confirm';
    sheetState.product = p;
    sheetState.channel = channelList()[0].id;
    confirmSheet();
  }

  if (act === 'mine-filter') {
    mineOrderFilter = el.dataset.f || 'all';
    render();
    return;
  }

  if (act === 'order') {
    const o = state.orders.find((x) => x.id === el.dataset.id);
    // 列表里点「支付中 / 待支付」的订单，直接跳到支付界面
    if (o) openOrder(o);
  }

  if (act === 'recharge') {
    sheetState.type = 'confirm';
    sheetState.product = { id: 'vip_month', title: '会员月卡', desc: '示例商品，用于演示支付流程', amount: 1200 };
    sheetState.channel = channelList()[0].id;
    confirmSheet();
  }
});

sheetEl.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'channel') {
    sheetState.channel = el.dataset.id;
    if (sheetState.type === 'continue' && sheetState.order) continuePaySheet(sheetState.order);
    else confirmSheet();
  }

  if (act === 'pay') {
    doPay();
  }

  if (act === 'close') {
    closeSheet();
  }

  if (act === 'share-copy') {
    await doShareCopy();
  }

  if (act === 'pick-avatar') {
    pickAvatarFile();
    return;
  }

  if (act === 'clear-avatar') {
    await saveAvatar('');
    return;
  }

  if (act === 'toggle-autorenew') {
    await toggleAutoRenew();
    return;
  }

  if (act === 'open-balance') {
    balanceSheet();
    return;
  }

  if (act === 'recharge') {
    sheetState.rechargeAmount = 3000; // 默认 ¥30
    rechargeSheet();
    return;
  }

  if (act === 'recharge-pick') {
    sheetState.rechargeAmount = Number(el.dataset.a);
    rechargeSheet();
    return;
  }

  if (act === 'recharge-custom') {
    sheetState.rechargeAmount = 2000; // 自定义档，配合输入框改金额
    rechargeSheet();
    return;
  }

  if (act === 'recharge-go') {
    rechargeGo();
    return;
  }

  if (act === 'save-nickname') {
    const nickname = (($('#nickInput') || {}).value || '').trim();
    if (!nickname) return toast('昵称不能为空');
    try {
      const { viewer } = await api('/api/auth/profile', { method: 'POST', body: JSON.stringify({ nickname }) });
      state.viewer = viewer;
      state.viewer.orders = state.orders;
      closeSheet();
      toast('已保存');
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  if (act === 'save-address') {
    const address = {
      name: (($('#addrName') || {}).value || '').trim(),
      phone: (($('#addrPhone') || {}).value || '').replace(/\D/g, ''),
      detail: (($('#addrDetail') || {}).value || '').trim(),
    };
    if (!address.name) return toast('请填写收货人');
    if (address.phone && address.phone.length !== 11) return toast('手机号需 11 位');
    if (!address.detail) return toast('请填写详细地址');
    try {
      const { viewer } = await api('/api/auth/profile', { method: 'POST', body: JSON.stringify({ address }) });
      state.viewer = viewer;
      state.viewer.orders = state.orders;
      closeSheet();
      toast('地址已保存');
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  if (act === 'save-password') {
    const oldPassword = (($('#pwdOld') || {}).value || '').trim();
    const newPassword = (($('#pwdNew') || {}).value || '').trim();
    if (!oldPassword) return toast('请输入原密码');
    if (newPassword.length < 6) return toast('新密码至少 6 位');
    try {
      await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ oldPassword, newPassword }) });
      closeSheet();
      toast('密码已修改');
    } catch (err) {
      toast(err.message);
    }
  }

  if (act === 'order') {
    const o = state.orders.find((x) => x.id === el.dataset.id);
    closeSheet();
    if (o) setTimeout(() => orderSheet(o), 260);
  }

  if (act === 'order-detail') {
    const o = state.orders.find((x) => x.id === el.dataset.id) || sheetState.order;
    if (o) orderSheet(o);
    return;
  }

  if (act === 'pay-order') {
    // 对已有订单继续支付：不新建订单，沿用弹层里选中的渠道
    const id = el.dataset.id;
    const order = state.orders.find((x) => x.id === id) || sheetState.order;
    const channel = sheetState.channel || (order && order.channel) || channelList()[0].id;
    const label = el.textContent;
    el.disabled = true;
    el.textContent = '正在拉起支付…';
    try {
      const res = await api(`/api/orders/${id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ channel }),
      });
      await applyPayResult(res);
      render();
    } catch (err) {
      el.disabled = false;
      el.textContent = label;
      toast(err.message);
    }
  }

  if (act === 'check-order') {
    // 扫码支付后手动确认：让服务端向支付宝查单（本地状态可能因回调延迟而滞后）
    const id = el.dataset.id;
    const label = el.textContent;
    el.disabled = true;
    el.textContent = '正在查询支付结果…';
    try {
      const res = await api(`/api/orders/${id}/sync`, { method: 'POST' });
      const order = res.order;
      if (order && order.status === 'paid') {
        upsertOrder(order);
        showSuccess(order);
        render();
      } else {
        el.disabled = false;
        el.textContent = label;
        let tip = '暂未查到支付结果，请 10 秒后再点一次';
        if (res.reason === 'nochannel') tip = '该订单不是支付宝订单，无法自动查询，请联系商家';
        else if (res.reason === 'amountmismatch') tip = '金额校验不一致，已拦截入账，请联系商家';
        else if (res.tradeStatus === 'WAIT_BUYER_PAY' || res.reason === 'ACQ.TRADE_NOT_EXIST') {
          tip = '支付宝还没收到这笔付款。若你已付款，请等 10 秒后再点一次';
        } else if (res.reason === 'throttled' || res.reason === 'notpending') {
          tip = '正在查询中，请稍候再试';
        }
        toast(tip);
        const s = document.querySelector('[data-qr-status]');
        if (s) {
          s.textContent = tip;
          s.style.color = '#d4523c';
        }
      }
    } catch (err) {
      el.disabled = false;
      el.textContent = label;
      toast(err.message || '查询失败，请稍后重试');
    }
  }

  if (act === 'refund') {
    try {
      const res = await api(`/api/orders/${el.dataset.id}/refund`, { method: 'POST' });
      state.balance = res.balance;
      const idx = state.orders.findIndex((o) => o.id === res.order.id);
      if (idx > -1) state.orders[idx] = res.order;
      closeSheet();
      toast(res.order.channel === 'wechat' ? '已提交微信退款' : '已退款到余额');
      render();
    } catch (err) {
      toast(err.message);
    }
  }
});

/* ---------------- 启动 ---------------- */

async function bootstrap() {
  const data = await api('/api/bootstrap');
  state.user = data.user;
  state.balance = data.balance;
  state.products = data.products;
  state.contents = Array.isArray(data.contents) ? data.contents : [];
  state.orders = data.orders;
  await loadViewer();
  if (state.viewer) state.viewer.orders = state.orders;
  state.provider = data.provider;
  state.payScene = data.payScene || 'native';
  state.wechatReady = !!data.wechatReady;
  state.alipayReady = !!data.alipayReady;
  state.channels = data.channels || { wechat: !!data.wechatReady, alipay: !!data.alipayReady, mock: true };
  state.wxMchId = data.wxMchId || '';
  if (data.site) state.site = data.site;
  applySite();
  state.loaded = true;
  render();
  registerSW();
  maybeShowInstallHint();
}

/** 从收银台返回后：轮询订单状态拿到最终结果 */
async function pollOrder(orderId, tries = 12, interval = 450) {
  for (let i = 0; i < tries; i++) {
    try {
      const { order } = await api(`/api/orders/${orderId}`);
      if (order.status === 'paid' || order.status === 'closed' || order.status === 'refunded') return order;
    } catch (e) {
      /* 单次失败继续轮询 */
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return null;
}

(async function start() {
  const q = new URLSearchParams(location.search);
  const returnOrderId = q.get('orderId');
  const result = q.get('result');

  try {
    await bootstrap();
  } catch (e) {
    view.innerHTML = `<div class="card" style="margin-top:40px"><div class="empty"><h3>连不上服务</h3><p>${e.message}<br/>请确认 node server.js 已启动</p></div></div>`;
    return;
  }

  if (returnOrderId && result) {
    history.replaceState(null, '', '/');
    if (result === 'paid') {
      const order = await pollOrder(returnOrderId);
      state.tab = 'mine';
      render();
      await bootstrap();
      if (order) setTimeout(() => showSuccess(order), 260);
      else toast('支付结果确认中，请稍后在订单里查看');
    } else {
      toast('已取消支付');
      state.tab = 'mine';
      render();
    }
  }
})();
