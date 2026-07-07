const firebaseConfig = {
  apiKey: "AIzaSyAWwVU89Is5sZFbjeXSfY08y7f8pP8V4OQ",
  authDomain: "sistema-separacao-e-fechamento.firebaseapp.com",
  projectId: "sistema-separacao-e-fechamento",
  messagingSenderId: "808931164240",
  appId: "1:808931164240:web:e81fdc523b486384119155"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();

db.settings({ ignoreUndefinedProperties: true });

/* Autenticação anônima: exige que o cliente passe pelo Firebase Auth
   antes de poder ler/escrever no banco (as regras do Firestore passam
   a checar request.auth != null). Sem isso, request.auth nunca é
   preenchido e não há como as regras distinguirem o app de um acesso
   direto à API. */
const authReady = firebase.auth().signInAnonymously()
  .catch(e => console.error('Erro na autenticação anônima:', e));

/* Cloudinary — armazenamento de fotos (Firebase Storage exige plano pago) */
const CLOUDINARY_CLOUD_NAME    = 'wwutkszi';
const CLOUDINARY_UPLOAD_PRESET = 'xnbsx4zh';
