'use strict';
/**
 * 云存储层（WorkBuddy 云服务 · Database）
 * ---------------------------------------------------------------
 * 服务端专用：订单 / 余额全部落在云数据库里，浏览器拿不到写权限。
 *
 * 安全模型：
 *   · orders / accounts / service_secrets 表对客户端完全禁止直连（RLS 默认拒绝 + 不授权 anon）
 *   · 服务端通过 app_* 系列 SECURITY DEFINER 函数读写，函数内校验 CLOUD_DB_SECRET
 *   · publishableKey 可以公开（客户端也用得到），但没有密钥就写不了任何数据
 *
 * 配置（写在 .env，来自 cloud_service activate 返回的 publicConfig）：
 *   CLOUD_ENDPOINT / CLOUD_PUBLISHABLE_KEY / CLOUD_OAUTH_RELAY / CLOUD_DB_SECRET
 */

const { createWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk');

const endpoint = process.env.CLOUD_ENDPOINT;
const publishableKey = process.env.CLOUD_PUBLISHABLE_KEY;
const oauthRelayBaseUrl = process.env.CLOUD_OAUTH_RELAY;
const secret = process.env.CLOUD_DB_SECRET;

const enabled = Boolean(endpoint && publishableKey && secret);

let client = null;
function getClient() {
  if (!enabled) throw new Error('云服务未配置：缺少 CLOUD_ENDPOINT / CLOUD_PUBLISHABLE_KEY / CLOUD_DB_SECRET');
  if (!client) {
    client = createWorkBuddyCloud({ endpoint, oauthRelayBaseUrl, publishableKey });
  }
  return client;
}

/** 统一把 {data,error} 信封转成抛错式 */
function unwrap(res, action) {
  if (res && res.error) {
    const err = new Error(`云数据库${action}失败：${res.error.message || res.error.code || '未知错误'}`);
    err.code = res.error.code;
    throw err;
  }
  return res.data;
}

async function call(fn, params, action) {
  const res = await getClient().database.rpc(fn, params);
  return unwrap(res, action);
}

function toMs(ts) {
  return ts ? new Date(ts).getTime() : null;
}

function fromRow(row) {
  return {
    id: row.id,
    userId: row.user_id || null,
    productId: row.product_id,
    title: row.title,
    amount: row.amount,
    channel: row.channel,
    status: row.status,
    transactionId: row.transaction_id,
    settleSource: row.settle_source,
    createdAt: toMs(row.created_at),
    paidAt: toMs(row.paid_at),
    refundedAt: toMs(row.refunded_at),
    closedAt: toMs(row.closed_at),
  };
}

/** 读取整份应用状态：账户 + 订单 + 商品 */
async function getState() {
  const data = await call('app_get_state', { p_secret: secret }, '读取');
  if (!data) throw new Error('云数据库读取失败：返回为空');
  return {
    account: data.account
      ? { id: data.account.id, nickname: data.account.nickname, balance: data.account.balance }
      : null,
    orders: (data.orders || []).map(fromRow),
    products: (data.products || []).map((p) => ({
      id: p.id,
      title: p.title,
      desc: p.description,
      amount: p.amount,
      tag: p.tag,
      memberDays: Number(p.member_days) || 0,
      memberOnly: p.member_only === true,
      memberPrice: Number(p.member_price) || 0,
      image: p.image || '',
    })),
  };
}

/** 新建订单 */
async function insertOrder(order) {
  const row = await call(
    'app_insert_order_user',
    {
      p_secret: secret,
      p_order: {
        id: order.id,
        user_id: order.userId || null,
        product_id: order.productId,
        title: order.title,
        amount: order.amount,
        channel: order.channel,
        status: order.status,
        created_at_ms: order.createdAt,
      },
    },
    '写入'
  );
  return fromRow(row);
}

/** 更新订单：只传需要改的字段，未传的保持不变 */
async function updateOrder(order) {
  const patch = {};
  if (order.status) patch.status = order.status;
  if (order.channel) patch.channel = order.channel;
  if (order.transactionId) patch.transaction_id = order.transactionId;
  if (order.settleSource) patch.settle_source = order.settleSource;
  if (order.paidAt) patch.paid_at = order.paidAt;
  if (order.refundedAt) patch.refunded_at = order.refundedAt;
  if (order.closedAt) patch.closed_at = order.closedAt;

  const row = await call(
    'app_update_order',
    { p_secret: secret, p_order_id: order.id, p_patch: patch },
    '更新订单'
  );
  if (!row) throw new Error('云数据库更新订单失败：订单不存在');
  return fromRow(row);
}

/** 更新账户（余额） */
async function updateAccount(patch) {
  const data = await call('app_update_account', { p_secret: secret, p_patch: patch }, '更新账户');
  return data ? { id: data.id, nickname: data.nickname, balance: data.balance } : null;
}

/* ---------------- 管理后台专用 ---------------- */

function productRow(p) {
  return {
    id: p.id,
    title: p.title,
    desc: p.description,
    amount: p.amount,
    tag: p.tag,
    sort: p.sort,
    active: p.active,
    memberDays: Number(p.member_days) || 0,
    memberOnly: p.member_only === true,
    memberPrice: Number(p.member_price) || 0,
    image: p.image || '',
  };
}

/** 后台商品列表（含未上架） */
async function adminListProducts() {
  const rows = await call('app_admin_list_products', { p_secret: secret }, '读取商品');
  return (rows || []).map(productRow);
}

/** 新增/更新商品 */
async function adminUpsertProduct(p) {
  const product = {
    id: p.id,
    title: p.title,
    description: p.desc,
    amount: p.amount,
    tag: p.tag,
    sort: p.sort,
    active: p.active,
    memberDays: Number(p.memberDays) || 0,
    memberOnly: Boolean(p.memberOnly),
    memberPrice: Number(p.memberPrice) || 0,
  };
  // 传了 image 才写图片列：不传 = 保留原图，传空串 = 清空
  if (p.image !== undefined && p.image !== null) product.image = p.image;
  const row = await call(
    'app_admin_upsert_product',
    { p_secret: secret, p_product: product },
    '保存商品'
  );
  return row ? productRow(row) : null;
}

/** 删除商品 */
async function adminDeleteProduct(id) {
  const row = await call('app_admin_delete_product', { p_secret: secret, p_id: id }, '删除商品');
  return row ? productRow(row) : null;
}

/* ---------------- 外观配置（名称 / 图标） ---------------- */

function settingsRow(row) {
  if (!row) return null;
  return {
    name: row.app_name || '',
    tagline: row.tagline || '',
    notice: row.notice || '',
    enableRegister: row.enable_register !== false,
    showMock: row.show_mock !== false,
    showBalance: row.show_balance !== false,
    home: row.home && typeof row.home === 'object' ? row.home : {},
    iconMime: row.icon_mime || null,
    iconData: row.icon_data || null,
    iconThumb: row.icon_thumb || null, // 给小程序用的 96px 小图（dataURL）
    iconVer: row.icon_ver || null,
    updatedAt: toMs(row.updated_at),
  };
}

/** 读取应用外观配置（单行） */
async function getSettings() {
  const row = await call('app_get_settings', { p_secret: secret }, '读取外观配置');
  return settingsRow(row);
}

/**
 * 保存外观配置
 * p.iconAction: 'keep' 保持原图标 | 'set' 换成新图标 | 'clear' 恢复默认
 */
async function adminSaveSettings({
  name,
  tagline,
  notice,
  enableRegister,
  showMock,
  showBalance,
  iconAction,
  iconMime,
  iconData,
  iconThumb,
  iconVer,
  home,
}) {
  const row = await call(
    'app_admin_save_settings',
    {
      p_secret: secret,
      p_settings: {
        app_name: name,
        tagline,
        notice,
        enable_register: enableRegister === undefined ? null : String(Boolean(enableRegister)),
        show_mock: showMock === undefined ? null : String(Boolean(showMock)),
        show_balance: showBalance === undefined ? null : String(Boolean(showBalance)),
        // home 不传 = 不改动；传对象 = 整块覆盖
        ...(home === undefined || home === null ? {} : { home }),
        icon_action: iconAction || 'keep',
        icon_mime: iconMime || null,
        icon_data: iconData || null,
        icon_thumb: iconThumb || null,
        icon_ver: iconVer || null,
      },
    },
    '保存外观配置'
  );
  return settingsRow(row);
}

/* ---------------- 首页内容（后台可增删改） ---------------- */

function contentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || '',
    desc: row.description || '',
    tag: row.tag || '',
    image: row.image || null,
    link: row.link || '',
    sort: Number(row.sort) || 100,
    active: row.active !== false,
    membersOnly: row.members_only === true,
    price: Math.max(0, Number(row.price) || 0),
    createdAt: toMs(row.created_at),
  };
}

