# Prompt de Contexto - Precision Inventory

Use este texto no inicio de um novo chat quando o historico estiver pesado.

```text
Voce esta trabalhando no projeto Precision Inventory em:
C:\Users\dmitry.santos\Desktop\Sistema inventario

Regras de seguranca:
- Nunca mexer em pastas do Windows, boot, registro, drivers, inicializacao ou arquivos de sistema.
- Trabalhar somente dentro do projeto e nas memorias autorizadas: HANDOFF.md, SKILLS.md, docs, Obsidian e ~/.hermes.
- Antes de alterar codigo, ler AGENTS.md, HANDOFF.md, SKILLS.md e os arquivos que serao alterados.
- Nao reverter mudancas do usuario ou de outra IDE sem pedido explicito.

Tecnologias:
- Frontend: React 19, TypeScript, Vite 6, Tailwind CSS 4 e lucide-react.
- Leitura de codigo: @zxing/browser, QR Code e codigo de barras, com fallback por numero/foto quando fizer sentido.
- Etiquetas/impressao: qrcode, jsbarcode e janela de impressao do navegador.
- PDF de cotacoes: pdfjs-dist, carregado sob demanda somente ao clicar em Importar PDF.
- Importacao Excel: read-excel-file.
- OCR/foto: tesseract.js.
- Online: Cloudflare Pages + Pages Functions + Cloudflare D1.
- API principal: functions/api/state.js.
- Banco D1: precision-inventory-db.
- GitHub: https://github.com/dmitrymarcelo/precision-inventory
- Producao: https://precision-inventory.pages.dev/

Comandos confiaveis nesta maquina:
- TypeScript:
  & 'C:\Users\dmitry.santos\Desktop\Sistema inventario\.codex-tools\node-v24.15.0-win-x64\node.exe' '.\node_modules\typescript\bin\tsc' --noEmit
- Build:
  & 'C:\Users\dmitry.santos\Desktop\Sistema inventario\.codex-tools\node-v24.15.0-win-x64\node.exe' '.\node_modules\vite\bin\vite.js' build
- Deploy:
  & 'C:\Users\dmitry.santos\Desktop\Sistema inventario\.codex-tools\node-v24.15.0-win-x64\node.exe' 'C:\Users\dmitry.santos\Desktop\Sistema inventario\.codex-tools\wrangler-runner\node_modules\wrangler\bin\wrangler.js' pages deploy dist --project-name precision-inventory --branch main --commit-dirty true --commit-message "<mensagem>"
- Validar producao:
  https://precision-inventory.pages.dev/
  https://precision-inventory.pages.dev/api/state

Estrutura principal:
- src/App.tsx: estado principal, navegacao, sincronizacao online e permissao.
- src/types.ts: tipos centrais de estoque, solicitacao, compras e cotacoes.
- src/components/Dashboard.tsx: painel, alertas, Curva ABC e indicadores.
- src/components/InventoryList.tsx: pagina Estoque, Atualizar Estoque e Recebimento.
- src/components/MaterialRequestForm.tsx: Solicitacao de pecas.
- src/components/MaterialSeparation.tsx: Separacao com leitura obrigatoria de etiqueta.
- src/components/OperationalInventory.tsx: Inventario Operacional priorizado por Curva ABC.
- src/components/AutomaticPurchases.tsx: Compras Automaticas, pacotes, cotacoes, PDF e mapa de cotacao.
- src/abcAnalysis.ts e src/abcAnalysisData.ts: Curva ABC, minimo/maximo automaticos.
- src/inventoryRules.ts: status e limites por item.
- functions/api/state.js: fonte de verdade online via D1.
- docs/COMPRAS_AUTOMATICAS.md: regra tecnica do modulo Compras.

Regras de negocio que nao podem quebrar:
- Em Atualizar Estoque, quantidade digitada = saldo final contado. Nao e entrada nem saida.
- Entrada real de material acontece somente pelo fluxo Recebimento.
- Compra, cotacao, aprovacao ou marcar como comprada nunca altera saldo.
- O botao `Ativo` pede confirmacao antes de marcar ou desmarcar um SKU.
- Alertas sao por item; o Painel nao deve virar regra unica centralizada.
- Localizacao importada vem da coluna K, campo locacao, da planilha principal.
- Solicitacao de pecas gira em torno de placa e centro de custo.
- Nao adicionar item sem saldo na solicitacao; bloquear visualmente.
- Separacao so confirma item lido se o codigo pertencer ao pedido aberto.
- Pedido entregue/atendido vira consulta: nao editar nem excluir.
- Mobile e prioridade operacional.
- Interface em portugues do Brasil, linguagem simples.

Curva ABC e min/max:
- Usar somente SKUs ativos do armazem nas sugestoes automaticas.
- Classe A: minimo 0,5 mes, maximo 1,5 mes.
- Classe B: minimo 0,35 mes, maximo 1 mes.
- Classe C: minimo 0,2 mes, maximo 0,75 mes.
- Quando houver saidas recentes, usar a maior demanda entre Curva ABC e consumo dos ultimos 120 dias.
- Entradas recentes aparecem em relatorio, mas nao reduzem min/max automaticamente.

Compras Automaticas:
- Necessidade = maximo calculado - saldo atual.
- Pacotes agrupados por tipo do item e classificacao.
- Classificacoes: Critico, Repor, Manual, Kit preventiva.
- VW deve aparecer como SAVEIRO/GOL.
- CHEVROLET deve aparecer como S-10.
- OLEO permanece como tipo operacional de compra quando salvo no item.
- Pedido manual de compra usa placa e centro de custo editaveis; placa deve buscar a base de veiculos e SKU deve sugerir itens automaticamente ao digitar.
- Aprovacao de item/pacote exige no minimo 3 cotacoes recebidas.
- Cotacao completa exige fornecedor e valor unitario.
- Pontuacao sugerida: preco/custo total 45%, tecnica 35%, prazo 20%.
- A escolha final continua humana e pode ter justificativa.

Regras de importacao de PDF em cotacoes:
- Cada linha de cotacao tem botao Importar PDF.
- O leitor de PDF usa pdfjs-dist com importacao dinamica/sob demanda para nao pesar a tela.
- Tentar preencher automaticamente: fornecedor, contato, numero da cotacao, data, validade, valor unitario, frete/taxas, prazo e pagamento.
- Se o PDF for escaneado/imagem e nao tiver texto, avisar e manter preenchimento manual.
- Se o PDF tiver varios SKUs, reconhecer itens de qualquer tipo/subgrupo: Critico, Repor, Manual ou Kit preventiva.
- Mostrar itens reconhecidos com SKU, descricao, tipo, classificacao e confianca.
- Permitir marcar/desmarcar itens reconhecidos.
- Permitir vincular manualmente quando o PDF nao reconhecer.
- Ao salvar, replicar a cotacao para outros itens reconhecidos, mas sem escolher vencedor/aprovar automaticamente nesses itens.
- Cada cotacao tem botao pequeno Imprimir mapa para layout de impressao.
- Ao imprimir cotacao com item vinculado, mostrar como um unico orcamento com varias linhas de item.
- Se o item vinculado ja tiver cotacoes no proprio SKU, o mapa deve puxar quantidade, valor unitario e total dessa cotacao; nao deixar a linha vinculada com `-`.
- Em mapas impressos, revisar codificacao para evitar texto quebrado; usar charset explicito e rotulos seguros quando necessario.

Memorias do projeto:
- AGENTS.md: regras obrigatorias para agentes.
- HANDOFF.md: estado atual, validacoes e deploys.
- SKILLS.md: playbook do projeto.
- docs/PROMPT_DE_CONTEXTO.md: contexto curto para novo chat.
- Obsidian: C:\Users\dmitry.santos\Downloads\Lembranças\Precision Inventory
- Hermes: C:\Users\dmitry.santos\.hermes\MEMORY.md, USER.md e skills.

Fluxo de trabalho:
- Se a tarefa for grande ou o contexto estiver pesado, sugerir abrir novo chat e usar este prompt.
- Para mudancas de codigo: alterar pouco por vez, validar com tsc e vite build.
- Para mudancas de app: publicar no Cloudflare Pages e validar / e /api/state.
- Atualizar HANDOFF.md e memoria relevante ao concluir.
- Sincronizar GitHub quando o usuario pedir ou quando a etapa importante precisar ficar registrada.
```
