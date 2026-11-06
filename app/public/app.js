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
  viewer: null, // 登录后的用户资料（手机号 / 积分 / 地址 / 余额 / 会员 / 订单）
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
  favorites: [], // 收藏的内容 id（登录才有）
  refunds: [], // 我的退款/退货申请（登录才有）
  myReviews: [], // 我的评价（登录才有，含被隐藏的）
  orders: [],
  tab: 'home',
  loaded: false,
  goodsQuery: '', // 首页商品搜索词（纯前端过滤，不落库）
  goodsFilter: 'all', // all / member / deal / owned
  goodsSort: 'default', // default / hot / priceAsc / priceDesc
  orderQuery: '', // 我的订单搜索词（商品名 / 订单号）
  contentQuery: '', // 内容页搜索词
  contentCat: 'all', // 内容页分类筛选：all / 分类名 / __fav
};

const sheetState = { type: null, product: null, order: null, channel: 'wechat', productId: '', reviewStars: 5 };

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

/** 聊天式时间：刚刚 / 5 分钟前 / 3 小时前 / 昨天 / 具体日期 */
function agoText(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 172800000) return '昨天';
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

/* ---------------- 本地小仓库：心愿单 / 足迹 / 搜索历史 / 消息已读 ---------------- */
/* 这些是「只在这台手机上」的轻数据，不进云库，清缓存即消失 */

const LS_GOODS_FAV = 'goods_fav_v1';
const LS_FOOTPRINT = 'footprint_v1';
const LS_SEARCH_HISTORY = 'search_history_v1';
const LS_MSG_READ = 'msg_read_v1';
const LS_CART = 'cart_v1';

function lsGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function lsSet(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    /* 无痕模式 / 超额：ignore */
  }
}

/** 心愿单：商品 id 数组，最近收藏的排前面 */
function goodsFavList() {
  const v = lsGet(LS_GOODS_FAV, []);
  return Array.isArray(v) ? v.map(String) : [];
}

function goodsFavOn(id) {
  return goodsFavList().includes(String(id));
}

/** 收藏/取消，返回 true 表示现在是「已收藏」 */
function toggleGoodsFav(id) {
  const key = String(id);
  const list = goodsFavList();
  const i = list.indexOf(key);
  if (i > -1) list.splice(i, 1);
  else list.unshift(key);
  lsSet(LS_GOODS_FAV, list.slice(0, 100));
  return i === -1;
}

/** 浏览足迹：[{ id, at }]，最多 20 条 */
function footprintList() {
  const v = lsGet(LS_FOOTPRINT, []);
  return Array.isArray(v) ? v.filter((x) => x && x.id) : [];
}

function pushFootprint(id) {
  const key = String(id || '');
  if (!key) return;
  const list = footprintList().filter((x) => String(x.id) !== key);
  list.unshift({ id: key, at: Date.now() });
  lsSet(LS_FOOTPRINT, list.slice(0, 20));
}

function clearFootprint() {
  lsSet(LS_FOOTPRINT, []);
}

/** 搜索历史：最近的放前面，去重，最多 8 条 */
function searchHistoryList() {
  const v = lsGet(LS_SEARCH_HISTORY, []);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : [];
}

function pushSearchHistory(q) {
  const key = String(q || '').trim();
  if (key.length < 1) return;
  const list = searchHistoryList().filter((x) => x !== key);
  list.unshift(key);
  lsSet(LS_SEARCH_HISTORY, list.slice(0, 8));
}

function clearSearchHistory() {
  lsSet(LS_SEARCH_HISTORY, []);
}

/* ---------------- 购物车（本机存储） ---------------- */
/* 只存「商品 id + 数量」，单价与会员价永远按服务端下发的商品表现算，避免改价后算错 */

function cartList() {
  const v = lsGet(LS_CART, []);
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && x.id && Number(x.qty) > 0)
    .map((x) => ({ id: String(x.id), qty: Math.min(99, Math.max(1, Math.floor(Number(x.qty) || 1))), at: Number(x.at) || 0 }));
}

function cartSave(list) {
  lsSet(LS_CART, (list || []).slice(0, 50));
  updateTabBadge();
}

/** 购物车总件数：底部导航角标用 */
function cartCount() {
  return cartList().reduce((s, x) => s + (Number(x.qty) || 0), 0);
}

function cartHas(id) {
  return cartList().some((x) => String(x.id) === String(id));
}

/** 加购，返回加完后的总件数 */
function cartAdd(id, qty) {
  const key = String(id || '');
  if (!key) return cartCount();
  const add = Math.max(1, Math.floor(Number(qty) || 1));
  const list = cartList();
  const hit = list.find((x) => x.id === key);
  if (hit) hit.qty = Math.min(99, hit.qty + add);
  else list.unshift({ id: key, qty: Math.min(99, add), at: Date.now() });
  cartSave(list);
  return cartCount();
}

function cartSetQty(id, qty) {
  const key = String(id || '');
  const n = Math.floor(Number(qty) || 0);
  let list = cartList();
  if (n <= 0) list = list.filter((x) => x.id !== key);
  else {
    const hit = list.find((x) => x.id === key);
    if (hit) hit.qty = Math.min(99, n);
  }
  cartSave(list);
}

function cartRemove(id) {
  const key = String(id || '');
  cartSave(cartList().filter((x) => x.id !== key));
}

function cartClear() {
  cartSave([]);
}

/**
 * 购物车明细：把本机 id/数量 和当前商品表拼起来
 * gone = 商品已下架/被删；locked = 会员专享但当前不是会员
 */
function cartRows() {
  return cartList().map((it) => {
    const p = (state.products || []).find((x) => String(x.id) === String(it.id)) || null;
    const qty = Math.max(1, Number(it.qty) || 1);
    const price = p ? memberPriceOf(p) : 0;
    return {
      id: it.id,
      qty,
      at: it.at,
      product: p,
      price,
      sum: price * qty,
      gone: !p,
      locked: Boolean(p && p.memberOnly && !viewerIsMember()),
    };
  });
}

/** 可结算的明细（排除下架/会员受限的） */
function cartPayableRows() {
  return cartRows().filter((r) => !r.gone && !r.locked);
}

function cartTotal() {
  return cartPayableRows().reduce((s, r) => s + r.sum, 0);
}

/** 加购（页面与弹层两套监听共用）：会员专享商品先引导开通 */
function handleCartAdd(el) {
  const id = el && el.dataset ? el.dataset.id : '';
  const p = (state.products || []).find((x) => String(x.id) === String(id));
  if (!p) return toast('商品不存在或已下架');
  if (p.memberOnly && !viewerIsMember()) {
    toast('该商品为会员专享，开通会员后可购买');
    return memberSheet();
  }
  const n = cartAdd(id, 1);
  const item = cartList().find((x) => x.id === String(id));
  if (el) el.textContent = `✓ 已加购 ${item ? item.qty : 1} 件`;
  return toast(`已加入购物车，共 ${n} 件`);
}

/** 消息中心：由订单 / 售后记录派生，不额外存库 */
function messageList() {
  const out = [];
  const push = (m) => {
    if (m && m.at) out.push(m);
  };
  (state.orders || []).forEach((o) => {
    const at = Number(o.paidAt) || Number(o.createdAt) || 0;
    if (o.status === 'paid' || o.status === 'refunded') {
      push({
        at: Number(o.paidAt) || at,
        kind: 'pay',
        title: '支付成功',
        text: `${o.title} · ${yuan(o.amount)}`,
        orderId: o.id,
      });
    }
    if (o.status === 'paid' && o.shipNo) {
      push({
        at: Number(o.shippedAt) || Number(o.paidAt) || at,
        kind: 'ship',
        title: '已发货',
        text: `${o.title} · ${o.shipCompany || '快递'} ${o.shipNo}`,
        orderId: o.id,
      });
    }
    if (o.status === 'paid' && o.receivedAt) {
      push({
        at: Number(o.receivedAt) || at,
        kind: 'ship',
        title: '已签收',
        text: `${o.title} · 确认收货成功，去评价一下呗`,
        orderId: o.id,
      });
    }
    if (o.status === 'refunded') {
      push({
        at: Number(o.refundedAt) || at,
        kind: 'refund',
        title: '退款已完成',
        text: `${o.title} · ${yuan(o.amount)} 原路退回`,
        orderId: o.id,
      });
    }
    if (isUnpaid(o)) {
      push({
        at: Number(o.createdAt) || 0,
        kind: 'unpaid',
        title: '订单待支付',
        text: `${o.title} · ${yuan(o.amount)}，超时会自动关闭`,
        orderId: o.id,
      });
    }
  });
  (state.refunds || []).forEach((r) => {
    if (!r || r.status === 'pending') return;
    const title =
      r.status === 'approved' ? '退款申请已通过' : r.status === 'rejected' ? '退款申请未通过' : '退款申请已撤销';
    push({
      at: Number(r.handledAt) || Number(r.createdAt) || 0,
      kind: 'refund',
      title,
      text: `${r.orderTitle || r.orderId}${r.adminNote ? ' · ' + r.adminNote : ''}`,
      orderId: r.orderId,
    });
  });
  return out.sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 50);
}

function msgLastRead() {
  return Number(lsGet(LS_MSG_READ, 0)) || 0;
}

function msgUnreadCount() {
  const last = msgLastRead();
  return messageList().filter((m) => (m.at || 0) > last).length;
}

function markMsgRead() {
  const list = messageList();
  const top = list.length ? Number(list[0].at) || Date.now() : Date.now();
  lsSet(LS_MSG_READ, top);
}


/* ---------------- 确认收货 + 评价 ---------------- */

/** 星级展示：4 → ★★★★☆ */
function starsRow(n) {
  const v = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return '★'.repeat(v) + '☆'.repeat(5 - v);
}

/** 订单里的商品清单（购物车订单逐件，老订单单件） */
function orderProductsOf(order) {
  if (!order) return [];
  if (order.items && order.items.length) {
    return order.items.map((it) => ({
      productId: String(it.productId || ''),
      title: it.title || '',
      qty: Number(it.qty) || 1,
    }));
  }
  return order.productId ? [{ productId: String(order.productId), title: order.title || '', qty: 1 }] : [];
}

/** 我对这笔订单某商品的评价（没有则 undefined） */
function myReviewFor(orderId, productId) {
  return (state.myReviews || []).find(
    (r) => r.orderId === orderId && String(r.productId) === String(productId)
  );
}

/** 拉取我的评价（失败不阻塞页面） */
async function refreshMyReviews() {
  if (!getToken()) {
    state.myReviews = [];
    return;
  }
  try {
    const res = await api('/api/reviews/mine');
    state.myReviews = res.reviews || [];
  } catch {
    /* 忽略 */
  }
}

/** 订单详情里的评价区：已收货后逐个商品显示「已评价 / 去评价」 */
function reviewEntriesHTML(order) {
  const prods = orderProductsOf(order).filter((p) => p.productId);
  if (!prods.length) return '';
  return `<div class="review-list">${prods
    .map((p) => {
      const mine = myReviewFor(order.id, p.productId);
      if (mine) {
        return `<div class="review-entry"><span class="k">${esc(p.title)}</span><span class="v"><span class="review-stars">${starsRow(
          mine.rating
        )}</span> 已评价${mine.hidden ? ' · 待审核' : ''}</span></div>`;
      }
      return `<button class="btn-ghost" data-act="review" data-id="${esc(p.productId)}" data-order="${esc(
        order.id
      )}" style="margin-top:10px">评价「${esc(p.title)}」</button>`;
    })
    .join('')}</div>`;
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
    err.code = data.code || null;
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
  // 换内容后回到顶部：否则从很长的订单列表点进详情，会停在中间看起来像「没打开」
  try {
    sheetEl.scrollTop = 0;
  } catch (e) {
    /* ignore */
  }
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

  // 后台配置的主题色：写进根变量，按钮/高亮/渐变跟着变
  const h = homeCfg();
  const root = document.documentElement;
  if (root && root.style) {
    root.style.setProperty('--accent', h.theme.accent);
    root.style.setProperty('--accent-2', h.theme.accent2);
  }

  // 底部导航文案与显隐（内容页可以在后台整块关掉）
  applyTabs(h.tabs);

  // 回到顶部按钮也可以在后台关掉
  const toTopBtn = document.getElementById('toTop');
  if (toTopBtn) toTopBtn.style.display = h.modules.toTop ? '' : 'none';

  // favicon / 主屏图标：只有在后台设了自定义图标时才覆盖，否则保留服务端默认
  const href = withShare(s.iconUrl || '/api/brand/icon');
  const icon = $('#appIcon');
  if (icon) icon.href = href;
  applyIosApp();
}

/** 底部导航：后台可改文案、可隐藏「内容」页 */
function applyTabs(tabs) {
  const cfg = tabs || HOME_FALLBACK.tabs;
  const bar = document.getElementById('tabbar');
  if (!bar) return;
  const labels = { home: cfg.home, content: cfg.content, cart: cfg.cart || '购物车', mine: cfg.mine };
  bar.querySelectorAll('.tab').forEach((t) => {
    const key = t.dataset.tab;
    const span = t.querySelector('span');
    if (span && labels[key]) span.textContent = labels[key];
    if (key === 'content') t.hidden = cfg.contentOn === false;
  });
  // 内容页被关掉时，停留在内容页要自动回首页
  if (cfg.contentOn === false && state.tab === 'content') state.tab = 'home';
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

function isFav(id) {
  return (state.favorites || []).includes(id);
}

function contentCardHTML(c, big = false) {
  const locked = Boolean(c.locked);
  const price = Math.max(0, Number(c.price) || 0);
  const fav = isFav(c.id);
  const views = Math.max(0, Number(c.views) || 0);
  const thumb = c.image
    ? `<span class="content-thumb ${locked ? 'is-locked' : ''}"><img src="${esc(c.image)}" alt="${esc(c.title)}" /></span>`
    : `<span class="content-thumb is-blank"><span>${locked ? '🔒' : esc((c.title || '内').trim().slice(0, 1))}</span></span>`;
  // 付费内容：会员免费看全部；非会员可以单篇解锁（price>0 才卖），正文由服务端抹掉
  const descHTML = locked
    ? `<span class="content-desc is-locked">${
        price > 0 ? `会员免费看 · 或 ${yuan(price)} 单篇解锁` : '会员专享内容，开通会员后查看全文'
      }</span>`
    : c.desc
      ? `<span class="content-desc">${esc(c.desc)}</span>`
      : '';
  const badge = locked
    ? `<span class="tag tag-gold">${price > 0 ? '付费内容' : '会员专享'}</span>`
    : c.unlocked
      ? '<span class="tag tag-blue">已解锁</span>'
      : c.tag
        ? `<span class="tag tag-blue">${esc(c.tag)}</span>`
        : '';
  // 归档信息：分类 / 阅读量，给内容一点「有人在看」的实感
  const meta = [c.category ? esc(c.category) : '', views ? `👁 ${views}` : ''].filter(Boolean).join(' · ');
  const body = `
    ${thumb}
    <span class="content-main">
      <span class="content-title">${esc(c.title)}${badge}</span>
      ${descHTML}
      ${meta ? `<span class="content-meta">${meta}</span>` : ''}
    </span>
    ${
      state.viewer
        ? `<span class="fav-btn ${fav ? 'on' : ''}" role="button" tabindex="0" aria-label="${
            fav ? '取消收藏' : '收藏'
          }" data-act="fav" data-id="${esc(c.id)}">${fav ? '★' : '☆'}</span>`
        : ''
    }`;
  const cls = 'content-card' + (big ? ' is-big' : '') + (locked ? ' is-locked' : '');
  if (locked) {
    return `<button class="${cls}" data-act="locked-content" data-id="${esc(c.id)}">${body}</button>`;
  }
  if (c.link) {
    return `<a class="${cls}" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">${body}</a>`;
  }
  // 已可读（会员 / 已解锁 / 免费）：点开看全文
  return `<button class="${cls}" data-act="open-content" data-id="${esc(c.id)}">${body}</button>`;
}

/* ---------------- 首页商品：搜索 + 筛选 + 卡片 ---------------- */

/** 已买过的商品 id（只算已支付订单），用于「已购」标记与筛选 */
function boughtProductIds() {
  const set = new Set();
  (state.orders || []).forEach((o) => {
    if (o.status === 'paid' && o.productId) set.add(o.productId);
  });
  return set;
}

const GOODS_FILTERS = {
  all: { label: '全部', match: () => true },
  member: { label: '会员专享', match: (p) => Boolean(p.memberOnly) },
  deal: { label: '有优惠', match: (p) => Number(p.memberPrice) > 0 },
  owned: { label: '已购', match: (p) => boughtProductIds().has(p.id) },
};

/** 按搜索词 + 当前筛选条件挑出要展示的商品 */
function visibleGoods() {
  const q = String(state.goodsQuery || '').trim().toLowerCase();
  const f = GOODS_FILTERS[state.goodsFilter] || GOODS_FILTERS.all;
  const list = (state.products || []).filter((p) => {
    if (!f.match(p)) return false;
    if (!q) return true;
    return `${p.title || ''} ${p.desc || ''} ${p.tag || ''}`.toLowerCase().includes(q);
  });
  const sort = state.goodsSort;
  if (sort === 'hot') {
    // 真实销量优先，销量相同保持后台排序
    return list.slice().sort((a, b) => (Number(b.sales) || 0) - (Number(a.sales) || 0));
  }
  if (sort === 'priceAsc') return list.slice().sort((a, b) => memberPriceOf(a) - memberPriceOf(b));
  if (sort === 'priceDesc') return list.slice().sort((a, b) => memberPriceOf(b) - memberPriceOf(a));
  return list;
}

