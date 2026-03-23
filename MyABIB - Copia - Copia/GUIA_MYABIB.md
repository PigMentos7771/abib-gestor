# 🧩 Guia de Componentes — MyABIB
> Cole este arquivo inteiro no início de qualquer conversa com o Antigravity antes de pedir mudanças visuais.

---

## Como usar este guia

Sempre que for pedir ao Antigravity para criar ou modificar algo visual no sistema MyABIB, cole este arquivo no início da conversa e diga:
> *"Siga rigorosamente o Guia de Componentes abaixo para manter a consistência visual do sistema."*

---

## 🎨 Variáveis de Cor (use SEMPRE estas, nunca cores fixas como #ff0000)

```css
--primary        → Azul principal (botões, destaques, links ativos)
--primary-hover  → Azul escuro (hover do botão primário)
--primary-light  → Azul transparente (fundo de badges e destaques sutis)

--danger         → Vermelho (excluir, urgente, erro)
--danger-light   → Vermelho claro (fundo de badges de perigo)
--warning        → Amarelo (atenção, editar, abonar)
--warning-light  → Amarelo claro (fundo de badges de atenção)
--success        → Verde (concluído, conferido, sucesso)
--success-light  → Verde claro (fundo de badges de sucesso)

--text-main      → Texto principal (títulos, labels)
--text-light     → Texto secundário (subtítulos, placeholders, dicas)
--bg-card        → Fundo branco (cards, modais, tabelas)
--bg-page        → Fundo cinza da página
--secondary      → Cinza claro (fundo de seções internas, inputs)
--border         → Cor das bordas
--shadow-sm      → Sombra leve
--shadow-md      → Sombra média (cards e modais)
--radius         → Borda arredondada padrão (12px)
--btn-height     → Altura padrão de botões e inputs (42px)
```

---

## 🔘 Botões

### Regra de ouro
> **Nunca crie botões com `style="..."` inline. Sempre use uma das classes abaixo.**

### Botão Primário — ação principal da tela
```html
<button class="btn-primary">
    <i class="fa-solid fa-plus"></i> Adicionar
</button>
```
Cor: azul. Use para: Salvar, Adicionar, Confirmar, Novo.

---

### Botão Secundário — ação de suporte
```html
<button class="btn-secondary">Cancelar</button>
<button class="btn-secondary">
    <i class="fa-solid fa-arrow-left"></i> Voltar
</button>
```
Cor: cinza. Use para: Cancelar, Voltar, Exportar, Ver Todos.

---

### Botão Ícone — apenas ícone, sem texto
```html
<button class="btn-icon" title="Descrição da ação">
    <i class="fa-solid fa-rotate-right"></i>
</button>
```
Quadrado 42×42px. Use para: recarregar, limpar campo, fechar.

---

### Botões de Ação em Tabelas — sempre combinados com btn-icon
```html
<!-- Editar (amarelo) -->
<button class="btn-icon btn-edit" title="Editar">
    <i class="fa-solid fa-pen"></i>
</button>

<!-- Excluir (vermelho) -->
<button class="btn-icon btn-delete" title="Excluir">
    <i class="fa-solid fa-trash"></i>
</button>

<!-- Confirmar / Sucesso (verde) -->
<button class="btn-icon btn-success" title="Confirmar">
    <i class="fa-solid fa-check"></i>
</button>

<!-- Ação azul (ex: calendário, e-mail) -->
<button class="btn-icon btn-calendar" title="Ver no calendário">
    <i class="fa-solid fa-calendar"></i>
</button>
```

---

### Botão que abre upload de arquivo (usar label, não button)
```html
<label for="meu-input" class="btn-primary">
    <i class="fa-solid fa-upload"></i> Importar Arquivo
</label>
<input type="file" id="meu-input" style="display:none;">
```

---

### Botão de Perigo (zona destrutiva)
```html
<button class="btn-primary" style="background:var(--danger); border-color:var(--danger);">
    <i class="fa-solid fa-trash"></i> Apagar Tudo
</button>
```
Este é o ÚNICO caso onde `style` é aceito num botão — para sobrescrever a cor de fundo para vermelho.

---

## 📋 Formulários

