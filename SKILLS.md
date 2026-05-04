# SKILLS.md

Este arquivo registra as "habilidades" praticas do projeto. Pense nele como um playbook vivo.

## Skill 1 - Importar inventario principal

Objetivo:

- carregar a planilha `mata225`
- transformar colunas no modelo interno

Mapa atual:

- `Produto` -> `sku`
- `Descricao` -> `name`
- `Saldo Atual` -> `quantity`
- `Grupo` -> categoria de origem
- `locacao` (coluna K) -> `location`

Cuidados:

- o status nao vem confiavel da planilha; ele e recalculado
- `location` vazia deve virar `Sem localizacao` no dado normalizado

## Skill 2 - Importar base de veiculos

Objetivo:

- alimentar placa + centro de custo para `Solicitacao de pecas`

Observacoes:

- o importador ja foi adaptado para CSVs reais do usuario
- algumas exportacoes usam `;`
- podem existir nomes como:
  - `cod_placa`
  - `centro_custo`
  - `cod_centro_custo`

Regra:

- sem placa e sem centro de custo valido, nao importa

## Skill 3 - Operar Buscar e Atualizar

Fluxo:

1. localizar SKU por texto ou leitor
2. abrir o item
3. ajustar:
   - quantidade atual contada
   - localizacao atual
   - limites de alerta do item
4. salvar ajuste
5. consultar logs do SKU

Regra critica:

- quantidade digitada = saldo final contado
- o botao `Ativo` deve pedir confirmacao antes de marcar ou desmarcar o SKU

## Skill 4 - Operar Solicitacao de pecas

Fluxo:

1. informar placa
2. puxar centro de custo
3. buscar itens
4. adicionar somente itens com saldo
5. salvar ou enviar para separacao

Regra de bateria:

- se a placa ja recebeu uma bateria em solicitacao `Atendida` ainda dentro da validade, abrir popup de confirmacao ao tentar incluir outra bateria
- o `OK` do popup confirma a inclusao do item; cancelar aborta a inclusao
- bateria geral vale 12 meses
- `12047 - BATERIA 5A 12V` vale 6 meses por ser bateria de moto
- a regra usa `fulfilledAt` da solicitacao atendida; se faltar, usa a data atualizada como fallback
- pedidos estornados/excluidos nao contam
- fonte da regra: `src/batteryWarrantyRules.ts`

Estados esperados:

- aberta
- em separacao
- separada
- atendida

## Skill 5 - Operar Separacao de material

Fluxo:

1. abrir pedido
2. iniciar leitor
3. conferir item por codigo
4. separar quantidades
5. concluir pedido

Comportamento esperado do leitor:

- codigo correto do pedido -> confirma
- codigo errado -> erro visual
- item fora do pedido -> rejeita

## Skill 6 - Etiquetas

Hoje existem dois formatos:

### A. Codigo de barras

Uso:

- fluxo principal
- mais estavel
- varias etiquetas por folha A4

### B. QR compacto

Uso:

- teste controlado
- layout menor
- QR do SKU + nome ao lado

Regra de seguranca:

- para evitar travamento, usar selecao menor

## Skill 7 - Revisao de texto e codificacao

Quando houver texto estranho:

- procurar `\\u00`
- procurar `Ã`, `�`, `Â`
- revisar JSX e strings visiveis

Arquivos mais sensiveis:

- `src/components/InventoryList.tsx`
- `src/App.tsx`
- `src/types.ts`
- `README.md`

## Skill 8 - Persistencia online

Ponto central:

- `functions/api/state.js`

O estado online guarda:

- itens
- logs
- configuracoes
- solicitacoes
- veiculos
- aliases OCR

## Skill 9 - Deploy

Fluxo nominal:

1. `npm run lint`
2. `npm run build`
3. `npm run deploy`

Se o deploy travar:

- registrar no `HANDOFF.md`
- nao assumir que a versao subiu
- deixar um preview local para validacao

## Skill 10 - Boas praticas para este projeto

- mudar pouco por vez
- validar a UX mobile
- nao quebrar o fluxo de operacao para testar uma ideia
- manter um caminho estavel e outro experimental quando necessario
- documentar decisoes novas nos arquivos de memoria
- protecoes contra toque acidental, como confirmacao do botao `Ativo`, devem valer tanto no estoque quanto no detalhe do item

## Skill 11 - Curva ABC e limites automaticos

Objetivo:

- usar a base tratada `Analise_Curva_ABC_Estoque_2026_Atualizada.xlsx`
- classificar somente SKUs ativos do sistema no painel
- priorizar alertas criticos/reposicao pelo rank da Curva ABC sem perder o agrupamento por tipo

Arquivos principais:

