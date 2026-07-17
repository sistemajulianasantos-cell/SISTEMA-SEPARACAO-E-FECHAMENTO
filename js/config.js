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