function goodsCardHTML(p) {
  const owned = boughtProductIds().has(p.id);
  const idx = Math.max(0, (state.products || []).findIndex((x) => x.id === p.id));
  const fav = goodsFavOn(p.id);
  const sold = Number(p.sales) || 0;
  return `
        <button class="goods-card${p.memberOnly && !viewerIsMember() ? ' is-locked' : ''}" data-act="goods" data-id="${esc(p.id)}">
          ${p.memberOnly ? '<span class="goods-badge">会员专享</span>' : ''}
          ${owned ? '<span class="goods-owned">已购</span>' : ''}
          <span class="goods-fav${fav ? ' on' : ''}" data-act="goods-fav" data-id="${esc(p.id)}" role="button" aria-label="${
            fav ? '取消收藏' : '收藏商品'
          }">${fav ? '♥' : '♡'}</span>
          ${
            p.image
              ? `<span class="goods-thumb"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" /></span>`
              : `<span class="goods-emoji">${GOODS_ICONS[idx % GOODS_ICONS.length]}</span>`
          }
          <span class="goods-name">${esc(p.title)}</span>
          ${
            Number(p.reviewCount) > 0
              ? `<span class="goods-rate">⭐ ${Number(p.rating || 0).toFixed(1)}<i>${p.reviewCount} 条评价</i></span>`
              : ''
          }
          ${p.desc ? `<span class="goods-desc">${esc(p.desc)}</span>` : ''}
          <span class="goods-foot">
            <b>${yuan(memberPriceOf(p))}</b>
            ${Number(p.memberPrice) > 0 ? `<s>${yuan(p.amount)}</s>` : ''}
            <em>${esc(p.memberOnly && !viewerIsMember() ? '开通会员' : p.tag || '购买')}</em>
          </span>
          ${sold ? `<span class="goods-sold">已售 ${sold}</span>` : ''}
        </button>`;
}

/** 只重绘商品网格，不动搜索框（避免输入时丢焦点） */
function refreshGoodsBox() {
  const box = document.getElementById('goodsBox');
  if (!box) return;
  const list = visibleGoods();
  const total = (state.products || []).length;
  box.innerHTML = list.length
    ? list.map(goodsCardHTML).join('')
    : `<div class="goods-none">
         <span>🔍</span>
         <p>没有找到相关商品</p>
         <button class="mini-btn" data-act="goods-reset">清空筛选</button>
       </div>`;
  if (list.length) {
    // 有结果时把 index 重新对齐，保证 emoji 图标与商品一一对应
    [...box.querySelectorAll('.goods-card')].forEach((el) => {
      const idx = (state.products || []).findIndex((p) => p.id === el.dataset.id);
      const emoji = el.querySelector('.goods-emoji');
      if (emoji && idx >= 0) emoji.textContent = GOODS_ICONS[idx % GOODS_ICONS.length];
    });
  }
  const meta = document.getElementById('goodsMeta');
  if (meta) meta.textContent = list.length === total ? `${total} 件` : `${list.length} / ${total} 件`;
  const clear = document.getElementById('goodsClear');
  if (clear) clear.hidden = !state.goodsQuery;
}

function goodsSectionHTML() {
  const goods = state.products || [];
  if (!goods.length) {
    return `
      <div class="section-head"><h2>${esc(homeCfg().goodsTitle)}</h2><span>0 件</span></div>
      <div class="card"><div class="empty" style="padding:22px 8px"><p>后台还没有上架商品</p></div></div>`;
  }
  const chips = Object.entries(GOODS_FILTERS)
    .filter(([k]) => k === 'all' || goods.some((p) => GOODS_FILTERS[k].match(p)))
    .map(
      ([k, f]) =>
        `<button class="gchip ${state.goodsFilter === k ? 'on' : ''}" data-act="goods-filter" data-f="${k}">${f.label}</button>`
    )
    .join('');
  const searchOn = homeCfg().modules.search;
  const sort = state.goodsSort;
  const sorts = [
    ['default', '综合'],
    ['hot', '销量'],
    ['price', sort === 'priceDesc' ? '价格 ↓' : '价格 ↑'],
  ]
    .map(
      ([k, label]) =>
        `<button class="gsort ${
          (k === 'price' ? sort === 'priceAsc' || sort === 'priceDesc' : sort === k) ? 'on' : ''
        }" data-act="goods-sort" data-s="${k}">${label}</button>`
    )
    .join('');
  const history = searchOn && !state.goodsQuery ? searchHistoryList() : [];
  return `
    <div class="section-head"><h2>${esc(homeCfg().goodsTitle)}</h2><span id="goodsMeta">${goods.length} 件</span></div>
    ${
      searchOn
        ? `<div class="search-bar">
      <span class="search-icon" aria-hidden="true">🔍</span>
      <input id="goodsSearch" type="search" placeholder="搜索商品名称或描述" value="${esc(state.goodsQuery)}" autocomplete="off" />
      <button class="search-clear" id="goodsClear" data-act="goods-clear" aria-label="清空搜索" ${state.goodsQuery ? '' : 'hidden'}>✕</button>
    </div>
    ${
      history.length
        ? `<div class="sh-row"><span class="sh-label">最近</span>${history
            .map(
              (q) =>
                `<button class="sh-chip" data-act="goods-search-q" data-q="${esc(q)}">${esc(q)}</button>`
            )
            .join('')}<button class="sh-clear" data-act="goods-search-clear" aria-label="清空搜索历史">清空</button></div>`
        : ''
    }
    <div class="gchips">${chips}</div>
    <div class="gsorts">${sorts}</div>`
        : ''
    }
    <div class="goods-grid" id="goodsBox">${visibleGoods().map(goodsCardHTML).join('')}</div>`;
}

/** 首页顶部的待支付提醒：有没付完的订单就顶在最上面，点一下直接回去付 */
function unpaidBannerHTML() {
  if (!state.viewer) return ''; // 游客的旧订单不在这里打扰，登录后再说
  const list = dropExpiredOrders(state.orders).filter(isUnpaid);
  if (!list.length) return '';
  const first = list[0];
  const deadline = orderDeadline(first);
  const title = list.length > 1 ? `${list.length} 笔订单待支付` : '还有 1 笔订单待支付';
  return `
    <button class="unpaid-bar" data-act="order" data-id="${esc(first.id)}">
      <span class="unpaid-ico">⏳</span>
      <span class="unpaid-main">
        <b>${title}</b>
        <i>${esc(first.title)} · ${yuan(first.amount)}</i>
      </span>
      <span class="order-count" data-until="${deadline}">剩余 ${mmss(deadline - Date.now())}</span>
      <span class="unpaid-go">去支付 ›</span>
    </button>`;
}

/* ---------------- 首页展示配置（后台「站点设置」里改） ---------------- */

const HOME_FALLBACK = {
  trust: [
    { icon: '🔒', title: '安全支付', desc: '官方通道', on: true },
    { icon: '⚡', title: '即时到账', desc: '分钟级', on: true },
    { icon: '💬', title: '售后无忧', desc: '在线客服', on: true },
  ],
  goodsTitle: '在售商品',
  contentTitle: '精选内容',
  homeTitle: '',
  support: { wechat: '', phone: '', note: '' },
  // 后台可控制的前端项（缺省都按「显示 / 默认色 / 默认文案」处理）
  modules: {
    goods: true,
    contents: true,
    trust: true,
    unpaid: true,
    notice: true,
    search: true,
    member: true,
    recharge: true,
    toTop: true,
    support: true,
  },
  theme: { accent: '#5a5cf0', accent2: '#8b5cf6' },
  tabs: { home: '首页', content: '内容', mine: '我的', contentOn: true },
  banner: { on: false, text: '', sub: '', btn: '', link: '', bg: '#5a5cf0' },
  entries: [],
};

/** 后台没配或字段缺失时回退到默认，保证首页不会出现空白块 */
function homeCfg() {
  const h = (state.site && state.site.home) || {};
  const trust =
    Array.isArray(h.trust) && h.trust.length ? h.trust.filter((t) => t && t.title && t.on !== false) : HOME_FALLBACK.trust;
  const support = h.support && typeof h.support === 'object' ? h.support : {};
  const mods = h.modules && typeof h.modules === 'object' ? h.modules : {};
  const modules = {};
  Object.keys(HOME_FALLBACK.modules).forEach((k) => {
    modules[k] = mods[k] !== false;
  });
  const theme = h.theme && typeof h.theme === 'object' ? h.theme : {};
  const tabs = h.tabs && typeof h.tabs === 'object' ? h.tabs : {};
  const banner = h.banner && typeof h.banner === 'object' ? h.banner : {};
  return {
    trustOn: h.trustOn !== false && modules.trust,
    trust,
    goodsTitle: h.goodsTitle || HOME_FALLBACK.goodsTitle,
    homeTitle: h.homeTitle || '',
    contentTitle: h.contentTitle || HOME_FALLBACK.contentTitle,
    support: {
      wechat: support.wechat || '',
      phone: support.phone || '',
      note: support.note || '',
    },
    modules,
    theme: {
      accent: theme.accent || HOME_FALLBACK.theme.accent,
      accent2: theme.accent2 || theme.accent || HOME_FALLBACK.theme.accent2,
    },
    tabs: {
      home: tabs.home || HOME_FALLBACK.tabs.home,
      content: tabs.content || HOME_FALLBACK.tabs.content,
      mine: tabs.mine || HOME_FALLBACK.tabs.mine,
      contentOn: tabs.contentOn !== false && modules.contents,
    },
    banner: {
      on: banner.on === true && Boolean(banner.text) && modules.notice !== false,
      text: banner.text || '',
      sub: banner.sub || '',
      btn: banner.btn || '',
      link: banner.link || '',
      bg: banner.bg || HOME_FALLBACK.banner.bg,
    },
    entries: Array.isArray(h.entries) ? h.entries.filter((e) => e && e.title && e.on !== false) : [],
  };
}

/** 客服信息是否有内容可展示 */
function hasSupport() {
  const s = homeCfg().support;
  return Boolean(s.wechat || s.phone);
}

/** 服务保障条：后台可改文案、可关掉单项；配了客服信息时「在线客服」可点开 */
function trustRowHTML() {
  const cfg = homeCfg();
  if (cfg.trustOn === false) return '';
  const list = cfg.trust;
  if (!list.length) return '';
  return `<div class="trust-row">${list
    .map((t) => {
      const clickable = hasSupport();
      const tag = clickable ? 'button' : 'div';
      return `<${tag} class="trust-item${clickable ? ' is-link' : ''}"${
        clickable ? ' data-act="support"' : ''
      }>
        <span class="trust-ico">${esc(t.icon || '')}</span><b>${esc(t.title)}</b>${
        t.desc ? `<i>${esc(t.desc)}</i>` : ''
      }
      </${tag}>`;
    })
    .join('')}</div>`;
}

/** 客服弹层：微信号 / 手机号一键复制 */
function supportSheet() {
  const s = homeCfg().support;
  if (!s.wechat && !s.phone) return toast('商家还没有填客服联系方式');
  const rows = [
    s.wechat
      ? `<div class="sup-row">
           <span class="sup-k">微信</span>
           <span class="sup-v">${esc(s.wechat)}</span>
           <button class="copy-mini" data-act="copy-text" data-id="${esc(s.wechat)}">复制</button>
         </div>`
      : '',
    s.phone
      ? `<div class="sup-row">
           <span class="sup-k">电话</span>
           <span class="sup-v">${esc(s.phone)}</span>
           <button class="copy-mini" data-act="copy-text" data-id="${esc(s.phone)}">复制</button>
         </div>`
      : '',
  ].join('');
  openSheet(`
    <h3>联系客服</h3>
    <p class="muted" style="font-size:12.5px;margin:6px 0 14px;line-height:1.7">
      ${esc(s.note || '有任何问题都可以找我们，看到会尽快回复')}
    </p>
    ${rows}
    <button class="btn-ghost" data-act="close" style="margin-top:14px">关闭</button>
  `);
}

/** 首页「最近看过」：读本地足迹，只展示还在架的商品；不足 2 条不打扰 */
function footprintStripHTML() {
  const seen = footprintList().map((x) => String(x.id));
  const items = [];
  seen.forEach((id) => {
    const p = (state.products || []).find((x) => String(x.id) === id);
    if (p && !items.some((y) => y.id === p.id)) items.push(p);
  });
  if (items.length < 2) return '';
  return `
    <div class="section-head">
      <h2>最近看过</h2>
      <button class="mini-btn" data-act="open-footprint">全部 ${items.length} 件 ›</button>
    </div>
    <div class="fp-row">
      ${items
        .slice(0, 8)
        .map((p) => {
          const idx = Math.max(0, (state.products || []).findIndex((x) => x.id === p.id));
          return `<button class="fp-card" data-act="goods" data-id="${esc(p.id)}">
            ${
              p.image
                ? `<span class="fp-thumb"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" /></span>`
                : `<span class="fp-emoji">${GOODS_ICONS[idx % GOODS_ICONS.length]}</span>`
            }
            <span class="fp-name">${esc(p.title)}</span>
            <span class="fp-price">${yuan(memberPriceOf(p))}</span>
          </button>`;
        })
        .join('')}
    </div>`;
}

function renderHome() {
  const s = state.site || {};
  const v = state.viewer;
  const paidCount = state.orders.filter((o) => o.status === 'paid').length;
  const homeTitle = homeCfg().homeTitle;
  const title = homeTitle ? esc(homeTitle) : s.tagline ? esc(s.tagline) : '选一件商品，走一遍完整支付';
  const channelName = state.channels.wechat
    ? '微信支付'
    : state.channels.alipay
      ? '支付宝'
      : state.channels.alipayQr
        ? '支付宝扫码'
        : '模拟收银台';
  const noticeHTML =
    s.notice && homeCfg().modules.notice
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
    ${bannerHTML()}
    ${homeCfg().modules.unpaid ? unpaidBannerHTML() : ''}

    ${homeCfg().modules.trust ? trustRowHTML() : ''}

    ${entriesHTML()}

    ${homeCfg().modules.goods ? goodsSectionHTML() : ''}

    ${homeCfg().modules.goods ? footprintStripHTML() : ''}

    ${
      homeCfg().modules.contents
        ? `<div class="section-head">
      <h2>${esc(homeCfg().contentTitle)}</h2>
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
    }`
        : ''
    }
  `;
}

/** 后台配的跳转地址：外部链接新窗口打开，站内路径直接走 */
function goLink(link) {
  const url = String(link || '').trim();
  if (!url) return toast('还没设置跳转地址');
  if (/^https?:\/\//i.test(url)) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  location.href = withShare(url.startsWith('/') ? url : '/' + url);
}

/* ---------------- 后台可配的首页横幅 / 快捷入口 ---------------- */

/** 首页横幅：后台填了文案并打开开关才显示 */
function bannerHTML() {
  const b = homeCfg().banner;
  if (!b.on) return '';
  const style = `background:${esc(b.bg)}`;
  const inner = `
    <span class="banner-main">
      <b>${esc(b.text)}</b>
      ${b.sub ? `<i>${esc(b.sub)}</i>` : ''}
    </span>
    ${b.btn ? `<span class="banner-btn">${esc(b.btn)}</span>` : ''}`;
  const cls = 'home-banner' + (b.link ? ' is-link' : '');
  if (b.link) {
    return `<button class="${cls}" style="${style}" data-act="home-banner">${inner}</button>`;
  }
  return `<div class="${cls}" style="${style}">${inner}</div>`;
}

/** 快捷入口宫格：后台添加什么就显示什么 */
function entriesHTML() {
  const list = homeCfg().entries;
  if (!list.length) return '';
  return `<div class="entry-grid">${list
    .map(
      (e, i) => `<button class="entry-item" data-act="home-entry" data-i="${i}">
        <span class="entry-icon">${esc(e.icon || '🔗')}</span>
        <span class="entry-title">${esc(e.title)}</span>
      </button>`
    )
    .join('')}</div>`;
}

/* ---------------- 渲染：内容 ---------------- */

/** 内容分类（按出现顺序去重，后台没填分类的内容不进 chips） */
function contentCats(list) {
  const out = [];
  (list || []).forEach((c) => {
    const cat = String(c.category || '').trim();
    if (cat && !out.includes(cat)) out.push(cat);
  });
  return out;
}

/** 内容页当前筛选结果（分类 + 关键词 + 只看收藏） */
function filteredContents() {
  const q = (state.contentQuery || '').trim().toLowerCase();
  const cat = state.contentCat || 'all';
  return (state.contents || []).filter((c) => {
    if (cat === '__fav' && !isFav(c.id)) return false;
    if (cat !== 'all' && cat !== '__fav' && String(c.category || '') !== cat) return false;
    if (q) {
      const hay = `${c.title || ''} ${c.desc || ''} ${c.tag || ''} ${c.category || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** 内容列表（单独抽出来，输入搜索时只换这一块，输入框不丢焦点） */
function contentListHTML() {
  const list = filteredContents();
  if (!list.length) {
    const empty = (state.contentQuery || '').trim() || state.contentCat !== 'all';
    return `<div class="card"><div class="empty" style="padding:26px 10px">
      <div class="empty-icon">${ICON.box}</div>
      <h3>${empty ? '没有符合条件的内容' : '还没有内容'}</h3>
      <p>${
        empty
          ? '换个关键词或分类试试，<br/>也可以点「全部」看所有内容'
          : '在后台「首页内容」里添加图文，<br/>这里会自动同步显示'
      }</p>
    </div></div>`;
  }
  return `<div class="content-list">${list.map((c) => contentCardHTML(c, true)).join('')}</div>`;
}

function renderContent() {
  const all = state.contents || [];
  const cats = contentCats(all);
  const favN = (state.favorites || []).length;
  const chips = [
    ['all', '全部', all.length],
    ...cats.map((c) => [c, c, all.filter((x) => String(x.category || '') === c).length]),
    ...(state.viewer ? [['__fav', '★ 收藏', favN]] : []),
  ];
  return `
    <div class="section-head" style="margin-top:14px">
      <h2>${esc(homeCfg().tabs.content)}</h2>
      <span>${all.length} 条</span>
    </div>
    ${
      all.length
        ? `<div class="search-bar">
            <span class="search-icon" aria-hidden="true">🔍</span>
            <input id="contentSearch" type="search" placeholder="搜索标题 / 描述 / 分类" value="${esc(
              state.contentQuery || ''
            )}" autocomplete="off" />
            <button class="search-clear" data-act="content-clear" aria-label="清空搜索" ${
              state.contentQuery ? '' : 'hidden'
            }>✕</button>
          </div>
          ${
            cats.length || state.viewer
              ? `<div class="gchips">${chips
                  .map(
                    ([k, label, n]) =>
                      `<button class="gchip ${state.contentCat === k ? 'on' : ''}" data-act="content-cat" data-c="${esc(
                        k
                      )}">${esc(label)}${n ? ` <i>${n}</i>` : ''}</button>`
                  )
                  .join('')}</div>`
              : ''
          }
          <div id="contentListBox">${contentListHTML()}</div>`
        : `<div class="card">
             <div class="empty">
               <div class="empty-icon">${ICON.box}</div>
               <h3>还没有内容</h3>
               <p>在后台「首页内容」里添加图文，<br/>这里会自动同步显示</p>
             </div>
           </div>`
    }`;
}

/* ---------------- 渲染：我的 ---------------- */

/** 分享链接：已装到桌面 / 直接转发都用它 */
function shareUrl() {
  const base = location.origin + '/';
  return SHARECODE ? base + '?sharecode=' + encodeURIComponent(SHARECODE) : base;
}

function renderLogin() {
  const s = state.site || {};
  return `
    <div class="card auth" style="margin-top:10px">
      <div class="auth-head">
        ${logoHTML('auth-logo')}
        <h2>登录后使用</h2>
        <p>手机号 + 密码登录，可下单、查看订单</p>
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

