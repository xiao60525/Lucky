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

/** 规格行：price 为 0 表示跟随商品价；stock 为 null 表示该规格不限量 */
function skuRow(k) {
  if (!k) return null;
  return {
    id: String(k.id || ''),
    name: String(k.name || ''),
    price: Math.max(0, Number(k.price) || 0),
    stock: k.stock === null || k.stock === undefined ? null : Math.max(0, Number(k.stock) || 0),
    sort: Number(k.sort) || 0,
    active: k.active !== false,
  };
}

function skuRows(list) {
  return (Array.isArray(list) ? list : []).map(skuRow).filter(Boolean);
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
    items: Array.isArray(row.items) ? row.items : [],
    // 下单时快照的收货信息（充值/内容单为 NULL）
    shipping: row.shipping && typeof row.shipping === 'object' ? row.shipping : null,
    shipCompany: row.ship_company || '',
    shipNo: row.ship_no || '',
    shippedAt: toMs(row.shipped_at),
    receivedAt: toMs(row.received_at),
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
      stock: p.stock === null || p.stock === undefined ? null : Math.max(0, Number(p.stock) || 0),
      skus: skuRows(p.skus),
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
        // 购物车订单：明细一起落库；单件订单传空数组
        items: Array.isArray(order.items) ? order.items : [],
        // 收货信息快照（仅商品单有；不传则落 NULL）
        shipping: order.shipping && typeof order.shipping === 'object' ? order.shipping : null,
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
  // 物流发货：后台填快递公司 + 运单号（shippedAt 传毫秒时间戳）
  if (order.shipCompany !== undefined) patch.ship_company = order.shipCompany;
  if (order.shipNo !== undefined) patch.ship_no = order.shipNo;
  if (order.shippedAt) patch.shipped_at = order.shippedAt;
  // 确认收货：receivedAt 传毫秒时间戳
  if (order.receivedAt) patch.received_at = order.receivedAt;

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
    // null = 不限量；数字 = 总库存（可用量 = stock - 已支付销量）
    stock: p.stock === null || p.stock === undefined ? null : Math.max(0, Number(p.stock) || 0),
    skus: skuRows(p.skus),
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
  // 传了 stock 才写库存列：null = 设为不限量，数字 = 指定库存
  if (p.stock !== undefined) product.stock = p.stock === null ? null : Math.max(0, Math.floor(Number(p.stock)) || 0);
  const row = await call(
    'app_admin_upsert_product',
    { p_secret: secret, p_product: product },
    '保存商品'
  );
  return row ? productRow(row) : null;
}

/** 只改库存（商品列表里快捷编辑用） */
async function adminSetStock(id, stock) {
  const row = await call(
    'app_admin_set_stock',
    { p_secret: secret, p_id: id, p_stock: stock === null ? null : Math.max(0, Math.floor(Number(stock)) || 0) },
    '修改库存'
  );
  return row ? productRow(row) : null;
}

/** 整组覆盖某商品的规格（空数组 = 回到单规格） */
async function adminSetSkus(productId, skus) {
  const payload = (Array.isArray(skus) ? skus : []).map((k) => ({
    id: k.id ? String(k.id).slice(0, 64) : '',
    name: String(k.name || '').slice(0, 30),
    price: Math.max(0, Math.floor(Number(k.price) || 0)),
    stock: k.stock === null || k.stock === undefined || String(k.stock).trim() === ''
      ? null
      : Math.max(0, Math.floor(Number(k.stock)) || 0),
    sort: Math.floor(Number(k.sort) || 0),
    active: k.active !== false,
  }));
  const rows = await call(
    'app_admin_set_skus',
    { p_secret: secret, p_product_id: productId, p_skus: payload },
    '保存规格'
  );
  return skuRows(rows);
}

/**
 * 批量操作商品
 * action: active | inactive | amount_set | amount_delta | amount_percent | stock_set | sort_set | delete
 */
