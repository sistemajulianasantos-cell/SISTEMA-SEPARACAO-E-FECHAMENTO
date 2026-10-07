/* Service worker — deixa o app abrir sem internet.
   • Página (index.html): tenta a rede primeiro (pra pegar versão nova) e,
     sem rede ou demorando, usa a cópia guardada.
   • js/css/ícones (com ?v=), SDK do Firebase, PDF.js e reCAPTCHA (App
     Check): usa a cópia guardada na hora e atualiza em segundo plano.
   • Dados (Firestore), login e upload de fotos NÃO passam por aqui — o
     Firestore tem o próprio cache offline (ver js/config.js). */
const CACHE = 'rc-separacao-v1';
const ESSENCIAIS = ['./', './index.html', './manifest.json', './icons/icon-rc.svg'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ESSENCIAIS)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

function ehArquivoDoApp(url) {
  if (url.origin === self.location.origin) return true;
  if (url.hostname === 'www.gstatic.com'
      && (url.pathname.startsWith('/firebasejs/') || url.pathname.startsWith('/recaptcha/'))) return true;
  if (url.hostname === 'www.google.com' && url.pathname.startsWith('/recaptcha/')) return true;
  if (url.hostname === 'cdnjs.cloudflare.com') return true;
  return false;
}

async function paginaRedePrimeiro(req) {
  const cache = await caches.open(CACHE);
  try {
    const resp = await Promise.race([
      fetch(req),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
    if (resp && resp.ok) cache.put('./index.html', resp.clone());
    return resp;
  } catch (_) {
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

async function cacheDepoisAtualiza(e) {
  const cache = await caches.open(CACHE);
  const guardado = await cache.match(e.request);
  const daRede = fetch(e.request).then(resp => {
    if (resp && (resp.ok || resp.type === 'opaque')) cache.put(e.request, resp.clone());
    return resp;
  });
  if (guardado) {
    e.waitUntil(daRede.catch(() => {}));
    return guardado;
  }
  return daRede;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!ehArquivoDoApp(url)) return;
  if (req.mode === 'navigate') {
    /* iframe do reCAPTCHA também é "navigate" — só a página do app usa a cópia */
    if (url.origin === self.location.origin) e.respondWith(paginaRedePrimeiro(req));
    return;
  }
  /* reCAPTCHA muda token/conteúdo por requisição em alguns endpoints —
     só o script em si (api.js / releases) vale guardar. */
  if (url.hostname === 'www.google.com' && !url.pathname.endsWith('.js')) return;
  e.respondWith(cacheDepoisAtualiza(e));
});
