// 数据层：商品与订单读写。页面只调用这里，不直接拼 SQL/查询。
const { cloud } = require('./cloud');

const ORDER_STATUS_TEXT = {
    created: '待支付',
    paid: '已支付',
    refunded: '已退款',
    closed: '已取消',
};

/** 云函数抛出的错误码 → 给用户看的文案 */
const ERROR_TEXT = {
    unauthorized: '请先登录后再操作',
    product_not_found: '商品不存在或已下架',
    order_not_cancellable: '订单状态已变化，刷新后重试',
    order_not_payable: '订单状态已变化，刷新后重试',
};

function readable(error, fallback) {
    const raw = (error && (error.message || error.error_description)) || '';
    const hit = Object.keys(ERROR_TEXT).find((k) => raw.indexOf(k) >= 0);
    return hit ? ERROR_TEXT[hit] : raw || fallback;
}

function fenToYuan(fen) {
    return (Number(fen || 0) / 100).toFixed(2);
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

const ORDER_FIELDS = 'id, product_id, title, amount, status, created_at, qty, remark, paid_at';

function decorateOrder(row) {
    const qty = Number(row.qty || 1);
    const amount = Number(row.amount || 0);
    return {
        id: row.id,
        productId: row.product_id,
        title: row.title,
        initial: String(row.title || '订').slice(0, 1),
        amount,
        qty,
        remark: row.remark || '',
        amountText: fenToYuan(amount),
        unitText: fenToYuan(Math.round(amount / (qty || 1))),
        status: row.status,
        statusText: ORDER_STATUS_TEXT[row.status] || row.status,
        createdText: formatTime(row.created_at),
        paidText: formatTime(row.paid_at),
        canPay: row.status === 'created',
        canCancel: row.status === 'created',
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
        initial: String(row.title || '商').slice(0, 1),
        amountText: fenToYuan(row.amount),
        amount: row.amount,
    }));
    return { data: list, error: null };
}

/** 单个商品：下单页展示用，金额始终以这里读到的为准 */
async function getProduct(id) {
    const { data, error } = await cloud.database
        .from('products')
        .select('id, title, description, amount, tag')
        .eq('id', id)
        .maybeSingle();

    if (error) return { data: null, error };
    if (!data) return { data: null, error: { message: 'product_not_found' } };
    return {
        data: {
            id: data.id,
            title: data.title,
            description: data.description || '',
            tag: data.tag || '',
            initial: String(data.title || '商').slice(0, 1),
            amount: Number(data.amount || 0),
            amountText: fenToYuan(data.amount),
        },
        error: null,
    };
}

/** 我的订单：RLS 只返回当前登录用户自己的订单 */
async function listMyOrders() {
    const { data, error } = await cloud.database
        .from('orders')
        .select(ORDER_FIELDS)
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        return { data: [], error: { message: readable(error, '订单加载失败') } };
    }
    return { data: (data || []).map(decorateOrder), error: null };
}

/** 单个订单：订单详情页用 */
async function getOrder(id) {
    const { data, error } = await cloud.database
        .from('orders')
        .select(ORDER_FIELDS)
        .eq('id', id)
        .maybeSingle();

    if (error) return { data: null, error: { message: readable(error, '订单读取失败') } };
    if (!data) return { data: null, error: { message: '订单不存在或不属于当前账号' } };
    return { data: decorateOrder(data), error: null };
}

/**
 * 下单：金额、数量、归属都由云库函数算，前端只提交商品和数量，
 * 避免改价 / 伪造 owner_id。
 */
async function placeOrder(productId, qty, remark) {
    const { data, error } = await cloud.database.rpc('app_place_order', {
        p_product_id: productId,
        p_qty: Math.max(1, Math.min(99, Number(qty) || 1)),
        p_remark: String(remark || '').slice(0, 200),
    });

    if (error) return { data: null, error: { message: readable(error, '下单失败，请稍后重试') } };
    if (!data) return { data: null, error: { message: '下单没有成功，请重新登录后再试' } };
    return { data: decorateOrder(data), error: null };
}

/** 取消订单：只能取消自己还没付款的单 */
async function cancelOrder(id) {
    const { data, error } = await cloud.database.rpc('app_cancel_order', { p_order_id: id });
    if (error) return { data: null, error: { message: readable(error, '取消失败，请稍后重试') } };
    return { data: data ? decorateOrder(data) : null, error: null };
}

/**
 * 演示支付：还没接入微信支付时的占位动作，只改订单状态，不发生任何真实扣款。
 * 绑定真实小程序并开通微信支付后，这里换成 wx.requestPayment 即可。
 */
async function demoPay(id) {
    const { data, error } = await cloud.database.rpc('app_demo_pay', { p_order_id: id });
    if (error) return { data: null, error: { message: readable(error, '支付失败，请稍后重试') } };
    return { data: data ? decorateOrder(data) : null, error: null };
}

/** 订单统计：给「我的」页顶部的状态入口用 */
function orderStats(orders) {
    const list = orders || [];
    return {
        created: list.filter((o) => o.status === 'created').length,
        paid: list.filter((o) => o.status === 'paid').length,
        closed: list.filter((o) => o.status === 'closed').length,
    };
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

module.exports = {
    listProducts,
    getProduct,
    listMyOrders,
    getOrder,
    placeOrder,
    cancelOrder,
    demoPay,
    orderStats,
    saveMyProfile,
    maskPhone,
    fenToYuan,
    ORDER_STATUS_TEXT,
};
