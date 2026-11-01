// 品牌信息（程序名称 / 图标）：由网页版管理后台「外观」页写入小程序云库，这里只读。
// 云库表 app_settings 对客户端只开放 SELECT，写不进去。
const { cloud } = require('./cloud');

const CACHE_KEY = 'brand_cache_v1';
const DEFAULT_BRAND = { name: '手机应用', tagline: '', logo: '', ver: '', initial: '应' };

let current = null;

/** 名称首字，用来在没有图标时当占位 */
function firstChar(name) {
    const text = String(name || '').trim();
    return text ? text.slice(0, 1) : '应';
}

function decorate(row) {
    const name = (row && row.app_name) || DEFAULT_BRAND.name;
    return {
        name,
        tagline: (row && row.tagline) || '',
        logo: (row && row.icon_data) || '',
        ver: (row && row.icon_ver) || '',
        initial: firstChar(name),
    };
}

function readCache() {
    try {
        const cached = wx.getStorageSync(CACHE_KEY);
        return cached && cached.name ? cached : null;
    } catch (e) {
        return null;
    }
}

function writeCache(value) {
    try {
        wx.setStorageSync(CACHE_KEY, value);
    } catch (e) {
        /* 缓存失败不影响使用 */
    }
}

/** 同步取当前品牌：先用本地缓存，保证首屏就有名字，不会闪一下默认名 */
function getBrand() {
    if (!current) {
        current = readCache() || DEFAULT_BRAND;
    }
    return current;
}

/** 从云库刷新（小程序启动、下拉刷新时调用）；失败就继续用缓存 */
async function refreshBrand() {
    const { data, error } = await cloud.database
        .from('app_settings')
        .select('app_name, tagline, icon_data, icon_ver')
        .limit(1);

    if (error) {
        console.warn('[brand] 读取失败，继续用缓存', error.message || '');
        return getBrand();
    }
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return getBrand();

    const next = decorate(rows[0]);
    const changed = !current || current.name !== next.name || current.ver !== next.ver;
    current = next;
    writeCache(next);
    return changed ? next : current;
}

/** 页面里统一：设置导航栏标题 + 返回给 setData 用的品牌对象 */
function applyNavTitle(page) {
    const brand = getBrand();
    wx.setNavigationBarTitle({ title: brand.name });
    if (page && page.setData) page.setData({ brand });
    return brand;
}

module.exports = { getBrand, refreshBrand, applyNavTitle, DEFAULT_BRAND };