async function adminBatchProducts(ids, action, value = null) {
  const r = await call(
    'app_admin_batch_products',
    {
      p_secret: secret,
      p_ids: (Array.isArray(ids) ? ids : []).map(String),
      p_action: String(action || ''),
      p_value: value === null || value === undefined ? null : Math.floor(Number(value)),
    },
    '批量操作商品'
  );
  return Number((r && r.affected) || 0);
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
    views: Math.max(0, Number(row.views) || 0),
    category: row.category || '',
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
        category: String(c.category || '').trim().slice(0, 12),
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

/* ---------------- 内容运营：阅读量 / 收藏 ---------------- */

/** 阅读 +1，返回最新阅读数 */
async function bumpContentView(contentId) {
  const r = await call('app_content_view', { p_secret: secret, p_content: String(contentId || '') }, '记录阅读');
  return Number((r && r.views) || 0) || 0;
}

/** 收藏 / 取消收藏，返回切换后的状态 */
async function toggleContentFavorite(userId, contentId) {
  const r = await call(
    'app_content_fav_toggle',
    { p_secret: secret, p_user: String(userId), p_content: String(contentId) },
    '收藏内容'
  );
  return Boolean(r && r.favorited);
}

/** 某用户收藏的内容 id（收藏时间倒序） */
async function contentFavorites(userId) {
  if (!userId) return [];
  const rows = await call('app_content_favorites', { p_secret: secret, p_user: String(userId) }, '读取收藏');
  return Array.isArray(rows) ? rows.map(String) : [];
}

/** 后台：{contentId: 收藏人数} */
async function adminContentFavCounts() {
  const map = await call('app_admin_content_fav_counts', { p_secret: secret }, '读取收藏统计');
  return map && typeof map === 'object' ? map : {};
}

/* ---------------- 用户反馈 ---------------- */

function feedbackRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id || '',
    content: row.content || '',
    contact: row.contact || '',
    status: row.status === 'done' ? 'done' : 'pending',
    reply: row.reply || '',
    createdAt: toMs(row.created_at),
    repliedAt: toMs(row.replied_at),
  };
}

async function addFeedback(userId, content, contact) {
  const row = await call(
    'app_feedback_add',
    { p_secret: secret, p_user: String(userId || ''), p_content: String(content || ''), p_contact: String(contact || '') },
    '提交反馈'
  );
  return feedbackRow(row);
}

async function myFeedbacks(userId) {
  if (!userId) return [];
  const rows = await call('app_feedback_mine', { p_secret: secret, p_user: String(userId) }, '读取我的反馈');
  return (Array.isArray(rows) ? rows : []).map(feedbackRow).filter(Boolean);
}

async function adminFeedbackList() {
  const rows = await call('app_admin_feedback_list', { p_secret: secret }, '读取反馈');
  return (Array.isArray(rows) ? rows : []).map(feedbackRow).filter(Boolean);
}

async function adminFeedbackReply(id, reply) {
  const row = await call(
    'app_admin_feedback_reply',
    { p_secret: secret, p_id: String(id), p_reply: String(reply || '') },
    '回复反馈'
  );
  return feedbackRow(row);
}

async function adminFeedbackDelete(id) {
  const r = await call('app_admin_feedback_delete', { p_secret: secret, p_id: String(id) }, '删除反馈');
  return Number(r && r.removed) || 0;
}

/* ---------------- 后台操作日志 ---------------- */

async function adminLogAdd(actor, action, detail) {
  try {
    await call(
      'app_admin_log_add',
      {
        p_secret: secret,
        p_actor: String(actor || ''),
        p_action: String(action || ''),
        p_detail: String(detail || ''),
      },
      '写操作日志'
    );
    return true;
  } catch (e) {
    // 日志写失败不能影响主流程
    console.warn('[log] 写入操作日志失败：' + e.message);
    return false;
  }
}

async function adminLogList(limit = 150) {
  const rows = await call(
    'app_admin_log_list',
    { p_secret: secret, p_limit: Math.max(1, Math.floor(Number(limit) || 150)) },
    '读取操作日志'
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id,
    actor: r.actor || '',
    action: r.action || '',
    detail: r.detail || '',
    createdAt: toMs(r.created_at),
  }));
}

