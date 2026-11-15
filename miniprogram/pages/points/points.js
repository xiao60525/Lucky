const { checkinStatus, checkin, pointsHistory } = require('../../utils/store');
const { applyNavTitle } = require('../../utils/brand');

Page({
    data: {
        loading: true,
        error: '',
        balanceText: '0',
        todayPoints: 50,
        streak: 0,
        checkedToday: false,
        checking: false,
        historyLoading: true,
        history: [],
    },

    onLoad() {
        applyNavTitle(this);
    },

    onShow() {
        this.load();
    },

    async load() {
        this.setData({ loading: true, error: '' });
        const { data: session, error } = await getApp().ensureSession();
        if (error || !session) {
            getApp().resetSession();
            this.setData({ loading: false, error: '请先在「我的」页登录后再来签到' });
            return;
        }
        const status = await checkinStatus();
        if (status.error) {
            this.setData({ loading: false, error: status.error.message });
            return;
        }
        this.setData({
            loading: false,
            balanceText: String(status.data.balance),
            todayPoints: status.data.todayPoints,
            streak: status.data.streak,
            checkedToday: status.data.checkedToday,
        });
        this.loadHistory();
    },

    async loadHistory() {
        this.setData({ historyLoading: true });
        const { data, error } = await pointsHistory();
        this.setData({
            historyLoading: false,
            history: error ? [] : data,
        });
    },

    async onCheckin() {
        if (this.data.checking || this.data.checkedToday) return;
        this.setData({ checking: true });
        const { data, error } = await checkin();
        if (error) {
            this.setData({ checking: false });
            wx.showToast({ title: error.message || '签到失败', icon: 'none' });
            return;
        }
        wx.showToast({ title: '签到成功', icon: 'success' });
        this.setData({
            checking: false,
            balanceText: String(data.balance),
            todayPoints: data.todayPoints,
            streak: data.streak,
            checkedToday: data.checkedToday,
        });
        this.loadHistory();
    },

    onRetry() {
        this.load();
    },

    async onPullDownRefresh() {
        await this.load();
        wx.stopPullDownRefresh();
    },
});