### Campo de texto, número, e-mail, data
```html
<div class="form-group">
    <label for="meu-campo">Nome do Campo</label>
    <input type="text" id="meu-campo" placeholder="Ex: valor aqui">
</div>
```

### Dois campos lado a lado
```html
<div class="form-group row">
    <div class="col">
        <label>Campo 1</label>
        <input type="text" id="campo1">
    </div>
    <div class="col">
        <label>Campo 2</label>
        <input type="text" id="campo2">
    </div>
</div>
```

### Select (lista suspensa)
```html
<div class="form-group">
    <label for="meu-select">Categoria</label>
    <select id="meu-select">
        <option value="" disabled selected>Selecione...</option>
        <option value="a">Opção A</option>
        <option value="b">Opção B</option>
    </select>
</div>
```

### Textarea
```html
<div class="form-group">
    <label for="meu-texto">Observações</label>
    <textarea id="meu-texto" rows="4" placeholder="Escreva aqui..."></textarea>
</div>
```

### Checkbox estilizado
```html
<div class="checkbox-wrapper">
    <input type="checkbox" id="minha-opcao">
    <label for="minha-opcao">Ativar esta opção</label>
</div>
```

### Toggle Switch (liga/desliga)
```html
<label class="toggle-switch">
    <input type="checkbox" id="meu-toggle" onchange="minhaFuncao(this.checked)">
    <span class="slider"></span>
</label>
```
Variante amarela (para "Abonar"): adicionar classe `toggle-switch-warning` ao label.

### Rodapé do formulário (botões de Cancelar + Salvar)
```html
<div class="form-actions">
    <button type="button" class="btn-secondary" onclick="fecharModal()">Cancelar</button>
    <button type="submit" class="btn-primary">
        <i class="fa-solid fa-save"></i> Salvar
    </button>
</div>
```

---

## 📦 Cards de Resumo (contadores no topo das telas)

```html
<div class="summary-cards">

    <div class="card danger-card">
        <div class="card-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="card-info">
            <h3>Título do Card</h3>
            <h2 id="meu-contador">0</h2>
            <p>Subtítulo descritivo</p>
        </div>
    </div>

    <div class="card warning-card"><!-- igual, cor amarela --></div>

    <div class="card success-card"><!-- igual, cor verde --></div>

</div>
```
Variantes: `danger-card` (vermelho), `warning-card` (amarelo), `success-card` (verde).
Card sem variante: fundo branco neutro.

---

## 🏷️ Badges de Status (em tabelas)

```html
<!-- Vermelho — urgente, perigo -->
<span class="status-badge status-danger">Vencido</span>

<!-- Amarelo — atenção -->
<span class="status-badge status-warning">Atenção</span>

<!-- Verde — ok, concluído -->
<span class="status-badge status-success">Conferido</span>

<!-- Azul — informativo -->
<span class="status-badge status-info">Em Andamento</span>
```

---

## 🗃️ Tabela Padrão

```html
<div class="deadlines-container">
    <div class="section-title">
        <h3>Título da Seção</h3>
        <!-- filtros e botões aqui -->
    </div>

    <div class="table-wrapper">
        <table class="deadlines-table">
            <thead>
                <tr>
                    <th>Coluna 1</th>
                    <th class="sortable-th" onclick="sortMinhaTabela('campo')">
                        Coluna Ordenável <i class="fa-solid fa-sort"></i>
                    </th>
                    <th style="text-align: right;">Ações</th>
                </tr>
            </thead>
            <tbody id="minha-lista">
                <!-- preenchido via JS -->
            </tbody>
        </table>

        <div id="empty-state-minha" class="empty-state hidden">
            <i class="fa-solid fa-folder-open"></i>
            <p>Nenhum item encontrado.</p>
        </div>
    </div>
</div>
```

### Linha de tabela com ações (gerada via JS)
```javascript
tr.innerHTML = `
    <td>${esc(item.nome)}</td>
    <td>${esc(item.descricao)}</td>
    <td class="action-buttons">
        <button class="btn-icon btn-edit" onclick="editar('${item.id}')" title="Editar">
            <i class="fa-solid fa-pen"></i>
        </button>
        <button class="btn-icon btn-delete" onclick="excluir('${item.id}')" title="Excluir">
            <i class="fa-solid fa-trash"></i>
        </button>
    </td>