async function adminLogClear() {
  const r = await call('app_admin_log_clear', { p_secret: secret }, '清理操作日志');
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

/** 后台：封禁 / 解封用户 */
async function adminSetUserBan(userId, banned, reason = '') {
  return call(
    'app_admin_user_ban',
    { p_secret: secret, p_id: userId, p_banned: Boolean(banned), p_reason: String(reason || '') },
    '封禁用户'
  );
}

/** 后台：延长未支付订单的支付时限（把 created_at 推到 now） */
async function adminExtendOrder(orderId) {
  return call('app_admin_order_extend', { p_secret: secret, p_id: orderId, p_minutes: 30 }, '延长支付');
}

/* ---------------- 评价 ---------------- */

function reviewRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    orderId: r.orderId || r.order_id || '',
    userId: r.userId || r.user_id || '',
    productId: r.productId || r.product_id || '',
    rating: Number(r.rating) || 0,
    content: r.content || '',
    hidden: r.hidden === true,
    hiddenReason: r.hiddenReason || r.hidden_reason || '',
    handler: r.handler || '',
    createdAt: toMs(r.createdAt || r.created_at),
    orderTitle: r.orderTitle || r.order_title || '',
    productTitle: r.productTitle || r.product_title || '',
    nickname: r.nickname || '',
    phone: r.phone || '',
  };
}

/** 用户提交评价（同一订单同一商品重复评价返回 duplicated=true） */
async function addReview({ userId, orderId, productId, rating, content }) {
  const row = await call(
    'app_add_review',
    {
      p_secret: secret,
      p_review: {
        user_id: String(userId || ''),
        order_id: String(orderId || ''),
        product_id: String(productId || ''),
        rating: Math.max(1, Math.min(5, Math.floor(Number(rating) || 0))),
        content: String(content || ''),
      },
    },
    '提交评价'
  );
  const out = reviewRow(row);
  if (out && row && row.duplicated) out.duplicated = true;
  return out;
}

/** 某商品的可见评价（游客可看） */
async function listReviews(productId, limit = 10, offset = 0) {
  const rows = await call(
    'app_list_reviews',
    {
      p_secret: secret,
      p_product_id: String(productId || ''),
      p_limit: Math.max(1, Math.floor(Number(limit) || 10)),
      p_offset: Math.max(0, Math.floor(Number(offset) || 0)),
    },
    '读取评价'
  );
  return (Array.isArray(rows) ? rows : []).map(reviewRow).filter(Boolean);
}

/** 全站评分统计：[{productId, avg, count}] */
async function reviewsStats() {
  const rows = await call('app_reviews_stats', { p_secret: secret }, '读取评分统计');
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    productId: r.productId,
    avg: Number(r.avg) || 0,
    count: Number(r.count) || 0,
  }));
}

/** 我的评价（含被隐藏的） */
async function myReviews(userId, limit = 50) {
  const rows = await call(
    'app_my_reviews',
    { p_secret: secret, p_user: String(userId || ''), p_limit: Math.max(1, Math.floor(Number(limit) || 50)) },
    '读取我的评价'
  );
  return (Array.isArray(rows) ? rows : []).map(reviewRow).filter(Boolean);
}

/** 后台：全部评价 */
async function adminReviewList(limit = 200) {
  const rows = await call(
    'app_admin_review_list',
    { p_secret: secret, p_limit: Math.max(1, Math.floor(Number(limit) || 200)) },
    '读取评价'
  );
  return (Array.isArray(rows) ? rows : []).map(reviewRow).filter(Boolean);
}

/** 后台：隐藏 / 恢复评价 */
async function adminReviewHide(id, hidden, reason, actor) {
  const row = await call(
    'app_admin_review_hide',
    {
      p_secret: secret,
      p_id: String(id || ''),
      p_hidden: Boolean(hidden),
      p_reason: String(reason || ''),
      p_actor: String(actor || ''),
    },
    '处理评价'
  );
  return reviewRow(row);
}

/** 健康检查：确认云端连通、密钥有效 */async function ping() {
  const state = await getState();
  return { ok: true, orders: state.orders.length, balance: state.account ? state.account.balance : null };
}

/* ---------------- 退款 / 退货申请 ---------------- */

function refundRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    orderId: r.orderId || r.order_id || '',
    userId: r.userId || r.user_id || '',
    amount: Number(r.amount) || 0,
    reason: r.reason || '',
    detail: r.detail || '',
    status: r.status || 'pending',
    adminNote: r.adminNote || r.admin_note || '',
    handler: r.handler || '',
    createdAt: toMs(r.createdAt || r.created_at),
    handledAt: toMs(r.handledAt || r.handled_at),
    orderTitle: r.orderTitle || r.order_title || '',
    channel: r.channel || '',
    orderStatus: r.orderStatus || r.order_status || '',
    nickname: r.nickname || '',
    phone: r.phone || '',
  };
}

