// 数据层：商品与订单读写。页面只调用这里，不直接拼 SQL/查询。
const { cloud } = require('./cloud');

const ORDER_STATUS_TEXT = {
    created: '待支付',
    paid: '已支付',
    refunded: '已退款',
    closed: '已关闭',
};

function fenToYuan(fen) {
    return (Number(fen || 0) / 100).toFixed(2);
}

function newOrderId() {
    const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
    return 'O' + Date.now().toString(36).toUpperCase() + rand;
}

function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return (
        date.getFullYear() +
        '-' +
        pad(date.getMonth() + 1) +
        '-' +
        pad(date.getDate()) +
        ' ' +
        pad(date.getHours()) +
        ':' +
        pad(date.getMinutes())
    );
}

function decorateOrder(row) {
    return {
        id: row.id,
        title: row.title,
        amountText: fenToYuan(row.amount),
        status: row.status,
        statusText: ORDER_STATUS_TEXT[row.status] || row.status,
        createdText: formatTime(row.created_at),
    };
}

/** 商品列表：公开可读，无需登录 */
async function listProducts() {
    const { data, error } = await cloud.database
        .from('products')
        .select('id, title, description, amount, tag, sort')
        .order('sort', { ascending: true });

    if (error) {
        return { data: [], error };
    }
    const list = (data || []).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description || '',
        tag: row.tag || '',
        amountText: fenToYuan(row.amount),
        amount: row.amount,
    }));
    return { data: list, error: null };
}

/** 我的订单：RLS 只返回当前登录用户自己的订单 */
async function listMyOrders() {
    const { data, error } = await cloud.database
        .from('orders')
        .select('id, product_id, title, amount, status, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        return { data: [], error };
    }
    return { data: (data || []).map(decorateOrder), error: null };
}

/** 下单：owner_id 由数据库按当前登录身份自动填充，前端不传 */
async function createOrder(product) {
    const { data, error } = await cloud.database
        .from('orders')
        .insert({
            id: newOrderId(),
            product_id: product.id,
            title: product.title,
            amount: product.amount,
            status: 'created',
        })
        .select();

    if (error) {
        return { data: null, error };
    }
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) {
        return { data: null, error: { message: '下单没有成功，请重新登录后再试' } };
    }
    return { data: decorateOrder(rows[0]), error: null };
}

/**
 * 登录成功后把手机号写入 profiles 表（幂等，重复登录只会更新登录时间）。
 * 后台的用户列表读的就是这张表，所以这一步失败意味着后台看不到该用户。
 */
async function saveMyProfile(phone) {
    const value = (phone || '').trim();
    if (!value) {
        return { data: null, error: { message: '缺少手机号' } };
    }
    const { data, error } = await cloud.database.rpc('app_touch_profile', { p_phone: value });
    if (error) {
        return { data: null, error };
    }
    return { data: data || null, error: null };
}

/** 手机号脱敏：13800138000 -> 138****8000，兼容 +86 前缀 */
function maskPhone(phone) {
    const raw = String(phone || '').replace(/[^\d]/g, '');
    if (raw.length < 7) return phone || '已登录';
    const tail = raw.slice(-4);
    const head = raw.length > 11 ? raw.slice(-11, -8) : raw.slice(0, 3);
    return head + '****' + tail;
}

module.exports = { listProducts, listMyOrders, createOrder, saveMyProfile, maskPhone, fenToYuan, ORDER_STATUS_TEXT };
