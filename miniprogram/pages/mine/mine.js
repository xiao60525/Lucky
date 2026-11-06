const { cloud } = require('../../utils/cloud');
const { listMyOrders, saveMyProfile, maskPhone, orderStats } = require('../../utils/store');
const { getBrand, refreshBrand, applyNavTitle } = require('../../utils/brand');

const FILTERS = [
    { key: 'all', label: '全部' },
    { key: 'created', label: '待支付' },
    { key: 'paid', label: '已支付' },
    { key: 'closed', label: '已取消' },
];

Page({
    data: {
        authState: 'checking',
        phoneText: '',
        initial: '?',
        orders: [],
        shownOrders: [],
        stats: { created: 0, paid: 0, closed: 0 },
        filters: FILTERS,
        filter: 'all',
        ordersLoading: false,
        ordersError: '',
        brand: getBrand(),
    },

    onLoad() {
        applyNavTitle(this);
    },

    onShow() {
        this.applyBrand();
        this.restore();
    },

    async applyBrand() {
        applyNavTitle(this);
        try {
            await refreshBrand();
        } catch (e) {
            /* 拉不到就用缓存 */
        }
        applyNavTitle(this);
    },

    async onPullDownRefresh() {
        await this.applyBrand();
        if (this.data.authState === 'signed-in') {
            await this.loadOrders();
        } else {
            await this.restore();
        }
        wx.stopPullDownRefresh();
    },

    async restore() {
        this.setData({ authState: 'checking', ordersError: '' });
        const { data: session, error } = await getApp().ensureSession();
        if (error || !session) {
            getApp().resetSession();
            this.setData({
                authState: 'signed-out',
                orders: [],
                shownOrders: [],
                stats: { created: 0, paid: 0, closed: 0 },
                phoneText: '',
                initial: '?',
            });
            return;
        }
        const user = session.user || {};
        const phone = user.phone || '';
        this.setData({
            authState: 'signed-in',
            phoneText: maskPhone(phone),
            initial: phone ? phone.replace(/[^\d]/g, '').slice(-2) : '我',
        });
        // 补写一次：登录时万一写库失败，进页面还能补上，保证后台能看到这个用户
        if (phone) {
            saveMyProfile(phone);
        }
        this.loadOrders();
    },

    async loadOrders() {
        this.setData({ ordersLoading: true, ordersError: '' });
        const { data, error } = await listMyOrders();
        if (error) {
            this.setData({ ordersLoading: false, ordersError: error.message || '订单加载失败' });
            return;
        }
        this.setData({ ordersLoading: false, orders: data, stats: orderStats(data) });
        this.applyFilter(this.data.filter, data);
    },

    /** 按状态筛选；顺手把当前筛选也纠正一下，避免空页 */
    applyFilter(key, source) {
        const orders = source || this.data.orders;
        const filter = key || 'all';
        this.setData({
            filter,
            shownOrders: filter === 'all' ? orders : orders.filter((o) => o.status === filter),
        });
    },

    onFilter(event) {
        this.applyFilter(event.currentTarget.dataset.key);
    },

    onTapOrder(event) {
        const id = event.currentTarget.dataset.id;
        if (!id) return;
        wx.navigateTo({ url: '/pages/order/order?id=' + encodeURIComponent(id) });
    },

    onSignedIn() {
        getApp().resetSession();
        this.restore();
    },

    async onSignOut() {
        await cloud.auth.signOut();
        getApp().resetSession();
        this.restore();
    },

    onRetryOrders() {
        this.loadOrders();
    },

    onGoShop() {
        wx.switchTab({ url: '/pages/index/index' });
    },
});