/** 用户提交退款申请（同一订单已有待审核申请时返回原申请，duplicated=true） */
async function applyRefund(userId, orderId, reason, detail) {
  const row = await call(
    'app_refund_apply',
    {
      p_secret: secret,
      p_user: String(userId || ''),
      p_order: String(orderId || ''),
      p_reason: String(reason || ''),
      p_detail: String(detail || ''),
    },
    '提交退款申请'
  );
  const out = refundRow(row);
  if (out && row && row.duplicated) out.duplicated = true;
  return out;
}

/** 用户自己的退款申请列表 */
async function myRefunds(userId, limit = 30) {
  const rows = await call(
    'app_refund_mine',
    { p_secret: secret, p_user: String(userId || ''), p_limit: Math.max(1, Math.floor(Number(limit) || 30)) },
    '读取退款申请'
  );
  return (Array.isArray(rows) ? rows : []).map(refundRow).filter(Boolean);
}

/** 用户撤销待审核申请 */
async function cancelRefund(userId, id) {
  const r = await call(
    'app_refund_cancel',
    { p_secret: secret, p_user: String(userId || ''), p_id: String(id || '') },
    '撤销退款申请'
  );
  return Number(r && r.cancelled) || 0;
}

/** 后台：全部退款申请 */
async function adminRefundList(limit = 200) {
  const rows = await call(
    'app_admin_refund_list',
    { p_secret: secret, p_limit: Math.max(1, Math.floor(Number(limit) || 200)) },
    '读取退款申请'
  );
  return (Array.isArray(rows) ? rows : []).map(refundRow).filter(Boolean);
}

/** 后台：审核通过 / 拒绝 */
async function adminRefundMark(id, status, note, actor) {
  const row = await call(
    'app_admin_refund_mark',
    {
      p_secret: secret,
      p_id: String(id || ''),
      p_status: String(status || ''),
      p_note: String(note || ''),
      p_actor: String(actor || ''),
    },
    '审核退款申请'
  );
  return refundRow(row);
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

/* ---------------- 小游戏排行榜 ---------------- */

/** 提交游戏成绩（云库只保留每人最高分），返回 { best, rank } */
async function gameScoreSubmit(userId, score) {
  return call(
    'app_game_score_submit',
    { p_secret: secret, p_user: userId, p_score: Math.floor(Number(score) || 0) },
    '提交游戏成绩'
  );
}

/** 排行榜前 N 名 [{ nickname, score }] */
async function gameScoresTop(limit = 20) {
  return call('app_game_scores_top', { p_secret: secret, p_limit: Math.floor(Number(limit) || 20) }, '读取排行榜');
}

/* ---------------- 在线客服 ---------------- */

function chatMsgRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    userId: String(row.user_id || ''),
    role: row.role === 'admin' ? 'admin' : 'user',
    body: String(row.body || ''),
    createdAt: toMs(row.created_at),
  };
}

function chatThreadRow(row) {
  if (!row) return null;
  return {
    userId: String(row.user_id || ''),
    nickname: String(row.nickname || ''),
    lastBody: String(row.last_body || ''),
    lastRole: row.last_role === 'admin' ? 'admin' : 'user',
    lastAt: toMs(row.last_at),
    userUnread: Math.max(0, Number(row.user_unread) || 0),
    adminUnread: Math.max(0, Number(row.admin_unread) || 0),
  };
}

/** 发消息，role: 'user' | 'admin' */
async function chatSend(userId, role, body) {
  const r = await call(
    'app_chat_send',
    {
      p_secret: secret,
      p_user: String(userId || ''),
      p_role: role === 'admin' ? 'admin' : 'user',
      p_body: String(body || ''),
    },
    '发送消息'
  );
  return chatMsgRow(r && r.message);
}

/** 用户取自己的会话（顺带清掉用户未读） */
async function chatThread(userId) {
  if (!userId) return { thread: null, messages: [] };
  const r = await call('app_chat_thread', { p_secret: secret, p_user: String(userId) }, '读取会话');
  return {
    thread: chatThreadRow(r && r.thread),
    messages: (Array.isArray(r && r.messages) ? r.messages : []).map(chatMsgRow).filter(Boolean),
  };
}

/** 用户未读条数（首页红点） */
async function chatUnread(userId) {
  if (!userId) return 0;
  const r = await call('app_chat_unread', { p_secret: secret, p_user: String(userId) }, '读取未读消息');
  return Math.max(0, Number(r && r.unread) || 0);
}

