// ============================================================
//  MODO DEBRIEFING — MyABIB
//  Cole este arquivo inteiro no final do seu script.js
//  (após a última função existente, antes do fechamento)
// ============================================================

// ── Estado do debriefing ──
const _debriefing = {
    ativo: false,
    pendencias: [],       // lista extraída pelo Gemini
    indexAtual: 0,        // qual pendência está sendo revisada
    textoRelato: ''       // transcrição completa do relato
};

// ============================================================
//  INICIALIZAÇÃO — adiciona botão no painel do agente
//  Chame esta função logo após agenteInit() no seu código.
//  Ou coloque no final do DOMContentLoaded.
// ============================================================
function debriefingInit() {
    // Espera o painel do agente existir no DOM
    const painel = document.getElementById('agente-painel');
    if (!painel) { setTimeout(debriefingInit, 800); return; }

    // Verifica se já foi inserido (evita duplicar)
    if (document.getElementById('btn-debriefing')) return;

    // Botão de Debriefing dentro do painel do agente
    const btnArea = painel.querySelector('.agente-controles') || painel;
    const btnDebrief = document.createElement('button');
    btnDebrief.id = 'btn-debriefing';
    btnDebrief.className = 'btn-secondary';
    btnDebrief.style.cssText = 'margin-top: 10px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px;';
    btnDebrief.innerHTML = '<i class="fa-solid fa-comments"></i> Modo Debriefing';
    btnDebrief.title = 'Relate uma reunião ou ligação e eu extraio as pendências automaticamente';
    btnDebrief.onclick = abrirModalDebriefing;
    btnArea.appendChild(btnDebrief);

    // Injeta o modal de debriefing no body
    _debriefingInjetarModal();

    console.log('[Debriefing] Inicializado.');
}

