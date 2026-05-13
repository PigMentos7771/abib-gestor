/**
 * Exames médicos ocupacionais — lista, agendamento (área de transferência), status.
 * Depende de: examesMedicosList, configGerais, salvarDados, showToast, showConfirm, esc, moment
 */

const EXAMES_FUNCOES_OPCOES = [
    'Auxiliar nos serviços de alimentação',
    'Cozinheiro(a)',
    'Nutricionista'
];

const EXAMES_TIPO_OPCOES = [
    { value: 'admissional', label: 'Admissional' },
    { value: 'demissional', label: 'Demissional' },
    { value: 'troca_funcao', label: 'Troca de função' },
    { value: 'periodico', label: 'Periódico' }
];

function examesTipoLabel(val) {
    const o = EXAMES_TIPO_OPCOES.find(function (x) { return x.value === val; });
    return o ? o.label : (val || '—');
}

/** Nome e cidade: primeira letra de cada palavra maiúscula, restante minúscula. */
function examesFormatarIniciaisMaiusculas(str) {
    if (!str || typeof str !== 'string') return '';
    return str.trim().split(/\s+/).map(function (word) {
        if (!word) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    }).join(' ');
}

/** @param {object} ex @param {moment.Moment} [momentoAgendamentoExame] data/hora informada ao agendar (ou já salva em ex) */
function montarTextoAgendamentoExame(ex, momentoAgendamentoExame) {
    const def = '63.098.051/0001-18';
    const cnpj = (configGerais && configGerais.cnpjExameTrabalho && String(configGerais.cnpjExameTrabalho).trim())
        ? String(configGerais.cnpjExameTrabalho).trim()
        : def;
    const dn = ex.dataNascimento ? moment(ex.dataNascimento).format('DD/MM/YYYY') : '';
    const nomeFmt = examesFormatarIniciaisMaiusculas(ex.nome || '');
    const cidadeFmt = examesFormatarIniciaisMaiusculas(ex.cidade || '');
    let mAg = momentoAgendamentoExame;
    if ((!mAg || typeof mAg.isValid !== 'function' || !mAg.isValid()) && ex.dataAgendamento) {
        mAg = moment(ex.dataAgendamento);
    }
    let linhaAg = '';
    if (mAg && typeof mAg.isValid === 'function' && mAg.isValid()) {
        linhaAg = '\n🔵 Data e horário do exame: ' + mAg.format('DD/MM/YYYY [às] HH:mm');
    }
    return '🔵 CNPJ da empresa: ' + cnpj + '\n' +
        '🔵 Nome completo do colaborador: ' + nomeFmt + '\n' +
        '🔵 CPF: ' + (ex.cpf || '') + '\n' +
        '🔵 Data de nascimento: ' + dn + '\n' +
        '🔵 Função exercida: ' + (ex.funcao || '') + '\n' +
        '🔵 Cidade que deseja agendamento: ' + cidadeFmt + '\n' +
        '🔵 Tipo de exame: ' + examesTipoLabel(ex.tipoExame) + linhaAg;
}

async function examesCopiarParaAreaTransferencia(texto) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(texto);
            return true;
        }
    } catch (e) { /* fallback abaixo */ }
    try {
        const ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.setAttribute('aria-hidden', 'true');
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.width = '2em';
        ta.style.height = '2em';
        ta.style.padding = '0';
        ta.style.border = 'none';
        ta.style.outline = 'none';
        ta.style.boxShadow = 'none';
        ta.style.background = 'transparent';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, texto.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e2) {
        return false;
    }
}

function popularSelectExameTipo() {
    const sel = document.getElementById('exame-tipo');
    if (!sel || sel._populado) return;
    sel.innerHTML = EXAMES_TIPO_OPCOES.map(function (o) {
        return '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>';
    }).join('');
    sel._populado = true;
}

function popularSelectExameFuncao() {
    const sel = document.getElementById('exame-funcao');
    if (!sel || sel._populado) return;
    sel.innerHTML = EXAMES_FUNCOES_OPCOES.map(function (t) {
        return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
    }).join('');
    sel._populado = true;
}

function fecharModalExameMedico() {
    const m = document.getElementById('modal-exame-medico');
    if (m) m.classList.add('hidden');
}