- `src/abcAnalysisData.ts`: base ABC gerada a partir da planilha tratada
- `src/abcAnalysis.ts`: busca por SKU e politica de minimo/maximo
- `src/inventoryRules.ts`: aplica a politica ABC antes dos limites manuais do item
- `src/components/Dashboard.tsx`: mostra resumo ABC e ordena o top de alertas

Regra atual:

- Classe A: minimo = 0,5 mes de demanda media; maximo = 1,5 mes
- Classe B: minimo = 0,35 mes; maximo = 1 mes
- Classe C: minimo = 0,2 mes; maximo = 0,75 mes
- No sistema, minimo alimenta `criticalLimit` e maximo alimenta `reorderLimit`
- SKU fora da Curva ABC continua usando os limites manuais/fallback ja existentes
- Quando existem movimentacoes recentes, a politica usa a maior demanda entre:
  - media mensal da Curva ABC tratada
  - saidas recentes dos ultimos 120 dias convertidas em media mensal
- Entradas recentes aparecem no relatorio explicativo, mas nao reduzem minimo/maximo automaticamente
- No Painel, clicar em item alertado deve abrir relatorio rapido antes de abrir o SKU
- No Inventario Operacional, a fila deve priorizar classe/rank ABC, status critico/reposicao, divergencia, movimentacao e falta de localizacao

## Skill 12 - Memoria Obsidian

Objetivo:

- usar o cofre `Lembrancas` como memoria ampla e navegavel do projeto
- manter um mapa visual para decisoes, regras, riscos, Curva ABC, deploy e handoff

Caminho do cofre:

- `C:\Users\dmitry.santos\Downloads\Lembrancas`
- No Windows/Obsidian o nome aparece como `Lembranças`

Notas principais:

- `Armazem 28/00 - Mapa do Projeto`
- `Armazem 28/01 - Regras de Negocio`
- `Armazem 28/02 - Modulos e Fluxos`
- `Armazem 28/03 - Deploy Cloudflare e GitHub`
- `Armazem 28/04 - Curva ABC e Inventario Operacional`
- `Armazem 28/05 - Decisoes Recentes`
- `Armazem 28/06 - Riscos e Cuidados`
- `Armazem 28/08 - Prompt de Contexto`
- `Armazem 28/99 - Diario de Handoff`

Regra:

- Obsidian complementa, mas nao substitui `HANDOFF.md`, `SKILLS.md` e `AGENTS.md`
- Ao concluir etapa importante, registrar no `HANDOFF.md`; quando for conhecimento amplo, registrar tambem no Obsidian

## Skill 13 - Compras automaticas

Objetivo:

- transformar alertas criticos, reposicao e pedidos manuais em uma fila de compras por pacote
- sugerir quantidade ideal sem dar entrada automatica no estoque
- manter aprovacao humana antes de compra/recebimento

Regra inicial:

- `necessidade = maximoAutomatico - saldoAtual`
- se saldo atual estiver abaixo do minimo, prioridade `Urgente`
- se estiver abaixo do maximo, prioridade `Repor`
- Classe A e saidas recentes sobem prioridade
- Estoque so aumenta pelo fluxo `Recebimento`, nunca pela aprovacao de compra

Agrupamento atual:

- somente SKUs com `isActiveInWarehouse === true` entram nas sugestoes automaticas
- pacotes sao separados por `tipo do veiculo`/tipo operacional e por classificacao
- classificacoes principais: `Critico`, `Repor`, `Manual`, `Kit preventiva`
- `VW` deve aparecer como `SAVEIRO/GOL`
- `CHEVROLET` deve aparecer como `S-10`
- `OLEO`, quando salvo no item, deve continuar como tipo operacional para compra
- pedido manual de compra deve ter placa, centro de custo editavel, SKU, quantidade e motivo
- ao digitar a placa no pedido manual, buscar a base de veiculos e preencher centro de custo quando encontrar
- ao digitar SKU/nome no pedido manual, mostrar sugestoes de itens automaticamente
- o pedido manual pode ser montado com varios SKUs antes de salvar
- cada SKU do pedido manual pode ter quantidade editada ou ser removido no formulario
- pedidos manuais em `Manual` ou `Em analise` podem ser editados/removidos depois de criados
- quando varios SKUs forem salvos juntos, manter o lote pelo campo `manualBatchId`

Cotacoes:

