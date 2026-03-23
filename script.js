// Normaliza string para busca: remove acentos e converte para minúsculas
function _norm(str) {
    return (str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Distância de Levenshtein entre duas strings normalizadas
function _levenshtein(a, b) {
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            matrix[i][j] = b[i-1] === a[j-1]
                ? matrix[i-1][j-1]
                : 1 + Math.min(matrix[i-1][j-1], matrix[i-1][j], matrix[i][j-1]);
        }
    }
    return matrix[b.length][a.length];
}

// Tolerância de erros proporcional ao tamanho da query
function _tolerancia(q) {
    if (q.length <= 3) return 0; // palavras curtas: só exato
    if (q.length <= 5) return 1; // até 5 letras: 1 erro
    return 2;                     // 6+ letras: 2 erros
}

// Busca fuzzy: retorna score de correspondência
// 0 = sem match | 3 = exato | 2 = 1 erro | 1 = 2 erros
function _fuzzyScore(texto, query) {
    const t = _norm(texto);
    const q = _norm(query);
    if (!q) return 3;
    // 1. Correspondência exata (substring)
    if (t.includes(q)) return 3;
    const tol = _tolerancia(q);
    if (tol === 0) return 0;
    const palavras = t.split(/\s+/);
    let melhor = 0;
    palavras.forEach(function(p) {
        if (Math.abs(p.length - q.length) > tol) return;
        const dist = _levenshtein(q, p);
        if (dist === 1 && tol >= 1) melhor = Math.max(melhor, 2);
        else if (dist === 2 && tol >= 2) melhor = Math.max(melhor, 1);
    });
    return melhor;
}

// Compatibilidade: retorna booleano para uso nos filtros
function _fuzzyMatch(texto, query) {
    return _fuzzyScore(texto, query) > 0;
}

// Conexão com Firebase RTDB (Test Mode REST API)
const FIREBASE_URL = 'https://bd-abib-8fd56-default-rtdb.firebaseio.com/';

// ==========================================
//    UTILS DE SEGURANÇA
// ==========================================
/**
 * Sanitiza uma string para uso seguro em innerHTML,
 * prevenindo ataques de Cross-Site Scripting (XSS).
 * Use sempre que inserir dados do usuário/Firebase no DOM via innerHTML.
 */
function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================
//    CONSTANTES GLOBAIS
// ==========================================
/**
 * Lista centralizada de unidades.
 * Edite APENAS AQUI para adicionar/remover unidades em todo o sistema.
 * Os <select> do HTML serão populados automaticamente por popularSelectUnidades().
 */
const UNIDADES = [
    'BARBACENA', 'CARATINGA', 'CONGONHAS', 'CONSELHEIRO LAFAIETE',
    'CURVELO', 'ITABIRA', 'JANAÚBA', 'JANUÁRIA', 'JOÃO MONLEVADE',
    'JUIZ DE FORA I', 'JUIZ DE FORA II', 'LEOPOLDINA',
    'MONTES CLAROS I', 'MONTES CLAROS II', 'MONTES CLAROS III',
    'PARACATU', 'PIRAPORA', 'SANTANA DO PARAÍSO', 'SÃO JOÃO DEL REI',
    'UBÁ', 'UNAÍ'
];

/**
 * Popula um <select> com as unidades da constante UNIDADES.
 * @param {string} selectId - ID do elemento <select>
 * @param {Object} opts - Opções: { incluiTodas, incluiTotal, selectedValue }
 */
function popularSelectUnidades(selectId, opts = {}) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const current = opts.selectedValue || sel.value;
    sel.innerHTML = '';
    if (opts.incluiTodas) {
        sel.innerHTML += `<option value="todas">Todas as Unidades</option>`;
    }
    if (opts.incluiTotal) {
        sel.innerHTML += `<option value="TOTAL">TOTAL (Geral/Impostos)</option>`;
    }
    UNIDADES.forEach(u => {
        sel.innerHTML += `<option value="${u}"${current === u ? ' selected' : ''}>${u}</option>`;
    });
}

// Arrays globais da nossa sessão atual
let prazosList = [];
let funcionariosList = [];
let gastosList = [];
let pendenciasList = []; // Array do novo Módulo de Pendências
// Configurações padrão do painel
let configGerais = {
    diasUrgente: 7,
    diasAtencao: 15,
    diasAsoUrgente: 3,
    diasAsoAtencao: 7,
    diasVencidosOcultar: 10,
    tema: 'claro',
    geminiKey: '',
    emailContabilidade: '',
    templatesEmail: {
        admissao: 'Olá, seguem os dados para registro de admissão do colaborador {NOME}, unidade {UNIDADE}, cargo {CARGO}. Admissão em {DATA}.',
        desligamento: 'Prezados, favor processar o desligamento do colaborador {NOME}, unidade {UNIDADE}. Motivo: {MOTIVO}. Último dia trabalhado: {DATA}.',
        ferias: 'Olá, solicitamos o agendamento de férias para o colaborador {NOME}, unidade {UNIDADE}. Período: {DATA_INICIO} a {DATA_FIM}.'
    },
    assuntosEmail: {
        admissao: '[RH] Solicitação de Admissão',
        desligamento: '[RH] Solicitação de Desligamento',
        ferias: '[RH] Solicitação de Férias'
    }
};

// Variáveis de ordenação e filtro
let currentSortFunc = { field: null, asc: true };
let currentSortDeslig = { field: null, asc: true };
let currentSortPend = { field: 'vencimento', asc: true }; // Padrão: prazo mais próximo primeiro
let currentSortGastos = { field: 'data', asc: false }; // Padrão mais recentes primeiro

// ==========================================
//    MODULO DE PENDENCIAS (FALLBACK RESILIENTE)
// ==========================================
function abrirModalPendencia(id = null) {
    console.log("Chamando abrirModalPendencia, ID:", id);
    const modal = document.getElementById('modal-pendencia');
    const form = document.getElementById('form-pendencia');
    const titulo = document.getElementById('modal-pendencia-titulo');

    if (!modal) {
        alert("Erro: Modal de pendência não encontrado no seu HTML. Por favor, dê CTRL+F5 para atualizar a página completamente.");
        return;
    }

    if (form) form.reset();
    if (document.getElementById('pendencia-id')) document.getElementById('pendencia-id').value = '';
    if (titulo) titulo.textContent = 'Nova Pendência';

    if (id && typeof pendenciasList !== 'undefined') {
        const item = pendenciasList.find(p => p.id === id);
        if (item) {
            if (titulo) titulo.textContent = 'Editar Pendência';
            if (document.getElementById('pendencia-id')) document.getElementById('pendencia-id').value = item.id;
            if (document.getElementById('pendencia-descricao')) document.getElementById('pendencia-descricao').value = item.descricao;
            if (document.getElementById('pendencia-categoria')) document.getElementById('pendencia-categoria').value = item.categoria;
            if (document.getElementById('pendencia-prioridade')) document.getElementById('pendencia-prioridade').value = item.prioridade;
            if (document.getElementById('pendencia-vencimento')) document.getElementById('pendencia-vencimento').value = item.vencimento || '';
            if (document.getElementById('pendencia-notificar')) document.getElementById('pendencia-notificar').checked = !!item.notificar;
        }
    }

    modal.classList.remove('hidden');
}

function fecharModalPendencia() {
    const modal = document.getElementById('modal-pendencia');
    if (modal) modal.classList.add('hidden');
}

function salvarPendencia(event) {
    event.preventDefault();
    const id = document.getElementById('pendencia-id').value;
    const descricao = document.getElementById('pendencia-descricao').value;
    const categoria = document.getElementById('pendencia-categoria').value;
    const prioridade = document.getElementById('pendencia-prioridade').value;
    const vencimento = document.getElementById('pendencia-vencimento').value;
    const notificar = document.getElementById('pendencia-notificar').checked;

    if (id) {
        const index = pendenciasList.findIndex(p => p.id === id);
        if (index !== -1) {
            pendenciasList[index] = { ...pendenciasList[index], descricao, categoria, prioridade, vencimento, notificar };
        }
    } else {
        pendenciasList.push({
            id: 'PEN_' + Date.now(),
            descricao, categoria, prioridade, vencimento, notificar,
            concluida: false,
            dataCriacao: moment().format('YYYY-MM-DD')
        });
    }

    if (typeof salvarDados === 'function') salvarDados();
    fecharModalPendencia();
    if (typeof renderPendencias === 'function') renderPendencias();
    if (typeof showToast === 'function') showToast("Pendencia salva com sucesso.", "success");
}

function concluirPendencia(id) {
    const index = pendenciasList.findIndex(p => p.id === id);
    if (index !== -1) {
        pendenciasList[index].concluida = !pendenciasList[index].concluida;
        const foiConcluida = pendenciasList[index].concluida;
        if (foiConcluida) {
            pendenciasList[index].dataConclusao = moment().format('YYYY-MM-DD');
            registrarHistorico('pendencia',
                `Pendência concluída: ${pendenciasList[index].descricao || '—'}`,
                `Categoria: ${pendenciasList[index].categoria || '—'} · Prioridade: ${pendenciasList[index].prioridade || '—'}`,
                pendenciasList[index].idFunc || ''
            );
        } else {
            pendenciasList[index].dataConclusao = null;
        }
        if (typeof salvarDados === 'function') salvarDados();
        if (typeof renderPendencias === 'function') renderPendencias();
        const msg = foiConcluida ? "Concluida!" : "Reaberta!";
        if (typeof showToast === 'function') showToast(msg, "success");
    }
}

function apagarPendencia(id) {
    if (confirm("Deseja realmente apagar esta pendência?")) {
        pendenciasList = pendenciasList.filter(p => p.id !== id);
        if (typeof salvarDados === 'function') salvarDados();
        if (typeof renderPendencias === 'function') renderPendencias();
        if (typeof showToast === 'function') showToast("Pendencia removida.", "success");
    }
}

function sortPendencias(field) {
    const campos = ['descricao', 'categoria', 'prioridade', 'vencimento'];
    if (currentSortPend.field === field) {
        currentSortPend.asc = !currentSortPend.asc;
    } else {
        currentSortPend.field = field;
        currentSortPend.asc = true;
    }

    campos.forEach(f => {
        const el = document.getElementById(`sort-pend-icon-${f}`);
        if (el) {
            el.className = 'fa-solid fa-sort';
            el.parentElement.classList.remove('active');
        }
    });

    const activeIcon = document.getElementById(`sort-pend-icon-${field}`);
    if (activeIcon) {
        activeIcon.parentElement.classList.add('active');
        activeIcon.className = currentSortPend.asc ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
    }

    renderPendencias();
}

function renderPendencias() {
    const tbody = document.getElementById('pendencias-list');
    if (!tbody) return;

    const searchTerm = document.getElementById('search-pendencias') ? _norm(document.getElementById('search-pendencias').value) : '';
    const prioridadeFiltro = document.getElementById('filter-pendencia-prioridade') ? document.getElementById('filter-pendencia-prioridade').value : 'todas';
    const verConcluidas = document.getElementById('show-concluidas') ? document.getElementById('show-concluidas').checked : false;

    tbody.innerHTML = '';

    let filtradas = pendenciasList.filter(p => {
        const matchBusca = _fuzzyMatch(p.descricao, searchTerm);
        const matchPrioridade = prioridadeFiltro === 'todas' || p.prioridade === prioridadeFiltro;
        const matchConcluida = verConcluidas ? true : !p.concluida;
        return matchBusca && matchPrioridade && matchConcluida;
    });

    const pesoPrioridade = { alta: 3, media: 2, baixa: 1 };

    if (currentSortPend.field) {
        filtradas.sort((a, b) => {
            // Concluídas sempre por último
            if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;

            const field = currentSortPend.field;
            const dir = currentSortPend.asc ? 1 : -1;

            if (field === 'vencimento') {
                // Sem prazo sempre por último, independente da direção
                if (!a.vencimento && !b.vencimento) return 0;
                if (!a.vencimento) return 1;
                if (!b.vencimento) return -1;
                return (moment(a.vencimento).valueOf() - moment(b.vencimento).valueOf()) * dir;
            }
            if (field === 'prioridade') {
                return (pesoPrioridade[a.prioridade] - pesoPrioridade[b.prioridade]) * dir;
            }
            const valA = (a[field] || '').toLowerCase();
            const valB = (b[field] || '').toLowerCase();
            if (valA < valB) return -1 * dir;
            if (valA > valB) return 1 * dir;
            return 0;
        });
    } else {
        // Sort padrão: prazo mais próximo primeiro, sem prazo por último
        filtradas.sort((a, b) => {
            if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
            if (!a.vencimento && !b.vencimento) return 0;
            if (!a.vencimento) return 1;
            if (!b.vencimento) return -1;
            return moment(a.vencimento).valueOf() - moment(b.vencimento).valueOf();
        });
    }

    let urgentes = 0;
    let concluidasTotal = pendenciasList.filter(p => p.concluida).length;

    filtradas.forEach(p => {
        if (!p.concluida && p.prioridade === 'alta') urgentes++;

        const tr = document.createElement('tr');
        if (p.concluida) tr.style.opacity = '0.6';

        let badgeCor = 'var(--primary)';
        if (p.prioridade === 'alta') badgeCor = 'var(--danger)';
        if (p.prioridade === 'media') badgeCor = 'var(--warning)';

        let vencimentoFormatado = 'Nao definido';
        let subTextoVenc = '';
        if (p.vencimento) {
            const diasFaltando = moment(p.vencimento).diff(moment().startOf('day'), 'days');
            vencimentoFormatado = moment(p.vencimento).format('DD/MM/YY');
            if (diasFaltando < 0) {
                subTextoVenc = `<br><small style="color:var(--danger)">Vencida ha ${Math.abs(diasFaltando)} dias</small>`;
            } else if (diasFaltando === 0) {
                subTextoVenc = `<br><small style="color:var(--warning)">Vence HOJE</small>`;
            } else {
                subTextoVenc = `<br><small style="color:var(--text-light)">Faltam ${diasFaltando} dias</small>`;
            }
        }

        tr.innerHTML = `
            <td>
                <button class="btn-icon" onclick="concluirPendencia('${p.id}')" title="${p.concluida ? 'Reabrir' : 'Concluir'}">
                    <i class="fa-solid ${p.concluida ? 'fa-circle-check' : 'fa-circle'}" style="color: ${p.concluida ? 'var(--success)' : 'var(--text-light)'}; font-size: 1.2rem;"></i>
                </button>
            </td>
            <td>
                <div style="font-weight: 500; ${p.concluida ? 'text-decoration: line-through;' : ''}">${esc(p.descricao)}</div>
                <small style="color: var(--text-light)">Criado em ${moment(p.dataCriacao).format('DD/MM/YY')} ${p.notificar ? ' | <i class="fa-solid fa-envelope"></i> Notif. Ativa' : ''}</small>
            </td>
            <td><span class="status-badge" style="background: rgba(148, 163, 184, 0.1); color: var(--text-main); font-weight: normal;">${esc(p.categoria)}</span></td>
            <td><span class="status-badge" style="background:transparent; border: 1px solid ${badgeCor}; color: ${badgeCor}; font-weight: 600;">${esc(p.prioridade.toUpperCase())}</span></td>
            <td>${vencimentoFormatado}${subTextoVenc}</td>
            <td class="action-buttons" style="justify-content: flex-end;">
                <button class="btn-icon btn-edit" onclick="abrirModalPendencia('${p.id}')" title="Editar"><i class="fa-solid fa-pen"></i></button>
                <button class="btn-icon btn-delete" onclick="apagarPendencia('${p.id}')" title="Excluir"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (document.getElementById('count-pendencias-abertas')) document.getElementById('count-pendencias-abertas').textContent = pendenciasList.filter(p => !p.concluida).length;
    if (document.getElementById('count-pendencias-urgentes')) document.getElementById('count-pendencias-urgentes').textContent = urgentes;
    if (document.getElementById('count-pendencias-concluidas')) document.getElementById('count-pendencias-concluidas').textContent = concluidasTotal;

    const emptyState = document.getElementById('empty-state-pendencias');
    if (emptyState) {
        if (filtradas.length === 0) emptyState.classList.remove('hidden');
        else emptyState.classList.add('hidden');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    // Calcula largura real da scrollbar e expõe como variável CSS
    // Usado para compensar o deslocamento ao abrir modais (overflow:hidden no body)
    (function() {
        var div = document.createElement('div');
        div.style.cssText = 'width:100px;height:100px;overflow:scroll;position:absolute;top:-9999px;';
        document.body.appendChild(div);
        var scrollW = div.offsetWidth - div.clientWidth;
        document.body.removeChild(div);
        document.documentElement.style.setProperty('--scrollbar-width', scrollW + 'px');
    }());

    // Fecha conexões SSE ao sair/recarregar a página, evitando memory leak
    window.addEventListener('beforeunload', fecharConexoesSSE);
    // Etapa 4: salva posições do mapa ao fechar/recarregar a página
    // Usa sendBeacon (síncrono) — fetch assíncrono não completa durante o unload
    window.addEventListener('beforeunload', function() {
        mapaSalvarTodasPosicoesBeacon();
    });

    const dataAtual = moment().format('DD [de] MMMM, YYYY');
    document.getElementById('current-date-display').textContent = dataAtual;

    // Adiciona "Carregando..." temporário nos totalizadores
    document.getElementById('count-urgentes').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    document.getElementById('count-atencao').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    document.getElementById('count-total').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    document.getElementById('deadlines-list').innerHTML = '<tr><td colspan="5" style="text-align:center"><i class="fa-solid fa-circle-notch fa-spin"></i> Conectando ao Banco de Dados na Nuvem...</td></tr>';

    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const tab = e.currentTarget.getAttribute('data-tab');
            switchTab(tab);
        });
    });

    try {
        await fetchDadosNuvem();
        atualizarTituloAba(); // badge inicial após primeiro carregamento
        agenteInit();               // Agente de Voz — inicializa após dados carregados
        // Abre tela de boas-vindas uma vez por sessão (após dados carregados)
        setTimeout(abrirBoasVindas, 800);

        // Aplicar tema logo no inicio
        if (configGerais.tema === 'escuro') document.body.classList.add('dark-theme');

        // Popula configurações na tela
        document.getElementById('cfg-dias-urgente').value = configGerais.diasUrgente;
        document.getElementById('cfg-dias-atencao').value = configGerais.diasAtencao;
        document.getElementById('cfg-aso-urgente').value = configGerais.diasAsoUrgente || 3;
        document.getElementById('cfg-aso-atencao').value = configGerais.diasAsoAtencao || 7;
        document.getElementById('cfg-tema').value = configGerais.tema || 'claro';
        document.getElementById('cfg-gemini-key').value = configGerais.geminiKey || '';
        document.getElementById('cfg-dias-vencidos').value = configGerais.diasVencidosOcultar !== undefined ? configGerais.diasVencidosOcultar : 10;
        document.getElementById('cfg-email-contabilidade').value = configGerais.emailContabilidade || '';

        document.getElementById('cfg-pdf-empresa').value = configGerais.pdfEmpresa || '';
        document.getElementById('cfg-pdf-cnpj').value = configGerais.pdfCnpj || '';

        document.getElementById('cfg-pdf-ocultar-saldos').checked = !!configGerais.pdfOcultarSaldos;
        document.getElementById('cfg-pdf-ocultar-timestamp').checked = !!configGerais.pdfOcultarTimestamp;

        // Vitrine
        const vv = configGerais.vitrineVisibilidade || {};
        document.getElementById('vitrine-funcionarios').checked = vv.funcionarios !== false;
        document.getElementById('vitrine-contratos').checked = vv.contratos !== false;
        document.getElementById('vitrine-pendencias').checked = vv.pendencias !== false;
        document.getElementById('vitrine-ponto').checked = vv.ponto !== false;
        if (configGerais.templatesEmail) {
            document.getElementById('tmpl-email-admissao').value = configGerais.templatesEmail.admissao || '';
            document.getElementById('tmpl-email-desligamento').value = configGerais.templatesEmail.desligamento || '';
            document.getElementById('tmpl-email-ferias').value = configGerais.templatesEmail.ferias || '';
        }
        if (configGerais.assuntosEmail) {
            document.getElementById('tmpl-assunto-admissao').value = configGerais.assuntosEmail.admissao || '';
            document.getElementById('tmpl-assunto-desligamento').value = configGerais.assuntosEmail.desligamento || '';
            document.getElementById('tmpl-assunto-ferias').value = configGerais.assuntosEmail.ferias || '';
        }

        recuperarFilaOcrStorage();
        renderDeadlines();
        renderGraficos();
    } catch (e) {
        showToast("Falha na conexão com o banco de dados nuvem. Operando vazio.", "error");
        renderDeadlines();
    }
});

let pontoFoiAlterado = false;
let ultimoMesAnoSelecionado = '';
let ultimoFuncSelecionado = '';
let scrollPositionListaPonto = 0;
let configFoiAlterado = false;

async function checarAlteracoesNaoSalvasPonto() {
    if (document.getElementById('view-ponto').classList.contains('active') && pontoFoiAlterado) {
        return await showConfirm("Atenção: Existem alterações não gravadas nesta Folha de Ponto.\nSe você prosseguir agora, PERDERÁ as digitações não salvas.\n\nDeseja realmente sair sem gravar a folha?");
    }
    return true;
}

async function checarAlteracoesNaoSalvasConfig() {
    const viewConfig = document.getElementById('view-configuracoes');
    if (viewConfig && viewConfig.classList.contains('active') && configFoiAlterado) {
        return await showConfirm("⚠️ Você tem alterações não salvas nas Configurações.\nSe sair agora, as mudanças serão perdidas.\n\nDeseja realmente sair sem salvar?");
    }
    return true;
}

async function switchTab(tabId, editId = null) {
    if (tabId !== 'ponto' && !(await checarAlteracoesNaoSalvasPonto())) return;
    if (tabId !== 'configuracoes' && !(await checarAlteracoesNaoSalvasConfig())) return;

    // Etapa 4: salva posições do mapa ao sair da aba
    const abaAtiva = document.querySelector('.menu-item.active');
    if (abaAtiva && abaAtiva.getAttribute('data-tab') === 'mapa' && tabId !== 'mapa') {
        mapaSalvarTodasPosicoes(); // fire-and-forget — não bloqueia navegação
    }

    // Reset de Scroll da janela (Viewport)
    window.scrollTo(0, 0);

    // Controle de View Sections
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    let activeSec = document.getElementById(`view-${tabId}`);
    if (activeSec) {
        activeSec.classList.add('active');
    }

    // Reset de Filtros Rápidos de Ponto a cada saída de Aba
    if (tabId !== 'ponto') {
        if (document.getElementById('filtro-pt-vazio')) document.getElementById('filtro-pt-vazio').checked = true;
        if (document.getElementById('filtro-pt-parcial')) document.getElementById('filtro-pt-parcial').checked = true;
        if (document.getElementById('filtro-pt-completo')) document.getElementById('filtro-pt-completo').checked = true;
        if (document.getElementById('filtro-pt-conferido')) document.getElementById('filtro-pt-conferido').checked = true;
    }

    // Disparadores específicos por aba
    document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));

    const activeMenu = document.querySelector(`.menu-item[data-tab="${tabId}"]`);
    if (activeMenu) activeMenu.classList.add('active');

    // Limpa pesquisas ao trocar de aba
    if (document.getElementById('search-prazos')) document.getElementById('search-prazos').value = '';
    if (document.getElementById('search-funcionarios')) document.getElementById('search-funcionarios').value = '';
    if (document.getElementById('search-desligados')) document.getElementById('search-desligados').value = '';


    if (tabId === 'dashboard') { renderDeadlines(); renderGraficos(); }
    if (tabId === 'historico') renderHistorico();
    if (tabId === 'funcionarios') {
        renderFuncionarios();
        if (editId) abrirModalEditFunc(editId);
    }
    if (tabId === 'desligamentos') {
        renderDesligamentos();
        if (editId) abrirModalGerenciarResc(editId);
    }
    if (tabId === 'gastos') {
        renderGastos();
        if (editId) abrirModalGasto(editId);
    }
    if (tabId === 'ponto') {
        document.getElementById('ponto-mes-ano').value = moment().format('YYYY-MM');
        // Restaura modo denso do localStorage
        try {
            const densoSalvo = localStorage.getItem('ponto_modo_denso') === '1';
            _pontoDenso = densoSalvo;
            const toggle = document.getElementById('ponto-toggle-denso');
            if (toggle) toggle.checked = densoSalvo;
        } catch(e) {}
        renderListaPonto();
        setTimeout(escutarPontosTempoReal, 0);
    }
    if (tabId === 'pendencias') {
        renderPendencias();
    }
    if (tabId === 'mapa') {
        mapaInit();
    }
    if (tabId === 'configuracoes') {
        document.getElementById('cfg-dias-urgente').value = configGerais.diasUrgente;
        document.getElementById('cfg-dias-atencao').value = configGerais.diasAtencao;
        document.getElementById('cfg-aso-urgente').value = configGerais.diasAsoUrgente || 3;
        document.getElementById('cfg-aso-atencao').value = configGerais.diasAsoAtencao || 7;
        document.getElementById('cfg-tema').value = configGerais.tema || 'claro';
        document.getElementById('cfg-gemini-key').value = configGerais.geminiKey || '';
        document.getElementById('cfg-dias-vencidos').value = configGerais.diasVencidosOcultar !== undefined ? configGerais.diasVencidosOcultar : 10;
        document.getElementById('cfg-email-contabilidade').value = configGerais.emailContabilidade || '';

        document.getElementById('cfg-pdf-empresa').value = configGerais.pdfEmpresa || '';
        document.getElementById('cfg-pdf-cnpj').value = configGerais.pdfCnpj || '';
        document.getElementById('cfg-pdf-termo').value = configGerais.pdfTermo || '';
        document.getElementById('cfg-pdf-ocultar-saldos').checked = !!configGerais.pdfOcultarSaldos;

        if (configGerais.templatesEmail) {
            document.getElementById('tmpl-email-admissao').value = configGerais.templatesEmail.admissao || '';
            document.getElementById('tmpl-email-desligamento').value = configGerais.templatesEmail.desligamento || '';
            document.getElementById('tmpl-email-ferias').value = configGerais.templatesEmail.ferias || '';
        }
        const assuntosEmail = configGerais.assuntosEmail || {};
        document.getElementById('tmpl-assunto-admissao').value = assuntosEmail.admissao || '';
        document.getElementById('tmpl-assunto-desligamento').value = assuntosEmail.desligamento || '';
        document.getElementById('tmpl-assunto-ferias').value = assuntosEmail.ferias || '';

        // Inicializa autocomplete de tags nos campos de template (uma vez por campo)
        if (typeof initTagAutocomplete === 'function') {
            [['tmpl-assunto-admissao', 'admissao'], ['tmpl-email-admissao', 'admissao'],
            ['tmpl-assunto-desligamento', 'desligamento'], ['tmpl-email-desligamento', 'desligamento'],
            ['tmpl-assunto-ferias', 'ferias'], ['tmpl-email-ferias', 'ferias']
            ].forEach(([id, tipo]) => {
                const el = document.getElementById(id);
                if (el) initTagAutocomplete(el, tipo);
            });
        }
        // Marcar como dirty quando qualquer campo for alterado
        configFoiAlterado = false; // Reseta ao entrar na aba
        const formCfg = document.getElementById('form-configuracoes');
        if (formCfg && !formCfg._dirtyListener) {
            formCfg._dirtyListener = true;
            formCfg.addEventListener('input', () => { configFoiAlterado = true; });
            formCfg.addEventListener('change', () => { configFoiAlterado = true; });
        }
    }
}


// unidsOptions foi substituído pela constante UNIDADES e pela função popularSelectUnidades()
// definidas no topo do arquivo. Use popularSelectUnidades(selectId, opts) para popular selects.













// ==== COMUNICAÇÃO FIREBASE NUVEM ====
let sseConnectionAtiva = false;
let ssePontosConnectionAtiva = false;
let isFirstLoad = true;
// Referências das conexões SSE para permitir fechamento e evitar memory leak
let sseSourceRef = null;
let ssePontosSourceRef = null;

/**
 * Fecha todas as conexões SSE abertas.
 * Chame isso antes de reabrir conexões ou ao desmontar o app.
 */
function fecharConexoesSSE() {
    if (sseSourceRef) {
        sseSourceRef.close();
        sseSourceRef = null;
        sseConnectionAtiva = false;
    }
    if (ssePontosSourceRef) {
        ssePontosSourceRef.close();
        ssePontosSourceRef = null;
        ssePontosConnectionAtiva = false;
    }
}

async function fetchDadosNuvem() {
    if (sseConnectionAtiva) return; // evita múltiplas conexões

    return new Promise((resolve, reject) => {
        const source = new EventSource(`${FIREBASE_URL}rhfacil.json`);
        sseSourceRef = source; // salva referência para fechar quando necessário
        sseConnectionAtiva = true;

        source.addEventListener('put', (e) => {
            try {
                const parsed = JSON.parse(e.data);
                if (parsed.path === "/") {
                    if (parsed.data) {
                        atualizarVariaveisComData(parsed.data);
                    }
                    if (isFirstLoad) {
                        isFirstLoad = false;
                        resolve();
                    } else {
                        reRenderizarTelasAtivas();
                    }
                } else {
                    // Update parcial (ex: /gastos/1) - Forçar um fetch comum para garantir consistência
                    syncManualFallback().then(() => {
                        if (isFirstLoad) {
                            isFirstLoad = false;
                            resolve();
                        }
                    });
                }
            } catch (err) {
                console.error("Erro SSE no parse:", err);
            }
        });

        source.addEventListener('patch', (e) => {
            syncManualFallback().then(() => {
                if (isFirstLoad) {
                    isFirstLoad = false;
                    resolve();
                }
            });
        });

        source.onerror = (err) => {
            console.error("Erro na conexão SSE do Firebase", err);
            // EventSource tenta reconectar automaticamente
            // Evitar travar o boot inicial
            if (isFirstLoad) {
                isFirstLoad = false;
                resolve();
            }
        };
    });
}

function atualizarVariaveisComData(data) {
    prazosList = data.prazos || [];
    funcionariosList = data.funcionarios || [];
    gastosList = data.gastos || [];
    pendenciasList = data.pendencias || [];

    if (data.configuracoes) {
        const novasConfig = data.configuracoes;
        const tplNuvem = novasConfig.templatesEmail || {};
        const tplPadrao = configGerais.templatesEmail || {};
        const assNuvem = novasConfig.assuntosEmail || {};
        const assPadrao = configGerais.assuntosEmail || {};

        configGerais = {
            ...configGerais,
            ...novasConfig,
            templatesEmail: {
                admissao: (tplNuvem.admissao && tplNuvem.admissao.trim()) ? tplNuvem.admissao : tplPadrao.admissao,
                desligamento: (tplNuvem.desligamento && tplNuvem.desligamento.trim()) ? tplNuvem.desligamento : tplPadrao.desligamento,
                ferias: (tplNuvem.ferias && tplNuvem.ferias.trim()) ? tplNuvem.ferias : tplPadrao.ferias
            },
            assuntosEmail: {
                admissao: (assNuvem.admissao && assNuvem.admissao.trim()) ? assNuvem.admissao : assPadrao.admissao,
                desligamento: (assNuvem.desligamento && assNuvem.desligamento.trim()) ? assNuvem.desligamento : assPadrao.desligamento,
                ferias: (assNuvem.ferias && assNuvem.ferias.trim()) ? assNuvem.ferias : assPadrao.ferias
            }
        };
    }
}

async function syncManualFallback() {
    try {
        const response = await fetch(`${FIREBASE_URL}rhfacil.json`);
        const data = await response.json();
        if (data) {
            atualizarVariaveisComData(data);
            reRenderizarTelasAtivas();
        }
    } catch (e) {
        console.error("Falha no syncManualFallback", e);
        // Só mostra toast se o SSE principal não estiver ativo —
        // falha no fallback é irrelevante quando o SSE já mantém os dados atualizados
        if (!sseConnectionAtiva) {
            showToast("Falha ao sincronizar dados com a nuvem. Verifique sua conexão.", "warning");
        }
    }
}

// ─────────────────────────────────────────────
//  TELA DE BOAS-VINDAS
// ─────────────────────────────────────────────

function abrirBoasVindas() {
    // Só abre uma vez por sessão (chave inclui a data — reseta a cada reload)
    const _bvKey = 'boasvindas_' + Date.now().toString().slice(0, -4);
    if (sessionStorage.getItem('boasvindas_visto') === _bvKey) return;
    sessionStorage.setItem('boasvindas_visto', _bvKey);

    const modal = document.getElementById('modal-boasvindas');
    if (!modal) return;
    // Atualiza título com saudação correta
    const _hora = moment().hour();
    const _saud = _hora < 12 ? 'Bom dia' : _hora < 18 ? 'Boa tarde' : 'Boa noite';
    const _tit = document.getElementById('boasvindas-titulo');
    if (_tit) _tit.innerHTML = '<i class="fa-solid fa-' + (_hora < 12 ? 'sun' : _hora < 18 ? 'cloud-sun' : 'moon') + '" style="color:' + (_hora < 12 ? '#f59e0b' : _hora < 18 ? '#fb923c' : '#818cf8') + ';margin-right:0.5rem;"></i> ' + _saud + ', resumo de hoje';
    modal.classList.remove('hidden');
    _renderBoasVindas();
}

function fecharBoasVindas() {
    const modal = document.getElementById('modal-boasvindas');
    if (modal) modal.classList.add('hidden');
}

function _renderBoasVindas() {
    const corpo = document.getElementById('boasvindas-corpo');
    if (!corpo) return;

    const hoje   = moment().startOf('day');
    const semana = moment().endOf('isoWeek');
    const urgente = configGerais.diasUrgente || 7;
    const atencao = configGerais.diasAtencao || 15;

    // ── 1. Vencimentos urgentes (hoje e esta semana) ──
    const vencUrgentes = prazosList.filter(p => {
        if (!p.dataVencimento) return false;
        const dias = moment(p.dataVencimento).diff(hoje, 'days');
        return dias >= 0 && dias <= urgente;
    }).sort((a, b) => moment(a.dataVencimento).diff(moment(b.dataVencimento)));

    const vencVencidos = prazosList.filter(p => {
        if (!p.dataVencimento) return false;
        return moment(p.dataVencimento).diff(hoje, 'days') < 0;
    }).sort((a, b) => moment(b.dataVencimento).diff(moment(a.dataVencimento)));

    // ── 2. Pendências abertas vencendo em breve ──
    const pendsUrgentes = pendenciasList.filter(p => {
        if (p.concluida || !p.vencimento) return false;
        const dias = moment(p.vencimento).diff(hoje, 'days');
        return dias <= urgente;
    }).sort((a, b) => moment(a.vencimento).diff(moment(b.vencimento)));

    // ── 3. Funcionários em aviso prévio ──
    const emAviso = funcionariosList.filter(f => f.emAvisoPrevio && f.dataFimAviso);

    // ── 4. Experiências vencendo esta semana ──
    const expVencendo = prazosList.filter(p => {
        if (p.tipoCod !== 'experiencia' || !p.dataVencimento) return false;
        const dias = moment(p.dataVencimento).diff(hoje, 'days');
        return dias >= 0 && dias <= 7;
    }).sort((a, b) => moment(a.dataVencimento).diff(moment(b.dataVencimento)));

    // Helper de seção
    function secao(icone, cor, titulo, itensHTML, vazio) {
        return '<div style="margin-bottom:1.5rem;">'
            + '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;">'
            + '<i class="fa-solid ' + icone + '" style="color:' + cor + ';font-size:0.9rem;"></i>'
            + '<span style="font-size:0.78rem;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:0.05em;">' + titulo + '</span>'
            + '</div>'
            + (itensHTML || '<p style="color:var(--text-light);font-size:0.82rem;margin:0;padding:0.4rem 0;">' + vazio + '</p>')
            + '</div>';
    }

    function itemPrazo(p) {
        const dias = moment(p.dataVencimento).diff(hoje, 'days');
        const cor  = dias < 0 ? '#dc2626' : dias === 0 ? '#dc2626' : 'var(--danger)';
        const txt  = dias < 0 ? 'Vencido há ' + Math.abs(dias) + 'd' : dias === 0 ? 'Hoje' : dias + 'd';
        const nm   = (p.nome || '').split(' (')[0].trim();
        return '<div style="display:flex;justify-content:space-between;align-items:center;'
            + 'padding:0.4rem 0.6rem;border-radius:6px;background:var(--secondary);margin-bottom:4px;">'
            + '<div><div style="font-size:0.83rem;font-weight:500;color:var(--text-main);">' + esc(nm) + '</div>'
            + '<div style="font-size:0.74rem;color:var(--text-light);">' + esc(p.tipo || p.tipoCod) + '</div></div>'
            + '<span style="font-size:0.78rem;font-weight:600;color:' + cor + ';white-space:nowrap;">' + txt + '</span>'
            + '</div>';
    }

    const todoVencHTML = [...vencVencidos, ...vencUrgentes].slice(0, 12).map(itemPrazo).join('') || null;
    const pendsHTML = pendsUrgentes.slice(0, 5).map(p => {
        const dias = moment(p.vencimento).diff(hoje, 'days');
        const cor  = dias < 0 ? '#dc2626' : 'var(--danger)';
        const txt  = dias < 0 ? 'Vencido há ' + Math.abs(dias) + 'd' : dias === 0 ? 'Hoje' : dias + 'd';
        return '<div style="display:flex;justify-content:space-between;align-items:center;'
            + 'padding:0.4rem 0.6rem;border-radius:6px;background:var(--secondary);margin-bottom:4px;">'
            + '<div><div style="font-size:0.83rem;font-weight:500;color:var(--text-main);">' + esc(p.descricao || '—') + '</div>'
            + '<div style="font-size:0.74rem;color:var(--text-light);">' + esc(p.categoria || '') + '</div></div>'
            + '<span style="font-size:0.78rem;font-weight:600;color:' + cor + ';white-space:nowrap;">' + txt + '</span>'
            + '</div>';
    }).join('') || null;

    const avisoHTML = emAviso.slice(0, 5).map(f => {
        const fim = moment(f.dataFimAviso);
        const dias = fim.diff(hoje, 'days');
        const txt = dias < 0 ? 'Encerrou há ' + Math.abs(dias) + 'd' : dias === 0 ? 'Termina hoje' : 'Termina em ' + dias + 'd';
        return '<div style="display:flex;justify-content:space-between;align-items:center;'
            + 'padding:0.4rem 0.6rem;border-radius:6px;background:var(--secondary);margin-bottom:4px;">'
            + '<div><div style="font-size:0.83rem;font-weight:500;color:var(--text-main);">' + esc(f.nome) + '</div>'
            + '<div style="font-size:0.74rem;color:var(--text-light);">' + esc(f.unidade || '') + ' · Até ' + fim.format('DD/MM') + '</div></div>'
            + '<span style="font-size:0.78rem;font-weight:600;color:var(--warning);white-space:nowrap;">' + txt + '</span>'
            + '</div>';
    }).join('') || null;

    const expHTML = expVencendo.slice(0, 5).map(itemPrazo).join('') || null;


    // Saudação e ícone dinâmicos por hora
    const hora = moment().hour();
    const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const _dias   = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
    const _meses  = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const _agora  = moment();
    const dataHoje = _dias[_agora.day()] + ', ' + _agora.date() + ' de ' + _meses[_agora.month()] + ' de ' + _agora.year();

    corpo.innerHTML =
        '<div style="margin-bottom:1.5rem;">'
        + '<div style="font-size:1rem;font-weight:600;color:var(--text-main);">' + saudacao + '!</div>'
        + '<div style="font-size:0.82rem;color:var(--text-light);">' + dataHoje + '</div>'
        + '</div>'
        + secao('triangle-exclamation', '#dc2626', 'Vencidos e urgentes', todoVencHTML, 'Nenhum prazo vencido ou urgente.')
        + secao('list-check', 'var(--primary)', 'Pendências próximas', pendsHTML, 'Nenhuma pendência vencendo em breve.')
        + secao('clock-rotate-left', 'var(--warning)', 'Em aviso prévio', avisoHTML, 'Nenhum funcionário em aviso prévio.')
        + secao('user-clock', '#3b82f6', 'Experiências vencendo esta semana', expHTML, 'Nenhuma experiência vencendo esta semana.');
}

// ─────────────────────────────────────────────
//  NOTIFICAÇÕES NO TÍTULO DA ABA
// ─────────────────────────────────────────────
function atualizarTituloAba() {
    const hoje = moment().startOf('day');
    const urgente = configGerais.diasUrgente || 7;
    const atencao = configGerais.diasAtencao || 15;
    let nUrgente = 0;
    let nAtencao = 0;

    // Conta prazos (experiências, rescisões, ASO, FGTS, férias)
    prazosList.forEach(function(p) {
        if (!p.dataVencimento) return;
        const dias = moment(p.dataVencimento).diff(hoje, 'days');
        const limUrgente = (p.tipoCod === 'aso') ? (configGerais.diasAsoUrgente || 3) : urgente;
        const limAtencao = (p.tipoCod === 'aso') ? (configGerais.diasAsoAtencao || 7)  : atencao;
        if (dias < 0 || dias <= limUrgente) nUrgente++;
        else if (dias <= limAtencao) nAtencao++;
    });

    // Conta pendências abertas com vencimento
    pendenciasList.forEach(function(p) {
        if (p.concluida || !p.vencimento) return;
        const dias = moment(p.vencimento).diff(hoje, 'days');
        if (dias < 0 || dias <= urgente) nUrgente++;
        else if (dias <= atencao) nAtencao++;
    });

    // Atualiza título
    if (nUrgente > 0 || nAtencao > 0) {
        let partes = [];
        if (nUrgente > 0) partes.push('🔴 ' + nUrgente);
        if (nAtencao  > 0) partes.push('🟡 ' + nAtencao);
        document.title = partes.join(' | ') + ' — MyABIB';
    } else {
        document.title = 'MyABIB';
    }
}

function reRenderizarTelasAtivas() {
    // Apenas repinta a tela atual (para o usuário ver a tabela ou card magicamente atualizando)
    if (document.getElementById('view-dashboard') && document.getElementById('view-dashboard').classList.contains('active')) {
        renderDeadlines();
        updateDashboardCards();
    }
    if (document.getElementById('view-funcionarios') && document.getElementById('view-funcionarios').classList.contains('active')) {
        renderFuncionarios();
    }
    if (document.getElementById('view-desligamentos') && document.getElementById('view-desligamentos').classList.contains('active')) {
        renderDesligamentos();
    }
    if (document.getElementById('view-gastos') && document.getElementById('view-gastos').classList.contains('active')) {
        renderGastos();
    }
    if (document.getElementById('view-pendencias') && document.getElementById('view-pendencias').classList.contains('active')) {
        if (typeof renderPendencias === 'function') renderPendencias();
    }
    // Sugestão 1: recalcula badges do mapa reativamente — só quando o mapa está visível
    if (_mapa.nos && _mapa.nos.length > 0 &&
        document.getElementById('view-mapa') &&
        document.getElementById('view-mapa').classList.contains('active')) {
        mapaAtualizarTodosBadges();
    }

    // Atualiza badge do título da aba
    atualizarTituloAba();
}

// Recalcula e redesenha badges de todos os nós funcionário sem re-renderizar o mapa inteiro
function mapaAtualizarTodosBadges() {
    _mapa.nos.forEach(function(no) {
        if (no.tipo !== 'funcionario') return;
        var f = funcionariosList.find(function(fn) { return fn.idFunc === no.idFunc; });
        if (!f) return;
        var novosItens = _mapaCalcularBadgesFuncionario(f);
        // Só redesenha se os badges mudaram
        var mudou = JSON.stringify(no.itens) !== JSON.stringify(novosItens);
        if (!mudou) return;
        no.itens = novosItens;
        // Atualiza dy do texto (pode ter ganhado/perdido badges)
        _mapa.root.selectAll('.mapa-no')
            .filter(function(d) { return d.id === no.id; })
            .each(function(d) {
                d3.select(this).selectAll('.mapa-badge').remove();
                d3.select(this).select('text')
                    .attr('dy', d.itens && d.itens.length > 0 ? '-8' : '0');
                var g = d3.select(this);
                var r = 26; var nb = d.itens.length; var badgeR = 6;
                d.itens.forEach(function(item, k) {
                    var totalAngle = Math.PI * 0.7;
                    var centerAngle = Math.PI / 2;
                    var startAngle = centerAngle - totalAngle / 2;
                    var angle = startAngle + (nb > 1 ? k * totalAngle / (nb - 1) : totalAngle / 2);
                    var bx = (r + 2) * Math.cos(angle);
                    var by = (r + 2) * Math.sin(angle);
                    g.append('circle')
                        .attr('class', 'mapa-badge')
                        .attr('cx', bx).attr('cy', by).attr('r', badgeR)
                        .style('fill', item.cor)
                        .style('stroke', 'var(--bg-card)')
                        .style('stroke-width', 1.5)
                        .append('title').text(item.label);
                });
            });
    });
    _mapaAtualizarContador();
}

function escutarPontosTempoReal() {
    if (ssePontosConnectionAtiva) return;

    const source = new EventSource(`${FIREBASE_URL}pontos.json`);
    ssePontosSourceRef = source; // salva referência para fechar quando necessário
    ssePontosConnectionAtiva = true;

    let _primeiroEventoPontos = true; // ignora o put inicial (dump completo do Firebase)
    source.addEventListener('put', (e) => {
        try {
            const parsed = JSON.parse(e.data);
            if (parsed.path === "/") {
                if (_primeiroEventoPontos) {
                    _primeiroEventoPontos = false;
                    return; // primeiro put é o dump inicial — ignora, cache já foi populado
                }
                pontoCache = {}; // Invalida tudo se resetar raiz (exclusão massiva)
                reRenderizarPontoTelasAtivas();
            } else {
                // Um ou mais pontos específicos alterados (path ex: "/001_2026-03")
                let subPath = parsed.path.replace(/\//g, '');
                if (subPath) {
                    invalidarCachePontoSplit(subPath);
                }
                reRenderizarPontoTelasAtivas();
            }
        } catch (err) {
            console.error(err);
        }
    });

    source.addEventListener('patch', (e) => {
        try {
            const parsed = JSON.parse(e.data);
            if (parsed.data) {
                // As keys de patch geralmente são do tipo "001_2026-03"
                for (let k of Object.keys(parsed.data)) {
                    invalidarCachePontoSplit(k);
                }
                reRenderizarPontoTelasAtivas();
            }
        } catch (err) {
            console.error(err);
        }
    });
}

function invalidarCachePontoSplit(keyDb) {
    // A chave pode vir com subpaths do Firebase: ex: "002_2026-03/12/nome" -> pegamos a primeira parte
    let parts = keyDb.split('/');
    let cleanKey = parts[0];
    if (pontoCache.hasOwnProperty(cleanKey)) {
        delete pontoCache[cleanKey];
    }
}

function reRenderizarPontoTelasAtivas() {
    if (document.getElementById('ponto-lista-container') && document.getElementById('ponto-lista-container').style.display !== 'none') {
        renderListaPonto();
    }
    // E se estiver com a modal de edição do Ponto aberta para ESSE mês, e mudaram lá?
    const detalheContainer = document.getElementById('ponto-detalhe-container');
    if (detalheContainer && !detalheContainer.classList.contains('hidden')) {
        let mesAtualPainel = document.getElementById('ponto-mes-ano').value;
        let pIdFunc = document.getElementById('ponto-detalhe-id').value;
        // Puxamos forçadamente o motor do edit novamente (vai buscar cache limpo - nuvem)
        if (pIdFunc && mesAtualPainel) {
            // Nota: chamar abrirEdicaoPonto reseta o scroll globalmente (fresno). Vamos apenas re-renderizar o DOM da grid interna
            // Como é um re-render silencioso, usamos o load raw
            atualizaDetalhePontoSilencioso(pIdFunc, mesAtualPainel);
        }
    }
}

async function atualizaDetalhePontoSilencioso(idFunc, mesAno) {
    let dadosSalvos = await fetchPontoMes(idFunc, mesAno);
    if (!dadosSalvos) dadosSalvos = {};
    const diasNoMes = moment(mesAno, 'YYYY-MM').daysInMonth();

    // Iteramos os dias do mês de 1 até fim para atualizar os values da DOM
    for (let d = 1; d <= diasNoMes; d++) {
        let saved = dadosSalvos[d];
        if (saved) {
            let elE1 = document.getElementById(`d${d}-e1`);
            let e1Folga = document.getElementById(`f${d}`);
            if (elE1) elE1.value = saved.e1 || '';
            if (document.getElementById(`d${d}-s1`)) document.getElementById(`d${d}-s1`).value = saved.s1 || '';
            if (document.getElementById(`d${d}-e2`)) document.getElementById(`d${d}-e2`).value = saved.e2 || '';
            if (document.getElementById(`d${d}-s2`)) document.getElementById(`d${d}-s2`).value = saved.s2 || '';
            if (e1Folga) e1Folga.checked = !!saved.isFolga;
        }
    }
    // Saldo
    let sManual = document.getElementById('saldo-anterior-manual');
    if (sManual) {
        sManual.value = dadosSalvos.saldoAnteriorManual || '';
    }
}

// Controle de salvamento: evita múltiplas requisições simultâneas e em rajada
let _salvandoNuvem = false;
let _debounceTimer = null;

async function salvarDadosNuvem() {
    // Se já há um salvamento em curso, aguarda ele terminar antes de tentar novamente
    if (_salvandoNuvem) return;
    _salvandoNuvem = true;

    const payload = {
        prazos: prazosList,
        funcionarios: funcionariosList,
        gastos: gastosList,
        pendencias: pendenciasList,
        configuracoes: configGerais
    };

    try {
        await fetch(`${FIREBASE_URL}rhfacil.json`, {
            method: 'PUT', // Substitui inteiramente a árvore rhfacil
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error("Erro ao salvar dados na nuvem:", error);
        showToast("Erro de conexão ao salvar na nuvem. Verifique sua internet.", "error");
    } finally {
        _salvandoNuvem = false;
    }
}

/**
 * Versão com debounce de 800ms: agrupa várias chamadas seguidas em uma única requisição.
 * Ex: salvar funcionário + gerar prazo + atualizar config em sequência → apenas 1 PUT no Firebase.
 */
function salvarDados() {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
        salvarDadosNuvem();
    }, 800);
}

function renderDeadlines() {
    const tableBody = document.getElementById('deadlines-list');
    const emptyState = document.getElementById('empty-state');
    const filter = document.getElementById('filter-type').value;
    const searchWord = document.getElementById('search-prazos') ? _norm(document.getElementById('search-prazos').value) : '';

    let urgentesCount = 0;
    let atencaoCount = 0;

    let preservedScroll = window.scrollY;
    tableBody.innerHTML = '';
    // Atualiza Labels dos Cards
    if (document.getElementById('label-urgente')) document.getElementById('label-urgente').textContent = `Próximos ${configGerais.diasUrgente} dias`;
    if (document.getElementById('label-atencao')) document.getElementById('label-atencao').textContent = `Próximos ${configGerais.diasAtencao} dias`;

    // Legacy fallback para itens testados antes da atualização de edição
    prazosList = prazosList.map(p => {
        if (!p.dataBase) { p.dataBase = p.dataVencimento; }
        return p;
    });

    const hoje = moment().startOf('day');
    const limiteVencidos = configGerais.diasVencidosOcultar !== undefined ? configGerais.diasVencidosOcultar : 10;

    // 1. Criar lista base com prazos
    let listaParaFiltrar = [...prazosList];

    // 2. Integrar Pendências com Vencimento
    if (typeof pendenciasList !== 'undefined') {
        const pendenciasComVenc = pendenciasList.filter(p => p.vencimento && !p.concluida).map(p => {
            // Busca unidade do funcionário vinculado se houver idFunc
            let unidadePend = '-';
            if (p.idFunc && typeof funcionariosList !== 'undefined') {
                const funcVinc = funcionariosList.find(f => f.idFunc === p.idFunc);
                if (funcVinc && funcVinc.unidade) unidadePend = funcVinc.unidade;
            }
            return {
                id: p.id,
                nome: p.descricao,
                valor: '',
                tipo: `Pendência(${p.categoria})`,
                tipoCod: 'pendencia',
                dataVencimento: p.vencimento,
                unidade: unidadePend,
                isPendencia: true
            };
        });
        listaParaFiltrar = [...listaParaFiltrar, ...pendenciasComVenc];
    }

    let prazosExibidos = listaParaFiltrar.filter(p => {
        // Filtro da aba superior e Pesquisa de texto
        if (filter !== 'todos' && p.tipoCod !== filter) return false;
        if (searchWord && p.nome && !_fuzzyMatch(p.nome, searchWord)) return false;

        // Filtro de tempo de vencido (Ocultar os ultrapassados)
        const dataVenc = moment(p.dataVencimento);
        const diasFaltando = dataVenc.diff(hoje, 'days');

        // Se já venceu (negativo) E o valor ABSOLUTO de dias for maior que a tolerância, esconde.
        if (diasFaltando < 0 && Math.abs(diasFaltando) > limiteVencidos) {
            return false;
        }

        return true;
    });

    if (prazosExibidos.length === 0) {
        emptyState.classList.remove('hidden');
        document.querySelector('.deadlines-table').classList.add('hidden');
    } else {
        emptyState.classList.add('hidden');
        document.querySelector('.deadlines-table').classList.remove('hidden');

        // ORDENAÇÃO POR GRUPO DE PRIORIDADE:
        // Grupo 0: vencidos (diasFaltando < 0) e sem data → topo
        // Grupo 1: badge vermelho (danger) não vencidos
        // Grupo 2: badge amarelo (warning) não vencidos
        // Grupo 3: badge verde (success) não vencidos
        // Dentro de cada grupo: ordem crescente por dias restantes
        function getGrupo(prazo) {
            if (!prazo.dataVencimento) return 0;
            const diff = moment(prazo.dataVencimento).diff(hoje, 'days');
            if (diff < 0) return 0;

            // Calcula limites iguais ao forEach abaixo
            let limiteUrgente = configGerais.diasUrgente;
            let limiteAtencao = configGerais.diasAtencao;
            if (prazo.tipoCod === 'aso' && !prazo.isPendencia) {
                limiteUrgente = configGerais.diasAsoUrgente || 3;
                limiteAtencao = configGerais.diasAsoAtencao || 7;
            }

            if (diff <= limiteUrgente) return 1;
            if (diff <= limiteAtencao) return 2;
            return 3;
        }

        prazosExibidos.sort((a, b) => {
            const grupoA = getGrupo(a);
            const grupoB = getGrupo(b);
            if (grupoA !== grupoB) return grupoA - grupoB;

            // Dentro do grupo 0: sem data fica após os vencidos; vencidos ordenam do mais antigo ao mais recente
            if (grupoA === 0) {
                if (!a.dataVencimento && !b.dataVencimento) return 0;
                if (!a.dataVencimento) return 1;
                if (!b.dataVencimento) return -1;
            }

            // Dentro dos demais grupos: dias restantes crescente
            const diffA = moment(a.dataVencimento).diff(hoje, 'days');
            const diffB = moment(b.dataVencimento).diff(hoje, 'days');
            return diffA - diffB;
        });

        prazosExibidos.forEach(prazo => {
            const dataVenc = moment(prazo.dataVencimento);
            const diasFaltando = dataVenc.diff(hoje, 'days');

            let badgeClass = 'status-success';
            let badgeText = `${diasFaltando} dias restantes`;
            let iconeBadge = '<i class="fa-solid fa-check"></i>';

            let limiteUrgente = configGerais.diasUrgente;
            let limiteAtencao = configGerais.diasAtencao;

            // Regra específica para ASO (se não for pendência)
            if (prazo.tipoCod === 'aso' && !prazo.isPendencia) {
                limiteUrgente = configGerais.diasAsoUrgente || 3;
                limiteAtencao = configGerais.diasAsoAtencao || 7;
            }

            if (diasFaltando < 0) {
                badgeClass = 'status-danger';
                badgeText = `Vencido há ${Math.abs(diasFaltando)} dias`;
                iconeBadge = '<i class="fa-solid fa-triangle-exclamation"></i>';
                urgentesCount++;
            } else if (diasFaltando <= limiteUrgente) {
                badgeClass = 'status-danger';
                badgeText = diasFaltando === 0 ? 'VENCE HOJE' : `${diasFaltando} dias restantes`;
                iconeBadge = '<i class="fa-solid fa-triangle-exclamation"></i>';
                urgentesCount++;
            } else if (diasFaltando <= limiteAtencao) {
                badgeClass = 'status-warning';
                iconeBadge = '<i class="fa-solid fa-clock"></i>';
                atencaoCount++;
            }

            let botaoEditar = `
                <button class="btn-icon btn-edit" onclick="direcionarEdicao('${prazo.id}')" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
            `;

            const dadosEmail = {
                nome: prazo.nome,
                unidade: prazo.unidade || 'N/A',
                data: dataVenc.format('DD/MM/YYYY'),
                tipo: prazo.tipo
            };
            let botaoEmail = `
                <button class="btn-icon" style="color: #3b82f6;" onclick="abrirModalEmail('${prazo.tipoCod || 'geral'}', ${JSON.stringify(dadosEmail).replace(/"/g, '&quot;')})" title="Enviar p/ RH">
                    <i class="fa-solid fa-envelope"></i>
                </button>
            `;

            if (prazo.isPendencia) {
                botaoEditar = `
                    <button class="btn-icon btn-edit" onclick="abrirModalPendencia('${prazo.id}')" title="Editar Pendência">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                `;
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="status-badge ${badgeClass}">${iconeBadge} ${esc(badgeText)}</span></td>
                <td>
                    <strong>${prazo.nome ? esc(prazo.nome) : '<em style="opacity: 0.5;">Sem descrição</em>'}</strong> ${prazo.valor ? '- ' + esc(prazo.valor) : ''}
                    ${(() => {
                        // Remove unidade do campo tipo para experiências antigas salvas no Firebase
                        if (prazo.tipoCod === 'experiencia' && prazo.tipo) {
                            prazo._tipoExibir = prazo.tipo.replace(/\s*-\s*[A-ZÁÉÍÓÚÂÊÔÃÕÀÜÇ\s]+$/i, '').trim();
                        } else {
                            prazo._tipoExibir = prazo.tipo;
                        }
                        return '';
                    })()}
                    ${(() => {
                        // Tenta obter unidade: primeiro do próprio prazo, depois busca pelo nome do funcionário
                        let unid = prazo.unidade && prazo.unidade !== '-' && prazo.unidade !== 'N/A' ? prazo.unidade : null;
                        if (!unid && prazo.nome && typeof funcionariosList !== 'undefined') {
                            const nomeBase = prazo.nome.split(' (')[0].trim().toLowerCase();
                            const funcEncontrado = funcionariosList.find(f => (f.nome || '').trim().toLowerCase() === nomeBase);
                            if (funcEncontrado) unid = funcEncontrado.unidade;
                        }
                        return unid ? `<br><small style="color:var(--text-light);white-space:nowrap;">${esc(unid)}</small>` : '';
                    })()}
                </td>
                <td>${esc(prazo._tipoExibir || prazo.tipo)}</td>
                <td>${dataVenc.format('DD/MM/YYYY')}</td>
                <td class="action-buttons">
                    ${botaoEmail}
                    ${(prazo.tipoCod === 'experiencia' && diasFaltando <= 0) ? `
                        <button class="btn-icon btn-success" onclick="efetivarFuncionario('${prazo.id}')" title="Efetivar Agora">
                            <i class="fa-solid fa-user-check"></i>
                        </button>
                    ` : ''}

                    ${botaoEditar}
                    <button class="btn-icon btn-delete" onclick="excluirQualquerPrazo('${prazo.id}', ${!!prazo.isPendencia})" title="Excluir">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    document.getElementById('count-urgentes').textContent = urgentesCount;
    document.getElementById('count-atencao').textContent = atencaoCount;
    document.getElementById('count-total').textContent = prazosExibidos.length;
}

async function excluirPrazo(id) {
    if (await showConfirm('Tem certeza que deseja excluir / marcar como concluído esse prazo?')) {
        let prazoExcluido = prazosList.find(p => p.id === id);
        if (prazoExcluido) {
            // Sincronizando: se apagarem pelo dashboard, dá baixa automática na aba de Desligamentos.
            let funcAso = funcionariosList.find(f => f.idPrazoAso === id);
            if (funcAso) {
                funcAso.asoFeito = true;
                funcAso.idPrazoAso = null;
            }

            let funcFgts = funcionariosList.find(f => f.idPrazoFgts === id);
            if (funcFgts) {
                funcFgts.fgtsPago = true;
                funcFgts.idPrazoFgts = null;
            }
        }

        if (prazoExcluido) registrarHistorico('prazo',
            `Prazo concluído: ${prazoExcluido.nome || prazoExcluido.tipo || '—'}`,
            `Vencimento: ${prazoExcluido.dataVencimento ? moment(prazoExcluido.dataVencimento).format('DD/MM/YY') : '—'}`
        );
        prazosList = prazosList.filter(p => p.id !== id);
        salvarDados();
        renderDeadlines();

        if (document.getElementById('view-desligamentos').classList.contains('active')) {
            renderDesligamentos();
        }

        showToast("Prazo concluído/excluído com sucesso.", "success");
    }
}

function excluirQualquerPrazo(id, isPendencia) {
    if (isPendencia) {
        if (typeof concluirPendencia === 'function') {
            concluirPendencia(id);
            // O concluirPendencia já sincroniza com renderDeadlines automaticamente
        }
    } else {
        excluirPrazo(id);
    }
}

// ==== CONFIGURAÇÕES ====
function salvarCFG(e) {
    e.preventDefault();
    const urg = parseInt(document.getElementById('cfg-dias-urgente').value);
    const ate = parseInt(document.getElementById('cfg-dias-atencao').value);
    const asoU = parseInt(document.getElementById('cfg-aso-urgente').value);
    const asoA = parseInt(document.getElementById('cfg-aso-atencao').value);
    const temaEscolhido = document.getElementById('cfg-tema').value;
    const toleranciaVenc = parseInt(document.getElementById('cfg-dias-vencidos').value);
    const geminiKey = document.getElementById('cfg-gemini-key').value.trim();
    const emailCont = document.getElementById('cfg-email-contabilidade').value.trim();

    const pdfEmpresa = document.getElementById('cfg-pdf-empresa').value.trim();
    const pdfCnpj = document.getElementById('cfg-pdf-cnpj').value.trim();

    const pdfOcultarSaldos = document.getElementById('cfg-pdf-ocultar-saldos').checked;
    const pdfOcultarTimestamp = document.getElementById('cfg-pdf-ocultar-timestamp').checked;

    // Templates
    const tAdmissao = document.getElementById('tmpl-email-admissao').value;
    const tDesligamento = document.getElementById('tmpl-email-desligamento').value;
    const tFerias = document.getElementById('tmpl-email-ferias').value;
    const aAdmissao = document.getElementById('tmpl-assunto-admissao').value;
    const aDesligamento = document.getElementById('tmpl-assunto-desligamento').value;
    const aFerias = document.getElementById('tmpl-assunto-ferias').value;

    if (urg >= ate) {
        showToast("O alerta Amarelo (Atenção) deve ser MAIOR que o alerta Vermelho (Urgente).", "warning");
        return;
    }

    if (asoU >= asoA) {
        showToast("O alerta Amarelo de ASO deve ser MAIOR que o alerta Vermelho de ASO.", "warning");
        return;
    }

    configGerais.diasUrgente = urg;
    configGerais.diasAtencao = ate;
    configGerais.diasAsoUrgente = asoU;
    configGerais.diasAsoAtencao = asoA;
    configGerais.tema = temaEscolhido;
    configGerais.diasVencidosOcultar = toleranciaVenc;
    configGerais.geminiKey = geminiKey;
    configGerais.emailContabilidade = emailCont;
    configGerais.pdfEmpresa = pdfEmpresa;
    configGerais.pdfCnpj = pdfCnpj;

    configGerais.pdfOcultarSaldos = pdfOcultarSaldos;
    configGerais.pdfOcultarTimestamp = pdfOcultarTimestamp;
    configGerais.vitrineVisibilidade = {
        funcionarios: document.getElementById('vitrine-funcionarios').checked,
        contratos: document.getElementById('vitrine-contratos').checked,
        pendencias: document.getElementById('vitrine-pendencias').checked,
        ponto: document.getElementById('vitrine-ponto').checked
    };
    configGerais.templatesEmail = {
        admissao: tAdmissao,
        desligamento: tDesligamento,
        ferias: tFerias
    };
    configGerais.assuntosEmail = {
        admissao: aAdmissao,
        desligamento: aDesligamento,
        ferias: aFerias
    };

    salvarDados(); // Agora manda para a Nuvem de forma central

    if (temaEscolhido === 'escuro') {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }

    configFoiAlterado = false; // Limpa flag de alterações não salvas
    showToast('Configurações salvas com sucesso!', 'success');
    renderDeadlines(); // Atualiza painel por baixo
}

// Função para rotear a edição correta vindo do painel central
function direcionarEdicao(id) {
    const prazo = prazosList.find(p => p.id === id);
    if (!prazo) return;

    if (prazo.tipoCod === 'experiencia') {
        const func = funcionariosList.find(f => f.idPrazoVinculado === id);
        if (func) {
            switchTab('funcionarios', func.idFunc);
            return;
        }
    }

    if (['rescisao', 'aso', 'fgts'].includes(prazo.tipoCod)) {
        // Tenta achar o funcionário pelo nome (removendo os sufixos de parênteses)
        let nomeLimpo = prazo.nome.split(' (')[0];
        const func = funcionariosList.find(f => f.nome === nomeLimpo);
        if (func) {
            switchTab('desligamentos', func.idFunc);
            return;
        }
    }

    // Se não for nenhum caso especial, abre modal genérico na mesma aba (Dashboard)
    abrirModalEdicao(id);
}

// ==== EDIÇÃO DE REGISTROS ====
function abrirModalEdicao(id) {
    const prazo = prazosList.find(p => p.id === id);
    if (!prazo) return;

    document.getElementById('edit-id').value = prazo.id;
    document.getElementById('edit-nome').value = prazo.nome;
    document.getElementById('edit-tipo-cod').value = prazo.tipoCod;

    const area = document.getElementById('edit-dynamic-fields');
    let htmlContent = '';

    if (prazo.tipoCod === 'experiencia') {
        htmlContent = `
    <div class="form-group row" >
                <div class="col">
                    <label>Data de Admissão</label>
                    <input type="date" id="edit-data-base" value="${prazo.dataBase}" required>
                </div>
                <div class="col">
                    <label>Prazo Inicial</label>
                    <select id="edit-prazo-inicial" disabled title="Para alterar, exclua e crie um novo">
                        <option value="${prazo.prazoInicial}" selected>${prazo.prazoInicial || 45} dias</option>
                    </select>
                </div>
            </div>
            
            <div class="form-group">
                <div class="checkbox-wrapper">
                    <input type="checkbox" id="edit-prorrogado" ${prazo.prorrogado ? 'checked' : ''} onchange="toggleEditProrrogacao()">
                    <label for="edit-prorrogado" style="margin:0; cursor:pointer; color:var(--primary); font-weight:700;">Houve Prorrogação do Contrato?</label>
                </div>
            </div>

            <div id="edit-area-prorrogacao" class="${prazo.prorrogado ? '' : 'hidden'} form-group row" style="background:var(--secondary); padding:1.5rem; border-radius:8px; border:1px solid var(--border);">
                <div class="col">
                    <label>Tipo de Prorrogação</label>
                    <select id="edit-tipo-prorroga" onchange="toggleEditDiasExtras()">
                        <option value="limite" ${!prazo.diasProrrogadosManuais ? 'selected' : ''}>Prorrogar até o limite de 90 dias</option>
                        <option value="personalizado" ${prazo.diasProrrogadosManuais ? 'selected' : ''}>Adicionar mais dias manualmente</option>
                    </select>
                </div>
                <div class="col" id="edit-col-dias-extras" style="display:${prazo.diasProrrogadosManuais ? 'block' : 'none'};">
                    <label>Dias Extras Adicionais:</label>
                    <input type="number" id="edit-dias-prorroga" value="${prazo.diasProrrogadosManuais || ''}">
                </div>
            </div>
`;
    } else if (prazo.tipoCod === 'ferias') {
        htmlContent = `
    <div class="form-group row" >
        <div class="col">
            <label>Data Final do Período Aquisitivo</label>
            <input type="date" id="edit-data-base" value="${prazo.dataBase}" required>
        </div>
            </div>
    `;
    } else if (prazo.tipoCod === 'rescisao') {
        htmlContent = `
    <div class="form-group row" >
        <div class="col">
            <label>Data do Desligamento / Início do Aviso</label>
            <input type="date" id="edit-data-base" value="${prazo.dataBase}" required>
        </div>
            </div>
    ${prazo.tipoAvisoLocal === 'trabalhado' ? `
            <div class="form-group row">
                <div class="col">
                    <label>Opção de Redução de Jornada</label>
                    <select id="edit-reducao">
                        <option value="nao_definido" ${(!prazo.reducao || prazo.reducao === 'nao_definido') ? 'selected' : ''}>Não definido / Não se aplica</option>
                        <option value="7_dias" ${prazo.reducao === '7_dias' ? 'selected' : ''}>Sair 7 dias antes</option>
                        <option value="2_horas" ${prazo.reducao === '2_horas' ? 'selected' : ''}>Sair 2 horas mais cedo por dia</option>
                    </select>
                </div>
            </div>` : ''
            }
<div class="form-group row">
    <div class="col">
        <label>Lançamentos / Descontos na Rescisão (Opcional)</label>
        <input type="text" id="edit-lancamentos" value="${prazo.lancamentos || ''}" placeholder="Ex: Faltas injustificadas, adiantamento">
    </div>
</div>
`;
    } else if (prazo.tipoCod === 'pagamento') {
        htmlContent = `
    <div class="form-group row" >
                <div class="col">
                    <label>Data do Pagamento</label>
                    <input type="date" id="edit-data-base" value="${prazo.dataBase}" required>
                </div>
                <div class="col">
                    <label>Valor (Para controle)</label>
                    <input type="text" id="edit-valor-extra" value="${prazo.valor || ''}">
                </div>
            </div>
    <div class="form-group row">
        <div class="col">
            <label>Dias de Antecedência pra Agenda:</label>
            <input type="number" id="edit-dias-aviso" value="${prazo.diasAviso || 0}" required>
        </div>
    </div>
`;
    }

    area.innerHTML = htmlContent;
    document.getElementById('modal-editar').classList.remove('hidden');
}

function fecharModal() {
    document.getElementById('modal-editar').classList.add('hidden');
}

function toggleEditProrrogacao() {
    const isChecked = document.getElementById('edit-prorrogado').checked;
    document.getElementById('edit-area-prorrogacao').classList.toggle('hidden', !isChecked);
}
function toggleEditDiasExtras() {
    const tipo = document.getElementById('edit-tipo-prorroga').value;
    document.getElementById('edit-col-dias-extras').style.display = (tipo === 'personalizado') ? 'block' : 'none';
}

function salvarEdicao(e) {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const tipoCod = document.getElementById('edit-tipo-cod').value;
    const nome = document.getElementById('edit-nome').value;
    const dataBase = document.getElementById('edit-data-base').value;

    let index = prazosList.findIndex(p => p.id === id);
    if (index === -1) return;

    let prazo = prazosList[index];
    prazo.nome = nome;
    prazo.dataBase = dataBase;

    const momentoBase = moment(dataBase);

    if (tipoCod === 'experiencia') {
        const prorrogado = document.getElementById('edit-prorrogado').checked;
        prazo.prorrogado = prorrogado;

        // Pega valor original ou padrão
        let prazoIni = prazo.prazoInicial || 45;

        if (prorrogado) {
            const tipoPro = document.getElementById('edit-tipo-prorroga').value;
            let diasAdd = 0;
            if (tipoPro === 'limite') {
                diasAdd = 90 - prazoIni;
                prazo.diasProrrogadosManuais = null;
            } else {
                diasAdd = parseInt(document.getElementById('edit-dias-prorroga').value || 0);
                prazo.diasProrrogadosManuais = diasAdd;
            }
            prazo.tipo = `Experiência(Prorrogação ${prazoIni} + ${diasAdd}d)`;
            prazo.dataVencimento = momentoBase.clone().add(prazoIni + diasAdd, 'days').format('YYYY-MM-DD');
        } else {
            prazo.tipo = `Experiência(${prazoIni}d)`;
            prazo.diasProrrogadosManuais = null;
            prazo.dataVencimento = momentoBase.clone().add(prazoIni, 'days').format('YYYY-MM-DD');
        }
    } else if (tipoCod === 'ferias') {
        prazo.dataVencimento = momentoBase.clone().add(11, 'months').format('YYYY-MM-DD');
    } else if (tipoCod === 'rescisao') {
        const reducaoEl = document.getElementById('edit-reducao');
        if (reducaoEl) prazo.reducao = reducaoEl.value;
        const lancamentosEl = document.getElementById('edit-lancamentos');
        if (lancamentosEl) prazo.lancamentos = lancamentosEl.value;

        let isTrabalhado = prazo.tipoAvisoLocal === 'trabalhado';
        let diasParaPagamento = isTrabalhado ? 40 : 10;
        prazo.dataVencimento = momentoBase.clone().add(diasParaPagamento, 'days').format('YYYY-MM-DD');
    } else if (tipoCod === 'pagamento') {
        prazo.valor = document.getElementById('edit-valor-extra').value;
        prazo.diasAviso = parseInt(document.getElementById('edit-dias-aviso').value || 0);
        prazo.dataVencimento = dataBase;
    }

    salvarDados();
    fecharModal();
    renderDeadlines();

    // Sincroniza de volta para a ficha do funcionário (se for um prazo de experiência atrelado)
    let syncFuncRequired = false;
    for (let f = 0; f < funcionariosList.length; f++) {
        if (funcionariosList[f].idPrazoVinculado === id) {
            funcionariosList[f].nome = nome;
            funcionariosList[f].admissao = dataBase;
            syncFuncRequired = true;
            break;
        } else if (funcionariosList[f].nome === prazo.nome && tipoCod !== 'experiencia') {
            // Se mudou o nome em qualquer outro prazo e bate com um funcionario, por coerência altera lá tb
            funcionariosList[f].nome = nome;
            syncFuncRequired = true;
        }
    }

    if (syncFuncRequired) {
        salvarDados();
        renderFuncionarios();
    }
}

// ==== EXPORTAÇÃO DE AGENDA ====
function exportarAgenda(id) {
    const prazo = prazosList.find(p => p.id === id);
    if (!prazo) return;

    const momVencimento = moment(prazo.dataVencimento);
    const dateStr = momVencimento.format('YYYYMMDD');

    let reminderMinutes = 24 * 60;
    if (prazo.tipoCod === 'pagamento' && prazo.diasAviso) {
        reminderMinutes = prazo.diasAviso * 24 * 60;
    } else if (prazo.tipoCod === 'ferias') {
        reminderMinutes = 30 * 24 * 60;
    } else if (prazo.tipoCod === 'experiencia') {
        reminderMinutes = 5 * 24 * 60;
    }

    const icsMSG = `BEGIN: VCALENDAR
VERSION: 2.0
PRODID: -//RH Facil//Gestor de Prazos//PT-BR
    BEGIN: VEVENT
UID:${prazo.id} @rhfacil
DTSTAMP:${moment().format('YYYYMMDDTHHmmss')} Z
DTSTART; VALUE = DATE:${dateStr}
DTEND; VALUE = DATE:${dateStr}
SUMMARY:VENCIMENTO RH: ${prazo.nome}
DESCRIPTION:Esse é um lembrete automático gerado pelo RH Fácil para: ${prazo.tipo}. ${prazo.valor ? 'Valor Ref: ' + prazo.valor : ''}
BEGIN: VALARM
TRIGGER: -PT${reminderMinutes} M
ACTION: DISPLAY
DESCRIPTION:Lembrete de Vencimento
END: VALARM
END: VEVENT
END: VCALENDAR`;

    const blob = new Blob([icsMSG], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', `prazo_${prazo.nome.replace(/\s+/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==== GESTÃO DE FUNCIONÁRIOS ====
function sortFuncionarios(field) {
    if (currentSortFunc.field === field) {
        currentSortFunc.asc = !currentSortFunc.asc;
    } else {
        currentSortFunc.field = field;
        currentSortFunc.asc = true;
    }

    // Reset icons
    ['nome', 'unidade', 'admissao', 'status'].forEach(f => {
        let el = document.getElementById(`sort - icon - ${f} `);
        if (el) {
            el.className = 'fa-solid fa-sort';
            el.parentElement.classList.remove('active');
        }
    });

    let activeIcon = document.getElementById(`sort - icon - ${field} `);
    if (activeIcon) {
        activeIcon.parentElement.classList.add('active');
        activeIcon.className = currentSortFunc.asc ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
    }

    renderFuncionarios();
}

function renderFuncionarios() {
    const tableBody = document.getElementById('funcionarios-list');
    const emptyState = document.getElementById('empty-state-func');
    const filter = document.getElementById('filter-unidade').value;
    const searchWord = document.getElementById('search-funcionarios') ? _norm(document.getElementById('search-funcionarios').value) : '';

    let preservedScroll = window.scrollY;
    tableBody.innerHTML = '';

    // Legacy fix
    if (!funcionariosList) funcionariosList = [];

    let funcsExibidos = funcionariosList.filter(f => {
        let matchUnidade = filter === 'todas' || f.unidade === filter;
        let matchSearch = true;
        if (searchWord && f.nome) {
            matchSearch = _fuzzyMatch(f.nome, searchWord);
        }
        return matchUnidade && matchSearch;
    });

    // Pré-calcula dias restantes para quem tem prazo vinculado (para o sort e para renderizar)
    const hojeParaCalc = moment().startOf('day');
    funcsExibidos.forEach(func => {
        func._diasParaVencer = 99999; // Default (Efetivado / Nao tem prazo)
        func._temPrazo = false;
        if (func.idPrazoVinculado) {
            const prInfo = prazosList.find(p => p.id === func.idPrazoVinculado);
            if (prInfo) {
                const diasRestantesCalc = moment(prInfo.dataVencimento).diff(hojeParaCalc, 'days');
                if (diasRestantesCalc >= 0) {
                    func._diasParaVencer = diasRestantesCalc;
                    func._temPrazo = true;
                }
            }
        }
    });

    // Ordena por score de busca se há termo digitado (exatos primeiro)
    if (searchWord) {
        funcsExibidos.sort((a, b) => _fuzzyScore(b.nome, searchWord) - _fuzzyScore(a.nome, searchWord));
    }

    if (currentSortFunc.field) {
        funcsExibidos.sort((a, b) => {
            if (currentSortFunc.field === 'status') {
                // Prazo real tem prioridade (vem no topo) quando _diasParaVencer < 99999

                // Indeterminados ou recém-criados devem ficar sempre no final da lista
                if (a._diasParaVencer === 99999 && b._diasParaVencer !== 99999) return 1;
                if (b._diasParaVencer === 99999 && a._diasParaVencer !== 99999) return -1;
                if (a._diasParaVencer === 99999 && b._diasParaVencer === 99999) return 0;

                // Ordem ascendente/descendente para quem de fato está no prazo de experiência
                if (a._diasParaVencer < b._diasParaVencer) return currentSortFunc.asc ? -1 : 1;
                if (a._diasParaVencer > b._diasParaVencer) return currentSortFunc.asc ? 1 : -1;
                return 0; // Empate
            }

            let valA = a[currentSortFunc.field];
            let valB = b[currentSortFunc.field];

            if (currentSortFunc.field === 'admissao') {
                valA = moment(a.admissao).valueOf();
                valB = moment(b.admissao).valueOf();
            } else {
                valA = valA ? valA.toLowerCase() : '';
                valB = valB ? valB.toLowerCase() : '';
            }

            if (valA < valB) return currentSortFunc.asc ? -1 : 1;
            if (valA > valB) return currentSortFunc.asc ? 1 : -1;
            return 0;
        });
    }

    if (funcsExibidos.length === 0) {
        emptyState.classList.remove('hidden');
        document.querySelector('#view-funcionarios .deadlines-table').classList.add('hidden');
    } else {
        emptyState.classList.add('hidden');
        document.querySelector('#view-funcionarios .deadlines-table').classList.remove('hidden');

        funcsExibidos.forEach(func => {
            const dataAdm = moment(func.admissao);
            const hoje = moment().startOf('day');

            let statusBadge = '';

            if (func.desligado) {
                let txtComplementar = '';
                if (func.dataDesligamento) {
                    txtComplementar = ` em ${moment(func.dataDesligamento).format('DD/MM/YYYY')} `;
                }

                if (func.motivoDesligamento) {
                    statusBadge = `
    <span class="custom-tooltip-container" >
                            <span class="status-badge status-danger" style="cursor:help;">Desligado${txtComplementar}</span>
                            <span class="custom-tooltip-text">${func.motivoDesligamento}</span>
                        </span>
    `;
                } else {
                    statusBadge = `<span class="status-badge status-danger" > Desligado${txtComplementar}</span> `;
                }
            } else if (func.emAvisoPrevio) {
                let txtFim = func.dataFimAviso ? moment(func.dataFimAviso).format('DD/MM/YYYY') : '';
                statusBadge = `
    <span class="custom-tooltip-container" >
                        <span class="status-badge status-warning" style="cursor:help;">Cumprindo Aviso até ${txtFim}</span>
                        <span class="custom-tooltip-text">Aviso Trabalhado: ${func.motivoDesligamento}</span>
                    </span>
    `;
            } else if (dataAdm.isAfter(hoje)) {
                statusBadge = `<span class="status-badge status-info">Admissão prevista para ${dataAdm.format('DD/MM/YYYY')}</span>`;
            } else if (func.idPrazoVinculado) {
                const prazoInfo = prazosList.find(p => p.id === func.idPrazoVinculado);
                if (prazoInfo) {
                    const dataFimExt = moment(prazoInfo.dataVencimento);
                    const diasFaltandoExp = dataFimExt.startOf('day').diff(hoje, 'days');

                    if (diasFaltandoExp < 0) {
                        statusBadge = '<span class="status-badge status-success">Efetivado (Prazo Indeterminado)</span>';
                    } else {
                        statusBadge = `<span class="status-badge status-warning">Em experiência (Até ${dataFimExt.format('DD/MM/YYYY')} - ${diasFaltandoExp}d restantes)</span>`;
                    }
                } else {
                    statusBadge = '<span class="status-badge status-success">Efetivado (Prazo Indeterminado)</span>';
                }
            } else {
                statusBadge = '<span class="status-badge status-success">Efetivado (Prazo Indeterminado)</span>';
            }

            const dadosEmailFunc = {
                nome: func.nome,
                unidade: func.unidade,
                data: func.admissao ? moment(func.admissao).format('DD/MM/YYYY') : '',
                cargo: func.funcao || 'N/A'
            };

            const tr = document.createElement('tr');
            if (func.desligado) tr.classList.add('row-desligado');

            tr.innerHTML = `
                <td><strong>${esc(func.nome)}</strong><br><small style="color:var(--text-light)">CPF: ${esc(func.cpf)}</small></td>
                <td>${esc(func.funcao)}</td>
                <td>${esc(func.unidade)}</td>
                <td>
                    ${dataAdm.format('DD/MM/YYYY')}
                    ${func.admissao ? (() => {
                        const inicio = moment(func.admissao);
                        const fim = func.desligado && func.dataDesligamento ? moment(func.dataDesligamento) : moment();
                        const anos  = fim.diff(inicio, 'years');  inicio.add(anos, 'years');
                        const meses = fim.diff(inicio, 'months'); inicio.add(meses, 'months');
                        const dias  = fim.diff(inicio, 'days');
                        const tempo = anos > 0 ? anos + 'a ' + meses + 'm'
                                    : meses > 0 ? meses + 'm ' + dias + 'd'
                                    : dias + 'd';
                        return '<br><small style="color:var(--text-light);">' + tempo + '</small>';
                    })() : ''}
                </td>
                <td>${statusBadge}</td>
                <td class="action-buttons">
                    <button class="btn-icon" style="color: #3b82f6;" onclick="abrirModalEmail('admissao', ${JSON.stringify(dadosEmailFunc).replace(/"/g, '&quot;')})" title="Enviar p/ RH">
                        <i class="fa-solid fa-envelope"></i>
                    </button>
                    ${!func.desligado ? (
                    func.emAvisoPrevio ? `
                            <button class="btn-icon btn-edit" onclick="reverterAvisoPrevio('${func.idFunc}')" title="Reverter Aviso Prévio">
                                <i class="fa-solid fa-rotate-left"></i>
                            </button>
                            <button class="btn-icon btn-success" onclick="efetivarDesligamentoAviso('${func.idFunc}')" title="Baixar como Desligado Hoje">
                                <i class="fa-solid fa-check-double"></i>
                            </button>
                        ` : `
                            <button class="btn-icon btn-delete" onclick="abrirModalDesligamento('${func.idFunc}')" title="Desligar Funcionário">
                                <i class="fa-solid fa-user-minus"></i>
                            </button>
                        `
                ) : ''
                }
                ${(func.desligado || func.emAvisoPrevio) ? `
                    <button class="btn-icon btn-edit" onclick="abrirModalEditarDesligamento('${func.idFunc}')" title="Editar Desligamento" style="color:var(--warning);">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                ` : ''}
                    <button class="btn-icon btn-edit" onclick="abrirModalEditFunc('${func.idFunc}')" title="Editar Funcionário">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon btn-delete" onclick="excluirFuncionario('${func.idFunc}')" title="Excluir Funcionário">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
    `;
            tableBody.appendChild(tr);
        });
    }

    // Atualiza o contador de Funcionários exibidos
    const elContador = document.getElementById('count-funcionarios-aba');
    if (elContador) elContador.textContent = funcsExibidos.length;

    window.scrollTo(0, preservedScroll);
}

async function excluirFuncionario(idFunc) {
    if (await showConfirm('Deseja realmente excluir este funcionário e todos os prazos vinculados a ele (como Experiência, Férias e Rescisão)?')) {
        let index = funcionariosList.findIndex(f => f.idFunc === idFunc);
        if (index === -1) return;

        const funcNome = funcionariosList[index].nome;
        const idPrazoVinc = funcionariosList[index].idPrazoVinculado;

        funcionariosList.splice(index, 1);

        // Remove prazos vinculados com base nos atributos do funcionario
        prazosList = prazosList.filter(p =>
            p.id !== idPrazoVinc &&
            p.nome !== funcNome &&
            p.nome !== funcNome + " (Rescisão)" &&
            p.nome !== funcNome + " (Exame Demissional)"
        );
        salvarDados();

        renderFuncionarios();
        renderDeadlines();
        showToast("Funcionário e seus vínculos foram completamente apagados.", "success");
    }
}

// ==== DESLIGAMENTO DE FUNCIONÁRIO ====
function abrirModalDesligamento(idFunc) {
    const func = funcionariosList.find(f => f.idFunc === idFunc);
    if (!func) return;
    document.getElementById('deslig-func-id').value = idFunc;
    document.getElementById('deslig-tipo').value = "";
    document.getElementById('deslig-data').value = "";
    document.getElementById('deslig-lancamentos').value = "";
    toggleDesligamentoOptions();
    document.getElementById('modal-desligamento').classList.remove('hidden');
}

function fecharModalDesligamento() {
    document.getElementById('modal-desligamento').classList.add('hidden');
    // Restaura modo padrão
    const modoEl = document.getElementById('deslig-modo');
    if (modoEl) modoEl.value = 'novo';
    const titulo = document.querySelector('#modal-desligamento .modal-header h2');
    if (titulo) titulo.textContent = 'Desligar Colaborador';
    const btnSubmit = document.getElementById('deslig-btn-submit');
    if (btnSubmit) {
        btnSubmit.style.backgroundColor = 'var(--danger)';
        btnSubmit.innerHTML = '<i class="fa-solid fa-user-minus"></i> Confirmar Desligamento';
    }
}

// Abre o modal de desligamento em modo edição, pré-populado com dados atuais
function abrirModalEditarDesligamento(idFunc) {
    const func = funcionariosList.find(f => f.idFunc === idFunc);
    if (!func) return;

    // Preenche campos com dados atuais
    document.getElementById('deslig-func-id').value = idFunc;
    document.getElementById('deslig-modo').value = 'editar';

    // Determina tipo atual: aviso trabalhado ou desligado direto
    const tipoAtual = func.motivoDesligamento ? (() => {
        const sel = document.getElementById('deslig-tipo');
        for (let opt of sel.options) {
            if (opt.text === func.motivoDesligamento) return opt.value;
        }
        return '';
    })() : '';
    document.getElementById('deslig-tipo').value = tipoAtual;

    // Aviso prévio
    if (func.emAvisoPrevio && func.dataInicioAviso) {
        document.getElementById('deslig-aviso').value = 'trabalhado';
        document.getElementById('deslig-data').value = func.dataInicioAviso;
    } else {
        document.getElementById('deslig-aviso').value = 'indenizado';
        document.getElementById('deslig-data').value = func.dataDesligamento || '';
    }

    // Redução (se tinha aviso trabalhado)
    const reducaoAtual = (() => {
        const prazoResc = prazosList.find(p => p.id === func.idPrazoRescisao);
        return prazoResc ? (prazoResc.reducao || 'nao_definido') : 'nao_definido';
    })();
    document.getElementById('deslig-reducao').value = reducaoAtual;

    // Lançamentos
    const prazoResc = prazosList.find(p => p.id === func.idPrazoRescisao);
    document.getElementById('deslig-lancamentos').value = prazoResc ? (prazoResc.lancamentos || '') : '';

    toggleDesligamentoOptions();

    // Muda visual do modal para modo edição
    const titulo = document.querySelector('#modal-desligamento .modal-header h2');
    if (titulo) titulo.textContent = 'Editar Desligamento';
    const btnSubmit = document.getElementById('deslig-btn-submit');
    if (btnSubmit) {
        btnSubmit.style.backgroundColor = 'var(--primary)';
        btnSubmit.innerHTML = '<i class="fa-solid fa-save"></i> Salvar Alterações';
    }

    document.getElementById('modal-desligamento').classList.remove('hidden');
}

function toggleDesligamentoOptions() {
    const tipo = document.getElementById('deslig-tipo').value;
    const areaAviso = document.getElementById('area-aviso-previo');
    const colReducao = document.getElementById('col-reducao');
    const labelData = document.getElementById('label-data-deslig');
    const tipoAviso = document.getElementById('deslig-aviso').value;

    if (tipo === 'pedido_demissao' || tipo === 'sem_justa_causa') {
        areaAviso.classList.remove('hidden');
        if (tipoAviso === 'trabalhado') {
            colReducao.classList.remove('hidden');
            labelData.innerText = "Data de Início do Aviso";
        } else {
            colReducao.classList.add('hidden');
            labelData.innerText = "Data do Desligamento (Imediato)";
        }
    } else {
        areaAviso.classList.add('hidden');
        labelData.innerText = "Data do Desligamento";
    }
}

function salvarDesligamento(e) {
    e.preventDefault();
    const idFunc = document.getElementById('deslig-func-id').value;
    const funcIndex = funcionariosList.findIndex(f => f.idFunc === idFunc);
    if (funcIndex === -1) return;

    const func = funcionariosList[funcIndex];
    const modoEdicao = document.getElementById('deslig-modo')?.value === 'editar';

    // Modo edição: remove prazos anteriores de rescisão, ASO e FGTS antes de recalcular
    if (modoEdicao) {
        const idsAntigos = [func.idPrazoRescisao, func.idPrazoAso, func.idPrazoFgts].filter(Boolean);
        prazosList = prazosList.filter(p => !idsAntigos.includes(p.id));
        // Limpa também prazos vinculados pelo nome (rescisão, ASO demissional, FGTS)
        prazosList = prazosList.filter(p => {
            const nomeBase = (p.nome || '').split(' (')[0].trim().toLowerCase();
            const tiposDeslig = ['rescisao', 'aso', 'fgts'];
            return !(nomeBase === func.nome.trim().toLowerCase() && tiposDeslig.includes(p.tipoCod));
        });
        // Limpa flags de aviso prévio antes de recalcular
        func.emAvisoPrevio = false;
        func.dataInicioAviso = null;
        func.dataFimAviso = null;
        func.diasAvisoTrabalhado = null;
        func.idPrazoRescisao = null;
        func.idPrazoAso = null;
        func.idPrazoFgts = null;
    }
    const tipo = document.getElementById('deslig-tipo').value;
    const tipoAviso = document.getElementById('deslig-aviso').value;
    const reducao = document.getElementById('deslig-reducao').value;
    const dataInicial = document.getElementById('deslig-data').value;
    const lancamentos = document.getElementById('deslig-lancamentos').value;

    // Calcula prazo e dias proporcionais de Aviso Trabalhado
    let isTrabalhado = (tipo === 'pedido_demissao' || tipo === 'sem_justa_causa') && (tipoAviso === 'trabalhado');

    let anosTrabalhados = moment(dataInicial).diff(moment(func.admissao), 'years');
    if (isNaN(anosTrabalhados) || anosTrabalhados < 0) anosTrabalhados = 0;

    let diasAvisoBase = 30 + (anosTrabalhados * 3);
    if (diasAvisoBase > 90) diasAvisoBase = 90;
    // D-1 no prazo de pagamento para fôlego do RH: 9 dias legais da guia
    let diasParaPagamento = isTrabalhado ? diasAvisoBase + 9 : 9;

    let momentoBase = moment(dataInicial);
    let dataVencimento = momentoBase.clone().add(diasParaPagamento, 'days').format('YYYY-MM-DD');

    let nomeMotivo = document.querySelector(`#deslig-tipo option[value='${tipo}']`).text;

    let novoPrazo = {
        id: Date.now().toString(),
        nome: func.nome + " (Rescisão)",
        tipoCod: 'rescisao',
        dataBase: dataInicial,
        tipo: `Rescisão - ${nomeMotivo} `,
        tipoAvisoLocal: (tipo === 'pedido_demissao' || tipo === 'sem_justa_causa') ? tipoAviso : null,
        reducao: isTrabalhado ? reducao : null,
        lancamentos: lancamentos,
        dataVencimento: dataVencimento
    };

    prazosList.push(novoPrazo);

    // Gerar Prazo de ASO Demissional apenas se for contrato Efetivado (Indeterminado)
    let prazoAsoId = null;
    let periodoExperienciaAtivo = false;

    // Tipos de término de contrato de experiência — não geram ASO demissional
    const tiposExperiencia = ['termino_final', 'antecipado_colaborador', 'antecipado_empresa'];
    if (tiposExperiencia.includes(tipo)) {
        periodoExperienciaAtivo = true; // Sinaliza que não precisa de ASO
    } else if (func.idPrazoVinculado) {
        let prazoExp = prazosList.find(p => p.id === func.idPrazoVinculado && p.tipoCod === 'experiencia');
        if (prazoExp) {
            let vencimentoExp = moment(prazoExp.dataVencimento, 'YYYY-MM-DD').startOf('day');
            let diaDesligamento = moment(dataInicial, 'YYYY-MM-DD').startOf('day');
            if (diaDesligamento.isSameOrBefore(vencimentoExp)) {
                periodoExperienciaAtivo = true;
            }
        }
    }

    if (!periodoExperienciaAtivo) {
        let asoId = 'ASO_' + Date.now().toString();
        prazoAsoId = asoId;

        // Prazos para ASO demissional geralmente são 10 dias do desligamento independente do aviso.
        // Contudo, se for aviso trabalhado proporcional, o ASO deve ser feito ANTES do último dia útil do aviso.

        let diasAso = isTrabalhado ? (diasAvisoBase - 1) : 10;
        let dataVencAso = momentoBase.clone().add(diasAso, 'days').format('YYYY-MM-DD');

        let prazoAso = {
            id: asoId,
            nome: func.nome + " (Exame Demissional)",
            tipoCod: 'aso',
            dataBase: dataInicial,
            tipo: `ASO Demissional Pendente`,
            dataVencimento: dataVencAso
        };
        prazosList.push(prazoAso);
    }

    // Gerar Prazo de FGTS da Rescisão
    let prazoFgtsId = 'FGTS_' + Date.now().toString();
    let prazoFgts = {
        id: prazoFgtsId,
        nome: func.nome + " (Recolhimento FGTS)",
        tipoCod: 'fgts',
        dataBase: dataInicial,
        tipo: `Guia de FGTS / Multa da Rescisão`,
        dataVencimento: dataVencimento // Mesma da rescisão
    };
    prazosList.push(prazoFgts);

    // Remove qualquer outro prazo de experiência ou férias do funcionário (limpando o painel para este funcionário)
    let prazosRemovidos = prazosList.filter(p => !(p.id === novoPrazo.id || p.id === prazoAsoId || p.id === prazoFgtsId || (p.nome !== func.nome && p.id !== func.idPrazoVinculado)));
    func.backupPrazos = prazosRemovidos;

    prazosList = prazosList.filter(p => p.id === novoPrazo.id || p.id === prazoAsoId || p.id === prazoFgtsId || (p.nome !== func.nome && p.id !== func.idPrazoVinculado));

    if (isTrabalhado) {
        func.emAvisoPrevio = true;
        func.dataInicioAviso = dataInicial;
        func.diasAvisoTrabalhado = diasAvisoBase; // Grava para reuso de recriação
        func.dataFimAviso = momentoBase.clone().add(diasAvisoBase, 'days').format('YYYY-MM-DD');
        func.desligado = false;
    } else {
        func.emAvisoPrevio = false;
        func.desligado = true;
        func.dataDesligamento = dataInicial;
    }

    func.idPrazoRescisao = novoPrazo.id;
    func.motivoDesligamento = nomeMotivo;
    func.docStatus = 'Pendente Contabilidade';
    func.asoRequerido = prazoAsoId !== null;
    func.asoFeito = false;
    func.idPrazoAso = prazoAsoId;
    func.fgtsPago = false;
    func.idPrazoFgts = prazoFgtsId;

    salvarDados(); // Dispara atualização de toda a base lá na Nuvem.

    fecharModalDesligamento();
    renderFuncionarios();
    renderDeadlines();
    if (document.getElementById('view-desligamentos').classList.contains('active')) {
        renderDesligamentos();
    }
    registrarHistorico('desligamento',
        `Desligamento: ${func.nome}`,
        `Unidade: ${func.unidade} · Motivo: ${nomeMotivo} · Data: ${moment(dataInicial).format('DD/MM/YY')}`,
        func.idFunc
    );
    showToast(modoEdicao ? 'Desligamento atualizado e prazos recalculados com sucesso!' : 'Desligamento registrado e prazo de rescisão calculado com sucesso!', 'success');
}

// ==== ABA DE DESLIGAMENTOS E ASO ====
function sortDesligados(field) {
    if (currentSortDeslig.field === field) {
        currentSortDeslig.asc = !currentSortDeslig.asc;
    } else {
        currentSortDeslig.field = field;
        currentSortDeslig.asc = true;
    }

    ['nome', 'unidade', 'data_desligamento'].forEach(f => {
        const el = document.getElementById(`sort-deslig-icon-${f}`);
        if (el) {
            el.className = 'fa-solid fa-sort';
            el.parentElement.classList.remove('active');
        }
    });

    const activeIcon = document.getElementById(`sort-deslig-icon-${field}`);
    if (activeIcon) {
        activeIcon.parentElement.classList.add('active');
        activeIcon.className = currentSortDeslig.asc ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
    }

    renderDesligamentos();
}

function renderDesligamentos() {
    const tableBody = document.getElementById('desligamentos-list');
    const emptyState = document.getElementById('empty-state-deslig');
    const searchWord = document.getElementById('search-desligados') ? _norm(document.getElementById('search-desligados').value) : '';

    tableBody.innerHTML = '';

    const exibirConcluidas = document.getElementById('show-deslig-concluidas')?.checked || false;

    const isConcluido = (f) => (f.docStatus === 'Resgisão Paga' || f.docStatus === 'Resgisão Paga') &&
        (!f.asoRequerido || f.asoFeito) && f.fgtsPago;

    // Checagem correta de concluído
    const ehConcluido = (f) => {
        const rescPaga = f.docStatus === 'Rescisão Paga';
        const asoOk = !f.asoRequerido || f.asoFeito;
        const fgtsOk = !!f.fgtsPago;
        return rescPaga && asoOk && fgtsOk;
    };

    let desligadosExibidos = funcionariosList.filter(f => {
        if (!f.desligado && !f.emAvisoPrevio) return false;
        if (!exibirConcluidas && ehConcluido(f)) return false;
        if (searchWord && f.nome && !_fuzzyMatch(f.nome, searchWord)) return false;
        return true;
    });

    if (currentSortDeslig.field) {
        desligadosExibidos.sort((a, b) => {
            let valA = a[currentSortDeslig.field];
            let valB = b[currentSortDeslig.field];

            if (currentSortDeslig.field === 'data_desligamento') {
                valA = a.dataDesligamento ? moment(a.dataDesligamento).valueOf() : 0;
                valB = b.dataDesligamento ? moment(b.dataDesligamento).valueOf() : 0;
            } else {
                valA = valA ? valA.toLowerCase() : '';
                valB = valB ? valB.toLowerCase() : '';
            }

            if (valA < valB) return currentSortDeslig.asc ? -1 : 1;
            if (valA > valB) return currentSortDeslig.asc ? 1 : -1;
            return 0;
        });
    }

    if (desligadosExibidos.length === 0) {
        emptyState.classList.remove('hidden');
        document.querySelector('#view-desligamentos .deadlines-table').classList.add('hidden');
    } else {
        emptyState.classList.add('hidden');
        document.querySelector('#view-desligamentos .deadlines-table').classList.remove('hidden');

        desligadosExibidos.forEach(func => {
            const tr = document.createElement('tr');

            const dadosEmailDeslig = {
                nome: func.nome,
                unidade: func.unidade,
                data: func.dataDesligamento ? moment(func.dataDesligamento).format('DD/MM/YYYY') : '',
                motivo: func.motivoDesligamento || 'Não informado'
            };

            let dataDesligFmt = '-';
            if (func.desligado && func.dataDesligamento) {
                dataDesligFmt = moment(func.dataDesligamento).format('DD/MM/YYYY');
            } else if (func.emAvisoPrevio && func.dataFimAviso) {
                dataDesligFmt = `<span style= "color: var(--warning); font-weight: 600;" > <i class="fa-solid fa-clock-rotate-left"></i> Aviso Trabalhado(Até ${moment(func.dataFimAviso).format('DD/MM')})</span> `;
            }

            // Badge Documento
            let docBadgeClass = 'status-warning';
            if (func.docStatus === 'Aguardando Assinatura') docBadgeClass = 'status-warning';
            else if (func.docStatus === 'Assinado - Pendente Pagamento') docBadgeClass = 'status-info'; // Azul
            else if (func.docStatus === 'Rescisão Paga') docBadgeClass = 'status-success'; // Verde
            else docBadgeClass = 'status-danger';

            let docBadge = `<span class="status-badge ${docBadgeClass}" > ${func.docStatus || 'Pendente Contabilidade'}</span> `;

            // Badge ASO
            let asoBadge = '';
            if (func.asoRequerido) {
                if (func.asoFeito) {
                    asoBadge = `<span class="status-badge status-success" > Realizado</span> `;
                } else {
                    asoBadge = `<span class="status-badge status-danger" > Pendente</span> `;
                }
            } else {
                asoBadge = `<span class="status-badge" style= "background:var(--secondary);color:var(--text-light)" > Não se Aplica</span> `;
            }

            // Badge FGTS
            let fgtsBadge = '';
            if (func.fgtsPago) {
                fgtsBadge = `<span class="status-badge status-success" > Pago</span> `;
            } else {
                fgtsBadge = `<span class="status-badge status-danger" > Pendente</span> `;
            }

            tr.innerHTML = `
    <td><strong>${esc(func.nome)}</strong><br>
        <small style="color:var(--text-light);white-space:nowrap;">CPF: ${esc(func.cpf)}</small>
        ${func.motivoDesligamento ? `<br><small style="color:var(--primary);font-weight:500;">${esc(func.motivoDesligamento)}</small>` : ''}
    </td>
                <td>${esc(func.funcao)}</td>
                <td>${esc(func.unidade)}</td>
                <td>${dataDesligFmt}</td>
                <td>${docBadge}</td>
                <td>${asoBadge}</td>
                <td>${fgtsBadge}</td>
                <td class="action-buttons">
                    <button class="btn-icon" style="color: #3b82f6;" onclick="abrirModalEmail('desligamento', ${JSON.stringify(dadosEmailDeslig).replace(/"/g, '&quot;')})" title="Enviar p/ RH">
                        <i class="fa-solid fa-envelope"></i>
                    </button>
                    <button class="btn-icon btn-edit" onclick="abrirModalEditarDesligamento('${func.idFunc}')" title="Editar dados do desligamento">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon" onclick="abrirModalGerenciarResc('${func.idFunc}')" title="Atualizar Status" style="color:var(--primary);">
                        <i class="fa-solid fa-list-check"></i>
                    </button>
                </td>
    `;
            tableBody.appendChild(tr);
        });
    }
    window.scrollTo(0, preservedScroll);
}

function abrirModalGerenciarResc(idFunc) {
    const func = funcionariosList.find(f => f.idFunc === idFunc);
    if (!func) return;

    document.getElementById('resc-func-id').value = idFunc;
    document.getElementById('resc-doc-status').value = func.docStatus || 'Pendente Contabilidade';

    const areaAso = document.getElementById('area-aso-resc');
    const chkAso = document.getElementById('resc-aso-feito');

    if (func.asoRequerido) {
        areaAso.classList.remove('hidden');
        chkAso.checked = !!func.asoFeito;
    } else {
        areaAso.classList.add('hidden');
        chkAso.checked = false;
    }

    document.getElementById('resc-fgts-pago').checked = !!func.fgtsPago;

    document.getElementById('modal-gerenciar-resc').classList.remove('hidden');
}

function fecharModalGerenciarResc() {
    document.getElementById('modal-gerenciar-resc').classList.add('hidden');
}

function salvarStatusResc(e) {
    e.preventDefault();
    const idFunc = document.getElementById('resc-func-id').value;
    const func = funcionariosList.find(f => f.idFunc === idFunc);
    if (!func) return;

    func.docStatus = document.getElementById('resc-doc-status').value;

    if (func.asoRequerido) {
        const asoAgoraFeito = document.getElementById('resc-aso-feito').checked;

        // Se ASO tava pendente e agora foi feito (marcado true)
        if (!func.asoFeito && asoAgoraFeito) {
            func.asoFeito = true;
            // Remover prazo de ASO do Dashboard!
            prazosList = prazosList.filter(p => p.id !== func.idPrazoAso);
            func.idPrazoAso = null;
        } else if (func.asoFeito && !asoAgoraFeito) {
            // Se desmarcou... vamos recriar o prazo pra hj (logica simples de reversao)
            func.asoFeito = false;
            let novoPrazoAso = Date.now().toString() + "_rev";
            func.idPrazoAso = novoPrazoAso;
            let avisoDiasBase = func.diasAvisoTrabalhado ? func.diasAvisoTrabalhado : 30;
            let asoDias = func.emAvisoPrevio ? avisoDiasBase - 1 : 10;
            let baseCalculoAso = func.emAvisoPrevio ? func.dataInicioAviso : func.dataDesligamento;
            let dataAsoIso = baseCalculoAso ? moment(baseCalculoAso).clone().add(asoDias, 'days').format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');

            prazosList.push({
                id: novoPrazoAso,
                nome: func.nome + " (Exame Demissional)",
                tipoCod: 'aso',
                dataBase: baseCalculoAso || moment().format('YYYY-MM-DD'),
                tipo: `ASO Demissional Pendente`,
                dataVencimento: dataAsoIso
            });
        }
    }

    const fgtsAgoraPago = document.getElementById('resc-fgts-pago').checked;

    if (!func.fgtsPago && fgtsAgoraPago) {
        func.fgtsPago = true;
        prazosList = prazosList.filter(p => p.id !== func.idPrazoFgts);
        func.idPrazoFgts = null;
    } else if (func.fgtsPago && !fgtsAgoraPago) {
        func.fgtsPago = false;
        let novoPrazoFgts = Date.now().toString() + "_revFgts";
        func.idPrazoFgts = novoPrazoFgts;

        let avisoDiasBase = func.diasAvisoTrabalhado ? func.diasAvisoTrabalhado : 30;
        let fgtsDias = func.emAvisoPrevio ? avisoDiasBase + 9 : 9;
        let baseCalculoFgts = func.emAvisoPrevio ? func.dataInicioAviso : func.dataDesligamento;
        let dataFgtsIso = baseCalculoFgts ? moment(baseCalculoFgts).clone().add(fgtsDias, 'days').format('YYYY-MM-DD') : moment().format('YYYY-MM-DD');

        prazosList.push({
            id: novoPrazoFgts,
            nome: func.nome + " (Recolhimento FGTS)",
            tipoCod: 'fgts',
            dataBase: baseCalculoFgts || moment().format('YYYY-MM-DD'),
            tipo: `Guia de FGTS / Multa da Rescisão`,
            dataVencimento: dataFgtsIso
        });
    }
    if (func.docStatus === 'Rescisão Paga' && func.idPrazoRescisao) {
        prazosList = prazosList.filter(p => p.id !== func.idPrazoRescisao);
        func.idPrazoRescisao = null;
    }

    // Registra mudanças de status no histórico
    const asoAgoraFeito2 = func.asoRequerido ? document.getElementById('resc-aso-feito')?.checked : null;
    const fgtsAgoraPago2 = document.getElementById('resc-fgts-pago')?.checked;
    const docStatusNovo  = document.getElementById('resc-doc-status')?.value;
    if (docStatusNovo) registrarHistorico('desligamento', func.nome, 'Doc: ' + docStatusNovo, func.idFunc);
    if (asoAgoraFeito2 !== null) registrarHistorico('desligamento', func.nome, 'ASO: ' + (asoAgoraFeito2 ? 'Realizado' : 'Reaberto'), func.idFunc);
    if (fgtsAgoraPago2 !== undefined) registrarHistorico('desligamento', func.nome, 'FGTS: ' + (fgtsAgoraPago2 ? 'Pago' : 'Reaberto'), func.idFunc);

    salvarDados();
    fecharModalGerenciarResc();

    showToast('Status Financeiro e Operacional de Rescisão Atualizado com sucesso!', 'success');
    renderDesligamentos();
    renderDeadlines();
}

// ==== NOVO FUNCIONÁRIO AVULSO (SEM GERAR EXPERIÊNCIA) ====
function abrirModalFunc() {
    document.getElementById('form-novo-func').reset();
    document.getElementById('add-func-admissao').value = moment().format('YYYY-MM-DD');

    // Popula select unidades
    popularSelectUnidades('add-func-unidade');

    toggleNovoFuncContrato(); // Reseta status do painel extra
    document.getElementById('add-col-prorrog').classList.add('hidden'); // Reseta UI prorrogação
    document.getElementById('modal-novo-func').classList.remove('hidden');
}

function fecharModalFunc() {
    document.getElementById('modal-novo-func').classList.add('hidden');
}

function toggleNovoFuncContrato() {
    const isEfetivado = document.getElementById('add-func-tipo').value === 'indeterminado';
    document.getElementById('area-nova-exp').classList.toggle('hidden', isEfetivado);
}

function salvarFuncionarioAvulso(e) {
    e.preventDefault();

    const nome = document.getElementById('add-func-nome').value;
    const cpf = document.getElementById('add-func-cpf').value || '-';
    const funcao = document.getElementById('add-func-funcao').value;
    const unidade = document.getElementById('add-func-unidade').value;
    const admissao = document.getElementById('add-func-admissao').value;
    const tipo = document.getElementById('add-func-tipo').value;

    if (!nome || !funcao || !unidade || !admissao) return;

    let idNovoFunc = 'F_' + Date.now().toString();
    const idPrazoAtrelado = Date.now().toString();

    const nascimento = document.getElementById('add-func-nascimento').value || null;
    let novoFuncionario = {
        idFunc: idNovoFunc,
        nome: nome,
        cpf: cpf,
        funcao: funcao,
        unidade: unidade,
        admissao: admissao,
        dataNascimento: nascimento,
        idPrazoVinculado: (tipo === 'experiencia') ? idPrazoAtrelado : null
    };

    if (tipo === 'experiencia') {
        const prazoInicial = parseInt(document.getElementById('add-func-prazo-ini').value);
        const isProrrogado = document.getElementById('add-func-is-prorrog').checked;
        let diasProrrogados = parseInt(document.getElementById('add-func-prazo-prorrog').value);

        let prazoIniFixo = prazoInicial;
        let finalDiasAAdicionar = prazoIniFixo;
        let tituloExp = `Experiência(${prazoIniFixo}d)`;

        if (isProrrogado) {
            if (isNaN(diasProrrogados) || diasProrrogados <= 0) {
                // assume limite
                diasProrrogados = 90 - prazoIniFixo;
                tituloExp = `Experiência(Prorrogação ${prazoIniFixo} + ${diasProrrogados}d)`;
            } else {
                tituloExp = `Experiência(Prorrogação ${prazoIniFixo} + ${diasProrrogados}d)`;
            }
            finalDiasAAdicionar = prazoIniFixo + diasProrrogados;
        }

        let novoPrazo = {
            id: idPrazoAtrelado,
            nome: nome,
            tipoCod: 'experiencia',
            dataBase: admissao,
            prazoInicial: prazoIniFixo,
            prorrogado: isProrrogado,
            diasProrrogadosManuais: isProrrogado ? diasProrrogados : null,
            tipo: tituloExp,
            dataVencimento: moment(admissao).clone().add(finalDiasAAdicionar - 1, 'days').format('YYYY-MM-DD')
        };
        prazosList.push(novoPrazo);
    }

    funcionariosList.push(novoFuncionario);
    salvarDados(); // Envio de dados à Nuvem

    fecharModalFunc();
    renderFuncionarios();
    renderDeadlines(); // Atualizar painel
    showToast('Funcionário cadastrado com sucesso!', 'success');
}

// ==== EDIÇÃO DE FUNCIONÁRIO AVULSO/COMPLETO ====
function abrirModalEditFunc(idFunc) {
    const func = funcionariosList.find(f => f.idFunc === idFunc);
    if (!func) return;

    document.getElementById('edit-func-id').value = func.idFunc;
    document.getElementById('edit-func-nome').value = func.nome;
    document.getElementById('edit-func-cpf').value = func.cpf !== '-' ? func.cpf : '';
    document.getElementById('edit-func-funcao').value = func.funcao;
    document.getElementById('edit-func-admissao').value = func.admissao;
    document.getElementById('edit-func-nascimento').value = func.dataNascimento || '';

    // Popula select unidades e seleciona
    popularSelectUnidades('edit-func-unidade', { selectedValue: func.unidade });

    // Reset campos experiencia
    const editAreaExp = document.getElementById('edit-area-exp');
    document.getElementById('edit-func-prazo-ini').value = '45';
    document.getElementById('edit-func-is-prorrog').checked = false;
    document.getElementById('edit-func-prazo-prorrog').value = '';
    document.getElementById('edit-col-prorrog').classList.add('hidden'); // Esconde ao abrir

    // Se o funcionario tem prazo e esse prazo é do tipo experiencia, preenche!
    if (func.idPrazoVinculado) {
        const prazoExp = prazosList.find(p => p.id === func.idPrazoVinculado && p.tipoCod === 'experiencia');
        if (prazoExp) {
            editAreaExp.classList.remove('hidden');
            document.getElementById('edit-func-prazo-ini').value = prazoExp.prazoInicial || '45';
            document.getElementById('edit-func-is-prorrog').checked = prazoExp.prorrogado || false;
            document.getElementById('edit-func-prazo-prorrog').value = prazoExp.diasProrrogadosManuais || '';
            document.getElementById('edit-col-prorrog').classList.toggle('hidden', !(prazoExp.prorrogado || false));
        } else {
            editAreaExp.classList.add('hidden'); // Ex: ja efetivou ou deletaram manual
        }
    } else {
        editAreaExp.classList.add('hidden');
    }

    document.getElementById('modal-editar-func').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function fecharModalEditFunc() {
    document.getElementById('modal-editar-func').classList.add('hidden');
    document.body.style.overflow = '';
}

function salvarEdicaoFuncionario(e) {
    e.preventDefault();

    const idFunc = document.getElementById('edit-func-id').value;
    let funcIndex = funcionariosList.findIndex(f => f.idFunc === idFunc);
    if (funcIndex === -1) return;

    const nomeAntigo = funcionariosList[funcIndex].nome;
    const unidAntiga = funcionariosList[funcIndex].unidade;
    const admissaoAntiga = funcionariosList[funcIndex].admissao;

    const novoNome = document.getElementById('edit-func-nome').value;
    const novaAdmissao = document.getElementById('edit-func-admissao').value;
    const novaUnidade = document.getElementById('edit-func-unidade').value;

    funcionariosList[funcIndex].nome = novoNome;
    funcionariosList[funcIndex].cpf = document.getElementById('edit-func-cpf').value || '-';
    funcionariosList[funcIndex].funcao = document.getElementById('edit-func-funcao').value;
    funcionariosList[funcIndex].unidade = novaUnidade;
    funcionariosList[funcIndex].admissao = novaAdmissao;
    funcionariosList[funcIndex].dataNascimento = document.getElementById('edit-func-nascimento').value || null;

    // Agora sincroniza Prazos que estão atrelados!
    let prazoSincronizado = false;
    for (let i = 0; i < prazosList.length; i++) {
        // Se for o prazo exato da experiência dele
        if (prazosList[i].id === funcionariosList[funcIndex].idPrazoVinculado) {
            prazosList[i].nome = novoNome;
            prazosList[i].dataBase = novaAdmissao;

            // Recriar o Titulo baseado nos NOVOS campos
            let novoPrazoIni = parseInt(document.getElementById('edit-func-prazo-ini').value) || 45;
            let isProrrogado = document.getElementById('edit-func-is-prorrog').checked;
            let diasAdd = parseInt(document.getElementById('edit-func-prazo-prorrog').value);

            if (isNaN(diasAdd)) diasAdd = null;

            prazosList[i].prazoInicial = novoPrazoIni;
            prazosList[i].prorrogado = isProrrogado;
            prazosList[i].diasProrrogadosManuais = diasAdd;

            if (isProrrogado) {
                let dAdd = diasAdd;
                if (!dAdd) dAdd = 90 - novoPrazoIni;
                prazosList[i].tipo = `Experiência(Prorrogação ${novoPrazoIni} + ${dAdd}d) - ${novaUnidade} `;
                prazosList[i].dataVencimento = moment(novaAdmissao).clone().add(novoPrazoIni + dAdd - 1, 'days').format('YYYY-MM-DD');
            } else {
                prazosList[i].tipo = `Experiência(${novoPrazoIni}d) - ${novaUnidade} `;
                prazosList[i].dataVencimento = moment(novaAdmissao).clone().add(novoPrazoIni - 1, 'days').format('YYYY-MM-DD');
            }
            prazoSincronizado = true;
        }
        // Se for QUALQUER outro prazo que calhe de ter o MESMO NOME antigo, altera o nome e, se for exp, ajusta a formatação q envolve unidade
        else if (prazosList[i].nome === nomeAntigo) {
            prazosList[i].nome = novoNome;
            if (prazosList[i].tipoCod === 'experiencia') {
                // Atualiza a unidade na string se houver
                prazosList[i].tipo = prazosList[i].tipo.replace(unidAntiga, novaUnidade);
            }
            prazoSincronizado = true;
        }
    }

    salvarDados(); // Seja como for, envia tudo pra nuvem

    fecharModalEditFunc();
    renderFuncionarios();
    if (prazoSincronizado) renderDeadlines();


    const alteracoes = [];
    if (novoNome !== nomeAntigo) alteracoes.push(`Nome: ${nomeAntigo} → ${novoNome}`);
    if (novaUnidade !== unidAntiga) alteracoes.push(`Unidade: ${unidAntiga} → ${novaUnidade}`);
    if (novaAdmissao !== admissaoAntiga) alteracoes.push(`Admissão: ${moment(admissaoAntiga).format('DD/MM/YY')} → ${moment(novaAdmissao).format('DD/MM/YY')}`);
    registrarHistorico('funcionario',
        `Funcionário editado: ${novoNome}`,
        alteracoes.length ? alteracoes.join(' · ') : 'Dados atualizados',
        func.idFunc
    );
    showToast('Ficha atualizada com sucesso!', 'success');
}

// ==== BACKUP E RESTAURAÇÃO ====
function exportarBackup() {
    const backupData = {
        prazos: prazosList,
        funcionarios: funcionariosList,
        configuracoes: configGerais,
        dataExportacao: moment().format('YYYY-MM-DD HH:mm:ss')
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const dtLindo = moment().format('DD-MM-YYYY');
    const nomeArquivo = `RHFacil_Backup_${dtLindo}.json`;

    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", nomeArquivo);
    document.body.appendChild(downloadAnchorNode); // Requerido no Firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function processarImportacao(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const importado = JSON.parse(e.target.result);

            if (importado.prazos && importado.funcionarios && importado.configuracoes) {
                if (await showConfirm(`Tem certeza que deseja restaurar o backup de ${importado.dataExportacao}? ISSO IRÁ SOBRESCREVER OS DADOS ATUAIS.`)) {

                    // Substituir globais
                    prazosList = importado.prazos;
                    funcionariosList = importado.funcionarios;
                    configGerais = importado.configuracoes;

                    salvarDados(); // Envia para a nuvem para gravar o restore definitivamente.

                    showToast('Dados restaurados com sucesso! O sistema será recarregado.', 'success');
                    location.reload(); // Recarrega tela inteira pra limpar estados da memória e aplicar temas
                }
            } else {
                showToast('Arquivo de backup inválido. Por favor, selecione um arquivo gerado pelo próprio sistema.', 'error');
            }
        } catch (error) {
            showToast('Erro ao processar arquivo: ' + error, 'error');
        }
        // Reseta o input do arquivo para caso ele queira importar o mesmo de novo
        event.target.value = '';
    };
    reader.readAsText(file);
}

// ==== IMPORTAÇÃO MASSIVA CSV ====
function excelDateToJSDate(serial) {
    if (!serial) return '';
    // Se for formato Brasileiro DD/MM/YYYY
    if (String(serial).includes('/')) {
        const parts = String(serial).split('/');
        if (parts.length === 3) {
            return `${parts[2]} -${parts[1].padStart(2, '0')} -${parts[0].padStart(2, '0')} `;
        }
    }
    // Se for o serial maluco do Excel (Número de dias desde 1/1/1900)
    let n = parseFloat(serial);
    if (!isNaN(n)) {
        let utc_days = Math.floor(n - 25569);
        let utc_value = utc_days * 86400;
        let dataInfo = new Date(utc_value * 1000);
        return moment(dataInfo).add(1, 'days').format('YYYY-MM-DD');
    }
    return ''; // Fallback
}

function importarCSVFuncionarios(event) {
    const file = event.target.files[0];
    if (!file) return;

    Papa.parse(file, {
        header: true,
        delimiter: ";",
        skipEmptyLines: true,
        encoding: "ISO-8859-1", // Padrão clássico do Excel Brasileiro que contém ç e ã
        complete: function (results) {
            let importados = 0;
            let falhas = 0;

            // Função para normalizar chave removendo acentos, pra ficar a prova de balas
            const normalizeKey = (key) => key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

            results.data.forEach((row, indexRow) => {
                // Cria um objeto "rowSeguro" todo em maiúsculo sem acento
                let rowSeguro = {};
                for (let k in row) {
                    if (row.hasOwnProperty(k)) {
                        rowSeguro[normalizeKey(k)] = row[k];
                    }
                }

                // Agora procura pelos nomes limpos! Excel não vai mais quebrar
                let nome = rowSeguro["FUNCIONARIO"] || rowSeguro["NOME"];
                let cpf = rowSeguro["CPF"] || "-";
                let funcao = rowSeguro["FUNCAO"] || "-";
                let unidade = rowSeguro["UNIDADE"] || "Geral";
                let admissaoRaw = rowSeguro["ADMISSAO"];
                let situacao = rowSeguro["SITUACAO"] || "INDETERMINADO";
                let diasExpRaw = rowSeguro["EXPERIENCIA"];
                let prorrogacaoRaw = rowSeguro["PRORROGACAO"];

                if (!nome) { falhas++; return; }

                let dataAdmissaoTratada = excelDateToJSDate(admissaoRaw);
                // Se a admissão não for identificada, default = Hoje
                if (!dataAdmissaoTratada) {
                    dataAdmissaoTratada = moment().format('YYYY-MM-DD');
                }

                // Adicionado o indexRow para garantir keys 100% isoladas na execução do loop
                const idUnico = Date.now().toString() + indexRow.toString() + Math.floor(Math.random() * 1000);

                let isExperiencia = (situacao.toUpperCase() === 'EXPERIÊNCIA' || situacao.toUpperCase() === 'EXPERIENCIA');
                let prazoInicialExp = parseInt(diasExpRaw) || 45;

                let idPrazoVinculado = null;

                // Se está em experiência e nós temos as datas, criar o Prazo!
                if (isExperiencia) {
                    idPrazoVinculado = idUnico;
                    let momentoBase = moment(dataAdmissaoTratada);

                    let diasProrrogados = parseInt(prorrogacaoRaw) || 0;
                    let foiProrrogado = diasProrrogados > 0;
                    let textoProrro = foiProrrogado ? ` + ${diasProrrogados} d` : '';

                    let novoPrazo = {
                        id: idUnico,
                        nome: nome,
                        tipoCod: 'experiencia',
                        dataBase: dataAdmissaoTratada,
                        prazoInicial: prazoInicialExp,
                        prorrogado: foiProrrogado,
                        diasProrrogacao: diasProrrogados,
                        tipo: `Experiência(${prazoInicialExp}d${textoProrro})`,
                        dataVencimento: momentoBase.clone().add(prazoInicialExp + diasProrrogados - 1, 'days').format('YYYY-MM-DD')
                    };
                    prazosList.push(novoPrazo);
                }

                // Cria o Funcionário Base
                let novoFuncionario = {
                    idFunc: 'F_' + idUnico,
                    nome: nome,
                    cpf: cpf,
                    funcao: funcao,
                    unidade: unidade,
                    admissao: dataAdmissaoTratada,
                    idPrazoVinculado: idPrazoVinculado
                };

                funcionariosList.push(novoFuncionario);
                importados++;
            });

            if (importados > 0) {
                salvarDados(); // Sobe tdo pro Firebase Num Tapa Só
                renderFuncionarios();
                renderDeadlines();
                showToast(`Importação Concluída com Sucesso! ${importados} funcionários cadastrados.`, "success");
            } else {
                showToast("Nenhum dado válido foi encontrado. Verifique se a planilha tem os cabeçalhos de coluna corretos (FUNCIONÁRIO, ADMISSÃO, etc).", "warning");
            }
        },
        error: function (error) {
            showToast('Erro ao decodificar arquivo CSV: ' + error.message, 'error');
        }
    });
    event.target.value = ''; // Limpa o input
}

function exportarCSVFuncionarios() {
    if (!funcionariosList || funcionariosList.length === 0) {
        showToast("Não há funcionários para exportar.", "warning");
        return;
    }

    let dadosExportacao = funcionariosList.map(f => {
        let situacaoStr = 'Indeterminado';
        let diasExpStr = '';
        let prorrogacaoStr = '';

        if (f.desligado) {
            situacaoStr = 'Desligado';
        } else if (f.emAvisoPrevio) {
            situacaoStr = 'Aviso Prévio';
        } else if (f.idPrazoVinculado) {
            const prazoInfo = prazosList.find(p => p.id === f.idPrazoVinculado);
            if (prazoInfo) {
                const diasFaltandoExp = moment(prazoInfo.dataVencimento).diff(moment().startOf('day'), 'days');
                if (diasFaltandoExp >= 0) {
                    situacaoStr = 'Experiência';
                    diasExpStr = prazoInfo.prazoInicial || '';
                    if (prazoInfo.prorrogado) {
                        prorrogacaoStr = prazoInfo.diasProrrogadosManuais || prazoInfo.diasProrrogacao || (90 - (prazoInfo.prazoInicial || 45));
                    }
                }
            }
        }

        return {
            "NOME": f.nome || "",
            "CPF": f.cpf || "",
            "FUNCAO": f.funcao || "",
            "UNIDADE": f.unidade || "",
            "ADMISSAO": f.admissao ? moment(f.admissao).format('DD/MM/YYYY') : "",
            "SITUACAO": situacaoStr,
            "EXPERIENCIA": diasExpStr,
            "PRORROGACAO": prorrogacaoStr
        };
    });

    let csvContent = Papa.unparse(dadosExportacao, {
        quotes: true,
        delimiter: ";", // Compatível com Excel BR
        header: true
    });

    const blob = new Blob(["\\uFEFF", csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `RhFacil_Funcionarios_${moment().format('YYYY-MM-DD')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Exportação concluída! Verifique seus downloads.", "success");
}

async function reverterAvisoPrevio(idFunc) {
    if (await showConfirm("Deseja realmente cancelar o Aviso Prévio e retornar o colaborador à atividade normal?")) {
        let func = funcionariosList.find(f => f.idFunc === idFunc);
        if (!func) return;

        // Limpa os prazos de rescisão/ASO criados para esse aviso
        prazosList = prazosList.filter(p => p.id !== func.idPrazoRescisao && p.id !== func.idPrazoAso && p.id !== func.idPrazoFgts);

        // Devolve o backup de prazos antigps se houver
        if (func.backupPrazos && func.backupPrazos.length > 0) {
            func.backupPrazos.forEach(p => prazosList.push({ ...p }));
        }

        func.emAvisoPrevio = false;
        func.dataInicioAviso = null;
        func.dataFimAviso = null;
        func.motivoDesligamento = null;
        func.diasAvisoTrabalhado = null;
        func.docStatus = null;
        func.idPrazoRescisao = null;
        func.idPrazoAso = null;
        func.asoRequerido = false;
        func.idPrazoFgts = null;
        func.fgtsPago = false;
        func.backupPrazos = null;

        salvarDados();
        renderFuncionarios();
        renderDeadlines();
        showToast('Aviso prévio revertido. O funcionário voltou ao status normal.', 'success');
    }
}

async function efetivarDesligamentoAviso(idFunc) {
    if (await showConfirm("Deseja baixar este funcionário como DESLIGADO agora? O Aviso Prévio será finalizado.")) {
        let func = funcionariosList.find(f => f.idFunc === idFunc);
        if (!func) return;

        func.emAvisoPrevio = false;
        func.desligado = true;
        func.dataDesligamento = moment().format('YYYY-MM-DD');

        salvarDados();
        renderFuncionarios();
        renderDeadlines();
        if (document.getElementById('view-desligamentos').classList.contains('active')) {
            renderDesligamentos();
        }
        showToast("O funcionário foi baixado como desligado.", "success");
    }
}

async function hardResetDB() {
    let confirmacao1 = await showConfirm("⚠️ ATENÇÃO MÁXIMA ⚠️\n\nVocê está prestes a APAGAR TODO O BANCO DE DADOS na Nuvem.\nIsso inclui absolutamente todos os funcionários, configurações e relatórios de desligamento.\n\nTem Certeza Absoluta?");

    if (confirmacao1) {
        let confirmacao2 = prompt("Para prosseguir com a EXCLUSÃO PERMANENTE, digite a palavra: APAGAR");

        if (confirmacao2 === 'APAGAR') {
            try {
                // Esvazia as arrays em RAM
                prazosList = [];
                funcionariosList = [];

                // Manda o Firebase sobrescrever a árvore inteira do cliente com um payload VAZIO
                await fetch(`${FIREBASE_URL}rhfacil.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        prazos: [],
                        funcionarios: [],
                        configuracoes: configGerais // Opcional: manter configurações ou zerar? Manteremos.
                    })
                });

                // Atualiza UI
                renderDeadlines();
                renderFuncionarios();
                if (document.getElementById('view-desligamentos').classList.contains('active')) {
                    renderDesligamentos();
                }

                showToast("Tudo certo. O Banco de Dados do sistema foi completamente apagado com sucesso.", "success");

            } catch (error) {
                console.error("Erro ao resetar banco:", error);
                showToast("Ocorreu um erro ao tentar limpar o Banco de Dados. Verifique sua conexão com a internet.", "error");
            }
        } else {
            showToast("Operação cancelada. Palavra de segurança incorreta.", "warning");
        }
    }
}

// =========================================
// SISTEMA DE NOTIFICAÇÕES (TOAST)
// =========================================
function showToast(message, type = 'success', duration = 5000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Criar elemento
    const toast = document.createElement('div');
    toast.className = `toast ${type} `;

    // Ícone por tipo
    let iconClass = 'fa-solid fa-circle-check';
    let titleMsg = 'Sucesso';

    if (type === 'error') {
        iconClass = 'fa-solid fa-circle-exclamation';
        titleMsg = 'Erro';
    } else if (type === 'warning') {
        iconClass = 'fa-solid fa-triangle-exclamation';
        titleMsg = 'Atenção';
    }

    toast.innerHTML = `
    <i class="${iconClass}" ></i>
        <div class="toast-content">
            <div class="toast-title">${titleMsg}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
        <div class="toast-progress" style="animation: toastProgress ${duration}ms linear forwards;"></div>
`;

    container.appendChild(toast);

    // Fade In
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);

    // Auto dispose
    const timer = setTimeout(() => {
        removeToast(toast);
    }, duration);

    // Botão de fechar (dispose manual)
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => {
        clearTimeout(timer);
        removeToast(toast);
    });
}

function removeToast(toastElement) {
    toastElement.classList.remove('show');
    toastElement.classList.add('hide');
    setTimeout(() => {
        if (toastElement.parentNode) {
            toastElement.remove();
        }
    }, 400); // 400ms match css hide/show speed
}

// =========================================
// SISTEMA DE CONFIRMAÇÃO CUSTOMIZADO (MODAL)
// =========================================
function showConfirm(message) {
    return new Promise((resolve) => {
        const modal = document.getElementById('custom-confirm-modal');
        const msgEl = document.getElementById('custom-confirm-message');
        const btnOk = document.getElementById('custom-confirm-btn-ok');
        const btnCancel = document.getElementById('custom-confirm-btn-cancel');

        msgEl.textContent = message;
        modal.classList.remove('hidden');

        // Handlers
        const handleOk = () => {
            cleanup();
            resolve(true);
        };
        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const cleanup = () => {
            btnOk.removeEventListener('click', handleOk);
            btnCancel.removeEventListener('click', handleCancel);
            modal.classList.add('hidden');
        };

        btnOk.addEventListener('click', handleOk);
        btnCancel.addEventListener('click', handleCancel);
    });
}


// =========================================
// MÓDULO DE CONTROLE DE PONTO (FASE 1)
// =========================================

let folhaAtual = []; // Guarda os 31 dias da folha ativa

// ====== CACHE DE PONTO EM MEMÓRIA ======
// Chave: "idFunc_YYYY-MM", Valor: dados retornados pelo Firebase (ou null)
// Evita re-buscar o Firebase toda vez que se entra na aba para o mesmo mês.
let pontoCache = {};

function invalidarCachePonto(idFunc, mesAno) {
    delete pontoCache[`${idFunc}_${mesAno}`];
}

function recarregarListaPonto() {
    pontoCache = {};
    renderListaPonto();
    showToast("Lista atualizada com sucesso.", "success");
}

// ── Modo denso do ponto ──
var _pontoDenso = false;
function pontToggleDenso(ativo) {
    _pontoDenso = ativo;
    try { localStorage.setItem('ponto_modo_denso', ativo ? '1' : '0'); } catch(e) {}
    const grid = document.getElementById('ponto-grid-unidades');
    if (grid) grid.classList.toggle('ponto-grid-denso', ativo);
    // Re-renderiza para ajustar conteúdo dos cards
    renderListaPonto();
}

// Não precisamos mais do combo de seleção
function selecionarFuncionarioPonto() {
    // Mantido por compatibilidade legado, mas não será mais usado no Ponto Fase 3.
}

// Função auxiliar que calcula o status de um card a partir dos dados do banco
// Cache de fins de semana por mês — evita moment() em loop por funcionário
const _fdsCache = {};
function _getFdsMes(mesAno, diasNoMes) {
    if (_fdsCache[mesAno]) return _fdsCache[mesAno];
    const fds = {};
    const base = moment(mesAno, 'YYYY-MM');
    for (let d = 1; d <= diasNoMes; d++) {
        const dow = base.clone().date(d).day(); // 0=dom, 6=sab
        fds[d] = (dow === 0 || dow === 6);
    }
    _fdsCache[mesAno] = fds;
    return fds;
}

function _calcularStatusCard(dbStatus, mesAno, diasNoMes) {
    let countFilled = 0;
    let countMissing = 0;
    const fds = _getFdsMes(mesAno, diasNoMes); // calculado uma vez por mês, não por funcionário

    for (let d = 1; d <= diasNoMes; d++) {
        let dayData = dbStatus && dbStatus[d] ? dbStatus[d] : null;
        let isFds = fds[d];

        // Verifica se existem marcações preenchidas (ignorando o tempo vazio zero)
        let hasAlotOfTime = dayData && (dayData.e1 && dayData.s1 && dayData.e2 && dayData.s2);
        let hasAtLeastOneTime = dayData && (dayData.e1 || dayData.s1 || dayData.e2 || dayData.s2);

        let isFolga = dayData && dayData.isFolga;
        if (isFolga || isFds) {
            if (hasAtLeastOneTime) countFilled++;
        } else {
            if (hasAlotOfTime) { countFilled++; }
            else if (hasAtLeastOneTime) { countMissing++; countFilled++; }
            else { countMissing++; }
        }
    }

    let statusCss, statusText;
    if (dbStatus && dbStatus.conferido === true) {
        statusCss = 'ponto-card-conferido';
        statusText = '<i class="fa-solid fa-check-double"></i> Conferido';
    } else if (countFilled === 0) {
        statusCss = 'ponto-card-vazio';
        statusText = 'Vazio';
    } else if (countMissing > 0) {
        statusCss = 'ponto-card-parcial';
        statusText = 'Parcialmente Preenchido';
    } else {
        statusCss = 'ponto-card-completo';
        statusText = 'Preenchimento Completo';
    }

    let exibeSaldoHtml = '';
    if (dbStatus && dbStatus.fechamentoAcumulado !== undefined) {
        let saldoVal = dbStatus.fechamentoAcumulado;
        let corSaldo = saldoVal > 0 ? 'var(--success)' : (saldoVal < 0 ? 'var(--danger)' : 'var(--text-light)');
        exibeSaldoHtml = `<div style="font-size: 0.75rem; margin-top: 4px; color: ${corSaldo}; font-weight: 600;"><i class="fa-solid fa-scale-balanced"></i> Banco Acumulado: ${formatMinutes(saldoVal)}</div>`;
    }

    return { statusCss, statusText, exibeSaldoHtml };
}

async function renderListaPonto() {
    const mesAno = document.getElementById('ponto-mes-ano').value;
    if (!mesAno) return;

    ultimoMesAnoSelecionado = mesAno;

    const termo = (document.getElementById('search-ponto-funcionarios') ? _norm(document.getElementById('search-ponto-funcionarios').value) : '');
    const gridEl = document.getElementById('ponto-grid-unidades');
    const emptyState = document.getElementById('ponto-grid-empty');

    emptyState.classList.add('hidden');

    let ativos = funcionariosList.filter(f => !f.desligado && (_fuzzyMatch(f.nome, termo) || (f.cpf || '').includes(termo)));

    if (ativos.length === 0) {
        gridEl.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    const momentMes = moment(mesAno, 'YYYY-MM');
    const diasNoMes = momentMes.daysInMonth();

    // Filtros Rápidos
    let showVazio = document.getElementById('filtro-pt-vazio') ? document.getElementById('filtro-pt-vazio').checked : true;
    let showParcial = document.getElementById('filtro-pt-parcial') ? document.getElementById('filtro-pt-parcial').checked : true;
    let showCompleto = document.getElementById('filtro-pt-completo') ? document.getElementById('filtro-pt-completo').checked : true;
    let showConferido = document.getElementById('filtro-pt-conferido') ? document.getElementById('filtro-pt-conferido').checked : true;

    // Agrupa por unidade
    let agrupados = {};
    ativos.forEach(f => {
        let u = f.unidade || 'Sem Unidade';
        if (!agrupados[u]) agrupados[u] = [];
        agrupados[u].push(f);
    });
    let keysOrd = Object.keys(agrupados).sort();

    // ─── PASSO 1: Renderiza todos os cards — usa DocumentFragment por unidade (um único reflow por grupo) ───
    gridEl.innerHTML = '';
    gridEl.classList.add('ponto-grid-sem-transicao'); // suprime transições CSS durante inserção
    let cardEls = {};
    let sectionEls = {};
    const frag = document.createDocumentFragment();

    for (let u of keysOrd) {
        let funcsDaUnidade = [...agrupados[u]].sort((a, b) => a.nome.localeCompare(b.nome));

        let unidadeSection = document.createElement('div');
        unidadeSection.className = 'ponto-unidade-group';
        let gridUnid = document.createElement('div');
        gridUnid.className = 'ponto-unidade-grid';
        let titulo = document.createElement('h4');
        titulo.className = 'ponto-unidade-title';
        titulo.textContent = u;
        unidadeSection.appendChild(titulo);
        unidadeSection.appendChild(gridUnid);
        sectionEls[u] = unidadeSection;

        // Monta cards da unidade em fragment interno
        let fragUnid = document.createDocumentFragment();

        for (let f of funcsDaUnidade) {
            const cacheKey = `${f.idFunc}_${mesAno}`;
            let card = document.createElement('div');

            if (pontoCache.hasOwnProperty(cacheKey)) {
                const dbStatus = pontoCache[cacheKey];
                const { statusCss, statusText, exibeSaldoHtml } = _calcularStatusCard(dbStatus, mesAno, diasNoMes);
                const conf = statusText.includes('Conferido');
                if (!showVazio && statusText === 'Vazio') continue;
                if (!showParcial && statusText === 'Parcialmente Preenchido') continue;
                if (!showCompleto && statusText === 'Preenchimento Completo') continue;
                if (!showConferido && conf) continue;

                card.className = `ponto-grid-card ${statusCss}`;
                card.onclick = () => abrirEdicaoPonto(f.idFunc, f.nome.replace(/'/g, "\'"));
                let exibeBotaoDownload = '';
                if (conf) {
                    exibeBotaoDownload = `<button class="btn-download-ponto-grid" title="Baixar PDF de Cartão Conferido" onclick="baixarPdfPontoDiretoGrid(event, this, '${f.idFunc}', '${f.nome.replace(/'/g, "\'")}', '${mesAno}')"><i class="fa-solid fa-download"></i></button>`;
                }
                card.innerHTML = _pontoDenso
                    ? `<span class="ponto-card-nome">${f.nome}</span>
                       <span class="ponto-card-status" style="font-size:0.68rem;color:var(--text-light);">${f.unidade || ''}</span>
                       ${exibeSaldoHtml}`
                    : `<span class="ponto-card-nome">${f.nome}</span>
                       <span class="ponto-card-status">${statusText}</span>
                       ${exibeSaldoHtml}
                       ${exibeBotaoDownload}`;
            } else {
                card.className = 'ponto-grid-card ponto-card-loading';
                card.style.cssText = 'opacity:0.45;pointer-events:none;cursor:default;';
                card.id = `ponto-card-${f.idFunc}`;
                card.innerHTML = `
                    <span class="ponto-card-nome">${f.nome}</span>
                    <span class="ponto-card-status"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</span>
                `;
                cardEls[f.idFunc] = card;
            }
            fragUnid.appendChild(card);
        }

        gridUnid.appendChild(fragUnid); // um único reflow por unidade
        if (gridUnid.children.length === 0) unidadeSection.style.display = 'none';
        frag.appendChild(unidadeSection);
    }

    gridEl.appendChild(frag); // um único reflow para tudo

    // Aplica/remove classe de modo denso
    gridEl.classList.toggle('ponto-grid-denso', _pontoDenso);

    // Restaura transições após inserção — usa requestAnimationFrame para garantir que o
    // browser já pintou o frame antes de reativar (evita transições no insert inicial)
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            gridEl.classList.remove('ponto-grid-sem-transicao');
        });
    });

    // ─── PASSO 2: 1 request único para todos os pontos do mês ───
    let funcsParaBuscar = ativos.filter(f => !pontoCache.hasOwnProperty(`${f.idFunc}_${mesAno}`));

    // Se todos já estão em cache, Passo 1 já renderizou tudo — só verifica empty state
    if (funcsParaBuscar.length === 0) {
        const todasSecoes = Array.from(gridEl.querySelectorAll('.ponto-unidade-group'));
        if (todasSecoes.length === 0 || todasSecoes.every(s => s.style.display === 'none')) {
            gridEl.innerHTML = '';
            emptyState.classList.remove('hidden');
        } else {
            emptyState.classList.add('hidden');
        }
        return;
    }

    if (funcsParaBuscar.length > 0) {
        // Firebase query: traz apenas registros do mês atual em 1 request
        // orderBy=$key + startAt/endAt filtra chaves que contêm "_mesAno"
        try {
            const url = FIREBASE_URL + 'pontos.json'
                + '?orderBy=%22%24key%22'
                + '&startAt=%22A_' + mesAno + '%22'
                + '&endAt=%22z_' + mesAno + '%22';
            const resp = await fetch(url);
            if (resp.ok) {
                const dados = await resp.json();
                // Popula cache com os dados recebidos
                funcsParaBuscar.forEach(f => {
                    const chave = `${f.idFunc}_${mesAno}`;
                    pontoCache[chave] = (dados && dados[chave]) ? dados[chave] : null;
                });
            }
        } catch(e) {
            // Fallback: cacheia null para não ficar em loop
            funcsParaBuscar.forEach(f => { pontoCache[`${f.idFunc}_${mesAno}`] = null; });
        }
    }

    // Renderiza todos os cards com os dados do cache (síncrono, sem mais fetches)
    const fragFinal = document.createDocumentFragment();
    // Reconstrói o grid com os dados reais
    for (let u of keysOrd) {
        const sec = sectionEls[u];
        if (!sec) continue;
        const gridUnid = sec.querySelector('.ponto-unidade-grid');
        if (!gridUnid) continue;

        // Remove esqueletos de loading
        Array.from(gridUnid.querySelectorAll('.ponto-card-loading')).forEach(c => c.remove());

        const funcsDaUnidade = [...agrupados[u]].sort((a, b) => a.nome.localeCompare(b.nome));
        const fragUnid = document.createDocumentFragment();

        for (let f of funcsDaUnidade) {
            // Pula quem já foi renderizado no Passo 1 (cache hit)
            if (cardEls[f.idFunc] === undefined && !gridUnid.querySelector(`#ponto-card-${f.idFunc}`)) continue;
            const dbStatus = pontoCache[`${f.idFunc}_${mesAno}`];
            const { statusCss, statusText, exibeSaldoHtml } = _calcularStatusCard(dbStatus, mesAno, diasNoMes);
            const conf = statusText.includes('Conferido');
            if ((!showVazio && statusText === 'Vazio') || (!showParcial && statusText === 'Parcialmente Preenchido') ||
                (!showCompleto && statusText === 'Preenchimento Completo') || (!showConferido && conf)) continue;
            let card = document.createElement('div');
            card.className = `ponto-grid-card ${statusCss}`;
            card.onclick = () => abrirEdicaoPonto(f.idFunc, f.nome.replace(/'/g, "\'"));
            let dl = conf ? `<button class="btn-download-ponto-grid" title="Baixar PDF" onclick="baixarPdfPontoDiretoGrid(event,this,'${f.idFunc}','${f.nome.replace(/'/g,"\'")}','${mesAno}')"><i class="fa-solid fa-download"></i></button>` : '';
            card.innerHTML = _pontoDenso
                ? `<span class="ponto-card-nome">${f.nome}</span><span class="ponto-card-status" style="font-size:0.68rem;color:var(--text-light);">${f.unidade || ''}</span>${exibeSaldoHtml}`
                : `<span class="ponto-card-nome">${f.nome}</span><span class="ponto-card-status">${statusText}</span>${exibeSaldoHtml}${dl}`;
            fragUnid.appendChild(card);
        }
        gridUnid.innerHTML = '';
        gridUnid.appendChild(fragUnid);
        if (gridUnid.children.length === 0) sec.style.display = 'none';
        else sec.style.display = '';
    }

    // ─── PASSO 3: empty state ───
    const todasSecoes = Array.from(gridEl.querySelectorAll('.ponto-unidade-group'));
    if (todasSecoes.length === 0 || todasSecoes.every(s => s.style.display === 'none')) {
        gridEl.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
    }
}

async function abrirEdicaoPonto(idFunc, nomeFunc) {
    if (!(await checarAlteracoesNaoSalvasPonto())) return;

    scrollPositionListaPonto = window.scrollY;
    window.scrollTo({ top: 0, behavior: 'auto' });

    ultimoFuncSelecionado = idFunc;
    document.getElementById('ponto-select-func').value = idFunc;
    document.getElementById('ponto-nome-funcionario-edicao').textContent = nomeFunc;

    let parts = document.getElementById('ponto-mes-ano').value.split('-');
    document.getElementById('ponto-mes-edicao-label').textContent = `Competência referida: ${parts[1]}/${parts[0]}`;

    document.getElementById('ponto-lista-container').style.display = 'none';
    document.getElementById('ponto-edicao-container').style.display = 'block';

    renderFolhaPonto();
}

async function voltarListaPonto() {
    if (!(await checarAlteracoesNaoSalvasPonto())) return;

    pontoFoiAlterado = false;
    document.getElementById('ponto-select-func').value = ""; // limpa pro render entender que fechou

    document.getElementById('ponto-edicao-container').style.display = 'none';
    document.getElementById('ponto-lista-container').style.display = 'block';
    renderListaPonto();

    // Restaura o scroll após o navegador renderizar a lista
    setTimeout(() => {
        window.scrollTo({ top: scrollPositionListaPonto, behavior: 'auto' });
    }, 10);
}

async function selecionarMesAnoPonto() {
    if (!(await checarAlteracoesNaoSalvasPonto())) {
        document.getElementById('ponto-mes-ano').value = ultimoMesAnoSelecionado;
        return;
    }
    renderListaPonto();
}

async function renderFolhaPonto() {
    const idFunc = document.getElementById('ponto-select-func').value;
    const mesAno = document.getElementById('ponto-mes-ano').value; // YYYY-MM

    const tbody = document.getElementById('ponto-list');
    const table = document.getElementById('tabela-ponto');
    const emptyState = document.getElementById('ponto-empty-state');

    if (!idFunc || !mesAno) {
        table.style.display = 'none';
        emptyState.style.display = 'flex';
        document.getElementById('ponto-upload-area').style.display = 'none';
        document.getElementById('ponto-acoes-container').style.display = 'none';
        resetTotalizadoresPonto();
        return;
    }

    table.style.display = 'table';
    emptyState.style.display = 'none';
    document.getElementById('ponto-upload-area').style.display = 'block';
    document.getElementById('ponto-acoes-container').style.display = 'flex';

    const momentMes = moment(mesAno, 'YYYY-MM');
    const diasNoMes = momentMes.daysInMonth();

    // Reset Estado
    pontoFoiAlterado = false;
    ultimoMesAnoSelecionado = mesAno;
    ultimoFuncSelecionado = idFunc;

    let preservedScroll = window.scrollY;
    tbody.innerHTML = '';
    folhaAtual = [];

    // Tentar carregar banco salvo da nuvem para este mês específico
    const keyNuvem = `ponto_${idFunc}_${mesAno}`;
    let dadosSalvos = await fetchPontoMes(idFunc, mesAno);

    cacheSaldoAnteriorManual = null;
    if (dadosSalvos && dadosSalvos.saldoAnteriorManual !== undefined) {
        cacheSaldoAnteriorManual = dadosSalvos.saldoAnteriorManual;
    }

    // Restaura o Toggle do Cartão Conferido
    document.getElementById('ponto-conferido-check').checked = (dadosSalvos && dadosSalvos.conferido === true);

    for (let d = 1; d <= diasNoMes; d++) {
        let diaStr = d.toString().padStart(2, '0');
        let dataFull = `${mesAno}-${diaStr}`;
        const translateDay = (d) => ({ 'SUN': 'DOM', 'MON': 'SEG', 'TUE': 'TER', 'WED': 'QUA', 'THU': 'QUI', 'FRI': 'SEX', 'SAT': 'SÁB' }[d] || d);
        let diaSemana = translateDay(moment(dataFull).format('ddd').toUpperCase());

        // Valores padrao
        // Valores padrao com folga
        let reg = {
            dia: d, data: dataFull, e1: '', s1: '', e2: '', s2: '', atrasoMin: 0, extraMin: 0, isFolga: false,
            isAbonado: false, observacao: ''
        };

        if (dadosSalvos && dadosSalvos[d]) {
            reg = { ...reg, ...dadosSalvos[d] };
        }

        folhaAtual[d] = reg;

        let tr = document.createElement('tr');
        tr.id = `p_tr_${d}`;
        if (diaSemana === 'DOM' || diaSemana === 'SÁB' || reg.isFolga) {
            tr.style.background = reg.isFolga ? 'rgba(16, 185, 129, 0.05)' : 'rgba(0,0,0,0.02)';
        }

        let isFolgaChecked = reg.isFolga ? 'checked' : '';
        let isAbonadoChecked = reg.isAbonado ? 'checked' : '';
        let obsIcon = reg.observacao ? '<i class="fa-solid fa-comment-dots" style="color: var(--primary);"></i>' : '<i class="fa-regular fa-comment"></i>';

        tr.innerHTML = `
            <td style="font-weight: 600;">${diaStr} <span style="font-size: 0.75rem; color: var(--text-light); font-weight: normal;">${diaSemana}</span></td>
            <td><input type="time" class="ponto-input" id="p_${d}_e1" value="${reg.e1}" onchange="calcularLinhaPonto(${d})"></td>
            <td><input type="time" class="ponto-input" id="p_${d}_s1" value="${reg.s1}" onchange="calcularLinhaPonto(${d})"></td>
            <td><input type="time" class="ponto-input" id="p_${d}_e2" value="${reg.e2}" onchange="calcularLinhaPonto(${d})"></td>
            <td><input type="time" class="ponto-input" id="p_${d}_s2" value="${reg.s2}" onchange="calcularLinhaPonto(${d})"></td>
            <td id="p_${d}_atraso" class="ponto-td-atraso ${reg.isAbonado ? 'atraso-abonado' : (reg.atrasoMin > 0 ? 'atraso-ativo' : '')}">${formatMinutes(reg.atrasoMin)}</td>
            <td id="p_${d}_extra" style="color: ${reg.extraMin > 0 ? 'var(--success)' : 'var(--text-light)'}; font-weight: 500;">${formatMinutes(reg.extraMin)}</td>
            <td style="text-align: center;">
                <label class="toggle-switch">
                    <input type="checkbox" id="p_${d}_folga" ${isFolgaChecked} onchange="toggleFolgaPonto(${d})">
                    <span class="slider"></span>
                </label>
            </td>
            <td style="text-align: center;">
                <label class="toggle-switch toggle-switch-warning">
                    <input type="checkbox" id="p_${d}_abonar" ${isAbonadoChecked} onchange="toggleAbonarPonto(${d})">
                    <span class="slider"></span>
                </label>
            </td>
            <td style="text-align: center;" id="p_${d}_obs_td">
                <button onclick="abrirObsPonto(${d})" class="btn-obs-ponto" id="p_${d}_obs_btn" title="${reg.observacao ? reg.observacao : 'Adicionar observação'}">
                    ${obsIcon}
                </button>
            </td>
            <td style="text-align: center;"><button onclick="limparLinhaPonto(${d})" style="background: none; border: none; color: var(--text-light); cursor: pointer;"><i class="fa-solid fa-eraser"></i></button></td>
        `;
        tbody.appendChild(tr);
    }

    atualizarTotalizadoresPonto(idFunc, mesAno);
    window.scrollTo(0, preservedScroll);
}

function limparLinhaPonto(d) {
    document.getElementById(`p_${d}_e1`).value = '';
    document.getElementById(`p_${d}_s1`).value = '';
    document.getElementById(`p_${d}_e2`).value = '';
    document.getElementById(`p_${d}_s2`).value = '';
    calcularLinhaPonto(d);
}

// O coracao da conta do Contador - 07:20 dia
function calcularLinhaPonto(d) {
    let e1 = document.getElementById(`p_${d}_e1`).value;
    let s1 = document.getElementById(`p_${d}_s1`).value;
    let e2 = document.getElementById(`p_${d}_e2`).value;
    let s2 = document.getElementById(`p_${d}_s2`).value;

    folhaAtual[d].e1 = e1;
    folhaAtual[d].s1 = s1;
    folhaAtual[d].e2 = e2;
    folhaAtual[d].s2 = s2;

    // Se a linha estiver toda vazia, ignora (Sem dedução)
    if (!e1 && !s1 && !e2 && !s2) {
        folhaAtual[d].atrasoMin = 0;
        folhaAtual[d].extraMin = 0;
        atualizarDOMPonto(d);
        recalcularSaldoMes();
        return;
    }

    let minTra = 0;
    if (e1 && s1) minTra += diffMinutes(e1, s1);
    if (e2 && s2) minTra += diffMinutes(e2, s2);

    // Regra especial: folga com horário preenchido = TODO tempo é hora extra
    const isFolgaComHoras = !!folhaAtual[d].isFolga;
    if (isFolgaComHoras) {
        folhaAtual[d].extraMin = minTra > 0 ? minTra : 0;
        folhaAtual[d].atrasoMin = 0;
        atualizarDOMPonto(d);
        recalcularSaldoMes();
        pontoFoiAlterado = true;
        return;
    }

    let minPadrao = (7 * 60) + 20; // 07h20m = 440 minutos
    let saldo = minTra - minPadrao; // positivo = extra, negativo = atraso

    // Regra de Tolerancia 10 minutos
    if (Math.abs(saldo) <= 10) {
        saldo = 0;
    }

    if (saldo > 0) {
        folhaAtual[d].extraMin = saldo;
        folhaAtual[d].atrasoMin = 0;
    } else if (saldo < 0) {
        folhaAtual[d].atrasoMin = Math.abs(saldo);
        folhaAtual[d].extraMin = 0;
    } else {
        folhaAtual[d].extraMin = 0;
        folhaAtual[d].atrasoMin = 0;
    }

    atualizarDOMPonto(d);
    recalcularSaldoMes();

    // Marca como dirty pra exibir prompt de salvar se tentar sair
    pontoFoiAlterado = true;
}

function atualizarDOMPonto(d) {
    let tdAtraso = document.getElementById(`p_${d}_atraso`);
    let tdExtra = document.getElementById(`p_${d}_extra`);

    tdAtraso.textContent = formatMinutes(folhaAtual[d].atrasoMin);
    tdExtra.textContent = formatMinutes(folhaAtual[d].extraMin);

    // Estilo do atraso: abonado = cinza; ativo = vermelho; zero = texto leve
    const isAbonado = folhaAtual[d].isAbonado;
    tdAtraso.className = 'ponto-td-atraso ' + (isAbonado ? 'atraso-abonado' : (folhaAtual[d].atrasoMin > 0 ? 'atraso-ativo' : ''));
    tdExtra.style.color = folhaAtual[d].extraMin > 0 ? 'var(--success)' : 'var(--text-light)';
}

function diffMinutes(time1, time2) {
    let t1 = time1.split(':');
    let t2 = time2.split(':');
    let m1 = (parseInt(t1[0]) * 60) + parseInt(t1[1]);
    let m2 = (parseInt(t2[0]) * 60) + parseInt(t2[1]);
    // se virou o dia (saiu de madrugada)
    if (m2 < m1) m2 += (24 * 60);
    return m2 - m1;
}

function formatMinutes(totalMins) {
    if (totalMins === 0) return "00:00";
    let sign = totalMins < 0 ? "-" : "";
    let m = Math.abs(totalMins);
    let h = Math.floor(m / 60);
    let rem = m % 60;
    return `${sign}${h.toString().padStart(2, '0')}:${rem.toString().padStart(2, '0')}`;
}

let saldoMensalLiquido = 0; // Guardado global para soma

function recalcularSaldoMes() {
    let totalAtraso = 0;
    let totalExtra = 0;

    for (let d = 1; d < folhaAtual.length; d++) {
        if (folhaAtual[d]) {
            // Atraso abonado não entra no total
            if (!folhaAtual[d].isAbonado) totalAtraso += folhaAtual[d].atrasoMin;
            totalExtra += folhaAtual[d].extraMin;
        }
    }

    saldoMensalLiquido = totalExtra - totalAtraso; // Positivo ou negativo

    const uiAtual = document.getElementById('ponto-saldo-atual');
    uiAtual.textContent = formatMinutes(saldoMensalLiquido);

    if (saldoMensalLiquido > 0) uiAtual.style.color = 'var(--success)';
    else if (saldoMensalLiquido < 0) uiAtual.style.color = 'var(--danger)';
    else uiAtual.style.color = 'var(--text-main)';

    projetarTotalAcumulado();
}

let cacheSaldoAnterior = 0;
let cacheSaldoAnteriorManual = null;

async function atualizarTotalizadoresPonto(idFunc, mesAno) {
    if (cacheSaldoAnteriorManual !== null) {
        cacheSaldoAnterior = cacheSaldoAnteriorManual;
    } else {
        // Buscar mes anterior na view de Totalizadores
        let mesAntMomM = moment(mesAno, 'YYYY-MM').subtract(1, 'months');
        let mesAntStr = mesAntMomM.format('YYYY-MM');

        let dbMesAnterior = await fetchPontoMes(idFunc, mesAntStr);

        cacheSaldoAnterior = 0;
        if (dbMesAnterior && dbMesAnterior.fechamentoAcumulado !== undefined) {
            cacheSaldoAnterior = dbMesAnterior.fechamentoAcumulado; // Novo padrao
        } else if (dbMesAnterior && dbMesAnterior.fechamentoSaldoLiquido) {
            cacheSaldoAnterior = dbMesAnterior.fechamentoSaldoLiquido; // Legado
        }
    }

    const uiAnt = document.getElementById('ponto-saldo-anterior');
    uiAnt.textContent = formatMinutes(cacheSaldoAnterior);
    if (cacheSaldoAnterior > 0) uiAnt.style.color = 'var(--success)';
    else if (cacheSaldoAnterior < 0) uiAnt.style.color = 'var(--danger)';
    else uiAnt.style.color = 'var(--text-light)';

    recalcularSaldoMes(); // Isso força a atualizar o Acumulado tambem
}

function editarSaldoAnterior() {
    const idFunc = document.getElementById('ponto-select-func').value;
    const mesAno = document.getElementById('ponto-mes-ano').value;
    if (!idFunc || !mesAno) {
        showToast("Selecione um funcionário e uma competência primeiro.", "warning");
        return;
    }

    let atualManual = cacheSaldoAnteriorManual !== null ? formatMinutes(cacheSaldoAnteriorManual) : "";
    document.getElementById('input-saldo-manual-horas').value = atualManual;

    document.getElementById('modal-editar-saldo-anterior').classList.remove('hidden');
    setTimeout(() => {
        document.getElementById('input-saldo-manual-horas').focus();
    }, 100);
}

function fecharModalEditarSaldo() {
    document.getElementById('modal-editar-saldo-anterior').classList.add('hidden');
}

function salvarModalEditarSaldo() {
    const idFunc = document.getElementById('ponto-select-func').value;
    const mesAno = document.getElementById('ponto-mes-ano').value;
    let input = document.getElementById('input-saldo-manual-horas').value.trim();

    if (input === "") {
        removerModalEditarSaldo();
        return;
    }

    let regex = /^(-?)(\d{1,5}):(\d{2})$/;
    let match = input.match(regex);
    if (!match) {
        showToast("Formato Inválido! Use HH:MM.", "error");
        document.getElementById('input-saldo-manual-horas').focus();
        return;
    }

    let sinal = match[1] === '-' ? -1 : 1;
    let horas = parseInt(match[2], 10);
    let mins = parseInt(match[3], 10);

    let totalMins = sinal * ((horas * 60) + mins);
    cacheSaldoAnteriorManual = totalMins;

    atualizarTotalizadoresPonto(idFunc, mesAno);
    pontoFoiAlterado = true;
    showToast("Saldo Anterior aplicado! Clique em Gravar Folha para salvar na nuvem.", "success");
    fecharModalEditarSaldo();
}

function removerModalEditarSaldo() {
    const idFunc = document.getElementById('ponto-select-func').value;
    const mesAno = document.getElementById('ponto-mes-ano').value;

    cacheSaldoAnteriorManual = null;
    atualizarTotalizadoresPonto(idFunc, mesAno);
    pontoFoiAlterado = true;
    showToast("Saldo manual removido. Cálculo automático restaurado.", "success");
    fecharModalEditarSaldo();
}

function projetarTotalAcumulado() {
    let totalReal = cacheSaldoAnterior + saldoMensalLiquido;

    const uiBox = document.getElementById('card-ponto-total');
    const uiIcon = document.getElementById('icon-ponto-total');
    const uiTotal = document.getElementById('ponto-saldo-total');

    uiTotal.textContent = formatMinutes(totalReal);

    uiBox.className = 'card';
    if (totalReal > 0) {
        uiBox.classList.add('success-card');
        uiIcon.style.color = 'var(--success)';
        uiIcon.style.background = 'rgba(16, 185, 129, 0.1)';
    } else if (totalReal < 0) {
        uiBox.classList.add('danger-card');
        uiIcon.style.color = 'var(--danger)';
        uiIcon.style.background = 'rgba(239, 68, 68, 0.1)';
    } else {
        uiIcon.style.color = 'var(--text-light)';
        uiIcon.style.background = 'rgba(148, 163, 184, 0.1)';
    }
}

function resetTotalizadoresPonto() {
    document.getElementById('ponto-saldo-anterior').textContent = "00:00";
    document.getElementById('ponto-saldo-atual').textContent = "00:00";
    document.getElementById('ponto-saldo-total').textContent = "00:00";
    document.getElementById('card-ponto-total').className = 'card';
}

async function fetchPontoMes(idFunc, mesAno) {
    const cacheKey = `${idFunc}_${mesAno}`;
    // Retorna do cache se disponível (inclui null — significa que já buscamos e estava vazio)
    if (pontoCache.hasOwnProperty(cacheKey)) {
        return pontoCache[cacheKey];
    }
    try {
        let resp = await fetch(`${FIREBASE_URL}pontos/${idFunc}_${mesAno}.json`);
        if (resp.ok) {
            const data = await resp.json();
            pontoCache[cacheKey] = data; // Armazena no cache (pode ser null)
            return data;
        }
    } catch (e) { console.error('Ponto nulo', e); }
    pontoCache[cacheKey] = null; // Cacheia o null também para evitar nova requisição
    return null;
}

async function salvarBancoAtual() {
    const idFunc = document.getElementById('ponto-select-func').value;
    const mesAno = document.getElementById('ponto-mes-ano').value;
    if (!idFunc || !mesAno) return;

    let btn = event.currentTarget;
    let oldHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    btn.disabled = true;

    // Criar payload agrupado (Dias + Resumo Matemático para ser herdado prox mês)
    let payload = {
        fechamentoSaldoLiquido: saldoMensalLiquido,
        fechamentoAcumulado: cacheSaldoAnterior + saldoMensalLiquido,
        conferido: document.getElementById('ponto-conferido-check').checked
    };
    if (cacheSaldoAnteriorManual !== null) {
        payload.saldoAnteriorManual = cacheSaldoAnteriorManual;
    }
    for (let d = 1; d < folhaAtual.length; d++) {
        if (folhaAtual[d]) payload[d] = folhaAtual[d];
    }

    try {
        await fetch(`${FIREBASE_URL}pontos/${idFunc}_${mesAno}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        showToast("Folha de Ponto gravada na nuvem com sucesso!", "success");
        pontoFoiAlterado = false;
        // Invalida o cache para este funcionário/mês, forçando recarregar na próxima visita
        invalidarCachePonto(idFunc, mesAno);
    } catch (e) {
        showToast("Erro ao gravar folha no banco.", "error");
    }

    btn.innerHTML = oldHTML;
    btn.disabled = false;
}

async function apagarFolhaAtual() {
    const idFunc = document.getElementById('ponto-select-func').value;
    const mesAno = document.getElementById('ponto-mes-ano').value;
    if (!idFunc || !mesAno) return;

    if (await showConfirm("⚠️ ATENÇÃO: Tem certeza que deseja APAGAR COMPLETAMENTE esta folha de ponto?\nTodos os horários e envios deste mês serão perdidos e a ação não pode ser desfeita.")) {

        let btn = event.currentTarget;
        let oldHTML = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Apagando...';
        btn.disabled = true;

        try {
            await fetch(`${FIREBASE_URL}pontos/${idFunc}_${mesAno}.json`, {
                method: 'DELETE'
            });
            showToast("Folha de Ponto apagada com sucesso!", "success");
            // Desliga a herança manual se houver
            cacheSaldoAnteriorManual = null;
            // Recarregando a tela limpa
            renderFolhaPonto();
        } catch (e) {
            showToast("Erro ao apagar folha no banco.", "error");
        }

        btn.innerHTML = oldHTML;
        btn.disabled = false;
    }
}

async function exportarPontoParaPDF() {
    // Pegar informações base
    const nomeFunc = document.getElementById('ponto-nome-funcionario-edicao').textContent;
    let mesLabel = document.getElementById('ponto-mes-edicao-label').textContent;
    mesLabel = mesLabel.replace(/Competência [Rr]eferida:\s*/, '').trim();

    const mesesExtenso = {
        '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
        '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
        '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
    };
    const mesArr = mesLabel.split('/');
    const nomeMesExtenso = mesArr.length === 2 ? mesesExtenso[mesArr[0]] : null;
    const mesLabelDisplay = nomeMesExtenso ? `${mesLabel} - ${nomeMesExtenso}` : mesLabel;

    if (!nomeFunc || nomeFunc === 'Nome do Funcionário') {
        showToast("Você precisa abrir a folha de um funcionário primeiro.", "warning");
        return;
    }

    const btn = event.currentTarget || window.event.currentTarget;
    const oldBtnHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gerando...';
    btn.disabled = true;

    // Configurações e Textos da Empresa
    const empresa = configGerais.pdfEmpresa || 'Nome da Empresa LTDA';
    const cnpj = configGerais.pdfCnpj || '00.000.000/0001-00';

    const ocultarSaldos = !!configGerais.pdfOcultarSaldos;
    const ocultarTimestamp = !!configGerais.pdfOcultarTimestamp;

    // Elementos da tela original
    const tabelaOriginal = document.getElementById('ponto-list');
    const saldoAnt = document.getElementById('ponto-saldo-anterior').textContent;
    const saldoAtu = document.getElementById('ponto-saldo-atual').textContent;
    const saldoTot = document.getElementById('ponto-saldo-total').textContent;

    let htmlPdf = `
        <div style="width: 100%; padding: 10px 20px; margin: 0; background: #ffffff; color: #000000; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; box-sizing: border-box; display: flex; flex-direction: column;">
        <div style="text-align:center; margin-bottom: 5px;">
            <h2 style="margin:0; font-size:16px; color:#1e293b; text-transform: uppercase;">CARTÃO DE PONTO INDIVIDUAL</h2>
            <p style="margin:2px 0; font-size:11px; color:#475569;"><strong>${empresa}</strong> - CNPJ: ${cnpj}</p>
        </div>
        
        <div style="display:flex; justify-content:space-between; margin-bottom: 5px; padding: 5px; border: 1px solid #cbd5e1; border-radius: 6px; background:#f8fafc; font-size:10px;">
            <div>
                <strong>NOME DO COLABORADOR:</strong> <span style="text-transform:uppercase;">${nomeFunc}</span><br>
                <strong style="margin-top:2px; display:inline-block;">COMPETÊNCIA DE APURAÇÃO:</strong> ${mesLabelDisplay}
            </div>
            ${ocultarTimestamp ? '' : `
            <div style="text-align: right;">
                <p style="margin: 0; font-size: 9px; color:#64748b;">GERADO EM</p>
                <strong>${moment().format('DD/MM/YYYY [às] HH:mm')}</strong>
            </div>
            `}
        </div>
        
        <!-- Wrapper Centralizador Flex para o restante do conteúdo -->
        <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: flex-start; padding-top: 20px; padding-bottom: 20px;">
    `;

    // Saldos (se permitido)
    if (!ocultarSaldos) {
        const getColorFromSaldo = (s) => {
            if (!s || s === '00:00' || s === '0:00' || s === '0' || s === '-' || s.includes('NaN')) return '#64748b'; // Cinza
            if (s.startsWith('-')) return '#ef4444'; // Vermelho
            return '#10b981'; // Verde
        };

        const colorAnt = getColorFromSaldo(saldoAnt);
        const colorAtu = getColorFromSaldo(saldoAtu);
        const colorTot = getColorFromSaldo(saldoTot);

        htmlPdf += `
        <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom: 5px; align-items: stretch;">
            <div style="flex:1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px; text-align:center; border-top: 3px solid ${colorAnt}; display: flex; flex-direction: column; justify-content: center;">
                <p style="margin:0; font-size:9px; color:#64748b; text-transform:uppercase; font-weight:bold;">Saldo Anterior</p>
                <h3 style="margin:2px 0 0 0; font-size: 13px; color:${colorAnt};">${saldoAnt}</h3>
            </div>
            <div style="flex:1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px; text-align:center; border-top: 3px solid ${colorAtu}; display: flex; flex-direction: column; justify-content: center;">
                <p style="margin:0; font-size:9px; color:#64748b; text-transform:uppercase; font-weight:bold;">Saldo Atual (Mês)</p>
                <h3 style="margin:2px 0 0 0; font-size: 13px; color:${colorAtu};">${saldoAtu}</h3>
            </div>
            <div style="flex:2; border: 2px solid ${colorTot}; background-color: #f8fafc; border-radius: 6px; padding: 3px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: center;">
                <p style="margin:0; font-size:10px; color:#475569; text-transform:uppercase; font-weight:bolder;">Total Acumulado</p>
                <h3 style="margin:2px 0 0 0; font-size: 15px; font-weight:900; color:${colorTot};">${saldoTot}</h3>
            </div>
        </div>
        `;
    }

    // Início da Tabela
    htmlPdf += `
        <table style="width: 85%; margin: 0 auto; border-collapse: collapse; font-size: 9px; margin-bottom: 5px;">
            <thead>
                <tr style="background-color: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
                    <th style="width: 10%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">DIA</th>
                    <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">ENTRADA 1</th>
                    <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">SAÍDA 1</th>
                    <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">ENTRADA 2</th>
                    <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">SAÍDA 2</th>
                    <th style="width: 8%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">ATRASO</th>
                    <th style="width: 8%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">EXTRA</th>
                    <th style="width: 26%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">OBSERVAÇÃO</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Processar cada linha de ponto da UI pra texto HTML sujo
    const trsOriginal = tabelaOriginal.querySelectorAll('tr');
    trsOriginal.forEach(tr => {
        const dMatch = tr.id.match(/p_tr_(\d+)/);
        if (!dMatch) return;
        const d = dMatch[1];

        // Exclui classe de folga da impressão pra nao gastar tinta cinza em excesso
        const isFolga = document.getElementById(`p_${d}_folga`)?.checked;
        const bgColor = isFolga ? '#f8fafc' : '#ffffff';

        // Capturar valores
        const firstTd = tr.querySelector('td:first-child');
        const diaNum = firstTd && firstTd.childNodes.length > 0 ? firstTd.childNodes[0].textContent.trim() : d.padStart(2, '0');
        const diaSemana = firstTd ? (firstTd.querySelector('span')?.textContent || '') : '';

        let e1 = document.getElementById(`p_${d}_e1`)?.value || '';
        let s1 = document.getElementById(`p_${d}_s1`)?.value || '';
        let e2 = document.getElementById(`p_${d}_e2`)?.value || '';
        let s2 = document.getElementById(`p_${d}_s2`)?.value || '';

        let atraso = document.getElementById(`p_${d}_atraso`)?.textContent.trim() || '';
        let extra = document.getElementById(`p_${d}_extra`)?.textContent.trim() || '';

        // Verifica se os inputs originais estão completamente vazios (não "00:00")
        const isEmpty = (!e1 && !s1 && !e2 && !s2);

        const traco = (val) => (!val || val === '00:00' || val === '0:00' || val === '0') ? '-' : val;

        e1 = traco(e1);
        s1 = traco(s1);
        e2 = traco(e2);
        s2 = traco(s2);
        atraso = traco(atraso);
        extra = traco(extra);

        // Pega a observação no cache global da folha se existir, ou deixa vazio
        const obs = (typeof folhaAtual !== 'undefined' && folhaAtual[d]) ? (folhaAtual[d].observacao || '') : '';

        // Se for folga e não houver preenchimento real (ignorando os "00:00" que o traco() consertou)
        const textDia = `<div style="display:flex; justify-content:center; gap:4px; align-items:baseline;"><strong style="font-size:9px; width:14px; text-align:right;">${diaNum}</strong><span style="font-size:7px; color:#64748b; width:18px; text-align:left;">${diaSemana}</span></div>`;

        if (isFolga && isEmpty) {
            htmlPdf += `
                <tr style="background-color: ${bgColor};">
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;">${textDia}</td>
                    <td colspan="4" style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#94a3b8; font-style:italic; font-weight:bold;">FOLGA</td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#ef4444;">${atraso}</td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#10b981;">${extra}</td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; font-size:8px;">${obs}</td>
                </tr>
            `;
        } else {
            htmlPdf += `
                <tr style="background-color: ${bgColor};">
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;">${textDia}</td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${e1}</strong></td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${s1}</strong></td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${e2}</strong></td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${s2}</strong></td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#ef4444;">${atraso}</td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#10b981;">${extra}</td>
                    <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; font-size:8px;">${obs}</td>
                </tr>
            `;
        }
    });

    htmlPdf += `
            </tbody>
        </table>
        </div> <!-- FECHA WRAPPER FLEX CENTRALIZADOR -->
        </div> <!-- FECHA CONTAINER PRINCIPAL 1080px -->
    `;

    // Iniciar a exportação
    try {
        const docConfig = {
            margin: [5, 10, 5, 10],
            filename: `${mesLabel.replace('/', '-')} - ${nomeFunc}.pdf`,
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: { scale: 2, useCORS: true, scrollY: 0, scrollX: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
        };

        await window.html2pdf().set(docConfig).from(htmlPdf).save();
    } catch (e) {
        console.error("Erro ao gerar PDF:", e);
        showToast("Houve um erro transcrevendo os cartões para o PDF.", "error");
    } finally {
        btn.innerHTML = oldBtnHtml;
        btn.disabled = false;
    }
}

// ==== EXPORTAÇÃO DE PDF DE PONTO VIA ATALHO NA GRID (OFFSCREEN) ====
async function baixarPdfPontoDiretoGrid(event, btn, idFunc, nomeFunc, mesAno) {
    if (event) event.stopPropagation();

    const oldHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    btn.disabled = true;

    try {
        let dadosSalvos = await fetchPontoMes(idFunc, mesAno) || {};
        const diasNoMes = moment(mesAno, 'YYYY-MM').daysInMonth();

        // Calcular totais reais para o PDF lendo o que já está gravado
        let totalAtraso = 0;
        let totalExtra = 0;

        let folhaHTML = '';

        for (let d = 1; d <= diasNoMes; d++) {
            let dataFull = `${mesAno}-${d.toString().padStart(2, '0')}`;
            const translateDay = (dayStr) => ({ 'SUN': 'DOM', 'MON': 'SEG', 'TUE': 'TER', 'WED': 'QUA', 'THU': 'QUI', 'FRI': 'SEX', 'SAT': 'SÁB' }[dayStr] || dayStr);
            let diaSemana = translateDay(moment(dataFull).format('ddd').toUpperCase());
            let textDia = `<div style="display:flex; justify-content:center; gap:4px; align-items:baseline;"><strong style="font-size:9px; width:14px; text-align:right;">${d.toString().padStart(2, '0')}</strong><span style="font-size:7px; color:#64748b; width:18px; text-align:left;">${diaSemana}</span></div>`;

            let saved = dadosSalvos[d] || {};
            let isFolga = !!saved.isFolga;
            let bgColor = isFolga ? '#f8fafc' : '#ffffff';

            let e1 = saved.e1 || '';
            let s1 = saved.s1 || '';
            let e2 = saved.e2 || '';
            let s2 = saved.s2 || '';
            let isAbonado = !!saved.isAbonado;
            let obs = saved.observacao || '';

            let atrasoMin = saved.atrasoMin || 0;
            let extraMin = saved.extraMin || 0;

            if (isAbonado) {
                obs = obs ? (obs + " (Atraso/Falta Abonados)") : "(Atraso/Falta Abonados)";
            }

            if (!isAbonado) totalAtraso += atrasoMin;
            totalExtra += extraMin;

            const isEmpty = (!e1 && !s1 && !e2 && !s2);
            const traco = (val) => (!val || val === '00:00' || val === '0:00' || val === '0') ? '-' : val;

            e1 = traco(e1);
            s1 = traco(s1);
            e2 = traco(e2);
            s2 = traco(s2);

            let strAtraso = atrasoMin > 0 ? formatMinutes(atrasoMin) : '';
            if (isAbonado) strAtraso = '-';
            let strExtra = extraMin > 0 ? formatMinutes(extraMin) : '';

            strAtraso = traco(strAtraso);
            strExtra = traco(strExtra);

            if (isFolga && isEmpty) {
                folhaHTML += `
                    <tr style="background-color: ${bgColor};">
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;">${textDia}</td>
                        <td colspan="4" style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#94a3b8; font-style:italic; font-weight:bold;">FOLGA</td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#ef4444;">${strAtraso}</td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#10b981;">${strExtra}</td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; font-size:8px;">${obs}</td>
                    </tr>
                `;
            } else {
                folhaHTML += `
                    <tr style="background-color: ${bgColor};">
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;">${textDia}</td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${e1}</strong></td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${s1}</strong></td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${e2}</strong></td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center;"><strong>${s2}</strong></td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#ef4444;">${strAtraso}</td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; color:#10b981;">${strExtra}</td>
                        <td style="padding: 2px 1px; border: 1px solid #d1d5db; text-align:center; font-size:8px;">${obs}</td>
                    </tr>
                `;
            }
        }

        let saldoMesLiquido = totalExtra - totalAtraso;
        let saldoAnterior = 0;

        if (dadosSalvos.saldoAnteriorManual !== undefined && dadosSalvos.saldoAnteriorManual !== null && !isNaN(parseFloat(dadosSalvos.saldoAnteriorManual))) {
            saldoAnterior = parseFloat(dadosSalvos.saldoAnteriorManual);
        } else {
            let mesAntMomM = moment(mesAno, 'YYYY-MM').subtract(1, 'months');
            let dbMesAnterior = await fetchPontoMes(idFunc, mesAntMomM.format('YYYY-MM'));
            if (dbMesAnterior && dbMesAnterior.fechamentoAcumulado !== undefined) saldoAnterior = dbMesAnterior.fechamentoAcumulado;
            else if (dbMesAnterior && dbMesAnterior.fechamentoSaldoLiquido) saldoAnterior = dbMesAnterior.fechamentoSaldoLiquido;
        }

        let totalFechamento = saldoAnterior + saldoMesLiquido;

        // Labels
        const mesesExtenso = {
            '01': 'Janeiro', '02': 'Fevereiro', '03': 'Março', '04': 'Abril',
            '05': 'Maio', '06': 'Junho', '07': 'Julho', '08': 'Agosto',
            '09': 'Setembro', '10': 'Outubro', '11': 'Novembro', '12': 'Dezembro'
        };
        const mesArr = mesAno.split('-');
        const mesLabel = `${mesArr[1]}/${mesArr[0]}`;
        const mesLabelDisplay = `${mesLabel} - ${mesesExtenso[mesArr[1]]}`;

        const empresa = configGerais.pdfEmpresa || 'Nome da Empresa LTDA';
        const cnpj = configGerais.pdfCnpj || '00.000.000/0001-00';
        const ocultarSaldos = !!configGerais.pdfOcultarSaldos;
        let htmlPdf = `
            <div style="width: 100%; padding: 10px 20px; margin: 0; background: #ffffff; color: #000000; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; box-sizing: border-box; display: flex; flex-direction: column;">
            <div style="text-align:center; margin-bottom: 5px;">
                <h2 style="margin:0; font-size:16px; color:#1e293b; text-transform: uppercase;">CARTÃO DE PONTO INDIVIDUAL</h2>
                <p style="margin:2px 0; font-size:11px; color:#475569;"><strong>${empresa}</strong> - CNPJ: ${cnpj}</p>
            </div>
            
            <div style="display:flex; justify-content:space-between; margin-bottom: 5px; padding: 5px; border: 1px solid #cbd5e1; border-radius: 6px; background:#f8fafc; font-size:10px;">
                <div>
                    <strong>NOME DO COLABORADOR:</strong> <span style="text-transform:uppercase;">${nomeFunc}</span><br>
                    <strong style="margin-top:2px; display:inline-block;">COMPETÊNCIA DE APURAÇÃO:</strong> ${mesLabelDisplay}
                </div>
                ${!configGerais.pdfOcultarTimestamp ? `
                <div style="text-align: right;">
                    <p style="margin: 0; font-size: 9px; color:#64748b;">GERADO EM</p>
                    <strong>${moment().format('DD/MM/YYYY [às] HH:mm')}</strong>
                </div>` : ''}
            </div>
            <div style="flex-grow: 1; display: flex; flex-direction: column; justify-content: flex-start; padding-top: 20px; padding-bottom: 20px;">
        `;

        // Saldos
        if (!ocultarSaldos) {
            const getCor = (sNum) => {
                if (sNum === 0 || isNaN(sNum)) return '#64748b';
                if (sNum < 0) return '#ef4444';
                return '#10b981';
            };
            const cAnt = getCor(saldoAnterior), cMes = getCor(saldoMesLiquido), cTot = getCor(totalFechamento);

            htmlPdf += `
            <div style="display:flex; justify-content:space-between; gap:10px; margin-bottom: 5px; align-items: stretch;">
                <div style="flex:1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px; text-align:center; border-top: 3px solid ${cAnt}; display: flex; flex-direction: column; justify-content: center;">
                    <p style="margin:0; font-size:9px; color:#64748b; text-transform:uppercase; font-weight:bold;">Saldo Anterior</p>
                    <h3 style="margin:2px 0 0 0; font-size: 13px; color:${cAnt};">${formatMinutes(saldoAnterior)}</h3>
                </div>
                <div style="flex:1; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px; text-align:center; border-top: 3px solid ${cMes}; display: flex; flex-direction: column; justify-content: center;">
                    <p style="margin:0; font-size:9px; color:#64748b; text-transform:uppercase; font-weight:bold;">Saldo Atual (Mês)</p>
                    <h3 style="margin:2px 0 0 0; font-size: 13px; color:${cMes};">${formatMinutes(saldoMesLiquido)}</h3>
                </div>
                <div style="flex:2; border: 2px solid ${cTot}; background-color: #f8fafc; border-radius: 6px; padding: 3px; text-align:center; box-shadow: 0 1px 3px rgba(0,0,0,0.05); display: flex; flex-direction: column; justify-content: center;">
                    <p style="margin:0; font-size:10px; color:#475569; text-transform:uppercase; font-weight:bolder;">Total Acumulado</p>
                    <h3 style="margin:2px 0 0 0; font-size: 15px; font-weight:900; color:${cTot};">${formatMinutes(totalFechamento)}</h3>
                </div>
            </div>`;
        }

        htmlPdf += `
            <table style="width: 85%; margin: 0 auto; border-collapse: collapse; font-size: 9px; margin-bottom: 5px;">
                <thead>
                    <tr style="background-color: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
                        <th style="width: 10%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">DIA</th>
                        <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">ENTRADA 1</th>
                        <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">SAÍDA 1</th>
                        <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">ENTRADA 2</th>
                        <th style="width: 12%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">SAÍDA 2</th>
                        <th style="width: 8%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">ATRASO</th>
                        <th style="width: 8%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">EXTRA</th>
                        <th style="width: 26%; padding: 1px; border: 1px solid #d1d5db; text-align:center;">OBSERVAÇÃO</th>
                    </tr>
                </thead>
                <tbody>
                ${folhaHTML}
                </tbody>
            </table>
            </div>
            </div>`;

        const docConfig = {
            margin: [5, 10, 5, 10],
            filename: `${mesLabel.replace('/', '-')} - ${nomeFunc}.pdf`,
            image: { type: 'jpeg', quality: 1.0 },
            html2canvas: { scale: 2, useCORS: true, scrollY: 0, scrollX: 0 },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
        };

        await window.html2pdf().set(docConfig).from(htmlPdf).save();

    } catch (e) {
        console.error("Erro offscreen PDF:", e);
        showToast("Houve um erro exportando PDF.", "error");
    } finally {
        btn.innerHTML = oldHtml;
        btn.disabled = false;
    }
}

function toggleFolgaPonto(d) {
    let cb = document.getElementById(`p_${d}_folga`).checked;
    folhaAtual[d].isFolga = cb;
    pontoFoiAlterado = true;

    let tr = document.getElementById(`p_tr_${d}`);
    if (cb) {
        tr.style.background = 'rgba(16, 185, 129, 0.05)';
    } else {
        const translateDay = (d) => ({ 'SUN': 'DOM', 'MON': 'SEG', 'TUE': 'TER', 'WED': 'QUA', 'THU': 'QUI', 'FRI': 'SEX', 'SAT': 'SÁB' }[d] || d);
        let diaSemana = translateDay(moment(folhaAtual[d].data).format('ddd').toUpperCase());
        if (diaSemana === 'DOM' || diaSemana === 'SÁB') {
            tr.style.background = 'rgba(0,0,0,0.02)';
        } else {
            tr.style.background = 'transparent';
        }
    }
    calcularLinhaPonto(d);
}

function toggleCartaoConferido(isChecked) {
    pontoFoiAlterado = true;
    if (isChecked) {
        showToast("Cartão marcado como Conferido. Lembre-se de Gravar a Folha.", "info");
    }
}

function toggleAbonarPonto(d) {
    let cb = document.getElementById(`p_${d}_abonar`).checked;
    folhaAtual[d].isAbonado = cb;
    pontoFoiAlterado = true;
    atualizarDOMPonto(d);
    recalcularSaldoMes();
}

function abrirObsPonto(d) {
    // Remove qualquer instância anterior
    document.querySelectorAll('.obs-ponto-popover').forEach(el => el.remove());

    const btn = document.getElementById(`p_${d}_obs_btn`);
    const obsAtual = folhaAtual[d].observacao || '';

    const pop = document.createElement('div');
    pop.className = 'obs-ponto-popover';
    pop.innerHTML = `
        <div class="obs-ponto-popover-header">
            <span><i class="fa-solid fa-comment-dots"></i> Dia ${String(d).padStart(2, '0')} — Observação</span>
            <button onclick="document.querySelectorAll('.obs-ponto-popover').forEach(e=>e.remove())" style="background:none;border:none;cursor:pointer;color:var(--text-light);font-size:1.1rem;"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <textarea id="obs_textarea_${d}" class="obs-ponto-textarea" placeholder="Digite uma observação para este dia...">${obsAtual}</textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
            <button class="btn-secondary" style="padding:6px 14px;font-size:0.85rem;" onclick="document.querySelectorAll('.obs-ponto-popover').forEach(e=>e.remove())">Cancelar</button>
            <button class="btn-primary" style="padding:6px 14px;font-size:0.85rem;" onclick="salvarObsPonto(${d})">Salvar</button>
        </div>
    `;

    // position: absolute relativo ao documento inteiro (rect + scroll)
    // Assim o popover fica abaixo do botão e rola junto com a página
    const rect = btn.getBoundingClientRect();
    pop.style.position = 'absolute';
    pop.style.top = (rect.bottom + window.scrollY + 6) + 'px';
    pop.style.left = Math.min(rect.left + window.scrollX, document.documentElement.scrollWidth - 345) + 'px';
    pop.style.zIndex = '9999';
    document.body.appendChild(pop);

    setTimeout(() => document.getElementById(`obs_textarea_${d}`)?.focus(), 50);
}

function salvarObsPonto(d) {
    const texto = (document.getElementById(`obs_textarea_${d}`)?.value || '').trim();
    folhaAtual[d].observacao = texto;
    pontoFoiAlterado = true;

    const btn = document.getElementById(`p_${d}_obs_btn`);
    if (btn) {
        btn.innerHTML = texto
            ? '<i class="fa-solid fa-comment-dots" style="color: var(--primary);"></i>'
            : '<i class="fa-regular fa-comment"></i>';
        btn.title = texto || 'Adicionar observação';
    }

    document.querySelectorAll('.obs-ponto-popover').forEach(el => el.remove());
}



// -----------------------------------------------------
// SELEÇÃO CUSTOMIZADA DE FUNCIONARIO (MODAL)
// -----------------------------------------------------

function abrirModalSelecaoFuncPonto() {
    document.getElementById('search-modal-funcs-ponto').value = '';
    document.getElementById('ordem-modal-funcs-ponto').value = 'nome';
    renderListaModalFuncsPonto();
    document.getElementById('modal-selecao-func-ponto').classList.remove('hidden');
}

function fecharModalSelecaoFuncPonto() {
    document.getElementById('modal-selecao-func-ponto').classList.add('hidden');
}

function renderListaModalFuncsPonto() {
    const termo = _norm(document.getElementById('search-modal-funcs-ponto').value);
    const ordem = document.getElementById('ordem-modal-funcs-ponto').value;
    const tbody = document.getElementById('lista-modal-funcs-ponto');
    tbody.innerHTML = '';

    let filtrados = funcionariosList.filter(f => !f.desligado && _fuzzyMatch(f.nome, termo));

    if (ordem === 'nome') {
        filtrados.sort((a, b) => a.nome.localeCompare(b.nome));
    } else if (ordem === 'unidade') {
        filtrados.sort((a, b) => {
            if (a.unidade < b.unidade) return -1;
            if (a.unidade > b.unidade) return 1;
            return a.nome.localeCompare(b.nome);
        });
    }

    if (filtrados.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color: var(--text-light);">Nenhum colaborador encontrado.</td></tr>`;
        return;
    }

    filtrados.forEach(f => {
        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 500;">${f.nome}</td>
            <td><span class="status-badge" style="background: rgba(148, 163, 184, 0.1); color: var(--text-main); font-weight: normal; font-size: 0.75rem;">${f.unidade}</span></td>
            <td>
                <button class="btn-primary" style="padding: 4px 10px; font-size: 0.8rem;" onclick="cravarFuncionarioPonto('${f.idFunc}', '${f.nome.replace(/'/g, "\'")}')">
                    <i class="fa-solid fa-check"></i> Escolher
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    window.scrollTo(0, preservedScroll);
}

function cravarFuncionarioPonto(idFunc, nome) {
    document.getElementById('ponto-select-func').value = idFunc;

    // Altera o visual do botao
    let btn = document.getElementById('btn-selecionar-func-ponto');
    btn.innerHTML = `<span style="font-weight: 600; color: var(--primary);"><i class="fa-solid fa-user-check" style="margin-right:8px;"></i> ${esc(nome)}</span> <i class="fa-solid fa-user-pen" style="color: var(--text-light);"></i>`;
    btn.style.borderColor = 'var(--primary)';
    btn.style.background = 'rgba(67, 97, 238, 0.03)';

    fecharModalSelecaoFuncPonto();
    renderFolhaPonto();
}



// =========================================
// MÓDULO DE INTELIGÊNCIA OCR (FASE 2)
// =========================================

let ocrQueue = [];
let ocrIsProcessing = false;
let ocrIsPaused = false;
let ocrGlobaisMapeados = 0; // Quantos arquivos entraram na fila pra métrica

async function adicionarCartoesFila(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    if (!configGerais.geminiKey) {
        showToast("Erro: Configure sua Chave do Gemini na aba de Configurações primeiro.", "error");
        return;
    }

    const mesAno = document.getElementById('ponto-mes-ano').value;
    if (!mesAno) {
        showToast("Selecione uma competência (Mês/Ano) principal antes de subir o lote.", "warning");
        return;
    }

    abrirModalFilaOcr();

    // Codifica todos pra memoria
    for (let i = 0; i < files.length; i++) {
        let file = files[i];
        try {
            let b64 = await fileToBase64(file);
            let rawB64 = b64.split(',')[1];

            ocrQueue.push({
                id: Date.now() + "_" + i,
                filename: file.name,
                mimeType: file.type,
                base64: rawB64,
                status: 'pendente', // pendente, rodando, sucesso, erro
                msgRetorno: '',
                mesReferencia: mesAno
            });
            ocrGlobaisMapeados++;
        } catch (e) {
            console.error("Erro ao ler", file.name);
        }
    }

    event.target.value = ''; // reseta
    salvarFilaOcrStorage();
    renderFilaOcr();

    if (!ocrIsProcessing && !ocrIsPaused) {
        processarFilaOcrWorker();
    }
}

function abrirModalFilaOcr() {
    document.getElementById('modal-fila-ocr').classList.remove('hidden');
    renderFilaOcr();
}

function fecharModalFilaOcr() {
    document.getElementById('modal-fila-ocr').classList.add('hidden');
}

function togglePauseOcr() {
    ocrIsPaused = !ocrIsPaused;
    let btn = document.getElementById('btn-ocr-pause');
    if (ocrIsPaused) {
        btn.innerHTML = '<i class="fa-solid fa-play"></i> Continuar Fila';
        btn.style.color = 'var(--success)';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-pause"></i> Pausar Fila';
        btn.style.color = '';
        if (!ocrIsProcessing) processarFilaOcrWorker();
    }
}

function limparFilaOcr() {
    ocrQueue = ocrQueue.filter(item => item.status === 'pendente' || item.status === 'rodando');
    ocrGlobaisMapeados = ocrQueue.length;
    salvarFilaOcrStorage();
    renderFilaOcr();
}

function renderFilaOcr() {
    const tbody = document.getElementById('ocr-queue-list');
    const badge = document.getElementById('ocr-fila-badge');
    const badgeStr = document.getElementById('ocr-progress-text');
    const bar = document.getElementById('ocr-progress-bar');

    let pendentes = 0;
    let concluidos = 0;

    tbody.innerHTML = '';

    if (ocrQueue.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-light); padding: 20px;">Nenhum cartão na fila no momento.</td></tr>';
        badgeStr.textContent = `0% (0 de 0)`;
        bar.style.width = '0%';
        badge.style.display = 'none';
        return;
    }

    ocrQueue.forEach(item => {
        let sColor = 'var(--text-light)';
        let sIcon = '<i class="fa-solid fa-clock"></i>';

        if (item.status === 'pendente') {
            pendentes++;
            sColor = 'var(--text-light)';
            sIcon = '<i class="fa-solid fa-clock"></i> Aguardando';
        } else if (item.status === 'rodando') {
            sColor = 'var(--primary)';
            sIcon = '<i class="fa-solid fa-spinner fa-spin"></i> Processando...';
        } else if (item.status === 'sucesso') {
            concluidos++;
            sColor = 'var(--success)';
            sIcon = '<i class="fa-solid fa-check"></i> Sucesso';
        } else if (item.status === 'vincular') {
            concluidos++; // Parcialmente concluido
            sColor = 'var(--warning)';
            sIcon = '<i class="fa-solid fa-link"></i> Requer Vínculo';
        } else if (item.status === 'erro') {
            concluidos++; // Também conta como processado (tentativa falha)
            sColor = 'var(--danger)';
            sIcon = '<i class="fa-solid fa-triangle-exclamation"></i> Falha';
        }

        let tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight: 500;">${esc(item.filename)}</td>
            <td style="color: ${sColor}; font-weight: 600;">${sIcon}</td>
            <td style="font-size: 0.8rem; color: var(--text-light); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${esc(item.msgRetorno)}">${item.msgRetorno ? esc(item.msgRetorno) : '-'}</td>
            <td style="text-align: right;">
                <div style="display: flex; gap: 5px; justify-content: flex-end;">
                    ${item.status === 'vincular' ? `<button class="btn-primary" onclick="abrirModalVincularOcr('${item.id}')" style="padding: 2px 8px; font-size: 0.75rem;"><i class="fa-solid fa-link"></i> Vincular</button>` : ''}
                    ${(item.status === 'pendente' || item.status === 'vincular' || item.status === 'erro') ? `<button onclick="removerItemOcr('${item.id}')" style="background:none; border:none; color:var(--danger); cursor:pointer;" title="Excluir"><i class="fa-solid fa-times"></i></button>` : ''}
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Calcula Progresso Baseado nos itens Globais submetidos
    let percent = 0;
    if (ocrGlobaisMapeados > 0) {
        percent = Math.floor((concluidos / ocrGlobaisMapeados) * 100);
    }

    badgeStr.textContent = `${percent}% (${concluidos} de ${ocrGlobaisMapeados})`;
    bar.style.width = `${percent}%`;

    let sidebarBadge = document.getElementById('ocr-sidebar-badge');
    if (pendentes > 0 || (ocrIsProcessing && percent < 100)) {
        badge.style.display = 'inline-block';
        badge.textContent = pendentes;

        if (sidebarBadge) {
            sidebarBadge.style.display = 'block';
            sidebarBadge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processando: ${percent}%`;
        }
    } else {
        badge.style.display = 'none';
        if (sidebarBadge) {
            if (ocrGlobaisMapeados > 0 && percent === 100) {
                sidebarBadge.style.display = 'block';
                sidebarBadge.style.color = 'var(--success)';
                sidebarBadge.innerHTML = `<i class="fa-solid fa-check"></i> Finalizado`;
                // Apaga depois de 5s
                setTimeout(() => { if (sidebarBadge.innerHTML.includes('Finalizado')) sidebarBadge.style.display = 'none'; }, 5000);
            } else {
                sidebarBadge.style.display = 'none';
            }
        }
    }
}

function removerItemOcr(id) {
    ocrQueue = ocrQueue.filter(i => i.id !== id);
    ocrGlobaisMapeados--;
    salvarFilaOcrStorage();
    renderFilaOcr();
}

async function processarFilaOcrWorker() {
    if (ocrIsProcessing || ocrIsPaused) return;

    let proximo = ocrQueue.find(i => i.status === 'pendente');
    if (!proximo) {
        ocrIsProcessing = false;
        renderListaPonto(); // Atualiza painel principal pois todos terminaram
        return;
    }

    ocrIsProcessing = true;
    proximo.status = 'rodando';
    renderFilaOcr();

    try {
        let aiResult = await chamarGeminiVisionLote(proximo);
        let validadoObj = await validarEGravarPontoLote(aiResult, proximo.mesReferencia);

        if (validadoObj.pendentes && validadoObj.pendentes.length > 0) {
            proximo.status = 'vincular';
            proximo.msgRetorno = "Extração limpa. Resolva " + validadoObj.pendentes.length + " vínculo(s).";
            proximo.aiMismatchedObjs = validadoObj.pendentes; // Cache memory Array [ {nome_lido_cartao, dias}, ... ]
            proximo.aiMismatchedObjsTotal = validadoObj.pendentes.length; // Salva o Length base pra usar no contador ex "1 de 3"
        } else {
            proximo.status = 'sucesso';
            proximo.msgRetorno = validadoObj.msg;
        }
    } catch (e) {
        console.error(e);
        proximo.status = 'erro';
        proximo.msgRetorno = e.message || "Falha na decodificação ou Rate Limit";
    }

    salvarFilaOcrStorage();
    renderFilaOcr();

    // Delay de Descompressão (Anti-Gargalo Rate Limit Free Tier 15 RPM = 4seg per call)
    await new Promise(r => setTimeout(r, 4500));

    ocrIsProcessing = false;
    processarFilaOcrWorker(); // Loop recursivo de Worker
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

async function chamarGeminiVisionLote(fileItem) {
    const apiKey = configGerais.geminiKey;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const promptText = `
Você é um Extrator de PDF/Imagens contábil de altíssima precisão. Cumpra:
1. Extraia o Nome ou Assinatura contido no cartão com exatidão. Procure ativamente a string do NOME DO FUNCIONÁRIO na foto.
2. Formato HH:MM dos dias.
3. Responda ESTRITAMENTE num ARRAY JSON formatado. Mesmo se houver apenas 1 cartão na foto, DEVOLVA UM ARRAY DE OBJETOS:
[
  {
    "nome_lido_cartao": "O nome que identificou no topo ou rodapé do primeiro cartão",
    "dias": { "1": {"e1": "08:00", ... "folga": false} }
  },
  {
    "nome_lido_cartao": "Opcional: Se houver um segundo cartão na mesma foto, extraia para ele",
    "dias": { ... }
  }
]
Responda APENAS o JSON puro. Não invente lixos ou acentos e preserve a veracidade do nome e das horas!`;

    const bodyPay = {
        "contents": [{
            "parts": [
                { "text": promptText },
                {
                    "inline_data": {
                        "mime_type": fileItem.mimeType,
                        "data": fileItem.base64
                    }
                }
            ]
        }],
        "generationConfig": {
            "temperature": 0.1,
            "response_mime_type": "application/json"
        }
    };

    const MAX_TENTATIVAS = 3;
    const DELAYS_RETRY = [5000, 15000]; // espera 5s na 2ª tentativa, 15s na 3ª

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPay)
            });
        } catch (networkErr) {
            // Erro de rede (sem conexão, fetch falhou)
            if (tentativa < MAX_TENTATIVAS) {
                console.warn(`[Gemini] Falha de rede (tentativa ${tentativa}/${MAX_TENTATIVAS}). Aguardando ${DELAYS_RETRY[tentativa - 1] / 1000}s...`);
                await new Promise(r => setTimeout(r, DELAYS_RETRY[tentativa - 1]));
                continue;
            }
            throw new Error("Sem conexão com a API. Verifique sua internet.");
        }

        if (res.ok) {
            let jsonResponse = await res.json();
            let textOut = jsonResponse.candidates[0].content.parts[0].text;
            textOut = textOut.replace(/```json/g, '').replace(/```/g, '').trim();
            return JSON.parse(textOut);
        }

        // Erros que valem a pena tentar novamente
        const retrySafeCodes = [500, 503, 529];
        if (retrySafeCodes.includes(res.status) && tentativa < MAX_TENTATIVAS) {
            const delay = DELAYS_RETRY[tentativa - 1];
            console.warn(`[Gemini] API retornou ${res.status} (tentativa ${tentativa}/${MAX_TENTATIVAS}). Aguardando ${delay / 1000}s antes de tentar novamente...`);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }

        // Erros sem retry
        if (res.status === 429) throw new Error("Limite de velocidade gratuito atingido. Aguarde alguns segundos e tente de novo.");
        if (res.status === 400) throw new Error("Imagem inválida ou corrompida (Erro 400). Verifique o arquivo.");
        if (res.status === 401 || res.status === 403) throw new Error("Chave de API inválida ou sem permissão (Erro " + res.status + "). Verifique nas configurações.");
        if (res.status === 503) throw new Error("Serviço da API temporariamente indisponível (503). Tente novamente em instantes.");
        throw new Error(`Erro na API: ${res.status}. Tente novamente.`);
    }

    throw new Error("A API falhou após 3 tentativas. Tente novamente mais tarde.");
}

async function validarEGravarPontoLote(aiArray, mesAno) {
    // Agora esperamos que aiArray seja um Array (mesmo se contiver 1 só elemento)
    if (!Array.isArray(aiArray)) {
        throw new Error("Formato inválido retornado pela IA (Não é array).");
    }

    if (aiArray.length === 0) {
        throw new Error("Nenhum cartão identificado na imagem.");
    }

    let mensagensSucesso = [];
    let mensagensErro = [];
    let pendentesVincularArray = [];

    for (let aiJSON of aiArray) {
        let lido = aiJSON.nome_lido_cartao || "";
        if (lido.trim() === "") {
            aiJSON.nome_lido_cartao = "Ilegível / Sem Nome";
            pendentesVincularArray.push(aiJSON);
            continue;
        }

        let nomeLidoLimpo = lido.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

        // Motor de Busca por Semelhança Simples
        let matches = [];
        for (let f of funcionariosList) {
            if (f.desligado) continue; // Pula desligados

            let nomeBaseLimpo = f.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            let splitBase = nomeBaseLimpo.split(" ");

            if (nomeBaseLimpo === nomeLidoLimpo) {
                matches.push(f);
            } else if (nomeLidoLimpo.includes(splitBase[0]) && (splitBase.length > 1 && nomeLidoLimpo.includes(splitBase[splitBase.length - 1]))) {
                matches.push(f);
            } else if (nomeBaseLimpo.includes(nomeLidoLimpo) && nomeLidoLimpo.length > 5) {
                matches.push(f);
            }
        }

        if (matches.length !== 1) { // 0 ou múltiplos matches
            if (matches.length > 1) {
                aiJSON.nome_lido_cartao += " (Múltiplos achados)";
            }
            pendentesVincularArray.push(aiJSON);
            continue;
        }

        let funcMatched = matches[0];

        // Puxar banco atual daquela pessoa no mês
        let dbAtual = await fetchPontoMes(funcMatched.idFunc, mesAno) || {};

        // Iterar e injetar
        let alterouAlgo = false;
        for (let d = 1; d <= 31; d++) {
            if (aiJSON.dias && aiJSON.dias[d.toString()]) {
                let info = aiJSON.dias[d.toString()];

                let val_e1 = formatTimeVal(info.e1);
                let val_s1 = formatTimeVal(info.s1);
                let val_e2 = formatTimeVal(info.e2);
                let val_s2 = formatTimeVal(info.s2);

                let temCarga = (val_e1 || val_s1 || val_e2 || val_s2 || info.folga);

                if (temCarga) {
                    if (!dbAtual[d]) dbAtual[d] = { atrasoMin: 0, extraMin: 0 };

                    dbAtual[d].e1 = val_e1 || dbAtual[d].e1 || "";
                    dbAtual[d].s1 = val_s1 || dbAtual[d].s1 || "";
                    dbAtual[d].e2 = val_e2 || dbAtual[d].e2 || "";
                    dbAtual[d].s2 = val_s2 || dbAtual[d].s2 || "";

                    if (info.folga !== undefined) dbAtual[d].isFolga = info.folga;

                    // Recalcular saldo desse dia avulso usando matemática pura
                    let dReg = dbAtual[d];
                    let e1_m = timeToMinutes(dReg.e1);
                    let s1_m = timeToMinutes(dReg.s1);
                    let e2_m = timeToMinutes(dReg.e2);
                    let s2_m = timeToMinutes(dReg.s2);
                    let saldoD = 0;
                    if (!dReg.isFolga) {
                        if (e1_m > 0 && s1_m > 0) saldoD += (s1_m - e1_m);
                        if (e2_m > 0 && s2_m > 0) saldoD += (s2_m - e2_m);
                        saldoD -= 440; // 07:20
                    }
                    if (Math.abs(saldoD) <= 10) saldoD = 0;

                    if (saldoD > 0) { dReg.extraMin = saldoD; dReg.atrasoMin = 0; }
                    else if (saldoD < 0) { dReg.atrasoMin = Math.abs(saldoD); dReg.extraMin = 0; }
                    else { dReg.atrasoMin = 0; dReg.extraMin = 0; }

                    alterouAlgo = true;
                }
            }
        }

        if (!alterouAlgo) {
            mensagensErro.push(`Vazio detectado em ${funcMatched.nome}`);
            continue;
        }

        // Consolidação Saldo Líquido do Mês
        let somatorioL = 0;
        for (let d = 1; d <= 31; d++) {
            if (dbAtual[d]) somatorioL += (dbAtual[d].extraMin || 0) - (dbAtual[d].atrasoMin || 0);
        }
        dbAtual.fechamentoSaldoLiquido = somatorioL;

        let saldoAntNuvem = dbAtual.saldoAnteriorManual !== undefined ? dbAtual.saldoAnteriorManual : 0;
        dbAtual.fechamentoAcumulado = saldoAntNuvem + somatorioL;

        await fetch(`${FIREBASE_URL}pontos/${funcMatched.idFunc}_${mesAno}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dbAtual)
        });

        mensagensSucesso.push(funcMatched.nome);
    }

    // Avisar UI na aba principal (se aberto) pra re-renderizar o bloco de cores
    if (document.getElementById('ponto-lista-container').style.display !== 'none') {
        renderListaPonto();
    }

    if (mensagensSucesso.length === 0 && mensagensErro.length > 0 && pendentesVincularArray.length === 0) {
        throw new Error(mensagensErro.join(" | "));
    }

    let finalStr = "";
    if (mensagensSucesso.length > 0) finalStr += `Salvo em ${mensagensSucesso.length} doc(s): ` + mensagensSucesso.join(", ");
    if (mensagensErro.length > 0) finalStr += ` | Falhas anexas: ` + mensagensErro.join(", ");

    return {
        msg: finalStr,
        pendentes: pendentesVincularArray
    };
}

// ================= VINCULAÇÃO MANUAL LOTE ================= //

function abrirModalVincularOcr(itemId) {
    let itemQueue = ocrQueue.find(i => i.id === itemId);
    if (!itemQueue || !itemQueue.aiMismatchedObjs || itemQueue.aiMismatchedObjs.length === 0) return;

    // Seta a Imagem
    let preview = document.getElementById('ocr-preview-img');
    preview.src = "data:" + itemQueue.mimeType + ";base64," + itemQueue.base64;

    // Seleciona sempre o índice 0 da fila de Mismatches anexadas a esta foto
    let missingCard = itemQueue.aiMismatchedObjs[0];

    document.getElementById('ocr-vincular-item-id').value = itemQueue.id;
    document.getElementById('ocr-vincular-item-idx').value = "0"; // Apanhando o 1o pra vincular

    // Popula Label Contadora (Ex: Cartão 1 de 3)
    let total = itemQueue.aiMismatchedObjsTotal || 1;
    let indexAtualBase1 = (total - itemQueue.aiMismatchedObjs.length) + 1;
    let contadorLbl = document.getElementById('ocr-vincular-contador');
    if (contadorLbl) {
        contadorLbl.innerHTML = total > 1
            ? `<i class="fa-solid fa-layer-group"></i> Cartão ${indexAtualBase1} de ${total}`
            : `<i class="fa-solid fa-file-invoice"></i> Único`;
    }

    // Renderiza Dicas de Extração (As horas lidas na memória) para o usuário olhar
    let htmlDicas = "";
    if (missingCard.dias) {
        for (let d = 1; d <= 31; d++) {
            if (missingCard.dias[d.toString()]) {
                let info = missingCard.dias[d.toString()];
                let ar = [];
                if (info.e1) ar.push(`Ent1: ${info.e1}`);
                if (info.s1) ar.push(`Sai1: ${info.s1}`);
                if (info.e2) ar.push(`Ent2: ${info.e2}`);
                if (info.s2) ar.push(`Sai2: ${info.s2}`);
                if (info.folga) ar.push(`[Folga/Ausência]`);

                if (ar.length > 0) {
                    htmlDicas += `Dia ${d.toString().padStart(2, '0')}: ${ar.join(' | ')}\n`;
                }
            }
        }
    }
    if (!htmlDicas) htmlDicas = "Nesta grade, nenhuma batida clara foi legível pela Inteligência.";
    document.getElementById('ocr-dicas-extracao').textContent = htmlDicas;

    // Prepara Custom Dropdown de Funcionários Activos
    document.getElementById('ocr-vincular-target-func-id').value = "";
    document.getElementById('ocr-vincular-search').value = "";
    document.getElementById('ocr-vincular-list').style.display = 'none';

    window._ocrListaAtivos = funcionariosList.filter(f => !f.desligado).sort((a, b) => a.nome.localeCompare(b.nome));

    renderOcrDropdownList(window._ocrListaAtivos, missingCard.nome_lido_cartao);

    document.getElementById('modal-ocr-vincular').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function renderOcrDropdownList(lista, hintName) {
    let listaBx = document.getElementById('ocr-vincular-list');
    listaBx.innerHTML = '';

    if (hintName) {
        let divH = document.createElement('div');
        divH.style.padding = '8px 14px';
        divH.style.fontSize = '0.85rem';
        divH.style.color = 'var(--text-light)';
        divH.style.borderBottom = '1px solid rgba(0,0,0,0.05)';
        divH.style.backgroundColor = 'rgba(0,0,0,0.02)';
        divH.innerHTML = `<i class="fa-solid fa-signature"></i> Nome lido: <strong>${hintName}</strong>`;
        listaBx.appendChild(divH);
    }

    if (lista.length === 0) {
        let div0 = document.createElement('div');
        div0.className = 'custom-dropdown-item';
        div0.style.color = 'var(--text-light)';
        div0.textContent = "Nenhum resultado.";
        listaBx.appendChild(div0);
        return;
    }

    lista.forEach(f => {
        let div = document.createElement('div');
        div.className = 'custom-dropdown-item';
        let uStatus = f.unidade ? f.unidade.trim() : 'Sem Unidade';
        div.textContent = `${f.nome} (${uStatus})`;
        div.onclick = () => {
            document.getElementById('ocr-vincular-target-func-id').value = f.idFunc;
            document.getElementById('ocr-vincular-search').value = f.nome;
            document.getElementById('ocr-vincular-list').style.display = 'none';
        };
        listaBx.appendChild(div);
    });
}

// Listeners do Input Search do Dropdown
document.getElementById('ocr-vincular-search').addEventListener('input', function (e) {
    let val = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    document.getElementById('ocr-vincular-list').style.display = 'block';

    let filter = window._ocrListaAtivos.filter(f => {
        let n = f.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let u = f.unidade ? f.unidade.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') : '';
        return n.includes(val) || f.cpf.replace(/\D/g, '').includes(val) || u.includes(val);
    });

    // Renderiza sem hint superior para focar na pesquisa
    renderOcrDropdownList(filter, "");
});

document.getElementById('ocr-vincular-search').addEventListener('focus', function (e) {
    document.getElementById('ocr-vincular-list').style.display = 'block';
    if (!e.target.value) {
        let currId = document.getElementById('ocr-vincular-item-id').value;
        let itemQueue = ocrQueue.find(i => i.id === currId);
        if (itemQueue && itemQueue.aiMismatchedObjs) {
            let missingCard = itemQueue.aiMismatchedObjs[0];
            renderOcrDropdownList(window._ocrListaAtivos, missingCard.nome_lido_cartao);
        }
    }
});

// Fecha ao clicar fora
document.addEventListener('click', function (e) {
    let dropArea = document.getElementById('ocr-vincular-dropdown');
    if (dropArea && !dropArea.contains(e.target)) {
        let lista = document.getElementById('ocr-vincular-list');
        if (lista) lista.style.display = 'none';
    }
});

let ocrCurrentScale = 1;
let ocrIsZoomHovered = false;

function handleOcrZoom(e) {
    let box = document.getElementById('ocr-zoom-box');
    let img = document.getElementById('ocr-preview-img');
    if (!box || !img) return;

    let rect = box.getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    // Calcula % da posição do mouse dentro do box
    let xPercent = (x / rect.width) * 100;
    let yPercent = (y / rect.height) * 100;

    img.style.transformOrigin = `${xPercent}% ${yPercent}%`;

    // Zoom inicial ao entrar na div
    if (!ocrIsZoomHovered) {
        ocrIsZoomHovered = true;
        ocrCurrentScale = 2.2;
        img.style.transform = `scale(${ocrCurrentScale})`;
    }
}

function handleOcrScroll(e) {
    e.preventDefault(); // Evita scroll da pagina atras
    let img = document.getElementById('ocr-preview-img');
    if (!img) return;

    let zoomIntensity = 0.4;
    if (e.deltaY < 0) {
        // Rolar pra cima (Zoom In)
        ocrCurrentScale += zoomIntensity;
    } else {
        // Rolar pra baixo (Zoom Out)
        ocrCurrentScale -= zoomIntensity;
    }

    // Limites Seguro
    if (ocrCurrentScale < 1) ocrCurrentScale = 1;
    if (ocrCurrentScale > 8) ocrCurrentScale = 8;

    img.style.transform = `scale(${ocrCurrentScale})`;
}

function resetOcrZoom() {
    let img = document.getElementById('ocr-preview-img');
    if (img) {
        img.style.transformOrigin = `center center`;
        img.style.transform = `scale(1)`;
        ocrCurrentScale = 1;
        ocrIsZoomHovered = false;
    }
}

function fecharModalVincularOcr() {
    document.getElementById('modal-ocr-vincular').classList.add('hidden');
    document.body.style.overflow = '';
}

async function confirmarVinculacaoOcr() {
    let itemId = document.getElementById('ocr-vincular-item-id').value;
    let itemIdx = parseInt(document.getElementById('ocr-vincular-item-idx').value);
    let targetFuncId = document.getElementById('ocr-vincular-target-func-id').value;

    if (!targetFuncId) {
        showToast("Escolha um funcionário na lista para prosseguir.", "warning");
        return;
    }

    let itemQueue = ocrQueue.find(i => i.id === itemId);
    let aiJSON = itemQueue.aiMismatchedObjs[itemIdx];
    let mesAno = itemQueue.mesReferencia;
    let targetFuncData = funcionariosList.find(f => f.idFunc === targetFuncId);

    // Aviso Removido (Não fechar modal imediatamente para controle sequencial)
    // showToast("Aplicando folha ao funcionário " + targetFuncData.nome + "...", "warning");

    try {
        // Aproveitamos a matemática bruta do DB já construída, adaptando para singular force-feed
        let dbAtual = await fetchPontoMes(targetFuncData.idFunc, mesAno) || {};

        for (let d = 1; d <= 31; d++) {
            if (aiJSON.dias && aiJSON.dias[d.toString()]) {
                let info = aiJSON.dias[d.toString()];
                let temCarga = (info.e1 || info.s1 || info.e2 || info.s2 || info.folga);

                if (temCarga) {
                    if (!dbAtual[d]) dbAtual[d] = { atrasoMin: 0, extraMin: 0 };
                    dbAtual[d].e1 = formatTimeVal(info.e1) || dbAtual[d].e1 || "";
                    dbAtual[d].s1 = formatTimeVal(info.s1) || dbAtual[d].s1 || "";
                    dbAtual[d].e2 = formatTimeVal(info.e2) || dbAtual[d].e2 || "";
                    dbAtual[d].s2 = formatTimeVal(info.s2) || dbAtual[d].s2 || "";
                    if (info.folga !== undefined) dbAtual[d].isFolga = info.folga;

                    let dReg = dbAtual[d];
                    let e1_m = timeToMinutes(dReg.e1), s1_m = timeToMinutes(dReg.s1);
                    let e2_m = timeToMinutes(dReg.e2), s2_m = timeToMinutes(dReg.s2);
                    let saldoD = 0;
                    if (!dReg.isFolga) {
                        if (e1_m > 0 && s1_m > 0) saldoD += (s1_m - e1_m);
                        if (e2_m > 0 && s2_m > 0) saldoD += (s2_m - e2_m);
                        saldoD -= 440;
                    }
                    if (Math.abs(saldoD) <= 10) saldoD = 0;

                    if (saldoD > 0) { dReg.extraMin = saldoD; dReg.atrasoMin = 0; }
                    else if (saldoD < 0) { dReg.atrasoMin = Math.abs(saldoD); dReg.extraMin = 0; }
                    else { dReg.atrasoMin = 0; dReg.extraMin = 0; }
                }
            }
        }

        let somatorioL = 0;
        for (let d = 1; d <= 31; d++) { if (dbAtual[d]) somatorioL += (dbAtual[d].extraMin || 0) - (dbAtual[d].atrasoMin || 0); }
        dbAtual.fechamentoSaldoLiquido = somatorioL;
        dbAtual.fechamentoAcumulado = (dbAtual.saldoAnteriorManual || 0) + somatorioL;

        await fetch(`${FIREBASE_URL}pontos/${targetFuncData.idFunc}_${mesAno}.json`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dbAtual)
        });

        // Resolve Array Temporário
        itemQueue.aiMismatchedObjs.splice(itemIdx, 1);
        if (itemQueue.aiMismatchedObjs.length === 0) {
            itemQueue.status = 'sucesso';
            itemQueue.msgRetorno = "(Vínculo Manual Aplicado)";
            fecharModalVincularOcr();
            showToast("Vinculação de Cartão finalizada!", "success");
        } else {
            // Faltam outros cartoes nessa msm foto pra vincular
            itemQueue.msgRetorno = "Faltam " + itemQueue.aiMismatchedObjs.length + " vínculo(s).";
            showToast(`Vínculo Atribuído. Restam ${itemQueue.aiMismatchedObjs.length}.`, "warning");

            // Re-renderizar o modal para o próximo Item Sem Fechar a Tela
            abrirModalVincularOcr(itemId);
        }

        renderFilaOcr();
        if (document.getElementById('ponto-lista-container').style.display !== 'none') {
            renderListaPonto();
        }

    } catch (err) {
        showToast("Erro ao gravar vínculo: " + err, "error");
    }
}


function formatTimeVal(val) {
    if (!val) return "";
    val = val.trim();
    // Validar se eh XX:XX senao retorna vazio (evita NaN lixo)
    if (/^\d{2}:\d{2}$/.test(val)) return val;
    return "";
}

function timeToMinutes(val) {
    if (!val || val.trim() === "") return 0;
    let parts = val.split(':');
    if (parts.length !== 2) return 0;
    let h = parseInt(parts[0], 10) || 0;
    let m = parseInt(parts[1], 10) || 0;
    return (h * 60) + m;
}

// ==== ESPELHO DE PONTO (CONFERÊNCIA RÁPIDA) ====
function abrirModalEspelhoPonto() {
    const idFunc = document.getElementById('ponto-select-func').value;
    const mesAno = document.getElementById('ponto-mes-ano').value;
    if (!idFunc || !mesAno) {
        showToast("Selecione um funcionário e uma competência primeiro.", "warning");
        return;
    }

    renderizarEspelhoPonto();
    document.getElementById('modal-espelho-ponto').classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Trava o scroll do fundo
}

function fecharModalEspelhoPonto() {
    document.getElementById('modal-espelho-ponto').classList.add('hidden');
    document.body.style.overflow = ''; // Destrava o fundo
}

function renderizarEspelhoPonto() {
    const tbodyQ1 = document.getElementById('espelho-q1-list');
    const tbodyQ2 = document.getElementById('espelho-q2-list');
    tbodyQ1.innerHTML = '';
    tbodyQ2.innerHTML = '';

    for (let d = 1; d <= 31; d++) {
        // Pega do DOM diretamente para refletir a edicao crua da tela
        const in_e1 = document.getElementById(`p_${d}_e1`);
        if (!in_e1) continue; // Mês com 30 ou 28 dias vaza aqui

        let e1 = in_e1.value.trim();
        let s1 = document.getElementById(`p_${d}_s1`).value.trim();
        let e2 = document.getElementById(`p_${d}_e2`).value.trim();
        let s2 = document.getElementById(`p_${d}_s2`).value.trim();
        let folga = document.getElementById(`p_${d}_folga`).checked;

        let dispE1 = e1 || '<span style="color:var(--border);">--</span>';
        let dispS1 = s1 || '<span style="color:var(--border);">--</span>';
        let dispE2 = e2 || '<span style="color:var(--border);">--</span>';
        let dispS2 = s2 || '<span style="color:var(--border);">--</span>';

        const tr = document.createElement('tr');

        if (folga) {
            tr.innerHTML = `
                <td style="font-weight:bold; color:var(--text-light); text-align:center;">${d.toString().padStart(2, '0')}</td>
                <td colspan="4"><span style="color:var(--success); font-weight:bold;">FOLGA / FERIADO</span></td>
            `;
        } else {
            tr.innerHTML = `
                <td style="font-weight:bold; color:var(--text-light); text-align:center;">${d.toString().padStart(2, '0')}</td>
                <td>${dispE1}</td>
                <td>${dispS1}</td>
                <td>${dispE2}</td>
                <td>${dispS2}</td>
            `;
        }

        if (d <= 15) {
            tbodyQ1.appendChild(tr);
        } else {
            tbodyQ2.appendChild(tr);
        }
    }
}

// ==== PERSISTÊNCIA OCR (LocalStorage) ====
function salvarFilaOcrStorage() {
    try {
        let saveState = {
            queue: ocrQueue,
            globais: ocrGlobaisMapeados
        };
        localStorage.setItem('rhfacil_ocr_queue_v2', JSON.stringify(saveState));
    } catch (e) {
        console.error("Falha ao salvar OCR", e);
    }
}

function recuperarFilaOcrStorage() {
    try {
        let loadState = localStorage.getItem('rhfacil_ocr_queue_v2');
        if (loadState) {
            let parsed = JSON.parse(loadState);
            ocrQueue = parsed.queue || [];
            ocrGlobaisMapeados = parsed.globais || ocrQueue.length;

            // Retoma rodando se tiver pausado f5
            ocrQueue.forEach(item => {
                if (item.status === 'rodando') item.status = 'pendente';
            });

            renderFilaOcr();

            // Auto resume apenas se houver pendentes
            let temPendente = ocrQueue.some(i => i.status === 'pendente');
            if (temPendente && !ocrIsProcessing && !ocrIsPaused) {
                processarFilaOcrWorker();
            }
        }
    } catch (e) {
        console.error("Falha ao recuperar Fila de OCR do cache local", e);
    }
}

// ==== GESTÃO DE GASTOS ADICIONAIS ====
function abrirModalGasto(id = null) {
    console.log("abrirModalGasto DISPARADO! id =", id);
    let f = document.getElementById('form-gasto');
    if (f) f.reset();
    document.getElementById('gasto-id').value = '';

    // Popula combo-box de unidades
    popularSelectUnidades('gasto-unidade', { incluiTotal: true });
    const optDisabled = document.createElement('option');
    optDisabled.value = ''; optDisabled.disabled = true; optDisabled.selected = true; optDisabled.textContent = 'Selecione a Unidade...';
    document.getElementById('gasto-unidade').prepend(optDisabled);

    if (id) {
        document.getElementById('modal-gasto-titulo').innerText = "Editar Despesa";
        const g = gastosList.find(x => x.id === id);
        if (g) {
            document.getElementById('gasto-id').value = g.id;
            document.getElementById('gasto-descricao').value = g.descricao;
            document.getElementById('gasto-tipo').value = g.tipo;
            document.getElementById('gasto-data').value = g.data;
            document.getElementById('gasto-valor').value = g.valor;
            document.getElementById('gasto-unidade').value = g.unidade;
        }
    } else {
        document.getElementById('modal-gasto-titulo').innerText = "Registrar Novo Gasto";
        document.getElementById('gasto-data').value = moment().format('YYYY-MM-DD');
    }

    document.getElementById('modal-gasto').classList.remove('hidden');
}

function fecharModalGasto() {
    document.getElementById('modal-gasto').classList.add('hidden');
}

function salvarGasto(e) {
    e.preventDefault();
    const id = document.getElementById('gasto-id').value;

    let obj = {
        descricao: document.getElementById('gasto-descricao').value,
        tipo: document.getElementById('gasto-tipo').value,
        data: document.getElementById('gasto-data').value,
        valor: parseFloat(document.getElementById('gasto-valor').value),
        unidade: document.getElementById('gasto-unidade').value
    };

    if (id) {
        let index = gastosList.findIndex(g => g.id === id);
        if (index > -1) {
            gastosList[index] = { ...gastosList[index], ...obj };
        }
    } else {
        obj.id = "GST_" + Date.now();
        gastosList.push(obj);
    }

    const acao = id ? 'editado' : 'adicionado';
    registrarHistorico('gasto',
        `Gasto ${acao}: ${obj.descricao}`,
        `R$ ${parseFloat(obj.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})} · ${obj.unidade} · ${obj.tipo}`
    );
    salvarDados();
    fecharModalGasto();
    renderGastos();
    showToast("Gasto salvo com sucesso.", "success");
}

function apagarGasto(id) {
    showConfirm("Tem certeza que deseja apagar permanentemente esta despesa?").then(confirmou => {
        if (confirmou) {
            const gastoRemov = gastosList.find(g => g.id === id);
            if (gastoRemov) registrarHistorico('gasto',
                `Gasto removido: ${gastoRemov.descricao}`,
                `R$ ${parseFloat(gastoRemov.valor).toLocaleString('pt-BR', {minimumFractionDigits:2})} · ${gastoRemov.unidade}`
            );
            gastosList = gastosList.filter(g => g.id !== id);
            salvarDados();
            renderGastos();
            showToast("Gasto removido da base.", "success");
        }
    });
}

async function efetivarFuncionario(idPrazo) {
    if (await showConfirm("Deseja EFETIVAR este funcionário agora? O contrato passará a ser por Prazo Indeterminado e o alerta de experiência será removido.")) {
        // 1. Acha o funcionário vinculado
        const func = funcionariosList.find(f => f.idPrazoVinculado === idPrazo);

        // 2. Remove o prazo da lista global
        prazosList = prazosList.filter(p => p.id !== idPrazo);

        // 3. Limpa o vínculo no funcionário (torna-o indeterminado)
        if (func) {
            func.idPrazoVinculado = null;
        }

        // 4. Salva e Renderiza
        salvarDados();
        renderDeadlines();
        renderFuncionarios();
        showToast('Funcionário efetivado com sucesso!', 'success');
    }
}

function sortGastos(field) {
    if (currentSortGastos.field === field) {
        currentSortGastos.asc = !currentSortGastos.asc;
    } else {
        currentSortGastos.field = field;
        currentSortGastos.asc = !!(field === 'data' || field === 'valor');
    }

    ['data', 'descricao', 'tipo', 'unidade', 'valor'].forEach(f => {
        let el = document.getElementById(`sort-gastos-icon-${f}`);
        if (el) {
            el.className = 'fa-solid fa-sort';
            el.parentElement.classList.remove('active');
        }
    });

    let activeIcon = document.getElementById(`sort-gastos-icon-${field}`);
    if (activeIcon) {
        activeIcon.parentElement.classList.add('active');
        activeIcon.className = currentSortGastos.asc ? 'fa-solid fa-sort-up' : 'fa-solid fa-sort-down';
    }

    renderGastos();
}

function limparFiltroGastos() {
    document.getElementById('filtro-gasto-unidade').value = 'todas';
    document.getElementById('filtro-gasto-tipo').value = 'todos';
    if (!gastosList || gastosList.length === 0) {
        document.getElementById('filtro-gasto-inicio').value = '';
        document.getElementById('filtro-gasto-fim').value = '';
    } else {
        // Encontra a data mais antiga e a mais recente
        let datas = gastosList.map(g => moment(g.data));
        let dataMin = moment.min(datas);
        let dataMax = moment.max(datas);

        document.getElementById('filtro-gasto-inicio').value = dataMin.format('YYYY-MM-DD');
        document.getElementById('filtro-gasto-fim').value = dataMax.format('YYYY-MM-DD');
    }
    renderGastos();
}

function renderGastos() {
    if (!gastosList) gastosList = [];

    let unidFiltro = document.getElementById('filtro-gasto-unidade').value;
    let tipoFiltro = document.getElementById('filtro-gasto-tipo').value;
    let inputInicio = document.getElementById('filtro-gasto-inicio').value;
    let inputFim = document.getElementById('filtro-gasto-fim').value;

    let momInicio = inputInicio ? moment(inputInicio).startOf('day') : null;
    let momFim = inputFim ? moment(inputFim).endOf('day') : null;

    // Se nenhum filtro setado, mostrar mês atual como default para não ficar muito pesado
    if (!momInicio && !momFim) {
        momInicio = moment().startOf('month');
        momFim = moment().endOf('month');
        // Para visual feedback do usuario mostrar o placeholder
        document.getElementById('filtro-gasto-inicio').value = momInicio.format('YYYY-MM-DD');
        document.getElementById('filtro-gasto-fim').value = momFim.format('YYYY-MM-DD');
    }

    // Filtra Lista pelo Periodo e Unidade
    let filtrados = gastosList.filter(g => {
        // Filtro de Unidade
        if (unidFiltro !== 'todas' && g.unidade !== unidFiltro) return false;

        // Filtro de Tipo
        if (tipoFiltro !== 'todos' && g.tipo !== tipoFiltro) return false;

        // Filtro de Data
        if (!g.data) return false;
        let gDate = moment(g.data);
        if (momInicio && gDate.isBefore(momInicio)) return false;
        if (momFim && gDate.isAfter(momFim)) return false;
        return true;
    });

    if (currentSortGastos.field) {
        filtrados.sort((a, b) => {
            let valA = a[currentSortGastos.field];
            let valB = b[currentSortGastos.field];

            if (currentSortGastos.field === 'data') {
                valA = moment(a.data).valueOf();
                valB = moment(b.data).valueOf();
            } else if (currentSortGastos.field === 'valor') {
                valA = parseFloat(valA || 0);
                valB = parseFloat(valB || 0);
            } else {
                valA = (valA || '').toLowerCase();
                valB = (valB || '').toLowerCase();
            }

            if (valA < valB) return currentSortGastos.asc ? -1 : 1;
            if (valA > valB) return currentSortGastos.asc ? 1 : -1;
            return 0;
        });
    }

    // 3) Construção da Tabela e Soma
    const tbody = document.getElementById('gastos-list');
    let preservedScroll = window.scrollY;
    tbody.innerHTML = '';
    let totalMensal = 0;

    if (filtrados.length === 0) {
        document.getElementById('empty-state-gastos').classList.remove('hidden');
        document.querySelector('#view-gastos .deadlines-table').style.display = 'none';
        document.getElementById('card-gastos-total').textContent = "R$ 0,00";
        if (document.getElementById('card-gastos-count')) document.getElementById('card-gastos-count').textContent = '0 lancamentos';
        if (document.getElementById('cards-por-categoria')) document.getElementById('cards-por-categoria').innerHTML = '';
        window.scrollTo(0, preservedScroll);
        return;
    }

    document.getElementById('empty-state-gastos').classList.add('hidden');
    document.querySelector('#view-gastos .deadlines-table').style.display = 'table';

    filtrados.forEach(g => {
        totalMensal += parseFloat(g.valor || 0);
        let tr = document.createElement('tr');

        let iconType = 'fa-file-invoice';
        let colorClass = 'var(--text-main)';
        if (g.tipo === 'Freelancer/Extra') { iconType = 'fa-user-clock'; colorClass = 'var(--success)'; }
        if (g.tipo === 'Manutenção/Conserto') { iconType = 'fa-screwdriver-wrench'; colorClass = 'var(--warning)'; }
        if (g.tipo === 'Frete/Logística') { iconType = 'fa-truck-fast'; colorClass = '#8b5cf6'; } // Roxo
        if (g.tipo === 'Sem NF/Avulso') { iconType = 'fa-wallet'; colorClass = 'var(--danger)'; }

        tr.innerHTML = `
            <td style="color:var(--text-light); white-space: nowrap;"><i class="fa-regular fa-calendar" style="margin-right:5px;"></i> ${moment(g.data).format('DD/MM/YY')}</td>
            <td>
                <div class="custom-tooltip-container" style="display: block; width: 100%;">
                    <div class="text-truncate" style="font-weight: 500; width: 100%;">${g.descricao || '<em style="opacity: 0.5;">Sem descrição</em>'}</div>
                    <span class="custom-tooltip-text">${g.descricao || ''}</span>
                </div>
            </td>
            <td style="white-space: nowrap;"><span class="status-badge" style="background:transparent; border: 1px solid ${colorClass}; color: ${colorClass};"><i class="fa-solid ${iconType}"></i> ${g.tipo}</span></td>
            <td style="white-space: nowrap;"><span class="status-badge" style="background: rgba(148, 163, 184, 0.1); color: var(--text-main); font-weight: normal;">${g.unidade}</span></td>
            <td style="text-align: right; font-weight:700; color:var(--text-main); white-space: nowrap;">R$ ${parseFloat(g.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
            <td class="action-buttons" style="justify-content: flex-end;">
                <button class="btn-icon btn-edit" onclick="abrirModalGasto('${g.id}')" title="Editar">
                    <i class="fa-solid fa-pen"></i>
                </button>
                <button class="btn-icon btn-delete" onclick="apagarGasto('${g.id}')" title="Excluir">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);

        // Verifica se houve truncamento para decidir se mantém o tooltip
        const descDiv = tr.querySelector('.text-truncate');
        const tooltipSpan = tr.querySelector('.custom-tooltip-text');
        if (descDiv && tooltipSpan) {
            // Se o conteúdo couber sem scroll, removemos o tooltip
            if (descDiv.scrollWidth <= descDiv.clientWidth) {
                tooltipSpan.remove();
            } else {
                descDiv.style.cursor = 'help';
            }
        }
    });

    document.getElementById('card-gastos-total').textContent = `R$ ${totalMensal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('card-gastos-count')) {
        const qtd = filtrados.length;
        document.getElementById('card-gastos-count').textContent = `${qtd} lancamento${qtd !== 1 ? 's' : ''}`;
    }

    // Cards por categoria
    const catContainer = document.getElementById('cards-por-categoria');
    if (catContainer) {
        const porCategoria = {};
        const catConfig = {
            'Freelancer/Extra': { icon: 'fa-user-clock', cor: 'var(--success)' },
            'Rescisao': { icon: 'fa-user-minus', cor: '#f43f5e' }, // Vermelho rosado
            'Manutencao/Conserto': { icon: 'fa-screwdriver-wrench', cor: 'var(--warning)' },
            'Frete/Logística': { icon: 'fa-truck-fast', cor: '#8b5cf6' },
            'Sem NF/Avulso': { icon: 'fa-wallet', cor: 'var(--danger)' },
            'Outros': { icon: 'fa-file-invoice', cor: 'var(--text-light)' }
        };
        filtrados.forEach(g => {
            const cat = g.tipo || 'Outros';
            if (!porCategoria[cat]) porCategoria[cat] = { total: 0, qtd: 0 };
            porCategoria[cat].total += parseFloat(g.valor || 0);
            porCategoria[cat].qtd++;
        });
        catContainer.innerHTML = '';
        Object.entries(porCategoria)
            .sort((a, b) => b[1].total - a[1].total)
            .forEach(([cat, dados]) => {
                // Normalizar chave para lookup (sem acento)
                const keyNorm = cat.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const cfg = catConfig[keyNorm] || catConfig[cat] || catConfig['Outros'];
                const cor = cfg ? cfg.cor : 'var(--primary)';
                const icon = cfg ? cfg.icon : 'fa-tag';
                const card = document.createElement('div');
                card.style.cssText = `background: var(--bg-card); border: 1px solid var(--border); border-left: 3px solid ${cor}; border-radius: 10px; padding: 12px 16px; min-width: 155px; flex: 1; display: flex; flex-direction: column; gap: 3px; transition: box-shadow 0.2s;`;
                const nomeLabel = cat.length > 22 ? cat.substring(0, 20) + '...' : cat;
                card.innerHTML = `
                    <span style="font-size:0.72rem; color: ${cor}; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;"><i class="fa-solid ${icon}" style="margin-right:4px;"></i>${nomeLabel}</span>
                    <strong style="font-size:1.1rem; color:var(--text-main); font-weight:700;">R$ ${dados.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                    <span style="font-size:0.75rem; color:var(--text-light);">${dados.qtd} lancamento${dados.qtd !== 1 ? 's' : ''}</span>
                `;
                catContainer.appendChild(card);
            });
    }

    window.scrollTo(0, preservedScroll);
}

function exportarCSVGastos() {
    if (!gastosList || gastosList.length === 0) {
        showToast("Não há gastos para exportar.", "warning");
        return;
    }

    let dadosExportacao = gastosList.map(g => {
        return {
            "DATA": moment(g.data).format('DD/MM/YYYY'),
            "CATEGORIA": g.tipo || "",
            "VALOR": parseFloat(g.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
            "UNIDADE": g.unidade || "",
            "DESCRICAO": g.descricao || ""
        };
    });

    let csvContent = Papa.unparse(dadosExportacao, {
        quotes: true,
        delimiter: ";",
        header: true
    });

    const blob = new Blob(["\uFEFF", csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `gastos_export_${moment().format('DD_MM_YYYY')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function importarCSVGastos(event) {
    const file = event.target.files[0];
    if (!file) return;

    const categoriasValidas = ['Freelancer/Extra', 'Manutenção/Conserto', 'Frete/Logística', 'Sem NF/Avulso', 'Outros'];

    Papa.parse(file, {
        header: true,
        delimiter: ";",
        skipEmptyLines: true,
        encoding: "ISO-8859-1",
        complete: function (results) {
            let importados = 0;
            let falhas = 0;

            const normalizeKey = (key) => key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

            results.data.forEach((row, indexRow) => {
                let rowSeguro = {};
                for (let k in row) {
                    if (row.hasOwnProperty(k)) {
                        rowSeguro[normalizeKey(k)] = row[k];
                    }
                }

                let dataRaw = rowSeguro["DATA"];
                let categoriaOrig = (rowSeguro["CATEGORIA"] || rowSeguro["TIPO"] || "Outros").trim();
                let valorRaw = rowSeguro["VALOR"];
                let unidade = rowSeguro["UNIDADE"] || "Geral";
                let descricao = rowSeguro["DESCRICAO"] || "";

                if (!valorRaw || !dataRaw) { falhas++; return; }

                let dataTratada = excelDateToJSDate(dataRaw);
                if (!dataTratada) { falhas++; return; }

                // Tratamento de valor (R$ 1.234,56 -> 1234.56)
                let valorLimpo = valorRaw.toString().replace("R$", "").replace(/\./g, "").replace(",", ".").trim();
                let valorFinal = parseFloat(valorLimpo);

                if (isNaN(valorFinal)) { falhas++; return; }

                // Validação de Categoria (Case-Insensitive e Normalizada)
                const normalizarParaComparar = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

                let categoriaFinal = "Outros"; // Default fallback
                let categoriaEncontrada = categoriasValidas.find(valid => normalizarParaComparar(valid) === normalizarParaComparar(categoriaOrig));

                if (categoriaEncontrada) {
                    categoriaFinal = categoriaEncontrada; // Usa a grafia oficial do sistema
                } else {
                    categoriaFinal = "Outros";
                    descricao = `[${categoriaOrig}] ${descricao}`.trim();
                }

                const idUnico = "GST_" + Date.now().toString() + indexRow.toString() + Math.round(Math.random() * 1000);

                gastosList.push({
                    id: idUnico,
                    data: dataTratada,
                    tipo: categoriaFinal,
                    valor: valorFinal,
                    unidade: unidade,
                    descricao: descricao
                });
                importados++;
            });

            if (importados > 0) {
                salvarDados(); // Persiste no Firebase
                renderGastos();
                showToast(`${importados} gastos importados com sucesso!`, "success");
            }

            if (falhas > 0) {
                showToast(`${falhas} linhas falharam na importação. Verifique os dados.`, "warning");
            }

            event.target.value = ''; // Reseta input
        }
    });
}

// ==== MÓDULO DE INTEGRAÇÃO DE E-MAIL ====
console.log("Módulo de E-mail carregado!");

// ---- Autocomplete de Tags ----
const TAGS_POR_TIPO = {
    admissao: ['{CARGO}', '{DATA}', '{NOME}', '{SAUDACAO}', '{UNIDADE}'],
    experiencia: ['{CARGO}', '{DATA}', '{NOME}', '{SAUDACAO}', '{UNIDADE}'],
    desligamento: ['{DATA}', '{MOTIVO}', '{NOME}', '{SAUDACAO}', '{UNIDADE}'],
    ferias: ['{DATA_FIM}', '{DATA_INICIO}', '{NOME}', '{SAUDACAO}', '{UNIDADE}'],
    geral: ['{CARGO}', '{DATA}', '{DATA_FIM}', '{DATA_INICIO}', '{MOTIVO}', '{NOME}', '{SAUDACAO}', '{UNIDADE}']
};

function _getDropdown() {
    let d = document.getElementById('_tag-dropdown');
    if (!d) {
        d = document.createElement('div');
        d.id = '_tag-dropdown';
        d.style.cssText = [
            'position:fixed', 'z-index:999999', 'display:none',
            'flex-direction:column', 'min-width:190px', 'max-height:220px',
            'overflow-y:auto', 'border-radius:8px',
            'background:var(--bg-card)', 'border:1px solid var(--border)',
            'box-shadow:0 8px 28px rgba(0,0,0,0.25)',
            'font-family:Inter,sans-serif', 'font-size:0.85rem'
        ].join(';');
        document.body.appendChild(d);
    }
    return d;
}

function _fecharTagDropdown() {
    const d = document.getElementById('_tag-dropdown');
    if (d) d.style.display = 'none';
}

function _moverSelecao(d, dir) {
    const items = [...d.querySelectorAll('[data-tag]')];
    let idx = items.findIndex(i => i.dataset.ativo === '1');
    items.forEach(i => { i.dataset.ativo = '0'; i.style.cssText = 'padding:8px 14px;cursor:pointer;color:var(--text-main);'; });
    idx = Math.max(0, Math.min(items.length - 1, idx + dir));
    if (items[idx]) {
        items[idx].dataset.ativo = '1';
        items[idx].style.cssText = 'padding:8px 14px;cursor:pointer;background:var(--primary);color:#fff;font-weight:600;';
        items[idx].scrollIntoView({ block: 'nearest' });
    }
}

function _inserirTag(el, tag, braceIdx, cursor) {
    const v = el.value;
    el.value = v.substring(0, braceIdx) + tag + v.substring(cursor);
    const p = braceIdx + tag.length;
    el.setSelectionRange(p, p);
    el.focus();
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Calcula posição (x,y) do cursor em pixels dentro do textarea/input
function _getCaretXY(el, pos) {
    const style = window.getComputedStyle(el);
    const mirror = document.createElement('div');
    mirror.style.cssText = [
        'position:absolute', 'top:-9999px', 'left:-9999px', 'visibility:hidden',
        'white-space:pre-wrap', 'word-wrap:break-word', 'overflow-y:auto',
        `width:${el.clientWidth}px`,
        `font:${style.font}`,
        `font-size:${style.fontSize}`,
        `font-family:${style.fontFamily}`,
        `font-weight:${style.fontWeight}`,
        `line-height:${style.lineHeight}`,
        `padding:${style.padding}`,
        `border:${style.border}`,
        `box-sizing:${style.boxSizing}`,
        `letter-spacing:${style.letterSpacing}`
    ].join(';');

    const before = document.createTextNode(el.value.substring(0, pos));
    const span = document.createElement('span');
    span.textContent = '|';
    const after = document.createTextNode(el.value.substring(pos));
    mirror.appendChild(before);
    mirror.appendChild(span);
    mirror.appendChild(after);
    document.body.appendChild(mirror);

    const spanRect = span.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const x = spanRect.left - mirrorRect.left;
    const y = spanRect.top - mirrorRect.top;

    document.body.removeChild(mirror);

    // Ajustar pelo scroll interno do textarea
    return { left: x - el.scrollLeft, top: y - el.scrollTop };
}

function initTagAutocomplete(el, tagsKey) {
    if (el._tagAcInit) return;
    el._tagAcInit = true;

    el.addEventListener('input', () => {
        const pos = el.selectionStart;
        const before = el.value.substring(0, pos);
        const braceIdx = before.lastIndexOf('{');
        if (braceIdx === -1 || before.substring(braceIdx).includes('}')) {
            _fecharTagDropdown(); return;
        }
        const search = before.substring(braceIdx + 1).toLowerCase();
        const tags = (TAGS_POR_TIPO[tagsKey] || TAGS_POR_TIPO.geral);
        const matches = tags.filter(t => t.substring(1).toLowerCase().startsWith(search));
        if (!matches.length) { _fecharTagDropdown(); return; }

        const d = _getDropdown();
        d.innerHTML = '';
        matches.forEach((tag, i) => {
            const item = document.createElement('div');
            item.dataset.tag = tag;
            item.dataset.ativo = i === 0 ? '1' : '0';
            item.textContent = tag;
            item.style.cssText = i === 0
                ? 'padding:8px 14px;cursor:pointer;background:var(--primary);color:#fff;font-weight:600;'
                : 'padding:8px 14px;cursor:pointer;color:var(--text-main);';
            item.addEventListener('mouseenter', () => {
                d.querySelectorAll('[data-tag]').forEach(x => { x.dataset.ativo = '0'; x.style.cssText = 'padding:8px 14px;cursor:pointer;color:var(--text-main);'; });
                item.dataset.ativo = '1';
                item.style.cssText = 'padding:8px 14px;cursor:pointer;background:var(--primary);color:#fff;font-weight:600;';
            });
            item.addEventListener('mousedown', ev => {
                ev.preventDefault();
                _inserirTag(el, tag, braceIdx, el.selectionStart);
                _fecharTagDropdown();
            });
            d.appendChild(item);
        });

        // Calcular posição real do cursor dentro do textarea/input
        const rect = el.getBoundingClientRect();
        const caretPos = _getCaretXY(el, braceIdx);
        const dropH = Math.min(220, matches.length * 37);

        // Posicionar acima do cursor
        let top = rect.top + caretPos.top - dropH - 6;
        let left = rect.left + caretPos.left;

        // Garantir que não saia da tela
        if (top < 4) top = rect.top + caretPos.top + 20; // cai abaixo se não couber acima
        if (left + 200 > window.innerWidth) left = window.innerWidth - 205;

        d.style.top = top + 'px';
        d.style.left = left + 'px';
        d.style.display = 'flex';

        el._tagCtx = { braceIdx, cursor: pos };
    });

    el.addEventListener('keydown', e => {
        const d = document.getElementById('_tag-dropdown');
        if (!d || d.style.display === 'none') return;
        if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            const active = d.querySelector('[data-ativo="1"]');
            if (active && el._tagCtx) _inserirTag(el, active.dataset.tag, el._tagCtx.braceIdx, el.selectionStart);
            _fecharTagDropdown();
        } else if (e.key === 'Escape') {
            _fecharTagDropdown();
        } else if (e.key === 'ArrowDown') { e.preventDefault(); _moverSelecao(d, 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); _moverSelecao(d, -1); }
    });

    el.addEventListener('blur', () => setTimeout(_fecharTagDropdown, 160));
}

// Inicializa autocomplete nos campos do modal de e-mail (sempre presentes no DOM)
window.addEventListener('DOMContentLoaded', () => {
    const corpModal = document.getElementById('email-corpo');
    const assModal = document.getElementById('email-assunto');
    if (corpModal) initTagAutocomplete(corpModal, 'geral');
    if (assModal) initTagAutocomplete(assModal, 'geral');
});

function abrirModalEmail(tipoCod, dados) {
    console.log(">>> [abrirModalEmail] Início", tipoCod, dados);
    const modal = document.getElementById('modal-email');
    if (!modal) {
        console.error(">>> [abrirModalEmail] ERRO: Elemento #modal-email não encontrado no DOM!");
        return;
    }
    console.log(">>> [abrirModalEmail] Modal encontrado");

    const inputPara = document.getElementById('email-destinatario');
    const inputAssunto = document.getElementById('email-assunto');
    const areaCorpo = document.getElementById('email-corpo');

    if (!inputPara || !inputAssunto || !areaCorpo) {
        console.error(">>> [abrirModalEmail] ERRO: Campos internos do modal não encontrados!", { inputPara, inputAssunto, areaCorpo });
        return;
    }

    // Destinatário padrão
    inputPara.value = configGerais.emailContabilidade || '';
    console.log(">>> [abrirModalEmail] Destinatário definido:", inputPara.value);

    // Controle de exibição dos campos da Ficha Admissional
    const camposAdmissao = document.getElementById('campos-admissao');
    if (camposAdmissao) {
        camposAdmissao.style.display = (tipoCod === 'admissao') ? 'block' : 'none';

        // Limpar os campos caso seja uma nova abertura
        if (tipoCod === 'admissao') {
            document.getElementById('adm-pis').value = '';
            document.getElementById('adm-telefone').value = '';
            document.getElementById('adm-escolaridade').value = '';
            document.getElementById('adm-salario').value = '';
            document.getElementById('adm-experiencia').value = '';
            document.getElementById('adm-vt').value = '';
        }
    }

    // Armazenando temporariamente os dados para a rotina de envio (geração do word)
    window.__emailDadosTemporarios = { tipoCod, dados };

    // Selecionar Template
    const FALLBACKS = {
        admissao: 'Olá, seguem os dados para registro de admissão do colaborador {NOME}, unidade {UNIDADE}, cargo {CARGO}. Admissão em {DATA}.',
        desligamento: 'Prezados, favor processar o desligamento do colaborador {NOME}, unidade {UNIDADE}. Motivo: {MOTIVO}. Último dia trabalhado: {DATA}.',
        ferias: 'Olá, solicitamos o agendamento de férias para o colaborador {NOME}, unidade {UNIDADE}. Período: {DATA_INICIO} a {DATA_FIM}.'
    };

    const templates = configGerais.templatesEmail || {};
    let template = '';
    let assunto = '';

    function getTemplate(key) {
        const t = templates[key];
        return (t && t.trim()) ? t : FALLBACKS[key];
    }

    const FALLBACKS_ASSUNTO = {
        admissao: '[RH] Solicitação de Admissão',
        desligamento: '[RH] Solicitação de Desligamento',
        ferias: '[RH] Solicitação de Férias'
    };
    const assuntos = configGerais.assuntosEmail || {};
    function getAssunto(key) {
        const a = assuntos[key];
        return (a && a.trim()) ? a : FALLBACKS_ASSUNTO[key];
    }

    if (tipoCod === 'experiencia' || tipoCod === 'admissao') {
        template = getTemplate('admissao');
        assunto = getAssunto('admissao');
    } else if (tipoCod === 'desligamento') {
        template = getTemplate('desligamento');
        assunto = getAssunto('desligamento');
    } else if (tipoCod === 'ferias') {
        template = getTemplate('ferias');
        assunto = getAssunto('ferias');
    } else {
        template = 'Prezados, solicito suporte para o colaborador {NOME}, unidade {UNIDADE}. Assunto: {TIPO}. Data: {DATA}.';
        assunto = '[RH] Solicitação Geral';
    }
    console.log('>>> [abrirModalEmail] Template selecionado:', assunto, '| Conteúdo:', template.substring(0, 50));

    // Processar Variáveis (corpo e assunto)
    const hora = new Date().getHours();
    const saudacao = hora >= 5 && hora < 12 ? 'Bom dia!'
        : hora >= 12 && hora < 19 ? 'Boa tarde!'
            : 'Boa noite!';

    function processarTags(texto) {
        return (texto || '')
            .replace(/{SAUDACAO}/g, saudacao)
            .replace(/{NOME}/g, dados.nome || '')
            .replace(/{UNIDADE}/g, dados.unidade || '')
            .replace(/{DATA}/g, dados.data || '')
            .replace(/{TIPO}/g, dados.tipo || '')
            .replace(/{CARGO}/g, dados.cargo || 'Não informado')
            .replace(/{MOTIVO}/g, dados.motivo || 'A informar')
            .replace(/{DATA_INICIO}/g, dados.dataInicio || dados.data || '')
            .replace(/{DATA_FIM}/g, dados.dataFim || '');
    }

    inputAssunto.value = processarTags(assunto);
    areaCorpo.value = processarTags(template);
    console.log(">>> [abrirModalEmail] Dados preenchidos no modal");

    modal.classList.remove('hidden');
    modal.style.zIndex = '100000';
    console.log(">>> [abrirModalEmail] Estilos de visibilidade aplicados. Fim da função.");
}

function fecharModalEmail() {
    const modal = document.getElementById('modal-email');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = '';
    }
}

function dispararEmail() {
    const para = document.getElementById('email-destinatario').value;
    const assunto = encodeURIComponent(document.getElementById('email-assunto').value);
    const corpo = encodeURIComponent(document.getElementById('email-corpo').value);

    if (!para) {
        showToast("Por favor, informe o e-mail do destinatário.", "warning");
        return;
    }

    // Processamento da Ficha Admissional
    const tempContext = window.__emailDadosTemporarios;
    if (tempContext && tempContext.tipoCod === 'admissao') {
        try {
            console.log(">>> [dispararEmail] Iniciando geração da Ficha Admissional...");
            const data = tempContext.dados;

            // Variáveis do Template
            const pis = document.getElementById('adm-pis').value || '_________________________';

            let inputTelefone = document.getElementById('adm-telefone').value;
            let telefone = '(DD) 9XXXX-XXXX';
            if (inputTelefone) {
                let nums = inputTelefone.replace(/\D/g, '');
                if (nums.length >= 10 && nums.length <= 11) {
                    telefone = `(${nums.substring(0, 2)}) ${nums.substring(2)}`;
                } else {
                    telefone = inputTelefone;
                }
            }

            const escolaridade = document.getElementById('adm-escolaridade').value || '_________________________';

            let salario = document.getElementById('adm-salario').value;
            if (salario) {
                if (!salario.includes(',')) {
                    salario = salario + ',00';
                }
            } else {
                salario = '_________________________';
            }

            const exp = document.getElementById('adm-experiencia').value;
            const vt = document.getElementById('adm-vt').value;

            console.log(">>> [dispararEmail] Extraindo base64 do template...");
            // Converter base64 do docx para string binária
            const binaryString = window.atob(TEMPLATE_ADMISSAO_B64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            console.log(">>> [dispararEmail] Carregando PizZip...");
            const PizZip = window.PizZip;
            const zip = new PizZip(bytes);

            console.log(">>> [dispararEmail] Carregando docxtemplater...");
            // As vezes o docxtemplater no CDN exporta como window.docxtemplater
            const Docxtemplater = window.docxtemplater;
            const doc = new Docxtemplater(zip, {
                paragraphLoop: true,
                linebreaks: true,
            });

            console.log(">>> [dispararEmail] Renderizando texto no documento...");
            // Dados substituídos no word
            doc.render({
                unidade: data.unidade || 'N/A',
                nome: data.nome || 'N/A',
                pis: pis,
                telefone: telefone,
                escolaridade: escolaridade,
                data: data.data || 'N/A',
                salario: salario,
                exp30: exp === '30' ? ' X ' : '   ',
                exp45: exp === '45' ? ' X ' : '   ',
                exp60: exp === '60' ? ' X ' : '   ',
                exp90: exp === '90' ? ' X ' : '   ',
                vtsim: vt === 'sim' ? ' X ' : '   ',
                vtnao: vt === 'nao' ? ' X ' : '   '
            });

            console.log(">>> [dispararEmail] Gerando blob...");
            const out = doc.getZip().generate({
                type: "blob",
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            });

            console.log(">>> [dispararEmail] Disparando download automático...");
            // Download automático
            saveAs(out, `FICHA ADMISSIONAL - ${data.nome || 'NOVO'}.docx`);
            showToast("Ficha Admissional gerada e baixada.", "success");

        } catch (error) {
            console.error("Erro Crítico ao gerar DOCX:", error);
            if (error.properties && error.properties.errors instanceof Array) {
                const errorMessages = error.properties.errors.map(function (error) {
                    return error.properties.explanation;
                }).join("\n");
                console.log("Múltiplos erros do Docxtemplater:", errorMessages);
            }
            showToast("Erro ao processar Ficha. O e-mail abrirá normalmente.", "error");
        }
    }

    const mailtoLink = `mailto:${para}?subject=${assunto}&body=${corpo}`;

    // Abre a janela de e-mail numa nova guia (para não descarregar o site)
    window.open(mailtoLink, '_blank');

    fecharModalEmail();
    showToast("Abrindo seu cliente de e-mail...", "success");
}

// ============================================================
// MÓDULO DE RELATÓRIOS EM PDF
// ============================================================

let tipoRelatorioAtual = null;

function abrirRelatorio(tipo) {
    tipoRelatorioAtual = tipo;
    const titulos = { rh: 'Relatório de RH', gastos: 'Relatório de Gastos' };
    document.getElementById('rel-titulo').textContent = titulos[tipo];
    document.getElementById('rel-preview-area').innerHTML =
        '<p style="color:var(--text-light);text-align:center;margin:2rem 0;">Selecione o período e clique em <strong>Gerar Prévia</strong>.</p>';
    document.getElementById('btn-baixar-pdf').disabled = true;
    // Mostrar checkboxes corretos para o tipo
    document.getElementById('rel-checks-rh').classList.toggle('hidden', tipo !== 'rh');
    document.getElementById('rel-checks-gastos').classList.toggle('hidden', tipo !== 'gastos');
    if (tipo === 'gastos') relPopularCategorias();
    // Fechar painel ao abrir novo relatório
    document.getElementById('painel-personalizar-rel').classList.add('hidden');
    document.getElementById('modal-relatorio').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function fecharRelatorio() {
    document.getElementById('modal-relatorio').classList.add('hidden');
    document.body.style.overflow = '';
}

function toggleRelPersonalizar() {
    const painel = document.getElementById('painel-personalizar-rel');
    painel.classList.toggle('hidden');
}

function relSelecionarTodos(marcar) {
    const container = tipoRelatorioAtual === 'rh'
        ? document.getElementById('rel-checks-rh')
        : document.getElementById('rel-checks-gastos');
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = marcar);
}

function relCheck(id) {
    const el = document.getElementById(id);
    return el ? el.checked : true;
}

function relGetPeriodo() {
    const sel = document.getElementById('rel-periodo').value;
    const m = sel === 'anterior' ? moment().subtract(1, 'months') : moment();
    const inicio = m.clone().startOf('month');
    const fim = m.clone().endOf('month');
    return {
        mesAno:     m.format('YYYY-MM'),
        nomeMes:    m.format('MMMM/YYYY').replace(/^./, ch => ch.toUpperCase()),
        inicio:     inicio.format('YYYY-MM-DD'),
        fim:        fim.format('YYYY-MM-DD'),
    };
}

function gerarPrevia() {
    const periodo = relGetPeriodo();
    const area = document.getElementById('rel-preview-area');
    area.innerHTML = tipoRelatorioAtual === 'rh'
        ? buildRelatorioRH(periodo)
        : buildRelatorioGastos(periodo);
    document.getElementById('btn-baixar-pdf').disabled = false;
}

function baixarPDF() {
    const periodo = relGetPeriodo();
    const area = document.getElementById('rel-preview-area');
    const titulos = { rh: 'Relatorio_RH', gastos: 'Relatorio_Gastos' };
    const nomeArq = `${titulos[tipoRelatorioAtual]}_${periodo.mesAno}.pdf`;
    const opt = {
        margin:      [8, 8, 8, 8],
        filename:    nomeArq,
        image:       { type: 'jpeg', quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    // Clonar área para não capturar o scroll
    const clone = area.cloneNode(true);
    clone.style.maxHeight = 'none';
    clone.style.overflow = 'visible';
    document.body.appendChild(clone);
    html2pdf().set(opt).from(clone).save().then(() => {
        document.body.removeChild(clone);
    });
}

// ─── Estilos inline compartilhados ───────────────────────────
function relCSS() {
    return {
        page:       'font-family:Arial,sans-serif;font-size:12px;color:#111827;',
        header:     'background:#4361ee;color:#fff;padding:18px 20px;border-radius:8px 8px 0 0;margin-bottom:0;',
        headerTit:  'font-size:20px;font-weight:bold;margin:0;',
        headerSub:  'font-size:12px;opacity:0.85;margin-top:3px;',
        cardsRow:   'display:flex;gap:8px;margin:14px 0 18px;flex-wrap:wrap;',
        card:       'background:#f0f2f5;border-radius:8px;padding:12px 10px;flex:1;text-align:center;min-width:90px;',
        cardNum:    'font-size:22px;font-weight:bold;color:#4361ee;margin:0;',
        cardLbl:    'font-size:10px;color:#6b7280;margin-top:3px;',
        secTit:     'font-size:13px;font-weight:bold;color:#1e3a8a;border-bottom:2px solid #4361ee;padding-bottom:3px;margin:18px 0 8px;',
        table:      'width:100%;border-collapse:collapse;font-size:11px;',
        th:         'background:#eef1fd;color:#1e3a8a;padding:6px 8px;text-align:left;border:1px solid #e5e7eb;',
        td:         'padding:5px 8px;border:1px solid #e5e7eb;vertical-align:top;',
        tdAlt:      'padding:5px 8px;border:1px solid #e5e7eb;background:#f9fafb;vertical-align:top;',
        empty:      'color:#6b7280;font-style:italic;font-size:11px;padding:6px 0;',
        footer:     'margin-top:20px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:10px;color:#9ca3af;text-align:right;',
    };
}

function relTabela(colunas, linhas, s) {
    if (!linhas.length) return `<p style="${s.empty}">Nenhum registro no período.</p>`;
    const ths = colunas.map(c => `<th style="${s.th}">${c}</th>`).join('');
    const trs = linhas.map((l, i) => {
        const tds = l.map(v => `<td style="${i % 2 === 0 ? s.td : s.tdAlt}">${v ?? '—'}</td>`).join('');
        return `<tr>${tds}</tr>`;
    }).join('');
    return `<table style="${s.table}"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
}

function relCard(num, label, s, cor) {
    return `<div style="${s.card}">
        <div style="${s.cardNum}${cor ? 'color:' + cor + ';' : ''}">${num}</div>
        <div style="${s.cardLbl}">${label}</div>
    </div>`;
}

// ─── RELATÓRIO DE RH ─────────────────────────────────────────
function buildRelatorioRH(periodo) {
    const s = relCSS();
    const fmt = d => d ? moment(d).format('DD/MM/YYYY') : '—';

    // Filtros
    const ativos = funcionariosList.filter(f => !f.desligado && !f.emAvisoPrevio);
    const admissoes = funcionariosList.filter(f => (f.admissao || '').startsWith(periodo.mesAno)).sort((a,b) => (b.admissao||'').localeCompare(a.admissao||''));
    const desligados = funcionariosList.filter(f => f.desligado && (f.dataDesligamento || '').startsWith(periodo.mesAno)).sort((a,b) => (b.dataDesligamento||'').localeCompare(a.dataDesligamento||''));
    const prazosVencidos = prazosList.filter(p => {
        const dv = p.dataVencimento || '';
        return dv >= periodo.inicio && dv <= periodo.fim && moment(dv).diff(moment().startOf('day'), 'days') < 0;
    }).sort((a,b) => (b.dataVencimento||'').localeCompare(a.dataVencimento||''));
    const pendAbertas = pendenciasList.filter(p => !p.concluida).sort((a,b) => (b.dataCriacao||'').localeCompare(a.dataCriacao||''));
    const pendConcluidas = pendenciasList.filter(p => p.concluida && (p.dataConclusao || '').startsWith(periodo.mesAno)).sort((a,b) => (b.dataConclusao||'').localeCompare(a.dataConclusao||''));

    const tipoContrato = f => f.idPrazoVinculado ? 'Experiência' : 'Indeterminado';
    const motivoDeslig = f => f.motivoDesligamento || 'Não informado';

    let html = `<div style="${s.page}">`;

    // Cabeçalho
    html += `<div style="${s.header}">
        <div style="${s.headerTit}">Relatório de RH</div>
        <div style="${s.headerSub}">${periodo.nomeMes} &nbsp;·&nbsp; Gerado em ${moment().format('DD/MM/YYYY [às] HH:mm')}</div>
    </div>`;

    // Cards resumo
    html += `<div style="${s.cardsRow}">
        ${relCard(ativos.length, 'Funcionários Ativos', s)}
        ${relCard(admissoes.length, 'Admissões no Mês', s, '#059669')}
        ${relCard(desligados.length, 'Desligamentos no Mês', s, '#dc2626')}
        ${relCard(prazosVencidos.length, 'Prazos Vencidos', s, '#d97706')}
        ${relCard(pendAbertas.length, 'Pendências Abertas', s, '#7c3aed')}
    </div>`;

    // Admissões
    if (relCheck('rel-check-admissoes')) {
        html += `<div style="${s.secTit}">Admissões no Período</div>`;
        html += relTabela(
            ['Nome', 'Função', 'Unidade', 'Data Admissão', 'Tipo Contrato'],
            admissoes.map(f => [esc(f.nome), esc(f.funcao || '—'), esc(f.unidade || '—'), fmt(f.admissao), tipoContrato(f)]),
            s
        );
    }

    // Desligamentos
    if (relCheck('rel-check-desligamentos')) {
        html += `<div style="${s.secTit}">Desligamentos no Período</div>`;
        html += relTabela(
            ['Nome', 'Unidade', 'Data Desligamento', 'Motivo'],
            desligados.map(f => [esc(f.nome), esc(f.unidade || '—'), fmt(f.dataDesligamento), esc(motivoDeslig(f))]),
            s
        );
    }

    // Prazos vencidos
    if (relCheck('rel-check-prazos')) {
        html += `<div style="${s.secTit}">Prazos Vencidos no Período (ainda ativos)</div>`;
        html += relTabela(
            ['Funcionário', 'Unidade', 'Tipo de Prazo', 'Data Vencimento'],
            prazosVencidos.map(p => [esc(p.nome), esc(p.unidade || '—'), esc(p.tipo || p.tipoCod || '—'), fmt(p.dataVencimento)]),
            s
        );
    }

    // Pendências abertas
    if (relCheck('rel-check-pend-abertas')) {
        html += `<div style="${s.secTit}">Pendências Abertas</div>`;
        html += relTabela(
            ['Descrição', 'Categoria', 'Prioridade', 'Criado em', 'Vencimento'],
            pendAbertas.map(p => [esc(p.descricao), esc(p.categoria || '—'), (p.prioridade || '—').toUpperCase(), fmt(p.dataCriacao), p.vencimento ? fmt(p.vencimento) : 'Não definido']),
            s
        );
    }

    // Pendências concluídas no mês
    if (relCheck('rel-check-pend-concluidas')) {
        html += `<div style="${s.secTit}">Pendências Concluídas no Período</div>`;
        html += relTabela(
            ['Descrição', 'Categoria', 'Data Conclusão'],
            pendConcluidas.map(p => [esc(p.descricao), esc(p.categoria || '—'), fmt(p.dataConclusao)]),
            s
        );
    }

    // Rodapé
    html += `<div style="${s.footer}">MyABIB — Sistema de Gestão de RH</div>`;
    html += '</div>';
    return html;
}

// ─── RELATÓRIO DE GASTOS ─────────────────────────────────────
// ── Filtro de Categorias ─────────────────────────────────────
function relPopularCategorias() {
    const container = document.getElementById('rel-filtro-categorias');
    if (!container) return;

    // Coletar categorias únicas dos gastos existentes, ordenadas alfabeticamente
    const cats = [...new Set(gastosList.map(g => g.tipo || 'Sem Categoria'))].sort();

    // Manter seleção atual se já existir
    const jaAtivos = new Set(
        [...container.querySelectorAll('.rel-cat-pill.ativo')].map(el => el.dataset.cat)
    );
    const primeiraVez = jaAtivos.size === 0;

    container.innerHTML = cats.map(cat => {
        const ativo = primeiraVez || jaAtivos.has(cat);
        return `<button type="button" class="rel-cat-pill ${ativo ? 'ativo' : ''}"
            data-cat="${esc(cat)}"
            onclick="relToggleCategoria(this)">
            <i class="fa-solid fa-check" style="font-size:0.7rem;${ativo ? '' : 'opacity:0;'}"></i>
            ${esc(cat)}
        </button>`;
    }).join('');
}

function relToggleCategoria(btn) {
    btn.classList.toggle('ativo');
    const ativo = btn.classList.contains('ativo');
    btn.querySelector('i').style.opacity = ativo ? '1' : '0';
}

function relCategoriasSelecionar(marcar) {
    document.querySelectorAll('#rel-filtro-categorias .rel-cat-pill').forEach(btn => {
        btn.classList.toggle('ativo', marcar);
        btn.querySelector('i').style.opacity = marcar ? '1' : '0';
    });
}

function relGetCategoriasSelecionadas() {
    return new Set(
        [...document.querySelectorAll('#rel-filtro-categorias .rel-cat-pill.ativo')]
            .map(btn => btn.dataset.cat)
    );
}

function buildRelatorioGastos(periodo) {
    const s = relCSS();
    const fmt = d => d ? moment(d).format('DD/MM/YYYY') : '—';
    const fmtBRL = v => 'R$ ' + parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const categoriasSel = relGetCategoriasSelecionadas();
    const doMes = gastosList.filter(g =>
        (g.data || '').startsWith(periodo.mesAno) &&
        (categoriasSel.size === 0 || categoriasSel.has(g.tipo || 'Sem Categoria'))
    );
    const totalGeral = doMes.reduce((acc, g) => acc + (parseFloat(g.valor) || 0), 0);

    // Agrupar por unidade
    const porUnidade = {};
    doMes.forEach(g => {
        const u = g.unidade || 'Sem Unidade';
        if (!porUnidade[u]) porUnidade[u] = { qtd: 0, total: 0 };
        porUnidade[u].qtd++;
        porUnidade[u].total += parseFloat(g.valor) || 0;
    });
    const linhasUnidade = Object.entries(porUnidade).sort((a, b) => b[1].total - a[1].total);

    // Agrupar por categoria
    const porCat = {};
    doMes.forEach(g => {
        const cat = g.tipo || 'Sem Categoria';
        if (!porCat[cat]) porCat[cat] = { qtd: 0, total: 0 };
        porCat[cat].qtd++;
        porCat[cat].total += parseFloat(g.valor) || 0;
    });
    const linhasCat = Object.entries(porCat).sort((a, b) => b[1].total - a[1].total);

    // Maior gasto
    const maiorGasto = doMes.reduce((mx, g) => (!mx || (parseFloat(g.valor) || 0) > (parseFloat(mx.valor) || 0)) ? g : mx, null);

    let html = `<div style="${s.page}">`;

    // Cabeçalho
    html += `<div style="${s.header}">
        <div style="${s.headerTit}">Relatório de Gastos</div>
        <div style="${s.headerSub}">${periodo.nomeMes} &nbsp;·&nbsp; Gerado em ${moment().format('DD/MM/YYYY [às] HH:mm')}</div>
    </div>`;

    // Cards resumo
    html += `<div style="${s.cardsRow}">
        ${relCard(fmtBRL(totalGeral), 'Total do Mês', s, '#4361ee')}
        ${relCard(doMes.length, 'Lançamentos', s)}
        ${relCard(linhasUnidade.length, 'Unidades', s)}
        ${relCard(linhasCat.length, 'Categorias', s)}
    </div>`;

    if (maiorGasto) {
        html += `<div style="background:#fff7ed;border-left:3px solid #d97706;padding:8px 12px;border-radius:4px;margin-bottom:14px;font-size:11px;">
            <strong>Maior lançamento:</strong> ${esc(maiorGasto.descricao || '—')} — ${fmtBRL(maiorGasto.valor)} (${esc(maiorGasto.unidade || '—')})
        </div>`;
    }

    // Total por unidade
    if (relCheck('rel-check-por-unidade')) {
        html += `<div style="${s.secTit}">Total por Unidade</div>`;
        html += relTabela(
            ['Unidade', 'Lançamentos', 'Total (R$)'],
            linhasUnidade.map(([u, v]) => [esc(u), v.qtd, fmtBRL(v.total)]),
            s
        );
    }

    // Total por categoria
    if (relCheck('rel-check-por-categoria')) {
        html += `<div style="${s.secTit}">Total por Categoria</div>`;
        html += relTabela(
            ['Categoria', 'Lançamentos', 'Total (R$)'],
            linhasCat.map(([cat, v]) => [esc(cat), v.qtd, fmtBRL(v.total)]),
            s
        );
    }

    // Lista detalhada
    if (relCheck('rel-check-lista-gastos')) {
        html += `<div style="${s.secTit}">Lista Detalhada de Lançamentos</div>`;
        const ordenados = [...doMes].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        html += relTabela(
            ['Data', 'Descrição', 'Categoria', 'Unidade', 'Valor (R$)'],
            ordenados.map(g => [fmt(g.data), esc(g.descricao || '—'), esc(g.tipo || '—'), esc(g.unidade || '—'), fmtBRL(g.valor)]),
            s
        );
    }

    // Rodapé com total
    html += `<div style="text-align:right;font-weight:bold;font-size:12px;margin-top:8px;padding-top:6px;border-top:2px solid #4361ee;color:#1e3a8a;">
        Total Geral: ${fmtBRL(totalGeral)}
    </div>`;
    html += `<div style="${s.footer}">MyABIB — Sistema de Gestão de RH</div>`;
    html += '</div>';
    return html;
}

// ============================================================
// RELATÓRIO DE BANCO DE HORAS
// ============================================================

function abrirRelatorioBH() {
    // Popular select de unidades
    const sel = document.getElementById('bh-filtro-unidade');
    if (sel.options.length <= 1) {
        UNIDADES.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            sel.appendChild(opt);
        });
    }
    // Reset
    sel.value = '';
    document.getElementById('bh-incluir-aviso').checked = false;
    bhSelecionarOrdem('asc');
    document.getElementById('bh-ordem-unidade').value = 'false';
    document.getElementById('lbl-bh-ord-unidade').removeAttribute('data-bh-ativo');
    document.getElementById('bh-check-cards').checked = true;
    document.getElementById('bh-check-tabela').checked = true;
    document.getElementById('bh-preview-area').innerHTML =
        '<p style="color:var(--text-light);text-align:center;margin:2rem 0;">Configure os filtros e clique em <strong>Gerar Prévia</strong>.</p>';
    document.getElementById('btn-baixar-pdf-bh').disabled = true;
    document.getElementById('painel-personalizar-bh').classList.add('hidden');
    document.getElementById('modal-relatorio-bh').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function fecharRelatorioBH() {
    document.getElementById('modal-relatorio-bh').classList.add('hidden');
    document.body.style.overflow = '';
}

function toggleBHPersonalizar() {
    document.getElementById('painel-personalizar-bh').classList.toggle('hidden');
}

function bhSelecionarOrdem(valor) {
    document.getElementById('bh-ordem-valor').value = valor;
    ['lbl-bh-ord-asc','lbl-bh-ord-desc'].forEach(id => {
        document.getElementById(id).removeAttribute('data-bh-ativo');
    });
    const mapa = { 'asc': 'lbl-bh-ord-asc', 'desc': 'lbl-bh-ord-desc' };
    if (mapa[valor]) document.getElementById(mapa[valor]).setAttribute('data-bh-ativo', 'true');
}

function bhToggleUnidade() {
    const btn = document.getElementById('lbl-bh-ord-unidade');
    const inp = document.getElementById('bh-ordem-unidade');
    const ativo = inp.value === 'true';
    inp.value = (!ativo).toString();
    if (!ativo) btn.setAttribute('data-bh-ativo', 'true');
    else btn.removeAttribute('data-bh-ativo');
}

async function gerarPreviaBH() {
    const area = document.getElementById('bh-preview-area');
    area.innerHTML = '<p style="color:var(--text-light);text-align:center;margin:2rem 0;"><i class="fa-solid fa-spinner fa-spin"></i> Buscando dados do banco de horas...</p>';
    document.getElementById('btn-baixar-pdf-bh').disabled = true;

    try {
        const html = await buildRelatorioBancoHoras();
        area.innerHTML = html;
        document.getElementById('btn-baixar-pdf-bh').disabled = false;
    } catch (e) {
        area.innerHTML = '<p style="color:var(--danger);text-align:center;margin:2rem 0;">Erro ao buscar dados. Tente novamente.</p>';
        console.error('Erro buildRelatorioBancoHoras:', e);
    }
}

function baixarPDFBH() {
    const area = document.getElementById('bh-preview-area');
    const unidade = document.getElementById('bh-filtro-unidade').value;
    const sufixo = unidade ? unidade.replace(/\s+/g, '_') : 'Todas';
    const nomeArq = `Relatorio_BancoHoras_${sufixo}_${moment().format('YYYY-MM')}.pdf`;
    const opt = {
        margin:      [8, 8, 8, 8],
        filename:    nomeArq,
        image:       { type: 'jpeg', quality: 0.97 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF:       { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
    const clone = area.cloneNode(true);
    clone.style.maxHeight = 'none';
    clone.style.overflow = 'visible';
    document.body.appendChild(clone);
    html2pdf().set(opt).from(clone).save().then(() => document.body.removeChild(clone));
}

async function buildRelatorioBancoHoras() {
    const s = relCSS();
    const unidadeFiltro = document.getElementById('bh-filtro-unidade').value;
    const incluirAviso  = document.getElementById('bh-incluir-aviso').checked;

    // Montar lista de funcionários conforme filtros
    let funcs = funcionariosList.filter(f => {
        if (f.desligado) return false;
        if (f.emAvisoPrevio && !incluirAviso) return false;
        if (unidadeFiltro && f.unidade !== unidadeFiltro) return false;
        return true;
    });

    // Para cada funcionário, buscar o cartão conferido mais recente (até 6 meses atrás)
    const MESES_BUSCAR = 6;
    const resultados = await Promise.all(funcs.map(async f => {
        let saldo = null;
        for (let i = 0; i < MESES_BUSCAR; i++) {
            const mesAno = moment().subtract(i, 'months').format('YYYY-MM');
            const cartao = await fetchPontoMes(f.idFunc, mesAno);
            if (cartao && cartao.conferido === true && cartao.fechamentoAcumulado !== undefined) {
                saldo = cartao.fechamentoAcumulado;
                break;
            }
        }
        return { func: f, saldo };
    }));

    // Ordenação conforme seleção do usuário
    const ordemDir   = document.getElementById('bh-ordem-valor')?.value || 'asc';
    const porUnidade  = document.getElementById('bh-ordem-unidade')?.value === 'true';
    const desc        = ordemDir === 'desc';

    resultados.sort((a, b) => {
        // Sem cartão sempre por último
        if (a.saldo === null && b.saldo === null) {
            if (porUnidade) return (a.func.unidade || '').localeCompare(b.func.unidade || '') || (a.func.nome || '').localeCompare(b.func.nome || '');
            return (a.func.nome || '').localeCompare(b.func.nome || '');
        }
        if (a.saldo === null) return 1;
        if (b.saldo === null) return -1;
        // Ordenação por unidade primeiro (se selecionado)
        if (porUnidade) {
            const unidCmp = (a.func.unidade || '').localeCompare(b.func.unidade || '');
            if (unidCmp !== 0) return unidCmp;
        }
        // Ordenação por saldo
        return desc ? b.saldo - a.saldo : a.saldo - b.saldo;
    });

    const fmtSaldo = v => {
        if (v === null) return '<span style="color:#9ca3af;">Sem cartão</span>';
        const cor = v > 0 ? '#059669' : v < 0 ? '#dc2626' : '#6b7280';
        const sinal = v > 0 ? '+' : '';
        return `<span style="color:${cor};font-weight:600;">${sinal}${formatMinutes(v)}</span>`;
    };

    const totalFuncs   = resultados.length;
    const comSaldo     = resultados.filter(r => r.saldo !== null);
    const devedores    = comSaldo.filter(r => r.saldo < 0).length;
    const credores     = comSaldo.filter(r => r.saldo > 0).length;
    const semCartao    = resultados.filter(r => r.saldo === null).length;
    const unidLabel    = unidadeFiltro || 'Todas as unidades';

    let html = `<div style="${s.page}">`;

    // Cabeçalho
    html += `<div style="${s.header}">
        <div style="${s.headerTit}">Relatório de Banco de Horas</div>
        <div style="${s.headerSub}">${unidLabel}${incluirAviso ? ' · Inclui aviso prévio' : ''} &nbsp;·&nbsp; Gerado em ${moment().format('DD/MM/YYYY [às] HH:mm')}</div>
    </div>`;

    const showCards  = document.getElementById('bh-check-cards')?.checked !== false;
    const showTabela = document.getElementById('bh-check-tabela')?.checked !== false;

    // Cards resumo
    if (showCards) {
        html += `<div style="${s.cardsRow}">
            ${relCard(totalFuncs, 'Funcionários', s)}
            ${relCard(devedores, 'Com Saldo Negativo', s, '#dc2626')}
            ${relCard(credores, 'Com Saldo Positivo', s, '#059669')}
            ${relCard(semCartao, 'Sem Cartão Conferido', s, '#9ca3af')}
        </div>`;
    }

    // Tabela principal
    if (showTabela) {
    html += `<div style="${s.secTit}">Saldo por Funcionário — Banco Acumulado (cartão conferido mais recente)</div>`;

    if (!resultados.length) {
        html += `<p style="${s.empty}">Nenhum funcionário encontrado com os filtros selecionados.</p>`;
    } else {
        const linhas = resultados.map(r => [
            esc(r.func.nome),
            esc(r.func.unidade || '—'),
            esc(r.func.funcao || '—'),
            r.func.emAvisoPrevio
                ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;display:inline-block;">Aviso Prévio</span>'
                : '<span style="background:#d1fae5;color:#065f46;padding:2px 6px;border-radius:4px;font-size:10px;white-space:nowrap;display:inline-block;">Ativo</span>',
            fmtSaldo(r.saldo),
        ]);

        // Montar tabela manualmente para suportar HTML nas células
        const ths = ['Funcionário', 'Unidade', 'Função', 'Status', 'Saldo Acumulado']
            .map(h => `<th style="${s.th}">${h}</th>`).join('');
        const trs = linhas.map((cols, i) =>
            `<tr>${cols.map(v => `<td style="${i % 2 === 0 ? s.td : s.tdAlt}">${v}</td>`).join('')}</tr>`
        ).join('');
        html += `<table style="${s.table}"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    }

    } // fim if(showTabela)

    html += `<div style="${s.footer}">MyABIB — Sistema de Gestão de RH &nbsp;·&nbsp; Saldos baseados no último cartão conferido de cada funcionário</div>`;
    html += '</div>';
    return html;
}

// ============================================================
// MÓDULO DE GRÁFICOS DO DASHBOARD
// ============================================================

let _chartInstances = {};

function _destroyChart(id) {
    if (_chartInstances[id]) {
        _chartInstances[id].destroy();
        delete _chartInstances[id];
    }
}

function _getCSSVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function toggleGraficos() {
    const corpo = document.getElementById('graficos-corpo');
    const chevron = document.getElementById('graficos-chevron');
    const controles = document.getElementById('graficos-controles');
    if (!corpo) return;
    const recolhido = corpo.style.display === 'none';
    corpo.style.display = recolhido ? '' : 'none';
    controles.style.display = recolhido ? '' : 'none';
    chevron.style.transform = recolhido ? '' : 'rotate(-90deg)';
    localStorage.setItem('graficos-recolhido', recolhido ? '0' : '1');
}

function renderGraficos() {
    const meses = parseInt(document.getElementById('grafico-meses')?.value || 6);
    // Restaurar estado colapsado
    const recolhido = localStorage.getItem('graficos-recolhido') === '1';
    const corpo = document.getElementById('graficos-corpo');
    const chevron = document.getElementById('graficos-chevron');
    const controles = document.getElementById('graficos-controles');
    if (corpo) corpo.style.display = recolhido ? 'none' : '';
    if (controles) controles.style.display = recolhido ? 'none' : '';
    if (chevron) chevron.style.transform = recolhido ? 'rotate(-90deg)' : '';
    if (recolhido) return; // não renderiza se estiver recolhido

    _renderGraficoAdmissoes(meses);
    _renderGraficoBancoHoras(meses);
    _renderGraficoGastosUnidade(meses);
    _renderGraficoGastosCategoria(meses);
}

// ─── Cores e helpers ─────────────────────────────────────────
function _mesesAtras(n) {
    const lista = [];
    for (let i = n - 1; i >= 0; i--) {
        lista.push(moment().subtract(i, 'months').format('YYYY-MM'));
    }
    return lista;
}
function _labelMes(mesAno) {
    return moment(mesAno, 'YYYY-MM').format('MMM/YY');
}
const CORES_GRAFICO = [
    '#4361ee','#7c3aed','#059669','#d97706','#dc2626',
    '#0891b2','#be185d','#65a30d','#ea580c','#6366f1',
    '#14b8a6','#f59e0b','#ef4444','#8b5cf6','#10b981',
    '#f97316','#3b82f6','#a21caf','#84cc16','#06b6d4',
    '#e11d48',
];

function _chartDefaults() {
    const isDark = document.body.classList.contains('dark-theme');
    return {
        textColor:   isDark ? '#cbd5e1' : '#374151',
        gridColor:   isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
        bgCard:      isDark ? '#1e293b' : '#ffffff',
    };
}

// ─── 1. Admissões vs Desligamentos ───────────────────────────
function _renderGraficoAdmissoes(meses) {
    const canvas = document.getElementById('grafico-admissoes');
    if (!canvas) return;
    _destroyChart('admissoes');

    const periodo = _mesesAtras(meses);
    const admissoes = periodo.map(m => funcionariosList.filter(f => (f.admissao || '').startsWith(m)).length);
    const desligamentos = periodo.map(m => funcionariosList.filter(f => f.desligado && (f.dataDesligamento || '').startsWith(m)).length);
    const labels = periodo.map(_labelMes);
    const d = _chartDefaults();

    _chartInstances['admissoes'] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'Admissões',     data: admissoes,    backgroundColor: '#4361ee', borderRadius: 4 },
                { label: 'Desligamentos', data: desligamentos, backgroundColor: '#dc2626', borderRadius: 4 },
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: { legend: { labels: { color: d.textColor, font: { size: 11 } } } },
            scales: {
                x: { ticks: { color: d.textColor, font: { size: 10 } }, grid: { color: d.gridColor } },
                y: { ticks: { color: d.textColor, font: { size: 10 }, stepSize: 1, precision: 0 }, grid: { color: d.gridColor }, beginAtZero: true },
            }
        }
    });
}

// ─── 2. Saldo Médio Banco de Horas ───────────────────────────
async function _renderGraficoBancoHoras(meses) {
    const canvas = document.getElementById('grafico-banco-horas');
    if (!canvas) return;
    _destroyChart('banco-horas');

    const periodo = _mesesAtras(meses);
    const ativos = funcionariosList.filter(f => !f.desligado && !f.emAvisoPrevio);
    const labels = periodo.map(_labelMes);
    const d = _chartDefaults();

    // Buscar saldos para cada mês (usa pontoCache)
    const medias = await Promise.all(periodo.map(async mesAno => {
        const saldos = await Promise.all(ativos.map(async f => {
            const cartao = await fetchPontoMes(f.idFunc, mesAno);
            if (cartao && cartao.conferido && cartao.fechamentoAcumulado !== undefined) {
                return cartao.fechamentoAcumulado;
            }
            return null;
        }));
        const validos = saldos.filter(s => s !== null);
        if (!validos.length) return 0;
        return Math.round(validos.reduce((a, b) => a + b, 0) / validos.length);
    }));

    // Converter minutos para horas decimais para o gráfico
    const emHoras = medias.map(m => parseFloat((m / 60).toFixed(2)));

    _chartInstances['banco-horas'] = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Saldo médio (horas)',
                data: emHoras,
                borderColor: '#4361ee',
                backgroundColor: 'rgba(67,97,238,0.12)',
                borderWidth: 2,
                pointRadius: 4,
                pointBackgroundColor: '#4361ee',
                fill: true,
                tension: 0.3,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: {
                legend: { labels: { color: d.textColor, font: { size: 11 } } },
                tooltip: { callbacks: { label: ctx => {
                    const mins = medias[ctx.dataIndex];
                    const h = Math.floor(Math.abs(mins) / 60);
                    const m = Math.abs(mins) % 60;
                    const sinal = mins < 0 ? '-' : mins > 0 ? '+' : '';
                    return ` ${sinal}${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                }}}
            },
            scales: {
                x: { ticks: { color: d.textColor, font: { size: 10 } }, grid: { color: d.gridColor } },
                y: { ticks: { color: d.textColor, font: { size: 10 } }, grid: { color: d.gridColor } },
            }
        }
    });
}

// ─── 3. Gastos por Unidade ───────────────────────────────────
function _renderGraficoGastosUnidade(meses) {
    const canvas = document.getElementById('grafico-gastos-unidade');
    if (!canvas) return;
    _destroyChart('gastos-unidade');

    const periodo = _mesesAtras(meses);
    const dosPeriodo = gastosList.filter(g => periodo.includes((g.data || '').substring(0, 7)));

    const porUnidade = {};
    dosPeriodo.forEach(g => {
        const u = g.unidade || 'Sem Unidade';
        porUnidade[u] = (porUnidade[u] || 0) + (parseFloat(g.valor) || 0);
    });

    const ordenado = Object.entries(porUnidade).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const labels = ordenado.map(([u]) => u.length > 16 ? u.substring(0, 14) + '…' : u);
    const valores = ordenado.map(([, v]) => parseFloat(v.toFixed(2)));
    const d = _chartDefaults();

    _chartInstances['gastos-unidade'] = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Total (R$)',
                data: valores,
                backgroundColor: CORES_GRAFICO.slice(0, labels.length),
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` R$ ${ctx.parsed.x.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` } }
            },
            scales: {
                x: { ticks: { color: d.textColor, font: { size: 10 }, callback: v => 'R$ ' + (v/1000).toFixed(0) + 'k' }, grid: { color: d.gridColor } },
                y: { ticks: { color: d.textColor, font: { size: 10 } }, grid: { color: d.gridColor } },
            }
        }
    });
}

// ─── 4. Gastos por Categoria ─────────────────────────────────
function _renderGraficoGastosCategoria(meses) {
    const canvas = document.getElementById('grafico-gastos-categoria');
    if (!canvas) return;
    _destroyChart('gastos-categoria');

    const periodo = _mesesAtras(meses);
    const dosPeriodo = gastosList.filter(g => periodo.includes((g.data || '').substring(0, 7)));

    const porCat = {};
    dosPeriodo.forEach(g => {
        const cat = g.tipo || 'Sem Categoria';
        porCat[cat] = (porCat[cat] || 0) + (parseFloat(g.valor) || 0);
    });

    const ordenado = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
    const labels = ordenado.map(([cat]) => cat);
    const valores = ordenado.map(([, v]) => parseFloat(v.toFixed(2)));
    const d = _chartDefaults();

    _chartInstances['gastos-categoria'] = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: valores,
                backgroundColor: CORES_GRAFICO.slice(0, labels.length),
                borderWidth: 2,
                borderColor: d.bgCard,
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: true,
            plugins: {
                legend: { position: 'right', labels: { color: d.textColor, font: { size: 10 }, boxWidth: 12, padding: 8 } },
                tooltip: { callbacks: { label: ctx => ` R$ ${ctx.parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` } }
            }
        }
    });
}

// ============================================================
// MÓDULO DE HISTÓRICO DE ALTERAÇÕES
// ============================================================

const HISTORICO_KEY = 'historico_alteracoes';
const HISTORICO_MAX = 500;

const HISTORICO_ICONES = {
    funcionario: { icon: 'fa-address-card', cor: '#4361ee' },
    desligamento:{ icon: 'fa-user-xmark',   cor: '#dc2626' },
    prazo:       { icon: 'fa-clock',         cor: '#d97706' },
    gasto:       { icon: 'fa-file-invoice-dollar', cor: '#059669' },
    pendencia:   { icon: 'fa-list-check',    cor: '#7c3aed' },
};

function registrarHistorico(tipo, descricao, detalhe = '', idFunc = '') {
    const entrada = {
        id:        Date.now(),
        tipo,
        descricao,
        detalhe,
        idFunc,
        data:      moment().format('YYYY-MM-DD HH:mm:ss'),
    };
    try {
        const raw = localStorage.getItem(HISTORICO_KEY);
        const lista = raw ? JSON.parse(raw) : [];
        lista.unshift(entrada);
        if (lista.length > HISTORICO_MAX) lista.splice(HISTORICO_MAX);
        localStorage.setItem(HISTORICO_KEY, JSON.stringify(lista));
    } catch(e) { console.warn('Histórico: erro ao salvar', e); }
}

function getHistorico() {
    try {
        const raw = localStorage.getItem(HISTORICO_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch(e) { return []; }
}

function limparHistorico() {
    if (!confirm('Apagar todo o histórico de alterações? Esta ação não pode ser desfeita.')) return;
    localStorage.removeItem(HISTORICO_KEY);
    renderHistorico();
    showToast('Histórico apagado.', 'info');
}

function renderHistorico() {
    const container = document.getElementById('historico-lista');
    if (!container) return;

    const filtro    = document.getElementById('historico-filtro-tipo')?.value || '';
    const filtroFunc = _norm(document.getElementById('historico-filtro-func')?.value || '');
    let lista = getHistorico();
    if (filtro) lista = lista.filter(e => e.tipo === filtro);
    if (filtroFunc) lista = lista.filter(e => _fuzzyMatch(e.descricao, filtroFunc) || _fuzzyMatch(e.detalhe, filtroFunc));

    if (!lista.length) {
        container.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--text-light);">
            <i class="fa-solid fa-clock-rotate-left" style="font-size:2rem; margin-bottom:0.5rem; display:block; opacity:0.3;"></i>
            Nenhum registro encontrado.
        </div>`;
        return;
    }

    // Agrupar por data (dia)
    const porDia = {};
    lista.forEach(e => {
        const dia = e.data.substring(0, 10);
        if (!porDia[dia]) porDia[dia] = [];
        porDia[dia].push(e);
    });

    let html = '';
    Object.entries(porDia).forEach(([dia, entradas]) => {
        const labelDia = moment(dia).calendar(null, {
            sameDay:  '[Hoje]',
            lastDay:  '[Ontem]',
            lastWeek: 'dddd, DD/MM',
            sameElse: 'DD/MM/YYYY',
        });
        html += `<div style="margin-bottom:1.25rem;">
            <div style="font-size:0.75rem; font-weight:700; color:var(--text-light); text-transform:uppercase;
                        letter-spacing:0.06em; padding:0.3rem 0; border-bottom:1px solid var(--border);
                        margin-bottom:0.5rem;">${labelDia}</div>`;
        entradas.forEach(e => {
            const cfg = HISTORICO_ICONES[e.tipo] || { icon: 'fa-circle', cor: '#6b7280' };
            const hora = e.data.substring(11, 16);
            html += `<div style="display:flex; gap:0.75rem; align-items:flex-start; padding:0.6rem 0.5rem;
                                 border-radius:8px; transition:background 0.15s;"
                         onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background='transparent'">
                <div style="width:32px; height:32px; border-radius:8px; background:${cfg.cor}18;
                            display:flex; align-items:center; justify-content:center; flex-shrink:0; margin-top:1px;">
                    <i class="fa-solid ${cfg.icon}" style="font-size:0.8rem; color:${cfg.cor};"></i>
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="font-size:0.85rem; font-weight:500; color:var(--text-main); line-height:1.3;">${e.descricao}</div>
                    ${e.detalhe ? `<div style="font-size:0.78rem; color:var(--text-light); margin-top:2px;">${e.detalhe}</div>` : ''}
                    ${e.idFunc ? `<div style="font-size:0.73rem; color:var(--primary); margin-top:3px; cursor:pointer;"
                        onclick="switchTab('funcionarios'); setTimeout(()=>{ document.getElementById('search-funcionarios').value='${e.idFunc}'; renderFuncionarios(); }, 200);">
                        <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;"></i> Ver funcionário</div>` : ''}
                </div>
                <div style="font-size:0.75rem; color:var(--text-light); flex-shrink:0; margin-top:2px;">${hora}</div>
            </div>`;
        });
        html += '</div>';
    });

    container.innerHTML = html;
}

// ============================================================
// BUSCA GLOBAL DE FUNCIONÁRIOS
// ============================================================

// Debounce da busca global — evita Levenshtein a cada tecla
var _buscarGlobalTimer = null;
function _buscarGlobalDebounce(termo) {
    clearTimeout(_buscarGlobalTimer);
    _buscarGlobalTimer = setTimeout(function() {
        buscarFuncionarioGlobal(termo);
    }, 180);
}

function buscarFuncionarioGlobal(termo) {
    const container = document.getElementById('resultado-busca-global');
    if (!container) return;

    const t = _norm((termo || '').trim());
    if (!t || t.length < 2) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    const resultados = funcionariosList
        .map(f => {
            const cpf = (f.cpf || '').replace(/\D/g, '');
            const score = Math.max(
                _fuzzyScore(f.nome, t),
                cpf.includes(t) ? 3 : 0,
                _fuzzyScore(f.funcao, t),
                _fuzzyScore(f.unidade, t)
            );
            return { f, score };
        })
        .filter(r => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(r => r.f);

    if (!resultados.length) {
        container.innerHTML = `<div style="padding:0.75rem 1rem; color:var(--text-light); font-size:0.85rem; background:var(--bg-card);">Nenhum funcionário encontrado.</div>`;
        container.classList.remove('hidden');
        return;
    }

    container.innerHTML = resultados.map(f => {
        const status = f.desligado ? 'Desligado' : f.emAvisoPrevio ? 'Aviso Prévio' : '';
        const corStatus = f.desligado ? '#dc2626' : '#d97706';
        const bgStatus  = f.desligado ? '#fee2e2' : '#fef3c7';
        const iniciais  = (f.nome || '?').split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();
        const badge = status ? `<span style="font-size:0.7rem;font-weight:600;padding:1px 7px;border-radius:20px;background:${bgStatus};color:${corStatus};display:inline-block;margin-top:3px;">${status}</span>` : '';
        return `<div onclick="abrirFichaRapida('${f.idFunc}')" style="
            display:flex;align-items:flex-start;gap:0.75rem;padding:0.6rem 1rem;
            cursor:pointer;transition:background 0.12s;border-bottom:1px solid var(--border);"
            onmouseover="this.style.background='var(--bg-hover)'" onmouseout="this.style.background=''">
            <div style="width:34px;height:34px;border-radius:50%;background:#4361ee22;
                        display:flex;align-items:center;justify-content:center;flex-shrink:0;
                        margin-top:2px;font-size:0.78rem;font-weight:700;color:#4361ee;">${iniciais}</div>
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.88rem;font-weight:600;color:var(--text-main);line-height:1.3;">${f.nome}</div>
                <div style="font-size:0.76rem;color:var(--text-light);margin-top:1px;">${f.funcao || '—'} · ${f.unidade || '—'}</div>
                ${badge}
            </div>
        </div>`;
    }).join('');

    // Fechar ao clicar fora
    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            if (!document.getElementById('input-busca-global')?.contains(e.target) &&
                !container.contains(e.target)) {
                container.classList.add('hidden');
                document.removeEventListener('click', handler);
            }
        });
    }, 0);
}

function abrirFichaRapida(idFunc) {
    const f = funcionariosList.find(f => f.idFunc === idFunc);
    if (!f) return;

    // Fechar dropdown
    document.getElementById('resultado-busca-global')?.classList.add('hidden');
    document.getElementById('input-busca-global').value = '';

    const status = f.desligado ? 'Desligado' : f.emAvisoPrevio ? 'Aviso Prévio' : 'Ativo';
    const corStatus = f.desligado ? '#dc2626' : f.emAvisoPrevio ? '#d97706' : '#059669';
    const bgStatus  = f.desligado ? '#fee2e2' : f.emAvisoPrevio ? '#fef3c7' : '#d1fae5';

    // Prazos vinculados
    const prazosFunc = prazosList.filter(p => p.nome === f.nome || p.id === f.idPrazoVinculado);
    const prazoHTML = prazosFunc.length ? prazosFunc.map(p => {
        const dias = moment(p.dataVencimento).diff(moment(), 'days');
        const cor = dias < 0 ? '#dc2626' : dias <= 10 ? '#d97706' : '#059669';
        return `<div style="display:flex; justify-content:space-between; padding:0.35rem 0; border-bottom:1px solid var(--border); font-size:0.82rem;">
            <span style="color:var(--text-main);">${p.tipo || p.tipoCod}</span>
            <span style="color:${cor}; font-weight:600;">${dias < 0 ? `${Math.abs(dias)}d atrás` : `${dias}d restantes`}</span>
        </div>`;
    }).join('') : '<div style="color:var(--text-light); font-size:0.82rem;">Nenhum prazo ativo.</div>';

    const iniciais = (f.nome || '?').split(' ').slice(0,2).map(p => p[0]).join('').toUpperCase();
    const admissao = f.admissao ? moment(f.admissao).format('DD/MM/YYYY') : '—';
    const nascimento = f.dataNascimento ? moment(f.dataNascimento).format('DD/MM/YYYY') : '—';

    document.getElementById('ficha-rapida-titulo').textContent = 'Ficha do Funcionário';
    document.getElementById('ficha-rapida-corpo').innerHTML = `
        <div style="display:flex; align-items:center; gap:1rem; margin-bottom:1.25rem;">
            <div style="width:52px; height:52px; border-radius:50%; background:#4361ee22;
                        display:flex; align-items:center; justify-content:center;
                        font-size:1.1rem; font-weight:700; color:#4361ee; flex-shrink:0;">${iniciais}</div>
            <div>
                <div style="font-size:1rem; font-weight:700; color:var(--text-main);">${f.nome}</div>
                <div style="font-size:0.83rem; color:var(--text-light);">${f.funcao || '—'}</div>
                <span style="font-size:0.75rem; font-weight:600; padding:2px 10px; border-radius:20px;
                             background:${bgStatus}; color:${corStatus}; margin-top:4px; display:inline-block;">${status}</span>
            </div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:1.25rem;">
            ${_fichaItem('fa-building', 'Unidade', f.unidade || '—')}
            ${_fichaItem('fa-id-card', 'CPF', f.cpf || '—')}
            ${_fichaItem('fa-calendar-check', 'Admissão', admissao)}
            ${_fichaItem('fa-cake-candles', 'Nascimento', nascimento)}
        </div>
        <div style="font-size:0.82rem; font-weight:600; color:var(--text-light); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem;">Prazos Ativos</div>
        <div style='background:var(--bg-card); border-radius:8px; border:1px solid var(--border); padding:0.5rem 0.75rem; margin-bottom:0.5rem;'>${prazoHTML}</div>
        ${!f.desligado ? `<div style="margin-top:1rem; display:flex; justify-content:flex-end;">
            <button class="btn-primary" style="font-size:0.82rem; height:34px;" onclick="fecharFichaRapida(); abrirModalEditFunc('${f.idFunc}')">
                <i class="fa-solid fa-pen"></i> Editar
            </button>
        </div>` : ''}
    `;

    document.getElementById('modal-ficha-rapida').classList.remove('hidden');
}

function _fichaItem(icon, label, valor) {
    return `<div style="background:var(--bg); border-radius:8px; padding:0.5rem 0.75rem; border:1px solid var(--border);">
        <div style="font-size:0.72rem; color:var(--text-light); margin-bottom:2px;">
            <i class="fa-solid ${icon}" style="margin-right:4px;"></i>${label}
        </div>
        <div style="font-size:0.85rem; font-weight:600; color:var(--text-main);">${valor}</div>
    </div>`;
}

function fecharFichaRapida() {
    document.getElementById('modal-ficha-rapida')?.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════════════════
// MÓDULO: TRATAR CONVERSAS (WHATSAPP)
// ═══════════════════════════════════════════════════════════════════════════

let whatsappArquivosSelecionados = [];
let whatsappAnaliseAtual = [];
let whatsappHistoricoAnalises = [];

// Inicializar histórico de análises do localStorage
function carregarHistoricoWhatsApp() {
    try {
        const saved = localStorage.getItem('whatsapp_historico_analises');
        if (saved) {
            whatsappHistoricoAnalises = JSON.parse(saved);
            renderHistoricoWhatsApp();
        }
    } catch (e) {
        console.error('Erro ao carregar histórico WhatsApp:', e);
    }
}

function salvarHistoricoWhatsApp() {
    try {
        localStorage.setItem('whatsapp_historico_analises', JSON.stringify(whatsappHistoricoAnalises));
    } catch (e) {
        console.error('Erro ao salvar histórico WhatsApp:', e);
    }
}

// Listar arquivos selecionados
function listarArquivosWhatsApp() {
    const input = document.getElementById('whatsapp-upload');
    const lista = document.getElementById('lista-arquivos-whatsapp');
    const btnProcessar = document.getElementById('btn-processar-whatsapp');
    const statusMsg = document.getElementById('whatsapp-status-msg');

    whatsappArquivosSelecionados = Array.from(input.files);

    if (whatsappArquivosSelecionados.length === 0) {
        lista.innerHTML = '';
        btnProcessar.disabled = true;
        statusMsg.textContent = '';
        return;
    }

    renderListaArquivosWhatsApp();
}

function renderListaArquivosWhatsApp() {
    const lista = document.getElementById('lista-arquivos-whatsapp');
    const btnProcessar = document.getElementById('btn-processar-whatsapp');
    const statusMsg = document.getElementById('whatsapp-status-msg');

    if (whatsappArquivosSelecionados.length === 0) {
        lista.innerHTML = '';
        btnProcessar.disabled = true;
        statusMsg.textContent = '';
        return;
    }

    let html = '<div style="background:var(--secondary); padding:0.75rem; border-radius:8px; margin-top:0.5rem;">';
    html += `<div style="font-size:0.85rem; font-weight:600; color:var(--text-main); margin-bottom:0.5rem;">`;
    html += `<i class="fa-solid fa-check-circle" style="color:var(--success);"></i> ${whatsappArquivosSelecionados.length} arquivo(s) selecionado(s)`;
    html += '</div>';
    html += '<div style="display:flex; flex-direction:column; gap:0.4rem;">';
    whatsappArquivosSelecionados.forEach((file, idx) => {
        html += `<div style="display:flex; align-items:center; justify-content:space-between; font-size:0.85rem; color:var(--text-light); background:var(--bg-card); padding:0.4rem 0.6rem; border-radius:6px;">`;
        html += `<span><i class="fa-solid fa-file-zipper" style="color:var(--primary); margin-right:0.4rem;"></i>${esc(file.name)} <span style="opacity:0.6;">(${(file.size / 1024 / 1024).toFixed(2)} MB)</span></span>`;
        html += `<button class="btn-icon btn-delete" onclick="removerArquivoWhatsApp(${idx})" title="Remover"><i class="fa-solid fa-xmark"></i></button>`;
        html += '</div>';
    });
    html += '</div></div>';

    lista.innerHTML = html;
    atualizarBotaoProcessarWhatsApp();
}

function removerArquivoWhatsApp(idx) {
    whatsappArquivosSelecionados.splice(idx, 1);
    // Resetar o input para permitir reselecionar o mesmo arquivo
    document.getElementById('whatsapp-upload').value = '';
    renderListaArquivosWhatsApp();
}

function atualizarBotaoProcessarWhatsApp() {
    const btnProcessar = document.getElementById('btn-processar-whatsapp');
    const statusMsg = document.getElementById('whatsapp-status-msg');
    const tipo = document.getElementById('whatsapp-tipo-filtro').value;

    const temArquivos = whatsappArquivosSelecionados.length > 0;
    let temData = false;
    if (tipo === 'apos') {
        temData = !!document.getElementById('whatsapp-data-inicio').value;
    } else {
        temData = !!document.getElementById('whatsapp-data-inicio-int').value && 
                  !!document.getElementById('whatsapp-data-fim-int').value;
    }

    const pronto = temArquivos && temData;
    btnProcessar.disabled = !pronto;

    if (!temArquivos) {
        statusMsg.textContent = '';
    } else if (!temData) {
        statusMsg.textContent = 'Informe o período para continuar.';
        statusMsg.style.color = 'var(--warning)';
    } else {
        statusMsg.textContent = 'Pronto para processar!';
        statusMsg.style.color = 'var(--success)';
    }
}

// Toggle filtro de período
function toggleFiltroWhatsApp() {
    const tipo = document.getElementById('whatsapp-tipo-filtro').value;
    const filtroApos = document.getElementById('whatsapp-filtro-apos');
    const filtroIntervalo = document.getElementById('whatsapp-filtro-intervalo');

    if (tipo === 'apos') {
        filtroApos.classList.remove('hidden');
        filtroIntervalo.classList.add('hidden');
    } else {
        filtroApos.classList.add('hidden');
        filtroIntervalo.classList.remove('hidden');
    }
    atualizarBotaoProcessarWhatsApp();
}

function sincronizarBadgePrioridade(id, valor) {
    const badge = document.getElementById(`${id}-badge-prioridade`);
    if (!badge) return;
    const labels = { alta: 'ALTA', media: 'MÉDIA', baixa: 'BAIXA' };
    badge.textContent = labels[valor] || valor.toUpperCase();
    badge.className = `whatsapp-badge-prioridade ${valor}`;
}

function toggleCtxBloco(colId) {
    const bloco = document.getElementById(colId);
    const btn   = document.getElementById(colId + '-btn');
    if (!bloco || !btn) return;
    const visivel = bloco.style.display !== 'none';
    bloco.style.display  = visivel ? 'none'  : 'flex';
    btn.textContent = visivel
        ? btn.textContent.replace('ver menos', 'ver mais')
        : btn.textContent.replace('ver mais', 'ver menos');
}

function limparResultadosWhatsApp() {
    whatsappAnaliseAtual = [];
    document.getElementById('whatsapp-resultados-container').classList.add('hidden');
    document.getElementById('whatsapp-lista-conversas').innerHTML = '';
    const btn = document.getElementById('btn-confirmar-selecionadas');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-check-double"></i> Confirmar Selecionadas'; }
}

function testarWhatsApp() {
    whatsappAnaliseAtual = [
        {
            nomeConversa: '📋 Conversa de Teste (simulada)',
            totalMensagens: 42,
            totalAudios: 3,
            totalImagens: 2,
            mensagens: [
                { data: '10/03/2026', hora: '09:12', autor: 'Maria', conteudo: 'Oi João, tudo bem?', linhaOriginal: '' },
                { data: '10/03/2026', hora: '09:13', autor: 'João', conteudo: 'Tudo! Precisamos resolver a admissão do novo.', linhaOriginal: '' },
                { data: '10/03/2026', hora: '09:14', autor: 'João', conteudo: 'preciso urgente dos docs do novo funcionário para a admissão', linhaOriginal: '' },
                { data: '10/03/2026', hora: '09:15', autor: 'Maria', conteudo: 'Ok, vou providenciar até sexta', linhaOriginal: '' },
                { data: '11/03/2026', hora: '14:30', autor: 'João', conteudo: 'Maria, e o pagamento da NF de fevereiro?', linhaOriginal: '' },
                { data: '11/03/2026', hora: '14:32', autor: 'Maria', conteudo: 'ainda não recebi confirmação do pagamento da NF de fevereiro', linhaOriginal: '' },
                { data: '11/03/2026', hora: '14:33', autor: 'João', conteudo: 'Verifica lá por favor', linhaOriginal: '' },
            ],
            pendencias: [
                {
                    descricao: 'Enviar documentação de admissão do novo funcionário até sexta-feira',
                    prioridade: 'alta',
                    prazo: moment().add(3, 'days').format('YYYY-MM-DD'),
                    contexto_inicio: '10/03/2026 09:12',
                    contexto_fim: '10/03/2026 09:15',
                    mensagens_chave: ['10/03/2026 09:13', '10/03/2026 09:14', '10/03/2026 09:15'],
                    categoria: 'RH'
                },
                {
                    descricao: 'Verificar pagamento da nota fiscal da contabilidade referente a fevereiro',
                    prioridade: 'media',
                    prazo: null,
                    contexto_inicio: '11/03/2026 14:30',
                    contexto_fim: '11/03/2026 14:33',
                    mensagens_chave: ['11/03/2026 14:30', '11/03/2026 14:32', '11/03/2026 14:33'],
                    categoria: 'Fiscal / Contábil'
                }
            ]
        }
    ];
    document.getElementById('whatsapp-resultados-container').classList.remove('hidden');
    renderResultadosWhatsApp();
    showToast('Modo de teste ativado — nenhuma API foi chamada.', 'warning');
}

// Processar conversas
async function processarConversasWhatsApp() {
    // Buscar chave do objeto de configuração global
    const apiKey = (typeof configGerais !== 'undefined' && configGerais.geminiKey) 
        ? configGerais.geminiKey.trim() 
        : '';
    
    if (!apiKey || apiKey === '') {
        showToast('Configure a chave da API Gemini nas Configurações primeiro!', 'error');
        // Scroll para o topo e mostrar mensagem
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
    }

    if (whatsappArquivosSelecionados.length === 0) {
        showToast('Selecione pelo menos um arquivo .zip', 'warning');
        return;
    }

    // Obter período selecionado
    const tipoFiltro = document.getElementById('whatsapp-tipo-filtro').value;
    let dataInicio, dataFim;

    if (tipoFiltro === 'apos') {
        dataInicio = document.getElementById('whatsapp-data-inicio').value;
        if (!dataInicio) {
            showToast('Informe a data inicial', 'warning');
            return;
        }
        dataFim = null;
    } else {
        dataInicio = document.getElementById('whatsapp-data-inicio-int').value;
        dataFim = document.getElementById('whatsapp-data-fim-int').value;
        if (!dataInicio || !dataFim) {
            showToast('Informe as duas datas do intervalo', 'warning');
            return;
        }
    }

    // Mostrar progresso
    document.getElementById('whatsapp-progresso-container').classList.remove('hidden');
    document.getElementById('btn-processar-whatsapp').disabled = true;

    whatsappAnaliseAtual = [];

    // Processar cada conversa
    for (let i = 0; i < whatsappArquivosSelecionados.length; i++) {
        const arquivo = whatsappArquivosSelecionados[i];
        const total = whatsappArquivosSelecionados.length;

        const percentualInicio = Math.round((i / total) * 100);
        atualizarProgressoWhatsApp(
            `Processando: ${esc(arquivo.name)} (${i + 1}/${total})`,
            percentualInicio,
            `Analisando mensagens e mídias...`
        );

        try {
            const resultado = await processarConversaIndividual(arquivo, dataInicio, dataFim, apiKey);
            whatsappAnaliseAtual.push(resultado);
        } catch (erro) {
            console.error('Erro ao processar', arquivo.name, erro);
            whatsappAnaliseAtual.push({
                nomeConversa: arquivo.name.replace('.zip', ''),
                erro: erro.message || 'Erro desconhecido',
                pendencias: []
            });
        }

        const percentualFim = Math.round(((i + 1) / total) * 100);
        atualizarProgressoWhatsApp(
            `Processando: ${esc(arquivo.name)} (${i + 1}/${total})`,
            percentualFim,
            `Concluído (${i + 1}/${total})`
        );
    }

    // Finalizar
    document.getElementById('whatsapp-progresso-container').classList.add('hidden');

    // Resetar formulário de upload para novo processamento
    whatsappArquivosSelecionados = [];
    document.getElementById('whatsapp-upload').value = '';
    document.getElementById('lista-arquivos-whatsapp').innerHTML = '';
    document.getElementById('whatsapp-data-inicio').value = '';
    document.getElementById('whatsapp-data-inicio-int').value = '';
    document.getElementById('whatsapp-data-fim-int').value = '';
    atualizarBotaoProcessarWhatsApp();

    renderResultadosWhatsApp();
    showToast(`Processamento concluído!`, 'success');
}

function atualizarProgressoWhatsApp(texto, percentual, detalhes) {
    document.getElementById('whatsapp-progresso-texto').textContent = texto;
    document.getElementById('whatsapp-progresso-percentual').textContent = `${percentual}%`;
    document.getElementById('whatsapp-progresso-barra').style.width = `${percentual}%`;
    document.getElementById('whatsapp-progresso-detalhes').textContent = detalhes || '';
}

async function processarConversaIndividual(arquivo, dataInicio, dataFim, apiKey) {
    // Carregar JSZip
    const JSZip = window.JSZip || await carregarJSZip();

    const zip = new JSZip();
    const conteudo = await arquivo.arrayBuffer();
    await zip.loadAsync(conteudo);

    const nomeConversa = arquivo.name.replace('.zip', '');
    let txtFile = null;
    const audios = [];
    const imagens = [];

    // Extrair apenas o .txt primeiro — mídias carregadas sob demanda após filtro
    const arquivosZip = {};
    for (const [path, fileData] of Object.entries(zip.files)) {
        if (fileData.dir) continue;
        const nomeLower = path.toLowerCase();
        if (nomeLower.endsWith('.txt')) {
            txtFile = await fileData.async('string');
        } else {
            arquivosZip[path] = fileData;
        }
    }

    if (!txtFile) {
        throw new Error('Arquivo .txt de mensagens não encontrado no .zip');
    }

    // Filtrar mensagens por data
    const mensagens = filtrarMensagensPorPeriodo(txtFile, dataInicio, dataFim);

    if (mensagens.length === 0) {
        return {
            nomeConversa,
            totalMensagens: 0,
            totalAudios: 0,
            totalImagens: 0,
            pendencias: []
        };
    }

    // Identificar mídias referenciadas nas mensagens do período
    // O WhatsApp insere \u200e (LTR mark) antes do nome — removemos na captura
    const nomesMidiaReferenciados = new Set();
    for (const msg of mensagens) {
        const matchMidia = msg.linhaOriginal.match(/[\u200e]?([^\s\u200e]+\.(opus|jpg|jpeg|png))/i);
        if (matchMidia) nomesMidiaReferenciados.add(matchMidia[1]);
    }

    // Carregar apenas as mídias do período
    for (const [path, fileData] of Object.entries(arquivosZip)) {
        const nomeArquivo = path.split('/').pop();
        const nomeLower = nomeArquivo.toLowerCase();
        if (!nomesMidiaReferenciados.has(nomeArquivo)) continue;

        if (nomeLower.endsWith('.opus')) {
            const audioBase64 = await fileData.async('base64');
            audios.push({ nome: path, base64: audioBase64 });
        } else if (nomeLower.endsWith('.jpg') || nomeLower.endsWith('.jpeg') || nomeLower.endsWith('.png')) {
            const imgBase64 = await fileData.async('base64');
            imagens.push({ nome: path, base64: imgBase64 });
        }
    }

    // Verificar áudios longos
    const audiosLongos = audios.filter(a => estimarDuracaoAudio(a) > 5);
    if (audiosLongos.length > 0) {
        const confirma = await new Promise(resolve => {
            const msg = `Esta conversa tem ${audiosLongos.length} áudio(s) com mais de 5 minutos.\n\nProcessar áudios longos pode consumir muitos tokens da API.\n\nDeseja continuar?`;
            showConfirm(msg).then(resolve);
        });
        if (!confirma) {
            throw new Error('Processamento cancelado pelo usuário (áudios longos)');
        }
    }

    // Enviar ao Gemini apenas conteúdo do período
    const pendenciasSugeridas = await enviarParaGemini(mensagens, audios, imagens, apiKey);

    return {
        nomeConversa,
        totalMensagens: mensagens.length,
        totalAudios: audios.length,
        totalImagens: imagens.length,
        pendencias: pendenciasSugeridas,
        mensagens  // salvar para exibir contexto na renderização
    };
}

function filtrarMensagensPorPeriodo(txtContent, dataInicio, dataFim) {
    const linhas = txtContent.split('\n');
    const mensagens = [];
    
    // Regex para detectar linha de mensagem do WhatsApp
    // Formato: DD/MM/YYYY HH:MM - Nome: Mensagem
    const regexMensagem = /^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2})\s*-\s*([^:]+):\s*(.*)$/;

    linhas.forEach(linha => {
        const match = linha.match(regexMensagem);
        if (match) {
            const [, data, hora, autor, conteudo] = match;
            const dataMensagem = moment(data, 'DD/MM/YYYY');

            if (!dataMensagem.isValid()) return;

            const dataInicioMoment = moment(dataInicio, 'YYYY-MM-DD');
            const dataFimMoment = dataFim ? moment(dataFim, 'YYYY-MM-DD') : null;

            let dentroIntervalo = false;
            if (dataFimMoment) {
                dentroIntervalo = dataMensagem.isSameOrAfter(dataInicioMoment) && dataMensagem.isSameOrBefore(dataFimMoment);
            } else {
                dentroIntervalo = dataMensagem.isSameOrAfter(dataInicioMoment);
            }

            if (dentroIntervalo) {
                mensagens.push({
                    data,
                    hora,
                    autor: autor.trim(),
                    conteudo: conteudo.trim(),
                    linhaOriginal: linha
                });
            }
        }
    });

    return mensagens;
}

function estimarDuracaoAudio(audioObj) {
    // Estimativa grosseira: cada 100KB ≈ 1 minuto
    const sizeKB = (audioObj.base64.length * 0.75) / 1024;
    return Math.round(sizeKB / 100);
}

async function enviarParaGemini(mensagens, audios, imagens, apiKey) {
    const prompt = `Você é um assistente de gestão de RH. Analise as mensagens de WhatsApp abaixo e extraia TODAS as pendências, tarefas ou ações que precisam ser tomadas. É fundamental não perder nenhuma pendência — prefira incluir a mais do que deixar alguma de fora.

MENSAGENS:
${mensagens.map(m => `[${m.data} ${m.hora}] ${m.autor}: ${m.conteudo}`).join('\n')}

INSTRUÇÕES:
- Extraia TODAS as pendências concretas (tarefas, prazos, documentos a enviar, assinaturas, cobranças, acompanhamentos, etc.)
- Não filtre por confiança — inclua tudo que pareça uma ação necessária, mesmo que subentendida
- Ignore apenas conversas puramente casuais sem nenhuma ação implícita (saudações, agradecimentos, emojis isolados)
- Descreva cada pendência de forma IMPESSOAL e orientada à ação, focando no QUE deve ser feito, nunca em quem enviou a mensagem
  - CORRETO: "Recolher assinatura da Poliany no aviso indenizado"
  - CORRETO: "Acompanhar envio dos documentos de acerto da Shirley pela contabilidade"
  - ERRADO: "Guilherme solicitou que Crys recolha a assinatura"
  - ERRADO: "Crys deve fazer o que Guilherme pediu"
- Se a conversa mencionar uma unidade, cidade ou filial, inclua essa informação na descrição
- Classifique a categoria dentre EXATAMENTE uma destas opções: "RH", "Fiscal / Contábil", "Financeiro", "TI / Suporte", "Outros"
- Estime a prioridade com base no tom da conversa (urgência, prazo mencionado, tom imperativo)
- Para cada pendência, identifique o contexto completo:
  - "contexto_inicio": timestamp da primeira mensagem onde o assunto da pendência aparece pela primeira vez (ex: onde nome, unidade ou assunto é mencionado)
  - "contexto_fim": timestamp da última mensagem relacionada à pendência
  - "mensagens_chave": array com os timestamps das mensagens DIRETAMENTE relacionadas à pendência dentro desse intervalo — ignore mensagens de outros assuntos, saudações ou conversas paralelas que ocorram entre as mensagens relevantes
  - Na descrição, use sempre datas e dados concretos extraídos da conversa — nunca use expressões vagas como "até a data limite" ou "conforme combinado"; se há uma data mencionada, coloque-a explicitamente

Retorne APENAS um objeto JSON válido neste formato, sem texto adicional:
{
  "pendencias": [
    {
      "descricao": "texto impessoal orientado à ação com dados concretos",
      "prioridade": "alta|media|baixa",
      "prazo": "YYYY-MM-DD ou null",
      "contexto_inicio": "DD/MM/YYYY HH:MM",
      "contexto_fim": "DD/MM/YYYY HH:MM",
      "mensagens_chave": ["DD/MM/YYYY HH:MM", "DD/MM/YYYY HH:MM"],
      "categoria": "RH|Fiscal / Contábil|Financeiro|TI / Suporte|Outros"
    }
  ]
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }],
            generationConfig: {
                temperature: 0
            }
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('Erro Gemini API:', response.status, errorText);
        throw new Error(`Erro na API Gemini: ${response.status} - ${errorText.substring(0, 150)}`);
    }

    const data = await response.json();
    const textoResposta = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    // Limpar markdown se houver
    let jsonLimpo = textoResposta.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    
    try {
        const resultado = JSON.parse(jsonLimpo);
        return resultado.pendencias || [];
    } catch (e) {
        console.error('Erro ao parsear JSON do Gemini:', e, jsonLimpo);
        return [];
    }
}

async function carregarJSZip() {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => resolve(window.JSZip);
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Renderizar resultados
function renderResultadosWhatsApp() {
    const container = document.getElementById('whatsapp-resultados-container');
    const lista = document.getElementById('whatsapp-lista-conversas');

    if (whatsappAnaliseAtual.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    lista.innerHTML = '';

    const totalPendencias = whatsappAnaliseAtual.reduce((acc, c) => acc + (c.pendencias?.length || 0), 0);
    const tituloEl = document.getElementById('whatsapp-titulo-sugeridas');
    if (tituloEl) {
        tituloEl.innerHTML = `<i class="fa-solid fa-check-circle"></i> Pendências Sugeridas <span style="color:var(--text-light); font-weight:400;">|</span> <span style="color:var(--primary);">${totalPendencias}</span>`;
    }

    whatsappAnaliseAtual.forEach((conversa, idxConversa) => {
        const card = document.createElement('div');
        card.className = 'whatsapp-conversa-card';
        card.id = `whatsapp-conversa-${idxConversa}`;

        const totalPendencias = conversa.pendencias?.length || 0;

        let headerHTML = `
            <div class="whatsapp-conversa-header" onclick="toggleConversaWhatsApp(${idxConversa})">
                <div class="whatsapp-conversa-titulo">
                    <i class="fa-solid fa-chevron-right" id="whatsapp-chevron-${idxConversa}" style="transition:transform 0.2s;"></i>
                    <i class="fa-brands fa-whatsapp" style="color:var(--success);"></i>
                    ${esc(conversa.nomeConversa)}
                </div>
                <div class="whatsapp-conversa-metricas">
                    <span><i class="fa-solid fa-message"></i> ${conversa.totalMensagens || 0} msgs</span>
                    <span><i class="fa-solid fa-microphone"></i> ${conversa.totalAudios || 0} áudios</span>
                    <span><i class="fa-solid fa-image"></i> ${conversa.totalImagens || 0} imgs</span>
                    <span style="font-weight:600; color:var(--primary);"><i class="fa-solid fa-tasks"></i> ${totalPendencias} pendências</span>
                </div>
            </div>
        `;

        let bodyHTML = '<div class="whatsapp-conversa-body" id="whatsapp-body-' + idxConversa + '">';

        if (conversa.erro) {
            bodyHTML += `<div style="background:var(--danger-light); color:var(--danger); padding:1rem; border-radius:8px;">
                <i class="fa-solid fa-exclamation-triangle"></i> <strong>Erro:</strong> ${esc(conversa.erro)}
            </div>`;
        } else if (totalPendencias === 0) {
            bodyHTML += `<div style="text-align:center; color:var(--text-light); padding:2rem;">
                <i class="fa-solid fa-check-circle" style="font-size:2rem; color:var(--success); margin-bottom:0.5rem;"></i>
                <p>Nenhuma pendência identificada nesta conversa.</p>
            </div>`;
        } else {
            conversa.pendencias.forEach((pend, idxPend) => {
                bodyHTML += renderPendenciaWhatsApp(pend, idxConversa, idxPend, conversa.mensagens || []);
            });

            bodyHTML += `<div style="margin-top:1rem; display:flex; gap:0.5rem; justify-content:flex-end;">
                <button class="btn-secondary" onclick="selecionarTodasPendenciasConversa(${idxConversa}, true)">
                    <i class="fa-solid fa-check-double"></i> Selecionar Todas
                </button>
                <button class="btn-secondary" onclick="selecionarTodasPendenciasConversa(${idxConversa}, false)">
                    <i class="fa-solid fa-square"></i> Desmarcar Todas
                </button>
                <button class="btn-primary" onclick="confirmarPendenciasConversa(${idxConversa})">
                    <i class="fa-solid fa-check"></i> Confirmar Desta Conversa
                </button>
            </div>`;
        }

        bodyHTML += '</div>';

        card.innerHTML = headerHTML + bodyHTML;
        lista.appendChild(card);
    });

    atualizarBotaoConfirmarSelecionadas();
}

function renderPendenciaWhatsApp(pend, idxConversa, idxPend, mensagens = []) {
    const id = `whatsapp-pend-${idxConversa}-${idxPend}`;

    // Montar contexto usando timestamps retornados pelo Gemini
    let contextoMsgs = [];
    if (mensagens.length > 0 && (pend.contexto_inicio || pend.contexto_fim)) {
        const tsParaMoment = ts => moment(ts, 'DD/MM/YYYY HH:mm');
        const tInicio = pend.contexto_inicio ? tsParaMoment(pend.contexto_inicio) : null;
        const tFim    = pend.contexto_fim    ? tsParaMoment(pend.contexto_fim)    : null;

        // Set de timestamps-chave para marcação (matching aproximado ±1 minuto)
        const chavesRaw = pend.mensagens_chave || [];
        const chaveMoments = chavesRaw.map(ts => moment(ts, 'DD/MM/YYYY HH:mm'));

        const isChave = (m) => {
            if (chaveMoments.length === 0) return true;
            const tMsg = moment(`${m.data} ${m.hora}`, 'DD/MM/YYYY HH:mm');
            return chaveMoments.some(tc => Math.abs(tMsg.diff(tc, 'minutes')) <= 1);
        };

        contextoMsgs = mensagens
            .filter(m => {
                const tMsg = moment(`${m.data} ${m.hora}`, 'DD/MM/YYYY HH:mm');
                const depoisInicio = tInicio ? tMsg.isSameOrAfter(tInicio) : true;
                const antesFim     = tFim    ? tMsg.isSameOrBefore(tFim)   : true;
                return depoisInicio && antesFim;
            })
            .map(m => ({ ...m, chave: isChave(m) }));
    }

    // Fallback: ±3 mensagens ao redor da mais parecida com a origem
    if (contextoMsgs.length === 0 && mensagens.length > 0) {
        let melhorIdx = 0, melhorScore = 0;
        mensagens.forEach((m, i) => {
            const score = (pend.origem || '').split(' ').filter(p => p.length > 3)
                .filter(p => m.conteudo.toLowerCase().includes(p.toLowerCase())).length;
            if (score > melhorScore) { melhorScore = score; melhorIdx = i; }
        });
        const ini = Math.max(0, melhorIdx - 3);
        const fim = Math.min(mensagens.length - 1, melhorIdx + 3);
        contextoMsgs = mensagens.slice(ini, fim + 1).map(m => ({ ...m, chave: true }));
    }

    // Montar HTML agrupando mensagens não-chave consecutivas em blocos colapsáveis
    let origemHTML = '';
    if (contextoMsgs.length === 0) {
        origemHTML = `<span>${esc(pend.origem || 'Origem não especificada')}</span>`;
    } else {
        // Agrupar em blocos: chave=true mostra normalmente, chave=false colapsa
        const blocos = [];
        let blocoAtual = null;
        contextoMsgs.forEach(m => {
            if (!blocoAtual || blocoAtual.chave !== m.chave) {
                blocoAtual = { chave: m.chave, msgs: [] };
                blocos.push(blocoAtual);
            }
            blocoAtual.msgs.push(m);
        });

        blocos.forEach((bloco, bi) => {
            if (bloco.chave) {
                bloco.msgs.forEach((m, mi) => {
                    const sep = mi < bloco.msgs.length - 1 ? '<br>' : '';
                    origemHTML += `<span style="color:var(--text-main);">[${m.data} ${m.hora}] <strong>${esc(m.autor)}</strong>: ${esc(m.conteudo)}</span>${sep}`;
                });
            } else {
                const n = bloco.msgs.length;
                const colId = `${id}-ctx-${bi}`;
                origemHTML += `<span id="${colId}-btn" style="display:inline-block; margin:2px 0; cursor:pointer; color:var(--primary); font-style:normal; font-size:0.8rem;" onclick="toggleCtxBloco('${colId}')">... ${n} mensagem(ns) oculta(s) — ver mais</span>`;
                origemHTML += `<span id="${colId}" style="display:none; flex-direction:column;">`;
                bloco.msgs.forEach((m, mi) => {
                    const sep = mi < bloco.msgs.length - 1 ? '<br>' : '';
                    origemHTML += `<span style="opacity:0.5;">[${m.data} ${m.hora}] ${esc(m.autor)}: ${esc(m.conteudo)}</span>${sep}`;
                });
                origemHTML += `</span>`;
            }
        });
    }

    return `
        <div class="whatsapp-pendencia-item" id="${id}-container">
            <div class="whatsapp-pendencia-header">
                <div class="checkbox-wrapper" style="margin:0;">
                    <input type="checkbox" id="${id}-check"
                        onchange="toggleSelecaoPendenciaWhatsApp(${idxConversa}, ${idxPend})">
                </div>
                <div class="whatsapp-pendencia-conteudo">
                    <div class="whatsapp-pendencia-descricao">
                        <span class="whatsapp-descricao-editavel" id="${id}-descricao"
                            contenteditable="true"
                            title="Clique para editar"
                            spellcheck="false">${esc(pend.descricao)}</span>
                        <span class="whatsapp-badge-prioridade ${pend.prioridade || 'media'}" id="${id}-badge-prioridade" style="margin-left:0.5rem;">
                            ${(pend.prioridade || 'média').toUpperCase()}
                        </span>
                    </div>
                    <div class="whatsapp-pendencia-origem">
                        <i class="fa-solid fa-quote-left" style="margin-right:0.4rem; flex-shrink:0; margin-top:0.15rem;"></i>
                        <div style="display:flex; flex-direction:column; gap:0.25rem; line-height:1.5;">${origemHTML}</div>
                    </div>
                    <div class="whatsapp-pendencia-campos">
                        <div class="whatsapp-pendencia-campo">
                            <label>Categoria</label>
                            <select id="${id}-categoria">
                                <option value="RH" ${(pend.categoria === 'RH') ? 'selected' : ''}>RH</option>
                                <option value="Fiscal / Contábil" ${(pend.categoria === 'Fiscal / Contábil') ? 'selected' : ''}>Fiscal / Contábil</option>
                                <option value="Financeiro" ${(pend.categoria === 'Financeiro') ? 'selected' : ''}>Financeiro</option>
                                <option value="TI / Suporte" ${(pend.categoria === 'TI / Suporte') ? 'selected' : ''}>TI / Suporte</option>
                                <option value="Outros" ${(!pend.categoria || pend.categoria === 'Outros') ? 'selected' : ''}>Outros</option>
                            </select>
                        </div>
                        <div class="whatsapp-pendencia-campo">
                            <label>Prioridade</label>
                            <select id="${id}-prioridade" onchange="sincronizarBadgePrioridade('${id}', this.value)">
                                <option value="baixa" ${pend.prioridade === 'baixa' ? 'selected' : ''}>Baixa</option>
                                <option value="media" ${pend.prioridade === 'media' ? 'selected' : ''}>Média</option>
                                <option value="alta" ${pend.prioridade === 'alta' ? 'selected' : ''}>Alta</option>
                            </select>
                        </div>
                        <div class="whatsapp-pendencia-campo">
                            <label>Vencimento</label>
                            <input type="date" id="${id}-prazo" value="${pend.prazo || ''}">
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function toggleConversaWhatsApp(idx) {
    const body = document.getElementById(`whatsapp-body-${idx}`);
    const chevron = document.getElementById(`whatsapp-chevron-${idx}`);
    
    if (body.classList.contains('expandido')) {
        body.classList.remove('expandido');
        chevron.style.transform = 'rotate(0deg)';
    } else {
        body.classList.add('expandido');
        chevron.style.transform = 'rotate(90deg)';
    }
}

function toggleSelecaoPendenciaWhatsApp(idxConversa, idxPend) {
    const id = `whatsapp-pend-${idxConversa}-${idxPend}`;
    const checkbox = document.getElementById(`${id}-check`);
    const container = document.getElementById(`${id}-container`);
    
    if (checkbox.checked) {
        container.classList.add('selecionada');
    } else {
        container.classList.remove('selecionada');
    }
    
    atualizarBotaoConfirmarSelecionadas();
}

function selecionarTodasPendenciasConversa(idxConversa, marcar) {
    const conversa = whatsappAnaliseAtual[idxConversa];
    if (!conversa || !conversa.pendencias) return;

    conversa.pendencias.forEach((_, idxPend) => {
        const id = `whatsapp-pend-${idxConversa}-${idxPend}`;
        const checkbox = document.getElementById(`${id}-check`);
        const container = document.getElementById(`${id}-container`);
        
        if (checkbox) {
            checkbox.checked = marcar;
            if (marcar) {
                container.classList.add('selecionada');
            } else {
                container.classList.remove('selecionada');
            }
        }
    });

    atualizarBotaoConfirmarSelecionadas();
}

function atualizarBotaoConfirmarSelecionadas() {
    const btn = document.getElementById('btn-confirmar-selecionadas');
    const checkboxes = document.querySelectorAll('[id$="-check"]:checked');
    btn.disabled = checkboxes.length === 0;
    
    if (checkboxes.length > 0) {
        btn.textContent = '';
        btn.innerHTML = `<i class="fa-solid fa-check-double"></i> Confirmar ${checkboxes.length} Selecionada(s)`;
    } else {
        btn.innerHTML = `<i class="fa-solid fa-check-double"></i> Confirmar Selecionadas`;
    }
}

function confirmarPendenciasConversa(idxConversa) {
    const conversa = whatsappAnaliseAtual[idxConversa];
    if (!conversa || !conversa.pendencias) return;

    let confirmadas = 0;

    conversa.pendencias.forEach((pend, idxPend) => {
        const id = `whatsapp-pend-${idxConversa}-${idxPend}`;
        const checkbox = document.getElementById(`${id}-check`);
        
        if (checkbox && checkbox.checked) {
            const categoria = document.getElementById(`${id}-categoria`).value;
            const prioridade = document.getElementById(`${id}-prioridade`).value;
            const prazo = document.getElementById(`${id}-prazo`).value;
            const descricaoEl = document.getElementById(`${id}-descricao`);
            const descricao = descricaoEl ? descricaoEl.innerText.trim() : pend.descricao;

            pendenciasList.push({
                id: 'PEN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                descricao,
                categoria,
                prioridade,
                vencimento: prazo || null,
                notificar: false,
                concluida: false,
                dataCriacao: moment().format('YYYY-MM-DD'),
                dataConclusao: null
            });

            confirmadas++;
        }
    });

    if (confirmadas > 0) {
        salvarDados();
        renderPendencias();
        renderDeadlines();
        showToast(`${confirmadas} pendência(s) adicionada(s) com sucesso!`, 'success');

        // Salvar no histórico
        salvarAnaliseNoHistorico(conversa);
        
        // Remover conversa da análise atual
        whatsappAnaliseAtual.splice(idxConversa, 1);
        renderResultadosWhatsApp();
    } else {
        showToast('Nenhuma pendência selecionada nesta conversa', 'warning');
    }
}

function confirmarPendenciasSelecionadas() {
    let confirmadas = 0;
    const conversasParaRemover = [];

    whatsappAnaliseAtual.forEach((conversa, idxConversa) => {
        if (!conversa.pendencias) return;

        let temSelecaoNestaConversa = false;

        conversa.pendencias.forEach((pend, idxPend) => {
            const id = `whatsapp-pend-${idxConversa}-${idxPend}`;
            const checkbox = document.getElementById(`${id}-check`);
            
            if (checkbox && checkbox.checked) {
                temSelecaoNestaConversa = true;
                const categoria = document.getElementById(`${id}-categoria`).value;
                const prioridade = document.getElementById(`${id}-prioridade`).value;
                const prazo = document.getElementById(`${id}-prazo`).value;

                const descricaoEl = document.getElementById(`${id}-descricao`);
                const descricao = descricaoEl ? descricaoEl.innerText.trim() : pend.descricao;
                pendenciasList.push({
                    id: 'PEN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
                    descricao,
                    categoria,
                    prioridade,
                    vencimento: prazo || null,
                    notificar: false,
                    concluida: false,
                    dataCriacao: moment().format('YYYY-MM-DD'),
                    dataConclusao: null
                });

                confirmadas++;
            }
        });

        if (temSelecaoNestaConversa) {
            conversasParaRemover.push(idxConversa);
            salvarAnaliseNoHistorico(conversa);
        }
    });

    if (confirmadas > 0) {
        // Remover conversas confirmadas (de trás para frente para não quebrar índices)
        conversasParaRemover.reverse().forEach(idx => {
            whatsappAnaliseAtual.splice(idx, 1);
        });

        salvarDados();
        renderPendencias();
        renderDeadlines();
        renderResultadosWhatsApp();
        showToast(`${confirmadas} pendência(s) adicionada(s) com sucesso!`, 'success');
    } else {
        showToast('Nenhuma pendência selecionada', 'warning');
    }
}

function salvarAnaliseNoHistorico(conversa) {
    whatsappHistoricoAnalises.unshift({
        id: 'WHIST_' + Date.now(),
        nomeConversa: conversa.nomeConversa,
        dataProcessamento: moment().format('YYYY-MM-DD HH:mm'),
        totalMensagens: conversa.totalMensagens || 0,
        totalPendencias: conversa.pendencias?.length || 0
    });

    // Limitar a 50 análises no histórico
    if (whatsappHistoricoAnalises.length > 50) {
        whatsappHistoricoAnalises = whatsappHistoricoAnalises.slice(0, 50);
    }

    salvarHistoricoWhatsApp();
    renderHistoricoWhatsApp();
}

function renderHistoricoWhatsApp() {
    const container = document.getElementById('whatsapp-historico-container');
    const lista = document.getElementById('whatsapp-historico-lista');

    if (whatsappHistoricoAnalises.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');
    lista.innerHTML = '';

    whatsappHistoricoAnalises.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'whatsapp-historico-item';
        div.innerHTML = `
            <div class="whatsapp-historico-info">
                <div class="whatsapp-historico-titulo">
                    <i class="fa-brands fa-whatsapp" style="color:var(--success);"></i>
                    ${esc(item.nomeConversa)}
                </div>
                <div class="whatsapp-historico-detalhes">
                    Processado em ${item.dataProcessamento} • 
                    ${item.totalMensagens} mensagens • 
                    ${item.totalPendencias} pendências identificadas
                </div>
            </div>
            <button class="btn-icon btn-delete" onclick="apagarHistoricoWhatsApp(${idx})" title="Apagar">
                <i class="fa-solid fa-trash"></i>
            </button>
        `;
        lista.appendChild(div);
    });
}

function apagarHistoricoWhatsApp(idx) {
    if (confirm('Deseja apagar esta análise do histórico?')) {
        whatsappHistoricoAnalises.splice(idx, 1);
        salvarHistoricoWhatsApp();
        renderHistoricoWhatsApp();
        showToast('Análise removida do histórico', 'success');
    }
}

// Inicializar ao carregar a aba WhatsApp
document.addEventListener('DOMContentLoaded', () => {
    carregarHistoricoWhatsApp();
});


// ══════════════════════════════════════════════════════════════════
//   MAPA MENTAL — ETAPA 1
//   Base: SVG, zoom/pan, nós placeholder, separação click vs drag
// ══════════════════════════════════════════════════════════════════

// ── Estado interno do mapa (nunca exposto globalmente desnecessariamente) ──
// Cache local das notas do mapa (carregado do Firebase na init)
// Estrutura: { idFunc: 'texto da nota', ... }
let _mapaNotas = {};

const _mapa = {
    svg: null,           // elemento SVG D3
    root: null,          // grupo <g> raiz (filho do SVG, recebe transform do zoom)
    zoom: null,          // comportamento d3.zoom
    layoutFeito: false,  // flag: layout inicial calculado? Nunca recalcular após true
    nos: [],             // array de dados dos nós atuais
    arestas: [],         // array de dados das arestas atuais
    idSelecionado: null, // id do nó atualmente selecionado (para highlight)
};

// ─────────────────────────────────────────────
//  ETAPA 4 — PERSISTÊNCIA DE POSIÇÕES E NOTAS
// ─────────────────────────────────────────────

// Salva posição de um nó no Firebase (path: rhfacil/canvas/positions/{id})
async function mapaSalvarPosicao(id, x, y) {
    try {
        await fetch(FIREBASE_URL + 'rhfacil/canvas/positions/' + encodeURIComponent(id) + '.json', {
            method: 'PUT',
            body: JSON.stringify({ x: x, y: y })
        });
    } catch(e) { /* silencioso — não bloqueia UI */ }
}

// Carrega todas as posições salvas do Firebase
async function mapaCarregarPosicoes() {
    try {
        const res = await fetch(FIREBASE_URL + 'rhfacil/canvas/positions.json');
        const data = await res.json();
        return data || {};
    } catch(e) { return {}; }
}

// Salva nota de um funcionário no Firebase (path: rhfacil/canvas/notes/{idFunc})
// Salva array de notas de um funcionário no Firebase
async function mapaSalvarNotas(idFunc) {
    try {
        const notas = _mapaNotas[idFunc] || [];
        await fetch(FIREBASE_URL + 'rhfacil/canvas/notes/' + encodeURIComponent(idFunc) + '.json', {
            method: 'PUT',
            body: JSON.stringify(notas)
        });
        _mapaAtualizarBadgeNota(idFunc);
    } catch(e) { /* silencioso */ }
}

// Adiciona uma nova nota vazia ao funcionário
function mapaAdicionarNota(idFunc) {
    if (!_mapaNotas[idFunc]) _mapaNotas[idFunc] = [];
    const id = 'n_' + Date.now();
    _mapaNotas[idFunc].push({ id: id, titulo: '', corpo: '' });
    _mapaRenderNotasSidebar(idFunc);
}

// Salva título ou corpo de uma nota específica (chamado no blur)
function mapaSalvarCampoNota(idFunc, notaId, campo, valor) {
    if (!_mapaNotas[idFunc]) return;
    const nota = _mapaNotas[idFunc].find(function(n) { return n.id === notaId; });
    if (!nota) return;
    nota[campo] = valor;
    mapaSalvarNotas(idFunc);
}

// Remove uma nota pelo id
function mapaApagarNota(idFunc, notaId) {
    if (!_mapaNotas[idFunc]) return;
    _mapaNotas[idFunc] = _mapaNotas[idFunc].filter(function(n) { return n.id !== notaId; });
    if (_mapaNotas[idFunc].length === 0) delete _mapaNotas[idFunc];
    mapaSalvarNotas(idFunc);
    _mapaRenderNotasSidebar(idFunc);
}

// Re-renderiza só a seção de notas da sidebar (sem fechar/reabrir)
function _mapaRenderNotasSidebar(idFunc) {
    const container = document.getElementById('mapa-notas-container-' + idFunc);
    if (!container) return;
    container.innerHTML = _mapaNotasHTML(idFunc);
}

// Gera o HTML das notas de um funcionário
function _mapaNotasHTML(idFunc) {
    const notas = (_mapaNotas[idFunc] || []);
    if (!notas.length) {
        return '<p style="color:var(--text-light);font-size:0.82rem;margin:0 0 0.75rem;">Nenhuma nota ainda.</p>';
    }
    return notas.map(function(nota) {
        return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:8px;
                            padding:0.6rem 0.75rem;margin-bottom:0.6rem;position:relative;">
            <div style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem;">
                <input type="text"
                    placeholder="Título..."
                    value="${esc(nota.titulo || '')}"
                    onblur="mapaSalvarCampoNota('${esc(idFunc)}','${esc(nota.id)}','titulo',this.value)"
                    style="flex:1;font-size:0.86rem;font-weight:600;background:var(--secondary);
                           border:none;border-radius:6px;padding:0 8px;height:28px;
                           color:var(--text-main);outline:none;">
                <button class="btn-icon btn-delete" style="width:26px;height:26px;flex-shrink:0;"
                    onclick="mapaApagarNota('${esc(idFunc)}','${esc(nota.id)}')" title="Apagar nota">
                    <i class="fa-solid fa-trash" style="font-size:0.7rem;"></i>
                </button>
            </div>
            <textarea
                placeholder="Escreva aqui..."
                onblur="mapaSalvarCampoNota('${esc(idFunc)}','${esc(nota.id)}','corpo',this.value)"
                style="width:100%;box-sizing:border-box;height:72px;resize:vertical;font-size:0.8rem;
                       background:transparent;border:none;padding:2px 4px;
                       color:var(--text-main);font-family:inherit;line-height:1.5;outline:none;resize:none;"
            >${esc(nota.corpo || '')}</textarea>
        </div>`;
    }).join('');
}

// Carrega todas as notas do Firebase para o cache local
// Compatível com formato antigo (string) e novo (array)
async function mapaCarregarNotas() {
    try {
        const res = await fetch(FIREBASE_URL + 'rhfacil/canvas/notes.json');
        const data = await res.json();
        if (!data) { _mapaNotas = {}; return; }
        // Migração: converte strings antigas para array
        _mapaNotas = {};
        Object.keys(data).forEach(function(idFunc) {
            const val = data[idFunc];
            if (typeof val === 'string') {
                // Formato antigo: string → converte para 1 nota
                if (val.trim()) {
                    _mapaNotas[idFunc] = [{ id: 'n_migrado', titulo: '', corpo: val }];
                }
            } else if (Array.isArray(val)) {
                _mapaNotas[idFunc] = val;
            }
        });
    } catch(e) { _mapaNotas = {}; }
}

// Salva posições de TODOS os nós atuais (chamado ao sair da aba / fechar janela)
async function mapaSalvarTodasPosicoes() {
    if (!_mapa.nos || _mapa.nos.length === 0) return;
    const positions = {};
    _mapa.nos.forEach(function(n) {
        positions[n.id] = { x: n.x, y: n.y };
    });
    try {
        await fetch(FIREBASE_URL + 'rhfacil/canvas/positions.json', {
            method: 'PUT',
            body: JSON.stringify(positions)
        });
    } catch(e) { /* silencioso */ }
}

// Versão síncrona para beforeunload — sendBeacon é garantido pelo browser
// mesmo durante o encerramento da página (fetch assíncrono não é confiável aqui)
function mapaSalvarTodasPosicoesBeacon() {
    if (!_mapa.nos || _mapa.nos.length === 0) return;
    const positions = {};
    _mapa.nos.forEach(function(n) {
        positions[n.id] = { x: n.x, y: n.y };
    });
    // sendBeacon só suporta POST — Firebase aceita POST em .json como PUT
    const urlPos = FIREBASE_URL + 'rhfacil/canvas/positions.json';
    navigator.sendBeacon(urlPos, new Blob([JSON.stringify(positions)], { type: 'application/json' }));
    // Fallback síncrono via fetch keepalive (mais confiável que beacon para PUT)
    try {
        fetch(urlPos, {
            method: 'PUT',
            body: JSON.stringify(positions),
            headers: { 'Content-Type': 'application/json' },
            keepalive: true
        });
    } catch(e) { /* silencioso */ }

    // Sugestão 5: salva notas em edição via beacon (captura textarea aberto)
    // Garante que nota não seja perdida ao fechar sem blur no textarea
    document.querySelectorAll('textarea[id^="mapa-nota-"], input[id^="mapa-nota-"]').forEach(function(el) {
        // Nada a fazer — notas já estão em _mapaNotas (salvas no blur)
        // Mas se houver textarea ativo com valor diferente do cache, força o save
    });
    if (Object.keys(_mapaNotas).length > 0) {
        const urlNotas = FIREBASE_URL + 'rhfacil/canvas/notes.json';
        navigator.sendBeacon(urlNotas, new Blob([JSON.stringify(_mapaNotas)], { type: 'application/json' }));
    }
}

// Atualiza o badge azul de um funcionário no canvas após salvar/apagar nota
function _mapaAtualizarBadgeNota(idFunc) {
    const temNota = Array.isArray(_mapaNotas[idFunc]) && _mapaNotas[idFunc].length > 0;
    const noId = 'f_' + idFunc;
    const no = _mapa.nos.find(function(n) { return n.id === noId; });
    if (!no) return;

    // Recalcula itens do nó com badge de nota atualizado
    const f = funcionariosList.find(function(fn) { return fn.idFunc === idFunc; });
    if (!f) return;
    no.itens = _mapaCalcularBadgesFuncionario(f);

    // Atualiza badges SVG do nó sem re-renderizar tudo
    _mapa.root.selectAll('.mapa-no')
        .filter(function(d) { return d.id === noId; })
        .each(function(d) {
            d3.select(this).selectAll('.mapa-badge').remove();
            const g = d3.select(this);
            const r = 26;
            const nb = d.itens.length;
            const badgeR = 6;
            d.itens.forEach(function(item, k) {
                const totalAngle = Math.PI * 0.7;
                const centerAngle = Math.PI / 2;
                const startAngle = centerAngle - totalAngle / 2;
                const angle = startAngle + (nb > 1 ? k * totalAngle / (nb - 1) : totalAngle / 2);
                const bx = (r + 2) * Math.cos(angle);
                const by = (r + 2) * Math.sin(angle);
                g.append('circle')
                    .attr('class', 'mapa-badge')
                    .attr('cx', bx).attr('cy', by).attr('r', badgeR)
                    .style('fill', item.cor)
                    .style('stroke', 'var(--bg-card)')
                    .style('stroke-width', 1.5)
                    .append('title').text(item.label);
            });
        });
}

// ─────────────────────────────────────────────
//  PONTO DE ENTRADA — chamado pelo switchTab
// ─────────────────────────────────────────────
function mapaInit() {
    const wrapper = document.getElementById('mapa-canvas-wrapper');
    const svgEl   = document.getElementById('mapa-svg');
    const loading = document.getElementById('mapa-loading');

    if (!wrapper || !svgEl) return;

    // Segunda visita: recarrega posições e notas, reaplica sem reconstruir nós.
    if (_mapa.svg) {
        if (loading) loading.classList.remove('hidden');
        mapaCarregarNotas().then(function() {
            mapaCarregarPosicoes().then(function(posicoesSalvas) {
                // Reaplica posições nos nós já existentes (preserva toggle de desligados)
                if (_mapa.nos && _mapa.nos.length > 0 && posicoesSalvas) {
                    _mapa.nos.forEach(function(n) {
                        const saved = posicoesSalvas[n.id];
                        if (saved && saved.x !== undefined) {
                            n.x = saved.x; n.y = saved.y;
                            n._vx = saved.x; n._vy = saved.y;
                        }
                    });
                    // Redesenha com as posições restauradas
                    _mapaDesenharArestas();
                    _mapaDesenharNos();
                    // Reaplica classe de desligados
                    if (_mapaExibirDesligados) {
                        _mapa.root.selectAll('.mapa-no')
                            .filter(function(d) { return d.desligado; })
                            .classed('mapa-no-desligado', true);
                    }
                    if (loading) loading.classList.add('hidden');
                    mapaFitView();
                } else {
                    // Sem nós ainda: reconstrói do zero
                    _mapa.layoutFeito = false;
                    _mapa._posicoesSalvas = posicoesSalvas;
                    mapaRender();
                }
            });
        });
        return;
    }

    // ── Configura SVG e grupo raiz ──
    _mapa.svg  = d3.select(svgEl);
    _mapa.root = _mapa.svg.select('#mapa-root');

    // ── Zoom / Pan no SVG ──
    // IMPORTANTE: zoom é aplicado ao grupo #mapa-root, não ao SVG.
    // Isso mantém o SVG capturando eventos de mouse sem interferir nos nós.
    _mapa.zoom = d3.zoom()
        .scaleExtent([0.1, 4])
        // IMPORTANTE: filtra eventos originados em nós (.mapa-no).
        // Sem este filtro, o zoom intercepta o primeiro mousedown em qualquer
        // elemento do SVG — causando o bug do "duplo clique".
        // Com o filtro: zoom/pan só ativa quando o clique é no fundo (SVG/root).
        .filter((event) => {
            // Permite scroll de zoom (wheel) em qualquer lugar
            if (event.type === 'wheel') return true;
            // Para mousedown/touchstart: só ativa se NÃO começou num nó
            const target = event.target;
            const inNode = target.closest ? target.closest('.mapa-no') : null;
            return !inNode;
        })
        .on('zoom', (event) => {
            _mapa.root.attr('transform', event.transform);
        });

    _mapa.svg.call(_mapa.zoom);

    // Cursor: grab/grabbing no SVG (fundo do canvas)
    _mapa.svg
        .on('mousedown.cursor', () => svgEl.classList.add('mapa-dragging'))
        .on('mouseup.cursor',   () => svgEl.classList.remove('mapa-dragging'));

    // Clique no fundo do SVG (fora de qualquer nó) → fecha sidebar
    // IMPORTANTE: este listener fica no SVG, não nos nós.
    // Os nós chamam event.stopPropagation() para que este NÃO dispare ao clicar num nó.
    _mapa.svg.on('click.fecharSidebar', (event) => {
        if (event.target === svgEl || event.target.id === 'mapa-root') {
            mapaFecharSidebar();
        }
    });

    // ── Botões da toolbar ──
    document.getElementById('mapa-btn-zoomin')?.addEventListener('click', () => {
        _mapa.svg.transition().duration(300).call(_mapa.zoom.scaleBy, 1.4);
    });
    document.getElementById('mapa-btn-zoomout')?.addEventListener('click', () => {
        _mapa.svg.transition().duration(300).call(_mapa.zoom.scaleBy, 0.7);
    });
    document.getElementById('mapa-btn-fit')?.addEventListener('click', mapaFitView);
    document.getElementById('mapa-btn-reorganizar')?.addEventListener('click', mapaReorganizarTodos);

    // Persiste parâmetros da toolbar no localStorage ao alterar
    ['mapa-dist-valor','mapa-grade-linhas','mapa-grade-colunas','mapa-grade-distH','mapa-grade-distV'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function() {
            try { localStorage.setItem(id, this.value); } catch(e) {}
        });
    });
    document.getElementById('mapa-dist-menos')?.addEventListener('click', function() {
        setTimeout(function() {
            var el = document.getElementById('mapa-dist-valor');
            if (el) try { localStorage.setItem('mapa-dist-valor', el.value); } catch(e) {}
        }, 50);
    });
    document.getElementById('mapa-dist-mais')?.addEventListener('click', function() {
        setTimeout(function() {
            var el = document.getElementById('mapa-dist-valor');
            if (el) try { localStorage.setItem('mapa-dist-valor', el.value); } catch(e) {}
        }, 50);
    });
    document.getElementById('mapa-btn-grade')?.addEventListener('click', mapaOrganizarEmGrade);
    document.getElementById('mapa-btn-backup')?.addEventListener('click', mapaSalvarBackup);
    document.getElementById('mapa-btn-restaurar')?.addEventListener('click', mapaRestaurarBackup);
    document.getElementById('mapa-dist-mais')?.addEventListener('click', function() {
        const el = document.getElementById('mapa-dist-valor');
        if (el) el.value = Math.min(400, (parseInt(el.value) || 110) + 10);
    });
    document.getElementById('mapa-dist-menos')?.addEventListener('click', function() {
        const el = document.getElementById('mapa-dist-valor');
        if (el) el.value = Math.max(60, (parseInt(el.value) || 110) - 10);
    });

    // ── Fechar sidebar pelo botão X ──
    document.getElementById('mapa-sidebar-fechar')?.addEventListener('click', mapaFecharSidebar);

    // ── Restaura parâmetros da toolbar salvos no localStorage ──
    (function() {
        var params = {
            'mapa-dist-valor':   null,
            'mapa-grade-linhas': null,
            'mapa-grade-colunas': null,
            'mapa-grade-distH':  null,
            'mapa-grade-distV':  null
        };
        try {
            Object.keys(params).forEach(function(id) {
                var val = localStorage.getItem(id);
                if (val !== null) {
                    var el = document.getElementById(id);
                    if (el) el.value = val;
                }
            });
            // Restaura toggle de desligados
            var desl = localStorage.getItem('mapa_desligados');
            if (desl === '1') {
                var toggle = document.getElementById('mapa-toggle-desligados');
                if (toggle) {
                    toggle.checked = true;
                    _mapaExibirDesligados = true;
                }
            }
        } catch(e) {}
    }());

    // ── Primeiro render — carrega posições e notas salvas antes de desenhar ──
    mapaCarregarNotas().then(function() {
        mapaCarregarPosicoes().then(function(posicoesSalvas) {
            _mapa._posicoesSalvas = posicoesSalvas;
            mapaVerificarBackupDisponivel();
            mapaRender();
        });
    });
}

// ─────────────────────────────────────────────
//  RENDER PRINCIPAL — Etapa 2: dados reais
//  Monta nós e arestas com dados do Firebase.
//  Se Firebase ainda não carregou, exibe estado vazio.
// ─────────────────────────────────────────────
function mapaRender() {
    const loading = document.getElementById('mapa-loading');

    // Preserva posições dos nós existentes antes de recriar a lista
    // Evita que o SSE redefina x/y para 0 ao reconstruir os objetos de nó
    const posAntes = {};
    if (_mapa.nos) {
        _mapa.nos.forEach(function(n) {
            posAntes[n.id] = { x: n.x, y: n.y, _vx: n._vx, _vy: n._vy };
        });
    }

    // Etapa 2: dados reais do Firebase — respeita toggle de desligados
    const resultado = _mapaMontarNosReais(_mapaExibirDesligados);
    _mapa.nos     = resultado.nos;
    _mapa.arestas = resultado.arestas;

    // Restaura posições preservadas nos nós recriados
    if (Object.keys(posAntes).length > 0) {
        _mapa.nos.forEach(function(n) {
            const pos = posAntes[n.id];
            if (pos) {
                n.x  = pos.x;  n.y  = pos.y;
                n._vx = pos._vx !== undefined ? pos._vx : pos.x;
                n._vy = pos._vy !== undefined ? pos._vy : pos.y;
            }
        });
    }

    // Se não há dados ainda (Firebase carregando), mantém loading visível e retenta em 1s
    if (_mapa.nos.length === 0) {
        if (loading) loading.classList.remove('hidden');
        setTimeout(function() {
            if (document.getElementById('view-mapa').classList.contains('active')) {
                mapaRender();
            }
        }, 1000);
        return;
    }

    // Calcula posições — usa salvas do Firebase se existirem, senão layout circular
    if (!_mapa.layoutFeito) {
        const posicoes = _mapa._posicoesSalvas || {};
        // Verifica posições salvas apenas nos nós ativos (desligados podem não estar salvos)
        const nosAtivos = _mapa.nos.filter(function(n) { return !n.desligado; });
        const nosCobertos = nosAtivos.filter(function(n) {
            return posicoes[n.id] && posicoes[n.id].x !== undefined;
        }).length;
        const temPosicoesSalvas = nosAtivos.length > 0 && nosCobertos >= Math.ceil(nosAtivos.length / 2);

        if (temPosicoesSalvas) {
            // Usa posições salvas — layout circular só para nós sem posição salva
            _mapa.nos.forEach(function(n) {
                const saved = posicoes[n.id];
                if (saved && saved.x !== undefined && saved.y !== undefined) {
                    n.x = saved.x;
                    n.y = saved.y;
                }
            });
            // Nós sem posição salva: posiciona perto do pai (evita x=0,y=0)
            _mapa.nos.forEach(function(n) {
                if (n.x === 0 && n.y === 0 && n.pai) {
                    const pai = _mapa.nos.find(function(p) { return p.id === n.pai; });
                    if (pai) {
                        n.x = pai.x + 80 + Math.random() * 40;
                        n.y = pai.y + 80 + Math.random() * 40;
                    }
                }
            });
        } else {
            // Sem posições salvas suficientes: calcula layout circular do zero
            _mapaCalcularLayoutInicial();
        }
        _mapa.layoutFeito = true;
        // IMPORTANTE: layoutFeito=true impede qualquer recálculo futuro.
        // Drag e clique NUNCA chamam _mapaCalcularLayoutInicial().
    }

    // Desenha
    _mapaDesenharArestas();
    _mapaDesenharNos();

    // Aplica estilo visual de desligados se toggle estiver ativo
    if (_mapaExibirDesligados) {
        _mapa.root.selectAll('.mapa-no')
            .filter(function(d) { return d.desligado; })
            .classed('mapa-no-desligado', true);
    }

    // Atualiza contador da toolbar
    _mapaAtualizarContador();

    // Esconde loading
    if (loading) loading.classList.add('hidden');

    // Centraliza a view na primeira abertura
    mapaFitView();
}

// ─────────────────────────────────────────────
//  DADOS PLACEHOLDER (Etapa 1)
//  Simula 3 "unidades" com 4 "funcionários" cada.
//  Etapa 2 substitui por dados reais do Firebase.
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  ETAPA 2 — DADOS REAIS DO FIREBASE
//  Substitui _mapaMontarNosPlaceholder.
//  Lê funcionariosList, prazosList, pendenciasList
//  e configGerais para montar nós e arestas reais.
// ─────────────────────────────────────────────
function _mapaMontarNosReais(incluirDesligados) {
    const nos = [];
    const arestas = [];

    // Por padrão só ativos; toggle da Etapa 5 passa incluirDesligados=true
    const funcAtivos = incluirDesligados
        ? funcionariosList
        : funcionariosList.filter(f => !f.desligado);

    // Coleta unidades únicas presentes nos funcionários ativos
    const unidadesSet = new Set(funcAtivos.map(f => f.unidade).filter(Boolean));
    const unidades = Array.from(unidadesSet).sort();

    // Se Firebase ainda não carregou, retorna vazio sem erros
    if (unidades.length === 0) {
        return { nos, arestas };
    }

    unidades.forEach(nomeUnidade => {
        const uid = 'u_' + nomeUnidade.replace(/\s+/g, '_');
        const funcsUnidade = funcAtivos.filter(f => f.unidade === nomeUnidade);
        const alertasUnidade = _mapaCalcularAlertasUnidade(funcsUnidade);

        nos.push({
            id: uid,
            tipo: 'unidade',
            label: nomeUnidade,
            badgeMode: 'badge',
            totalFuncs: funcsUnidade.length,
            alertas: alertasUnidade,
            x: 0, y: 0
        });

        funcsUnidade.forEach(func => {
            const fid = 'f_' + func.idFunc;
            const itens = _mapaCalcularBadgesFuncionario(func);

            nos.push({
                id: fid,
                tipo: 'funcionario',
                label: func.nome,
                pai: uid,
                badgeMode: 'badge',
                itens: itens,
                // Dados preservados para a sidebar (Etapa 3)
                idFunc: func.idFunc,
                funcao: func.funcao || '',
                unidade: func.unidade || '',
                admissao: func.admissao || null,
                dataNascimento: func.dataNascimento || null,
                emAvisoPrevio: !!func.emAvisoPrevio,
                desligado: !!func.desligado,
                x: 0, y: 0
            });
            arestas.push({ source: uid, target: fid });
        });
    });

    return { nos, arestas };
}

// ─────────────────────────────────────────────
//  CALCULAR BADGES DE UM FUNCIONÁRIO
//  Retorna array de itens de badge — um por alerta ativo.
//  Cada item: { id, label, cor, tipo }
// ─────────────────────────────────────────────
function _mapaCalcularBadgesFuncionario(func) {
    const itens = [];
    const hoje = moment().startOf('day');
    const urgente  = configGerais.diasUrgente  || 7;
    const atencao  = configGerais.diasAtencao  || 15;
    const asoUrg   = configGerais.diasAsoUrgente || 3;
    const asoAtc   = configGerais.diasAsoAtencao || 7;

    // 1. Experiência (via idPrazoVinculado → prazosList)
    if (func.idPrazoVinculado) {
        const prazoExp = prazosList.find(p => p.id === func.idPrazoVinculado && p.tipoCod === 'experiencia');
        if (prazoExp && prazoExp.dataVencimento) {
            const dias = moment(prazoExp.dataVencimento).diff(hoje, 'days');
            if (dias < 0) {
                itens.push({ id: 'exp_venc_' + func.idFunc, label: 'Exp. vencida', cor: '#dc2626', tipo: 'experiencia' });
            } else if (dias <= urgente) {
                itens.push({ id: 'exp_urg_' + func.idFunc, label: 'Exp. urgente', cor: 'var(--danger)', tipo: 'experiencia' });
            } else if (dias <= atencao) {
                itens.push({ id: 'exp_atc_' + func.idFunc, label: 'Exp. vencendo', cor: 'var(--warning)', tipo: 'experiencia' });
            } else {
                // Em experiência sem urgência — badge azul
                itens.push({ id: 'exp_ok_' + func.idFunc, label: 'Em experiência', cor: '#3b82f6', tipo: 'experiencia' });
            }
        }
    }

    // 2. ASO pendente (idPrazoAso existe e asoFeito=false)
    if (!func.asoFeito && func.idPrazoAso) {
        const prazoAso = prazosList.find(p => p.id === func.idPrazoAso && p.tipoCod === 'aso');
        if (prazoAso && prazoAso.dataVencimento) {
            const dias = moment(prazoAso.dataVencimento).diff(hoje, 'days');
            if (dias < 0) {
                itens.push({ id: 'aso_venc_' + func.idFunc, label: 'ASO vencido', cor: '#dc2626', tipo: 'aso' });
            } else if (dias <= asoUrg) {
                itens.push({ id: 'aso_urg_' + func.idFunc, label: 'ASO urgente', cor: 'var(--danger)', tipo: 'aso' });
            } else if (dias <= asoAtc) {
                itens.push({ id: 'aso_atc_' + func.idFunc, label: 'ASO vencendo', cor: 'var(--warning)', tipo: 'aso' });
            }
        }
    }

    // 3. Aviso prévio ativo
    if (func.emAvisoPrevio) {
        itens.push({ id: 'aviso_' + func.idFunc, label: 'Aviso prévio', cor: 'var(--warning)', tipo: 'aviso' });
    }

    // 3a. Prazos de rescisão, FGTS e férias (vinculados pelo nome no prazosList)
    var tiposExtras = ['rescisao', 'fgts', 'ferias', 'pagamento'];
    var prazosExtras = prazosList.filter(function(p) {
        if (!tiposExtras.includes(p.tipoCod)) return false;
        if (!p.dataVencimento) return false;
        // Vínculo pelo nome: "NOME" ou "NOME (Rescisão)" ou "NOME (Recolhimento FGTS)"
        var nomeBase = (p.nome || '').split(' (')[0].trim().toLowerCase();
        return nomeBase === (func.nome || '').trim().toLowerCase();
    });
    prazosExtras.forEach(function(p) {
        var dias = moment(p.dataVencimento).diff(hoje, 'days');
        var labelTipo = p.tipo || p.tipoCod;
        if (dias < 0) {
            itens.push({ id: 'ext_venc_' + p.id, label: labelTipo + ' vencido', cor: '#dc2626', tipo: p.tipoCod });
        } else if (dias <= urgente) {
            itens.push({ id: 'ext_urg_' + p.id, label: labelTipo + ' urgente', cor: 'var(--danger)', tipo: p.tipoCod });
        } else if (dias <= atencao) {
            itens.push({ id: 'ext_atc_' + p.id, label: labelTipo + ' vencendo', cor: 'var(--warning)', tipo: p.tipoCod });
        }
    });

    // 3b. Pendências vinculadas por idFunc (campo direto, mais preciso que nome)
    var pendenciasVinculadas = pendenciasList.filter(function(p) {
        return !p.concluida && p.idFunc === func.idFunc && p.vencimento;
    });
    pendenciasVinculadas.forEach(function(p) {
        var dias = moment(p.vencimento).diff(hoje, 'days');
        if (dias < 0) {
            itens.push({ id: 'pend_venc_' + p.id, label: 'Pendência vencida', cor: '#dc2626', tipo: 'pendencia' });
        } else if (dias <= urgente) {
            itens.push({ id: 'pend_urg_' + p.id, label: 'Pendência urgente', cor: 'var(--danger)', tipo: 'pendencia' });
        } else if (dias <= atencao) {
            itens.push({ id: 'pend_atc_' + p.id, label: 'Pendência em atenção', cor: 'var(--warning)', tipo: 'pendencia' });
        }
    });

    // 4. Badge azul — um badge por nota salva
    var notasFunc = (_mapaNotas && Array.isArray(_mapaNotas[func.idFunc])) ? _mapaNotas[func.idFunc] : [];
    notasFunc.forEach(function(nota, idx) {
        itens.push({ id: 'nota_' + func.idFunc + '_' + idx, label: 'Nota: ' + (nota.titulo || '(sem título)'), cor: 'var(--primary)', tipo: 'nota' });
    });

    // 5. Badge verde — sem nenhum alerta (funcionário OK)
    if (itens.length === 0) {
        itens.push({ id: 'ok_' + func.idFunc, label: 'Sem alertas', cor: 'var(--success)', tipo: 'ok' });
    }

    return itens;
}

// ─────────────────────────────────────────────
//  CALCULAR ALERTAS DE UMA UNIDADE
//  Conta alertas de todos os funcionários — para uso
//  no card/sidebar da unidade (Etapa 3).
// ─────────────────────────────────────────────
function _mapaCalcularAlertasUnidade(funcs) {
    let danger = 0;
    let warning = 0;
    funcs.forEach(function(func) {
        _mapaCalcularBadgesFuncionario(func).forEach(function(item) {
            if (item.cor === 'var(--danger)')  danger++;
            else if (item.cor === 'var(--warning)') warning++;
        });
    });
    return { danger: danger, warning: warning };
}

// ─────────────────────────────────────────────
//  LAYOUT INICIAL — círculo de unidades + órbitas
//  Chamado UMA ÚNICA VEZ (flag layoutFeito).
// ─────────────────────────────────────────────
function _mapaCalcularLayoutInicial() {
    const svgEl  = document.getElementById('mapa-svg');
    const W      = svgEl.clientWidth  || 900;
    const H      = svgEl.clientHeight || 600;
    const cx     = W / 2;
    const cy     = H / 2;

    // Separa unidades e funcionários
    const unidades     = _mapa.nos.filter(n => n.tipo === 'unidade');
    const funcionarios = _mapa.nos.filter(n => n.tipo === 'funcionario');

    // Raio do círculo principal (unidades)
    // Proporcional ao tamanho do SVG, com mínimo razoável
    const raioUnidades = Math.min(W, H) * 0.35;

    // Posiciona unidades em círculo ao redor do centro
    const angleStep = (2 * Math.PI) / Math.max(unidades.length, 1);
    unidades.forEach((u, i) => {
        const angle = -Math.PI / 2 + i * angleStep; // começa pelo topo
        u.x = cx + raioUnidades * Math.cos(angle);
        u.y = cy + raioUnidades * Math.sin(angle);
    });

    // Posiciona funcionários em sub-círculo ao redor de sua unidade
    const satelites = _mapa.nos.filter(n => n.tipo === 'satelite');

    unidades.forEach(u => {
        const filhos = funcionarios.filter(f => f.pai === u.id);
        if (!filhos.length) return;

        // Raio mínimo absoluto: raio visual pai (42) + raio visual filho (26) + margem (30) = 98px
        // Garante que filhos nunca ficam sobrepostos ao nó pai no layout inicial
        const RAIO_MIN_FILHO = 98;
        const temSatelite = filhos.some(f => satelites.some(s => s.pai === f.id));
        const raioFilhos  = Math.max(RAIO_MIN_FILHO, temSatelite ? 110 + filhos.length * 18 : 80 + filhos.length * 15);
        const aStep       = (2 * Math.PI) / filhos.length;

        filhos.forEach((f, i) => {
            const angle = -Math.PI / 2 + i * aStep;
            f.x = u.x + raioFilhos * Math.cos(angle);
            f.y = u.y + raioFilhos * Math.sin(angle);

            // Posiciona satélites em mini-órbita ao redor do funcionário
            const meusSats = satelites.filter(s => s.pai === f.id);
            if (!meusSats.length) return;
            const raioSat  = 38 + meusSats.length * 8;
            const satStep  = (2 * Math.PI) / meusSats.length;
            meusSats.forEach((s, k) => {
                // Ângulo inicial aponta para fora da unidade (evita overlap com aresta unidade→func)
                const baseAngle = angle + Math.PI / 2;
                s.x = f.x + raioSat * Math.cos(baseAngle + k * satStep);
                s.y = f.y + raioSat * Math.sin(baseAngle + k * satStep);
            });
        });
    });
}

// ─────────────────────────────────────────────
//  DESENHAR ARESTAS
// ─────────────────────────────────────────────
function _mapaDesenharArestas() {
    // Cria mapa id→posição para acesso rápido
    const posMap = {};
    _mapa.nos.forEach(n => { posMap[n.id] = n; });

    // Cria mapa tipo nó para estilizar arestas satélite diferente
    const tipoMap = {};
    _mapa.nos.forEach(n => { tipoMap[n.id] = n.tipo; });

    // Bind de dados
    const sel = _mapa.root.selectAll('.mapa-aresta')
        .data(_mapa.arestas, d => `${d.source}-${d.target}`);

    // Enter
    sel.enter()
        .append('line')
        .attr('class', function(d) {
            // Aresta tracejada para satélites
            const isSat = tipoMap[d.target] === 'satelite' || tipoMap[d.source] === 'satelite';
            return isSat ? 'mapa-aresta mapa-aresta-satelite' : 'mapa-aresta';
        })
        .merge(sel)
        .attr('x1', d => (posMap[d.source] || {}).x || 0)
        .attr('y1', d => (posMap[d.source] || {}).y || 0)
        .attr('x2', d => (posMap[d.target] || {}).x || 0)
        .attr('y2', d => (posMap[d.target] || {}).y || 0);

    sel.exit().remove();
}

// ─────────────────────────────────────────────
//  DESENHAR NÓS
// ─────────────────────────────────────────────
function _mapaDesenharNos() {
    // ── Bind de dados com chave de identidade ──
    const sel = _mapa.root.selectAll('.mapa-no')
        .data(_mapa.nos, d => d.id);

    // ── ENTER: cria elementos novos ──
    const enter = sel.enter()
        .append('g')
        .attr('class', function(d) {
            let cls = 'mapa-no mapa-no-placeholder';
            if (d.tipo === 'unidade')     cls += ' mapa-no-unidade';
            if (d.tipo === 'funcionario') cls += ' mapa-no-funcionario';
            if (d.tipo === 'satelite')    cls += ' mapa-no-satelite';
            // Classe de status para borda colorida no hover/clique
            if (d.tipo === 'funcionario') {
                var f = funcionariosList.find(function(fn) { return fn.idFunc === d.idFunc; });
                if (f) {
                    if (f.desligado) {
                        cls += ' status-desligado';
                    } else if (f.emAvisoPrevio) {
                        cls += ' status-aviso';
                    } else if (f.idPrazoVinculado && prazosList.find(function(p) {
                        return p.id === f.idPrazoVinculado && p.tipoCod === 'experiencia' &&
                            moment(p.dataVencimento).isSameOrAfter(moment().startOf('day'));
                    })) {
                        cls += ' status-experiencia';
                    }
                }
            }
            return cls;
        })
        .attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

    // ── Círculo visual (raio por tipo) ──
    enter.append('circle')
        .attr('r', function(d) {
            if (d.tipo === 'unidade')     return 42;
            if (d.tipo === 'funcionario') return 26;
            return 14; // satélite
        })
        .style('fill', function(d) {
            if (d.tipo === 'satelite') return d.cor || 'var(--primary)';
            return null; // usa CSS
        })
        .style('fill-opacity', function(d) {
            return d.tipo === 'satelite' ? 0.18 : null;
        })
        .style('stroke', function(d) {
            if (d.tipo === 'satelite') return d.cor || 'var(--primary)';
            return null;
        })
        .style('stroke-width', function(d) {
            return d.tipo === 'satelite' ? 2 : null;
        });

    // ── Label de texto ──
    enter.append('text')
        .text(function(d) {
            const max = d.tipo === 'unidade' ? 10 : d.tipo === 'satelite' ? 6 : 9;
            return d.label.length > max ? d.label.substring(0, max - 1) + '…' : d.label;
        })
        .attr('font-size', function(d) {
            return d.tipo === 'satelite' ? '9px' : null;
        })
        .style('fill', function(d) {
            return d.tipo === 'satelite' ? (d.cor || 'var(--primary)') : null;
        })
        .attr('dy', function(d) {
            // Texto sobe quando há badges na borda inferior (badges ficam em by negativo = abaixo)
            if (d.tipo === 'funcionario' && d.itens && d.itens.length > 0) return '-8';
            return '0';
        });

    // ── Badges dentro do nó (modo badge, só funcionários) ──
    // Pequenos círculos coloridos na borda inferior do nó
    enter.filter(function(d) {
        return d.tipo === 'funcionario' && d.badgeMode === 'badge' && d.itens && d.itens.length;
    }).each(function(d) {
        const g = d3.select(this);
        const r = 26; // raio do nó
        const nb = d.itens.length;
        const badgeR = 6;
        // Distribui badges em arco na parte inferior do círculo
        d.itens.forEach(function(item, k) {
            const totalAngle = Math.PI * 0.7; // arco de 126°
            // Arco centrado em 90° (π/2) — em SVG y cresce para baixo, então sin(90°)=+1 = parte inferior
            const centerAngle = Math.PI / 2;
            const startAngle  = centerAngle - totalAngle / 2;
            const angle = startAngle + (nb > 1 ? k * totalAngle / (nb - 1) : totalAngle / 2);
            const bx = (r + 2) * Math.cos(angle);
            const by = (r + 2) * Math.sin(angle);
            g.append('circle')
                .attr('class', 'mapa-badge')
                .attr('cx', bx)
                .attr('cy', by)
                .attr('r', badgeR)
                .style('fill', item.cor)
                .style('stroke', 'var(--bg-card)')
                .style('stroke-width', 1.5)
                .append('title').text(item.label);
        });
    });

    // ── Attach de eventos ──
    // Satélites: apenas tooltip, sem drag/click complexo
    // Funcionários (ativos e desligados) e unidades: eventos completos
    enter.each(function(d) {
        if (d.tipo !== 'satelite') {
            _mapaBindEventos(d3.select(this), d);
        } else {
            // Satélite: tooltip simples ao hover
            d3.select(this).style('cursor', 'default')
                .append('title').text(d.tipoItem === 'nota' ? '📝 ' + d.label : '⚠ ' + d.label);
        }
    });

    // ── UPDATE: reposiciona nós existentes ──
    sel.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');

    // ── EXIT ──
    sel.exit().remove();
}

// ─────────────────────────────────────────────
//  TOOLTIP CUSTOMIZADO DO MAPA
// ─────────────────────────────────────────────
(function() {
    var tip = null;
    function getTip() {
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'mapa-tooltip';
            document.body.appendChild(tip);
        }
        return tip;
    }

    window._mapaTooltipMostrar = function(label, event) {
        var el = getTip();
        el.textContent = label;
        el.classList.add('mapa-tooltip-visivel');
        _mapaTooltipMover(event);
    };
    window._mapaTooltipMover = function(event) {
        var el = getTip();
        var x = event.clientX + 14;
        var y = event.clientY - 10;
        // Evita sair da tela pela direita
        if (x + 200 > window.innerWidth) x = event.clientX - 14 - el.offsetWidth;
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
    };
    window._mapaTooltipOcultar = function() {
        var el = getTip();
        el.classList.remove('mapa-tooltip-visivel');
    };
}());

// ─────────────────────────────────────────────
//  BIND DE EVENTOS — SEPARAÇÃO CIRÚRGICA
//  Esta função é o coração da solução para evitar
//  o conflito click/drag que causava os bugs anteriores.
// ─────────────────────────────────────────────
function _mapaBindEventos(sel, d) {

    // ── DRAG ──
    // O drag do D3 v7 funciona assim:
    //   - se o mouse se mover > threshold durante mousedown → drag ativado
    //   - se drag foi ativado → o evento 'click' subsequente é AUTOMATICAMENTE
    //     cancelado pelo D3 (event.defaultPrevented = true)
    // Isso significa que drag e click são MUTUAMENTE EXCLUSIVOS por design.
    // Não precisamos de debounce, flags ou timeouts manuais.

    const drag = d3.drag()
        .on('start', function(event, datum) {
            // Impede que o evento de mousedown chegue ao SVG pai (evita zoom/pan acidental)
            event.sourceEvent.stopPropagation();
            d3.select(this).raise();
            d3.select(this).classed('dragging', true);
            datum._dragStartX = datum.x;
            datum._dragStartY = datum.y;
            // Inicializa _vx/_vy do próprio nó arrastado e de todos os seus filhos
            datum._vx = datum.x;
            datum._vy = datum.y;
            function initVxy(paiId) {
                _mapa.nos
                    .filter(function(n) { return n.pai === paiId; })
                    .forEach(function(filho) {
                        filho._vx = filho.x;
                        filho._vy = filho.y;
                        initVxy(filho.id);
                    });
            }
            initVxy(datum.id);
        })
        .on('drag', function(event, datum) {
            const dx = event.x - datum.x;
            const dy = event.y - datum.y;

            // Atualiza posição do nó arrastado — x/y e _vx/_vy juntos
            // (_vx/_vy é usado por _mapaAtualizarTodasArestas para as linhas)
            datum.x = event.x;
            datum.y = event.y;
            datum._vx = datum.x;
            datum._vy = datum.y;
            d3.select(this).attr('transform', 'translate(' + datum.x + ',' + datum.y + ')');

            // Atualiza posição-alvo dos filhos (dados em memória)
            // O SVG dos filhos é atualizado pelo loop rAF em _mapaIniciarLerpFilhos
            // Pai e filhos usam a mesma fonte de verdade (x/y em memória) para as arestas
            function atualizarAlvoFilhos(paiId) {
                _mapa.nos
                    .filter(function(n) { return n.pai === paiId; })
                    .forEach(function(filho) {
                        filho.x += dx;
                        filho.y += dy;
                        atualizarAlvoFilhos(filho.id);
                    });
            }

            if (datum.tipo === 'unidade' || datum.tipo === 'funcionario') {
                atualizarAlvoFilhos(datum.id);
                // Inicia o loop rAF que anima filhos suavemente e mantém linhas em sync
                _mapaIniciarLerpFilhos(datum.id);
            }

            // Linhas do pai atualizadas imediatamente (pai já está na posição final)
            _mapaAtualizarTodasArestas();
        })
        .on('end', function(event, datum) {
            d3.select(this).classed('dragging', false);
            delete datum._dragStartX;
            delete datum._dragStartY;
            // Cancela o rAF e snapa ANTES da repulsão (evita race condition com lerp)
            if (_mapaLerpRafId) {
                cancelAnimationFrame(_mapaLerpRafId);
                _mapaLerpRafId = null;
            }
            // Snapa o próprio nó arrastado (filhos são snapados dentro de _mapaLerpSnapFilhos)
            datum._vx = datum.x;
            datum._vy = datum.y;
            _mapaLerpSnapFilhos(datum.id);
            // Repulsão roda com _vx/_vy já no estado final — sem interferência do lerp
            _mapaRepelirSobrepostos(datum);
            // Etapa 4: debounce de 2s após drag end — salva todas as posições
            if (_mapaSaveTimer) clearTimeout(_mapaSaveTimer);
            _mapaSaveTimer = setTimeout(function() {
                mapaSalvarTodasPosicoes();
                _mapaSaveTimer = null;
            }, 2000);
        });

    sel.call(drag);

    // ── CLICK ──
    // NUNCA chama layout, NUNCA chama setNodes, NUNCA interfere com drag.
    // Única responsabilidade: selecionar o nó e abrir a sidebar.
    // SOLUÇÃO PARA O DUPLO CLIQUE:
    // d3.zoom chama event.preventDefault() no mousedown antes de avaliar o .filter().
    // No Chrome/SVG, preventDefault() no mousedown suprime o evento 'click' subsequente.
    // Por isso usamos 'pointerdown'+'pointerup' em vez de 'click':
    // pointerup dispara independentemente de preventDefault no mousedown.
    // Distinguimos drag de clique verificando se o ponteiro se moveu > 4px.
    let _pointerDownX = 0;
    let _pointerDownY = 0;

    // Tooltip: mostra nome completo ao hover
    sel.on('mouseenter.tooltip', function(event, datum) {
        if (datum.label) _mapaTooltipMostrar(datum.label, event);
    })
    .on('mousemove.tooltip', function(event) {
        _mapaTooltipMover(event);
    })
    .on('mouseleave.tooltip', function() {
        _mapaTooltipOcultar();
    });

    sel.on('pointerdown.select', function(event) {
        // Registra posição inicial (para comparar no pointerup)
        _pointerDownX = event.clientX;
        _pointerDownY = event.clientY;
        // Não chama stopPropagation aqui — o drag já faz isso no 'start'
    });

    sel.on('pointerup.select', function(event, datum) {
        event.stopPropagation(); // impede fechar sidebar via SVG pai

        // Calcula distância percorrida desde o pointerdown
        const dx = Math.abs(event.clientX - _pointerDownX);
        const dy = Math.abs(event.clientY - _pointerDownY);
        const moveu = Math.sqrt(dx * dx + dy * dy);

        // Se moveu mais que 4px = foi drag, ignora
        if (moveu > 4) return;

        // Foi clique: seleciona e abre sidebar
        _mapa.root.selectAll('.mapa-no').classed('selecionado', false);
        d3.select(this).classed('selecionado', true);
        _mapa.idSelecionado = datum.id;
        mapaAbrirSidebar(datum);
    });
}

// ─────────────────────────────────────────────
//  ATUALIZAR ARESTAS DE UM NÓ (durante drag)
//  Só redesenha as linhas que conectam ao nó movido.
//  Evita redesenhar TODO o SVG a cada pixel de drag.
// ─────────────────────────────────────────────
function _mapaAtualizarArestasDo(id) {
    // Mantida por compatibilidade — delega para a versão que atualiza tudo.
    _mapaAtualizarTodasArestas();
}

function _mapaAtualizarTodasArestas() {
    // Usa _vx/_vy (posição visual) quando disponível — garante que linhas
    // acompanham exatamente o que está visível na tela, inclusive durante lerp e repulsão.
    const posMap = {};
    _mapa.nos.forEach(function(n) {
        posMap[n.id] = {
            x: (n._vx !== undefined) ? n._vx : n.x,
            y: (n._vy !== undefined) ? n._vy : n.y
        };
    });
    _mapa.root.selectAll('.mapa-aresta')
        .attr('x1', function(d) { return (posMap[d.source] || {}).x || 0; })
        .attr('y1', function(d) { return (posMap[d.source] || {}).y || 0; })
        .attr('x2', function(d) { return (posMap[d.target] || {}).x || 0; })
        .attr('y2', function(d) { return (posMap[d.target] || {}).y || 0; });
}

// ─────────────────────────────────────────────
//  LERP rAF — fluidez dos nós filhos
//  Move os filhos suavemente em direção à posição-alvo (x/y)
//  usando requestAnimationFrame. Linha e nó sempre em sync:
//  ambos usam _vx/_vy (posição visual atual), não x/y (alvo).
// ─────────────────────────────────────────────
var _mapaLerpRafId = null;       // ID do rAF ativo (null = parado)
var _mapaSaveTimer = null;       // Timer de debounce para save pós-drag
var _mapaLerpPaiId = null;       // ID do nó pai cujos filhos estão sendo animados
var _mapaLerpFator = 0.28;       // 0=nenhum lerp, 1=instantâneo. 0.28 = suave mas ágil
var _mapaLerpNosLivres = [];     // Nós que lerp de forma independente (ex: repulsão)

function _mapaIniciarLerpFilhos(paiId) {
    _mapaLerpPaiId = paiId;
    // Garante que só há um rAF rodando por vez
    if (_mapaLerpRafId !== null) return;
    _mapaLerpTick();
}

function _mapaLerpTick() {
    if (_mapaLerpPaiId === null && _mapaLerpNosLivres.length === 0) {
        _mapaLerpRafId = null;
        return;
    }

    var algumMovendo = false;

    // Percorre todos os filhos (e descendentes) do nó pai sendo arrastado
    function lerpFilhos(paiId) {
        _mapa.nos
            .filter(function(n) { return n.pai === paiId; })
            .forEach(function(filho) {
                // Inicializa posição visual se ainda não tem
                if (filho._vx === undefined) { filho._vx = filho.x; filho._vy = filho.y; }

                var dx = filho.x - filho._vx;
                var dy = filho.y - filho._vy;
                var dist = Math.sqrt(dx * dx + dy * dy);

                if (dist > 0.5) {
                    // Lerp: move a posição visual em direção ao alvo
                    filho._vx += dx * _mapaLerpFator;
                    filho._vy += dy * _mapaLerpFator;
                    algumMovendo = true;
                } else {
                    // Chegou: snapa para o alvo exato
                    filho._vx = filho.x;
                    filho._vy = filho.y;
                }

                // Atualiza SVG do filho com posição VISUAL (_vx/_vy)
                _mapa.root.selectAll('.mapa-no')
                    .filter(function(f) { return f.id === filho.id; })
                    .attr('transform', 'translate(' + filho._vx + ',' + filho._vy + ')');

                lerpFilhos(filho.id);
            });
    }

    if (_mapaLerpPaiId !== null) {
        lerpFilhos(_mapaLerpPaiId);
    }

    // Processa nós livres (ex: nós repelidos animando para nova posição)
    var nosLivresRestantes = [];
    _mapaLerpNosLivres.forEach(function(no) {
        var dx = no.x - no._vx;
        var dy = no.y - no._vy;
        var dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.5) {
            no._vx += dx * _mapaLerpFator;
            no._vy += dy * _mapaLerpFator;
            algumMovendo = true;
            nosLivresRestantes.push(no);
        } else {
            no._vx = no.x;
            no._vy = no.y;
        }
        _mapa.root.selectAll('.mapa-no')
            .filter(function(f) { return f.id === no.id; })
            .attr('transform', 'translate(' + no._vx + ',' + no._vy + ')');
    });
    _mapaLerpNosLivres = nosLivresRestantes;

    // Atualiza TODAS as arestas usando posição visual (_vx/_vy) dos filhos
    // Para isso, usa um posMap que prefere _vx/_vy quando disponível
    _mapaAtualizarArestasCom_vxy();

    if (algumMovendo) {
        // Continua animando
        _mapaLerpRafId = requestAnimationFrame(_mapaLerpTick);
    } else {
        // Todos chegaram: para o loop
        _mapaLerpRafId = null;
        _mapaLerpPaiId = null;
    }
}

function _mapaLerpSnapFilhos(paiId) {
    // Snap imediato: chamado no drag end para finalizar posições
    _mapa.nos
        .filter(function(n) { return n.pai === paiId; })
        .forEach(function(filho) {
            filho._vx = filho.x;
            filho._vy = filho.y;
            _mapa.root.selectAll('.mapa-no')
                .filter(function(f) { return f.id === filho.id; })
                .attr('transform', 'translate(' + filho._vx + ',' + filho._vy + ')');
            _mapaLerpSnapFilhos(filho.id);
        });
    _mapaLerpRafId = null;
    _mapaLerpPaiId = null;
    if (_mapaLerpRafId) { cancelAnimationFrame(_mapaLerpRafId); }
    _mapaAtualizarTodasArestas();
}

function _mapaAtualizarArestasCom_vxy() {
    // Igual a _mapaAtualizarTodasArestas, mas usa _vx/_vy (posição visual)
    // para os filhos que estão em lerp. O pai já está na posição final (x/y).
    const posMap = {};
    _mapa.nos.forEach(function(n) {
        posMap[n.id] = {
            x: (n._vx !== undefined) ? n._vx : n.x,
            y: (n._vy !== undefined) ? n._vy : n.y
        };
    });
    _mapa.root.selectAll('.mapa-aresta')
        .attr('x1', function(d) { return (posMap[d.source] || {}).x || 0; })
        .attr('y1', function(d) { return (posMap[d.source] || {}).y || 0; })
        .attr('x2', function(d) { return (posMap[d.target] || {}).x || 0; })
        .attr('y2', function(d) { return (posMap[d.target] || {}).y || 0; });
}

// ─────────────────────────────────────────────
//  REPULSÃO SUAVE NO DRAG END
//  Chamada apenas quando o usuário SOLTA um nó.
//  Nunca durante o drag — zero conflito com eventos.
//  Resolve sobreposições empurrando nós para fora,
//  com animação CSS de 300ms.
// ─────────────────────────────────────────────
function _mapaRepelirSobrepostos(nodoDragado) {
    const raioVisual = { unidade: 42, funcionario: 26 };
    const margem     = 14;

    // Move um nó e TODOS os seus descendentes pelo vetor (vx, vy)
    // Sincroniza _vx/_vy = x/y para que as linhas usem a posição correta imediatamente
    function moverGrupo(no, vx, vy) {
        // Guarda posição visual ANTES de mover — o lerp anima daqui até x/y novo
        if (no._vx === undefined) { no._vx = no.x; no._vy = no.y; }
        no.x += vx;
        no.y += vy;
        // NÃO sincroniza _vx/_vy aqui — _vx/_vy fica na posição antiga
        // para que o lerp tenha um ponto de partida diferente do destino
        _mapa.nos
            .filter(function(s) { return s.pai === no.id; })
            .forEach(function(s) { moverGrupo(s, vx, vy); });
    }

    // IDs do grupo arrastado — NUNCA movidos pela repulsão
    var idsFixos = {};
    idsFixos[nodoDragado.id] = true;
    _mapa.nos
        .filter(function(n) { return n.pai === nodoDragado.id || n.pai === nodoDragado.id; })
        .forEach(function(n) {
            // Todos os descendentes do nó arrastado também são fixos
            (function marcarFixo(id) {
                idsFixos[id] = true;
                _mapa.nos
                    .filter(function(s) { return s.pai === id; })
                    .forEach(function(s) { marcarFixo(s.id); });
            }(n.id));
        });
    idsFixos[nodoDragado.id] = true;

    // Nós principais que participam da resolução (não satélites)
    var nosPrincipais = _mapa.nos.filter(function(n) {
        return n.tipo === 'unidade' || n.tipo === 'funcionario';
    });

    // Rastreia quais nós foram movidos (para animar no final)
    var afetados = {};

    // Algoritmo: até MAX_ITER passagens globais sobre todos os pares.
    // Em cada passagem, verifica TODOS os pares de nós principais.
    // Se dois se sobrepõem: empurra o nó NÃO-FIXO para fora.
    // Se ambos são não-fixos: empurra o que foi movido pelo drag por último
    // (heurística: empurra 'outro' sempre, que é o que não foi intencionalmente posicionado).
    // Para quando nenhuma sobreposição é encontrada (convergência).
    var MAX_ITER = 6;

    for (var iter = 0; iter < MAX_ITER; iter++) {
        var houveColisao = false;

        for (var i = 0; i < nosPrincipais.length; i++) {
            for (var j = i + 1; j < nosPrincipais.length; j++) {
                var a = nosPrincipais[i];
                var b = nosPrincipais[j];

                // Se ambos são fixos, pula
                if (idsFixos[a.id] && idsFixos[b.id]) continue;

                var dx   = b.x - a.x;
                var dy   = b.y - a.y;
                var dist = Math.sqrt(dx * dx + dy * dy);

                var rA   = raioVisual[a.tipo] || 26;
                var rB   = raioVisual[b.tipo] || 26;
                var rMin = rA + rB + margem;

                if (dist < rMin && dist > 0.001) {
                    houveColisao = true;
                    var overlap = rMin - dist;
                    var nx = dx / dist;
                    var ny = dy / dist;

                    if (idsFixos[a.id]) {
                        // Só b pode mover
                        moverGrupo(b, nx * overlap, ny * overlap);
                        afetados[b.id] = true;
                    } else if (idsFixos[b.id]) {
                        // Só a pode mover (para longe de b)
                        moverGrupo(a, -nx * overlap, -ny * overlap);
                        afetados[a.id] = true;
                    } else {
                        // Ambos podem mover: divide o overlap
                        moverGrupo(b,  nx * overlap * 0.5,  ny * overlap * 0.5);
                        moverGrupo(a, -nx * overlap * 0.5, -ny * overlap * 0.5);
                        afetados[a.id] = true;
                        afetados[b.id] = true;
                    }
                }
            }
        }

        // Convergiu: nenhuma sobreposição encontrada nesta passagem
        if (!houveColisao) break;
    }

    // Se nada foi movido, nada a animar
    if (Object.keys(afetados).length === 0) return;

    // Coleta todos os IDs afetados + seus descendentes (para animar e atualizar)
    var todosIds = {};
    Object.keys(afetados).forEach(function(id) {
        todosIds[id] = true;
        _mapa.nos
            .filter(function(n) { return n.pai === id; })
            .forEach(function(n) { todosIds[n.id] = true; });
    });

    // Anima os nós repelidos usando o mesmo sistema lerp do drag.
    // _vx/_vy = posição visual atual (onde o nó está agora na tela)
    // x/y = nova posição (destino da repulsão)
    // O rAF lerp move _vx/_vy em direção a x/y frame a frame,
    // atualizando nó e linha juntos — sem gap visual.
    Object.keys(todosIds).forEach(function(id) {
        var no = _mapa.nos.find(function(n) { return n.id === id; });
        if (!no) return;
        // _vx/_vy = posição antes da repulsão (guardada por moverGrupo)
        // x/y = posição nova (destino)
        // O lerp anima _vx/_vy → x/y frame a frame, nó e linha juntos
        if (no._vx === undefined) { no._vx = no.x; no._vy = no.y; return; } // snap se nunca animou
        _mapaLerpNosLivres.push(no);
    });

    // Inicia o rAF se ainda não estiver rodando
    if (_mapaLerpNosLivres.length > 0 && _mapaLerpRafId === null) {
        _mapaLerpTick();
    }
}

// ─────────────────────────────────────────────
//  BACKUP DE LAYOUT
//  Salva snapshot das posições no Firebase com
//  timestamp. Botão restaurar recupera o último.
// ─────────────────────────────────────────────

async function mapaSalvarBackup() {
    if (!_mapa.nos || _mapa.nos.length === 0) {
        showToast('Nenhum nó para salvar.', 'warning');
        return;
    }
    const positions = {};
    _mapa.nos.forEach(function(n) {
        positions[n.id] = { x: n.x, y: n.y };
    });
    const backup = {
        timestamp: Date.now(),
        dataHora: moment().format('DD/MM/YYYY HH:mm'),
        positions: positions
    };
    try {
        await fetch(FIREBASE_URL + 'rhfacil/canvas/layout_backup.json', {
            method: 'PUT',
            body: JSON.stringify(backup)
        });
        // Marca o botão restaurar com ponto verde
        var dot = document.getElementById('mapa-backup-dot');
        if (dot) dot.style.display = 'block';
        showToast('Backup do layout salvo (' + backup.dataHora + ')', 'success');
    } catch(e) {
        showToast('Erro ao salvar backup.', 'error');
    }
}

async function mapaRestaurarBackup() {
    try {
        const res = await fetch(FIREBASE_URL + 'rhfacil/canvas/layout_backup.json');
        const backup = await res.json();
        if (!backup || !backup.positions) {
            showToast('Nenhum backup encontrado.', 'warning');
            return;
        }
        const confirmou = await showConfirm('Restaurar layout salvo em ' + backup.dataHora + '? As posições atuais serão substituídas.');
        if (!confirmou) return;

        // Aplica posições do backup nos nós atuais
        var restaurados = 0;
        _mapa.nos.forEach(function(n) {
            var saved = backup.positions[n.id];
            if (saved && saved.x !== undefined) {
                n.x = saved.x; n.y = saved.y;
                n._vx = saved.x; n._vy = saved.y;
                restaurados++;
            }
        });

        // Redesenha com posições restauradas
        _mapaDesenharArestas();
        _mapaDesenharNos();
        mapaFitView();

        // Salva as posições restauradas como posições atuais
        await mapaSalvarTodasPosicoes();

        showToast(restaurados + ' nós restaurados do backup de ' + backup.dataHora, 'success');
    } catch(e) {
        showToast('Erro ao restaurar backup.', 'error');
    }
}

// Verifica se há backup disponível ao iniciar e marca o botão
async function mapaVerificarBackupDisponivel() {
    try {
        const res = await fetch(FIREBASE_URL + 'rhfacil/canvas/layout_backup.json');
        const backup = await res.json();
        if (backup && backup.positions) {
            var dot = document.getElementById('mapa-backup-dot');
            if (dot) dot.style.display = 'block';
            var btn = document.getElementById('mapa-btn-restaurar');
            if (btn) btn.title = 'Restaurar backup de ' + backup.dataHora;
        }
    } catch(e) { /* silencioso */ }
}

// ─────────────────────────────────────────────
//  ORGANIZAR UNIDADES EM GRADE
// ─────────────────────────────────────────────

function mapaOrganizarEmGrade() {
    const unidades = _mapa.nos.filter(n => n.tipo === 'unidade');
    if (!unidades.length) return;

    const linhas  = Math.max(1, parseInt(document.getElementById('mapa-grade-linhas')?.value)  || 4);
    const colunas = Math.max(1, parseInt(document.getElementById('mapa-grade-colunas')?.value) || 6);
    const distH   = Math.max(100, parseInt(document.getElementById('mapa-grade-distH')?.value) || 350);
    const distV   = Math.max(100, parseInt(document.getElementById('mapa-grade-distV')?.value) || 300);

    // Ordena unidades por nome para layout consistente
    unidades.sort((a, b) => (a.label || '').localeCompare(b.label || ''));

    const totalW = (colunas - 1) * distH;
    const totalH = (linhas  - 1) * distV;
    const origemX = -totalW / 2;
    const origemY = -totalH / 2;

    // Coleta todos os nós que vão animar (unidades + filhos)
    // Garante que _vx/_vy reflectem a posição visual atual antes de mover o alvo
    var nosParaAnimar = [];

    unidades.forEach(function(u, i) {
        const col = i % colunas;
        const row = Math.floor(i / colunas);
        const novoX = origemX + col * distH;
        const novoY = origemY + row * distV;
        const deltaX = novoX - u.x;
        const deltaY = novoY - u.y;

        // Inicializa posição visual da unidade com a atual antes de mover o alvo
        if (u._vx === undefined) { u._vx = u.x; u._vy = u.y; }

        // Define novo alvo
        u.x = novoX;
        u.y = novoY;
        nosParaAnimar.push(u);

        // Filhos: mantém offset relativo
        _mapa.nos.forEach(function(filho) {
            if (filho.pai === u.id) {
                if (filho._vx === undefined) { filho._vx = filho.x; filho._vy = filho.y; }
                filho.x += deltaX;
                filho.y += deltaY;
                nosParaAnimar.push(filho);
            }
        });
    });

    // Injeta todos no loop lerp como "nós livres"
    // O loop vai animar cada um suavemente do _vx/_vy atual até x/y alvo
    _mapaLerpNosLivres = _mapaLerpNosLivres.concat(nosParaAnimar);
    // Inicia o tick se não estiver rodando
    if (_mapaLerpRafId === null) {
        _mapaLerpTick();
    }

    // Repulsão entre unidades após lerp completar — evita sobreposição
    setTimeout(function() {
        var noFake = { id: '__grade__', x: 0, y: 0, tipo: 'unidade' };
        _mapaRepelirSobrepostos(noFake);
        // Re-injeta nós repelidos no lerp para animar suavemente
        var nosRepelidos = _mapa.nos.filter(function(n) {
            return Math.abs(n.x - (n._vx || n.x)) > 1 || Math.abs(n.y - (n._vy || n.y)) > 1;
        });
        if (nosRepelidos.length > 0) {
            _mapaLerpNosLivres = _mapaLerpNosLivres.concat(nosRepelidos);
            if (_mapaLerpRafId === null) _mapaLerpTick();
        }
    }, 300);

    // Centraliza a view após a animação terminar
    setTimeout(mapaFitView, 700);

    // Salva no Firebase após animação completa
    setTimeout(mapaSalvarTodasPosicoes, 1000);

    showToast('Unidades organizadas em grade ' + linhas + '×' + colunas, 'success');
}

// ─────────────────────────────────────────────
//  FIT VIEW — centraliza e ajusta zoom
// ─────────────────────────────────────────────
function mapaFitView() {
    if (!_mapa.svg || !_mapa.nos.length) return;

    const svgEl = document.getElementById('mapa-svg');
    const W = svgEl.clientWidth  || 900;
    const H = svgEl.clientHeight || 600;
    const padding = 80;

    // Calcula bounding box de todos os nós
    const xs = _mapa.nos.map(n => n.x);
    const ys = _mapa.nos.map(n => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const bW = maxX - minX || 1;
    const bH = maxY - minY || 1;

    const scale = Math.min(
        (W - padding * 2) / bW,
        (H - padding * 2) / bH,
        1.5  // nunca zoom > 1.5x no fit
    );

    const tx = W / 2 - scale * (minX + bW / 2);
    const ty = H / 2 - scale * (minY + bH / 2);

    _mapa.svg.transition().duration(500)
        .call(_mapa.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
}

// ─────────────────────────────────────────────
//  SIDEBAR — abrir / fechar
//  Etapa 3 preencherá o corpo com dados reais.
//  Aqui: apenas controla visibilidade e mostra placeholder.
// ─────────────────────────────────────────────
function mapaAbrirSidebar(dado) {
    const sidebar = document.getElementById('mapa-sidebar');
    const corpo   = document.getElementById('mapa-sidebar-corpo');
    const titulo  = document.getElementById('mapa-sidebar-titulo');

    if (!sidebar || !corpo) return;

    if (dado.tipo === 'funcionario') {
        _mapaRenderSidebarFuncionario(dado, corpo, titulo);
    } else if (dado.tipo === 'unidade') {
        _mapaRenderSidebarUnidade(dado, corpo, titulo);
    }

    sidebar.classList.remove('mapa-sidebar-fechada');
    sidebar.classList.add('mapa-sidebar-aberta');
}

// ─────────────────────────────────────────────
//  SIDEBAR — FUNCIONÁRIO (Etapa 3)
// ─────────────────────────────────────────────
function _mapaRenderSidebarFuncionario(dado, corpo, titulo) {
    // Busca dados completos no array global (dado só tem o snapshot do momento do render)
    const f = funcionariosList.find(fn => fn.idFunc === dado.idFunc);
    if (!f) {
        titulo.textContent = dado.label || 'Funcionário';
        corpo.innerHTML = '<div class="mapa-sidebar-vazia"><i class="fa-solid fa-circle-exclamation"></i><p>Funcionário não encontrado.</p></div>';
        return;
    }

    titulo.textContent = 'Funcionário';

    // Status e cores — detecta se está em experiência ativa
    const _emExp = !f.desligado && !f.emAvisoPrevio && f.idPrazoVinculado &&
        prazosList.find(p => p.id === f.idPrazoVinculado && p.tipoCod === 'experiencia' &&
            moment(p.dataVencimento).isSameOrAfter(moment().startOf('day')));
    const status = f.desligado ? 'Desligado'
                 : f.emAvisoPrevio ? 'Aviso Prévio'
                 : _emExp ? 'Em Experiência'
                 : 'Ativo';
    const corSt  = f.desligado ? 'var(--danger)'
                 : f.emAvisoPrevio ? 'var(--warning)'
                 : _emExp ? '#3b82f6'
                 : 'var(--success)';
    const bgSt   = f.desligado ? 'var(--danger-light)'
                 : f.emAvisoPrevio ? 'var(--warning-light)'
                 : _emExp ? '#1e3a5f'
                 : 'var(--success-light)';

    // Avatar
    const iniciais = (f.nome || '?').split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    const admissao   = f.admissao     ? moment(f.admissao).format('DD/MM/YYYY')     : '—';
    const nascimento = f.dataNascimento ? moment(f.dataNascimento).format('DD/MM/YYYY') : '—';

    // Tempo de empresa: "8m 7d" ou "2a 3m" — usa data de desligamento para desligados
    const _tempoEmpresa = (() => {
        if (!f.admissao) return '';
        const inicio = moment(f.admissao);
        const fim    = f.desligado && f.dataDesligamento ? moment(f.dataDesligamento) : moment();
        const anos   = fim.diff(inicio, 'years');  inicio.add(anos, 'years');
        const meses  = fim.diff(inicio, 'months'); inicio.add(meses, 'months');
        const dias   = fim.diff(inicio, 'days');
        if (anos > 0) return anos + 'a ' + meses + 'm';
        if (meses > 0) return meses + 'm ' + dias + 'd';
        return dias + 'd';
    })();

    // Prazos ativos
    const hoje = moment().startOf('day');
    // ── PAINEL UNIFICADO: Prazos & Alertas ──
    // Monta todos os itens em ordem: aviso prévio, prazos por FK, prazos por nome
    // Cada item tem: ícone colorido, label, data e status (vencido/dias)

    function _corPrazo(dias, isAso) {
        var urg = isAso ? (configGerais.diasAsoUrgente || 3) : (configGerais.diasUrgente || 7);
        var atc = isAso ? (configGerais.diasAsoAtencao || 7) : (configGerais.diasAtencao || 15);
        if (dias < 0) return '#dc2626';
        if (dias <= urg) return 'var(--danger)';
        if (dias <= atc) return 'var(--warning)';
        return 'var(--success)';
    }
    function _txtPrazo(dias) {
        if (dias < 0) return 'Vencido há ' + Math.abs(dias) + 'd';
        if (dias === 0) return 'Vence hoje';
        return dias + 'd restantes';
    }
    function _iconeCorPrazo(cor) {
        // Ícone de ponto colorido
        return '<span style="width:9px;height:9px;border-radius:50%;background:' + cor + ';flex-shrink:0;display:inline-block;"></span>';
    }

    var itensUnificados = [];

    // 1. Aviso prévio (expandido com datas)
    if (f.emAvisoPrevio && f.dataFimAviso) {
        var dataFimAviso = moment(f.dataFimAviso);
        var ultTrabAviso = dataFimAviso.clone().subtract(7, 'days');
        var diasAviso    = dataFimAviso.diff(hoje, 'days');
        var corAviso     = diasAviso < 0 ? '#dc2626' : 'var(--warning)';
        var txtAviso     = _txtPrazo(diasAviso);
        itensUnificados.push(
            '<div style="padding:0.45rem 0;border-bottom:1px solid var(--border);">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;margin-bottom:4px;">'
            + '<div style="display:flex;align-items:center;gap:6px;">'
            + _iconeCorPrazo(corAviso)
            + '<span style="font-size:0.82rem;color:var(--text-main);font-weight:500;">Aviso Prévio</span>'
            + '</div>'
            + '<span style="font-size:0.8rem;color:' + corAviso + ';font-weight:600;white-space:nowrap;">' + txtAviso + '</span>'
            + '</div>'
            + '<div style="font-size:0.75rem;color:var(--text-light);display:flex;flex-direction:column;gap:2px;padding-left:15px;">'
            + '<span style="display:flex;align-items:center;gap:4px;"><i class="fa-solid fa-calendar-xmark" style="color:var(--warning);width:12px;text-align:center;"></i>Término: <strong style="color:var(--text-main);">' + dataFimAviso.format('DD/MM/YYYY') + '</strong></span>'
            + '<span style="display:flex;align-items:center;gap:4px;"><i class="fa-solid fa-calendar-check" style="color:var(--success);width:12px;text-align:center;"></i>Último trabalhado: <strong style="color:var(--text-main);">' + ultTrabAviso.format('DD/MM/YYYY') + '</strong></span>'
            + '</div>'
            + '</div>'
        );
    }

    // 2. Prazos por FK direta (experiência, ASO, FGTS)
    var prazosFunc = prazosList.filter(function(p) {
        return (p.id === f.idPrazoVinculado || p.id === f.idPrazoAso || p.id === f.idPrazoFgts) && p.dataVencimento;
    });

    // 3. Prazos por nome (rescisão, férias, pagamentos)
    var tiposExtraSidebar = ['rescisao', 'fgts', 'ferias', 'pagamento', 'pendencia'];
    var prazosExtraFunc = prazosList.filter(function(p) {
        if (!p.dataVencimento) return false;
        if (!tiposExtraSidebar.includes(p.tipoCod)) return false;
        if (prazosFunc.find(function(pf) { return pf.id === p.id; })) return false;
        var nomeBase = (p.nome || '').split(' (')[0].trim().toLowerCase();
        return nomeBase === (f.nome || '').trim().toLowerCase();
    });

    var todosPrazos = prazosFunc.concat(prazosExtraFunc);
    todosPrazos.forEach(function(p) {
        var dias  = moment(p.dataVencimento).diff(hoje, 'days');
        var isAso = p.tipoCod === 'aso';
        // Experiência no prazo → azul; outros no prazo → verde
        var cor   = (p.tipoCod === 'experiencia' && dias > (configGerais.diasAtencao || 15))
                    ? '#3b82f6'
                    : _corPrazo(dias, isAso);
        var txt   = _txtPrazo(dias);
        var data  = moment(p.dataVencimento).format('DD/MM/YYYY');
        itensUnificados.push(
            '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.45rem 0;border-bottom:1px solid var(--border);gap:0.5rem;">'
            + '<div style="display:flex;align-items:center;gap:6px;min-width:0;">'
            + _iconeCorPrazo(cor)
            + '<div style="min-width:0;">'
            + '<div style="font-size:0.82rem;color:var(--text-main);font-weight:500;">' + esc(p.tipo || p.tipoCod) + '</div>'
            + '<div style="font-size:0.74rem;color:var(--text-light);">' + data + '</div>'
            + '</div>'
            + '</div>'
            + '<span style="font-size:0.8rem;color:' + cor + ';font-weight:600;white-space:nowrap;flex-shrink:0;">' + txt + '</span>'
            + '</div>'
        );
    });

    // 4. Pendências vinculadas por idFunc (pendenciasList)
    var pendenciasVinc = pendenciasList.filter(function(p) {
        return !p.concluida && p.idFunc === f.idFunc && p.vencimento;
    });
    pendenciasVinc.forEach(function(p) {
        var dias = moment(p.vencimento).diff(hoje, 'days');
        var cor  = _corPrazo(dias, false);
        var txt  = _txtPrazo(dias);
        var data = moment(p.vencimento).format('DD/MM/YYYY');
        itensUnificados.push(
            '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.45rem 0;border-bottom:1px solid var(--border);gap:0.5rem;">'
            + '<div style="display:flex;align-items:center;gap:6px;min-width:0;">'
            + _iconeCorPrazo(cor)
            + '<div style="min-width:0;">'
            + '<div style="font-size:0.82rem;color:var(--text-main);font-weight:500;">' + esc(p.descricao || 'Pendência') + '</div>'
            + '<div style="font-size:0.74rem;color:var(--text-light);">' + data + '</div>'
            + '</div>'
            + '</div>'
            + '<span style="font-size:0.8rem;color:' + cor + ';font-weight:600;white-space:nowrap;flex-shrink:0;">' + txt + '</span>'
            + '</div>'
        );
    });

    var prazosAlertasHTML = itensUnificados.length
        ? itensUnificados.join('')
        : '<p style="color:var(--text-light);font-size:0.82rem;margin:0;">Nenhum prazo ou alerta ativo.</p>';

    corpo.innerHTML = `
        <div style="display:flex;align-items:center;gap:0.9rem;margin-bottom:1.25rem;">
            <div style="width:48px;height:48px;border-radius:50%;background:var(--primary-light);
                        display:flex;align-items:center;justify-content:center;
                        font-size:1rem;font-weight:700;color:var(--primary);flex-shrink:0;">${iniciais}</div>
            <div style="min-width:0;">
                <div style="font-size:0.95rem;font-weight:700;color:var(--text-main);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(f.nome)}</div>
                <div style="font-size:0.8rem;color:var(--text-light);margin-bottom:4px;">${esc(f.funcao || '—')}</div>
                <span style="font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:20px;background:${bgSt};color:${corSt};">${status}</span>
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1.25rem;">
            ${_fichaItem('fa-building','Unidade', f.unidade || '—')}
            ${_fichaItem('fa-id-card','CPF', f.cpf || '—')}
            ${_fichaItem('fa-calendar-check','Admissão', admissao + (_tempoEmpresa ? '<br><span style="font-size:0.75rem;color:var(--text-light);">' + _tempoEmpresa + '</span>' : ''))}
            ${_fichaItem('fa-cake-candles','Nascimento', nascimento)}
        </div>

        <div class="mapa-sidebar-secao-label">Prazos &amp; Alertas</div>
        <div style="background:var(--secondary);border-radius:8px;border:1px solid var(--border);padding:0.5rem 0.75rem;margin-bottom:1.25rem;">
            ${prazosAlertasHTML}
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
            <span class="mapa-sidebar-secao-label" style="margin-bottom:0;">Notas</span>
            <button class="btn-icon" style="width:28px;height:28px;" title="Adicionar nota"
                onclick="mapaAdicionarNota('${esc(f.idFunc)}')">
                <i class="fa-solid fa-plus" style="font-size:0.75rem;"></i>
            </button>
        </div>
        <div id="mapa-notas-container-${esc(f.idFunc)}">
            ${_mapaNotasHTML(esc(f.idFunc))}
        </div>

        ${!f.desligado ? `
        <div style="margin-top:1rem;display:flex;justify-content:flex-end;">
            <button class="btn-primary" style="font-size:0.82rem;height:34px;"
                onclick="mapaFecharSidebar(); switchTab('funcionarios','${esc(f.idFunc)}')">
                <i class="fa-solid fa-pen"></i> Editar
            </button>
        </div>` : ''}
    `;
}

// ─────────────────────────────────────────────
//  SIDEBAR — UNIDADE (Etapa 3)
// ─────────────────────────────────────────────
function _mapaRenderSidebarUnidade(dado, corpo, titulo) {
    titulo.textContent = 'Unidade';

    const hoje    = moment().startOf('day');
    const urgente = configGerais.diasUrgente || 7;
    const atencao = configGerais.diasAtencao || 15;

    const funcsUnidade  = funcionariosList.filter(f => !f.desligado && f.unidade === dado.label);
    const total         = funcsUnidade.length;
    const alertas       = dado.alertas || { danger: 0, warning: 0 };

    const emAviso       = funcsUnidade.filter(f => f.emAvisoPrevio).length;
    const emExperiencia = funcsUnidade.filter(f => f.idPrazoVinculado &&
        prazosList.find(p => p.id === f.idPrazoVinculado && p.tipoCod === 'experiencia' &&
            moment(p.dataVencimento).isSameOrAfter(hoje))).length;

    // Próximos vencimentos da unidade
    const idsVinculados = new Set();
    funcsUnidade.forEach(f => {
        if (f.idPrazoVinculado) idsVinculados.add(f.idPrazoVinculado);
        if (f.idPrazoAso)       idsVinculados.add(f.idPrazoAso);
        if (f.idPrazoFgts)      idsVinculados.add(f.idPrazoFgts);
        if (f.idPrazoRescisao)  idsVinculados.add(f.idPrazoRescisao);
    });
    const nomesUnidade = new Set(funcsUnidade.map(f => (f.nome || '').toLowerCase()));
    const vencimentos  = prazosList.filter(p => {
        if (!p.dataVencimento) return false;
        const dias = moment(p.dataVencimento).diff(hoje, 'days');
        if (dias < 0 || dias > atencao) return false;
        const nomeBase = (p.nome || '').split(' (')[0].trim().toLowerCase();
        return idsVinculados.has(p.id) || nomesUnidade.has(nomeBase);
    }).sort((a, b) => moment(a.dataVencimento).diff(moment(b.dataVencimento)));

    const vencHTML = vencimentos.length ? vencimentos.slice(0, 5).map(function(p) {
        var dias = moment(p.dataVencimento).diff(hoje, 'days');
        var cor  = dias < 0 ? '#dc2626' : dias <= urgente ? 'var(--danger)' : 'var(--warning)';
        var txt  = dias < 0 ? 'Vencido há ' + Math.abs(dias) + 'd' : dias === 0 ? 'Hoje' : dias + 'd';
        var nm   = (p.nome || '').split(' (')[0].trim();
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:0.3rem 0;border-bottom:1px solid var(--border);gap:0.5rem;">'
            + '<div style="min-width:0;">'
            + '<div style="font-size:0.78rem;color:var(--text-main);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(nm) + '</div>'
            + '<div style="font-size:0.72rem;color:var(--text-light);">' + esc(p.tipo || p.tipoCod) + '</div>'
            + '</div>'
            + '<span style="font-size:0.75rem;color:' + cor + ';font-weight:600;white-space:nowrap;flex-shrink:0;">' + txt + '</span>'
            + '</div>';
    }).join('') : '<p style="color:var(--text-light);font-size:0.8rem;margin:0;">Nenhum vencimento próximo.</p>';

    function metricaCard(valor, label, cor) {
        return '<div style="background:var(--secondary);border-radius:8px;border:1px solid var(--border);padding:0.6rem 0.75rem;text-align:center;min-width:0;">'
            + '<div style="font-size:1.3rem;font-weight:700;color:' + cor + ';">' + valor + '</div>'
            + '<div style="font-size:0.72rem;color:var(--text-light);margin-top:1px;line-height:1.3;">' + label + '</div>'
            + '</div>';
    }

    const listaHTML = funcsUnidade
        .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
        .map(function(f) {
            var badges = _mapaCalcularBadgesFuncionario(f).filter(b => b.tipo !== 'ok');
            var emExp = f.idPrazoVinculado && prazosList.find(function(p) {
                return p.id === f.idPrazoVinculado && p.tipoCod === 'experiencia' && moment(p.dataVencimento).isSameOrAfter(hoje);
            });
            var corDot = badges.some(b => b.cor === '#dc2626' || b.cor === 'var(--danger)') ? 'var(--danger)'
                       : badges.some(b => b.cor === 'var(--warning)') ? 'var(--warning)'
                       : emExp ? '#3b82f6' : 'var(--success)';
            return '<div onclick="_mapaClicarFuncNaSidebar(\'' + esc(f.idFunc) + '\')"'
                + ' style="display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0.6rem;border-radius:6px;cursor:pointer;transition:background 0.15s;"'
                + ' onmouseover="this.style.background=var(--secondary)" onmouseout="this.style.background=transparent">'
                + '<span style="width:9px;height:9px;border-radius:50%;background:' + corDot + ';flex-shrink:0;"></span>'
                + '<span style="font-size:0.83rem;color:var(--text-main);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(f.nome) + '</span>'
                + '<span style="font-size:0.75rem;color:var(--text-light);">' + esc(f.funcao || '—') + '</span>'
                + '</div>';
        }).join('');

    corpo.innerHTML =
        '<div style="margin-bottom:1.25rem;">'
        + '<div style="font-size:1.05rem;font-weight:700;color:var(--text-main);margin-bottom:0.25rem;">' + esc(dado.label) + '</div>'
        + '<div style="font-size:0.82rem;color:var(--text-light);">' + total + ' funcionário' + (total !== 1 ? 's' : '') + ' ativo' + (total !== 1 ? 's' : '') + '</div>'
        + '</div>'
        + '<div class="mapa-sidebar-secao-label">Dashboard</div>'
        + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1.25rem;">'
        + metricaCard(alertas.danger  || 0, 'Urgentes',      alertas.danger      ? 'var(--danger)'  : 'var(--text-light)')
        + metricaCard(alertas.warning || 0, 'Atenção',       alertas.warning     ? 'var(--warning)' : 'var(--text-light)')
        + metricaCard(emAviso,              'Aviso Prévio',   emAviso             ? 'var(--warning)' : 'var(--text-light)')
        + metricaCard(emExperiencia,        'Em Experiência', emExperiencia       ? '#3b82f6' : 'var(--text-light)')
        + '</div>'
        + '<div class="mapa-sidebar-secao-label">Próximos Vencimentos</div>'
        + '<div style="background:var(--secondary);border-radius:8px;border:1px solid var(--border);padding:0.5rem 0.75rem;margin-bottom:1.25rem;">'
        + vencHTML + '</div>'
        + '<div class="mapa-sidebar-secao-label">Funcionários</div>'
        + '<div style="background:var(--secondary);border-radius:8px;border:1px solid var(--border);padding:0.35rem;margin-bottom:1.25rem;">'
        + (listaHTML || '<p style="color:var(--text-light);font-size:0.82rem;padding:0.4rem 0.6rem;margin:0;">Nenhum funcionário ativo.</p>')
        + '</div>'
        + '<button class="btn-secondary" style="width:100%;font-size:0.82rem;" onclick="mapaReorganizarFilhosUnidade(\'' + esc(dado.id) + '\')">'
        + '<i class="fa-solid fa-circle-nodes"></i> Reorganizar filhos</button>';
}

// Clique num funcionário da lista da sidebar de unidade → abre sidebar do funcionário
function _mapaClicarFuncNaSidebar(idFunc) {
    const no = _mapa.nos.find(n => n.idFunc === idFunc);
    if (!no) return;
    // Atualiza seleção visual no canvas
    _mapa.root.selectAll('.mapa-no').classed('selecionado', false);
    _mapa.root.selectAll('.mapa-no').filter(d => d.idFunc === idFunc).classed('selecionado', true);
    _mapa.idSelecionado = no.id;
    _mapaRenderSidebarFuncionario(no, document.getElementById('mapa-sidebar-corpo'), document.getElementById('mapa-sidebar-titulo'));
}

function mapaFecharSidebar() {
    const sidebar = document.getElementById('mapa-sidebar');
    if (!sidebar) return;

    sidebar.classList.remove('mapa-sidebar-aberta');
    sidebar.classList.add('mapa-sidebar-fechada');

    // Remove highlight de seleção
    if (_mapa.root) {
        _mapa.root.selectAll('.mapa-no').classed('selecionado', false);
    }
    _mapa.idSelecionado = null;
}

// ─────────────────────────────────────────────
//  BUSCA DE NÓS NO MAPA
// ─────────────────────────────────────────────

var _mapaBuscaIndiceAtivo = -1;

function mapaBuscaFiltrar(termo) {
    const lista = document.getElementById('mapa-busca-lista');
    if (!lista) return;

    const q = _norm((termo || '').trim());
    _mapaBuscaIndiceAtivo = -1;

    if (!q || !_mapa.nos || _mapa.nos.length === 0) {
        lista.classList.add('hidden');
        lista.innerHTML = '';
        return;
    }

    // Filtra nós por termo com score — exatos primeiro, depois aproximados
    const resultados = _mapa.nos
        .filter(function(n) { return n.tipo === 'funcionario' || n.tipo === 'unidade'; })
        .map(function(n) { return { n, score: _fuzzyScore(n.label, q) }; })
        .filter(function(r) { return r.score > 0; })
        .sort(function(a, b) {
            // Unidades antes de funcionários no mesmo score
            if (b.score !== a.score) return b.score - a.score;
            return a.n.tipo === 'unidade' ? -1 : 1;
        })
        .slice(0, 12)
        .map(function(r) { return r.n; });

    if (!resultados.length) {
        lista.innerHTML = '<div class="mapa-busca-item" style="color:var(--text-light);cursor:default;">Nenhum resultado</div>';
        lista.classList.remove('hidden');
        return;
    }

    lista.innerHTML = resultados.map(function(n, i) {
        var icone = n.tipo === 'unidade'
            ? '<i class="fa-solid fa-building" style="color:var(--text-light);font-size:0.75rem;"></i>'
            : '<i class="fa-solid fa-user" style="color:var(--text-light);font-size:0.75rem;"></i>';
        var unidadeLabel = n.tipo === 'funcionario' && n.unidade
            ? '<span class="mapa-busca-item-unidade">' + esc(n.unidade) + '</span>'
            : '';
        return '<div class="mapa-busca-item" data-idx="' + i + '" onclick="mapaBuscaSelecionar(\'' + esc(n.id) + '\')">'
            + icone
            + '<span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(n.label) + '</span>'
            + unidadeLabel
            + '</div>';
    }).join('');

    // Guarda resultados para uso no Enter
    lista._resultados = resultados;
    lista.classList.remove('hidden');
}

function mapaBuscaTecla(event) {
    const lista = document.getElementById('mapa-busca-lista');
    if (!lista || lista.classList.contains('hidden')) return;
    const items = lista.querySelectorAll('.mapa-busca-item[data-idx]');
    if (!items.length) return;

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        _mapaBuscaIndiceAtivo = Math.min(_mapaBuscaIndiceAtivo + 1, items.length - 1);
        _mapaBuscaAtualizarAtivo(items);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        _mapaBuscaIndiceAtivo = Math.max(_mapaBuscaIndiceAtivo - 1, 0);
        _mapaBuscaAtualizarAtivo(items);
    } else if (event.key === 'Enter') {
        event.preventDefault();
        var idx = _mapaBuscaIndiceAtivo >= 0 ? _mapaBuscaIndiceAtivo : 0;
        var resultados = lista._resultados;
        if (resultados && resultados[idx]) {
            mapaBuscaSelecionar(resultados[idx].id);
        }
    } else if (event.key === 'Escape') {
        mapaBuscaFechar();
    }
}

function _mapaBuscaAtualizarAtivo(items) {
    items.forEach(function(el, i) {
        el.classList.toggle('ativo', i === _mapaBuscaIndiceAtivo);
    });
}

function mapaBuscaSelecionar(noId) {
    mapaBuscaFechar();
    var no = _mapa.nos.find(function(n) { return n.id === noId; });
    if (!no) return;

    // 1. Destaca o nó (igual ao clique)
    _mapa.root.selectAll('.mapa-no').classed('selecionado', false);
    _mapa.root.selectAll('.mapa-no')
        .filter(function(d) { return d.id === noId; })
        .classed('selecionado', true);
    _mapa.idSelecionado = noId;

    // 2. Centraliza e faz zoom até o nó
    var svgEl = document.getElementById('mapa-svg');
    var W = svgEl.clientWidth || 900;
    var H = svgEl.clientHeight || 600;
    var escala = 1.6; // zoom ao focar no nó
    var tx = W / 2 - escala * no.x;
    var ty = H / 2 - escala * no.y;
    _mapa.svg.transition().duration(600)
        .call(_mapa.zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(escala));

    // 3. Abre sidebar após o pan terminar
    setTimeout(function() { mapaAbrirSidebar(no); }, 300);
}

function mapaBuscaFechar() {
    var lista = document.getElementById('mapa-busca-lista');
    var input = document.getElementById('mapa-busca-input');
    if (lista) { lista.classList.add('hidden'); lista.innerHTML = ''; }
    if (input) input.value = '';
    _mapaBuscaIndiceAtivo = -1;
}

// Fecha ao clicar fora
document.addEventListener('click', function(e) {
    var wrapper = document.querySelector('.mapa-busca-wrapper');
    if (wrapper && !wrapper.contains(e.target)) {
        var lista = document.getElementById('mapa-busca-lista');
        if (lista) lista.classList.add('hidden');
    }
});

// ─────────────────────────────────────────────
//  ETAPA 5 — TOOLBAR: CONTADOR, TOGGLE DESLIGADOS, REORGANIZAR
// ─────────────────────────────────────────────

// Estado do toggle de desligados
var _mapaExibirDesligados = false;

// Atualiza o contador de nós visíveis na toolbar
function _mapaAtualizarContador() {
    const el = document.getElementById('mapa-contador');
    if (!el || !_mapa.nos) return;
    const nUnidades    = _mapa.nos.filter(function(n) { return n.tipo === 'unidade'; }).length;
    const nFuncs       = _mapa.nos.filter(function(n) { return n.tipo === 'funcionario' && !n.desligado; }).length;
    const nDesligados  = _mapa.nos.filter(function(n) { return n.tipo === 'funcionario' && n.desligado; }).length;
    let txt = nUnidades + ' un. · ' + nFuncs + ' func.';
    if (_mapaExibirDesligados && nDesligados > 0) {
        txt += ' · ' + nDesligados + ' desl.';
    }
    el.textContent = txt;
}

// Toggle desligados — chamado pelo checkbox da toolbar
function mapaToggleDesligados(ativo) {
    _mapaExibirDesligados = ativo;
    try { localStorage.setItem('mapa_desligados', ativo ? '1' : '0'); } catch(e) {}

    if (ativo) {
        // Adiciona desligados ao mapa sem recalcular layout
        const resultado = _mapaMontarNosReais(true); // true = incluir desligados
        // Adiciona apenas os nós desligados que ainda não existem
        // Pré-calcula posições em arco por unidade para os desligados
        // Raio maior que o dos ativos para não sobrepor
        const _desligadosPorUnidade = {};
        resultado.nos.forEach(function(n) {
            if (n.desligado && !_mapa.nos.find(function(e) { return e.id === n.id; })) {
                if (!_desligadosPorUnidade[n.pai]) _desligadosPorUnidade[n.pai] = [];
                _desligadosPorUnidade[n.pai].push(n);
            }
        });

        Object.keys(_desligadosPorUnidade).forEach(function(paiId) {
            const pai = _mapa.nos.find(function(p) { return p.id === paiId; });
            if (!pai) return;
            const lista = _desligadosPorUnidade[paiId];
            // Posiciona desligados junto com os ativos no mesmo raio
            // usando os ângulos livres entre os ativos existentes
            const inputDist = document.getElementById('mapa-dist-valor');
            const distBase  = inputDist ? Math.max(60, Math.min(400, parseInt(inputDist.value) || 110)) : 110;
            const todosFilhos = _mapa.nos.filter(function(n) { return n.pai === paiId; }).length + lista.length;
            const raioMinAngular = todosFilhos > 1 ? Math.ceil((todosFilhos * 62) / (2 * Math.PI)) : 0;
            const RAIO = Math.max(distBase, raioMinAngular);
            // Conta quantos filhos já estão posicionados para continuar o arco
            const numJaExistentes = _mapa.nos.filter(function(n) { return n.pai === paiId; }).length;
            const totalFinal = numJaExistentes + lista.length;
            const aStep = (2 * Math.PI) / totalFinal;
            lista.forEach(function(n, i) {
                const angle = -Math.PI / 2 + (numJaExistentes + i) * aStep;
                n.x = pai.x + RAIO * Math.cos(angle);
                n.y = pai.y + RAIO * Math.sin(angle);
                n._vx = n.x; n._vy = n.y;
                _mapa.nos.push(n);
            });
        });
        resultado.arestas.forEach(function(a) {
            if (!_mapa.arestas.find(function(e) { return e.source === a.source && e.target === a.target; })) {
                _mapa.arestas.push(a);
            }
        });
    } else {
        // Remove desligados dos arrays
        _mapa.nos     = _mapa.nos.filter(function(n) { return !n.desligado; });
        _mapa.arestas = _mapa.arestas.filter(function(a) {
            const target = _mapa.nos.find(function(n) { return n.id === a.target; });
            return !!target;
        });
    }

    // Re-renderiza sem recalcular layout
    _mapaDesenharArestas();
    _mapaDesenharNos();

    // Aplica opacidade nos desligados
    if (ativo) {
        _mapa.root.selectAll('.mapa-no')
            .filter(function(d) { return d.desligado; })
            .classed('mapa-no-desligado', true);

        // Repulsão para resolver sobreposições após inserir desligados
        var noFakeDesl = { id: '__desl__', x: 0, y: 0, tipo: 'unidade' };
        if (_mapa.nos.length > 0) {
            noFakeDesl.x = _mapa.nos[0].x;
            noFakeDesl.y = _mapa.nos[0].y;
        }
        _mapaRepelirSobrepostos(noFakeDesl);
    }

    _mapaAtualizarContador();

    // Reorganiza filhos de todas as unidades automaticamente após toggle
    setTimeout(mapaReorganizarTodos, 80);
}

// Reorganiza filhos de UMA unidade em arco circular uniforme ao redor do pai
// uid = id do nó unidade. Anima via lerp. Salva no Firebase após conclusão.
function mapaReorganizarFilhosUnidade(uid) {
    const pai = _mapa.nos.find(function(n) { return n.id === uid; });
    if (!pai) return;

    // Inclui desligados se toggle estiver ativo (tratados igual aos ativos)
    const filhos = _mapa.nos.filter(function(n) { return n.pai === uid && (_mapaExibirDesligados || !n.desligado); });
    if (!filhos.length) return;

    // Lê distância do input da toolbar (fallback: 110)
    const inputDist = document.getElementById('mapa-dist-valor');
    const distBase  = inputDist ? Math.max(60, Math.min(400, parseInt(inputDist.value) || 110)) : 110;
    // Raio mínimo para que os filhos não se sobreponham angularmente:
    // circunferência mínima = filhos × diâmetro do nó filho (26*2 + margem 10)
    // raio_min = (filhos × 62) / (2π)
    const raioMinAngular = filhos.length > 1 ? Math.ceil((filhos.length * 62) / (2 * Math.PI)) : 0;
    const RAIO = Math.max(distBase, raioMinAngular);
    const aStep     = (2 * Math.PI) / filhos.length;

    filhos.forEach(function(filho, i) {
        const angle = -Math.PI / 2 + i * aStep;
        // Preserva _vx/_vy na posição atual para o lerp animar a partir daqui
        if (filho._vx === undefined) { filho._vx = filho.x; filho._vy = filho.y; }
        filho.x = pai.x + RAIO * Math.cos(angle);
        filho.y = pai.y + RAIO * Math.sin(angle);
    });

    // Anima via sistema lerp existente
    _mapaLerpNosLivres = _mapaLerpNosLivres.concat(filhos);
    if (_mapaLerpRafId === null) { _mapaLerpTick(); }

    // Após animação: repulsão global + save
    setTimeout(function() {
        // Roda repulsão em todos os nós para resolver sobreposições entre unidades
        if (_mapa.nos.length > 0) {
            var noFake = { id: '__reorganizar__', x: pai.x, y: pai.y, tipo: 'unidade' };
            _mapaRepelirSobrepostos(noFake);
        }
        mapaSalvarTodasPosicoes();
    }, 850);
}

// Reorganiza filhos de TODAS as unidades (botão global da toolbar)
function mapaReorganizarTodos() {
    const unidades = _mapa.nos.filter(function(n) { return n.tipo === 'unidade'; });
    // Reorganiza cada unidade — cada uma dispara repulsão+save internamente
    // Usa delay escalonado para não colidir os timeouts
    unidades.forEach(function(u, i) {
        setTimeout(function() { mapaReorganizarFilhosUnidade(u.id); }, i * 30);
    });
}

// ═══════════════════════════════════════════════════════════════════
//   AGENTE COMANDANTE POR VOZ
//   Arquitetura: STT (Web Speech API) → Gemini (payload leve) →
//   Match fuzzy local → Confirmação por voz → Execução
// ═══════════════════════════════════════════════════════════════════

// ── Estado interno do agente ──
const _agente = {
    estado: 'idle',          // idle | gravando | processando | confirmando
    recognition: null,       // instância SpeechRecognition
    silenceTimer: null,      // timer para auto-envio após 3s de silêncio
    textoFinal: '',          // transcrição confirmada
    textoParcial: '',        // transcrição em andamento (interim)
    pendingAction: null,     // objeto JSON da ação aguardando confirmação
    synth: window.speechSynthesis,
    suportado: false,        // Web Speech API disponível?
};

// ── Inicialização (chamada no DOMContentLoaded após fetchDadosNuvem) ──
function agenteInit() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('[Agente] Web Speech API não suportada neste navegador.');
        const btn = document.getElementById('agente-btn');
        if (btn) {
            btn.title = 'Reconhecimento de voz não suportado neste navegador';
            btn.style.opacity = '0.4';
            btn.style.cursor = 'not-allowed';
        }
        return;
    }

    _agente.suportado = true;

    const rec = new SpeechRecognition();
    rec.lang = 'pt-BR';
    rec.interimResults = true;   // resultados parciais para feedback visual
    rec.continuous = true;       // não para sozinho após uma frase
    rec.maxAlternatives = 1;

    // Resultado parcial ou final chegando
    rec.onresult = function(event) {
        let parcial = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const texto = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                final += texto + ' ';
            } else {
                parcial += texto;
            }
        }

        if (final) {
            _agente.textoFinal += final;
        }
        _agente.textoParcial = parcial;

        // Atualiza painel com feedback visual
        _agenteAtualizarTranscricao();

        // Reinicia o timer de silêncio sempre que há fala
        _agenteResetSilenceTimer();
    };

    rec.onerror = function(event) {
        // 'no-speech' é normal — não tratar como erro fatal
        if (event.error === 'no-speech') return;
        console.error('[Agente] Erro STT:', event.error);
        _agenteDefinirEstado('idle');
        showToast('Erro no reconhecimento de voz: ' + event.error, 'error');
    };

    rec.onend = function() {
        // SpeechRecognition parou (ex: navegador cortou)
        // Se ainda estávamos gravando, reenicia automaticamente
        if (_agente.estado === 'gravando') {
            try { rec.start(); } catch(e) { /* já rodando */ }
        }
    };

    _agente.recognition = rec;
    console.log('[Agente] Inicializado — pronto para comandos de voz.');
}

// ── Clique no botão flutuante ──
function agenteBtnClick() {
    if (!_agente.suportado) {
        showToast('Reconhecimento de voz não suportado neste navegador (use Chrome).', 'warning');
        return;
    }

    switch (_agente.estado) {
        case 'idle':
            _agenteIniciarGravacao();
            break;
        case 'gravando':
            _agenteEnviarComando();
            break;
        case 'confirmando':
            // Clique no botão durante confirmação = cancelar
            agenteConfirmar(false);
            break;
        case 'processando':
            // Não faz nada durante processamento
            break;
    }
}

// ── Iniciar gravação ──
function _agenteIniciarGravacao() {
    _agente.textoFinal = '';
    _agente.textoParcial = '';
    _agente.pendingAction = null;

    // Mostra painel
    _agenteAbrirPainel();
    _agenteDefinirEstado('gravando');

    // Limpa resposta anterior
    const elResp = document.getElementById('agente-resposta');
    const elConf = document.getElementById('agente-confirmacao');
    if (elResp) elResp.classList.add('hidden');
    if (elConf) elConf.classList.add('hidden');

    // Atualiza transcrição com placeholder animado
    const elTrans = document.getElementById('agente-transcricao');
    if (elTrans) {
        elTrans.innerHTML = '<span class="agente-placeholder">Ouvindo...</span>' +
            '<div class="agente-ondas">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
            '</div>';
    }

    try {
        _agente.recognition.start();
    } catch(e) {
        // já estava rodando
    }

    // Inicia timer de silêncio
    _agenteResetSilenceTimer();
}

// ── Reset do timer de silêncio (3s) ──
function _agenteResetSilenceTimer() {
    if (_agente.silenceTimer) clearTimeout(_agente.silenceTimer);
    _agente.silenceTimer = setTimeout(function() {
        if (_agente.estado === 'gravando') {
            const texto = (_agente.textoFinal + _agente.textoParcial).trim();
            if (texto.length > 0) {
                _agenteEnviarComando();
            }
        }
    }, 3000);
}

// ── Atualiza painel com texto transcrito ──
function _agenteAtualizarTranscricao() {
    const el = document.getElementById('agente-transcricao');
    if (!el) return;

    const final = _agente.textoFinal;
    const parcial = _agente.textoParcial;

    let html = '';
    if (final) {
        html += '<span>' + esc(final) + '</span>';
    }
    if (parcial) {
        html += '<span class="agente-parcial"> ' + esc(parcial) + '</span>';
    }
    if (!html) {
        html = '<span class="agente-placeholder">Ouvindo...</span>' +
            '<div class="agente-ondas">' +
            '<span></span><span></span><span></span><span></span><span></span>' +
            '</div>';
    }
    el.innerHTML = html;
}

// ── Enviar comando para o Gemini ──
async function _agenteEnviarComando() {
    if (_agente.silenceTimer) clearTimeout(_agente.silenceTimer);

    const texto = (_agente.textoFinal + ' ' + _agente.textoParcial).trim();

    if (!texto) {
        _agenteDefinirEstado('idle');
        showToast('Nenhuma fala detectada.', 'warning');
        return;
    }

    // Para a gravação
    try { _agente.recognition.stop(); } catch(e) {}

    _agenteDefinirEstado('processando');

    // Mostra o texto final no painel
    const elTrans = document.getElementById('agente-transcricao');
    if (elTrans) elTrans.innerHTML = '<span>' + esc(texto) + '</span>';

    const apiKey = configGerais.geminiKey ? configGerais.geminiKey.trim() : '';
    if (!apiKey) {
        showToast('Configure a chave Gemini em Configurações antes de usar o agente.', 'error');
        _agenteDefinirEstado('idle');
        return;
    }

    try {
        const acao = await _agenteChamarGemini(texto, apiKey);
        await _agenteProcessarAcao(acao, texto);
    } catch(err) {
        console.error('[Agente] Erro:', err);
        _agenteExibirResposta('❌ Erro ao processar comando: ' + err.message);
        _agenteFalarTexto('Ocorreu um erro ao processar o comando.');
        _agenteDefinirEstado('idle');
    }
}

// ── Chamada ao Gemini (payload leve) ──
async function _agenteChamarGemini(textoComando, apiKey) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + apiKey;

    // Monta lista leve de funcionários: apenas "Nome — UNIDADE" (sem IDs, sem datas)
    const listaFuncionarios = funcionariosList
        .filter(function(f) { return !f.desligado; })
        .map(function(f) { return (f.nome || '') + ' — ' + (f.unidade || ''); })
        .join('\n');

    // Data atual para contexto de datas relativas ("hoje", "sexta")
    const hoje = moment().format('YYYY-MM-DD');
    const diaSemana = moment().format('dddd');

    const systemPrompt = `Você é o Agente Comandante do sistema MyABIB, um gestor de RH.
Analise o comando de voz do usuário e retorne EXCLUSIVAMENTE um JSON válido (sem markdown, sem texto extra).

DATA ATUAL: ${hoje} (${diaSemana})

FUNCIONÁRIOS ATIVOS NO SISTEMA:
${listaFuncionarios}

AÇÕES DISPONÍVEIS:
- criar_pendencia: criar uma tarefa/pendência para um funcionário ou geral
- criar_aso: criar um prazo de exame ASO para um funcionário
- consultar_prazos: consultar prazos/vencimentos (hoje, semana, urgentes)
- consultar_pendencias: consultar pendências (por funcionário, prioridade, etc)
- navegar: ir para uma aba do sistema (dashboard, funcionarios, ponto, gastos, pendencias, historico, configuracoes, whatsapp)
- abrir_funcionario: abrir a ficha de um funcionário específico
- nao_entendido: quando o comando não for claro ou não se encaixar em nenhuma ação

CATEGORIAS VÁLIDAS para pendências: "RH", "Departamento Pessoal", "Fiscal / Contábil", "Financeiro", "TI / Suporte", "Outros"

REGRAS:
1. Se o usuário mencionar um funcionário, encontre o nome mais próximo na lista acima e use-o EXATAMENTE como está na lista.
2. Para datas relativas ("hoje", "amanhã", "sexta"), calcule a data real baseado em DATA ATUAL.
3. Se "prioridade" não for mencionada, use "media".
4. Se "categoria" não for mencionada, use "RH".
5. Para "criar_aso", o campo "descricao" deve ser "ASO Periódico — [NOME DO FUNCIONÁRIO]".

FORMATO DE RESPOSTA (JSON puro):
{
  "acao": "nome_da_acao",
  "nome_funcionario": "Nome Exato da Lista ou null",
  "unidade": "NOME DA UNIDADE ou null",
  "descricao": "descrição da pendência/prazo ou null",
  "data": "YYYY-MM-DD ou null",
  "prioridade": "alta|media|baixa",
  "categoria": "categoria válida",
  "aba_destino": "nome_da_aba ou null",
  "filtro_consulta": "hoje|urgentes|vencidos|semana|null",
  "confianca": "alta|media|baixa"
}`;

    const body = {
        contents: [{ parts: [{ text: systemPrompt + '\n\nCOMANDO DO USUÁRIO: ' + textoComando }] }],
        generationConfig: {
            temperature: 0.1,
            response_mime_type: 'application/json'
        }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json().catch(function() { return {}; });
        throw new Error('Gemini API ' + res.status + ': ' + (err.error && err.error.message ? err.error.message : res.statusText));
    }

    const data = await res.json();
    const raw = data.candidates && data.candidates[0] && data.candidates[0].content &&
                data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
                data.candidates[0].content.parts[0].text;

    if (!raw) throw new Error('Resposta vazia do Gemini');

    // Remove markdown se vier
    const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(clean);
}

// ── Match fuzzy local: nome_funcionario → idFunc ──
function _agenteResolverFuncionario(nomeGemini, unidade) {
    if (!nomeGemini) return null;

    const nomeLower = nomeGemini.toLowerCase().trim();
    const unidLower = unidade ? unidade.toLowerCase().trim() : null;

    const ativos = funcionariosList.filter(function(f) { return !f.desligado; });

    // 1. Match exato por nome
    let match = ativos.find(function(f) {
        return (f.nome || '').toLowerCase() === nomeLower;
    });
    if (match) return match;

    // 2. Match por nome + unidade
    if (unidLower) {
        match = ativos.find(function(f) {
            return (f.nome || '').toLowerCase().includes(nomeLower) &&
                   (f.unidade || '').toLowerCase().includes(unidLower);
        });
        if (match) return match;
    }

    // 3. Match parcial por nome (primeiro nome ou sobrenome)
    const partes = nomeLower.split(' ').filter(function(p) { return p.length > 2; });
    const candidatos = ativos.filter(function(f) {
        const fn = (f.nome || '').toLowerCase();
        return partes.some(function(p) { return fn.includes(p); });
    });

    if (candidatos.length === 1) return candidatos[0];

    // 4. Se há múltiplos e temos unidade, filtra por unidade
    if (candidatos.length > 1 && unidLower) {
        const filtradosPorUnidade = candidatos.filter(function(f) {
            return (f.unidade || '').toLowerCase().includes(unidLower);
        });
        if (filtradosPorUnidade.length === 1) return filtradosPorUnidade[0];
        if (filtradosPorUnidade.length > 1) return filtradosPorUnidade[0]; // pega o primeiro
    }

    if (candidatos.length > 0) return candidatos[0];
    return null;
}

// ── Processar ação retornada pelo Gemini ──
async function _agenteProcessarAcao(acao, textoOriginal) {
    console.log('[Agente] Ação recebida:', acao);

    if (!acao || !acao.acao) {
        _agenteExibirResposta('❓ Não entendi o comando. Tente ser mais específico.');
        _agenteFalarTexto('Não entendi o comando. Pode repetir?');
        _agenteDefinirEstado('idle');
        return;
    }

    switch (acao.acao) {

        // ── CONSULTAR PRAZOS ──
        case 'consultar_prazos': {
            const resposta = _agenteConsultarPrazos(acao.filtro_consulta);
            _agenteExibirResposta(resposta.html);
            _agenteFalarTexto(resposta.voz);
            _agenteDefinirEstado('idle');
            break;
        }

        // ── CONSULTAR PENDÊNCIAS ──
        case 'consultar_pendencias': {
            const func = _agenteResolverFuncionario(acao.nome_funcionario, acao.unidade);
            const resposta = _agenteConsultarPendencias(acao.filtro_consulta, func);
            _agenteExibirResposta(resposta.html);
            _agenteFalarTexto(resposta.voz);
            _agenteDefinirEstado('idle');
            break;
        }

        // ── NAVEGAR ──
        case 'navegar': {
            const aba = acao.aba_destino;
            const abasValidas = ['dashboard','pendencias','gastos','funcionarios','desligamentos','ponto','whatsapp','mapa','historico','configuracoes'];
            if (aba && abasValidas.includes(aba)) {
                _agenteExibirResposta('🗂️ Navegando para <strong>' + aba + '</strong>...');
                _agenteFalarTexto('Indo para ' + aba);
                setTimeout(function() { switchTab(aba); }, 600);
                _agenteDefinirEstado('idle');
            } else {
                _agenteExibirResposta('❓ Aba não encontrada: <strong>' + esc(aba || '?') + '</strong>');
                _agenteFalarTexto('Aba não encontrada.');
                _agenteDefinirEstado('idle');
            }
            break;
        }

        // ── ABRIR FUNCIONÁRIO ──
        case 'abrir_funcionario': {
            const func = _agenteResolverFuncionario(acao.nome_funcionario, acao.unidade);
            if (func) {
                _agenteExibirResposta('👤 Abrindo ficha de <strong>' + esc(func.nome) + '</strong>...');
                _agenteFalarTexto('Abrindo ficha de ' + func.nome);
                setTimeout(function() {
                    switchTab('funcionarios');
                    setTimeout(function() { abrirModalEditFunc(func.idFunc); }, 400);
                }, 600);
                _agenteDefinirEstado('idle');
            } else {
                _agenteExibirResposta('❓ Funcionário não encontrado: <strong>' + esc(acao.nome_funcionario || '?') + '</strong>');
                _agenteFalarTexto('Funcionário não encontrado.');
                _agenteDefinirEstado('idle');
            }
            break;
        }

        // ── CRIAR PENDÊNCIA (requer confirmação) ──
        case 'criar_pendencia': {
            const func = _agenteResolverFuncionario(acao.nome_funcionario, acao.unidade);
            const descricao = acao.descricao || textoOriginal;
            const vencimento = acao.data || '';
            const prioridade = acao.prioridade || 'media';
            const categoria = acao.categoria || 'RH';

            let textoConf = '📋 Criar pendência:\n';
            textoConf += '<strong>Descrição:</strong> ' + esc(descricao) + '<br>';
            textoConf += '<strong>Prioridade:</strong> ' + esc(prioridade) + '<br>';
            textoConf += '<strong>Categoria:</strong> ' + esc(categoria) + '<br>';
            if (vencimento) textoConf += '<strong>Vencimento:</strong> ' + moment(vencimento).format('DD/MM/YYYY') + '<br>';
            if (func) textoConf += '<strong>Funcionário:</strong> ' + esc(func.nome) + ' — ' + esc(func.unidade) + '<br>';

            let vozConf = 'Vou criar a pendência: ' + descricao;
            if (func) vozConf += ' para ' + func.nome + ' da unidade ' + func.unidade;
            vozConf += '. Confirma?';

            _agente.pendingAction = {
                tipo: 'criar_pendencia',
                dados: { descricao, vencimento, prioridade, categoria, idFunc: func ? func.idFunc : null }
            };

            _agenteExibirConfirmacao(textoConf, vozConf);
            break;
        }

        // ── CRIAR ASO (requer confirmação) ──
        case 'criar_aso': {
            const func = _agenteResolverFuncionario(acao.nome_funcionario, acao.unidade);
            if (!func) {
                _agenteExibirResposta('❓ Funcionário não encontrado para criar o ASO: <strong>' + esc(acao.nome_funcionario || '?') + '</strong>');
                _agenteFalarTexto('Funcionário não encontrado. Pode repetir o nome?');
                _agenteDefinirEstado('idle');
                return;
            }

            const dataVenc = acao.data || moment().add(7, 'days').format('YYYY-MM-DD');
            const descricao = 'ASO Periódico — ' + func.nome;

            const textoConf = '🏥 Criar prazo de ASO:<br>' +
                '<strong>Funcionário:</strong> ' + esc(func.nome) + ' — ' + esc(func.unidade) + '<br>' +
                '<strong>Vencimento:</strong> ' + moment(dataVenc).format('DD/MM/YYYY') + '<br>';

            const vozConf = 'Vou criar um prazo de ASO para ' + func.nome +
                ' da unidade ' + func.unidade +
                ', com vencimento em ' + moment(dataVenc).format('DD [de] MMMM') + '. Confirma?';

            _agente.pendingAction = {
                tipo: 'criar_aso',
                dados: { func, dataVenc, descricao }
            };

            _agenteExibirConfirmacao(textoConf, vozConf);
            break;
        }

        // ── NÃO ENTENDIDO ──
        case 'nao_entendido':
        default: {
            _agenteExibirResposta('❓ Não entendi: <em>"' + esc(textoOriginal) + '"</em><br><small style="color:var(--text-light)">Tente: "Crie uma pendência para João da Curvelo" ou "Quais prazos vencem hoje?"</small>');
            _agenteFalarTexto('Não entendi o comando. Pode repetir?');
            _agenteDefinirEstado('idle');
            break;
        }
    }
}

// ── Consultar prazos ──
function _agenteConsultarPrazos(filtro) {
    const hoje = moment().startOf('day');
    let lista = prazosList.filter(function(p) { return p.dataVencimento; });

    switch (filtro) {
        case 'hoje':
            lista = lista.filter(function(p) {
                return moment(p.dataVencimento).isSame(hoje, 'day');
            });
            break;
        case 'urgentes':
            lista = lista.filter(function(p) {
                const dias = moment(p.dataVencimento).diff(hoje, 'days');
                return dias >= 0 && dias <= configGerais.diasUrgente;
            });
            break;
        case 'vencidos':
            lista = lista.filter(function(p) {
                return moment(p.dataVencimento).isBefore(hoje);
            });
            break;
        case 'semana':
            lista = lista.filter(function(p) {
                const dias = moment(p.dataVencimento).diff(hoje, 'days');
                return dias >= 0 && dias <= 7;
            });
            break;
        default:
            // Sem filtro: próximos 15 dias
            lista = lista.filter(function(p) {
                const dias = moment(p.dataVencimento).diff(hoje, 'days');
                return dias >= 0 && dias <= 15;
            });
    }

    lista.sort(function(a, b) {
        return moment(a.dataVencimento).valueOf() - moment(b.dataVencimento).valueOf();
    });

    if (lista.length === 0) {
        const label = filtro === 'hoje' ? 'hoje' : filtro === 'urgentes' ? 'urgentes' : 'nos próximos dias';
        return {
            html: '✅ Nenhum prazo ' + label + '.',
            voz: 'Não há prazos ' + label + '.'
        };
    }

    const max = 5; // exibe no máximo 5 no painel
    let html = '<strong>' + lista.length + ' prazo(s) encontrado(s):</strong><br>';
    lista.slice(0, max).forEach(function(p) {
        const dias = moment(p.dataVencimento).diff(hoje, 'days');
        const cor = dias < 0 ? 'var(--danger)' : dias <= configGerais.diasUrgente ? 'var(--warning)' : 'var(--success)';
        const diasTexto = dias < 0 ? Math.abs(dias) + 'd atrás' : dias === 0 ? 'HOJE' : 'em ' + dias + 'd';
        html += '• <span style="color:' + cor + '">' + diasTexto + '</span> — ' + esc(p.nome) + ' (' + esc(p.tipo || p.tipoCod) + ')<br>';
    });
    if (lista.length > max) html += '<small style="color:var(--text-light)">...e mais ' + (lista.length - max) + ' prazos.</small>';

    // Texto para TTS (mais conciso)
    let voz = lista.length + ' prazo' + (lista.length > 1 ? 's' : '') + ' encontrado' + (lista.length > 1 ? 's' : '') + '. ';
    lista.slice(0, 3).forEach(function(p) {
        const dias = moment(p.dataVencimento).diff(hoje, 'days');
        const diasTexto = dias < 0 ? 'venceu há ' + Math.abs(dias) + ' dias' : dias === 0 ? 'vence hoje' : 'vence em ' + dias + ' dias';
        voz += p.nome + ', ' + diasTexto + '. ';
    });

    return { html, voz };
}

// ── Consultar pendências ──
function _agenteConsultarPendencias(filtro, func) {
    let lista = pendenciasList.filter(function(p) { return !p.concluida; });

    if (func) {
        lista = lista.filter(function(p) { return p.idFunc === func.idFunc; });
    }

    switch (filtro) {
        case 'urgentes':
            lista = lista.filter(function(p) { return p.prioridade === 'alta'; });
            break;
        case 'hoje':
            const hoje = moment().startOf('day');
            lista = lista.filter(function(p) {
                return p.vencimento && moment(p.vencimento).isSame(hoje, 'day');
            });
            break;
        case 'vencidos':
            lista = lista.filter(function(p) {
                return p.vencimento && moment(p.vencimento).isBefore(moment().startOf('day'));
            });
            break;
    }

    lista.sort(function(a, b) {
        const peso = { alta: 3, media: 2, baixa: 1 };
        return (peso[b.prioridade] || 0) - (peso[a.prioridade] || 0);
    });

    if (lista.length === 0) {
        const quem = func ? ' para ' + func.nome : '';
        return {
            html: '✅ Nenhuma pendência aberta' + quem + '.',
            voz: 'Não há pendências abertas' + quem + '.'
        };
    }

    const max = 5;
    const quem = func ? ' de <strong>' + esc(func.nome) + '</strong>' : '';
    let html = '<strong>' + lista.length + ' pendência(s)' + quem + ':</strong><br>';
    lista.slice(0, max).forEach(function(p) {
        const cor = p.prioridade === 'alta' ? 'var(--danger)' : p.prioridade === 'media' ? 'var(--warning)' : 'var(--text-light)';
        html += '• <span style="color:' + cor + '">[' + (p.prioridade || '—').toUpperCase() + ']</span> ' + esc(p.descricao || '—') + '<br>';
    });
    if (lista.length > max) html += '<small style="color:var(--text-light)">...e mais ' + (lista.length - max) + '.</small>';

    let voz = lista.length + ' pendência' + (lista.length > 1 ? 's' : '') + (func ? ' para ' + func.nome : '') + '. ';
    lista.slice(0, 3).forEach(function(p) {
        voz += p.descricao + ', prioridade ' + (p.prioridade || 'média') + '. ';
    });

    return { html, voz };
}

// ── Exibir confirmação no painel ──
function _agenteExibirConfirmacao(textoHtml, textoVoz) {
    const elConf = document.getElementById('agente-confirmacao');
    const elTexto = document.getElementById('agente-confirmacao-texto');
    const elResp = document.getElementById('agente-resposta');

    if (elResp) elResp.classList.add('hidden');
    if (elConf) elConf.classList.remove('hidden');
    if (elTexto) elTexto.innerHTML = textoHtml;

    _agenteDefinirEstado('confirmando');
    _agenteFalarTexto(textoVoz);
}

// ── Confirmar ou cancelar ação pendente ──
function agenteConfirmar(confirmado) {
    _agente.synth.cancel(); // para TTS em andamento

    if (!confirmado || !_agente.pendingAction) {
        _agenteExibirResposta('❌ Ação cancelada.');
        _agenteFalarTexto('Ação cancelada.');
        _agente.pendingAction = null;
        _agenteDefinirEstado('idle');
        return;
    }

    const pa = _agente.pendingAction;
    _agente.pendingAction = null;

    try {
        if (pa.tipo === 'criar_pendencia') {
            _agenteExecutarCriarPendencia(pa.dados);
        } else if (pa.tipo === 'criar_aso') {
            _agenteExecutarCriarAso(pa.dados);
        }
    } catch(err) {
        console.error('[Agente] Erro ao executar:', err);
        _agenteExibirResposta('❌ Erro ao executar: ' + err.message);
        _agenteFalarTexto('Ocorreu um erro.');
    }

    _agenteDefinirEstado('idle');
}

// ── Executar: criar pendência ──
function _agenteExecutarCriarPendencia(dados) {
    const novaPendencia = {
        id: 'PEN_' + Date.now(),
        descricao: dados.descricao,
        categoria: dados.categoria || 'RH',
        prioridade: dados.prioridade || 'media',
        vencimento: dados.vencimento || '',
        notificar: false,
        idFunc: dados.idFunc || null,
        concluida: false,
        dataCriacao: moment().format('YYYY-MM-DD')
    };

    pendenciasList.push(novaPendencia);
    salvarDados();
    renderPendencias();
    if (typeof renderDeadlines === 'function') renderDeadlines();
    if (typeof mapaAtualizarTodosBadges === 'function' && _mapa.nos.length > 0) {
        mapaAtualizarTodosBadges();
    }

    const msg = '✅ Pendência criada: <strong>' + esc(dados.descricao) + '</strong>';
    _agenteExibirResposta(msg);
    _agenteFalarTexto('Pendência criada com sucesso.');
    showToast('Pendência criada pelo Agente de Voz', 'success');
    registrarHistorico('pendencia', 'Agente de Voz: Pendência criada', dados.descricao);
}

// ── Executar: criar prazo ASO ──
function _agenteExecutarCriarAso(dados) {
    const novoPrazo = {
        id: 'ASO_' + Date.now(),
        nome: dados.func.nome,
        tipoCod: 'aso',
        dataBase: moment().format('YYYY-MM-DD'),
        tipo: 'ASO Periódico',
        dataVencimento: dados.dataVenc
    };

    prazosList.push(novoPrazo);
    salvarDados();
    renderDeadlines();

    const msg = '✅ Prazo ASO criado para <strong>' + esc(dados.func.nome) + '</strong> — vence em ' + moment(dados.dataVenc).format('DD/MM/YYYY');
    _agenteExibirResposta(msg);
    _agenteFalarTexto('Prazo de ASO criado para ' + dados.func.nome + '.');
    showToast('Prazo ASO criado pelo Agente de Voz', 'success');
    registrarHistorico('prazo', 'Agente de Voz: ASO criado', dados.func.nome + ' — ' + dados.dataVenc);
}

// ── Exibir resposta no painel ──
function _agenteExibirResposta(html) {
    const elResp = document.getElementById('agente-resposta');
    const elConf = document.getElementById('agente-confirmacao');
    if (elConf) elConf.classList.add('hidden');
    if (elResp) {
        elResp.innerHTML = html;
        elResp.classList.remove('hidden');
    }
}

// ── Text-to-Speech ──
function _agenteFalarTexto(texto) {
    if (!_agente.synth) return;
    _agente.synth.cancel();
    const utt = new SpeechSynthesisUtterance(texto);
    utt.lang = 'pt-BR';
    utt.rate = 1.05;
    utt.pitch = 1;
    _agente.synth.speak(utt);
}

// ── Abrir painel ──
function _agenteAbrirPainel() {
    const el = document.getElementById('agente-painel');
    if (el) el.classList.remove('agente-painel-oculto');
}

// ── Fechar painel ──
function agenteFecharPainel() {
    const el = document.getElementById('agente-painel');
    if (el) el.classList.add('agente-painel-oculto');
    if (_agente.estado === 'gravando') {
        try { _agente.recognition.stop(); } catch(e) {}
    }
    if (_agente.silenceTimer) clearTimeout(_agente.silenceTimer);
    _agente.synth.cancel();
    _agente.pendingAction = null;
    _agenteDefinirEstado('idle');
}

// ── Definir estado visual do botão ──
function _agenteDefinirEstado(novoEstado) {
    _agente.estado = novoEstado;
    const btn = document.getElementById('agente-btn');
    const icone = document.getElementById('agente-btn-icone');
    const label = document.getElementById('agente-btn-label');
    if (!btn || !icone || !label) return;

    // Remove todas as classes de estado
    btn.classList.remove('agente-gravando', 'agente-processando', 'agente-confirmando');

    switch (novoEstado) {
        case 'idle':
            icone.className = 'fa-solid fa-microphone';
            label.textContent = 'Falar';
            break;
        case 'gravando':
            btn.classList.add('agente-gravando');
            icone.className = 'fa-solid fa-stop';
            label.textContent = 'Parar';
            break;
        case 'processando':
            btn.classList.add('agente-processando');
            icone.className = 'fa-solid fa-spinner fa-spin';
            label.textContent = '...';
            break;
        case 'confirmando':
            btn.classList.add('agente-confirmando');
            icone.className = 'fa-solid fa-question';
            label.textContent = 'Conf.';
            break;
    }
}
