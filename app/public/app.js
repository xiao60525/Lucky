'use strict';
/* ------------------------------------------------------------------
   手机应用骨架 · 前端
   纯原生 JS，无构建、无依赖。
------------------------------------------------------------------ */

const $ = (s) => document.querySelector(s);
const view = $('#view');
const sheetEl = $('#sheet');
const maskEl = $('#mask');
const toastEl = $('#toast');

const state = {
  user: null,
  balance: 0,
  provider: 'mock',
  payScene: 'native',
  wechatReady: false,
  wxMchId: '',
  site: { name: 'App', tagline: '', iconUrl: null, hasIcon: false },
  products: [],
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

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `请求失败(${res.status})`);
  return data;
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

function renderHome() {
  const paidCount = state.orders.filter((o) => o.status === 'paid').length;
  const s = state.site || {};
  const title = s.tagline ? esc(s.tagline) : '先把支付跑通<br/>内容慢慢加';

  return `
    <div class="hero">
      <div class="hero-brand">
        ${logoHTML('hero-logo')}
        <span class="hero-appname">${esc(s.name || 'App')}</span>
      </div>
      <div class="hero-greet">${greeting()}，${state.user ? esc(state.user.nickname) : '游客'}</div>
      <div class="hero-title">${title}</div>
      <div class="hero-meta">
        <span class="hero-chip">渠道：模拟收银台</span>
        <span class="hero-chip">已支付 ${paidCount} 笔</span>
      </div>
    </div>

    <div class="section-head"><h2>支付体验</h2><span>示例商品</span></div>
    <div class="card">
      ${state.products
        .map(
          (p, i) => `
        <button class="goods-row" data-act="buy" data-id="${p.id}">
          <span class="goods-thumb">${['🧩', '💎', '🪙'][i % 3]}</span>
          <span class="goods-main">
            <span class="goods-title">${p.title}<span class="tag">${p.tag}</span></span>
            <span class="goods-desc">${p.desc}</span>
          </span>
          <span class="goods-price">${yuan(p.amount)}</span>
          <span class="goods-buy">购买</span>
        </button>`
        )
        .join('')}
    </div>

    <div class="section-head"><h2>内容</h2><span>待填充</span></div>
    <div class="card">
      <div class="empty" style="padding:22px 8px 14px">
        <div class="empty-icon">${ICON.box}</div>
        <h3>内容区暂时是空的</h3>
        <p>这里以后放你的文章、视频、商品或游戏入口<br/>有想法了直接往里面加</p>
      </div>
      <div class="skeleton-lines">
        <div class="sk w80"></div>
        <div class="sk w60"></div>
        <div class="sk w40" style="margin-bottom:2px"></div>
      </div>
    </div>
  `;
}

/* ---------------- 渲染：内容 ---------------- */

function renderContent() {
  return `
    <div class="section-head" style="margin-top:14px"><h2>内容</h2><span>0 条</span></div>
    <div class="card">
      <div class="empty">
        <div class="empty-icon">${ICON.box}</div>
        <h3>还没有内容</h3>
        <p>这个页面先空着<br/>等你想好放什么，接上数据就能显示</p>
      </div>
    </div>
    <div class="card">
      <div class="skeleton-lines">
        <div class="sk w80"></div>
        <div class="sk w60"></div>
        <div class="sk w80"></div>
        <div class="sk w40" style="margin-bottom:2px"></div>
      </div>
    </div>
  `;
}

/* ---------------- 渲染：我的 ---------------- */

