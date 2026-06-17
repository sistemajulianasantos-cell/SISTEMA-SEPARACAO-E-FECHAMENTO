/* ============================================================
   APP.JS — Lógica de UI, navegação e fluxos
   ============================================================ */

/* ── Estado global ── */
let usuarioAtual      = null;
let festaAtual        = null;
let unsubFestas       = null;
let unsubFesta        = null;
let filtroAtualCEO    = 'todas';
let filtroAtualCoord  = 'conferencia';
let filtroData        = null;
let todasFestasCache  = [];
let roleAtivo         = null;   /* papel ativo quando usuário tem múltiplos papéis */
let festaEditandoId   = null;   /* id da festa em edição */

let timers    = {};
let intervalos= {};

let fotosCache = { separacao: [], conferencia: [], retorno: [], galpao: [] };

/* ══════════════════════════════════════════════════
   INICIALIZAÇÃO
══════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  /* Restaurar credenciais salvas */
  const savedNome  = localStorage.getItem('rc_nome');
  const savedSenha = localStorage.getItem('rc_senha');
  if (savedNome && savedSenha) {
    document.getElementById('login-nome').value    = savedNome;
    document.getElementById('login-senha').value   = savedSenha;
    document.getElementById('login-lembrar').checked = true;
  }

  try {
    const total = await contarUsuarios();
    if (total === 0) {
      mostrarTela('tela-setup');
    } else {
      mostrarTela('tela-login');
    }
  } catch (e) {
    console.error('Erro ao verificar usuários:', e);
    mostrarTela('tela-login');
  }
});

/* ══════════════════════════════════════════════════
   NAVEGAÇÃO
══════════════════════════════════════════════════ */

let historico = [];

