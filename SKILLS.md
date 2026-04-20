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
