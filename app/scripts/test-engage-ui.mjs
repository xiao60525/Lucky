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

const products = [
  {
    id: 'p1',
    title: '会员月卡',
    desc: '',
    amount: 1000,
    tag: '热卖',
    sort: 1,
    active: true,
    memberDays: 30,
    memberOnly: false,
    memberPrice: 0,
    image: '',
  },
];
const orders = [
  {
    id: 'O20261105001',
    title: '会员月卡',
    amount: 1000,
    amountText: '10.00',
    status: 'paid',
    channel: 'alipay_wap',
    channelName: '支付宝',
    userId: 'u1',
    productId: 'p1',
    buyer: { nickname: '张三', phone: '13800000001' },
    createdAt: now - 3600e3,
    paidAt: now - 3500e3,
    transactionId: 'TRX123',
  },
];
const userList = [
  {
    id: 'u1',
    phone: '13800000001',
    nickname: '张三',
    balance: 500,
    isMember: true,
    memberExpire: now + 20 * 86400e3,
    autoRenew: false,
    source: 'web',
    createdAt: now - 30 * 86400e3,
    lastLoginAt: now - 3600e3,
    orderCount: 1,
    paidAmount: 1000,
    banned: false,
    banReason: '',
  },
];

let replyBody = null;
let deleteUrl = null;
let cleared = false;
let reviewBody = null;
let refunds = [
  {
    id: 'rf_1',
    orderId: 'O20261105001',
    userId: 'u1',
    amount: 1000,
    reason: '商品与描述不符',
    detail: '和图片不一样',
    status: 'pending',
    adminNote: '',
    handler: '',
    createdAt: now - 1800e3,
    handledAt: null,
    orderTitle: '会员月卡',
    channel: 'alipay_wap',
    orderStatus: 'paid',
    nickname: '张三',
    phone: '13800000001',
  },
  {
    id: 'rf_2',
    orderId: 'O20261105002',
    userId: 'u2',
    amount: 1000,
    reason: '不想要了',
    detail: '',
    status: 'pending',
    adminNote: '',
    handler: '',
    createdAt: now - 900e3,
    handledAt: null,
    orderTitle: '会员季卡',
    channel: 'alipay_wap',
    orderStatus: 'paid',
    nickname: '李四',
    phone: '13800000002',
  },
];

w.confirm = () => true;
w.prompt = () => '不符合退款条件';

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
        refundPending: refunds.filter((r) => r.status === 'pending').length,
        refundTotal: refunds.length,
        trend: [],
      },
      orders,
      orderTtlMinutes: 30,
      products,
      contents,
      feedbacks,
      refunds,
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
  if (u.includes('/api/admin/users')) return json({ ready: true, users: userList });
  if (u.includes('/api/admin/refund/review')) {
    reviewBody = JSON.parse(opts.body || '{}');
    const r = refunds.find((x) => x.id === reviewBody.id);
    if (r && reviewBody.action === 'approve') {
      r.status = 'approved';
      r.adminNote = reviewBody.note || '';
      r.handledAt = Date.now();
    } else if (r && reviewBody.action === 'reject') {
      r.status = 'rejected';
      r.adminNote = reviewBody.note || '';
      r.handledAt = Date.now();
    }
    return json({ refund: r || {} });
  }
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
check(
  '侧栏反馈角标显示待处理数',
  (($('.nav-btn[data-tab="feedback"] .nav-badge') || {}).textContent || '') === '1',
  ($('.nav-btn[data-tab="feedback"] .nav-badge') || {}).textContent
);
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

