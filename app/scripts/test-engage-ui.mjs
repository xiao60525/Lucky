/**
 * 后台新页面（反馈 / 日志 / 内容分类与数据列）渲染测试
 * 用 jsdom 加载真实 admin.html + admin.js，stub 接口，不依赖线上登录态。
 *
 * 用法：node scripts/test-engage-ui.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public/admin.html'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'public/admin.js'), 'utf8');

const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/admin?sharecode=TEST' });
const w = dom.window;
const { window } = dom;

let pass = 0;
const fails = [];
function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const now = Date.now();
const feedbacks = [
  {
    id: 'fb_a',
    userId: 'u1',
    content: '希望支持夜间模式定时切换',
    contact: '13800000001',
    status: 'pending',
    reply: '',
    createdAt: now - 3600e3,
    repliedAt: null,
  },
  {
    id: 'fb_b',
    userId: 'u2',
    content: '付款后订单页没刷新',
    contact: '',
    status: 'done',
    reply: '已修复，请更新到最新版',
    createdAt: now - 86400e3,
    repliedAt: now - 7200e3,
  },
];

const logs = [
  { id: 'l1', actor: 'admin', action: '订单退款', detail: 'O123 · ¥12.00 · 会员月卡', createdAt: now - 600e3 },
  { id: 'l2', actor: 'admin', action: '保存内容', detail: '「新闻」 [行业资讯]', createdAt: now - 1200e3 },
];

const contents = [
  {
    id: 'c1',
    title: '新闻',
    desc: '示例内容',
    tag: '',
    category: '行业资讯',
    price: 199,
    views: 12,
    favCount: 3,
    unlockCount: 1,
    sort: 1,
    active: true,
    membersOnly: false,
    image: '',
  },
  {
    id: 'c2',
    title: '使用教程',
    desc: '怎么用',
    tag: '',
    category: '',
    price: 0,
    views: 5,
    favCount: 0,
    unlockCount: 0,
    sort: 2,
    active: true,
    membersOnly: true,
    image: '',
  },
];

let replyBody = null;
let deleteUrl = null;
let cleared = false;

w.fetch = async (url, opts = {}) => {
  const u = String(url);
  const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });
  if (u.includes('/api/admin/overview')) {
    return json({
      stats: {
        orders: 3,
        paidOrders: 2,
        pendingOrders: 1,
        gross: 300,
        refundSum: 0,
        net: 300,
        balance: 0,
        todayOrders: 1,
        todayPaid: 1,
        todayGmv: 100,
        todayNewUsers: 1,
        weekGmv: 300,
        memberCount: 1,
        userCount: 2,
        payRate: 100,
        unlockCount: 1,
        viewCount: 17,
        favCount: 3,
        contentCount: 2,
        feedbackPending: 1,
        feedbackTotal: 2,
        trend: [],
      },
      orders: [],
      orderTtlMinutes: 30,
      products: [],
      contents,
      feedbacks,
      logs,
      site: { name: '测试应用', notice: '', home: {}, hasIcon: false },
      mp: { ready: false },
      pay: { alipay: { ready: false, missing: [] }, wechatReady: false, missing: [], provider: 'mock', cloudReady: true },
    });
  }
  if (u.includes('/api/admin/feedback/reply')) {
    replyBody = JSON.parse(opts.body || '{}');
    const f = feedbacks.find((x) => x.id === replyBody.id);
    if (f) {
      f.reply = replyBody.reply;
      f.status = replyBody.reply ? 'done' : 'pending';
      f.repliedAt = replyBody.reply ? Date.now() : null;
    }
    return json({ feedback: f });
  }
  if (u.includes('/api/admin/feedback/delete')) {
    deleteUrl = u;
    return json({ removed: true });
  }
  if (u.includes('/api/admin/logs/clear')) {
    cleared = true;
    return json({ removed: 3 });
  }
  if (u.includes('/api/admin/users')) return json({ ready: true, users: [] });
  return json({}, 200);
};

w.sessionStorage.setItem('admin_token', 'test-token');
w.eval(js);
await wait(140);

const $ = (sel) => w.document.querySelector(sel);
const all = (sel) => [...w.document.querySelectorAll(sel)];
const nav = (key) =>
  w.document.querySelector(`.nav-btn[data-tab="${key}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

check('后台已登录并渲染侧边栏', Boolean($('.side-nav')));

/* ---------- 概览 ---------- */
check('概览有「内容与反馈」卡片', w.document.body.textContent.includes('累计阅读'));
check('概览显示待处理反馈', w.document.body.textContent.includes('待处理反馈'));
check('侧栏反馈角标显示待处理数', ($('.nav-badge') || {}).textContent === '1', ($('.nav-badge') || {}).textContent);
check(
  '概览可跳到内容页',
  Boolean($('#ovGoContent')) && Boolean($('#ovGoFeedback'))
);