function mostrarTela(id, subtitulo = '') {
  document.querySelectorAll('.tela').forEach(t => t.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');

  const header  = document.getElementById('header');
  const btnBack = document.getElementById('btn-back');
  const sub     = document.getElementById('header-subtitulo');

  const telasAuth      = ['tela-setup', 'tela-login'];
  const telasPrincipais= ['tela-ceo', 'tela-colaborador', 'tela-coordenador'];

  if (telasAuth.includes(id)) {
    header.classList.add('hidden');
  } else {
    header.classList.remove('hidden');
    sub.textContent = subtitulo;
    if (telasPrincipais.includes(id)) {
      btnBack.classList.add('hidden');
    } else {
      btnBack.classList.remove('hidden');
    }
  }

  window.scrollTo(0, 0);
}

function navegar(id, subtitulo = '') {
  historico.push(id);
  mostrarTela(id, subtitulo);
}

function goBack() {
  historico.pop();
  const anterior = historico[historico.length - 1];
  if (anterior) {
    if (anterior === 'tela-lista-festas') {
      mostrarTela('tela-lista-festas', subtituloListaFestas());
      if (!unsubFestas) carregarCEO(); else atualizarVisaoCEO();
    } else {
      mostrarTela(anterior);
      if (anterior === 'tela-ceo')          carregarCEO();
      if (anterior === 'tela-colaborador')  carregarColab();
      if (anterior === 'tela-coordenador')  carregarCoord(filtroAtualCoord);
      if (anterior === 'tela-usuarios')     carregarUsuarios();
    }
  } else {
    irParaPrincipal();
  }
}

function irParaPrincipal() {
  historico = [];
  pararListeners();
  if (!usuarioAtual) { mostrarTela('tela-login'); return; }

  const roles = usuarioAtual.roles || [usuarioAtual.role];
  const papel = roles.includes('ceo') ? 'ceo' : (roleAtivo || roles[0]);

  if (papel === 'ceo') {
    mostrarTela('tela-ceo');
    carregarCEO();
  } else if (papel === 'coordenador') {
    mostrarTela('tela-coordenador');
    carregarCoord(filtroAtualCoord);
  } else {
    /* separador, colaborador ou qualquer outro papel */
    mostrarTela('tela-colaborador');
    carregarColab();
  }
}

function pararListeners() {
  if (unsubFestas) { unsubFestas(); unsubFestas = null; }
  if (unsubFesta)  { unsubFesta();  unsubFesta  = null; }
}

/* ══════════════════════════════════════════════════
   SETUP INICIAL
══════════════════════════════════════════════════ */

async function finalizarSetup() {
  const nome     = document.getElementById('setup-nome').value.trim();
  const senha    = document.getElementById('setup-senha').value;
  const confirma = document.getElementById('setup-confirma').value;

  if (!nome)              return toast('Informe o nome', 'erro');
  if (senha.length < 4)   return toast('Senha deve ter ao menos 4 caracteres', 'erro');
  if (senha !== confirma) return toast('As senhas não coincidem', 'erro');

  try {
    await criarUsuario(nome, senha, 'ceo');
    toast('Administrador criado. Faça login.', 'sucesso');
    setTimeout(() => mostrarTela('tela-login'), 1200);
  } catch (e) {
    console.error(e);
    toast('Erro ao criar administrador', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════════ */

async function doLogin() {
  const nome  = document.getElementById('login-nome').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erro  = document.getElementById('login-erro');
  const btn   = document.getElementById('btn-entrar');

  if (!nome || !senha) {
    erro.textContent = 'Preencha nome e senha.';
    erro.classList.remove('hidden');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Verificando...';
  erro.classList.add('hidden');

  try {
    const usuario = await autenticarUsuario(nome, senha);

    if (!usuario) {
      erro.textContent = 'Usuário ou senha incorretos.';
      erro.classList.remove('hidden');
      btn.disabled    = false;
      btn.textContent = 'Entrar';
      return;
    }

    usuarioAtual = usuario;
    roleAtivo    = null;
    document.getElementById('header-usuario').textContent = usuario.nome;

    /* Salvar ou limpar credenciais conforme checkbox */
    if (document.getElementById('login-lembrar').checked) {
      localStorage.setItem('rc_nome',  nome);
      localStorage.setItem('rc_senha', senha);
    } else {
      localStorage.removeItem('rc_nome');
      localStorage.removeItem('rc_senha');
    }
    document.getElementById('login-senha').value = '';

    /* CEO sempre vai direto ao painel; outros com múltiplos papéis vêem o seletor */
    const roles = usuario.roles || [usuario.role];
    if (!roles.includes('ceo') && roles.length > 1) {
      mostrarTela('tela-roles');
      document.getElementById('roles-boas-vindas').textContent =
        `Bem-vindo(a), ${usuario.nome}. Selecione como deseja acessar agora.`;
      renderizarRolePicker(roles);
    } else {
      irParaPrincipal();
    }

  } catch (e) {
    console.error(e);
    erro.textContent = 'Erro de conexão. Tente novamente.';
    erro.classList.remove('hidden');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Entrar';
  }
}

const ROLE_NOMES = { separador: 'Separador', coordenador: 'Coordenador', ceo: 'CEO / Administrador' };

function renderizarRolePicker(roles) {
  document.getElementById('roles-opcoes').innerHTML = roles.map(r => `
    <div class="role-card" onclick="escolherRole('${r}')">
      <span>${ROLE_NOMES[r] || r}</span>
      <span class="role-card-seta">&#8250;</span>
    </div>
  `).join('');
}

function escolherRole(role) {
  roleAtivo = role;
  irParaPrincipal();
}

function logout() {
  pararListeners();
  pararTimers();
  usuarioAtual = null;
  festaAtual   = null;
  fotosCache   = { separacao: [], conferencia: [], retorno: [], galpao: [] };
  historico    = [];
  document.getElementById('login-nome').value  = '';
  document.getElementById('login-senha').value = '';
  document.getElementById('login-erro').classList.add('hidden');
  mostrarTela('tela-login');
}

/* ══════════════════════════════════════════════════
   CEO — DASHBOARD
══════════════════════════════════════════════════ */

function carregarCEO() {
  pararListeners();
  unsubFestas = escutarFestas({}, festas => {
    todasFestasCache = festas;
    renderizarStatsCEO(festas);
    atualizarVisaoCEO();
  });
}

function renderizarStatsCEO(festas) {
  const c = s => festas.filter(f => f.status === s).length;
  const cores  = { agendada:'#0284C7', separando:'#D97706', conferencia:'#1D4ED8', festa:'#7C3AED', retorno:'#DC2626', galpao:'#78716C', concluida:'#166534' };
  const nomes  = { agendada:'Agendadas', separando:'Separando', conferencia:'Conferência', festa:'Em Festa', retorno:'Retorno', galpao:'Galpão', concluida:'Concluídas' };
  const status = ['agendada','separando','conferencia','festa','retorno','galpao','concluida'];

  document.getElementById('ceo-stats').innerHTML = status.map(s => `
    <div class="stat-card">
      <div class="stat-numero" style="color:${cores[s]}">${c(s)}</div>
      <div class="stat-label">${nomes[s]}</div>
    </div>
  `).join('');

  renderizarTiraData(festas);
}

/* Aplica filtro de status + filtro de data e re-renderiza a lista */
function atualizarVisaoCEO() {
  const porStatus = filtroAtualCEO === 'todas'
    ? todasFestasCache
    : todasFestasCache.filter(f => f.status === filtroAtualCEO);

  const lista = filtroData
    ? porStatus.filter(f => normalizarData(f.data) === filtroData)
    : porStatus;

  document.getElementById('ceo-lista').innerHTML = lista.length
    ? lista.map(f => htmlCardFesta(f, 'ceo')).join('')
    : estadoVazio('Nenhuma festa encontrada.');
}

function filtrarCEO(filtro, btn) {
  filtroAtualCEO = filtro;
  filtroData     = null;  /* reset do filtro de data ao trocar de aba */
  document.querySelectorAll('#ceo-tabs .tab').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');
  atualizarVisaoCEO();
}

/* ── Tira de datas ── */
function normalizarData(val) {
  if (!val) return '';
  const d = toDate(val);
  if (isNaN(d)) return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function renderizarTiraData(festas) {
  const el = document.getElementById('tira-datas');
  if (!el) return;

  const contagemPorDia = {};
  festas.forEach(f => {
    const key = normalizarData(f.data);
    if (key) contagemPorDia[key] = (contagemPorDia[key] || 0) + 1;
  });

  const dias = Object.keys(contagemPorDia).sort();

  if (!dias.length) {
    el.innerHTML = '';
    return;
  }

  const hojeKey = normalizarData(new Date());
  const DIAS_SEMANA = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  el.innerHTML = `
    <button class="data-btn-todas ${!filtroData ? 'ativo' : ''}"
      onclick="filtrarPorData(null, this)">Todas</button>

    ${dias.map(d => {
      const dt     = new Date(d + 'T12:00:00');
      const num    = String(dt.getDate()).padStart(2,'0');
      const mes    = MESES[dt.getMonth()];
      const sem    = DIAS_SEMANA[dt.getDay()];
      const qtd    = contagemPorDia[d];
      const isHoje = d === hojeKey;
      const isAtivo= d === filtroData;

      return `
        <button class="data-btn ${isAtivo ? 'ativo' : ''} ${isHoje ? 'hoje' : ''}"
          onclick="filtrarPorData('${d}', this)">
          ${qtd > 0 ? `<span class="data-btn-cnt">${qtd}</span>` : ''}
          <span class="data-btn-num">${num}</span>
          <span class="data-btn-mes">${mes}</span>
          <span class="data-btn-sem">${sem}</span>
        </button>
      `;
    }).join('')}
  `;
}

function subtituloListaFestas() {
  if (!filtroData) return 'Todas as Festas';
  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DIAS  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const dt = new Date(filtroData + 'T12:00:00');
  return `${dt.getDate()} ${MESES[dt.getMonth()]} — ${DIAS[dt.getDay()]}`;
}

function filtrarPorData(dia, btn) {
  filtroData      = dia;
  filtroAtualCEO  = 'todas';

  /* Atualizar visual da tira */
  document.querySelectorAll('#tira-datas .data-btn, #tira-datas .data-btn-todas')
    .forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');

  /* Resetar tabs da lista */
  document.querySelectorAll('#ceo-tabs .tab').forEach(b => b.classList.remove('ativo'));
  const todasTab = document.querySelector('#ceo-tabs .tab[data-filtro="todas"]');
  if (todasTab) todasTab.classList.add('ativo');

  /* Navegar para a tela de lista */
  historico = ['tela-ceo'];
  navegar('tela-lista-festas', subtituloListaFestas());
  atualizarVisaoCEO();
}

/* ══════════════════════════════════════════════════
   COLABORADOR
══════════════════════════════════════════════════ */

function carregarColab() {
  pararListeners();
  /* Escuta todas as festas e filtra no cliente para agendada + separando */
  unsubFestas = escutarFestas({}, festas => {
    const visiveis = festas.filter(f => f.status === 'agendada' || f.status === 'separando');
    const el = document.getElementById('colab-lista');
    el.innerHTML = visiveis.length
      ? visiveis.map(f => htmlCardFesta(f, 'colaborador')).join('')
      : estadoVazio('Nenhuma festa aguardando separação no momento.');
  });
}

function abrirSeparacao(id) {
  pararListeners();
  fotosCache.separacao = [];
  document.getElementById('preview-sep').innerHTML = '';
  document.getElementById('sep-obs').value = '';
  pararTimers();

  historico = ['tela-colaborador'];
  mostrarTela('tela-separacao', 'Separação');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    if (festa.status === 'agendada') {
      renderizarIniciarSeparacao(festa);
    } else {
      renderizarSeparacao(festa);
    }
  });
}

function renderizarIniciarSeparacao(festa) {
  document.getElementById('sep-info').innerHTML = htmlInfoFesta(festa);
  document.getElementById('sep-itens').innerHTML = `
    <div class="box-iniciar">
      <p>Esta festa ainda nao foi iniciada. Clique abaixo para comecar a separacao dos itens.</p>
      <button class="btn-iniciar-sep" onclick="confirmarInicioSeparacao()">Iniciar Separacao</button>
    </div>
  `;
  /* Ocultar campos de fotos e obs até iniciar */
  document.getElementById('btn-sep-concluir').style.display = 'none';
}

async function confirmarInicioSeparacao() {
  if (!festaAtual) return;
  try {
    await iniciarSeparacao(festaAtual.id, usuarioAtual.nome);
    /* O listener do escutarFesta vai re-renderizar automaticamente com status 'separando' */
    document.getElementById('btn-sep-concluir').style.display = '';
  } catch (e) {
    console.error(e);
    toast('Erro ao iniciar separacao.', 'erro');
  }
}

function renderizarSeparacao(festa) {
  document.getElementById('btn-sep-concluir').style.display = '';
  document.getElementById('sep-info').innerHTML = htmlInfoFesta(festa);

  const alteracoes = festa.alteracoes || [];
  let avisoHTML = '';
  if (alteracoes.length > 0) {
    const ultima = alteracoes[alteracoes.length - 1];
    const campos = (ultima.campos || []).map(c => c.campo).join(', ');
    avisoHTML = `
      <div class="aviso-alteracao">
        <strong>Atencao: esta festa foi alterada pelo administrador.</strong>
        <p>Alterado por ${ultima.alteradoPor} — campos: ${campos || 'data/itens'}. Verifique as quantidades antes de continuar.</p>
      </div>
    `;
  }

  const itens = festa.itens || [];
  if (!itens.length) {
    document.getElementById('sep-itens').innerHTML = avisoHTML + estadoVazio('Nenhum item cadastrado nesta festa.');
    return;
  }

  const tab       = window._tabSep || 'pendente';
  const pendentes = itens.map((item, i) => ({ ...item, _i: i })).filter(it => !it.separado);
  const separados = itens.map((item, i) => ({ ...item, _i: i })).filter(it =>  it.separado);

  document.getElementById('sep-itens').innerHTML = avisoHTML + `
    <div class="sep-tabs">
      <button class="sep-tab ${tab === 'pendente' ? 'ativo' : ''}" onclick="mudarTabSep('pendente')">
        Pendente <span class="sep-badge">${pendentes.length}</span>
      </button>
      <button class="sep-tab ${tab === 'separado' ? 'ativo' : ''}" onclick="mudarTabSep('separado')">
        Separado <span class="sep-badge sep-badge-ok">${separados.length}</span>
      </button>
    </div>
    <div id="sep-lista-pendente" ${tab !== 'pendente' ? 'class="hidden"' : ''}>
      ${pendentes.length
        ? pendentes.map(it => htmlItemPendente(it, it._i)).join('')
        : '<p class="vazio-sep">Todos os itens foram separados.</p>'}
    </div>
    <div id="sep-lista-separado" ${tab !== 'separado' ? 'class="hidden"' : ''}>
      ${separados.length
        ? separados.map(it => htmlItemSeparado(it, it._i)).join('')
        : '<p class="vazio-sep">Nenhum item separado ainda.</p>'}
    </div>
  `;
}

function htmlItemPendente(item, i) {
  return `
    <div class="item-pend-card">
      <div class="item-pend-info">
        <div class="item-nome">${item.nome}</div>
        <div class="item-sub">${item.unidade || 'un'} &mdash; necessario: <strong>${item.qtdNecessaria}</strong></div>
      </div>
      <div class="item-pend-acoes">
        <div class="qty-ajuste-wrap">
          <button class="btn-qty" onclick="ajustarQty(${i},-1)">&#8722;</button>
          <input type="number" id="qty-ajuste-${i}" class="qty-ajuste"
            value="${item.qtdNecessaria}" min="0" />
          <button class="btn-qty" onclick="ajustarQty(${i},1)">&#43;</button>
        </div>
        <button class="btn-separar" onclick="separarItem(${i})">Separar</button>
      </div>
    </div>
  `;
}

function htmlItemSeparado(item, i) {
  return `
    <div class="item-sep-card">
      <div class="item-pend-info">
        <div class="item-nome">${item.nome}</div>
        <div class="item-sub">Separado: <strong>${item.qtdSeparada}</strong> ${item.unidade || 'un'}</div>
      </div>
      <button class="btn-desfazer" onclick="desfazerItem(${i})">Desfazer</button>
    </div>
  `;
}

function mudarTabSep(tab) {
  window._tabSep = tab;
  if (festaAtual) renderizarSeparacao(festaAtual);
}

function ajustarQty(i, delta) {
  const input = document.getElementById(`qty-ajuste-${i}`);
  if (!input) return;
  input.value = Math.max(0, (parseFloat(input.value) || 0) + delta);
}

async function separarItem(i) {
  if (!festaAtual) return;
  const itens = (festaAtual.itens || []).map(it => ({ ...it }));
  const qtd   = parseFloat(document.getElementById(`qty-ajuste-${i}`)?.value) ?? itens[i].qtdNecessaria;
  itens[i]    = { ...itens[i], separado: true, qtdSeparada: qtd };

  const ehPrimeiro = !festaAtual.primeiroItemEm &&
    itens.filter((it, idx) => idx !== i && it.separado).length === 0;

  try {
    await marcarItemSeparado(festaAtual.id, itens, ehPrimeiro);
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar item. Tente novamente.', 'erro');
  }
}

async function desfazerItem(i) {
  if (!festaAtual) return;
  const itens = (festaAtual.itens || []).map(it => ({ ...it }));
  itens[i]    = { ...itens[i], separado: false, qtdSeparada: undefined };
  try {
    await marcarItemSeparado(festaAtual.id, itens, false);
  } catch (e) {
    toast('Erro ao desfazer.', 'erro');
  }
}

async function concluirSeparacao() {
  if (!festaAtual) return;

  const itens      = festaAtual.itens || [];
  const pendentes  = itens.filter(it => !it.separado);
  if (pendentes.length > 0) {
    toast(`Ainda ha ${pendentes.length} item(ns) pendente(s). Separe todos antes de finalizar.`, 'erro');
    window._tabSep = 'pendente';
    renderizarSeparacao(festaAtual);
    return;
  }

  const btn = document.getElementById('btn-sep-concluir');
  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    let fotoUrls = [];
    if (fotosCache.separacao.filter(Boolean).length) {
      toast('Enviando fotos...', 'info');
      fotoUrls = await uploadFotos(fotosCache.separacao, festaAtual.id, 'separacao');
    }

    await concluirEtapa(festaAtual.id, 'separacao', {
      itens,
      obsSeparacao:   document.getElementById('sep-obs').value,
      fotosSeparacao: fotoUrls,
      colaborador:    usuarioAtual.nome,
    });

    window._tabSep = 'pendente';
    toast('Separacao finalizada. Festa enviada para Conferencia.', 'sucesso');
    setTimeout(() => irParaPrincipal(), 1600);

  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
    btn.disabled    = false;
    btn.textContent = 'Finalizar Separação';
  }
}

/* ── Timers ── */
function toggleTimer(i) {
  const btn  = document.getElementById(`btn-timer-${i}`);
  const disp = document.getElementById(`timer-${i}`);

  if (intervalos[i]) {
    clearInterval(intervalos[i]);
    intervalos[i] = null;
    btn.textContent = 'Iniciar';
    btn.className   = 'btn-timer timer-iniciar';
  } else {
    if (!timers[i]) timers[i] = 0;
    const inicio = Date.now() - timers[i] * 1000;
    intervalos[i] = setInterval(() => {
      timers[i] = Math.floor((Date.now() - inicio) / 1000);
      disp.textContent = formatarTempo(timers[i]);
    }, 1000);
    btn.textContent = 'Parar';
    btn.className   = 'btn-timer timer-parar';
  }
}

function formatarTempo(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  return [h, m, seg].map(v => String(v).padStart(2, '0')).join(':');
}

function pararTimers() {
  Object.values(intervalos).forEach(clearInterval);
  timers    = {};
  intervalos= {};
}

/* ══════════════════════════════════════════════════
   COORDENADOR
══════════════════════════════════════════════════ */

function carregarCoord(status) {
  pararListeners();
  filtroAtualCoord = status;
  unsubFestas = escutarFestas({ status }, festas => {
    const el = document.getElementById('coord-lista');
    el.innerHTML = festas.length
      ? festas.map(f => htmlCardFesta(f, 'coordenador')).join('')
      : estadoVazio('Nenhuma festa nesta etapa.');
  });
}

function filtrarCoord(status, btn) {
  document.querySelectorAll('#tela-coordenador .tab').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');
  carregarCoord(status);
}

/* ── CONFERÊNCIA ── */
function abrirConferencia(id) {
  pararListeners();
  fotosCache.conferencia = [];
  document.getElementById('preview-conf').innerHTML = '';
  document.getElementById('conf-obs').value = '';

  historico = ['tela-coordenador'];
  mostrarTela('tela-conferencia', 'Conferência de Chegada');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarConferencia(festa);
  });
}

function renderizarConferencia(festa) {
  document.getElementById('conf-info').innerHTML = htmlInfoFesta(festa);

  document.getElementById('conf-itens').innerHTML = (festa.itens || []).map((item, i) => `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${item.nome}</div>
          <div class="item-sub">Separado: <strong>${item.qtdSeparada || 0}</strong> ${item.unidade || 'un'}</div>
        </div>
      </div>
      <div class="item-entrada">
        <label>Conferido:</label>
        <input type="number" class="qty-input" id="conf-qty-${i}"
          value="${item.qtdConferida !== undefined ? item.qtdConferida : (item.qtdSeparada || '')}"
          min="0" placeholder="0"
          oninput="checarConf(${i}, ${item.qtdSeparada || 0})" />
        <span class="item-unidade">${item.unidade || 'un'}</span>
      </div>
      <div id="conf-msg-${i}">
        ${item.qtdConferida !== undefined && item.qtdConferida !== item.qtdSeparada
          ? `<span class="msg-item msg-erro">Divergencia registrada</span>` : ''}
      </div>
    </div>
  `).join('');
}

function checarConf(i, separado) {
  const val = parseFloat(document.getElementById(`conf-qty-${i}`).value) || 0;
  const el  = document.getElementById(`conf-msg-${i}`);
  if (val === separado) {
    el.innerHTML = `<span class="msg-item msg-ok">Confere</span>`;
  } else {
    el.innerHTML = `<span class="msg-item msg-erro">Divergencia: esperado ${separado}, conferido ${val}</span>`;
  }
  atualizarBoxDivConf();
}

function atualizarBoxDivConf() {
  const itens = festaAtual?.itens || [];
  const divs  = itens.map((item, i) => {
    const val = parseFloat(document.getElementById(`conf-qty-${i}`)?.value) || 0;
    const sep = item.qtdSeparada || 0;
    return val !== sep ? { item: item.nome, separado: sep, conferido: val } : null;
  }).filter(Boolean);

  const box   = document.getElementById('conf-div-box');
  const lista = document.getElementById('conf-div-lista');

  if (divs.length) {
    box.classList.remove('hidden');
    lista.innerHTML = divs.map(d =>
      `<div class="div-linha">${d.item}: separado ${d.separado}, conferido ${d.conferido}</div>`
    ).join('');
  } else {
    box.classList.add('hidden');
  }
}

async function concluirConferencia() {
  if (!festaAtual) return;
  const btn = document.getElementById('btn-conf-concluir');
  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    const itens = (festaAtual.itens || []).map((item, i) => ({
      ...item,
      qtdConferida: parseFloat(document.getElementById(`conf-qty-${i}`)?.value) || 0,
    }));

    const divergencias = itens
      .filter(it => it.qtdConferida !== (it.qtdSeparada || 0))
      .map(it => ({ item: it.nome, separado: it.qtdSeparada || 0, conferido: it.qtdConferida }));

    let fotoUrls = [];
    if (fotosCache.conferencia.filter(Boolean).length) {
      toast('Enviando fotos...', 'info');
      fotoUrls = await uploadFotos(fotosCache.conferencia, festaAtual.id, 'conferencia');
    }

    await concluirEtapa(festaAtual.id, 'conferencia', {
      itens,
      divergencias,
      obsConferencia:   document.getElementById('conf-obs').value,
      fotosConferencia: fotoUrls,
      coordenador:      usuarioAtual.nome,
    });

    const msg = divergencias.length
      ? `Conferencia concluida com ${divergencias.length} divergencia(s). Festa liberada.`
      : 'Conferencia concluida sem divergencias. Festa liberada.';
    toast(msg, divergencias.length ? 'aviso' : 'sucesso');
    setTimeout(() => irParaPrincipal(), 1800);

  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
    btn.disabled    = false;
    btn.textContent = 'Confirmar Conferência — Liberar para Festa';
  }
}

