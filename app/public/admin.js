'use strict';
/* 管理后台前端：登录 -> 概览 / 商品 / 订单 / 配置 */

const $ = (s) => document.querySelector(s);
const yuan = (fen) => (fen / 100).toFixed(2);
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '-');
const STATUS_TEXT = { created: '待支付', pending: '支付中', paid: '已支付', refunded: '已退款', closed: '已关闭' };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { token: sessionStorage.getItem('admin_token') || '', tab: 'overview', data: null };
/** 外观草稿：待上传的新图标（dataURL）/ 96px 小图 / 是否点了「恢复默认」 */
const siteDraft = { icon: null, thumb: null, clearIcon: false };
/** 小程序同步结果提示（保存后显示，重新渲染也保留） */
let siteSyncText = '';

/** 预览域名需要 sharecode 才能访问接口，从当前地址栏取出并透传到每个请求 */
const SHARECODE = new URLSearchParams(location.search).get('sharecode');
function apiPath(path) {
  if (!SHARECODE) return path;
  return path + (path.includes('?') ? '&' : '?') + 'sharecode=' + encodeURIComponent(SHARECODE);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch(apiPath(path), {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { 'x-admin-token': state.token } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) {
    state.token = '';
    sessionStorage.removeItem('admin_token');
    render();
    throw new Error('登录已过期，请重新登录');
  }
  if (!res.ok) throw new Error(data.message || `请求失败(${res.status})`);
  return data;
}

/* ---------------- 登录 ---------------- */

function renderLogin() {
  $('#app').innerHTML = `
    <div class="login-card">
      <h2>管理后台</h2>
      <p>手机App支付骨架 · 请输入管理密码</p>
      <input type="password" id="pwd" placeholder="管理密码" autocomplete="current-password" />
      <button id="loginBtn">登录</button>
    </div>`;
  const doLogin = async () => {
    const btn = $('#loginBtn');
    const pwd = $('#pwd').value.trim();
    if (!pwd) return;
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const r = await fetch(apiPath('/api/admin/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || '登录失败');
      state.token = data.token;
      sessionStorage.setItem('admin_token', data.token);
      await load();
    } catch (e) {
      toast(e.message);
      if (btn) { btn.disabled = false; btn.textContent = '登录'; }
    }
  };
  $('#loginBtn').onclick = doLogin;
  // 注意：处理函数不能返回值。箭头函数省略花括号会隐式返回 false，
  // 而 DOM 事件处理器返回 false 等同于 preventDefault()，会把除回车外的所有按键吞掉。
  $('#pwd').onkeydown = (e) => {
    if (e.key === 'Enter') doLogin();
  };
  // 桌面端自动聚焦；移动端不自动弹键盘（会遮挡页面、且部分浏览器不给焦点）
  if (!/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    try { $('#pwd').focus(); } catch (_) {}
  }
}

/* ---------------- 数据加载 ---------------- */

async function load() {
  try {
    state.data = await api('/api/admin/overview');
    if (state.data.site && state.data.site.name) {
      document.title = state.data.site.name + ' · 管理后台';
    }
    render();
  } catch (e) {
    if (state.token) toast(e.message);
  }
}

/* ---------------- 渲染 ---------------- */

function render() {
  if (!state.token) return renderLogin();
  const d = state.data;
  if (!d) {
    $('#app').innerHTML = '<p class="muted" style="text-align:center;margin-top:80px">加载中…</p>';
    return;
  }
  const tabs = { overview: '概览', products: '商品管理', orders: '订单管理', users: '用户', site: '外观', pay: '支付配置' };
  $('#app').innerHTML = `
    <header class="bar">
      <h1>管理后台</h1>
      <div class="who">
        <span>商户号 ${d.pay.mchid || '未配置'}</span>
        <button id="logoutBtn">退出</button>
      </div>
    </header>
    <div class="tabs">${Object.entries(tabs).map(([k, v]) => `<button data-tab="${k}" class="${state.tab === k ? 'on' : ''}">${v}</button>`).join('')}</div>
    <div id="panel"></div>`;
  document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; render(); }));
  $('#logoutBtn').onclick = () => { state.token = ''; sessionStorage.removeItem('admin_token'); render(); };
  ({ overview: renderOverview, products: renderProducts, orders: renderOrders, users: renderUsers, site: renderSite, pay: renderPay })[state.tab]();
}