function abrirModalExameMedico(id) {
    popularSelectExameTipo();
    popularSelectExameFuncao();
    const m = document.getElementById('modal-exame-medico');
    const titulo = document.getElementById('modal-exame-medico-titulo');
    const hid = document.getElementById('exame-id');
    if (!m || !titulo || !hid) return;

    document.getElementById('exame-nome').value = '';
    document.getElementById('exame-cpf').value = '';
    document.getElementById('exame-nascimento').value = '';
    document.getElementById('exame-cidade').value = '';
    document.getElementById('exame-funcao').selectedIndex = 0;
    document.getElementById('exame-tipo').selectedIndex = 0;

    if (id) {
        const it = examesMedicosList.find(function (x) { return x.id === id; });
        if (!it || it.status !== 'pendente') {
            showToast('Só é possível editar exames pendentes.', 'warning');
            return;
        }
        titulo.textContent = 'Editar exame (pendente)';
        hid.value = it.id;
        document.getElementById('exame-nome').value = it.nome || '';
        document.getElementById('exame-cpf').value = it.cpf || '';
        document.getElementById('exame-nascimento').value = it.dataNascimento || '';
        document.getElementById('exame-cidade').value = it.cidade || '';
        var sf = document.getElementById('exame-funcao');
        if (sf) sf.value = it.funcao || EXAMES_FUNCOES_OPCOES[0];
        var st = document.getElementById('exame-tipo');
        if (st) st.value = it.tipoExame || 'admissional';
    } else {
        titulo.textContent = 'Novo exame médico';
        hid.value = '';
    }
    m.classList.remove('hidden');
}

function salvarExameMedicoForm(ev) {
    ev.preventDefault();
    const hid = document.getElementById('exame-id');
    const nome = document.getElementById('exame-nome').value.trim();
    const cpf = document.getElementById('exame-cpf').value.trim();
    const dataNascimento = document.getElementById('exame-nascimento').value;
    const cidade = document.getElementById('exame-cidade').value.trim();
    const funcao = document.getElementById('exame-funcao').value;
    const tipoExame = document.getElementById('exame-tipo').value;

    if (!nome || !cpf || !dataNascimento || !cidade) {
        showToast('Preencha nome, CPF, data de nascimento e cidade.', 'warning');
        return;
    }

    const nomeFmt = examesFormatarIniciaisMaiusculas(nome);
    const cidadeFmt = examesFormatarIniciaisMaiusculas(cidade);

    if (hid.value) {
        const idx = examesMedicosList.findIndex(function (x) { return x.id === hid.value; });
        if (idx === -1) return;
        if (examesMedicosList[idx].status !== 'pendente') {
            showToast('Este exame não está mais pendente.', 'warning');
            return;
        }
        examesMedicosList[idx] = Object.assign({}, examesMedicosList[idx], {
            nome: nomeFmt,
            cpf: cpf,
            dataNascimento: dataNascimento,
            cidade: cidadeFmt,
            funcao: funcao,
            tipoExame: tipoExame
        });
    } else {
        examesMedicosList.push({
            id: 'EXM_' + Date.now(),
            status: 'pendente',
            nome: nomeFmt,
            cpf: cpf,
            dataNascimento: dataNascimento,
            cidade: cidadeFmt,
            funcao: funcao,
            tipoExame: tipoExame,
            dataCriacao: moment().format('YYYY-MM-DD')
        });
    }

    salvarDados();
    fecharModalExameMedico();
    renderExamesMedicos();
    showToast('Exame salvo.', 'success');
}

function fecharModalAgendarExame() {
    var m = document.getElementById('modal-exame-agendar');
    if (m) m.classList.add('hidden');
}

function abrirModalAgendarExame(id) {
    var idx = examesMedicosList.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    var ex = examesMedicosList[idx];
    if (ex.status !== 'pendente') return;

    if (!ex.nome || !ex.cpf || !ex.dataNascimento || !ex.cidade) {
        showToast('Complete os dados do exame antes de agendar.', 'warning');
        return;
    }

    var hid = document.getElementById('exame-agendar-id');
    var inpD = document.getElementById('exame-agendar-data');
    var inpT = document.getElementById('exame-agendar-hora');
    var modal = document.getElementById('modal-exame-agendar');
    if (!hid || !inpD || !inpT || !modal) return;

    hid.value = id;
    inpD.value = moment().format('YYYY-MM-DD');
    inpT.value = '';

    modal.classList.remove('hidden');
    setTimeout(function () {
        inpT.focus();
    }, 120);
}

