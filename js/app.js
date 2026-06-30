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

let abaEstoqueAtual    = 'sintetico';
let abaProducaoAtual   = 'sintetico';
let ordemProducaoAtual = 'categoria';   /* 'categoria' | 'prioridade' */
let estoqueCache       = {};
let comprasCache       = [];
let _abaCompras        = 'alertas';
let _solicitarContext  = null;
let _receberContext    = null;
let _buscaFestas       = '';
let _buscaUsuarios     = '';
let _buscaEstoque      = '';
let _buscaCompras      = '';
let _usuariosCache     = [];
let itemConfigsCache   = {};   /* nomeKey → config */
let categoriasCache    = [];   /* [{id, nome, nomeKey, ordem}] */
let _comprarContext    = null;
let _itemConfigEditId  = null;
let _categoriaEditId   = null;
let sidebarPinada      = false;
let _modoSelecaoCadastro = false;
let _itensSelecionados   = new Set();
let _buscaCadastro       = '';

let fotosCache = { separacao: [], conferencia: [], retorno: [], galpao: [], confItens: {} };
let modoGrupoSep = 'categoria'; /* 'nenhum' | 'categoria' | 'setor' */
let _tvClockTimer      = null;
let _tvScrollTimers    = [];
let _tvScrollState     = {};
let _tvScrollDelay     = null;

/* ══════════════════════════════════════════════════
   PAINEL TV
══════════════════════════════════════════════════ */

function _tvPararAutoScroll() {
  _tvScrollTimers.forEach(clearInterval);
  _tvScrollTimers = [];
  if (_tvScrollDelay) { clearTimeout(_tvScrollDelay); _tvScrollDelay = null; }
}

function _tvIniciarAutoScroll() {
  _tvPararAutoScroll();
  const IDS = ['tv-agenda', 'tv-separando', 'tv-producao'];
  IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    /* Só faz loop se o conteúdo ultrapassar a altura visível */
    const alturaOriginal = el.scrollHeight;
    if (alturaOriginal <= el.clientHeight + 10) return;

    /* Duplica o conteúdo para loop contínuo sem salto */
    el.innerHTML = el.innerHTML + el.innerHTML;
    el.scrollTop = 0;

    const timer = setInterval(() => {
      el.scrollTop += 1;
      /* Quando chega na metade (fim da 1ª cópia), volta silenciosamente */
      if (el.scrollTop >= alturaOriginal) {
        el.scrollTop -= alturaOriginal;
      }
    }, 35); // ~28px/s
    _tvScrollTimers.push(timer);
  });
}

function carregarTV() {
  pararListeners();
  _tvPararAutoScroll();

  if (_tvClockTimer) clearInterval(_tvClockTimer);
  _tvAtualizarRelogio();
  _tvClockTimer = setInterval(_tvAtualizarRelogio, 1000);

  Promise.all([listarItemConfigs(), listarCategorias(), buscarEstoque(), listarCompras()]).then(([cfgs, cats, est, compras]) => {
    itemConfigsCache = {};
    cfgs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
    categoriasCache = cats;
    estoqueCache    = est;
    comprasCache    = compras;
    if (todasFestasCache.length) renderizarPainelTV(todasFestasCache);
  }).catch(e => console.error('TV configs:', e));

  unsubFestas = escutarFestas({}, festas => {
    todasFestasCache = festas;
    renderizarPainelTV(festas);
  });
}

function _tvAtualizarRelogio() {
  const rel = document.getElementById('tv-relogio');
  const dat = document.getElementById('tv-data');
  if (!rel) return;
  const DIAS  = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const agora = new Date();
  rel.textContent = agora.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  if (dat) dat.textContent = `${DIAS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}`;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('tv-btn-fs');
  if (!btn) return;
  btn.textContent = document.fullscreenElement ? '✕ Sair da Tela Cheia' : '⛶ Tela Cheia';
});

function renderizarPainelTV(festas) {
  const hojeKey  = normalizarData(new Date());
  const hojeDate = new Date(); hojeDate.setHours(0, 0, 0, 0);

  const separando     = festas.filter(f => f.status === 'separando');
  const agendadasHoje = festas.filter(f => f.status === 'agendada' && normalizarData(f.data) === hojeKey);
  const atrasadas     = festas.filter(f => {
    if (!['agendada', 'separando'].includes(f.status)) return false;
    const fd = toDate(f.data); fd.setHours(0, 0, 0, 0);
    return fd < hojeDate && normalizarData(f.data) !== hojeKey;
  });
  const proximas = festas
    .filter(f => {
      if (f.status !== 'agendada') return false;
      const fd = toDate(f.data); fd.setHours(0, 0, 0, 0);
      return fd > hojeDate;
    })
    .sort((a, b) => toDate(a.data) - toDate(b.data))
    .slice(0, 6);

  /* Produção: mesma lógica do CEO — agrega por nomeBaseKey, festas agendada/separando */
  const festasParaProducao = festas.filter(f => f.status === 'agendada' || f.status === 'separando');
  const producao = agregarItensFestas(festasParaProducao);

  _tvRenderSeparando(separando);
  _tvRenderProducao(producao);
  _tvRenderAgenda(agendadasHoje, atrasadas, proximas, hojeKey);

  /* Reinicia o auto-scroll após o DOM atualizar */
  if (_tvScrollDelay) clearTimeout(_tvScrollDelay);
  _tvScrollDelay = setTimeout(_tvIniciarAutoScroll, 400);
}

function _tvRenderSeparando(separando) {
  const titulo = document.getElementById('tv-sep-titulo');
  if (titulo) titulo.textContent = `EM SEPARAÇÃO (${separando.length})`;

  const el = document.getElementById('tv-separando');
  if (!el) return;

  if (!separando.length) {
    el.innerHTML = '<div class="tv-vazio">Nenhuma festa em separação agora</div>';
    return;
  }

  el.innerHTML = separando.map(f => {
    const todosItens = (f.itens || []).filter(it => deveExibirNaSeparacao(it));
    const total      = todosItens.length;
    const sepCount   = todosItens.filter(it => it.separado).length;
    const pendentes  = todosItens.filter(it => !it.separado && standByInfo(it, f.data) === null);
    const pct        = total > 0 ? Math.round((sepCount / total) * 100) : 0;
    const completo   = pct === 100;

    const MAX_SHOW = 8;
    const mostrar  = pendentes.slice(0, MAX_SHOW);
    const resto    = pendentes.length - MAX_SHOW;

    return `
      <div class="tv-festa-card">
        <div class="tv-festa-nome">${f.nome}</div>
        <div class="tv-festa-meta">${f.cliente}${f.hora ? ' · ' + f.hora : ''}</div>
        ${f.colaborador ? `<div><span class="tv-separador-badge">👤 ${f.colaborador}</span></div>` : ''}
        <div class="tv-progresso-barra-wrap">
          <div class="tv-progresso-barra${completo ? ' completo' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="tv-progresso-label">${sepCount} de ${total} itens separados — ${pct}%</div>
        ${pendentes.length > 0 ? `
          <div class="tv-pendentes-titulo">Pendentes (${pendentes.length}):</div>
          <ul class="tv-pendentes-lista">
            ${mostrar.map(it => `<li>${nomeBasDisplay(it.nome)} — ${it.qtdNecessaria} ${it.unidade || 'un'}</li>`).join('')}
            ${resto > 0 ? `<li style="color:#475569;font-size:11px">... e mais ${resto} itens</li>` : ''}
          </ul>
        ` : `<div class="tv-tudo-separado">✓ Todos os itens separados!</div>`}
      </div>
    `;
  }).join('');
}

function _tvRenderProducao(producao) {
  const el = document.getElementById('tv-producao');
  if (!el) return;

  if (!producao.length) {
    el.innerHTML = '<div class="tv-vazio">Nenhum item de produção pendente</div>';
    return;
  }

  /* Enriquecer com dados de estoque e grupo do cadastro */
  const itens = producao.map(p => {
    const est    = estoqueCache[p.nomeKey] || estoqueCache[nomeBaseKey(p.nomeKey)] || {};
    const qtdEst = est.qtd || 0;
    const falta  = p.total - qtdEst;
    const pct    = p.total > 0 ? Math.min(100, Math.round((qtdEst / p.total) * 100)) : 100;
    const cfg    = buscarConfigItem(p.nomeKey);
    const grupo  = cfg?.grupo || p.grupo || 'Geral';
    return { ...p, qtdEst, falta, pct, grupo };
  });

  /* Dentro de cada grupo: falta sem compra → aguardando chegada → ok */
  const grupos = {};
  itens.forEach(p => {
    const g = p.grupo || 'Geral';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(p);
  });
  const _prioridade = p => {
    const baseKey = nomeBaseKey(p.nomeKey);
    const temCompra = comprasCache.some(c =>
      (c.nomeKey === p.nomeKey || c.nomeKey === baseKey) &&
      (c.status === 'pendente' || c.status === 'pedido')
    );
    if (p.falta > 0 && !temCompra) return 0;  // urgente
    if (p.falta > 0 && temCompra)  return 1;  // aguardando chegada
    return 2;                                  // ok
  };
  Object.values(grupos).forEach(arr => arr.sort((a, b) => _prioridade(a) - _prioridade(b) || b.falta - a.falta));

  const renderItem = p => {
    const baseKey = nomeBaseKey(p.nomeKey);
    const compra  = comprasCache.find(c =>
      (c.nomeKey === p.nomeKey || c.nomeKey === baseKey) &&
      (c.status === 'pendente' || c.status === 'pedido')
    );

    if (p.falta > 0 && compra) {
      /* Falta, mas há compra em andamento — aguardando chegada */
      const statusLabel = compra.status === 'pedido' ? 'Pedido feito' : 'Compra solicitada';
      return `
        <div class="tv-prod-item tv-prod-aguardando">
          <div class="tv-prod-item-topo">
            <div class="tv-prod-nome">${p.nome}</div>
            <div style="text-align:right">
              <div class="tv-prod-falta-num" style="color:#1d4ed8">${compra.qtdSolicitada}</div>
              <div class="tv-prod-falta-label" style="color:#1d4ed8">${p.unidade} a chegar</div>
            </div>
          </div>
          <div class="tv-prod-detalhe">Estoque: ${p.qtdEst} &nbsp;|&nbsp; Falta: ${p.falta}</div>
          <div class="tv-prod-aguardando-label">🚚 ${statusLabel} — aguardando chegada</div>
          <div class="tv-prod-barra-wrap"><div class="tv-prod-barra-fill tv-prod-barra-aguardando" style="width:${p.pct}%"></div></div>
        </div>`;
    }

    if (p.falta > 0) {
      /* Falta e sem compra registrada */
      return `
        <div class="tv-prod-item tv-prod-falta">
          <div class="tv-prod-item-topo">
            <div class="tv-prod-nome">${p.nome}</div>
            <div style="text-align:right">
              <div class="tv-prod-falta-num">${p.falta}</div>
              <div class="tv-prod-falta-label">${p.unidade} falta</div>
            </div>
          </div>
          <div class="tv-prod-detalhe">Estoque: ${p.qtdEst}</div>
          <div class="tv-prod-barra-wrap"><div class="tv-prod-barra-fill deficit" style="width:${p.pct}%"></div></div>
        </div>`;
    }

    /* Estoque ok */
    return `
      <div class="tv-prod-item">
        <div class="tv-prod-item-topo">
          <div class="tv-prod-nome">${p.nome}</div>
          <div style="text-align:right">
            <div class="tv-prod-qty">${p.total}</div>
            <div class="tv-prod-ok-label">✓ ok</div>
          </div>
        </div>
        <div class="tv-prod-detalhe">Estoque: ${p.qtdEst}</div>
        <div class="tv-prod-barra-wrap"><div class="tv-prod-barra-fill" style="width:${p.pct}%"></div></div>
      </div>`;
  };

  const ordemGrupos = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  el.innerHTML = ordemGrupos.map(g => `
    <div class="tv-prod-grupo">
      <div class="tv-prod-grupo-header">${g}</div>
      ${grupos[g].map(renderItem).join('')}
    </div>
  `).join('');
}

function _tvRenderEstoque(producao) {
  const el = document.getElementById('tv-estoque');
  if (!el) return;

  if (!producao.length) {
    el.innerHTML = '<div class="tv-vazio">Sem itens de produção</div>';
    return;
  }

  const itens = producao.map(p => {
    const baseKey = nomeBaseKey(p.nomeKey || normalizarNomeItem(p.nome));
    const est     = estoqueCache[baseKey] || estoqueCache[p.nomeKey] || {};
    const qtdEst  = est.qtd || 0;
    const falta   = p.total - qtdEst;
    return { ...p, qtdEst, falta };
  }).sort((a, b) => b.falta - a.falta);

  const comFalta = itens.filter(p => p.falta > 0);
  const okItems  = itens.filter(p => p.falta <= 0);

  const renderItem = (p) => {
    if (p.falta > 0) {
      return `
        <div class="tv-est-item">
          <div class="tv-est-nome">${p.nome}</div>
          <div class="tv-est-nums">
            <span>Pedido: <strong>${p.total}</strong></span>
            <span>Estoque: <strong>${p.qtdEst}</strong></span>
          </div>
          <div style="display:flex;align-items:baseline;gap:4px">
            <div class="tv-est-produzir">${p.falta}</div>
            <div class="tv-est-produzir-label">${p.unidade} a produzir</div>
          </div>
        </div>`;
    }
    return `
      <div class="tv-est-item" style="border-left-color:#15803d;background:#F0FDF4">
        <div class="tv-est-nome">${p.nome}</div>
        <div class="tv-est-nums">
          <span>Pedido: <strong>${p.total}</strong></span>
          <span>Estoque: <strong>${p.qtdEst}</strong></span>
        </div>
        <div class="tv-est-ok">OK</div>
      </div>`;
  };

  el.innerHTML = (comFalta.length ? `<div class="tv-secao-titulo">FALTAM (${comFalta.length})</div>` + comFalta.map(renderItem).join('') : '')
               + (okItems.length  ? `<div class="tv-secao-titulo">OK (${okItems.length})</div>`      + okItems.map(renderItem).join('')  : '');
}

function _tvRenderAgenda(agendadasHoje, atrasadas, proximas, hojeKey) {
  const el = document.getElementById('tv-agenda');
  if (!el) return;

  let html = '';

  if (atrasadas.length) {
    html += `<div class="tv-secao-titulo">⚠ Atrasadas (${atrasadas.length})</div>`;
    html += atrasadas.map(f => {
      const pend = (f.itens || []).filter(it => deveExibirNaSeparacao(it) && !it.separado).length;
      return `
        <div class="tv-agenda-item urgente">
          <span class="tv-agenda-badge urgente">ATRASADA · ${formatarData(f.data)}</span>
          <div class="tv-agenda-nome">${f.nome}</div>
          <div class="tv-agenda-meta">${f.cliente}${f.hora ? ' · ' + f.hora : ''} · ${pend} pendentes</div>
        </div>
      `;
    }).join('');
  }

  if (agendadasHoje.length) {
    html += `<div class="tv-secao-titulo">Hoje (${agendadasHoje.length})</div>`;
    html += agendadasHoje.map(f => {
      const total = (f.itens || []).filter(it => deveExibirNaSeparacao(it)).length;
      return `
        <div class="tv-agenda-item hoje">
          <span class="tv-agenda-badge hoje">HOJE${f.hora ? ' · ' + f.hora : ''}</span>
          <div class="tv-agenda-nome">${f.nome}</div>
          <div class="tv-agenda-meta">${f.cliente} · ${total} itens</div>
        </div>
      `;
    }).join('');
  }

  if (proximas.length) {
    const amanhaDate = new Date(); amanhaDate.setDate(amanhaDate.getDate() + 1);
    const amanhaKey  = normalizarData(amanhaDate);
    html += `<div class="tv-secao-titulo">Próximas</div>`;
    html += proximas.map(f => {
      const fKey     = normalizarData(f.data);
      const isAmanha = fKey === amanhaKey;
      return `
        <div class="tv-agenda-item">
          <span class="tv-agenda-badge ${isAmanha ? 'amanha' : 'futuro'}">${isAmanha ? 'AMANHÃ' : formatarData(f.data)}</span>
          <div class="tv-agenda-nome">${f.nome}</div>
          <div class="tv-agenda-meta">${f.cliente}${f.hora ? ' · ' + f.hora : ''}</div>
        </div>
      `;
    }).join('');
  }

  if (!html) html = '<div class="tv-vazio">Nenhuma festa agendada</div>';
  el.innerHTML = html;
}

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

  const telasAuth      = ['tela-setup', 'tela-login', 'tela-tv'];
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

  /* Menu button: visível apenas para CEO em telas autenticadas */
  const btnMenu = document.getElementById('btn-menu');
  if (btnMenu) {
    const ehCeo = usuarioAtual &&
      (usuarioAtual.roles || [usuarioAtual.role || '']).includes('ceo');
    if (!telasAuth.includes(id) && ehCeo) {
      btnMenu.classList.remove('hidden');
    } else {
      btnMenu.classList.add('hidden');
    }
  }

  window.scrollTo(0, 0);
}

function navegar(id, subtitulo = '') {
  historico.push(id);
  mostrarTela(id, subtitulo);
}