function renderOverview() {
  const s = state.data.stats;
  $('#panel').innerHTML = `
    <div class="card">
      <h3>经营概览</h3>
      <div class="stats">
        <div class="stat"><div class="k">净收入</div><div class="v"><small>¥</small>${yuan(s.net)}</div></div>
        <div class="stat"><div class="k">累计收款</div><div class="v"><small>¥</small>${yuan(s.gross)}</div></div>
        <div class="stat"><div class="k">累计退款</div><div class="v"><small>¥</small>${yuan(s.refundSum)}</div></div>
        <div class="stat"><div class="k">账户余额</div><div class="v"><small>¥</small>${yuan(s.balance)}</div></div>
        <div class="stat"><div class="k">订单总数</div><div class="v">${s.orders}</div></div>
        <div class="stat"><div class="k">已支付订单</div><div class="v">${s.paidOrders}</div></div>
        <div class="stat"><div class="k">待支付订单</div><div class="v">${s.pendingOrders}</div></div>
      </div>
    </div>
    <div class="card">
      <h3>最近订单</h3>
      ${orderTable(state.data.orders.slice(0, 8))}
    </div>`;
}

function orderTable(orders) {
  if (!orders.length) return '<p class="muted">还没有订单</p>';
  return `<table><thead><tr><th>订单号</th><th>商品</th><th>金额</th><th>渠道</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
    <tbody>${orders
      .map(
        (o) => `<tr>
      <td style="font-family:monospace;font-size:12px">${o.id}</td>
      <td>${o.title}</td>
      <td>¥${o.amountText}</td>
      <td class="muted">${o.channelName || '-'}</td>
      <td><span class="tag ${o.status}">${STATUS_TEXT[o.status] || o.status}</span></td>
      <td class="muted" style="white-space:nowrap">${fmtTime(o.paidAt || o.createdAt)}</td>
      <td style="white-space:nowrap">
        ${o.status === 'paid' ? `<button class="op danger" data-refund="${o.id}">退款</button>` : ''}
        ${(o.status === 'created' || o.status === 'pending') ? `<button class="op" data-close="${o.id}">关闭</button>` : ''}
      </td>
    </tr>`
      )
      .join('')}</tbody></table>`;
}

function renderProducts() {
  const ps = state.data.products;
  $('#panel').innerHTML = `
    <div class="card">
      <h3 id="formTitle">新增商品</h3>
      <div class="form-grid">
        <div><label>商品 ID（留空自动生成）</label><input id="f-id" placeholder="如 coin_120" /></div>
        <div><label>名称 *</label><input id="f-title" placeholder="如 120 金币" /></div>
        <div><label>价格（元）*</label><input id="f-amount" type="number" min="0.01" step="0.01" placeholder="1.20" /></div>
        <div><label>角标（如：热卖）</label><input id="f-tag" maxlength="10" /></div>
        <div><label>排序（小在前）</label><input id="f-sort" type="number" value="99" /></div>
        <div><label>状态</label><select id="f-active"><option value="1">上架</option><option value="0">下架</option></select></div>
        <div class="full"><label>描述</label><input id="f-desc" /></div>
      </div>
      <div class="row-actions">
        <button class="btn" id="saveBtn">保存</button>
        <button class="btn ghost" id="resetBtn">清空表单</button>
      </div>
    </div>
    <div class="card">
      <h3>全部商品（${ps.length}）</h3>
      ${ps.length
        ? `<table><thead><tr><th>ID</th><th>名称</th><th>价格</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>${ps
            .map(
              (p) => `<tr>
            <td style="font-family:monospace;font-size:12px">${p.id}</td>
            <td>${p.title}${p.tag ? ` <span class="muted">·${p.tag}</span>` : ''}</td>
            <td>¥${yuan(p.amount)}</td>
            <td class="muted">${p.sort}</td>
            <td>${p.active ? '<span class="tag paid">上架</span>' : '<span class="tag off">下架</span>'}</td>
            <td style="white-space:nowrap">
              <button class="op" data-edit='${JSON.stringify(p).replace(/'/g, '&#39;')}'>编辑</button>
              <button class="op danger" data-del="${p.id}">删除</button>
            </td>
          </tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="muted">还没有商品，先在上面新增一个</p>'}
    </div>`;

  $('#saveBtn').onclick = saveProduct;
  $('#resetBtn').onclick = () => fillForm(null);
  document.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => fillForm(JSON.parse(b.dataset.edit))));
  document.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => delProduct(b.dataset.del)));
}

function fillForm(p) {
  $('#formTitle').textContent = p ? '编辑商品：' + p.title : '新增商品';
  $('#f-id').value = p ? p.id : '';
  $('#f-title').value = p ? p.title : '';
  $('#f-amount').value = p ? (p.amount / 100).toFixed(2) : '';
  $('#f-tag').value = p ? p.tag || '' : '';
  $('#f-sort').value = p ? p.sort : 99;
  $('#f-active').value = p && p.active === false ? '0' : '1';
  $('#f-desc').value = p ? p.desc || '' : '';
}

