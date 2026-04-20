# HANDOFF.md

Ultima atualizacao: 2026-04-20

## Resumo executivo

O sistema ja tem os modulos principais funcionando:

- Painel
- Atualziar Estoque
- Kit Preventivas
- Solicitacao de pecas
- Separacao de material
- Inventario
- Impressao de etiquetas
- Persistencia online via Cloudflare D1

## Estado atual por modulo

### 1. Painel

- Mostra metricas operacionais
- Botoes principais ja ficaram interativos
- Nao deve voltar a concentrar regra unica de alerta
- O antigo bloco `Atalhos por veiculo` saiu do painel e virou acesso para uma aba dedicada

### 2. Atualziar Estoque

- Busca por SKU
- Leitura por camera/foto
- Leitor agora aceita QR Code e codigo de barras
- Quantidade digitada representa saldo contado atual
- Localizacao pode ser corrigida
- Agora existe campo de `modelo do veiculo` salvo no item
- O item agora salva tambem `tipo do veiculo`, derivado do modelo oficial
- Em `Buscar e Atualizar`, o campo operacional visivel deixou de editar `modelo do veiculo` e passou a editar direto `tipo do veiculo`
- Regra de alerta e editada por item
- Existe botao para imprimir etiqueta do item aberto

### 3. Solicitacao de pecas

- Formulario simplificado por placa + centro de custo
- Usa base de veiculos importada
- Nao permite adicionar item sem saldo
- Pedido pode ser editado/excluido enquanto nao foi entregue
- Pedido entregue fica bloqueado para consulta

### 4. Separacao de material

- Leitor confirma apenas itens corretos do pedido aberto
- Leitor agora aceita QR Code e codigo de barras
- Leitura errada deixa o leitor em estado de erro
- Pedido entregue fica travado para consulta

### 5. Inventario

- Importa planilha principal mata225
- Paginacao em 100 itens por pagina
- Exporta CSV
- Abre painel de etiquetas
- Painel de etiquetas tem selecao por SKU e busca rapida
- Busca e exportacao agora consideram `modelo do veiculo` e `tipo do veiculo`

### 6. Kit Preventivas

- Nova aba dedicada para kits de manutencao preventiva
- Usa uma base fixa de referencias por modelo para calcular kits completos
- Calcula quantos kits cada modelo consegue montar com o estoque atual
- Mostra item limitante e componentes que impedem um kit completo
- Cada item do kit pode ser aberto direto em `Atualziar Estoque`

### 7. Pecas/Modelo

- Nova aba dedicada para navegacao por veiculo
- Fluxo em 3 etapas:
  - escolher `tipo`
  - escolher `modelo`
  - ver as `pecas` daquele grupo
- Ao tocar em uma peca, o sistema abre o SKU direto em `Atualziar Estoque`
- A aba considera:
  - `vehicleType` salvo no item
  - `vehicleModel` salvo no item
  - fallback de tipo derivado do modelo oficial

### 8. Etiquetas

- Formato inicial do painel: `QR Code`
- `Code 39` continua disponivel como fallback estavel
- O painel agora ficou focado em selecao + impressao, sem preview de modelo na tela
- Impressao em grade A4, varias etiquetas por folha
- O painel de `Etiquetas` agora abre mais leve:
  - marca por padrao apenas a pagina atual do inventario
  - limita a lista visivel de selecao para evitar congelamento com muitos SKUs
  - abre em `QR Code`, mantendo `Code 39` como alternativa manual
  - nao renderiza mais etiqueta de exemplo dentro do painel para reduzir carga

## Persistencia online

- Cloudflare Pages Functions: `functions/api/state.js`
- D1 configurado em `wrangler.toml`
- Banco: `precision-inventory-db`
- O estado salvo online inclui:
  - items
  - logs
  - settings
  - requests
  - vehicles
  - ocrAliases

## Decisoes de negocio ja fechadas

- Atualizacao de estoque = ajuste para saldo contado
- Regra de alerta por item
- Localizacao da planilha = coluna `K`, campo `locacao`
- Solicitacao gira em torno de placa e centro de custo
- Item sem saldo nao entra na solicitacao
- Entregue = somente consulta

