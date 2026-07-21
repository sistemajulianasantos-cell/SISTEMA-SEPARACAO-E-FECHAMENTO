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

/* Sessão anônima inicial: usada SOMENTE para (a) a checagem de "existe
   algum usuário cadastrado?" na tela de setup e (b) localizar, durante o
   login, uma conta antiga ainda não migrada para o Firebase Authentication
   (ver js/firestore.js). Ela NÃO dá acesso a dados de negócio — as regras
   do Firestore (firestore.rules) exigem uma conta real (não anônima) para
   ler/escrever festas, estoque, compras etc. Ao fazer login, essa sessão
   anônima é substituída pela sessão real do usuário. */
const authReady = firebase.auth().signInAnonymously()
  .catch(e => console.error('Erro na autenticação anônima:', e));

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