async function confirmarAgendarExame(ev) {
    ev.preventDefault();
    var id = document.getElementById('exame-agendar-id').value;
    var d = document.getElementById('exame-agendar-data').value;
    var t = document.getElementById('exame-agendar-hora').value;
    if (!id || !d || !t) {
        showToast('Preencha data e horário.', 'warning');
        return;
    }
    var mDt = moment(d + ' ' + t, 'YYYY-MM-DD HH:mm', true);
    if (!mDt.isValid()) {
        showToast('Data ou horário inválidos.', 'warning');
        return;
    }

    var idx = examesMedicosList.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    var ex = examesMedicosList[idx];
    if (ex.status !== 'pendente') return;

    var texto = montarTextoAgendamentoExame(ex, mDt);
    var ok = await examesCopiarParaAreaTransferencia(texto);
    if (!ok) {
        showToast('Não foi possível copiar. Copie manualmente da mensagem.', 'error');
        return;
    }

    examesMedicosList[idx].nome = examesFormatarIniciaisMaiusculas(ex.nome || '');
    examesMedicosList[idx].cidade = examesFormatarIniciaisMaiusculas(ex.cidade || '');
    examesMedicosList[idx].status = 'agendado';
    examesMedicosList[idx].dataAgendamento = mDt.format('YYYY-MM-DD HH:mm:ss');
    salvarDados();
    fecharModalAgendarExame();
    renderExamesMedicos();
    showToast('Texto copiado para a área de transferência e exame marcado como agendado.', 'success');
}

function exameAcaoConcluir(id) {
    const idx = examesMedicosList.findIndex(function (x) { return x.id === id; });
    if (idx === -1) return;
    if (examesMedicosList[idx].status !== 'agendado') return;
    examesMedicosList[idx].status = 'concluido';
    examesMedicosList[idx].dataConclusao = moment().format('YYYY-MM-DD');
    salvarDados();
    renderExamesMedicos();
    showToast('Exame concluído.', 'success');
}

/** Copia de novo o texto de solicitação (exames já agendados). */
async function exameAcaoCopiarTextoNovamente(id) {
    const ex = examesMedicosList.find(function (x) { return x.id === id; });
    if (!ex || ex.status !== 'agendado') return;
    const texto = montarTextoAgendamentoExame(ex);
    const ok = await examesCopiarParaAreaTransferencia(texto);
    if (ok) {
        showToast('Texto copiado novamente para a área de transferência.', 'success');
    } else {
        showToast('Não foi possível copiar. Tente de novo ou copie manualmente.', 'error');
    }
}

function exameAcaoExcluir(id) {
    showConfirm('Deseja realmente remover este registro de exame?').then(function (sim) {
        if (!sim) return;
        examesMedicosList = examesMedicosList.filter(function (x) { return x.id !== id; });
        salvarDados();
        renderExamesMedicos();
        showToast('Registro removido.', 'success');
    });
}