// ============================================================
//  MODAL DE DEBRIEFING
// ============================================================
function _debriefingInjetarModal() {
    if (document.getElementById('modal-debriefing')) return;

    const modal = document.createElement('div');
    modal.id = 'modal-debriefing';
    modal.className = 'modal-overlay hidden';
    modal.innerHTML = `
        <div class="modal-box" style="max-width: 640px; width: 95vw;">

            <!-- ETAPA 1: Gravação do relato -->
            <div id="debrief-etapa-gravacao">
                <div class="modal-header">
                    <h2><i class="fa-solid fa-comments"></i> Modo Debriefing</h2>
                    <button class="btn-close" type="button" onclick="fecharModalDebriefing()">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">

                    <div style="background:var(--secondary); border-radius:8px; padding:1rem; border-left:4px solid var(--primary); margin-bottom:1.25rem;">
                        <p style="margin:0; font-size:0.9rem; color:var(--text-main);">
                            <strong>Como usar:</strong> Clique em "Começar a gravar" e relate livremente a reunião ou ligação que acabou de ter. 
                            Fale nomes, unidades, prazos e o que foi pedido — como se estivesse contando para um colega. 
                            Eu extraio as pendências automaticamente.
                        </p>
                    </div>

                    <!-- Área de transcrição ao vivo -->
                    <div id="debrief-transcricao"
                         style="min-height:120px; background:var(--bg-card); border:1px solid var(--border);
                                border-radius:8px; padding:1rem; margin-bottom:1rem;
                                font-size:0.9rem; color:var(--text-main); line-height:1.6;">
                        <span style="color:var(--text-light);">Sua fala aparecerá aqui em tempo real...</span>
                    </div>

                    <!-- Status -->
                    <div id="debrief-status" style="text-align:center; margin-bottom:1rem; font-size:0.85rem; color:var(--text-light); min-height:20px;"></div>

                    <!-- Botões de gravação -->
                    <div style="display:flex; gap:10px;">
                        <button id="btn-debrief-gravar" class="btn-primary" style="flex:1;"
                                onclick="debriefingToggleGravacao()">
                            <i class="fa-solid fa-microphone"></i> Começar a gravar
                        </button>
                        <button id="btn-debrief-processar" class="btn-primary" style="flex:1; display:none;"
                                onclick="debriefingProcessar()">
                            <i class="fa-solid fa-wand-magic-sparkles"></i> Extrair pendências
                        </button>
                        <button class="btn-secondary" onclick="fecharModalDebriefing()">Cancelar</button>
                    </div>

                    <!-- Indicador de gravação -->
                    <div id="debrief-gravando-indicator" style="display:none; text-align:center; margin-top:0.75rem;">
                        <span style="color:var(--danger); font-size:0.85rem;">
                            <i class="fa-solid fa-circle" style="animation: pulse 1s infinite;"></i>
                            Gravando — fale livremente, sem pressa
                        </span>
                    </div>
                </div>
            </div>

            <!-- ETAPA 2: Revisão de pendências -->
            <div id="debrief-etapa-revisao" style="display:none;">
                <div class="modal-header">
                    <h2><i class="fa-solid fa-list-check"></i> Revisar Pendências</h2>
                    <button class="btn-close" type="button" onclick="fecharModalDebriefing()">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">

                    <!-- Contador de progresso -->
                    <div id="debrief-progresso" style="margin-bottom:1.25rem; text-align:center; color:var(--text-light); font-size:0.85rem;"></div>

                    <!-- Card da pendência atual -->
                    <div id="debrief-card-pendencia" style="background:var(--secondary); border-radius:10px; padding:1.25rem; margin-bottom:1.25rem;">

                        <div class="form-group">
                            <label for="debrief-desc">Descrição</label>
                            <textarea id="debrief-desc" rows="3"
                                      style="width:100%; resize:vertical;"></textarea>
                        </div>

                        <div class="form-group row">
                            <div class="col">
                                <label for="debrief-prioridade">Prioridade</label>
                                <select id="debrief-prioridade">
                                    <option value="alta">🔴 Alta</option>
                                    <option value="media" selected>🟡 Média</option>
                                    <option value="baixa">🟢 Baixa</option>
                                </select>
                            </div>
                            <div class="col">
                                <label for="debrief-categoria">Categoria</label>
                                <select id="debrief-categoria">
                                    <option value="RH">RH</option>
                                    <option value="Departamento Pessoal">Departamento Pessoal</option>
                                    <option value="Fiscal / Contábil">Fiscal / Contábil</option>
                                    <option value="Financeiro">Financeiro</option>
                                    <option value="TI / Suporte">TI / Suporte</option>
                                    <option value="Outros">Outros</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-group row">
                            <div class="col">
                                <label for="debrief-vencimento">Prazo</label>
                                <input type="date" id="debrief-vencimento">
                            </div>
                            <div class="col">
                                <label for="debrief-unidade">Unidade</label>
                                <select id="debrief-unidade">
                                    <option value="">— Nenhuma —</option>
                                </select>
                            </div>
                        </div>

                        <!-- Trecho de origem (contexto do relato) -->
                        <div id="debrief-origem-container" style="display:none; margin-top:0.5rem;">
                            <label style="font-size:0.8rem; color:var(--text-light);">
                                <i class="fa-solid fa-quote-left" style="font-size:0.7rem;"></i>
                                Trecho do relato que originou esta pendência:
                            </label>
                            <p id="debrief-origem"
                               style="font-size:0.82rem; color:var(--text-light); font-style:italic;
                                      background:var(--bg-card); border-radius:6px; padding:0.6rem 0.75rem;
                                      border-left:3px solid var(--border); margin:0.35rem 0 0;"></p>
                        </div>
                    </div>

                    <!-- Botões de ação da revisão -->
                    <div style="display:flex; gap:10px;">
                        <button class="btn-secondary" onclick="debriefingPularPendencia()"
                                style="flex:1;">
                            <i class="fa-solid fa-forward"></i> Pular
                        </button>
                        <button class="btn-primary" onclick="debriefingConfirmarPendencia()"
                                style="flex:1; background:var(--success); border-color:var(--success);">
                            <i class="fa-solid fa-check"></i> Confirmar e salvar
                        </button>
                    </div>

                    <!-- Botão finalizar antecipado -->
                    <div style="text-align:center; margin-top:0.75rem;">
                        <button class="btn-secondary" onclick="debriefingFinalizar()"
                                style="font-size:0.82rem; padding:0.35rem 1rem;">
                            Finalizar revisão
                        </button>
                    </div>

                </div>
            </div>

            <!-- ETAPA 3: Resumo final -->
            <div id="debrief-etapa-resumo" style="display:none;">
                <div class="modal-header">
                    <h2><i class="fa-solid fa-circle-check"></i> Debriefing concluído</h2>
                    <button class="btn-close" type="button" onclick="fecharModalDebriefing()">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="modal-body">
                    <div id="debrief-resumo-conteudo" style="text-align:center; padding:1rem 0;"></div>
                    <div class="form-actions" style="justify-content:center;">
                        <button class="btn-primary" onclick="fecharModalDebriefing()">
                            <i class="fa-solid fa-check"></i> Concluir
                        </button>
                    </div>
                </div>
            </div>

        </div>
    `;

    document.body.appendChild(modal);

    // Popula o select de unidades com as unidades do sistema
    const selUnit = document.getElementById('debrief-unidade');
    if (selUnit && typeof UNIDADES !== 'undefined') {
        UNIDADES.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            selUnit.appendChild(opt);
        });
    }
}

