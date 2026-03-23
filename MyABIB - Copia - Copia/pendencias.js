// --- MODULO DE PENDENCIAS (ISOLADO) ---

function abrirModalPendencia(id = null) {
    console.log("Chamando abrirModalPendencia, ID:", id);
    const modal = document.getElementById('modal-pendencia');
    const form = document.getElementById('form-pendencia');
    const titulo = document.getElementById('modal-pendencia-titulo');

    if (!modal || !form || !titulo) {
        console.error("Erro: Elementos do modal de pendencia nao encontrados.");
        return;
    }

    form.reset();
    if (document.getElementById('pendencia-id')) document.getElementById('pendencia-id').value = '';
    if (document.getElementById('pendencia-idFunc')) document.getElementById('pendencia-idFunc').value = '';
    titulo.textContent = 'Nova Pendencia';

    // Popula select de funcionários
    var sel = document.getElementById('pendencia-idFunc-select');
    if (sel && typeof funcionariosList !== 'undefined') {
        // Usa DocumentFragment para um único reflow no DOM em vez de 83+ individuais
        var frag = document.createDocumentFragment();
        var optDefault = document.createElement('option');
        optDefault.value = '';
        optDefault.textContent = 'Nenhum (pendência geral)';
        frag.appendChild(optDefault);

        var ativos = funcionariosList.filter(function(f) { return !f.desligado; });
        ativos.sort(function(a,b) { return (a.nome||'').localeCompare(b.nome||''); });
        ativos.forEach(function(f) {
            var opt = document.createElement('option');
            opt.value = f.idFunc;
            opt.textContent = f.nome + (f.unidade ? ' — ' + f.unidade : '');
            frag.appendChild(opt);
        });

        sel.innerHTML = '';
        sel.appendChild(frag); // único reflow
    }

    if (id) {
        if (typeof pendenciasList !== 'undefined') {
            const item = pendenciasList.find(p => p.id === id);
            if (item) {
                titulo.textContent = 'Editar Pendencia';
                if (document.getElementById('pendencia-id')) document.getElementById('pendencia-id').value = item.id;
                if (document.getElementById('pendencia-descricao')) document.getElementById('pendencia-descricao').value = item.descricao;
                if (document.getElementById('pendencia-categoria')) document.getElementById('pendencia-categoria').value = item.categoria;
                if (document.getElementById('pendencia-prioridade')) document.getElementById('pendencia-prioridade').value = item.prioridade;
                if (document.getElementById('pendencia-vencimento')) document.getElementById('pendencia-vencimento').value = item.vencimento || '';
                if (document.getElementById('pendencia-notificar')) document.getElementById('pendencia-notificar').checked = !!item.notificar;
                if (document.getElementById('pendencia-idFunc-select')) document.getElementById('pendencia-idFunc-select').value = item.idFunc || '';
            }
        }
    }

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function fecharModalPendencia() {
    console.log("Fechando modal pendencia");
    const modal = document.getElementById('modal-pendencia');
    if (modal) modal.classList.add('hidden');
    document.body.style.overflow = '';
}

function salvarPendencia(event) {
    event.preventDefault();
    console.log("Salvando pendencia...");
    const id = document.getElementById('pendencia-id').value;
    const descricao = document.getElementById('pendencia-descricao').value;
    const categoria = document.getElementById('pendencia-categoria').value;
    const prioridade = document.getElementById('pendencia-prioridade').value;
    const vencimento = document.getElementById('pendencia-vencimento').value;
    const notificar = document.getElementById('pendencia-notificar').checked;
    const idFuncVinc = document.getElementById('pendencia-idFunc-select') ? document.getElementById('pendencia-idFunc-select').value : '';

    const novaData = {
        descricao,
        categoria,
        prioridade,
        vencimento,
        notificar,
        idFunc: idFuncVinc || null
    };

    if (id) {
        const index = pendenciasList.findIndex(p => p.id === id);
        if (index !== -1) {
            pendenciasList[index] = { ...pendenciasList[index], ...novaData };
        }
    } else {
        pendenciasList.push({
            id: 'PEN_' + Date.now(),
            ...novaData,
            concluida: false,
            dataCriacao: moment().format('YYYY-MM-DD')
        });
    }

    if (typeof salvarDados === 'function') salvarDados();
    fecharModalPendencia();
    renderPendencias();
    if (typeof renderDeadlines === 'function') renderDeadlines();

    if (typeof mapaAtualizarTodosBadges === 'function' && typeof _mapa !== 'undefined' && _mapa.nos && _mapa.nos.length > 0) {
        mapaAtualizarTodosBadges();
        // Atualiza sidebar se estiver aberta
        if (_mapa.idSelecionado) {
            var noAberto = _mapa.nos.find(function(n) { return n.id === _mapa.idSelecionado; });
            if (noAberto) mapaAbrirSidebar(noAberto);
        }
    }
    if (typeof showToast === 'function') showToast("Pendencia salva com sucesso.", "success");
}

function concluirPendencia(id) {
    const index = pendenciasList.findIndex(p => p.id === id);
    if (index !== -1) {
        pendenciasList[index].concluida = !pendenciasList[index].concluida;
        if (pendenciasList[index].concluida) {
            pendenciasList[index].dataConclusao = moment().format('YYYY-MM-DD');
        } else {
            pendenciasList[index].dataConclusao = null;
        }
        if (typeof salvarDados === 'function') salvarDados();
        renderPendencias();
        if (typeof renderDeadlines === 'function') renderDeadlines();
    if (typeof mapaAtualizarTodosBadges === 'function' && typeof _mapa !== 'undefined' && _mapa.nos && _mapa.nos.length > 0) {
                mapaAtualizarTodosBadges();
        // Atualiza sidebar se estiver aberta
        if (_mapa.idSelecionado) {
            var noAberto = _mapa.nos.find(function(n) { return n.id === _mapa.idSelecionado; });
            if (noAberto) mapaAbrirSidebar(noAberto);
        }
    }
        const msg = pendenciasList[index].concluida ? "Concluida!" : "Reaberta!";
        if (typeof showToast === 'function') showToast(msg, "success");
    }
}

function apagarPendencia(id) {
    if (typeof showConfirm === 'function') {
        showConfirm("Deseja realmente apagar esta pendencia?").then(confirmou => {
            if (confirmou) {
                pendenciasList = pendenciasList.filter(p => p.id !== id);
                if (typeof salvarDados === 'function') salvarDados();
                renderPendencias();
                if (typeof renderDeadlines === 'function') renderDeadlines();
    if (typeof mapaAtualizarTodosBadges === 'function' && typeof _mapa !== 'undefined' && _mapa.nos && _mapa.nos.length > 0) {
                mapaAtualizarTodosBadges();
        // Atualiza sidebar se estiver aberta
        if (_mapa.idSelecionado) {
            var noAberto = _mapa.nos.find(function(n) { return n.id === _mapa.idSelecionado; });
            if (noAberto) mapaAbrirSidebar(noAberto);
        }
    }
                if (typeof showToast === 'function') showToast("Pendencia removida.", "success");
            }
        });
    } else if (confirm("Deseja realmente apagar esta pendencia?")) {
        pendenciasList = pendenciasList.filter(p => p.id !== id);
        if (typeof salvarDados === 'function') salvarDados();
        renderPendencias();
        if (typeof renderDeadlines === 'function') renderDeadlines();
    }
}

function sortPendencias(field) {
    if (typeof currentSortPend === 'undefined') window.currentSortPend = { field: null, asc: true };
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

    const searchTerm = document.getElementById('search-pendencias') ? document.getElementById('search-pendencias').value.toLowerCase() : '';
    const prioridadeFiltro = document.getElementById('filter-pendencia-prioridade') ? document.getElementById('filter-pendencia-prioridade').value : 'todas';
    const verConcluidas = document.getElementById('show-concluidas') ? document.getElementById('show-concluidas').checked : false;

    tbody.innerHTML = '';

    let filtradas = pendenciasList.filter(p => {
        const matchBusca = (p.descricao || '').toLowerCase().includes(searchTerm);
        const matchPrioridade = prioridadeFiltro === 'todas' || p.prioridade === prioridadeFiltro;
        const matchConcluida = verConcluidas ? true : !p.concluida;
        return matchBusca && matchPrioridade && matchConcluida;
    });

    const pesoPrioridade = { alta: 3, media: 2, baixa: 1 };
    const sortState = (typeof currentSortPend !== 'undefined') ? currentSortPend : { field: null, asc: true };

    if (sortState.field) {
        filtradas.sort((a, b) => {
            if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
            const field = sortState.field;
            const dir = sortState.asc ? 1 : -1;
            if (field === 'vencimento') {
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
                <div style="font-weight: 500; ${p.concluida ? 'text-decoration: line-through;' : ''}">${p.descricao || '<em style="opacity: 0.5;">Sem descrição</em>'}</div>
                <small style="color: var(--text-light)">Criado em ${moment(p.dataCriacao).format('DD/MM/YY')} ${p.notificar ? ' | <i class="fa-solid fa-envelope"></i> Notif. Ativa' : ''}</small>
            </td>
            <td><span class="status-badge" style="background: rgba(148, 163, 184, 0.1); color: var(--text-main); font-weight: normal;">${p.categoria}</span></td>
            <td><span class="status-badge" style="background:transparent; border: 1px solid ${badgeCor}; color: ${badgeCor}; font-weight: 600;">${p.prioridade.toUpperCase()}</span></td>
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