/** 后台：全部会话（按最后消息倒序） */
async function adminChatThreads() {
  const rows = await call('app_admin_chat_threads', { p_secret: secret }, '读取客服会话');
  return (Array.isArray(rows) ? rows : []).map(chatThreadRow).filter(Boolean);
}

/** 后台：某个用户的对话（顺带清掉后台未读） */
async function adminChatMsgs(userId) {
  const r = await call(
    'app_admin_chat_msgs',
    { p_secret: secret, p_user: String(userId || '') },
    '读取客服对话'
  );
  return {
    thread: chatThreadRow(r && r.thread),
    messages: (Array.isArray(r && r.messages) ? r.messages : []).map(chatMsgRow).filter(Boolean),
  };
}

/* ---------------- 好友与私聊 ---------------- */

function friendReqRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    otherId: String(row.otherId || row.other_id || ''),
    nickname: String(row.nickname || ''),
    avatar: row.avatar || null,
    createdAt: toMs(row.createdAt || row.created_at),
  };
}

function friendRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    nickname: String(row.nickname || ''),
    avatar: row.avatar || null,
    lastBody: String(row.lastBody || ''),
    lastFrom: String(row.lastFrom || ''),
    lastAt: toMs(row.lastAt),
    unread: Math.max(0, Number(row.unread) || 0),
    friendSince: toMs(row.friendSince),
  };
}

function dmMsgRow(row) {
  if (!row) return null;
  return {
    id: String(row.id || ''),
    fromUser: String(row.from_user || ''),
    toUser: String(row.to_user || ''),
    body: String(row.body || ''),
    kind: String(row.kind || 'text'),
    payload: row.payload && typeof row.payload === 'object' ? row.payload : null,
    createdAt: toMs(row.created_at),
  };
}

/** 搜人：手机号精确 / 昵称模糊 */
async function friendSearch(userId, q) {
  const rows = await call(
    'app_friend_search',
    { p_secret: secret, p_user: String(userId || ''), p_q: String(q || '') },
    '搜索用户'
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: String(r.id || ''),
    nickname: String(r.nickname || ''),
    avatar: r.avatar || null,
    phoneMasked: String(r.phoneMasked || ''),
    relation: String(r.relation || 'none'),
  }));
}

/** 发起加好友（对方已申请时直接互相加为好友） */
async function friendRequest(userId, toUserId) {
  return call(
    'app_friend_request',
    { p_secret: secret, p_from: String(userId || ''), p_to: String(toUserId || '') },
    '发送好友申请'
  );
}

/** 我收到的与发出的待处理申请 */
async function friendRequests(userId) {
  const r = await call('app_friend_requests', { p_secret: secret, p_user: String(userId || '') }, '读取好友申请');
  return {
    incoming: (Array.isArray(r && r.incoming) ? r.incoming : []).map(friendReqRow).filter(Boolean),
    outgoing: (Array.isArray(r && r.outgoing) ? r.outgoing : []).map(friendReqRow).filter(Boolean),
  };
}

/** 同意 / 拒绝好友申请 */
async function friendRespond(userId, requestId, accept) {
  return call(
    'app_friend_respond',
    {
      p_secret: secret,
      p_user: String(userId || ''),
      p_id: String(requestId || ''),
      p_accept: Boolean(accept),
    },
    accept ? '同意好友申请' : '拒绝好友申请'
  );
}

/** 好友列表 + 总未读 + 待处理申请数 */
async function friendList(userId) {
  const r = await call('app_friend_list', { p_secret: secret, p_user: String(userId || '') }, '读取好友列表');
  return {
    friends: (Array.isArray(r && r.friends) ? r.friends : []).map(friendRow).filter(Boolean),
    unread: Math.max(0, Number(r && r.unread) || 0),
    pending: Math.max(0, Number(r && r.pending) || 0),
  };
}

/** 发私聊消息（必须是好友）：kind = text | image | product | transfer */
async function dmSend(userId, toUserId, body, kind, payload) {
  const r = await call(
    'app_dm_send',
    {
      p_secret: secret,
      p_from: String(userId || ''),
      p_to: String(toUserId || ''),
      p_body: String(body || ''),
      p_kind: String(kind || 'text'),
      p_payload: payload || null,
    },
    '发送消息'
  );
  return dmMsgRow(r && r.message);
}