/* ---------- 反馈页 ---------- */
nav('feedback');
await wait(60);
check('反馈页列出 2 条', all('#fbRows .fb-item').length === 2, String(all('#fbRows .fb-item').length));
check('待处理/已回复状态区分', all('.fb-status').some((e) => e.textContent === '待处理') && all('.fb-status.done').length === 1);
check('已回复内容展示回复块', Boolean($('.fb-reply')) && $('.fb-reply').textContent.includes('已修复'));
check('反馈筛选 chip 齐全', all('[data-fbf]').length === 3);
check('每条反馈都有回复输入框', all('#fbRows textarea.fb-text').length === 2);

// 筛选到「待处理」只剩 1 条
all('[data-fbf]').find((b) => b.dataset.fbf === 'pending').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(40);
check('筛选待处理只剩 1 条', all('#fbRows .fb-item').length === 1, String(all('#fbRows .fb-item').length));

// 回填并保存回复
const ta = $('#fbr-fb_a');
ta.value = '收到，已排期';
all('[data-fbreply="fb_a"]')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(120);
check('保存回复调用接口', Boolean(replyBody) && replyBody.id === 'fb_a' && replyBody.reply === '收到，已排期');
// 回复后仍停在「待处理」筛选下：处理完的条目应该移出列表
check('回复后从待处理列表移出', all('#fbRows .fb-item').length === 0, String(all('#fbRows .fb-item').length));
all('[data-fbf]').find((b) => b.dataset.fbf === 'done').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(40);
check('已回复列表有 2 条', all('#fbRows .fb-item').length === 2, String(all('#fbRows .fb-item').length));

/* ---------- 日志页 ---------- */
nav('logs');
await wait(60);
check('日志页有表格', Boolean($('#panel table')));
check('日志行数正确', all('#panel tbody tr').length === 2, String(all('#panel tbody tr').length));
check('日志显示操作名与详情', $('#panel tbody').textContent.includes('订单退款') && $('#panel tbody').textContent.includes('会员月卡'));
check('日志页有清理按钮', Boolean($('#logClear')));

/* ---------- 内容页：分类与数据列 ---------- */
nav('contents');
await wait(60);
check('内容表单有分类输入', Boolean($('#c-category')));
check('分类建议来自已有内容', all('#c-cat-list option').some((o) => o.value === '行业资讯'));
check('内容表有分类列', $('#panel table thead').textContent.includes('分类'));
check('内容表有数据列', $('#panel table thead').textContent.includes('数据'));
check(
  '内容表显示阅读与收藏数',
  $('#panel tbody').textContent.includes('👁 12') && $('#panel tbody').textContent.includes('★ 3'),
  $('#panel tbody').textContent.replace(/\s+/g, ' ').slice(0, 60)
);
check('未分类内容显示占位', $('#panel tbody').textContent.includes('未分类'));

/* ---------- 编辑回填分类 ---------- */
all('[data-cedit="c1"]')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(40);
check('编辑时回填分类', $('#c-category').value === '行业资讯', $('#c-category').value);

console.log('\n----------------------------------------');
console.log(`结果：${pass}/${pass + fails.length} 通过`);
if (fails.length) {
  console.log('失败项：' + fails.join('、'));
  process.exit(1);
}