/** 未支付订单只保留 30 分钟（与服务端 ORDER_TTL_MINUTES 一致），超时订单服务端会删除，前端同步隐藏 */
const ORDER_TTL_MS = 30 * 60 * 1000;

/** 未支付且已超时：视同已关闭，不再提供继续支付入口 */
function orderExpired(o) {
  return (
    Boolean(o) &&
    (o.status === 'created' || o.status === 'pending') &&
    Date.now() - (Number(o.createdAt) || 0) > ORDER_TTL_MS
  );
}

/** 列表里去掉超时未支付的订单 */
function dropExpiredOrders(list) {
  return (list || []).filter((o) => !orderExpired(o));
}

/** 待支付 / 支付中：都还能继续付款（超时的不算） */
function isUnpaid(o) {
  return Boolean(o) && (o.status === 'created' || o.status === 'pending') && !orderExpired(o);
}

/** 待支付订单的自动关闭时间点 */
function orderDeadline(o) {
  return (Number(o && o.createdAt) || 0) + ORDER_TTL_MS;
}

/** 毫秒 → m:ss */
function mmss(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** 这笔订单的退款申请（优先返回待审核的那条，否则返回最近一条） */
function refundOfOrder(orderId) {
  const key = String(orderId == null ? '' : orderId);
  const list = (state.refunds || []).filter((r) => String(r.orderId) === key);
  return list.find((r) => r.status === 'pending') || list[0] || null;
}

/**
 * 按 id 找订单：订单号在接口里可能是数字也可能是字符串，
 * 列表 / 用户信息 / 当前弹层三处都找一遍，避免「点了没反应」。
 */
function findOrder(id) {
  const key = String(id == null ? '' : id);
  if (!key) return null;
  const pools = [
    Array.isArray(state.orders) ? state.orders : [],
    (state.viewer && Array.isArray(state.viewer.orders) && state.viewer.orders) || [],
    sheetState.order ? [sheetState.order] : [],
  ];
  for (const pool of pools) {
    const hit = pool.find((o) => o && String(o.id) === key);
    if (hit) return hit;
  }
  return null;
}

const REFUND_REASONS = ['不想要了', '商品与描述不符', '重复购买', '服务未使用', '其他原因'];

const REFUND_STATUS_TEXT = {
  pending: '审核中',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已撤销',
};

function mineOrderRow(o) {
  const meta = [esc(o.id), timeText(o.createdAt)].join(' · ');
  const ch = mineChannelName(o);
  const chTag = ch && o.status !== 'created' ? `<span class="tag tag-blue" style="margin-left:6px">${esc(ch)}</span>` : '';
  // 退款进度：待审核 / 已拒绝都能在列表上一眼看到
  const rf = refundOfOrder(o.id);
  const rfTag =
    rf && rf.status === 'pending'
      ? '<span class="tag tag-gold" style="margin-left:6px">退款审核中</span>'
      : rf && rf.status === 'rejected'
        ? '<span class="tag tag-gray" style="margin-left:6px">退款被拒</span>'
        : '';
  // 已发货在列表上直接可见，点开详情看单号
  const shipTag = o.receivedAt
    ? '<span class="tag tag-green" style="margin-left:6px">已签收</span>'
    : o.status === 'paid' && o.shipNo
      ? '<span class="tag tag-blue" style="margin-left:6px">已发货</span>'
      : '';
  // 没付完的订单给一个明确入口，点整行就直接进支付界面
  const cta = isUnpaid(o) ? `<span class="order-cta">继续支付 ›</span>` : '';
  // 已支付且没有审核中的申请：列表上直接给「申请退款」，不用先进详情
  const refundCta =
    o.status === 'paid' && !(rf && rf.status === 'pending')
      ? `<span class="order-cta is-refund" data-act="refund" data-id="${esc(o.id)}">申请退款 ›</span>`
      : '';
  // 买过的还能再买一次：直接进收银台，不用回首页找商品
  const canReorder =
    (o.status === 'paid' || o.status === 'refunded' || o.status === 'closed') &&
    (state.products || []).some((p) => String(p.id) === String(o.productId));
  const reorderCta = canReorder
    ? `<span class="order-cta is-reorder" data-act="reorder" data-id="${esc(o.id)}">再来一单</span>`
    : '';
  // 未支付订单带倒计时：到点服务端就删了，先让用户看见剩余时间
  const left = orderDeadline(o) - Date.now();
  const countdown = isUnpaid(o)
    ? `<span class="order-count" data-until="${orderDeadline(o)}">剩余 ${mmss(left)}</span>`
    : '';
  return `
    <button class="order-row" data-act="order" data-id="${esc(o.id)}">
      <span class="order-main">
        <span class="order-title">${esc(o.title)}${chTag}${rfTag}${shipTag}</span>
        <span class="order-meta">${meta}</span>
      </span>
      <span class="order-right">
        <span class="order-amount">${yuan(o.amount)}</span>
        <span class="status ${esc(o.status)}">${STATUS_TEXT[o.status] || o.status}</span>
        ${countdown}
        ${cta}
        ${refundCta}
        ${reorderCta}
      </span>
    </button>`;
}

/** 每秒刷新倒计时；到点就把该订单从本地列表移除（服务端已删除） */
let countdownTimer = null;
function tickCountdowns() {
  const nodes = document.querySelectorAll('.order-count[data-until]');
  if (!nodes.length) {
    // 页面上已经没有倒计时了，停掉定时器，别空转
    stopCountdownTick();
    return;
  }
  let expired = false;
  nodes.forEach((n) => {
    const left = Number(n.dataset.until) - Date.now();
    if (left <= 0) {
      expired = true;
      n.textContent = '已关闭';
      n.classList.add('is-over');
      return;
    }
    const t = `剩余 ${mmss(left)}`;
    if (n.textContent !== t) n.textContent = t;
  });
  if (!expired) return;
  state.orders = dropExpiredOrders(state.orders);
  if (state.viewer) state.viewer.orders = state.orders;
  const box = document.getElementById('ordersBox');
  if (box) box.innerHTML = mineOrderList(state.orders);
  else if (!sheetEl.classList.contains('show')) render(); // 首页提醒条 / 我的页都要跟着变
  updateTabBadge();
  toast('有订单超时未支付，已自动关闭');
}

function startCountdownTick() {
  if (countdownTimer) return;
  countdownTimer = setInterval(tickCountdowns, 1000);
}

function stopCountdownTick() {
  if (!countdownTimer) return;
  clearInterval(countdownTimer);
  countdownTimer = null;
}


/** 订单筛选：待支付把 created / pending 合并成一类 */
const ORDER_FILTERS = {
  all: { label: '全部', match: () => true },
  unpaid: { label: '待支付', match: (o) => isUnpaid(o) },
  ship: {
    label: '待发货',
    match: (o) => o.status === 'paid' && !o.shipNo && (refundOfOrder(o.id) || {}).status !== 'pending',
  },
  recv: { label: '待收货', match: (o) => o.status === 'paid' && Boolean(o.shipNo) && !o.receivedAt },
  review: {
    label: '待评价',
    match: (o) => o.status === 'paid' && Boolean(o.receivedAt) && !myReviewFor(o.id, o.productId),
  },
  paid: { label: '已支付', match: (o) => o.status === 'paid' && (refundOfOrder(o.id) || {}).status !== 'pending' },
  refunding: { label: '售后中', match: (o) => (refundOfOrder(o.id) || {}).status === 'pending' },
  refunded: { label: '已退款', match: (o) => o.status === 'refunded' },
};

/** 订单搜索：商品名 / 订单号 / 渠道，忽略大小写 */
function orderMatchesQuery(o, q) {
  const key = String(q || '').trim().toLowerCase();
  if (!key) return true;
  return `${o.title || ''} ${o.id || ''} ${o.channelName || ''}`.toLowerCase().includes(key);
}

/** 订单行（筛选 + 搜索之后的结果），单独一块便于输入时只重绘列表 */
function mineOrderRowsHTML(orders, q) {
  const filter = ORDER_FILTERS[mineOrderFilter] || ORDER_FILTERS.all;
  const key = String(q == null ? state.orderQuery : q);
  const list = (orders || []).filter(filter.match).filter((o) => orderMatchesQuery(o, key));
  return list.length
    ? list.map(mineOrderRow).join('')
    : `<div class="empty" style="padding:20px 8px"><p>${key.trim() ? '没有匹配的订单' : '该状态下暂无订单'}</p></div>`;
}

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
  const q = String(state.orderQuery || '').trim();
  return `
    <div class="msearch">
      <span class="search-icon" aria-hidden="true">🔍</span>
      <input id="orderSearch" type="search" placeholder="搜商品名 / 订单号" value="${esc(state.orderQuery)}" autocomplete="off" />
      <button class="search-clear" data-act="order-search-clear" aria-label="清空搜索" ${q ? '' : 'hidden'}>✕</button>
    </div>
    <div class="mchips">${chips}</div>
    <div id="orderRows">${mineOrderRowsHTML(orders, q)}</div>`;
}

/** 已登录：头像 / 昵称 / 手机号 / 余额 / 积分 / 地址 / 会员 / 订单 / 分享 / 设置 */
/** 会员是否生效 */
function isMemberActive(v) {
  return Boolean(v && v.memberExpire && v.memberExpire > Date.now());
}

/** 当前登录用户是否会员（门禁只看服务端下发的会员有效期） */
function viewerIsMember() {
  return isMemberActive(state.viewer);
}

/** 展示价：会员且配了会员价就用会员价，否则原价 */
function memberPriceOf(p) {
  const mp = Number(p.memberPrice) || 0;
  if (viewerIsMember() && mp > 0 && mp < p.amount) return mp;
  return p.amount;
}

/**
 * 点「购买」的统一入口：登录校验 → 会员专享门禁 → 进收银台。
 * 会员商品（送会员天数）本身不受门禁限制，否则非会员永远开不了会员。
 */
function startBuy(productId) {
  if (!state.viewer) {
    closeSheet();
    state.tab = 'mine';
    render();
    toast('请先登录再下单');
    return;
  }
  const p = state.products.find((x) => x.id === productId);
  if (!p) return toast('商品不存在或已下架');
  if (p.memberOnly && Number(p.memberDays) === 0 && !viewerIsMember()) {
    toast('该商品为会员专享，开通会员后即可购买');
    return memberSheet();
  }
  sheetState.type = 'confirm';
  sheetState.product = { ...p, amount: memberPriceOf(p) };
  sheetState.channel = preferredChannel(channelList());
  confirmSheet();
}

/* ---------------- 商品详情：看得清楚再买 ---------------- */