## Problemas conhecidos hoje

1. Ainda existe risco de texto com codificacao ruim em arquivos antigos
   - Exemplos vistos em `README.md`, `src/App.tsx`, `src/types.ts`
   - A interface principal foi tratada em pontos criticos, mas ainda precisa de uma revisao ampla

2. Deploy com `wrangler` travou nesta maquina
   - `npm run lint` passou
   - `npm run build` passou
   - `npm run deploy` travou por timeout
   - o publish em producao foi concluido depois via MCP da Cloudflare

3. O painel de `Etiquetas` ainda precisa observacao em listas muito grandes
   - a previa foi removida para cortar o principal gargalo de renderizacao
   - `QR Code` virou formato inicial, mas `Code 39` continua como fallback estavel

4. O travamento ao clicar em `Etiquetas` estava concentrado no painel de selecao
   - a tela estava abrindo com itens demais marcados e renderizados ao mesmo tempo
   - o problema principal nao era apenas a troca entre codigo de barras e QR
   - a mitigacao atual reduz carga inicial e orienta o usuario a refinar a busca

5. Nesta maquina o `npm` nao ficou acessivel nesta sessao apos reinstalacao do Windows
   - as mudancas recentes nao puderam ser validadas com `npm run lint` e `npm run build`
   - precisa confirmar o ambiente Node antes da proxima etapa

6. O deploy automatico ficou bloqueado por autenticacao da Cloudflare
   - `wrangler pages deploy dist --project-name precision-inventory` pediu `CLOUDFLARE_API_TOKEN`
   - sem token no ambiente, o `wrangler` local continua bloqueado nesta maquina
   - nesta etapa a publicacao foi feita com sucesso via MCP da Cloudflare + upload manual dos assets

## O que acabou de ser feito

- Criada memoria persistente do projeto com:
  - `AGENTS.md`
  - `HANDOFF.md`
  - `SKILLS.md`
- A tela de etiquetas ganhou modo:
  - `Codigo de barras`
  - `QR compacto`
- A tela de Inventario teve textos importantes corrigidos
- O preview de etiquetas passou a respeitar o formato escolhido
- O leitor de `Buscar e Atualizar` passou a aceitar QR Code e codigo de barras
- O leitor de `Separacao de material` passou a aceitar QR Code e codigo de barras
- O fallback por codigo de barras e OCR numerico foi mantido para etiquetas antigas
- Foi usado um Node portatil dentro de `.codex-tools` para validar a etapa sem depender do Windows
- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Os assets de `dist` foram publicados no Cloudflare Pages via MCP
- O worker da API `/api/state` foi republicado como `_worker.bundle` com binding `D1`
- O deploy de producao concluido desta etapa anterior foi `ba0425c2-63ab-45e8-b1b5-be3360726bb1`
- Validado online em producao:
  - `https://precision-inventory.pages.dev/` respondeu `200`
  - `https://precision-inventory.pages.dev/api/state` respondeu `200`
  - a persistencia online compartilhada continuou ativa no `DB`
- O painel de `Etiquetas` deixou de abrir com toda a lista filtrada marcada por padrao
- Ao abrir `Etiquetas`, o sistema marca somente os SKUs da pagina atual do inventario
- A lista de selecao de etiquetas passou a mostrar apenas um bloco visivel inicial e pede refinamento quando houver muitos resultados
- A verificacao de SKUs selecionados ficou mais leve internamente para reduzir custo com listas grandes
- O formato inicial do painel passou para `QR Code`, mantendo `Code 39` como fallback manual
- O preview/modelo de etiqueta foi removido da tela de `Etiquetas` para evitar novo travamento durante a selecao
- `tsc --noEmit` passou novamente usando o Node portatil
- `vite build` passou novamente usando o Node portatil
- Os assets estaticos foram reenviados com hash compativel com o Wrangler para corrigir o publish direto no Cloudflare Pages
- O worker da API foi reenviado em um `_worker.bundle` enxuto mantendo o binding `D1`
- O deploy de producao concluido para esta correcao final de `Etiquetas` foi `663fd003-6fbd-474a-bb0c-dadda73d5ca1`
- Validado online em producao nesta etapa:
  - `https://precision-inventory.pages.dev/` respondeu `200`
  - `https://precision-inventory.pages.dev/api/state` respondeu `200`
  - `https://663fd003.precision-inventory.pages.dev/` respondeu `200`
  - o HTML publicado passou a apontar para os novos assets gerados no build desta correcao
