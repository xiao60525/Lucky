/**
 * 临时端到端验证：小游戏排行榜（提交成绩 / 最高分保留 / 排行榜列表）
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 3972;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('node', ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));

let cookie = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
  });
  const setc = res.headers.get('set-cookie');
  if (setc) cookie = setc.split(';')[0];
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? '✔' : '✗') + ' ' + msg);
  if (!cond) failed++;
};

try {
  for (let i = 0; i < 40; i++) {
    try { await api('/api/health'); break; } catch { await sleep(500); }
  }
  const phone = '137' + String(Date.now()).slice(-8);
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone, password: 'test123456', nickname: '西瓜高手' }),
  });
  ok(reg.status === 201, `注册测试用户 ${phone}`);

  let s = await api('/api/game/score', { method: 'POST', body: JSON.stringify({ score: 88 }) });
  console.log('SUBMIT1', s.status, JSON.stringify(s.body)); ok(s.status === 200 && s.body.best === 88 && s.body.rank === 1, '首次提交 88 分 → best=88 rank=1');

  s = await api('/api/game/score', { method: 'POST', body: JSON.stringify({ score: 50 }) });
  ok(s.status === 200 && s.body.best === 88, '再提交 50 分 → 保留最高 88');

  s = await api('/api/game/score', { method: 'POST', body: JSON.stringify({ score: 120 }) });
  ok(s.status === 200 && s.body.best === 120, '提交 120 分 → 更新 best=120');

  s = await api('/api/game/score', { method: 'POST', body: JSON.stringify({ score: -5 }) });
  ok(s.status === 400, '非法成绩 -5 被拒绝');

  const lb = await api('/api/game/leaderboard'); console.log('LB', lb.status, JSON.stringify(lb.body).slice(0,300));
  ok(lb.status === 200 && Array.isArray(lb.body.list) && lb.body.list.length >= 1, '排行榜返回列表');
  const me = (lb.body.list || []).find((r) => r.nickname === '西**');
  ok(Boolean(me && me.score === 120), '排行榜含脱敏昵称「西**」且分数为 120');

  // 未登录不能提交
  cookie = '';
  const anon = await api('/api/game/score', { method: 'POST', body: JSON.stringify({ score: 999 }) });
  ok(anon.status === 401, '未登录提交成绩被拒绝');
  const anonLb = await api('/api/game/leaderboard');
  ok(anonLb.status === 200, '未登录可以看排行榜');

  console.log(failed ? `结果：${failed} 项失败` : '结果：全部通过');
  console.log('清理 SQL（后续执行）：');
  console.log(`DELETE FROM game_scores WHERE user_id IN (SELECT id FROM app_users WHERE phone='${phone}');`);
  console.log(`DELETE FROM app_users WHERE phone='${phone}';`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('测试执行失败:', e);
  process.exitCode = 1;
} finally {
  server.kill();
}
