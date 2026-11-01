const { cloud } = require('../../utils/cloud');
const { listMyOrders, saveMyProfile, maskPhone } = require('../../utils/store');
const { getBrand, refreshBrand, applyNavTitle } = require('../../utils/brand');

Page({
    data: {
        authState: 'checking',
        phoneText: '',
        initial: '?',
        orders: [],
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

    async restore() {
        this.setData({ authState: 'checking', ordersError: '' });
        const { data: session, error } = await getApp().ensureSession();
        if (error || !session) {
            getApp().resetSession();
            this.setData({ authState: 'signed-out', orders: [], phoneText: '', initial: '?' });
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
        this.setData({ ordersLoading: false, orders: data });
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