function renderExamesMedicos() {
    const tbody = document.getElementById('exames-medicos-list');
    const emptyEl = document.getElementById('empty-state-exames');
    const showConcl = document.getElementById('exames-show-concluidos') &&
        document.getElementById('exames-show-concluidos').checked;
    if (!tbody) return;

    const q = _norm(document.getElementById('search-exames') ? document.getElementById('search-exames').value : '');

    let rows = examesMedicosList.filter(function (ex) {
        if (ex.status === 'concluido' && !showConcl) return false;
        if (!q) return true;
        const blob = _norm([ex.nome, ex.cpf, ex.cidade, ex.funcao, examesTipoLabel(ex.tipoExame)].join(' '));
        return blob.indexOf(q) !== -1;
    });

    rows.sort(function (a, b) {
        var oa = a.status === 'pendente' ? 0 : a.status === 'agendado' ? 1 : 2;
        var ob = b.status === 'pendente' ? 0 : b.status === 'agendado' ? 1 : 2;
        if (oa !== ob) return oa - ob;
        return (b.dataCriacao || '').localeCompare(a.dataCriacao || '');
    });

    var nPen = examesMedicosList.filter(function (x) { return x.status === 'pendente'; }).length;
    var nAgen = examesMedicosList.filter(function (x) { return x.status === 'agendado'; }).length;
    var nConc = examesMedicosList.filter(function (x) { return x.status === 'concluido'; }).length;
    var elPen = document.getElementById('count-exames-pendentes');
    var elAgen = document.getElementById('count-exames-agendados');
    var elConc = document.getElementById('count-exames-concluidos');
    if (elPen) elPen.textContent = String(nPen);
    if (elAgen) elAgen.textContent = String(nAgen);
    if (elConc) elConc.textContent = String(nConc);

    if (rows.length === 0) {
        tbody.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    tbody.innerHTML = rows.map(function (ex) {
        var st = ex.status;
        // Mesmo padrão visual da coluna Prioridade em Gestão de Pendências (status-badge + borda)
        var badgeCor = 'var(--primary)';
        if (st === 'pendente') badgeCor = 'var(--warning)';
        if (st === 'agendado') badgeCor = '#3b82f6';
        if (st === 'concluido') badgeCor = 'var(--success)';
        var badgeLabel = st === 'pendente' ? 'PENDENTE' : st === 'agendado' ? 'AGENDADO' : 'CONCLUÍDO';
        var badge = '<span class="status-badge" style="background:transparent;border:1px solid ' + badgeCor + ';color:' + badgeCor + ';font-weight:600;">' + badgeLabel + '</span>';
        var nasc = ex.dataNascimento ? moment(ex.dataNascimento).format('DD/MM/YYYY') : '—';

        var acoes = '';
        var eid = ex.id;
        // Mesmo padrão das pendências: btn-icon + tonalidade (btn-edit / btn-calendar / btn-delete / btn-success)
        if (st === 'pendente') {
            acoes =
                '<button type="button" class="btn-icon btn-edit" onclick="abrirModalExameMedico(\'' + eid + '\')" title="Editar"><i class="fa-solid fa-pen"></i></button>' +
                '<button type="button" class="btn-icon btn-calendar" onclick="abrirModalAgendarExame(\'' + eid + '\')" title="Agendar — informe data/hora, copia o texto e marca como agendado"><i class="fa-solid fa-calendar-plus"></i></button>' +
                '<button type="button" class="btn-icon btn-delete" onclick="exameAcaoExcluir(\'' + eid + '\')" title="Excluir"><i class="fa-solid fa-trash"></i></button>';
        } else if (st === 'agendado') {
            acoes =
                '<button type="button" class="btn-icon btn-calendar" onclick="exameAcaoCopiarTextoNovamente(\'' + eid + '\')" title="Copiar texto de solicitação novamente"><i class="fa-solid fa-copy"></i></button>' +
                '<button type="button" class="btn-icon btn-success" onclick="exameAcaoConcluir(\'' + eid + '\')" title="Marcar como concluído"><i class="fa-solid fa-circle-check"></i></button>' +
                '<button type="button" class="btn-icon btn-delete" onclick="exameAcaoExcluir(\'' + eid + '\')" title="Excluir"><i class="fa-solid fa-trash"></i></button>';
        } else {
            acoes = '<button type="button" class="btn-icon btn-delete" onclick="exameAcaoExcluir(\'' + eid + '\')" title="Excluir"><i class="fa-solid fa-trash"></i></button>';
        }

        var nomeEx = ex.nome ? examesFormatarIniciaisMaiusculas(ex.nome) : '—';
        var cidadeEx = ex.cidade ? examesFormatarIniciaisMaiusculas(ex.cidade) : '—';
        var agendPara = '—';
        if (ex.dataAgendamento) {
            var mA = moment(ex.dataAgendamento);
            if (mA.isValid()) agendPara = mA.format('DD/MM/YYYY HH:mm');
        }
        return '<tr data-exame-id="' + esc(ex.id) + '">' +
            '<td>' + badge + '</td>' +
            '<td>' + esc(nomeEx) + '</td>' +
            '<td>' + esc(ex.cpf || '—') + '</td>' +
            '<td>' + esc(nasc) + '</td>' +
            '<td>' + esc(cidadeEx) + '</td>' +
            '<td>' + esc(ex.funcao || '—') + '</td>' +
            '<td>' + esc(examesTipoLabel(ex.tipoExame)) + '</td>' +
            '<td>' + esc(agendPara) + '</td>' +
            '<td class="action-buttons" style="justify-content: flex-end;">' + acoes + '</td>' +
            '</tr>';
    }).join('');
}
