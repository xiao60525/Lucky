/* Service Worker：iOS/Android 桌面应用壳缓存 + 离线兜底 + manifest 修补 */
'use strict';

const SHELL_CACHE = 'app-shell-v21';

/** 注册时透传的 sharecode（预览网关会把 query 里的 sharecode 剥掉，服务端看不到，只能在这里补） */
const SHARE = (() => {
  try {
    return new URL(self.serviceWorker.scriptURL).searchParams.get('sharecode') || '';
  } catch {
    return '';
  }
})();

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 逐个缓存：预览网关可能拦掉个别资源，单个失败不能拖垮安装
      await Promise.all(
        ['/', '/index.html', '/styles.css?v=20261105d', '/app.js?v=20261105d'].map(async (u) => {
          try {
            const r = await fetch(u, { credentials: 'same-origin' });
            if (r.ok) await cache.put(u, r);
          } catch {
            /* 忽略，靠运行时再补 */
          }
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // manifest：注入 sharecode（保证「添加到主屏幕」后 start_url 能过网关）
  if (SHARE && url.pathname === '/manifest.webmanifest') {
    event.respondWith(buildManifest(req));
    return;
  }

  // 导航请求缺 sharecode：302 补上（主屏启动兜底，防止网关 403）
  if (SHARE && req.mode === 'navigate' && !url.searchParams.has('sharecode')) {
    url.searchParams.set('sharecode', SHARE);
    event.respondWith(Response.redirect(url.href, 302));
    return;
  }

  // API：永远走网络（订单/支付必须新鲜）；断网给结构化错误，前端可提示
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(req);
        } catch {
          return new Response(JSON.stringify({ offline: true, message: '当前离线，恢复网络后自动重试' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  // 图标 / 启动图：缓存优先（URL 带版本号，内容变了 URL 变，自然穿透）
  if (url.pathname.startsWith('/api/brand/')) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // 页面与静态资源：网络优先，离线回壳
  event.respondWith(
    (async () => {
      try {
        const r = await fetch(req);
        if (r.ok) {
          const cache = await caches.open(SHELL_CACHE);
          cache.put(req, r.clone()).catch(() => {});
        }
        return r;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html');
          if (shell) return shell;
        }
        return new Response('离线', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })()
  );
});

/** 拉服务端 manifest 并把 sharecode 补进 start_url 与图标地址 */
async function buildManifest(req) {
  let m = {};
  try {
    const r = await fetch(req, { credentials: 'same-origin' });
    if (r.ok) m = await r.json();
  } catch {
    /* 断网时用空骨架 */
  }
  if (!m.name) m.name = 'App';
  const q = 'sharecode=' + encodeURIComponent(SHARE);
  m.start_url = '/?' + q;
  m.scope = '/';
  (m.icons || []).forEach((i) => {
    if (i && i.src && !/sharecode=/.test(i.src)) i.src += (i.src.includes('?') ? '&' : '?') + q;
  });
  return new Response(JSON.stringify(m), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
  });
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(req);
  const fresh = fetch(req, { credentials: 'same-origin' })
    .then((r) => {
      if (r.ok) cache.put(req, r.clone()).catch(() => {});
      return r;
    })
    .catch(() => cached);
  return cached || fresh;
}