`;
```
> ⚠️ Sempre use `esc()` ao inserir dados do usuário via innerHTML para evitar falhas de segurança.

---

## 🪟 Modal Padrão

```html
<div id="modal-meu" class="modal-overlay hidden">
    <div class="modal-box">
        <div class="modal-header">
            <h2><i class="fa-solid fa-plus"></i> Título do Modal</h2>
            <button class="btn-close" type="button" onclick="fecharMeuModal()">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>
        <div class="modal-body">

            <!-- campos do formulário aqui -->

            <div class="form-actions">
                <button type="button" class="btn-secondary" onclick="fecharMeuModal()">Cancelar</button>
                <button type="button" class="btn-primary" onclick="salvarMeuModal()">
                    <i class="fa-solid fa-save"></i> Salvar
                </button>
            </div>
        </div>
    </div>
</div>
```

### Abrir e fechar modal via JS
```javascript
function abrirMeuModal() {
    document.getElementById('modal-meu').classList.remove('hidden');
}
function fecharMeuModal() {
    document.getElementById('modal-meu').classList.add('hidden');
}
```

---

## 🔔 Notificações (Toast)

Sempre use a função JS existente — nunca crie popups manuais:
```javascript
showToast("Salvo com sucesso!", "success");  // verde
showToast("Ocorreu um erro.", "error");       // vermelho
showToast("Atenção: verifique os dados.", "warning"); // amarelo
showToast("Informação genérica.");            // azul (padrão)
```

---

## 🏗️ Seções de Destaque (painéis internos com borda colorida)

```html
<!-- Destaque azul (informações principais) -->
<div style="background:var(--secondary); padding:1.5rem; border-radius:8px; margin-bottom:1.5rem; border-left:4px solid var(--primary);">
    <h4 style="margin-bottom:1rem; color:var(--text-main);">Título da Seção</h4>
    <!-- conteúdo aqui -->
</div>

<!-- Destaque vermelho (zona de perigo) -->
<div style="background:var(--danger-light); padding:1.5rem; border-radius:8px; border-left:4px solid var(--danger);">
    <h4 style="color:var(--danger);">⚠️ Zona de Perigo</h4>
</div>

<!-- Destaque verde (sucesso / positivo) -->
<div style="background:var(--success-light); padding:1.5rem; border-radius:8px; border-left:4px solid var(--success);">
    <h4 style="color:var(--success);">✓ Configuração OK</h4>
</div>
```

---

## 🔍 Barra de Busca com Botão Limpar

```html
<div style="position: relative; flex: 1; min-width: 250px;">
    <input type="text" id="search-minha-lista" placeholder="Pesquisar..."
        oninput="renderMinhaLista()">
    <button class="btn-icon"
        onclick="document.getElementById('search-minha-lista').value=''; renderMinhaLista()"
        style="position: absolute; right: 2px; top: 50%; transform: translateY(-50%); color: var(--text-light);"
        title="Limpar">
        <i class="fa-solid fa-xmark"></i>
    </button>
</div>
```

---

## 📐 Regras de Ouro (para o Antigravity seguir)

1. **Nunca use cores fixas** como `#ff0000`, `blue`, `rgb(...)`. Use sempre `var(--nome-da-cor)`.
2. **Nunca crie botões com `style` inline**, exceto para sobrescrever cor de fundo com `var(--danger)`.
3. **Sempre use `esc()`** ao inserir texto do usuário via innerHTML no JavaScript.
4. **Inputs, selects e botões** têm sempre 42px de altura — não mude isso.
5. **Ícones**: use sempre Font Awesome 6 com `<i class="fa-solid fa-nome-do-icone"></i>`.
6. **Espaçamento**: use `gap`, `padding` e `margin` com valores em `rem` ou `px` redondos.
7. **Novas unidades**: se precisar adicionar uma cidade, edite apenas o array `UNIDADES` no topo do `script.js`.
8. **Ao adicionar nova aba/seção**: siga o mesmo padrão `<section id="view-nome" class="view-section">` e adicione o link na sidebar com `data-tab="nome"`.
