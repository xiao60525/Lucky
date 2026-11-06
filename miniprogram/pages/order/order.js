const { getOrder, cancelOrder, demoPay } = require('../../utils/store');

const STATUS_HINT = {
    created: '订单已生成，等待付款',
    paid: '付款已完成，可回到首页继续选购',
    closed: '订单已取消，没有产生任何费用',
    refunded: '这笔订单已退款',
};

Page({
    data: {
        state: 'loading',
        error: '',
        order: null,
        hint: '',
        isNew: false,
        acting: false,
    },

    onLoad(query) {
        this.orderId = (query && query.id) ? decodeURIComponent(query.id) : '';
        this.setData({ isNew: Boolean(query && query.new === '1') });
        this.load();
    },

    async load() {
        if (!this.orderId) {
            this.setData({ state: 'error', error: '没有找到这笔订单' });
            return;
        }
        this.setData({ state: 'loading', error: '' });

        const { data, error } = await getOrder(this.orderId);
        if (error || !data) {
            this.setData({ state: 'error', error: (error && error.message) || '订单读取失败' });
            return;
        }
        wx.setNavigationBarTitle({ title: '订单详情' });
        this.setData({
            state: 'ready',
            order: data,
            hint: STATUS_HINT[data.status] || '',
        });
    },

    onRetry() {
        this.load();
    },

    onCopyId() {
        const id = this.data.order && this.data.order.id;
        if (!id) return;
        wx.setClipboardData({ data: id });
    },

    /** 演示支付：真实微信支付接入前用，只改状态不扣款 */
    onPay() {
        if (this.data.acting) return;
        wx.showModal({
            title: '演示支付',
            content: '目前还没有接入微信支付，这一步只把订单标记为「已支付」，不会真实扣款。',
            confirmText: '确认演示',
            success: (res) => {
                if (res.confirm) this.runPay();
            },
        });
    },

    async runPay() {
        this.setData({ acting: true });
        const { data, error } = await demoPay(this.orderId);
        this.setData({ acting: false });
        if (error || !data) {
            wx.showToast({ title: (error && error.message) || '支付失败', icon: 'none' });
            this.load();
            return;
        }
        this.setData({ order: data, hint: STATUS_HINT[data.status] || '', isNew: false });
        wx.showToast({ title: '已标记为已支付', icon: 'success' });
    },

    onCancel() {
        if (this.data.acting) return;
        wx.showModal({
            title: '取消订单',
            content: '取消后订单不能恢复，需要重新下单。确定取消吗？',
            confirmText: '取消订单',
            confirmColor: '#f05252',
            success: (res) => {
                if (res.confirm) this.runCancel();
            },
        });
    },

    async runCancel() {
        this.setData({ acting: true });
        const { data, error } = await cancelOrder(this.orderId);
        this.setData({ acting: false });
        if (error || !data) {
            wx.showToast({ title: (error && error.message) || '取消失败', icon: 'none' });
            this.load();
            return;
        }
        this.setData({ order: data, hint: STATUS_HINT[data.status] || '', isNew: false });
        wx.showToast({ title: '订单已取消', icon: 'success' });
    },

    onBuyAgain() {
        const order = this.data.order;
        if (!order || !order.productId) return;
        wx.navigateTo({ url: '/pages/detail/detail?productId=' + encodeURIComponent(order.productId) });
    },

    onGoOrders() {
        wx.switchTab({ url: '/pages/mine/mine' });
    },

    onGoShop() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
