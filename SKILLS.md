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

## Skill 4 - Operar Solicitacao de pecas

Fluxo:

1. informar placa
2. puxar centro de custo
3. buscar itens
4. adicionar somente itens com saldo
5. salvar ou enviar para separacao

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

- `Precision Inventory/00 - Mapa do Projeto`
- `Precision Inventory/01 - Regras de Negocio`
- `Precision Inventory/02 - Modulos e Fluxos`
- `Precision Inventory/03 - Deploy Cloudflare e GitHub`
- `Precision Inventory/04 - Curva ABC e Inventario Operacional`
- `Precision Inventory/05 - Decisoes Recentes`
- `Precision Inventory/06 - Riscos e Cuidados`
- `Precision Inventory/99 - Diario de Handoff`

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

Memoria Obsidian:

- `Precision Inventory/07 - Proposta Compras Automaticas`

Documento tecnico no projeto:

- `docs/COMPRAS_AUTOMATICAS.md`
