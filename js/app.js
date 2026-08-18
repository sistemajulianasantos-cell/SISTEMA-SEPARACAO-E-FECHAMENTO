/* ============================================================
   APP.JS — Lógica de UI, navegação e fluxos
   ============================================================ */

/* ── Estado global ── */
let usuarioAtual      = null;
let festaAtual        = null;
let unsubFestas       = null;
let unsubFesta        = null;
let unsubEstoque      = null;   /* listener de estoque, vivo por toda a sessão (ver garantirListenerEstoque) */
let _estoquePronto    = null;   /* Promise resolvida no 1º snapshot do estoque */
let filtroAtualCEO    = 'todas';
let filtroAtualCoord  = 'conferencia';
let filtroData        = null;
let todasFestasCache  = [];
let roleAtivo         = null;   /* papel ativo quando usuário tem múltiplos papéis */
let festaEditandoId   = null;   /* id da festa em edição */
let linkConferenciaPendente = null; /* { festaId } quando um link de Conferência válido foi aberto */

let timers    = {};
let intervalos= {};

let abaConfAtual       = 'aconferir';   /* 'aconferir' | 'conferido' */
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
let _buscaEstoque          = '';
let _estoqueFiltroCategoria = '';
let _buscaCompras      = '';
let _usuariosCache     = [];
let itemConfigsCache   = {};   /* nomeKey → config */
let categoriasCache    = [];   /* [{id, nome, nomeKey, ordem}] */
let _comprarContext    = null;
let _itemConfigEditId  = null;
let _categoriaEditId   = null;
let _modoSelecaoCadastro = false;
let _itensSelecionados   = new Set();
let _buscaCadastro       = '';
let _filtroCadastroCat   = '';

let _buscaEquipe         = '';
let _equipeRosterCache   = null;  /* elenco do controle-gestao (null = indisponível) */
let _equipeEscalasCache  = null;  /* escalações do controle-gestao (null = indisponível) */
let _equipeContratosCache= null;  /* contratos do controle-gestao (para vínculo manual) */
let _equipeFestasCache   = [];
let _vinculoEquipeFestaId= null;  /* festa em edição no modal de vínculo manual */

let _mapaPrecoInsumoGestao     = null;   /* nomeBaseKey → custoReposicao, lido do controle-gestao-main */
let _insumosGestaoIndisponivel = false;  /* true = última tentativa de leitura falhou/projeto fora do ar */

let fotosCache = { separacao: [], conferencia: [], retorno: [], galpao: [], confItens: {} };
let modoGrupoSep = 'categoria'; /* 'nenhum' | 'categoria' | 'setor' */
let _tvClockTimer      = null;
let _tvScrollTimers    = [];
let _tvScrollState     = {};
let _tvScrollDelay     = null;
let _tvRefreshTimer    = null;

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
  _tvArmarFullscreenNoPrimeiroToque();

  if (_tvClockTimer) clearInterval(_tvClockTimer);
  _tvAtualizarRelogio();
  _tvClockTimer = setInterval(_tvAtualizarRelogio, 1000);

  const carregarDadosTV = () => {
    Promise.all([listarItemConfigs(), listarCategorias(), garantirListenerEstoque(), listarCompras()]).then(([cfgs, cats, , compras]) => {
      itemConfigsCache = {};
      cfgs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
      categoriasCache = cats;
      comprasCache    = compras;
      if (todasFestasCache.length) renderizarPainelTV(todasFestasCache);
    }).catch(e => console.error('TV configs:', e));
  };
  carregarDadosTV();

  /* Atualização automática de 15 em 15min — o painel roda sem ninguém
     tocar, então não pode depender de alguém apertar F5. Recarrega só os
     dados (não a página), pra não perder a tela cheia. */
  if (_tvRefreshTimer) clearInterval(_tvRefreshTimer);
  _tvRefreshTimer = setInterval(carregarDadosTV, 15 * 60 * 1000);

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
  btn.textContent = document.fullscreenElement ? 'Sair da Tela Cheia' : 'Tela Cheia';
});

/* Navegador bloqueia tela cheia automática sem nenhuma interação — não tem
   como pular isso via JS. Isso aqui pega o primeiro toque/clique/tecla
   depois que o painel TV abre e já entra em tela cheia nesse instante, pra
   não precisar ninguém procurar o botão. Só dispara uma vez. */
let _tvFullscreenArmado = false;
function _tvArmarFullscreenNoPrimeiroToque() {
  if (_tvFullscreenArmado || document.fullscreenElement) return;
  _tvFullscreenArmado = true;
  const ativar = () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    document.removeEventListener('click', ativar);
    document.removeEventListener('touchstart', ativar);
    document.removeEventListener('keydown', ativar);
    _tvFullscreenArmado = false;
  };
  document.addEventListener('click', ativar, { once: true });
  document.addEventListener('touchstart', ativar, { once: true });
  document.addEventListener('keydown', ativar, { once: true });
}