/** 商品详情弹层：大图 + 会员价对比 + 描述 + 购买/分享 */
function goodsSheet(productId) {
  const p = (state.products || []).find((x) => x.id === productId);
  if (!p) return toast('商品不存在或已下架');
  sheetState.type = 'goods';
  sheetState.product = p;
  pushFootprint(p.id); // 记一笔浏览足迹（本机）
  const mp = Number(p.memberPrice) || 0;
  const isMember = viewerIsMember();
  const hasMemberPrice = mp > 0 && mp < p.amount;
  const showPrice = isMember && hasMemberPrice ? mp : p.amount;
  const bought = boughtProductIds().has(p.id);
  const sold = Number(p.sales) || (state.orders || []).filter((o) => o.productId === p.id && o.status === 'paid').length;
  const fav = goodsFavOn(p.id);
  const cartItem = cartList().find((x) => String(x.id) === String(p.id));
  const inCart = Boolean(cartItem);
  const inCartQty = cartItem ? cartItem.qty : 0;
  const idx = Math.max(0, state.products.findIndex((x) => x.id === p.id));
  const save = hasMemberPrice ? p.amount - mp : 0;

  const hero = p.image
    ? `<div class="gs-hero"><img src="${esc(p.image)}" alt="${esc(p.title)}" />${
        p.memberOnly ? '<span class="gs-tag">会员专享</span>' : ''
      }</div>`
    : `<div class="gs-hero is-plain"><span class="gs-emoji">${GOODS_ICONS[idx % GOODS_ICONS.length]}</span>${
        p.memberOnly ? '<span class="gs-tag">会员专享</span>' : ''
      }</div>`;

  const metaChips = [
    p.tag ? `<span class="gs-chip">${esc(p.tag)}</span>` : '',
    Number(p.memberDays) > 0 ? `<span class="gs-chip">送 ${p.memberDays} 天会员</span>` : '',
    bought ? '<span class="gs-chip is-on">你已购买过</span>' : '',
    sold ? `<span class="gs-chip">已售 ${sold}</span>` : '',
    Number(p.reviewCount) > 0 ? `<span class="gs-chip">⭐ ${Number(p.rating).toFixed(1)} · ${p.reviewCount} 条评价</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  const priceHTML = hasMemberPrice
    ? `<div class="gs-price">
         <b>${yuan(showPrice)}</b>
         ${isMember ? `<s>${yuan(p.amount)}</s><span class="gs-save">会员已省 ${yuan(save)}</span>` : `<span class="gs-save">会员价 ${yuan(mp)}</span>`}
       </div>`
    : `<div class="gs-price"><b>${yuan(p.amount)}</b></div>`;

  const recs = (state.products || []).filter((x) => String(x.id) !== String(p.id)).slice(0, 6);
  const recHTML = recs.length
    ? `<div class="gs-rec-head">大家还在看</div>
       <div class="fp-row">${recs
         .map((x) => {
           const xi = Math.max(0, (state.products || []).findIndex((y) => y.id === x.id));
           return `<button class="fp-card" data-act="goods" data-id="${esc(x.id)}">
             ${
               x.image
                 ? `<span class="fp-thumb"><img src="${esc(x.image)}" alt="${esc(x.title)}" loading="lazy" /></span>`
                 : `<span class="fp-emoji">${GOODS_ICONS[xi % GOODS_ICONS.length]}</span>`
             }
             <span class="fp-name">${esc(x.title)}</span>
             <span class="fp-price">${yuan(memberPriceOf(x))}</span>
           </button>`;
         })
         .join('')}</div>`
    : '';

  openSheet(`
    ${hero}
    <h3 class="gs-title">${esc(p.title)}</h3>
    ${priceHTML}
    <p class="gs-desc">${esc(p.desc || '商家还没有填写商品描述')}</p>
    ${metaChips ? `<div class="gs-chips">${metaChips}</div>` : ''}
    <div class="gs-buy-row">
      <button class="btn-ghost gs-cart" data-act="cart-add" data-id="${esc(p.id)}">
        ${inCart ? `✓ 已加购 ${inCartQty} 件` : '加入购物车'}
      </button>
      <button class="btn-primary" data-act="buy" data-id="${esc(p.id)}">
        ${p.memberOnly && !isMember ? '开通会员后购买' : '立即购买'}
      </button>
    </div>
    <div class="gs-actions">
      <button class="btn-ghost ${fav ? 'is-on' : ''}" data-act="goods-fav" data-id="${esc(p.id)}">${
        fav ? '♥ 已收藏' : '♡ 收藏'
      }</button>
      <button class="btn-ghost" data-act="share-goods" data-id="${esc(p.id)}">分享给朋友</button>
    </div>
    ${
      inCart
        ? `<button class="link-btn" data-act="go-tab" data-tab="cart">去购物车结算（${inCartQty}）›</button>`
        : fav
          ? '<button class="link-btn" data-act="open-wishlist">去心愿单看看 ›</button>'
          : '<p class="gs-tip">收藏后可在「我的 → 心愿单」随时找到</p>'
    }
    <div class="gs-reviews" id="gsReviews">
      <div class="gs-rec-head">用户评价</div>
      <p class="gs-tip">加载中…</p>
    </div>
    ${recHTML}
  `);
  loadGoodsReviews(p.id); // 异步补评价区，不阻塞弹层打开
}

/** 收藏 / 取消收藏商品：就地刷新按钮，不整页重绘 */
function paintGoodsFav(id) {
  const on = goodsFavOn(id);
  document.querySelectorAll('[data-act="goods-fav"]').forEach((el) => {
    if (String(el.dataset.id) !== String(id)) return;
    el.classList.toggle('on', on);
    el.textContent = el.closest('.goods-card') ? (on ? '♥' : '♡') : on ? '♥ 已收藏' : '♡ 收藏';
  });
}

function handleGoodsFav(id) {
  const key = String(id || '');
  if (!key) return;
  const on = toggleGoodsFav(key);
  toast(on ? '已加入心愿单' : '已取消收藏');
  // 心愿单里取消收藏要整块重绘；商品详情里重绘保持按钮文案正确
  if (sheetState.type === 'wishlist') return wishlistSheet();
  if (sheetState.type === 'goods') return goodsSheet(key);
  paintGoodsFav(key);
}

/** 再来一单：复用正常下单流程，直接进收银台 */
function reorder(orderId) {
  const o = findOrder(orderId);
  if (!o || !o.productId) return toast('这笔订单没有可复购的商品');
  if (!(state.products || []).some((p) => String(p.id) === String(o.productId))) {
    return toast('商品已下架，去首页看看别的吧');
  }
  return startBuy(o.productId);
}

/** 单个商品的分享链接：带上 ?p= 商品 id，对方打开直达详情 */
function goodsShareUrl(p) {
  const base = location.origin + '/';
  const qs = [];
  if (SHARECODE) qs.push('sharecode=' + encodeURIComponent(SHARECODE));
  qs.push('p=' + encodeURIComponent(p.id));
  return base + '?' + qs.join('&');
}

async function shareGoods(productId) {
  const p = (state.products || []).find((x) => x.id === productId);
  if (!p) return;
  const url = goodsShareUrl(p);
  // 优先调系统分享（手机端体验更好），不支持就退回复制链接
  if (navigator.share) {
    try {
      await navigator.share({ title: p.title, text: p.desc || p.title, url });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // 用户自己取消了，不打扰
    }
  }
  const ok = await copyText(url);
  toast(ok ? '商品链接已复制，发给朋友即可打开' : '复制失败，请手动复制地址栏链接');
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
  // 未登录（比如从首页快捷入口点进来）：先去登录，别硬渲染会员信息
  if (!v) {
    state.tab = 'mine';
    render();
    return toast('登录后可开通会员');
  }
  const active = isMemberActive(v);
  const goods = state.products.filter((p) => Number(p.memberDays) > 0);
  const renewOn = Boolean(v.autoRenew);
  const cycleReady = Boolean(state.site && state.site.cycleReady);
  const cycleOn = v.cycleStatus === 'NORMAL';
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
    ${
      cycleReady
        ? `<button class="autorenew-row ${cycleOn ? 'on' : ''}" data-act="${cycleOn ? 'cycle-unsign' : 'cycle-sign'}">
      <span class="autorenew-main">
        <b>${cycleOn ? '✅ 支付宝免密续费（已签约）' : '🅰️ 支付宝免密续费'}</b>
        <i>${cycleOn ? '到期由支付宝自动代扣，无需余额；点击解除' : '推荐：签约后到期自动从支付宝扣款，余额不足也不怕'}</i>
      </span>
      <span class="member-arrow">›</span>
    </button>`
        : ''
    }
    <button class="autorenew-row ${renewOn ? 'on' : ''}" data-act="toggle-autorenew">
      <span class="autorenew-main">
        <b>🔄 自动续费</b>
        <i>${renewOn ? (cycleOn ? '已开启，到期由支付宝代扣' : '已开启，到期自动从余额扣款续费，随时可关') : '开启后到期自动续费，不再断档'}</i>
      </span>
      <span class="switch ${renewOn ? 'on' : ''}"><span class="knob"></span></span>
    </button>
    <p class="cashier-note">购买会员商品支付成功后自动开通，重复购买到期时间自动顺延${renewOn ? (cycleOn ? '；到期由支付宝自动代扣' : '；自动续费将从余额扣款，请保持余额充足') : ''}</p>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>
  `);
}

/** 付费内容弹层：两条路都给——单篇解锁（永久）或开通会员（全部免费） */
/** 内容详情里的一行小信息：分类 · 阅读数 */
function contentMetaText(c) {
  const bits = [];
  if (c.category) bits.push(c.category);
  if (Number(c.views)) bits.push(`${Number(c.views)} 次阅读`);
  bits.push(new Date(c.createdAt || Date.now()).toLocaleDateString('zh-CN'));
  return bits.join(' · ');
}

/** 收藏按钮（弹层里用；卡片上用右上角的星标） */
function contentFavBtnHTML(c) {
  if (!state.viewer) return '';
  const fav = isFav(c.id);
  return `<button class="fav-sheet-btn ${fav ? 'on' : ''}" data-act="fav" data-id="${esc(c.id)}">${
    fav ? '★ 已收藏' : '☆ 收藏'
  }</button>`;
}

/** 阅读上报：同一篇 30 分钟内只报一次，避免刷新把数字刷上去 */
const VIEW_DEBOUNCE_MS = 30 * 60 * 1000;
function reportContentView(contentId) {
  if (!contentId) return;
  const key = 'viewed_' + contentId;
  try {
    const last = Number(localStorage.getItem(key) || 0);
    if (last && Date.now() - last < VIEW_DEBOUNCE_MS) return;
    localStorage.setItem(key, String(Date.now()));
  } catch {
    /* 隐私模式下 localStorage 不可用，照常上报 */
  }
  api('/api/content/view', { method: 'POST', body: JSON.stringify({ contentId }) })
    .then((r) => {
      const c = (state.contents || []).find((x) => x.id === contentId);
      if (c && r && Number(r.views) >= 0) c.views = Number(r.views);
    })
    .catch(() => {});
}

/** 星标变颜色（只改这一篇的按钮，不整页重绘，避免打断阅读） */
function paintFav(id) {
  const fav = isFav(id);
  document.querySelectorAll('[data-act="fav"]').forEach((el) => {
    if (el.dataset.id !== id) return;
    if (el.classList.contains('fav-btn')) {
      el.textContent = fav ? '★' : '☆';
      el.classList.toggle('on', fav);
    } else if (el.classList.contains('fav-sheet-btn')) {
      el.textContent = fav ? '★ 已收藏' : '☆ 收藏';
      el.classList.toggle('on', fav);
    }
  });
}

/** 收藏 / 取消收藏 */
async function toggleFav(contentId) {
  if (!contentId) return;
  if (!state.viewer) {
    state.tab = 'mine';
    render();
    return toast('登录后就能收藏');
  }
  try {
    const r = await api('/api/content/favorite', {
      method: 'POST',
      body: JSON.stringify({ contentId }),
    });
    const set = new Set(state.favorites || []);
    if (r.favorited) set.add(contentId);
    else set.delete(contentId);
    state.favorites = Array.from(set);
    paintFav(contentId);
    toast(r.favorited ? '已收藏，可在「我的收藏」查看' : '已取消收藏');
  } catch (e) {
    toast(e.message || '操作失败');
  }
}

function contentSheet(contentId) {
  const c = (state.contents || []).find((x) => x.id === contentId);
  if (!c) return toast('内容不存在或已下线');
  sheetState.type = 'content';
  sheetState.content = c;
  const price = Math.max(0, Number(c.price) || 0);
  // 已经能看（会员 / 已解锁 / 免费）：直接给全文，不再出现任何付费引导
  if (!c.locked) {
    reportContentView(c.id);
    return openSheet(`
    <h3>${esc(c.title)}</h3>
    <p class="sheet-sub">${c.unlocked ? '已解锁 · 永久可看' : viewerIsMember() ? '会员权益 · 免费阅读' : '免费内容'} · ${esc(
      contentMetaText(c)
    )}</p>
    ${c.image ? `<div class="content-hero"><img src="${esc(c.image)}" alt="${esc(c.title)}" /></div>` : ''}
    <div class="content-full">${esc(c.desc || '这篇内容还没有正文，稍后再来看看～').replace(/\n/g, '<br />')}</div>
    <div class="sheet-actions">
      ${contentFavBtnHTML(c)}
      <button class="btn-ghost" data-act="close">关闭</button>
    </div>
  `);
  }
  const memberGoods = state.products.filter((p) => Number(p.memberDays) > 0).sort((a, b) => a.amount - b.amount);
  const cheapest = memberGoods[0];
  openSheet(`
    <h3>${esc(c.title)}</h3>
    <p class="sheet-sub">${price > 0 ? '这是付费内容，两种方式都能看全文' : '这是会员专享内容，开通会员后可看全文'}${
      c.category ? ' · ' + esc(c.category) : ''
    }</p>
    <div class="paywall-box">
      <span class="pw-lock">🔒</span>
      <span class="pw-main">
        <b>${price > 0 ? `${yuan(price)} 单篇解锁` : '开通会员查看'}</b>
        <i>${price > 0 ? '一次购买，永久可看，不会再收费' : '会员期内所有内容免费看'}</i>
      </span>
    </div>
    ${
      price > 0
        ? `<button class="btn-primary" data-act="unlock-content" data-id="${esc(c.id)}">${yuan(price)} 解锁这篇</button>`
        : ''
    }
    <button class="${price > 0 ? 'btn-ghost' : 'btn-primary'}" data-act="open-member" style="margin-top:10px">
      ${cheapest ? `开通会员全部免费看（${yuan(cheapest.amount)} 起）` : '查看会员中心'}
    </button>
    <p class="cashier-note">已经是会员？会员期内这篇不用再买，直接点开就能看</p>
  `);
}