function goBack() {
  /* Ao sair da edição (cancelar), libera o separador */
  const atual = historico[historico.length - 1];
  if (atual === 'tela-editar-festa' && festaEditandoId) {
    atualizarFesta(festaEditandoId, { editandoAgora: null }).catch(() => {});
  }

  historico.pop();
  const anterior = historico[historico.length - 1];
  if (anterior) {
    if (anterior === 'tela-lista-festas') {
      mostrarTela('tela-lista-festas', subtituloListaFestas());
      if (!unsubFestas) carregarCEO(); else atualizarVisaoCEO();
    } else {
      mostrarTela(anterior);
      if (anterior === 'tela-ceo')                  carregarCEO();
      if (anterior === 'tela-colaborador')          carregarColab();
      if (anterior === 'tela-coordenador')          carregarCoord(filtroAtualCoord);
      if (anterior === 'tela-usuarios')             carregarUsuarios();
      if (anterior === 'tela-historico-contagem')   abrirHistoricoContagem();
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
    initSidebarPin();
    mostrarTela('tela-ceo');
    carregarCEO();
  } else if (papel === 'coordenador') {
    mostrarTela('tela-coordenador');
    carregarCoord(filtroAtualCoord);
  } else if (papel === 'tv') {
    mostrarTela('tela-tv');
    carregarTV();
  } else {
    /* separador, colaborador ou qualquer outro papel */
    mostrarTela('tela-colaborador');
    carregarColab();
  }
}

function pararListeners() {
  if (unsubFestas) { unsubFestas(); unsubFestas = null; }
  if (unsubFesta)  { unsubFesta();  unsubFesta  = null; }
  _tvPararAutoScroll();
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

const ROLE_NOMES = { separador: 'Separador', coordenador: 'Coordenador', ceo: 'CEO / Administrador', tv: 'Painel TV' };

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
  if (_tvClockTimer) { clearInterval(_tvClockTimer); _tvClockTimer = null; }
  usuarioAtual = null;
  festaAtual   = null;
  fotosCache   = { separacao: [], conferencia: [], retorno: [], galpao: [] };
  historico    = [];
  /* Fechar e desafixar sidebar */
  sidebarPinada = false;
  const sb = document.getElementById('sidebar');
  if (sb) sb.classList.remove('aberto', 'pinada');
  const ov = document.getElementById('sidebar-overlay');
  if (ov) ov.classList.add('hidden');
  document.body.classList.remove('sidebar-pinada');
  document.body.style.overflow = '';
  document.getElementById('login-nome').value  = '';
  document.getElementById('login-senha').value = '';
  document.getElementById('login-erro').classList.add('hidden');
  mostrarTela('tela-login');
}

/* ══════════════════════════════════════════════════
   CEO — DASHBOARD
══════════════════════════════════════════════════ */

async function carregarCEO() {
  pararListeners();

  try {
    const [configs, est, cats] = await Promise.all([
      listarItemConfigs(), buscarEstoque(), listarCategorias(),
    ]);
    itemConfigsCache = {};
    configs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
    estoqueCache    = est;
    categoriasCache = cats;
  } catch(e) { console.error('Erro ao carregar dados iniciais:', e); }

  unsubFestas = escutarFestas({}, festas => {
    todasFestasCache = festas;
    renderizarStatsCEO(festas);
    renderizarAgendaStripCEO(festas);
    renderizarProducaoCEO();
    atualizarBadgeCompras();
  });
}

function renderizarStatsCEO(festas) {
  const c = s => festas.filter(f => f.status === s).length;
  const cores  = { agendada:'#0284C7', separando:'#D97706', conferencia:'#1D4ED8', festa:'#7C3AED', retorno:'#DC2626', galpao:'#78716C', concluida:'#166534' };
  const nomes  = { agendada:'Agendadas', separando:'Separando', conferencia:'Conferência', festa:'Em Festa', retorno:'Retorno', galpao:'Galpão', concluida:'Concluídas' };
  const status = ['agendada','separando','conferencia','festa','retorno','galpao','concluida'];

  /* Stats agora ficam no sidebar */
  const sidebarStats = document.getElementById('sidebar-stats');
  if (sidebarStats) {
    sidebarStats.innerHTML = status.map(s => `
      <div class="sidebar-stat">
        <div class="sidebar-stat-num" style="color:${cores[s]}">${c(s)}</div>
        <div class="sidebar-stat-label">${nomes[s]}</div>
      </div>
    `).join('');
  }

  renderizarTiraData(festas);
  renderizarSidebarAgenda(festas);
  renderizarAlertaHoje(festas, 'alerta-hoje-ceo');
}

/* ═══════════════════════════════════════════════════════════
   ALERTA — Festas hoje com itens pendentes de separação
═══════════════════════════════════════════════════════════ */

function renderizarAlertaHoje(festas, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const hojeKey = normalizarData(new Date());

  /* Festas cuja data é HOJE e que ainda estão em separação pendente */
  const festasHoje = festas.filter(f => {
    const fKey = normalizarData(f.data);
    return fKey === hojeKey && (f.status === 'agendada' || f.status === 'separando');
  });

  /* Festas atrasadas (data passada, ainda não separadas) */
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const festasAtrasadas = festas.filter(f => {
    if (normalizarData(f.data) === hojeKey) return false;
    const fd = toDate(f.data);
    fd.setHours(0, 0, 0, 0);
    return fd < hoje && (f.status === 'agendada' || f.status === 'separando');
  });

  const urgentes = [...festasHoje, ...festasAtrasadas];
  if (!urgentes.length) {
    el.innerHTML = '';
    atualizarMenuBadge(0);
    return;
  }

  /* Contar itens pendentes por festa — excluindo itens ocultos da separação */
  const itens = urgentes.map(f => {
    const visiveis   = (f.itens || []).filter(it => deveExibirNaSeparacao(it));
    const totalItens = visiveis.length;
    const pendentes  = visiveis.filter(it => !it.separado).length;
    const atrasada   = normalizarData(f.data) !== hojeKey;
    return { f, totalItens, pendentes, atrasada };
  });

  const totalPendentes = itens.reduce((s, x) => s + x.pendentes, 0);
  atualizarMenuBadge(totalPendentes);

  const titulo = festasHoje.length === 1
    ? `1 Festa hoje — itens a separar!`
    : festasHoje.length > 1
      ? `${festasHoje.length} Festas hoje — itens a separar!`
      : `${festasAtrasadas.length} Festa(s) atrasada(s) pendente(s)!`;

  el.innerHTML = `
    <div class="alerta-hoje">
      <div class="alerta-hoje-titulo">
        <span class="alerta-icone">🚨</span>
        <span>${titulo}</span>
      </div>
      <div class="alerta-hoje-lista">
        ${itens.map(({ f, totalItens, pendentes, atrasada }) => {
          const dataFmt = formatarData(f.data);
          const sub     = atrasada ? `Atrasada — ${dataFmt}` : formatarData(f.data);
          const btnLabel = pendentes === 0 ? 'Ver Festa' : 'Ir Separar';
          const btnClass = pendentes === 0 ? 'alerta-hoje-btn concluida' : 'alerta-hoje-btn';
          const badgeClass = pendentes === 0 ? 'alerta-hoje-badge zero' : 'alerta-hoje-badge';
          const badgeLabel = pendentes === 0
            ? '✓ Separado'
            : `${pendentes} de ${totalItens} pendente${pendentes !== 1 ? 's' : ''}`;
          return `
            <div class="alerta-hoje-item">
              <div class="alerta-hoje-info">
                <div class="alerta-hoje-nome">${f.nome || f.tipo || 'Festa'}</div>
                <div class="alerta-hoje-sub">${sub}${f.hora ? ' · ' + f.hora : ''}</div>
              </div>
              <span class="${badgeClass}">${badgeLabel}</span>
              <button class="${btnClass}" onclick="abrirSeparacao('${f.id}')">${btnLabel}</button>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function atualizarMenuBadge(total) {
  const badge = document.getElementById('menu-badge');
  if (!badge) return;
  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : total;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* Cards de agenda compactos no topo da tela-ceo */
function renderizarAgendaStripCEO(festas) {
  const el = document.getElementById('producao-agenda-strip');
  if (!el) return;

  const ativas = festas.filter(f => f.status !== 'concluida');

  /* Agrupar por dia */
  const porDia = {};
  ativas.forEach(f => {
    const key = normalizarData(f.data);
    if (!key) return;
    if (!porDia[key]) porDia[key] = { key, festas: [] };
    porDia[key].festas.push(f);
  });

  const dias = Object.keys(porDia).sort();
  if (!dias.length) { el.innerHTML = ''; return; }

  const hojeKey   = normalizarData(new Date());
  const MESES     = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DIAS_SEM  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  el.innerHTML = dias.map(d => {
    const dt    = new Date(d + 'T12:00:00');
    const num   = String(dt.getDate()).padStart(2,'0');
    const mes   = MESES[dt.getMonth()];
    const sem   = DIAS_SEM[dt.getDay()];
    const qtd   = porDia[d].festas.length;
    const isHj  = d === hojeKey;
    const status= [...new Set(porDia[d].festas.map(f => f.status))];

    return `
      <button class="agenda-card${isHj ? ' agenda-card-hoje' : ''}"
        onclick="navegarSidebar(); filtrarPorData('${d}', null)">
        <div class="agenda-card-dia">${num}</div>
        <div class="agenda-card-mes">${mes}</div>
        <div class="agenda-card-sem">${sem}</div>
        <div class="agenda-card-qtd">${qtd} festa${qtd !== 1 ? 's' : ''}</div>
        ${isHj ? '<div class="agenda-card-hoje-label">Hoje</div>' : ''}
      </button>
    `;
  }).join('');
}

/* Aplica filtro de status + filtro de data + busca e re-renderiza a lista */
function atualizarVisaoCEO() {
  const porStatus = filtroAtualCEO === 'todas'
    ? todasFestasCache
    : todasFestasCache.filter(f => f.status === filtroAtualCEO);

  const porData = filtroData
    ? porStatus.filter(f => normalizarData(f.data) === filtroData)
    : porStatus;

  const busca = _buscaFestas.toLowerCase().trim();
  const lista = busca
    ? porData.filter(f =>
        (f.nome   || '').toLowerCase().includes(busca) ||
        (f.cliente || '').toLowerCase().includes(busca))
    : porData;

  document.getElementById('ceo-lista').innerHTML = lista.length
    ? lista.map(f => htmlCardFesta(f, 'ceo')).join('')
    : estadoVazio('Nenhuma festa encontrada.');
}

function filtrarFestas(valor) {
  _buscaFestas = valor;
  atualizarVisaoCEO();
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
    renderizarAlertaHoje(festas, 'alerta-hoje-colab');
  });
}

async function abrirSeparacao(id) {
  pararListeners();
  fotosCache.separacao = [];
  document.getElementById('preview-sep').innerHTML = '';
  document.getElementById('sep-obs').value = '';
  pararTimers();

  historico = ['tela-colaborador'];
  mostrarTela('tela-separacao', 'Separação');

  /* Garantir que configs e categorias estejam carregados (necessário para filtro de separação e stand-by) */
  if (!Object.keys(itemConfigsCache).length) {
    try {
      const [cfgs, cats] = await Promise.all([listarItemConfigs(), listarCategorias()]);
      itemConfigsCache = {};
      cfgs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
      categoriasCache = cats;
    } catch(e) { console.error('Erro ao carregar configs de item:', e); }
  }

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
    <div class="card-iniciar-sep" onclick="confirmarInicioSeparacao()">
      <div class="card-iniciar-sep-icone">▶</div>
      <div class="card-iniciar-sep-texto">Iniciar Separação</div>
    </div>
  `;
  /* Ocultar tudo que não deve aparecer antes de iniciar */
  document.querySelector('.sep-agrupamento-bar').style.display = 'none';
  document.getElementById('sep-fotos-section').style.display  = 'none';
  document.getElementById('sep-obs-section').style.display    = 'none';
}

async function confirmarInicioSeparacao() {
  if (!festaAtual) return;
  try {
    await iniciarSeparacao(festaAtual.id, usuarioAtual.nome);
    /* Reexibir seções ocultadas */
    document.querySelector('.sep-agrupamento-bar').style.display = '';
    document.getElementById('sep-fotos-section').style.display  = '';
    document.getElementById('sep-obs-section').style.display    = '';
    /* O listener do escutarFesta vai re-renderizar automaticamente com status 'separando' */
  } catch (e) {
    console.error(e);
    toast('Erro ao iniciar separacao.', 'erro');
  }
}

function renderizarSeparacao(festa) {
  document.getElementById('sep-info').innerHTML = htmlInfoFesta(festa);

  /* Bloquear separador enquanto admin edita quantidades */
  if (festa.editandoAgora) {
    document.getElementById('sep-itens').innerHTML = `
      <div class="aviso-editando">
        <div class="aviso-editando-icone">✏️</div>
        <strong>${festa.editandoAgora} está editando as quantidades</strong>
        <p>Aguarde enquanto o administrador finaliza as alterações. A tela será atualizada automaticamente.</p>
      </div>
    `;
    return;
  }

  const alteracoes = festa.alteracoes || [];
  let avisoHTML = '';
  if (alteracoes.length > 0) {
    const ultima = alteracoes[alteracoes.length - 1];
    const detalhes = (ultima.campos || [])
      .filter(c => c.campo !== 'Data' && c.campo !== 'Horario')
      .map(c => `${c.campo}: ${c.de} → ${c.para}`)
      .join(', ');
    const quando = ultima.alteradoEm
      ? new Date(ultima.alteradoEm).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '';
    avisoHTML = `
      <div class="aviso-alteracao">
        <strong>⚠ Quantidades alteradas pelo administrador</strong>
        <p>${ultima.alteradoPor}${quando ? ' em ' + quando : ''}${detalhes ? ': ' + detalhes : ''}. Verifique os itens antes de continuar.</p>
      </div>
    `;
  }

  const itens = festa.itens || [];
  if (!itens.length) {
    document.getElementById('sep-itens').innerHTML = avisoHTML + estadoVazio('Nenhum item cadastrado nesta festa.');
    return;
  }

  const tab          = window._tabSep || 'pendente';
  const todos        = itens.map((item, i) => ({ ...item, _i: i }));
  const ocultos      = todos.filter(it => !deveExibirNaSeparacao(it));
  const comIdx       = todos.filter(it =>  deveExibirNaSeparacao(it));
  const separados    = comIdx.filter(it =>  it.separado);
  const naoSeparados = comIdx.filter(it => !it.separado);
  const standBy      = naoSeparados.filter(it => standByInfo(it, festa.data) !== null);
  const pendentes    = naoSeparados.filter(it => standByInfo(it, festa.data) === null);

  /* Preservar texto da busca em re-renders automáticos */
  const buscaAtual = document.getElementById('busca-sep-input')?.value || '';

  const standByProd  = standBy.filter(it => standByInfo(it, festa.data)?.tipo === 'producao');
  const standByFrig  = standBy.filter(it => standByInfo(it, festa.data)?.tipo === 'refrigerado');

  const htmlStandBy = standBy.length ? `
    <div class="standby-section">
      ${standByProd.length ? `
        <div class="standby-section-titulo">Produção — Separar no dia do evento</div>
        ${standByProd.map(it => {
          const info = standByInfo(it, festa.data);
          return `
            <div class="item-standby-card producao-bloqueada">
              <span class="item-standby-icone" style="display:none"></span>
              <div class="item-standby-corpo">
                <div class="item-standby-nome">${it.nome}</div>
                <div class="item-standby-msg">${info.msg} &mdash; Qtd: <strong>${it.qtdNecessaria}</strong> ${it.unidade || 'un'}</div>
              </div>
            </div>
          `;
        }).join('')}
      ` : ''}
      ${standByFrig.length ? `
        <div class="standby-section-titulo">&#10052; Refrigerados — Stand-by</div>
        ${standByFrig.map(it => {
          const info = standByInfo(it, festa.data);
          return `
            <div class="item-standby-card">
              <span class="item-standby-icone">&#10052;</span>
              <div class="item-standby-corpo">
                <div class="item-standby-nome">${it.nome}</div>
                <div class="item-standby-msg">${info.msg} &mdash; Qtd: <strong>${it.qtdNecessaria}</strong> ${it.unidade || 'un'}</div>
              </div>
            </div>
          `;
        }).join('')}
      ` : ''}
    </div>
  ` : '';

  const avisoOcultos = ocultos.length
    ? `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px;color:#6B7280;">
        ${ocultos.length} item(s) oculto(s) da separação (Equipe / Coquetéis): ${ocultos.map(i=>i.nome).join(', ')}
       </div>`
    : '';

  document.getElementById('sep-itens').innerHTML = avisoHTML + avisoOcultos + `
    <div class="busca-sep-wrap">
      <input type="search" id="busca-sep-input" class="busca-sep"
        placeholder="Pesquisar item..."
        oninput="filtrarItensSep(this.value)"
        value="${buscaAtual.replace(/"/g, '&quot;')}" />
    </div>
    <button class="btn-confirmar btn-full" style="margin:10px 0" onclick="concluirSeparacao()">Finalizar Separação</button>
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
        ? htmlItensPorGrupo(pendentes, 'pendente')
        : '<p class="vazio-sep">Todos os itens foram separados.</p>'}
      ${tab === 'pendente' ? htmlStandBy : ''}
    </div>
    <div id="sep-lista-separado" ${tab !== 'separado' ? 'class="hidden"' : ''}>
      ${separados.length
        ? htmlItensPorGrupo(separados, 'separado')
        : '<p class="vazio-sep">Nenhum item separado ainda.</p>'}
    </div>
  `;

  if (buscaAtual) filtrarItensSep(buscaAtual);
}

function htmlBadgeForn(item) {
  const forn = item.fornecimento || extrairFornDoNome(item.nome);
  if (!forn) return '';
  const cls = ['consignado','cliente','romero','reserva','proprio','terceiro'].includes(forn)
    ? `forn-card-${forn}` : 'forn-card-default';
  return `<div class="forn-card ${cls}"><span class="forn-card-label">Fornecimento</span><span class="forn-card-valor">${forn}</span></div>`;
}

function htmlItemPendente(item, i) {
  const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
  const locParts = [cfg?.setor, cfg?.prateleira].filter(Boolean);
  const locHtml  = locParts.length
    ? `<div class="item-localizacao"><span class="item-localizacao-icone">📍</span>${locParts.join(' / ')}</div>`
    : '';
  const badgeForn = htmlBadgeForn(item);
  return `
    <div class="item-pend-card">
      <div class="item-pend-esquerda">
        <div class="item-pend-info">
          <div class="item-nome">
            ${nomeBasDisplay(item.nome)}
            <button class="btn-editar-nome" title="Substituir / editar nome" onclick="editarNomeItem(${i})">✏️</button>
          </div>
          ${badgeForn || ''}
          <div class="item-sub">${item.unidade || 'un'} &mdash; total: <strong>${item.qtdNecessaria}</strong></div>
          ${locHtml}
        </div>
        <div class="item-pend-acoes">
          <div class="qty-ajuste-wrap">
            <button class="btn-qty" onclick="ajustarQty(${i},-1)">&#8722;</button>
            <input type="number" id="qty-ajuste-${i}" class="qty-ajuste"
              value="${item.qtdNecessaria}" min="0" />
            <button class="btn-qty" onclick="ajustarQty(${i},1)">&#43;</button>
          </div>
        </div>
      </div>
      <button class="btn-separar"
        onpointerdown="iniciarHoldSepara(this,${i})"
        onpointerup="cancelarHoldSepara(this)"
        onpointercancel="cancelarHoldSepara(this)"
        onpointerleave="cancelarHoldSepara(this)">Separar</button>
    </div>
  `;
}

function htmlItemSeparado(item, i) {
  const badgeForn = htmlBadgeForn(item);
  const parcial   = (item.qtdSeparada ?? 0) < (item.qtdNecessaria ?? 0);
  return `
    <div class="item-sep-card${parcial ? ' item-sep-parcial' : ''}">
      <div class="item-pend-info">
        <div class="item-nome">${nomeBasDisplay(item.nome)}</div>
        ${badgeForn || ''}
        <div class="item-sub">
          Separado: <strong>${item.qtdSeparada}</strong> de <strong>${item.qtdNecessaria}</strong> ${item.unidade || 'un'}
          ${parcial ? '<span class="badge-parcial">⚠ Parcial</span>' : ''}
        </div>
      </div>
      <button class="btn-desfazer" onclick="desfazerItem(${i})">Desfazer</button>
    </div>
  `;
}

function mudarTabSep(tab) {
  window._tabSep = tab;
  if (festaAtual) renderizarSeparacao(festaAtual);
}

function trocarModoGrupoSep(modo, btn) {
  modoGrupoSep = modo;
  document.querySelectorAll('.sep-agrup-tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  if (festaAtual) renderizarSeparacao(festaAtual);
}

/* Agrupa array de itens por campo de config (grupo ou setor); preserva ordem das categorias */
function htmlItensPorGrupo(itens, tipo) {
  if (modoGrupoSep === 'nenhum') {
    return itens.map(it => tipo === 'pendente'
      ? htmlItemPendente(it, it._i)
      : htmlItemSeparado(it, it._i)
    ).join('');
  }

  const campo = modoGrupoSep === 'setor' ? 'setor' : 'grupo';

  /* Montar grupos preservando a ordem das categorias */
  const gruposOrdem = [];
  const gruposMap   = {};
  itens.forEach(it => {
    const cfg = buscarConfigItem(normalizarNomeItem(it.nome));
    /* Prioridade: 1) config.grupo/setor  2) item.categoria (backfill/PDF)  3) fallback */
    let nome = (cfg && cfg[campo])
      || (campo === 'grupo' ? (it.categoria || 'Sem Categoria') : 'Sem Setor');
    if (!gruposMap[nome]) {
      gruposMap[nome] = [];
      gruposOrdem.push(nome);
    }
    gruposMap[nome].push(it);
  });

  /* Ordenar pelo índice de categoria (se modo categoria) */
  if (modoGrupoSep === 'categoria') {
    gruposOrdem.sort((a, b) => {
      const oa = categoriasCache.find(c => c.nome === a)?.ordem ?? 999;
      const ob = categoriasCache.find(c => c.nome === b)?.ordem ?? 999;
      return oa - ob;
    });
  }

  return gruposOrdem.map(nome => {
    const lista = gruposMap[nome];
    const html  = lista.map(it => tipo === 'pendente'
      ? htmlItemPendente(it, it._i)
      : htmlItemSeparado(it, it._i)
    ).join('');
    return `
      <div class="sep-grupo-header">
        <span class="sep-grupo-nome">${nome}</span>
        <span class="sep-grupo-badge">${lista.length} item${lista.length !== 1 ? 'ns' : ''}</span>
      </div>
      ${html}
    `;
  }).join('');
}

function ajustarQty(i, delta) {
  const input = document.getElementById(`qty-ajuste-${i}`);
  if (!input) return;
  input.value = Math.max(0, (parseFloat(input.value) || 0) + delta);
}

/* ── Hold-to-confirm no botão Separar ── */
let _holdTimer = null;

function iniciarHoldSepara(btn, i) {
  btn.classList.add('hold-progress');
  _holdTimer = setTimeout(() => {
    _holdTimer = null;
    btn.classList.remove('hold-progress');
    separarItem(i);
  }, 1000);
}

function cancelarHoldSepara(btn) {
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
  btn.classList.remove('hold-progress');
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
  /* Itens em stand-by e itens ocultos da separação (equipe/coquetéis) não bloqueiam a conclusão */
  const pendentes  = itens.filter(it =>
    !it.separado &&
    standByInfo(it, festaAtual.data) === null &&
    deveExibirNaSeparacao(it)
  );
  if (pendentes.length > 0) {
    toast(`Ainda há ${pendentes.length} item(ns) pendente(s). Separe todos antes de finalizar.`, 'erro');
    window._tabSep = 'pendente';
    renderizarSeparacao(festaAtual);
    return;
  }

  /* Aviso de separações parciais */
  const parciais = itens.filter(it =>
    it.separado && (it.qtdSeparada ?? 0) < (it.qtdNecessaria ?? 0)
  );
  if (parciais.length > 0) {
    const lista = parciais.map(it =>
      `• ${nomeBasDisplay(it.nome)}: ${it.qtdSeparada}/${it.qtdNecessaria} ${it.unidade || 'un'}`
    ).join('\n');
    if (!confirm(`${parciais.length} item(ns) com separação parcial:\n\n${lista}\n\nDeseja finalizar mesmo assim?`)) return;
  }

  const btn = document.querySelector('#sep-itens .btn-confirmar');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }

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
    if (btn) { btn.disabled = false; btn.textContent = 'Finalizar Separação'; }
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

function formatarDataHora(val) {
  if (!val) return '—';
  return toDate(val).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
}

function formatarDuracao(inicio, fim) {
  const seg = Math.max(0, Math.floor((( fim ? toDate(fim) : new Date()) - toDate(inicio)) / 1000));
  const h   = Math.floor(seg / 3600);
  const m   = Math.floor((seg % 3600) / 60);
  if (h > 0) return `${h}h ${m}min`;
  if (m > 0) return `${m}min`;
  return `${seg}s`;
}

async function mudarStatusFesta(id, novoStatus) {
  const label = STATUS_LABELS[novoStatus] || novoStatus;

  if (novoStatus === 'agendada') {
    if (!confirm('Retornar para "Agendada" vai apagar TODOS os dados de separação, conferência e retorno desta festa. Deseja continuar?')) return;
    try {
      const itensReset = (festaAtual?.itens || []).map(it => ({
        id:            it.id,
        nome:          it.nome,
        categoria:     it.categoria     || '',
        fornecimento:  it.fornecimento  || '',
        qtdNecessaria: it.qtdNecessaria || 0,
        unidade:       it.unidade       || 'un',
        separado:      false,
        qtdSeparada:   0,
        qtdConferida:  0,
        qtdRetorno:    0,
        qtdGalpao:     0,
        qtdDanificada: 0,
      }));
      await resetarParaAgendada(id, itensReset);
      toast(`Festa retornada para "${label}" e dados de processo apagados.`, 'sucesso');
    } catch(e) {
      console.error(e);
      toast('Erro ao resetar festa.', 'erro');
    }
    return;
  }

  try {
    await atualizarFesta(id, { status: novoStatus });
    toast(`Status alterado para "${label}".`, 'sucesso');
  } catch(e) {
    console.error(e);
    toast('Erro ao alterar status.', 'erro');
    if (festaAtual) renderizarDetalhe(festaAtual);
  }
}

function filtrarItensSep(q) {
  const termo = q.trim().toLowerCase();
  document.querySelectorAll('.item-pend-card, .item-sep-card').forEach(card => {
    const nome = card.querySelector('.item-nome')?.textContent.toLowerCase() || '';
    card.style.display = (!termo || nome.includes(termo)) ? '' : 'none';
  });
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

/* Retorna a tela-lista do papel ativo (CEO → tela-ceo, coord → tela-coordenador) */
function telaListaAtual() {
  const roles = usuarioAtual?.roles || [usuarioAtual?.role || ''];
  return roles.includes('ceo') ? 'tela-ceo' : 'tela-coordenador';
}

/* ── CONFERÊNCIA ── */
async function abrirConferencia(id) {
  pararListeners();
  fotosCache.conferencia = [];
  fotosCache.confItens   = {};
  document.getElementById('preview-conf').innerHTML = '';
  document.getElementById('conf-obs').value = '';

  historico = [telaListaAtual()];
  mostrarTela('tela-conferencia', 'Conferência de Chegada');

  /* Carregar configs se necessário (para saber quais itens exigem foto) */
  if (!Object.keys(itemConfigsCache).length) {
    try {
      const [cfgs, cats] = await Promise.all([listarItemConfigs(), listarCategorias()]);
      itemConfigsCache = {};
      cfgs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
      categoriasCache = cats;
    } catch(e) { console.error('Erro ao carregar configs:', e); }
  }

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarConferencia(festa);
  });
}

function renderizarConferencia(festa) {
  document.getElementById('conf-info').innerHTML = htmlInfoFesta(festa);

  const itensOcultosConf = (festa.itens || []).filter((item) => {
    const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
    return cfg && cfg.conferirCoord === false;
  });

  document.getElementById('conf-itens').innerHTML =
    (itensOcultosConf.length ? `
      <div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px;color:#6B7280;">
        ${itensOcultosConf.length} item(s) sem conferência do coordenador: ${itensOcultosConf.map(i => i.nome).join(', ')}
      </div>` : '') +
    (festa.itens || []).filter((item) => {
      const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
      return !cfg || cfg.conferirCoord !== false;
    }).map((item) => {
    const ri        = (festa.itens || []).indexOf(item);
    const cfg       = buscarConfigItem(normalizarNomeItem(item.nome));
    const exigeFoto = !!cfg?.exigeFoto;
    const temFoto   = !!(fotosCache.confItens[ri] || item.fotoConferencia);
    const fotoAreaHtml = exigeFoto ? `
      <div class="item-foto-area${temFoto ? ' ok' : ''}" id="conf-foto-area-${ri}">
        <div class="item-foto-preview">
          ${item.fotoConferencia
            ? `<img src="${item.fotoConferencia}" alt="foto">`
            : fotosCache.confItens[ri]
              ? `<img src="${URL.createObjectURL(fotosCache.confItens[ri])}" alt="foto">`
              : `<div class="item-foto-placeholder">📷</div>`}
        </div>
        <div class="item-foto-label">
          <div class="item-foto-label-titulo${temFoto ? ' ok' : ''}">${temFoto ? '✓ Foto anexada' : 'Foto obrigatória'}</div>
          <div class="item-foto-label-desc">${temFoto ? 'Toque para trocar' : 'Este item exige registro fotográfico'}</div>
        </div>
        <input type="file" id="conf-foto-input-${ri}" accept="image/*" capture="environment" style="display:none"
          onchange="onFotoItemConf(${ri}, this)" />
        <button class="btn-foto-item${temFoto ? ' ok' : ''}"
          onclick="document.getElementById('conf-foto-input-${ri}').click()">
          ${temFoto ? '✓ OK' : '📷 Anexar'}
        </button>
      </div>
    ` : '';

    const confVal  = item.qtdConferida;
    const sepVal   = item.qtdSeparada || 0;
    const msgInicial = confVal !== undefined
      ? (confVal > sepVal
          ? `<span class="msg-item msg-alerta">⚠ Quantidade acima do separado</span>`
          : confVal < sepVal
            ? `<span class="msg-item msg-erro">⚠ Quantidade abaixo do separado</span>`
            : '')
      : '';

    return `
      <div class="item-row">
        <div class="item-topo">
          <div>
            <div class="item-nome">
              ${nomeBasDisplay(item.nome)}
              <button class="btn-editar-nome" title="Editar nome" onclick="editarNomeItem(${ri})">✏️</button>
            </div>
            ${htmlBadgeForn(item) || ''}
          </div>
        </div>
        <div class="item-entrada">
          <label>Quantidade:</label>
          <input type="number" class="qty-input" id="conf-qty-${ri}"
            value="${confVal !== undefined ? confVal : ''}"
            min="0" placeholder="0"
            oninput="checarConf(${ri}, ${sepVal})" />
          <span class="item-unidade">${item.unidade || 'un'}</span>
        </div>
        <div id="conf-msg-${ri}">${msgInicial}</div>
        ${fotoAreaHtml}
      </div>
    `;
  }).join('');
}

/* Captura foto por item na conferência */
function onFotoItemConf(idx, input) {
  if (!input.files[0]) return;
  fotosCache.confItens[idx] = input.files[0];
  /* Atualizar a área de foto sem re-renderizar tudo */
  const area = document.getElementById(`conf-foto-area-${idx}`);
  if (!area) return;
  area.classList.add('ok');
  area.querySelector('.item-foto-preview').innerHTML =
    `<img src="${URL.createObjectURL(input.files[0])}" alt="foto">`;
  area.querySelector('.item-foto-label-titulo').className = 'item-foto-label-titulo ok';
  area.querySelector('.item-foto-label-titulo').textContent = '✓ Foto anexada';
  area.querySelector('.item-foto-label-desc').textContent = 'Toque para trocar';
  const btn = area.querySelector('.btn-foto-item');
  btn.className = 'btn-foto-item ok';
  btn.textContent = '✓ OK';
}

/* Edição rápida de nome de item (coordenador e separador) */
async function editarNomeItem(idx) {
  if (!festaAtual) return;
  const item = festaAtual.itens[idx];
  if (!item) return;
  const novoNome = prompt(`Alterar nome do item:\n"${item.nome}"\n\nNovo nome:`, item.nome);
  if (!novoNome || novoNome.trim() === item.nome) return;
  const novosItens = festaAtual.itens.map((it, i) =>
    i === idx ? { ...it, nome: novoNome.trim() } : it
  );
  try {
    await atualizarFesta(festaAtual.id, { itens: novosItens });
    toast('Nome atualizado.', 'sucesso');
  } catch(e) {
    console.error(e);
    toast('Erro ao atualizar nome.', 'erro');
  }
}

function checarConf(i, separado) {
  const val = parseFloat(document.getElementById(`conf-qty-${i}`).value) || 0;
  const el  = document.getElementById(`conf-msg-${i}`);
  if (val === separado) {
    el.innerHTML = '';
  } else if (val > separado) {
    el.innerHTML = `<span class="msg-item msg-alerta">⚠ Quantidade acima do separado</span>`;
  } else {
    el.innerHTML = `<span class="msg-item msg-erro">⚠ Quantidade abaixo do separado</span>`;
  }
  atualizarBoxDivConf();
}

function atualizarBoxDivConf() {
  const itens = festaAtual?.itens || [];
  const divs  = itens.map((item, i) => {
    const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
    if (cfg && cfg.conferirCoord === false) return null;
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

  /* Validar fotos obrigatórias por item (apenas itens que devem ser conferidos) */
  const semFoto = (festaAtual.itens || []).filter((item, i) => {
    const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
    if (cfg && cfg.conferirCoord === false) return false;
    return cfg?.exigeFoto && !fotosCache.confItens[i] && !item.fotoConferencia;
  });
  if (semFoto.length) {
    toast(`Foto obrigatória em: ${semFoto.map(i => i.nome).join(', ')}`, 'erro');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    /* Montar itens com qtdConferida; itens sem conferência do coord mantêm qtdSeparada */
    const itens = await Promise.all((festaAtual.itens || []).map(async (item, i) => {
      const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
      if (cfg && cfg.conferirCoord === false) {
        return { ...item, qtdConferida: item.qtdSeparada || 0 };
      }
      const qtdConferida = parseFloat(document.getElementById(`conf-qty-${i}`)?.value) || 0;
      const fotoFile     = fotosCache.confItens[i];
      let fotoConferencia = item.fotoConferencia || null;
      if (fotoFile) {
        const urls = await uploadFotos([fotoFile], festaAtual.id, `conf_item_${i}`);
        fotoConferencia = urls[0] || fotoConferencia;
      }
      return { ...item, qtdConferida, ...(fotoConferencia ? { fotoConferencia } : {}) };
    }));

    const divergencias = itens
      .filter(it => {
        const cfg = buscarConfigItem(normalizarNomeItem(it.nome));
        if (cfg && cfg.conferirCoord === false) return false;
        return it.qtdConferida !== (it.qtdSeparada || 0);
      })
      .map(it => ({ item: it.nome, separado: it.qtdSeparada || 0, conferido: it.qtdConferida }));

    let fotoUrls = [];
    if (fotosCache.conferencia.filter(Boolean).length) {
      toast('Enviando fotos gerais...', 'info');
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

  historico = [telaListaAtual()];
  mostrarTela('tela-retorno', 'Registro de Retorno');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarRetorno(festa);
  });
}

function renderizarRetorno(festa) {
  document.getElementById('ret-info').innerHTML = htmlInfoFesta(festa);

  document.getElementById('ret-itens').innerHTML = (festa.itens || []).map((item, i) => {
    const badgeForn = htmlBadgeForn(item);
    return `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${nomeBasDisplay(item.nome)}</div>
          ${badgeForn || ''}
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
  `;
  }).join('');
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

  historico = [telaListaAtual()];
  mostrarTela('tela-galpao', 'Conferência do Galpão');

  unsubFesta = escutarFesta(id, festa => {
    festaAtual = festa;
    renderizarGalpao(festa);
  });
}

function renderizarGalpao(festa) {
  document.getElementById('gal-info').innerHTML = htmlInfoFesta(festa);

  document.getElementById('gal-itens').innerHTML = (festa.itens || []).map((item, i) => {
    const badgeForn = htmlBadgeForn(item);
    return `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${nomeBasDisplay(item.nome)}</div>
          ${badgeForn || ''}
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
  `;
  }).join('');
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
      const item = {
        id:            `item-${idx}`,
        nome:          nomeItem,
        qtdNecessaria: parseFloat(inputs[1]?.value) || 0,
        unidade:       inputs[2]?.value.trim() || 'un',
        qtdSeparada:   0,
        qtdConferida:  0,
        qtdRetorno:    0,
        qtdGalpao:     0,
        qtdDanificada: 0,
      };
      /* Preservar categoria e fornecimento detectados no import de PDF */
      if (row.dataset.categoria)    item.categoria    = row.dataset.categoria;
      if (row.dataset.fornecimento) item.fornecimento = row.dataset.fornecimento;
      itens.push(item);
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

    /* Auto-criar configs de item para itens com categoria do PDF (silencioso, sem bloquear) */
    itens.filter(it => it.categoria).forEach(it => {
      const key = normalizarNomeItem(it.nome);
      if (!itemConfigsCache[key] && !itemConfigsCache[nomeBaseKey(key)]) {
        const dados = {
          nome:            it.nome,
          nomeKey:         key,
          grupo:           it.categoria,
          ordemSeparacao:  999,
          prioridade:      '',
          eProducao:       false,
          exibirSeparacao: true,
          exigeFoto:       false,
          refrigerado:     false,
          diasAntesEvento: 1,
        };
        salvarItemConfigDB(dados)
          .then(() => { itemConfigsCache[key] = dados; })
          .catch(() => {});
      }
    });

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

  const excluirHTML = `
    <div style="padding-top:12px;border-top:var(--borda);margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <button class="btn-perigo" onclick="confirmarExcluirFesta('${festa.id}','${_esc(festa.nome)}','${festa.status}')">
        🗑 Excluir Festa
      </button>
      <span style="font-size:11px;color:var(--cinza-400)">Irreversível — use apenas para re-importar.</span>
    </div>
  `;

  const sepTimingHTML = festa.separacaoInicio ? (() => {
    const concluida = !!festa.separacaoFim;
    const dur = formatarDuracao(festa.separacaoInicio, festa.separacaoFim || null);
    return `<div class="sep-timing">
      <span>Separação iniciada: <strong>${formatarDataHora(festa.separacaoInicio)}</strong></span>
      ${concluida
        ? `<span>Duração: <strong>${dur}</strong></span>`
        : `<span>Em andamento há <strong>${dur}</strong></span>`}
    </div>`;
  })() : '';

  const statusOpcoesHTML = Object.entries(STATUS_LABELS)
    .map(([k, v]) => `<option value="${k}"${festa.status === k ? ' selected' : ''}>${v}</option>`)
    .join('');

  document.getElementById('detalhe-content').innerHTML = `
    <div class="card-festa-info" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <h2>${festa.nome}</h2>
        <div class="detalhe-status-col">
          <span class="badge badge-${festa.status}">${STATUS_LABELS[festa.status] || festa.status}</span>
          <div class="status-editor">
            <label>Alterar:</label>
            <select class="status-select" onchange="mudarStatusFesta('${festa.id}',this.value)">
              ${statusOpcoesHTML}
            </select>
          </div>
        </div>
      </div>
      ${htmlInfoLinhas(festa)}
      ${sepTimingHTML}
    </div>

    ${excluirHTML}
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