/* ── RETORNO ── */
function abrirRetorno(id) {
  pararListeners();
  fotosCache.retorno = [];
  document.getElementById('preview-ret').innerHTML = '';
  document.getElementById('ret-obs').value = '';

  historico = ['tela-coordenador'];
  mostrarTela('tela-retorno', 'Registro de Retorno');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarRetorno(festa);
  });
}

function renderizarRetorno(festa) {
  document.getElementById('ret-info').innerHTML = htmlInfoFesta(festa);

  document.getElementById('ret-itens').innerHTML = (festa.itens || []).map((item, i) => `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${item.nome}</div>
          <div class="item-sub">Enviado: <strong>${item.qtdConferida || item.qtdSeparada || 0}</strong> ${item.unidade || 'un'}</div>
        </div>
      </div>
      <div class="item-entrada" style="margin-bottom:8px">
        <label>Retornou:</label>
        <input type="number" class="qty-input" id="ret-qty-${i}"
          value="${item.qtdRetorno !== undefined ? item.qtdRetorno : ''}"
          min="0" placeholder="0" />
        <span class="item-unidade">${item.unidade || 'un'}</span>
      </div>
      <div class="item-entrada">
        <label>Danificado:</label>
        <input type="number" class="qty-input" id="ret-dan-${i}"
          value="${item.qtdDanificada || 0}"
          min="0" placeholder="0" style="width:70px" />
        <span class="item-unidade">${item.unidade || 'un'}</span>
      </div>
    </div>
  `).join('');
}

