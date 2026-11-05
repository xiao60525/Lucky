'use strict';
/**
 * 用户资料（前端「编辑资料」）端到端自测
 * ---------------------------------------------------------------
 * 覆盖：更新昵称 + 个性签名 → viewer 立即返回新值且落库 →
 *       换绑手机号（密码错被拒 / 号被占用被拒 / 正确换绑成功）→
 *       用新手机号登录、旧手机号登不上 → 长度与格式校验
 *
 * 运行：node scripts/test-profile.mjs
 * 说明：会真实写测试用户到云库，脚本结束打印清理 SQL。
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3996;
const BASE = `http://localhost:${PORT}`;

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`✔ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    fail++;
    console.log(`✘ ${name}${extra ? ' — ' + extra : ''}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const srv = spawn(process.execPath, ['server.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), PAY_PROVIDER: 'mock' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => (srvLog += d));
srv.stderr.on('data', (d) => (srvLog += d));

async function waitReady() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) {
        const b = await fetch(`${BASE}/api/bootstrap`);
        if (b.status === 200) return true;
      }
    } catch {
      /* retry */
    }
    await sleep(250);
  }
  return false;
}

let token = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-user-token': token } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

const tail = String(Date.now()).slice(-4);
const PHONE = '1991000' + tail;
const PHONE2 = '1992000' + tail;
const PWD = 'pf7k2m91';

(async () => {
  if (!(await waitReady())) {
    console.error('服务未启动：\n' + srvLog.slice(-1500));
    srv.kill();
    process.exit(1);
  }

  // 1. 注册
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE, password: PWD, nickname: '资料测试' }),
  });
  token = (reg.data && reg.data.token) || '';
  ok('测试用户注册成功', Boolean(token), PHONE);
  if (!token) {
    srv.kill();
    process.exit(1);
  }
  ok('注册后昵称正确', reg.data.viewer && reg.data.viewer.nickname === '资料测试');
  ok('新用户签名为空', reg.data.viewer && reg.data.viewer.bio === '', JSON.stringify((reg.data.viewer || {}).bio));

  // 2. 更新昵称 + 签名
  const up = await api('/api/auth/profile', {
    method: 'POST',
    body: JSON.stringify({ nickname: '小石头', bio: '热爱支付与内容运营' }),
  });
  ok('资料更新接口成功', up.status === 200 && Boolean(up.data && up.data.viewer), `${up.status}`);
  const v1 = (up.data && up.data.viewer) || {};
  ok('昵称已更新', v1.nickname === '小石头', v1.nickname);
  ok('个性签名已更新', v1.bio === '热爱支付与内容运营', v1.bio);

  // 3. 重新拉 /api/auth/me 确认落库
  const me = await api('/api/auth/me');
  const v2 = (me.data && (me.data.viewer || me.data)) || {};
  ok('重新读取仍是新昵称', v2.nickname === '小石头', v2.nickname);
  ok('重新读取仍是新签名', v2.bio === '热爱支付与内容运营', v2.bio);

  // 4. 签名可以清空；超长被截断到 40 字
  const longBio = '很'.repeat(60);
  const up2 = await api('/api/auth/profile', { method: 'POST', body: JSON.stringify({ bio: longBio }) });
  const bio2 = (up2.data && up2.data.viewer && up2.data.viewer.bio) || '';
  ok('超长签名被截断到 40 字', bio2.length === 40, String(bio2.length));
  const up3 = await api('/api/auth/profile', { method: 'POST', body: JSON.stringify({ bio: '' }) });
  ok('签名可以清空', up3.status === 200 && (up3.data.viewer || {}).bio === '');

  // 5. 空昵称被拒绝
  const badNick = await api('/api/auth/profile', { method: 'POST', body: JSON.stringify({ nickname: '   ' }) });
  ok('空昵称被拒绝', badNick.status === 400, badNick.data && badNick.data.message);

  // 6. 换绑手机号：密码错
  const wrongPwd = await api('/api/auth/phone', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE2, password: 'wrongpwd' }),
  });
  ok('密码错误不能换绑', wrongPwd.status === 400, wrongPwd.data && wrongPwd.data.message);

  // 7. 换绑手机号：格式错
  const badPhone = await api('/api/auth/phone', {
    method: 'POST',
    body: JSON.stringify({ phone: '12345', password: PWD }),
  });
  ok('手机号格式错误被拒绝', badPhone.status === 400, badPhone.data && badPhone.data.message);

  // 8. 换绑手机号：正确
  const phoneOk = await api('/api/auth/phone', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE2, password: PWD }),
  });
  ok('换绑手机号成功', phoneOk.status === 200 && Boolean(phoneOk.data && phoneOk.data.viewer), `${phoneOk.status}`);
  const v3 = (phoneOk.data && phoneOk.data.viewer) || {};
  ok('返回值里手机号已变（脱敏后前 3 位 + 后 4 位）', String(v3.phoneMasked || '').endsWith(PHONE2.slice(-4)), v3.phoneMasked);

  // 9. 新号能登录、旧号不能
  const oldToken = token;
  token = '';
  const loginNew = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone: PHONE2, password: PWD }) });
  ok('新手机号可以登录', loginNew.status === 200 && Boolean(loginNew.data && loginNew.data.token), `${loginNew.status}`);
  const loginOld = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ phone: PHONE, password: PWD }) });
  ok('旧手机号登录不上', loginOld.status === 401 || loginOld.status === 404, `${loginOld.status}`);

  // 10. 手机号被占用：用第三个账号注册同号
  const PHONE3 = '1993000' + tail;
  const reg2 = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE3, password: PWD, nickname: '占位' }),
  });
  const token2 = (reg2.data && reg2.data.token) || '';
  token = token2;
  const taken = await api('/api/auth/phone', { method: 'POST', body: JSON.stringify({ phone: PHONE2, password: PWD }) });
  ok('换成别人已用的号被拒绝', taken.status === 400, taken.data && taken.data.message);
  token = oldToken;

  console.log(`\n结果：${pass}/${pass + fail} 通过`);
  if (fail) console.log('\n最近服务端日志：\n' + srvLog.slice(-1200));
  console.log(
    `\n清理测试数据（云库执行）：\nDELETE FROM accounts WHERE id IN (SELECT id FROM app_users WHERE phone IN ('${PHONE}','${PHONE2}','${PHONE3}'));\nDELETE FROM app_users WHERE phone IN ('${PHONE}','${PHONE2}','${PHONE3}');`
  );
  srv.kill();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试异常:', e);
  srv.kill();
  process.exit(1);
});