- Em `Buscar e Atualizar`, o item agora pode salvar `modelo do veiculo` com sugestoes vindas da base importada de veiculos
- Em `Buscar e Atualizar`, quando houver base de veiculos importada, o `modelo do veiculo` agora pode ser selecionado diretamente da lista reconhecida
- A selecao de `modelo do veiculo` passou a usar uma lista oficial filtrada pelo usuario, evitando mostrar todas as variacoes parecidas da planilha crua
- A busca do inventario e a exportacao CSV passaram a considerar `modelo do veiculo`
- A busca da `Solicitacao de pecas` passou a considerar `modelo do veiculo`
- `tsc --noEmit` passou novamente usando o Node portatil
- `vite build` passou novamente usando o Node portatil
- Nesta etapa, por decisao do usuario, a mudanca ficou somente no projeto local e ainda nao foi publicada online
- Foi criado um catalogo oficial que atrela cada `modelo de veiculo` a um `tipo de veiculo`
- A normalizacao dos itens agora converte modelos parecidos para o nome oficial da lista do usuario
- `Buscar e Atualizar` passou a salvar no item:
  - `vehicleModel`
  - `vehicleType`
- O `Painel` agora tem uma area `Atalhos por veiculo` com botoes por tipo e por modelo
- Cada botao do `Painel` abre o `Inventario` ja filtrado pela busca correspondente
- O `Inventario` passou a:
  - buscar tambem por `tipo do veiculo`
  - mostrar `modelo` e `tipo` no card do item
  - exportar `modelo` e `tipo` no CSV
- A `Solicitacao de pecas` passou a buscar tambem por `tipo do veiculo`
- `tsc --noEmit` passou novamente usando o Node portatil
- `vite build` passou novamente usando o Node portatil
- O build trouxe apenas o aviso de chunk grande do Vite, sem falha de compilacao
- Nesta etapa, por decisao do usuario, a mudanca continuou somente no projeto local e ainda nao foi publicada online
- Em `Buscar e Atualizar`, a tela passou a trabalhar com `tipo do veiculo` no lugar de `modelo do veiculo`
- Ao salvar por essa tela, o item grava `vehicleType` diretamente e limpa o `vehicleModel` antigo para nao manter amarracao errada com um modelo especifico
- A interface visivel da aba `update` passou a usar o nome `Atualziar Estoque`
- `tsc --noEmit` passou novamente usando o Node portatil
- `vite build` passou novamente usando o Node portatil
- Nesta etapa, por decisao do usuario, a mudanca continuou somente no projeto local e ainda nao foi publicada online
- Foi criada a nova aba `Pecas/Modelo` para o cliente navegar por:
  - tipo
  - modelo
  - pecas
- A navegacao principal do sistema agora mostra `Pecas/Modelo`
- O antigo painel `Atalhos por veiculo` do `Painel` foi movido para essa aba nova
- O `Painel` agora mostra apenas um acesso simples para abrir `Pecas/Modelo`
- A nova aba permite tocar em cada peca para abrir o SKU correspondente em `Atualziar Estoque`
- `tsc --noEmit` passou novamente usando o Node portatil
- `vite build` passou novamente usando o Node portatil
- `http://localhost:3000` respondeu `200`
- Nesta etapa, por decisao do usuario, a mudanca continuou somente no projeto local e ainda nao foi publicada online
- Foi criada a nova aba `Kit Preventivas`
- A aba usa uma base fixa de kits por modelo com codigo e quantidade exigida por item
- O calculo de disponibilidade usa o saldo atual do inventario:
  - por componente: `floor(saldo atual / quantidade exigida no kit)`
  - por kit: menor valor entre os componentes
- Foram cadastrados os kits de:
  - SAVEIRO
  - STRADA/MOBI
  - RANGER
  - HILUX
  - S10
  - GOL
  - MOTO
  - LANCHA 40HP
  - LANCHA 90HP / 115HP
