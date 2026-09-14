/* ══════════════════════════════════════════════════
   CATÁLOGO — fichas de coquetéis lidas ao vivo do controle-gestao-main
   (dbGestao é read-only: esta tela é só consulta, nunca escreve nada.
   Cadastro/edição de coquetéis e fotos continua sempre no Gestão Main —
   aba Fichas / Fotos dos Coquetéis — pra não gerar duplicidade.)
══════════════════════════════════════════════════ */

let _catalogoFichasCache  = [];
let _catalogoInsumosCache = [];
let _catalogoFotoCache     = {}; /* fichaId  -> base64 | null */
let _catalogoCopoFotoCache = {}; /* insumoId -> base64 | null */

/* Mesmas categorias que o Gestão Main considera "fora da ficha técnica"
   (copo, material, equipe...) — não entram na lista de ingredientes. */
const CATALOGO_CATS_FORA = ['MATERIAL', 'DESCARTÁVEIS', 'KIT BARTENDER', 'EQUIPE', 'COPOS E TAÇAS'];

async function abrirCatalogo() {
  historico.push('tela-catalogo');
  mostrarTela('tela-catalogo', 'Catálogo');
  const inputNome   = document.getElementById('catalogo-busca-nome');
  const inputInsumo = document.getElementById('catalogo-busca-insumo');
  if (inputNome)   inputNome.value   = '';
  if (inputInsumo) inputInsumo.value = '';
  await carregarCatalogo();
}

async function carregarCatalogo() {
  const el = document.getElementById('catalogo-lista');
  if (el) el.innerHTML = estadoVazio('Carregando...');

  const [fichas, insumos] = await Promise.all([
    buscarFichasGestao(),
    buscarInsumosGestao(),
  ]);

  const indisponivel = fichas === null || insumos === null;
  const elAviso = document.getElementById('catalogo-status');
  if (elAviso) elAviso.classList.toggle('hidden', !indisponivel);

  _catalogoFichasCache  = (fichas || []).slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
  _catalogoInsumosCache = insumos || [];
  _catalogoFotoCache     = {};
  _catalogoCopoFotoCache = {};

  renderizarCatalogo();
}

function filtrarCatalogo() {
  renderizarCatalogo();
}

/* Ingredientes de uma ficha, no mesmo formato que a Ficha Técnica do Gestão
   Main usa (medida + nome) — ver _ftItemEhIngrediente/_ftLinhasIngredientes
   em controle-gestao-main/js/fichaTecnica.js. */
function _catalogoIngredientes(f) {
  return (f.itens || [])
    .filter(i => {
      if (i.foraFT === true)  return false;
      if (i.foraFT === false) return true;
      return CATALOGO_CATS_FORA.indexOf((i.cat || '').toUpperCase()) === -1;
    })
    .map(i => {
      let med = '';
      const q = parseFloat(i.qtd);
      if (i.qtd != null && i.qtd !== '' && !isNaN(q)) {
        med = q + ((i.un && i.un !== '—') ? ' ' + i.un : '');
      }
      return { nome: i.nome, med };
    });
}

function renderizarCatalogo() {
  const el = document.getElementById('catalogo-lista');
  if (!el) return;

  const termoNome   = normalizarNomeItem(document.getElementById('catalogo-busca-nome')?.value   || '');
  const termoInsumo = normalizarNomeItem(document.getElementById('catalogo-busca-insumo')?.value || '');

  const lista = _catalogoFichasCache.filter(f => {
    if (termoNome) {
      const alvo = normalizarNomeItem(f.nome) + '_' + normalizarNomeItem(f.variantes || '');
      if (alvo.indexOf(termoNome) === -1) return false;
    }
    if (termoInsumo) {
      const ingredientes = _catalogoIngredientes(f).map(i => normalizarNomeItem(i.nome)).join('_');
      if (ingredientes.indexOf(termoInsumo) === -1) return false;
    }
    return true;
  });

  if (!lista.length) {
    el.innerHTML = estadoVazio(
      _catalogoFichasCache.length
        ? 'Nenhum coquetel encontrado com esse filtro.'
        : 'Nenhum coquetel cadastrado ainda no Gestão.'
    );
    return;
  }

  el.innerHTML = lista.map(f => htmlCardCatalogo(f)).join('');

  /* Fotos carregam depois, por fora do dbGestao — não trava a renderização
     da lista (cross-project, pode ser mais lento que a leitura local). */
  lista.forEach(f => {
    _catalogoCarregarFoto(f).then(b64 => {
      if (!b64) return;
      const img   = document.getElementById('catalogo-foto-' + f.id);
      const vazio = document.getElementById('catalogo-foto-vazia-' + f.id);
      if (img)   { img.src = b64; img.classList.remove('hidden'); }
      if (vazio) vazio.classList.add('hidden');
    });
  });
}

function htmlCardCatalogo(f) {
  const ingredientes = _catalogoIngredientes(f);
  const ingrHtml = ingredientes.length
    ? ingredientes.map(i => `<div>${i.med ? `<strong>${_escHtml(i.med)}</strong> — ` : ''}${_escHtml(i.nome)}</div>`).join('')
    : '<div class="catalogo-card-vazio">Sem ingredientes cadastrados</div>';

  return `
    <div class="catalogo-card">
      <div class="catalogo-card-foto">
        <img id="catalogo-foto-${f.id}" src="" alt="${_escHtml(f.nome)}" class="hidden">
        <div id="catalogo-foto-vazia-${f.id}" class="catalogo-card-foto-vazia">sem foto</div>
      </div>
      <div class="catalogo-card-corpo">
        <div class="catalogo-card-nome">${_escHtml(f.nome)}</div>
        ${f.variantes  ? `<div class="catalogo-card-variantes">${_escHtml(f.variantes)}</div>` : ''}
        ${f.descricao  ? `<div class="catalogo-card-desc">${_escHtml(f.descricao)}</div>`       : ''}
        <div class="catalogo-card-ingr-label">Ingredientes</div>
        <div class="catalogo-card-ingr">${ingrHtml}</div>
      </div>
    </div>
  `;
}

/* Foto do coquetel pronto (fichaFoto_<id>, anexada no Gestão Main); sem foto
   própria, cai na foto do copo (mesmo insumo/foto que a Ficha Técnica de lá
   usa — insumoFoto_<id> da categoria COPOS E TAÇAS, casado pelo NOME salvo
   em f.copo). */
async function _catalogoCarregarFoto(f) {
  if (_catalogoFotoCache.hasOwnProperty(f.id)) return _catalogoFotoCache[f.id];

  let b64 = await buscarFotoFichaGestao(f.id);

  if (!b64 && f.copo) {
    const insumo = _catalogoInsumosCache.find(i => (i.nome || '').toUpperCase() === (f.copo || '').toUpperCase());
    if (insumo) {
      if (!_catalogoCopoFotoCache.hasOwnProperty(insumo.id)) {
        _catalogoCopoFotoCache[insumo.id] = await buscarFotoInsumoGestao(insumo.id);
      }
      b64 = _catalogoCopoFotoCache[insumo.id];
    }
  }

  _catalogoFotoCache[f.id] = b64 || null;
  return _catalogoFotoCache[f.id];
}