function renderizarPainelTV(festas) {
  const hojeKey  = normalizarData(new Date());
  const hojeDate = new Date(); hojeDate.setHours(0, 0, 0, 0);

  /* Semana de calendário (segunda a domingo) que contém hoje — Agenda,
     Produção e Em Separação na TV mostram só o que cai dentro dela, pra
     não misturar eventos de semanas futuras no painel do dia a dia. */
  const diaSemana     = hojeDate.getDay(); // 0=domingo .. 6=sábado
  const diffSegunda   = diaSemana === 0 ? -6 : 1 - diaSemana;
  const inicioSemana  = new Date(hojeDate); inicioSemana.setDate(hojeDate.getDate() + diffSegunda);
  const fimSemana     = new Date(inicioSemana); fimSemana.setDate(inicioSemana.getDate() + 6);

  const separando     = festas.filter(f => {
    if (f.status !== 'separando') return false;
    const fd = toDate(f.data); fd.setHours(0, 0, 0, 0);
    return fd >= hojeDate && fd <= fimSemana;
  });
  const agendadasHoje = festas.filter(f => f.status === 'agendada' && normalizarData(f.data) === hojeKey);
  const proximas = festas
    .filter(f => {
      if (f.status !== 'agendada') return false;
      const fd = toDate(f.data); fd.setHours(0, 0, 0, 0);
      return fd > hojeDate && fd <= fimSemana;
    })
    .sort((a, b) => toDate(a.data) - toDate(b.data));

  /* Produção TV: apenas itens eProducao, agrega por nomeBaseKey */
  const mapaProd = {};
  festas.filter(f => {
    const fd = toDate(f.data); fd.setHours(0, 0, 0, 0);
    if (f.status === 'agendada') return fd >= inicioSemana && fd <= fimSemana;
    if (f.status !== 'separando') return false;
    return fd >= hojeDate && fd <= fimSemana;
  }).forEach(f => {
    (f.itens || []).forEach(item => {
      const key = nomeBaseKey(normalizarNomeItem(item.nome));
      const cfg = buscarConfigItem(key);
      if (!cfg?.eProducao) return;
      if (!mapaProd[key]) mapaProd[key] = {
        nomeKey: key,
        nome:    nomeBasDisplay(item.nome),
        total:   0,
        unidade: item.unidade || 'un',
        grupo:   cfg.grupo || 'Geral',
      };
      mapaProd[key].total += (item.qtdNecessaria || 0);
    });
  });
  const producao = Object.values(mapaProd).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  _tvRenderSeparando(separando);
  _tvRenderProducao(producao);
  _tvRenderAgenda(agendadasHoje, proximas, hojeKey);

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
        <div class="tv-festa-nome">${_escHtml(f.nome)}</div>
        <div class="tv-festa-meta">${_escHtml(f.cliente)}${f.hora ? ' · ' + _escHtml(f.hora) : ''}${_infoEventoTexto(f) ? ' · ' + _infoEventoTexto(f) : ''}</div>
        ${f.colaborador ? `<div><span class="tv-separador-badge">${_escHtml(f.colaborador)}</span></div>` : ''}
        <div class="tv-progresso-barra-wrap">
          <div class="tv-progresso-barra${completo ? ' completo' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="tv-progresso-label">${sepCount} de ${total} itens separados — ${pct}%</div>
        ${pendentes.length > 0 ? `
          <div class="tv-pendentes-titulo">Pendentes (${pendentes.length}):</div>
          <ul class="tv-pendentes-lista">
            ${mostrar.map(it => `<li>${_escHtml(nomeBasDisplay(it.nome))} — ${it.qtdNecessaria} ${_escHtml(it.unidade || 'un')}</li>`).join('')}
            ${resto > 0 ? `<li style="color:#475569;font-size:11px">... e mais ${resto} itens</li>` : ''}
          </ul>
        ` : `<div class="tv-tudo-separado">Todos os itens separados</div>`}
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

  /* Enriquecer com dados de estoque */
  const itens = producao.map(p => {
    const est    = estoqueCache[p.nomeKey] || estoqueCache[nomeBaseKey(p.nomeKey)] || {};
    const qtdEst = est.qtd || 0;
    const falta  = p.total - qtdEst;
    const pct    = p.total > 0 ? Math.min(100, Math.round((qtdEst / p.total) * 100)) : 100;
    return { ...p, qtdEst, falta, pct };
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
            <div class="tv-prod-nome">${_escHtml(p.nome)}</div>
            <div style="text-align:right">
              <div class="tv-prod-falta-num" style="color:#1d4ed8">${compra.qtdSolicitada}</div>
              <div class="tv-prod-falta-label" style="color:#1d4ed8">${_escHtml(p.unidade)} a chegar</div>
            </div>
          </div>
          <div class="tv-prod-detalhe">Estoque: ${p.qtdEst} &nbsp;|&nbsp; Falta: ${p.falta}</div>
          <div class="tv-prod-aguardando-label">${statusLabel} — aguardando chegada</div>
          <div class="tv-prod-barra-wrap"><div class="tv-prod-barra-fill tv-prod-barra-aguardando" style="width:${p.pct}%"></div></div>
        </div>`;
    }

    if (p.falta > 0) {
      /* Falta e sem compra registrada */
      return `
        <div class="tv-prod-item tv-prod-falta">
          <div class="tv-prod-item-topo">
            <div class="tv-prod-nome">${_escHtml(p.nome)}</div>
            <div style="text-align:right">
              <div class="tv-prod-falta-num">${p.falta}</div>
              <div class="tv-prod-falta-label">${_escHtml(p.unidade)} falta</div>
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
          <div class="tv-prod-nome">${_escHtml(p.nome)}</div>
          <div style="text-align:right">
            <div class="tv-prod-qty">${p.total}</div>
            <div class="tv-prod-ok-label">ok</div>
          </div>
        </div>
        <div class="tv-prod-detalhe">Estoque: ${p.qtdEst}</div>
        <div class="tv-prod-barra-wrap"><div class="tv-prod-barra-fill" style="width:${p.pct}%"></div></div>
      </div>`;
  };

  const ordemGrupos = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  el.innerHTML = ordemGrupos.map(g => `
    <div class="tv-prod-grupo">
      <div class="tv-prod-grupo-header">${_escHtml(g)}</div>
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
          <div class="tv-est-nome">${_escHtml(p.nome)}</div>
          <div class="tv-est-nums">
            <span>Pedido: <strong>${p.total}</strong></span>
            <span>Estoque: <strong>${p.qtdEst}</strong></span>
          </div>
          <div style="display:flex;align-items:baseline;gap:4px">
            <div class="tv-est-produzir">${p.falta}</div>
            <div class="tv-est-produzir-label">${_escHtml(p.unidade)} a produzir</div>
          </div>
        </div>`;
    }
    return `
      <div class="tv-est-item" style="border-left-color:#15803d;background:#F0FDF4">
        <div class="tv-est-nome">${_escHtml(p.nome)}</div>
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

function _tvRenderAgenda(agendadasHoje, proximas, hojeKey) {
  const el = document.getElementById('tv-agenda');
  if (!el) return;

  let html = '';

  if (agendadasHoje.length) {
    html += `<div class="tv-secao-titulo">Hoje (${agendadasHoje.length})</div>`;
    html += agendadasHoje.map(f => {
      const total = (f.itens || []).filter(it => deveExibirNaSeparacao(it)).length;
      return `
        <div class="tv-agenda-item hoje">
          <span class="tv-agenda-badge hoje">HOJE${f.hora ? ' · ' + _escHtml(f.hora) : ''}</span>
          <div class="tv-agenda-nome">${_escHtml(f.nome)}</div>
          <div class="tv-agenda-meta">${_escHtml(f.cliente)} · ${total} itens${_infoEventoTexto(f) ? ' · ' + _infoEventoTexto(f) : ''}</div>
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
          <div class="tv-agenda-nome">${_escHtml(f.nome)}</div>
          <div class="tv-agenda-meta">${_escHtml(f.cliente)}${f.hora ? ' · ' + _escHtml(f.hora) : ''}${_infoEventoTexto(f) ? ' · ' + _infoEventoTexto(f) : ''}</div>
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
  await authReady;

  /* Remove senha eventualmente salva por versões antigas do app */
  localStorage.removeItem('rc_senha');

  /* Restaurar nome de usuário salvo (a senha nunca é persistida) */
  const savedNome = localStorage.getItem('rc_nome');
  if (savedNome) {
    document.getElementById('login-nome').value    = savedNome;
    document.getElementById('login-lembrar').checked = true;
  }

  /* Link de convite: ?cadastro=coordenador abre direto o auto-cadastro */
  const params = new URLSearchParams(window.location.search);
  if (params.get('cadastro') === 'coordenador') {
    mostrarTela('tela-primeiro-acesso');
    return;
  }

  /* Link temporário de Conferência: ?conf=<token> — ainda exige login normal
     (ver roteamentoPosLogin), só pula direto pra festa certa depois. */
  const confToken = params.get('conf');
  if (confToken) {
    try {
      const link = await buscarLinkConferencia(confToken);
      if (!link) {
        toast('Link inválido.', 'erro');
      } else if (!link.expiraEm || link.expiraEm.toMillis() < Date.now()) {
        toast('Este link expirou. Peça um novo ao responsável.', 'erro');
      } else {
        linkConferenciaPendente = { festaId: link.festaId };
        document.getElementById('login-aviso-link').classList.remove('hidden');
      }
    } catch (e) {
      console.error('Erro ao validar link de conferência:', e);
    }
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

  const telasAuth      = ['tela-setup', 'tela-login', 'tela-primeiro-acesso', 'tela-tv'];
  const telasPrincipais= ['tela-inicial'];

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

  /* Botão Início: visível em qualquer tela autenticada, exceto o próprio hub */
  const btnInicio = document.getElementById('btn-inicio');
  if (btnInicio) {
    if (!telasAuth.includes(id) && id !== 'tela-inicial') {
      btnInicio.classList.remove('hidden');
    } else {
      btnInicio.classList.add('hidden');
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
      if (anterior === 'tela-ceo')                  { if (!unsubFestas) carregarCEO(); else atualizarVisaoCEO(); }
      if (anterior === 'tela-colaborador')          carregarColab();
      if (anterior === 'tela-coordenador')          carregarCoord(filtroAtualCoord);
      if (anterior === 'tela-usuarios')             carregarUsuarios();
      if (anterior === 'tela-historico-contagem')   abrirHistoricoContagem();
      if (anterior === 'tela-inicial') {
        if (papelAtual() === 'coordenador') abrirHomeCoordenador(); else renderizarInicio(papelAtual());
      }
      if (anterior === 'tela-agenda-meses')         renderizarAgendaMeses();
      if (anterior === 'tela-agenda-datas')         renderizarAgendaDatas(_agendaMesSelecionado);
      if (anterior === 'tela-equipe')               carregarEquipe();
    }
  } else {
    irParaPrincipal();
  }
}

/* Papel (perfil) em uso no momento, considerando múltiplos papéis */
function papelAtual() {
  const roles = usuarioAtual?.roles || [usuarioAtual?.role || ''];
  return roles.includes('ceo') ? 'ceo' : (roleAtivo || roles[0]);
}

function souCeo() {
  return !!(usuarioAtual?.roles?.includes('ceo') || usuarioAtual?.role === 'ceo');
}

function irParaPrincipal() {
  historico = [];
  pararListeners();
  if (!usuarioAtual) { mostrarTela('tela-login'); return; }

  const papel = papelAtual();

  if (papel === 'tv') {
    mostrarTela('tela-tv');
    carregarTV();
    return;
  }

  historico = ['tela-inicial'];
  mostrarTela('tela-inicial');

  if (papel === 'coordenador') {
    abrirHomeCoordenador();
    return;
  }

  renderizarInicio(papel);

  /* Pré-carrega os dados da tela principal de cada papel (alertas, badges) */
  if (papel === 'ceo') carregarCEO();
  else                 carregarColab();
}

/* ══════════════════════════════════════════════════
   TELA INICIAL — HUB DE CARDS (pós-login)
══════════════════════════════════════════════════ */

function renderizarInicio(papel) {
  const el = document.getElementById('inicio-conteudo');
  if (!el) return;
  const nome = (usuarioAtual?.nome || '').split(' ')[0] || '';
  const saudacao = `<div class="inicio-saudacao">Olá${nome ? ', ' + nome : ''}!</div>`;

  if (papel === 'ceo') {
    el.innerHTML = `
      ${saudacao}
      <div class="inicio-secao-label">Principal</div>
      <div class="inicio-grid">
        <div class="inicio-card" onclick="irInicioProducao()">
          <div class="inicio-card-nome">Produção</div>
        </div>
        <div class="inicio-card" onclick="irInicioAgenda()">
          <div class="inicio-card-nome">Agenda</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirEquipe()">
          <div class="inicio-card-nome">Equipe</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirEstoque()">
          <div class="inicio-card-nome">Estoque</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirListaCompras()">
          <div class="inicio-card-nome">Compras &amp; Lista</div>
          <span id="badge-compras" class="inicio-card-badge hidden"></span>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirPainelTV()">
          <div class="inicio-card-nome">Painel TV</div>
        </div>
      </div>
      <div class="inicio-secao-label">Administrativo</div>
      <div class="inicio-grid">
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirRelatorio()">
          <div class="inicio-card-nome">Relatórios</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirAnalise()">
          <div class="inicio-card-nome">Análise</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirCadastroItens()">
          <div class="inicio-card-nome">Cadastro</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirUsuarios()">
          <div class="inicio-card-nome">Usuários</div>
        </div>
      </div>
    `;
  } else {
    /* separador, colaborador ou qualquer outro papel */
    el.innerHTML = `
      ${saudacao}
      <div class="inicio-grid">
        <div class="inicio-card" onclick="irInicioColab()">
          <div class="inicio-card-nome">Festas para Separar</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirInventario()">
          <div class="inicio-card-nome">Inventário</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirEntradaMercadoria()">
          <div class="inicio-card-nome">Entrada de Mercadoria</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirEstoque()">
          <div class="inicio-card-nome">Controle de Estoque</div>
        </div>
        <div class="inicio-card" onclick="historico=['tela-inicial']; abrirRegistrarProducao()">
          <div class="inicio-card-nome">Registrar Produção</div>
        </div>
      </div>
    `;
  }
}

/* ══════════════════════════════════════════════════
   HOME DO COORDENADOR — acesso só à festa recebida por link (não
   navega lista de todas as festas; ver feedback da Juliana em 08-11).
══════════════════════════════════════════════════ */

function abrirHomeCoordenador() {
  /* Limpa qualquer conteúdo de uma tela/papel anterior (ex.: cards do CEO)
     que possa ter ficado no DOM — evita mostrá-lo por engano enquanto o
     snapshot da festa (abaixo) ainda não respondeu. */
  const elInicio = document.getElementById('inicio-conteudo');
  if (elInicio) elInicio.innerHTML = '';

  const festaId = usuarioAtual?.festaLinkAtivaId;
  if (!festaId) {
    renderizarHomeCoordenador(null);
    return;
  }
  unsubFesta = escutarFestaOuNula(festaId, festa => {
    if (!festa || festa.status === 'concluida') {
      _limparAcessoCoordenador();
      renderizarHomeCoordenador(null);
      return;
    }
    renderizarHomeCoordenador(festa);
  });
}

async function _limparAcessoCoordenador() {
  if (!usuarioAtual) return;
  usuarioAtual.festaLinkAtivaId = null;
  try { await limparFestaLinkAtiva(usuarioAtual.id); } catch (e) { console.error('Erro ao limpar acesso da festa:', e); }
}

function renderizarHomeCoordenador(festa) {
  const el = document.getElementById('inicio-conteudo');
  if (!el) return;
  const nome = (usuarioAtual?.nome || '').split(' ')[0] || '';
  const saudacao = `<div class="inicio-saudacao">Olá${nome ? ', ' + nome : ''}!</div>`;

  if (!festa) {
    el.innerHTML = `${saudacao}${estadoVazio('Solicite o link da festa ao administrador para ter acesso.')}`;
    return;
  }

  const ACAO_ETAPA = { conferencia: 'abrirConferencia', festa: 'avancarParaRetorno', retorno: 'abrirRetorno', galpao: 'abrirGalpao' };
  const funcao = ACAO_ETAPA[festa.status];

  el.innerHTML = `
    ${saudacao}
    <div class="inicio-grid">
      <div class="inicio-card${funcao ? '' : ' inicio-card-desabilitado'}"
        ${funcao ? `onclick="${funcao}('${festa.id}')"` : ''}>
        <div class="inicio-card-nome">${_escHtml(festa.nome)}</div>
        <div class="inicio-card-sub">${funcao ? (STATUS_LABELS[festa.status] || festa.status) : 'Aguardando — ' + (STATUS_LABELS[festa.status] || festa.status)}</div>
      </div>
    </div>
  `;
}

function abrirPainelTV() {
  historico = ['tela-inicial'];
  mostrarTela('tela-tv');
  carregarTV();
}

function irInicioProducao() {
  historico = ['tela-inicial'];
  navegar('tela-ceo');
  if (!unsubFestas) carregarCEO(); else atualizarVisaoCEO();
}

function irInicioAgenda() {
  historico = ['tela-inicial'];
  navegar('tela-agenda-meses', 'Agenda');
  if (!unsubFestas) carregarCEO();
  renderizarAgendaMeses();
}

function irAgendaTodas() {
  filtroData     = null;
  filtroAtualCEO = 'todas';
  document.querySelectorAll('#ceo-tabs .tab').forEach(b => b.classList.remove('ativo'));
  const todasTab = document.querySelector('#ceo-tabs .tab[data-filtro="todas"]');
  if (todasTab) todasTab.classList.add('ativo');
  navegar('tela-lista-festas', subtituloListaFestas());
  if (!unsubFestas) carregarCEO(); else atualizarVisaoCEO();
}

let _agendaMesSelecionado = null;
const MESES_NOME_COMPLETO = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function renderizarAgendaMeses() {
  const el = document.getElementById('agenda-meses-conteudo');
  if (!el) return;

  const porMes = {};
  todasFestasCache.forEach(f => {
    const key = normalizarData(f.data);
    if (!key) return;
    const mesKey = key.slice(0, 7);
    porMes[mesKey] = (porMes[mesKey] || 0) + 1;
  });

  const meses   = Object.keys(porMes).sort();
  const hojeMes = normalizarData(new Date()).slice(0, 7);

  if (!meses.length) {
    el.innerHTML = estadoVazio('Nenhuma festa cadastrada.');
    return;
  }

  el.innerHTML = meses.map(m => {
    const [ano, mesNum] = m.split('-');
    const nome  = MESES_NOME_COMPLETO[parseInt(mesNum, 10) - 1];
    const qtd   = porMes[m];
    const atual = m === hojeMes;
    return `
      <div class="agenda-mes-card${atual ? ' atual' : ''}" onclick="abrirAgendaMes('${m}')">
        <div class="agenda-mes-nome">${nome}</div>
        <div class="agenda-mes-ano">${ano}</div>
        <div class="agenda-mes-qtd">${qtd} festa${qtd !== 1 ? 's' : ''}</div>
      </div>
    `;
  }).join('');
}

function abrirAgendaMes(mesKey) {
  _agendaMesSelecionado = mesKey;
  const [ano, mesNum] = mesKey.split('-');
  const subtitulo = `${MESES_NOME_COMPLETO[parseInt(mesNum, 10) - 1]} ${ano}`;
  navegar('tela-agenda-datas', subtitulo);
  renderizarAgendaDatas(mesKey);
}

function renderizarAgendaDatas(mesKey) {
  const el = document.getElementById('agenda-datas-conteudo');
  if (!el || !mesKey) return;

  const porDia = {};
  todasFestasCache.forEach(f => {
    const key = normalizarData(f.data);
    if (!key || !key.startsWith(mesKey)) return;
    porDia[key] = (porDia[key] || 0) + 1;
  });

  const dias     = Object.keys(porDia).sort();
  const hojeKey  = normalizarData(new Date());
  const MESES    = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const DIAS_SEM = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];

  if (!dias.length) {
    el.innerHTML = estadoVazio('Nenhuma festa neste mês.');
    return;
  }

  el.innerHTML = dias.map(d => {
    const dt   = new Date(d + 'T12:00:00');
    const num  = String(dt.getDate()).padStart(2, '0');
    const mes  = MESES[dt.getMonth()];
    const sem  = DIAS_SEM[dt.getDay()];
    const qtd  = porDia[d];
    const isHj = d === hojeKey;
    return `
      <div class="agenda-data-card${isHj ? ' hoje' : ''}" onclick="abrirDataAgenda('${d}')">
        <div class="agenda-data-dia">${num}</div>
        <div class="agenda-data-mes">${mes}</div>
        <div class="agenda-data-sem">${sem}</div>
        <div class="agenda-data-qtd">${qtd} festa${qtd !== 1 ? 's' : ''}</div>
        ${isHj ? '<div class="agenda-data-hoje-label">Hoje</div>' : ''}
      </div>
    `;
  }).join('');
}

function abrirDataAgenda(dia) {
  filtroData     = dia;
  filtroAtualCEO = 'todas';
  document.querySelectorAll('#ceo-tabs .tab').forEach(b => b.classList.remove('ativo'));
  const todasTab = document.querySelector('#ceo-tabs .tab[data-filtro="todas"]');
  if (todasTab) todasTab.classList.add('ativo');
  navegar('tela-lista-festas', subtituloListaFestas());
  if (!unsubFestas) carregarCEO(); else atualizarVisaoCEO();
}

function irInicioCoord(status) {
  historico = ['tela-inicial'];
  navegar('tela-coordenador');
  document.querySelectorAll('#tela-coordenador .tab').forEach(b => b.classList.remove('ativo'));
  const btn = document.querySelector(`#tela-coordenador .tab[data-status="${status}"]`);
  if (btn) btn.classList.add('ativo');
  carregarCoord(status);
}

function irInicioColab() {
  historico = ['tela-inicial'];
  navegar('tela-colaborador');
  carregarColab();
}

function pararListeners() {
  if (unsubFestas) { unsubFestas(); unsubFestas = null; }
  if (unsubFesta)  { unsubFesta();  unsubFesta  = null; }
  _tvPararAutoScroll();
  /* unsubEstoque NÃO para aqui de propósito — ao contrário de festas (que é
     por tela), o listener de estoque fica vivo a sessão toda (ver
     garantirListenerEstoque), porque quase toda tela precisa dele. Só é
     desligado no logout(). */
}

/* Garante que o listener de estoque esteja ativo e devolve uma Promise que
   resolve assim que o 1º snapshot chegar (na prática, só espera de verdade
   na primeira chamada da sessão — nas seguintes já está pronto). Chamar em
   toda tela que precisa do estoque em vez de buscarEstoque(), pra nunca
   mais reler a coleção inteira a cada abertura de tela. */
function garantirListenerEstoque() {
  if (!_estoquePronto) {
    _estoquePronto = new Promise(resolve => {
      unsubEstoque = escutarEstoque(mapa => {
        estoqueCache = mapa;
        resolve();
      });
    });
  }
  return _estoquePronto;
}

/* ══════════════════════════════════════════════════
   SETUP INICIAL
══════════════════════════════════════════════════ */

async function finalizarSetup() {
  const nome     = document.getElementById('setup-nome').value.trim();
  const senha    = document.getElementById('setup-senha').value;
  const confirma = document.getElementById('setup-confirma').value;

  if (!nome)              return toast('Informe o nome', 'erro');
  if (senha.length < 6)   return toast('Senha deve ter ao menos 6 caracteres', 'erro');
  if (senha !== confirma) return toast('As senhas não coincidem', 'erro');

  try {
    await criarUsuario(nome, senha, 'ceo');
    toast('Administrador criado. Faça login.', 'sucesso');
    setTimeout(() => mostrarTela('tela-login'), 1200);
  } catch (e) {
    console.error(e);
    if (e.code === 'auth/email-already-in-use') {
      toast('Ja existe uma conta com esse nome. Apague-a em Firebase Console > Authentication > Users antes de tentar de novo.', 'erro');
    } else {
      toast('Erro ao criar administrador', 'erro');
    }
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

    /* Salvar ou limpar nome de usuário conforme checkbox (a senha nunca é persistida) */
    if (document.getElementById('login-lembrar').checked) {
      localStorage.setItem('rc_nome', nome);
    } else {
      localStorage.removeItem('rc_nome');
    }
    document.getElementById('login-senha').value = '';

    /* Senha legada com menos de 6 caracteres: força a troca antes de entrar
       (ver _senhaFirebase em firestore.js — hoje só "completa por dentro"
       senhas curtas, nunca força a pessoa a definir uma de verdade). */
    if (senha.length < 6) {
      abrirModalTrocarSenha({
        obrigatoria: true,
        senhaAtual: senha,
        aoConcluir: () => roteamentoPosLogin(usuario),
      });
    } else {
      roteamentoPosLogin(usuario);
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

/* CEO sempre vai direto ao painel; outros com múltiplos papéis vêem o seletor */
function roteamentoPosLogin(usuario) {
  garantirListenerEstoque(); /* dispara em background — não trava o roteamento esperando */

  if (linkConferenciaPendente) {
    const { festaId } = linkConferenciaPendente;
    linkConferenciaPendente = null;
    const rolesLink = usuario.roles || [usuario.role];
    if (rolesLink.includes('coordenador') || rolesLink.includes('ceo')) {
      if (!rolesLink.includes('ceo')) {
        roleAtivo = 'coordenador';
        usuario.festaLinkAtivaId = festaId;
        salvarFestaLinkAtiva(usuario.id, festaId).catch(e => console.error('Erro ao salvar acesso da festa:', e));
      }
      abrirConferencia(festaId);
      return;
    }
    toast('Esta conta não tem permissão de coordenador para usar este link.', 'erro');
    /* segue para o roteamento normal abaixo */
  }

  const roles = usuario.roles || [usuario.role];
  if (!roles.includes('ceo') && roles.length > 1) {
    mostrarTela('tela-roles');
    document.getElementById('roles-boas-vindas').textContent =
      `Bem-vindo(a), ${usuario.nome}. Selecione como deseja acessar agora.`;
    renderizarRolePicker(roles);
  } else {
    irParaPrincipal();
  }
}

/* ══════════════════════════════════════════════════
   PRIMEIRO ACESSO (auto-cadastro como Coordenador)
══════════════════════════════════════════════════ */

function abrirPrimeiroAcesso() {
  document.getElementById('pa-nome').value     = '';
  document.getElementById('pa-senha').value    = '';
  document.getElementById('pa-confirma').value = '';
  document.getElementById('pa-erro').classList.add('hidden');
  mostrarTela('tela-primeiro-acesso');
}

async function submitPrimeiroAcesso() {
  const nome     = document.getElementById('pa-nome').value.trim();
  const senha    = document.getElementById('pa-senha').value;
  const confirma = document.getElementById('pa-confirma').value;
  const erro     = document.getElementById('pa-erro');
  const btn      = document.getElementById('btn-pa-entrar');

  const mostrarErro = msg => { erro.textContent = msg; erro.classList.remove('hidden'); };
  erro.classList.add('hidden');

  if (!nome || nome.trim().split(/\s+/).length < 2) {
    return mostrarErro('Informe nome e sobrenome completos.');
  }
  if (senha.length < 6)   return mostrarErro('Senha deve ter ao menos 6 caracteres.');
  if (senha !== confirma) return mostrarErro('As senhas não coincidem.');

  btn.disabled    = true;
  btn.textContent = 'Cadastrando...';

  try {
    const existente = await buscarUsuarioPorNome(nome);
    if (existente) {
      mostrarErro('Já existe um usuário com esse nome. Faça login ou contate o administrador.');
      return;
    }

    await criarUsuario(nome, senha, ['coordenador']);
    const usuario = await autenticarUsuario(nome, senha);

    usuarioAtual = usuario;
    roleAtivo    = 'coordenador';
    document.getElementById('header-usuario').textContent = usuario.nome;

    toast(`Bem-vindo(a), ${usuario.nome}!`, 'sucesso');
    irParaPrincipal();
  } catch (e) {
    console.error(e);
    if (e.code === 'auth/email-already-in-use') {
      mostrarErro('Já existe um usuário com esse nome. Faça login ou contate o administrador.');
    } else {
      mostrarErro('Erro ao cadastrar. Tente novamente.');
    }
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Cadastrar e Entrar';
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
  if (unsubEstoque)    { unsubEstoque();  unsubEstoque = null; }
  _estoquePronto = null;
  if (_tvClockTimer)   { clearInterval(_tvClockTimer);   _tvClockTimer   = null; }
  if (_tvRefreshTimer) { clearInterval(_tvRefreshTimer); _tvRefreshTimer = null; }
  firebase.auth().signOut().catch(() => {});
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
   TROCAR SENHA (autoatendimento)
══════════════════════════════════════════════════ */

/* Modo obrigatório: acionado a partir do login quando a senha atual tem
   menos de 6 caracteres (ver doLogin em app.js). Nesse modo o campo "senha
   atual" fica oculto e pré-preenchido (a pessoa acabou de digitá-la no
   login), não dá pra cancelar nem fechar clicando fora, e só ao salvar com
   sucesso o fluxo de roteamento pós-login (aoConcluir) é retomado. */
let _trocaSenhaObrigatoria = false;
let _trocaSenhaCallback    = null;

function abrirModalTrocarSenha(opts = {}) {
  if (!usuarioAtual) return;
  _trocaSenhaObrigatoria = !!opts.obrigatoria;
  _trocaSenhaCallback    = opts.aoConcluir || null;

  document.getElementById('ts-senha-atual').value    = opts.senhaAtual || '';
  document.getElementById('ts-senha-nova').value      = '';
  document.getElementById('ts-senha-confirma').value  = '';
  document.getElementById('ts-erro').classList.add('hidden');
  document.getElementById('ts-titulo').textContent =
    _trocaSenhaObrigatoria ? 'Defina uma nova senha' : 'Trocar minha senha';
  document.getElementById('ts-aviso-obrigatorio').classList.toggle('hidden', !_trocaSenhaObrigatoria);
  document.getElementById('ts-campo-atual').classList.toggle('hidden', _trocaSenhaObrigatoria);
  document.getElementById('btn-ts-cancelar').classList.toggle('hidden', _trocaSenhaObrigatoria);
  document.getElementById('modal-trocar-senha').classList.remove('hidden');
}

function fecharModalTrocarSenha(force) {
  if (_trocaSenhaObrigatoria && !force) return;
  document.getElementById('modal-trocar-senha').classList.add('hidden');
}

async function confirmarTrocarSenha() {
  const atual    = document.getElementById('ts-senha-atual').value;
  const nova     = document.getElementById('ts-senha-nova').value;
  const confirma = document.getElementById('ts-senha-confirma').value;
  const erro     = document.getElementById('ts-erro');
  const btn      = document.getElementById('btn-ts-salvar');

  const mostrarErro = msg => { erro.textContent = msg; erro.classList.remove('hidden'); };
  erro.classList.add('hidden');

  if (!atual || !nova)     return mostrarErro('Preencha todos os campos.');
  if (nova.length < 6)     return mostrarErro('A nova senha deve ter ao menos 6 caracteres.');
  if (nova !== confirma)   return mostrarErro('As senhas não coincidem.');

  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    await trocarSenhaUsuarioAtual(atual, nova);
    fecharModalTrocarSenha(true);
    toast('Senha alterada com sucesso.', 'sucesso');
    if (_trocaSenhaObrigatoria) {
      const callback = _trocaSenhaCallback;
      _trocaSenhaObrigatoria = false;
      _trocaSenhaCallback    = null;
      if (callback) callback();
    }
  } catch (e) {
    const CODIGOS_SENHA_ATUAL_INCORRETA = [
      'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-login-credentials',
    ];
    if (CODIGOS_SENHA_ATUAL_INCORRETA.includes(e.code)) {
      mostrarErro('Senha atual incorreta.');
    } else {
      console.error(e);
      mostrarErro('Erro ao trocar senha. Tente novamente.');
    }
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Salvar nova senha';
  }
}

/* ══════════════════════════════════════════════════
   CEO — DASHBOARD
══════════════════════════════════════════════════ */

async function carregarCEO() {
  pararListeners();

  garantirListenerEstoque();
  /* Só busca de novo se ainda não tem nada em cache nesta sessão — evita
     reler item_config/categorias inteiros a cada navegação. */
  if (!Object.keys(itemConfigsCache).length) {
    try {
      const [configs, cats] = await Promise.all([
        listarItemConfigs(), listarCategorias(),
      ]);
      itemConfigsCache = {};
      configs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
      categoriasCache = cats;
    } catch(e) { console.error('Erro ao carregar dados iniciais:', e); }
  }

  /* Cross-project (controle-gestao-main): cria festas a partir dos Contratos
     e carrega elenco/escalação pra mostrar resumo de equipe nos cards. Roda
     em paralelo, sem bloquear a tela — nunca derruba o app se o outro
     projeto estiver indisponível (mesma disciplina da aba Equipe). */
  sincronizarFestasDeContratos();
  carregarCachesEquipeParaCards();

  unsubFestas = escutarFestas({}, festas => {
    todasFestasCache = festas;
    renderizarStatsCEO(festas);
    renderizarAgendaStripCEO(festas);
    renderizarProducaoCEO();
    atualizarBadgeCompras();
    if (!document.getElementById('tela-agenda-meses').classList.contains('hidden')) renderizarAgendaMeses();
    if (!document.getElementById('tela-agenda-datas').classList.contains('hidden')) renderizarAgendaDatas(_agendaMesSelecionado);
  });
}

function renderizarStatsCEO(festas) {
  renderizarTiraData(festas);
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
            ? 'Separado'
            : `${pendentes} de ${totalItens} pendente${pendentes !== 1 ? 's' : ''}`;
          return `
            <div class="alerta-hoje-item">
              <div class="alerta-hoje-info">
                <div class="alerta-hoje-nome">${_escHtml(f.nome || f.tipo || 'Festa')}</div>
                <div class="alerta-hoje-sub">${sub}${f.hora ? ' · ' + _escHtml(f.hora) : ''}</div>
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
        onclick="filtrarPorData('${d}', null)">
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

  /* "Valor da carga" é só pro CEO — carrega os preços em paralelo e
     re-renderiza quando chegar (a tela já apareceu com o resto pronto). */
  if (souCeo()) {
    carregarPrecosGestao().then(() => {
      if (festaAtual && festaAtual.status !== 'agendada') renderizarSeparacao(festaAtual);
    });
  }
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
  document.getElementById('sep-info').innerHTML = htmlInfoFesta(festa) + (souCeo() ? htmlValorCarga(festa) : '') + htmlLinkConferenciaBtn(festa);

  /* Bloquear separador enquanto admin edita quantidades */
  if (festa.editandoAgora) {
    document.getElementById('sep-itens').innerHTML = `
      <div class="aviso-editando">
        <strong>${_escHtml(festa.editandoAgora)} está editando as quantidades</strong>
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
      .map(c => `${_escHtml(c.campo)}: ${_escHtml(c.de)} → ${_escHtml(c.para)}`)
      .join(', ');
    const quando = ultima.alteradoEm
      ? new Date(ultima.alteradoEm).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '';
    avisoHTML = `
      <div class="aviso-alteracao">
        <strong>Quantidades alteradas pelo administrador</strong>
        <p>${_escHtml(ultima.alteradoPor)}${quando ? ' em ' + quando : ''}${detalhes ? ': ' + detalhes : ''}. Verifique os itens antes de continuar.</p>
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
                <div class="item-standby-nome">${_escHtml(it.nome)}</div>
                <div class="item-standby-msg">${_escHtml(info.msg)} &mdash; Qtd: <strong>${it.qtdNecessaria}</strong> ${_escHtml(it.unidade || 'un')}</div>
              </div>
            </div>
          `;
        }).join('')}
      ` : ''}
      ${standByFrig.length ? `
        <div class="standby-section-titulo">Refrigerados — Stand-by</div>
        ${standByFrig.map(it => {
          const info = standByInfo(it, festa.data);
          return `
            <div class="item-standby-card">
              <span class="item-standby-icone" style="display:none"></span>
              <div class="item-standby-corpo">
                <div class="item-standby-nome">${_escHtml(it.nome)}</div>
                <div class="item-standby-msg">${_escHtml(info.msg)} &mdash; Qtd: <strong>${it.qtdNecessaria}</strong> ${_escHtml(it.unidade || 'un')}</div>
              </div>
            </div>
          `;
        }).join('')}
      ` : ''}
    </div>
  ` : '';

  const avisoOcultos = ocultos.length
    ? `<div style="background:#F9FAFB;border:1px dashed #D1D5DB;border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:12px;color:#6B7280;">
        ${ocultos.length} item(s) oculto(s) da separação (Equipe / Coquetéis): ${_escHtml(ocultos.map(i=>i.nome).join(', '))}
       </div>`
    : '';

  document.getElementById('sep-itens').innerHTML = avisoHTML + avisoOcultos + `
    <div class="busca-sep-wrap">
      <input type="search" id="busca-sep-input" class="busca-sep"
        placeholder="Pesquisar item..."
        oninput="filtrarItensSep(this.value)"
        value="${buscaAtual.replace(/"/g, '&quot;')}" />
    </div>
    <div class="sep-add-item-wrap" style="margin-bottom:10px">
      <button class="btn-secundario btn-sm" onclick="toggleAddItemSep()">&#43; Item não listado</button>
      <div id="sep-add-item-form" class="hidden" style="margin-top:8px;display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
        <div style="flex:2;min-width:160px">
          <label style="font-size:12px;color:var(--cinza-600)">Item cadastrado</label>
          <input type="text" id="sep-add-input" list="sep-add-datalist" placeholder="Buscar item..." autocomplete="off" style="width:100%" />
          <datalist id="sep-add-datalist"></datalist>
        </div>
        <div style="width:90px">
          <label style="font-size:12px;color:var(--cinza-600)">Qtd.</label>
          <input type="number" id="sep-add-qtd" min="0" placeholder="0" style="width:100%" />
        </div>
        <button class="btn-primario btn-sm" onclick="adicionarItemSeparacao()">Adicionar</button>
      </div>
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

function toggleAddItemSep() {
  const form = document.getElementById('sep-add-item-form');
  if (!form) return;
  const abrindo = form.classList.contains('hidden');
  form.classList.toggle('hidden');
  if (abrindo) popularSelectAddItemSep();
}

function popularSelectAddItemSep() {
  const datalist = document.getElementById('sep-add-datalist');
  if (!datalist || !festaAtual) return;

  const itens = festaAtual.itens || [];
  const keysJaNaFesta = new Set(itens.map(it => nomeBaseKey(normalizarNomeItem(it.nome))));

  const disponiveis = Object.values(itemConfigsCache)
    .filter(c => !keysJaNaFesta.has(nomeBaseKey(c.nomeKey || normalizarNomeItem(c.nome))))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  datalist.innerHTML = disponiveis.map(c => `<option value="${_esc(c.nome)}">`).join('');
}

async function adicionarItemSeparacao() {
  if (!festaAtual) return;
  const input = document.getElementById('sep-add-input');
  const cfg   = _resolverItemCatalogoPorNome(input?.value);
  if (!cfg) return toast('Selecione um item valido da lista do cadastro.', 'erro');

  const qtdInput = document.getElementById('sep-add-qtd');
  const qtd      = parseFloat(qtdInput?.value) || 0;
  if (qtd <= 0) return toast('Informe uma quantidade.', 'erro');

  const itens = (festaAtual.itens || []).map(it => ({ ...it }));
  itens.push({
    id:            `item-novo-${Date.now()}`,
    nome:          cfg.nome,
    qtdNecessaria: qtd,
    unidade:       cfg.unidade || 'un',
    separado:      false,
    qtdSeparada:   0,
    qtdConferida:  0,
    qtdRetorno:    0,
    qtdGalpao:     0,
    qtdDanificada: 0,
  });

  try {
    await atualizarFesta(festaAtual.id, { itens });
    toast(`${cfg.nome} adicionado a lista.`, 'sucesso');
    /* O listener do escutarFesta vai re-renderizar automaticamente */
  } catch (e) {
    console.error(e);
    toast('Erro ao adicionar item.', 'erro');
  }
}

function htmlBadgeForn(item) {
  const forn = item.fornecimento || extrairFornDoNome(item.nome);
  if (!forn) return '';
  const cls = ['consignado','cliente','romero','reserva','proprio','terceiro'].includes(forn)
    ? `forn-card-${forn}` : 'forn-card-default';
  return `<div class="forn-card ${cls}"><span class="forn-card-label">Fornecimento</span><span class="forn-card-valor">${_escHtml(forn)}</span></div>`;
}

function htmlItemPendente(item, i) {
  const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
  const locParts = [cfg?.setor, cfg?.prateleira].filter(Boolean);
  const locHtml  = locParts.length
    ? `<div class="item-localizacao">${_escHtml(locParts.join(' / '))}</div>`
    : '';
  const badgeForn = htmlBadgeForn(item);
  return `
    <div class="item-pend-card">
      <div class="item-pend-esquerda">
        <div class="item-pend-info">
          <div class="item-nome">
            ${_escHtml(nomeBasDisplay(item.nome))}
            <button class="btn-editar-nome" title="Substituir / editar nome" onclick="editarNomeItem(${i})">Editar</button>
          </div>
          ${badgeForn || ''}
          <div class="item-sub">${_escHtml(item.unidade || 'un')} &mdash; total: <strong>${item.qtdNecessaria}</strong></div>
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
        <div class="item-nome">${_escHtml(nomeBasDisplay(item.nome))}</div>
        ${badgeForn || ''}
        <div class="item-sub">
          Separado: <strong>${item.qtdSeparada}</strong> de <strong>${item.qtdNecessaria}</strong> ${_escHtml(item.unidade || 'un')}
          ${parcial ? `<span class="badge-parcial">Parcial</span>` : ''}
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
        <span class="sep-grupo-nome">${_escHtml(nome)}</span>
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
  itens[i]    = {
    ...itens[i],
    separado:    true,
    qtdSeparada: qtd,
    separadoPor: usuarioAtual?.nome || null,
    separadoEm:  new Date(),
  };

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
  itens[i]    = { ...itens[i], separado: false, qtdSeparada: undefined, separadoPor: undefined, separadoEm: undefined };
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
      try {
        toast('Enviando fotos...', 'info');
        fotoUrls = await uploadFotos(fotosCache.separacao, festaAtual.id, 'separacao');
      } catch (e) {
        console.error('Erro ao enviar fotos da separação:', e);
        toast('Não foi possível enviar as fotos, mas a separação será salva.', 'aviso');
      }
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

function formatarHora(val) {
  if (!val) return '';
  return toDate(val).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
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
    /* Coordenador só vê festas ativas (data de hoje em diante) — festas com
       data passada, esquecidas numa etapa, ficam só para o CEO resolver. */
    const hojeKey = normalizarData(new Date());
    const ativas  = festas.filter(f => normalizarData(f.data) >= hojeKey);
    const el = document.getElementById('coord-lista');
    el.innerHTML = ativas.length
      ? ativas.map(f => htmlCardFesta(f, 'coordenador')).join('')
      : estadoVazio('Nenhuma festa nesta etapa.');
  });
}

function filtrarCoord(status, btn) {
  document.querySelectorAll('#tela-coordenador .tab').forEach(b => b.classList.remove('ativo'));
  btn.classList.add('ativo');
  carregarCoord(status);
}

/* Retorna a tela-lista do papel ativo (CEO → tela-ceo, coord → tela-inicial,
   já que o coordenador não navega mais lista de festas) */
function telaListaAtual() {
  const roles = usuarioAtual?.roles || [usuarioAtual?.role || ''];
  return roles.includes('ceo') ? 'tela-ceo' : 'tela-inicial';
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

function htmlCardConfItem(item, ri, conferido) {
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
            : `<div class="item-foto-placeholder"></div>`}
      </div>
      <div class="item-foto-label">
        <div class="item-foto-label-titulo${temFoto ? ' ok' : ''}">${temFoto ? 'Foto anexada' : 'Foto obrigatória'}</div>
        <div class="item-foto-label-desc">${temFoto ? 'Toque para trocar' : 'Este item exige registro fotográfico'}</div>
      </div>
      <input type="file" id="conf-foto-input-${ri}" accept="image/*" capture="environment" style="display:none"
        onchange="onFotoItemConf(${ri}, this)" />
      <button class="btn-foto-item${temFoto ? ' ok' : ''}"
        onclick="document.getElementById('conf-foto-input-${ri}').click()">
        ${temFoto ? 'OK' : 'Anexar'}
      </button>
    </div>
  ` : '';

  const confVal  = item.qtdConferida;
  const sepVal   = item.qtdSeparada || 0;
  const msgInicial = confVal !== undefined
    ? (confVal > sepVal
        ? `<span class="msg-item msg-alerta">Quantidade acima do separado</span>`
        : confVal < sepVal
          ? `<span class="msg-item msg-erro">Quantidade abaixo do separado</span>`
          : '')
    : '';

  return `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">
            ${_escHtml(nomeBasDisplay(item.nome))}
            <button class="btn-editar-nome" title="Editar nome" onclick="editarNomeItem(${ri})">Editar</button>
          </div>
          ${htmlBadgeForn(item) || ''}
          ${souCeo() && item.separado && item.qtdSeparada !== undefined ? `
            <div class="item-sub">
              Separado: <strong>${item.qtdSeparada} ${_escHtml(item.unidade || 'un')}</strong>${item.separadoPor ? ` por <strong>${_escHtml(item.separadoPor)}</strong>` : ''}${item.separadoEm ? ` às ${formatarHora(item.separadoEm)}` : ''}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="item-entrada">
        <label>Quantidade conferida:</label>
        <input type="number" class="qty-input" id="conf-qty-${ri}"
          value="${confVal !== undefined ? confVal : ''}"
          min="0" placeholder="0"
          oninput="checarConf(${ri}, ${sepVal})"
          onchange="salvarQtdConf(${ri})" />
        <span class="item-unidade">${_escHtml(item.unidade || 'un')}</span>
      </div>
      <div id="conf-msg-${ri}">${msgInicial}</div>
      ${fotoAreaHtml}
      ${conferido
        ? `<button class="btn-desfazer" onclick="reabrirItemConf(${ri})">↺ Reabrir</button>`
        : `<button class="btn-confirmar btn-sm" onclick="marcarItemConferido(${ri})">Marcar como Conferido</button>`}
    </div>
  `;
}

function renderizarConferencia(festa) {
  document.getElementById('conf-info').innerHTML = htmlInfoFesta(festa) + htmlLinkConferenciaBtn(festa);

  const buscaConf = document.getElementById('busca-conf-input')?.value || '';

  const visiveis = (festa.itens || []).filter((item) => {
    /* CEO vê todos os itens da festa; demais perfis só os configurados
       para aparecer na conferência (descartáveis/decoração ficam ocultos) */
    if (souCeo()) return true;
    const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
    return !cfg || cfg.conferirCoord !== false;
  }).map((item) => ({ item, ri: (festa.itens || []).indexOf(item) }));

  /* Item só é considerado "conferido" depois que o coordenador de fato salva uma
     quantidade (marcado por conferidoEm); qtdConferida sozinha não serve porque
     itens novos já nascem com qtdConferida:0 (ver criarFesta / duplicarFesta). */
  const pendentes  = visiveis.filter(({ item }) => item.conferidoEm === undefined);
  const conferidos = visiveis.filter(({ item }) => item.conferidoEm !== undefined);

  const buscaHtml = `
    <div class="busca-sep-wrap">
      <input type="search" id="busca-conf-input" class="busca-sep"
        placeholder="Pesquisar item..."
        oninput="filtrarItensConf(this.value)"
        value="${buscaConf.replace(/"/g, '&quot;')}" />
    </div>
  `;

  const tabsHtml = `
    <div class="filtros-tabs" id="conf-tabs">
      <button class="tab${abaConfAtual === 'aconferir' ? ' ativo' : ''}"
        onclick="trocarAbaConf('aconferir', this)">A Conferir (${pendentes.length})</button>
      <button class="tab${abaConfAtual === 'conferido' ? ' ativo' : ''}"
        onclick="trocarAbaConf('conferido', this)">Conferido (${conferidos.length})</button>
    </div>
  `;

  const pendentesHtml = pendentes.length
    ? pendentes.map(({ item, ri }) => htmlCardConfItem(item, ri, false)).join('')
    : estadoVazio('Nenhum item pendente de conferência.');

  const conferidosHtml = conferidos.length
    ? conferidos.map(({ item, ri }) => htmlCardConfItem(item, ri, true)).join('')
    : estadoVazio('Nenhum item conferido ainda.');

  document.getElementById('conf-itens').innerHTML = `
    ${buscaHtml}
    ${tabsHtml}
    <div id="conf-lista-aconferir" class="${abaConfAtual === 'aconferir' ? '' : 'hidden'}">${pendentesHtml}</div>
    <div id="conf-lista-conferido" class="${abaConfAtual === 'conferido' ? '' : 'hidden'}">${conferidosHtml}</div>
  `;

  if (buscaConf) filtrarItensConf(buscaConf);
}

function trocarAbaConf(aba, btn) {
  abaConfAtual = aba;
  document.querySelectorAll('#conf-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  document.getElementById('conf-lista-aconferir')?.classList.toggle('hidden', aba !== 'aconferir');
  document.getElementById('conf-lista-conferido')?.classList.toggle('hidden', aba !== 'conferido');
}

function filtrarItensConf(q) {
  const termo = q.trim().toLowerCase();
  document.querySelectorAll('#conf-itens .item-row').forEach(card => {
    const nome = card.querySelector('.item-nome')?.textContent.toLowerCase() || '';
    card.style.display = (!termo || nome.includes(termo)) ? '' : 'none';
  });
}

/* Grava um campo de um item específico da festa no Firestore sem perder o resto,
   mantendo festaAtual local em sincronia (evita perder dados já salvos ao atualizar a página) */
async function persistirItemFesta(idx, patch) {
  if (!festaAtual) return;
  const itens = (festaAtual.itens || []).map((it, i) => i === idx ? { ...it, ...patch } : it);
  festaAtual = { ...festaAtual, itens };
  await atualizarFesta(festaAtual.id, { itens });
}

/* Salva a quantidade conferida assim que o coordenador sai do campo,
   para não perder o valor caso a página seja atualizada antes de concluir.
   Não marca o item como conferido — isso só acontece ao clicar no botão
   "Marcar como Conferido" (marcarItemConferido), para o item não migrar de
   aba sozinho apenas por o usuário ter tocado no campo. */
async function salvarQtdConf(idx) {
  if (!festaAtual) return;
  const val = parseFloat(document.getElementById(`conf-qty-${idx}`)?.value) || 0;
  try {
    await persistirItemFesta(idx, { qtdConferida: val });
  } catch (e) {
    console.error('Erro ao salvar quantidade conferida:', e);
    toast('Não foi possível salvar a quantidade. Verifique a conexão.', 'erro');
  }
}

/* Confirma a conferência do item — move-o de "A Conferir" para "Conferido" */
async function marcarItemConferido(idx) {
  if (!festaAtual) return;
  const val = parseFloat(document.getElementById(`conf-qty-${idx}`)?.value) || 0;
  try {
    await persistirItemFesta(idx, { qtdConferida: val, conferidoEm: new Date() });
  } catch (e) {
    console.error('Erro ao marcar item como conferido:', e);
    toast('Não foi possível confirmar a conferência. Verifique a conexão.', 'erro');
  }
}

/* Desfaz a confirmação — devolve o item para "A Conferir" */
async function reabrirItemConf(idx) {
  if (!festaAtual) return;
  try {
    await persistirItemFesta(idx, { conferidoEm: undefined });
  } catch (e) {
    console.error('Erro ao reabrir item:', e);
    toast('Não foi possível reabrir o item. Verifique a conexão.', 'erro');
  }
}

/* Captura foto por item na conferência — envia para o Firebase imediatamente,
   para não depender do botão final e não perder a foto se algo der errado depois */
async function onFotoItemConf(idx, input) {
  if (!input.files[0]) return;
  const file = input.files[0];
  fotosCache.confItens[idx] = file;

  const area = document.getElementById(`conf-foto-area-${idx}`);
  if (!area) return;
  area.classList.add('ok');
  area.querySelector('.item-foto-preview').innerHTML =
    `<img src="${URL.createObjectURL(file)}" alt="foto">`;
  const titulo = area.querySelector('.item-foto-label-titulo');
  const desc   = area.querySelector('.item-foto-label-desc');
  const btn    = area.querySelector('.btn-foto-item');
  titulo.className = 'item-foto-label-titulo ok';
  titulo.textContent = 'Enviando...';
  desc.textContent   = 'Salvando foto...';
  btn.className = 'btn-foto-item ok';
  btn.textContent = 'Enviando...';

  try {
    const urls = await uploadFotos([file], festaAtual.id, `conf_item_${idx}`);
    await persistirItemFesta(idx, { fotoConferencia: urls[0] });
    fotosCache.confItens[idx] = null; /* já persistida, não precisa reenviar no final */
    titulo.textContent = 'Foto anexada';
    desc.textContent   = 'Toque para trocar';
    btn.textContent   = 'OK';
  } catch (e) {
    console.error('Erro ao enviar foto do item:', e);
    toast('Falha ao enviar a foto. Tente novamente.', 'erro');
    titulo.className  = 'item-foto-label-titulo';
    titulo.textContent = 'Foto obrigatória';
    desc.textContent   = 'Falha no envio — toque para tentar novamente';
    area.classList.remove('ok');
    btn.className = 'btn-foto-item';
    btn.textContent = 'Anexar';
  }
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
    el.innerHTML = `<span class="msg-item msg-alerta">Quantidade acima do separado</span>`;
  } else {
    el.innerHTML = `<span class="msg-item msg-erro">Quantidade abaixo do separado</span>`;
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
      `<div class="div-linha">${_escHtml(d.item)}: separado ${d.separado}, conferido ${d.conferido}</div>`
    ).join('');
  } else {
    box.classList.add('hidden');
  }
}

async function concluirConferencia() {
  if (!festaAtual) return;
  const btn = document.getElementById('btn-conf-concluir');

  /* Foto obrigatória por item: avisa mas não bloqueia a liberação da festa
     (bloqueio temporariamente desativado — TODO: revisar este processo). */
  const semFoto = (festaAtual.itens || []).filter((item, i) => {
    const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
    if (cfg && cfg.conferirCoord === false) return false;
    return cfg?.exigeFoto && !fotosCache.confItens[i] && !item.fotoConferencia;
  });
  if (semFoto.length) {
    toast(`Aviso: foto pendente em: ${semFoto.map(i => i.nome).join(', ')}. Liberando mesmo assim.`, 'aviso');
  }

  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    /* Montar itens com qtdConferida; itens sem conferência do coord mantêm qtdSeparada.
       Cada foto é enviada isoladamente — se uma falhar, as demais e o resto da
       conferência (quantidades, etc.) não são perdidos. */
    const falhasFoto = [];
    const itens = await Promise.all((festaAtual.itens || []).map(async (item, i) => {
      const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
      if (cfg && cfg.conferirCoord === false) {
        return { ...item, qtdConferida: item.qtdSeparada || 0 };
      }
      const qtdConferida = parseFloat(document.getElementById(`conf-qty-${i}`)?.value) || 0;
      const fotoFile     = fotosCache.confItens[i];
      let fotoConferencia = item.fotoConferencia || null;
      if (fotoFile) {
        try {
          const urls = await uploadFotos([fotoFile], festaAtual.id, `conf_item_${i}`);
          fotoConferencia = urls[0] || fotoConferencia;
        } catch (e) {
          console.error(`Erro ao enviar foto do item "${item.nome}":`, e);
          falhasFoto.push(item.nome);
        }
      }
      return { ...item, qtdConferida, ...(fotoConferencia ? { fotoConferencia } : {}) };
    }));

    /* Se algum item obrigatório continua sem foto após a tentativa, avisa mas
       não bloqueia (bloqueio temporariamente desativado — TODO: revisar). */
    const aindaSemFoto = itens.filter((item) => {
      const cfg = buscarConfigItem(normalizarNomeItem(item.nome));
      if (cfg && cfg.conferirCoord === false) return false;
      return cfg?.exigeFoto && !item.fotoConferencia;
    });
    if (aindaSemFoto.length) {
      toast(`Aviso: falha ao enviar foto de: ${aindaSemFoto.map(i => i.nome).join(', ')}. Liberando mesmo assim.`, 'aviso');
    }

    const divergencias = itens
      .filter(it => {
        const cfg = buscarConfigItem(normalizarNomeItem(it.nome));
        if (cfg && cfg.conferirCoord === false) return false;
        return it.qtdConferida !== (it.qtdSeparada || 0);
      })
      .map(it => ({ item: it.nome, separado: it.qtdSeparada || 0, conferido: it.qtdConferida }));

    let fotoUrls = [];
    if (fotosCache.conferencia.filter(Boolean).length) {
      try {
        toast('Enviando fotos gerais...', 'info');
        fotoUrls = await uploadFotos(fotosCache.conferencia, festaAtual.id, 'conferencia');
      } catch (e) {
        console.error('Erro ao enviar fotos gerais:', e);
        toast('Não foi possível enviar as fotos gerais, mas a conferência será salva.', 'aviso');
      }
    }

    if (falhasFoto.length) {
      toast(`Aviso: não foi possível enviar a foto de "${falhasFoto.join(', ')}", mas o restante da conferência foi salvo.`, 'aviso');
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
  document.getElementById('ret-info').innerHTML = htmlInfoFesta(festa) + htmlLinkConferenciaBtn(festa);

  document.getElementById('ret-itens').innerHTML = (festa.itens || []).map((item, i) => {
    const badgeForn = htmlBadgeForn(item);
    const enviado   = item.qtdConferida || item.qtdSeparada || 0;
    const unidade   = item.unidade || 'un';
    const consumidoInicial = item.qtdConsumida !== undefined ? item.qtdConsumida : '';
    const danificadoInicial = item.qtdDanificada || 0;
    const retornoInicial = Math.max(0, enviado - (parseFloat(consumidoInicial) || 0) - danificadoInicial);
    return `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${_escHtml(nomeBasDisplay(item.nome))}</div>
          ${badgeForn || ''}
          <div class="item-sub">Enviado: <strong>${enviado}</strong> ${_escHtml(unidade)}</div>
        </div>
      </div>
      <div class="item-entrada" style="margin-bottom:8px">
        <label>Consumido:</label>
        <input type="number" class="qty-input" id="ret-cons-${i}"
          value="${consumidoInicial}"
          min="0" placeholder="0" oninput="calcularRetornoItem(${i}, ${enviado}, '${_esc(unidade)}')" />
        <span class="item-unidade">${_escHtml(unidade)}</span>
      </div>
      <div class="item-entrada">
        <label>Danificado:</label>
        <input type="number" class="qty-input" id="ret-dan-${i}"
          value="${danificadoInicial}"
          min="0" placeholder="0" style="width:70px" oninput="calcularRetornoItem(${i}, ${enviado}, '${_esc(unidade)}')" />
        <span class="item-unidade">${_escHtml(unidade)}</span>
      </div>
      <div class="item-sub" id="ret-calc-${i}" style="margin-top:6px">Retorna pro galpão: <strong>${retornoInicial}</strong> ${_escHtml(unidade)}</div>
    </div>
  `;
  }).join('');
}

function calcularRetornoItem(i, enviado, unidade) {
  const consumido  = parseFloat(document.getElementById(`ret-cons-${i}`)?.value) || 0;
  const danificado = parseFloat(document.getElementById(`ret-dan-${i}`)?.value) || 0;
  const retorno = Math.max(0, enviado - consumido - danificado);
  const el = document.getElementById(`ret-calc-${i}`);
  if (el) el.innerHTML = `Retorna pro galpão: <strong>${retorno}</strong> ${_escHtml(unidade)}`;
}

async function concluirRetorno() {
  if (!festaAtual) return;
  const btn = document.getElementById('btn-ret-concluir');
  btn.disabled    = true;
  btn.textContent = 'Salvando...';

  try {
    const itens = (festaAtual.itens || []).map((item, i) => {
      const enviado    = item.qtdConferida || item.qtdSeparada || 0;
      const consumido  = parseFloat(document.getElementById(`ret-cons-${i}`)?.value) || 0;
      const danificado = parseFloat(document.getElementById(`ret-dan-${i}`)?.value) || 0;
      const retorno    = Math.max(0, enviado - consumido - danificado);
      return { ...item, qtdConsumida: consumido, qtdDanificada: danificado, qtdRetorno: retorno };
    });

    let fotoUrls = [];
    if (fotosCache.retorno.filter(Boolean).length) {
      try {
        toast('Enviando fotos...', 'info');
        fotoUrls = await uploadFotos(fotosCache.retorno, festaAtual.id, 'retorno');
      } catch (e) {
        console.error('Erro ao enviar fotos do retorno:', e);
        toast('Não foi possível enviar as fotos, mas o retorno será salvo.', 'aviso');
      }
    }

    await concluirEtapa(festaAtual.id, 'retorno', {
      itens,
      obsRetorno:   document.getElementById('ret-obs').value,
      fotosRetorno: fotoUrls,
    });

    toast('Retorno registrado. Festa enviada para o Galpao.', 'sucesso');
    abrirRelatorioRetorno({ ...festaAtual, itens, fotosRetorno: fotoUrls });

  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
    btn.disabled    = false;
    btn.textContent = 'Confirmar Retorno — Enviar para Galpão';
  }
}

/* ── RELATÓRIO SIMPLES DE RETORNO ──
   Exibido logo após confirmar o Retorno: por item, quantidade enviada
   (inicial) x quantidade que retornou (final), com a foto do item
   (tirada na Conferência) logo abaixo das quantidades. */
function abrirRelatorioRetorno(festa) {
  pararListeners();
  historico = [telaListaAtual()];
  mostrarTela('tela-relatorio-retorno', 'Relatório de Retorno');

  const itens = festa.itens || [];
  const linhasItens = itens.map(item => {
    const unidade = item.unidade || 'un';
    const enviado = item.qtdConferida || item.qtdSeparada || 0;
    const retorno = item.qtdRetorno || 0;
    const foto    = item.fotoConferencia;
    return `
      <div class="item-row">
        <div class="item-nome">${_escHtml(nomeBasDisplay(item.nome))}</div>
        <div class="item-sub">
          Inicial: <strong>${enviado}</strong> ${_escHtml(unidade)}
          &nbsp;→&nbsp;
          Final: <strong>${retorno}</strong> ${_escHtml(unidade)}
          ${item.qtdConsumida ? ` (consumido: ${item.qtdConsumida})` : ''}
          ${item.qtdDanificada ? ` (danificado: ${item.qtdDanificada})` : ''}
        </div>
        ${foto ? `<div class="grade-fotos" style="margin-top:8px"><img src="${foto}" class="foto-thumb" onclick="window.open('${foto}','_blank')"></div>` : ''}
      </div>
    `;
  }).join('');

  const fotosRetornoHTML = (festa.fotosRetorno || []).length ? `
    <div class="detalhe-card" style="margin-top:16px">
      <h3>Fotos do Retorno</h3>
      <div class="grade-fotos">${festa.fotosRetorno.map(u => `<img src="${u}" class="foto-thumb" onclick="window.open('${u}','_blank')">`).join('')}</div>
    </div>
  ` : '';

  document.getElementById('relret-content').innerHTML = `
    <div class="card-festa-info" style="margin-bottom:16px">
      <h2>${_escHtml(festa.cliente || festa.nome)}</h2>
      <div class="card-festa-meta">${_escHtml(festa.nome)}</div>
    </div>
    ${linhasItens}
    ${fotosRetornoHTML}
  `;
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
  document.getElementById('gal-info').innerHTML = htmlInfoFesta(festa) + htmlLinkConferenciaBtn(festa);

  document.getElementById('gal-itens').innerHTML = (festa.itens || []).map((item, i) => {
    const badgeForn = htmlBadgeForn(item);
    return `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${_escHtml(nomeBasDisplay(item.nome))}</div>
          ${badgeForn || ''}
          <div class="item-sub">
            Retornou: <strong>${item.qtdRetorno || 0}</strong>
            ${item.qtdDanificada ? ` — Danificado: <strong>${item.qtdDanificada}</strong>` : ''}
            ${_escHtml(item.unidade || 'un')}
          </div>
        </div>
      </div>
      <div class="item-entrada">
        <label>Conferido no Galpão:</label>
        <input type="number" class="qty-input" id="gal-qty-${i}"
          value="${item.qtdGalpao !== undefined ? item.qtdGalpao : (item.qtdRetorno || '')}"
          min="0" placeholder="0"
          oninput="checarGal(${i}, ${item.qtdRetorno || 0})" />
        <span class="item-unidade">${_escHtml(item.unidade || 'un')}</span>
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
      `<div class="div-linha">${_escHtml(d.item)}: retornou ${d.retorno}, galpao ${d.galpao}</div>`
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
      try {
        toast('Enviando fotos...', 'info');
        fotoUrls = await uploadFotos(fotosCache.galpao, festaAtual.id, 'galpao');
      } catch (e) {
        console.error('Erro ao enviar fotos do galpão:', e);
        toast('Não foi possível enviar as fotos, mas o registro será salvo.', 'aviso');
      }
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

  historico = ['tela-inicial', 'tela-ceo', 'tela-lista-festas'];
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

/* Auto-criar configs de item para itens com categoria vinda do PDF (silencioso,
   sem bloquear) — usado tanto na criação da festa quanto ao importar um PDF
   numa festa já existente. Usa o nome sem sufixo de fornecimento (ex:
   "CONSIGNADO") para não poluir o cadastro. */
function _autoCriarConfigsDeItensPDF(itens) {
  itens.filter(it => it.categoria).forEach(it => {
    const nomeLimpo = nomeBasDisplay(it.nome);
    const key = normalizarNomeItem(nomeLimpo);
    if (!itemConfigsCache[key] && !itemConfigsCache[nomeBaseKey(key)]) {
      const dados = {
        nome:            nomeLimpo,
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
    const convidadosVal = parseFloat(document.getElementById('cf-convidados').value);

    await salvarFesta({
      nome,
      cliente,
      data:        new Date(dataStr + 'T12:00:00'),
      hora:        document.getElementById('cf-hora').value,
      local:       document.getElementById('cf-local').value.trim(),
      colaborador: document.getElementById('cf-colaborador').value,
      obs:         document.getElementById('cf-obs').value.trim(),
      tipoEvento:  document.getElementById('cf-tipo-evento').value.trim(),
      convidados:  isNaN(convidadosVal) ? null : convidadosVal,
      itens,
      criadoPor:   usuarioAtual.nome,
    });

    toast(`Festa "${nome}" criada com sucesso.`, 'sucesso');

    _autoCriarConfigsDeItensPDF(itens);

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
        <button class="btn-secundario" onclick="abrirEditarFesta('${festa.id}')">Editar Detalhes / Quantidades</button>
        <button class="btn-secundario" onclick="ceoSepararFesta('${festa.id}')">Separar esta Festa</button>
       </div>`
    : '';

  const importarItensHTML = (festa.status === 'agendada' || festa.status === 'separando')
    ? `<div class="importar-or-box" style="margin-bottom:16px">
        <input type="file" id="input-importar-or-detalhe" accept=".pdf" style="display:none"
          onchange="processarArquivoORDetalhe(this, '${festa.id}')">
        <div>
          <div class="importar-or-titulo">Importar Ordem de Separacao</div>
          <div class="importar-or-desc">Selecione o PDF gerado pelo sistema para preencher a lista de itens desta festa. Não altera nome, cliente, data ou local.</div>
        </div>
        <button class="btn-primario btn-sm" onclick="document.getElementById('input-importar-or-detalhe').click()">
          Selecionar PDF
        </button>
       </div>`
    : '';

  const excluirHTML = _podeExcluirFesta(festa.nome, festa.status)
    ? `<div style="padding-top:12px;border-top:var(--borda);margin-top:12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <button class="btn-perigo" onclick="confirmarExcluirFesta('${festa.id}','${_esc(festa.nome)}','${festa.status}')">
          Excluir Festa
        </button>
        <span style="font-size:11px;color:var(--cinza-400)">Irreversível — use apenas para re-importar.</span>
      </div>`
    : '';

  const linkConfHTML = htmlLinkConferenciaBtn(festa);

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
        <h2>${_escHtml(festa.nome)}</h2>
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
    ${linkConfHTML}
    ${avancarHTML}
    ${editarHTML}
    ${importarItensHTML}

    <div class="detalhe-card">
      <h3>Itens (${itens.length})</h3>
      ${itens.map(it => `
        <div class="detalhe-linha">
          <span>${_escHtml(it.nome)}</span>
          <span>Nec: ${it.qtdNecessaria} | Sep: ${it.qtdSeparada || 0} | Conf: ${it.qtdConferida || 0} | Ret: ${it.qtdRetorno !== undefined ? it.qtdRetorno : '—'} ${_escHtml(it.unidade || 'un')}</span>
        </div>
      `).join('')}
    </div>

    ${divs.length ? `
      <div class="detalhe-card" style="border-left:3px solid var(--vermelho)">
        <h3 style="color:var(--vermelho)">Divergencias na Conferencia (${divs.length})</h3>
        ${divs.map(d => `
          <div class="detalhe-linha">
            <span>${_escHtml(d.item)}</span>
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
            <span>${_escHtml(d.item)}</span>
            <span>Retornou: ${d.retorno} / Galpao: ${d.galpao}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${festa.obsSeparacao ? `<div class="detalhe-card"><h3>Obs. Separacao</h3><p style="font-size:13px">${_escHtml(festa.obsSeparacao)}</p></div>` : ''}
    ${festa.obsConferencia ? `<div class="detalhe-card"><h3>Obs. Conferencia</h3><p style="font-size:13px">${_escHtml(festa.obsConferencia)}</p></div>` : ''}
    ${festa.obsRetorno ? `<div class="detalhe-card"><h3>Obs. Retorno</h3><p style="font-size:13px">${_escHtml(festa.obsRetorno)}</p></div>` : ''}

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

/* Festas "Agendada" sempre podem ser excluídas. Festas de teste (nome contém
   "teste") podem ser excluídas em qualquer status, pra permitir testar o
   sistema livremente sem deixar lixo de separação/conferência pra trás. */
function _podeExcluirFesta(nome, status) {
  return status === 'agendada' || /teste/i.test(nome || '');
}

async function confirmarExcluirFesta(id, nome, status) {
  if (!_podeExcluirFesta(nome, status)) {
    alert(`Não é possível excluir "${nome}": a festa já está em "${STATUS_LABELS[status] || status}". Só é possível excluir festas com status "Agendada" (antes de iniciar a separação).`);
    return;
  }
  if (!confirm(`Excluir a festa "${nome}"?\n\nEsta ação não pode ser desfeita.`)) return;
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

/* ── Link temporário de Conferência (24h) ── */
async function gerarELinkConferencia(festaId, nomeFesta) {
  try {
    const token = await gerarLinkConferencia(festaId, nomeFesta);
    const url = `${location.origin}${location.pathname}?conf=${token}`;
    document.getElementById('lc-url').value = url;
    document.getElementById('modal-link-conferencia').classList.remove('hidden');
  } catch (e) {
    console.error(e);
    toast('Erro ao gerar link.', 'erro');
  }
}

function fecharModalLinkConferencia() {
  document.getElementById('modal-link-conferencia').classList.add('hidden');
}

function copiarLinkConferencia() {
  const input = document.getElementById('lc-url');
  navigator.clipboard.writeText(input.value)
    .then(() => toast('Link copiado!', 'sucesso'))
    .catch(() => { input.select(); toast('Não deu pra copiar automaticamente — selecione e copie.', 'aviso'); });
}

/* ── Edição de data/quantidades ── */
let _efItensExtras = [];   /* itens do catálogo adicionados nesta sessão de edição, ainda não salvos */

async function abrirEditarFesta(id) {
  festaEditandoId = id;
  _efItensExtras  = [];
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
  document.getElementById('ef-tipo-evento').value = festa.tipoEvento || '';
  document.getElementById('ef-convidados').value  = festa.convidados != null ? festa.convidados : '';

  /* Preencher quantidades por item (itens já na festa + itens adicionados nesta sessão).
     Se o campo já existe na tela (ex.: o listener recebeu uma atualização
     enquanto o CEO estava digitando), reaproveita o valor que já está no
     input em vez do valor salvo no Firestore — senão cada eco do listener
     (inclusive o "editandoAgora" que esta própria tela grava ao abrir) apaga
     silenciosamente o que a pessoa acabou de digitar. */
  const itens     = festa.itens || [];
  const todos     = itens.concat(_efItensExtras);
  document.getElementById('ef-itens').innerHTML = todos.map((item, i) => {
    const inputExistente = document.getElementById(`ef-qty-${i}`);
    const valorAtual = inputExistente ? inputExistente.value : item.qtdNecessaria;
    return `
    <div class="item-row">
      <div class="item-topo">
        <div>
          <div class="item-nome">${_escHtml(item.nome)}</div>
          <div class="item-sub">Unidade: ${_escHtml(item.unidade || 'un')}</div>
        </div>
        ${item._novo ? `<button class="btn-del-item" onclick="removerItemExtraEdicao(${i - itens.length})">x</button>` : ''}
      </div>
      <div class="item-entrada">
        <label>Quantidade necessaria:</label>
        <input type="number" class="qty-input" id="ef-qty-${i}"
          value="${valorAtual}" min="0" />
        <span class="item-unidade">${_escHtml(item.unidade || 'un')}</span>
      </div>
    </div>
  `;
  }).join('');

  popularSelectAddItemEdicao();
}

function popularSelectAddItemEdicao() {
  const datalist = document.getElementById('ef-add-datalist');
  if (!datalist) return;

  const itens = (festaAtual?.itens || []).concat(_efItensExtras);
  const keysJaNaFesta = new Set(itens.map(it => nomeBaseKey(normalizarNomeItem(it.nome))));

  const disponiveis = Object.values(itemConfigsCache)
    .filter(c => !keysJaNaFesta.has(nomeBaseKey(c.nomeKey || normalizarNomeItem(c.nome))))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  datalist.innerHTML = disponiveis.map(c => `<option value="${_esc(c.nome)}">`).join('');
}

/* Importa itens de um PDF (Ordem de Separação) numa festa JÁ criada — só
   preenche a lista de itens (mesmo parser usado na criação), nunca mexe em
   nome/cliente/data/hora, que já vieram do Contrato de origem. Itens ficam
   em _efItensExtras (mesmo staging do "+ Adicionar Item" manual) até ela
   clicar em Salvar. */
async function processarArquivoOREdicao(input) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  toast('Lendo PDF...', 'info');

  try {
    const linhas = await extrairLinhasPDF(file);
    const dados  = parsearOR(linhas);

    if (!dados.itens.length) {
      toast('Nenhum item encontrado no PDF.', 'aviso');
      return;
    }

    const jaNaFesta = new Set((festaAtual?.itens || []).concat(_efItensExtras).map(it => normalizarNomeItem(it.nome)));
    let adicionados = 0;
    dados.itens.forEach(it => {
      const chave = normalizarNomeItem(it.nome);
      if (jaNaFesta.has(chave)) return;
      _efItensExtras.push({ ...it, _novo: true });
      jaNaFesta.add(chave);
      adicionados++;
    });

    renderizarEditarFesta(festaAtual);
    const ignorados = dados.itens.length - adicionados;
    toast(`${adicionados} item(ns) importado(s)${ignorados ? `, ${ignorados} já estava(m) na lista` : ''}. Confira as quantidades e clique em Salvar.`, 'sucesso');

  } catch (e) {
    console.error('Erro ao importar PDF:', e);
    toast('Erro ao ler o PDF. Verifique o arquivo e tente novamente.', 'erro');
  }
}

/* Importa itens de um PDF (Ordem de Separação) direto na tela de Detalhe da
   Festa (ex: festas sincronizadas de Contratos, que chegam sem itens) — grava
   direto no Firestore, sem passar pela tela de Editar. Nunca mexe em
   nome/cliente/data/hora. */
async function processarArquivoORDetalhe(input, festaId) {
  const file = input.files[0];
  if (!file) return;
  input.value = '';

  toast('Lendo PDF...', 'info');

  try {
    const linhas = await extrairLinhasPDF(file);
    const dados  = parsearOR(linhas);

    if (!dados.itens.length) {
      toast('Nenhum item encontrado no PDF.', 'aviso');
      return;
    }

    const itensAtuais = festaAtual?.itens || [];
    const jaNaFesta    = new Set(itensAtuais.map(it => normalizarNomeItem(it.nome)));
    const novos = dados.itens.filter(it => {
      const chave = normalizarNomeItem(it.nome);
      if (jaNaFesta.has(chave)) return false;
      jaNaFesta.add(chave);
      return true;
    });

    if (!novos.length) {
      toast('Todos os itens do PDF já estão nesta festa.', 'aviso');
      return;
    }

    const itensFinal = itensAtuais.concat(novos);
    await atualizarFesta(festaId, { itens: itensFinal });
    _autoCriarConfigsDeItensPDF(itensFinal);

    toast(`${novos.length} item(ns) importado(s) com sucesso.`, 'sucesso');

  } catch (e) {
    console.error('Erro ao importar PDF:', e);
    toast('Erro ao ler o PDF. Verifique o arquivo e tente novamente.', 'erro');
  }
}

function adicionarItemEdicaoFesta() {
  const input = document.getElementById('ef-add-input');
  const cfg   = _resolverItemCatalogoPorNome(input?.value);
  if (!cfg) return toast('Selecione um item valido da lista do cadastro.', 'erro');

  const qtdInput = document.getElementById('ef-add-qtd');
  const qtd      = parseFloat(qtdInput?.value) || 0;

  _efItensExtras.push({
    id:            `item-novo-${Date.now()}`,
    nome:          cfg.nome,
    qtdNecessaria: qtd,
    unidade:       cfg.unidade || 'un',
    qtdSeparada:   0,
    qtdConferida:  0,
    qtdRetorno:    0,
    qtdGalpao:     0,
    qtdDanificada: 0,
    _novo:         true,
  });

  if (qtdInput) qtdInput.value = '';
  if (input)    input.value    = '';
  renderizarEditarFesta(festaAtual);
  toast(`${cfg.nome} adicionado. Salve as alteracoes para confirmar.`, 'sucesso');
}

function removerItemExtraEdicao(idx) {
  _efItensExtras.splice(idx, 1);
  renderizarEditarFesta(festaAtual);
}

async function salvarEdicaoFesta() {
  if (!festaAtual || !festaEditandoId) return;

  const novaDataStr   = document.getElementById('ef-data').value;
  const novaHora      = document.getElementById('ef-hora').value;
  const novoTipo      = document.getElementById('ef-tipo-evento').value.trim();
  const novosConv     = parseFloat(document.getElementById('ef-convidados').value);
  const novosConvidados = isNaN(novosConv) ? null : novosConv;

  if (!novaDataStr) return toast('Informe a data do evento.', 'erro');

  const novaData = new Date(novaDataStr + 'T12:00:00');

  /* Montar itens com novas quantidades e registrar o que mudou */
  const itens        = festaAtual.itens || [];
  const alteracoes   = [];
  const itensAtuais  = itens.concat(_efItensExtras).map((item, i) => {
    const novaQtd = parseFloat(document.getElementById(`ef-qty-${i}`)?.value) || 0;
    if (item._novo) {
      alteracoes.push({ campo: item.nome, de: 'Item adicionado', para: novaQtd });
      const { _novo, ...itemLimpo } = item;
      return { ...itemLimpo, qtdNecessaria: novaQtd };
    }
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
  if ((festaAtual.tipoEvento || '') !== novoTipo) {
    alteracoes.push({ campo: 'Tipo de Evento', de: festaAtual.tipoEvento || '—', para: novoTipo || '—' });
  }
  if ((festaAtual.convidados ?? null) !== novosConvidados) {
    alteracoes.push({ campo: 'Convidados', de: festaAtual.convidados ?? '—', para: novosConvidados ?? '—' });
  }

  try {
    await editarFestaDados(
      festaEditandoId,
      { data: novaData, hora: novaHora, tipoEvento: novoTipo, convidados: novosConvidados, itens: itensAtuais },
      alteracoes,
      usuarioAtual.nome
    );

    /* Liberar separador */
    try { await atualizarFesta(festaEditandoId, { editandoAgora: null }); } catch(_) {}

    _autoCriarConfigsDeItensPDF(itensAtuais);
    _efItensExtras = [];

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
    abrirRetorno(id);
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
  historico = ['tela-inicial', 'tela-ceo', 'tela-lista-festas'];
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
          <div class="usuario-nome">${_escHtml(u.nome)}</div>
          <div class="usuario-role">${_escHtml(rolesTexto)}</div>
        </div>
        <div class="usuario-acoes">
          ${u.id !== usuarioAtual.id
            ? `<button class="btn-perigo" onclick="confirmarDeletarUsuario('${u.id}','${_esc(u.nome)}')">Remover</button>`
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
  if (senha.length < 6)   return toast('Senha deve ter ao menos 6 caracteres.', 'erro');
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
    if (e.code === 'auth/email-already-in-use') {
      toast('Ja existe uma conta com esse nome (pode ser uma conta orfa de uma tentativa anterior). Apague-a em Firebase Console > Authentication > Users antes de tentar de novo.', 'erro');
    } else {
      toast('Erro ao criar usuario.', 'erro');
    }
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
      ? `<span class="badge-fornecimento badge-forn-${_escHtml(item.fornecimento)}">${_escHtml(item.fornecimento)}</span>`
      : '';

    row.innerHTML = `
      <input type="text"   value="${_escHtml(item.nome)}" placeholder="Nome do item" />
      <input type="number" value="${item.qtdNecessaria}" placeholder="0" />
      <input type="text"   value="${_escHtml(item.unidade)}" placeholder="un" />
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
    else if (f.status === 'festa')       onclick = `abrirDetalheFesta('${f.id}')`;
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

  const resumoEquipe = _resumoEquipeFesta(f);

  const infoEventoTxt  = _infoEventoTexto(f);
  const infoEventoHtml = infoEventoTxt ? `<div class="card-festa-meta">${infoEventoTxt}</div>` : '';

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
            <div class="card-festa-nome">${_escHtml(f.nome)}</div>
            <span class="badge badge-${f.status}">${_escHtml(STATUS_LABELS[f.status] || f.status)}</span>
            ${f.origemAuto ? `<span class="badge-ordem" title="Criada automaticamente a partir de um Contrato">Contrato</span>` : ''}
          </div>
          <div class="card-festa-meta">${_escHtml(f.cliente)}${f.hora ? ' — ' + _escHtml(f.hora) : ''}</div>
          ${infoEventoHtml}
          ${f.local ? `<div class="card-festa-meta">${_escHtml(f.local)}</div>` : ''}
          ${resumoEquipe ? `<div class="card-festa-meta">${_escHtml(resumoEquipe)}</div>` : ''}
          <div class="card-festa-rodape">
            <span>${(f.itens || []).length} itens</span>
            ${f.colaborador ? `<span>${_escHtml(f.colaborador)}</span>` : ''}
            ${(f.divergencias?.length > 0) ? `<span class="badge-divergencia-card">${f.divergencias.length} divergência${f.divergencias.length !== 1 ? 's' : ''}</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
}

/* Tipo de Evento + Convidados, formatados igual em toda tela que mostra
   dados da festa (card da lista, Separação/Conferência/Retorno/Galpão,
   Detalhe). String vazia quando nenhum dos dois está preenchido. */
function _infoEventoTexto(f) {
  const partes = [];
  if (f.tipoEvento) partes.push(_escHtml(f.tipoEvento));
  if (f.convidados != null) partes.push(`${f.convidados} convidados`);
  return partes.join(' · ');
}

function htmlInfoFesta(f) {
  const ehCEO = !!(usuarioAtual?.roles?.includes('ceo') || usuarioAtual?.role === 'ceo');
  const btnExcluir = (ehCEO && _podeExcluirFesta(f.nome, f.status))
    ? `<div style="margin-top:10px">
        <button class="btn-perigo" style="font-size:12px;padding:5px 12px"
          onclick="confirmarExcluirFesta('${f.id}','${_esc(f.nome)}','${f.status}')">
          Excluir Festa
        </button>
       </div>`
    : '';
  const infoEventoTxt = _infoEventoTexto(f);
  return `
    <h2>${_escHtml(f.nome)}</h2>
    <div class="info-linha">${_escHtml(f.cliente)}${f.data ? ' — ' + formatarData(f.data) : ''}</div>
    ${f.hora  ? `<div class="info-linha">${_escHtml(f.hora)}</div>` : ''}
    ${f.local ? `<div class="info-linha">${_escHtml(f.local)}</div>` : ''}
    ${infoEventoTxt ? `<div class="info-linha">${infoEventoTxt}</div>` : ''}
    ${f.obs   ? `<div class="info-linha" style="opacity:.75;font-size:12px;margin-top:6px">${_escHtml(f.obs)}</div>` : ''}
    ${btnExcluir}
  `;
}

/* Botão de gerar/reenviar o link de Conferência — precisa aparecer em toda
   tela onde o CEO possa estar acompanhando a festa (separação, conferência,
   retorno, galpão), não só nos Detalhes, senão fica sem como pegar o link
   depois que a festa avança de etapa. */
function htmlLinkConferenciaBtn(f) {
  if (!souCeo()) return '';
  return `
    <div class="detalhe-acoes" style="margin:8px 0 16px">
      <button class="btn-secundario" onclick="gerarELinkConferencia('${f.id}','${_esc(f.nome)}')">Gerar link de Conferência (24h)</button>
    </div>
  `;
}

function htmlInfoLinhas(f) {
  return [
    f.data        && `<div class="info-linha">${formatarData(f.data)}</div>`,
    f.hora        && `<div class="info-linha">${_escHtml(f.hora)}</div>`,
    f.cliente     && `<div class="info-linha">${_escHtml(f.cliente)}</div>`,
    f.local       && `<div class="info-linha">${_escHtml(f.local)}</div>`,
    _infoEventoTexto(f) && `<div class="info-linha">${_infoEventoTexto(f)}</div>`,
    f.colaborador && `<div class="info-linha">Colaborador: ${_escHtml(f.colaborador)}</div>`,
    f.coordenador && `<div class="info-linha">Coordenador: ${_escHtml(f.coordenador)}</div>`,
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

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const ativas = todasFestasCache.filter(f => {
    if (f.status === 'concluida') return false;
    const d = toDate(f.data);
    return !isNaN(d) && d >= hoje;
  });
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

  const PRIOR_LABEL = { alta: 'Alta Prioridade', media: 'Média Prioridade', baixa: 'Baixa Prioridade' };
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
        <span class="producao-grupo-nome producao-nao-clas-label">Não classificados</span>
        <span class="producao-grupo-qtd">${naoClas.length} item${naoClas.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="producao-grupo-itens" id="grupo-__nao_classificados">
        <p class="producao-nao-clas-hint">Configure esses itens em <strong>Cadastro</strong> e marque "É item de Produção" para que apareçam aqui.</p>
        ${naoClas.map(item => `
          <div class="producao-item-row producao-item-nao-clas">
            <div class="producao-item-info">
              <div class="producao-item-nome">${_escHtml(nomeBasDisplay(item.nome))}</div>
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
        <span class="producao-grupo-nome">${_escHtml(g.nome)}</span>
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
      ? `<span class="badge-refrigerado">Refrig.</span>` : '';
    const badgePrior  = cfg?.prioridade
      ? `<span class="badge-prioridade prior-${cfg.prioridade}">${cfg.prioridade}</span>` : '';

    return `
      <div class="producao-item-row">
        <div class="producao-item-info">
          <div class="producao-item-nome">${_escHtml(nomeBasDisplay(item.nome))}</div>
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
      ? `<span class="badge-refrigerado">Refrig.</span>` : '';

    const subRows = item.festas.map(f => {
      let dataTxt = '';
      if (f.festaData) {
        const d = toDate(f.festaData);
        if (!isNaN(d)) dataTxt = ` — ${String(d.getDate()).padStart(2,'0')} ${MESES_ABR[d.getMonth()]}`;
      }
      return `
        <div class="analitico-sub-row">
          <span class="analitico-sub-nome">${_escHtml(f.festaNome)}${dataTxt}</span>
          <span class="analitico-sub-qty">${f.qtd} ${item.unidade}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="producao-item-row">
        <div class="producao-item-info" style="width:100%">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div class="producao-item-nome">${_escHtml(nomeBasDisplay(item.nome))} ${badgeRefrig}</div>
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

/* Sufixos que indicam TIPO DE FORNECIMENTO — mesmo produto, formas diferentes de obter.
   extrairFornDoNome() sempre devolve a forma canônica daqui (masc./singular). */
const SUFIXOS_FORNECIMENTO = [
  'consignado','cliente','romero','reserva','proprio','propria','terceiro',
  'cortesia','gratis','gratuito','locacao','doacao','empresa',
];

/* Variantes de grafia que aparecem no nome (import de PDF) mas apontam pro
   mesmo sufixo canônico acima (ex.: "CONSIGNADA" no feminino). "bebida"/
   "bebidas" não é fornecimento nenhum — é o nome da categoria que o PDF às
   vezes cola no final do item ("750MLBEBIDAS", "750MLBEBIDA CONSIGNADO");
   mapeia pra null de propósito: é ruído puro, sempre descartado do nome,
   nunca indica de quem veio o produto. */
const _ALIAS_SUFIXO_NOME = { consignada: 'consignado', bebida: null, bebidas: null };

/* Palavras (sufixo real OU ruído de categoria) cortadas do final do nome ao
   calcular a chave/nome base do produto — nomeBaseKey/nomeBasDisplay tratam
   os dois tipos igual, só extrairFornDoNome() se importa com qual é qual. */
const _CORTAR_DO_NOME = [...SUFIXOS_FORNECIMENTO, ...Object.keys(_ALIAS_SUFIXO_NOME)];

/* Retorna o nomeKey sem sufixo de fornecimento e/ou ruído de categoria.
   Trata sufixo/ruído separado ("aperol_consignado"), colado ("aperol_1000mlromero")
   e os dois emendados ("aperol_750mlbebidas_consignada", "aperol_750mlbebidas") —
   por isso repete a checagem em camadas até não sobrar mais nada pra cortar. */
function nomeBaseKey(nomeKey) {
  let s = nomeKey || '';
  for (let i = 0; i < 3; i++) {
    const partes = s.split('_').filter(Boolean);
    if (partes.length < 1) break;
    const ultimo = partes[partes.length - 1];
    let novo = null;
    /* Sufixo/ruído exato */
    if (partes.length > 1 && _CORTAR_DO_NOME.includes(ultimo)) {
      const idx = s.lastIndexOf('_' + ultimo);
      if (idx !== -1) novo = s.slice(0, idx).replace(/_+$/, '');
    }
    /* Colado no final da última palavra (ex: "1000mlromero" → strip "romero") */
    if (novo === null) {
      const suf = _CORTAR_DO_NOME.find(x => ultimo.endsWith(x) && ultimo.length > x.length);
      if (suf) novo = s.slice(0, s.length - suf.length).replace(/_+$/, '');
    }
    if (novo === null || novo === s) break;
    s = novo;
  }
  return s;
}

/* Retorna nome de exibição sem sufixo/ruído — mesma lógica em camadas de
   nomeBaseKey, só que operando nas palavras do nome original (com espaço). */
function nomeBasDisplay(nome) {
  let s = (nome || '').trim();
  for (let i = 0; i < 3 && s; i++) {
    const partes = s.split(/\s+/);
    const ultimo  = partes[partes.length - 1];
    const ultimoN = normalizarNomeItem(ultimo);
    let novo = null;
    /* Sufixo/ruído exato como palavra separada */
    if (partes.length > 1 && _CORTAR_DO_NOME.includes(ultimoN)) {
      novo = partes.slice(0, -1).join(' ');
    } else {
      /* Colado no final da última palavra (ex: "750MLROMERO" → "750ML") */
      const suf = _CORTAR_DO_NOME.find(x => ultimoN.endsWith(x) && ultimoN.length > x.length);
      if (suf) {
        const semSuf = ultimo.slice(0, ultimo.length - suf.length);
        novo = (partes.length > 1 ? partes.slice(0, -1).join(' ') + ' ' : '') + semSuf;
      }
    }
    if (novo === null || novo === s) break;
    s = novo.trim();
  }
  return s;
}

/* Extrai o sufixo de fornecimento embutido no nome (ex: "APEROL CONSIGNADO" → "consignado").
   Nunca devolve ruído de categoria ("bebida"/"bebidas") — só um sufixo real. */
function extrairFornDoNome(nome) {
  const partes = (nome || '').trim().split(/\s+/);
  const ultimo  = normalizarNomeItem(partes[partes.length - 1]);
  if (partes.length > 1) {
    if (SUFIXOS_FORNECIMENTO.includes(ultimo)) return ultimo;
    if (_ALIAS_SUFIXO_NOME[ultimo]) return _ALIAS_SUFIXO_NOME[ultimo];
  }
  /* Colado no final */
  for (const suf of SUFIXOS_FORNECIMENTO) {
    if (ultimo.endsWith(suf) && ultimo.length > suf.length) return suf;
  }
  for (const [alias, canon] of Object.entries(_ALIAS_SUFIXO_NOME)) {
    if (canon && ultimo.endsWith(alias) && ultimo.length > alias.length) return canon;
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
let _abaInventario      = 'acontar'; /* 'acontar' | 'contados' */
let _inventarioConfigs  = [];        /* cache dos item_configs carregados */

/* Um item fica na aba "Contados" por 24h a partir do momento em que foi
   contado (campo ultimaContagemEm no doc de estoque) — não é um estado só
   de memória, então sobrevive a "Atualizar"/recarregar a tela. Só ações de
   CONTAGEM setam esse campo; entrada de mercadoria não conta como contagem. */
function _itemContadoRecentemente(nomeKey) {
  const ts = estoqueCache[nomeKey]?.ultimaContagemEm;
  if (!ts) return false;
  const d = toDate(ts);
  if (isNaN(d)) return false;
  return (Date.now() - d.getTime()) < 24 * 60 * 60 * 1000;
}

async function abrirInventario() {
  historico.push('tela-colaborador');
  mostrarTela('tela-inventario', 'Inventário de Estoque');
  _buscaInventario = '';
  _abaInventario   = 'acontar';
  const busca = document.querySelector('#tela-inventario .barra-busca');
  if (busca) busca.value = '';
  await recarregarInventario();
}

async function recarregarInventario() {
  document.getElementById('inventario-conteudo').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const [configs, , cats] = await Promise.all([
      Object.keys(itemConfigsCache).length ? Promise.resolve(Object.values(itemConfigsCache)) : listarItemConfigs(),
      garantirListenerEstoque(),
      categoriasCache.length ? Promise.resolve(categoriasCache) : listarCategorias(),
    ]);
    _inventarioConfigs = configs;
    if (!categoriasCache.length) categoriasCache = cats;
    const dl = document.getElementById('inv-add-datalist');
    if (dl) dl.innerHTML = configs.map(c => `<option value="${_esc(c.nome)}">`).join('');
    renderizarInventario();
  } catch (e) {
    console.error(e);
    toast('Erro ao carregar inventário.', 'erro');
    document.getElementById('inventario-conteudo').innerHTML =
      '<div class="estado-vazio"><p>Erro ao carregar. Tente novamente.</p></div>';
  }
}

/* Categorias como Coquetéis (produzidos internamente, não dá pra contar
   estoque) usam o mesmo flag exibirEstoque que já esconde a categoria do
   Controle de Estoque — aqui ele também tira os itens da tela de Inventário. */
function _categoriaPermiteEstoque(grupo) {
  if (!grupo) return true;
  const cat = categoriasCache.find(c => c.nome === grupo);
  return !cat || cat.exibirEstoque !== false;
}

/* Mesmo esquema do exibirSeparacao: a categoria libera/bloqueia por padrão,
   mas o item pode ter um override individual (exibirCompras=false) mesmo
   com a categoria liberada — usado na Lista de Compras e nos Alertas de
   estoque mínimo, pra tirar itens específicos sem esconder a categoria toda. */
function deveExibirNaListaCompras(cfg) {
  if (!cfg) return true;
  if (cfg.exibirCompras === false) return false;
  if (cfg.grupo) {
    const cat = categoriasCache.find(c => c.nome === cfg.grupo);
    if (cat && cat.exibirCompras === false) return false;
  }
  return true;
}

function filtrarInventario(valor) {
  _buscaInventario = valor;
  renderizarInventario();
}

function invNomeInput(val) {
  const cfg = _inventarioConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(val));
  const unEl = document.getElementById('inv-add-un');
  if (unEl) unEl.textContent = cfg?.unidade || '';
}

async function invAdicionarItem() {
  const nomeInput = document.getElementById('inv-add-nome');
  const qtdInput  = document.getElementById('inv-add-qtd');
  const nome = (nomeInput?.value || '').trim();
  if (!nome) return toast('Informe o nome do produto.', 'erro');
  const qtd = parseFloat(qtdInput?.value) || 0;
  const cfg = _inventarioConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(nome));
  const nomeKey  = cfg ? (cfg.nomeKey || normalizarNomeItem(cfg.nome)) : normalizarNomeItem(nome);
  const unidade  = cfg?.unidade || 'un';
  const nomeReal = cfg?.nome || nome;
  const dadosSalvar = { nome: nomeReal, unidade, qtd, ultimaContagemEm: new Date() };

  try {
    await salvarItemEstoque(nomeKey, dadosSalvar);
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), ...dadosSalvar, nomeKey };
    if (nomeInput) nomeInput.value = '';
    if (qtdInput)  qtdInput.value  = '';
    const unEl = document.getElementById('inv-add-un');
    if (unEl) unEl.textContent = '';
    toast(`${nomeReal}: ${qtd} ${unidade}`, 'sucesso');
    renderizarInventario();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar.', 'erro');
    return;
  }
  try {
    await registrarContagemHistorico({ nomeKey, nome: nomeReal, unidade, qtd, contadoPor: usuarioAtual?.nome || '—', tipo: 'contagem' });
  } catch (e) {
    toast('Aviso: não foi possível salvar no histórico.', 'erro');
  }
}

function trocarAbaInventario(aba, btn) {
  _abaInventario = aba;
  document.querySelectorAll('#inv-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  renderizarInventario();
}

function renderizarInventario() {
  const busca = _buscaInventario.toLowerCase().trim();
  let itens = _inventarioConfigs.filter(c => c.nome && _categoriaPermiteEstoque(c.grupo));
  if (busca) itens = itens.filter(c =>
    (c.nome || '').toLowerCase().includes(busca) ||
    (c.grupo || '').toLowerCase().includes(busca)
  );

  /* Separar por aba — "contado" é derivado do ultimaContagemEm salvo no
     estoque (válido por 24h), não de um Set em memória, então sobrevive a
     "Atualizar"/reabrir a tela. */
  const aContar  = itens.filter(c => !_itemContadoRecentemente(c.nomeKey || normalizarNomeItem(c.nome)));
  const contados = itens.filter(c =>  _itemContadoRecentemente(c.nomeKey || normalizarNomeItem(c.nome)));
  const lista    = _abaInventario === 'acontar' ? aContar : contados;

  /* Tabs com contadores */
  const nContados = contados.length;
  const nAContar  = aContar.length;
  const tabsHtml  = `
    <div class="filtros-tabs" id="inv-tabs" style="margin-bottom:12px">
      <button class="tab${_abaInventario === 'acontar'  ? ' ativo' : ''}" id="inv-tab-acontar"
        onclick="trocarAbaInventario('acontar',this)">A Contar (${nAContar})</button>
      <button class="tab${_abaInventario === 'contados' ? ' ativo' : ''}" id="inv-tab-contados"
        onclick="trocarAbaInventario('contados',this)">Contados (${nContados})</button>
    </div>`;

  if (!lista.length) {
    const msg = _abaInventario === 'acontar'
      ? 'Todos os itens já foram contados nas últimas 24h!'
      : 'Nenhum item contado nas últimas 24h.';
    document.getElementById('inventario-conteudo').innerHTML = tabsHtml + estadoVazio(msg);
    return;
  }

  /* Agrupar por categoria/grupo, produtos em ordem alfabética dentro de cada uma */
  lista.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  const grupos = {};
  lista.forEach(c => {
    const g = c.grupo || 'Sem Categoria';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(c);
  });

  const itenHtml = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(g => {
    const linhas = grupos[g].map(c => {
      const key      = c.nomeKey || normalizarNomeItem(c.nome);
      const est      = estoqueCache[key] || {};
      const qtdEst   = est.qtd != null ? est.qtd : '';
      const un       = c.unidade || est.unidade || '';
      const contado  = _itemContadoRecentemente(key);
      const btnLabel = contado ? 'Atualizar' : 'Contar';
      const btnStyle = contado ? 'background:var(--cinza-600)' : '';
      return `
        <div class="estoque-item-card" id="inv-card-${key}" style="margin-bottom:8px">
          <div class="estoque-item-header">
            <div class="estoque-item-nome">${_escHtml(c.nome)}</div>
            <div style="font-size:12px;color:var(--cinza-500)">${contado ? `<span style="color:var(--verde-700);font-weight:600">Contado</span>` : (un ? _escHtml(un) : '')}</div>
          </div>
          <div class="estoque-body-row">
            <span class="estoque-body-label">Qtd.:</span>
            <div class="estoque-qty-wrap">
              <input type="number" class="estoque-qty-input"
                id="inv-qty-${key}"
                ${contado ? `value="${qtdEst}"` : ''} min="0" placeholder="0"
              />
              ${un ? `<span class="estoque-qty-un">${_escHtml(un)}</span>` : ''}
            </div>
            <button class="btn-primario btn-sm" style="margin-left:8px;flex-shrink:0;${btnStyle}"
              onclick="salvarInventarioQtd('${_esc(key)}','${_esc(c.nome)}','${_esc(un)}')">
              ${btnLabel}
            </button>
          </div>
          ${contado ? `
          <div style="text-align:right;margin-top:6px">
            <button class="btn-secundario btn-sm" style="color:var(--vermelho)"
              onclick="desfazerContagemInventario(this,'${_esc(key)}','${_esc(c.nome)}','${_esc(un)}')">
              &#8617; Desfazer
            </button>
          </div>` : ''}
        </div>`;
    }).join('');
    return `
      <div class="grupo-titulo" style="margin-top:16px;margin-bottom:4px;font-size:12px;font-weight:700;text-transform:uppercase;color:var(--cinza-500);letter-spacing:.5px">${_escHtml(g)}</div>
      ${linhas}`;
  }).join('');

  document.getElementById('inventario-conteudo').innerHTML = tabsHtml + itenHtml;
}

/* ══════════════════════════════════════════════════
   ENTRADA DE MERCADORIA — tela própria, separada do Inventário. Quem só
   precisa registrar mercadoria chegando não precisa passar pelo Inventário
   (contagem geral) pra isso.
══════════════════════════════════════════════════ */

let _buscaEntrada   = '';
let _entradaConfigs = []; /* cache dos item_configs carregados */

async function abrirEntradaMercadoria() {
  historico.push('tela-colaborador');
  mostrarTela('tela-entrada-mercadoria', 'Entrada de Mercadoria');
  _buscaEntrada = '';
  const busca = document.querySelector('#tela-entrada-mercadoria .barra-busca');
  if (busca) busca.value = '';
  await recarregarEntradaMercadoria();
}

async function recarregarEntradaMercadoria() {
  document.getElementById('entrada-mercadoria-conteudo').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const [configs, , cats] = await Promise.all([
      Object.keys(itemConfigsCache).length ? Promise.resolve(Object.values(itemConfigsCache)) : listarItemConfigs(),
      garantirListenerEstoque(),
      categoriasCache.length ? Promise.resolve(categoriasCache) : listarCategorias(),
    ]);
    _entradaConfigs = configs;
    if (!categoriasCache.length) categoriasCache = cats;
    const dl = document.getElementById('ent-add-datalist');
    if (dl) dl.innerHTML = configs.map(c => `<option value="${_esc(c.nome)}">`).join('');
    renderizarEntradaMercadoria();
  } catch (e) {
    console.error(e);
    toast('Erro ao carregar.', 'erro');
    document.getElementById('entrada-mercadoria-conteudo').innerHTML =
      '<div class="estado-vazio"><p>Erro ao carregar. Tente novamente.</p></div>';
  }
}

function filtrarEntradaMercadoria(valor) {
  _buscaEntrada = valor;
  renderizarEntradaMercadoria();
}

function entNomeInput(val) {
  const cfg  = _entradaConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(val));
  const unEl = document.getElementById('ent-add-un');
  if (unEl) unEl.textContent = cfg?.unidade || '';
}

async function entAdicionarItem() {
  const nomeInput = document.getElementById('ent-add-nome');
  const qtdInput  = document.getElementById('ent-add-qtd');
  const nome = (nomeInput?.value || '').trim();
  if (!nome) return toast('Informe o nome do produto.', 'erro');
  const qtdChegando = parseFloat(qtdInput?.value) || 0;
  if (qtdChegando <= 0) return toast('Informe quanto está chegando.', 'erro');
  const cfg = _entradaConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(nome));
  const nomeKey  = cfg ? (cfg.nomeKey || normalizarNomeItem(cfg.nome)) : normalizarNomeItem(nome);
  const unidade  = cfg?.unidade || 'un';
  const nomeReal = cfg?.nome || nome;
  const qtdAtual = estoqueCache[nomeKey]?.qtd || 0;
  const qtdNova  = qtdAtual + qtdChegando;
  try {
    await salvarItemEstoque(nomeKey, { nome: nomeReal, unidade, qtd: qtdNova });
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), nome: nomeReal, unidade, qtd: qtdNova, nomeKey };
    if (nomeInput) nomeInput.value = '';
    if (qtdInput)  qtdInput.value  = '';
    const unEl = document.getElementById('ent-add-un');
    if (unEl) unEl.textContent = '';
    toast(`+${qtdChegando} ${unidade} de "${nomeReal}" — total agora: ${qtdNova} ${unidade}`, 'sucesso');
    renderizarEntradaMercadoria();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar.', 'erro');
    return;
  }
  try {
    await registrarContagemHistorico({ nomeKey, nome: nomeReal, unidade, qtd: qtdChegando, contadoPor: usuarioAtual?.nome || '—', tipo: 'entrada' });
  } catch (e) {
    toast('Aviso: não foi possível salvar no histórico.', 'erro');
  }
}

function renderizarEntradaMercadoria() {
  const busca = _buscaEntrada.toLowerCase().trim();
  let itens = _entradaConfigs.filter(c => c.nome && _categoriaPermiteEstoque(c.grupo));
  if (busca) itens = itens.filter(c =>
    (c.nome || '').toLowerCase().includes(busca) ||
    (c.grupo || '').toLowerCase().includes(busca)
  );

  if (!itens.length) {
    document.getElementById('entrada-mercadoria-conteudo').innerHTML = estadoVazio('Nenhum item encontrado.');
    return;
  }

  /* Agrupar por categoria/grupo, produtos em ordem alfabética dentro de cada uma */
  itens.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  const grupos = {};
  itens.forEach(c => {
    const g = c.grupo || 'Sem Categoria';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(c);
  });

  const itenHtml = Object.keys(grupos).sort((a, b) => a.localeCompare(b, 'pt-BR')).map(g => {
    const linhas = grupos[g].map(c => {
      const key      = c.nomeKey || normalizarNomeItem(c.nome);
      const est      = estoqueCache[key] || {};
      const qtdAtual = est.qtd || 0;
      const un       = c.unidade || est.unidade || '';
      return `
        <div class="estoque-item-card" id="ent-card-${key}" style="margin-bottom:8px">
          <div class="estoque-item-header">
            <div class="estoque-item-nome">${_escHtml(c.nome)}</div>
            <div class="estoque-item-total" style="font-size:12px;color:var(--cinza-500)">Em estoque: ${qtdAtual} ${_escHtml(un)}</div>
          </div>
          <div class="estoque-body-row">
            <span class="estoque-body-label">Chegando:</span>
            <div class="estoque-qty-wrap">
              <input type="number" class="estoque-qty-input"
                id="ent-qty-${key}"
                min="0" placeholder="0"
              />
              ${un ? `<span class="estoque-qty-un">${_escHtml(un)}</span>` : ''}
            </div>
            <button class="btn-primario btn-sm" style="margin-left:8px;flex-shrink:0"
              onclick="registrarEntradaMercadoria('${_esc(key)}','${_esc(c.nome)}','${_esc(un)}')">
              &#43; Registrar Entrada
            </button>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="grupo-titulo" style="margin-top:16px;margin-bottom:4px;font-size:12px;font-weight:700;text-transform:uppercase;color:var(--cinza-500);letter-spacing:.5px">${_escHtml(g)}</div>
      ${linhas}`;
  }).join('');

  document.getElementById('entrada-mercadoria-conteudo').innerHTML = itenHtml;
}

async function registrarEntradaMercadoria(nomeKey, nome, unidade) {
  const input       = document.getElementById(`ent-qty-${nomeKey}`);
  const qtdChegando = input ? (parseFloat(input.value) || 0) : 0;
  if (qtdChegando <= 0) return toast('Informe quanto está chegando.', 'erro');
  const qtdAtual = estoqueCache[nomeKey]?.qtd || 0;
  const qtdNova  = qtdAtual + qtdChegando;
  try {
    await salvarItemEstoque(nomeKey, { nome, unidade, qtd: qtdNova });
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), nome, unidade, qtd: qtdNova, nomeKey };
    toast(`+${qtdChegando} ${unidade || 'un'} de "${nome}" — total agora: ${qtdNova} ${unidade || 'un'}`, 'sucesso');
    renderizarEntradaMercadoria();
  } catch (e) {
    console.error(e);
    toast('Erro ao registrar entrada. Tente novamente.', 'erro');
    return;
  }
  try {
    await registrarContagemHistorico({
      nomeKey, nome, unidade, qtd: qtdChegando,
      contadoPor: usuarioAtual?.nome || '—', tipo: 'entrada',
    });
  } catch (e) {
    console.error('Erro ao registrar histórico:', e);
    toast('Aviso: não foi possível salvar no histórico de contagem.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   REGISTRAR PRODUÇÃO — um lote só: baixa os insumos usados do estoque e
   soma o que foi produzido, na mesma ação. Tela própria, separada de
   Inventário e Entrada de Mercadoria — aqui o movimento é duplo (sai
   insumo, entra produzido), ao contrário das outras duas que são só um
   sentido.
══════════════════════════════════════════════════ */
let _prodConfigs = []; /* cache dos item_configs carregados */
let _prodInsumos = []; /* [{nomeKey, nome, unidade, qtd}] pendente de registrar, monta o lote antes de confirmar */

async function abrirRegistrarProducao() {
  historico.push('tela-colaborador');
  mostrarTela('tela-registrar-producao', 'Registrar Produção');
  _prodInsumos = [];
  renderizarProdInsumos();
  const nomeI = document.getElementById('prod-insumo-nome'); if (nomeI) nomeI.value = '';
  const qtdI  = document.getElementById('prod-insumo-qtd');  if (qtdI)  qtdI.value  = '';
  const nomeS = document.getElementById('prod-saida-nome');  if (nomeS) nomeS.value = '';
  const qtdS  = document.getElementById('prod-saida-qtd');   if (qtdS)  qtdS.value  = '';
  const fichaSel = document.getElementById('prod-ficha-select'); if (fichaSel) fichaSel.value = '';
  const fichaQtd = document.getElementById('prod-ficha-qtd');    if (fichaQtd) fichaQtd.value = '';
  const fichaUn  = document.getElementById('prod-ficha-un');     if (fichaUn)  fichaUn.textContent = '';
  const fichaHint= document.getElementById('prod-ficha-hint');   if (fichaHint) fichaHint.textContent = '';
  await recarregarRegistrarProducao();
}

async function recarregarRegistrarProducao() {
  try {
    const [configs, , fichas] = await Promise.all([
      Object.keys(itemConfigsCache).length ? Promise.resolve(Object.values(itemConfigsCache)) : listarItemConfigs(),
      garantirListenerEstoque(),
      fichasTecnicasCache.length ? Promise.resolve(fichasTecnicasCache) : listarFichasTecnicas(),
    ]);
    _prodConfigs = configs;
    fichasTecnicasCache = fichas;
    const dl1 = document.getElementById('prod-insumo-datalist');
    if (dl1) dl1.innerHTML = configs.map(c => `<option value="${_esc(c.nome)}">`).join('');
    const dl2 = document.getElementById('prod-saida-datalist');
    if (dl2) dl2.innerHTML = configs.map(c => `<option value="${_esc(c.nome)}">`).join('');
    const selFicha = document.getElementById('prod-ficha-select');
    if (selFicha) {
      selFicha.innerHTML = '<option value="">Selecione uma ficha...</option>' +
        fichas.map(f => `<option value="${f.id}">${_escHtml(f.nome)}</option>`).join('');
    }
  } catch (e) {
    console.error(e);
    toast('Erro ao carregar produtos.', 'erro');
  }
}

function prodFichaSelecionada(fichaId) {
  const ficha = fichasTecnicasCache.find(f => f.id === fichaId);
  const un    = document.getElementById('prod-ficha-un');
  const hint  = document.getElementById('prod-ficha-hint');
  if (un)   un.textContent   = ficha?.unidadeRendimento || '';
  if (hint) hint.textContent = ficha
    ? `Rendimento-base da ficha: ${ficha.rendimento} ${ficha.unidadeRendimento || ''} — ${(ficha.ingredientes || []).length} insumo(s)`
    : '';
}

function calcularInsumosDaFicha() {
  const fichaId = document.getElementById('prod-ficha-select')?.value;
  if (!fichaId) return toast('Selecione uma ficha técnica.', 'erro');
  const ficha = fichasTecnicasCache.find(f => f.id === fichaId);
  if (!ficha) return toast('Ficha não encontrada.', 'erro');
  const qtdDesejada = parseFloat(document.getElementById('prod-ficha-qtd')?.value) || 0;
  if (qtdDesejada <= 0) return toast('Informe quanto quer produzir.', 'erro');
  if (!ficha.rendimento) return toast('Essa ficha não tem rendimento-base cadastrado.', 'erro');

  const fator = qtdDesejada / ficha.rendimento;

  /* Recalcular substitui só os insumos que vieram de um cálculo anterior
     dessa mesma ficha — não duplica, e não mexe no que foi adicionado à
     mão além da ficha. */
  _prodInsumos = _prodInsumos.filter(i => !i.daFicha);
  (ficha.ingredientes || []).forEach(ing => {
    const qtdCalculada = Math.round(ing.qtd * fator * 1000) / 1000;
    const existente = _prodInsumos.find(i => i.nomeKey === ing.nomeKey);
    if (existente) {
      existente.qtd += qtdCalculada;
      existente.daFicha = true;
    } else {
      _prodInsumos.push({ nomeKey: ing.nomeKey, nome: ing.nome, unidade: ing.unidade, qtd: qtdCalculada, daFicha: true });
    }
  });
  renderizarProdInsumos();

  /* Preenche também "produzido agora" com o produto e a quantidade da ficha */
  const nomeSInput = document.getElementById('prod-saida-nome');
  const qtdSInput  = document.getElementById('prod-saida-qtd');
  if (nomeSInput) nomeSInput.value = ficha.nome;
  if (qtdSInput)  qtdSInput.value  = qtdDesejada;
  prodSaidaNomeInput(ficha.nome);

  toast(`Insumos calculados para ${qtdDesejada} ${ficha.unidadeRendimento || ''} de ${ficha.nome}.`, 'sucesso');
}

function prodInsumoNomeInput(val) {
  const cfg  = _prodConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(val));
  const unEl = document.getElementById('prod-insumo-un');
  if (unEl) unEl.textContent = cfg?.unidade || '';
}

function prodSaidaNomeInput(val) {
  const cfg  = _prodConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(val));
  const unEl = document.getElementById('prod-saida-un');
  if (unEl) unEl.textContent = cfg?.unidade || '';
}

function prodAdicionarInsumo() {
  const nomeInput = document.getElementById('prod-insumo-nome');
  const qtdInput  = document.getElementById('prod-insumo-qtd');
  const nome = (nomeInput?.value || '').trim();
  if (!nome) return toast('Informe o nome do insumo.', 'erro');
  const qtd = parseFloat(qtdInput?.value) || 0;
  if (qtd <= 0) return toast('Informe a quantidade usada.', 'erro');

  const cfg      = _prodConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(nome));
  const nomeKey  = cfg ? (cfg.nomeKey || normalizarNomeItem(cfg.nome)) : normalizarNomeItem(nome);
  const unidade  = cfg?.unidade || 'un';
  const nomeReal = cfg?.nome || nome;

  const existente = _prodInsumos.find(i => i.nomeKey === nomeKey);
  if (existente) existente.qtd += qtd;
  else _prodInsumos.push({ nomeKey, nome: nomeReal, unidade, qtd });

  if (nomeInput) nomeInput.value = '';
  if (qtdInput)  qtdInput.value  = '';
  const unEl = document.getElementById('prod-insumo-un');
  if (unEl) unEl.textContent = '';
  renderizarProdInsumos();
}

function prodRemoverInsumo(nomeKey) {
  _prodInsumos = _prodInsumos.filter(i => i.nomeKey !== nomeKey);
  renderizarProdInsumos();
}

function renderizarProdInsumos() {
  const el = document.getElementById('prod-insumos-lista');
  if (!el) return;
  if (!_prodInsumos.length) {
    el.innerHTML = '<p style="font-size:12px;color:var(--cinza-500);padding:6px 0">Nenhum insumo adicionado ainda.</p>';
    return;
  }
  el.innerHTML = _prodInsumos.map(i => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid #F3F4F6;border-radius:6px;margin-bottom:6px;font-size:13px">
      <span>${_escHtml(i.nome)} — <strong>${i.qtd}</strong> ${_escHtml(i.unidade)}
        ${i.daFicha ? '<span style="background:#EDE9FE;color:#6D28D9;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-left:6px">FICHA</span>' : ''}
      </span>
      <button class="btn-secundario btn-sm" onclick="prodRemoverInsumo('${_esc(i.nomeKey)}')" style="padding:2px 8px">Remover</button>
    </div>
  `).join('');
}

async function confirmarRegistrarProducao() {
  if (!_prodInsumos.length) return toast('Adicione pelo menos um insumo usado.', 'erro');

  const nomeSInput = document.getElementById('prod-saida-nome');
  const qtdSInput  = document.getElementById('prod-saida-qtd');
  const nomeSaida  = (nomeSInput?.value || '').trim();
  const qtdSaida   = parseFloat(qtdSInput?.value) || 0;
  if (!nomeSaida)    return toast('Informe o que foi produzido.', 'erro');
  if (qtdSaida <= 0) return toast('Informe a quantidade produzida.', 'erro');

  const cfgSaida      = _prodConfigs.find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(nomeSaida));
  const nomeKeySaida  = cfgSaida ? (cfgSaida.nomeKey || normalizarNomeItem(cfgSaida.nome)) : normalizarNomeItem(nomeSaida);
  const unidadeSaida  = cfgSaida?.unidade || 'un';
  const nomeSaidaReal = cfgSaida?.nome || nomeSaida;

  const btn = document.querySelector('#tela-registrar-producao .btn-primario');
  if (btn) { btn.disabled = true; btn.textContent = 'Registrando...'; }

  try {
    const avisosNegativo = [];

    /* Baixa cada insumo usado */
    for (const insumo of _prodInsumos) {
      const qtdAtual = estoqueCache[insumo.nomeKey]?.qtd || 0;
      const qtdNova  = qtdAtual - insumo.qtd;
      if (qtdNova < 0) avisosNegativo.push(insumo.nome);
      await salvarItemEstoque(insumo.nomeKey, { nome: insumo.nome, unidade: insumo.unidade, qtd: qtdNova });
      estoqueCache[insumo.nomeKey] = { ...(estoqueCache[insumo.nomeKey] || {}), nome: insumo.nome, unidade: insumo.unidade, qtd: qtdNova, nomeKey: insumo.nomeKey };
      await registrarContagemHistorico({
        nomeKey: insumo.nomeKey, nome: insumo.nome, unidade: insumo.unidade, qtd: insumo.qtd,
        contadoPor: usuarioAtual?.nome || '—', tipo: 'producao_baixa',
      });
    }

    /* Soma o que foi produzido */
    const qtdAtualSaida = estoqueCache[nomeKeySaida]?.qtd || 0;
    const qtdNovaSaida  = qtdAtualSaida + qtdSaida;
    await salvarItemEstoque(nomeKeySaida, { nome: nomeSaidaReal, unidade: unidadeSaida, qtd: qtdNovaSaida });
    estoqueCache[nomeKeySaida] = { ...(estoqueCache[nomeKeySaida] || {}), nome: nomeSaidaReal, unidade: unidadeSaida, qtd: qtdNovaSaida, nomeKey: nomeKeySaida };
    await registrarContagemHistorico({
      nomeKey: nomeKeySaida, nome: nomeSaidaReal, unidade: unidadeSaida, qtd: qtdSaida,
      contadoPor: usuarioAtual?.nome || '—', tipo: 'producao_entrada',
    });

    toast(
      avisosNegativo.length
        ? `Produção registrada! Atenção: ${avisosNegativo.join(', ')} ficou com estoque negativo — confira a contagem.`
        : `Produção registrada: ${nomeSaidaReal} +${qtdSaida} ${unidadeSaida}`,
      avisosNegativo.length ? 'erro' : 'sucesso'
    );

    _prodInsumos = [];
    renderizarProdInsumos();
    if (nomeSInput) nomeSInput.value = '';
    if (qtdSInput)  qtdSInput.value  = '';
    const unEl = document.getElementById('prod-saida-un');
    if (unEl) unEl.textContent = '';
  } catch (e) {
    console.error(e);
    toast('Erro ao registrar produção. Tente novamente.', 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Registrar produção'; }
  }
}

async function salvarInventarioQtd(nomeKey, nome, unidade) {
  const input = document.getElementById(`inv-qty-${nomeKey}`);
  /* Campo vem vazio (não pré-preenchido com o valor antigo, pra forçar a
     contagem real) — por isso, vazio não pode virar "0 salvo" sem querer. */
  if (!input || input.value.trim() === '') return toast('Informe a quantidade contada.', 'erro');
  const qtd   = parseFloat(input.value) || 0;
  const agora = new Date();
  try {
    await salvarItemEstoque(nomeKey, { nome, unidade, qtd, ultimaContagemEm: agora });
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), nome, unidade, qtd, nomeKey, ultimaContagemEm: agora };
    toast(`${nome}: ${qtd} ${unidade || 'un'}`, 'sucesso');
    renderizarInventario();
  } catch (e) {
    console.error(e);
    toast('Erro ao salvar. Tente novamente.', 'erro');
    return;
  }
  try {
    await registrarContagemHistorico({ nomeKey, nome, unidade, qtd, contadoPor: usuarioAtual?.nome || '—', tipo: 'contagem' });
  } catch (e) {
    console.error('Erro ao registrar histórico:', e);
    toast('Aviso: não foi possível salvar no histórico de contagem.', 'erro');
  }
}

/* Desfaz a última contagem de um item: volta o estoque pro valor da
   contagem anterior (não de entrada/produção, que guardam a diferença, não
   o total — só "contagem" guarda o total real em cada momento). Se não
   achar uma contagem anterior, avisa antes de zerar. A própria ação de
   desfazer vira uma nova contagem no histórico (não apaga a errada — fica
   registrado que existiu e foi corrigida, igual um estorno). */
async function desfazerContagemInventario(btn, nomeKey, nome, unidade) {
  if (btn) { btn.disabled = true; btn.textContent = 'Desfazendo...'; }
  try {
    const registros = await listarHistoricoContagem(500);
    const doItem = registros.filter(r => r.nomeKey === nomeKey && (r.tipo === 'contagem' || !r.tipo));
    const valorAnterior = doItem.length >= 2 ? doItem[1].qtd : 0;

    const msg = doItem.length >= 2
      ? `Desfazer a última contagem de "${nome}"? Volta de ${doItem[0]?.qtd ?? '—'} para ${valorAnterior} ${unidade || 'un'}.`
      : `Não encontrei uma contagem anterior de "${nome}" pra restaurar. Desfazer mesmo assim e zerar o estoque?`;
    if (!confirm(msg)) return;

    /* Desfazer não conta como uma contagem nova — o item precisa voltar
       pra "A Contar" pra ser recontado de verdade, não ficar parado em
       "Contados" com o número só corrigido. Por isso ultimaContagemEm
       recua pro passado em vez de virar "agora". */
    const passado = new Date(0);
    await salvarItemEstoque(nomeKey, { nome, unidade, qtd: valorAnterior, ultimaContagemEm: passado });
    estoqueCache[nomeKey] = { ...(estoqueCache[nomeKey] || {}), nome, unidade, qtd: valorAnterior, nomeKey, ultimaContagemEm: passado };
    await registrarContagemHistorico({ nomeKey, nome, unidade, qtd: valorAnterior, contadoPor: usuarioAtual?.nome || '—', tipo: 'contagem' });
    toast(`Contagem de "${nome}" desfeita — voltou pra ${valorAnterior} ${unidade || 'un'} e pra aba "A Contar".`, 'sucesso');
    renderizarInventario();
  } catch (e) {
    console.error(e);
    toast('Erro ao desfazer. Tente novamente.', 'erro');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '&#8617; Desfazer'; }
  }
}

/* ══════════════════════════════════════════════════
   HISTÓRICO DE CONTAGEM (CEO)
══════════════════════════════════════════════════ */

async function abrirHistoricoContagem() {
  /* Redireciona para a aba Histórico dentro do Controle de Estoque */
  await abrirEstoque('historico');
}

async function _abrirHistoricoContagemLegado() {
  historico.push('tela-historico-contagem');
  mostrarTela('tela-historico-contagem', 'Histórico de Contagem');
  document.getElementById('hist-cont-lista').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const registros = await listarHistoricoContagem(1500);
    renderizarHistoricoContagem(registros);
  } catch (e) {
    console.error('Histórico contagem:', e);
    document.getElementById('hist-cont-lista').innerHTML =
      '<div class="estado-vazio"><p>Erro ao carregar. Tente novamente.</p></div>';
  }
}

/* Tipos de lançamento no historico_contagem — cada ação de estoque grava um
   desses, usado tanto na tabela de Histórico quanto na legenda dela. */
const TIPO_HISTORICO = {
  contagem:         { label: 'Contagem',        cor: '#111827', sinal: ''  },
  entrada:          { label: 'Entrada',         cor: '#1D4ED8', sinal: '+' },
  producao_baixa:   { label: 'Baixa (produção)', cor: '#B91C1C', sinal: '-' },
  producao_entrada: { label: 'Produzido',       cor: '#6D28D9', sinal: '+' },
};

function renderizarHistoricoContagem(registros, containerId) {
  const el = document.getElementById(containerId || 'hist-cont-lista');
  if (!registros.length) {
    el.innerHTML = `<div class="estado-vazio">
      <p>Nenhuma contagem registrada ainda.</p>
      <p style="font-size:12px;color:var(--cinza-500);margin-top:8px">
        O histórico é gerado ao salvar uma quantidade no<br>
        <strong>Controle de Estoque</strong> (aba Sintético) ou no <strong>Inventário</strong> (separadores).
      </p>
    </div>`;
    return;
  }

  const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  /* Tabela: produto na vertical, data na horizontal, célula = quantidade
     registrada naquele dia. Se houver mais de um registro do mesmo produto
     no mesmo dia (ex: contou de manhã e de novo à tarde), fica o mais
     recente. Colunas mais recentes primeiro. */
  const porProdutoDia = {}; /* chave (nomeKey||nome) -> { nome, unidade, porDia: { diaKey -> registro } } */
  const diasTs = {};        /* diaKey -> timestamp do dia, só p/ ordenar as colunas */

  registros.forEach(r => {
    const d = r.contadoEm?.toDate ? r.contadoEm.toDate() : new Date(r.contadoEm);
    if (isNaN(d)) return;
    const diaKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    diasTs[diaKey] = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

    const chave = r.nomeKey || r.nome;
    if (!chave) return;
    if (!porProdutoDia[chave]) porProdutoDia[chave] = { nome: r.nome || r.nomeKey, unidade: r.unidade, porDia: {} };

    const existente = porProdutoDia[chave].porDia[diaKey];
    if (!existente) {
      porProdutoDia[chave].porDia[diaKey] = r;
    } else {
      const dExist = existente.contadoEm?.toDate ? existente.contadoEm.toDate() : new Date(existente.contadoEm);
      if (d.getTime() >= dExist.getTime()) porProdutoDia[chave].porDia[diaKey] = r;
    }
  });

  /* Sem isso, só aparece na tabela quem já teve pelo menos um registro de
     histórico (contagem/entrada/produção) — item cadastrado que nunca foi
     contado nem movimentado simplesmente sumia da lista. Completa com todo
     item do Cadastro que ainda não apareceu, mesmo que fique só com "—". */
  Object.values(itemConfigsCache).forEach(cfg => {
    if (!cfg.nomeKey || porProdutoDia[cfg.nomeKey]) return;
    porProdutoDia[cfg.nomeKey] = {
      nome:    cfg.nome,
      unidade: cfg.unidade || estoqueCache[cfg.nomeKey]?.unidade || 'un',
      porDia:  {},
    };
  });

  const dias = Object.keys(diasTs).sort((a, b) => diasTs[b] - diasTs[a]);
  const fmtDia = diaKey => {
    const [ano, mes, dia] = diaKey.split('-').map(Number);
    return `${String(dia).padStart(2, '0')}/${MESES[mes - 1]}`;
  };

  const produtos = Object.values(porProdutoDia).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const headerCols = dias.map(dia => `
    <th style="padding:8px 10px;text-align:center;font-size:11px;font-weight:700;color:var(--cinza-500);white-space:nowrap;border-bottom:2px solid #E5E7EB">${fmtDia(dia)}</th>
  `).join('');

  const linhas = produtos.map(p => {
    const cols = dias.map(dia => {
      const r = p.porDia[dia];
      if (!r) return `<td style="padding:8px 10px;text-align:center;color:#D1D5DB;border-bottom:1px solid #F3F4F6">—</td>`;
      const info = TIPO_HISTORICO[r.tipo] || TIPO_HISTORICO.contagem;
      const d = r.contadoEm?.toDate ? r.contadoEm.toDate() : new Date(r.contadoEm);
      const hora = !isNaN(d) ? `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '';
      return `
        <td style="padding:8px 10px;text-align:center;font-weight:700;white-space:nowrap;border-bottom:1px solid #F3F4F6;color:${info.cor}"
          title="${info.label} — ${_escHtml(r.contadoPor || '—')} às ${hora}">
          ${info.sinal}${r.qtd}
        </td>`;
    }).join('');
    return `
      <tr>
        <td style="padding:8px 10px;font-weight:600;font-size:13px;white-space:nowrap;border-bottom:1px solid #F3F4F6;position:sticky;left:0;background:#fff">
          ${_escHtml(p.nome)}<br><span style="font-weight:400;font-size:11px;color:var(--cinza-500)">${_escHtml(p.unidade || 'un')}</span>
        </td>
        ${cols}
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div style="font-size:11px;color:var(--cinza-500);margin-bottom:8px;display:flex;flex-wrap:wrap;gap:10px">
      ${Object.values(TIPO_HISTORICO).map(t => `<span><span style="color:${t.cor};font-weight:700">${t.sinal || '·'}</span> ${_escHtml(t.label)}</span>`).join('')}
      &nbsp;·&nbsp; toque num número pra ver quem registrou e a que horas
    </div>
    <div style="overflow-x:auto;border:1px solid #E5E7EB;border-radius:8px">
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead>
          <tr>
            <th style="padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:var(--cinza-500);white-space:nowrap;border-bottom:2px solid #E5E7EB;position:sticky;left:0;background:#fff">Produto</th>
            ${headerCols}
          </tr>
        </thead>
        <tbody>
          ${linhas}
        </tbody>
      </table>
    </div>
  `;
}

async function abrirEstoque(abaInicial) {
  historico.push('tela-estoque');
  mostrarTela('tela-estoque', 'Controle de Estoque');
  const desc = document.getElementById('estoque-desc');
  if (desc) desc.textContent = souCeo()
    ? 'Edite as quantidades em estoque. O sistema calcula automaticamente o saldo em relação às festas ativas.'
    : 'Consulte as quantidades em estoque. O sistema calcula automaticamente o saldo em relação às festas ativas.';
  /* "Estoque R$" mostra custo de reposição (dado financeiro) — só CEO,
     mesmo padrão de "podeEditar = souCeo()" já usado nesta tela. */
  const btnValor = document.getElementById('estoque-tab-valor');
  if (btnValor) btnValor.classList.toggle('hidden', !souCeo());

  abaEstoqueAtual = abaInicial || 'sintetico';
  if (abaEstoqueAtual === 'valor' && !souCeo()) abaEstoqueAtual = 'sintetico';
  const tabIndex  = { sintetico: 0, analitico: 1, valor: 2, historico: 3 }[abaEstoqueAtual] ?? 0;
  document.querySelectorAll('#estoque-tabs .tab').forEach((b, i) => {
    b.classList.toggle('ativo', i === tabIndex);
  });
  if (abaEstoqueAtual === 'historico') {
    const btn = document.querySelector('#estoque-tabs .tab[data-aba="historico"]');
    trocarAbaEstoque('historico', btn);
  } else if (abaEstoqueAtual === 'valor') {
    const btn = document.querySelector('#estoque-tabs .tab[data-aba="valor"]');
    await recarregarEstoque();
    trocarAbaEstoque('valor', btn);
  } else {
    await recarregarEstoque();
  }
}

async function recarregarEstoque() {
  document.getElementById('estoque-conteudo').innerHTML =
    '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const [, festas] = await Promise.all([
      garantirListenerEstoque(),
      todasFestasCache.length ? Promise.resolve(todasFestasCache) : buscarTodasFestas(),
    ]);
    todasFestasCache = festas;
    const cats = categoriasCache.length ? categoriasCache : await listarCategorias();
    if (!categoriasCache.length) categoriasCache = cats;
    const selCat = document.getElementById('estoque-filtro-cat');
    if (selCat) {
      selCat.innerHTML = '<option value="">Todas as categorias</option>';
      cats.filter(c => c.exibirEstoque !== false).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.nome;
        opt.textContent = c.nome;
        if (c.nome === _estoqueFiltroCategoria) opt.selected = true;
        selCat.appendChild(opt);
      });
    }
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

  const elConteudo  = document.getElementById('estoque-conteudo');
  const elHistorico = document.getElementById('estoque-historico');

  if (aba === 'historico') {
    if (elConteudo)  elConteudo.classList.add('hidden');
    if (elHistorico) {
      elHistorico.classList.remove('hidden');
      elHistorico.innerHTML = '<div class="estado-vazio"><p>Carregando...</p></div>';
      listarHistoricoContagem(1500).then(registros => {
        renderizarHistoricoContagem(registros, 'estoque-historico');
      }).catch(e => {
        console.error(e);
        elHistorico.innerHTML = estadoVazio('Erro ao carregar histórico.');
      });
    }
  } else if (aba === 'valor') {
    if (elConteudo)  elConteudo.classList.remove('hidden');
    if (elHistorico) elHistorico.classList.add('hidden');
    renderizarEstoque(todasFestasCache, estoqueCache); /* mostra na hora, mesmo sem preço ainda */
    carregarPrecosGestao().then(() => {
      if (abaEstoqueAtual === 'valor') renderizarEstoque(todasFestasCache, estoqueCache);
    });
  } else {
    if (elConteudo)  elConteudo.classList.remove('hidden');
    if (elHistorico) elHistorico.classList.add('hidden');
    renderizarEstoque(todasFestasCache, estoqueCache);
  }
}

function filtrarEstoque(valor) {
  _buscaEstoque = valor;
  renderizarEstoque(todasFestasCache, estoqueCache);
}

function filtrarEstoqueCat(val) {
  _estoqueFiltroCategoria = val;
  renderizarEstoque(todasFestasCache, estoqueCache);
}

function renderizarEstoque(festas, estoqueMap) {
  /* "Necessário" só conta festa que ainda não foi separada de fato
     (agendada ou separando). A partir de conferência em diante, os itens
     já foram fisicamente pegos do estoque durante a separação — contar
     de novo aqui infla o "necessário" com pedidos que já saíram. */
  const festasRelevantes = festas.filter(f => f.status === 'agendada' || f.status === 'separando');
  const todos = agregarItensFestas(festasRelevantes);

  /* Itens do Cadastro sem nenhuma festa ativa pedindo também entram na tela,
     com Necessário 0 — só pra dar pra registrar/consultar o estoque deles;
     não entram no cálculo de falta/sobra (ver htmlEstoqueSintetico/Analitico). */
  const chavesComFesta = new Set(todos.map(it => it.nomeKey));
  Object.values(itemConfigsCache).forEach(cfg => {
    if (!cfg.nomeKey || chavesComFesta.has(cfg.nomeKey)) return;
    todos.push({
      nomeKey: cfg.nomeKey,
      nome:    cfg.nome,
      unidade: estoqueMap[cfg.nomeKey]?.unidade || 'un',
      total:   0,
      festas:  [],
    });
  });
  todos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const busca = _buscaEstoque.toLowerCase().trim();
  let itens = todos.filter(it => {
    const cfg = buscarConfigItem(it.nomeKey);
    const cat = cfg?.grupo ? categoriasCache.find(c => c.nome === cfg.grupo) : null;
    if (cat && cat.exibirEstoque === false) return false;
    return true;
  });
  if (_estoqueFiltroCategoria) {
    itens = itens.filter(it => {
      const cfg = buscarConfigItem(it.nomeKey);
      return cfg?.grupo === _estoqueFiltroCategoria;
    });
  }
  if (busca) itens = itens.filter(it => (it.nome || '').toLowerCase().includes(busca));
  if (!itens.length) {
    document.getElementById('estoque-conteudo').innerHTML =
      estadoVazio('Nenhum item encontrado.');
    return;
  }

  /* Agrupar por categoria, em ordem alfabética */
  const grupos = {};
  itens.forEach(it => {
    const cfg = buscarConfigItem(it.nomeKey);
    const g   = cfg?.grupo || 'Sem Categoria';
    if (!grupos[g]) grupos[g] = [];
    grupos[g].push(it);
  });

  const renderCard = it => {
    if (abaEstoqueAtual === 'analitico') return htmlEstoqueAnalitico(it, estoqueMap[it.nomeKey]);
    if (abaEstoqueAtual === 'valor')     return htmlEstoqueValor(it, estoqueMap[it.nomeKey]);
    return htmlEstoqueSintetico(it, estoqueMap[it.nomeKey]);
  };

  let resumoValorHTML = '';
  if (abaEstoqueAtual === 'valor') {
    let totalGeral = 0, semPreco = 0;
    itens.forEach(it => {
      const preco = precoInsumoPorNomeKey(it.nomeKey);
      if (preco == null) { semPreco++; return; }
      totalGeral += preco * (estoqueMap[it.nomeKey]?.qtd || 0);
    });
    resumoValorHTML = `
      <div class="estoque-item-card" style="background:#F9FAFB">
        <div class="estoque-item-header">
          <div class="estoque-item-nome">Valor total em estoque</div>
          <div class="estoque-item-total"><strong style="font-size:16px">${_fmtReais(totalGeral)}</strong></div>
        </div>
        ${semPreco ? `<p style="font-size:12px;color:var(--cinza-500);margin:4px 0 0">${semPreco} item(ns) sem preço vinculado no Cadastro de Insumos — não entram no total.</p>` : ''}
        ${_insumosGestaoIndisponivel ? `<p style="font-size:12px;color:#B45309;margin:4px 0 0">Não foi possível carregar os preços do controle-gestao-main agora. Valores podem estar desatualizados.</p>` : ''}
      </div>
    `;
  }

  document.getElementById('estoque-conteudo').innerHTML = resumoValorHTML + Object.keys(grupos)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .map(g => `
      <div class="grupo-titulo" style="margin-top:16px;margin-bottom:4px;font-size:12px;font-weight:700;text-transform:uppercase;color:var(--cinza-500);letter-spacing:.5px">${_escHtml(g)}</div>
      ${grupos[g].map(renderCard).join('')}
    `).join('');
}

function htmlEstoqueValor(item, est) {
  const qtdEst = est?.qtd || 0;
  const preco  = precoInsumoPorNomeKey(item.nomeKey);
  const valor  = preco != null ? preco * qtdEst : null;
  return `
    <div class="estoque-item-card">
      <div class="estoque-item-header">
        <div class="estoque-item-nome">${_escHtml(item.nome)}</div>
        <div class="estoque-item-total">${valor != null
          ? `<strong>${_fmtReais(valor)}</strong>`
          : '<span style="color:var(--cinza-500)">Sem preço vinculado</span>'}</div>
      </div>
      <div class="estoque-body-row">
        <span class="estoque-body-label">Em estoque:</span>
        <div class="estoque-qty-wrap">
          <strong>${qtdEst}</strong>&nbsp;<span class="estoque-qty-un">${_escHtml(item.unidade)}</span>
        </div>
        ${preco != null ? `<span style="color:var(--cinza-500);font-size:12px;margin-left:8px">&times; ${_fmtReais(preco)}/${_escHtml(item.unidade)}</span>` : ''}
      </div>
    </div>
  `;
}

function _esc(s) {
  return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
}

function _escHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Resolve um item do cadastro (item_config) a partir do nome digitado num input com datalist */
function _resolverItemCatalogoPorNome(nomeDigitado) {
  const alvo = normalizarNomeItem(nomeDigitado);
  if (!alvo) return null;
  return Object.values(itemConfigsCache).find(c => normalizarNomeItem(c.nome) === alvo) || null;
}

function htmlEstoqueSintetico(item, est) {
  const qtdEst     = est?.qtd || 0;
  const semDemanda = !item.festas.length;
  const diff       = qtdEst - item.total;
  const pct        = item.total > 0 ? Math.min(100, Math.round((qtdEst / item.total) * 100)) : 100;
  const podeEditar = souCeo(); /* separador só visualiza — não edita quantidade nem pede compra */

  return `
    <div class="estoque-item-card">
      <div class="estoque-item-header">
        <div class="estoque-item-nome">${_escHtml(item.nome)}</div>
        <div class="estoque-item-total">${semDemanda
          ? '<span style="color:var(--cinza-500)">Sem festa ativa</span>'
          : `Necessário: <strong>${item.total}</strong> ${_escHtml(item.unidade)}`}</div>
      </div>
      <div class="estoque-body-row">
        <span class="estoque-body-label">Em estoque:</span>
        ${podeEditar ? `
        <div class="estoque-qty-wrap">
          <input type="number" class="estoque-qty-input"
            id="estoque-qty-${item.nomeKey}"
            value="${qtdEst}" min="0"
            onchange="salvarEstoqueQtd('${_esc(item.nomeKey)}','${_esc(item.nome)}','${_esc(item.unidade)}',this.value)"
          />
          <span class="estoque-qty-un">${_escHtml(item.unidade)}</span>
        </div>
        <button class="btn-comprar"
          onclick="comprarItemEstoque('${_esc(item.nomeKey)}','${_esc(item.nome)}','${_esc(item.unidade)}')">
          + Comprar
        </button>` : `
        <div class="estoque-qty-wrap">
          <strong>${qtdEst}</strong>&nbsp;<span class="estoque-qty-un">${_escHtml(item.unidade)}</span>
        </div>`}
      </div>
      ${semDemanda ? '' : `
      <div class="estoque-progress-track">
        <div class="estoque-progress-bar ${diff < 0 ? 'deficit' : 'ok'}" style="width:${pct}%"></div>
      </div>
      <div class="estoque-diff ${diff < 0 ? 'deficit-text' : 'ok-text'}">
        ${diff < 0
          ? `Falta <strong>${Math.abs(diff)}</strong> ${_escHtml(item.unidade)} (${pct}% coberto)`
          : `Estoque suficiente — sobra <strong>${diff}</strong> ${_escHtml(item.unidade)}`}
      </div>`}
    </div>
  `;
}

function htmlEstoqueAnalitico(item, est) {
  const qtdEst     = est?.qtd || 0;
  const semDemanda = !item.festas.length;
  const diff       = qtdEst - item.total;
  const podeEditar = souCeo(); /* separador só visualiza — não edita quantidade nem pede compra */

  const MESES_ABR = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

  const festasHTML = semDemanda
    ? '<p style="font-size:12px;color:var(--cinza-500);padding:4px 0">Nenhuma festa ativa pede este item.</p>'
    : item.festas.map(f => {
    let dataTxt = '';
    if (f.festaData) {
      const d = toDate(f.festaData);
      if (!isNaN(d)) dataTxt = ` — ${String(d.getDate()).padStart(2,'0')} ${MESES_ABR[d.getMonth()]}`;
    }
    return `
      <div class="analitico-festa-row">
        <div class="analitico-festa-nome">
          ${_escHtml(f.festaNome)}${dataTxt}
          <span class="badge badge-${f.festaStatus}" style="font-size:9px;margin-left:4px">
            ${_escHtml(STATUS_LABELS[f.festaStatus] || f.festaStatus)}
          </span>
        </div>
        <div class="analitico-festa-qty">
          ${podeEditar ? `
          <input type="number" class="estoque-qty-input-sm"
            value="${f.qtd}" min="0"
            onchange="editarQtdFestaEstoque('${_esc(f.festaId)}',${f.itemIdx},this.value)"
          />
          <span class="estoque-qty-un">${_escHtml(item.unidade)}</span>` : `
          <strong>${f.qtd}</strong>&nbsp;<span class="estoque-qty-un">${_escHtml(item.unidade)}</span>`}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="estoque-item-card">
      <div class="estoque-item-header">
        <div class="estoque-item-nome">${_escHtml(item.nome)}</div>
        <div class="estoque-item-total">
          ${semDemanda
            ? `<span style="color:var(--cinza-500)">Sem festa ativa</span> &nbsp;|&nbsp; Estoque: <strong>${qtdEst}</strong> ${_escHtml(item.unidade)}`
            : `Total: <strong>${item.total}</strong> ${_escHtml(item.unidade)} &nbsp;|&nbsp;
               Estoque: <strong>${qtdEst}</strong> ${_escHtml(item.unidade)}
               <span class="${diff < 0 ? 'deficit-text' : 'ok-text'}" style="font-weight:700">
                 &nbsp;(${diff < 0 ? 'falta ' + Math.abs(diff) : 'sobra ' + diff})
               </span>`}
        </div>
      </div>
      <div class="analitico-festas-lista">${festasHTML}</div>
      ${podeEditar ? `
      <div class="analitico-item-footer">
        <button class="btn-comprar"
          onclick="comprarItemEstoque('${_esc(item.nomeKey)}','${_esc(item.nome)}','${_esc(item.unidade)}')">
          + Comprar
        </button>
      </div>` : ''}
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
    return;
  }
  try {
    await registrarContagemHistorico({ nomeKey, nome, unidade, qtd, contadoPor: usuarioAtual?.nome || '—' });
  } catch (e) {
    console.error('Erro ao registrar histórico:', e);
    toast('Aviso: não foi possível salvar no histórico de contagem.', 'erro');
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
   SINCRONIZAÇÃO DE FESTAS A PARTIR DE CONTRATOS
   (controle-gestao-main) — cross-project, só leitura de
   contratos; grava festas normalmente aqui (projeto local).
══════════════════════════════════════════════════ */

/* Cria uma festa (sem itens — a lista é anexada depois, manualmente ou via
   "Importar itens (PDF)" na tela de editar festa) para cada contrato futuro
   do controle-gestao-main que ainda não tem festa correspondente aqui.
   Também traz tipo de evento e nº de convidados do contrato (c.tipo →
   tipoEvento, c.convidados → convidados) — a mesma informação que aparece
   depois na tabela Analítico de Compras & Lista.
   Nunca atualiza uma festa já existente (mesmo que o contrato mude depois),
   e nunca roda em cima de contrato cancelado. Silencioso: se o outro
   projeto estiver indisponível, não interrompe o carregamento da tela.
   carregarCEO() chama esta função a cada navegação (login, voltar pra
   lista, criar/editar/excluir festa); sem a trava abaixo, duas chamadas
   disparadas em sequência rápida liam "festas existentes" antes de
   qualquer uma delas gravar, e cada uma criava sua própria festa pro
   mesmo contrato — daí cards duplicados. */
let _syncContratosEmAndamento = false;
async function sincronizarFestasDeContratos() {
  if (_syncContratosEmAndamento) return;
  _syncContratosEmAndamento = true;
  try {
    const contratos = await buscarContratosGestao();
    console.log('[syncContratos] contratos lidos do gestao:', contratos === null ? 'INDISPONÍVEL (null — projeto secundário não respondeu)' : contratos.length);
    if (!contratos || !contratos.length) return;

    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const futuros = contratos.filter(c => {
      if (!c.data || c.status === 'cancelado') return false;
      const d = new Date(c.data + 'T12:00:00');
      return !isNaN(d) && d >= hoje;
    });
    console.log('[syncContratos] futuros e não cancelados:', futuros.length, futuros.map(c => ({ id: c.id, nome: c.nomeEvento || c.nome, data: c.data, status: c.status })));
    if (!futuros.length) return;

    const festasExistentes = await buscarTodasFestas();
    console.log('[syncContratos] festas já existentes aqui:', festasExistentes.length);

    let criadas = 0;
    for (const c of futuros) {
      const jaExiste = _festaJaExisteParaContrato(c, festasExistentes);
      console.log('[syncContratos] contrato', c.id, '"' + (c.nomeEvento || c.nome) + '"', c.data, jaExiste ? '→ já tem festa, pulando' : '→ vai criar festa nova');
      if (jaExiste) continue;
      const nomeEvento    = c.nomeEvento || c.nome || 'Evento';
      const convidadosNum = parseInt(c.convidados, 10);
      await salvarFesta({
        nome:             nomeEvento,
        cliente:          c.nome || '',
        data:             new Date(c.data + 'T12:00:00'),
        hora:             c.hrInicio || c.hrIni || '',
        local:            c.local || '',
        tipoEvento:       c.tipo || '',
        convidados:       isNaN(convidadosNum) ? null : convidadosNum,
        itens:            [],
        criadoPor:        'Sincronização automática (Contratos)',
        contratoOrigemId: c.id,
        origemAuto:       true,
      });
      /* evita duplicar dentro do mesmo laço, antes do próximo .get() */
      festasExistentes.push({ nome: nomeEvento, data: c.data, contratoOrigemId: c.id });
      criadas++;
    }

    if (criadas > 0) {
      toast(`${criadas} festa${criadas > 1 ? 's' : ''} criada${criadas > 1 ? 's' : ''} automaticamente a partir de Contratos.`, 'sucesso');
    }
  } catch (e) {
    console.error('Erro ao sincronizar festas de contratos:', e);
  } finally {
    _syncContratosEmAndamento = false;
  }
}

/* Considera "já existe" por vínculo explícito (contratoOrigemId) OU por
   nome+data batendo com uma festa já cadastrada manualmente antes desta
   sincronização existir — evita duplicar histórico antigo. */
function _festaJaExisteParaContrato(contrato, festasExistentes) {
  if (festasExistentes.some(f => f.contratoOrigemId === contrato.id)) return true;
  const chaveContrato = _chaveMatchEvento(contrato.nomeEvento || contrato.nome, contrato.data);
  return festasExistentes.some(f => _chaveMatchEvento(f.nome, f.data) === chaveContrato);
}

/* ══════════════════════════════════════════════════
   TEMPORÁRIO — Limpeza pontual das festas que foram sincronizadas
   de Contratos antes de tipoEvento/convidados existirem. Exclui só
   festas "Agendada" a partir de uma data e ressincroniza, pra vir
   tudo certo do sincronizarFestasDeContratos() de novo.
   Remover esta seção + o botão "🧹 Limpar Futuras" e o modal
   #modal-limpeza-festas do index.html depois de usada uma vez.
══════════════════════════════════════════════════ */

let _limpezaFestasAlvo = [];

function abrirLimpezaFestasFuturas() {
  const amanha = new Date(); amanha.setDate(amanha.getDate() + 1);
  document.getElementById('limp-data-corte').value =
    `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, '0')}-${String(amanha.getDate()).padStart(2, '0')}`;
  _limpezaFestasAlvo = [];
  document.getElementById('limp-resultado').innerHTML = '';
  document.getElementById('limp-btn-excluir').disabled = true;
  document.getElementById('modal-limpeza-festas').classList.remove('hidden');
  _limpezaBuscar();
}

function fecharModalLimpezaFestas() {
  document.getElementById('modal-limpeza-festas').classList.add('hidden');
}

function _limpezaBuscar() {
  const corteStr = document.getElementById('limp-data-corte').value;
  const elResult = document.getElementById('limp-resultado');
  const btn      = document.getElementById('limp-btn-excluir');

  if (!corteStr) { elResult.innerHTML = ''; btn.disabled = true; _limpezaFestasAlvo = []; return; }

  const corte = new Date(corteStr + 'T00:00:00');
  _limpezaFestasAlvo = todasFestasCache
    .filter(f => {
      if (f.status !== 'agendada') return false;
      const d = toDate(f.data);
      return !isNaN(d) && d >= corte;
    })
    .sort((a, b) => toDate(a.data) - toDate(b.data));

  if (!_limpezaFestasAlvo.length) {
    elResult.innerHTML = '<p style="color:var(--cinza-500)">Nenhuma festa Agendada encontrada a partir dessa data.</p>';
    btn.disabled = true;
    return;
  }

  const n = _limpezaFestasAlvo.length;
  elResult.innerHTML = `
    <p style="font-weight:700;margin-bottom:6px">${n} festa${n > 1 ? 's' : ''} ser${n > 1 ? 'ão' : 'á'} exclu${n > 1 ? 'ídas' : 'ída'}:</p>
    <ul style="max-height:220px;overflow-y:auto;padding-left:18px;margin:0">
      ${_limpezaFestasAlvo.map(f => `<li>${_escHtml(f.nome)} — ${formatarData(f.data)}${f.origemAuto ? ' (via Contrato)' : ''}</li>`).join('')}
    </ul>
  `;
  btn.disabled = false;
}

async function _limpezaExecutar() {
  if (!_limpezaFestasAlvo.length) return;
  const n = _limpezaFestasAlvo.length;
  if (!confirm(`Excluir ${n} festa${n > 1 ? 's' : ''} Agendada${n > 1 ? 's' : ''} e ressincronizar com Contratos?\n\nEsta ação não pode ser desfeita.`)) return;

  const btn = document.getElementById('limp-btn-excluir');
  btn.disabled = true;
  btn.textContent = 'Excluindo...';

  try {
    for (const f of _limpezaFestasAlvo) {
      await deletarFesta(f.id);
    }
    toast(`${n} festa${n > 1 ? 's' : ''} excluída${n > 1 ? 's' : ''}. Ressincronizando...`, 'sucesso');
    _limpezaFestasAlvo = [];
    await sincronizarFestasDeContratos();
    fecharModalLimpezaFestas();
  } catch (e) {
    console.error('Erro na limpeza de festas:', e);
    toast('Erro ao excluir: ' + (e?.message || 'erro desconhecido'), 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Excluir e Ressincronizar';
  }
}

/* Carrega elenco/escalação do controle-gestao-main pra mostrar um resumo
   de equipe nos cards de festa (lista/agenda), sem precisar abrir a aba
   Equipe separada. Mesmas caches que a aba Equipe usa. */
async function carregarCachesEquipeParaCards() {
  try {
    const [roster, escalas] = await Promise.all([buscarEquipeGestao(), buscarEscalasGestao()]);
    _equipeRosterCache  = roster;
    _equipeEscalasCache = escalas;
    if (!document.getElementById('tela-lista-festas')?.classList.contains('hidden')) atualizarVisaoCEO();
  } catch (e) {
    console.error('Erro ao carregar equipe para os cards:', e);
  }
}

/* ══════════════════════════════════════════════════
   EQUIPE — escalação lida ao vivo do controle-gestao-main
   (dbGestao é read-only: nada aqui deve gravar no projeto
   secundário, só no campo equipeVinculoManual da própria festa)
══════════════════════════════════════════════════ */

async function abrirEquipe() {
  historico.push('tela-equipe');
  mostrarTela('tela-equipe', 'Equipe');
  _buscaEquipe = '';
  const inputBusca = document.querySelector('#tela-equipe .barra-busca');
  if (inputBusca) inputBusca.value = '';
  await carregarEquipe();
}

async function carregarEquipe() {
  const [festas, roster, escalas, contratos] = await Promise.all([
    buscarTodasFestas(),
    buscarEquipeGestao(),
    buscarEscalasGestao(),
    buscarContratosGestao(),
  ]);
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  _equipeFestasCache = festas.filter(f => {
    if (f.status === 'concluida') return false;
    const fd = toDate(f.data); fd.setHours(0, 0, 0, 0);
    return fd >= hoje;
  });
  _equipeRosterCache    = roster;
  _equipeEscalasCache   = escalas;
  _equipeContratosCache = contratos;

  const indisponivel = roster === null || escalas === null;
  const elAviso = document.getElementById('equipe-status-gestao');
  if (elAviso) elAviso.classList.toggle('hidden', !indisponivel);

  renderizarEquipe();
}

function filtrarEquipe(valor) {
  _buscaEquipe = (valor || '').toLowerCase().trim();
  renderizarEquipe();
}

function renderizarEquipe() {
  const el = document.getElementById('equipe-lista');
  if (!el) return;
  const termo = _buscaEquipe;
  const lista = _equipeFestasCache
    .filter(f => !termo || f.nome.toLowerCase().includes(termo) || (f.cliente || '').toLowerCase().includes(termo))
    .sort((a, b) => toDate(a.data) - toDate(b.data));

  el.innerHTML = lista.length
    ? lista.map(f => htmlCardEquipeFesta(f)).join('')
    : estadoVazio('Nenhuma festa ativa encontrada.');
}

/* Chave normalizada nome+data — os dois sistemas não compartilham ID,
   então festa (aqui) e escalação/contrato (controle-gestao) só podem
   ser casados por nome+data digitados independentemente em cada um. */
function _chaveMatchEvento(nome, data) {
  const d = data ? toDate(data) : null;
  return normalizarNomeItem(nome) + '|' + (d && !isNaN(d) ? d.toISOString().slice(0, 10) : '');
}

function _matchEscalasParaFesta(festa) {
  if (!_equipeEscalasCache) return null; /* controle-gestao indisponível */
  const vinculo = festa.equipeVinculoManual;
  if (vinculo) {
    return _equipeEscalasCache.filter(e =>
      vinculo.contratoId ? e.contratoId === vinculo.contratoId
                          : _chaveMatchEvento(e.nomeEvento, e.dataEvento) === vinculo.chave
    );
  }
  const chaveFesta = _chaveMatchEvento(festa.nome, festa.data);
  return _equipeEscalasCache.filter(e => _chaveMatchEvento(e.nomeEvento, e.dataEvento) === chaveFesta);
}

/* Resumo curto de equipe pro card da lista de festas (ex: "2 Bartender, 1 Head
   Bartender") — reaproveita o mesmo match da aba Equipe. String vazia quando
   não há vínculo ou a leitura cross-project ainda não carregou. */
function _resumoEquipeFesta(festa) {
  const escalas = _matchEscalasParaFesta(festa);
  if (!escalas || !escalas.length) return '';
  const roster  = _equipeRosterCache || [];
  const porCargo = {};
  escalas.forEach(e => {
    const pessoa = roster.find(p => p.id === e.colaboradorId);
    const cargo  = e.cargo || pessoa?.cargo || 'Equipe';
    porCargo[cargo] = (porCargo[cargo] || 0) + 1;
  });
  return Object.entries(porCargo).map(([cargo, n]) => `${n} ${cargo}`).join(', ');
}

function htmlCardEquipeFesta(festa) {
  const escalas = _matchEscalasParaFesta(festa);
  const roster  = _equipeRosterCache || [];

  const MESES_ABR = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  let diaNum = '—', mesTxt = '';
  const d = festa.data ? toDate(festa.data) : null;
  if (d && !isNaN(d)) { diaNum = String(d.getDate()).padStart(2, '0'); mesTxt = MESES_ABR[d.getMonth()]; }

  let corpoEquipe;
  if (escalas === null) {
    corpoEquipe = `<div class="equipe-card-vazio">Equipe indisponível no momento.</div>`;
  } else if (!escalas.length) {
    corpoEquipe = `
      <div class="equipe-card-vazio">Nenhum vínculo encontrado com o controle-gestao.</div>
      <button class="btn-secundario btn-sm" onclick="abrirVinculoManualEquipe('${_esc(festa.id)}')">Vincular evento</button>
    `;
  } else {
    corpoEquipe = `
      <div class="equipe-card-lista">
        ${escalas.map(e => {
          const pessoa = roster.find(p => p.id === e.colaboradorId);
          return `<div class="equipe-card-pessoa">
            <span class="equipe-card-nome">${_esc(pessoa?.nome || '—')}</span>
            <span class="equipe-card-cargo">${_esc(e.cargo || pessoa?.cargo || '')}</span>
          </div>`;
        }).join('')}
      </div>
      ${festa.equipeVinculoManual ? `<button class="btn-secundario btn-sm" onclick="desvincularEquipeFesta('${_esc(festa.id)}')">Desvincular / procurar de novo</button>` : ''}
    `;
  }

  return `
    <div class="card-festa card-equipe">
      <div class="card-festa-body">
        <div class="card-data-col">
          <div class="card-data-num">${diaNum}</div>
          <div class="card-data-mes">${mesTxt}</div>
        </div>
        <div class="card-corpo">
          <div class="card-festa-topo">
            <div class="card-festa-nome">${festa.nome}</div>
          </div>
          <div class="card-festa-meta">${festa.cliente || ''}</div>
          ${_infoEventoTexto(festa) ? `<div class="card-festa-meta">${_infoEventoTexto(festa)}</div>` : ''}
          ${corpoEquipe}
        </div>
      </div>
    </div>
  `;
}

/* ── Vínculo manual (fallback para quando nome/data não batem automaticamente) ── */

function _candidatosEventoGestao(dataFesta) {
  const alvo = toDate(dataFesta).getTime();
  const JANELA_MS = 3 * 24 * 60 * 60 * 1000;

  if (_equipeContratosCache && _equipeContratosCache.length) {
    return _equipeContratosCache
      .filter(c => c.data && Math.abs(toDate(c.data).getTime() - alvo) <= JANELA_MS)
      .map(c => ({ contratoId: c.id, nomeEvento: c.nomeEvento || c.nome, dataEvento: c.data }));
  }
  /* Sem contratos disponíveis: monta candidatos a partir dos eventos distintos já presentes nas escalas */
  const vistos = new Map();
  (_equipeEscalasCache || []).forEach(e => {
    if (!e.dataEvento || Math.abs(toDate(e.dataEvento).getTime() - alvo) > JANELA_MS) return;
    const chave = e.contratoId || _chaveMatchEvento(e.nomeEvento, e.dataEvento);
    if (!vistos.has(chave)) vistos.set(chave, { contratoId: e.contratoId, nomeEvento: e.nomeEvento, dataEvento: e.dataEvento });
  });
  return [...vistos.values()];
}

function abrirVinculoManualEquipe(festaId) {
  const festa = _equipeFestasCache.find(f => f.id === festaId);
  if (!festa) return;
  _vinculoEquipeFestaId = festaId;

  const candidatos = _candidatosEventoGestao(festa.data);
  const select = document.getElementById('modal-vinculo-select');
  select.innerHTML = candidatos.length
    ? candidatos.map((c, i) => `<option value="${i}">${_esc(c.nomeEvento)} — ${formatarData(c.dataEvento)}</option>`).join('')
    : '<option value="">Nenhum evento próximo encontrado</option>';
  select.dataset.candidatos = JSON.stringify(candidatos);

  document.getElementById('modal-vinculo-info').textContent = `${festa.nome} — ${formatarData(festa.data)}`;
  document.getElementById('modal-vinculo-equipe').classList.remove('hidden');
}

function fecharModalVinculoEquipe() {
  document.getElementById('modal-vinculo-equipe').classList.add('hidden');
  _vinculoEquipeFestaId = null;
}

async function confirmarVinculoEquipe() {
  const select = document.getElementById('modal-vinculo-select');
  const idx = select?.value;
  if (idx === '' || idx == null) return toast('Selecione um evento.', 'erro');
  const candidatos = JSON.parse(select.dataset.candidatos || '[]');
  const escolhido  = candidatos[parseInt(idx)];
  if (!escolhido || !_vinculoEquipeFestaId) return;

  const vinculo = {
    contratoId:   escolhido.contratoId || null,
    chave:        escolhido.contratoId ? null : _chaveMatchEvento(escolhido.nomeEvento, escolhido.dataEvento),
    vinculadoEm:  new Date().toISOString(),
    vinculadoPor: usuarioAtual?.nome || '',
  };

  try {
    await atualizarFesta(_vinculoEquipeFestaId, { equipeVinculoManual: vinculo });
    const festa = _equipeFestasCache.find(f => f.id === _vinculoEquipeFestaId);
    if (festa) festa.equipeVinculoManual = vinculo;
    fecharModalVinculoEquipe();
    renderizarEquipe();
    toast('Evento vinculado.', 'sucesso');
  } catch (e) {
    console.error(e);
    toast('Erro ao vincular evento.', 'erro');
  }
}

async function desvincularEquipeFesta(festaId) {
  try {
    await atualizarFesta(festaId, { equipeVinculoManual: firebase.firestore.FieldValue.delete() });
    const festa = _equipeFestasCache.find(f => f.id === festaId);
    if (festa) delete festa.equipeVinculoManual;
    renderizarEquipe();
  } catch (e) {
    console.error(e);
    toast('Erro ao desvincular.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   PREÇOS — lidos ao vivo do Cadastro de Insumos do controle-gestao-main
   (mesmo app secundário 'gestao' da aba Equipe; só leitura, nunca grava
   nada lá). Usado pra "Valor da carga" (Separação) e aba "Estoque R$".
══════════════════════════════════════════════════ */

async function carregarPrecosGestao() {
  const insumos = await buscarInsumosGestao();
  _insumosGestaoIndisponivel = insumos === null;
  const mapa = {};
  (insumos || []).forEach(ins => {
    /* preço manual (Cadastro de Insumos) tem prioridade sobre o de reposição —
       mesma regra do precoEfetivoInsumo() no controle-gestao-main. */
    const custo = (ins.precoManual != null && ins.precoManual !== '')
      ? Number(ins.precoManual)
      : Number(ins.custoReposicao) || 0;
    if (!custo) return;
    [ins.nome, ...(ins.aliases || [])].forEach(n => {
      const chave = nomeBaseKey(normalizarNomeItem(n));
      if (chave && !(chave in mapa)) mapa[chave] = custo;
    });
  });
  _mapaPrecoInsumoGestao = mapa;
  return mapa;
}

/* null = preço ainda não carregado ou item não encontrado no Cadastro de Insumos */
function precoInsumoPorNomeKey(nomeKey) {
  if (!_mapaPrecoInsumoGestao) return null;
  const chave = nomeBaseKey(nomeKey);
  return chave in _mapaPrecoInsumoGestao ? _mapaPrecoInsumoGestao[chave] : null;
}

function _fmtReais(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* Soma o custo (qtdNecessaria × custoReposicao) de todos os itens de uma festa —
   usado na Separação pra mostrar "Valor da carga" que está indo pro evento. */
function _valorCargaFesta(festa) {
  if (!_mapaPrecoInsumoGestao) return null;
  let total = 0, semPreco = 0;
  (festa.itens || []).forEach(it => {
    const preco = precoInsumoPorNomeKey(nomeBaseKey(normalizarNomeItem(it.nome)));
    if (preco == null) { semPreco++; return; }
    total += preco * (it.qtdNecessaria || 0);
  });
  return { total, semPreco };
}

function htmlValorCarga(festa) {
  if (!_mapaPrecoInsumoGestao) {
    return `<div class="info-linha" style="margin-top:6px;color:var(--cinza-500)">Carregando valor da carga…</div>`;
  }
  const { total, semPreco } = _valorCargaFesta(festa);
  return `
    <div class="info-linha" style="margin-top:6px;font-weight:700">Valor da carga: ${_fmtReais(total)}</div>
    ${semPreco ? `<div class="info-linha" style="font-size:12px;color:var(--cinza-500)">${semPreco} item(ns) sem preço vinculado no Cadastro de Insumos — não entram no total.</div>` : ''}
    ${_insumosGestaoIndisponivel ? `<div class="info-linha" style="font-size:12px;color:#B45309">Preços do controle-gestao-main indisponíveis no momento.</div>` : ''}
  `;
}

/* ══════════════════════════════════════════════════
   CADASTRO DE ITENS (grupos, prioridade, refrigerado)
══════════════════════════════════════════════════ */

async function abrirCadastroItens(aba) {
  historico.push('tela-cadastro-itens');
  mostrarTela('tela-cadastro-itens', 'Cadastro');
  _buscaCadastro = '';
  const inputBusca = document.getElementById('busca-cadastro');
  if (inputBusca) inputBusca.value = '';
  /* Garantir que a aba correta esteja ativa */
  const abaAlvo = aba || 'config';
  const btnAlvo = document.getElementById(
    abaAlvo === 'localizacoes' ? 'tab-itens-loc'    :
    abaAlvo === 'categorias'   ? 'tab-itens-cat'     :
    abaAlvo === 'fichas'       ? 'tab-itens-fichas'  : 'tab-itens-config'
  );
  trocarAbaItens(abaAlvo, btnAlvo);
}

function filtrarCadastro(termo) {
  _buscaCadastro = (termo || '').toLowerCase().trim();
  renderizarCadastroItens();
}

function filtrarCadastroPorCategoria(valor) {
  _filtroCadastroCat = valor || '';
  renderizarCadastroItens();
}

function trocarAbaItens(aba, btn) {
  document.querySelectorAll('#tela-cadastro-itens .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');

  const elConf     = document.getElementById('cadastro-itens-lista');
  const elCat      = document.getElementById('cadastro-itens-cat');
  const elLoc      = document.getElementById('cadastro-itens-loc');
  const elFichas   = document.getElementById('cadastro-itens-fichas');
  const btnNovo    = document.getElementById('btn-novo-item-config');
  const btnNovoCat = document.getElementById('btn-nova-categoria');
  const btnNovaFicha = document.getElementById('btn-nova-ficha');
  const btnSel     = document.getElementById('btn-selecionar-itens');
  const btnAplicar = document.getElementById('btn-aplicar-class');
  const btnPadr    = document.getElementById('btn-padronizar-nomes');
  const btnDup     = document.getElementById('btn-resolver-duplicados');
  const busca      = document.getElementById('busca-cadastro-wrap');

  /* Reset todos */
  elConf?.classList.add('hidden');
  elCat?.classList.add('hidden');
  elLoc?.classList.add('hidden');
  elFichas?.classList.add('hidden');
  if (btnNovo)      btnNovo.classList.add('hidden');
  if (btnNovoCat)   btnNovoCat.classList.add('hidden');
  if (btnNovaFicha) btnNovaFicha.classList.add('hidden');
  if (btnSel)       btnSel.style.display = '';
  if (btnAplicar)   btnAplicar.classList.add('hidden');
  if (btnPadr)      btnPadr.classList.add('hidden');
  if (btnDup)       btnDup.classList.add('hidden');
  if (busca)        busca.classList.add('hidden');

  if (aba === 'categorias') {
    elCat?.classList.remove('hidden');
    if (btnNovoCat) btnNovoCat.classList.remove('hidden');
    if (btnSel)     btnSel.style.display = 'none';
    renderizarCategorias();
  } else if (aba === 'localizacoes') {
    elLoc?.classList.remove('hidden');
    renderizarLocalizacoes();
  } else if (aba === 'fichas') {
    elFichas?.classList.remove('hidden');
    if (btnNovaFicha) btnNovaFicha.classList.remove('hidden');
    if (btnSel)        btnSel.style.display = 'none';
    renderizarFichasTecnicas();
  } else {
    elConf?.classList.remove('hidden');
    if (btnNovo)    btnNovo.classList.remove('hidden');
    if (btnAplicar) btnAplicar.classList.remove('hidden');
    if (btnPadr)    btnPadr.classList.remove('hidden');
    if (btnDup)     btnDup.classList.remove('hidden');
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
    /* Carregar configs, categorias e itens de todas as festas em paralelo.
       Reaproveita o cache já em memória quando possível — esta função roda
       a cada tecla digitada na busca/filtro, então não pode reler as
       coleções inteiras do Firestore a cada letra. */
    const [configs, festas, cats] = await Promise.all([
      Object.keys(itemConfigsCache).length ? Promise.resolve(Object.values(itemConfigsCache)) : listarItemConfigs(),
      todasFestasCache.length ? Promise.resolve(todasFestasCache) : buscarTodasFestas(),
      categoriasCache.length ? Promise.resolve(categoriasCache) : listarCategorias(),
    ]);
    if (!Object.keys(itemConfigsCache).length) {
      itemConfigsCache = {};
      configs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
    }
    if (!categoriasCache.length) categoriasCache = cats;

    /* Popular o filtro por categoria preservando a seleção atual */
    const selCat = document.getElementById('cadastro-filtro-cat');
    if (selCat) {
      const atual = _filtroCadastroCat;
      selCat.innerHTML = '<option value="">Todas as categorias</option>'
        + categoriasCache.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'))
            .map(c => `<option value="${_escHtml(c.nome)}">${_escHtml(c.nome)}</option>`).join('')
        + `<option value="Sem Categoria">Sem Categoria</option>`;
      selCat.value = atual;
    }

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
      if (!grupos[g]) grupos[g] = { itens: [] };
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
        <strong style="color:#92400E;">Produtos duplicados (${duplicados.size}):</strong>
        <ul style="margin:4px 0 0 16px;color:#78350F;">
          ${[...duplicados].map(k => `<li>${_escHtml(configs.find(c=>c.nomeKey===k)?.nome || k)}</li>`).join('')}
        </ul>
        <span style="font-size:11px;color:#92400E;">Remova as entradas extras para evitar conflitos.</span>
      </div>` : '';

    const filtrar = (nome) => !busca || nome.toLowerCase().includes(busca);

    const htmlGrupos = Object.entries(grupos)
      .filter(([grupo]) => !_filtroCadastroCat || grupo === _filtroCadastroCat)
      .sort(([nomeA], [nomeB]) => nomeA.localeCompare(nomeB, 'pt-BR'))
      .map(([grupo, grpData]) => {
        const itensFiltrados = grpData.itens
          .filter(c => filtrar(c.nome))
          .sort((a,b) => (a.ordemSeparacao||999)-(b.ordemSeparacao||999));
        if (!itensFiltrados.length) return '';
        return `
          <div class="config-grupo-bloco">
            <div class="config-grupo-titulo">${_escHtml(grupo)}</div>
            ${itensFiltrados.map(c => htmlConfigItemRow(c)).join('')}
          </div>`;
      }).join('');

    /* Itens sem config não têm categoria — só faz sentido mostrar essa
       seção quando nenhum filtro de categoria específico está ativo */
    const semConfigFiltrado = _filtroCadastroCat ? [] : semConfig.filter(it => filtrar(it.nomeDisplay));
    const htmlSemConfig = semConfigFiltrado.length ? `
      <div class="config-grupo-bloco">
        <div class="config-grupo-titulo producao-nao-clas-label">Não configurados (${semConfigFiltrado.length})</div>
        <p class="producao-nao-clas-hint">Estes itens estão nas festas mas ainda não foram classificados.</p>
        ${semConfigFiltrado.sort((a,b) => a.nomeDisplay.localeCompare(b.nomeDisplay,'pt-BR')).map(it => `
          <div class="config-item-row">
            <div class="config-item-info">
              <div class="config-item-nome">${_escHtml(it.nomeDisplay)}</div>
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
    el.innerHTML = conteudo || estadoVazio(busca ? `Nenhum produto encontrado para "${_escHtml(busca)}".` : 'Nenhum item encontrado. Cadastre uma festa para começar.');
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
  const badgeCompras = !deveExibirNaListaCompras(c) ? '<span class="badge-oculto-sep">Oculto compras</span>' : '';
  const nomeExibido = nomeBasDisplay(c.nome);
  const metaHtml    = `
    ${c.ordemSeparacao && c.ordemSeparacao !== 999 ? `<span class="badge-ordem">#${c.ordemSeparacao}</span>` : ''}
    ${c.prioridade ? `<span class="badge-prioridade prior-${c.prioridade}">${c.prioridade}</span>` : ''}
    ${c.refrigerado ? `<span class="badge-refrigerado">Refrig.</span>` : ''}
  `;

  return `
    <div class="config-item-row" data-item-id="${_esc(c.id)}" onclick="onClickItemCadastro('${_esc(c.id)}')">
      <input type="checkbox" class="chk-item-cadastro" onclick="event.stopPropagation();toggleSelecaoItemCadastro('${_esc(c.id)}')">
      <div class="config-item-info">
        <div class="config-item-nome">${_escHtml(nomeExibido)} ${badgeProd} ${badgeSep} ${badgeCompras}</div>
        <div class="config-item-meta">${metaHtml}</div>
      </div>
      <div class="config-item-acoes">
        <button class="btn-icone" title="Editar" onclick="event.stopPropagation();abrirFormItemConfig('${c.id}')">Editar</button>
        <button class="btn-icone btn-icone-del" title="Remover" onclick="event.stopPropagation();confirmarDeletarItemConfig('${_esc(c.id)}','${_esc(c.nome)}')">Remover</button>
      </div>
    </div>
  `;
}

/* ════════════════════════════════════════
   PADRONIZAR NOMES — aplica a lista de nomes "oficiais" da Juliana em 3 frentes:
   1) Cadastro de Itens — troca só o campo "nome" (o que aparece na tela); o
      nomeKey NUNCA é recalculado aqui, porque é ele — não o nome de exibição —
      que vincula o item ao estoque e ao historico_contagem. Espelha o nome
      novo no doc de estoque correspondente só se ele já existir, nunca cria
      um novo.
   2) Itens dentro das festas ATIVAS (status != concluida) — é esse texto, e
      não o do Cadastro, que aparece na tela Controle de Estoque (vem do PDF
      importado da festa). Ao renomear um item aqui, o nomeKey recalculado a
      partir do nome novo pode ser diferente do antigo — migra então o doc de
      estoque (mesmo doc, só troca a chave) e qualquer compra pendente/em
      andamento da chave antiga para a chave nova, senão a contagem já feita
      "some" da tela por ficar presa sob a chave velha.
   3) Nomes da lista que não batem em NENHUM lugar (nem Cadastro, nem festa,
      por nenhum apelido) são produtos ainda não cadastrados — cria um item
      novo no Cadastro sem categoria, pra revisão manual depois.
   Casamento é sempre por igualdade exata (nome/apelido, sem distinguir
   maiúsculas e espaços nas pontas) — não tenta adivinhar nomes parecidos.
════════════════════════════════════════ */
const LISTA2_PARA_PADRAO = {
  "AGUA COM GAS": "AGUA COM GAS - 500ML",
  "AGUA SEM GAS 500ML": "AGUA SEM GAS - 500ML",
  "AGUA TONICA": "AGUA TONICA LATA TRADICIONAL - 350ML",
  "AMARENA": "AMARENA",
  "AMAROGUTTA": "AMAROGUTTA - 1000ML",
  "APEROL": "APEROL - 750ML",
  "ANGOSTURA": "BITTER ANGOSTURA - 200ML (RESERVA)",
  "BITTER LARANJA": "BITTER ORANGE - 200ML",
  "BANANINHA": "CACHAÇA BANANINHA - 750ML",
  "CACHACA SPIRAL": "CACHAÇA SPIRAL - 1000ML",
  "CAMPARI": "CAMPARI - 998 ML",
  "DOMEC": "CONHAQUE DOMECQ - 1000ML",
  "COPO BAIXO XTRA": "COPO BAIXO XTRA",
  "COPO BOODY MARY": "COPO BLOOD MARY",
  "CANECA DE COBRE": "COPO CANECA COBRE",
  "COPO LONG ELYSIA": "COPO LONGO ELYSIA",
  "COPO LONG LISO MODELO NOVO": "COPO LONGO LISO NOVO",
  "COPO LONG LISO MODELO VELHO": "COPO LONGO LISO VELHO",
  "COPO LONG REVEL": "COPO LONGO REVEL",
  "COPO LONG XTRA": "COPO LONGO XTRA",
  "EMULSIFICANTE": "EMULSIFICANTE - 200ml",
  "ESPUMA DE GENGIBRE": "ESPUMA DE GENGIBRE - 1000ML",
  "ESPUMA DE SICILIANO": "ESPUMA DE LIMAO SICILIANO - 1000ML",
  "ESPUMA DE TANGERINA": "ESPUMA DE TANGERINA - 1000ML",
  "ESPUMANTE BRUT": "ESPUMANTE BRUT - 750ML",
  "ESPUMANTE 0%": "ESPUMANTE FREIXENET 0% - 750ML",
  "FERNET": "FERNET BRANCA - 750ML",
  "FIREBALL": "FIREBALL - 750ML",
  "GIN BEEFEATER": "GIN BEEFEATER - 750ML",
  "GIN BOMBAY": "GIN BOMBAY - 750ML",
  "GIN HENDRICKS": "GIN HENDRICKS - 750ML",
  "GIN MARTIN MILLER": "GIN MARTIN MILLER - 750ML",
  "GIN ROKU": "GIN ROKU - 750ML",
  "GIN SPIRAL": "GIN SPIRAL - 1000ML",
  "GIN TANQUERAY": "GIN TANQUERAY - 750ML",
  "GIN YVY CERRADO": "GIN YVY CERRADO - 500ML",
  "GIN YVY MATA ATLANTICA": "GIN YVY MATA ATLANTICA - 500ML",
  "GIN ZURR": "GIN ZURR - 750ML",
  "JAGERMEISTER": "JAGERMEISTER - 750ML",
  "LICOR 43": "LICOR 43 - 700ML",
  "LILLET": "LILLET BLANC - 750ML",
  "LILLET ROSE": "LILLET ROSE - 750ML",
  "MANZA": "MANZA - 330ML",
  "MARACUJA PROD": "MARACUJA",
  "MEL": "MEL",
  "NEGRONI ROMERO": "NEGRONI",
  "PISCO CHI CAPEL RESERVADO 700 ML": "PISCO CAPEL - 750ML",
  "PURE MAÇA VERDE 1883 1L": "PURE 1883 MAÇA - 1000ML",
  "PURE DE MARACUJA": "PURE 1883 MARACUJA - 1000ML",
  "PURE DE ABACAXI": "PURE DE FRUTA ABACAXI",
  "PURE DE BANANA": "PURE DE FRUTA BANANA",
  "PURE DE FRUTAS VERMELHAS": "PURE DE FRUTAS VERMELHAS",
  "PURE DE JABUTICABA": "PURE MONIN JABUTICABA - 1000ML",
  "PURE DE PERA": "PURE MONIN PERA - 1000ML",
  "PURE DE TORANJA": "PURE MONIN TORANJA - 1000ML",
  "RUM HAVANA": "RUM HAVANA CLUB ANEJO - 700ML",
  "SAQUE": "SAQUE - 600ML",
  "GINGER ALE": "SODA GINGER ALE - 1000ML",
  "SODA DE GRAPEFRUIT": "SODA GRAPEFRUIT - 1000ML",
  "SUCO LARANJA": "SUCO DE LARANJA",
  "SUCO DE LIMAO": "SUCO DE LIMAO",
  "SUCO DE PESSEGO": "SUCO DE PESSEGO",
  "TAÇA DE VINHO BRUNELLO": "TAÇA BRUNELLO",
  "TAÇA CALISE AMERICA (RECEPTIVO)": "TAÇA CALISE AMERICA",
  "TAÇA COUPE AMERICA": "TAÇA COUPE AMÉRICA",
  "TAÇA COUPE TIMELEES": "TAÇA COUPE TIMELESS",
  "TAÇA MARTINI": "TAÇA MARTINI AMERICA",
  "TAÇA DE VINHO XTRA": "TAÇA XTRA",
  "TEQUILA DON JULIO": "TEQUILA DON JULIO - 750ML",
  "TEQUILA 1800 BLANCO": "TEQUILA JOSE CUERVO 1800 BLANCO - 750ML",
  "TEQUILA 1800 CRISTALINO": "TEQUILA JOSE CUERVO 1800 CRISTALINO - 750ML",
  "TEQUILA 1800 CRISTALINO AURORA": "TEQUILA JOSE CUERVO CRISTALINO (AURORA) - 700ML",
  "TEQUILA JOSE CUERVO ESPECIAL": "TEQUILA JOSE CUERVO ESPECIAL OURO - 750ML",
  "MAESTRO DOBEL": "TEQUILA MAESTRO DOBEL - 750ML",
  "1757": "VERMUTE 1757 - 750ML",
  "VERMUTE ARG CARPANO ROSSO": "VERMUTE CARPANO ROSSO - 950ML",
  "CINZANO": "VERMUTE ROSSO CINZANO - 1000ML",
  "VINHO DO PORTO BRANCO": "VINHO DO PORTO BRANCO - 750ML",
  "VODKA ABSOLUT": "VODKA ABSOLUT - 1000ML",
  "VODKA GREY GOOSE": "VODKA GREY GOOSE - 750ML",
  "VODKA IMPERIAL GOLD": "VODKA IMPERIAL GOLD - 750ML",
  "VODKA KETEL ONE": "VODKA KETEL ONE - 750ML",
  "VODKA RCV": "VODKA RCV - 750ML",
  "VODKA ROBERTO CAVALLI": "VODKA ROBERTO CAVALLI - 1000ML",
  "VODKA WYBOROWA": "VODKA WYBOROWA - 750ML",
  "WHISKY 3 LOBOS SINGLE MALT 750 ML": "WHISKEY 3 LOBOS - 750ML",
  "BLACK LABEL": "WHISKEY BLACK LABEL - 750ML",
  "WHISKY BUFFALO TRACE BOURBON - 750 ML": "WHISKEY BUFALO TRACE - 750ML",
  "BULLEIT": "WHISKEY BULLEIT - 750ML",
  "CHIVAS 12": "WHISKEY CHIVAS 12 - 750ML",
  "JACK DANIELS": "WHISKEY JACK DANIELS - 750ML",
  "WHISKY JAMESON - 750ML": "WHISKEY JAMESON - 750ML",
  "RED LABEL": "WHISKEY RED LABEL - 750ML",
  "SINGLETON": "WHISKEY SINGLETON - 750ML",
  "THE GLENLIVET": "WHISKEY THE GLENLIVET - 750ML",
  "ABACAXI XP": "XAROPE 1883 ABACAXI - 1000ML",
  "AMARETO": "XAROPE 1883 AMARETO - 1000ML",
  "XAROPE 1883 DE AMORA": "XAROPE 1883 AMORA - 1000ML",
  "CARAMELO": "XAROPE 1883 CARAMELO - 1000ML",
  "CARAMELO SALGADO": "XAROPE 1883 CARAMELO SALGADO - 1000ML",
  "CRAMBERRY": "XAROPE 1883 CRAMBERRY - 1000ML",
  "BLUE CURACAO": "XAROPE 1883 CURAÇAU BLUE - 1000ML",
  "XAROPE 1883 DE FRAMBOESA": "XAROPE 1883 FRAMBOESA - 1000ML",
  "GENGIBRE": "XAROPE 1883 GENGIBRE - 1000ML",
  "GRENADINE": "XAROPE 1883 GRENADINE - 1000ML",
  "XAROPE LARANJA VERMELHA 1L": "XAROPE 1883 LARANJA VERMELHA - 1000ML",
  "XAROPE 1883 DE LICHIA": "XAROPE 1883 LICHIA - 1000ML",
  "LIMAO SICILIANO": "XAROPE 1883 LIMAO SICILIANO - 1000ML",
  "XAROPE DE MAÇA VERDE": "XAROPE 1883 MAÇA VERDE - 1000ML",
  "MAPLE": "XAROPE 1883 MAPLE - 1000ML",
  "MARACUJA VERMELHO": "XAROPE 1883 MARACUJÁ VERMELHO - 1000ML",
  "MELANCIA": "XAROPE 1883 MELANCIA - 1000ML",
  "MENTA": "XAROPE 1883 MENTA - 1000ML",
  "PEPINO": "XAROPE 1883 PEPINO - 1000ML",
  "PIMENTA": "XAROPE 1883 PIMENTA - 1000ML",
  "POMEGRANATE ROMA": "XAROPE 1883 ROMA/POMEGRANATE - 1000ML",
  "XAROPE 1883 DE TANGERINA": "XAROPE 1883 TANGERINE - 1000ML",
  "TONIC XP": "XAROPE 1883 TONIC - 1000ML",
  "XAROPE DE ACUCAR": "XAROPE DE AÇUCAR",
  "FLOR DE SABUGUEIRO": "XAROPE FABRI FLOR DE SABUGUEIRO - 1000ML",
  "MANDARIN": "XAROPE FABRI MANDARIM - 1000ML",
  "AGAVE": "XAROPE MONIN AGAVEA - 1000ML",
  "MELON": "XAROPE MONIN MELON - 1000ML",
  "MENTA VERDE": "XAROPE MONIN MENTA VERDE - 1000ML",
  "MORANGO XP": "XAROPE MONIN MORANGO - 1000ML",
  "PIPOCA": "XAROPE MONIN PIPOCA - 1000ML",
  "PISTACHIO": "XAROPE MONIN PISTACHO - 1000ML",
  "PURE DE YUZU": "XAROPE MONIN YUZU - 1000ML",
};
const LISTA3_PARA_PADRAO = {
  "AGUA COM GAS - 500ML": "AGUA COM GAS - 500ML",
  "AGUA TONICA LATA ZERO - 350 ML": "AGUA TONICA LATA TRADICIONAL - 350ML",
  "APEROL - 750ML": "APEROL - 750ML",
  "BIQUEIRA BITTER ANGOSTURA": "BIQUEIRA BITTER ANGOSTURA",
  "BITTER ANGOSTURA - 200ML": "BITTER ANGOSTURA - 200ML (RESERVA)",
  "CACHAÇA SPIRAL - 1000ML": "CACHAÇA SPIRAL - 1000ML",
  "CAMPARI - 998 ML": "CAMPARI - 998 ML",
  "COPO BAIXO XTRA": "COPO BAIXO XTRA",
  "COPO CANECA COBRE": "COPO CANECA COBRE",
  "COPO LONGO ELYSIA": "COPO LONGO ELYSIA",
  "COPO LONGO LISO NOVO": "COPO LONGO LISO NOVO",
  "COPO LONGO LISO ANTIGO": "COPO LONGO LISO VELHO",
  "COPO LONGO XTRA": "COPO LONGO XTRA",
  "EMULSIFICANTE - 200ml": "EMULSIFICANTE - 200ml",
  "ESPUMA DE GENGIBRE - 1000ML": "ESPUMA DE GENGIBRE - 1000ML",
  "ESPUMA DE LIMAO SICILIANO - 1000ML": "ESPUMA DE LIMAO SICILIANO - 1000ML",
  "ESPUMANTE BRUT - 750ML": "ESPUMANTE BRUT - 750ML",
  "FIREBALL - 750ML": "FIREBALL - 750ML",
  "GIN BEEFEATER - 750ML": "GIN BEEFEATER - 750ML",
  "GIN TANQUERAY - 750ML": "GIN TANQUERAY - 750ML",
  "LICOR 43 - 700ML": "LICOR 43 - 700ML",
  "MANZA - 330ML": "MANZA - 330ML",
  "MARACUJA": "MARACUJA",
  "MEL": "MEL",
  "RUM HAVANA CLUB ANEJO - 700ML": "RUM HAVANA CLUB ANEJO - 700ML",
  "SODA GINGER ALE - 1000ML": "SODA GINGER ALE - 1000ML",
  "SODA GRAPEFRUIT - 1000ML": "SODA GRAPEFRUIT - 1000ML",
  "SUCO DE LARANJA": "SUCO DE LARANJA",
  "SUCO DE LIMAO": "SUCO DE LIMAO",
  "TAÇA COUPE AMÉRICA": "TAÇA COUPE AMÉRICA",
  "TAÇA COUPE TIMELESS": "TAÇA COUPE TIMELESS",
  "TAÇA XTRA": "TAÇA XTRA",
  "TEQUILA JOSE CUERVO ESPECIAL OURO- 750ML": "TEQUILA JOSE CUERVO ESPECIAL OURO - 750ML",
  "VERMUTE CARPANO- 950ML": "VERMUTE CARPANO ROSSO - 950ML",
  "Vermute cinzano": "VERMUTE ROSSO CINZANO - 1000ML",
  "VODKA ABSOLUT - 1000ML": "VODKA ABSOLUT - 1000ML",
  "WHISKEY JAMESON - 750ML": "WHISKEY JAMESON - 750ML",
  "XAROPE 1883 CRAMBERRY - 1000ML": "XAROPE 1883 CRAMBERRY - 1000ML",
  "XAROPE 1883 GENGIBRE - 1000ML": "XAROPE 1883 GENGIBRE - 1000ML",
  "XAROPE 1883 LICHIA - 1000ML": "XAROPE 1883 LICHIA - 1000ML",
  "LIMAO SICILIANO": "XAROPE 1883 LIMAO SICILIANO - 1000ML",
  "XAROPE 1883 MARACUJÁ VERMELHO- 1000ML": "XAROPE 1883 MARACUJÁ VERMELHO - 1000ML",
  "XAROPE 1883 TANGERINE - 1000ML": "XAROPE 1883 TANGERINE - 1000ML",
  "XAROPE DE AÇUCAR": "XAROPE DE AÇUCAR",
};
/* lista3 vence em caso de apelido repetido entre as duas — é a que já reflete
   os nomes atuais do sistema */
const MAPA_PADRONIZACAO_NOMES = { ...LISTA2_PARA_PADRAO, ...LISTA3_PARA_PADRAO };

let _padronizacaoPendente      = []; /* [{id, nomeKey, nomeAtual, nomeNovo}] — Cadastro */
let _padronizacaoPendenteFesta = []; /* [{festaId, festaNome, itemIdx, nomeAtual, nomeNovo, oldKey, newKey}] — itens de festas ativas */
let _padronizacaoPendenteNovos = []; /* [{nomeNovo}] — produtos a cadastrar do zero */
let _padronizacaoFestasSnapshot = []; /* festas ativas no momento do preview, reusadas na confirmação p/ os itemIdx baterem */

async function abrirModalPadronizarNomes() {
  const configs = Object.values(itemConfigsCache);
  const porNomeAtualCfg = {};
  configs.forEach(c => { porNomeAtualCfg[(c.nome || '').trim().toUpperCase()] = c; });

  const festasTodas = await buscarTodasFestas();
  _padronizacaoFestasSnapshot = festasTodas.filter(f => f.status !== 'concluida');

  const porNomeAtualFesta = {};
  _padronizacaoFestasSnapshot.forEach(f => (f.itens || []).forEach((it, idx) => {
    const chave = (it.nome || '').trim().toUpperCase();
    if (!chave) return;
    if (!porNomeAtualFesta[chave]) porNomeAtualFesta[chave] = [];
    porNomeAtualFesta[chave].push({ festaId: f.id, festaNome: f.nome, itemIdx: idx, nomeAtual: it.nome });
  }));

  /* Agrupa todos os apelidos (das duas listas) por nome canônico — o próprio
     nome canônico também conta como "apelido de si mesmo" */
  const porCanonico = {};
  Object.entries(MAPA_PADRONIZACAO_NOMES).forEach(([alias, canonicoRaw]) => {
    const canonico = canonicoRaw.trim();
    if (!porCanonico[canonico]) porCanonico[canonico] = new Set();
    porCanonico[canonico].add(alias.trim());
    porCanonico[canonico].add(canonico);
  });

  _padronizacaoPendente      = [];
  _padronizacaoPendenteFesta = [];
  _padronizacaoPendenteNovos = [];

  Object.entries(porCanonico).forEach(([canonico, aliasesSet]) => {
    let achouEmAlgumLugar = false;
    aliasesSet.forEach(alias => {
      const chave = alias.toUpperCase();

      const cfg = porNomeAtualCfg[chave];
      if (cfg) {
        achouEmAlgumLugar = true;
        if ((cfg.nome || '').trim() !== canonico) {
          _padronizacaoPendente.push({ id: cfg.id, nomeKey: cfg.nomeKey, nomeAtual: cfg.nome, nomeNovo: canonico });
        }
      }

      const ocorrenciasFesta = porNomeAtualFesta[chave];
      if (ocorrenciasFesta) {
        achouEmAlgumLugar = true;
        ocorrenciasFesta.forEach(oc => {
          if (oc.nomeAtual.trim() === canonico) return;
          _padronizacaoPendenteFesta.push({
            ...oc,
            nomeNovo: canonico,
            oldKey: nomeBaseKey(normalizarNomeItem(oc.nomeAtual)),
            newKey: nomeBaseKey(normalizarNomeItem(canonico)),
          });
        });
      }
    });
    if (!achouEmAlgumLugar) _padronizacaoPendenteNovos.push({ nomeNovo: canonico });
  });

  /* Aviso preventivo: se dois itens diferentes do Cadastro forem terminar
     com o mesmo nome (ex.: dois apelidos da lista, cada um já usado por um
     item separado, apontando pro mesmo nome padrão), isso cria um
     duplicado visual — nomeKey continua diferente, então não é bug, mas
     ela precisa saber antes de aplicar (depois dá pra corrigir em
     "Resolver duplicados"). */
  const nomeNovoPorId = {};
  _padronizacaoPendente.forEach(p => { nomeNovoPorId[p.id] = p.nomeNovo; });
  const resultanteContagem = {};
  configs.forEach(c => {
    const nomeResultante = (nomeNovoPorId[c.id] || c.nome || '').trim().toUpperCase();
    if (!nomeResultante) return;
    resultanteContagem[nomeResultante] = (resultanteContagem[nomeResultante] || 0) + 1;
  });
  const avisosColisao = Object.entries(resultanteContagem).filter(([, qtd]) => qtd > 1).map(([nome]) => nome);

  const listaEl    = document.getElementById('padronizar-nomes-lista');
  const btnAplicar = document.getElementById('btn-aplicar-padronizacao');
  const total = _padronizacaoPendente.length + _padronizacaoPendenteFesta.length + _padronizacaoPendenteNovos.length;

  const htmlAviso = avisosColisao.length ? `
    <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:6px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#991B1B">
      <strong>Isso vai deixar ${avisosColisao.length} nome(s) duplicado(s) no Cadastro:</strong>
      ${avisosColisao.map(_escHtml).join(', ')}. São itens diferentes (vínculo com estoque/festa diferente) que vão ficar com o mesmo nome exibido — depois de aplicar, use "Resolver duplicados" pra escolher qual manter.
    </div>` : '';

  if (!total) {
    listaEl.innerHTML = htmlAviso + '<p style="font-size:13px;color:#6B7280;padding:12px 0">Nenhuma mudança pendente — tudo já está com o nome padrão.</p>';
    if (btnAplicar) btnAplicar.classList.add('hidden');
  } else {
    const linhaTroca = p => `
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;padding:6px 0;border-bottom:1px solid #F3F4F6;font-size:13px">
        <span style="color:#9CA3AF;text-decoration:line-through">${_escHtml(p.nomeAtual)}</span>
        <span style="color:#111827;font-weight:600;text-align:right">&#8594; ${_escHtml(p.nomeNovo)}${p.festaNome ? `<br><span style="font-weight:400;color:#9CA3AF;font-size:11px">${_escHtml(p.festaNome)}</span>` : ''}</span>
      </div>`;
    const secao = (titulo, itens, render) => !itens.length ? '' : `
      <div style="margin-bottom:14px">
        <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px">${_escHtml(titulo)} (${itens.length}):</div>
        ${itens.map(render).join('')}
      </div>`;

    listaEl.innerHTML = htmlAviso +
      secao('Cadastro de Itens', _padronizacaoPendente, linhaTroca) +
      secao('Controle de Estoque (festas ativas)', _padronizacaoPendenteFesta, linhaTroca) +
      secao('Novos produtos a cadastrar (sem categoria)', _padronizacaoPendenteNovos, p => `
        <div style="padding:6px 0;border-bottom:1px solid #F3F4F6;font-size:13px;color:#111827;font-weight:600">+ ${_escHtml(p.nomeNovo)}</div>`);
    if (btnAplicar) btnAplicar.classList.remove('hidden');
  }

  document.getElementById('modal-padronizar-nomes').classList.remove('hidden');
}

function fecharModalPadronizarNomes() {
  document.getElementById('modal-padronizar-nomes').classList.add('hidden');
}

async function confirmarPadronizarNomes() {
  const total = _padronizacaoPendente.length + _padronizacaoPendenteFesta.length + _padronizacaoPendenteNovos.length;
  if (!total) return;
  const btnAplicar = document.getElementById('btn-aplicar-padronizacao');
  if (btnAplicar) { btnAplicar.disabled = true; btnAplicar.textContent = 'Aplicando...'; }
  try {
    const [estoqueAtual, comprasAtuais] = await Promise.all([buscarEstoque(), listarCompras()]);
    const conflitosEstoque = [];

    /* 1) Cadastro — só troca o nome de exibição, nomeKey preservado */
    for (const p of _padronizacaoPendente) {
      await salvarItemConfigDB({ id: p.id, nome: p.nomeNovo });
      if (estoqueAtual[p.nomeKey]) {
        await salvarItemEstoque(p.nomeKey, { nome: p.nomeNovo });
      }
    }

    /* 2) Produtos novos — cadastro do zero, sem categoria (revisão manual depois) */
    for (const p of _padronizacaoPendenteNovos) {
      await salvarItemConfigDB({
        nome: p.nomeNovo,
        nomeKey: normalizarNomeItem(p.nomeNovo),
        grupo: '',
        ordemSeparacao: 999,
        prioridade: '',
        eProducao: false,
        exibirSeparacao: true,
        exigeFoto: false,
        conferirCoord: true,
        setor: '',
        prateleira: '',
        refrigerado: false,
        diasAntesEvento: 1,
        estoqueMinimo: null,
        qtdSugerida: null,
      });
    }

    /* 3) Itens dentro das festas ativas — reescreve o array itens de cada festa afetada */
    const mudancasPorFesta = {};
    _padronizacaoPendenteFesta.forEach(p => {
      if (!mudancasPorFesta[p.festaId]) mudancasPorFesta[p.festaId] = [];
      mudancasPorFesta[p.festaId].push(p);
    });
    for (const [festaId, mudancas] of Object.entries(mudancasPorFesta)) {
      const festa = _padronizacaoFestasSnapshot.find(f => f.id === festaId);
      if (!festa) continue;
      const itens = (festa.itens || []).map(it => ({ ...it }));
      mudancas.forEach(m => {
        if (itens[m.itemIdx] && (itens[m.itemIdx].nome || '').trim() === m.nomeAtual.trim()) {
          itens[m.itemIdx].nome = m.nomeNovo;
        }
      });
      await editarQtdFesta(festaId, itens);
    }

    /* 4) Migra a chave de estoque + compras pendentes/em andamento da chave antiga
       pra chave nova (uma vez por par oldKey→newKey, mesmo que várias festas usem o mesmo item) */
    const paresJaMigrados = new Set();
    for (const m of _padronizacaoPendenteFesta) {
      if (m.oldKey === m.newKey) continue;
      const par = `${m.oldKey}→${m.newKey}`;
      if (paresJaMigrados.has(par)) continue;
      paresJaMigrados.add(par);

      const docAntigo = estoqueAtual[m.oldKey];
      const docNovo   = estoqueAtual[m.newKey];
      if (docAntigo && docNovo) {
        conflitosEstoque.push(m.nomeNovo); /* já existe estoque nas duas chaves — não mescla sozinho */
      } else if (docAntigo && !docNovo) {
        await renomearChaveEstoque(docAntigo.id, m.newKey, m.nomeNovo);
      }

      const comprasParaMigrar = comprasAtuais.filter(c => c.nomeKey === m.oldKey && (c.status === 'pendente' || c.status === 'pedido'));
      for (const c of comprasParaMigrar) {
        await atualizarCompraDB(c.id, { nomeKey: m.newKey, nome: m.nomeNovo });
      }
    }

    toast(`${total} mudança(s) aplicada(s)!${conflitosEstoque.length ? ` ${conflitosEstoque.length} item(ns) com estoque nas duas chaves — revise manualmente: ${conflitosEstoque.join(', ')}` : ''}`, 'sucesso');
    if (conflitosEstoque.length) console.warn('Padronizar nomes — conflitos de estoque (revisar manualmente):', conflitosEstoque);

    _padronizacaoPendente      = [];
    _padronizacaoPendenteFesta = [];
    _padronizacaoPendenteNovos = [];
    _padronizacaoFestasSnapshot = [];
    fecharModalPadronizarNomes();

    const [cfgsFrescos, festasFrescas, comprasFrescas] = await Promise.all([
      listarItemConfigs(), buscarTodasFestas(), listarCompras(),
    ]);
    itemConfigsCache = {};
    cfgsFrescos.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
    todasFestasCache = festasFrescas;
    comprasCache      = comprasFrescas;
    renderizarCadastroItens();
  } catch (e) {
    console.error(e);
    toast('Erro ao aplicar padronização. Tente novamente.', 'erro');
  } finally {
    if (btnAplicar) { btnAplicar.disabled = false; btnAplicar.textContent = 'Aplicar'; }
  }
}

/* ════════════════════════════════════════
   RESOLVER DUPLICADOS — itens do Cadastro com o MESMO nome de exibição mas
   nomeKey diferente (o caso mais comum é sobra de uma "Padronizar nomes"
   onde dois apelidos diferentes da lista apontavam pro mesmo nome final, e
   os dois já existiam como itens separados). Mostra qual nomeKey está de
   fato vinculado a uma festa ativa — normalmente o "certo" pra manter — e
   remove os outros, migrando estoque e compras pendentes quando possível.
════════════════════════════════════════ */
let _duplicadosPendente = []; /* [{nome, itens:[{id,nomeKey,temEstoque,qtdEstoque,usadoEmFesta}]}] */

async function abrirModalResolverDuplicados() {
  const configs = Object.values(itemConfigsCache);
  const porNome = {};
  configs.forEach(c => {
    const chave = (c.nome || '').trim().toUpperCase();
    if (!chave) return;
    if (!porNome[chave]) porNome[chave] = [];
    porNome[chave].push(c);
  });
  const gruposDuplicados = Object.entries(porNome).filter(([, arr]) => arr.length > 1);

  const listaEl    = document.getElementById('resolver-duplicados-lista');
  const btnAplicar = document.getElementById('btn-aplicar-resolver-duplicados');

  if (!gruposDuplicados.length) {
    _duplicadosPendente = [];
    listaEl.innerHTML = '<p style="font-size:13px;color:#6B7280;padding:12px 0">Nenhum nome duplicado encontrado no Cadastro.</p>';
    if (btnAplicar) btnAplicar.classList.add('hidden');
    document.getElementById('modal-resolver-duplicados').classList.remove('hidden');
    return;
  }

  const [festasTodas, estoqueAtual] = await Promise.all([buscarTodasFestas(), buscarEstoque()]);
  const chavesUsadasEmFestas = new Set();
  festasTodas.filter(f => f.status !== 'concluida').forEach(f => (f.itens || []).forEach(it => {
    const k = normalizarNomeItem(it.nome);
    chavesUsadasEmFestas.add(k);
    chavesUsadasEmFestas.add(nomeBaseKey(k));
  }));

  _duplicadosPendente = gruposDuplicados.map(([nome, itens]) => ({
    nome,
    itens: itens.map(c => ({
      id: c.id,
      nomeKey: c.nomeKey,
      temEstoque: !!estoqueAtual[c.nomeKey],
      qtdEstoque: estoqueAtual[c.nomeKey]?.qtd,
      usadoEmFesta: chavesUsadasEmFestas.has(c.nomeKey),
    })),
  }));

  listaEl.innerHTML = _duplicadosPendente.map((grupo, gi) => {
    /* Sugestão de qual manter: vinculado a festa ativa primeiro, depois com estoque, senão o primeiro */
    let sugeridoIdx = grupo.itens.findIndex(it => it.usadoEmFesta);
    if (sugeridoIdx === -1) sugeridoIdx = grupo.itens.findIndex(it => it.temEstoque);
    if (sugeridoIdx === -1) sugeridoIdx = 0;

    return `
      <div style="border:1px solid #E5E7EB;border-radius:8px;padding:10px 12px;margin-bottom:10px">
        <div style="font-weight:700;font-size:14px;margin-bottom:6px">${_escHtml(grupo.nome)}</div>
        ${grupo.itens.map((it, ii) => `
          <label style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;font-size:13px;cursor:pointer">
            <input type="radio" name="dup-group-${gi}" value="${ii}" ${ii === sugeridoIdx ? 'checked' : ''} style="margin-top:3px">
            <span>
              <span style="color:#374151">nomeKey: <code>${_escHtml(it.nomeKey)}</code></span><br>
              ${it.usadoEmFesta ? '<span style="background:#DCFCE7;color:#15803d;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;margin-right:4px">VINCULADO A FESTA ATIVA</span>' : ''}
              ${it.temEstoque ? `<span style="background:#DBEAFE;color:#1D4ED8;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700">ESTOQUE: ${it.qtdEstoque ?? 0}</span>` : '<span style="color:#9CA3AF;font-size:11px">sem estoque registrado</span>'}
            </span>
          </label>
        `).join('')}
      </div>`;
  }).join('');

  if (btnAplicar) btnAplicar.classList.remove('hidden');
  document.getElementById('modal-resolver-duplicados').classList.remove('hidden');
}

function fecharModalResolverDuplicados() {
  document.getElementById('modal-resolver-duplicados').classList.add('hidden');
}

async function confirmarResolverDuplicados() {
  if (!_duplicadosPendente.length) return;
  const btnAplicar = document.getElementById('btn-aplicar-resolver-duplicados');
  if (btnAplicar) { btnAplicar.disabled = true; btnAplicar.textContent = 'Aplicando...'; }
  try {
    const [estoqueAtual, comprasAtuais] = await Promise.all([buscarEstoque(), listarCompras()]);
    const conflitosEstoque = [];
    let totalRemovidos = 0;

    for (let gi = 0; gi < _duplicadosPendente.length; gi++) {
      const grupo = _duplicadosPendente[gi];
      const radioMarcado = document.querySelector(`input[name="dup-group-${gi}"]:checked`);
      const winnerIdx = radioMarcado ? parseInt(radioMarcado.value) : 0;
      const winner = grupo.itens[winnerIdx];
      const losers = grupo.itens.filter((_, i) => i !== winnerIdx);

      for (const loser of losers) {
        /* Migra o estoque do perdedor pro vencedor, se o vencedor ainda não tiver doc */
        const docPerdedor = estoqueAtual[loser.nomeKey];
        const docVencedor = estoqueAtual[winner.nomeKey];
        if (docPerdedor && docVencedor) {
          conflitosEstoque.push(`${grupo.nome} (${loser.nomeKey})`);
        } else if (docPerdedor && !docVencedor) {
          await renomearChaveEstoque(docPerdedor.id, winner.nomeKey, grupo.nome);
          estoqueAtual[winner.nomeKey] = { ...docPerdedor, nomeKey: winner.nomeKey };
        }

        /* Migra compras pendentes/em andamento do perdedor pro vencedor */
        const comprasParaMigrar = comprasAtuais.filter(c => c.nomeKey === loser.nomeKey && (c.status === 'pendente' || c.status === 'pedido'));
        for (const c of comprasParaMigrar) {
          await atualizarCompraDB(c.id, { nomeKey: winner.nomeKey, nome: grupo.nome });
        }

        await deletarItemConfigDB(loser.id);
        totalRemovidos++;
      }
    }

    toast(`${totalRemovidos} duplicado(s) removido(s).${conflitosEstoque.length ? ` ${conflitosEstoque.length} com estoque nas duas chaves — revise manualmente: ${conflitosEstoque.join(', ')}` : ''}`, 'sucesso');
    if (conflitosEstoque.length) console.warn('Resolver duplicados — conflitos de estoque (revisar manualmente):', conflitosEstoque);

    _duplicadosPendente = [];
    fecharModalResolverDuplicados();

    const cfgsFrescos = await listarItemConfigs();
    itemConfigsCache = {};
    cfgsFrescos.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
    renderizarCadastroItens();
  } catch (e) {
    console.error(e);
    toast('Erro ao resolver duplicados. Tente novamente.', 'erro');
  } finally {
    if (btnAplicar) { btnAplicar.disabled = false; btnAplicar.textContent = 'Aplicar'; }
  }
}

function onClickItemCadastro(id) {
  if (_modoSelecaoCadastro) toggleSelecaoItemCadastro(id);
}

async function abrirFormItemConfig(id, nomePreenchido) {
  _itemConfigEditId = id || null;
  await preencherSugestoesItemConfig();

  const resetForm = (cfg) => {
    document.getElementById('ic-nome').value    = (cfg?.nome ? nomeBasDisplay(cfg.nome) : nomePreenchido) || '';
    document.getElementById('ic-grupo').value   = cfg?.grupo || '';
    document.getElementById('ic-ordem').value   = (cfg?.ordemSeparacao && cfg.ordemSeparacao !== 999) ? cfg.ordemSeparacao : '';
    document.getElementById('ic-dias-antes').value = cfg?.diasAntesEvento ?? 1;
    document.getElementById('ic-refrigerado').checked    = !!cfg?.refrigerado;
    document.getElementById('ic-producao').checked        = !!cfg?.eProducao;
    document.getElementById('ic-separacao').checked       = cfg?.exibirSeparacao !== false;
    document.getElementById('ic-compras').checked          = cfg?.exibirCompras   !== false;
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
    if (dlNomes) dlNomes.innerHTML = [...nomesSet].sort().map(n => `<option value="${_escHtml(n)}">`).join('');

    const dlGrupos = document.getElementById('ic-grupos-lista');
    if (dlGrupos) dlGrupos.innerHTML = [...gruposSet].sort().map(g => `<option value="${_escHtml(g)}">`).join('');
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
  const exibirCompras   = document.getElementById('ic-compras').checked;
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
    exibirCompras,
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

/* Festas ainda não concluídas (agendada em diante) cujos itens usam este item do Cadastro */
async function _festasUsandoItemCadastro(nomeKey) {
  const festas = await buscarTodasFestas();
  return festas.filter(f => {
    if (f.status === 'concluida') return false;
    return (f.itens || []).some(it => {
      const cfg = buscarConfigItem(normalizarNomeItem(it.nome));
      return cfg && cfg.nomeKey === nomeKey;
    });
  });
}

async function confirmarDeletarItemConfig(id, nome) {
  const cfg = Object.values(itemConfigsCache).find(c => c.id === id);
  if (cfg) {
    let festasEmUso;
    try {
      festasEmUso = await _festasUsandoItemCadastro(cfg.nomeKey);
    } catch (e) {
      console.error(e);
      toast('Não foi possível verificar o uso do item. Tente novamente.', 'erro');
      return;
    }
    if (festasEmUso.length) {
      alert(`Não é possível remover "${nome}": está em uso em ${festasEmUso.length} festa${festasEmUso.length !== 1 ? 's' : ''} ainda não concluída${festasEmUso.length !== 1 ? 's' : ''}:\n\n${festasEmUso.map(f => `- ${f.nome} (${STATUS_LABELS[f.status] || f.status})`).join('\n')}`);
      return;
    }
  }
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
    if (btnSel)  btnSel.textContent = 'Cancelar';
    if (btnNovo) btnNovo.classList.add('hidden');
  } else {
    lista?.classList.remove('modo-selecao');
    barra?.classList.add('hidden');
    if (btnSel)  btnSel.textContent = 'Selecionar';
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
  const btnDel = document.getElementById('btn-excluir-selecionados');

  if (btnDel) { btnDel.disabled = true; btnDel.textContent = 'Verificando...'; }
  let festas;
  try {
    festas = await buscarTodasFestas();
  } catch (e) {
    console.error(e);
    toast('Não foi possível verificar o uso dos itens. Tente novamente.', 'erro');
    if (btnDel) { btnDel.disabled = false; btnDel.textContent = 'Excluir'; }
    return;
  }
  const festasAtivas = festas.filter(f => f.status !== 'concluida');
  const bloqueados = ids
    .map(id => Object.values(itemConfigsCache).find(c => c.id === id))
    .filter(cfg => cfg && festasAtivas.some(f => (f.itens || []).some(it => {
      const c = buscarConfigItem(normalizarNomeItem(it.nome));
      return c && c.nomeKey === cfg.nomeKey;
    })));

  if (bloqueados.length) {
    alert(`Não é possível remover ${bloqueados.length} ite${bloqueados.length !== 1 ? 'ns' : 'm'} porque ${bloqueados.length !== 1 ? 'estão' : 'está'} em uso em festas ainda não concluídas:\n\n${bloqueados.map(c => c.nome).join(', ')}\n\nDesmarque ${bloqueados.length !== 1 ? 'esses itens' : 'esse item'} para remover o restante.`);
    if (btnDel) { btnDel.disabled = false; btnDel.textContent = 'Excluir'; }
    return;
  }

  if (!confirm(`Remover ${ids.length} item${ids.length !== 1 ? 's' : ''} do cadastro?\n\nIsso não afeta as festas já cadastradas.`)) {
    if (btnDel) { btnDel.disabled = false; btnDel.textContent = 'Excluir'; }
    return;
  }
  if (btnDel) { btnDel.textContent = 'Removendo...'; }
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
    if (btnDel) { btnDel.disabled = false; btnDel.textContent = 'Excluir'; }
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
    _analiseCache = todasFestasCache.length ? todasFestasCache : await buscarTodasFestas();
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
        <div class="analise-card-label">Mais rápida<br><span class="analise-card-sub">${_escHtml(maisRapido.nome || maisRapido.cliente)}</span></div>
      </div>
      <div class="analise-card analise-card-laranja">
        <div class="analise-card-valor">${_fmtMin(maisLento.mins)}</div>
        <div class="analise-card-label">Mais demorada<br><span class="analise-card-sub">${_escHtml(maisLento.nome || maisLento.cliente)}</span></div>
      </div>
    </div>

    <!-- Ranking colaboradores -->
    <h3 class="analise-secao-titulo">Desempenho por Colaborador</h3>
    <div class="analise-ranking">
      ${ranking.map((c, i) => `
        <div class="analise-colab-card ${c.media <= mediaMins * 0.9 ? 'analise-colab-top' : ''}">
          <div class="analise-colab-pos">${i + 1}º</div>
          <div class="analise-colab-info">
            <div class="analise-colab-nome">${_escHtml(c.nome)}</div>
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
              <div class="analise-lista-nome">${_escHtml(r.nome || '—')}</div>
              <div class="analise-lista-cliente">${_escHtml(r.cliente)}</div>
            </div>
            <div class="analise-lista-colab">${_escHtml(r.colaborador)}</div>
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
   LISTA DE COMPRAS
══════════════════════════════════════════════════ */

let _lcPeriodo      = 'semana';   /* 'semana' | '15dias' | 'mes' | 'tudo' | 'custom' */
let _lcAba          = 'sintetico';
let _lcFornecimento = 'todos';    /* 'todos' | 'romero' | 'consignado' | 'cliente' */

let _lcSecaoAtual = 'evento'; /* 'evento' | 'alertas' | 'pedidos' | 'simular' */

let _lcSimQtds = {}; /* nomeKey -> qtd digitada na Simulação de Compra (só na sessão, nunca salvo) */

async function abrirListaCompras(secao) {
  historico.push('tela-lista-compras');
  mostrarTela('tela-lista-compras', 'Compras & Lista');

  const secaoAlvo = secao || 'evento';

  /* Popular dropdowns de categoria (evento + simular) */
  const cats = categoriasCache.length ? categoriasCache : await listarCategorias();
  ['lc-filtro-cat', 'lc-sim-filtro-cat'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">Todas as categorias</option>';
    cats.filter(c => c.exibirEstoque !== false).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.nome;
      opt.textContent = c.nome;
      sel.appendChild(opt);
    });
  });

  /* Ativar seção correta */
  document.querySelectorAll('.lc-secao-tabs .tab').forEach(b => b.classList.remove('ativo'));
  const tabIdx = { evento: 0, alertas: 1, pedidos: 2, simular: 3 }[secaoAlvo] ?? 0;
  const tabs = document.querySelectorAll('.lc-secao-tabs .tab');
  if (tabs[tabIdx]) tabs[tabIdx].classList.add('ativo');
  ['evento','alertas','pedidos','simular'].forEach(s => {
    const el = document.getElementById(`lc-secao-${s}`);
    if (el) el.classList.toggle('hidden', s !== secaoAlvo);
  });
  _lcSecaoAtual = secaoAlvo;

  if (secaoAlvo === 'evento') {
    _lcAba          = 'sintetico';
    _lcFornecimento = 'todos';
    document.querySelectorAll('#lc-tabs .tab').forEach((b, i) => b.classList.toggle('ativo', i === 0));
    document.querySelectorAll('#lc-forn-tabs .tab').forEach((b, i) => b.classList.toggle('ativo', i === 0));
    lcSetPeriodo('semana', document.querySelector('#lc-periodo-tabs .tab[data-lc-periodo="semana"]'));
    await lcRenderizar();
  } else if (secaoAlvo === 'simular') {
    await lcAbrirSimulacao();
  } else {
    await recarregarCompras();
    if (secaoAlvo === 'pedidos') {
      _abaCompras = 'andamento';
      trocarAbaCompras('andamento', document.querySelector('#compras-tabs .tab'));
    }
  }
}

function lcAtualizar() {
  if (_lcSecaoAtual === 'evento') {
    lcRenderizar();
  } else if (_lcSecaoAtual === 'simular') {
    lcAbrirSimulacao();
  } else {
    recarregarCompras();
  }
}

function lcTrocarSecao(secao, btn) {
  _lcSecaoAtual = secao;
  document.querySelectorAll('.lc-secao-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  ['evento','alertas','pedidos','simular'].forEach(s => {
    const el = document.getElementById(`lc-secao-${s}`);
    if (el) el.classList.toggle('hidden', s !== secao);
  });
  if (secao === 'evento') {
    lcRenderizar();
  } else if (secao === 'simular') {
    lcAbrirSimulacao();
  } else {
    recarregarCompras();
    if (secao === 'pedidos') {
      _abaCompras = 'andamento';
      trocarAbaCompras('andamento', document.querySelector('#compras-tabs .tab'));
    }
  }
}

function lcSetPeriodo(periodo, btn) {
  _lcPeriodo = periodo;
  document.querySelectorAll('#lc-periodo-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');

  const range = document.getElementById('lc-custom-range');
  if (range) range.classList.toggle('hidden', periodo !== 'custom');

  if (periodo !== 'custom') lcRenderizarConteudo();
}

function lcTrocarAba(aba, btn) {
  _lcAba = aba;
  document.querySelectorAll('#lc-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  lcRenderizarConteudo();
}

function lcSetFornecimento(forn, btn) {
  _lcFornecimento = forn;
  document.querySelectorAll('#lc-forn-tabs .tab').forEach(b => b.classList.remove('ativo'));
  if (btn) btn.classList.add('ativo');
  lcRenderizarConteudo();
}

async function _lcCarregarBase() {
  const [, festas, cfgs, cats] = await Promise.all([
    garantirListenerEstoque(),
    todasFestasCache.length ? Promise.resolve(todasFestasCache) : buscarTodasFestas(),
    Object.keys(itemConfigsCache).length ? Promise.resolve(Object.values(itemConfigsCache)) : listarItemConfigs(),
    categoriasCache.length ? Promise.resolve(categoriasCache) : listarCategorias(),
  ]);
  todasFestasCache = festas;
  if (!Object.keys(itemConfigsCache).length) {
    itemConfigsCache = {};
    cfgs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
  }
  if (!categoriasCache.length) categoriasCache = cats;
}

async function lcRenderizar() {
  const el = document.getElementById('lc-conteudo');
  if (el) el.innerHTML = '<div class="estado-vazio"><p>Calculando...</p></div>';

  try {
    await _lcCarregarBase();
    lcRenderizarConteudo();
  } catch(e) {
    console.error(e);
    const el2 = document.getElementById('lc-conteudo');
    if (el2) el2.innerHTML = estadoVazio('Erro ao carregar. Tente novamente.');
  }
}

function _lcFiltrarFestas() {
  const ativas = todasFestasCache.filter(f => f.status !== 'concluida');

  if (_lcPeriodo === 'tudo') return ativas;

  const hoje = new Date(); hoje.setHours(0,0,0,0);

  if (_lcPeriodo === 'custom') {
    const ini = document.getElementById('lc-data-inicio')?.value;
    const fim = document.getElementById('lc-data-fim')?.value;
    if (!ini || !fim) return ativas;
    const dIni = new Date(ini + 'T00:00:00');
    const dFim = new Date(fim + 'T23:59:59');
    return ativas.filter(f => {
      const d = toDate(f.data);
      return !isNaN(d) && d >= dIni && d <= dFim;
    });
  }

  let diasFuturo = 7;
  if (_lcPeriodo === '15dias') diasFuturo = 15;
  if (_lcPeriodo === 'mes') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);
    return ativas.filter(f => {
      const d = toDate(f.data);
      return !isNaN(d) && d >= ini && d <= fim;
    });
  }

  const fim = new Date(hoje); fim.setDate(hoje.getDate() + diasFuturo); fim.setHours(23,59,59);
  return ativas.filter(f => {
    const d = toDate(f.data);
    return !isNaN(d) && d >= hoje && d <= fim;
  });
}

/* Agrega os itens de uma lista de festas com estoque calculado (usado em
   "Por Evento" e em "Simular Compra" — cada um passa seu próprio recorte
   de festas). "A Comprar" considera apenas qtd ROMERO+OUTRO (itens que
   precisamos comprar). Consignado e Cliente não precisam de compra. */
function _lcConstruirItens(festas) {
  /* Índice estoque por chave base — agrega variantes (ex: "aperol" + "aperol_consignado" → "aperol") */
  const estBaseIdx = {};
  Object.values(estoqueCache).forEach(e => {
    if (!e.nomeKey) return;
    const baseK = nomeBaseKey(e.nomeKey);
    estBaseIdx[baseK] = (estBaseIdx[baseK] || 0) + (e.qtd || 0);
  });

  /* Busca config por chave base, com fallback para busca linear pelo base key do catálogo */
  function _lcCfg(baseKey) {
    if (itemConfigsCache[baseKey]) return itemConfigsCache[baseKey];
    return Object.values(itemConfigsCache).find(c => nomeBaseKey(c.nomeKey) === baseKey) || null;
  }

  /* Agregar todos os itens das festas informadas, rastreando fornecimento por item */
  const mapa = {};
  festas.forEach(festa => {
    (festa.itens || []).forEach(item => {
      const key = nomeBaseKey(normalizarNomeItem(item.nome));
      const cfg = _lcCfg(key);
      if (!deveExibirNaListaCompras(cfg)) return;
      if (!mapa[key]) {
        mapa[key] = {
          nomeKey: key,
          nome:    nomeBasDisplay(item.nome),
          unidade: item.unidade || 'un',
          necessario: 0,
          qtdRomero: 0, qtdConsignado: 0, qtdCliente: 0, qtdOutro: 0,
          festas:  [],
          cfg,
        };
      }
      const qtd  = item.qtdNecessaria || 0;
      /* Detecta fornecimento: campo explícito → sufixo no nome → padrão romero */
      const forn = item.fornecimento || extrairFornDoNome(item.nome) || 'romero';
      mapa[key].necessario += qtd;
      if      (forn === 'consignado') mapa[key].qtdConsignado += qtd;
      else if (forn === 'cliente')    mapa[key].qtdCliente    += qtd;
      else if (forn === 'romero')     mapa[key].qtdRomero     += qtd;
      else                            mapa[key].qtdOutro       += qtd;
      mapa[key].festas.push({
        festaId:         festa.id,
        festaNome:       festa.nome,
        festaData:       festa.data,
        festaStatus:     festa.status,
        festaTipoEvento: festa.tipoEvento || '',
        festaConvidados: festa.convidados ?? null,
        qtd, forn,
      });
    });
  });

  return Object.values(mapa).map(it => {
    const estoque  = estBaseIdx[it.nomeKey] ?? 0;
    const qtdComprar = it.qtdRomero + it.qtdOutro; /* só o que precisamos comprar */
    const aComprar = Math.max(0, qtdComprar - estoque);
    return { ...it, estoque, qtdComprar, aComprar };
  });
}

function lcRenderizarConteudo() {
  const el = document.getElementById('lc-conteudo');
  if (!el) return;

  const festas   = _lcFiltrarFestas();
  const busca    = (document.getElementById('lc-busca')?.value || '').toLowerCase().trim();
  const catFiltro = document.getElementById('lc-filtro-cat')?.value  || '';
  const statusFiltro = document.getElementById('lc-filtro-status')?.value || 'todos';

  let todosItens = _lcConstruirItens(festas);

  /* Filtro de fornecimento */
  if (_lcFornecimento !== 'todos') {
    todosItens = todosItens.filter(it => {
      if (_lcFornecimento === 'romero')     return it.qtdRomero     > 0 || it.qtdOutro > 0;
      if (_lcFornecimento === 'consignado') return it.qtdConsignado > 0;
      if (_lcFornecimento === 'cliente')    return it.qtdCliente    > 0;
      return true;
    });
  }

  /* Na visão "Por Evento" os itens aparecem independente da configuração
     exibirEstoque da categoria (esse flag só vale pro Controle de Estoque e
     Inventário) — mas já respeitam o exibirCompras (categoria + item),
     filtrado dentro de _lcConstruirItens/deveExibirNaListaCompras. */

  /* Sumário calculado ANTES dos filtros de busca/status — mostra o quadro real */
  const elSum = document.getElementById('lc-sumario');
  if (elSum) {
    const totalItens = todosItens.length;
    const faltando   = todosItens.filter(i => i.aComprar > 0).length;
    const estoqueOk  = todosItens.filter(i => i.aComprar === 0).length;
    elSum.innerHTML = `
      <div class="container lc-sumario-inner">
        <div class="rel-pill"><span class="rel-pill-num">${festas.length}</span><span class="rel-pill-lab">Festas no período</span></div>
        <div class="rel-pill"><span class="rel-pill-num">${totalItens}</span><span class="rel-pill-lab">Itens totais</span></div>
        <div class="rel-pill"><span class="rel-pill-num deficit-text">${faltando}</span><span class="rel-pill-lab">A Comprar</span></div>
        <div class="rel-pill"><span class="rel-pill-num ok-text">${estoqueOk}</span><span class="rel-pill-lab">Estoque OK</span></div>
      </div>
    `;
  }

  /* Filtros de visualização aplicados na lista exibida */
  let itens = [...todosItens];
  if (busca)      itens = itens.filter(it => it.nome.toLowerCase().includes(busca));
  if (catFiltro)  itens = itens.filter(it => it.cfg?.grupo === catFiltro);
  if (statusFiltro === 'comprar') itens = itens.filter(it => it.aComprar > 0);

  if (!itens.length) {
    let msg = 'Nenhum item encontrado para o período selecionado.';
    if (!todosItens.length && festas.length > 0) {
      msg = 'As festas deste período não têm itens cadastrados.';
    } else if (todosItens.length > 0 && statusFiltro === 'comprar') {
      msg = `Estoque OK! Todos os ${todosItens.length} itens têm quantidade suficiente. Mude o filtro para "Todos os itens" para ver a lista completa.`;
    } else if (todosItens.length > 0 && busca) {
      msg = `Nenhum item com "${_escHtml(busca)}" encontrado. Limpe a busca para ver todos os ${todosItens.length} itens.`;
    } else if (!festas.length) {
      msg = 'Nenhuma festa ativa no período selecionado. Tente "Todos Ativos".';
    }
    el.innerHTML = estadoVazio(msg);
    return;
  }

  /* Agrupar por categoria */
  const catOrdem = {};
  categoriasCache.forEach((c, i) => { catOrdem[c.nome] = c.ordem != null ? c.ordem : i + 1; });

  const grupos = {};
  itens.forEach(it => {
    const g = it.cfg?.grupo || 'Sem Categoria';
    if (!grupos[g]) grupos[g] = { ordem: catOrdem[g] ?? 999, itens: [] };
    grupos[g].itens.push(it);
  });

  const gruposOrdenados = Object.entries(grupos)
    .sort(([,a],[,b]) => a.ordem - b.ordem)
    .map(([nome, g]) => ({ nome, ...g }));

  if (_lcAba === 'sintetico') {
    el.innerHTML = gruposOrdenados.map(g => lcHtmlGrupoSintetico(g)).join('');
  } else {
    el.innerHTML = gruposOrdenados.map(g => lcHtmlGrupoAnalitico(g)).join('');
  }
}

/* ══════════════════════════════════════════════════
   SIMULAR COMPRA — estoque + o que está sendo pedido pelas
   festas ativas, com um campo de "quanto pretendo comprar" que
   calcula ao vivo a quantidade final. Não grava nada no Firestore.
══════════════════════════════════════════════════ */

async function lcAbrirSimulacao() {
  const el = document.getElementById('lc-simular-conteudo');
  if (el) el.innerHTML = '<div class="estado-vazio"><p>Calculando...</p></div>';

  try {
    await _lcCarregarBase();
    lcRenderizarSimulacao();
  } catch(e) {
    console.error(e);
    const el2 = document.getElementById('lc-simular-conteudo');
    if (el2) el2.innerHTML = estadoVazio('Erro ao carregar. Tente novamente.');
  }
}

function lcRenderizarSimulacao() {
  const el = document.getElementById('lc-simular-conteudo');
  if (!el) return;

  /* Todas as festas ativas (não concluídas) — a simulação olha para toda a
     necessidade futura, não só o recorte de período usado em "Por Evento". */
  const festas    = todasFestasCache.filter(f => f.status !== 'concluida');
  const busca     = (document.getElementById('lc-sim-busca')?.value || '').toLowerCase().trim();
  const catFiltro = document.getElementById('lc-sim-filtro-cat')?.value || '';

  let itens = _lcConstruirItens(festas);
  if (busca)     itens = itens.filter(it => it.nome.toLowerCase().includes(busca));
  if (catFiltro) itens = itens.filter(it => it.cfg?.grupo === catFiltro);

  if (!itens.length) {
    let msg = 'Nenhuma festa ativa no momento — nada para simular.';
    if (busca || catFiltro) msg = 'Nenhum item encontrado com esse filtro.';
    el.innerHTML = estadoVazio(msg);
    return;
  }

  const catOrdem = {};
  categoriasCache.forEach((c, i) => { catOrdem[c.nome] = c.ordem != null ? c.ordem : i + 1; });

  const grupos = {};
  itens.forEach(it => {
    const g = it.cfg?.grupo || 'Sem Categoria';
    if (!grupos[g]) grupos[g] = { ordem: catOrdem[g] ?? 999, itens: [] };
    grupos[g].itens.push(it);
  });

  const gruposOrdenados = Object.entries(grupos)
    .sort(([,a],[,b]) => a.ordem - b.ordem)
    .map(([nome, g]) => ({ nome, ...g }));

  el.innerHTML = gruposOrdenados.map(g => lcHtmlGrupoSimulacao(g)).join('');
}

function lcHtmlGrupoSimulacao(g) {
  const grupoKey = g.nome.replace(/[^a-z0-9]/gi,'_').toLowerCase();
  const rows = g.itens
    .slice()
    .sort((a,b) => {
      const oA = a.cfg?.ordemSeparacao ?? 999;
      const oB = b.cfg?.ordemSeparacao ?? 999;
      return oA - oB || a.nome.localeCompare(b.nome, 'pt-BR');
    })
    .map(it => {
      const compraAtual = _lcSimQtds[it.nomeKey] || 0;
      const ficaria      = it.estoque + compraAtual;
      const badgeR = it.cfg?.refrigerado ? `<span class="badge-refrigerado">Refrig.</span>` : '';

      return `
        <div class="lc-row lc-sim-row">
          <div class="lc-row-nome">${_escHtml(nomeBasDisplay(it.nome))} ${badgeR}</div>
          <div class="lc-row-num">${it.estoque} <span class="lc-row-un">${it.unidade}</span></div>
          <div class="lc-row-num">${it.qtdComprar} <span class="lc-row-un">${it.unidade}</span></div>
          <div class="lc-row-comprar">
            <input type="number" class="lc-sim-input" min="0" step="0.1" placeholder="0"
              value="${compraAtual || ''}"
              oninput="lcSimAtualizarQtd('${_esc(it.nomeKey)}', this.value, ${it.estoque}, ${it.qtdComprar}, '${_esc(it.unidade)}')" />
          </div>
          <div class="lc-row-num lc-sim-ficaria ${ficaria >= it.qtdComprar ? 'ok-text' : 'deficit-text'}" id="lc-sim-ficaria-${it.nomeKey}">
            ${ficaria} <span class="lc-row-un">${it.unidade}</span>
          </div>
        </div>
      `;
    }).join('');

  return `
    <div class="lc-grupo">
      <div class="lc-grupo-header" onclick="toggleGrupo('lc_${grupoKey}')">
        <span class="producao-grupo-seta">&#9660;</span>
        <span class="lc-grupo-nome">${_escHtml(g.nome)}</span>
      </div>
      <div class="lc-grupo-corpo" id="grupo-lc_${grupoKey}">
        <div class="lc-table-header">
          <span class="lc-row-nome">Item</span>
          <span class="lc-row-num">Estoque</span>
          <span class="lc-row-num">Pedindo</span>
          <span class="lc-row-comprar">Compra</span>
          <span class="lc-row-num">Ficaria</span>
        </div>
        ${rows}
      </div>
    </div>
  `;
}

function lcSimAtualizarQtd(nomeKey, valor, estoqueAtual, necessario, unidade) {
  const n = parseFloat(valor);
  if (isNaN(n) || n <= 0) delete _lcSimQtds[nomeKey];
  else _lcSimQtds[nomeKey] = n;

  const compra  = _lcSimQtds[nomeKey] || 0;
  const ficaria = estoqueAtual + compra;
  const el = document.getElementById(`lc-sim-ficaria-${nomeKey}`);
  if (el) {
    el.className   = `lc-row-num lc-sim-ficaria ${ficaria >= necessario ? 'ok-text' : 'deficit-text'}`;
    el.innerHTML   = `${ficaria} <span class="lc-row-un">${unidade}</span>`;
  }
}

function lcSimLimpar() {
  _lcSimQtds = {};
  lcRenderizarSimulacao();
}

function lcHtmlGrupoSintetico(g) {
  const grupoKey = g.nome.replace(/[^a-z0-9]/gi,'_').toLowerCase();
  const rows = g.itens
    .slice()
    .sort((a,b) => {
      const oA = a.cfg?.ordemSeparacao ?? 999;
      const oB = b.cfg?.ordemSeparacao ?? 999;
      return oA - oB || a.nome.localeCompare(b.nome, 'pt-BR');
    })
    .map(it => {
      /* Quantidade visível depende do filtro de fornecimento */
      let qtdVis = it.necessario;
      if (_lcFornecimento === 'romero')     qtdVis = it.qtdRomero + it.qtdOutro;
      if (_lcFornecimento === 'consignado') qtdVis = it.qtdConsignado;
      if (_lcFornecimento === 'cliente')    qtdVis = it.qtdCliente;

      const diff    = it.estoque - qtdVis;
      const pct     = qtdVis > 0 ? Math.min(100, Math.round((it.estoque / qtdVis) * 100)) : 100;
      const diffCls = diff < 0 ? 'deficit-text' : 'ok-text';
      const diffTxt = diff < 0 ? `− ${Math.abs(diff)}` : `+${diff}`;
      const badgeR  = it.cfg?.refrigerado ? `<span class="badge-refrigerado">Refrig.</span>` : '';
      const badgeP  = it.cfg?.prioridade  ? `<span class="badge-prioridade prior-${it.cfg.prioridade}">${it.cfg.prioridade}</span>` : '';

      /* Badges de fornecimento — mostra breakdown quando houver mais de um tipo */
      const fornParts = [];
      if (it.qtdRomero     > 0) fornParts.push(`<span class="lc-forn-badge lc-forn-romero">R ${it.qtdRomero}</span>`);
      if (it.qtdConsignado > 0) fornParts.push(`<span class="lc-forn-badge lc-forn-cons">C ${it.qtdConsignado}</span>`);
      if (it.qtdCliente    > 0) fornParts.push(`<span class="lc-forn-badge lc-forn-cli">Cl ${it.qtdCliente}</span>`);
      if (it.qtdOutro      > 0) fornParts.push(`<span class="lc-forn-badge lc-forn-outro">? ${it.qtdOutro}</span>`);
      const fornHtml = fornParts.length > 1 ? `<div class="lc-forn-row">${fornParts.join('')}</div>` : '';

      /* "A Comprar" só conta quando filtro é todos ou romero */
      const mostraCompra = _lcFornecimento === 'todos' || _lcFornecimento === 'romero';
      const compraHtml = mostraCompra
        ? `<div class="lc-row-comprar ${it.aComprar > 0 ? 'lc-falta' : 'lc-ok'}">
             ${it.aComprar > 0 ? `<strong>${it.aComprar} ${it.unidade}</strong>` : `OK`}
           </div>`
        : `<div class="lc-row-comprar" style="color:var(--cinza-400);font-size:12px">—</div>`;

      return `
        <div class="lc-row">
          <div class="lc-row-nome">${_escHtml(nomeBasDisplay(it.nome))} ${badgeR}${badgeP}${fornHtml}</div>
          <div class="lc-row-num">${qtdVis} <span class="lc-row-un">${it.unidade}</span></div>
          <div class="lc-row-num">${it.estoque} <span class="lc-row-un">${it.unidade}</span></div>
          <div class="lc-row-num ${diffCls}">${diffTxt}</div>
          ${compraHtml}
        </div>
        <div class="lc-row-bar">
          <div class="lc-bar-fill ${diff < 0 ? 'deficit' : 'ok'}" style="width:${pct}%"></div>
        </div>
      `;
    }).join('');

  const totalFalta = g.itens.reduce((s, it) => s + it.aComprar, 0);
  const badge = totalFalta > 0 ? `<span class="lc-grupo-badge lc-falta">${g.itens.filter(i=>i.aComprar>0).length} faltam</span>` : `<span class="lc-grupo-badge lc-ok">OK</span>`;

  return `
    <div class="lc-grupo">
      <div class="lc-grupo-header" onclick="toggleGrupo('lc_${grupoKey}')">
        <span class="producao-grupo-seta">&#9660;</span>
        <span class="lc-grupo-nome">${_escHtml(g.nome)}</span>
        ${badge}
      </div>
      <div class="lc-grupo-corpo" id="grupo-lc_${grupoKey}">
        <div class="lc-table-header">
          <span class="lc-row-nome">Item</span>
          <span class="lc-row-num">Necessário</span>
          <span class="lc-row-num">Estoque</span>
          <span class="lc-row-num">Diferença</span>
          <span class="lc-row-comprar">A Comprar</span>
        </div>
        ${rows}
      </div>
    </div>
  `;
}

const LC_FORN_LABEL = {
  romero:     { label: 'Romero',     cls: 'lc-forn-romero' },
  consignado: { label: 'Consignado', cls: 'lc-forn-cons'   },
  cliente:    { label: 'Cliente',    cls: 'lc-forn-cli'    },
  outro:      { label: 'Outro',      cls: 'lc-forn-outro'  },
};

function lcHtmlGrupoAnalitico(g) {
  const grupoKey = g.nome.replace(/[^a-z0-9]/gi,'_').toLowerCase();
  const rows = g.itens
    .slice()
    .sort((a,b) => a.nome.localeCompare(b.nome, 'pt-BR'))
    .map(it => {
      /* Mesma lógica do Sintético: o filtro de Fornecimento recalcula a
         quantidade visível e restringe as linhas de festa exibidas. */
      let qtdVis = it.necessario;
      if (_lcFornecimento === 'romero')     qtdVis = it.qtdRomero + it.qtdOutro;
      if (_lcFornecimento === 'consignado') qtdVis = it.qtdConsignado;
      if (_lcFornecimento === 'cliente')    qtdVis = it.qtdCliente;

      const diff    = it.estoque - qtdVis;
      const diffCls = diff < 0 ? 'deficit-text' : 'ok-text';
      const badgeR  = it.cfg?.refrigerado ? `<span class="badge-refrigerado">Refrig.</span>` : '';
      const mostraCompra = _lcFornecimento === 'todos' || _lcFornecimento === 'romero';

      const festasFiltradas = _lcFornecimento === 'todos'
        ? it.festas
        : it.festas.filter(f => f.forn === _lcFornecimento);

      const subRows = festasFiltradas
        .slice()
        .sort((a, b) => {
          const dA = toDate(a.festaData), dB = toDate(b.festaData);
          return (isNaN(dA) ? 0 : dA) - (isNaN(dB) ? 0 : dB);
        })
        .map(f => {
          let dataTxt = '—';
          if (f.festaData) {
            const d = toDate(f.festaData);
            if (!isNaN(d)) dataTxt = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
          }
          const fornInfo = LC_FORN_LABEL[f.forn] || LC_FORN_LABEL.outro;
          return `
            <tr>
              <td>${_escHtml(f.festaNome)}</td>
              <td>${dataTxt}</td>
              <td>${f.festaTipoEvento ? _escHtml(f.festaTipoEvento) : '—'}</td>
              <td class="lc-analitico-num">${f.festaConvidados != null ? f.festaConvidados : '—'}</td>
              <td><span class="lc-forn-badge ${fornInfo.cls}">${fornInfo.label}</span></td>
              <td class="lc-analitico-num">${f.qtd} ${it.unidade}</td>
            </tr>
          `;
        }).join('');

      return `
        <div class="lc-analitico-item">
          <div class="lc-analitico-resumo">
            <div class="lc-row-nome">${_escHtml(nomeBasDisplay(it.nome))} ${badgeR}</div>
            <div class="lc-analitico-nums">
              <span>Necessário: <strong>${qtdVis}</strong> ${it.unidade}</span>
              <span>Estoque: <strong>${it.estoque}</strong> ${it.unidade}</span>
              <span class="${diffCls}">Dif: ${diff < 0 ? '−'+Math.abs(diff) : '+'+diff}</span>
              ${mostraCompra
                ? `<span class="lc-analitico-comprar ${it.aComprar > 0 ? 'lc-falta' : 'lc-ok'}">
                     ${it.aComprar > 0 ? `Comprar: <strong>${it.aComprar} ${it.unidade}</strong>` : `Estoque OK`}
                   </span>`
                : ''}
            </div>
          </div>
          <div class="lc-analitico-tabela-wrap">
            <table class="lc-analitico-tabela">
              <colgroup>
                <col style="width:26%"><col style="width:9%"><col style="width:23%">
                <col style="width:12%"><col style="width:14%"><col style="width:16%">
              </colgroup>
              <thead>
                <tr>
                  <th>Festa</th>
                  <th>Data</th>
                  <th>Tipo de Evento</th>
                  <th class="lc-analitico-num">Convidados</th>
                  <th>De quem</th>
                  <th class="lc-analitico-num">Qtd.</th>
                </tr>
              </thead>
              <tbody>${subRows}</tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

  const totalFalta = g.itens.reduce((s, it) => s + it.aComprar, 0);
  const badge = totalFalta > 0 ? `<span class="lc-grupo-badge lc-falta">${g.itens.filter(i=>i.aComprar>0).length} faltam</span>` : `<span class="lc-grupo-badge lc-ok">OK</span>`;

  return `
    <div class="lc-grupo">
      <div class="lc-grupo-header" onclick="toggleGrupo('lc_${grupoKey}')">
        <span class="producao-grupo-seta">&#9660;</span>
        <span class="lc-grupo-nome">${_escHtml(g.nome)}</span>
        ${badge}
      </div>
      <div class="lc-grupo-corpo" id="grupo-lc_${grupoKey}">
        ${rows}
      </div>
    </div>
  `;
}

/* Reaproveita exatamente os mesmos dados/filtros da tela (_lcConstruirItens,
   filtro de Fornecimento, busca, categoria, status) pra que o CSV exportado
   sempre bata com o que está sendo exibido — nunca recalcula por conta própria. */
function lcExportarCSV() {
  const festas   = _lcFiltrarFestas();
  const busca    = (document.getElementById('lc-busca')?.value || '').toLowerCase().trim();
  const catFiltro = document.getElementById('lc-filtro-cat')?.value || '';
  const statusFiltro = document.getElementById('lc-filtro-status')?.value || 'todos';

  let todosItens = _lcConstruirItens(festas);

  if (_lcFornecimento !== 'todos') {
    todosItens = todosItens.filter(it => {
      if (_lcFornecimento === 'romero')     return it.qtdRomero     > 0 || it.qtdOutro > 0;
      if (_lcFornecimento === 'consignado') return it.qtdConsignado > 0;
      if (_lcFornecimento === 'cliente')    return it.qtdCliente    > 0;
      return true;
    });
  }

  let itens = todosItens;
  if (busca)      itens = itens.filter(it => it.nome.toLowerCase().includes(busca));
  if (catFiltro)  itens = itens.filter(it => it.cfg?.grupo === catFiltro);
  if (statusFiltro === 'comprar') itens = itens.filter(it => it.aComprar > 0);

  itens = itens.slice().sort((a,b) => {
    const ga = a.cfg?.grupo || 'ZZZ';
    const gb = b.cfg?.grupo || 'ZZZ';
    return ga.localeCompare(gb,'pt-BR') || a.nome.localeCompare(b.nome,'pt-BR');
  });

  const mostraCompra = _lcFornecimento === 'todos' || _lcFornecimento === 'romero';

  let header, rows;

  if (_lcAba === 'sintetico') {
    header = ['Categoria','Item','Unidade','Necessário','Estoque','A Comprar'];
    rows   = itens.map(it => {
      let qtdVis = it.necessario;
      if (_lcFornecimento === 'romero')     qtdVis = it.qtdRomero + it.qtdOutro;
      if (_lcFornecimento === 'consignado') qtdVis = it.qtdConsignado;
      if (_lcFornecimento === 'cliente')    qtdVis = it.qtdCliente;
      return [
        it.cfg?.grupo || 'Sem Categoria',
        nomeBasDisplay(it.nome),
        it.unidade,
        qtdVis,
        it.estoque,
        mostraCompra ? it.aComprar : '—',
      ];
    });
  } else {
    header = ['Categoria','Item','Festa','Data','Tipo de Evento','Convidados','De Quem','Qtd','Unidade'];
    rows   = [];
    itens.forEach(it => {
      const festasFiltradas = _lcFornecimento === 'todos'
        ? it.festas
        : it.festas.filter(f => f.forn === _lcFornecimento);
      festasFiltradas
        .slice()
        .sort((a, b) => {
          const dA = toDate(a.festaData), dB = toDate(b.festaData);
          return (isNaN(dA) ? 0 : dA) - (isNaN(dB) ? 0 : dB);
        })
        .forEach(f => {
          const d = toDate(f.festaData);
          const dataTxt = !isNaN(d) ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}` : '—';
          rows.push([
            it.cfg?.grupo || 'Sem Categoria',
            nomeBasDisplay(it.nome),
            f.festaNome,
            dataTxt,
            f.festaTipoEvento || '—',
            f.festaConvidados != null ? f.festaConvidados : '—',
            (LC_FORN_LABEL[f.forn] || LC_FORN_LABEL.outro).label,
            f.qtd,
            it.unidade,
          ]);
        });
    });
  }

  const csv  = [header, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const now  = new Date();
  a.href     = url;
  a.download = `lista-compras-${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSV exportado!', 'ok');
}

/* ══════════════════════════════════════════════════
   RELATÓRIO POR PERÍODO
══════════════════════════════════════════════════ */

let relPeriodoAno = new Date().getFullYear();
let relPeriodoMes = new Date().getMonth();
let abaRelAtual   = 'item';

async function abrirRelatorio() {
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
    const [, festas] = await Promise.all([
      garantirListenerEstoque(),
      todasFestasCache.length ? Promise.resolve(todasFestasCache) : buscarTodasFestas(),
    ]);
    todasFestasCache = festas;

    const inicio = new Date(relPeriodoAno, relPeriodoMes, 1);
    const fim    = new Date(relPeriodoAno, relPeriodoMes + 1, 0, 23, 59, 59);
    const festasNoPeriodo = festas.filter(f => {
      const d = toDate(f.data);
      return !isNaN(d) && d >= inicio && d <= fim;
    });

    renderizarSumarioRelatorio(festasNoPeriodo);
    if (abaRelAtual === 'item') {
      renderizarRelPorItem(festasNoPeriodo, festas, estoqueCache);
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
        <div class="rel-grupo-titulo">${_escHtml(grupo)}</div>
        ${gData.itens.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR')).map(it => htmlRelItemCard(it)).join('')}
      </div>
    `).join('');
}

function htmlRelItemCard(it) {
  const aproveit   = it.saida > 0 ? Math.round((it.retorno / it.saida) * 100) : null;
  const espCls     = it.esperado < 0 ? 'deficit-text' : 'ok-text';
  const badgeRefrig = it.cfg?.refrigerado ? `<span class="badge-refrigerado">Refrig.</span>` : '';

  return `
    <div class="rel-card">
      <div class="rel-card-header">
        <div class="rel-card-nome">${_escHtml(it.nome)} ${badgeRefrig}</div>
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
          ${_escHtml(d.festaNome)}${dataTxt?' — '+dataTxt:''}
          <span class="badge badge-${d.festaStatus}" style="font-size:9px;margin-left:4px">${_escHtml(STATUS_LABELS[d.festaStatus]||d.festaStatus)}</span>
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
            <div class="rel-festa-nome">${_escHtml(f.nome)}</div>
            <div class="rel-festa-meta">${formatarData(f.data)}${f.cliente?' · '+_escHtml(f.cliente):''}${_infoEventoTexto(f)?' · '+_infoEventoTexto(f):''}</div>
          </div>
          <span class="badge badge-${f.status}">${_escHtml(STATUS_LABELS[f.status]||f.status)}</span>
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
    const configs = Object.keys(itemConfigsCache).length ? Object.values(itemConfigsCache) : await listarItemConfigs();
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
          <div class="config-grupo-titulo">${_escHtml(grupo)}</div>
          ${itens.sort((a,b) => a.nome.localeCompare(b.nome,'pt-BR')).map(c => `
            <div class="loc-item-row">
              <div class="loc-item-info">
                <div class="loc-item-nome">${_escHtml(c.nome)}</div>
                <div class="loc-item-grupo">${_escHtml(c.grupo || '—')}</div>
              </div>
              <div class="loc-campos">
                <input class="loc-input" id="loc-setor-${c.id}"
                  placeholder="Setor / Ambiente" value="${_escHtml(c.setor || '')}" />
                <input class="loc-input" id="loc-prat-${c.id}"
                  placeholder="Prateleira" value="${_escHtml(c.prateleira || '')}" style="width:90px" />
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
          <div class="config-item-nome">${_escHtml(c.nome)}</div>
          <div class="config-item-meta">${c.ordem ? `Ordem: #${c.ordem}` : 'Sem ordem definida'}</div>
        </div>
        <div class="config-item-acoes">
          <button class="btn-icone" title="Editar" onclick="abrirFormCategoria('${c.id}')">Editar</button>
          <button class="btn-icone btn-icone-del" title="Remover" onclick="confirmarDeletarCategoria('${_esc(c.id)}','${_esc(c.nome)}')">Remover</button>
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
    document.getElementById('cat-estoque').checked   = cat.exibirEstoque   !== false;
    document.getElementById('cat-compras').checked   = cat.exibirCompras   !== false;
    historico.push('tela-form-categoria');
    mostrarTela('tela-form-categoria', 'Editar Categoria');
  } else {
    document.getElementById('cat-nome').value        = '';
    document.getElementById('cat-ordem').value       = '';
    document.getElementById('cat-separacao').checked = true;
    document.getElementById('cat-estoque').checked   = true;
    document.getElementById('cat-compras').checked   = true;
    historico.push('tela-form-categoria');
    mostrarTela('tela-form-categoria', 'Nova Categoria');
  }
}

async function salvarCategoria() {
  const nome = document.getElementById('cat-nome').value.trim();
  if (!nome) return toast('Informe o nome da categoria.', 'erro');
  const ordemStr        = document.getElementById('cat-ordem').value.trim();
  const exibirSeparacao = document.getElementById('cat-separacao').checked;
  const exibirEstoque   = document.getElementById('cat-estoque').checked;
  const exibirCompras   = document.getElementById('cat-compras').checked;
  const dados = {
    nome,
    nomeKey:          normalizarNomeItem(nome),
    ordem:            ordemStr ? parseInt(ordemStr) : 999,
    exibirSeparacao,
    exibirEstoque,
    exibirCompras,
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
   FICHAS TÉCNICAS CRUD — receita (rendimento-base + insumos) usada em
   Registrar Produção pra converter automaticamente a quantidade.
══════════════════════════════════════════════════ */
let fichasTecnicasCache = [];
let _fichaEditId        = null;
let _fichaInsumosForm   = []; /* [{nomeKey, nome, unidade, qtd}] montado no form antes de salvar */

async function renderizarFichasTecnicas() {
  const el = document.getElementById('cadastro-itens-fichas');
  if (!el) return;
  el.innerHTML = '<div class="estado-vazio"><p>Carregando...</p></div>';
  try {
    const fichas = await listarFichasTecnicas();
    fichasTecnicasCache = fichas;
    if (!fichas.length) {
      el.innerHTML = estadoVazio('Nenhuma ficha técnica cadastrada. Clique em "+ Nova Ficha" para criar a primeira.');
      return;
    }
    el.innerHTML = fichas.map(f => `
      <div class="config-item-row">
        <div class="config-item-info">
          <div class="config-item-nome">${_escHtml(f.nome)}</div>
          <div class="config-item-meta">Rendimento: ${f.rendimento} ${_escHtml(f.unidadeRendimento || '')} &nbsp;·&nbsp; ${(f.ingredientes || []).length} insumo(s)</div>
        </div>
        <div class="config-item-acoes">
          <button class="btn-icone" title="Editar" onclick="abrirFormFicha('${f.id}')">Editar</button>
          <button class="btn-icone btn-icone-del" title="Remover" onclick="confirmarDeletarFicha('${_esc(f.id)}','${_esc(f.nome)}')">Remover</button>
        </div>
      </div>
    `).join('');
  } catch(e) {
    console.error(e);
    el.innerHTML = estadoVazio('Erro ao carregar. Tente novamente.');
  }
}

async function abrirFormFicha(id) {
  _fichaEditId      = id || null;
  _fichaInsumosForm = [];

  /* Sugestão de nome pro produto final (livre — pode ser algo ainda não
     cadastrado, já que é o que vai ser produzido). Insumos, não: sempre um
     select dos itens já cadastrados, pra nunca criar um produto órfão. */
  const configs = Object.values(itemConfigsCache).length ? Object.values(itemConfigsCache) : await listarItemConfigs();
  const dlNome = document.getElementById('ficha-nome-datalist');
  if (dlNome) dlNome.innerHTML = configs.map(c => `<option value="${_esc(c.nome)}">`).join('');
  const selInsumo = document.getElementById('ficha-insumo-select');
  if (selInsumo) {
    const configsOrdenados = [...configs].sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    selInsumo.innerHTML = '<option value="">Selecione o produto...</option>' +
      configsOrdenados.map(c => `<option value="${_esc(c.nomeKey)}">${_escHtml(c.nome)}</option>`).join('');
  }

  if (id) {
    const fichas = fichasTecnicasCache.length ? fichasTecnicasCache : await listarFichasTecnicas();
    const ficha  = fichas.find(f => f.id === id);
    if (!ficha) return toast('Ficha não encontrada.', 'erro');
    document.getElementById('ficha-nome').value           = ficha.nome || '';
    document.getElementById('ficha-rendimento').value     = ficha.rendimento ?? '';
    document.getElementById('ficha-rendimento-un').value  = ficha.unidadeRendimento || '';
    document.getElementById('ficha-validade').value       = ficha.validade || '';
    document.getElementById('ficha-armazenamento').value  = ficha.localArmazenamento || '';
    document.getElementById('ficha-tempo-producao').value = ficha.tempoProducao || '';
    document.getElementById('ficha-responsavel').value    = ficha.responsavel || '';
    _fichaInsumosForm = (ficha.ingredientes || []).map(i => ({ ...i }));
    historico.push('tela-form-ficha');
    mostrarTela('tela-form-ficha', 'Editar Ficha Técnica');
    document.getElementById('form-ficha-titulo').textContent = 'Editar Ficha Técnica';
  } else {
    ['ficha-nome','ficha-rendimento','ficha-rendimento-un','ficha-validade','ficha-armazenamento','ficha-tempo-producao','ficha-responsavel']
      .forEach(id2 => { const el = document.getElementById(id2); if (el) el.value = ''; });
    historico.push('tela-form-ficha');
    mostrarTela('tela-form-ficha', 'Nova Ficha Técnica');
    document.getElementById('form-ficha-titulo').textContent = 'Nova Ficha Técnica';
  }
  const qtdI   = document.getElementById('ficha-insumo-qtd');   if (qtdI)   qtdI.value   = '';
  const precoI = document.getElementById('ficha-insumo-preco'); if (precoI) precoI.value = '';
  const unEl   = document.getElementById('ficha-insumo-un');    if (unEl)   unEl.textContent = '';
  renderizarFichaInsumosForm();
}

function fichaInsumoSelecionado(nomeKey) {
  const cfg  = Object.values(itemConfigsCache).find(c => c.nomeKey === nomeKey);
  const unEl = document.getElementById('ficha-insumo-un');
  if (unEl) unEl.textContent = cfg?.unidade || '';
}

function fichaAdicionarInsumo() {
  const selInsumo = document.getElementById('ficha-insumo-select');
  const qtdInput  = document.getElementById('ficha-insumo-qtd');
  const precoInput= document.getElementById('ficha-insumo-preco');
  const nomeKey   = selInsumo?.value || '';
  if (!nomeKey) return toast('Selecione o produto do insumo.', 'erro');
  const qtd = parseFloat(qtdInput?.value) || 0;
  if (qtd <= 0) return toast('Informe a quantidade do insumo.', 'erro');
  const preco = parseFloat(precoInput?.value) || 0;

  const cfg      = Object.values(itemConfigsCache).find(c => c.nomeKey === nomeKey);
  const unidade  = cfg?.unidade || 'un';
  const nomeReal = cfg?.nome || nomeKey;

  const existente = _fichaInsumosForm.find(i => i.nomeKey === nomeKey);
  if (existente) { existente.qtd += qtd; if (preco) existente.preco = preco; }
  else _fichaInsumosForm.push({ nomeKey, nome: nomeReal, unidade, qtd, preco });

  if (selInsumo)  selInsumo.value = '';
  if (qtdInput)   qtdInput.value  = '';
  if (precoInput) precoInput.value = '';
  const unEl = document.getElementById('ficha-insumo-un');
  if (unEl) unEl.textContent = '';
  renderizarFichaInsumosForm();
}

function fichaRemoverInsumo(nomeKey) {
  _fichaInsumosForm = _fichaInsumosForm.filter(i => i.nomeKey !== nomeKey);
  renderizarFichaInsumosForm();
}

function renderizarFichaInsumosForm() {
  const el   = document.getElementById('ficha-insumos-lista');
  const hint = document.getElementById('ficha-custo-total-hint');
  if (!el) return;
  if (!_fichaInsumosForm.length) {
    el.innerHTML = '<p style="font-size:12px;color:var(--cinza-500);padding:6px 0">Nenhum insumo adicionado ainda.</p>';
    if (hint) hint.textContent = '';
    return;
  }
  el.innerHTML = _fichaInsumosForm.map(i => {
    const custo = (i.preco || 0) * i.qtd;
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;border:1px solid #F3F4F6;border-radius:6px;margin-bottom:6px;font-size:13px">
      <span>${_escHtml(i.nome)} — <strong>${i.qtd}</strong> ${_escHtml(i.unidade)}
        ${i.preco ? `<span style="color:var(--cinza-500)"> · R$ ${i.preco.toFixed(2)}/un · custo R$ ${custo.toFixed(2)}</span>` : ''}
      </span>
      <button class="btn-secundario btn-sm" onclick="fichaRemoverInsumo('${_esc(i.nomeKey)}')" style="padding:2px 8px">Remover</button>
    </div>`;
  }).join('');

  if (hint) {
    const custoTotal = _fichaInsumosForm.reduce((soma, i) => soma + (i.preco || 0) * i.qtd, 0);
    const rendimento = parseFloat(document.getElementById('ficha-rendimento')?.value) || 0;
    hint.textContent = custoTotal
      ? `Custo total: R$ ${custoTotal.toFixed(2)}${rendimento ? ` — R$ ${(custoTotal / rendimento).toFixed(2)} por unidade de rendimento` : ''}`
      : '';
  }
}

async function salvarFichaTecnica() {
  const nome = document.getElementById('ficha-nome').value.trim();
  if (!nome) return toast('Informe o nome do produto final.', 'erro');
  const rendimento = parseFloat(document.getElementById('ficha-rendimento').value);
  if (!rendimento || rendimento <= 0) return toast('Informe o rendimento (maior que zero).', 'erro');
  const unidadeRendimento = document.getElementById('ficha-rendimento-un').value.trim() || 'un';
  if (!_fichaInsumosForm.length) return toast('Adicione pelo menos um insumo.', 'erro');

  const cfgNome  = Object.values(itemConfigsCache).find(c => normalizarNomeItem(c.nome) === normalizarNomeItem(nome));
  const nomeKey  = cfgNome ? (cfgNome.nomeKey || normalizarNomeItem(cfgNome.nome)) : normalizarNomeItem(nome);
  const nomeReal = cfgNome?.nome || nome;

  const dados = {
    nome: nomeReal,
    nomeKey,
    rendimento,
    unidadeRendimento,
    ingredientes:      _fichaInsumosForm,
    validade:          document.getElementById('ficha-validade').value.trim(),
    localArmazenamento:document.getElementById('ficha-armazenamento').value.trim(),
    tempoProducao:     document.getElementById('ficha-tempo-producao').value.trim(),
    responsavel:       document.getElementById('ficha-responsavel').value.trim(),
  };
  if (_fichaEditId) dados.id = _fichaEditId;

  try {
    await salvarFichaTecnicaDB(dados);
    toast('Ficha técnica salva.', 'sucesso');
    goBack();
    setTimeout(async () => {
      if (historico[historico.length - 1] === 'tela-cadastro-itens') await renderizarFichasTecnicas();
    }, 100);
  } catch(e) {
    console.error(e);
    toast('Erro ao salvar ficha técnica.', 'erro');
  }
}

async function confirmarDeletarFicha(id, nome) {
  if (!confirm(`Remover a ficha técnica "${nome}"?`)) return;
  try {
    await deletarFichaTecnicaDB(id);
    fichasTecnicasCache = fichasTecnicasCache.filter(f => f.id !== id);
    toast('Ficha técnica removida.', 'sucesso');
    await renderizarFichasTecnicas();
  } catch(e) {
    console.error(e);
    toast('Erro ao remover ficha técnica.', 'erro');
  }
}

/* ══════════════════════════════════════════════════
   TELA COMPRAS
══════════════════════════════════════════════════ */

async function abrirCompras() {
  await abrirListaCompras('alertas');
}

async function recarregarCompras() {
  try {
    const [cfgs, , compras] = await Promise.all([
      Object.keys(itemConfigsCache).length ? Promise.resolve(Object.values(itemConfigsCache)) : listarItemConfigs(),
      garantirListenerEstoque(),
      listarCompras(),
    ]);
    if (!Object.keys(itemConfigsCache).length) {
      itemConfigsCache = {};
      cfgs.forEach(c => { itemConfigsCache[c.nomeKey] = c; });
    }
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
    if (!deveExibirNaListaCompras(cfg)) return false;
    const qtd = estoqueCache[cfg.nomeKey]?.qtd || 0;
    return qtd < cfg.estoqueMinimo;
  }).length;
}

function _alertasCompras() {
  return Object.values(itemConfigsCache)
    .filter(cfg => cfg.estoqueMinimo != null && deveExibirNaListaCompras(cfg))
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
  /* Controla só andamento/historico (alertas é seção separada) */
  ['andamento','historico'].forEach(id => {
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
      : `<span style="color:#15803d;font-weight:700">Estoque ok</span>`;
    const jaTemPedido = comprasCache.some(c => c.nomeKey === a.nomeKey && (c.status === 'pendente' || c.status === 'pedido'));
    return `
      <div class="compra-alerta-card${cor}">
        <div class="compra-alerta-nome">${_escHtml(a.nome)}</div>
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
          <div class="compra-pedido-nome">${_escHtml(c.nome)}</div>
          <span class="compra-status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="compra-pedido-detalhe">
          Qtd solicitada: <strong>${c.qtdSolicitada} ${c.unidade || 'un'}</strong>
          &nbsp;|&nbsp; Solicitado em: ${data}
          ${c.observacao ? `<br>Obs: ${_escHtml(c.observacao)}` : ''}
        </div>
        <div class="compra-pedido-acoes">
          ${c.status === 'pendente'
            ? `<button class="btn-primario"   style="font-size:13px;padding:8px 14px" onclick="marcarComoPedido('${c.id}')">Pedido Feito</button>`
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
          <div class="compra-pedido-nome">${_escHtml(c.nome)}</div>
          <span class="compra-status-badge compra-status-recebido">Recebido</span>
        </div>
        <div class="compra-pedido-detalhe">
          Recebido: <strong>${c.qtdRecebida || c.qtdSolicitada} ${c.unidade || 'un'}</strong>
          &nbsp;|&nbsp; Data: ${dataRec}
          ${c.observacao ? `<br>Obs: ${_escHtml(c.observacao)}` : ''}
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

