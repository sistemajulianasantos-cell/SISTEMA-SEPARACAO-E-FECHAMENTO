const firebaseConfig = {
  apiKey: "AIzaSyAWwVU89Is5sZFbjeXSfY08y7f8pP8V4OQ",
  authDomain: "sistema-separacao-e-fechamento.firebaseapp.com",
  projectId: "sistema-separacao-e-fechamento",
  messagingSenderId: "808931164240",
  appId: "1:808931164240:web:e81fdc523b486384119155"
};

firebase.initializeApp(firebaseConfig);

/* App Check (reCAPTCHA v3). Cole sua site key do console → App Check.
   Enquanto estiver vazia, não ativa nada (app segue normal). */
const APPCHECK_SITE_KEY = '6Ley_k8tAAAAAPBAhj2PBBdw6Qf3McQ_HMq_5AEl';   // ex.: '6Lc_xxxxxxxxxxxxxxxxxxxx'
if (APPCHECK_SITE_KEY) {
  firebase.appCheck().activate(APPCHECK_SITE_KEY, /* autoRefresh */ true);
}

const db = firebase.firestore();

db.settings({ ignoreUndefinedProperties: true });

/* ════════════════════════════════════════════════════════════
   FUNCIONAR SEM INTERNET (pedido da Juliana em 10-07)
   1) Cache local do Firestore: o que já foi lido fica no aparelho e toda
      gravação entra numa fila local que sobe sozinha quando a conexão
      volta (inclusive se o app for fechado e reaberto).
   2) Sem internet, a promise de uma gravação só resolve quando o servidor
      confirmar — e o app inteiro faz "await" nelas, então a tela travava.
      As gravações abaixo passam a liberar a tela logo (o dado já está na
      fila local); se o servidor recusar depois, avisa.
   3) Leitura com .get() sem internet esperava ~10s antes de cair pro
      cache; agora vai direto pro cache quando está offline.
   ════════════════════════════════════════════════════════════ */
db.enablePersistence({ synchronizeTabs: true })
  .catch(e => console.warn('Cache offline do Firestore indisponível:', e.code || e));

(function () {
  const fs = firebase.firestore;
  const ESPERA_ESCRITA_MS = 4000;
  const ESPERA_LEITURA_MS = 6000;
  const semRede = () => navigator.onLine === false;
  const dormir  = ms => new Promise(r => setTimeout(r, ms));

  function naoTravar(p) {
    let liberado = false;
    p.catch(e => {
      if (!liberado) return;  /* erro antes de liberar: quem chamou já recebe */
      console.error('Gravação recusada pelo servidor:', e);
      if (typeof toast === 'function') toast('Uma alteração não foi aceita pelo servidor: ' + (e.code || e.message || e), 'erro');
    });
    return Promise.race([p, dormir(semRede() ? 0 : ESPERA_ESCRITA_MS).then(() => { liberado = true; })]);
  }

  ['set', 'update', 'delete'].forEach(m => {
    const orig = fs.DocumentReference.prototype[m];
    fs.DocumentReference.prototype[m] = function (...args) { return naoTravar(orig.apply(this, args)); };
  });
  const origCommit = fs.WriteBatch.prototype.commit;
  fs.WriteBatch.prototype.commit = function () { return naoTravar(origCommit.call(this)); };
  /* add() = doc() com id gerado no aparelho + set(): devolve a referência
     mesmo offline (o original só devolvia depois do servidor confirmar) */
  fs.CollectionReference.prototype.add = function (dados) {
    const ref = this.doc();
    return ref.set(dados).then(() => ref);
  };

  function lerSemTravar(orig) {
    return function (opts) {
      if (opts && opts.source) return orig.call(this, opts);
      const doCache = () => orig.call(this, { source: 'cache' });
      if (semRede()) return doCache().catch(() => orig.call(this));
      const servidor = orig.call(this).catch(e => {
        if (e && e.code === 'unavailable') return doCache();
        throw e;
      });
      return Promise.race([servidor, dormir(ESPERA_LEITURA_MS).then(() => doCache().catch(() => servidor))]);
    };
  }
  fs.Query.prototype.get             = lerSemTravar(fs.Query.prototype.get);
  fs.DocumentReference.prototype.get = lerSemTravar(fs.DocumentReference.prototype.get);
})();

/* Aviso fixo enquanto estiver sem internet + confirmação quando a fila
   local terminar de subir. */
