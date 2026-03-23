# 📱 Funcionalidade: Tratar Conversas (WhatsApp)

## Visão Geral

Nova aba no sistema MyABIB que permite importar conversas exportadas do WhatsApp e extrair pendências automaticamente usando Inteligência Artificial (Gemini API).

---

## Como Usar

### 1. Exportar Conversas do WhatsApp

No WhatsApp:
1. Abra a conversa que deseja processar
2. Toque nos 3 pontos (menu) → **Mais** → **Exportar conversa**
3. Escolha **COM MÍDIA** (importante!)
4. Salve o arquivo `.zip` gerado

Repita para cada conversa que deseja analisar.

### 2. Importar no Sistema

1. Acesse a aba **"Tratar Conversas"** no menu lateral
2. Clique em **"Escolher Arquivos (.zip)"**
3. Selecione um ou vários arquivos `.zip` de uma vez
4. Defina o período de análise:
   - **"Após uma data específica"**: analisa mensagens a partir de uma data
   - **"Intervalo entre datas"**: analisa mensagens num período específico

### 3. Processar

1. Clique em **"Processar Conversas"**
2. Aguarde o processamento (você verá o progresso em tempo real)
3. Se houver áudios muito longos (>5min), o sistema pedirá confirmação

### 4. Revisar Pendências Sugeridas

Para cada conversa processada, você verá:
- Nome da conversa (nome do arquivo)
- Quantidade de mensagens, áudios e imagens no período
- Lista de pendências identificadas pela IA

Para cada pendência:
- ✅ **Checkbox** para selecionar
- 📝 **Descrição** da pendência
- 💬 **Trecho original** da mensagem que gerou a sugestão
- 🎯 **Nível de confiança** (alta/média/baixa)
- **Campos editáveis:**
  - Categoria (padrão: "WhatsApp")
  - Prioridade (alta/média/baixa)
  - Vencimento (data opcional)

### 5. Confirmar Pendências

Três formas de confirmar:

**Opção A - Individual por Conversa:**
1. Marque as pendências que deseja importar de uma conversa
2. Clique em **"Confirmar Desta Conversa"**

**Opção B - Seleção em Lote:**
1. Marque pendências de várias conversas diferentes
2. Clique em **"Confirmar Selecionadas"** (topo da tela)

**Opção C - Todas de Uma Conversa:**
1. Clique em **"Selecionar Todas"** dentro de uma conversa
2. Clique em **"Confirmar Desta Conversa"**

### 6. Histórico de Análises

Após confirmar pendências, a análise fica salva na seção **"Histórico de Análises"** (mesmo dentro da aba Tratar Conversas).

Você pode:
- Ver quando foi processada
- Quantas mensagens e pendências foram identificadas
- Apagar análises antigas (botão de lixeira)

---

## Detalhes Técnicos

### O que o Sistema Faz

1. **Extrai arquivos** do `.zip`:
   - `.txt` - arquivo de texto com as mensagens
   - `.opus` - áudios enviados na conversa
   - `.jpg`/`.png` - imagens enviadas

2. **Filtra mensagens** pelo período selecionado

3. **Envia para Gemini**:
   - Texto das mensagens como contexto
   - Mídias (áudios e imagens) quando relevantes
   - Prompt especializado em identificar pendências de RH

4. **Recebe sugestões** estruturadas:
   - Descrição clara da tarefa
   - Prioridade sugerida
   - Prazo (se mencionado nas mensagens)
   - Nível de confiança da IA

### Limitações Conhecidas

⚠️ **Áudios longos (>5min):**
- Podem consumir muitos tokens da API
- Sistema avisa e pede confirmação antes de processar

⚠️ **Imagens sem texto:**
- Gemini ignora automaticamente imagens que não têm conteúdo relevante

⚠️ **Falsos positivos:**
- A IA pode sugerir pendências que não fazem sentido
- **Por isso a revisão manual é obrigatória** antes de confirmar

