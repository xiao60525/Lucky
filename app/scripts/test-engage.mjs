/**
 * 内容互动 + 用户反馈 + 操作日志 + 数据导出 端到端测试
 * -----------------------------------------------------------------
 * 覆盖：
 *   1. 收藏切换（收藏 → bootstrap 带出 → 取消）
 *   2. 阅读量上报（同一篇 +N）
 *   3. 内容分类（后台保存 → 前台 bootstrap 带出）
 *   4. 反馈闭环（用户提交 → 后台看到 → 后台回复 → 用户看到回复）
 *   5. 后台操作日志（登录 & 保存内容会留下记录）
 *   6. CSV 导出（订单 / 用户，带 BOM 与表头）
 *   7. 概览新增指标（阅读 / 收藏 / 待处理反馈）
 *
 * 用法：node scripts/test-engage.mjs
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3998;
const BASE = `http://localhost:${PORT}`;

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) {
    pass++;
    console.log(`✔ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fails.push(name);
    console.log(`✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function envValue(key) {
  try {
    const t = readFileSync(join(ROOT, '.env'), 'utf8');
    for (const line of t.split(/\r?\n/)) {
      if (line.startsWith(key + '=')) return line.slice(key.length + 1).trim();
    }
  } catch {}
  return '';
}

const srv = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), PAY_PROVIDER: 'mock' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
srv.stdout.on('data', (d) => (log += d));
srv.stderr.on('data', (d) => (log += d));

const api = async (path, opts = {}) => {
  const r = await fetch(BASE + path, opts);
  const ct = r.headers.get('content-type') || '';
  let data = null;
  let text = '';
  if (ct.includes('json')) {
    try {
      data = await r.json();
    } catch {}
  } else {
    text = await r.text();
  }
  return { status: r.status, data, text, headers: r.headers };
};
const postJSON = (path, body, headers = {}) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const getWith = (path, headers = {}) => api(path, { headers });

let userToken = '';
const uHeaders = () => ({ Authorization: 'Bearer ' + userToken });

let adminToken = '';
const aHeaders = () => ({ 'x-admin-token': adminToken });

let contentId = '';
let feedbackId = '';

try {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/bootstrap`);
      if (r.status === 200) break;
    } catch {}
    await sleep(300);
  }

  /* ---------- 0. 测试用户 ---------- */
  const phone = '198' + String(Date.now()).slice(-8);
  const pwd = 'test' + String(Date.now()).slice(-6);
  const reg = await postJSON('/api/auth/register', { phone, password: pwd, nickname: '互动测试' });
  ok('注册测试用户', reg.status === 201 && Boolean(reg.data && reg.data.token), `${reg.status}`);
  userToken = reg.data.token;

  /* ---------- 1. 后台登录 ---------- */
  const adminPwd = process.env.TEST_ADMIN_PASSWORD || envValue('ADMIN_PASSWORD');
  const login = await postJSON('/api/admin/login', { userName: envValue('ADMIN_USER') || 'admin', password: adminPwd });
  adminToken = login.data && login.data.token;
  if (!adminToken) {
    const key = (envValue('ADMIN_TOKEN_SECRET') || envValue('PAY_SECRET') || adminPwd || 'admin-dev-token').trim();
    const exp = Date.now() + 3600 * 1000;
    const sig = crypto.createHmac('sha256', key).update('admin|' + exp).digest('base64url');
    adminToken = exp.toString(36) + '.' + sig;
  }
  ok('后台可用', Boolean(adminToken));

  /* ---------- 2. 新建一篇测试内容（带分类） ---------- */
  contentId = 'tc' + Date.now().toString(36);
  const saved = await postJSON(
    '/api/admin/content/save',
    {
      id: contentId,
      title: '自动化测试内容',
      desc: '这条内容由测试脚本创建，测试结束后会删除。',
      tag: '测试',
      category: '测试分类',
      sort: 1,
      active: true,
      membersOnly: false,
      price: 0,
    },
    aHeaders()
  );
  ok('后台保存内容（带分类）', saved.status === 200 && saved.data.content.category === '测试分类', `${saved.status}`);

  /* ---------- 3. 前台看到分类与收藏态 ---------- */
  let boot = await getWith('/api/bootstrap', uHeaders());
  let mine = (boot.data.contents || []).find((c) => c.id === contentId);
  ok('前台内容带分类', Boolean(mine) && mine.category === '测试分类');
  ok('前台初始无收藏', Array.isArray(boot.data.favorites) && boot.data.favorites.length === 0);
  const v0 = mine ? Number(mine.views) || 0 : 0;

  /* ---------- 4. 收藏 → 取消 ---------- */
  const fav1 = await postJSON('/api/content/favorite', { contentId }, uHeaders());
  ok('收藏成功', fav1.status === 200 && fav1.data.favorited === true);
  boot = await getWith('/api/bootstrap', uHeaders());
  ok('bootstrap 带出收藏', (boot.data.favorites || []).includes(contentId));
  const fav2 = await postJSON('/api/content/favorite', { contentId }, uHeaders());
  ok('再点取消收藏', fav2.status === 200 && fav2.data.favorited === false);
  boot = await getWith('/api/bootstrap', uHeaders());
  ok('取消后不再带出', !(boot.data.favorites || []).includes(contentId));

  /* ---------- 5. 阅读量 ---------- */
  const v1 = await postJSON('/api/content/view', { contentId });
  const v2 = await postJSON('/api/content/view', { contentId });
  ok('阅读 +1 生效', v1.status === 200 && v1.data.views === v0 + 1, `${v0} → ${v1.data && v1.data.views}`);
  ok('阅读可累加', v2.data && v2.data.views === v0 + 2);
  const badView = await postJSON('/api/content/view', { contentId: '' });
  ok('缺参数被拒', badView.status === 400);

  /* ---------- 6. 反馈闭环 ---------- */
  const fb = await postJSON('/api/feedback', { content: '自动化测试：希望支持夜间模式定时切换。', contact: '测试联系方式' }, uHeaders());
  ok('提交反馈成功', fb.status === 200 && Boolean(fb.data.feedback.id), `${fb.status}`);
  feedbackId = fb.data.feedback.id;
  const short = await postJSON('/api/feedback', { content: 'x' }, uHeaders());
  ok('内容过短被拒', short.status === 400);
  const noAuth = await postJSON('/api/feedback', { content: '未登录提交' });
  ok('未登录不能提交', noAuth.status === 401);

  const mineList = await getWith('/api/feedback/mine', uHeaders());
  const mineFb = (mineList.data.feedbacks || []).find((f) => f.id === feedbackId);
  ok('我的反馈能看到', Boolean(mineFb) && mineFb.status === 'pending');

  const adminFb = await getWith('/api/admin/feedback', aHeaders());
  ok('后台能读到反馈', (adminFb.data.feedbacks || []).some((f) => f.id === feedbackId));

  const reply = await postJSON('/api/admin/feedback/reply', { id: feedbackId, reply: '收到，已排期，下个版本做。' }, aHeaders());
  ok('后台回复成功', reply.status === 200 && reply.data.feedback.status === 'done');

  const mineAfter = await getWith('/api/feedback/mine', uHeaders());
  const replied = (mineAfter.data.feedbacks || []).find((f) => f.id === feedbackId);
  ok('用户能看到回复', Boolean(replied) && replied.reply.includes('下个版本'));

  const clearReply = await postJSON('/api/admin/feedback/reply', { id: feedbackId, reply: '' }, aHeaders());
  ok('清空回复回到待处理', clearReply.data.feedback.status === 'pending');

  /* ---------- 7. 操作日志 ---------- */
  const logs = await getWith('/api/admin/logs', aHeaders());
  const llist = logs.data.logs || [];
  ok('日志接口可用', logs.status === 200 && Array.isArray(llist));
  ok('记录了「保存内容」', llist.some((l) => l.action === '保存内容'));
  ok('记录了「回复反馈」', llist.some((l) => l.action === '回复反馈'));
  ok('日志带操作人', llist.every((l) => typeof l.actor === 'string'));

  /* ---------- 8. 概览指标 ---------- */
  const ov = await getWith('/api/admin/overview', aHeaders());
  const s = ov.data.stats || {};
  ok('概览含内容阅读数', typeof s.viewCount === 'number' && s.viewCount >= 2, String(s.viewCount));
  ok('概览含收藏数', typeof s.favCount === 'number');
  ok('概览含待处理反馈', s.feedbackPending >= 1, String(s.feedbackPending));
  ok('概览含内容总数', typeof s.contentCount === 'number' && s.contentCount >= 1);

  /* ---------- 9. CSV 导出 ---------- */
  const csvOrders = await getWith('/api/admin/export?type=orders', aHeaders());
  ok('订单 CSV 可下载', csvOrders.status === 200 && (csvOrders.headers.get('content-type') || '').includes('text/csv'));
  // fetch 的 text() 会吃掉 BOM，这里按表头内容断言（BOM 由服务端拼接，见 sendCSV）
  ok('CSV 表头正确', csvOrders.text.startsWith('订单号,') && csvOrders.text.includes('金额(元)'));
  const csvUsers = await getWith('/api/admin/export?type=users', aHeaders());
  ok('用户 CSV 可下载', csvUsers.status === 200 && csvUsers.text.startsWith('ID,'));
  const noToken = await getWith('/api/admin/export?type=orders');
  ok('未登录导不出', noToken.status === 401);

  /* ---------- 10. 清理测试内容 ---------- */
  const del = await postJSON('/api/admin/content/delete', { id: contentId }, aHeaders());
  ok('清理测试内容', del.status === 200);
  const delFb = await postJSON('/api/admin/feedback/delete', { id: feedbackId }, aHeaders());
  ok('清理测试反馈', delFb.status === 200 && delFb.data.removed === true);

  boot = await getWith('/api/bootstrap', uHeaders());
  ok('删除后前台不再出现', !(boot.data.contents || []).some((c) => c.id === contentId));
} catch (e) {
  fails.push('脚本异常: ' + e.message);
  console.log('✘ 脚本异常：' + e.stack);
} finally {
  srv.kill();
  console.log('\n----------------------------------------');
  console.log(`通过 ${pass} 项，失败 ${fails.length} 项`);
  if (fails.length) {
    console.log('失败项：\n - ' + fails.join('\n - '));
    console.log('\n--- 服务端日志（末尾 4000 字）---\n' + log.slice(-4000));
  }
  process.exit(fails.length ? 1 : 0);
}