/** 读和某个好友的对话（顺带清未读）；after 传 ISO 时间表示只要这之后的新消息 */
async function dmThread(userId, otherId, after) {
  const params = {
    p_secret: secret,
    p_user: String(userId || ''),
    p_other: String(otherId || ''),
  };
  if (after) params.p_after = String(after);
  const r = await call('app_dm_thread', params, '读取聊天记录');
  const f = (r && r.friend) || {};
  return {
    friend: {
      id: String(f.id || otherId || ''),
      nickname: String(f.nickname || ''),
      avatar: f.avatar || null,
    },
    messages: (Array.isArray(r && r.messages) ? r.messages : []).map(dmMsgRow).filter(Boolean),
    // 转账卡片状态补丁：增量拉取时老消息不会重发，用它同步「已收款 / 已退还 / 已撤销」
    transfers: (Array.isArray(r && r.transfers) ? r.transfers : [])
      .map((x) => ({
        id: String((x && x.id) || ''),
        payload: x && x.payload && typeof x.payload === 'object' ? x.payload : null,
      }))
      .filter((x) => x.id),
    clearedAt: toMs(r && r.clearedAt) || null,
  };
}

/** 清空与某个好友的聊天记录（只清自己这边） */
async function dmClear(userId, otherId) {
  return call(
    'app_dm_clear',
    { p_secret: secret, p_user: String(userId || ''), p_other: String(otherId || '') },
    '清空聊天记录'
  );
}

/** 好友间转账（站内余额，单位分）：只扣款冻结，等对方领取才入账 */
async function dmTransfer(userId, toUserId, amountFen, note) {
  const r = await call(
    'app_dm_transfer',
    {
      p_secret: secret,
      p_from: String(userId || ''),
      p_to: String(toUserId || ''),
      p_amount: Math.round(Number(amountFen) || 0),
      p_note: String(note || ''),
    },
    '转账'
  );
  const t = (r && r.transfer) || {};
  return {
    message: dmMsgRow(r && r.message),
    transfer: {
      id: String(t.id || ''),
      status: String(t.status || 'pending'),
      amount: Number(t.amount) || 0,
      note: String(t.note || ''),
      fromUser: String(t.fromUser || ''),
      toUser: String(t.toUser || ''),
      messageId: String(t.messageId || ''),
    },
    balance: Number((r && r.balance) || 0),
  };
}

/** 收款 / 退还 / 撤销：action = accept | reject | cancel */
async function dmTransferAct(userId, transferId, action) {
  const r = await call(
    'app_dm_transfer_act',
    {
      p_secret: secret,
      p_user: String(userId || ''),
      p_tid: String(transferId || ''),
      p_action: String(action || ''),
    },
    '处理转账'
  );
  return {
    status: String((r && r.status) || ''),
    transferId: String((r && r.tid) || ''),
    messageId: String((r && r.messageId) || ''),
    balance: Number((r && r.balance) || 0),
  };
}

/** 待收款（收到的）+ 待领取（我发出的） */
async function dmTransferPending(userId) {
  const r = await call(
    'app_dm_transfer_pending',
    { p_secret: secret, p_user: String(userId || '') },
    '读取待收款转账'
  );
  const map = (row) => {
    const x = row || {};
    const c = x.createdAt ? new Date(x.createdAt).getTime() : 0;
    return {
      id: String(x.id || ''),
      direction: String(x.direction || 'in'),
      amount: Number(x.amount) || 0,
      note: String(x.note || ''),
      status: String(x.status || 'pending'),
      createdAt: Number.isFinite(c) ? c : 0,
      fromUser: String(x.fromUser || ''),
      toUser: String(x.toUser || ''),
      messageId: String(x.messageId || ''),
      nickname: String(x.nickname || '好友'),
      avatar: x.avatar || null,
    };
  };
  return {
    incoming: (Array.isArray(r && r.incoming) ? r.incoming : []).map(map).filter((x) => x.id),
    outgoing: (Array.isArray(r && r.outgoing) ? r.outgoing : []).map(map).filter((x) => x.id),
    incomingCount: Math.max(0, Number(r && r.incomingCount) || 0),
    incomingAmount: Math.max(0, Number(r && r.incomingAmount) || 0),
  };
}