/** 前台：只取已上线的内容 */
async function listContents() {
  const rows = await call('app_list_contents', { p_secret: secret }, '读取首页内容');
  return (rows || []).map(contentRow);
}

/** 后台：含未上线 */
async function adminListContents() {
  const rows = await call('app_admin_list_contents', { p_secret: secret }, '读取首页内容');
  return (rows || []).map(contentRow);
}

async function adminUpsertContent(c) {
  const row = await call(
    'app_admin_upsert_content',
    {
      p_secret: secret,
      p_content: {
        id: c.id,
        title: c.title,
        description: c.desc || '',
        tag: c.tag || '',
        image: c.image || null,
        link: c.link || '',
        sort: Number(c.sort) || 100,
        active: c.active !== false,
        membersOnly: Boolean(c.membersOnly),
        price: Math.max(0, Math.floor(Number(c.price) || 0)),
      },
    },
    '保存首页内容'
  );
  return contentRow(row);
}

async function adminDeleteContent(id) {
  const row = await call('app_admin_delete_content', { p_secret: secret, p_id: id }, '删除首页内容');
  return contentRow(row);
}

/* ---------------- 内容单篇解锁 ---------------- */

/** 某用户已解锁的内容 id 列表 */
async function contentUnlocks(userId) {
  if (!userId) return [];
  const rows = await call('app_content_unlocks', { p_secret: secret, p_user: String(userId) }, '读取解锁记录');
  return Array.isArray(rows) ? rows.map(String) : [];
}