/* ---------- 订单页：日期/渠道筛选、今日退款、分页控件 ---------- */
nav('orders');
await wait(60);
check('订单页有日期筛选', all('[data-od]').length === 4, String(all('[data-od]').length));
check('订单页有渠道筛选', all('[data-oc]').length === 5, String(all('[data-oc]').length));
check('订单统计含今日退款', $('#panel .ostat-row').textContent.includes('今日退款'));
check('订单表格显示 1 条已支付订单', $('#panel tbody').textContent.includes('O20261105001'));
check('订单表格显示操作按钮', Boolean($('[data-refund="O20261105001"]')));
// 渠道筛选到微信：应该没有匹配
all('[data-oc]').find((b) => b.dataset.oc === 'wechat').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(40);
check('按渠道筛选微信后为空', $('#panel').textContent.includes('没有符合条件的订单'));
all('[data-oc]').find((b) => b.dataset.oc === 'alipay').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(40);
check('切回支付宝又能看到订单', $('#panel tbody').textContent.includes('O20261105001'));

/* ---------- 商品页：行内上下架 / 复制 / 销售额 ---------- */
nav('products');
await wait(60);
check('商品行有快捷上下架按钮', Boolean($('[data-ptoggle="p1"]')) && $('[data-ptoggle="p1"]').textContent === '下架');
check('商品行有复制按钮', Boolean($('[data-pcopy="p1"]')));
check('商品显示销售额', $('#panel tbody').textContent.includes('已售 1') && $('#panel tbody').textContent.includes('¥10.00'));
$('[data-pcopy="p1"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(40);
check('复制后表单变为新增且 ID 为空', $('#formTitle').textContent.includes('复制') && $('#f-id').value === '');

/* ---------- 用户页：排序 / 累计消费 / 分页 ---------- */
nav('users');
await wait(80);
check('用户页有排序下拉', Boolean($('#userSort')));
check('用户表有累计消费列', $('#panel thead').textContent.includes('累计消费'));
check('用户行显示累计消费金额', $('#panel tbody').textContent.includes('¥10.00'));
$('#userSort').value = 'paid';
$('#userSort').dispatchEvent(new w.Event('change', { bubbles: true }));
await wait(40);
check('按消费排序后用户仍在列表', $('#panel tbody').textContent.includes('张三'));

/* ---------- 会员页：快捷续期 / 导出 ---------- */
nav('members');
await wait(80);
check('会员页有导出名单按钮', Boolean($('#exportMembers')));
check('会员行有快捷续30天按钮', Boolean($('[data-mquick="u1"]')));
check('会员状态显示剩余天数', $('#panel tbody').textContent.includes('会员 · 剩'), ($('#panel tbody') || { textContent: '' }).textContent.replace(/\s+/g, ' ').slice(0, 80));

/* ---------- 退款审核页 ---------- */
nav('orders');
await wait(60);
check('订单表标记退款待审', $('#panel tbody').textContent.includes('退款待审'));

nav('refunds');
await wait(80);
check('退款页列出待审核申请', all('#panel tbody tr').length === 2, String(all('#panel tbody tr').length));
check('退款页显示申请原因', $('#panel').textContent.includes('商品与描述不符'));
check('退款页有同意/拒绝按钮', Boolean($('[data-rf-ok="rf_1"]')) && Boolean($('[data-rf-no="rf_1"]')));
check('待审核统计正确', $('#panel').textContent.includes('待审核 · ¥20.00'));

$('[data-rf-ok="rf_1"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(180);
check(
  '同意退款调用审核接口',
  Boolean(reviewBody) && reviewBody.action === 'approve' && reviewBody.id === 'rf_1',
  JSON.stringify(reviewBody)
);
check('审核通过后状态变为已通过', ($('#panel').textContent || '').includes('已通过') || refunds[0].status === 'approved');

nav('refunds');
await wait(80);
check('列表默认只看待审核', all('#panel tbody tr').length === 1, String(all('#panel tbody tr').length));
$('[data-rf-no="rf_2"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
await wait(180);
check(
  '拒绝会带上原因提交',
  Boolean(reviewBody) && reviewBody.action === 'reject' && reviewBody.note === '不符合退款条件',
  JSON.stringify(reviewBody)
);
check('拒绝后状态变为已拒绝', refunds[1].status === 'rejected');

console.log('\n----------------------------------------');
console.log(`结果：${pass}/${pass + fails.length} 通过`);
if (fails.length) {
  console.log('失败项：' + fails.join('、'));
  process.exit(1);
}