function renderMine() {
  const orders = state.orders;
  return `
    <div class="card" style="margin-top:10px">
      <div class="profile">
        <div class="avatar">${state.user ? state.user.nickname.slice(0, 1) : '游'}</div>
        <div>
          <div class="profile-name">${state.user ? state.user.nickname : '游客'}</div>
          <div class="profile-sub">ID: ${state.user ? state.user.id : '-'}</div>
        </div>
      </div>
      <div class="balance">
        <div>
          <div class="balance-label">账户余额</div>
          <div class="balance-value">${yuan(state.balance)}</div>
        </div>
        <button class="goods-buy" data-act="recharge">充值</button>
      </div>
    </div>

    <div class="section-head"><h2>我的订单</h2><span>${orders.length} 条</span></div>
    <div class="card">
      ${
        orders.length
          ? orders
              .map(
                (o) => `
          <button class="order-row" data-act="order" data-id="${o.id}">
            <span class="order-main">
              <span class="order-title">${o.title}</span>
              <span class="order-meta">${o.id} · ${timeText(o.createdAt)}</span>
            </span>
            <span class="order-right">
              <span class="order-amount">${yuan(o.amount)}</span>
              <span class="status ${o.status}">${STATUS_TEXT[o.status]}</span>
            </span>
          </button>`
              )
              .join('')
          : `<div class="empty" style="padding:26px 8px">
               <h3>还没有订单</h3>
               <p>去首页买一个示例商品试试支付</p>
             </div>`
      }
    </div>
    <p style="text-align:center;font-size:11.5px;color:#a3a9b8;margin:18px 0 0">${
      state.provider === 'wechat' && state.wechatReady
        ? '当前支付渠道：微信支付' + (state.wxMchId ? '（商户号 ' + state.wxMchId + '）' : '')
        : '当前支付渠道：模拟收银台（沙箱环境，不会真实扣款）'
    }</p>
  `;
}

/* ---------------- 渲染入口 ---------------- */

const TITLES = { home: '首页', content: '内容', mine: '我的' };

function render() {
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
  if (state.provider === 'wechat' && state.wechatReady) {
    list.push({
      id: 'wechat',
      name: '微信支付',
      cls: 'wechat',
      icon: ICON.wechat,
      extra: SCENE_TEXT[state.payScene] || '推荐',
    });
  } else {
    list.push({ id: 'mock', name: '模拟收银台', cls: 'wechat', icon: ICON.wechat, extra: '沙箱环境' });
  }
  list.push({ id: 'balance', name: '余额支付', cls: 'balance', icon: ICON.balance, extra: yuan(state.balance) });
  return list;
}