- `Analisar` abre o mapa de cotacoes do SKU
- exigir no minimo 3 cotacoes recebidas para aprovar item ou pacote
- cotacao completa precisa ter fornecedor e valor unitario
- registrar contato, numero, data, validade, frete/taxas, prazo, pagamento, nota tecnica e observacoes
- pontuacao sugerida: preco/custo total 45%, tecnica 35%, prazo 20%
- menor preco nao e obrigatoriamente vencedor; registrar justificativa da escolha
- cotacao/aprovacao nunca altera saldo do estoque
- cada cotacao pode importar PDF de fornecedor
- leitura de PDF deve carregar o motor sob demanda para nao pesar a abertura da tela
- se o PDF tiver varios SKUs, reconhecer itens de qualquer tipo/subgrupo `Critico`, `Repor`, `Manual` ou `Kit preventiva`
- quando reconhecer outros SKUs no PDF, salvar a cotacao tambem nos itens vinculados, sem aprovar automaticamente
- se o PDF nao reconhecer um item, permitir vinculo manual no formulario
- cada cotacao tem botao para imprimir o mapa de cotacao
- ao imprimir item vinculado, o mapa deve aparecer como um unico orcamento com varias linhas de item
- se o item vinculado ja tiver cotacoes salvas no proprio SKU, o mapa deve reaproveitar quantidade, valor unitario e total dessa cotacao em vez de imprimir `-`

Memoria Obsidian:

- `Armazem 28/07 - Proposta Compras Automaticas`

Documento tecnico no projeto:

- `docs/COMPRAS_AUTOMATICAS.md`

## Skill 14 - Troca de chat com pouco contexto

Objetivo:

- quando o contexto da conversa ficar grande, abrir um novo chat sem perder as regras do projeto
- economizar credito evitando reler todo o historico antigo

Fonte principal:

- `docs/PROMPT_DE_CONTEXTO.md`

Regra:

- antes de iniciar um novo chat, usar o prompt de contexto como handoff
- o novo agente deve ler `AGENTS.md`, `HANDOFF.md`, `SKILLS.md` e `docs/PROMPT_DE_CONTEXTO.md`
- para modulo `Compras`, ler tambem `docs/COMPRAS_AUTOMATICAS.md`
- para memoria ampla, consultar Obsidian `Armazem 28/08 - Prompt de Contexto`
- para memoria procedural Hermes, consultar `C:\Users\dmitry.santos\.hermes\skills\precision-inventory-context\SKILL.md`

Quando sugerir novo chat:

- conversa muito longa
- muitas ferramentas chamadas
- tarefa nova e grande depois de uma entrega concluida
- risco de gastar credito relendo contexto antigo

## Skill 15 - Graphify do projeto

Objetivo:

- usar Graphify como mapa rapido de arquitetura do projeto
- reduzir buscas repetidas em arquivos quando a pergunta for sobre relacao entre modulos

Instalacao local atual:

- CLI: `C:\Users\dmitry.santos\.local\bin\graphify.exe`
- Grafo do projeto: `graphify-out/`
- Relatorio principal: `graphify-out/GRAPH_REPORT.md`
- Hook local do Codex: `.codex/hooks.json`
- Skill Hermes: `C:\Users\dmitry.santos\.hermes\skills\graphify\SKILL.md`
- Skill Hermes do fluxo do projeto: `C:\Users\dmitry.santos\.hermes\skills\precision-inventory-graphify\SKILL.md`

Regras:

- antes de perguntas grandes de arquitetura, ler `graphify-out/GRAPH_REPORT.md`
- para relacoes entre modulos, usar `graphify query`, `graphify path` ou `graphify explain`
- apos alterar codigo, rodar `C:\Users\dmitry.santos\.local\bin\graphify.exe update .`
- nao adicionar `graphify-out/cache/`, `graphify-out/manifest.json` nem `graphify-out/cost.json` ao Git
- manter `.graphifyignore` evitando `node_modules`, `dist`, `.codex-tools`, `AGENTS.md`, `.codex` e o proprio `graphify-out`

## Skill 16 - Divergencias operacionais

Objetivo:

- tratar divergencia como pendencia operacional ate recontagem administrativa
- reduzir risco de furo em estoque, solicitacao e separacao sem mexer em Compras/Pagamentos

Regra atual:

- a fonte compartilhada da regra e `src/divergenceRules.ts`
- divergencia aberta = ultimo log `divergencia` do SKU sem log posterior `ajuste`
- `ajuste` posterior representa recontagem e encerra a pendencia
- `recebimento` nao encerra divergencia
- `solicitacao` nao encerra divergencia

Aplicacao:

- `Inventario Operacional` mostra divergencias abertas mesmo se forem de outro dia
- `Buscar e Atualizar` mostra alerta de divergencia aberta e pede confirmacao para encerrar por ajuste
- `Solicitacao de pecas` bloqueia item com divergencia aberta antes de criar/salvar pedido
- `Separacao de material` registra motivo quando o saldo real diverge do sistema
- baixa final com divergencia exige admin
- `Historico` mostra divergencias da solicitacao com sistema, real, diferenca e motivo

Cuidados:

- nao liberar item divergente em nova solicitacao sem recontagem
- nao considerar recebimento como solucao automatica para divergencia antiga
- se alterar esse fluxo, validar mobile e fluxo de separacao com leitor