// ============================================================
//  ABRIR / FECHAR MODAL
// ============================================================
function abrirModalDebriefing() {
    const modal = document.getElementById('modal-debriefing');
    if (!modal) { _debriefingInjetarModal(); setTimeout(abrirModalDebriefing, 100); return; }

    // Reset completo
    _debriefing.ativo = false;
    _debriefing.pendencias = [];
    _debriefing.indexAtual = 0;
    _debriefing.textoRelato = '';

    _debriefingMostrarEtapa('gravacao');
    _debriefingResetGravacao();
    modal.classList.remove('hidden');
}

function fecharModalDebriefing() {
    // Para gravação se estiver ativa
    if (_debriefing.ativo && _debriefing._recognition) {
        try { _debriefing._recognition.stop(); } catch(e) {}
        _debriefing.ativo = false;
    }
    const modal = document.getElementById('modal-debriefing');
    if (modal) modal.classList.add('hidden');
}

function _debriefingMostrarEtapa(etapa) {
    ['gravacao','revisao','resumo'].forEach(e => {
        const el = document.getElementById(`debrief-etapa-${e}`);
        if (el) el.style.display = e === etapa ? '' : 'none';
    });
}

function _debriefingResetGravacao() {
    const trans = document.getElementById('debrief-transcricao');
    if (trans) trans.innerHTML = '<span style="color:var(--text-light);">Sua fala aparecerá aqui em tempo real...</span>';

    const status = document.getElementById('debrief-status');
    if (status) status.textContent = '';

    const btnGravar = document.getElementById('btn-debrief-gravar');
    if (btnGravar) {
        btnGravar.innerHTML = '<i class="fa-solid fa-microphone"></i> Começar a gravar';
        btnGravar.style.display = '';
    }

    const btnProcessar = document.getElementById('btn-debrief-processar');
    if (btnProcessar) btnProcessar.style.display = 'none';

    const indicator = document.getElementById('debrief-gravando-indicator');
    if (indicator) indicator.style.display = 'none';
}

// ============================================================
//  GRAVAÇÃO DE VOZ
// ============================================================
function debriefingToggleGravacao() {
    if (_debriefing.ativo) {
        _debriefingPararGravacao();
    } else {
        _debriefingIniciarGravacao();
    }
}