/** 私聊未读 + 好友申请待处理数 + 待收款转账数 */
async function dmUnread(userId) {
  const r = await call('app_dm_unread', { p_secret: secret, p_user: String(userId || '') }, '读取未读消息');
  return {
    unread: Math.max(0, Number(r && r.unread) || 0),
    pending: Math.max(0, Number(r && r.pending) || 0),
    transferIn: Math.max(0, Number(r && r.transferIn) || 0),
  };
}

/** 删除好友 */
async function friendRemove(userId, otherId) {
  return call(
    'app_friend_remove',
    { p_secret: secret, p_user: String(userId || ''), p_other: String(otherId || '') },
    '删除好友'
  );
}

/* ---------------- 收货地址（多地址簿） ---------------- */

/** 地址列表（默认地址排第一；老用户首次调用会把旧单地址迁成一条） */
async function addrList(userId) {
  const r = await call('app_addr_list', { p_secret: secret, p_user: String(userId || '') }, '读取收货地址');
  return addrPayload(r);
}

/** 新增 / 编辑地址：id 传空即新增 */
async function addrSave(userId, addr) {
  const a = addr || {};
  const r = await call(
    'app_addr_save',
    {
      p_secret: secret,
      p_user: String(userId || ''),
      p_id: String(a.id || ''),
      p_name: String(a.name || ''),
      p_phone: String(a.phone || ''),
      p_region: String(a.region || ''),
      p_detail: String(a.detail || ''),
      p_tag: String(a.tag || ''),
      p_default: Boolean(a.isDefault),
    },
    '保存收货地址'
  );
  return addrPayload(r);
}

/** 删除地址（删掉默认的会自动把最近一条提为默认） */
async function addrDelete(userId, id) {
  const r = await call(
    'app_addr_delete',
    { p_secret: secret, p_user: String(userId || ''), p_id: String(id || '') },
    '删除收货地址'
  );
  return addrPayload(r);
}

/** 设为默认地址 */
async function addrDefault(userId, id) {
  const r = await call(
    'app_addr_default',
    { p_secret: secret, p_user: String(userId || ''), p_id: String(id || '') },
    '设置默认地址'
  );
  return addrPayload(r);
}

/** 地址返回结构统一成 { addresses, focusId } */
function addrPayload(r) {
  const list = Array.isArray(r && r.addresses) ? r.addresses : [];
  return {
    addresses: list.map((a) => ({
      id: String((a && a.id) || ''),
      name: String((a && a.name) || ''),
      phone: String((a && a.phone) || ''),
      phoneMasked: String((a && a.phoneMasked) || ''),
      region: String((a && a.region) || ''),
      detail: String((a && a.detail) || ''),
      tag: String((a && a.tag) || ''),
      isDefault: Boolean(a && a.isDefault),
      updatedAt: Number((a && a.updatedAt) || 0),
    })),
    focusId: String((r && r.focusId) || ''),
  };
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
  adminSetStock,
  adminSetSkus,
  adminBatchProducts,
  listContents,
  adminListContents,
  adminUpsertContent,
  adminDeleteContent,
  contentUnlocks,
  unlockContent,
  revokeContentUnlock,
  adminContentUnlockCounts,
  bumpContentView,
  toggleContentFavorite,
  contentFavorites,
  adminContentFavCounts,
  addFeedback,
  myFeedbacks,
  adminFeedbackList,
  adminFeedbackReply,
  adminFeedbackDelete,
  adminLogAdd,
  adminLogList,
  adminLogClear,
  gameScoreSubmit,
  gameScoresTop,
  chatSend,
  chatThread,
  chatUnread,
  adminChatThreads,
  adminChatMsgs,
  friendSearch,
  friendRequest,
  friendRequests,
  friendRespond,
  friendList,
  dmSend,
  dmThread,
  dmClear,
  dmTransfer,
  dmTransferAct,
  dmTransferPending,
  dmUnread,
  friendRemove,
  addrList,
  addrSave,
  addrDelete,
  addrDefault,
  applyRefund,
  myRefunds,
  cancelRefund,
  adminRefundList,
  adminRefundMark,
  getAdminCredentials,
  setAdminCredentials,
  purgeStaleOrders,
  adminSetUserBan,
  adminExtendOrder,
  addReview,
  listReviews,
  reviewsStats,
  myReviews,
  adminReviewList,
  adminReviewHide,
};