async function saveProduct() {
  const btn = $('#saveBtn');
  const amountYuan = parseFloat($('#f-amount').value);
  if (!Number.isFinite(amountYuan) || amountYuan <= 0) return toast('请填写正确的价格');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    await api('/api/admin/product/save', {
      method: 'POST',
      body: JSON.stringify({
        id: $('#f-id').value.trim(),
        title: $('#f-title').value.trim(),
        desc: $('#f-desc').value.trim(),
        amount: Math.round(amountYuan * 100),
        tag: $('#f-tag').value.trim(),
        sort: parseInt($('#f-sort').value, 10) || 99,
        active: $('#f-active').value === '1',
      }),
    });
    toast('已保存');
    await load();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

async function delProduct(id) {
  if (!confirm(`确定删除商品「${id}」？已产生的订单不受影响。`)) return;
  try {
    await api('/api/admin/product/delete', { method: 'POST', body: JSON.stringify({ id }) });
    toast('已删除');
    await load();
  } catch (e) {
    toast(e.message);
  }
}

function renderOrders() {
  $('#panel').innerHTML = `<div class="card"><h3>全部订单（${state.data.orders.length}）</h3>${orderTable(state.data.orders)}</div>`;
  bindOrderOps();
}

function bindOrderOps() {
  document.querySelectorAll('[data-refund]').forEach((b) => (b.onclick = () => refundOrder(b.dataset.refund)));
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeOrder(b.dataset.close)));
}

async function refundOrder(id) {
  if (!confirm(`确定退款订单 ${id}？`)) return;
  try {
    await api('/api/admin/order/refund', { method: 'POST', body: JSON.stringify({ orderId: id }) });
    toast('已退款');
    await load();
  } catch (e) {
    toast(e.message);
  }
}

async function closeOrder(id) {
  if (!confirm(`确定关闭订单 ${id}？`)) return;
  try {
    await api('/api/admin/order/close', { method: 'POST', body: JSON.stringify({ orderId: id }) });
    toast('已关闭');
    await load();
  } catch (e) {
    toast(e.message);
  }
}

/* ---------------- 用户（小程序手机号用户，跨云环境只读） ---------------- */

function renderUsers() {
  $('#panel').innerHTML = `
    <div class="card">
      <h3>用户</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">小程序端手机号登录的用户，数据来自小程序云库，后台只读。</p>
      <div id="userTable"><p class="muted">加载中…</p></div>
    </div>`;

  api('/api/admin/users')
    .then((r) => {
      const box = $('#userTable');
      if (!box) return;
      const list = r.users || [];
      if (list.length === 0) {
        box.innerHTML = '<p class="muted">还没有用户登录。小程序端用手机号登录后，会自动出现在这里。</p>';
        return;
      }
      const paidSum = list.reduce((s, u) => s + (u.paidAmount || 0), 0);
      box.innerHTML = `
        <p class="muted" style="font-size:12.5px;margin:0 0 10px">共 ${list.length} 位用户，累计支付 ¥${yuan(paidSum)}</p>
        <table>
          <thead><tr><th>手机号</th><th>注册时间</th><th>最近登录</th><th>订单数</th><th>累计支付</th></tr></thead>
          <tbody>${list
            .map(
              (u) => `<tr>
              <td style="font-family:monospace;font-size:13px">${u.phone || '<span class="muted">未绑定</span>'}</td>
              <td class="muted" style="white-space:nowrap">${fmtTime(u.createdAt)}</td>
              <td class="muted" style="white-space:nowrap">${fmtTime(u.lastLoginAt)}</td>
              <td>${u.orderCount}</td>
              <td>¥${yuan(u.paidAmount || 0)}</td>
            </tr>`
            )
            .join('')}</tbody>
        </table>`;
    })
    .catch((e) => {
      const box = $('#userTable');
      if (!box) return;
      const notReady = /未配置/.test(e.message);
      box.innerHTML = notReady
        ? `<p class="muted">未接入小程序云库。在 <code>app/.env</code> 填好 MP_CLOUD_ENDPOINT / MP_CLOUD_PUBLISHABLE_KEY / MP_CLOUD_SECRET 后重启即可。</p>`
        : `<p style="color:var(--bad);font-size:13px">读取失败：${e.message}</p>`;
    });
}

/* ---------------- 外观（程序名称 / 图标） ---------------- */

