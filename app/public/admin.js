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
  const savedUser = localStorage.getItem('admin_user') || '';
  $('#app').innerHTML = `
    <div class="login-card">
      <div class="login-logo">🔐</div>
      <h2>管理后台</h2>
      <p>请输入管理员账号和密码登录</p>
      <input type="text" id="user" placeholder="管理员账号（默认 admin）" autocomplete="username" value="${esc(savedUser)}" />
      <input type="password" id="pwd" placeholder="管理密码" autocomplete="current-password" />
      <button id="loginBtn">登 录</button>
    </div>`;
  const doLogin = async () => {
    const btn = $('#loginBtn');
    const user = $('#user').value.trim();
    const pwd = $('#pwd').value.trim();
    if (!user) return toast('请输入管理员账号');
    if (!pwd) return toast('请输入管理密码');
    btn.disabled = true;
    btn.textContent = '登录中…';
    try {
      const r = await fetch(apiPath('/api/admin/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user, password: pwd }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.message || '登录失败');
      localStorage.setItem('admin_user', user);
      sessionStorage.setItem('admin_user', data.user || user);
      sessionStorage.setItem('admin_token', data.token);
      state.token = data.token;
      await load();
    } catch (e) {
      toast(e.message);
      if (btn) { btn.disabled = false; btn.textContent = '登 录'; }
    }
  };
  $('#loginBtn').onclick = doLogin;
  // 注意：处理函数不能返回值。箭头函数省略花括号会隐式返回 false，
  // 而 DOM 事件处理器返回 false 等同于 preventDefault()，会把除回车外的所有按键吞掉。
  const onEnter = (e) => {
    if (e.key === 'Enter') doLogin();
  };
  $('#user').onkeydown = onEnter;
  $('#pwd').onkeydown = onEnter;
  // 桌面端自动聚焦；移动端不自动弹键盘（会遮挡页面、且部分浏览器不给焦点）
  if (!/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
    try { ($('#user').value ? $('#pwd') : $('#user')).focus(); } catch (_) {}
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

/** 后台导航：key / 图标 / 名称 */
const NAV = [
  ['overview', '📊', '概览'],
  ['orders', '🧾', '订单'],
  ['products', '📦', '商品'],
  ['members', '👑', '会员'],
  ['users', '👥', '用户'],
  ['contents', '📝', '首页内容'],
  ['site', '🎨', '外观'],
  ['preview', '📱', '页面预览'],
  ['pay', '💳', '支付'],
];

function render() {
  if (!state.token) return renderLogin();
  const d = state.data;
  if (!d) {
    $('#app').innerHTML = '<p class="muted" style="text-align:center;margin-top:80px">加载中…</p>';
    return;
  }
  const siteName = (d.site && d.site.name) || '';
  $('#app').innerHTML = `
    <div class="shell">
      <aside class="side">
        <div class="side-brand">
          <span class="side-logo">⚡</span>
          <div class="side-brand-txt"><b>管理后台</b><i>${esc(siteName)}</i></div>
        </div>
        <nav class="side-nav">${NAV.map(
          ([k, ic, label]) => `<button class="nav-btn ${state.tab === k ? 'on' : ''}" data-tab="${k}"><span class="ic">${ic}</span>${label}</button>`
        ).join('')}</nav>
        <div class="side-foot">
          <span class="muted">管理员 ${esc(sessionStorage.getItem('admin_user') || 'admin')} · 商户号 ${d.pay.mchid || '未配置'}</span>
          <button id="logoutBtn">退出登录</button>
        </div>
      </aside>
      <main class="main"><div id="panel"></div></main>
    </div>`;
  document.querySelectorAll('.nav-btn').forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; render(); }));
  $('#logoutBtn').onclick = () => { state.token = ''; sessionStorage.removeItem('admin_token'); render(); };
  ({ overview: renderOverview, products: renderProducts, members: renderMembers, contents: renderContents, orders: renderOrders, users: renderUsers, site: renderSite, preview: renderPreview, pay: renderPay })[state.tab]();
}

