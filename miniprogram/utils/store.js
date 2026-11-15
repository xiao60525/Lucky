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
    order_not_found: '订单不存在或不属于当前账号',
    order_not_cancellable: '订单状态已变化，刷新后重试',
    order_not_payable: '订单状态已变化，刷新后重试',
    already_checked_in: '今天已经签到过啦，明天再来',
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
        .select('id, title, description, amount, tag, sort, image')
        .order('sort', { ascending: true });

    if (error) {
        return { data: [], error };
    }
    const list = (data || []).map((row) => ({
        id: row.id,
        title: row.title,
        description: row.description || '',
        tag: row.tag || '',
        image: row.image || '',
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
        .select('id, title, description, amount, tag, image')
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
            image: data.image || '',
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

/**
 * 发起支付前取支付参数（支付单号 / 金额 / 商品）。
 * 同一订单重复调用复用同一支付单号，并累加 pay_attempts。
 */
async function preparePayment(id) {
    const { data, error } = await cloud.database.rpc('app_prepare_payment', { p_order_id: id });
    if (error) return { data: null, error: { message: readable(error, '支付单初始化失败') } };
    if (!data) return { data: null, error: { message: '支付单初始化失败' } };
    return {
        data: {
            orderId: data.orderId,
            outTradeNo: data.outTradeNo,
            amount: Number(data.amount || 0),
            productId: data.productId,
            title: data.title,
            qty: Number(data.qty || 1),
            attempts: Number(data.attempts || 0),
        },
        error: null,
    };
}

/**
 * 支付成功落库：校验支付单号一致后置为已支付，并按金额返积分（同单幂等）。
 * 真实支付接入后，这一步应在服务端回调里做权威校验。
 */
async function markPaidOrder(id, outTradeNo, channel) {
    const { data, error } = await cloud.database.rpc('app_mark_paid_order', {
        p_order_id: id,
        p_out_trade_no: outTradeNo,
        p_channel: channel || 'xpay',
    });
    if (error) return { data: null, error: { message: readable(error, '支付结果记录失败') } };
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

/* ===================== 积分签到 ===================== */

const POINTS_KIND_TEXT = {
    checkin: '每日签到',
    order: '订单返积分',
};

function decorateLedger(row) {
    return {
        points: Number(row.points || 0),
        pointsText: (Number(row.points || 0) > 0 ? '+' : '') + Number(row.points || 0),
        kind: row.kind || '',
        kindText: POINTS_KIND_TEXT[row.kind] || row.kind || '积分变动',
        note: row.note || '',
        createdText: formatTime(row.created_at),
    };
}

/** 签到状态：余额 / 今天是否已签 / 连续天数 */
async function checkinStatus() {
    const { data, error } = await cloud.database.rpc('app_checkin_status');
    if (error) return { data: null, error: { message: readable(error, '积分读取失败') } };
    if (!data) return { data: null, error: { message: '积分读取失败' } };
    return {
        data: {
            balance: Number(data.balance || 0),
            checkedToday: data.checkedToday === true,
            streak: Number(data.streak || 0),
            todayPoints: Number(data.todayPoints || 0),
        },
        error: null,
    };
}

/** 今日签到：成功返回最新状态，重复签抛 already_checked_in */
async function checkin() {
    const { data, error } = await cloud.database.rpc('app_checkin');
    if (error) return { data: null, error: { message: readable(error, '签到失败，请稍后重试') } };
    if (!data) return { data: null, error: { message: '签到失败，请稍后重试' } };
    return {
        data: {
            balance: Number(data.balance || 0),
            checkedToday: data.checkedToday === true,
            streak: Number(data.streak || 0),
            todayPoints: Number(data.todayPoints || 0),
        },
        error: null,
    };
}

/** 积分明细：最近 50 条流水 */
async function pointsHistory() {
    const { data, error } = await cloud.database.rpc('app_points_history');
    if (error) return { data: [], error: { message: readable(error, '积分明细读取失败') } };
    return { data: (data || []).map(decorateLedger), error: null };
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
    preparePayment,
    markPaidOrder,
    orderStats,
    checkinStatus,
    checkin,
    pointsHistory,
    saveMyProfile,
    maskPhone,
    fenToYuan,
    ORDER_STATUS_TEXT,
};