function currentIconSrc() {
  if (siteDraft.icon) return siteDraft.icon;
  if (siteDraft.clearIcon) return '';
  const s = state.data.site;
  return s && s.hasIcon ? apiPath(s.iconUrl) : '';
}

/** 图标节点：有图用图，没图用「名称首字 + 渐变底」占位 */
function iconNode(src, name, cls) {
  if (src) return `<span class="${cls}"><img src="${esc(src)}" alt="应用图标" /></span>`;
  return `<span class="${cls} is-default"><span>${esc((name || 'A').trim().slice(0, 1) || 'A')}</span></span>`;
}

/** 小程序同步状态文案：保存结果显示优先，其次是是否已接入 */
function mpStatusHTML() {
  if (siteSyncText) return siteSyncText;
  const ready = state.data && state.data.mp && state.data.mp.ready;
  return ready
    ? '小程序同步：✅ 已接入。保存后小程序的名称与图标会一起更新，重新进入小程序即生效。'
    : '小程序同步：⚠️ 未配置小程序云库（app/.env 的 MP_CLOUD_*），现在只对网页版生效。';
}

function renderSite() {
  const s = state.data.site || { name: '', tagline: '', hasIcon: false };
  $('#panel').innerHTML = `
    <div class="card">
      <h3>程序名称与图标</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 14px">
        保存后，手机端页面标题、首页顶部、浏览器标签页图标会一起更新；已打开的页面刷新一次即可看到。
      </p>

      <div class="brand-row">
        <div id="brandPreview">${iconNode(currentIconSrc(), s.name, 'brand-preview')}</div>
        <div class="brand-pick">
          <div class="brand-btns">
            <label class="btn ghost" for="iconFile" style="display:inline-block">上传新图标</label>
            <button class="op" id="clearIconBtn">恢复默认</button>
          </div>
          <input type="file" id="iconFile" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" />
          <p class="muted" style="font-size:11.5px;margin:8px 0 0;line-height:1.6">
            建议 512×512 的方形图（PNG / JPG / WEBP，≤ 8MB）。<br/>上传后会在这里自动压到 512px、512KB 以内再存。
          </p>
        </div>
      </div>

      <div class="form-grid" style="margin-top:16px">
        <div><label>程序名称 *（最多 24 字）</label><input id="s-name" maxlength="24" value="${esc(s.name || '')}" placeholder="如 我的小工具" /></div>
        <div><label>副标题（可选，最多 40 字）</label><input id="s-tagline" maxlength="40" value="${esc(s.tagline || '')}" placeholder="如 一个能付款的小应用" /></div>
      </div>

      <div class="row-actions">
        <button class="btn" id="saveSiteBtn">保存并生效</button>
        <button class="btn ghost" id="reloadSiteBtn">撤销修改</button>
      </div>
      <p class="muted" id="mpStatus" style="font-size:12px;margin:10px 0 0;line-height:1.6">${mpStatusHTML()}</p>
    </div>

    <div class="card">
      <h3>手机端效果预览</h3>
      <div class="mock-app">
        <div class="mock-top">
          <span id="mockLogo">${iconNode(currentIconSrc(), s.name, 'mock-logo')}</span>
          <span class="mock-name" id="mockName">${esc(s.name || '程序名称')}</span>
        </div>
        <div class="mock-body">
          <div class="mock-greet">晚上好，游客</div>
          <div class="mock-hero" id="mockHero">${esc(s.tagline || '先把支付跑通，内容慢慢加')}</div>
          <div class="mock-line w70"></div>
          <div class="mock-line w45"></div>
        </div>
      </div>
    </div>`;

  const syncPreview = () => {
    const name = ($('#s-name').value || '').trim() || '程序名称';
    const tag = ($('#s-tagline').value || '').trim();
    const src = currentIconSrc();
    $('#brandPreview').innerHTML = iconNode(src, name, 'brand-preview');
    $('#mockLogo').innerHTML = iconNode(src, name, 'mock-logo');
    $('#mockName').textContent = name;
    $('#mockHero').textContent = tag || '先把支付跑通，内容慢慢加';
  };

  $('#s-name').oninput = syncPreview;
  $('#s-tagline').oninput = syncPreview;
  $('#iconFile').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重复选同一个文件
    if (f) pickIcon(f).then(syncPreview).catch((err) => toast(err.message || '图片处理失败'));
  };
  $('#clearIconBtn').onclick = () => {
    siteDraft.icon = null;
    siteDraft.thumb = null;
    siteDraft.clearIcon = true;
    syncPreview();
    toast('已选择恢复默认图标，记得点保存');
  };
  $('#saveSiteBtn').onclick = saveSite;
  $('#reloadSiteBtn').onclick = () => {
    siteDraft.icon = null;
    siteDraft.thumb = null;
    siteDraft.clearIcon = false;
    siteSyncText = '';
    renderSite();
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片读取失败，换一张试试'));
    img.src = src;
  });
}