function renderOverview() {
  const s = state.data.stats;
  const orders = state.data.orders || [];
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const t0 = dayStart.getTime();
  const todayPaid = orders.filter((o) => (o.status === 'paid' || o.status === 'refunded') && o.paidAt >= t0);
  const todaySum = todayPaid.reduce((sum, o) => sum + o.amount, 0);
  const stat = (cls, ic, k, v) => `<div class="stat ${cls}"><div class="stat-ic">${ic}</div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  $('#panel').innerHTML = `
    <div class="card">
      <h3>经营概览</h3>
      <div class="stats">
        ${stat('hl-brand', '📅', '今日收入', `<small>¥</small>${yuan(todaySum)}`)}
        ${stat('hl-brand', '🧾', '今日成交', `${todayPaid.length} <small>笔</small>`)}
        ${stat('hl-ok', '💰', '净收入', `<small>¥</small>${yuan(s.net)}`)}
        ${stat('', '📥', '累计收款', `<small>¥</small>${yuan(s.gross)}`)}
        ${stat('hl-bad', '↩️', '累计退款', `<small>¥</small>${yuan(s.refundSum)}`)}
        ${stat('', '👛', '账户余额', `<small>¥</small>${yuan(s.balance)}`)}
        ${stat('', '📦', '订单总数', `${s.orders} <small>笔</small>`)}
        ${stat('hl-ok', '✅', '已支付订单', `${s.paidOrders} <small>笔</small>`)}
        ${stat(s.pendingOrders ? 'hl-warn' : '', '⏳', '待支付订单', `${s.pendingOrders} <small>笔</small>`)}
      </div>
    </div>
    <div class="card">
      <h3>最近订单</h3>
      ${orderTable(state.data.orders.slice(0, 8))}
    </div>`;
}

/** 订单页筛选状态（内存态，切标签页后保留） */
const orderFilter = { status: 'all', q: '' };

function orderBuyerText(o) {
  if (!o.buyer) return '<span class="muted">游客/老订单</span>';
  const nick = o.buyer.nickname ? esc(o.buyer.nickname) : '';
  const phone = o.buyer.phone ? `<span style="font-family:monospace;font-size:12px">${esc(o.buyer.phone)}</span>` : '';
  return [nick, phone].filter(Boolean).join('<br/>') || '<span class="muted">—</span>';
}

function filteredOrders(orders) {
  const q = orderFilter.q.trim().toLowerCase();
  return orders.filter((o) => {
    if (orderFilter.status !== 'all' && o.status !== orderFilter.status) return false;
    if (!q) return true;
    const hay = [o.id, o.title, o.transactionId, o.buyer && o.buyer.phone, o.buyer && o.buyer.nickname]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

function renderOrderStats(orders) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const t0 = dayStart.getTime();
  const paidLike = orders.filter((o) => (o.status === 'paid' || o.status === 'refunded') && o.paidAt);
  const todayPaid = paidLike.filter((o) => o.paidAt >= t0);
  const todaySum = todayPaid.reduce((s, o) => s + o.amount, 0);
  const pending = orders.filter((o) => o.status === 'created' || o.status === 'pending').length;
  const item = (label, val, cls) => `<div class="ostat ${cls || ''}"><b>${val}</b><span>${label}</span></div>`;
  return `
    <div class="ostat-row">
      ${item('今日收入', '¥' + yuan(todaySum))}
      ${item('今日成交', todayPaid.length + ' 笔')}
      ${item('待支付', pending + ' 笔', pending ? 'warn' : '')}
      ${item('订单总数', orders.length + ' 笔')}
    </div>`;
}

function renderOrderControls() {
  const counts = { all: state.data.orders.length };
  for (const o of state.data.orders) counts[o.status] = (counts[o.status] || 0) + 1;
  const tabs = [
    ['all', '全部'],
    ['created', '待支付'],
    ['pending', '支付中'],
    ['paid', '已支付'],
    ['refunded', '已退款'],
    ['closed', '已关闭'],
  ]
    .map(([k, label]) => {
      const n = counts[k] || 0;
      return `<button class="ochip ${orderFilter.status === k ? 'on' : ''}" data-of="${k}">${label}${n ? ` <i>${n}</i>` : ''}</button>`;
    })
    .join('');
  return `
    <div class="obar">
      <div class="ochips">${tabs}</div>
      <div class="osearch">
        <input id="orderSearch" placeholder="搜订单号 / 手机号 / 昵称 / 商品 / 交易号" value="${esc(orderFilter.q)}" />
        <button class="op" id="orderExport">导出 CSV</button>
      </div>
    </div>`;
}

function orderTable(orders) {
  const list = filteredOrders(orders);
  if (!orders.length) return '<p class="muted">还没有订单</p>';
  if (!list.length) return '<p class="muted">没有符合条件的订单，换个筛选或关键词试试</p>';
  return `<div class="otable-wrap"><table><thead><tr><th>订单号</th><th>商品</th><th>买家</th><th>金额</th><th>渠道</th><th>状态</th><th>下单时间</th><th>支付时间</th><th>第三方交易号</th><th>操作</th></tr></thead>
    <tbody>${list
      .map(
        (o) => `<tr>
      <td style="font-family:monospace;font-size:12px;max-width:150px;word-break:break-all">
        <span class="oid" data-copy="${esc(o.id)}" title="点击复制">${esc(o.id)}</span>
      </td>
      <td style="max-width:130px;word-break:break-all">${esc(o.title)}</td>
      <td style="white-space:nowrap">${orderBuyerText(o)}</td>
      <td style="white-space:nowrap">¥${o.amountText}</td>
      <td class="muted" style="white-space:nowrap">${o.channelName || '-'}</td>
      <td><span class="tag ${o.status}">${STATUS_TEXT[o.status] || o.status}</span></td>
      <td class="muted" style="white-space:nowrap">${fmtTime(o.createdAt)}</td>
      <td class="muted" style="white-space:nowrap">${fmtTime(o.paidAt)}</td>
      <td style="font-family:monospace;font-size:11px;max-width:120px;word-break:break-all" title="${esc(o.transactionId || '')}">${
        o.transactionId ? esc(o.transactionId) : '<span class="muted">—</span>'
      }</td>
      <td style="white-space:nowrap">
        ${o.status === 'paid' ? `<button class="op danger" data-refund="${o.id}">退款</button>` : ''}
        ${
          o.status === 'pending' && /^alipay/i.test(String(o.channel || ''))
            ? `<button class="op" data-sync="${o.id}" title="向支付宝查单，已付款会自动变为已支付">同步</button>`
            : ''
        }
        ${(o.status === 'created' || o.status === 'pending') ? `<button class="op" data-close="${o.id}">关闭</button>` : ''}
      </td>
    </tr>`
      )
      .join('')}</tbody></table></div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">共 ${list.length} 条（库中最多展示最近 200 条）</p>`;
}

