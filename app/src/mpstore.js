'use strict';
/**
 * 小程序云库 · 客户端
 * ---------------------------------------------------------------
 * 管理后台属于网页版应用，小程序用户数据在另一个云环境里（wbapp_yRpS…）。
 * 这里用小程序应用自己的 publishableKey + 服务端密钥，通过 SECURITY DEFINER 函数访问：
 *   · app_admin_list_users    读用户列表（只读）
 *   · app_admin_save_settings 写外观配置（名称 / 图标），小程序端只读这张表
 *
 * 配置（.env）：
 *   MP_CLOUD_ENDPOINT / MP_CLOUD_PUBLISHABLE_KEY / MP_CLOUD_SECRET
 */

const { createWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk');

const endpoint = process.env.MP_CLOUD_ENDPOINT;
const publishableKey = process.env.MP_CLOUD_PUBLISHABLE_KEY;
const secret = process.env.MP_CLOUD_SECRET;

const enabled = Boolean(endpoint && publishableKey && secret);

let client = null;
function getClient() {
  if (!client) {
    client = createWorkBuddyCloud({ endpoint, publishableKey });
  }
  return client;
}

function notConfigured() {
  const err = new Error('小程序云库未配置：缺少 MP_CLOUD_ENDPOINT / MP_CLOUD_PUBLISHABLE_KEY / MP_CLOUD_SECRET');
  err.code = 'MP_NOT_CONFIGURED';
  return err;
}

/**
 * 把外观配置同步到小程序云库（小程序端公开只读）
 * iconAction: 'keep' 保持不变 | 'set' 写入新图标 | 'clear' 清空图标
 */
async function saveBrand({ name, tagline, iconAction, iconData, iconVer }) {
  if (!enabled) throw notConfigured();
  const { data, error } = await getClient().database.rpc('app_admin_save_settings', {
    p_secret: secret,
    p_settings: {
      app_name: name,
      tagline,
      icon_action: iconAction || 'keep',
      icon_data: iconData || null,
      icon_ver: iconVer || null,
    },
  });
  if (error) {
    const err = new Error(error.message || '同步到小程序失败');
    err.code = error.code || 'MP_SAVE_FAILED';
    throw err;
  }
  return data || null;
}

/** 小程序侧登录用户列表（含手机号、订单数与累计支付金额） */
async function listUsers() {
  if (!enabled) throw notConfigured();
  const { data, error } = await getClient().database.rpc('app_admin_list_users', { p_secret: secret });
  if (error) {
    const err = new Error(error.message || '读取小程序用户失败');
    err.code = error.code || 'MP_QUERY_FAILED';
    throw err;
  }
  return Array.isArray(data) ? data : [];
}

/** 连通性自检 */
async function ping() {
  if (!enabled) return { ok: false, reason: 'not_configured' };
  try {
    const users = await listUsers();
    return { ok: true, users: users.length };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

module.exports = { enabled, endpoint, listUsers, saveBrand, ping };
