# 🔧 Troubleshooting - Erro 404 API Gemini

## Problema
Ao processar conversas do WhatsApp, aparece: **"Erro na API Gemini: 404"**

---

## Possíveis Causas e Soluções

### 1. ✅ Chave da API Inválida ou Expirada

**Como verificar:**
- Acesse: https://aistudio.google.com/app/apikey
- Veja se sua chave está ativa

**Solução:**
1. Crie uma **nova chave** no AI Studio
2. No sistema MyABIB → **Configurações**
3. Seção **"Integração Inteligência Artificial (OCR)"**
4. Cole a nova chave
5. Clique em **Salvar Configurações**
6. Recarregue a página (F5)

**Formato correto da chave:**
```
AIzaSyB_1234abcd5678efgh9012ijkl3456mnop
```
- Começa com `AIza`
- ~39 caracteres

---

### 2. ✅ Modelo Gemini Mudou de Nome

**O código agora tenta automaticamente:**
1. Primeiro: `gemini-1.5-flash` (API v1)
2. Se falhar: `gemini-1.5-flash` (API v1beta)

**Se mesmo assim der erro 404:**

Verifique no console do navegador (F12) qual URL está sendo chamada e qual erro retorna.

**Modelos disponíveis (março 2026):**
- `gemini-1.5-flash` ✅ (recomendado - mais barato)
- `gemini-1.5-pro` (mais preciso, mais caro)
- `gemini-pro` (versão antiga)

---

### 3. ✅ Restrições da API Key

**Sintoma:** Erro 404 ou 403

**Possíveis causas:**
- Chave sem permissão para o modelo `gemini-1.5-flash`
- Quota excedida
- Região bloqueada

**Solução:**
1. Acesse: https://aistudio.google.com/app/apikey
2. Clique na sua chave → **Settings**
3. Verifique:
   - ✅ Status: Active
   - ✅ Quota: não excedida
   - ✅ Allowed models: inclui gemini-1.5-flash

---

### 4. ✅ URL da API Mudou

**Versão atual do código (já corrigida):**
```javascript
// Tenta v1 primeiro
https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent

// Se falhar, tenta v1beta
https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent
```

**Se NENHUMA funcionar:**

Verifique a documentação oficial:
https://ai.google.dev/api/rest/v1/models/generateContent

---

## 🔍 Debug Passo a Passo

### Passo 1: Abra o Console do Navegador
1. Pressione **F12**
2. Vá na aba **Console**
3. Tente processar uma conversa
4. Veja a mensagem de erro completa

### Passo 2: Verifique a Request
No console, procure por:
```
Erro Gemini API: 404 {mensagem detalhada}
```

**Mensagens comuns:**

| Erro | Significado | Solução |
|------|-------------|---------|
| `404 - Model not found` | Modelo não existe | Atualize o nome do modelo no código |
| `403 - Permission denied` | Sem permissão | Verifique configuração da chave |
| `429 - Quota exceeded` | Quota excedida | Aguarde ou upgrade no plano |
| `400 - Invalid request` | Request malformado | Bug no código, me avise |

### Passo 3: Teste Manual da API

Abra o **Postman** ou **curl** e teste:

```bash
curl -X POST \
  'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=SUA_CHAVE_AQUI' \
  -H 'Content-Type: application/json' \
  -d '{
    "contents": [{
      "parts": [{"text": "Olá, estou testando"}]
    }]
  }'
```

**Se retornar 200:** A chave está OK, o problema é no código  
**Se retornar 404:** A chave ou modelo está errado  

---

## 🛠️ Correções Aplicadas

O arquivo `script.js` que você recebeu JÁ INCLUI:

✅ **Correção 1:** Busca a chave de `configGerais.geminiKey` (não localStorage)  
✅ **Correção 2:** Tenta v1 primeiro, depois v1beta automaticamente  
✅ **Correção 3:** Mostra mensagem de erro detalhada no console  
✅ **Correção 4:** Não quebra o sistema se 1 conversa falhar  

---

## 📞 Se Nada Funcionar

**Opção 1: Teste com Modelo Alternativo**

Edite o arquivo `script.js`, linha ~7135:

```javascript
// ANTES
'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent'

// DEPOIS (tente gemini-pro)
'https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent'
```

**Opção 2: Use a v1beta Diretamente**

Linha ~7135, force v1beta:

```javascript
'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent'
```

**Opção 3: Me avise**

Mande print do erro completo do console (F12) e eu ajusto!

---

## ✅ Checklist Final

Antes de processar, confirme:

- [ ] Chave da API está configurada em Configurações
- [ ] Chave começa com `AIza` e tem ~39 caracteres
- [ ] Chave está ativa no AI Studio (https://aistudio.google.com/app/apikey)
- [ ] Arquivo .zip do WhatsApp foi exportado **COM MÍDIA**
- [ ] Período selecionado contém mensagens
- [ ] Console do navegador (F12) não mostra outros erros

---

**Última atualização:** 17/03/2026  
**Versão do sistema:** MyABIB 3.5
