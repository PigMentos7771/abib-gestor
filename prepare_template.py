import zipfile
import base64
import os
import re

docx_path = 'FICHA_PROCESSAR.docx'
out_path = 'FICHA_TEMPLATE_FINAL.docx'
js_out = 'templateBase64.js'

if not os.path.exists(docx_path):
    print("Arquivo não encontrado")
    exit(1)

with zipfile.ZipFile(docx_path, 'r') as zin:
    with zipfile.ZipFile(out_path, 'w') as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)
            if item.filename == 'word/document.xml':
                xml = content.decode('utf-8')
                
                # Regex builder that ignores any interspersed XML tags (e.g. <w:t>, <w:r>) between characters
                def make_regex(text):
                    parts = []
                    for i, c in enumerate(text):
                        if c == ' ':
                            parts.append(r'(?:\s|<[^>]+>)*')
                        else:
                            parts.append(re.escape(c))
                        
                        # Only allow interleaving tags BETWEEN characters, never at the very end.
                        if i < len(text) - 1:
                            parts.append(r'(?:<[^>]+>)*')
                    return re.compile(''.join(parts))

                xml = re.sub(make_regex('(UNIDADE)'), '({unidade})', xml)
                xml = re.sub(make_regex('(NOME)'), '{nome}', xml)
                xml = re.sub(make_regex('PIS: ___'), 'PIS: {pis} ___', xml)
                # Removes any excessive underscores
                xml = re.sub(r'\{pis\}\s*(?:<[^>]+>|_|\s)*\.', '{pis}.', xml)
                
                xml = re.sub(make_regex('(DD) 9XXXXXXXX'), '{telefone}', xml)
                xml = re.sub(make_regex('(ESCOLARIDADE)'), '{escolaridade}', xml)
                xml = re.sub(make_regex('(DATA)'), '{data}', xml)
                xml = re.sub(make_regex('(SALÁRIO)'), '{salario}', xml)
                
                # Checkboxes
                xml = re.sub(make_regex('(  ) 30 dias'), '({exp30}) 30 dias', xml)
                xml = re.sub(make_regex('( X ) 45 dias'), '({exp45}) 45 dias', xml)
                xml = re.sub(make_regex('(  ) 60 dias'), '({exp60}) 60 dias', xml)
                xml = re.sub(make_regex('(  ) 90 dias'), '({exp90}) 90 dias', xml)
                
                xml = re.sub(make_regex('( ) sim'), '({vtsim}) sim', xml)
                
                # Using regex dot for 'ã' to avoid encoding issues
                vt_regex_parts = []
                for i, c in enumerate('( X ) n'):
                    if c == ' ':
                        vt_regex_parts.append(r'(?:\s|<[^>]+>)*')
                    else:
                        vt_regex_parts.append(re.escape(c))
                    if i < len('( X ) n') - 1:
                        vt_regex_parts.append(r'(?:<[^>]+>)*')
                
                vt_regex = ''.join(vt_regex_parts) + r'(?:<[^>]+>)*.' + r'(?:<[^>]+>)*o'
                xml = re.sub(vt_regex, '({vtnao}) não', xml)
                
                content = xml.encode('utf-8')
            zout.writestr(item, content)

with open(out_path, 'rb') as f:
    b64 = base64.b64encode(f.read()).decode('utf-8')

with open(js_out, 'w') as f:
    f.write("const TEMPLATE_ADMISSAO_B64 = '" + b64 + "';\n")

print("Base64 regerado via Regex Avançada com sucesso.")