async function concluirRetorno() {
  if (!festaAtual) return;
  const btn = document.getElementById('btn-ret-concluir');
  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    const itens = (festaAtual.itens || []).map((item, i) => ({
      ...item,
      qtdRetorno:    parseFloat(document.getElementById(`ret-qty-${i}`)?.value) || 0,
      qtdDanificada: parseFloat(document.getElementById(`ret-dan-${i}`)?.value) || 0,
    }));

    let fotoUrls = [];
    if (fotosCache.retorno.filter(Boolean).length) {
      toast('Enviando fotos...', 'info');
      fotoUrls = await uploadFotos(fotosCache.retorno, festaAtual.id, 'retorno');
    }

    await concluirEtapa(festaAtual.id, 'retorno', {
      itens,
      obsRetorno:   document.getElementById('ret-obs').value,
      fotosRetorno: fotoUrls,
    });

    toast('Retorno registrado. Festa enviada para o Galpao.', 'sucesso');
    setTimeout(() => irParaPrincipal(), 1600);

  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
    btn.disabled    = false;
    btn.textContent = 'Confirmar Retorno — Enviar para Galpão';
  }
}

/* ── GALPÃO ── */
function abrirGalpao(id) {
  pararListeners();
  fotosCache.galpao = [];
  document.getElementById('preview-gal').innerHTML = '';
  document.getElementById('gal-obs').value = '';

  historico = ['tela-coordenador'];
  mostrarTela('tela-galpao', 'Conferência do Galpão');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarGalpao(festa);
  });
}

function renderizarGalpao(festa) {
  document.getElementById('gal-info').innerHTML = htmlInfoFesta(festa);

  document.getElementById('gal-itens').innerHTML = (festa.itens || []).map((item, i) => `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${item.nome}</div>
          <div class="item-sub">
            Retornou: <strong>${item.qtdRetorno || 0}</strong>
            ${item.qtdDanificada ? ` — Danificado: <strong>${item.qtdDanificada}</strong>` : ''}
            ${item.unidade || 'un'}
          </div>
        </div>
      </div>
      <div class="item-entrada">
        <label>Conferido no Galpão:</label>
        <input type="number" class="qty-input" id="gal-qty-${i}"
          value="${item.qtdGalpao !== undefined ? item.qtdGalpao : (item.qtdRetorno || '')}"
          min="0" placeholder="0"
          oninput="checarGal(${i}, ${item.qtdRetorno || 0})" />
        <span class="item-unidade">${item.unidade || 'un'}</span>
      </div>
      <div id="gal-msg-${i}"></div>
    </div>
  `).join('');
}