function confirmSheet() {
  const p = sheetState.product;
  const ch = sheetState.channel;
  const balanceEnough = state.balance >= p.amount;
  const channels = channelList();

  const html = `
    <h3>确认订单</h3>
    <p class="sheet-sub">${p.title} · ${p.desc}</p>
    <div class="amount-box">
      <div class="amount-label">支付金额</div>
      <div class="amount-big"><small>¥</small>${(p.amount / 100).toFixed(2)}</div>
    </div>
    <div class="pay-list">
      ${channels
        .map(
          (c) => `
        <button class="pay-item ${ch === c.id ? 'selected' : ''}" data-act="channel" data-id="${c.id}">
          <span class="pay-icon ${c.cls}">${c.icon}</span>
          <span class="pay-name">${c.name}</span>
          <span class="pay-extra">${c.id === 'balance' && !balanceEnough ? '余额不足' : c.extra}</span>
          <span class="radio"></span>
        </button>`
        )
        .join('')}
    </div>
    <button class="btn-primary" id="payBtn" data-act="pay" ${ch === 'balance' && !balanceEnough ? 'disabled' : ''}>
      ${ch === 'balance' && !balanceEnough ? '余额不足' : '确认支付 ' + yuan(p.amount)}
    </button>
    <p class="cashier-note">${
      state.provider === 'wechat' && state.wechatReady ? '微信支付 · 真实扣款' : '沙箱环境，不会产生真实扣款'
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
function qrSheet(order, qrUrl) {
  sheetState.type = 'qr';
  openSheet(`
    <h3>微信扫码支付</h3>
    <p class="sheet-sub">${order.title} · ${yuan(order.amount)}</p>
    <div style="text-align:center;padding:6px 0 2px">
      <img src="${qrUrl}" alt="支付二维码" style="width:236px;height:236px;border-radius:14px;border:1px solid var(--line)" />
      <p style="font-size:12.5px;color:var(--muted);margin:12px 0 0">打开微信「扫一扫」完成支付，支付后会自动跳转</p>
    </div>
    <button class="btn-primary" data-act="check-order" data-id="${order.id}">我已完成支付</button>
    <button class="btn-ghost" data-act="close">稍后支付</button>
  `);
  // 后台轮询，付完自动关闭弹层
  pollOrder(order.id, 120, 1500).then((o) => {
    if (o && o.status === 'paid' && sheetState.type === 'qr') {
      const idx = state.orders.findIndex((x) => x.id === o.id);
      if (idx > -1) state.orders[idx] = o;
      else state.orders.unshift(o);
      showSuccess(o);
      render();
    }
  });
}

/** 把服务端返回的支付模式落到界面：余额 / 跳转 / 微信内调起 / 扫码 */
async function applyPayResult(res) {
  if (res.mode === 'balance') {
    state.balance = res.balance;
    state.orders.unshift(res.order);
    showSuccess(res.order);
    render();
    return;
  }

  if (res.mode === 'redirect' || res.mode === 'h5') {
    location.href = withShare(res.payUrl); // 跳收银台 / 微信 H5 收银台，回来后轮询状态
    return;
  }

  if (res.mode === 'jsapi') {
    closeSheet();
    try {
      await invokeWechatPay(res.payParams);
      const o = await pollOrder(res.order.id, 40, 800);
      const paid = o || (await api(`/api/orders/${res.order.id}`)).order;
      state.orders.unshift(paid);
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
    state.orders.unshift(res.order);
    qrSheet(res.order, res.qrUrl);
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
      body: JSON.stringify({ productId: sheetState.product.id }),
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

  const actions =
    order.status === 'created'
      ? `<button class="btn-primary" data-act="pay-order" data-id="${order.id}">去支付 ${yuan(order.amount)}</button>`
      : order.status === 'paid'
      ? `<button class="btn-ghost" data-act="refund" data-id="${order.id}" style="color:#f05252">申请退款</button>`
      : `<button class="btn-primary" data-act="close">知道了</button>`;

  openSheet(`
    <h3>订单详情</h3>
    <p class="sheet-sub">${STATUS_TEXT[order.status]}</p>
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

/* ---------------- 事件 ---------------- */

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    render();
  });
});

maskEl.addEventListener('click', closeSheet);

view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;

  if (act === 'buy') {
    const p = state.products.find((x) => x.id === el.dataset.id);
    if (!p) return;
    sheetState.type = 'confirm';
    sheetState.product = p;
    sheetState.channel = channelList()[0].id;
    confirmSheet();
  }

  if (act === 'order') {
    const o = state.orders.find((x) => x.id === el.dataset.id);
    if (o) orderSheet(o);
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
    confirmSheet();
  }

  if (act === 'pay') {
    doPay();
  }

  if (act === 'close') {
    closeSheet();
  }

  if (act === 'order') {
    const o = state.orders.find((x) => x.id === el.dataset.id);
    closeSheet();
    if (o) setTimeout(() => orderSheet(o), 260);
  }

  if (act === 'pay-order') {
    // 待支付订单重新发起支付
    try {
      const res = await api(`/api/orders/${el.dataset.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ channel: channelList()[0].id }),
      });
      await applyPayResult(res);
    } catch (err) {
      toast(err.message);
    }
  }

  if (act === 'check-order') {
    // 扫码支付后手动确认：查一次订单状态
    try {
      const { order } = await api(`/api/orders/${el.dataset.id}`);
      if (order.status === 'paid') {
        const idx = state.orders.findIndex((o) => o.id === order.id);
        if (idx > -1) state.orders[idx] = order;
        else state.orders.unshift(order);
        showSuccess(order);
        render();
      } else {
        toast('还没有收到支付结果，请稍等一下');
      }
    } catch (err) {
      toast(err.message);
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
  state.orders = data.orders;
  state.provider = data.provider;
  state.payScene = data.payScene || 'native';
  state.wechatReady = !!data.wechatReady;
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
