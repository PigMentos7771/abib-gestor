# Backup de segurança - OCR Contorno

Data: 2026-04-07

Objetivo: checkpoint antes da implementação de contorno visual de cartão por IA no modal de vinculação OCR.

## Trecho base `index.html` (modal OCR vinculação)

```html
<div id="ocr-zoom-box" class="ocr-zoom-container" onmousemove="handleOcrZoom(event)"
    onmouseleave="resetOcrZoom()" onwheel="handleOcrScroll(event)"
    style="flex: 1; min-width: 250px; background: var(--bg-card); padding: 10px; border-radius: 8px; border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; overflow: hidden; max-height: 400px; position: relative;">
    <div
        style="position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.6); color: white; padding: 4px 8px; border-radius: 4px; pointer-events: none; font-size: 0.75rem; z-index: 10;">
        <i class="fa-solid fa-magnifying-glass-plus"></i> Role o mouse para +/- Zoom
    </div>
    <img id="ocr-preview-img" src=""
        style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px; pointer-events: none;">
</div>
```

## Trecho base `script.js` (prompt OCR)

```js
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
```

## Trecho base `script.js` (render modal vinculação)

```js
// Renderiza Dicas de Extração (As horas lidas na memória) para o usuário olhar
let htmlDicas = "";
if (missingCard.dias) {
    for (let d = 1; d <= 31; d++) {
        if (missingCard.dias[d.toString()]) {
            let info = missingCard.dias[d.toString()];
            const dFmt = d.toString().padStart(2, '0');
            if (info.folga) {
                htmlDicas += `D${dFmt} Folga/Ausência\n`;
                continue;
            }
            const p1 = (info.e1 && info.s1) ? `${info.e1} - ${info.s1}` : "";
            const p2 = (info.e2 && info.s2) ? `${info.e2} - ${info.s2}` : "";
            const avulsos = [];
            if (!p1 && info.e1) avulsos.push(info.e1);
            if (!p1 && info.s1) avulsos.push(info.s1);
            if (!p2 && info.e2) avulsos.push(info.e2);
            if (!p2 && info.s2) avulsos.push(info.s2);

            const partes = [];
            if (p1) partes.push(p1);
            if (p2) partes.push(p2);
            if (avulsos.length > 0) partes.push(avulsos.join(' | '));

            if (partes.length > 0) {
                htmlDicas += `D${dFmt}  ${partes.join(' | ')}\n`;
            }
        }
    }
}
if (!htmlDicas) htmlDicas = "Nesta grade, nenhuma batida clara foi legível pela Inteligência.";
document.getElementById('ocr-dicas-extracao').textContent = htmlDicas;
renderOcrSugestoesIA(missingCard);
```

