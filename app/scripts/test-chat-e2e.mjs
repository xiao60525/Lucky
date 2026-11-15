/**
 * 在线客服端到端验证
 * 用户发消息 → 后台看到会话（含未读）→ 后台回复 → 用户收到并清未读
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import crypto from 'node:crypto';

const PORT = 3973;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

let cookie = '';
let adminToken = '';

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (adminToken) headers['x-admin-token'] = adminToken;
  const res = await fetch(BASE + path, { ...opts, headers });
  const setc = res.headers.get('set-cookie');
  if (setc) cookie = setc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? '✔' : '✘') + ' ' + msg);
  if (!cond) failed++;
};

// 管理员令牌：用 .env 里的签名密钥直接签（后台可能改过密码，密码登录在脚本里不可靠）
function envOf(key) {
  try {
    const txt = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const m = txt.match(new RegExp('^' + key + '=(.*)$', 'm'));
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function adminTokenOf() {
  const key = envOf('ADMIN_TOKEN_SECRET') || envOf('PAY_SECRET') || envOf('ADMIN_PASSWORD') || 'admin-dev-token';
  const exp = Date.now() + 3600 * 1000;
  const sig = crypto.createHmac('sha256', key).update('admin|' + exp).digest('base64url');
  return exp.toString(36) + '.' + sig;
}

try {
  for (let i = 0; i < 40; i++) {
    try {
      await api('/api/health');
      break;
    } catch {
      await sleep(500);
    }
  }

  const phone = '138' + String(Date.now()).slice(-8);
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone, password: 'test123456', nickname: '客服测试' }),
  });
  const uid = (reg.body.viewer && reg.body.viewer.id) || '';
  ok(reg.status === 201 && !!uid, `注册测试用户 ${phone}（${uid}）`);

  // 未登录不能发消息
  const anonCookie = cookie;
  cookie = '';
  const anonSend = await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ text: '未登录试试' }) });
  ok(anonSend.status === 401, '未登录发送被拒绝');
  const anonThread = await api('/api/chat/thread');
  ok(anonThread.status === 401, '未登录读会话被拒绝');
  cookie = anonCookie;

  let t = await api('/api/chat/thread');
  ok(t.status === 200 && Array.isArray(t.body.messages) && t.body.messages.length === 0, '新用户会话为空');

  const empty = await api('/api/chat/send', { method: 'POST', body: JSON.stringify({ text: '   ' }) });
  ok(empty.status === 400, '空消息被拒绝');

  const s1 = await api('/api/chat/send', {
    method: 'POST',
    body: JSON.stringify({ text: '你好，这个有现货吗？今天下单能发吗' }),
  });
  ok(s1.status === 200 && s1.body.message && s1.body.message.role === 'user', '用户发送消息成功');

  t = await api('/api/chat/thread');
  ok(t.status === 200 && t.body.messages.length === 1, '会话里能看到自己的消息');

  // 后台令牌
  adminToken = adminTokenOf();
  const threads = await api('/api/admin/chat/threads');
  ok(threads.status === 200, '管理令牌可访问后台客服接口');
  const mine = (threads.body.threads || []).find((x) => x.userId === uid);
  ok(threads.status === 200 && !!mine, '后台会话列表出现该用户');
  ok(mine && mine.adminUnread === 1, `后台未读计数 = 1（实际 ${mine && mine.adminUnread}）`);
  ok(mine && mine.nickname === '客服测试', '会话带用户昵称');
  ok((threads.body.pending || 0) >= 1, '待回复总数 >= 1（导航角标用）');

  const msgs = await api('/api/admin/chat/messages?user=' + encodeURIComponent(uid));
  ok(msgs.status === 200 && (msgs.body.messages || []).length === 1, '后台能读到用户消息');
  ok(msgs.body.buyer && msgs.body.buyer.phone === phone, '后台能看到用户手机号');

  const threads2 = await api('/api/admin/chat/threads');
  const mine2 = (threads2.body.threads || []).find((x) => x.userId === uid);
  ok(mine2 && mine2.adminUnread === 0, '读过后后台未读清零');

  const reply = await api('/api/admin/chat/reply', {
    method: 'POST',
    body: JSON.stringify({ user: uid, text: '有现货，今天下单明天一早就发' }),
  });
  ok(reply.status === 200 && reply.body.message && reply.body.message.role === 'admin', '后台回复成功');

  const unread = await api('/api/chat/unread');
  ok(unread.status === 200 && unread.body.unread === 1, `用户未读数 = 1（实际 ${unread.body.unread}）`);

  t = await api('/api/chat/thread');
  ok(t.status === 200 && t.body.messages.length === 2, '用户能看到商家的回复');
  ok(t.body.messages[1] && t.body.messages[1].role === 'admin', '第二条是商家身份');

  const unread2 = await api('/api/chat/unread');
  ok(unread2.body.unread === 0, '用户读过后未读清零');

  // 用户不能冒充商家
  const forge = await api('/api/chat/send', {
    method: 'POST',
    body: JSON.stringify({ text: '我是商家', role: 'admin' }),
  });
  ok(forge.status === 200 && forge.body.message.role === 'user', '用户伪造 admin 身份被忽略（仍是 user）');

  // 后台接口不能被普通用户调用
  const savedToken = adminToken;
  adminToken = '';
  const noAuth = await api('/api/admin/chat/threads');
  ok(noAuth.status === 401, '无管理令牌访问后台会话被拒绝');
  adminToken = savedToken;

  console.log(failed ? `结果：${failed} 项失败` : '结果：全部通过');
  console.log('清理 SQL（后续执行）：');
  console.log(`DELETE FROM chat_messages WHERE user_id = '${uid}';`);
  console.log(`DELETE FROM chat_threads WHERE user_id = '${uid}';`);
  console.log(`DELETE FROM app_users WHERE id = '${uid}';`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('测试执行失败:', e);
  process.exitCode = 1;
} finally {
  server.kill();
}