function _debriefingIniciarGravacao() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast('Reconhecimento de voz não suportado. Use o Chrome.', 'error');
        return;
    }

    _debriefing._frasesConfirmadas = [];
    _debriefing._textoParcial = '';
    _debriefing.textoRelato = '';

    const rec = new SpeechRecognition();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = function(event) {
        let parcial = '', final = '';
        for (let i = 0; i < event.results.length; i++) {
            const txt = event.results[i][0].transcript;
            if (event.results[i].isFinal) { final += txt + ' '; }
            else { parcial += txt; }
        }
        if (final.trim()) {
            _debriefing._frasesConfirmadas.push(final.trim());
            _debriefing._textoParcial = '';
            _debriefing.textoRelato = _debriefing._frasesConfirmadas.join(' ');
        } else {
            _debriefing._textoParcial = parcial;
        }
        _debriefingAtualizarTranscricao();
    };

    rec.onerror = function(event) {
        if (event.error === 'no-speech') {
            if (_debriefing.ativo) { try { rec.start(); } catch(e) {} }
            return;
        }
        if (event.error === 'aborted') return;
        showToast('Erro no reconhecimento: ' + event.error, 'error');
        _debriefing.ativo = false;
    };

    rec.onend = function() {
        if (_debriefing.ativo) { try { rec.start(); } catch(e) {} }
    };

    _debriefing._recognition = rec;
    _debriefing.ativo = true;

    try { rec.start(); } catch(e) {
        showToast('Não foi possível iniciar o microfone.', 'error');
        _debriefing.ativo = false;
        return;
    }

    // Atualiza UI
    const btnGravar = document.getElementById('btn-debrief-gravar');
    if (btnGravar) btnGravar.innerHTML = '<i class="fa-solid fa-stop"></i> Parar gravação';

    const indicator = document.getElementById('debrief-gravando-indicator');
    if (indicator) indicator.style.display = '';

    const status = document.getElementById('debrief-status');
    if (status) status.textContent = 'Fale o que aconteceu na reunião ou ligação...';
}

function _debriefingPararGravacao() {
    _debriefing.ativo = false;
    try { if (_debriefing._recognition) _debriefing._recognition.stop(); } catch(e) {}

    // Consolida texto final
    _debriefing.textoRelato = [
        ...((_debriefing._frasesConfirmadas) || []),
        _debriefing._textoParcial || ''
    ].join(' ').trim();

    const indicator = document.getElementById('debrief-gravando-indicator');
    if (indicator) indicator.style.display = 'none';

    const btnGravar = document.getElementById('btn-debrief-gravar');
    if (btnGravar) btnGravar.style.display = 'none';

    const btnProcessar = document.getElementById('btn-debrief-processar');
    if (btnProcessar) btnProcessar.style.display = '';

    const status = document.getElementById('debrief-status');
    if (_debriefing.textoRelato.length > 10) {
        if (status) status.textContent = `Relato capturado (${_debriefing.textoRelato.split(' ').length} palavras). Clique em "Extrair pendências" quando quiser.`;
    } else {
        if (status) status.textContent = 'Relato muito curto. Tente gravar novamente.';
        const btnGravarEl = document.getElementById('btn-debrief-gravar');
        if (btnGravarEl) {
            btnGravarEl.innerHTML = '<i class="fa-solid fa-microphone"></i> Gravar novamente';
            btnGravarEl.style.display = '';
        }
        if (btnProcessar) btnProcessar.style.display = 'none';
    }
}

function _debriefingAtualizarTranscricao() {
    const el = document.getElementById('debrief-transcricao');
    if (!el) return;
    let html = '';
    if (_debriefing.textoRelato) html += esc(_debriefing.textoRelato);
    if (_debriefing._textoParcial) html += '<span style="color:var(--text-light);"> ' + esc(_debriefing._textoParcial) + '</span>';
    if (!html) html = '<span style="color:var(--text-light);">Sua fala aparecerá aqui em tempo real...</span>';
    el.innerHTML = html;
}