function checarGal(i, retorno) {
  const val = parseFloat(document.getElementById(`gal-qty-${i}`).value) || 0;
  const el  = document.getElementById(`gal-msg-${i}`);
  if (val === retorno) {
    el.innerHTML = `<span class="msg-item msg-ok">Confere</span>`;
  } else {
    el.innerHTML = `<span class="msg-item msg-erro">Divergencia: retornou ${retorno}, conferido ${val}</span>`;
  }
  atualizarBoxDivGal();
}

function atualizarBoxDivGal() {
  const itens = festaAtual?.itens || [];
  const divs  = itens.map((item, i) => {
    const val = parseFloat(document.getElementById(`gal-qty-${i}`)?.value) || 0;
    const ret = item.qtdRetorno || 0;
    return val !== ret ? { item: item.nome, retorno: ret, galpao: val } : null;
  }).filter(Boolean);

  const box   = document.getElementById('gal-div-box');
  const lista = document.getElementById('gal-div-lista');

  if (divs.length) {
    box.classList.remove('hidden');
    lista.innerHTML = divs.map(d =>
      `<div class="div-linha">${d.item}: retornou ${d.retorno}, galpao ${d.galpao}</div>`
    ).join('');
  } else {
    box.classList.add('hidden');
  }
}

async function concluirGalpao() {
  if (!festaAtual) return;
  const btn = document.getElementById('btn-gal-concluir');
  btn.disabled    = true;
  btn.textContent = 'Finalizando...';

  try {
    const itens = (festaAtual.itens || []).map((item, i) => ({
      ...item,
      qtdGalpao: parseFloat(document.getElementById(`gal-qty-${i}`)?.value) || 0,
    }));

    const divergenciasGalpao = itens
      .filter(it => it.qtdGalpao !== (it.qtdRetorno || 0))
      .map(it => ({ item: it.nome, retorno: it.qtdRetorno || 0, galpao: it.qtdGalpao }));

    let fotoUrls = [];
    if (fotosCache.galpao.filter(Boolean).length) {
      toast('Enviando fotos...', 'info');
      fotoUrls = await uploadFotos(fotosCache.galpao, festaAtual.id, 'galpao');
    }

    await concluirEtapa(festaAtual.id, 'galpao', {
      itens,
      divergenciasGalpao,
      obsGalpao:   document.getElementById('gal-obs').value,
      fotosGalpao: fotoUrls,
    });

    toast('Festa concluida e arquivada.', 'sucesso');
    setTimeout(() => irParaPrincipal(), 1800);

  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
    btn.disabled    = false;
    btn.textContent = 'Concluir e Arquivar Festa';
  }
}

/* ══════════════════════════════════════════════════
   CEO — CRIAR FESTA
══════════════════════════════════════════════════ */

async function abrirCriarFesta() {
  document.getElementById('cf-nome').value      = '';
  document.getElementById('cf-cliente').value   = '';
  document.getElementById('cf-data').value      = '';
  document.getElementById('cf-hora').value      = '';
  document.getElementById('cf-local').value     = '';
  document.getElementById('cf-obs').value       = '';
  document.getElementById('itens-criar-lista').innerHTML = '';

  // Preencher select de colaboradores
  const select = document.getElementById('cf-colaborador');
  select.innerHTML = '<option value="">— Selecionar —</option>';
  try {
    const usuarios = await listarUsuarios();
    const colab    = usuarios.filter(u => u.role === 'colaborador' || u.role === 'coordenador');
    colab.forEach(u => {
      const opt = document.createElement('option');
      opt.value       = u.nome;
      opt.textContent = `${u.nome} (${ROLE_LABELS[u.role] || u.role})`;
      select.appendChild(opt);
    });
  } catch (e) { console.warn('Erro ao carregar colaboradores'); }

  // Itens padrão
  [
    { nome: 'Copos Long Drink',   qtd: 100, un: 'un' },
    { nome: 'Tacas de Vinho',     qtd:  50, un: 'un' },
    { nome: 'Tacas de Champagne', qtd:  30, un: 'un' },
    { nome: 'Gelo',               qtd:  50, un: 'kg' },
    { nome: 'Guardanapos',        qtd: 200, un: 'un' },
  ].forEach(p => addItemCriar(p));

  historico = ['tela-ceo', 'tela-lista-festas'];
  mostrarTela('tela-criar', 'Nova Festa');
}

function addItemCriar(preset = null) {
  const row = document.createElement('div');
  row.className = 'item-criar-row';
  row.innerHTML = `
    <input type="text"   placeholder="Nome do item"  value="${preset?.nome || ''}" />
    <input type="number" placeholder="0"              value="${preset?.qtd  || ''}" />
    <input type="text"   placeholder="un"             value="${preset?.un   || 'un'}" />
    <button class="btn-del-item" onclick="this.closest('.item-criar-row').remove()">x</button>
  `;
  document.getElementById('itens-criar-lista').appendChild(row);
}

