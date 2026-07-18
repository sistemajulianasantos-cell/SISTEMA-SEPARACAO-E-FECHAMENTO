/* ============================================================
   FIRESTORE — operações com o banco de dados
   ============================================================ */

const TS = () => firebase.firestore.FieldValue.serverTimestamp();
const ARR_UNION = val => firebase.firestore.FieldValue.arrayUnion(val);

/* ── Helpers de data ── */
function toDate(val) {
  if (!val) return new Date(0);
  if (val.toDate) return val.toDate();
  return new Date(val);
}

function formatarData(val) {
  if (!val) return '—';
  return toDate(val).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ── Hash de senha (SHA-256 + salt fixo) — ESQUEMA LEGADO ──
   Mantido só para autenticar/migrar contas antigas (ver
   autenticarUsuarioLegado). Contas novas usam o Firebase Authentication
   de verdade e nunca mais gravam senha nem hash no Firestore. */
async function hashSenha(senha) {
  const dados = new TextEncoder().encode(senha + 'romero-salt-2024');
  const buf   = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ════════════════════════════════════════
   USUÁRIOS — autenticação via Firebase Authentication
   O login continua sendo por "nome de usuário" na tela, mas por trás
   cada pessoa tem uma conta real no Firebase Auth, com um e-mail
   sintético derivado do nome (ex.: "joao.silva@sistema-separacao.local").
   A senha é validada e guardada pelo próprio Firebase — nunca mais
   trafega nem fica salva como hash dentro do Firestore.
════════════════════════════════════════ */

const AUTH_DOMINIO_USUARIO = 'sistema-separacao.local';

function normalizarNomeUsuario(nome) {
  return (nome || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

function _emailDoUsuario(nome) {
  return `${normalizarNomeUsuario(nome)}@${AUTH_DOMINIO_USUARIO}`;
}

/* O Firebase Auth exige senha com pelo menos 6 caracteres, mas o app
   sempre permitiu 4 (e várias contas antigas usam senha de 4 dígitos).
   Em vez de forçar todo mundo a redefinir a senha agora, completamos de
   forma determinística senhas curtas até 6 caracteres antes de qualquer
   chamada ao Firebase Auth — quem digita continua digitando a senha
   original de sempre; o preenchimento é só um detalhe interno. */
function _senhaFirebase(senha) {
  if (!senha || senha.length >= 6) return senha;
  let s = senha;
  while (s.length < 6) s += senha;
  return s.slice(0, 6);
}

/* App secundário do Firebase — usado só para criar a conta de OUTRA
   pessoa (ex.: CEO cadastrando um colaborador). createUserWithEmailAndPassword
   loga automaticamente como o usuário recém-criado quando chamado no app
   principal, o que derrubaria a sessão de quem está cadastrando; rodando
   num app secundário isso não acontece. */
function _appSecundario() {
  const NOME_APP = 'secundario';
  const existente = firebase.apps.find(a => a.name === NOME_APP);
  if (existente) return existente;

  const app = firebase.initializeApp(firebaseConfig, NOME_APP);
  /* Replica a ativação do App Check do app principal — sem isso, chamadas
     de Auth/Firestore pelo app secundário seriam rejeitadas se o App Check
     estiver com enforcement ligado no projeto. */
  if (typeof APPCHECK_SITE_KEY !== 'undefined' && APPCHECK_SITE_KEY) {
    app.appCheck().activate(APPCHECK_SITE_KEY, true);
  }
  return app;
}

async function contarUsuarios() {
  const snap = await db.collection('usuarios').limit(1).get();
  return snap.size;
}

/* roles: array de strings, ex: ['separador', 'coordenador'].
   Cria a conta no Firebase Auth (via app secundário, sem afetar a sessão
   atual) e o perfil em usuarios/{uid}. O documento é gravado usando a
   própria sessão recém-criada (as regras do Firestore exigem que o
   primeiro documento de um usuário seja gravado por ele mesmo). Quem
   chamar e quiser efetivamente entrar como esse usuário deve, em
   seguida, chamar autenticarUsuario. */
async function criarUsuario(nome, senha, roles) {
  /* papel principal: ceo > coordenador > separador */
  const role = roles.includes('ceo') ? 'ceo'
    : roles.includes('coordenador') ? 'coordenador' : 'separador';

  const appSec   = _appSecundario();
  const cred     = await appSec.auth().createUserWithEmailAndPassword(_emailDoUsuario(nome), _senhaFirebase(senha));
  const uid      = cred.user.uid;

  const dados = {
    nome,
    nomeKey:  normalizarNomeUsuario(nome),
    role,           /* campo legado — mantido para compat */
    roles,          /* array com todos os papéis */
    ativo:     true,
    criadoEm: TS(),
  };
  await appSec.firestore().collection('usuarios').doc(uid).set(dados);
  await appSec.auth().signOut();

  return { id: uid, ...dados };
}

async function buscarUsuarioPorNome(nome) {
  const snap = await db.collection('usuarios')
    .where('nome', '==', nome)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() };
}

async function autenticarUsuario(nome, senha) {
  const email = _emailDoUsuario(nome);
  try {
    const cred  = await firebase.auth().signInWithEmailAndPassword(email, _senhaFirebase(senha));
    const doc   = await db.collection('usuarios').doc(cred.user.uid).get();
    if (!doc.exists) { await firebase.auth().signOut(); return null; }
    const usuario = { id: cred.user.uid, ...doc.data() };
    if (!usuario.roles) usuario.roles = [usuario.role];
    return usuario;
  } catch (e) {
    const CODIGOS_CREDENCIAL_INVALIDA = [
      'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential',
      'auth/invalid-login-credentials',
    ];
    if (CODIGOS_CREDENCIAL_INVALIDA.includes(e.code)) {
      /* Pode ser uma conta ainda não migrada do esquema antigo (hash no
         Firestore) — tenta validar por ali e, se bater, migra na hora. */
      return autenticarUsuarioLegado(nome, senha);
    }
    throw e;
  }
}

async function autenticarUsuarioLegado(nome, senha) {
  /* A consulta ao Firestore exige alguma sessão (mesmo anônima) — depois
     de um logout ela deixa de existir, então garantimos uma aqui. */
  if (!firebase.auth().currentUser) {
    await firebase.auth().signInAnonymously();
  }
  const usuarioLegado = await buscarUsuarioPorNome(nome);
  if (!usuarioLegado || !usuarioLegado.senhaHash) return null;
  const hash = await hashSenha(senha);
  if (hash !== usuarioLegado.senhaHash) return null;
  return migrarUsuarioLegado(usuarioLegado, senha);
}

/* Cria a conta real no Firebase Auth para quem só existia no esquema
   antigo e apaga o registro legado (com o hash de senha). A senha em
   texto puro só existe neste instante, durante o próprio login, e nunca
   é salva em lugar nenhum. */
async function migrarUsuarioLegado(usuarioLegado, senha) {
  const roles   = usuarioLegado.roles || [usuarioLegado.role];
  const nomeKey = normalizarNomeUsuario(usuarioLegado.nome);
  const email   = _emailDoUsuario(usuarioLegado.nome);

  const cred = await firebase.auth().createUserWithEmailAndPassword(email, _senhaFirebase(senha));
  const uid  = cred.user.uid;

  const dados = {
    nome:     usuarioLegado.nome,
    nomeKey,
    role:     usuarioLegado.role,
    roles,
    ativo:    usuarioLegado.ativo !== false,
    criadoEm: usuarioLegado.criadoEm || TS(),
  };
  await db.collection('usuarios').doc(uid).set(dados);
  await db.collection('usuarios').doc(usuarioLegado.id).delete();
  return { id: uid, ...dados };
}

/* Troca a senha do usuário atualmente logado. Reautentica com a senha
   atual antes (o Firebase exige login "recente" para trocar senha, e
   isso já serve para validar que a senha atual está correta). Como não
   há e-mail real nem backend, esta é a única forma de redefinição de
   senha disponível hoje — quem esquecer a senha precisa que o CEO
   cadastre um usuário novo. */
async function trocarSenhaUsuarioAtual(senhaAtual, novaSenha) {
  const user = firebase.auth().currentUser;
  if (!user || !user.email) throw new Error('Sem sessão ativa.');

  const cred = firebase.auth.EmailAuthProvider.credential(user.email, _senhaFirebase(senhaAtual));
  await user.reauthenticateWithCredential(cred);
  await user.updatePassword(_senhaFirebase(novaSenha));
}

async function listarUsuarios() {
  const snap = await db.collection('usuarios').orderBy('nome').get();
  return snap.docs.map(d => {
    const data = d.data();
    if (!data.roles) data.roles = [data.role];
    return { id: d.id, ...data };
  });
}

async function deletarUsuario(id) {
  return db.collection('usuarios').doc(id).delete();
}

/* ════════════════════════════════════════
   FESTAS
════════════════════════════════════════ */

function escutarFestas(filtro, callback) {
  let q = db.collection('festas');
  if (filtro.status && filtro.status !== 'todas') {
    q = q.where('status', '==', filtro.status);
  }
  return q.onSnapshot(snap => {
    const festas = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => toDate(b.data) - toDate(a.data));
    callback(festas);
  }, err => console.error('Firestore listener error:', err));
}

function escutarFesta(id, callback) {
  return db.collection('festas').doc(id).onSnapshot(doc => {
    if (doc.exists) callback({ id: doc.id, ...doc.data() });
  });
}

async function salvarFesta(dados) {
  return db.collection('festas').add({
    ...dados,
    status:    'agendada',   /* criada → aguardando separação */
    criadoEm: TS(),
    alteracoes: [],
  });
}

async function atualizarFesta(id, dados) {
  return db.collection('festas').doc(id).update(dados);
}

async function resetarParaAgendada(id, itens) {
  const DEL = () => firebase.firestore.FieldValue.delete();
  return db.collection('festas').doc(id).update({
    status:             'agendada',
    itens,
    editandoAgora:      null,
    alteracoes:         [],
    colaborador:        DEL(),
    coordenador:        DEL(),
    separacaoInicio:    DEL(),
    separacaoFim:       DEL(),
    primeiroItemEm:     DEL(),
    conferenciaFim:     DEL(),
    retornoFim:         DEL(),
    galpaoFim:          DEL(),
    obsSeparacao:       DEL(),
    obsConferencia:     DEL(),
    obsRetorno:         DEL(),
    obsGalpao:          DEL(),
    fotosSeparacao:     DEL(),
    fotosConferencia:   DEL(),
    fotosRetorno:       DEL(),
    fotosGalpao:        DEL(),
    divergencias:       DEL(),
    divergenciasGalpao: DEL(),
    ultimaAlteracao:    DEL(),
  });
}

async function deletarFesta(id) {
  return db.collection('festas').doc(id).delete();
}

/* Colaborador inicia a separação: agendada → separando */
async function iniciarSeparacao(id, colaborador) {
  return db.collection('festas').doc(id).update({
    status:           'separando',
    colaborador,
    separacaoInicio: TS(),
  });
}

/* Marca um item como separado; no primeiro item, registra primeiroItemEm para medir tempo */
async function marcarItemSeparado(festaId, itens, ehPrimeiro) {
  const update = { itens };
  if (ehPrimeiro) update.primeiroItemEm = TS();
  return db.collection('festas').doc(festaId).update(update);
}

const PROXIMA_ETAPA = {
  separacao:   'conferencia',
  conferencia: 'festa',
  retorno:     'galpao',
  galpao:      'concluida',
};

async function concluirEtapa(id, etapa, dados) {
  return db.collection('festas').doc(id).update({
    ...dados,
    status:          PROXIMA_ETAPA[etapa],
    [`${etapa}Fim`]: TS(),
  });
}

/* Edição de data/hora/quantidades enquanto agendada ou separando */
async function editarFestaDados(id, { data, hora, itens }, alteracoes, usuarioNome) {
  const registro = {
    alteradoEm:  new Date().toISOString(),
    alteradoPor: usuarioNome,
    campos:      alteracoes,   /* array de { campo, de, para } */
  };

  return db.collection('festas').doc(id).update({
    data,
    hora,
    itens,
    ultimaAlteracao: TS(),
    alteracoes:      ARR_UNION(registro),
  });
}

/* ════════════════════════════════════════
   CATEGORIAS (grupos/setores de separação)
════════════════════════════════════════ */

async function listarCategorias() {
  const snap = await db.collection('categorias').orderBy('ordem').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function salvarCategoriaDB(dados) {
  const snap = await db.collection('categorias')
    .where('nomeKey', '==', dados.nomeKey).limit(1).get();
  if (!snap.empty) {
    return db.collection('categorias').doc(snap.docs[0].id).update({ ...dados, updatedAt: TS() });
  }
  return db.collection('categorias').add({ ...dados, criadoEm: TS(), updatedAt: TS() });
}

async function deletarCategoriaDB(id) {
  return db.collection('categorias').doc(id).delete();
}

/* ════════════════════════════════════════
   CONFIGURAÇÕES DE ITENS (grupos, prioridade, stand-by)
════════════════════════════════════════ */

async function listarItemConfigs() {
  const snap = await db.collection('item_config').orderBy('grupo').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function salvarItemConfigDB(dados) {
  /* Edição de doc existente — atualiza pelo ID para evitar duplicata se nomeKey mudou */
  if (dados.id) {
    const { id, ...rest } = dados;
    return db.collection('item_config').doc(id).update({ ...rest, updatedAt: TS() });
  }
  /* Criação: upsert por nomeKey */
  const snap = await db.collection('item_config')
    .where('nomeKey', '==', dados.nomeKey).limit(1).get();
  if (!snap.empty) {
    return db.collection('item_config').doc(snap.docs[0].id).update({
      ...dados, updatedAt: TS(),
    });
  }
  return db.collection('item_config').add({ ...dados, criadoEm: TS(), updatedAt: TS() });
}

async function deletarItemConfigDB(id) {
  return db.collection('item_config').doc(id).delete();
}

/* ════════════════════════════════════════
   ESTOQUE
════════════════════════════════════════ */

async function buscarEstoque() {
  const snap = await db.collection('estoque').get();
  const result = {};
  snap.docs.forEach(d => {
    const data = d.data();
    result[data.nomeKey] = { id: d.id, ...data };
  });
  return result;
}

async function salvarItemEstoque(nomeKey, dados) {
  const snap = await db.collection('estoque')
    .where('nomeKey', '==', nomeKey).limit(1).get();
  if (!snap.empty) {
    return db.collection('estoque').doc(snap.docs[0].id).update({
      ...dados, nomeKey, updatedAt: TS(),
    });
  }
  return db.collection('estoque').add({
    ...dados, nomeKey, updatedAt: TS(),
  });
}

async function registrarContagemHistorico({ nomeKey, nome, unidade, qtd, contadoPor }) {
  return db.collection('historico_contagem').add({
    nomeKey, nome, unidade, qtd, contadoPor,
    contadoEm: TS(),
  });
}

async function listarHistoricoContagem(limite = 300) {
  const snap = await db.collection('historico_contagem')
    .limit(limite)
    .get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const da = a.contadoEm?.toDate ? a.contadoEm.toDate().getTime() : (a.contadoEm || 0);
      const db_ = b.contadoEm?.toDate ? b.contadoEm.toDate().getTime() : (b.contadoEm || 0);
      return db_ - da;
    });
}

/* Atualiza apenas os itens de uma festa (sem registrar alterações no histórico) */
async function buscarTodasFestas() {
  const snap = await db.collection('festas').get();
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => toDate(b.data) - toDate(a.data));
}

async function editarQtdFesta(festaId, itens) {
  return db.collection('festas').doc(festaId).update({
    itens,
    editandoAgora: null,
    ultimaAlteracao: TS(),
  });
}

/* ════════════════════════════════════════
   COMPRAS
════════════════════════════════════════ */

async function listarCompras() {
  const snap = await db.collection('compras').orderBy('criadoEm', 'desc').get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function salvarCompraDB(dados) {
  return db.collection('compras').add({ ...dados, criadoEm: TS() });
}

async function atualizarCompraDB(id, dados) {
  return db.collection('compras').doc(id).update({ ...dados, updatedAt: TS() });
}

async function deletarCompraDB(id) {
  return db.collection('compras').doc(id).delete();
}

/* ════════════════════════════════════════
   CLOUDINARY — fotos
════════════════════════════════════════ */

async function uploadFotos(files, festaId, tipo) {
  const validos = files.filter(Boolean);
  const urls = [];
  for (const file of validos) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', `festas/${festaId}/${tipo}`);

    const resp = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
      method: 'POST',
      body: formData,
    });
    const data = await resp.json();
    if (!resp.ok || !data.secure_url) {
      throw new Error(data.error?.message || 'Falha no upload da foto');
    }
    urls.push(data.secure_url);
  }
  return urls;
}