⚠️ **Formato das mensagens:**
- O sistema espera o formato padrão do WhatsApp: `DD/MM/YYYY HH:MM - Nome: Mensagem`
- Conversas muito antigas ou com formatação diferente podem não ser processadas corretamente

### Armazenamento

- **Análises confirmadas:** salvas no `localStorage` do navegador
- **Limite:** até 50 análises no histórico
- **Pendências confirmadas:** vão para o Firebase junto com as demais pendências do sistema

### Custo de API

- Usa a **mesma chave Gemini** já configurada no sistema (Configurações)
- Custo depende de:
  - Quantidade de mensagens no período
  - Quantidade de mídias (áudios e imagens)
  - Tamanho dos áudios

**Estimativa:**
- Conversa pequena (100 msgs, sem mídias): ~$0.01
- Conversa média (500 msgs, 10 áudios): ~$0.05
- Conversa grande (2000 msgs, 50 áudios): ~$0.20

---

## Dicas de Uso

✅ **Boas práticas:**
- Exporte conversas **com mídia** para análise mais precisa
- Use filtros de data para processar apenas o período necessário
- Revise TODAS as sugestões antes de confirmar
- Edite categoria e prioridade conforme necessário
- Use o histórico para saber o que já foi processado

❌ **Evite:**
- Processar conversas muito antigas (dados irrelevantes)
- Importar a mesma conversa múltiplas vezes
- Confirmar pendências sem revisar (pode gerar ruído no sistema)
- Processar conversas pessoais não relacionadas ao trabalho

---

## Fluxo Completo (Exemplo)

**Cenário:** Você tem 5 conversas de funcionários sobre documentos pendentes nas últimas 2 semanas.

1. Exporta as 5 conversas do WhatsApp (com mídia)
2. Acessa "Tratar Conversas" no sistema
3. Seleciona os 5 arquivos `.zip` de uma vez
4. Configura período: "Após 01/03/2026"
5. Clica em "Processar Conversas"
6. Sistema processa conversa por conversa (mostra progresso)
7. Revisa as 23 pendências sugeridas no total
8. Corrige 3 que estavam erradas
9. Ajusta categorias e prioridades
10. Seleciona todas e confirma
11. **Resultado:** 20 pendências novas na lista de Pendências do sistema

---

## Integração com o Sistema

As pendências confirmadas:
- ✅ Aparecem na aba **"Gestão de Pendências"**
- ✅ São contabilizadas no **Dashboard** (cards de urgência/atenção)
- ✅ Disparam e-mails se a opção "Notificar" estiver ativa
- ✅ Ficam no **Histórico de Alterações** do sistema
- ✅ Podem ser editadas, concluídas ou excluídas normalmente

---

## Suporte e Troubleshooting

### "Erro na API Gemini: 403"
→ Chave da API inválida ou sem créditos. Verifique em Configurações.

### "Arquivo .txt de mensagens não encontrado"
→ O `.zip` exportado está corrompido ou não é do WhatsApp. Exporte novamente.

### "Nenhuma pendência identificada"
→ O Gemini não encontrou tarefas concretas nas mensagens do período. Normal para conversas casuais.

### Processamento muito lento
→ Normal para conversas com muitos áudios. Cada áudio é enviado para análise.

### Análise não aparece no histórico
→ Só vai para o histórico depois de confirmar ao menos 1 pendência da conversa.

---

## Roadmap Futuro (Possíveis Melhorias)

- 🔄 Processamento em segundo plano (não bloquear a tela)
- 📊 Dashboard com estatísticas de conversas processadas
- 🏷️ Gemini sugerindo categorias automaticamente
- 🔗 Vincular pendências a funcionários específicos
- 📧 Exportar relatório das pendências por conversa
- 🗂️ Salvar análises no Firebase (não só localStorage)

---

**Versão:** 1.0  
**Data:** Março 2026  
**Autor:** Sistema MyABIB