- A aba mostra:
  - kits completos disponiveis hoje
  - item limitante
  - componentes em falta
  - acesso direto ao SKU em `Atualziar Estoque`
- A navegacao principal agora mostra `Kit Preventivas`
- O `Painel` ganhou atalho direto para `Kit Preventivas`
- `tsc --noEmit` passou novamente usando o Node portatil
- `vite build` passou novamente usando o Node portatil
- `http://localhost:3000` respondeu `200`
- O build trouxe apenas o aviso de chunk grande do Vite, sem falha de compilacao
- Nesta etapa, por decisao do usuario, a mudanca continuou somente no projeto local e ainda nao foi publicada online

## Proximos passos recomendados

1. Fazer uma revisao geral de texto/codificacao em:
   - `src/App.tsx`
   - `src/types.ts`
   - `README.md`
   - arquivos antigos que ainda exibem mojibake

2. Testar o QR compacto com:
   - poucos SKUs
   - impressao real
   - leitura no celular
   - leitura em `Buscar e Atualizar`
   - leitura em `Separacao de material`

3. Validar com a equipe se o travamento em `Etiquetas` desapareceu no uso real
   - testar com busca ampla
   - testar com pagina cheia
   - testar no celular

4. Resolver o deploy online desta maquina
   - opcional: fornecer `CLOUDFLARE_API_TOKEN` para voltar a usar `wrangler` local
   - opcional: transformar o fluxo MCP atual em script reutilizavel dentro do projeto

5. Se o QR funcionar bem, decidir se vira:
   - opcao permanente
   - ou formato padrao para alguns cenarios

6. Validar com o usuario se os atalhos por `tipo/modelo` no `Painel` cobrem bem a operacao real
   - confirmar se a lista oficial precisa de mais modelos
   - confirmar se algum tipo deve ser renomeado
   - confirmar se depois vale criar botoes dedicados dentro de `Buscar e Atualizar`

## Como validar localmente

- `npm run lint`
- `npm run build`
- `npm run preview`

Se o `npm` ainda nao abrir nesta maquina:

- corrigir o ambiente Node primeiro
- so depois repetir a validacao local

Se for publicar nesta maquina sem restaurar o Node global:

- usar o Node portatil em `.codex-tools`
- garantir `CLOUDFLARE_API_TOKEN` disponivel antes do deploy

Se precisar de teste rapido local:

- abrir o preview e validar a aba `Inventario`
- testar o painel `Etiquetas`
- testar ambos os modos: `Codigo de barras` e `QR compacto`

## Observacao importante para futuros agentes

Nao assumir que a ultima mudanca esta publicada online.
Sempre diferenciar:

- codigo local pronto
- build validado
- deploy realmente publicado

Nesta etapa, os tres ficaram verdadeiros ao mesmo tempo.

## Deploy publicado em 2026-04-20

- O projeto foi publicado com sucesso no Cloudflare Pages para o ambiente de producao
- O deploy foi feito a partir do build local validado, usando o Node portatil em `.codex-tools` e `wrangler`
- Preview publicado:
  - `https://a64b672c.precision-inventory.pages.dev`
- Producao validada:
  - `https://precision-inventory.pages.dev`
- API online validada:
  - `https://precision-inventory.pages.dev/api/state`

## O que foi validado neste deploy

- `tsc --noEmit` passou localmente antes da publicacao
- `vite build` passou localmente antes da publicacao
- A producao respondeu `200`
- A API `/api/state` respondeu `200` usando a base real no D1
- O HTML publicado em producao passou a servir os assets novos do build atual:
  - `/assets/index-7muIXcYn.js`
  - `/assets/index-B-IWPQPV.css`

## Observacoes operacionais do deploy

- Nesta maquina, o fluxo confiavel de deploy ficou via Node portatil + `wrangler`
- O `wrangler` local so concluiu o deploy com `CLOUDFLARE_API_TOKEN` disponivel no ambiente
- Nao houve alteracao manual no banco D1 durante esta etapa
- O deploy serviu para publicar a interface nova sobre a base real ja existente