async function submitCriarFesta() {
  const nome    = document.getElementById('cf-nome').value.trim();
  const cliente = document.getElementById('cf-cliente').value.trim();
  const dataStr = document.getElementById('cf-data').value;

  if (!nome || !cliente || !dataStr) return toast('Preencha nome, cliente e data.', 'erro');

  const rows  = document.querySelectorAll('#itens-criar-lista .item-criar-row');
  const itens = [];
  rows.forEach((row, idx) => {
    const inputs = row.querySelectorAll('input');
    const nomeItem = inputs[0]?.value.trim();
    if (nomeItem) {
      itens.push({
        id:            `item-${idx}`,
        nome:          nomeItem,
        qtdNecessaria: parseFloat(inputs[1]?.value) || 0,
        unidade:       inputs[2]?.value.trim() || 'un',
        qtdSeparada:   0,
        qtdConferida:  0,
        qtdRetorno:    0,
        qtdGalpao:     0,
        qtdDanificada: 0,
      });
    }
  });

  if (!itens.length) return toast('Adicione pelo menos um item.', 'erro');

  try {
    await salvarFesta({
      nome,
      cliente,
      data:        new Date(dataStr + 'T12:00:00'),
      hora:        document.getElementById('cf-hora').value,
      local:       document.getElementById('cf-local').value.trim(),
      colaborador: document.getElementById('cf-colaborador').value,
      obs:         document.getElementById('cf-obs').value.trim(),
      itens,
      criadoPor:   usuarioAtual.nome,
    });

    toast(`Festa "${nome}" criada com sucesso.`, 'sucesso');
    setTimeout(() => irParaPrincipal(), 1200);

  } catch (e) {
    console.error(e);
    toast('Erro ao criar festa. Verifique a conexão.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   CEO — DETALHE DA FESTA
══════════════════════════════════════════════════ */

function abrirDetalheFesta(id) {
  pararListeners();
  historico.push('tela-detalhe');
  mostrarTela('tela-detalhe', 'Detalhes da Festa');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarDetalhe(festa);
  });
}

function renderizarDetalhe(festa) {
  const itens       = festa.itens || [];
  const divs        = festa.divergencias || [];
  const divsGal     = festa.divergenciasGalpao || [];

  const avancarHTML = festa.status === 'festa'
    ? `<div class="caixa-avancar">
        <p>Festa encerrada? Registre o retorno dos materiais.</p>
        <button class="btn-primario" onclick="avancarParaRetorno('${festa.id}')">Iniciar Retorno</button>
       </div>`
    : '';

  const editarHTML = (festa.status === 'agendada' || festa.status === 'separando')
    ? `<div class="detalhe-acoes" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn-secundario" onclick="abrirEditarFesta('${festa.id}')">Editar Data / Quantidades</button>
        <button class="btn-secundario" onclick="ceoSepararFesta('${festa.id}')">Separar esta Festa</button>
       </div>`
    : '';

  document.getElementById('detalhe-content').innerHTML = `
    <div class="card-festa-info" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <h2>${festa.nome}</h2>
        <span class="badge badge-${festa.status}">${STATUS_LABELS[festa.status] || festa.status}</span>
      </div>
      ${htmlInfoLinhas(festa)}
    </div>

    ${avancarHTML}
    ${editarHTML}

    <div class="detalhe-card">
      <h3>Itens (${itens.length})</h3>
      ${itens.map(it => `
        <div class="detalhe-linha">
          <span>${it.nome}</span>
          <span>Nec: ${it.qtdNecessaria} | Sep: ${it.qtdSeparada || 0} | Conf: ${it.qtdConferida || 0} | Ret: ${it.qtdRetorno !== undefined ? it.qtdRetorno : '—'} ${it.unidade || 'un'}</span>
        </div>
      `).join('')}
    </div>

    ${divs.length ? `
      <div class="detalhe-card" style="border-left:3px solid var(--vermelho)">
        <h3 style="color:var(--vermelho)">Divergencias na Conferencia (${divs.length})</h3>
        ${divs.map(d => `
          <div class="detalhe-linha">
            <span>${d.item}</span>
            <span>Separado: ${d.separado} / Conferido: ${d.conferido}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${divsGal.length ? `
      <div class="detalhe-card" style="border-left:3px solid var(--amarelo)">
        <h3 style="color:var(--amarelo)">Divergencias no Galpao (${divsGal.length})</h3>
        ${divsGal.map(d => `
          <div class="detalhe-linha">
            <span>${d.item}</span>
            <span>Retornou: ${d.retorno} / Galpao: ${d.galpao}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${festa.obsSeparacao ? `<div class="detalhe-card"><h3>Obs. Separacao</h3><p style="font-size:13px">${festa.obsSeparacao}</p></div>` : ''}
    ${festa.obsConferencia ? `<div class="detalhe-card"><h3>Obs. Conferencia</h3><p style="font-size:13px">${festa.obsConferencia}</p></div>` : ''}
    ${festa.obsRetorno ? `<div class="detalhe-card"><h3>Obs. Retorno</h3><p style="font-size:13px">${festa.obsRetorno}</p></div>` : ''}

    ${festa.fotosSeparacao?.length ? `
      <div class="detalhe-card"><h3>Fotos da Separacao</h3>
        <div class="grade-fotos">${festa.fotosSeparacao.map(u => `<img src="${u}" class="foto-thumb" onclick="window.open('${u}','_blank')">`).join('')}</div>
      </div>` : ''}

    ${festa.fotosConferencia?.length ? `
      <div class="detalhe-card"><h3>Fotos da Conferencia</h3>
        <div class="grade-fotos">${festa.fotosConferencia.map(u => `<img src="${u}" class="foto-thumb" onclick="window.open('${u}','_blank')">`).join('')}</div>
      </div>` : ''}

    ${festa.fotosRetorno?.length ? `
      <div class="detalhe-card"><h3>Fotos do Retorno</h3>
        <div class="grade-fotos">${festa.fotosRetorno.map(u => `<img src="${u}" class="foto-thumb" onclick="window.open('${u}','_blank')">`).join('')}</div>
      </div>` : ''}
  `;
}

/* CEO usa a tela de separacao como se fosse colaborador */
function ceoSepararFesta(id) {
  abrirSeparacao(id);
}

/* ── Edição de data/quantidades ── */
function abrirEditarFesta(id) {
  festaEditandoId = id;
  pararListeners();
  historico.push('tela-editar-festa');
  mostrarTela('tela-editar-festa', 'Editar Festa');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarEditarFesta(festa);
  });
}

function renderizarEditarFesta(festa) {
  /* Preencher data e hora */
  if (festa.data) {
    const d = toDate(festa.data);
    if (!isNaN(d)) {
      document.getElementById('ef-data').value =
        `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
  }
  document.getElementById('ef-hora').value = festa.hora || '';

  /* Preencher quantidades por item */
  const itens = festa.itens || [];
  document.getElementById('ef-itens').innerHTML = itens.map((item, i) => `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${item.nome}</div>
          <div class="item-sub">Unidade: ${item.unidade || 'un'}</div>
        </div>
      </div>
      <div class="item-entrada">
        <label>Quantidade necessaria:</label>
        <input type="number" class="qty-input" id="ef-qty-${i}"
          value="${item.qtdNecessaria}" min="0" />
        <span class="item-unidade">${item.unidade || 'un'}</span>
      </div>
    </div>
  `).join('');
}

async function salvarEdicaoFesta() {
  if (!festaAtual || !festaEditandoId) return;

  const novaDataStr = document.getElementById('ef-data').value;
  const novaHora    = document.getElementById('ef-hora').value;

  if (!novaDataStr) return toast('Informe a data do evento.', 'erro');

  const novaData = new Date(novaDataStr + 'T12:00:00');

  /* Montar itens com novas quantidades e registrar o que mudou */
  const itens        = festaAtual.itens || [];
  const alteracoes   = [];
  const itensAtuais  = itens.map((item, i) => {
    const novaQtd = parseFloat(document.getElementById(`ef-qty-${i}`)?.value) || 0;
    if (novaQtd !== item.qtdNecessaria) {
      alteracoes.push({ campo: item.nome, de: item.qtdNecessaria, para: novaQtd });
    }
    return { ...item, qtdNecessaria: novaQtd };
  });

  /* Verificar mudança de data */
  const dataAtual = normalizarData(festaAtual.data);
  const dataNova  = novaDataStr;
  if (dataAtual !== dataNova) {
    alteracoes.push({ campo: 'Data', de: dataAtual, para: dataNova });
  }
  if ((festaAtual.hora || '') !== novaHora) {
    alteracoes.push({ campo: 'Horario', de: festaAtual.hora || '—', para: novaHora });
  }

  try {
    await editarFestaDados(
      festaEditandoId,
      { data: novaData, hora: novaHora, itens: itensAtuais },
      alteracoes,
      usuarioAtual.nome
    );

    const msg = alteracoes.length
      ? `Alteracoes salvas. ${alteracoes.length} campo(s) modificado(s).`
      : 'Nenhuma alteracao detectada.';
    toast(msg, 'sucesso');
    setTimeout(() => goBack(), 1200);

  } catch (e) {
    console.error(e);
    toast('Erro ao salvar alteracoes.', 'erro');
  }
}

async function avancarParaRetorno(id) {
  if (!confirm('Confirmar que a festa encerrou e iniciar o processo de retorno?')) return;
  try {
    await atualizarFesta(id, { status: 'retorno', festaFim: firebase.firestore.FieldValue.serverTimestamp() });
    toast('Festa enviada para Retorno.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao atualizar status.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   CEO — GERENCIAMENTO DE USUÁRIOS
══════════════════════════════════════════════════ */

const ROLE_LABELS = { colaborador: 'Colaborador', coordenador: 'Coordenador', ceo: 'CEO / Administrador' };

function abrirUsuarios() {
  historico = ['tela-ceo', 'tela-lista-festas'];
  mostrarTela('tela-usuarios', 'Usuários');
  carregarUsuarios();
}

async function carregarUsuarios() {
  const el = document.getElementById('usuarios-lista');
  el.innerHTML = '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const usuarios = await listarUsuarios();
    if (!usuarios.length) {
      el.innerHTML = estadoVazio('Nenhum usuário cadastrado.');
      return;
    }
    el.innerHTML = usuarios.map(u => {
      const rolesTexto = (u.roles || [u.role])
        .map(r => ROLE_LABELS[r] || r)
        .join(', ');
      return `
        <div class="usuario-row">
          <div class="usuario-info">
            <div class="usuario-nome">${u.nome}</div>
            <div class="usuario-role">${rolesTexto}</div>
          </div>
          <div class="usuario-acoes">
            ${u.id !== usuarioAtual.id
              ? `<button class="btn-perigo" onclick="confirmarDeletarUsuario('${u.id}','${u.nome}')">Remover</button>`
              : '<span style="font-size:12px;color:var(--cinza-400)">Você</span>'
            }
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    console.error(e);
    el.innerHTML = estadoVazio('Erro ao carregar usuários.');
  }
}

function abrirFormUsuario() {
  document.getElementById('fu-nome').value     = '';
  document.getElementById('fu-senha').value    = '';
  document.getElementById('fu-confirma').value = '';
  document.querySelectorAll('input[name="fu-roles"]').forEach(cb => cb.checked = false);
  document.getElementById('form-usuario-titulo').textContent = 'Novo Usuário';

  historico.push('tela-form-usuario');
  mostrarTela('tela-form-usuario', 'Novo Usuário');
}

async function salvarUsuario() {
  const nome     = document.getElementById('fu-nome').value.trim();
  const senha    = document.getElementById('fu-senha').value;
  const confirma = document.getElementById('fu-confirma').value;
  const roles    = Array.from(document.querySelectorAll('input[name="fu-roles"]:checked'))
                        .map(cb => cb.value);

  if (!nome)              return toast('Informe o nome.', 'erro');
  if (!roles.length)      return toast('Selecione ao menos uma funcao.', 'erro');
  if (senha.length < 4)   return toast('Senha deve ter ao menos 4 caracteres.', 'erro');
  if (senha !== confirma) return toast('As senhas nao coincidem.', 'erro');

  const existente = await buscarUsuarioPorNome(nome);
  if (existente) return toast('Ja existe um usuario com esse nome.', 'erro');

  try {
    await criarUsuario(nome, senha, roles);
    toast(`Usuario "${nome}" criado com sucesso.`, 'sucesso');
    setTimeout(() => {
      historico.pop();
      mostrarTela('tela-usuarios', 'Usuários');
      carregarUsuarios();
    }, 1000);
  } catch (e) {
    console.error(e);
    toast('Erro ao criar usuario.', 'erro');
  }
}

async function confirmarDeletarUsuario(id, nome) {
  if (!confirm(`Remover o usuario "${nome}"? Esta acao nao pode ser desfeita.`)) return;
  try {
    await deletarUsuario(id);
    toast(`Usuario "${nome}" removido.`, 'sucesso');
    carregarUsuarios();
  } catch (e) {
    console.error(e);
    toast('Erro ao remover usuario.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   IMPORTAÇÃO DE ORDEM DE SEPARACAO (PDF)
══════════════════════════════════════════════════ */

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

async function processarArquivoOR(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  toast('Lendo PDF...', 'info');

  try {
    const linhas = await extrairLinhasPDF(file);
    const dados  = parsearOR(linhas);

    if (!dados.itens.length) {
      toast('Nenhum item encontrado. Verifique se o PDF esta no formato correto.', 'aviso');
      return;
    }

    preencherFormularioImport(dados);
    toast(`${dados.itens.length} itens importados com sucesso.`, 'sucesso');

  } catch (e) {
    console.error('Erro ao importar PDF:', e);
    toast('Erro ao ler o PDF. Verifique o arquivo e tente novamente.', 'erro');
  }
}

async function extrairLinhasPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const linhas = [];

  for (let num = 1; num <= pdf.numPages; num++) {
    const page    = await pdf.getPage(num);
    const content = await page.getTextContent();

    // Agrupar itens de texto pela posicao vertical (y) arredondada
    const grupos = {};
    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      if (!grupos[y]) grupos[y] = [];
      grupos[y].push({ x: item.transform[4], txt: item.str.trim() });
    }

    // Ordenar grupos de cima para baixo (y decrescente) e montar linhas
    Object.keys(grupos)
      .map(Number)
      .sort((a, b) => b - a)
      .forEach(y => {
        const linha = grupos[y]
          .sort((a, b) => a.x - b.x)
          .map(i => i.txt)
          .filter(t => t.length > 0)
          .join(' ')
          .trim();
        if (linha) linhas.push(linha);
      });
  }

  return linhas;
}

function parsearOR(linhas) {
  const resultado = { evento: '', cliente: '', data: '', hora: '', or: '', itens: [] };

  const RE_ITEM    = /^(\d+(?:[.,]\d+)?)\s*(UN|PCT|CX|KG|L|LT|GF|FR|PC|ML|FD|BND|SC|GR|MT|PAR)\b\s*(.+)/i;
  const RE_COLUNA  = /^(Sa[íi]da|Extras|Volta)$/i;
  const RE_DATA    = /(\d{2})\/(\d{2})\/(\d{4})/;

  const IGNORAR = [
    'Saída','Extras','Volta','Data de Impressão','SAIDA','EXTRAS','VOLTA',
    '1/3','2/3','3/3','1/2','2/2','1/1',
  ];

  let categoriaAtual = '';

  for (const linhaOriginal of linhas) {
    // Ignorar linhas de controle e cabecalhos de colunas
    if (IGNORAR.some(ig => linhaOriginal.includes(ig))) continue;
    if (RE_COLUNA.test(linhaOriginal.trim())) continue;

    const linha = linhaOriginal.trim();

    // OR number
    const matchOR = linha.match(/\bOR\s*(\d+)\b/i);
    if (matchOR && !resultado.or) {
      resultado.or = matchOR[1];
    }

    // Cabecalho: CLIENTE
    if (/^CLIENTE\s*:/i.test(linha)) {
      resultado.cliente = linha.replace(/^CLIENTE\s*:\s*/i, '').trim();
      continue;
    }

    // Cabecalho: EVENTO
    if (/^EVENTO\s*:/i.test(linha)) {
      let ev = linha.replace(/^EVENTO\s*:\s*/i, '').trim();
      // Remover "Evento: - " prefixo se existir
      ev = ev.replace(/^Evento\s*:\s*-?\s*/i, '').trim();
      resultado.evento = ev;
      continue;
    }

    // Cabecalho: Data
    if (/^Data\s*:/i.test(linha)) {
      const m = linha.match(RE_DATA);
      if (m) resultado.data = `${m[3]}-${m[2]}-${m[1]}`;
      continue;
    }

    // Cabecalho: Horario
    if (/^Hor[aá]rio\s*:/i.test(linha)) {
      const horaPart = linha.replace(/^Hor[aá]rio\s*:\s*/i, '').trim();
      // Pegar apenas HH:MM
      const mHora = horaPart.match(/(\d{1,2}):(\d{2})/);
      if (mHora) resultado.hora = `${mHora[1].padStart(2,'0')}:${mHora[2]}`;
      continue;
    }

    // Tentativa de extrair item com quantidade e unidade
    const matchItem = linha.match(RE_ITEM);
    if (matchItem) {
      const [, qtdStr, unidade, nomeRaw] = matchItem;

      // Limpar nome: remover ** (marcadores de negrito), e colunas
      const nome = nomeRaw
        .replace(/\*\*/g, '')
        .replace(/\s+(Sa[íi]da|Extras|Volta)\s*.*$/i, '')
        .trim();

      if (nome.length > 1) {
        resultado.itens.push({
          id:            `item-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
          nome,
          categoria:     categoriaAtual,
          qtdNecessaria: parseFloat(qtdStr.replace(',', '.')),
          unidade:       unidade.toUpperCase(),
          qtdSeparada:   0,
          qtdConferida:  0,
          qtdRetorno:    0,
          qtdGalpao:     0,
          qtdDanificada: 0,
        });
      }
      continue;
    }

    // Detectar cabecalho de categoria: linha em maiusculas sem digitos no inicio
    const somenteLetras = linha.replace(/[^A-Za-zÀ-ÿ\s]/g, '').trim();
    if (
      somenteLetras.length > 2 &&
      somenteLetras === somenteLetras.toUpperCase() &&
      !/^\d/.test(linha) &&
      linha.length < 60
    ) {
      categoriaAtual = linha.trim();
    }
  }

  return resultado;
}

function preencherFormularioImport(dados) {
  // Preencher campos do formulario
  if (dados.evento)  document.getElementById('cf-nome').value    = dados.evento;
  if (dados.cliente) document.getElementById('cf-cliente').value = dados.cliente;
  if (dados.data)    document.getElementById('cf-data').value    = dados.data;
  if (dados.hora)    document.getElementById('cf-hora').value    = dados.hora;

  // Limpar lista e popular com itens importados, agrupados por categoria
  const lista = document.getElementById('itens-criar-lista');
  lista.innerHTML = '';

  let categoriaAtual = '';

  dados.itens.forEach(item => {
    // Separador de categoria
    if (item.categoria && item.categoria !== categoriaAtual) {
      categoriaAtual = item.categoria;
      const sep = document.createElement('div');
      sep.className   = 'categoria-separador';
      sep.textContent = item.categoria;
      lista.appendChild(sep);
    }

    const row = document.createElement('div');
    row.className = 'item-criar-row';
    row.innerHTML = `
      <input type="text"   value="${item.nome.replace(/"/g, '&quot;')}" placeholder="Nome do item" />
      <input type="number" value="${item.qtdNecessaria}" placeholder="0" />
      <input type="text"   value="${item.unidade}" placeholder="un" />
      <button class="btn-del-item" onclick="this.closest('.item-criar-row').remove()">x</button>
    `;
    lista.appendChild(row);
  });
}

/* ══════════════════════════════════════════════════
   FOTOS
══════════════════════════════════════════════════ */

const TIPO_PARA_ID = { separacao: 'sep', conferencia: 'conf', retorno: 'ret', galpao: 'gal' };

function handleFotos(input, tipo) {
  const files = Array.from(input.files);
  if (!files.length) return;

  const inicio  = fotosCache[tipo].length;
  fotosCache[tipo] = [...fotosCache[tipo], ...files];
  const preview = document.getElementById(`preview-${TIPO_PARA_ID[tipo]}`);

  files.forEach((file, i) => {
    const reader = new FileReader();
    const idx    = inicio + i;
    reader.onload = e => {
      const wrap = document.createElement('div');
      wrap.className = 'foto-wrap';
      wrap.innerHTML = `
        <img src="${e.target.result}" class="foto-thumb" onclick="window.open(this.src,'_blank')">
        <button class="foto-del" onclick="removerFoto('${tipo}',${idx},this)">x</button>
      `;
      preview.appendChild(wrap);
    };
    reader.readAsDataURL(file);
  });
}

function removerFoto(tipo, idx, btn) {
  fotosCache[tipo][idx] = null;
  btn.closest('.foto-wrap').remove();
}

/* ══════════════════════════════════════════════════
   HELPERS DE HTML
══════════════════════════════════════════════════ */

const STATUS_LABELS = {
  agendada: 'Agendada', separando: 'Separando', conferencia: 'Em Conferência',
  festa: 'Em Festa', retorno: 'Retorno',
  galpao: 'Conf. Galpão', concluida: 'Concluída',
};

function htmlCardFesta(f, contexto) {
  let onclick = '';
  if (contexto === 'ceo')          onclick = `abrirDetalheFesta('${f.id}')`;
  else if (contexto === 'colaborador') onclick = `abrirSeparacao('${f.id}')`;
  else if (contexto === 'coordenador') {
    if      (f.status === 'conferencia') onclick = `abrirConferencia('${f.id}')`;
    else if (f.status === 'retorno')     onclick = `abrirRetorno('${f.id}')`;
    else if (f.status === 'galpao')      onclick = `abrirGalpao('${f.id}')`;
  }

  const MESES_ABR = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const DIAS_ABR  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  let diaNum = '—', mesTxt = '', semTxt = '';
  if (f.data) {
    const d = toDate(f.data);
    if (!isNaN(d)) {
      diaNum = String(d.getDate()).padStart(2, '0');
      mesTxt = MESES_ABR[d.getMonth()];
      semTxt = DIAS_ABR[d.getDay()];
    }
  }

  return `
    <div class="card-festa st-${f.status}" onclick="${onclick}">
      <div class="card-festa-body">
        <div class="card-data-col">
          <div class="card-data-num">${diaNum}</div>
          <div class="card-data-mes">${mesTxt}</div>
          <div class="card-data-sem">${semTxt}</div>
        </div>
        <div class="card-corpo">
          <div class="card-festa-topo">
            <div class="card-festa-nome">${f.nome}</div>
            <span class="badge badge-${f.status}">${STATUS_LABELS[f.status] || f.status}</span>
          </div>
          <div class="card-festa-meta">${f.cliente}${f.hora ? ' — ' + f.hora : ''}</div>
          ${f.local ? `<div class="card-festa-meta">${f.local}</div>` : ''}
          <div class="card-festa-rodape">
            <span>${(f.itens || []).length} itens</span>
            ${f.colaborador ? `<span>${f.colaborador}</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function htmlInfoFesta(f) {
  return `
    <h2>${f.nome}</h2>
    <div class="info-linha">${f.cliente}${f.data ? ' — ' + formatarData(f.data) : ''}</div>
    ${f.hora  ? `<div class="info-linha">${f.hora}</div>` : ''}
    ${f.local ? `<div class="info-linha">${f.local}</div>` : ''}
    ${f.obs   ? `<div class="info-linha" style="opacity:.75;font-size:12px;margin-top:6px">${f.obs}</div>` : ''}
  `;
}

function htmlInfoLinhas(f) {
  return [
    f.data        && `<div class="info-linha">${formatarData(f.data)}</div>`,
    f.hora        && `<div class="info-linha">${f.hora}</div>`,
    f.cliente     && `<div class="info-linha">${f.cliente}</div>`,
    f.local       && `<div class="info-linha">${f.local}</div>`,
    f.colaborador && `<div class="info-linha">Colaborador: ${f.colaborador}</div>`,
    f.coordenador && `<div class="info-linha">Coordenador: ${f.coordenador}</div>`,
  ].filter(Boolean).join('');
}

function estadoVazio(msg) {
  return `<div class="estado-vazio"><p>${msg}</p></div>`;
}

/* ══════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════ */

let _toastTimer;
function toast(msg, tipo = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = `toast ${tipo}`;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}
<!-- Sincronizado com GitHub - Juliana -->
