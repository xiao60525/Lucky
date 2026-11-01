/* ------------------------------------------------------------------
   原生 App（Capacitor iOS/Android）引导
   页面在原生壳里从 capacitor://localhost 加载，接口和图片要打到线上域名，
   并且要带上预览网关要求的 sharecode。浏览器里打开时这段代码不做任何事。
------------------------------------------------------------------ */
(function () {
  var NATIVE = /^(capacitor|ionic|file):$/.test(location.protocol) || !!window.Capacitor;
  if (!NATIVE) return;

  var ORIGIN = 'https://mobile-app-pay-skeleton.app.workbuddy.host';
  var SHARE = 'O53RMG5UQ2';

  window.__NATIVE__ = { origin: ORIGIN, sharecode: SHARE };

  function withShare(url) {
    if (/[?&]sharecode=/.test(url)) return url;
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'sharecode=' + SHARE;
  }

  // 相对路径的接口请求 → 补全为线上绝对地址（含 sharecode）
  var origFetch = window.fetch ? window.fetch.bind(window) : null;
  if (origFetch) {
    window.fetch = function (input, init) {
      if (typeof input === 'string' && input.charAt(0) === '/') {
        return origFetch(ORIGIN + withShare(input), init);
      }
      return origFetch(input, init);
    };
  }
})();
