const { getBrand, refreshBrand, applyNavTitle } = require('../../utils/brand');

Page({
    data: {
        brand: getBrand(),
        placeholders: [
            { id: 'p1', title: '图文内容位', desc: '放公告、活动或玩法介绍' },
            { id: 'p2', title: '视频内容位', desc: '需要时再接入，不占当前体积' },
            { id: 'p3', title: '自定义模块', desc: '有想法随时加，页面已留好插入点' },
        ],
    },

    onLoad() {
        applyNavTitle(this);
    },

    async onShow() {
        applyNavTitle(this);
        try {
            await refreshBrand();
        } catch (e) {
            /* 用缓存即可 */
        }
        applyNavTitle(this);
    },
});
