const firebaseConfig = {
  apiKey: "AIzaSyAWwVU89Is5sZFbjeXSfY08y7f8pP8V4OQ",
  authDomain: "sistema-separacao-e-fechamento.firebaseapp.com",
  projectId: "sistema-separacao-e-fechamento",
  storageBucket: "sistema-separacao-e-fechamento.firebasestorage.app",
  messagingSenderId: "808931164240",
  appId: "1:808931164240:web:e81fdc523b486384119155"
};

firebase.initializeApp(firebaseConfig);

const db      = firebase.firestore();
const storage = firebase.storage();

db.settings({ ignoreUndefinedProperties: true });