/** 写入解锁（幂等）：支付成功后调用 */
async function unlockContent(userId, contentId, orderId) {
  const row = await call(
    'app_content_unlock_add',
    {
      p_secret: secret,
      p_user: String(userId),
      p_content: String(contentId),
      p_order: String(orderId || ''),
    },
    '解锁内容'
  );
  return row || null;
}

/** 后台：{contentId: 解锁人数} */
async function adminContentUnlockCounts() {
  const map = await call('app_admin_content_unlock_counts', { p_secret: secret }, '读取解锁统计');
  return map && typeof map === 'object' ? map : {};
}

/** 退款后收回解锁（按订单号，幂等） */
async function revokeContentUnlock(orderId) {
  const r = await call('app_content_unlock_remove', { p_secret: secret, p_order: String(orderId || '') }, '收回解锁');
  return Number(r && r.removed) || 0;
}

/** 删除超时未支付订单（分钟数），返回实际删除条数 */
async function purgeStaleOrders(minutes = 30) {
  const n = await call(
    'app_purge_stale_orders',
    { p_secret: secret, p_minutes: Math.max(1, Math.floor(Number(minutes)) || 30) },
    '清理超时订单'
  );
  return Number(n) || 0;
}

/** 健康检查：确认云端连通、密钥有效 */async function ping() {
  const state = await getState();
  return { ok: true, orders: state.orders.length, balance: state.account ? state.account.balance : null };
}

/* ---------------- 管理员账号密码 ---------------- */

function adminCredRow(row) {
  if (!row) return null;
  return {
    user: row.user_name || '',
    pwdHash: row.pwd_hash || '',
    pwdSalt: row.pwd_salt || '',
    updatedAt: toMs(row.updated_at),
  };
}

/** 读取管理员凭据（null = 还没在后台改过，回退 .env） */
async function getAdminCredentials() {
  const row = await call('app_admin_get_credentials', { p_secret: secret }, '读取管理员账号');
  return adminCredRow(row);
}

/** 保存管理员凭据（账号 + 密码哈希/盐） */
async function setAdminCredentials({ user, pwdHash, pwdSalt }) {
  const row = await call(
    'app_admin_set_credentials',
    { p_secret: secret, p_user: user, p_hash: pwdHash, p_salt: pwdSalt },
    '保存管理员账号'
  );
  return adminCredRow(row);
}

module.exports = {
  enabled,
  endpoint,
  getState,
  insertOrder,
  updateOrder,
  updateAccount,
  getSettings,
  adminSaveSettings,
  ping,
  adminListProducts,
  adminUpsertProduct,
  adminDeleteProduct,
  listContents,
  adminListContents,
  adminUpsertContent,
  adminDeleteContent,
  contentUnlocks,
  unlockContent,
  revokeContentUnlock,
  adminContentUnlockCounts,
  getAdminCredentials,
  setAdminCredentials,
  purgeStaleOrders,
};
