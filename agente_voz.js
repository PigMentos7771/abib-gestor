/**
 * AGENTE DE VOZ MYABIB - CO-PILOTO ADMINISTRATIVO
 * Integração: Web Speech API + Gemini API + Firebase RTDB
 */

const btnVoz = document.getElementById('btn-voz-comando');
const statusVoz = document.getElementById('voz-status-badge');

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!Recognition) {
    console.error("Navegador não suporta reconhecimento de voz.");
    btnVoz.style.display = 'none';
} else {
    const recognition = new Recognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;

    btnVoz.addEventListener('click', () => {
        if (btnVoz.classList.contains('listening')) {
            recognition.stop();
        } else {
            recognition.start();
        }
    });

    recognition.onstart = () => {
        btnVoz.classList.add('listening');
        statusVoz.style.display = 'block';
        statusVoz.textContent = "Ouvindo agora...";
    };

    recognition.onend = () => {
        btnVoz.classList.remove('listening');
    };

    recognition.onresult = async (event) => {
        const textoEscutado = event.results[0][0].transcript;
        statusVoz.textContent = "Processando...";
        await interpretarComandoComIA(textoEscutado);
    };
}

async function interpretarComandoComIA(frase) {
    // Pegamos a lista de funcionários e unidades do sistema para dar contexto à IA
    const contextFuncionarios = typeof funcionariosList !== 'undefined' ? 
        funcionariosList.map(f => f.nome).slice(0, 20).join(', ') : '';

    const systemPrompt = `
    Você é o Agente MyABIB. Converta a fala do usuário em uma ação no sistema.
    
    Fala do usuário: "${frase}"

    Responda APENAS um JSON:
    {
        "acao": "CRIAR_PENDENCIA",
        "dados": {
            "descricao": "Texto curto da tarefa",
            "prioridade": "alta|media|baixa",
            "categoria": "RH|Fiscal|Agendamento|Geral",
            "vencimento": "YYYY-MM-DD" (hoje se não especificado)
        },
        "feedback": "Frase curta para eu falar de volta ao usuário"
    }
    `;

    try {
        // Usa a função enviarParaGemini que já existe no seu script.js
        const rawResponse = await enviarParaGemini(systemPrompt);
        const cleanJson = rawResponse.replace(/```json|```/g, '').trim();
        const acaoIA = JSON.parse(cleanJson);

        if (acaoIA.acao === "CRIAR_PENDENCIA") {
            const novaPendencia = {
                descricao: acaoIA.dados.descricao,
                prioridade: acaoIA.dados.prioridade,
                categoria: acaoIA.dados.categoria,
                vencimento: acaoIA.dados.vencimento || new Date().toISOString().split('T')[0],
                dataCriacao: new Date().toISOString(),
                concluida: false
            };

            // Salva no seu Firebase (usando a URL que está no seu script.js)
            await fetch(`${FIREBASE_URL}pendencias.json`, {
                method: 'POST',
                body: JSON.stringify(novaPendencia)
            });

            darFeedbackVoz(acaoIA.feedback);
            if (typeof renderPendencias === 'function') renderPendencias();
        }
    } catch (error) {
        console.error("Erro no Agente de Voz:", error);
        darFeedbackVoz("Houve um erro no processamento.");
    }
}

function darFeedbackVoz(mensagem) {
    statusVoz.textContent = mensagem;
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(mensagem);
    utter.lang = 'pt-BR';
    synth.speak(utter);
    setTimeout(() => { statusVoz.style.display = 'none'; }, 4000);
}