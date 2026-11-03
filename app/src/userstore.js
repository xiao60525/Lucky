'use strict';
/**
 * 用户体系（网页版 / PWA）
 * ---------------------------------------------------------------
 * 手机号 + 密码登录。密码用 scrypt 加盐哈希，只存哈希；
 * 会话令牌为 HMAC 签名的无状态 token（默认 30 天），放在 Authorization: Bearer。
 *
 * 数据全部走云库 SECURITY DEFINER 函数（app_user_*），浏览器无直接读写权限。
 *
 * 配置（.env）：
 *   USER_TOKEN_SECRET  会话签名密钥，不填则复用 CLOUD_DB_SECRET
 */

const crypto = require('crypto');
const { createWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk');
const { channelName } = require('./payments');

const endpoint = process.env.CLOUD_ENDPOINT;
const publishableKey = process.env.CLOUD_PUBLISHABLE_KEY;
const oauthRelayBaseUrl = process.env.CLOUD_OAUTH_RELAY;
const secret = process.env.CLOUD_DB_SECRET;
const tokenSecret = process.env.USER_TOKEN_SECRET || process.env.CLOUD_DB_SECRET || 'dev-only-secret';

const enabled = Boolean(endpoint && publishableKey && secret);

let client = null;
function getClient() {
  if (!enabled) throw new Error('云服务未配置：缺少 CLOUD_ENDPOINT / CLOUD_PUBLISHABLE_KEY / CLOUD_DB_SECRET');
  if (!client) client = createWorkBuddyCloud({ endpoint, oauthRelayBaseUrl, publishableKey });
  return client;
}

async function call(fn, params, action) {
  const res = await getClient().database.rpc(fn, params);
  if (res && res.error) {
    const err = new Error(`云数据库${action}失败：${res.error.message || res.error.code || '未知错误'}`);
    err.code = res.error.code;
    throw err;
  }
  return res.data;
}

/* ---------------------------- 密码哈希 ---------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, N, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expect = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(password, salt, expect.length, { N: Number(N), r: Number(r), p: Number(p) });
    return got.length === expect.length && crypto.timingSafeEqual(got, expect);
  } catch (e) {
    return false;
  }
}

/* ---------------------------- 会话令牌 ---------------------------- */

const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

function signToken(userId) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${userId}|${exp}`;
  const sig = crypto.createHmac('sha256', tokenSecret).update('user|' + payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

/** 校验令牌，返回 userId；无效返回 null */
function readToken(token) {
  try {
    const raw = String(token || '').replace(/^Bearer\s+/i, '').trim();
    const dot = raw.lastIndexOf('.');
    if (dot < 1) return null;
    const payload = Buffer.from(raw.slice(0, dot), 'base64url').toString('utf8');
    const userId = payload.split('|')[0];
    const exp = Number(payload.split('|')[1]);
    if (!userId || !exp || exp < Date.now()) return null;
    const expect = crypto.createHmac('sha256', tokenSecret).update('user|' + payload).digest('base64url');
    const got = raw.slice(dot + 1);
    if (got.length !== expect.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expect))) return null;
    return userId;
  } catch (e) {
    return null;
  }
}

/* ---------------------------- 数据访问 ---------------------------- */

function normalizeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    phone: row.phone,
    nickname: row.nickname || '用户',
    points: row.points || 0,
    coupons: Array.isArray(row.coupons) ? row.coupons : [],
    address: row.address && typeof row.address === 'object' ? row.address : {},
    avatar: row.avatar || null,
    memberLevel: row.member_level || null,
    memberExpire: row.member_expire ? new Date(row.member_expire).getTime() : null,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).getTime() : null,
  };
}

/** 会员是否有效（到期时间晚于当前） */
function isMember(profile) {
  return Boolean(profile && profile.memberLevel && profile.memberExpire && profile.memberExpire > Date.now());
}

/** 注册：手机号唯一，返回 {profile, token} */
async function register({ phone, password, nickname }) {
  const existing = await call('app_user_auth', { p_secret: secret, p_phone: phone }, '查询');
  if (existing) {
    const err = new Error('该手机号已注册，请直接登录');
    err.code = 'PHONE_EXISTS';
    throw err;
  }
  const id = 'u_' + crypto.randomBytes(9).toString('hex');
  const hash = hashPassword(password);
  const now = Date.now();
  const coupons = [
    { id: 'c_new_' + id.slice(2), title: '新人立减 5 元', amount: 500, expiresAt: now + 30 * 86400000 },
    { id: 'c_new2_' + id.slice(2), title: '满 20 减 3 元', amount: 300, expiresAt: now + 30 * 86400000 },
  ];
  const row = await call(
    'app_user_register',
    {
      p_secret: secret,
      p_id: id,
      p_phone: phone,
      p_nickname: nickname || '用户' + phone.slice(-4),
      p_hash: hash,
      p_coupons: coupons,
    },
    '注册'
  );
  return { profile: normalizeProfile(row), token: signToken(id) };
}

/** 登录：校验密码 */
async function login({ phone, password }) {
  const row = await call('app_user_auth', { p_secret: secret, p_phone: phone }, '登录');
  if (!row) {
    const err = new Error('手机号未注册');
    err.code = 'NO_USER';
    throw err;
  }
  if (!verifyPassword(password, row.password_hash)) {
    const err = new Error('密码不正确');
    err.code = 'BAD_PASSWORD';
    throw err;
  }
  const profile = normalizeProfile(row);
  profile.lastLoginAt = Date.now();
  return { profile, token: signToken(row.id) };
}

/** 读取用户完整信息：资料 + 余额 + 本人订单 */
/** 订单行归一化：云库返回 snake_case，前端统一用 camelCase + 渠道展示名 */
function normalizeOrder(row) {
  if (!row || typeof row !== 'object') return row;
  const amount = Number(row.amount) || 0;
  return {
    id: row.id,
    productId: row.product_id || row.productId || null,
    title: row.title || '',
    amount,
    amountText: (amount / 100).toFixed(2),
    channel: row.channel || null,
    channelName: channelName(row.channel),
    status: row.status,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : null,
    paidAt: row.paid_at ? new Date(row.paid_at).getTime() : null,
    refundedAt: row.refunded_at ? new Date(row.refunded_at).getTime() : null,
    transactionId: row.transaction_id || null,
  };
}

async function getUser(userId) {
  const data = await call('app_user_get', { p_secret: secret, p_id: userId }, '读取');
  if (!data) return null;
  return {
    profile: normalizeProfile(data.profile),
    balance: data.balance || 0,
    orders: Array.isArray(data.orders) ? data.orders.map(normalizeOrder) : [],
  };
}

/** 开通/续费会员：p_days 为购买商品配置的天数，返回新的到期时间戳（ms），失败返回 null */
async function grantMember(userId, days) {
  const data = await call('app_user_grant_member', { p_secret: secret, p_id: userId, p_days: Number(days) }, '开通会员');
  return data ? new Date(data).getTime() : null;
}

/** 后台取消会员：清空等级与到期时间 */
async function revokeMember(userId) {
  await call('app_user_revoke_member', { p_secret: secret, p_id: userId }, '取消会员');
  return true;
}

/** 改资料（昵称 / 收货地址） */
async function updateProfile(userId, patch) {
  const row = await call('app_user_update', { p_secret: secret, p_id: userId, p_patch: patch }, '保存');
  return normalizeProfile(row);
}

/** 读取用户余额（分）。注册用户在 accounts 表必有行，无行视为 0 */
async function getUserBalance(userId) {
  const data = await call('app_user_balance_get', { p_secret: secret, p_id: userId }, '读取余额');
  return Number(data) || 0;
}

/** 原子加减用户余额（分为单位，delta 可负）。余额不足时抛 INSUFFICIENT_BALANCE */
async function adjustUserBalance(userId, delta) {
  try {
    const data = await call(
      'app_user_balance_add',
      { p_secret: secret, p_id: userId, p_delta: Number(delta) },
      '更新余额'
    );
    return Number(data) || 0;
  } catch (e) {
    if (String(e.message || '').includes('insufficient_balance')) {
      const err = new Error('余额不足');
      err.code = 'INSUFFICIENT_BALANCE';
      throw err;
    }
    throw e;
  }
}

/** 改密码：先验旧密码 */
async function changePassword(userId, oldPassword, newPassword) {
  const data = await call('app_user_get', { p_secret: secret, p_id: userId }, '读取');
  const row = await call('app_user_auth', { p_secret: secret, p_phone: data.profile.phone }, '校验');
  if (!row || !verifyPassword(oldPassword, row.password_hash)) {
    const err = new Error('原密码不正确');
    err.code = 'BAD_PASSWORD';
    throw err;
  }
  await call(
    'app_user_set_password',
    { p_secret: secret, p_id: userId, p_hash: hashPassword(newPassword) },
    '修改密码'
  );
  return true;
}

/** 后台：网页版注册用户列表 */
async function listUsers() {
  const data = await call('app_user_list', { p_secret: secret }, '查询');
  return Array.isArray(data) ? data : [];
}

module.exports = {
  enabled,
  register,
  login,
  getUser,
  getUserBalance,
  adjustUserBalance,
  grantMember,
  revokeMember,
  isMember,
  updateProfile,
  changePassword,
  listUsers,
  signToken,
  readToken,
  hashPassword,
  verifyPassword,
};
