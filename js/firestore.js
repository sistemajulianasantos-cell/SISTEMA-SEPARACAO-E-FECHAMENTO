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

/* ── Hash de senha (SHA-256 + salt fixo) ── */
async function hashSenha(senha) {
  const dados = new TextEncoder().encode(senha + 'romero-salt-2024');
  const buf   = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ════════════════════════════════════════
   USUÁRIOS
════════════════════════════════════════ */

async function contarUsuarios() {
  const snap = await db.collection('usuarios').limit(1).get();
  return snap.size;
}

/* roles: array de strings, ex: ['separador', 'coordenador'] */
async function criarUsuario(nome, senha, roles) {
  const hash  = await hashSenha(senha);
  /* papel principal: ceo > coordenador > separador */
  const role  = roles.includes('ceo') ? 'ceo'
    : roles.includes('coordenador') ? 'coordenador' : 'separador';

  return db.collection('usuarios').add({
    nome,
    senhaHash: hash,
    role,           /* campo legado — mantido para compat */
    roles,          /* array com todos os papéis */
    ativo:     true,
    criadoEm: TS(),
  });
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
  const usuario = await buscarUsuarioPorNome(nome);
  if (!usuario) return null;
  const hash = await hashSenha(senha);
  if (hash !== usuario.senhaHash) return null;
  /* garantir que o campo roles exista (retrocompatibilidade) */
  if (!usuario.roles) usuario.roles = [usuario.role];
  return usuario;
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
   STORAGE — fotos
════════════════════════════════════════ */

async function uploadFotos(files, festaId, tipo) {
  const validos = files.filter(Boolean);
  const urls = [];
  for (const file of validos) {
    const caminho = `festas/${festaId}/${tipo}/${Date.now()}_${file.name}`;
    const ref = storage.ref(caminho);
    await ref.put(file);
    urls.push(await ref.getDownloadURL());
  }
  return urls;
}