(function () {
  function atualizarAvisoRede() {
    let el = document.getElementById('aviso-offline');
    if (!el) {
      el = document.createElement('div');
      el.id = 'aviso-offline';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:8px 16px;'
        + 'background:#B45309;color:#fff;font-size:13px;font-weight:600;text-align:center;display:none';
      el.textContent = 'Sem internet — pode continuar usando. As alterações ficam salvas neste aparelho e sobem quando a conexão voltar.';
      document.body.appendChild(el);
    }
    el.style.display = navigator.onLine ? 'none' : 'block';
  }
  window.addEventListener('offline', atualizarAvisoRede);
  window.addEventListener('online', () => {
    atualizarAvisoRede();
    db.waitForPendingWrites()
      .then(() => { if (typeof toast === 'function') toast('Internet voltou — tudo que foi feito offline já foi enviado.', 'sucesso'); })
      .catch(() => {});
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', atualizarAvisoRede);
  else atualizarAvisoRede();
})();

/* Guarda os arquivos do app no aparelho pra abrir sem internet (sw.js) */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker não registrado:', e));
  });
}

/* Sessão anônima inicial: usada SOMENTE para (a) a checagem de "existe
   algum usuário cadastrado?" na tela de setup e (b) localizar, durante o
   login, uma conta antiga ainda não migrada para o Firebase Authentication
   (ver js/firestore.js). Ela NÃO dá acesso a dados de negócio — as regras
   do Firestore (firestore.rules) exigem uma conta real (não anônima) para
   ler/escrever festas, estoque, compras etc. Ao fazer login, essa sessão
   anônima é substituída pela sessão real do usuário. */
const authReady = (async () => {
  /* Persistência LOCAL: a sessão do usuário fica salva no aparelho e
     sobrevive a fechar/reabrir o navegador (é o padrão em browser, mas
     deixamos explícito). Assim o auto-login em js/app.js consegue reusar
     uma sessão real já existente. */
  try {
    await firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
  } catch (e) { console.error('setPersistence:', e); }

  /* Espera o SDK terminar de restaurar (ou não) uma sessão salva antes de
     decidir se precisa da sessão anônima. */
  await new Promise(resolve => {
    const unsub = firebase.auth().onAuthStateChanged(() => { unsub(); resolve(); });
  });

  /* Só entra anônimo se NÃO há nenhuma sessão restaurada — senão a chamada
     abaixo trocaria a sessão real do usuário por uma anônima. */
  if (!firebase.auth().currentUser) {
    try {
      await firebase.auth().signInAnonymously();
    } catch (e) { console.error('Erro na autenticação anônima:', e); }
  }
})();

/* Cloudinary — armazenamento de fotos (Firebase Storage exige plano pago) */
const CLOUDINARY_CLOUD_NAME    = 'wwutkszi';
const CLOUDINARY_UPLOAD_PRESET = 'xnbsx4zh';

/* ════════════════════════════════════════════════════════════
   APP SECUNDÁRIO — leitura read-only do controle-gestao-main
   (aba Equipe: elenco/escalação por evento vêm de lá, nunca são
   editados aqui). Nunca deve ganhar chamadas de escrita. Projeto
   separado, sem App Check configurado — não replicar a ativação
   feita acima para o app principal.
   ════════════════════════════════════════════════════════════ */
const firebaseConfigGestao = {
  apiKey: "AIzaSyCSIMoj3cx0OddVWNgVuUz85Hwk32kRV3g",
  authDomain: "controle-e-gestao-93c69.firebaseapp.com",
  projectId: "controle-e-gestao-93c69",
  storageBucket: "controle-e-gestao-93c69.firebasestorage.app",
  messagingSenderId: "754860108927",
  appId: "1:754860108927:web:212499c91e35f113dbe34a"
};

let dbGestao = null;
let gestaoAuthReady = Promise.resolve(false);

try {
  const appGestao = firebase.initializeApp(firebaseConfigGestao, 'gestao');
  dbGestao = firebase.firestore(appGestao);
  gestaoAuthReady = firebase.auth(appGestao).signInAnonymously()
    .then(() => true)
    .catch(e => { console.error('Erro na autenticação anônima (gestao):', e); return false; });
} catch (e) {
  console.error('Erro ao inicializar app secundário (gestao):', e);
}