function exportOrdersCsv(orders) {
  const list = filteredOrders(orders);
  const head = ['订单号', '商品', '买家昵称', '买家手机号', '金额(元)', '渠道', '状态', '下单时间', '支付时间', '第三方交易号'];
  const escCell = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const rows = list.map((o) =>
    [
      o.id,
      o.title,
      o.buyer && o.buyer.nickname,
      o.buyer && o.buyer.phone,
      o.amountText,
      o.channelName || o.channel || '',
      STATUS_TEXT[o.status] || o.status,
      o.createdAt ? fmtTime(o.createdAt) : '',
      o.paidAt ? fmtTime(o.paidAt) : '',
      o.transactionId || '',
    ]
      .map(escCell)
      .join(',')
  );
  // \ufeff 让 Excel 正确识别 UTF-8
  const blob = new Blob(['\ufeff' + head.join(',') + '\n' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '订单-' + new Date().toISOString().slice(0, 10) + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`已导出 ${list.length} 条订单`);
}

function renderProducts() {
  const ps = state.data.products;
  let pfilter = 'all';
  const pChips = () => {
    const counts = { all: ps.length, active: 0, inactive: 0, member: 0 };
    ps.forEach((p) => {
      if (p.active) counts.active++;
      else counts.inactive++;
      if (Number(p.memberDays) > 0) counts.member++;
    });
    return [
      ['all', '全部'],
      ['active', '上架'],
      ['inactive', '下架'],
      ['member', '会员商品'],
    ]
      .map(([k, label]) => `<button class="ochip ${pfilter === k ? 'on' : ''}" data-pf="${k}">${label}${counts[k] ? ` <i>${counts[k]}</i>` : ''}</button>`)
      .join('');
  };
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
        <div><label>会员天数（0=普通商品）</label><input id="f-memberdays" type="number" min="0" step="1" value="0" placeholder="如 30" /></div>
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
        ? `<div class="ochips">${pChips()}</div><div class="search-box"><input id="productSearch" placeholder="🔍 搜商品 ID / 名称" /></div><div id="productRows"></div>`
        : '<p class="muted">还没有商品，先在上面新增一个</p>'}
    </div>`;

  $('#saveBtn').onclick = saveProduct;
  $('#resetBtn').onclick = () => fillForm(null);
  if (ps.length) {
    const renderProductRows = () => {
      const box = $('#productRows');
      if (!box) return;
      const q = ($('#productSearch').value || '').trim().toLowerCase();
      const fl = ps.filter(
        (p) =>
          (!q || `${p.id} ${p.title}`.toLowerCase().includes(q)) &&
          (pfilter === 'all' ||
            (pfilter === 'active' && p.active) ||
            (pfilter === 'inactive' && !p.active) ||
            (pfilter === 'member' && Number(p.memberDays) > 0))
      );
      box.innerHTML = fl.length
        ? `<table><thead><tr><th>ID</th><th>名称</th><th>价格</th><th>会员</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>${fl
            .map(
              (p) => `<tr>
            <td style="font-family:monospace;font-size:12px">${p.id}</td>
            <td>${p.title}${p.tag ? ` <span class="muted">·${p.tag}</span>` : ''}</td>
            <td>¥${yuan(p.amount)}</td>
            <td>${Number(p.memberDays) > 0 ? `<span class="tag tag-green">送 ${p.memberDays} 天</span>` : '<span class="muted">—</span>'}</td>
            <td class="muted">${p.sort}</td>
            <td>${p.active ? '<span class="tag paid">上架</span>' : '<span class="tag off">下架</span>'}</td>
            <td style="white-space:nowrap">
              <button class="op" data-edit='${JSON.stringify(p).replace(/'/g, '&#39;')}'>编辑</button>
              <button class="op danger" data-del="${p.id}">删除</button>
            </td>
          </tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="search-none muted">没有匹配的商品，换个筛选条件或关键词试试</p>';
      box.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => fillForm(JSON.parse(b.dataset.edit))));
      box.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => delProduct(b.dataset.del)));
    };
    renderProductRows();
    let ptimer = null;
    $('#productSearch').oninput = () => {
      clearTimeout(ptimer);
      ptimer = setTimeout(renderProductRows, 200);
    };
    document.querySelectorAll('[data-pf]').forEach((b) => {
      b.onclick = () => {
        pfilter = b.dataset.pf;
        document.querySelectorAll('[data-pf]').forEach((x) => x.classList.toggle('on', x === b));
        renderProductRows();
      };
    });
  }
}

function fillForm(p) {
  $('#formTitle').textContent = p ? '编辑商品：' + p.title : '新增商品';
  $('#f-id').value = p ? p.id : '';
  $('#f-title').value = p ? p.title : '';
  $('#f-amount').value = p ? (p.amount / 100).toFixed(2) : '';
  $('#f-tag').value = p ? p.tag || '' : '';
  $('#f-sort').value = p ? p.sort : 99;
  $('#f-active').value = p && p.active === false ? '0' : '1';
  $('#f-memberdays').value = p ? Number(p.memberDays) || 0 : 0;
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
        memberDays: Math.max(0, parseInt($('#f-memberdays').value, 10) || 0),
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

/* ---------------- 首页内容（用户手机端看到的内容卡片） ---------------- */

/** 正在编辑的内容（null = 新增）+ 待提交的配图 */
let editingContent = null;
const contentDraft = { image: '' };

function renderContents() {
  const cs = state.data.contents || [];
  let cfilter = 'all';
  const cChips = () => {
    const counts = { all: cs.length, active: 0, hidden: 0 };
    cs.forEach((c) => (c.active ? counts.active++ : counts.hidden++));
    return [
      ['all', '全部'],
      ['active', '上线'],
      ['hidden', '隐藏'],
    ]
      .map(([k, label]) => `<button class="ochip ${cfilter === k ? 'on' : ''}" data-cf="${k}">${label}${counts[k] ? ` <i>${counts[k]}</i>` : ''}</button>`)
      .join('');
  };
  $('#panel').innerHTML = `
    <div class="card">
      <h3 id="cFormTitle">新增首页内容</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 14px;line-height:1.65">
        这里加的内容会显示在手机首页「精选内容」，以及底部「内容」页；用户点开就能看到标题、描述和配图。
      </p>
      <div class="form-grid">
        <div><label>标题 *（最多 40 字）</label><input id="c-title" maxlength="40" placeholder="如 新用户立减 5 元" /></div>
        <div><label>角标（如：活动 / 新品）</label><input id="c-tag" maxlength="10" /></div>
        <div class="full"><label>描述（最多 200 字）</label><textarea id="c-desc" rows="2" maxlength="200" placeholder="一句话说清这是什么"></textarea></div>
        <div><label>跳转链接（可选）</label><input id="c-link" placeholder="https://… 或 /admin" /></div>
        <div><label>排序（小在前）</label><input id="c-sort" type="number" value="100" /></div>
        <div><label>状态</label><select id="c-active"><option value="1">上线</option><option value="0">隐藏</option></select></div>
        <div>
          <label>配图（可选）</label>
          <div class="brand-btns">
            <label class="btn ghost" for="c-img" style="padding:7px 12px;font-size:12.5px">选择图片</label>
            <button class="op" id="c-img-clear" type="button">移除</button>
          </div>
          <input type="file" id="c-img" accept="image/png,image/jpeg,image/webp" style="display:none" />
        </div>
      </div>
      <div class="c-preview" id="c-preview"></div>
      <div class="row-actions">
        <button class="btn" id="c-save">保存</button>
        <button class="btn ghost" id="c-reset">清空表单</button>
      </div>
    </div>

    <div class="card">
      <h3>全部内容（${cs.length}）</h3>
      ${cs.length
        ? `<div class="ochips">${cChips()}</div><div class="search-box"><input id="contentSearch" placeholder="🔍 搜标题 / 描述" /></div><div id="contentRows"></div>`
        : '<p class="muted">还没有内容，先在上面新增一条</p>'}
    </div>`;

  renderContentPreview();
  if (cs.length) {
    const renderContentRows = () => {
      const box = $('#contentRows');
      if (!box) return;
      const q = ($('#contentSearch').value || '').trim().toLowerCase();
      const fl = cs.filter(
        (c) =>
          (!q || `${c.title || ''} ${c.desc || ''}`.toLowerCase().includes(q)) &&
          (cfilter === 'all' || (cfilter === 'active' ? c.active : !c.active))
      );
      box.innerHTML = fl.length
        ? `<table><thead><tr><th>配图</th><th>标题</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>${fl
            .map(
              (c) => `<tr>
            <td>${
              c.image
                ? `<img src="${esc(c.image)}" alt="" style="width:44px;height:44px;border-radius:9px;object-fit:cover;display:block" />`
                : '<span class="muted">无</span>'
            }</td>
            <td>${esc(c.title)}${c.tag ? ` <span class="tag tag-blue">${esc(c.tag)}</span>` : ''}<div class="muted" style="font-size:11.5px;margin-top:2px">${esc(c.desc || '')}</div></td>
            <td class="muted">${c.sort}</td>
            <td>${c.active ? '<span class="tag paid">上线</span>' : '<span class="tag off">隐藏</span>'}</td>
            <td style="white-space:nowrap">
              <button class="op" data-cedit="${esc(c.id)}">编辑</button>
              <button class="op danger" data-cdel="${esc(c.id)}">删除</button>
            </td>
          </tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="search-none muted">没有匹配的内容，换个筛选条件或关键词试试</p>';
      box.querySelectorAll('[data-cedit]').forEach(
        (b) => (b.onclick = () => fillContentForm(cs.find((x) => x.id === b.dataset.cedit)))
      );
      box.querySelectorAll('[data-cdel]').forEach((b) => (b.onclick = () => delContent(b.dataset.cdel)));
    };
    renderContentRows();
    let ctimer = null;
    $('#contentSearch').oninput = () => {
      clearTimeout(ctimer);
      ctimer = setTimeout(renderContentRows, 200);
    };
    document.querySelectorAll('[data-cf]').forEach((b) => {
      b.onclick = () => {
        cfilter = b.dataset.cf;
        document.querySelectorAll('[data-cf]').forEach((x) => x.classList.toggle('on', x === b));
        renderContentRows();
      };
    });
  }
  $('#c-img').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    pickContentImage(f)
      .then(() => renderContentPreview())
      .catch((err) => toast(err.message || '图片处理失败'));
  };
  $('#c-img-clear').onclick = () => {
    contentDraft.image = '';
    renderContentPreview();
    toast('配图已移除，点保存生效');
  };
  $('#c-save').onclick = saveContent;
  $('#c-reset').onclick = () => fillContentForm(null);
  document.querySelectorAll('[data-cedit]').forEach(
    (b) => (b.onclick = () => fillContentForm(cs.find((x) => x.id === b.dataset.cedit)))
  );
  document.querySelectorAll('[data-cdel]').forEach((b) => (b.onclick = () => delContent(b.dataset.cdel)));
}

function renderContentPreview() {
  const box = $('#c-preview');
  if (!box) return;
  box.innerHTML = contentDraft.image
    ? `<img src="${esc(contentDraft.image)}" alt="配图预览" />`
    : '<span class="muted" style="font-size:12px">未选择配图（也能保存，只是卡片左侧会是标题首字）</span>';
}

function fillContentForm(c) {
  editingContent = c || null;
  contentDraft.image = c && c.image ? c.image : '';
  $('#cFormTitle').textContent = c ? '编辑内容：' + c.title : '新增首页内容';
  $('#c-title').value = c ? c.title : '';
  $('#c-tag').value = c ? c.tag || '' : '';
  $('#c-desc').value = c ? c.desc || '' : '';
  $('#c-link').value = c ? c.link || '' : '';
  $('#c-sort').value = c ? c.sort : 100;
  $('#c-active').value = c && c.active === false ? '0' : '1';
  renderContentPreview();
}

/** 配图：最长边压到 720px，JPEG（带透明转 PNG），控制在 400KB 以内 */
async function pickContentImage(file) {
  if (!/^image\//.test(file.type)) throw new Error('请选择图片文件');
  if (file.size > 8 * 1024 * 1024) throw new Error('图片太大，请选 8MB 以内的');
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('图片读取失败'));
    r.readAsDataURL(file);
  });
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, 720 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let out = cv.toDataURL('image/jpeg', 0.86);
  if (out.length > 380 * 1024) out = cv.toDataURL('image/jpeg', 0.7);
  contentDraft.image = out;
  toast(`配图已就绪（${w}×${h}，${Math.round((out.length * 0.75) / 1024)}KB）`);
}

async function saveContent() {
  const btn = $('#c-save');
  const title = ($('#c-title').value || '').trim();
  if (!title) return toast('标题不能为空');
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    await api('/api/admin/content/save', {
      method: 'POST',
      body: JSON.stringify({
        id: editingContent ? editingContent.id : '',
        title,
        desc: ($('#c-desc').value || '').trim(),
        tag: ($('#c-tag').value || '').trim(),
        link: ($('#c-link').value || '').trim(),
        sort: parseInt($('#c-sort').value, 10) || 100,
        active: $('#c-active').value === '1',
        image: contentDraft.image || '',
      }),
    });
    toast('已保存');
    editingContent = null;
    contentDraft.image = '';
    await load();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

async function delContent(id) {
  if (!confirm('确定删除这条内容？手机端会立刻不再显示。')) return;
  try {
    await api('/api/admin/content/delete', { method: 'POST', body: JSON.stringify({ id }) });
    toast('已删除');
    await load();
  } catch (e) {
    toast(e.message);
  }
}

function renderOrders() {
  const orders = state.data.orders || [];
  $('#panel').innerHTML = `
    <div class="card">
      <h3>订单管理</h3>
      ${renderOrderStats(orders)}
      ${renderOrderControls()}
      <div id="orderTableBox">${orderTable(orders)}</div>
    </div>`;
  bindOrderOps();

  // 状态筛选
  document.querySelectorAll('[data-of]').forEach((b) => {
    b.onclick = () => {
      orderFilter.status = b.dataset.of;
      renderOrders();
    };
  });
  // 关键词搜索（防抖，只重绘表格区域避免输入框失焦）
  const box = $('#orderSearch');
  if (box) {
    let timer = null;
    box.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        orderFilter.q = box.value;
        const box2 = $('#orderTableBox');
        if (box2) box2.innerHTML = orderTable(state.data.orders || []);
        bindOrderOps();
        bindCopy();
      }, 250);
    };
  }
  // 导出
  const ex = $('#orderExport');
  if (ex) ex.onclick = () => exportOrdersCsv(orders);
  bindCopy();
}

function bindCopy() {
  document.querySelectorAll('[data-copy]').forEach((el) => {
    el.onclick = () => {
      const text = el.dataset.copy;
      const done = () => toast('订单号已复制：' + text);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
      } else fallbackCopy(text, done);
    };
  });
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    toast('复制失败，请手动选择');
  }
  document.body.removeChild(ta);
}

function bindOrderOps() {
  document.querySelectorAll('[data-refund]').forEach((b) => (b.onclick = () => refundOrder(b.dataset.refund)));
  document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeOrder(b.dataset.close)));
  document.querySelectorAll('[data-sync]').forEach((b) => (b.onclick = () => syncOrder(b.dataset.sync, b)));
}

/** 向支付宝查单，已付款则入账（对账用） */
async function syncOrder(id, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '查询中';
  try {
    const res = await api(`/api/admin/orders/${encodeURIComponent(id)}/sync`, { method: 'POST' });
    if (res.paid) {
      toast('已确认支付，订单已入账');
      await load();
    } else {
      const map = {
        WAIT_BUYER_PAY: '支付宝显示「等待付款」，买家可能还没扫码',
        'ACQ.TRADE_NOT_EXIST': '支付宝查不到这笔交易（未扫码或已超时）',
        amountmismatch: '金额不一致，已拒绝入账',
        nochannel: '该订单不是支付宝渠道',
      };
      toast(map[res.reason] || map[res.tradeStatus] || '仍未支付');
      btn.disabled = false;
      btn.textContent = label;
    }
  } catch (e) {
    toast(e.message || '查询失败');
    btn.disabled = false;
    btn.textContent = label;
  }
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
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">手机号登录的用户：网页版 / PWA 用户来自本应用云库，小程序用户来自小程序云库，这里只读展示。</p>
      <div id="userTable"><p class="muted">加载中…</p></div>
    </div>`;

  api('/api/admin/users')
    .then((r) => {
      const box = $('#userTable');
      if (!box) return;
      const list = r.users || [];
      if (list.length === 0) {
        box.innerHTML = '<p class="muted">还没有用户。网页版或小程序端用手机号注册/登录后，会自动出现在这里。</p>';
        return;
      }
      const paidSum = list.reduce((s, u) => s + (u.paidAmount || 0), 0);
      const webCount = list.filter((u) => u.source === 'web').length;
      const mpCount = list.filter((u) => u.source === 'mp').length;
      let usrc = 'all';
      let umember = 'all';
      const userChips = () => {
        const srcCounts = { all: list.length, web: webCount, mp: mpCount };
        const memCounts = {
          all: list.length,
          member: list.filter((u) => u.isMember).length,
          normal: list.filter((u) => !u.isMember).length,
        };
        const chip = (group, k, label, n) =>
          `<button class="ochip ${(group === 'src' ? usrc : umember) === k ? 'on' : ''}" data-uf="${group}:${k}">${label}${n ? ` <i>${n}</i>` : ''}</button>`;
        return (
          chip('src', 'all', '全部', srcCounts.all) +
          chip('src', 'web', '网页/APP', srcCounts.web) +
          chip('src', 'mp', '小程序', srcCounts.mp) +
          '<span class="ochip-sep"></span>' +
          chip('mem', 'all', '不限身份', memCounts.all) +
          chip('mem', 'member', '会员', memCounts.member) +
          chip('mem', 'normal', '普通', memCounts.normal)
        );
      };
      box.innerHTML = `
        <p class="muted" style="font-size:12.5px;margin:0 0 10px">共 ${list.length} 位用户（网页版 ${webCount} · 小程序 ${mpCount}），累计支付 ¥${yuan(paidSum)}</p>
        <div class="ochips">${userChips()}</div>
        <div class="search-box"><input id="userSearch" placeholder="🔍 搜手机号 / 昵称" /></div>
        <div id="userRows"></div>`;
      const renderUserRows = () => {
        const rows = $('#userRows');
        if (!rows) return;
        const q = ($('#userSearch').value || '').trim().toLowerCase();
        const fl = list.filter(
          (u) =>
            (!q || `${u.phone || ''} ${u.nickname || ''}`.toLowerCase().includes(q)) &&
            (usrc === 'all' || u.source === usrc) &&
            (umember === 'all' || (umember === 'member' ? u.isMember : !u.isMember))
        );
        rows.innerHTML = fl.length
          ? `<table>
          <thead><tr><th>手机号</th><th>昵称</th><th>来源</th><th>积分</th><th>余额</th><th>注册时间</th><th>最近登录</th><th>订单数</th><th>累计支付</th></tr></thead>
          <tbody>${fl
            .map(
              (u) => `<tr>
              <td style="font-family:monospace;font-size:13px">${u.phone || '<span class="muted">未绑定</span>'}</td>
              <td>${u.nickname || '<span class="muted">—</span>'}</td>
              <td><span class="tag ${u.source === 'web' ? 'tag-blue' : 'tag-green'}">${
                u.source === 'web' ? '网页/APP' : '小程序'
              }</span></td>
              <td>${u.points || 0}</td>
              <td>¥${yuan(u.balance || 0)}</td>
              <td class="muted" style="white-space:nowrap">${fmtTime(u.createdAt)}</td>
              <td class="muted" style="white-space:nowrap">${fmtTime(u.lastLoginAt)}</td>
              <td>${u.orderCount}</td>
              <td>¥${yuan(u.paidAmount || 0)}</td>
            </tr>`
            )
            .join('')}</tbody>
        </table>`
          : '<p class="search-none muted">没有匹配的用户，换个筛选条件或关键词试试</p>';
      };
      renderUserRows();
      let utimer = null;
      $('#userSearch').oninput = () => {
        clearTimeout(utimer);
        utimer = setTimeout(renderUserRows, 200);
      };
      box.querySelectorAll('[data-uf]').forEach((b) => {
        b.onclick = () => {
          const [group, k] = b.dataset.uf.split(':');
          if (group === 'src') usrc = k;
          else umember = k;
          box.querySelectorAll(`[data-uf^="${group}:"]`).forEach((x) => x.classList.toggle('on', x === b));
          renderUserRows();
        };
      });
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

/* ---------------- 会员管理 ---------------- */

const MEMBER_ACTION_TEXT = {
  purchase: '自购',
  autorenew: '自动续费',
  grant: '后台赠送',
  revoke: '后台取消',
  autorenew_fail: '续费失败',
  cycle_sign: '支付宝签约',
  cycle_unsign: '支付宝解约',
};

function memberSourceTag(log) {
  if (!log) return '<span class="muted">—</span>';
  const map = {
    purchase: ['tag-green', '客户自购'],
    autorenew: ['tag-orange', '自动续费'],
    grant: ['tag-blue', '后台赠送'],
  };
  const m = map[log.action];
  if (!m) return '<span class="muted">—</span>';
  return `<span class="tag ${m[0]}">${m[1]}</span>`;
}

function memberBadge(u) {
  const cycleTag = u.cycleStatus === 'NORMAL' ? ' <span class="tag tag-blue">支付宝代扣</span>' : '';
  if (u.isMember) {
    const d = u.memberExpire ? new Date(u.memberExpire) : null;
    const left = d ? Math.ceil((d.getTime() - Date.now()) / 86400000) : 0;
    const soon = left <= 7 ? 'tag-orange' : 'tag-green';
    const renew = u.autoRenew ? ` <span class="tag tag-orange">自动续费</span>${cycleTag}` : '';
    return `<span class="tag ${soon}">会员 · 剩 ${left} 天</span>${renew}<div class="muted" style="font-size:11.5px;margin-top:2px">${d ? fmtTime(d.getTime()) : ''}</div>`;
  }
  if (u.autoRenew) return `<span class="tag tag-orange">已开自动续费</span>${cycleTag}`;
  return '<span class="muted">—</span>';
}

function memberLogRow(l) {
  const action = MEMBER_ACTION_TEXT[l.action] || l.action;
  const amount = Number(l.amount || 0) ? ` ¥${yuan(Number(l.amount))}` : '';
  const days = Number(l.days || 0) ? ` +${l.days}天` : '';
  const expire = l.expire_after ? ` · 到期 ${fmtTime(new Date(l.expire_after).getTime())}` : '';
  const src = l.source === 'admin' ? '后台' : l.source === 'system' ? '系统' : '用户';
  return `<tr>
    <td class="muted" style="font-size:11.5px;white-space:nowrap">${fmtTime(new Date(l.created_at).getTime())}</td>
    <td>${action}${days}${amount} <span class="muted" style="font-size:11px">(${src})</span></td>
    <td class="muted" style="font-size:11.5px">${esc(l.order_id || l.note || '')}</td>
  </tr>`;
}

function renderMembers() {
  $('#panel').innerHTML = `
    <div class="card">
      <h3>会员管理</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">
        用户在手机端购买「会员商品」后自动开通；开启「自动续费」的用户到期前 24 小时自动从余额扣款续费，余额不足会记录失败并跳过。
        「来源」列显示会员是<b>客户自购 / 自动续费 / 后台赠送</b>；点「记录」可查看该用户全部会员流水。
        商品在 <b>商品</b> 页设置「会员天数」。
      </p>
      <div id="memberTable"><p class="muted">加载中…</p></div>
    </div>`;

  api('/api/admin/users')
    .then(async (r) => {
      const box = $('#memberTable');
      if (!box) return;
      const list = r.users || [];
      const web = list.filter((u) => u.source === 'web');
      const members = web.filter((u) => u.isMember);
      const soon = members.filter((u) => u.memberExpire && u.memberExpire - Date.now() < 7 * 86400000);
      const autoN = web.filter((u) => u.autoRenew).length;
      // 每个用户最近一条来源流水，判断会员是自购 / 自动续费 / 后台赠送
      let latestLog = {};
      try {
        const lr = await api('/api/admin/member/logs?limit=500');
        (lr.logs || []).forEach((l) => {
          if (['purchase', 'autorenew', 'grant'].includes(l.action) && !latestLog[l.user_id]) latestLog[l.user_id] = l;
        });
      } catch (e) {
        /* 流水读取失败不阻塞列表 */
      }
      let mfilter = 'all';
      const mChips = () => {
        const counts = {
          all: web.length,
          active: 0,
          soon: 0,
          expired: 0,
          auto: 0,
        };
        web.forEach((u) => {
          if (u.isMember) {
            counts.active++;
            if (u.memberExpire && u.memberExpire - Date.now() < 7 * 86400000) counts.soon++;
          } else if (u.memberExpire && u.memberExpire < Date.now()) counts.expired++;
          if (u.autoRenew) counts.auto++;
        });
        return [
          ['all', '全部'],
          ['active', '生效中'],
          ['soon', '7天内到期'],
          ['expired', '已过期'],
          ['auto', '自动续费'],
        ]
          .map(([k, label]) => `<button class="ochip ${mfilter === k ? 'on' : ''}" data-mf="${k}">${label}${counts[k] ? ` <i>${counts[k]}</i>` : ''}</button>`)
          .join('');
      };
      box.innerHTML = `
        <div class="ostat-row">
          <div class="ostat"><b>${members.length}</b><span>生效会员</span></div>
          <div class="ostat ${soon.length ? 'warn' : ''}"><b>${soon.length}</b><span>7 天内到期</span></div>
          <div class="ostat"><b>${autoN}</b><span>自动续费</span></div>
          <div class="ostat"><b>${web.length}</b><span>注册用户</span></div>
        </div>
        ${
          web.length
            ? `<div class="ochips">${mChips()}</div><div class="search-box"><input id="memberSearch" placeholder="🔍 搜手机号 / 昵称" /></div><div id="memberRows"></div>
            <div id="memberLogBox" style="margin-top:14px"></div>`
            : '<p class="muted">还没有网页版注册用户。</p>'
        }`;

      const renderMemberRows = () => {
        const rows = $('#memberRows');
        if (!rows) return;
        const q = ($('#memberSearch').value || '').trim().toLowerCase();
        const fl = web.filter((u) => {
          if (q && !`${u.phone || ''} ${u.nickname || ''}`.toLowerCase().includes(q)) return false;
          if (mfilter === 'all') return true;
          if (mfilter === 'active') return u.isMember;
          if (mfilter === 'soon') return u.isMember && u.memberExpire && u.memberExpire - Date.now() < 7 * 86400000;
          if (mfilter === 'expired') return !u.isMember && u.memberExpire && u.memberExpire < Date.now();
          if (mfilter === 'auto') return Boolean(u.autoRenew);
          return true;
        });
        rows.innerHTML = fl.length
          ? `<table><thead><tr><th>手机号</th><th>昵称</th><th>会员状态</th><th>来源</th><th>余额</th><th>订单数</th><th>操作</th></tr></thead><tbody>${fl
              .map(
                (u) => `<tr>
                <td style="font-family:monospace;font-size:13px">${u.phone || '<span class="muted">未绑定</span>'}</td>
                <td>${u.nickname || '<span class="muted">—</span>'}</td>
                <td>${memberBadge(u)}</td>
                <td>${memberSourceTag(latestLog[u.id])}</td>
                <td>¥${yuan(u.balance || 0)}</td>
                <td>${u.orderCount || 0}</td>
                <td style="white-space:nowrap">
                  <button class="op" data-mgrant="${u.id}" data-name="${esc(u.nickname || u.phone)}">开通/续费</button>
                  <button class="op" data-mlog="${u.id}" data-name="${esc(u.nickname || u.phone)}">记录</button>
                  ${u.isMember ? `<button class="op danger" data-mrevoke="${u.id}" data-name="${esc(u.nickname || u.phone)}">取消</button>` : ''}
                </td>
              </tr>`
              )
              .join('')}</tbody></table>`
          : '<p class="search-none muted">没有匹配的用户，换个筛选条件或关键词试试</p>';

        rows.querySelectorAll('[data-mlog]').forEach((b) => {
          b.onclick = async () => {
            const box2 = $('#memberLogBox');
            if (!box2) return;
            box2.innerHTML = '<p class="muted">加载流水…</p>';
            try {
              const lr = await api(`/api/admin/member/logs?userId=${encodeURIComponent(b.dataset.mlog)}&limit=50`);
              const logs = lr.logs || [];
              box2.innerHTML = `<div class="card">
                <h3 style="margin-top:0">「${esc(b.dataset.name)}」的会员记录</h3>
                ${
                  logs.length
                    ? `<table><thead><tr><th>时间</th><th>操作</th><th>订单 / 备注</th></tr></thead><tbody>${logs.map(memberLogRow).join('')}</tbody></table>`
                    : '<p class="muted">暂无记录</p>'
                }
              </div>`;
              box2.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            } catch (e) {
              box2.innerHTML = `<p style="color:var(--bad);font-size:13px">读取失败：${e.message}</p>`;
            }
          };
        });

        rows.querySelectorAll('[data-mgrant]').forEach((b) => {
          b.onclick = async () => {
            const input = prompt(`给「${b.dataset.name}」开通/续费多少天会员？\n（30=月卡 90=季卡 365=年卡，会累加到当前到期时间）`, '30');
            if (input === null) return;
            const days = parseInt(input, 10);
            if (!Number.isFinite(days) || days <= 0) return toast('请输入大于 0 的天数');
            try {
              const r = await api('/api/admin/member/grant', {
                method: 'POST',
                body: JSON.stringify({ userId: b.dataset.mgrant, days }),
              });
              toast('已开通，到期 ' + (r.expire ? fmtTime(new Date(r.expire).getTime()) : '成功'));
              renderMembers();
            } catch (e) {
              toast(e.message);
            }
          };
        });
        rows.querySelectorAll('[data-mrevoke]').forEach((b) => {
          b.onclick = async () => {
            if (!confirm(`确定取消「${b.dataset.name}」的会员？用户端立即失效。`)) return;
            try {
              await api('/api/admin/member/revoke', { method: 'POST', body: JSON.stringify({ userId: b.dataset.mrevoke }) });
              toast('已取消会员');
              renderMembers();
            } catch (e) {
              toast(e.message);
            }
          };
        });
      };
      renderMemberRows();
      let mtimer = null;
      const msearch = $('#memberSearch');
      if (msearch)
        msearch.oninput = () => {
          clearTimeout(mtimer);
          mtimer = setTimeout(renderMemberRows, 200);
        };
      box.querySelectorAll('[data-mf]').forEach((b) => {
        b.onclick = () => {
          mfilter = b.dataset.mf;
          box.querySelectorAll('[data-mf]').forEach((x) => x.classList.toggle('on', x === b));
          renderMemberRows();
        };
      });
    })
    .catch((e) => {
      const box = $('#memberTable');
      if (box) box.innerHTML = `<p style="color:var(--bad);font-size:13px">读取失败：${e.message}</p>`;
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
  const s = state.data.site || { name: '', tagline: '', notice: '', enableRegister: true, showMock: true, showBalance: true, hasIcon: false };
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
        <div class="full"><label>首页公告（可选，最多 200 字，留空不显示）</label><input id="s-notice" maxlength="200" value="${esc(s.notice || '')}" placeholder="如 新用户下单立减 5 元，活动截止 11 月 11 日" /></div>
      </div>

      <div class="row-actions">
        <button class="btn" id="saveSiteBtn">保存并生效</button>
        <button class="btn ghost" id="reloadSiteBtn">撤销修改</button>
      </div>
      <p class="muted" id="mpStatus" style="font-size:12px;margin:10px 0 0;line-height:1.6">${mpStatusHTML()}</p>
    </div>

    <div class="card">
      <h3>前台功能开关</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">
        这些开关直接控制用户手机上看到什么。改完点上面的「保存并生效」。
      </p>
      <label class="switch-row">
        <div><b>开放新用户注册</b><p class="muted" style="font-size:12px;margin:2px 0 0">关闭后登录页不再出现注册入口，接口也会拒绝注册</p></div>
        <input type="checkbox" id="s-reg" ${s.enableRegister !== false ? 'checked' : ''} />
      </label>
      <label class="switch-row">
        <div><b>显示模拟收银台</b><p class="muted" style="font-size:12px;margin:2px 0 0">没配微信/支付宝时兜底的假支付；正式运营建议关闭</p></div>
        <input type="checkbox" id="s-mock" ${s.showMock !== false ? 'checked' : ''} />
      </label>
      <label class="switch-row">
        <div><b>显示余额支付</b><p class="muted" style="font-size:12px;margin:2px 0 0">用户用账户余额下单；不想做余额体系可关闭</p></div>
        <input type="checkbox" id="s-bal" ${s.showBalance !== false ? 'checked' : ''} />
      </label>
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
  const payload = {
    name,
    tagline: ($('#s-tagline').value || '').trim(),
    notice: ($('#s-notice') ? $('#s-notice').value : '').trim(),
    enableRegister: !$('#s-reg') || $('#s-reg').checked,
    showMock: !$('#s-mock') || $('#s-mock').checked,
    showBalance: !$('#s-bal') || $('#s-bal').checked,
  };
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

/* ---------------- 页面预览：直接看前端真实页面 + 快捷设置 ---------------- */

function refreshPreviewFrame() {
  const f = $('#previewFrame');
  if (f) f.src = '/?_=' + Date.now();
}

function renderPreview() {
  const s = state.data.site || { name: '', tagline: '', notice: '', enableRegister: true, showMock: true, showBalance: true };
  $('#panel').innerHTML = `
    <div class="card">
      <h3>前端页面预览</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 12px">
        左边就是用户手机上打开的真实页面。在这里或其它页改完设置后，点「刷新预览」即可看到最新效果。
      </p>
      <div class="pv-wrap">
        <div class="pv-phone"><iframe id="previewFrame" title="前端页面预览"></iframe></div>
        <div class="pv-side">
          <button class="btn" id="pv-refresh">🔄 刷新预览</button>
          <a class="btn ghost" href="/" target="_blank" rel="noopener" style="text-decoration:none;text-align:center">在新窗口打开前台</a>
          <div class="pv-tips">
            <b>前端内容在这里设置</b>
            <p>· 名称 / 副标题 / 公告 / 开关 → 下方快捷设置或「外观」页<br/>
               · 首页内容卡片（精选内容、内容页）→「首页内容」页<br/>
               · 商品与价格 →「商品」页<br/>
               · 图标上传 →「外观」页</p>
          </div>
          <div class="pv-jumps">
            <button class="btn ghost" id="pv-go-site">去外观设置</button>
            <button class="btn ghost" id="pv-go-contents">去首页内容管理</button>
            <button class="btn ghost" id="pv-go-products">去商品管理</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>前端快捷设置</h3>
      <p class="muted" style="font-size:12.5px;margin:0 0 14px">改完点「保存并刷新预览」，左边页面立即更新。</p>
      <div class="form-grid">
        <div><label>程序名称 *（最多 24 字）</label><input id="pv-name" maxlength="24" value="${esc(s.name || '')}" placeholder="如 我的小工具" /></div>
        <div><label>副标题（最多 40 字）</label><input id="pv-tagline" maxlength="40" value="${esc(s.tagline || '')}" placeholder="如 一个能付款的小应用" /></div>
        <div class="full"><label>首页公告（最多 200 字，留空不显示）</label><input id="pv-notice" maxlength="200" value="${esc(s.notice || '')}" placeholder="如 新用户下单立减 5 元" /></div>
      </div>
      <label class="switch-row">
        <div><b>开放新用户注册</b><p class="muted" style="font-size:12px;margin:2px 0 0">关闭后登录页不再出现注册入口</p></div>
        <input type="checkbox" id="pv-reg" ${s.enableRegister !== false ? 'checked' : ''} />
      </label>
      <label class="switch-row">
        <div><b>显示模拟收银台</b><p class="muted" style="font-size:12px;margin:2px 0 0">没配微信/支付宝时的兜底假支付，正式运营建议关闭</p></div>
        <input type="checkbox" id="pv-mock" ${s.showMock !== false ? 'checked' : ''} />
      </label>
      <label class="switch-row">
        <div><b>显示余额支付</b><p class="muted" style="font-size:12px;margin:2px 0 0">用户用账户余额下单</p></div>
        <input type="checkbox" id="pv-bal" ${s.showBalance !== false ? 'checked' : ''} />
      </label>
      <div class="row-actions">
        <button class="btn" id="pv-save">保存并刷新预览</button>
      </div>
    </div>`;

  refreshPreviewFrame();
  $('#pv-refresh').onclick = () => {
    refreshPreviewFrame();
    toast('预览已刷新');
  };
  $('#pv-go-site').onclick = () => {
    state.tab = 'site';
    render();
  };
  $('#pv-go-contents').onclick = () => {
    state.tab = 'contents';
    render();
  };
  $('#pv-go-products').onclick = () => {
    state.tab = 'products';
    render();
  };
  $('#pv-save').onclick = savePreviewSettings;
}

async function savePreviewSettings() {
  const btn = $('#pv-save');
  const name = ($('#pv-name').value || '').trim();
  if (!name) return toast('程序名称不能为空');
  const payload = {
    name,
    tagline: ($('#pv-tagline').value || '').trim(),
    notice: ($('#pv-notice').value || '').trim(),
    enableRegister: $('#pv-reg').checked,
    showMock: $('#pv-mock').checked,
    showBalance: $('#pv-bal').checked,
  };
  btn.disabled = true;
  btn.textContent = '保存中…';
  try {
    const r = await api('/api/admin/site/save', { method: 'POST', body: JSON.stringify(payload) });
    state.data.site = r.site;
    document.title = r.site.name + ' · 管理后台';
    toast('已保存，预览已更新');
    renderPreview(); // 重渲染会重建 iframe，即最新页面
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
    btn.textContent = '保存并刷新预览';
  }
}

function renderPay() {
  const p = state.data.pay || {};
  const ali = p.alipay || { ready: false, missing: [] };
  const aliMissing = ali.missing || [];
  const wxMissing = p.missing || [];

  const statusBadge = (ok) =>
    ok
      ? '<span class="tag on">已配置</span>'
      : '<span class="tag off">未配置</span>';

  $('#panel').innerHTML = `
    <div class="card">
      <h3>收款渠道总览</h3>
      <div class="cfg-row"><span>微信支付</span><b>${statusBadge(p.wechatReady)}</b></div>
      <div class="cfg-row"><span>支付宝</span><b>${statusBadge(ali.ready)}</b></div>
      <div class="cfg-row"><span>默认渠道</span><b>${
        p.provider === 'alipay' && ali.ready
          ? '支付宝（真实）'
          : p.provider === 'wechat' && p.wechatReady
          ? '微信支付（真实）'
          : '模拟收银台（沙箱，不真实扣款）'
      }</b></div>
      <div class="cfg-row"><span>云数据库</span><b>${p.cloudReady ? '已连接' : '未连接'}</b></div>
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">两个渠道都配置好后，用户下单时可以自己选微信或支付宝。</p>
    </div>

    <div class="card">
      <h3>支付宝</h3>
      <div class="cfg-row"><span>APPID</span><b style="font-family:monospace;font-size:12.5px">${ali.appId || '未配置'}</b></div>
      <div class="cfg-row"><span>运行环境</span><b>${ali.sandbox ? '沙箱（openapi.alipaydev.com）' : '生产（openapi.alipay.com）'}</b></div>
      <div class="cfg-row"><span>异步通知</span><b style="font-size:12px">${ali.notifyUrl || '未配置'}</b></div>
      <div class="cfg-row"><span>签名方式</span><b>RSA2（SHA256withRSA）</b></div>
      ${ali.ready
        ? '<div class="check-item" style="margin-top:10px">✅ 支付宝凭据已配齐，可以真实收款</div>'
        : aliMissing.length
        ? aliMissing
            .map(
              (m) =>
                `<div class="check-item" style="margin-top:10px"><span style="color:var(--bad)">✗</span><b>${m.key}</b><span class="muted">${m.desc}</span></div>`
            )
            .join('')
        : ''}
      <p class="muted" style="font-size:12.5px;margin:12px 0 0">
        在支付宝开放平台 → 控制台 → 创建应用（网页/移动应用）→ 签约「手机网站支付」或「电脑网站支付」，
        然后把 APPID、应用私钥、支付宝公钥填到 app/.env。缺少的部分会列在上面。
      </p>
      ${
        ali.ready
          ? `<div class="row-actions" style="margin-top:12px">
               <button class="btn" id="payCheckBtn">测试支付宝连通性</button>
               <span class="muted" style="font-size:12px">真实调用支付宝接口，确认哪些能力已生效</span>
             </div>
             <div id="payCheckBox"></div>`
          : ''
      }
    </div>

    <div class="card">
      <h3>微信支付</h3>
      <div class="cfg-row"><span>商户号</span><b>${p.mchid || '未配置'}</b></div>
      <div class="cfg-row"><span>下单场景</span><b>${p.scene === 'auto' ? '自动适配（微信内/浏览器/扫码）' : p.scene || '未配置'}</b></div>
      <div class="cfg-row"><span>回调地址</span><b style="font-size:12px">${p.notifyUrl || '未配置'}</b></div>
      ${p.wechatReady
        ? '<div class="check-item" style="margin-top:10px">✅ 微信支付凭据已配齐</div>'
        : wxMissing.length
        ? wxMissing
            .map(
              (m) =>
                `<div class="check-item" style="margin-top:10px"><span style="color:var(--bad)">✗</span><b>${m.key}</b><span class="muted">${m.desc}</span></div>`
            )
            .join('') + '<p class="muted" style="font-size:12.5px;margin-top:10px">在商户平台 → 账户中心 → API安全 获取。</p>'
        : ''}
    </div>`;

  const btn = $('#payCheckBtn');
  if (btn) btn.onclick = runPayCheck;
}

/** 支付宝连通性自检：真实调用接口，报告每项能力是否可用 */
async function runPayCheck() {
  const btn = $('#payCheckBtn');
  const box = $('#payCheckBox');
  if (!btn || !box) return;
  btn.disabled = true;
  btn.textContent = '检测中…';
  box.innerHTML = '';
  try {
    const r = await api('/api/admin/pay-check', { method: 'POST' });
    const a = r.alipay || {};
    const row = (label, item, okText, failText) => {
      const ok = item && item.ok;
      return `<div class="check-item" style="margin-top:10px">
        <span style="color:${ok ? 'var(--ok, #18a058)' : 'var(--bad)'}">${ok ? '✓' : '✗'}</span>
        <b>${label}</b>
        <span class="muted">${ok ? okText : `${failText}${item && item.code ? '（' + item.code + '）' : ''}`}</span>
      </div>`;
    };
    box.innerHTML = `
      <div style="margin-top:12px">
        ${row('基础接口（查单）', a.query, '正常', '异常')}
        ${row('手机网站支付（wap.pay）', a.wap, '收银台可打开，可跳转付款', '未签约或未生效')}
        ${row('当面付扫码（precreate）', a.qr, '二维码下单正常，可用于扫码收款', '不可用')}
        <p class="muted" style="font-size:12.5px;margin:12px 0 0">
          手机网站支付未生效时，前端「支付宝扫码」渠道仍可正常收款（用户在支付宝里扫码付款）。
          如需跳转式付款，请到开放平台 → 产品绑定 → 手机网站支付 → 确认签约状态为「已生效」。
        </p>
      </div>`;
  } catch (e) {
    box.innerHTML = `<div class="check-item" style="margin-top:12px"><span style="color:var(--bad)">✗</span><b>检测失败</b><span class="muted">${esc(e.message)}</span></div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '测试支付宝连通性';
  }
}

/* ---------------- 启动 ---------------- */

if (state.token) load();
else renderLogin();