async function confirmarExcluirFesta(id, nome, status) {
  const emAndamento = !['agendada','concluida'].includes(status);
  const aviso = emAndamento
    ? `\n\n⚠ ATENÇÃO: Esta festa está "${STATUS_LABELS[status] || status}". Excluir perderá todo o histórico de separação.`
    : '';
  if (!confirm(`Excluir a festa "${nome}"?${aviso}\n\nEsta ação não pode ser desfeita.`)) return;
  try {
    await deletarFesta(id);
    toast('Festa excluída.', 'sucesso');
    setTimeout(() => irParaPrincipal(), 800);
  } catch(e) {
    console.error('Excluir festa:', e);
    const msg = e?.code === 'permission-denied'
      ? 'Sem permissão no banco de dados. Verifique as regras do Firestore.'
      : (e?.message || 'Erro desconhecido');
    toast('Erro ao excluir: ' + msg, 'erro');
  }
}

/* CEO usa a tela de separacao como se fosse colaborador */
function ceoSepararFesta(id) {
  abrirSeparacao(id);
}

/* ── Edição de data/quantidades ── */
async function abrirEditarFesta(id) {
  festaEditandoId = id;
  pararListeners();
  historico.push('tela-editar-festa');
  mostrarTela('tela-editar-festa', 'Editar Festa');

  /* Avisar o separador que o admin está editando */
  try { await atualizarFesta(id, { editandoAgora: usuarioAtual.nome }); } catch(_) {}

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

    /* Liberar separador */
    try { await atualizarFesta(festaEditandoId, { editandoAgora: null }); } catch(_) {}

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

function filtrarUsuarios(valor) {
  _buscaUsuarios = valor;
  renderizarListaUsuarios();
}

function renderizarListaUsuarios() {
  const el = document.getElementById('usuarios-lista');
  if (!el) return;
  const busca = _buscaUsuarios.toLowerCase().trim();
  const lista = busca
    ? _usuariosCache.filter(u => (u.nome || '').toLowerCase().includes(busca))
    : _usuariosCache;
  if (!lista.length) { el.innerHTML = estadoVazio('Nenhum usuário encontrado.'); return; }
  el.innerHTML = lista.map(u => {
    const rolesTexto = (u.roles || [u.role]).map(r => ROLE_LABELS[r] || r).join(', ');
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
      </div>`;
  }).join('');
}

async function carregarUsuarios() {
  const el = document.getElementById('usuarios-lista');
  el.innerHTML = '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const usuarios = await listarUsuarios();
    _usuariosCache = usuarios;
    if (!usuarios.length) {
      el.innerHTML = estadoVazio('Nenhum usuário cadastrado.');
      return;
    }
    renderizarListaUsuarios();
  } catch(e) { el.innerHTML = estadoVazio('Erro ao carregar.'); }
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

      // Limpar nome: remover marcadores, cabeçalhos de coluna e números soltos no final
      // (números soltos são valores das colunas Saída/Extras/Volta mesclados na linha)
      const nome = nomeRaw
        .replace(/\*\*/g, '')
        .replace(/\s+(Sa[íi]da|Extras|Volta)\s*.*$/i, '')
        .replace(/(?:\s+\d+(?:[.,]\d+)?)+\s*$/, '')
        .trim();

      if (nome.length > 1) {
        /* Detectar sufixo de fornecimento (consignado, cliente, romero…) */
        let fornecimento = '';
        const nomeNorm = normalizarNomeItem(nome);
        for (const suf of SUFIXOS_FORNECIMENTO) {
          if (nomeNorm.endsWith('_' + suf)) { fornecimento = suf; break; }
        }

        resultado.itens.push({
          id:            `item-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
          nome,
          categoria:     categoriaAtual,
          fornecimento,
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
      linha.length < 80
    ) {
      // Verificar se o PDF fundiu um cabeçalho de categoria com o primeiro item da seção
      // Ex: "BEBIDAS ALCOOLICAS 10 UN VINHO TINTO" → categoria + item na mesma linha
      const RE_CAT_EMBUTIDA = /^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\/\-]*?)\s+(\d+(?:[.,]\d+)?)\s+(UN|PCT|CX|KG|L|LT|GF|FR|PC|ML|FD|BND|SC|GR|MT|PAR)\b\s*(.+)/i;
      const matchEmb = linha.match(RE_CAT_EMBUTIDA);
      if (matchEmb) {
        const [, catPart, qtdStr, unidade, nomeRaw] = matchEmb;
        const catCheck = catPart.replace(/[^A-Za-zÀ-ÿ\s]/g, '').trim();
        if (catCheck.length > 2 && catCheck === catCheck.toUpperCase()) {
          categoriaAtual = catPart.trim();
          const nome = nomeRaw
            .replace(/\*\*/g, '')
            .replace(/\s+(Sa[íi]da|Extras|Volta)\s*.*$/i, '')
            .replace(/(?:\s+\d+(?:[.,]\d+)?)+\s*$/, '')
            .trim();
          if (nome.length > 1) {
            let fornecimento = '';
            const nomeNorm = normalizarNomeItem(nome);
            for (const suf of SUFIXOS_FORNECIMENTO) {
              if (nomeNorm.endsWith('_' + suf)) { fornecimento = suf; break; }
            }
            resultado.itens.push({
              id:            `item-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
              nome,
              categoria:     categoriaAtual,
              fornecimento,
              qtdNecessaria: parseFloat(qtdStr.replace(',', '.')),
              unidade:       unidade.toUpperCase(),
              qtdSeparada:   0, qtdConferida: 0, qtdRetorno: 0, qtdGalpao: 0, qtdDanificada: 0,
            });
          }
          continue;
        }
      }
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
    /* Guardar categoria e fornecimento no dataset para uso ao salvar */
    row.dataset.categoria    = item.categoria || '';
    row.dataset.fornecimento = item.fornecimento || '';

    const badgeForn = item.fornecimento
      ? `<span class="badge-fornecimento badge-forn-${item.fornecimento}">${item.fornecimento}</span>`
      : '';

    row.innerHTML = `
      <input type="text"   value="${item.nome.replace(/"/g, '&quot;')}" placeholder="Nome do item" />
      <input type="number" value="${item.qtdNecessaria}" placeholder="0" />
      <input type="text"   value="${item.unidade}" placeholder="un" />
      ${badgeForn}
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
  if (contexto === 'ceo') {
    /* CEO acessa conferência, retorno e galpão diretamente — igual ao coordenador */
    if      (f.status === 'conferencia') onclick = `abrirConferencia('${f.id}')`;
    else if (f.status === 'retorno')     onclick = `abrirRetorno('${f.id}')`;
    else if (f.status === 'galpao')      onclick = `abrirGalpao('${f.id}')`;
    else                                 onclick = `abrirDetalheFesta('${f.id}')`;
  } else if (contexto === 'colaborador') {
    onclick = `abrirSeparacao('${f.id}')`;
  } else if (contexto === 'coordenador') {
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
            ${(f.divergencias?.length > 0) ? `<span class="badge-divergencia-card">⚠ ${f.divergencias.length} divergência${f.divergencias.length !== 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

function htmlInfoFesta(f) {
  const ehCEO = !!(usuarioAtual?.roles?.includes('ceo') || usuarioAtual?.role === 'ceo');
  const btnExcluir = ehCEO
    ? `<div style="margin-top:10px">
        <button class="btn-perigo" style="font-size:12px;padding:5px 12px"
          onclick="confirmarExcluirFesta('${f.id}','${_esc(f.nome)}','${f.status}')">
          🗑 Excluir Festa
        </button>
       </div>`
    : '';
  return `
    <h2>${f.nome}</h2>
    <div class="info-linha">${f.cliente}${f.data ? ' — ' + formatarData(f.data) : ''}</div>
    ${f.hora  ? `<div class="info-linha">${f.hora}</div>` : ''}
    ${f.local ? `<div class="info-linha">${f.local}</div>` : ''}
    ${f.obs   ? `<div class="info-linha" style="opacity:.75;font-size:12px;margin-top:6px">${f.obs}</div>` : ''}
    ${btnExcluir}
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

/* ══════════════════════════════════════════════════
   SIDEBAR
══════════════════════════════════════════════════ */

function initSidebarPin() {
  sidebarPinada = localStorage.getItem('rc_sidebar_pinada') === '1';
  const sb     = document.getElementById('sidebar');
  const btnPin = document.getElementById('btn-pin-sidebar');
  if (sidebarPinada) {
    sb.classList.add('aberto', 'pinada');
    document.body.classList.add('sidebar-pinada');
    if (btnPin) btnPin.classList.add('ativo');
  } else {
    sb.classList.remove('pinada');
    document.body.classList.remove('sidebar-pinada');
    if (btnPin) btnPin.classList.remove('ativo');
  }
}

function abrirSidebar() {
  const sb = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  sb.classList.add('aberto');
  if (!sidebarPinada) {
    ov.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function fecharSidebar(forca) {
  if (sidebarPinada && !forca) return;
  if (forca && sidebarPinada) {
    /* Botão X: desafixar também */
    sidebarPinada = false;
    localStorage.setItem('rc_sidebar_pinada', '0');
    document.body.classList.remove('sidebar-pinada');
    const btn = document.getElementById('btn-pin-sidebar');
    if (btn) btn.classList.remove('ativo');
    document.getElementById('sidebar').classList.remove('pinada');
  }
  document.getElementById('sidebar').classList.remove('aberto');
  document.getElementById('sidebar-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function togglePinSidebar() {
  sidebarPinada = !sidebarPinada;
  localStorage.setItem('rc_sidebar_pinada', sidebarPinada ? '1' : '0');
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sidebar-overlay');
  const btn = document.getElementById('btn-pin-sidebar');
  if (sidebarPinada) {
    sb.classList.add('pinada');
    ov.classList.add('hidden');
    document.body.classList.add('sidebar-pinada');
    document.body.style.overflow = '';
    if (btn) btn.classList.add('ativo');
  } else {
    sb.classList.remove('pinada');
    document.body.classList.remove('sidebar-pinada');
    if (btn) btn.classList.remove('ativo');
  }
}

function navegarSidebar() {
  if (!sidebarPinada) fecharSidebar();
}

function renderizarSidebarAgenda(festas) {
  const el = document.getElementById('sidebar-agenda');
  if (!el) return;

  const contagemPorDia = {};
  festas.forEach(f => {
    const key = normalizarData(f.data);
    if (key) contagemPorDia[key] = (contagemPorDia[key] || 0) + 1;
  });

  const dias = Object.keys(contagemPorDia).sort();
  const MESES     = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DIAS_SEM  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  el.innerHTML = `
    <button class="sidebar-data-btn todas"
      onclick="navegarSidebar(); filtrarPorData(null, null)">Ver Todas as Festas</button>
    ${dias.map(d => {
      const dt  = new Date(d + 'T12:00:00');
      const num = String(dt.getDate()).padStart(2,'0');
      const mes = MESES[dt.getMonth()];
      const sem = DIAS_SEM[dt.getDay()];
      const qtd = contagemPorDia[d];
      return `
        <button class="sidebar-data-btn"
          onclick="navegarSidebar(); filtrarPorData('${d}', null)">
          <span class="sidebar-data-dia">${num}</span>
          <span class="sidebar-data-info">
            <span class="sidebar-data-texto">${sem}, ${num} ${mes}</span>
            <span class="sidebar-data-qtd">${qtd} festa${qtd !== 1 ? 's' : ''}</span>
          </span>
        </button>
      `;
    }).join('')}
  `;
}

/* Atalho "Novo Usuário" pela sidebar: garante navegação correta após salvar */
function abrirSidebarNovoUsuario() {
  navegarSidebar();
  historico = ['tela-ceo', 'tela-lista-festas', 'tela-usuarios'];
  abrirFormUsuario();
}

/* ══════════════════════════════════════════════════
   LISTA DE PRODUÇÃO (tela-ceo)
══════════════════════════════════════════════════ */

function trocarAbaProducao(aba, btn) {
  abaProducaoAtual = aba;
  document.querySelectorAll('#producao-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  renderizarProducaoCEO();
}

function trocarOrdemProducao(ordem, btn) {
  ordemProducaoAtual = ordem;
  document.querySelectorAll('#producao-ordem-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  renderizarProducaoCEO();
}

function recarregarProducao() {
  carregarCEO();
}

function renderizarProducaoCEO() {
  const el = document.getElementById('producao-conteudo');
  if (!el) return;

  const ativas = todasFestasCache.filter(f => f.status !== 'concluida');
  const todosItens = agregarItensFestas(ativas);

  if (!todosItens.length) {
    el.innerHTML = estadoVazio('Nenhum item encontrado nas festas ativas.');
    return;
  }

  /* Separar em: produção ativa, e não classificados (sem nenhum cadastro) */
  const itensProducao = todosItens.filter(item => {
    const cfg = buscarConfigItem(item.nomeKey);
    return cfg?.eProducao === true;
  });
  /* Só aparecem como "Não Classificados" itens que não têm NENHUM cadastro */
  const naoClas = todosItens.filter(item => !buscarConfigItem(item.nomeKey));

  /* Construir grupos conforme modo de ordenação */
  const grupos = {};

  const PRIOR_LABEL = { alta: '🔴 Alta Prioridade', media: '🟡 Média Prioridade', baixa: '🟢 Baixa Prioridade' };
  const PRIOR_ORD   = { alta: 0, media: 1, baixa: 2 };

  /* Mapear ordens das categorias para exibição */
  const catOrdem = {};
  categoriasCache.forEach((c, i) => { catOrdem[c.nome] = c.ordem || (i + 1); });

  itensProducao.forEach(item => {
    const cfg = buscarConfigItem(item.nomeKey);
    let chaveGrupo, nomeGrupo, ordemGrupo;

    if (ordemProducaoAtual === 'prioridade') {
      const p = cfg?.prioridade || 'baixa';
      chaveGrupo = p;
      nomeGrupo  = PRIOR_LABEL[p] || p;
      ordemGrupo = PRIOR_ORD[p] ?? 9;
    } else {
      nomeGrupo  = cfg?.grupo || 'Sem Categoria';
      chaveGrupo = nomeGrupo;
      ordemGrupo = catOrdem[nomeGrupo] ?? 999;
    }

    if (!grupos[chaveGrupo]) grupos[chaveGrupo] = { nome: nomeGrupo, ordem: ordemGrupo, itens: [] };
    grupos[chaveGrupo].itens.push({ ...item, cfg });
  });

  const gruposOrdenados = Object.values(grupos)
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));

  const htmlGrupos = gruposOrdenados.map(g => htmlGrupoProducao(g)).join('');

  /* Seção de não classificados */
  const htmlNaoClas = naoClas.length ? `
    <div class="producao-grupo producao-grupo-nao-clas">
      <div class="producao-grupo-header" onclick="toggleGrupo('_nao_classificados')">
        <span class="producao-grupo-seta">&#9660;</span>
        <span class="producao-grupo-nome producao-nao-clas-label">&#9888; Não classificados</span>
        <span class="producao-grupo-qtd">${naoClas.length} item${naoClas.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="producao-grupo-itens" id="grupo-__nao_classificados">
        <p class="producao-nao-clas-hint">Configure esses itens em <strong>Cadastro</strong> e marque "É item de Produção" para que apareçam aqui.</p>
        ${naoClas.map(item => `
          <div class="producao-item-row producao-item-nao-clas">
            <div class="producao-item-info">
              <div class="producao-item-nome">${nomeBasDisplay(item.nome)}</div>
              <div class="producao-item-total">Total: <strong>${item.total}</strong> ${item.unidade}</div>
            </div>
            <button class="btn-sm btn-secundario" onclick="abrirFormItemConfig(null,'${_esc(item.nome)}')">Configurar</button>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  el.innerHTML = (itensProducao.length === 0 && naoClas.length > 0)
    ? estadoVazio('Nenhum item marcado como Produção. Configure os itens abaixo para que apareçam aqui.') + htmlNaoClas
    : htmlGrupos + htmlNaoClas;
}

function htmlGrupoProducao(g) {
  const grupoKey = g.nome.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const itensDomGrupo = g.itens.slice().sort((a, b) => {
    const oA = a.cfg?.ordemSeparacao != null ? a.cfg.ordemSeparacao : 999;
    const oB = b.cfg?.ordemSeparacao != null ? b.cfg.ordemSeparacao : 999;
    return oA - oB || a.nome.localeCompare(b.nome, 'pt-BR');
  });

  const htmlItens = abaProducaoAtual === 'sintetico'
    ? htmlProducaoSintetico(itensDomGrupo)
    : htmlProducaoAnalitico(itensDomGrupo);

  return `
    <div class="producao-grupo">
      <div class="producao-grupo-header" onclick="toggleGrupo('${grupoKey}')">
        <span class="producao-grupo-seta">&#9660;</span>
        <span class="producao-grupo-nome">${g.nome}</span>
        <span class="producao-grupo-qtd">${g.itens.length} item${g.itens.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="producao-grupo-itens" id="grupo-${grupoKey}">
        ${htmlItens}
      </div>
    </div>
  `;
}

function htmlProducaoSintetico(itens) {
  return itens.map(item => {
    const est    = estoqueCache[item.nomeKey];
    const qtdEst = est?.qtd || 0;
    const diff   = qtdEst - item.total;
    const pct    = item.total > 0 ? Math.min(100, Math.round((qtdEst / item.total) * 100)) : 100;
    const cfg    = item.cfg;
    const badgeRefrig = cfg?.refrigerado
      ? '<span class="badge-refrigerado">&#10052; Refrig.</span>' : '';
    const badgePrior  = cfg?.prioridade
      ? `<span class="badge-prioridade prior-${cfg.prioridade}">${cfg.prioridade}</span>` : '';

    return `
      <div class="producao-item-row">
        <div class="producao-item-info">
          <div class="producao-item-nome">${nomeBasDisplay(item.nome)}</div>
          ${badgeRefrig || badgePrior ? `<div class="producao-item-badges">${badgeRefrig}${badgePrior}</div>` : ''}
          <div class="producao-item-total">Necessário: <strong>${item.total}</strong> ${item.unidade}</div>
        </div>
        <div class="producao-item-nums">
          ${diff < 0
            ? `<span class="producao-diff-falta" style="font-size:18px;font-weight:900">A PRODUZIR: ${Math.abs(diff)} ${item.unidade}</span>
               <span style="font-size:11px;color:var(--cinza-500)">Pedido: ${item.total} &nbsp;|&nbsp; Estoque: ${qtdEst}</span>`
            : `<span class="producao-diff-ok">OK — +${diff} em estoque</span>
               <span style="font-size:11px;color:var(--cinza-500)">Pedido: ${item.total} &nbsp;|&nbsp; Estoque: ${qtdEst}</span>`
          }
          <div class="producao-mini-bar">
            <div class="producao-mini-fill ${diff < 0 ? 'deficit' : 'ok'}" style="width:${pct}%"></div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function htmlProducaoAnalitico(itens) {
  const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return itens.map(item => {
    const est    = estoqueCache[item.nomeKey];
    const qtdEst = est?.qtd || 0;
    const diff   = qtdEst - item.total;
    const cfg    = item.cfg;
    const badgeRefrig = cfg?.refrigerado
      ? '<span class="badge-refrigerado">&#10052;</span>' : '';

    const subRows = item.festas.map(f => {
      let dataTxt = '';
      if (f.festaData) {
        const d = toDate(f.festaData);
        if (!isNaN(d)) dataTxt = ` — ${String(d.getDate()).padStart(2,'0')} ${MESES_ABR[d.getMonth()]}`;
      }
      return `
        <div class="analitico-sub-row">
          <span class="analitico-sub-nome">${f.festaNome}${dataTxt}</span>
          <span class="analitico-sub-qty">${f.qtd} ${item.unidade}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="producao-item-row">
        <div class="producao-item-info" style="width:100%">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div class="producao-item-nome">${nomeBasDisplay(item.nome)} ${badgeRefrig}</div>
            <div class="producao-item-nums" style="flex-direction:row;gap:10px;align-items:center">
              <span class="producao-item-total">Total: <strong>${item.total}</strong> ${item.unidade}</span>
              <span class="${diff < 0 ? 'producao-diff-falta' : 'producao-diff-ok'}">
                ${diff < 0 ? 'Falta ' + Math.abs(diff) : '+' + diff + ' ok'}
              </span>
            </div>
          </div>
          <div class="analitico-sub-lista">${subRows}</div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleGrupo(grupoKey) {
  const el     = document.getElementById(`grupo-${grupoKey}`);
  const header = el?.previousElementSibling;
  if (!el) return;
  el.classList.toggle('collapsed');
  if (header) header.classList.toggle('collapsed');
}

/* ══════════════════════════════════════════════════
   ESTOQUE & RELATÓRIO
══════════════════════════════════════════════════ */

function normalizarNomeItem(nome) {
  return (nome || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/* Sufixos que indicam TIPO DE FORNECIMENTO — mesmo produto, formas diferentes de obter */
const SUFIXOS_FORNECIMENTO = [
  'consignado','cliente','romero','reserva','proprio','propria','terceiro',
  'cortesia','gratis','gratuito','locacao','doacao','empresa',
];

/* Retorna o nomeKey sem o sufixo de fornecimento.
   Trata tanto sufixo separado ("aperol_consignado") quanto colado ("aperol_1000mlromero"). */
function nomeBaseKey(nomeKey) {
  const s = nomeKey || '';
  const partes = s.split('_').filter(Boolean);
  if (partes.length < 1) return s;
  const ultimo = partes[partes.length - 1];
  /* Sufixo exato */
  if (partes.length > 1 && SUFIXOS_FORNECIMENTO.includes(ultimo)) {
    const idx = s.lastIndexOf('_' + ultimo);
    if (idx !== -1) return s.slice(0, idx).replace(/_+$/, '');
  }
  /* Sufixo colado no final da última palavra (ex: "1000mlromero" → strip "romero") */
  for (const suf of SUFIXOS_FORNECIMENTO) {
    if (ultimo.endsWith(suf) && ultimo.length > suf.length) {
      return s.slice(0, s.length - suf.length);
    }
  }
  return s;
}

/* Retorna nome de exibição sem o sufixo.
   Trata sufixo separado ("APEROL CONSIGNADO") e colado ("APEROL - 750MLROMERO"). */
function nomeBasDisplay(nome) {
  const s = (nome || '').trim();
  if (!s) return s;
  const partes = s.split(/\s+/);
  const ultimo  = partes[partes.length - 1];
  const ultimoN = normalizarNomeItem(ultimo);
  /* Sufixo exato como palavra separada */
  if (partes.length > 1 && SUFIXOS_FORNECIMENTO.includes(ultimoN)) {
    return partes.slice(0, -1).join(' ');
  }
  /* Sufixo colado no final da última palavra (ex: "750MLROMERO" → "750ML") */
  for (const suf of SUFIXOS_FORNECIMENTO) {
    if (ultimoN.endsWith(suf) && ultimoN.length > suf.length) {
      const semSuf = ultimo.slice(0, ultimo.length - suf.length);
      return (partes.length > 1 ? partes.slice(0, -1).join(' ') + ' ' : '') + semSuf;
    }
  }
  return s;
}

/* Extrai o sufixo de fornecimento embutido no nome (ex: "APEROL CONSIGNADO" → "consignado") */
function extrairFornDoNome(nome) {
  const partes = (nome || '').trim().split(/\s+/);
  const ultimo  = normalizarNomeItem(partes[partes.length - 1]);
  if (partes.length > 1 && SUFIXOS_FORNECIMENTO.includes(ultimo)) return ultimo;
  /* Colado no final */
  for (const suf of SUFIXOS_FORNECIMENTO) {
    if (ultimo.endsWith(suf) && ultimo.length > suf.length) return suf;
  }
  return null;
}

/* Busca config do item por nomeKey; com fallback para nome base (variante) */
function buscarConfigItem(nomeKey) {
  return itemConfigsCache[nomeKey] || itemConfigsCache[nomeBaseKey(nomeKey)] || null;
}

/* Verifica se um item de festa deve aparecer na tela de separação */
function deveExibirNaSeparacao(item) {
  const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
  if (!cfg) return true; // sem config → exibe por padrão
  if (cfg.exibirSeparacao === false) return false;
  // itens de produção sempre aparecem na separação
  if (cfg.eProducao) return true;
  // verificar nível de categoria
  if (cfg.grupo) {
    const cat = categoriasCache.find(c => c.nome === cfg.grupo);
    if (cat && cat.exibirSeparacao === false) return false;
  }
  return true;
}

function agregarItensFestas(festas) {
  const mapa = {};
  festas.filter(f => f.status !== 'concluida').forEach(f => {
    (f.itens || []).forEach((item, itemIdx) => {
      /* Usa a chave BASE (sem sufixo de fornecimento) para agregar variantes */
      const key = nomeBaseKey(normalizarNomeItem(item.nome));
      if (!mapa[key]) {
        mapa[key] = {
          nomeKey: key,
          nome:    nomeBasDisplay(item.nome),
          unidade: item.unidade || 'un',
          total:   0,
          festas:  [],
        };
      }
      mapa[key].total += (item.qtdNecessaria || 0);
      mapa[key].festas.push({
        festaId:     f.id,
        festaNome:   f.nome,
        festaStatus: f.status,
        festaData:   f.data,
        itemIdx,
        qtd: item.qtdNecessaria || 0,
      });
    });
  });
  return Object.values(mapa).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

/* Retorna {diasRestantes, msg, tipo} se item está em stand-by, null se já liberado */
function standByInfo(item, festaData) {
  const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
  if (!cfg || !festaData) return null;

  const dataFesta = toDate(festaData);
  if (isNaN(dataFesta)) return null;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  /* Produção (sem ser refrigerado): só bloqueia se diasAntesEvento === 0 explicitamente */
  if (cfg.eProducao && !cfg.refrigerado) {
    if (cfg.diasAntesEvento !== 0) return null;
    const dataLibera = new Date(dataFesta);
    dataLibera.setHours(0, 0, 0, 0);
    const diasRestantes = Math.ceil((dataLibera - hoje) / (1000 * 60 * 60 * 24));
    if (diasRestantes <= 0) return null;
    return {
      diasRestantes,
      tipo: 'producao',
      msg: diasRestantes === 1 ? 'Separar amanhã (dia do evento)' : `Separar em ${diasRestantes} dias (dia do evento)`,
    };
  }

  /* Refrigerado: bloqueia N dias antes conforme cadastro */
  if (!cfg.refrigerado) return null;

  const diasAntes = cfg.diasAntesEvento ?? 1;
  const dataLibera = new Date(dataFesta);
  dataLibera.setDate(dataLibera.getDate() - diasAntes);
  dataLibera.setHours(0, 0, 0, 0);

  const diasRestantes = Math.ceil((dataLibera - hoje) / (1000 * 60 * 60 * 24));
  if (diasRestantes <= 0) return null;

  return {
    diasRestantes,
    tipo: 'refrigerado',
    msg: diasAntes === 0
      ? (diasRestantes === 1 ? 'Separar amanhã (dia do evento)' : `Separar em ${diasRestantes} dias (dia do evento)`)
      : (diasRestantes === 1 ? 'Libera amanhã' : `Libera em ${diasRestantes} dias`),
  };
}

/* ══════════════════════════════════════════════════
   INVENTÁRIO (SEPARADOR) — contagem de estoque sem compras
══════════════════════════════════════════════════ */

let _buscaInventario    = '';
let _inventarioContados = new Set(); /* nomeKeys contados nesta sessão */
let _abaInventario      = 'acontar'; /* 'acontar' | 'contados' */
let _inventarioConfigs  = [];        /* cache dos item_configs carregados */

async function abrirInventario() {
  historico.push('tela-colaborador');
  mostrarTela('tela-inventario', 'Inventário de Estoque');
  _buscaInventario    = '';
  _inventarioContados = new Set();
  _abaInventario      = 'acontar';
  const busca = document.querySelector('#tela-inventario .barra-busca');
  if (busca) busca.value = '';
  await recarregarInventario();
}

async function recarregarInventario() {
  document.getElementById('inventario-conteudo').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const [configs, estoqueMap] = await Promise.all([
      listarItemConfigs(),
      buscarEstoque(),
    ]);
    estoqueCache       = estoqueMap;
    _inventarioConfigs = configs;
    renderizarInventario();
  } catch (e) {
    console.error(e);
    toast('Erro ao carregar inventário.', 'erro');
    document.getElementById('inventario-conteudo').innerHTML =
      '<div class="estado-vazio"><p>Erro ao carregar. Tente novamente.</p></div>';
  }
}

function filtrarInventario(valor) {
  _buscaInventario = valor;
  renderizarInventario();
}

function trocarAbaInventario(aba, btn) {
  _abaInventario = aba;
  document.querySelectorAll('#inv-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  renderizarInventario();
}


function renderizarInventario() {
  const busca = _buscaInventario.toLowerCase().trim();
  let itens = _inventarioConfigs.filter(c => c.nome);
  if (busca) itens = itens.filter(c =>
    (c.nome || '').toLowerCase().includes(busca) ||
    (c.grupo || '').toLowerCase().includes(busca)
  );

  /* Separar por aba */
  const aContar  = itens.filter(c => !_inventarioContados.has(c.nomeKey || normalizarNomeItem(c.nome)));
  const contados = itens.filter(c =>  _inventarioContados.has(c.nomeKey || normalizarNomeItem(c.nome)));
  const lista    = _abaInventario === 'acontar' ? aContar : contados;

  /* Tabs com contadores */
  const nContados = _inventarioContados.size;
  const nAContar  = _inventarioConfigs.filter(c => c.nome).length - nContados;
  const tabsHtml  = `
    <div class="filtros-tabs" id="inv-tabs" style="margin-bottom:12px">
      <button class="tab${_abaInventario === 'acontar'  ? ' ativo' : ''}" id="inv-tab-acontar"
        onclick="trocarAbaInventario('acontar',this)">A Contar (${nAContar})</button>
      <button class="tab${_abaInventario === 'contados' ? ' ativo' : ''}" id="inv-tab-contados"
        onclick="trocarAbaInventario('contados',this)">Contados (${nContados})</button>
    </div>`;

  if (!lista.length) {
    const msg = _abaInventario === 'acontar'
      ? 'Todos os itens já foram contados nesta sessão!'
      : 'Nenhum item contado ainda.';
    document.getElementById('inventario-conteudo').innerHTML = tabsHtml + estadoVazio(msg);
    return;
  }

  /* Agrupar por categoria/grupo */
  const grupos = {};
  lista.forEach(c => {
    const g = c.grupo || 'Sem Categoria';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(c);
  });

  const itenHtml = Object.keys(grupos).sort().map(g => {
    const linhas = grupos[g].map(c => {
      const key      = c.nomeKey || normalizarNomeItem(c.nome);
      const est      = estoqueCache[key] || {};
      const qtdEst   = est.qtd != null ? est.qtd : '';
      const un       = c.unidade || est.unidade || '';
      const contado  = _inventarioContados.has(key);
      const btnLabel = contado ? '&#9998; Atualizar' : '&#10003; Contar';
      const btnStyle = contado ? 'background:var(--cinza-600)' : '';
      return `
        <div class="estoque-item-card" id="inv-card-${key}" style="margin-bottom:8px">
          <div class="estoque-item-header">
            <div class="estoque-item-nome">${c.nome}</div>
            ${un ? `<div class="estoque-item-total" style="font-size:12px;color:var(--cinza-500)">${un}</div>` : ''}
          </div>
          <div class="estoque-body-row">
            <span class="estoque-body-label">Qtd.:</span>
            <div class="estoque-qty-wrap">
              <input type="number" class="estoque-qty-input"
                id="inv-qty-${key}"
                value="${qtdEst}" min="0" placeholder="0"
              />
              ${un ? `<span class="estoque-qty-un">${un}</span>` : ''}
            </div>
            <button class="btn-primario btn-sm" style="margin-left:8px;flex-shrink:0;${btnStyle}"
              onclick="salvarInventarioQtd('${_esc(key)}','${_esc(c.nome)}','${_esc(un)}')">
              ${btnLabel}
            </button>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="grupo-titulo" style="margin-top:16px;margin-bottom:4px;font-size:12px;font-weight:700;text-transform:uppercase;color:var(--cinza-500);letter-spacing:.5px">${g}</div>
      ${linhas}`;
  }).join('');

  document.getElementById('inventario-conteudo').innerHTML = tabsHtml + itenHtml;
}

async function salvarInventarioQtd(nomeKey, nome, unidade) {
  const input = document.getElementById(`inv-qty-${nomeKey}`);
  const qtd   = input ? (parseFloat(input.value) || 0) : 0;
  try {
    await salvarItemEstoque(nomeKey, { nome, unidade, qtd });
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), nome, unidade, qtd, nomeKey };
    registrarContagemHistorico({ nomeKey, nome, unidade, qtd, contadoPor: usuarioAtual?.nome || '—' })
      .catch(e => console.error('Erro ao registrar histórico:', e));
    _inventarioContados.add(nomeKey);
    toast(`${nome}: ${qtd} ${unidade || 'un'} ✓`, 'sucesso');
    renderizarInventario();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   HISTÓRICO DE CONTAGEM (CEO)
══════════════════════════════════════════════════ */

async function abrirHistoricoContagem() {
  historico.push('tela-historico-contagem');
  mostrarTela('tela-historico-contagem', 'Histórico de Contagem');
  document.getElementById('hist-cont-lista').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const registros = await listarHistoricoContagem(300);
    renderizarHistoricoContagem(registros);
  } catch (e) {
    console.error('Histórico contagem:', e);
    document.getElementById('hist-cont-lista').innerHTML =
      '<div class="estado-vazio"><p>Erro ao carregar. Tente novamente.</p></div>';
  }
}

function renderizarHistoricoContagem(registros) {
  const el = document.getElementById('hist-cont-lista');
  if (!registros.length) {
    el.innerHTML = estadoVazio('Nenhuma contagem registrada ainda.');
    return;
  }

  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const fmt = ts => {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    if (isNaN(d)) return '—';
    const dia  = String(d.getDate()).padStart(2,'0');
    const mes  = MESES[d.getMonth()];
    const ano  = d.getFullYear();
    const hora = String(d.getHours()).padStart(2,'0');
    const min  = String(d.getMinutes()).padStart(2,'0');
    return `${dia} ${mes} ${ano} às ${hora}:${min}`;
  };

  /* Agrupar por data (dia) */
  const porDia = {};
  registros.forEach(r => {
    const d = r.contadoEm?.toDate ? r.contadoEm.toDate() : new Date(r.contadoEm);
    const diaKey = isNaN(d) ? 'Sem data' : `${String(d.getDate()).padStart(2,'0')} ${MESES[d.getMonth()]} ${d.getFullYear()}`;
    if (!porDia[diaKey]) porDia[diaKey] = [];
    porDia[diaKey].push(r);
  });

  el.innerHTML = Object.keys(porDia).map(dia => `
    <div class="grupo-titulo" style="margin-top:16px;margin-bottom:4px;font-size:12px;font-weight:700;text-transform:uppercase;color:var(--cinza-500);letter-spacing:.5px">${dia}</div>
    ${porDia[dia].map(r => `
      <div class="estoque-item-card" style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div>
            <div style="font-weight:600;font-size:14px">${r.nome || r.nomeKey}</div>
            <div style="font-size:12px;color:var(--cinza-500);margin-top:2px">
              👤 ${r.contadoPor || '—'} &nbsp;·&nbsp; ${fmt(r.contadoEm)}
            </div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div style="font-size:20px;font-weight:700;color:var(--verde-700)">${r.qtd}</div>
            <div style="font-size:11px;color:var(--cinza-500)">${r.unidade || 'un'}</div>
          </div>
        </div>
      </div>
    `).join('')}
  `).join('');
}

async function abrirEstoque() {
  historico.push('tela-estoque');
  mostrarTela('tela-estoque', 'Controle de Estoque');
  abaEstoqueAtual = 'sintetico';
  document.querySelectorAll('#estoque-tabs .tab').forEach((b, i) => {
    b.classList.toggle('ativo', i === 0);
  });
  await recarregarEstoque();
}

async function recarregarEstoque() {
  document.getElementById('estoque-conteudo').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const [estoqueMap, festas] = await Promise.all([
      buscarEstoque(),
      buscarTodasFestas(),
    ]);
    estoqueCache     = estoqueMap;
    todasFestasCache = festas;
    renderizarEstoque(todasFestasCache, estoqueCache);
  } catch (e) {
    console.error(e);
    toast('Erro ao carregar estoque.', 'erro');
    document.getElementById('estoque-conteudo').innerHTML =
      '<div class="estado-vazio"><p>Erro ao carregar. Tente novamente.</p></div>';
  }
}

function trocarAbaEstoque(aba, btn) {
  abaEstoqueAtual = aba;
  document.querySelectorAll('#estoque-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  renderizarEstoque(todasFestasCache, estoqueCache);
}

function filtrarEstoque(valor) {
  _buscaEstoque = valor;
  renderizarEstoque(todasFestasCache, estoqueCache);
}

function renderizarEstoque(festas, estoqueMap) {
  const todos = agregarItensFestas(festas);
  const busca = _buscaEstoque.toLowerCase().trim();
  const itens = busca ? todos.filter(it => (it.nome || '').toLowerCase().includes(busca)) : todos;
  if (!itens.length) {
    document.getElementById('estoque-conteudo').innerHTML =
      estadoVazio('Nenhum item encontrado nas festas ativas.');
    return;
  }
  document.getElementById('estoque-conteudo').innerHTML = abaEstoqueAtual === 'sintetico'
    ? itens.map(it => htmlEstoqueSintetico(it, estoqueMap[it.nomeKey])).join('')
    : itens.map(it => htmlEstoqueAnalitico(it, estoqueMap[it.nomeKey])).join('');
}

function _esc(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

function htmlEstoqueSintetico(item, est) {
  const qtdEst = est?.qtd || 0;
  const diff   = qtdEst - item.total;
  const pct    = item.total > 0 ? Math.min(100, Math.round((qtdEst / item.total) * 100)) : 100;

  return `
    <div class="estoque-item-card">
      <div class="estoque-item-header">
        <div class="estoque-item-nome">${item.nome}</div>
        <div class="estoque-item-total">Necessário: <strong>${item.total}</strong> ${item.unidade}</div>
      </div>
      <div class="estoque-body-row">
        <span class="estoque-body-label">Em estoque:</span>
        <div class="estoque-qty-wrap">
          <input type="number" class="estoque-qty-input"
            id="estoque-qty-${item.nomeKey}"
            value="${qtdEst}" min="0"
            onchange="salvarEstoqueQtd('${_esc(item.nomeKey)}','${_esc(item.nome)}','${_esc(item.unidade)}',this.value)"
          />
          <span class="estoque-qty-un">${item.unidade}</span>
        </div>
        <button class="btn-comprar"
          onclick="comprarItemEstoque('${_esc(item.nomeKey)}','${_esc(item.nome)}','${_esc(item.unidade)}')">
          + Comprar
        </button>
      </div>
      <div class="estoque-progress-track">
        <div class="estoque-progress-bar ${diff < 0 ? 'deficit' : 'ok'}" style="width:${pct}%"></div>
      </div>
      <div class="estoque-diff ${diff < 0 ? 'deficit-text' : 'ok-text'}">
        ${diff < 0
          ? `Falta <strong>${Math.abs(diff)}</strong> ${item.unidade} (${pct}% coberto)`
          : `Estoque suficiente — sobra <strong>${diff}</strong> ${item.unidade}`}
      </div>
    </div>
  `;
}

function htmlEstoqueAnalitico(item, est) {
  const qtdEst = est?.qtd || 0;
  const diff   = qtdEst - item.total;

  const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const festasHTML = item.festas.map(f => {
    let dataTxt = '';
    if (f.festaData) {
      const d = toDate(f.festaData);
      if (!isNaN(d)) dataTxt = ` — ${String(d.getDate()).padStart(2,'0')} ${MESES_ABR[d.getMonth()]}`;
    }
    return `
      <div class="analitico-festa-row">
        <div class="analitico-festa-nome">
          ${f.festaNome}${dataTxt}
          <span class="badge badge-${f.festaStatus}" style="font-size:9px;margin-left:4px">
            ${STATUS_LABELS[f.festaStatus] || f.festaStatus}
          </span>
        </div>
        <div class="analitico-festa-qty">
          <input type="number" class="estoque-qty-input-sm"
            value="${f.qtd}" min="0"
            onchange="editarQtdFestaEstoque('${_esc(f.festaId)}',${f.itemIdx},this.value)"
          />
          <span class="estoque-qty-un">${item.unidade}</span>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="estoque-item-card">
      <div class="estoque-item-header">
        <div class="estoque-item-nome">${item.nome}</div>
        <div class="estoque-item-total">
          Total: <strong>${item.total}</strong> ${item.unidade} &nbsp;|&nbsp;
          Estoque: <strong>${qtdEst}</strong> ${item.unidade}
          <span class="${diff < 0 ? 'deficit-text' : 'ok-text'}" style="font-weight:700">
            &nbsp;(${diff < 0 ? 'falta ' + Math.abs(diff) : 'sobra ' + diff})
          </span>
        </div>
      </div>
      <div class="analitico-festas-lista">${festasHTML}</div>
      <div class="analitico-item-footer">
        <button class="btn-comprar"
          onclick="comprarItemEstoque('${_esc(item.nomeKey)}','${_esc(item.nome)}','${_esc(item.unidade)}')">
          + Comprar
        </button>
      </div>
    </div>
  `;
}

async function salvarEstoqueQtd(nomeKey, nome, unidade, qtdStr) {
  const qtd = parseFloat(qtdStr) || 0;
  try {
    await salvarItemEstoque(nomeKey, { nome, unidade, qtd });
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), nome, unidade, qtd, nomeKey };
    toast('Estoque atualizado.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar estoque.', 'erro');
  }
}

async function editarQtdFestaEstoque(festaId, itemIdx, novaQtdStr) {
  const novaQtd = parseFloat(novaQtdStr) || 0;
  const festa   = todasFestasCache.find(f => f.id === festaId);
  if (!festa) return toast('Festa não encontrada.', 'erro');

  const itens = (festa.itens || []).map((it, i) =>
    i === itemIdx ? { ...it, qtdNecessaria: novaQtd } : { ...it }
  );

  try {
    await editarQtdFesta(festaId, itens);
    /* Atualizar cache local para que a re-renderização seja imediata */
    const idx = todasFestasCache.findIndex(f => f.id === festaId);
    if (idx >= 0) todasFestasCache[idx] = { ...todasFestasCache[idx], itens };
    toast('Quantidade atualizada na festa.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao atualizar quantidade.', 'erro');
  }
}

/* ── Modal Comprar ── */
function comprarItemEstoque(nomeKey, nome, unidade) {
  _comprarContext = { nomeKey, nome, unidade };
  document.getElementById('modal-comprar-titulo').textContent = `Comprar: ${nome}`;
  document.getElementById('modal-comprar-qty').value = '';
  document.getElementById('modal-comprar').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-comprar-qty').focus(), 80);
}

function fecharModalComprar() {
  document.getElementById('modal-comprar').classList.add('hidden');
  _comprarContext = null;
}

async function confirmarCompra() {
  if (!_comprarContext) return;
  const qtdCompra = parseFloat(document.getElementById('modal-comprar-qty').value);
  if (isNaN(qtdCompra) || qtdCompra <= 0) {
    toast('Informe uma quantidade válida.', 'erro');
    return;
  }

  const { nomeKey, nome, unidade } = _comprarContext;
  const qtdAtual = estoqueCache[nomeKey]?.qtd || 0;
  const novaQtd  = qtdAtual + qtdCompra;

  try {
    await salvarItemEstoque(nomeKey, { nome, unidade, qtd: novaQtd });
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), nome, unidade, qtd: novaQtd, nomeKey };

    /* Atualizar input visível se existir */
    const inputEl = document.getElementById(`estoque-qty-${nomeKey}`);
    if (inputEl) inputEl.value = novaQtd;

    /* Re-renderizar para atualizar barras de progresso */
    renderizarEstoque(todasFestasCache, estoqueCache);
    fecharModalComprar();
    toast(`+${qtdCompra} ${unidade} adicionados ao estoque de "${nome}".`, 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao registrar compra.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   CADASTRO DE ITENS (grupos, prioridade, refrigerado)
══════════════════════════════════════════════════ */

async function abrirCadastroItens(aba) {
  navegarSidebar();
  historico.push('tela-cadastro-itens');
  mostrarTela('tela-cadastro-itens', 'Cadastro');
  _buscaCadastro = '';
  const inputBusca = document.getElementById('busca-cadastro');
  if (inputBusca) inputBusca.value = '';
  /* Garantir que a aba correta esteja ativa */
  const abaAlvo = aba || 'config';
  const btnAlvo = document.getElementById(
    abaAlvo === 'localizacoes' ? 'tab-itens-loc' :
    abaAlvo === 'categorias'   ? 'tab-itens-cat'  : 'tab-itens-config'
  );
  trocarAbaItens(abaAlvo, btnAlvo);
}

function filtrarCadastro(termo) {
  _buscaCadastro = (termo || '').toLowerCase().trim();
  renderizarCadastroItens();
}

function trocarAbaItens(aba, btn) {
  document.querySelectorAll('#tela-cadastro-itens .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');

  const elConf    = document.getElementById('cadastro-itens-lista');
  const elCat     = document.getElementById('cadastro-itens-cat');
  const elLoc     = document.getElementById('cadastro-itens-loc');
  const btnNovo   = document.getElementById('btn-novo-item-config');
  const btnNovoCat= document.getElementById('btn-nova-categoria');
  const btnSel    = document.getElementById('btn-selecionar-itens');
  const btnAplicar= document.getElementById('btn-aplicar-class');
  const busca     = document.getElementById('busca-cadastro-wrap');

  /* Reset todos */
  elConf?.classList.add('hidden');
  elCat?.classList.add('hidden');
  elLoc?.classList.add('hidden');
  if (btnNovo)    btnNovo.classList.add('hidden');
  if (btnNovoCat) btnNovoCat.classList.add('hidden');
  if (btnSel)     btnSel.style.display = '';
  if (btnAplicar) btnAplicar.classList.add('hidden');
  if (busca)      busca.classList.add('hidden');

  if (aba === 'categorias') {
    elCat?.classList.remove('hidden');
    if (btnNovoCat) btnNovoCat.classList.remove('hidden');
    if (btnSel)     btnSel.style.display = 'none';
    renderizarCategorias();
  } else if (aba === 'localizacoes') {
    elLoc?.classList.remove('hidden');
    renderizarLocalizacoes();
  } else {
    elConf?.classList.remove('hidden');
    if (btnNovo)    btnNovo.classList.remove('hidden');
    if (btnAplicar) btnAplicar.classList.remove('hidden');
    if (busca)      busca.classList.remove('hidden');
    renderizarCadastroItens();
  }
}

async function renderizarCadastroItens() {
  const el = document.getElementById('cadastro-itens-lista');
  if (!el) return;
  el.innerHTML = '<div class="estado-vazio"><p>Carregando...</p></div>';
  const busca = _buscaCadastro;
  const buscaWrap = document.getElementById('busca-cadastro-wrap');
  try {
    /* Carregar configs e itens de todas as festas em paralelo */
    const [configs, festas] = await Promise.all([
      listarItemConfigs(),
      todasFestasCache.length ? Promise.resolve(todasFestasCache) : buscarTodasFestas(),
    ]);
    itemConfigsCache = {};
    configs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });

    /* Itens únicos de todas as festas */
    const nomesNasFestas = {};
    festas.forEach(f => (f.itens || []).forEach(it => {
      const key = normalizarNomeItem(it.nome);
      if (!nomesNasFestas[key]) nomesNasFestas[key] = it.nome;
    }));

    /* Agrupar por grupo para itens configurados */
    const grupos = {};
    configs.forEach(c => {
      const g = c.grupo || 'Sem Categoria';
      if (!grupos[g]) grupos[g] = { ordem: 999, itens: [] };
      const catInfo = categoriasCache.find(cat => cat.nome === g);
      if (catInfo) grupos[g].ordem = catInfo.ordem || 999;
      grupos[g].itens.push(c);
      delete nomesNasFestas[c.nomeKey]; /* remover da lista de não configurados (match exato) */
    });

    /* Remover também variantes cujo NOME BASE já está configurado */
    Object.keys(nomesNasFestas).forEach(k => {
      const base = nomeBaseKey(k);
      if (base !== k && itemConfigsCache[base]) delete nomesNasFestas[k];
    });

    /* Agrupar itens não configurados por nome base (deduplicar variantes) */
    const semConfigPorBase = {};
    Object.entries(nomesNasFestas).forEach(([key, nome]) => {
      const base = nomeBaseKey(key);
      if (!semConfigPorBase[base]) {
        semConfigPorBase[base] = { nomeKey: base, nomeDisplay: nomeBasDisplay(nome), variantes: [] };
      }
      if (key !== base) semConfigPorBase[base].variantes.push(nome);
    });
    const semConfig = Object.values(semConfigPorBase);

    /* Detectar nomeKeys duplicados entre configs */
    const keyCount = {};
    configs.forEach(c => { keyCount[c.nomeKey] = (keyCount[c.nomeKey] || 0) + 1; });
    const duplicados = new Set(Object.keys(keyCount).filter(k => keyCount[k] > 1));

    const htmlDuplicados = duplicados.size ? `
      <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:13px;">
        <strong style="color:#92400E;">⚠ Produtos duplicados (${duplicados.size}):</strong>
        <ul style="margin:4px 0 0 16px;color:#78350F;">
          ${[...duplicados].map(k => `<li>${configs.find(c=>c.nomeKey===k)?.nome || k}</li>`).join('')}
        </ul>
        <span style="font-size:11px;color:#92400E;">Remova as entradas extras para evitar conflitos.</span>
      </div>` : '';

    const filtrar = (nome) => !busca || nome.toLowerCase().includes(busca);

    const htmlGrupos = Object.entries(grupos)
      .sort(([, a], [, b]) => a.ordem - b.ordem || 0)
      .map(([grupo, grpData]) => {
        const itensFiltrados = grpData.itens
          .filter(c => filtrar(c.nome))
          .sort((a,b) => (a.ordemSeparacao||999)-(b.ordemSeparacao||999));
        if (!itensFiltrados.length) return '';
        return `
          <div class="config-grupo-bloco">
            <div class="config-grupo-titulo">${grupo}</div>
            ${itensFiltrados.map(c => htmlConfigItemRow(c)).join('')}
          </div>`;
      }).join('');

    const semConfigFiltrado = semConfig.filter(it => filtrar(it.nomeDisplay));
    const htmlSemConfig = semConfigFiltrado.length ? `
      <div class="config-grupo-bloco">
        <div class="config-grupo-titulo producao-nao-clas-label">&#9888; Não configurados (${semConfigFiltrado.length})</div>
        <p class="producao-nao-clas-hint">Estes itens estão nas festas mas ainda não foram classificados.</p>
        ${semConfigFiltrado.sort((a,b) => a.nomeDisplay.localeCompare(b.nomeDisplay,'pt-BR')).map(it => `
          <div class="config-item-row">
            <div class="config-item-info">
              <div class="config-item-nome">${it.nomeDisplay}</div>
              <div class="config-item-meta">Sem configuração</div>
            </div>
            <div class="config-item-acoes">
              <button class="btn-icone" title="Configurar" onclick="abrirFormItemConfig(null,'${_esc(it.nomeDisplay)}')">+ Config.</button>
            </div>
          </div>
        `).join('')}
      </div>
    ` : '';

    const conteudo = htmlDuplicados + htmlGrupos + htmlSemConfig;
    el.innerHTML = conteudo || estadoVazio(busca ? `Nenhum produto encontrado para "${busca}".` : 'Nenhum item encontrado. Cadastre uma festa para começar.');
  } catch(e) {
    console.error(e);
    el.innerHTML = estadoVazio('Erro ao carregar. Tente novamente.');
  }
}

function htmlConfigItemRow(c) {
  const badgeProd   = c.eProducao ? '<span class="badge-producao">Produção</span>' : '';
  const catOculta   = (() => {
    if (!c.grupo) return false;
    const cat = categoriasCache.find(x => x.nome === c.grupo);
    return cat && cat.exibirSeparacao === false;
  })();
  const badgeSep    = (c.exibirSeparacao === false || catOculta) ? '<span class="badge-oculto-sep">Oculto sep.</span>' : '';
  const nomeExibido = nomeBasDisplay(c.nome);
  const metaHtml    = `
    ${c.ordemSeparacao && c.ordemSeparacao !== 999 ? `<span class="badge-ordem">#${c.ordemSeparacao}</span>` : ''}
    ${c.prioridade ? `<span class="badge-prioridade prior-${c.prioridade}">${c.prioridade}</span>` : ''}
    ${c.refrigerado ? '<span class="badge-refrigerado">&#10052; Refrig.</span>' : ''}
  `;

  return `
    <div class="config-item-row" data-item-id="${_esc(c.id)}" onclick="onClickItemCadastro('${_esc(c.id)}')">
      <input type="checkbox" class="chk-item-cadastro" onclick="event.stopPropagation();toggleSelecaoItemCadastro('${_esc(c.id)}')">
      <div class="config-item-info">
        <div class="config-item-nome">${nomeExibido} ${badgeProd} ${badgeSep}</div>
        <div class="config-item-meta">${metaHtml}</div>
      </div>
      <div class="config-item-acoes">
        <button class="btn-icone" title="Editar" onclick="event.stopPropagation();abrirFormItemConfig('${c.id}')">&#9998;</button>
        <button class="btn-icone btn-icone-del" title="Remover" onclick="event.stopPropagation();confirmarDeletarItemConfig('${_esc(c.id)}','${_esc(c.nome)}')">&#128465;</button>
      </div>
    </div>
  `;
}

function onClickItemCadastro(id) {
  if (_modoSelecaoCadastro) toggleSelecaoItemCadastro(id);
}

async function abrirFormItemConfig(id, nomePreenchido) {
  _itemConfigEditId = id || null;
  await preencherSugestoesItemConfig();

  const resetForm = (cfg) => {
    document.getElementById('ic-nome').value    = cfg?.nome  || nomePreenchido || '';
    document.getElementById('ic-grupo').value   = cfg?.grupo || '';
    document.getElementById('ic-ordem').value   = (cfg?.ordemSeparacao && cfg.ordemSeparacao !== 999) ? cfg.ordemSeparacao : '';
    document.getElementById('ic-dias-antes').value = cfg?.diasAntesEvento ?? 1;
    document.getElementById('ic-refrigerado').checked    = !!cfg?.refrigerado;
    document.getElementById('ic-producao').checked        = !!cfg?.eProducao;
    document.getElementById('ic-separacao').checked       = cfg?.exibirSeparacao !== false;
    document.getElementById('ic-exige-foto').checked      = !!cfg?.exigeFoto;
    document.getElementById('ic-conferir-coord').checked  = cfg?.conferirCoord !== false;
    document.getElementById('ic-setor').value        = cfg?.setor        || '';
    document.getElementById('ic-prateleira').value   = cfg?.prateleira   || '';
    document.getElementById('ic-estoque-min').value  = cfg?.estoqueMinimo != null ? cfg.estoqueMinimo : '';
    document.getElementById('ic-qtd-sugerida').value = cfg?.qtdSugerida  != null ? cfg.qtdSugerida  : '';
    toggleStandByForm();
    document.querySelectorAll('input[name="ic-prioridade"]').forEach(r => {
      r.checked = r.value === (cfg?.prioridade || '');
    });
  };

  if (id) {
    const configs = await listarItemConfigs();
    const cfg = configs.find(c => c.id === id);
    if (!cfg) return toast('Item não encontrado.', 'erro');
    resetForm(cfg);
    historico.push('tela-form-item-config');
    mostrarTela('tela-form-item-config', 'Editar Item');
  } else {
    resetForm(null);
    /* Pré-preencher grupo com categoria detectada automaticamente (sugestão editável) */
    if (nomePreenchido) {
      const keyBusca = normalizarNomeItem(nomePreenchido);
      let sugestao = '';
      todasFestasCache.forEach(f => {
        if (sugestao) return;
        (f.itens || []).forEach(it => {
          if (sugestao) return;
          const k = normalizarNomeItem(it.nome);
          if (k === keyBusca || nomeBaseKey(k) === keyBusca) sugestao = it.categoria || '';
        });
      });
      if (sugestao) document.getElementById('ic-grupo').value = sugestao;
    }
    historico.push('tela-form-item-config');
    mostrarTela('tela-form-item-config', nomePreenchido ? `Configurar: ${nomePreenchido}` : 'Novo Item');
  }
}

async function preencherSugestoesItemConfig() {
  try {
    const festas = todasFestasCache.length ? todasFestasCache : await buscarTodasFestas();
    const nomesSet  = new Set();
    const gruposSet = new Set();

    festas.forEach(f => (f.itens || []).forEach(it => {
      if (it.nome) nomesSet.add(nomeBasDisplay(it.nome));
    }));
    /* Prioridade: categorias cadastradas, depois grupos dos configs */
    categoriasCache.forEach(c => { if (c.nome) gruposSet.add(c.nome); });
    Object.values(itemConfigsCache).forEach(c => { if (c.grupo) gruposSet.add(c.grupo); });

    const dlNomes = document.getElementById('ic-nomes-lista');
    if (dlNomes) dlNomes.innerHTML = [...nomesSet].sort().map(n => `<option value="${n}">`).join('');

    const dlGrupos = document.getElementById('ic-grupos-lista');
    if (dlGrupos) dlGrupos.innerHTML = [...gruposSet].sort().map(g => `<option value="${g}">`).join('');
  } catch(e) { console.error(e); }
}

function toggleStandByForm() {
  const refrig  = document.getElementById('ic-refrigerado')?.checked;
  const prod    = document.getElementById('ic-producao')?.checked;
  const section = document.getElementById('ic-standby-config');
  if (section) section.classList.toggle('hidden', !refrig && !prod);
}
function toggleRefrigeradoForm(checked) { toggleStandByForm(); }

async function salvarItemConfig() {
  const nome = document.getElementById('ic-nome').value.trim();
  if (!nome) return toast('Informe o nome do item.', 'erro');

  const grupo       = document.getElementById('ic-grupo').value.trim();
  const ordemStr    = document.getElementById('ic-ordem').value.trim();
  const diasStr     = document.getElementById('ic-dias-antes').value.trim();
  const refrigerado = document.getElementById('ic-refrigerado').checked;
  const prioEl      = document.querySelector('input[name="ic-prioridade"]:checked');
  const prioridade  = prioEl ? prioEl.value : '';

  const eProducao       = document.getElementById('ic-producao').checked;
  const exibirSeparacao = document.getElementById('ic-separacao').checked;
  const exigeFoto       = document.getElementById('ic-exige-foto').checked;
  const conferirCoord   = document.getElementById('ic-conferir-coord').checked;
  const setor           = document.getElementById('ic-setor').value.trim();
  const prateleira      = document.getElementById('ic-prateleira').value.trim();

  const dados = {
    nome,
    nomeKey:          normalizarNomeItem(nome),
    grupo:            grupo || '',
    ordemSeparacao:   ordemStr ? parseInt(ordemStr) : 999,
    prioridade,
    eProducao,
    exibirSeparacao,
    exigeFoto,
    conferirCoord,
    setor,
    prateleira,
    refrigerado,
    diasAntesEvento: (refrigerado || eProducao) ? (diasStr !== '' && !isNaN(parseInt(diasStr)) ? parseInt(diasStr) : 1) : 1,
    estoqueMinimo: (() => { const v = parseFloat(document.getElementById('ic-estoque-min').value); return isNaN(v) ? null : v; })(),
    qtdSugerida:   (() => { const v = parseFloat(document.getElementById('ic-qtd-sugerida').value); return isNaN(v) ? null : v; })(),
  };

  if (_itemConfigEditId) dados.id = _itemConfigEditId;

  /* Verificar duplicado: outro item já tem o mesmo nomeKey */
  const todosConfigs = await listarItemConfigs();
  const duplicado = todosConfigs.find(c => c.nomeKey === dados.nomeKey && c.id !== _itemConfigEditId);
  if (duplicado) {
    if (!confirm(`Já existe um produto cadastrado com o nome "${duplicado.nome}".\n\nDeseja substituí-lo?`)) return;
  }

  try {
    await salvarItemConfigDB(dados);
    /* Se o nomeKey mudou durante edição, remove a entrada antiga do cache */
    if (_itemConfigEditId) {
      const oldKey = Object.keys(itemConfigsCache).find(k => itemConfigsCache[k].id === _itemConfigEditId);
      if (oldKey && oldKey !== dados.nomeKey) delete itemConfigsCache[oldKey];
    }
    itemConfigsCache[dados.nomeKey] = { ...(itemConfigsCache[dados.nomeKey] || {}), ...dados };
    toast('Item salvo com sucesso.', 'sucesso');
    goBack();
    /* Recarregar lista se voltou para tela de cadastro */
    setTimeout(async () => {
      if (historico[historico.length - 1] === 'tela-cadastro-itens') {
        await renderizarCadastroItens();
      }
    }, 100);
  } catch(e) {
    console.error(e);
    toast('Erro ao salvar item.', 'erro');
  }
}

async function confirmarDeletarItemConfig(id, nome) {
  if (!confirm(`Remover configuração de "${nome}"?\n\nIsso não afeta as festas já cadastradas.`)) return;
  try {
    await deletarItemConfigDB(id);
    const nomeKey = Object.keys(itemConfigsCache).find(k => itemConfigsCache[k].id === id);
    if (nomeKey) delete itemConfigsCache[nomeKey];
    toast('Item removido.', 'sucesso');
    await renderizarCadastroItens();
  } catch(e) {
    console.error(e);
    toast('Erro ao remover item.', 'erro');
  }
}

/* ── Seleção em massa no Cadastro ── */
function toggleModoSelecaoCadastro() {
  _modoSelecaoCadastro = !_modoSelecaoCadastro;
  _itensSelecionados.clear();

  const lista   = document.getElementById('cadastro-itens-lista');
  const barra   = document.getElementById('barra-selecao-cadastro');
  const btnSel  = document.getElementById('btn-selecionar-itens');
  const btnNovo = document.getElementById('btn-novo-item-config');

  if (_modoSelecaoCadastro) {
    lista?.classList.add('modo-selecao');
    barra?.classList.remove('hidden');
    if (btnSel)  btnSel.textContent = '✕ Cancelar';
    if (btnNovo) btnNovo.classList.add('hidden');
  } else {
    lista?.classList.remove('modo-selecao');
    barra?.classList.add('hidden');
    if (btnSel)  btnSel.textContent = '☐ Selecionar';
    if (btnNovo) btnNovo.classList.remove('hidden');
    /* Limpa checkboxes visualmente */
    lista?.querySelectorAll('.chk-item-cadastro').forEach(c => c.checked = false);
    lista?.querySelectorAll('.config-item-row').forEach(r => r.classList.remove('selecionado'));
  }
  _atualizarBarraSelecao();
}

function toggleSelecaoItemCadastro(id) {
  if (_itensSelecionados.has(id)) {
    _itensSelecionados.delete(id);
  } else {
    _itensSelecionados.add(id);
  }
  const sel = _itensSelecionados.has(id);
  const row = document.querySelector(`.config-item-row[data-item-id="${id}"]`);
  if (row) {
    row.classList.toggle('selecionado', sel);
    const chk = row.querySelector('.chk-item-cadastro');
    if (chk) chk.checked = sel;
  }
  _atualizarBarraSelecao();
}

function toggleSelecionarTudoCadastro(marcar) {
  document.querySelectorAll('#cadastro-itens-lista .config-item-row[data-item-id]').forEach(row => {
    const id = row.dataset.itemId;
    if (!id) return;
    if (marcar) {
      _itensSelecionados.add(id);
    } else {
      _itensSelecionados.delete(id);
    }
    row.classList.toggle('selecionado', marcar);
    const chk = row.querySelector('.chk-item-cadastro');
    if (chk) chk.checked = marcar;
  });
  _atualizarBarraSelecao();
}

function _atualizarBarraSelecao() {
  const n       = _itensSelecionados.size;
  const cont    = document.getElementById('selecao-contagem');
  const btnDel  = document.getElementById('btn-excluir-selecionados');
  const chkTudo = document.getElementById('chk-selecionar-tudo');
  if (cont)   cont.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
  if (btnDel) btnDel.disabled  = n === 0;
  if (chkTudo) {
    const total = document.querySelectorAll('#cadastro-itens-lista .config-item-row[data-item-id]').length;
    chkTudo.indeterminate = n > 0 && n < total;
    chkTudo.checked       = total > 0 && n === total;
  }
}

async function excluirSelecionadosCadastro() {
  const ids = [..._itensSelecionados];
  if (!ids.length) return;
  if (!confirm(`Remover ${ids.length} item${ids.length !== 1 ? 's' : ''} do cadastro?\n\nIsso não afeta as festas já cadastradas.`)) return;
  const btnDel = document.getElementById('btn-excluir-selecionados');
  if (btnDel) { btnDel.disabled = true; btnDel.textContent = 'Removendo...'; }
  try {
    await Promise.all(ids.map(id => deletarItemConfigDB(id)));
    ids.forEach(id => {
      const nomeKey = Object.keys(itemConfigsCache).find(k => itemConfigsCache[k].id === id);
      if (nomeKey) delete itemConfigsCache[nomeKey];
    });
    _itensSelecionados.clear();
    toast(`${ids.length} item${ids.length !== 1 ? 's' : ''} removido${ids.length !== 1 ? 's' : ''}.`, 'sucesso');
    toggleModoSelecaoCadastro();
  } catch(e) {
    console.error(e);
    toast('Erro ao remover itens. Tente novamente.', 'erro');
    if (btnDel) { btnDel.disabled = false; btnDel.textContent = '🗑 Excluir'; }
  }
}

/* ══════════════════════════════════════════════════
   ANÁLISE DE DESEMPENHO
══════════════════════════════════════════════════ */

let _analiseAno   = new Date().getFullYear();
let _analiseMes   = new Date().getMonth();
let _analiseCache = [];

const MESES_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function _fmtMin(mins) {
  if (!isFinite(mins) || mins < 0) return '—';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function _classeVelocidade(mins, media) {
  if (!isFinite(mins) || !isFinite(media) || media === 0) return '';
  const ratio = mins / media;
  if (ratio <= 0.8)  return 'analise-rapido';
  if (ratio >= 1.3)  return 'analise-lento';
  return 'analise-medio';
}

async function abrirAnalise() {
  historico.push(telaListaAtual());
  mostrarTela('tela-analise', 'Análise de Desempenho');
  _analiseAno = new Date().getFullYear();
  _analiseMes = new Date().getMonth();
  await carregarAnalise();
}

async function carregarAnalise() {
  document.getElementById('analise-conteudo').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    _analiseCache = await buscarTodasFestas();
    renderizarAnalise();
  } catch(e) {
    console.error(e);
    document.getElementById('analise-conteudo').innerHTML =
      estadoVazio('Erro ao carregar dados.');
  }
}

function navMesAnalise(delta) {
  _analiseMes += delta;
  if (_analiseMes < 0)  { _analiseMes = 11; _analiseAno--; }
  if (_analiseMes > 11) { _analiseMes = 0;  _analiseAno++; }
  document.getElementById('analise-mes-label').textContent =
    `${MESES_FULL[_analiseMes]} ${_analiseAno}`;
  renderizarAnalise();
}

function renderizarAnalise() {
  const label = document.getElementById('analise-mes-label');
  if (label) label.textContent = `${MESES_FULL[_analiseMes]} ${_analiseAno}`;

  /* Festas com separação concluída no período */
  const registros = _analiseCache
    .filter(f => {
      if (!f.separacaoInicio || !f.separacaoFim) return false;
      const d = toDate(f.separacaoFim);
      return d.getMonth() === _analiseMes && d.getFullYear() === _analiseAno;
    })
    .map(f => {
      const ini  = toDate(f.separacaoInicio);
      const fim  = toDate(f.separacaoFim);
      const mins = Math.round((fim - ini) / 60000);
      const totalItens = (f.itens || []).length;
      const sepItens   = (f.itens || []).filter(it => it.separado).length;
      return {
        festaId: f.id, nome: f.nome, cliente: f.cliente || '—',
        colaborador: f.colaborador || '—',
        data: f.data, dataFim: f.separacaoFim,
        ini, fim, mins, totalItens, sepItens,
        status: f.status,
      };
    })
    .filter(r => r.mins > 0)
    .sort((a, b) => toDate(b.dataFim) - toDate(a.dataFim));

  const el = document.getElementById('analise-conteudo');
  if (!el) return;

  if (!registros.length) {
    el.innerHTML = estadoVazio(`Nenhuma separação concluída em ${MESES_FULL[_analiseMes]} ${_analiseAno}.`);
    return;
  }

  /* Métricas globais */
  const mediaMins = Math.round(registros.reduce((s, r) => s + r.mins, 0) / registros.length);
  const maisRapido = registros.reduce((a, b) => a.mins < b.mins ? a : b);
  const maisLento  = registros.reduce((a, b) => a.mins > b.mins ? a : b);
  const totalItens = registros.reduce((s, r) => s + r.totalItens, 0);

  /* Por colaborador */
  const porColab = {};
  registros.forEach(r => {
    if (!porColab[r.colaborador]) porColab[r.colaborador] = [];
    porColab[r.colaborador].push(r);
  });
  const ranking = Object.entries(porColab)
    .map(([nome, regs]) => ({
      nome,
      total:   regs.length,
      media:   Math.round(regs.reduce((s, r) => s + r.mins, 0) / regs.length),
      melhor:  Math.min(...regs.map(r => r.mins)),
      pior:    Math.max(...regs.map(r => r.mins)),
      itens:   regs.reduce((s, r) => s + r.totalItens, 0),
    }))
    .sort((a, b) => a.media - b.media);

  el.innerHTML = `
    <!-- Cards de resumo -->
    <div class="analise-cards">
      <div class="analise-card">
        <div class="analise-card-valor">${registros.length}</div>
        <div class="analise-card-label">Separações no período</div>
      </div>
      <div class="analise-card">
        <div class="analise-card-valor">${_fmtMin(mediaMins)}</div>
        <div class="analise-card-label">Tempo médio</div>
      </div>
      <div class="analise-card analise-card-verde">
        <div class="analise-card-valor">${_fmtMin(maisRapido.mins)}</div>
        <div class="analise-card-label">Mais rápida<br><span class="analise-card-sub">${maisRapido.nome || maisRapido.cliente}</span></div>
      </div>
      <div class="analise-card analise-card-laranja">
        <div class="analise-card-valor">${_fmtMin(maisLento.mins)}</div>
        <div class="analise-card-label">Mais demorada<br><span class="analise-card-sub">${maisLento.nome || maisLento.cliente}</span></div>
      </div>
    </div>

    <!-- Ranking colaboradores -->
    <h3 class="analise-secao-titulo">Desempenho por Colaborador</h3>
    <div class="analise-ranking">
      ${ranking.map((c, i) => `
        <div class="analise-colab-card ${c.media <= mediaMins * 0.9 ? 'analise-colab-top' : ''}">
          <div class="analise-colab-pos">${i + 1}º</div>
          <div class="analise-colab-info">
            <div class="analise-colab-nome">${c.nome}</div>
            <div class="analise-colab-stats">
              ${c.total} separação${c.total > 1 ? 'ões' : ''} &nbsp;·&nbsp;
              ${c.itens} itens no total
            </div>
          </div>
          <div class="analise-colab-tempos">
            <div class="analise-tempo-bloco">
              <div class="analise-tempo-val analise-rapido">${_fmtMin(c.melhor)}</div>
              <div class="analise-tempo-legenda">melhor</div>
            </div>
            <div class="analise-tempo-bloco">
              <div class="analise-tempo-val">${_fmtMin(c.media)}</div>
              <div class="analise-tempo-legenda">média</div>
            </div>
            <div class="analise-tempo-bloco">
              <div class="analise-tempo-val analise-lento">${_fmtMin(c.pior)}</div>
              <div class="analise-tempo-legenda">pior</div>
            </div>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- Lista de separações -->
    <h3 class="analise-secao-titulo">Todas as Separações</h3>
    <div class="analise-lista">
      <div class="analise-lista-header">
        <span>Festa / Cliente</span>
        <span>Colaborador</span>
        <span>Data evento</span>
        <span>Duração</span>
      </div>
      ${registros.map(r => {
        const cls  = _classeVelocidade(r.mins, mediaMins);
        const dataEvento = r.data
          ? toDate(r.data).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })
          : '—';
        const horaIni = r.ini.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
        const horaFim = r.fim.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
        return `
          <div class="analise-lista-row">
            <div>
              <div class="analise-lista-nome">${r.nome || '—'}</div>
              <div class="analise-lista-cliente">${r.cliente}</div>
            </div>
            <div class="analise-lista-colab">${r.colaborador}</div>
            <div class="analise-lista-data">${dataEvento}</div>
            <div>
              <span class="analise-duracao ${cls}">${_fmtMin(r.mins)}</span>
              <div class="analise-horario">${horaIni} → ${horaFim}</div>
            </div>
          </div>`;
      }).join('')}
    </div>
  `;
}

/* ══════════════════════════════════════════════════
   RELATÓRIO POR PERÍODO
══════════════════════════════════════════════════ */

let relPeriodoAno = new Date().getFullYear();
let relPeriodoMes = new Date().getMonth();
let abaRelAtual   = 'item';

async function abrirRelatorio() {
  navegarSidebar();
  historico.push('tela-relatorio');
  mostrarTela('tela-relatorio', 'Relatório por Período');
  relPeriodoAno = new Date().getFullYear();
  relPeriodoMes = new Date().getMonth();
  abaRelAtual   = 'item';
  document.querySelectorAll('#rel-tabs .tab').forEach((b, i) => b.classList.toggle('ativo', i === 0));
  await renderizarRelatorio();
}

async function renderizarRelatorio() {
  atualizarLabelRelPeriodo();
  const elC = document.getElementById('rel-conteudo');
  if (elC) elC.innerHTML = '<div class="estado-vazio"><p>Calculando...</p></div>';

  try {
    const [estoqueMap, festas] = await Promise.all([
      buscarEstoque(),
      todasFestasCache.length ? Promise.resolve(todasFestasCache) : buscarTodasFestas(),
    ]);
    estoqueCache     = estoqueMap;
    todasFestasCache = festas;

    const inicio = new Date(relPeriodoAno, relPeriodoMes, 1);
    const fim    = new Date(relPeriodoAno, relPeriodoMes + 1, 0, 23, 59, 59);
    const festasNoPeriodo = festas.filter(f => {
      const d = toDate(f.data);
      return !isNaN(d) && d >= inicio && d <= fim;
    });

    renderizarSumarioRelatorio(festasNoPeriodo);
    if (abaRelAtual === 'item') {
      renderizarRelPorItem(festasNoPeriodo, festas, estoqueMap);
    } else {
      renderizarRelPorFesta(festasNoPeriodo);
    }
  } catch(e) {
    console.error(e);
    const elC = document.getElementById('rel-conteudo');
    if (elC) elC.innerHTML = estadoVazio('Erro ao carregar. Tente novamente.');
  }
}

function atualizarLabelRelPeriodo() {
  const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const el = document.getElementById('rel-mes-label');
  if (el) el.textContent = `${MESES[relPeriodoMes]} ${relPeriodoAno}`;
}

function navMesRelatorio(delta) {
  relPeriodoMes += delta;
  if (relPeriodoMes < 0)  { relPeriodoMes = 11; relPeriodoAno--; }
  if (relPeriodoMes > 11) { relPeriodoMes = 0;  relPeriodoAno++; }
  renderizarRelatorio();
}

function trocarAbaRelatorio(aba, btn) {
  abaRelAtual = aba;
  document.querySelectorAll('#rel-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  renderizarRelatorio();
}

function renderizarSumarioRelatorio(festas) {
  const el = document.getElementById('rel-sumario');
  if (!el) return;

  const nomeKeys   = new Set(festas.flatMap(f => (f.itens||[]).map(it => normalizarNomeItem(it.nome))));
  const totSaida   = festas.reduce((s,f) => s+(f.itens||[]).reduce((ss,it) => ss+(it.qtdConferida??it.qtdSeparada??0),0),0);
  const totRetorno = festas.reduce((s,f) => s+(f.itens||[]).reduce((ss,it) => ss+(it.qtdRetorno||0),0),0);
  const totAvarias = festas.reduce((s,f) => s+(f.itens||[]).reduce((ss,it) => ss+(it.qtdDanificada||0),0),0);

  el.innerHTML = [
    { num: festas.length,  lab: 'Festas' },
    { num: nomeKeys.size,  lab: 'Itens únicos' },
    { num: totSaida,       lab: 'Total Saída' },
    { num: totRetorno,     lab: 'Total Retorno' },
    { num: totAvarias||'—', lab: 'Avarias', red: totAvarias > 0 },
  ].map(p => `
    <div class="rel-pill">
      <span class="rel-pill-num${p.red?' deficit-text':''}">${p.num}</span>
      <span class="rel-pill-lab">${p.lab}</span>
    </div>
  `).join('');
}

function renderizarRelPorItem(festasNoPeriodo, todasFestas, estoqueMap) {
  const el = document.getElementById('rel-conteudo');
  if (!el) return;

  if (!festasNoPeriodo.length) {
    el.innerHTML = estadoVazio('Nenhuma festa neste período. Use as setas para navegar entre meses.');
    return;
  }

  /* Agregar por nomeKey */
  const mapa = {};
  festasNoPeriodo.forEach(festa => {
    (festa.itens || []).forEach(item => {
      const key = normalizarNomeItem(item.nome);
      if (!mapa[key]) mapa[key] = {
        nomeKey: key, nome: item.nome, unidade: item.unidade||'un',
        solicitado:0, saida:0, retorno:0, avarias:0, festasDetalhe:[],
      };
      const saida = item.qtdConferida ?? item.qtdSeparada ?? 0;
      mapa[key].solicitado += item.qtdNecessaria || 0;
      mapa[key].saida      += saida;
      mapa[key].retorno    += item.qtdRetorno    || 0;
      mapa[key].avarias    += item.qtdDanificada || 0;
      mapa[key].festasDetalhe.push({
        festaNome: festa.nome, festaData: festa.data, festaStatus: festa.status,
        solicitado: item.qtdNecessaria||0, saida,
        retorno: item.qtdRetorno||0, avarias: item.qtdDanificada||0,
      });
    });
  });

  /* Solicitado pendente para cálculo "Após Pendentes" */
  const solPend = {};
  todasFestas.filter(f => f.status !== 'concluida').forEach(f => {
    (f.itens||[]).forEach(it => {
      const k = normalizarNomeItem(it.nome);
      solPend[k] = (solPend[k]||0) + (it.qtdNecessaria||0);
    });
  });

  const itens = Object.values(mapa).map(it => ({
    ...it,
    extra:        Math.max(0, it.saida - it.solicitado),
    estoqueAtual: estoqueMap[it.nomeKey]?.qtd || 0,
    esperado:     (estoqueMap[it.nomeKey]?.qtd || 0) - (solPend[it.nomeKey] || 0),
    cfg:          itemConfigsCache[it.nomeKey],
  }));

  /* Agrupar por categoria */
  const grupos = {};
  itens.forEach(it => {
    const g = it.cfg?.grupo || 'Sem Categoria';
    if (!grupos[g]) grupos[g] = { ordem: 999, itens: [] };
    const cat = categoriasCache.find(c => c.nome === g);
    if (cat) grupos[g].ordem = cat.ordem || 999;
    grupos[g].itens.push(it);
  });

  el.innerHTML = Object.entries(grupos)
    .sort(([,a],[,b]) => a.ordem - b.ordem)
    .map(([grupo, gData]) => `
      <div class="rel-grupo-bloco">
        <div class="rel-grupo-titulo">${grupo}</div>
        ${gData.itens.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR')).map(it => htmlRelItemCard(it)).join('')}
      </div>
    `).join('');
}

function htmlRelItemCard(it) {
  const aproveit   = it.saida > 0 ? Math.round((it.retorno / it.saida) * 100) : null;
  const espCls     = it.esperado < 0 ? 'deficit-text' : 'ok-text';
  const badgeRefrig = it.cfg?.refrigerado ? '<span class="badge-refrigerado">&#10052;</span>' : '';

  return `
    <div class="rel-card">
      <div class="rel-card-header">
        <div class="rel-card-nome">${it.nome} ${badgeRefrig}</div>
        <div class="rel-card-badges">
          ${it.cfg?.prioridade ? `<span class="badge-prioridade prior-${it.cfg.prioridade}">${it.cfg.prioridade}</span>` : ''}
        </div>
      </div>
      <div class="rel-grid">
        <div class="rel-cell">
          <div class="rel-cell-valor">${it.solicitado}</div>
          <div class="rel-cell-label">Solicitado</div>
        </div>
        <div class="rel-cell">
          <div class="rel-cell-valor">${it.saida}</div>
          <div class="rel-cell-label">Saída</div>
        </div>
        <div class="rel-cell">
          <div class="rel-cell-valor ${it.extra>0?'ok-text':'rel-cinza'}">${it.extra>0?'+'+it.extra:'—'}</div>
          <div class="rel-cell-label">Extra</div>
        </div>
        <div class="rel-cell">
          <div class="rel-cell-valor">${it.retorno}</div>
          <div class="rel-cell-label">Retorno</div>
        </div>
        <div class="rel-cell">
          <div class="rel-cell-valor ${it.avarias>0?'deficit-text':'rel-cinza'}">${it.avarias>0?it.avarias:'—'}</div>
          <div class="rel-cell-label">Avarias</div>
        </div>
        <div class="rel-cell">
          <div class="rel-cell-valor">${aproveit!==null?aproveit+'%':'—'}</div>
          <div class="rel-cell-label">Aproveit.</div>
        </div>
        <div class="rel-cell">
          <div class="rel-cell-valor">${it.estoqueAtual}</div>
          <div class="rel-cell-label">Est. Atual</div>
        </div>
        <div class="rel-cell">
          <div class="rel-cell-valor ${espCls}">${it.esperado}</div>
          <div class="rel-cell-label">Após Pend.</div>
        </div>
      </div>
      <details class="rel-card-detalhe">
        <summary>Ver festas deste período (${it.festasDetalhe.length})</summary>
        ${htmlRelDetalhesFestas(it.festasDetalhe, it.unidade)}
      </details>
    </div>
  `;
}

function htmlRelDetalhesFestas(detalhes, unidade) {
  const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return detalhes.map(d => {
    let dataTxt = '';
    if (d.festaData) {
      const dt = toDate(d.festaData);
      if (!isNaN(dt)) dataTxt = `${String(dt.getDate()).padStart(2,'0')} ${MESES_ABR[dt.getMonth()]}`;
    }
    return `
      <div class="rel-detalhe-row">
        <div class="rel-detalhe-festa">
          ${d.festaNome}${dataTxt?' — '+dataTxt:''}
          <span class="badge badge-${d.festaStatus}" style="font-size:9px;margin-left:4px">${STATUS_LABELS[d.festaStatus]||d.festaStatus}</span>
        </div>
        <div class="rel-detalhe-nums">
          <span>Solicitado: <strong>${d.solicitado}</strong></span>
          <span>Saída: <strong>${d.saida}</strong></span>
          <span>Retorno: <strong>${d.retorno}</strong></span>
          ${d.avarias?`<span class="deficit-text">Avarias: <strong>${d.avarias}</strong></span>`:''}
        </div>
      </div>
    `;
  }).join('');
}

function renderizarRelPorFesta(festasNoPeriodo) {
  const el = document.getElementById('rel-conteudo');
  if (!el) return;

  if (!festasNoPeriodo.length) {
    el.innerHTML = estadoVazio('Nenhuma festa neste período.');
    return;
  }

  el.innerHTML = festasNoPeriodo.map(f => {
    const itens  = f.itens || [];
    const totSol = itens.reduce((s,it) => s+(it.qtdNecessaria||0), 0);
    const totSai = itens.reduce((s,it) => s+(it.qtdConferida??it.qtdSeparada??0), 0);
    const totRet = itens.reduce((s,it) => s+(it.qtdRetorno||0), 0);
    const totAva = itens.reduce((s,it) => s+(it.qtdDanificada||0), 0);
    const saldo  = totSai - totRet;
    const apr    = totSai > 0 ? Math.round((totRet/totSai)*100) : null;

    return `
      <div class="rel-festa-card">
        <div class="rel-festa-header">
          <div>
            <div class="rel-festa-nome">${f.nome}</div>
            <div class="rel-festa-meta">${formatarData(f.data)}${f.cliente?' · '+f.cliente:''}</div>
          </div>
          <span class="badge badge-${f.status}">${STATUS_LABELS[f.status]||f.status}</span>
        </div>
        <div class="rel-grid" style="grid-template-columns:repeat(4,1fr)">
          <div class="rel-cell"><div class="rel-cell-valor">${totSol}</div><div class="rel-cell-label">Solicitado</div></div>
          <div class="rel-cell"><div class="rel-cell-valor">${totSai}</div><div class="rel-cell-label">Saída</div></div>
          <div class="rel-cell"><div class="rel-cell-valor">${totRet}</div><div class="rel-cell-label">Retorno</div></div>
          <div class="rel-cell">
            <div class="rel-cell-valor ${totAva>0?'deficit-text':'rel-cinza'}">${totAva||'—'}</div>
            <div class="rel-cell-label">Avarias</div>
          </div>
        </div>
        <div class="rel-festa-saldo">
          Saldo líquido: <strong class="${saldo>0?'deficit-text':'ok-text'}">${saldo} itens consumidos</strong>
          ${apr!==null?`&nbsp;·&nbsp; Aproveit.: <strong>${apr}%</strong>`:''}
        </div>
      </div>
    `;
  }).join('');
}

function exportarCSVRelatorio() {
  const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const inicio = new Date(relPeriodoAno, relPeriodoMes, 1);
  const fim    = new Date(relPeriodoAno, relPeriodoMes + 1, 0, 23, 59, 59);
  const festas = todasFestasCache.filter(f => {
    const d = toDate(f.data); return !isNaN(d) && d >= inicio && d <= fim;
  });

  const mapa = {};
  festas.forEach(festa => {
    (festa.itens||[]).forEach(item => {
      const key = normalizarNomeItem(item.nome);
      if (!mapa[key]) mapa[key] = { nome:item.nome, unidade:item.unidade||'un', solicitado:0, saida:0, retorno:0, avarias:0 };
      mapa[key].solicitado += item.qtdNecessaria||0;
      mapa[key].saida      += item.qtdConferida??item.qtdSeparada??0;
      mapa[key].retorno    += item.qtdRetorno||0;
      mapa[key].avarias    += item.qtdDanificada||0;
    });
  });

  const solPend = {};
  todasFestasCache.filter(f=>f.status!=='concluida').forEach(f=>{
    (f.itens||[]).forEach(it=>{
      const k=normalizarNomeItem(it.nome);
      solPend[k]=(solPend[k]||0)+(it.qtdNecessaria||0);
    });
  });

  const linhas = [['Item','Unidade','Categoria','Solicitado','Saída','Extra','Retorno','Avarias','Aproveit%','Est.Atual','AposPend']];
  Object.entries(mapa).forEach(([key, it]) => {
    const cfg  = itemConfigsCache[key];
    const est  = estoqueCache[key]?.qtd || 0;
    const apr  = it.saida>0 ? Math.round(it.retorno/it.saida*100) : 0;
    const ext  = Math.max(0, it.saida-it.solicitado);
    linhas.push([it.nome, it.unidade, cfg?.grupo||'', it.solicitado, it.saida, ext, it.retorno, it.avarias, apr+'%', est, est-(solPend[key]||0)]);
  });

  const csv  = linhas.map(r => r.join(';')).join('\n');
  const blob = new Blob(['﻿'+csv], { type:'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href:url, download:`relatorio-${MESES_ABR[relPeriodoMes]}-${relPeriodoAno}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════════════
   LOCALIZAÇÕES (Setor / Prateleira por item)
══════════════════════════════════════════════════ */

/* Aplica categorias e fornecimento do item_config nos itens das festas já existentes */
async function backfillCategoriasNasFestas() {
  if (!confirm(
    'Aplicar classificações nas festas já importadas?\n\n' +
    'O sistema vai ler os cadastros de itens e preencher a categoria nos itens de todas as festas que ainda não têm categoria. ' +
    'Itens que já têm categoria não serão alterados.\n\nDeseja continuar?'
  )) return;

  toast('Carregando festas e configurações...', 'info');
  try {
    const [configs, festas] = await Promise.all([
      listarItemConfigs(),
      buscarTodasFestas(),
    ]);

    const cfgMap = {};
    configs.forEach(c => { cfgMap[c.nomeKey] = c; });

    let festasAtualizadas = 0;
    let itensAtualizados  = 0;

    for (const festa of festas) {
      const itens = festa.itens || [];
      let modificado = false;

      const novosItens = itens.map(item => {
        const key = normalizarNomeItem(item.nome);
        const cfg = cfgMap[key] || cfgMap[nomeBaseKey(key)];

        const novoItem = { ...item };
        /* Aplicar categoria se o item não tiver */
        if (!novoItem.categoria && cfg?.grupo) {
          novoItem.categoria = cfg.grupo;
          modificado = true;
          itensAtualizados++;
        }
        /* Detectar fornecimento se não tiver */
        if (!novoItem.fornecimento) {
          for (const suf of SUFIXOS_FORNECIMENTO) {
            if (key.endsWith('_' + suf)) {
              novoItem.fornecimento = suf;
              modificado = true;
              break;
            }
          }
        }
        return novoItem;
      });

      if (modificado) {
        await atualizarFesta(festa.id, { itens: novosItens });
        festasAtualizadas++;
      }
    }

    toast(
      itensAtualizados
        ? `Concluído: ${itensAtualizados} item(ns) em ${festasAtualizadas} festa(s) atualizados.`
        : 'Nenhum item precisou de atualização.',
      'sucesso'
    );
  } catch(e) {
    console.error(e);
    toast('Erro ao aplicar classificações. Tente novamente.', 'erro');
  }
}

async function abrirCadastroLocalizacoes() {
  /* Abre Itens & Configurações já na aba de Localizações */
  await abrirCadastroItens('localizacoes');
}

async function renderizarLocalizacoes() {
  const el = document.getElementById('cadastro-itens-loc');
  if (!el) return;
  el.innerHTML = '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const configs = await listarItemConfigs();
    if (!configs.length) {
      el.innerHTML = '<div class="estado-vazio"><p>Nenhum item configurado. Cadastre itens primeiro.</p></div>';
      return;
    }
    /* Agrupar por categoria */
    const grupos = {};
    configs.forEach(c => {
      const g = c.grupo || 'Sem Categoria';
      if (!grupos[g]) grupos[g] = [];
      grupos[g].push(c);
    });

    el.innerHTML = Object.entries(grupos)
      .sort(([a], [b]) => {
        const oa = categoriasCache.find(cat => cat.nome === a)?.ordem ?? 999;
        const ob = categoriasCache.find(cat => cat.nome === b)?.ordem ?? 999;
        return oa - ob;
      })
      .map(([grupo, itens]) => `
        <div class="config-grupo-bloco">
          <div class="config-grupo-titulo">${grupo}</div>
          ${itens.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR')).map(c => `
            <div class="loc-item-row">
              <div class="loc-item-info">
                <div class="loc-item-nome">${c.nome}</div>
                <div class="loc-item-grupo">${c.grupo || '—'}</div>
              </div>
              <div class="loc-campos">
                <input class="loc-input" id="loc-setor-${c.id}"
                  placeholder="Setor / Ambiente" value="${c.setor || ''}" />
                <input class="loc-input" id="loc-prat-${c.id}"
                  placeholder="Prateleira" value="${c.prateleira || ''}" style="width:90px" />
                <button class="btn-loc-salvar" onclick="salvarLocalizacaoItem('${c.id}','${_esc(c.nomeKey)}')">
                  Salvar
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `).join('');
  } catch(e) {
    console.error(e);
    el.innerHTML = '<div class="estado-vazio"><p>Erro ao carregar. Tente novamente.</p></div>';
  }
}

async function salvarLocalizacaoItem(configId, nomeKey) {
  const setor      = document.getElementById(`loc-setor-${configId}`)?.value.trim() || '';
  const prateleira = document.getElementById(`loc-prat-${configId}`)?.value.trim() || '';
  try {
    await db.collection('item_config').doc(configId).update({ setor, prateleira });
    if (itemConfigsCache[nomeKey]) {
      itemConfigsCache[nomeKey].setor      = setor;
      itemConfigsCache[nomeKey].prateleira = prateleira;
    }
    toast('Localização salva.', 'sucesso');
  } catch(e) {
    console.error(e);
    toast('Erro ao salvar localização.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   CATEGORIAS CRUD
══════════════════════════════════════════════════ */

async function abrirCadastroCategorias() {
  /* Redireciona para a aba Categorias dentro de Cadastro */
  abrirCadastroItens('categorias');
}

async function renderizarCategorias() {
  const el = document.getElementById('cadastro-itens-cat') || document.getElementById('categorias-lista');
  if (!el) return;
  el.innerHTML = '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const cats = await listarCategorias();
    categoriasCache = cats;
    if (!cats.length) {
      el.innerHTML = estadoVazio('Nenhuma categoria cadastrada. Clique em "+ Nova" para criar a primeira.');
      return;
    }
    el.innerHTML = cats.map(c => `
      <div class="config-item-row">
        <div class="config-item-info">
          <div class="config-item-nome">${c.nome}</div>
          <div class="config-item-meta">${c.ordem ? `Ordem: #${c.ordem}` : 'Sem ordem definida'}</div>
        </div>
        <div class="config-item-acoes">
          <button class="btn-icone" title="Editar" onclick="abrirFormCategoria('${c.id}')">&#9998;</button>
          <button class="btn-icone btn-icone-del" title="Remover" onclick="confirmarDeletarCategoria('${_esc(c.id)}','${_esc(c.nome)}')">&#128465;</button>
        </div>
      </div>
    `).join('');
  } catch(e) {
    console.error(e);
    el.innerHTML = estadoVazio('Erro ao carregar. Tente novamente.');
  }
}

async function abrirFormCategoria(id) {
  _categoriaEditId = id || null;
  if (id) {
    const cats = await listarCategorias();
    const cat  = cats.find(c => c.id === id);
    if (!cat) return toast('Categoria não encontrada.', 'erro');
    document.getElementById('cat-nome').value       = cat.nome  || '';
    document.getElementById('cat-ordem').value      = cat.ordem || '';
    document.getElementById('cat-separacao').checked = cat.exibirSeparacao !== false;
    historico.push('tela-form-categoria');
    mostrarTela('tela-form-categoria', 'Editar Categoria');
  } else {
    document.getElementById('cat-nome').value       = '';
    document.getElementById('cat-ordem').value      = '';
    document.getElementById('cat-separacao').checked = true;
    historico.push('tela-form-categoria');
    mostrarTela('tela-form-categoria', 'Nova Categoria');
  }
}

async function salvarCategoria() {
  const nome = document.getElementById('cat-nome').value.trim();
  if (!nome) return toast('Informe o nome da categoria.', 'erro');
  const ordemStr        = document.getElementById('cat-ordem').value.trim();
  const exibirSeparacao = document.getElementById('cat-separacao').checked;
  const dados = {
    nome,
    nomeKey:          normalizarNomeItem(nome),
    ordem:            ordemStr ? parseInt(ordemStr) : 999,
    exibirSeparacao,
  };
  try {
    await salvarCategoriaDB(dados);
    toast('Categoria salva.', 'sucesso');
    goBack();
    setTimeout(async () => {
      const tela = historico[historico.length - 1];
      if (tela === 'tela-cadastro-categorias' || tela === 'tela-cadastro-itens') {
        await renderizarCategorias();
      }
    }, 100);
  } catch(e) {
    console.error(e);
    toast('Erro ao salvar categoria.', 'erro');
  }
}

async function confirmarDeletarCategoria(id, nome) {
  if (!confirm(`Remover a categoria "${nome}"?\n\nItens que usam essa categoria não serão afetados.`)) return;
  try {
    await deletarCategoriaDB(id);
    categoriasCache = categoriasCache.filter(c => c.id !== id);
    toast('Categoria removida.', 'sucesso');
    await renderizarCategorias();
  } catch(e) {
    console.error(e);
    toast('Erro ao remover categoria.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   TELA COMPRAS
══════════════════════════════════════════════════ */

async function abrirCompras() {
  historico.push('tela-compras');
  mostrarTela('tela-compras', 'Compras');
  _abaCompras = 'alertas';
  await recarregarCompras();
}

async function recarregarCompras() {
  try {
    const [cfgs, est, compras] = await Promise.all([
      listarItemConfigs(), buscarEstoque(), listarCompras(),
    ]);
    itemConfigsCache = {};
    cfgs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
    estoqueCache = est;
    comprasCache = compras;
    renderizarCompras();
    atualizarBadgeCompras();
  } catch(e) { console.error(e); toast('Erro ao carregar compras.', 'erro'); }
}

function atualizarBadgeCompras() {
  const alertas = _contarAlertasCompras();
  const badge   = document.getElementById('badge-compras');
  if (!badge) return;
  if (alertas > 0) {
    badge.textContent = alertas;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function _contarAlertasCompras() {
  return Object.values(itemConfigsCache).filter(cfg => {
    if (cfg.estoqueMinimo == null) return false;
    const qtd = estoqueCache[cfg.nomeKey]?.qtd || 0;
    return qtd < cfg.estoqueMinimo;
  }).length;
}

function _alertasCompras() {
  return Object.values(itemConfigsCache)
    .filter(cfg => cfg.estoqueMinimo != null)
    .map(cfg => {
      const qtdAtual = estoqueCache[cfg.nomeKey]?.qtd || 0;
      const falta    = cfg.estoqueMinimo - qtdAtual;
      const pct      = cfg.estoqueMinimo > 0 ? Math.min(100, Math.round((qtdAtual / cfg.estoqueMinimo) * 100)) : 100;
      return { nomeKey: cfg.nomeKey, nome: cfg.nome, unidade: cfg.unidade || 'un',
               qtdAtual, estoqueMinimo: cfg.estoqueMinimo, qtdSugerida: cfg.qtdSugerida || 0,
               falta, pct };
    })
    .sort((a, b) => b.falta - a.falta);
}

function trocarAbaCompras(aba, btn) {
  _abaCompras = aba;
  document.querySelectorAll('#compras-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  ['alertas','andamento','historico'].forEach(id => {
    const el = document.getElementById(`compras-${id}`);
    if (el) el.classList.toggle('hidden', id !== aba);
  });
}

function filtrarCompras(valor) {
  _buscaCompras = valor;
  renderizarCompras();
}

function renderizarCompras() {
  trocarAbaCompras(_abaCompras, document.querySelector(`#compras-tabs .tab.ativo`));
  _renderAlertas();
  _renderAndamento();
  _renderHistorico();
}

function _renderAlertas() {
  const el = document.getElementById('compras-alertas');
  if (!el) return;
  const busca    = _buscaCompras.toLowerCase().trim();
  const todos    = busca ? _alertasCompras().filter(a => (a.nome || '').toLowerCase().includes(busca)) : _alertasCompras();
  const urgentes = todos.filter(a => a.falta > 0);
  const ok       = todos.filter(a => a.falta <= 0);
  const badge    = document.getElementById('badge-alertas-tab');
  if (badge) badge.textContent = urgentes.length || '';

  if (!todos.length) {
    el.innerHTML = '<p class="vazio-sep">Nenhum item com estoque mínimo configurado.</p>';
    return;
  }

  const renderCard = (a) => {
    const cor   = a.falta > 0 ? '' : ' ok';
    const label = a.falta > 0
      ? `<span class="compra-falta-destaque">${a.falta} ${a.unidade} abaixo do mínimo</span>`
      : `<span style="color:#15803d;font-weight:700">✓ Estoque ok</span>`;
    const jaTemPedido = comprasCache.some(c => c.nomeKey === a.nomeKey && (c.status === 'pendente' || c.status === 'pedido'));
    return `
      <div class="compra-alerta-card${cor}">
        <div class="compra-alerta-nome">${a.nome}</div>
        <div class="compra-alerta-nums">
          <span>Atual: <strong>${a.qtdAtual} ${a.unidade}</strong></span>
          <span>Mínimo: <strong>${a.estoqueMinimo} ${a.unidade}</strong></span>
          ${a.qtdSugerida ? `<span>Sugerido: <strong>${a.qtdSugerida} ${a.unidade}</strong></span>` : ''}
        </div>
        ${label}
        <div class="compra-alerta-barra-wrap">
          <div class="compra-alerta-barra-fill${a.falta > 0 ? ' deficit' : ''}" style="width:${a.pct}%"></div>
        </div>
        <div class="compra-alerta-acoes">
          ${a.falta > 0 && !jaTemPedido
            ? `<button class="btn-primario" style="font-size:13px;padding:8px 14px" onclick="abrirModalSolicitar('${a.nomeKey}')">+ Solicitar Compra</button>`
            : jaTemPedido ? `<span style="font-size:12px;color:#1d4ed8;font-weight:600">Pedido em andamento</span>` : ''}
        </div>
      </div>`;
  };

  el.innerHTML = (urgentes.length ? `<h3 style="font-size:13px;font-weight:700;color:#DC2626;margin-bottom:8px">Precisam Comprar (${urgentes.length})</h3>` + urgentes.map(renderCard).join('') : '')
               + (ok.length       ? `<h3 style="font-size:13px;font-weight:700;color:#15803d;margin:16px 0 8px">Estoque OK (${ok.length})</h3>` + ok.map(renderCard).join('') : '');
}

function _renderAndamento() {
  const el = document.getElementById('compras-andamento');
  if (!el) return;
  const busca  = _buscaCompras.toLowerCase().trim();
  const lista  = comprasCache.filter(c => (c.status === 'pendente' || c.status === 'pedido') && (!busca || (c.nome || '').toLowerCase().includes(busca)));
  const badge  = document.getElementById('badge-andamento-tab');
  if (badge) badge.textContent = lista.length || '';

  if (!lista.length) {
    el.innerHTML = '<p class="vazio-sep">Nenhum pedido em andamento.</p>';
    return;
  }

  el.innerHTML = lista.map(c => {
    const statusLabel = c.status === 'pedido' ? 'Pedido feito' : 'Pendente';
    const statusClass = c.status === 'pedido' ? 'compra-status-pedido' : 'compra-status-pendente';
    const data        = c.criadoEm?.toDate ? c.criadoEm.toDate().toLocaleDateString('pt-BR') : '—';
    return `
      <div class="compra-pedido-card">
        <div class="compra-pedido-topo">
          <div class="compra-pedido-nome">${c.nome}</div>
          <span class="compra-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="compra-pedido-detalhe">
          Qtd solicitada: <strong>${c.qtdSolicitada} ${c.unidade || 'un'}</strong>
          &nbsp;|&nbsp; Solicitado em: ${data}
          ${c.observacao ? `<br>Obs: ${c.observacao}` : ''}
        </div>
        <div class="compra-pedido-acoes">
          ${c.status === 'pendente'
            ? `<button class="btn-primario"   style="font-size:13px;padding:8px 14px" onclick="marcarComoPedido('${c.id}')">✓ Pedido Feito</button>`
            : ''}
          <button class="btn-primario" style="font-size:13px;padding:8px 14px;background:#15803d;border-color:#15803d" onclick="abrirModalReceber('${c.id}')">Registrar Recebimento</button>
          <button class="btn-secundario" style="font-size:12px;padding:6px 10px" onclick="cancelarCompra('${c.id}')">Cancelar</button>
        </div>
      </div>`;
  }).join('');
}

function _renderHistorico() {
  const el = document.getElementById('compras-historico');
  if (!el) return;
  const busca = _buscaCompras.toLowerCase().trim();
  const lista = comprasCache.filter(c => c.status === 'recebido' && (!busca || (c.nome || '').toLowerCase().includes(busca)));

  if (!lista.length) {
    el.innerHTML = '<p class="vazio-sep">Nenhuma compra concluída ainda.</p>';
    return;
  }

  el.innerHTML = lista.map(c => {
    const dataRec = c.recebidoEm?.toDate ? c.recebidoEm.toDate().toLocaleDateString('pt-BR') : '—';
    return `
      <div class="compra-pedido-card">
        <div class="compra-pedido-topo">
          <div class="compra-pedido-nome">${c.nome}</div>
          <span class="compra-status-badge compra-status-recebido">Recebido</span>
        </div>
        <div class="compra-pedido-detalhe">
          Recebido: <strong>${c.qtdRecebida || c.qtdSolicitada} ${c.unidade || 'un'}</strong>
          &nbsp;|&nbsp; Data: ${dataRec}
          ${c.observacao ? `<br>Obs: ${c.observacao}` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ── Modais ── */

function abrirModalSolicitar(nomeKey) {
  const cfg  = itemConfigsCache[nomeKey];
  if (!cfg) return;
  _solicitarContext = { nomeKey, nome: cfg.nome, unidade: cfg.unidade || 'un' };
  document.getElementById('modal-solicitar-titulo').textContent = `Solicitar: ${cfg.nome}`;
  document.getElementById('modal-solicitar-qty').value  = cfg.qtdSugerida || '';
  document.getElementById('modal-solicitar-obs').value  = '';
  document.getElementById('modal-solicitar-compra').classList.remove('hidden');
}

function fecharModalSolicitarCompra() {
  document.getElementById('modal-solicitar-compra').classList.add('hidden');
  _solicitarContext = null;
}

async function confirmarSolicitacaoCompra() {
  if (!_solicitarContext) return;
  const qty = parseFloat(document.getElementById('modal-solicitar-qty').value);
  if (isNaN(qty) || qty <= 0) return toast('Informe uma quantidade válida.', 'erro');
  const obs = document.getElementById('modal-solicitar-obs').value.trim();
  const { nomeKey, nome, unidade } = _solicitarContext;
  try {
    await salvarCompraDB({
      nomeKey, nome, unidade,
      qtdSolicitada: qty,
      qtdAtual:      estoqueCache[nomeKey]?.qtd || 0,
      estoqueMinimo: itemConfigsCache[nomeKey]?.estoqueMinimo || 0,
      status:        'pendente',
      observacao:    obs,
    });
    fecharModalSolicitarCompra();
    toast(`Compra de "${nome}" solicitada!`, 'sucesso');
    await recarregarCompras();
    trocarAbaCompras('andamento', document.querySelectorAll('#compras-tabs .tab')[1]);
  } catch(e) { console.error(e); toast('Erro ao solicitar compra.', 'erro'); }
}

async function marcarComoPedido(id) {
  try {
    await atualizarCompraDB(id, { status: 'pedido', pedidoEm: new Date() });
    toast('Marcado como pedido feito!', 'sucesso');
    await recarregarCompras();
  } catch(e) { console.error(e); toast('Erro ao atualizar.', 'erro'); }
}

function abrirModalReceber(id) {
  const compra = comprasCache.find(c => c.id === id);
  if (!compra) return;
  _receberContext = compra;
  document.getElementById('modal-receber-info').textContent = `${compra.nome} — Solicitado: ${compra.qtdSolicitada} ${compra.unidade || 'un'}`;
  document.getElementById('modal-receber-qty').value = compra.qtdSolicitada;
  document.getElementById('modal-receber-compra').classList.remove('hidden');
}

function fecharModalReceberCompra() {
  document.getElementById('modal-receber-compra').classList.add('hidden');
  _receberContext = null;
}

async function confirmarRecebimentoCompra() {
  if (!_receberContext) return;
  const qty = parseFloat(document.getElementById('modal-receber-qty').value);
  if (isNaN(qty) || qty <= 0) return toast('Informe a quantidade recebida.', 'erro');
  const { id, nomeKey, nome, unidade } = _receberContext;
  try {
    const qtdAtual = estoqueCache[nomeKey]?.qtd || 0;
    await salvarItemEstoque(nomeKey, { qtd: qtdAtual + qty, unidade, nome });
    await atualizarCompraDB(id, { status: 'recebido', qtdRecebida: qty, recebidoEm: new Date() });
    fecharModalReceberCompra();
    toast(`+${qty} ${unidade} de "${nome}" adicionados ao estoque!`, 'sucesso');
    await recarregarCompras();
  } catch(e) { console.error(e); toast('Erro ao registrar recebimento.', 'erro'); }
}

async function cancelarCompra(id) {
  if (!confirm('Cancelar este pedido?')) return;
  try {
    await deletarCompraDB(id);
    toast('Pedido cancelado.', 'sucesso');
    await recarregarCompras();
  } catch(e) { console.error(e); toast('Erro ao cancelar.', 'erro'); }
}