// ============================================================
//  PROCESSAMENTO COM GEMINI
// ============================================================
async function debriefingProcessar() {
    if (!_debriefing.textoRelato || _debriefing.textoRelato.length < 10) {
        showToast('Relato muito curto para processar.', 'warning');
        return;
    }

    const apiKey = (typeof configGerais !== 'undefined' && configGerais.geminiKey)
        ? configGerais.geminiKey.trim()
        : (localStorage.getItem('gemini_api_key') || '');

    if (!apiKey) {
        showToast('Configure a chave Gemini em Configurações.', 'error');
        return;
    }

    const btnProcessar = document.getElementById('btn-debrief-processar');
    if (btnProcessar) {
        btnProcessar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analisando...';
        btnProcessar.disabled = true;
    }

    const status = document.getElementById('debrief-status');
    if (status) status.textContent = 'O Gemini está extraindo as pendências do seu relato...';

    const hoje = (typeof moment !== 'undefined') ? moment().format('YYYY-MM-DD') : new Date().toISOString().split('T')[0];

    // Monta lista de funcionários ativos para contexto
    const listaFunc = (typeof funcionariosList !== 'undefined')
        ? funcionariosList.filter(f => !f.desligado).map(f => `${f.nome} — ${f.unidade}`).join('\n')
        : '';

    const listaUnidades = (typeof UNIDADES !== 'undefined') ? UNIDADES.join(', ') : '';

    const prompt = `Você é um assistente especializado em RH e administração. Analise o relato de reunião/ligação abaixo e extraia TODAS as pendências, tarefas e compromissos mencionados.

DATA DE HOJE: ${hoje}

UNIDADES DA EMPRESA: ${listaUnidades}

FUNCIONÁRIOS ATIVOS (para referência de nomes):
${listaFunc}

RELATO DA REUNIÃO/LIGAÇÃO:
"${_debriefing.textoRelato}"

INSTRUÇÕES:
- Extraia TODAS as pendências concretas: tarefas a fazer, documentos a enviar, ligações a retornar, prazos a registrar, exames (ASO) a agendar, admissões, desligamentos, férias, etc.
- Ignore conversas casuais e informações sem ação necessária.
- Para cada pendência, identifique o prazo se mencionado (use formato YYYY-MM-DD). Se não houver prazo explícito, deixe null.
- Prioridade: use "alta" para urgente/imediato, "media" para esta semana, "baixa" para sem urgência.
- Categorias disponíveis: "RH", "Departamento Pessoal", "Fiscal / Contábil", "Financeiro", "TI / Suporte", "Outros"
- Unidade: identifique qual unidade foi mencionada (use exatamente os nomes da lista acima). Se não mencionada, deixe null.
- Origem: copie o trecho exato do relato que gerou a pendência (até 100 caracteres).

Retorne APENAS JSON válido, sem markdown, sem explicações:
{
  "pendencias": [
    {
      "descricao": "Descrição clara e objetiva da tarefa",
      "prioridade": "alta|media|baixa",
      "categoria": "categoria",
      "vencimento": "YYYY-MM-DD ou null",
      "unidade": "nome da unidade ou null",
      "origem": "trecho do relato"
    }
  ],
  "resumo_relato": "Uma frase resumindo o que foi discutido"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1, response_mime_type: 'application/json' }
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`Gemini ${res.status}: ${(err.error && err.error.message) || res.statusText}`);
        }

        const data = await res.json();
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) throw new Error('Resposta vazia do Gemini');

        const resultado = JSON.parse(raw.replace(/```json\n?/g,'').replace(/```\n?/g,'').trim());

        if (!resultado.pendencias || resultado.pendencias.length === 0) {
            if (status) status.textContent = 'Nenhuma pendência identificada no relato.';
            if (btnProcessar) {
                btnProcessar.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Extrair pendências';
                btnProcessar.disabled = false;
            }
            showToast('Nenhuma pendência identificada. Tente detalhar mais o relato.', 'warning');
            return;
        }

        // Armazena e vai para revisão
        _debriefing.pendencias = resultado.pendencias;
        _debriefing.indexAtual = 0;
        _debriefing._confirmadas = 0;
        _debriefing._puladas = 0;
        _debriefing._resumoRelato = resultado.resumo_relato || '';

        _debriefingMostrarEtapa('revisao');
        _debriefingCarregarPendenciaAtual();

    } catch(err) {
        console.error('[Debriefing]', err);
        showToast('Erro ao processar: ' + err.message, 'error');
        if (status) status.textContent = 'Erro ao processar. Tente novamente.';
        if (btnProcessar) {
            btnProcessar.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Tentar novamente';
            btnProcessar.disabled = false;
        }
    }
}

// ============================================================
//  REVISÃO DE PENDÊNCIAS (uma por uma)
// ============================================================
function _debriefingCarregarPendenciaAtual() {
    const total = _debriefing.pendencias.length;
    const idx = _debriefing.indexAtual;

    if (idx >= total) {
        _debriefingFinalizar();
        return;
    }

    const p = _debriefing.pendencias[idx];

    // Atualiza contador
    const prog = document.getElementById('debrief-progresso');
    if (prog) prog.textContent = `Pendência ${idx + 1} de ${total}`;

    // Preenche campos
    const desc = document.getElementById('debrief-desc');
    if (desc) desc.value = p.descricao || '';

    const prioridade = document.getElementById('debrief-prioridade');
    if (prioridade) prioridade.value = p.prioridade || 'media';

    const categoria = document.getElementById('debrief-categoria');
    if (categoria) categoria.value = p.categoria || 'RH';

    const vencimento = document.getElementById('debrief-vencimento');
    if (vencimento) vencimento.value = p.vencimento || '';

    const unidade = document.getElementById('debrief-unidade');
    if (unidade) unidade.value = p.unidade || '';

    // Mostra origem (contexto)
    const origemContainer = document.getElementById('debrief-origem-container');
    const origemEl = document.getElementById('debrief-origem');
    if (p.origem && origemEl && origemContainer) {
        origemEl.textContent = `"${p.origem}"`;
        origemContainer.style.display = '';
    } else if (origemContainer) {
        origemContainer.style.display = 'none';
    }
}

function debriefingConfirmarPendencia() {
    // Lê os valores editados pelo usuário
    const descricao = (document.getElementById('debrief-desc') || {}).value || '';
    const prioridade = (document.getElementById('debrief-prioridade') || {}).value || 'media';
    const categoria = (document.getElementById('debrief-categoria') || {}).value || 'RH';
    const vencimento = (document.getElementById('debrief-vencimento') || {}).value || '';
    const unidade = (document.getElementById('debrief-unidade') || {}).value || '';

    if (!descricao.trim()) {
        showToast('A descrição não pode estar vazia.', 'warning');
        return;
    }

    // Tenta vincular funcionário pela unidade (se informada)
    let idFunc = null;
    if (unidade && typeof funcionariosList !== 'undefined') {
        // Não vincula a funcionário específico — a unidade fica na descrição se necessário
    }

    // Cria a pendência no sistema
    const novaPendencia = {
        id: 'PEN_DBR_' + Date.now() + '_' + _debriefing.indexAtual,
        descricao: descricao.trim() + (unidade ? ` [${unidade}]` : ''),
        categoria,
        prioridade,
        vencimento,
        notificar: false,
        idFunc: idFunc,
        concluida: false,
        dataCriacao: (typeof moment !== 'undefined') ? moment().format('YYYY-MM-DD') : new Date().toISOString().split('T')[0],
        origem: 'debriefing'
    };

    if (typeof pendenciasList !== 'undefined') pendenciasList.push(novaPendencia);
    if (typeof salvarDados === 'function') salvarDados();
    if (typeof renderPendencias === 'function') renderPendencias();
    if (typeof renderDeadlines === 'function') renderDeadlines();
    if (typeof mapaAtualizarTodosBadges === 'function' && typeof _mapa !== 'undefined' && _mapa.nos && _mapa.nos.length > 0) mapaAtualizarTodosBadges();
    if (typeof registrarHistorico === 'function') registrarHistorico('pendencia', 'Debriefing: Pendência criada', descricao.trim());

    _debriefing._confirmadas = (_debriefing._confirmadas || 0) + 1;
    _debriefing.indexAtual++;
    _debriefingCarregarPendenciaAtual();
}

function debriefingPularPendencia() {
    _debriefing._puladas = (_debriefing._puladas || 0) + 1;
    _debriefing.indexAtual++;
    _debriefingCarregarPendenciaAtual();
}

function debriefingFinalizar() {
    _debriefingMostrarEtapa('resumo');

    const confirmadas = _debriefing._confirmadas || 0;
    const puladas = _debriefing._puladas || 0;
    const total = _debriefing.pendencias.length;

    const resumoEl = document.getElementById('debrief-resumo-conteudo');
    if (resumoEl) {
        let html = '';

        if (_debriefing._resumoRelato) {
            html += `<p style="color:var(--text-light); font-size:0.88rem; margin-bottom:1.25rem; font-style:italic;">"${esc(_debriefing._resumoRelato)}"</p>`;
        }

        html += `
            <div style="display:flex; gap:1rem; justify-content:center; margin-bottom:1.25rem; flex-wrap:wrap;">
                <div style="background:var(--success-light); border-radius:10px; padding:1rem 1.5rem; text-align:center; min-width:110px;">
                    <div style="font-size:2rem; font-weight:700; color:var(--success);">${confirmadas}</div>
                    <div style="font-size:0.8rem; color:var(--success);">Salvas</div>
                </div>
                <div style="background:var(--secondary); border-radius:10px; padding:1rem 1.5rem; text-align:center; min-width:110px;">
                    <div style="font-size:2rem; font-weight:700; color:var(--text-light);">${puladas}</div>
                    <div style="font-size:0.8rem; color:var(--text-light);">Puladas</div>
                </div>
                <div style="background:var(--primary-light); border-radius:10px; padding:1rem 1.5rem; text-align:center; min-width:110px;">
                    <div style="font-size:2rem; font-weight:700; color:var(--primary);">${total}</div>
                    <div style="font-size:0.8rem; color:var(--primary);">Identificadas</div>
                </div>
            </div>
        `;

        if (confirmadas > 0) {
            html += `<p style="color:var(--success); font-size:0.9rem;"><i class="fa-solid fa-circle-check"></i> ${confirmadas} pendência${confirmadas > 1 ? 's' : ''} adicionada${confirmadas > 1 ? 's' : ''} ao sistema com sucesso.</p>`;
        } else {
            html += `<p style="color:var(--text-light); font-size:0.9rem;">Nenhuma pendência foi salva neste debriefing.</p>`;
        }

        resumoEl.innerHTML = html;
    }

    if (confirmadas > 0) {
        showToast(`${confirmadas} pendência${confirmadas > 1 ? 's' : ''} salva${confirmadas > 1 ? 's' : ''} via Debriefing!`, 'success');
    }
}

// ============================================================
//  AUTO-INICIALIZAÇÃO
//  Aguarda o DOM estar pronto e o sistema carregado
// ============================================================
(function() {
    function tentarInit() {
        if (document.getElementById('agente-painel')) {
            debriefingInit();
        } else {
            setTimeout(tentarInit, 1000);
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', tentarInit);
    } else {
        setTimeout(tentarInit, 500);
    }
})();