/** 进入单篇解锁收银台（内容页与弹层共用） */
function startUnlockContent(contentId) {
  const c = (state.contents || []).find((x) => x.id === contentId);
  if (!c) return toast('内容不存在或已下线');
  const price = Math.max(0, Number(c.price) || 0);
  if (!price) return memberSheet();
  sheetState.type = 'confirm';
  sheetState.product = {
    contentId: c.id,
    id: 'c:' + c.id,
    title: `解锁《${c.title}》`,
    desc: '单篇解锁 · 永久可看',
    amount: price,
  };
  sheetState.channel = preferredChannel(channelList());
  return confirmSheet();
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
    ${homeCfg().modules.recharge ? '<button class="btn-primary" data-act="recharge" style="margin-top:12px">充值到余额</button>' : ''}
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

/** 订单列表弹层：从「我的」页入口点进来，替代直接铺在页面上 */
function ordersSheet() {
  const orders = dropExpiredOrders(state.orders);
  const paidSum = orders
    .filter((o) => o.status === 'paid' || o.status === 'refunded')
    .reduce((s, o) => s + (Number(o.amount) || 0), 0);
  openSheet(`
    <h3>我的订单</h3>
    <p class="sheet-sub">共 ${orders.length} 条${paidSum ? ` · 累计消费 ${yuan(paidSum)}` : ''}，点订单可查看详情或继续支付</p>
    <div class="card" style="margin-top:10px" id="ordersBox">${mineOrderList(orders)}</div>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>
  `);
  startCountdownTick();
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

/* ---------------- 购物车页 ---------------- */

/** 单行购物车明细：图 / 标题 / 标签 / 单价 / 数量步进 / 删除 */
function cartLineHTML(r) {
  const p = r.product;
  const idx = p ? Math.max(0, (state.products || []).findIndex((x) => String(x.id) === String(p.id))) : 0;
  const thumb = p
    ? p.image
      ? `<img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" />`
      : `<span class="cart-emoji">${GOODS_ICONS[idx % GOODS_ICONS.length]}</span>`
    : '<span class="cart-emoji">🚫</span>';
  const memberOn = Boolean(p && viewerIsMember() && Number(p.memberPrice) > 0 && Number(p.memberPrice) < p.amount);
  const tags = [
    r.gone ? '<span class="cart-tag is-bad">已下架</span>' : '',
    r.locked ? '<span class="cart-tag is-warn">会员专享</span>' : '',
    memberOn ? '<span class="cart-tag is-ok">会员价</span>' : '',
    p && Number(p.memberDays) > 0 ? `<span class="cart-tag">送 ${p.memberDays} 天会员</span>` : '',
  ]
    .filter(Boolean)
    .join('');

  return `
    <div class="cart-item${r.gone ? ' is-gone' : ''}">
      <button class="cart-thumb" data-act="goods" data-id="${esc(r.id)}" ${r.gone ? 'disabled' : ''}>${thumb}</button>
      <div class="cart-main">
        <div class="cart-name">${esc(p ? p.title : '商品已下架')}</div>
        ${tags ? `<div class="cart-tags">${tags}</div>` : ''}
        <div class="cart-bottom">
          <span class="cart-price">${p ? yuan(r.price) : ''}${memberOn ? `<s>${yuan(p.amount)}</s>` : ''}</span>
          <div class="stepper">
            <button data-act="cart-qty" data-id="${esc(r.id)}" data-d="-1" aria-label="减少数量" ${
              r.gone ? 'disabled' : ''
            }>−</button>
            <i>${r.qty}</i>
            <button data-act="cart-qty" data-id="${esc(r.id)}" data-d="1" aria-label="增加数量" ${
              r.gone ? 'disabled' : ''
            }>+</button>
          </div>
        </div>
      </div>
      <button class="cart-del" data-act="cart-remove" data-id="${esc(r.id)}" aria-label="删除">✕</button>
    </div>`;
}

/** 购物车页：明细 + 底部合计/结算 */
function renderCart() {
  const rows = cartRows();
  if (!rows.length) {
    const recs = (state.products || []).slice(0, 6);
    return `
      <div class="card cart-empty">
        <div class="cart-empty-ico">🛒</div>
        <h3>购物车还是空的</h3>
        <p>把想买的先加进来，一次结算更省事</p>
        <button class="btn-primary" data-act="go-tab" data-tab="home" style="margin-top:14px">去挑商品</button>
      </div>
      ${
        recs.length
          ? `<div class="section-head"><h2>随便看看</h2><span>${recs.length} 件</span></div>
             <div class="fp-row">${recs
               .map((x) => {
                 const xi = Math.max(0, (state.products || []).findIndex((y) => String(y.id) === String(x.id)));
                 return `<button class="fp-card" data-act="goods" data-id="${esc(x.id)}">
                   ${
                     x.image
                       ? `<span class="fp-thumb"><img src="${esc(x.image)}" alt="${esc(x.title)}" loading="lazy" /></span>`
                       : `<span class="fp-emoji">${GOODS_ICONS[xi % GOODS_ICONS.length]}</span>`
                   }
                   <span class="fp-name">${esc(x.title)}</span>
                   <span class="fp-price">${yuan(memberPriceOf(x))}</span>
                 </button>`;
               })
               .join('')}</div>`
          : ''
      }`;
  }

  const payable = rows.filter((r) => !r.gone && !r.locked);
  const total = payable.reduce((s, r) => s + r.sum, 0);
  const listTotal = payable.reduce((s, r) => s + (r.product ? r.product.amount * r.qty : 0), 0);
  const count = rows.reduce((s, r) => s + r.qty, 0);
  const payCount = payable.reduce((s, r) => s + r.qty, 0);
  const blocked = rows.filter((r) => r.gone || r.locked);

  return `
    <div class="cart-head">
      <h2>购物车 <span>${count} 件</span></h2>
      <button class="mini-btn" data-act="cart-clear">清空</button>
    </div>
    ${
      blocked.length
        ? `<p class="cart-hint">${
            blocked.some((r) => r.gone)
              ? '有商品已下架，已自动跳过，可直接删除'
              : '有会员专享商品，开通会员后即可一起结算'
          }</p>`
        : ''
    }
    <div class="cart-list">${rows.map(cartLineHTML).join('')}</div>
    <div class="cart-bar">
      <div class="cart-sum">
        <span>合计</span>
        <b>${yuan(total)}</b>
        ${listTotal > total ? `<s>${yuan(listTotal)}</s>` : ''}
      </div>
      <button class="btn-primary cart-pay" data-act="cart-checkout" ${payable.length ? '' : 'disabled'}>
        ${payable.length ? `去结算（${payCount}）` : '暂无可结算商品'}
      </button>
    </div>`;
}

/** 购物车结算前的确认弹层：列出明细 + 选支付方式 */
function cartConfirmSheet() {
  const rows = cartPayableRows();
  if (!rows.length) return toast('购物车里没有可结算的商品');
  const total = rows.reduce((s, r) => s + r.sum, 0);
  const count = rows.reduce((s, r) => s + r.qty, 0);
  sheetState.type = 'cart-confirm';
  sheetState.items = rows.map((r) => ({ productId: r.id, qty: r.qty }));
  sheetState.total = total;
  if (!sheetState.channel) sheetState.channel = preferredChannel(channelList());
  const ch = sheetState.channel;
  const balanceEnough = state.balance >= total;
  openSheet(`
    <h3>确认订单</h3>
    <p class="sheet-sub">共 ${count} 件商品</p>
    <div class="co-list">
      ${rows
        .map(
          (r) => `<div class="co-line">
            <span class="co-name">${esc(r.product.title)}</span>
            <i>×${r.qty}</i>
            <b>${yuan(r.sum)}</b>
          </div>`
        )
        .join('')}
    </div>
    <div class="amount-box">
      <div class="amount-label">支付金额</div>
      <div class="amount-big"><small>¥</small>${(total / 100).toFixed(2)}</div>
    </div>
    <div class="pay-list">
      ${channelItemsHTML(ch)}
    </div>
    <button class="btn-primary" id="payBtn" data-act="pay" ${ch === 'balance' && !balanceEnough ? 'disabled' : ''}>
      ${ch === 'balance' && !balanceEnough ? '余额不足' : '确认支付 ' + yuan(total)}
    </button>
    <p class="cashier-note">${
      state.channels.wechat || state.channels.alipay || state.channels.alipayQr
        ? '真实支付渠道 · 会真实扣款，请用小额测试'
        : '沙箱环境，不会产生真实扣款'
    }</p>
  `);
}

function renderUserCenter() {
  const v = state.viewer;
  const addr = v.address || {};
  const orders = v.orders || [];
  const hasAddr = Boolean(addr.detail || addr.name);
  const msgs = messageList();
  const unreadN = msgs.filter((m) => (m.at || 0) > msgLastRead()).length;
  const msgTotal = msgs.length;
  const wishN = goodsFavList().filter((id) => (state.products || []).some((p) => String(p.id) === id)).length;
  const fpN = footprintList().filter((x) => (state.products || []).some((p) => String(p.id) === String(x.id))).length;
  const cartN = cartCount();

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
            <button class="mini-btn" data-act="edit-profile">编辑资料</button>
          </div>
          <div class="profile-bio">${
            v.bio ? esc(v.bio) : '<span style="opacity:.55">还没有个性签名，点编辑资料写一句</span>'
          }</div>
          <div class="profile-sub">${esc(v.phoneMasked)} · ID ${esc(v.id.slice(0, 10))}</div>
        </div>
      </div>
      <div class="stat-row">
        <button class="stat stat-btn" data-act="open-balance" aria-label="余额中心">
          <b>${yuan(v.balance)}</b><span>余额 ›</span>
        </button>
        <div class="stat"><b>${v.points}</b><span>积分</span></div>
      </div>
    </div>

    ${homeCfg().modules.member ? memberBannerHTML(v) : ''}

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

    <div class="section-head">
      <h2>我的订单</h2>
      <button class="mini-btn" data-act="open-orders">全部订单${orders.length ? ' ' + orders.length : ''} ›</button>
    </div>

    <div class="card order-quick">
      ${[
        ['unpaid', '待付款'],
        ['ship', '待发货'],
        ['recv', '待收货'],
        ['review', '待评价'],
      ]
        .map(([k, label]) => {
          const n = orders.filter(ORDER_FILTERS[k].match).length;
          return `<button class="quick-cell${n ? ' is-on' : ''}" data-act="quick-orders" data-f="${k}">
            <b>${n}</b><span>${label}</span>
          </button>`;
        })
        .join('')}
    </div>

    <div class="section-head"><h2>我的服务</h2></div>
    <div class="card set-list">
      <button class="set-row" data-act="go-tab" data-tab="cart">
        <span>购物车${cartN ? ` <em class="dot-num">${cartN}</em>` : ''}</span>
        <i style="font-size:12px;color:var(--muted)">${cartN ? `${cartN} 件待结算` : '还没加购商品'}</i>
        <i>›</i>
      </button>
      <button class="set-row" data-act="open-messages">
        <span>消息中心${unreadN ? ` <em class="dot-num">${unreadN}</em>` : ''}</span>
        <i style="font-size:12px;color:var(--muted)">${
          unreadN ? `${unreadN} 条新动态` : msgTotal ? '订单与售后通知' : '暂无消息'
        }</i>
        <i>›</i>
      </button>
      <button class="set-row" data-act="open-wishlist">
        <span>心愿单</span>
        <i style="font-size:12px;color:var(--muted)">${
          wishN ? `${wishN} 件商品` : '收藏想买的商品'
        }</i>
        <i>›</i>
      </button>
      <button class="set-row" data-act="open-footprint">
        <span>最近浏览</span>
        <i style="font-size:12px;color:var(--muted)">${fpN ? `${fpN} 件` : '看看逛过什么'}</i>
        <i>›</i>
      </button>
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

    <div class="section-head">
      <h2>内容与帮助</h2>
      <button class="mini-btn" data-act="go-content">看内容 ›</button>
    </div>
    <div class="card set-list">
      <button class="set-row" data-act="open-favorites">
        <span>我的收藏</span>
        <i style="font-size:12px;color:var(--muted)">${
          (state.favorites || []).length ? (state.favorites || []).length + ' 篇' : '还没有收藏'
        }</i>
        <i>›</i>
      </button>
      <button class="set-row" data-act="open-refunds">
        <span>退款与售后</span>
        <i style="font-size:12px;color:var(--muted)">${
          (state.refunds || []).some((r) => r.status === 'pending')
            ? '有申请审核中'
            : (state.refunds || []).length
              ? (state.refunds || []).length + ' 条记录'
              : '申请与进度'
        }</i>
        <i>›</i>
      </button>
      <button class="set-row" data-act="feedback-new">
        <span>意见反馈</span>
        <i style="font-size:12px;color:var(--muted)">想加功能 / 遇到问题</i>
        <i>›</i>
      </button>
      <button class="set-row" data-act="feedback-mine"><span>我的反馈</span><i>›</i></button>
    </div>

    <div class="section-head"><h2>设置</h2></div>
    <div class="card set-list">
      <button class="set-row" data-act="settings">
        <span>设置中心</span>
        <i style="font-size:12px;color:var(--muted)">${isDark() ? '深色模式开 · ' : ''}账号安全 / 外观 / 通用</i>
        <i>›</i>
      </button>
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
    state.orders = dropExpiredOrders(orders);
    state.viewer.orders = state.orders;
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
  state.orders = dropExpiredOrders(orders);
  state.viewer.orders = state.orders;
  // 退款进度也一起刷新（后台审核后再下拉就能看到结果）
  try {
    const { refunds } = await api('/api/refunds');
    state.refunds = Array.isArray(refunds) ? refunds : [];
  } catch (e) {
    /* 未登录或网络异常时忽略 */
  }
  render();
  return state.viewer;
}

/** 内容解锁后重新拉首页内容（正文只有服务端解锁后才下发） */
async function refreshContents() {
  try {
    const data = await api('/api/bootstrap');
    state.contents = Array.isArray(data.contents) ? data.contents : [];
    state.favorites = Array.isArray(data.favorites) ? data.favorites : [];
    state.balance = data.balance;
    state.orders = dropExpiredOrders(data.orders || []);
    if (state.viewer) state.viewer.orders = state.orders;
    render();
  } catch (e) {
    /* 失败就保持原样，用户可下拉刷新 */
  }
}

/** 退款申请提交/撤销后，重新拉一次退款列表与订单状态 */
async function refreshRefundState() {
  try {
    const data = await api('/api/bootstrap');
    state.refunds = Array.isArray(data.refunds) ? data.refunds : [];
    state.orders = dropExpiredOrders(data.orders || []);
    if (state.viewer) state.viewer.orders = state.orders;
    state.balance = data.balance;
  } catch (e) {
    /* 网络失败就保持原样，用户可以下拉刷新 */
  }
}

function copyText(text) {
  // 返回 true / false，调用方好给出准确反馈
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false
    );
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    if (typeof document.execCommand === 'function') ok = document.execCommand('copy');
  } catch (e) {
    ok = false;
  } finally {
    ta.remove();
  }
  return Promise.resolve(ok);
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

/** 编辑资料：头像 / 昵称 / 签名 / 手机号 / 密码 一处搞定 */
function profileSheet() {
  const v = state.viewer;
  if (!v) return toast('登录后可以编辑资料');
  openSheet(`
    <h3 class="sheet-title">编辑资料</h3>
    <div class="pf-head">
      ${avatarHTML(v, 'avatar-pf')}
      <button class="mini-btn" data-act="edit-avatar">换头像</button>
    </div>
    <label class="field"><span>昵称</span><input id="pfNick" maxlength="16" value="${esc(v.nickname)}" placeholder="最多 16 个字" /></label>
    <label class="field"><span>个性签名</span><input id="pfBio" maxlength="40" value="${esc(v.bio || '')}" placeholder="一句话介绍自己（最多 40 字）" /></label>
    <button class="set-row" data-act="open-phone" style="margin-top:4px">
      <span>手机号</span>
      <i style="font-size:12px;color:var(--muted)">${esc(v.phoneMasked)}</i>
      <i>›</i>
    </button>
    <button class="set-row" data-act="change-password">
      <span>登录密码</span>
      <i style="font-size:12px;color:var(--muted)">修改</i>
      <i>›</i>
    </button>
    <button class="btn-primary" data-act="save-profile" style="margin-top:14px">保存</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
  `);
}

/** 换绑手机号：需要登录密码验证（无短信通道） */
function phoneSheet() {
  const v = state.viewer;
  if (!v) return toast('登录后可以换绑手机号');
  openSheet(`
    <h3 class="sheet-title">换绑手机号</h3>
    <p class="sheet-sub">当前 ${esc(v.phoneMasked)}。换绑后请用新手机号 + 原密码登录。</p>
    <label class="field"><span>新手机号</span><input id="phNew" inputmode="numeric" maxlength="11" placeholder="11 位手机号" /></label>
    <label class="field"><span>登录密码</span><input id="phPwd" type="password" maxlength="32" placeholder="用于验证身份" /></label>
    <button class="btn-primary" data-act="save-phone" style="margin-top:14px">确认换绑</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
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

/* ---------------- 设置中心 ---------------- */

const DARK_KEY = 'dark_mode';

/** 当前是否深色模式 */
function isDark() {
  try {
    return window.document.body.classList.contains('dark');
  } catch (e) {
    return false;
  }
}

/** 应用/取消深色模式并记忆 */
function applyDark(on) {
  try {
    window.document.body.classList.toggle('dark', Boolean(on));
    localStorage.setItem(DARK_KEY, on ? '1' : '0');
  } catch (e) {
    /* 隐私模式等场景下静默失败 */
  }
}

/** 估算本地缓存占用（localStorage） */
function localStorageSize() {
  try {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      n += (String(k).length + String(localStorage.getItem(k) || '').length) * 2;
    }
    return n > 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';
  } catch (e) {
    return '';
  }
}

/** 设置中心弹层：账号安全 / 外观 / 通用 / 其他 */
function settingsSheet() {
  const dark = isDark();
  openSheet(`
    <h3 class="sheet-title">设置</h3>
    <p class="sheet-group">账号与安全</p>
    <button class="set-row" data-act="change-password"><span>修改密码</span><i>›</i></button>
    <button class="set-row" data-act="edit-address"><span>收货地址</span><i>›</i></button>
    <p class="sheet-group">外观</p>
    <button class="set-row" data-act="toggle-dark">
      <span>深色模式</span>
      <span class="switch ${dark ? 'on' : ''}"><span class="knob"></span></span>
    </button>
    <p class="sheet-group">通用</p>
    <button class="set-row" data-act="refresh"><span>刷新数据</span><i>›</i></button>
    <button class="set-row" data-act="clear-cache"><span>清除缓存</span><i style="font-size:12px;color:var(--muted)">${localStorageSize()}</i></button>
    <p class="sheet-group">帮助与反馈</p>
    <button class="set-row" data-act="feedback-new"><span>意见反馈</span><i>›</i></button>
    <button class="set-row" data-act="feedback-mine"><span>我的反馈</span><i>›</i></button>
    <p class="sheet-group">其他</p>
    <button class="set-row" data-act="about"><span>关于</span><i>›</i></button>
    <button class="set-row danger" data-act="logout"><span>退出登录</span><i>›</i></button>
    <button class="btn-ghost" data-act="close" style="margin-top:14px">关闭</button>
  `);
}

/* ---------------- 意见反馈 ---------------- */

/** 提交反馈：登录用户才能用，商家在后台「反馈」页看到并回复 */
function feedbackSheet() {
  if (!state.viewer) {
    state.tab = 'mine';
    render();
    return toast('登录后才能提交反馈');
  }
  const contact = '';
  openSheet(`
    <h3>意见反馈</h3>
    <p class="sheet-sub">用着不顺手、想加功能、遇到报错，都可以写在这里，我们看到会回复</p>
    <textarea id="fbText" class="fb-text" rows="5" maxlength="1000" placeholder="请描述你遇到的问题或想要的功能…"></textarea>
    <input id="fbContact" class="fb-input" maxlength="60" placeholder="联系方式（选填，方便我们找到你）" value="${esc(contact)}" />
    <button class="btn-primary" data-act="feedback-send" style="margin-top:12px">提交反馈</button>
    <button class="btn-ghost" data-act="feedback-mine" style="margin-top:10px">查看我提交过的反馈</button>
  `);
}

async function sendFeedback() {
  const text = (($('#fbText') || {}).value || '').trim();
  const contact = (($('#fbContact') || {}).value || '').trim();
  if (text.length < 2) return toast('请把问题描述得再具体一点');
  const btn = document.querySelector('[data-act="feedback-send"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '提交中…';
  }
  try {
    await api('/api/feedback', { method: 'POST', body: JSON.stringify({ content: text, contact }) });
    toast('已收到，感谢反馈！');
    return myFeedbackSheet();
  } catch (e) {
    toast(e.message || '提交失败');
    if (btn) {
      btn.disabled = false;
      btn.textContent = '提交反馈';
    }
  }
}

/** 我的反馈：带商家回复 */
async function myFeedbackSheet() {
  if (!state.viewer) {
    state.tab = 'mine';
    render();
    return toast('登录后才能查看反馈');
  }
  openSheet('<h3>我的反馈</h3><p class="sheet-sub">加载中…</p>');
  let list = [];
  try {
    const r = await api('/api/feedback/mine');
    list = r.feedbacks || [];
  } catch (e) {
    return openSheet(`<h3>我的反馈</h3><p class="sheet-sub">${esc(e.message || '读取失败')}</p>
      <button class="btn-ghost" data-act="close" style="margin-top:14px">关闭</button>`);
  }
  const rows = list.length
    ? list
        .map(
          (f) => `<div class="fb-item">
        <div class="fb-head">
          <span class="fb-status ${f.status === 'done' ? 'done' : ''}">${f.status === 'done' ? '已回复' : '待处理'}</span>
          <span class="muted">${timeText(f.createdAt)}</span>
        </div>
        <div class="fb-body">${esc(f.content)}</div>
        ${
          f.reply
            ? `<div class="fb-reply"><b>商家回复</b>${esc(f.reply)}</div>`
            : '<div class="muted fb-wait">商家还没回复，处理后会显示在这里</div>'
        }
      </div>`
        )
        .join('')
    : '<div class="empty" style="padding:24px 8px"><p>你还没有提交过反馈</p></div>';
  openSheet(`
    <h3>我的反馈</h3>
    <p class="sheet-sub">共 ${list.length} 条</p>
    <div class="fb-list">${rows}</div>
    <button class="btn-primary" data-act="feedback-new" style="margin-top:14px">再提一条</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>
  `);
}

/** 我的收藏：只列当前仍上线的内容 */
function favoritesSheet() {
  if (!state.viewer) {
    state.tab = 'mine';
    render();
    return toast('登录后才能收藏');
  }
  const list = (state.contents || []).filter((c) => isFav(c.id));
  openSheet(`
    <h3>我的收藏</h3>
    <p class="sheet-sub">${list.length ? list.length + ' 篇' : '还没有收藏内容'}</p>
    ${
      list.length
        ? `<div class="content-list">${list.map((c) => contentCardHTML(c)).join('')}</div>`
        : '<div class="empty" style="padding:22px 8px"><p>在内容卡片右上角点 ☆ 就能收藏</p></div>'
    }
    <button class="btn-ghost" data-act="close" style="margin-top:14px">关闭</button>
  `);
}

/* ---------------- 渲染入口 ---------------- */

const TITLES = { home: '首页', content: '内容', cart: '购物车', mine: '我的' };

/** 底部角标：「我的」= 待支付订单数，「购物车」= 已加购件数 */
function updateTabBadge() {
  paintTabBadge('.tab[data-tab="mine"]', dropExpiredOrders(state.orders || []).filter(isUnpaid).length);
  paintTabBadge('.tab[data-tab="cart"]', cartCount());
}

function paintTabBadge(selector, n) {
  const tab = document.querySelector(selector);
  if (!tab) return;
  let badge = tab.querySelector('.tab-badge');
  if (!n) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('i');
    badge.className = 'tab-badge';
    tab.appendChild(badge);
  }
  badge.textContent = n > 99 ? '99+' : String(n);
}

/** 首屏骨架屏：比转圈更接近最终版式，减少等待的突兀感 */
function skeletonHTML() {
  return `
    <div class="sk sk-hero"></div>
    <div class="sk-row">
      ${'<div class="sk sk-stat"></div>'.repeat(3)}
    </div>
    <div class="section-head"><h2>${esc(homeCfg().goodsTitle)}</h2></div>
    <div class="goods-grid">
      ${'<div class="sk-card"><div class="sk sk-block"></div><div class="sk w80"></div><div class="sk w40"></div></div>'.repeat(4)}
    </div>
    <div class="section-head"><h2>${esc(homeCfg().contentTitle)}</h2></div>
    <div class="card">
      <div class="sk w60"></div>
      <div class="sk w80"></div>
      <div class="sk w40" style="margin-bottom:0"></div>
    </div>`;
}

// 各 tab 的滚动位置：切走再切回来时还原，避免总是跳回顶部
const tabScroll = { home: 0, content: 0, cart: 0, mine: 0 };
let pendingScroll = null;

function render() {
  // 「我的」页与首页共用同一份订单：付款成功、刷新后立刻同步，避免刚付完看不到新订单
  if (state.viewer) state.viewer.orders = state.orders;
  $('#topbarTitle').textContent = TITLES[state.tab];
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('is-active', t.dataset.tab === state.tab);
  });
  updateTabBadge();
  if (!state.loaded) {
    view.innerHTML = skeletonHTML();
    return;
  }
  view.innerHTML =
    state.tab === 'home'
      ? renderHome()
      : state.tab === 'content'
        ? renderContent()
        : state.tab === 'cart'
          ? renderCart()
          : renderMine();
  if (state.tab === 'home') refreshGoodsBox(); // 统一走一遍：空结果空态、emoji 对齐、计数
  if (view.querySelector('.order-count')) startCountdownTick(); // 有待支付倒计时才开始计时
  // 切 tab 回来恢复滚动位置；其他重绘照旧回到顶部
  const restore = pendingScroll;
  pendingScroll = null;
  view.scrollTop = 0;
  if (restore) requestAnimationFrame(() => { view.scrollTop = restore; });
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
  let list = [];
  list = [];
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
    list.push({ id: 'alipay_qr', name: '支付宝扫码', cls: 'alipay', icon: ICON.alipay, extra: inWechat ? '推荐' : '扫码付' });
  }
  // 微信内置浏览器禁止跳转支付宝，列出只会让用户点了白屏，直接不放出来
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

/* ---------------- 支付方式记忆（只记真实三方渠道，不记余额） ---------------- */
const CHANNEL_KEY = 'last_channel_v1';

function preferredChannel(list) {
  let saved = '';
  try {
    saved = localStorage.getItem(CHANNEL_KEY) || '';
  } catch (e) {
    /* 隐私模式下不可用，忽略 */
  }
  if (saved && list.some((c) => c.id === saved)) return saved;
  return list[0].id;
}

function rememberChannel(id) {
  if (!id || id === 'balance') return; // 余额不足时会被禁用，不记忆
  try {
    localStorage.setItem(CHANNEL_KEY, id);
  } catch (e) {
    /* ignore */
  }
}

function channelItemsHTML(selected) {
  // 充值订单不能用余额支付，过滤掉余额渠道
  const list = channelList().filter((c) => !(sheetState.product && sheetState.product.recharge && c.id === 'balance'));
  // 微信内提示：跳转支付宝会被拦截，引导用扫码或浏览器打开
  const tip =
    /MicroMessenger/i.test(navigator.userAgent) && (state.channels || {}).alipay
      ? '<div class="pay-tip">微信内无法直接跳转支付宝：可用「支付宝扫码」付款，或复制本页网址到手机浏览器打开后再选支付宝</div>'
      : '';
  return (
    tip +
    list
      .map(
        (c) => `
        <button class="pay-item ${selected === c.id ? 'selected' : ''}" data-act="channel" data-id="${c.id}">
          <span class="pay-icon ${c.cls}">${c.icon}</span>
          <span class="pay-name">${c.name}</span>
          <span class="pay-extra">${c.id === 'balance' && state.balance < (sheetState.product ? sheetState.product.amount : 0) ? '余额不足' : c.extra}</span>
          <span class="radio"></span>
        </button>`
      )
      .join('')
  );
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

/** 跳转支付弹层：自动跳支付宝；被拦截时手动点按钮继续；付款回来自动查单 */
function redirectSheet(order, payUrl, channel) {
  sheetState.type = 'redirect';
  sheetState.order = order;
  const name = /^alipay/i.test(String(channel || order.channel || '')) ? '支付宝' : '收银台';
  openSheet(`
    <h3>正在跳转${name}付款…</h3>
    <p class="sheet-sub">${esc(order.title)} · ${yuan(order.amount)}</p>
    <div class="redirect-note">
      <p>如果没有自动跳转（部分浏览器会拦截站外跳转），点下面按钮继续付款。</p>
      <p>付款完成回到本页时，会自动帮你确认支付结果。</p>
    </div>
    <a class="btn-primary" href="${esc(payUrl)}">继续付款（手动跳转）</a>
    <button class="btn-ghost" data-act="check-order" data-id="${esc(order.id)}" style="margin-top:10px">我已完成支付，查询结果</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">暂不支付</button>
  `);
  setTimeout(() => {
    location.href = withShare(payUrl);
  }, 250);
}

/** 从支付宝回来自动确认：仅在跳转支付过渡层打开时生效 */
async function syncRedirectOrder() {
  const order = sheetState.order;
  if (sheetState.type !== 'redirect' || !order || order.status === 'paid') return;
  try {
    const res = await api(`/api/orders/${order.id}/sync`, { method: 'POST' });
    if (res.order && res.order.status === 'paid') {
      upsertOrder(res.order);
      closeSheet();
      showSuccess(res.order);
      render();
    } else if (res.order && res.order.status === 'closed') {
      upsertOrder(res.order);
      closeSheet();
      toast('这笔订单已超时失效，请重新下单');
      render();
    }
  } catch (e) {
    /* 静默：用户可手动点「查询结果」 */
  }
}

// 从支付宝付款切回浏览器时自动确认一次支付结果
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncRedirectOrder();
});

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
  if (!order || !order.id || orderExpired(order)) return;
  const idx = state.orders.findIndex((o) => String(o.id) === String(order.id));
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
    redirectSheet(res.order, res.payUrl, res.channel); // 先弹过渡层再跳：万一被浏览器拦截，用户还有手动入口
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
  const cartItems =
    sheetState.type === 'cart-confirm' && Array.isArray(sheetState.items) && sheetState.items.length
      ? sheetState.items
      : null;
  try {
    const payload = cartItems
      ? { items: cartItems.map((it) => ({ productId: it.productId, qty: it.qty })) }
      : sheetState.product.contentId
        ? { contentId: sheetState.product.contentId }
        : sheetState.product.recharge
          ? { recharge: sheetState.product.amount }
          : { productId: sheetState.product.id };
    const created = await api('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    // 购物车下单：这几件从购物车移除（万一没付成，还能在「我的订单 → 继续支付」里找回这笔单）
    if (cartItems) {
      const ids = cartItems.map((it) => String(it.productId));
      cartSave(cartList().filter((x) => !ids.includes(x.id)));
    }
    const res = await api(`/api/orders/${created.order.id}/pay`, {
      method: 'POST',
      body: JSON.stringify({ channel: sheetState.channel }),
    });
    await applyPayResult(res);
  } catch (e) {
    toast(e.message);
    if (btn) {
      btn.disabled = false;
      const amt = cartItems ? Number(sheetState.total) || 0 : sheetState.product.amount;
      btn.textContent = '确认支付 ' + yuan(amt);
    }
  }
}

function showSuccess(order) {
  // 会员商品支付成功后，静默刷新一次用户信息，让会员状态立即生效（购物车订单逐件判断）
  const boughtIds = (order.items && order.items.length ? order.items.map((it) => it.productId) : [order.productId]).filter(
    Boolean
  );
  const boughtGoods = boughtIds
    .map((id) => (state.products || []).find((x) => String(x.id) === String(id)))
    .filter(Boolean);
  if (boughtGoods.some((p) => Number(p.memberDays) > 0) || order.recharge) refreshMe().catch(() => {});
  // 内容解锁：重新拉一次内容，正文才会由服务端下发
  if (order.kind === 'content' || String(order.productId || '').startsWith('c:')) {
    refreshContents().catch(() => {});
  }
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
  // 评价状态异步补拉一次（首次打开才拉，避免循环重绘）
  if (getToken() && sheetState._revRefreshed !== order.id) {
    sheetState._revRefreshed = order.id;
    refreshMyReviews().then(() => {
      if (sheetState.type === 'order' && sheetState.order && sheetState.order.id === order.id) {
        orderSheet(sheetState.order);
      }
    });
  }
  const canQueryPay = /^alipay/i.test(String(order.channel || ''));
  // 详情页点「继续支付」时沿用原渠道（渠道还能用的话）
  if (order.channel && channelList().some((c) => c.id === order.channel)) sheetState.channel = order.channel;

  let actions;
  // 已发货时给一个直达物流查询的入口（按单号查，第三方页面无需登录）
  const trackLink = order.shipNo
    ? `<a class="btn-ghost" href="https://www.kuaidi100.com/chaxun?nu=${encodeURIComponent(order.shipNo)}" target="_blank" rel="noopener" style="margin-top:10px;display:block">查询物流进度</a>`
    : '';
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
    const rf = refundOfOrder(order.id);
    if (rf && rf.status === 'pending') {
      actions = `
        <div class="refund-note">
          <b>退款申请审核中</b>
          <i>${esc(rf.reason || '')} · ${timeText(rf.createdAt)}</i>
          <i>商家审核通过后原路退回，审核期间不用重复提交</i>
        </div>
        <button class="btn-ghost" data-act="cancel-refund" data-id="${esc(rf.id)}" style="color:#f05252">撤销申请</button>
        <button class="btn-ghost" data-act="open-refunds" style="margin-top:10px">查看售后进度</button>
        ${trackLink}
        <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>`;
    } else {
      actions = `
        ${
          rf && rf.status === 'rejected'
            ? `<div class="refund-note is-bad"><b>上次申请未通过</b><i>${esc(
                rf.adminNote || '商家未填写原因'
              )}</i><i>可以改一下说明后重新申请</i></div>`
            : rf && rf.status === 'approved'
              ? `<div class="refund-note is-ok"><b>退款已通过</b><i>${esc(rf.adminNote || '款项已原路退回')}</i></div>`
              : ''
        }
        ${
          order.receivedAt
            ? `<div class="refund-note is-ok"><b>已确认收货</b><i>${timeText(order.receivedAt)} · 用得满意的话，评价一下呗</i></div>
        ${reviewEntriesHTML(order)}`
            : `<button class="btn-primary" data-act="receive-order" data-id="${esc(order.id)}">确认收货</button>`
        }
        <button class="btn-ghost" data-act="refund" data-id="${esc(order.id)}" style="color:#f05252;margin-top:10px">申请退款 / 退货</button>
        <button class="btn-ghost" data-act="open-refunds" style="margin-top:10px">退款与售后记录</button>
        ${trackLink}
        <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>`;
    }
  } else {
    // 已退款 / 已关闭：给一句明确结论，避免用户以为「点不开」
    const rf = refundOfOrder(order.id);
    const note =
      order.status === 'refunded'
        ? `<div class="refund-note is-ok"><b>已退款</b><i>${
            order.refundedAt ? '退款时间 ' + timeText(order.refundedAt) : '款项已原路退回'
          }</i>${rf && rf.adminNote ? `<i>${esc(rf.adminNote)}</i>` : ''}</div>`
        : order.status === 'closed'
          ? '<div class="refund-note"><b>订单已关闭</b><i>这笔订单没有完成支付，无需退款</i></div>'
          : '';
    actions = `
      ${note}
      <button class="btn-primary" data-act="close">知道了</button>
      <button class="btn-ghost" data-act="open-refunds" style="margin-top:10px">退款与售后记录</button>`;
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
      ${
        order.items && order.items.length > 1
          ? `<div class="detail-row"><span class="k">商品</span><span class="v">${order.items
              .map((it) => `${esc(it.title)} ×${it.qty}`)
              .join('<br />')}</span></div>`
          : `<div class="detail-row"><span class="k">商品</span><span class="v">${esc(order.title)}</span></div>`
      }
      <div class="detail-row"><span class="k">金额</span><span class="v">${yuan(order.amount)}${
        Number(order.listAmount) > Number(order.amount) ? `<s class="detail-old">${yuan(order.listAmount)}</s>` : ''
      }</span></div>
      <div class="detail-row"><span class="k">支付方式</span><span class="v">${order.channelName}</span></div>
      <div class="detail-row">
        <span class="k">订单号</span>
        <span class="v">${esc(order.id)}
          <button class="copy-mini" data-act="copy-order" data-id="${esc(order.id)}">复制</button>
        </span>
      </div>
      <div class="detail-row"><span class="k">创建时间</span><span class="v">${timeText(order.createdAt)}</span></div>
      ${
        order.paidAt
          ? `<div class="detail-row"><span class="k">支付时间</span><span class="v">${timeText(order.paidAt)}</span></div>`
          : ''
      }
      ${
        order.status === 'paid'
          ? `<div class="detail-row"><span class="k">物流</span><span class="v">${
              order.shipNo
                ? `${esc(order.shipCompany || '快递')} ${esc(order.shipNo)}
              <button class="copy-mini" data-act="copy-shipno" data-id="${esc(order.shipNo)}">复制单号</button>${
                  order.receivedAt ? '<span class="tag tag-green" style="margin-left:6px">已签收</span>' : ''
                }`
                : '商家准备发货中，发货后这里会显示快递单号'
            }</span></div>`
          : ''
      }
      ${
        order.receivedAt
          ? `<div class="detail-row"><span class="k">收货</span><span class="v">已确认收货 · ${timeText(order.receivedAt)}</span></div>`
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

/** 申请退款 / 退货：选原因 + 补充说明，提交后等商家审核 */
function refundSheet(order) {
  sheetState.type = 'refund';
  sheetState.order = order;
  sheetState.reason = '';
  openSheet(`
    <h3>申请退款 / 退货</h3>
    <p class="sheet-sub">${esc(order.title)} · ${yuan(order.amount)}</p>
    <p class="sheet-group">退款原因</p>
    <div class="reason-chips">
      ${REFUND_REASONS.map(
        (r) => `<button class="reason-chip" data-act="refund-reason" data-r="${esc(r)}">${esc(r)}</button>`
      ).join('')}
    </div>
    <textarea class="fb-text" id="refundDetail" rows="3" maxlength="300" placeholder="补充说明（选填）：遇到的问题、期望怎么处理"></textarea>
    <div class="refund-tip">
      提交后由商家审核，通过后按原支付渠道退回（余额支付退回余额），通常 1~3 个工作日到账。<br />
      审核期间这笔订单不能重复申请，可以随时撤销。
    </div>
    <button class="btn-primary" data-act="submit-refund" data-id="${esc(order.id)}">提交申请</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
  `);
}

/** 评价弹层：点星星打分 + 写两句感受 */
function reviewSheet(order, productId, title) {
  sheetState.type = 'review';
  sheetState.order = order;
  sheetState.productId = String(productId || '');
  sheetState.reviewStars = 5;
  openSheet(`
    <h3>评价商品</h3>
    <p class="sheet-sub">${esc(title || order.title)} · 订单 ${esc(order.id)}</p>
    <div class="star-picker" id="starPicker">
      ${[1, 2, 3, 4, 5]
        .map((n) => `<button class="star-btn${n <= 5 ? ' on' : ''}" data-act="set-star" data-s="${n}" aria-label="${n} 星">★</button>`)
        .join('')}
      <span class="star-label" id="starLabel">5 分 · 非常满意</span>
    </div>
    <textarea class="fb-text" id="reviewContent" rows="4" maxlength="500" placeholder="说说商品的使用感受（选填，最多 500 字）"></textarea>
    <p class="gs-tip">评价会以昵称展示在商品页，商家能后台处理违规内容</p>
    <button class="btn-primary" data-act="submit-review" data-id="${esc(order.id)}">提交评价</button>
    <button class="btn-ghost" data-act="close" style="margin-top:10px">取消</button>
  `);
}

const STAR_LABELS = ['', '1 分 · 很不满意', '2 分 · 不满意', '3 分 · 一般', '4 分 · 满意', '5 分 · 非常满意'];

/** 星星选择就地重绘 */
function paintStars() {
  const n = sheetState.reviewStars || 5;
  const picker = $('#starPicker');
  if (!picker) return;
  picker.querySelectorAll('.star-btn').forEach((b) => b.classList.toggle('on', Number(b.dataset.s) <= n));
  const label = $('#starLabel');
  if (label) label.textContent = STAR_LABELS[n] || '';
}

/** 商品详情：拉取评价并填充到弹层里（弹层还开着且还是这个商品才填） */
async function loadGoodsReviews(productId) {
  try {
    const res = await api(`/api/reviews?productId=${encodeURIComponent(productId)}&limit=5`);
    const box = $('#gsReviews');
    if (!box || sheetState.type !== 'goods' || String(sheetState.product && sheetState.product.id) !== String(productId)) return;
    const list = res.reviews || [];
    const head =
      res.count > 0
        ? `<div class="gs-rec-head">用户评价 <span class="gs-rate">${starsRow(res.rating)} ${Number(res.rating).toFixed(1)}</span><span class="gs-rate-n">${res.count} 条</span></div>`
        : '<div class="gs-rec-head">用户评价</div>';
    box.innerHTML =
      head +
      (list.length
        ? list
            .map(
              (r) => `
        <div class="gs-review">
          <div class="gs-review-top"><b>${esc(r.nickname || '匿名用户')}</b><span class="review-stars">${starsRow(r.rating)}</span></div>
          ${r.content ? `<p class="gs-review-text">${esc(r.content)}</p>` : '<p class="gs-review-text muted">这位用户没有留下文字</p>'}
          <i class="gs-review-time">${timeText(r.createdAt)}</i>
        </div>`
            )
            .join('')
        : '<p class="gs-tip">还没有评价，购买后第一个来评价吧</p>');
  } catch {
    const box = $('#gsReviews');
    if (box) box.innerHTML = '<div class="gs-rec-head">用户评价</div><p class="gs-tip">评价加载失败，稍后再看</p>';
  }
}

/** 我的退款 / 售后记录 */
function refundsSheet() {
  sheetState.type = 'refunds';
  const list = state.refunds || [];
  const badge = (s) =>
    s === 'pending'
      ? '<span class="fb-status">审核中</span>'
      : s === 'approved'
        ? '<span class="fb-status done">已通过</span>'
        : s === 'rejected'
          ? '<span class="fb-status is-bad">已拒绝</span>'
          : '<span class="fb-status is-off">已撤销</span>';
  openSheet(`
    <h3>退款与售后</h3>
    <p class="sheet-sub">${list.length ? `共 ${list.length} 条记录` : '还没有提交过退款申请'}</p>
    ${
      list.length
        ? `<div class="fb-list">${list
            .map(
              (r) => `<div class="fb-item">
          <div class="fb-head">
            <span>${esc(r.orderTitle || r.orderId)} · ${yuan(r.amount)}</span>
            ${badge(r.status)}
          </div>
          <div class="fb-body">${esc(r.reason || '未填写原因')}${
            r.detail ? `\n${esc(r.detail)}` : ''
          }</div>
          <div class="fb-wait muted">提交于 ${timeText(r.createdAt)}${
            r.handledAt ? ` · 处理于 ${timeText(r.handledAt)}` : ''
          }</div>
          ${
            r.adminNote
              ? `<div class="fb-reply"><b>商家回复</b>${esc(r.adminNote)}</div>`
              : r.status === 'pending'
                ? '<div class="fb-wait muted">等待商家审核…</div>'
                : ''
          }
          ${
            r.status === 'pending'
              ? `<div class="sheet-actions"><button class="fav-sheet-btn" data-act="cancel-refund" data-id="${esc(
                  r.id
                )}">撤销申请</button></div>`
              : ''
          }
        </div>`
            )
            .join('')}</div>`
        : `<div class="empty" style="padding:20px 4px"><p>退款 / 退货申请提交后，可以在这里查看审核进度和商家回复</p></div>`
    }
    <button class="btn-ghost" data-act="close" style="margin-top:14px">关闭</button>
  `);
}

/**
 * 心愿单：本机收藏的商品（只在这台手机上，换设备不同步）
 * 商品下架后自动从列表里藏起来，不清空本地记录
 */
function wishlistSheet() {
  sheetState.type = 'wishlist';
  const ids = goodsFavList();
  const items = ids
    .map((id) => (state.products || []).find((p) => String(p.id) === id))
    .filter(Boolean);
  const gone = ids.length - items.length;
  openSheet(`
    <h3>心愿单</h3>
    <p class="sheet-sub">${
      items.length ? `收藏了 ${items.length} 件商品${gone ? `（另有 ${gone} 件已下架）` : ''}` : '还没有收藏商品'
    }</p>
    ${
      items.length
        ? `<div class="wish-list">${items
            .map((p) => {
              const idx = Math.max(0, (state.products || []).findIndex((x) => x.id === p.id));
              return `<div class="wish-item">
            <button class="wish-open" data-act="goods" data-id="${esc(p.id)}">
              ${
                p.image
                  ? `<span class="wish-thumb"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" /></span>`
                  : `<span class="wish-emoji">${GOODS_ICONS[idx % GOODS_ICONS.length]}</span>`
              }
              <span class="wish-main">
                <b>${esc(p.title)}</b>
                <i>${esc(p.desc || (p.memberOnly ? '会员专享' : '在售中'))}</i>
              </span>
              <span class="wish-price">${yuan(memberPriceOf(p))}</span>
            </button>
            <div class="wish-acts">
              <button class="fav-sheet-btn" data-act="buy" data-id="${esc(p.id)}">购买</button>
              <button class="fav-sheet-btn is-quiet" data-act="goods-fav" data-id="${esc(p.id)}">取消收藏</button>
            </div>
          </div>`;
            })
            .join('')}</div>`
        : `<div class="empty" style="padding:22px 4px"><p>在商品卡片右上角点 ♡ 就能收藏，方便下次再找</p></div>`
    }
    <button class="btn-ghost" data-act="close" style="margin-top:14px">关闭</button>
  `);
}

/** 最近浏览：本机足迹，按时间倒序 */
function footprintSheet() {
  sheetState.type = 'footprint';
  const rows = footprintList()
    .map((x) => {
      const p = (state.products || []).find((y) => String(y.id) === String(x.id));
      return p ? { p, at: x.at } : null;
    })
    .filter(Boolean);
  openSheet(`
    <h3>最近浏览</h3>
    <p class="sheet-sub">${rows.length ? `共 ${rows.length} 件 · 只保存在这台手机上` : '还没有浏览记录'}</p>
    ${
      rows.length
        ? `<div class="fp-list">${rows
            .map(({ p, at }) => {
              const idx = Math.max(0, (state.products || []).findIndex((x) => x.id === p.id));
              return `<button class="fp-line" data-act="goods" data-id="${esc(p.id)}">
            ${
              p.image
                ? `<span class="fp-thumb"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy" /></span>`
                : `<span class="fp-emoji">${GOODS_ICONS[idx % GOODS_ICONS.length]}</span>`
            }
            <span class="fp-line-main"><b>${esc(p.title)}</b><i>${agoText(at)}</i></span>
            <span class="fp-price">${yuan(memberPriceOf(p))}</span>
          </button>`;
            })
            .join('')}</div>
          <button class="btn-ghost" data-act="footprint-clear" style="margin-top:12px;color:#f05252">清空浏览记录</button>`
        : `<div class="empty" style="padding:22px 4px"><p>点开商品详情后，这里会留下记录</p></div>`
    }
    <button class="btn-ghost" data-act="close" style="margin-top:10px">关闭</button>
  `);
}

/** 消息中心：订单/售后动态（由订单与退款记录派生），打开即已读 */
function messagesSheet() {
  sheetState.type = 'messages';
  const list = messageList();
  const icon = { pay: '💰', refund: '↩️', unpaid: '⏳', ship: '📦' };
  markMsgRead();
  updateTabBadge();
  openSheet(`
    <h3>消息中心</h3>
    <p class="sheet-sub">${list.length ? `共 ${list.length} 条动态` : '还没有新消息'}</p>
    ${
      list.length
        ? `<div class="msg-list">${list
            .map(
              (m) => `<button class="msg-item" data-act="order" data-id="${esc(m.orderId || '')}">
          <span class="msg-ico ${esc(m.kind)}">${icon[m.kind] || '🔔'}</span>
          <span class="msg-main">
            <b>${esc(m.title)}</b>
            <i>${esc(m.text)}</i>
          </span>
          <span class="msg-time">${agoText(m.at)}</span>
        </button>`
            )
            .join('')}</div>`
        : `<div class="empty" style="padding:22px 4px"><p>下单、支付、退款有变化时，这里会收到通知</p></div>`
    }
    <button class="btn-ghost" data-act="close" style="margin-top:14px">关闭</button>
  `);
}

/**
 * 继续支付：订单已经创建过（created / pending），不再新建订单，直接对这笔订单重新拉起收银台。
 * 收银台未关闭时用户又点了一次二维码支付，也能从这里重新打开二维码。
 */
function continuePaySheet(order) {
  if (orderExpired(order)) {
    state.orders = state.orders.filter((o) => o.id !== order.id);
    closeSheet();
    render();
    toast(`订单超过 ${Math.round(ORDER_TTL_MS / 60000)} 分钟未支付，已自动关闭，请重新下单`);
    return;
  }
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
  if (!order) return false;
  if (orderExpired(order)) {
    state.orders = state.orders.filter((o) => String(o.id) !== String(order.id));
    closeSheet();
    render();
    toast(`订单超过 ${Math.round(ORDER_TTL_MS / 60000)} 分钟未支付，已自动关闭`);
    return true;
  }
  if (isUnpaid(order)) continuePaySheet(order);
  else orderSheet(order);
  return true;
}

/**
 * 点订单的唯一入口：本地找不到就向服务端补一次，
 * 任何一步失败都给明确提示，不再出现「点了没反应」。
 */
async function openOrderById(id) {
  const key = String(id == null ? '' : id);
  if (!key) {
    toast('没拿到订单号，下拉刷新后再试');
    return false;
  }
  const local = findOrder(key);
  if (local) return openOrder(local);
  try {
    const { order } = await api(`/api/orders/${encodeURIComponent(key)}`);
    if (order) {
      upsertOrder(order);
      return openOrder(order);
    }
  } catch (e) {
    toast(e.status === 404 ? '这笔订单已关闭或不存在了' : e.message || '订单详情加载失败，请下拉刷新后重试');
    return false;
  }
  toast('订单详情加载失败，请下拉刷新后重试');
  return false;
}

/* ---------------- 事件 ---------------- */

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    const next = t.dataset.tab;
    // 再点当前 tab：回到顶部并刷新一次（未读角标、订单状态等要跟着变）
    if (next === state.tab) {
      pendingScroll = 0;
      render();
      return;
    }
    tabScroll[state.tab] = view.scrollTop || 0;
    state.tab = next;
    pendingScroll = tabScroll[next] || 0;
    render();
  });
});

maskEl.addEventListener('click', closeSheet);

/* 商品详情大图：点图放大查看，点任意处关闭 */
const imgViewer = document.getElementById('imgViewer');
if (imgViewer) {
  document.addEventListener(
    'click',
    (e) => {
      const img = e.target && e.target.closest ? e.target.closest('.gs-hero img') : null;
      if (!img || !img.src) return;
      e.preventDefault();
      e.stopPropagation();
      const pic = document.getElementById('imgViewerPic');
      if (pic) pic.src = img.src;
      imgViewer.hidden = false;
    },
    true
  );
  imgViewer.addEventListener('click', () => {
    imgViewer.hidden = true;
  });
}

// 兜底：异步处理里抛异常时给一句可见提示，避免用户点了却「没反应」
window.addEventListener('unhandledrejection', (e) => {
  const err = e && e.reason;
  if (err) console.error('[app] 未处理的异常:', err);
  const msg = (err && (err.message || err.msg)) || '操作失败，请稍后重试';
  toast(String(msg).slice(0, 40));
});

// 商品搜索：边输入边过滤，只重绘网格，输入框不会丢焦点
view.addEventListener('input', (e) => {
  if (!e.target) return;
  if (e.target.id === 'goodsSearch') {
    state.goodsQuery = e.target.value || '';
    // 输入时把「最近搜索」收起来，避免占地方
    const sh = view.querySelector('.sh-row');
    if (sh) sh.hidden = Boolean(state.goodsQuery);
    refreshGoodsBox();
    return;
  }
  if (e.target.id === 'contentSearch') {
    state.contentQuery = e.target.value || '';
    const box = document.getElementById('contentListBox');
    if (box) box.innerHTML = contentListHTML();
    const clear = view.querySelector('.search-clear[data-act="content-clear"]');
    if (clear) clear.hidden = !state.contentQuery;
  }
});

// 搜索框失焦/回车时把关键词记进「最近搜索」（只在这台手机上）
view.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'goodsSearch') {
    pushSearchHistory(e.target.value);
    const sh = view.querySelector('.sh-row');
    if (sh) sh.hidden = Boolean(state.goodsQuery);
  }
});

// 订单弹层里搜订单：只重绘列表，输入框不丢焦点
sheetEl.addEventListener('input', (e) => {
  if (!e.target || e.target.id !== 'orderSearch') return;
  state.orderQuery = e.target.value || '';
  const rows = document.getElementById('orderRows');
  if (rows) rows.innerHTML = mineOrderRowsHTML(dropExpiredOrders(state.orders), state.orderQuery);
  const clear = sheetEl.querySelector('[data-act="order-search-clear"]');
  if (clear) clear.hidden = !state.orderQuery;
});

/* 下拉刷新：内容在顶部时继续往下拉，松手重新拉一遍数据 */
let pullStartY = null;
let pullDist = 0;
const pullEl = document.createElement('div');
pullEl.className = 'pull-tip';
pullEl.innerHTML = '<span class="pull-spin"></span><span class="pull-text">下拉刷新</span>';
(function mountPullTip() {
  const phone = document.querySelector('.phone');
  if (phone) phone.appendChild(pullEl);
})();

function setPull(d) {
  pullDist = d;
  const text = pullEl.querySelector('.pull-text');
  pullEl.style.opacity = d > 6 ? '1' : '0';
  pullEl.style.transform = `translate(-50%, ${Math.min(d, 70) - 46}px)`;
  if (text) text.textContent = d >= 56 ? '松开刷新' : '下拉刷新';
  pullEl.classList.toggle('is-ready', d >= 56);
}

view.addEventListener(
  'touchstart',
  (e) => {
    if (sheetEl.classList.contains('show') || view.scrollTop > 0 || e.touches.length !== 1) {
      pullStartY = null;
      return;
    }
    pullStartY = e.touches[0].clientY;
  },
  { passive: true }
);
view.addEventListener(
  'touchmove',
  (e) => {
    if (pullStartY == null) return;
    const dy = e.touches[0].clientY - pullStartY;
    setPull(dy <= 0 ? 0 : Math.min(96, dy * 0.55));
  },
  { passive: true }
);
view.addEventListener('touchend', async () => {
  if (pullStartY == null) return;
  pullStartY = null;
  const shouldRefresh = pullDist >= 56;
  setPull(0);
  if (!shouldRefresh) return;
  pullEl.classList.add('is-loading');
  const text = pullEl.querySelector('.pull-text');
  if (text) text.textContent = '正在刷新…';
  try {
    await bootstrap();
    toast('已是最新内容');
  } catch (e) {
    toast('刷新失败，请检查网络');
  }
  pullEl.classList.remove('is-loading');
  setPull(0);
});

/* 回到顶部：往下翻超过一屏多一点才出现 */
const toTopEl = document.getElementById('toTop');
if (toTopEl) {
  view.addEventListener(
    'scroll',
    () => toTopEl.classList.toggle('is-on', view.scrollTop > 320),
    { passive: true }
  );
  toTopEl.addEventListener('click', () => {
    if (typeof view.scrollTo === 'function') view.scrollTo({ top: 0, behavior: 'smooth' });
    else view.scrollTop = 0;
  });
}

view.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  /* 用户相关 */
  if (act === 'reload') return location.reload();
  if (act === 'login') return doAuth(false);
  if (act === 'register') return doAuth(true);
  if (act === 'logout') return logout();
  if (act === 'edit-profile') return profileSheet();
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
  if (act === 'settings') return settingsSheet();
  if (act === 'share-copy') return doShareCopy();
  if (act === 'share-more') return doShareMore();
  if (act === 'share-qr') return shareQrSheet();

  if (act === 'open-member') return memberSheet();
  if (act === 'go-tab') {
    state.tab = el.dataset.tab || 'home';
    return render();
  }
  /* 购物车 */
  if (act === 'cart-add') {
    return handleCartAdd(el);
  }
  if (act === 'cart-qty') {
    const cur = cartList().find((x) => x.id === String(el.dataset.id));
    if (!cur) return;
    const next = cur.qty + (Number(el.dataset.d) || 0);
    if (next > 99) return toast('单件商品最多 99 件');
    cartSetQty(el.dataset.id, next);
    if (state.tab === 'cart') render();
    return;
  }
  if (act === 'cart-remove') {
    cartRemove(el.dataset.id);
    toast('已移出购物车');
    if (state.tab === 'cart') render();
    return;
  }
  if (act === 'cart-clear') {
    if (!window.confirm('确定清空购物车？')) return;
    cartClear();
    toast('购物车已清空');
    return render();
  }
  if (act === 'cart-checkout') {
    if (!state.viewer) {
      state.tab = 'mine';
      render();
      return toast('请先登录后再结算');
    }
    return cartConfirmSheet();
  }
  if (act === 'home-banner') {
    return goLink(homeCfg().banner.link);
  }
  if (act === 'home-entry') {
    const e = homeCfg().entries[Number(el.dataset.i)];
    if (!e) return;
    if (e.act === 'content') {
      state.tab = homeCfg().tabs.contentOn ? 'content' : 'home';
      return render();
    }
    if (e.act === 'member') return memberSheet();
    if (e.act === 'support') return supportSheet();
    if (e.act === 'link') return goLink(e.value);
    // goods：回到首页并定位到商品区
    state.tab = 'home';
    state.goodsFilter = 'all';
    state.goodsQuery = '';
    render();
    const box = view.querySelector('#goodsBox');
    if (box) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  if (act === 'open-content') {
    return contentSheet(el.dataset.id);
  }
  if (act === 'content-cat') {
    state.contentCat = el.dataset.c || 'all';
    return render();
  }
  if (act === 'content-clear') {
    state.contentQuery = '';
    return render();
  }
  if (act === 'fav') return toggleFav(el.dataset.id);
  if (act === 'open-favorites') return favoritesSheet();
  if (act === 'open-refunds') return refundsSheet();
  if (act === 'feedback-new') return feedbackSheet();
  if (act === 'feedback-mine') return myFeedbackSheet();
  if (act === 'locked-content') {
    if (!state.viewer) {
      state.tab = 'mine';
      render();
      return toast('登录后可单篇解锁或开通会员');
    }
    const cid = el.dataset.id;
    const c = (state.contents || []).find((x) => x.id === cid);
    // 兜底：本地认为自己是会员却点到锁，多半是会员刚生效而页面还是旧数据，
    // 先拉一次最新状态，是会员就直接打开正文，避免重复弹「开通会员」。
    if (viewerIsMember()) {
      toast('正在同步会员状态…');
      await refreshMe().catch(() => {});
      await refreshContents();
      const fresh = (state.contents || []).find((x) => x.id === cid);
      if (fresh && !fresh.locked) return contentSheet(cid);
      if (fresh && Number(fresh.price) > 0) return contentSheet(cid);
    }
    if (c && Number(c.price) > 0) return contentSheet(cid);
    toast('会员专享内容，开通会员后查看全文');
    return memberSheet();
  }
  if (act === 'unlock-content') {
    return startUnlockContent(el.dataset.id || (sheetState.content && sheetState.content.id));
  }
  if (act === 'toggle-autorenew') return toggleAutoRenew();
  if (act === 'open-balance') return balanceSheet();

  if (act === 'buy') {
    startBuy(el.dataset.id);
    return;
  }
  if (act === 'goods') {
    goodsSheet(el.dataset.id);
    return;
  }
  if (act === 'support') {
    supportSheet();
    return;
  }

  /* 首页商品：筛选 / 清空搜索 */
  if (act === 'goods-filter') {
    state.goodsFilter = el.dataset.f || 'all';
    view.querySelectorAll('.gchip').forEach((c) => c.classList.toggle('on', c.dataset.f === state.goodsFilter));
    refreshGoodsBox();
    return;
  }
  if (act === 'goods-clear') {
    state.goodsQuery = '';
    const input = document.getElementById('goodsSearch');
    if (input) {
      input.value = '';
      input.focus();
    }
    refreshGoodsBox();
    return;
  }
  if (act === 'goods-reset') {
    state.goodsQuery = '';
    state.goodsFilter = 'all';
    state.goodsSort = 'default';
    return render();
  }

  /* 商品心愿单 / 排序 / 搜索历史 */
  if (act === 'goods-fav') {
    return handleGoodsFav(el.dataset.id);
  }
  if (act === 'goods-sort') {
    const s = el.dataset.s || 'default';
    if (s === 'price') state.goodsSort = state.goodsSort === 'priceAsc' ? 'priceDesc' : 'priceAsc';
    else state.goodsSort = s;
    return render();
  }
  if (act === 'goods-search-q') {
    state.goodsQuery = el.dataset.q || '';
    return render();
  }
  if (act === 'goods-search-clear') {
    clearSearchHistory();
    toast('已清空搜索历史');
    return render();
  }

  /* 我的服务：消息 / 心愿单 / 足迹 */
  if (act === 'open-wishlist') return wishlistSheet();
  if (act === 'open-footprint') return footprintSheet();
  if (act === 'open-messages') return messagesSheet();
  if (act === 'reorder') return reorder(el.dataset.id);

  if (act === 'open-orders') return ordersSheet();

  if (act === 'quick-orders') {
    // 「我的」页订单状态快捷入口：直接带筛选打开订单列表
    mineOrderFilter = el.dataset.f || 'all';
    return ordersSheet();
  }

  if (act === 'order') {
    // 列表里点「支付中 / 待支付」的订单，直接跳到支付界面；其余看详情
    openOrderById(el.dataset.id);
  }
});

sheetEl.addEventListener('click', async (e) => {

  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'buy') {
    startBuy(el.dataset.id);
    return;
  }
  if (act === 'cart-add') {
    handleCartAdd(el);
    return;
  }
  if (act === 'go-tab') {
    state.tab = el.dataset.tab || 'home';
    closeSheet();
    render();
    return;
  }
  if (act === 'cart-checkout') {
    cartConfirmSheet();
    return;
  }
  if (act === 'share-goods') {
    await shareGoods(el.dataset.id);
    return;
  }
  // 付费内容弹层里的两个入口（弹层内点击走这里，不是页面监听器）
  if (act === 'unlock-content') {
    return startUnlockContent(el.dataset.id || (sheetState.content && sheetState.content.id));
  }
  if (act === 'open-member') return memberSheet();
  if (act === 'fav') return toggleFav(el.dataset.id);
  if (act === 'open-favorites') return favoritesSheet();
  if (act === 'open-refunds') return refundsSheet();
  if (act === 'open-wishlist') return wishlistSheet();
  if (act === 'open-footprint') return footprintSheet();
  if (act === 'open-messages') return messagesSheet();
  if (act === 'goods-fav') return handleGoodsFav(el.dataset.id);
  if (act === 'reorder') return reorder(el.dataset.id);
  if (act === 'footprint-clear') {
    clearFootprint();
    toast('浏览记录已清空');
    return footprintSheet();
  }
  if (act === 'order-search-clear') {
    state.orderQuery = '';
    const input = document.getElementById('orderSearch');
    if (input) {
      input.value = '';
      input.focus();
    }
    const box = document.getElementById('ordersBox');
    if (box) box.innerHTML = mineOrderList(dropExpiredOrders(state.orders));
    return;
  }
  if (act === 'feedback-new') return feedbackSheet();
  if (act === 'feedback-mine') return myFeedbackSheet();
  if (act === 'feedback-send') return sendFeedback();
  if (act === 'copy-order') {
    const ok = await copyText(el.dataset.id || '');
    toast(ok ? '订单号已复制' : '复制失败，请长按手动复制');
    return;
  }
  if (act === 'copy-shipno') {
    const ok = await copyText(el.dataset.id || '');
    toast(ok ? '运单号已复制' : '复制失败，请长按手动复制');
    return;
  }
  if (act === 'copy-text') {
    const ok = await copyText(el.dataset.id || '');
    toast(ok ? '已复制，去粘贴给客服吧' : '复制失败，请长按手动复制');
    return;
  }

  /* 设置中心 */
  if (act === 'toggle-dark') {
    applyDark(!isDark());
    return settingsSheet(); // 重绘开关状态
  }
  if (act === 'change-password') return passwordSheet();
  if (act === 'edit-address') return addressSheet();
  if (act === 'about') return aboutSheet();
  if (act === 'refresh') {
    closeSheet();
    toast('刷新中…');
    await refreshMe();
    return toast('已刷新');
  }
  if (act === 'clear-cache') {
    const dark = isDark();
    try {
      localStorage.clear();
    } catch (err) {
      /* ignore */
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if (dark) applyDark(true); // 清缓存后保住深色模式偏好
    toast('缓存已清除，正在刷新');
    setTimeout(() => location.reload(), 700);
    return;
  }
  if (act === 'logout') {
    closeSheet();
    return logout();
  }

  if (act === 'channel') {
    sheetState.channel = el.dataset.id;
    rememberChannel(el.dataset.id);
    if (sheetState.type === 'continue' && sheetState.order) continuePaySheet(sheetState.order);
    else if (sheetState.type === 'cart-confirm') cartConfirmSheet();
    else confirmSheet();
  }

  if (act === 'mine-filter') {
    mineOrderFilter = el.dataset.f || 'all';
    const box = window.document.querySelector('#ordersBox');
    if (box) box.innerHTML = mineOrderList(dropExpiredOrders(state.orders));
    return;
  }

  if (act === 'order') {
    openOrderById(el.dataset.id);
    return;
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

  if (act === 'cycle-sign') {
    try {
      toast('正在跳转支付宝签约…');
      const r = await api('/api/user/cycle/sign', { method: 'POST' });
      if (r.signUrl) window.location.href = r.signUrl;
    } catch (e) {
      toast(e.message);
    }
    return;
  }

  if (act === 'cycle-unsign') {
    if (!window.confirm('确定解除支付宝免密续费？解约后自动续费将改用余额扣款。')) return;
    try {
      const r = await api('/api/user/cycle/unsign', { method: 'POST' });
      if (r.viewer) state.viewer = r.viewer;
      toast('已解除支付宝免密续费');
      memberSheet();
      render();
    } catch (e) {
      toast(e.message);
    }
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

  if (act === 'save-profile') {
    const nickname = (($('#pfNick') || {}).value || '').trim();
    const bio = (($('#pfBio') || {}).value || '').trim();
    if (!nickname) return toast('昵称不能为空');
    try {
      const { viewer } = await api('/api/auth/profile', {
        method: 'POST',
        body: JSON.stringify({ nickname, bio }),
      });
      state.viewer = viewer;
      state.viewer.orders = state.orders;
      closeSheet();
      toast('资料已更新');
      render();
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  if (act === 'open-phone') return phoneSheet();

  if (act === 'save-phone') {
    const phone = (($('#phNew') || {}).value || '').replace(/\D/g, '');
    const password = (($('#phPwd') || {}).value || '').trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) return toast('请输入正确的 11 位手机号');
    if (!password) return toast('请输入登录密码');
    try {
      const { viewer } = await api('/api/auth/phone', {
        method: 'POST',
        body: JSON.stringify({ phone, password }),
      });
      state.viewer = viewer;
      state.viewer.orders = state.orders;
      closeSheet();
      toast('手机号已换绑，下次用新号登录');
      render();
    } catch (err) {
      toast(err.message);
    }
    return;
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

  if (act === 'order-detail') {
    await openOrderById(el.dataset.id || (sheetState.order && sheetState.order.id));
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
      // 订单已超时被服务端删除：本地同步移除，回到列表
      if (err.code === 'order_expired' || err.status === 404) {
        state.orders = state.orders.filter((o) => o.id !== id);
        if (state.viewer) state.viewer.orders = state.orders;
        closeSheet();
        render();
      }
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
      } else if (order && order.status === 'closed') {
        upsertOrder(order);
        closeSheet();
        toast('这笔订单已超时失效（未扣款），请重新下单');
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
    const order = findOrder(el.dataset.id) || sheetState.order;
    if (!order || !order.id) return toast('订单不存在或已关闭，请刷新后重试');
    return refundSheet(order);
  }

  if (act === 'refund-reason') {
    sheetState.reason = el.dataset.r || '';
    sheetEl.querySelectorAll('[data-act="refund-reason"]').forEach((x) => x.classList.toggle('on', x === el));
    return;
  }

  if (act === 'submit-refund') {
    const order = sheetState.order;
    if (!order) return toast('订单不存在');
    if (!sheetState.reason) return toast('请先选一个退款原因');
    const detail = (($('#refundDetail') || {}).value || '').trim();
    el.disabled = true;
    try {
      const res = await api(`/api/orders/${order.id}/refund-request`, {
        method: 'POST',
        body: JSON.stringify({ reason: sheetState.reason, detail }),
      });
      await refreshRefundState();
      closeSheet();
      toast((res && res.message) || '退款申请已提交，等待商家审核');
      render();
    } catch (err) {
      el.disabled = false;
      toast(err.message);
    }
    return;
  }

  if (act === 'cancel-refund') {
    if (!confirm('确定撤销这条退款申请？撤销后可以重新提交。')) return;
    try {
      await api(`/api/refunds/${el.dataset.id}/cancel`, { method: 'POST' });
      await refreshRefundState();
      closeSheet();
      toast('已撤销申请');
      render();
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  /* ---------------- 确认收货 + 评价 ---------------- */

  if (act === 'receive-order') {
    if (!confirm('确认已收到货？确认后就可以评价商品了。')) return;
    const id = el.dataset.id;
    el.disabled = true;
    el.textContent = '正在确认…';
    try {
      const res = await api(`/api/orders/${id}/receive`, { method: 'POST' });
      if (res.order) upsertOrder(res.order);
      toast('已确认收货');
      const order = findOrder(id) || res.order;
      sheetState._revRefreshed = null; // 收货后强制补拉一次评价状态
      if (order) orderSheet(order);
      render();
    } catch (err) {
      el.disabled = false;
      el.textContent = '确认收货';
      toast(err.message);
    }
    return;
  }

  if (act === 'review') {
    const order = findOrder(el.dataset.order) || findOrder(el.dataset.id) || sheetState.order;
    if (!order || !order.id) return toast('订单不存在，请刷新后重试');
    if (!order.receivedAt) return toast('请先确认收货，再评价');
    const productId = el.dataset.id;
    const prod = orderProductsOf(order).find((p) => p.productId === String(productId));
    return reviewSheet(order, productId, prod ? prod.title : order.title);
  }

  if (act === 'set-star') {
    sheetState.reviewStars = Math.max(1, Math.min(5, Number(el.dataset.s) || 5));
    paintStars();
    return;
  }

  if (act === 'submit-review') {
    const order = sheetState.order;
    if (!order || !order.id) return toast('订单不存在');
    const content = (($('#reviewContent') || {}).value || '').trim();
    el.disabled = true;
    try {
      const res = await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({
          orderId: order.id,
          productId: sheetState.productId,
          rating: sheetState.reviewStars || 5,
          content,
        }),
      });
      await refreshMyReviews();
      toast((res && res.message) || '评价提交成功');
      const fresh = findOrder(order.id) || order;
      orderSheet(fresh);
      render();
    } catch (err) {
      el.disabled = false;
      toast(err.message);
    }
    return;
  }

  if (act === 'open-refunds') return refundsSheet();
});

/* ---------------- 启动 ---------------- */

async function bootstrap() {
  const data = await api('/api/bootstrap');
  state.user = data.user;
  state.balance = data.balance;
  state.products = data.products;
  state.contents = Array.isArray(data.contents) ? data.contents : [];
  state.favorites = Array.isArray(data.favorites) ? data.favorites : [];
  state.refunds = Array.isArray(data.refunds) ? data.refunds : [];
  state.orders = data.orders;
  await loadViewer();
  if (state.viewer) state.viewer.orders = state.orders;
  // 我的评价（「待评价」计数要用）：不阻塞首屏，回来补一次渲染
  if (state.viewer) {
    refreshMyReviews().then(() => {
      if (state.tab === 'mine') render();
    });
  }
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
  const cycleBack = q.get('cycle') === 'signed';

  // 恢复用户上次选择的深色模式（不依赖登录态，纯本地记忆）
  try {
    applyDark(localStorage.getItem(DARK_KEY) === '1');
  } catch (e) {
    /* ignore */
  }

  try {
    await bootstrap();
    startCountdownTick(); // 待支付订单倒计时（到点自动从列表移除）
  } catch (e) {
    // 首屏加载失败：给普通用户看得懂的提示 + 一键重试（不暴露服务端细节）
    view.innerHTML = `
      <div class="card" style="margin-top:40px">
        <div class="empty">
          <div class="empty-icon">${ICON.box}</div>
          <h3>网络开小差了</h3>
          <p>内容没能加载出来，请检查网络后重试</p>
          <button class="btn-primary" data-act="reload" style="margin-top:16px">重新加载</button>
        </div>
      </div>`;
    return;
  }

  if (cycleBack) {
    history.replaceState(null, '', '/' + (SHARECODE ? '?sharecode=' + encodeURIComponent(SHARECODE) : ''));
    if (state.viewer) {
      if (state.viewer.cycleStatus === 'NORMAL') toast('支付宝免密续费签约成功 ✅');
      else {
        toast('签约结果确认中，稍后自动刷新');
        setTimeout(async () => {
          await refreshMe();
          if (state.viewer && state.viewer.cycleStatus === 'NORMAL') toast('支付宝免密续费签约成功 ✅');
          else toast('暂未查到签约，可稍后在会员中心再试');
        }, 3000);
      }
    }
  }

  // 商品分享链接：?p=商品id 直接打开详情
  const sharedGoods = q.get('p');
  if (sharedGoods) {
    const p = (state.products || []).find((x) => x.id === sharedGoods);
    if (p) setTimeout(() => goodsSheet(p.id), 260);
    else toast('分享的商品已下架');
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