/** 选图后本地压缩：主图最长边 512px（PNG 优先，超 700KB 转 JPEG），另存一张 96px 小图给小程序 */
async function pickIcon(file) {
  if (!/^image\//.test(file.type)) throw new Error('请选择图片文件');
  if (file.size > 8 * 1024 * 1024) throw new Error('图片太大，请选 8MB 以内的');
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('图片读取失败'));
    r.readAsDataURL(file);
  });
  const img = await loadImage(dataUrl);

  const draw = (max) => {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    return { cv, w, h };
  };

  const big = draw(512);
  let out = big.cv.toDataURL('image/png');
  if (out.length > 700 * 1024) out = big.cv.toDataURL('image/jpeg', 0.86);
  if (out.length > 700 * 1024) out = big.cv.toDataURL('image/jpeg', 0.7);

  // 小程序端只下这张小图，省流量
  const small = draw(96);
  const thumb = small.cv.toDataURL('image/png');

  siteDraft.icon = out;
  siteDraft.thumb = thumb;
  siteDraft.clearIcon = false;
  siteSyncText = '';
  toast(
    `图片已就绪（${big.w}×${big.h}，${Math.round((out.length * 0.75) / 1024)}KB），点保存后生效`
  );
}

async function saveSite() {
  const btn = $('#saveSiteBtn');
  const name = ($('#s-name').value || '').trim();
  if (!name) return toast('程序名称不能为空');
  const payload = { name, tagline: ($('#s-tagline').value || '').trim() };
  if (siteDraft.icon) {
    payload.icon = siteDraft.icon;
    if (siteDraft.thumb) payload.iconThumb = siteDraft.thumb;
  }
  if (siteDraft.clearIcon) payload.clearIcon = true;

  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const r = await api('/api/admin/site/save', { method: 'POST', body: JSON.stringify(payload) });
    state.data.site = r.site;
    siteDraft.icon = null;
    siteDraft.thumb = null;
    siteDraft.clearIcon = false;
    document.title = r.site.name + ' · 管理后台';

    if (r.mp && r.mp.synced) {
      siteSyncText = '小程序同步：✅ 本次已同步到小程序，重新进入小程序即可看到新名称和图标。';
      toast('已保存，网页版与小程序均已更新');
    } else {
      siteSyncText = `小程序同步：⚠️ 网页版已保存，但小程序未同步（${(r.mp && r.mp.message) || '未接入小程序云库'}）。`;
      toast('已保存（小程序未同步，见下方提示）');
    }
    renderSite();
  } catch (e) {
    toast(e.message);
  } finally {
    const b = $('#saveSiteBtn');
    if (b) {
      b.disabled = false;
      b.textContent = '保存并生效';
    }
  }
}

function renderPay() {
  const p = state.data.pay;
  $('#panel').innerHTML = `
    <div class="card">
      <h3>支付配置状态</h3>
      <div class="cfg-row"><span>当前渠道</span><b>${p.provider === 'wechat' && p.wechatReady ? '微信支付（真实）' : '模拟收银台（沙箱）'}</b></div>
      <div class="cfg-row"><span>商户号</span><b>${p.mchid || '未配置'}</b></div>
      <div class="cfg-row"><span>下单场景</span><b>${p.scene === 'auto' ? '自动适配（微信内/浏览器/扫码）' : p.scene}</b></div>
      <div class="cfg-row"><span>回调地址</span><b style="font-size:12px">${p.notifyUrl || '未配置'}</b></div>
      <div class="cfg-row"><span>云数据库</span><b>${p.cloudReady ? '已连接' : '未连接'}</b></div>
    </div>
    <div class="card">
      <h3>待补齐的微信支付凭据</h3>
      ${p.wechatReady
        ? '<div class="check-item">✅ 微信支付凭据已配齐，可以真实收款</div>'
        : p.missing.length
        ? p.missing.map((m) => `<div class="check-item"><span style="color:var(--bad)">✗</span><b>${m.key}</b><span class="muted">${m.desc}</span></div>`).join('') +
          '<p class="muted" style="font-size:12.5px;margin-top:10px">在商户平台 → 账户中心 → API安全 获取，填入 app/.env 后运行 npm run pay:check 验证。</p>'
        : ''}
    </div>`;
}

/* ---------------- 启动 ---------------- */

if (state.token) load();
else renderLogin();