## Skill 17 - Protocolo Karpathy para Codex

Objetivo:

- consultar primeiro o protocolo de trabalho antes de tarefas de codigo
- reduzir suposicoes erradas, overengineering, refatoracao lateral e entrega sem verificacao

Fonte principal no projeto:

- `CODEX.md`

Fonte instalada como skill global do Codex:

- `C:\Users\dmitry.santos\.codex\skills\karpathy-guidelines\SKILL.md`
- referencias originais em `C:\Users\dmitry.santos\.codex\skills\karpathy-guidelines\references\`

Repositorio clonado para referencia local:

- `.codex-tools/andrej-karpathy-skills`

Regra:

- antes de mexer em codigo, consultar `CODEX.md`
- para tarefas nao triviais, aplicar os quatro principios:
  - pensar antes de codar
  - simplicidade primeiro
  - mudancas cirurgicas
  - execucao guiada por objetivo verificavel
- o protocolo complementa, mas nao substitui, `AGENTS.md`, `HANDOFF.md` e as regras de negocio do estoque

## Skill 18 - Kit Preventivas

Objetivo:

- manter os kits de preventiva centralizados e consistentes entre a tela `Kit Preventivas` e o seletor de kits em `Solicitacao de pecas`

Fonte principal:

- `src/preventiveKitCatalog.ts`

Regra:

- alterar componentes do kit somente no catalogo central
- validar se a tela e o seletor de solicitacao usam o mesmo SKU apos a mudanca

Kit `MOTO` atual:

- `18002` - `FILTRO COMBUSTIVEL GI80 HONDA NXR BROS` - exige 1
- `17902` - `OLEO 20W50 MOTO - LITRO` - exige 1

## Skill 19 - Superpowers para Codex

Objetivo:

- disponibilizar metodologia complementar de desenvolvimento por skills, sem substituir o protocolo `CODEX.md`
- usar processos estruturados quando a tarefa pedir descoberta, planejamento, TDD, debug, revisao ou verificacao final

Instalacao atual:

- clone principal: `C:\Users\dmitry.santos\.codex\superpowers`
- descoberta de skills por junction: `C:\Users\dmitry.santos\.agents\skills\superpowers`
- clone de referencia do projeto: `.codex-tools/superpowers`
- fonte: `https://github.com/obra/superpowers.git`

Skills instaladas:

- `brainstorming`
- `dispatching-parallel-agents`
- `executing-plans`
- `finishing-a-development-branch`
- `receiving-code-review`
- `requesting-code-review`
- `subagent-driven-development`
- `systematic-debugging`
- `test-driven-development`
- `using-git-worktrees`
- `using-superpowers`
- `verification-before-completion`
- `writing-plans`
- `writing-skills`

Regra:

- consultar `CODEX.md` primeiro em tarefas de codigo
- usar Superpowers depois, quando alguma skill combinar com o trabalho
- as regras de negocio do inventario e a UX mobile continuam tendo prioridade
- reiniciar o Codex para a lista de skills aparecer em novas sessoes

Validacao:

- todas as skills passaram no `quick_validate.py` com `PYTHONUTF8=1`

## Skill 20 - Validade de bateria por placa

Objetivo:

- abrir popup de confirmacao quando uma placa tentar solicitar outra bateria antes de vencer a validade da ultima bateria atendida
- reduzir troca duplicada e facilitar revisao operacional sem bloquear casos legitimos

Fonte principal:

- `src/batteryWarrantyRules.ts`
- integracao visual em `src/components/RequestManager.tsx`

Regra atual:

- validade operacional da bateria geral = 12 meses a partir da data de fechamento da solicitacao atendida
- validade do SKU `12047 - BATERIA 5A 12V` = 6 meses, por ser bateria de moto
- o calculo usa `fulfilledAt`; se um registro antigo nao tiver esse campo, usa `updatedAt` ou `createdAt`
- compara por placa normalizada
- considera apenas solicitacoes `Atendida`
- ignora solicitacoes excluidas, estornadas e o proprio pedido em edicao
- identifica baterias de veiculo por descricao/categoria contendo `BATERIA`
- ignora acessorios como terminal, cabo, suporte, tampa, carregador e bateria pequena/litio tipo `CR2032`
- o alerta aparece no formulario quando o pedido atual tem bateria e a placa tem bateria ainda dentro da validade operacional
- ao adicionar bateria por busca, leitor, seletor por modelo ou kit, abre popup antes de incluir se houver validade ativa

Comportamento:

- popup exige `OK` para confirmar a inclusao do item
- se cancelar, a bateria nao entra na solicitacao
- texto deve orientar revisao antes de liberar outra bateria
- se no futuro o usuario pedir bloqueio obrigatorio, transformar a regra em validacao antes de salvar
