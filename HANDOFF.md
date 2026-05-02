# HANDOFF.md

Ultima atualizacao: 2026-05-01

## Resumo executivo

O sistema ja tem os modulos principais funcionando:

- Painel
- Atualziar Estoque
- Kit Preventivas
- Solicitacao de pecas
- Separacao de material
- Inventario
- Impressao de etiquetas
- Compras Automaticas
- Persistencia online via Cloudflare D1

## Estado atual por modulo

### 1. Painel

- Mostra metricas operacionais
- Botoes principais ja ficaram interativos
- Nao deve voltar a concentrar regra unica de alerta
- O antigo bloco `Atalhos por veiculo` saiu do painel e virou acesso para uma aba dedicada
- Usa a Curva ABC 2026 para priorizar o top de alertas criticos/reposicao somente entre SKUs ativos no armazem
- O resumo ABC mostra quantos itens ativos existem nas classes A/B/C e exibe minimo/maximo automatico nos itens alertados
- Ao clicar em um SKU alertado, abre um relatorio rapido explicando classe, rank, demanda media, saidas/entradas recentes e motivo do minimo/maximo

### 2. Atualziar Estoque

- Busca por SKU
- Leitura por camera/foto
- Leitor agora aceita QR Code e codigo de barras
- Quantidade digitada representa saldo contado atual
- Localizacao pode ser corrigida
- Cadastro manual de item no estoque (quando SKU nao existe), com validacao e registro de log inicial
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
- Alteracoes locais (ex.: marcar item como `Ativo`) agora disparam salvamento online mesmo quando o inventario ainda e o "baseline" inicial
- Escrita concorrente (varios celulares) agora faz merge por SKU usando `updatedAt` do item, evitando que um celular sobrescreva silenciosamente a alteracao do outro
- O status de sincronizacao agora aparece tambem no celular (Salvo online / Salvando / Conectando / Modo local) e o app tenta reconectar automaticamente quando o telefone cair em "Modo local"
- Alteracoes feitas sem internet ficam em uma "fila local" persistente (outbox) e sao enviadas automaticamente quando a internet volta
- Para evitar diferenca de UI entre iOS Safari e Android Chrome, o status de sincronizacao tambem aparece no cabecalho do layout em telas pequenas
- Controle de acesso por usuario/senha (matricula + senha) via D1:
  - login: `functions/api/auth.js`
  - cadastro/controle: `functions/api/users.js`
  - quando existir pelo menos 1 usuario cadastrado, o `PUT /api/state` passa a exigir sessao (Bearer token)
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

- Barra superior simplificada novamente:
  - removido texto visual `Precision Inventory` do canto esquerdo, mantendo apenas o icone
  - removidos `Admin` e `Sair` da barra
  - foto do usuario virou menu de conta
  - menu da foto mostra permissao, status do sistema, `Usuarios` para admin e `Sair`
  - aba `Usuarios` saiu da navegacao principal e fica acessivel pela foto
- Proposta de `Compras Automaticas` ficou pronta para implementacao futura:
  - documento tecnico criado em `docs/COMPRAS_AUTOMATICAS.md`
  - nota Obsidian `Precision Inventory/07 - Proposta Compras Automaticas` atualizada com referencia ao documento tecnico
  - regra reforcada: compra aprovada/comprada nao altera estoque; entrada continua so por `Recebimento`
- Validado localmente:
  - `tsc --noEmit` passou usando Node portatil
  - `vite build` passou usando Node portatil
- Publicado via Wrangler:
  - preview: `https://ce68c52e.precision-inventory.pages.dev`
  - producao: `https://precision-inventory.pages.dev/` respondeu `200`
  - `/api/state` respondeu `200`
  - `Cache-Control` da home em producao: `no-store`
  - asset principal publicado: `assets/index-CI1gM3x2.js`
- Removido o botao de notificacoes/sino da barra superior:
  - alertas de estoque ficam concentrados no `Painel`
  - removido dropdown duplicado de alertas no `Layout`
  - `Layout` deixou de receber `items`, `settings` e `onSelectSku` apenas para alimentar o sino
- Registrada proposta de modulo futuro `Compras Automaticas`:
  - nota criada no Obsidian: `Precision Inventory/07 - Proposta Compras Automaticas`
  - proposta usa alertas criticos, reposicao, Curva ABC, saidas recentes e pedidos manuais
  - regra de seguranca: aprovar compra nao aumenta estoque; entrada real continua somente pelo fluxo `Recebimento`
- Validado localmente:
  - `tsc --noEmit` passou usando Node portatil
  - `vite build` passou usando Node portatil
- Publicado via Wrangler:
  - preview: `https://c29c163f.precision-inventory.pages.dev`
  - producao: `https://precision-inventory.pages.dev/` respondeu `200`
  - `/api/state` respondeu `200`
  - `Cache-Control` da home em producao: `no-store`
  - asset principal publicado: `assets/index-OfDveYJZ.js`
- Configurado Obsidian como memoria ampla do projeto:
  - cofre localizado em `C:\Users\dmitry.santos\Downloads\Lembranças`
  - criada pasta `Precision Inventory` dentro do cofre
  - criado mapa principal `Precision Inventory/00 - Mapa do Projeto`
  - criadas notas para regras de negocio, modulos/fluxos, deploy/GitHub, Curva ABC, decisoes recentes, riscos/cuidados e diario de handoff
  - criados templates de `Registro de Decisao` e `Handoff Rapido`
  - nota `Bem-vindo.md` do cofre passou a apontar para o mapa do projeto
  - `SKILLS.md` e skill local Hermes foram atualizados para lembrar o uso do Obsidian
- Evoluida a Curva ABC para modo operacional:
  - `abcAnalysis.ts` passou a aceitar logs recentes e comparar a demanda media da planilha com as saidas dos ultimos 120 dias
  - para minimo/maximo, o sistema usa a maior demanda entre Curva ABC tratada e saidas recentes, evitando subestimar item que acelerou consumo
  - entradas recentes aparecem no relatorio explicativo, mas nao reduzem minimo/maximo automaticamente
  - SKU fora da Curva ABC tratada continua usando limites manuais/fallback para nao mudar regra sem classificacao
- Painel:
  - clicar em item alertado agora abre `Relatorio rapido ABC`
  - o relatorio mostra status, saldo, min/max usado, classe ABC, rank, demanda media, saidas recentes, entradas recentes e fonte do calculo
  - o botao `Abrir no Estoque` continua levando ao SKU para ajuste
- Inventario Operacional:
  - recebeu resumo `Inventario guiado por Curva ABC`
  - filas passam a priorizar classe/rank ABC, status calculado com ABC/logs, divergencia, movimentacao recente e falta de localizacao
  - cada card priorizado mostra classe/rank ABC e min/max automatico quando existir classificacao
- Validado localmente:
  - `tsc --noEmit` passou usando Node portatil
  - `vite build` passou usando Node portatil
- Publicado via Wrangler:
  - preview: `https://683469e6.precision-inventory.pages.dev`
  - producao: `https://precision-inventory.pages.dev/` respondeu `200`
  - `/api/state` respondeu `200`
  - `Cache-Control` da home em producao: `no-store`
  - asset principal publicado: `assets/index-CZy2z39v.js`
- Integrada a planilha tratada `Analise_Curva_ABC_Estoque_2026_Atualizada.xlsx` ao projeto:
  - gerado `src/abcAnalysisData.ts` com 622 registros da aba `ABC_Completa`
  - criado `src/abcAnalysis.ts` para buscar SKU mesmo com/sem zero a esquerda
  - `inventoryRules.ts` agora aplica a politica ABC antes dos limites manuais quando o SKU existe na curva
  - o Painel mostra resumo ABC dos itens ativos e ordena o top de `Alertas criticos/Repor em breve` pelo rank ABC, mantendo a divisao por tipo
  - politica inicial: Classe A = minimo 0,5 mes e maximo 1,5 mes; Classe B = minimo 0,35 mes e maximo 1 mes; Classe C = minimo 0,2 mes e maximo 0,75 mes
  - o minimo automatico vira `criticalLimit`; o maximo automatico vira `reorderLimit`
- Validado localmente:
  - `tsc --noEmit` passou usando Node portatil
  - `vite build` passou usando Node portatil
- Publicado via Wrangler:
  - preview: `https://bf2ee852.precision-inventory.pages.dev`
  - producao: `https://precision-inventory.pages.dev/` respondeu `200`
  - `/api/state` respondeu `200`
  - `Cache-Control` da home em producao: `no-store`
  - asset principal publicado: `assets/index-DehdCAcT.js`
- Publicado controle anti-cache no Cloudflare Pages via `public/_headers`:
  - `/` agora responde com `Cache-Control: no-store` (forca o navegador a buscar o HTML sempre)
  - `/assets/*` continua com cache longo (max-age + immutable) porque ja tem hash no nome
  - validado em producao: `https://precision-inventory.pages.dev/` retornou `Cache-Control: no-store`
- Ajustes recentes de UX e fluxo (mobile):
  - `Solicitacao de pecas`:
    - `Dados do veiculo` ficou em 1 linha: `Placa confirmada / Modelo / Centro de custo` (descricao removida da tela)
    - adicionado leitor `Ler etiqueta` ao lado da busca de SKU em `Adicionar itens` (le o codigo e ja tenta adicionar o item)
    - removido o painel `Solicitacoes recentes` para reduzir poluicao no telefone
  - `Separacao`:
    - lista passou a mostrar somente solicitacoes abertas (nao exibe `Atendida` e `Estornada`)
    - removido o texto de instrucao no topo esquerdo (Operacao guiada por etiqueta...)
    - para solicitacoes abertas na lista: adicionados botoes `Editar` (abre a solicitacao na aba `Solicitacoes`) e `Remover` (com confirmacao)
  - `Historico de solicitacoes`:
    - nova aba dedicada com lista + detalhes (itens, auditoria, logs vinculados por `referenceCode`)
    - filtros: Data (de/ate), Usuario, SKU, Placa
    - leitor pequeno no campo `SKU` para preencher filtro por leitura de etiqueta
    - estorno habilitado no Historico para solicitacoes `Atendida` (admin), mantendo regra de nao editar/remover atendidas
  - Barra superior:
    - botao `Tela cheia` ao lado do sino (modo tela cheia do sistema inteiro)
    - removido o indicador visual `Salvando online` da tela (as regras de salvamento offline/outbox continuam ativas)
- Correcao critica publicada:
  - `Historico de solicitacoes` chegou a ficar em branco por erro `showToast is not defined` e foi corrigido (props repassada pelo App)
- Adicionado estorno de solicitacao atendida (somente admin) na aba `Separacao`:
  - novo status `Estornada`
  - estorno devolve quantidades ao estoque e grava log `recebimento` com referencia `ESTORNO SOL-xxxx`
  - cores na `Separacao`: Atendida = verde, Aberta = amarela, Estornada = azul claro
- Corrigido o fluxo de "Primeiro acesso" (troca de senha):
  - o front agora diferencia "sem internet" de erro de servidor e mostra mensagens mais claras
  - a API `/api/auth?action=change-password` agora sempre retorna JSON mesmo quando ocorrer erro interno (evita "Falha de conexão" enganosa)
  - publicado via `npm run deploy`
- Alterada a regra de "Ativos" para apontamento manual por SKU:
  - novo campo `isActiveInWarehouse` no item
  - Painel e filtro Ativo agora usam somente esse campo (padrao inicial = 0 ativos)
  - no Estoque, cada linha tem um botao `Ativo` para marcar/desmarcar
- Implementada tela de login local para permissoes:
  - `Consulta`: navega e visualiza, sem alterar dados
  - `Operacao`: libera alteracoes (estoque, solicitacoes, importacoes)
  - o modo Operacao usa um codigo salvo no dispositivo (localStorage)
- Adicionada protecao de escrita no App:
  - em modo Consulta, setters de estoque/logs/solicitacoes/config/veiculos ficam bloqueados
  - ocrAliases fica bloqueado em Consulta para nao afetar o estado compartilhado
- `npm run lint` passou usando o Node portatil
- `npm run build` passou usando o Node portatil
- `npm run deploy` passou usando o Node portatil (wrangler pages deploy)
- O botao `Ativo` foi adicionado tambem no formulario `Item encontrado` (Buscar e Atualizar) para marcar/desmarcar o SKU direto no detalhe
- Corrigida a persistencia do apontamento `Ativo`: a marcacao passa a sobreviver ao refresh mesmo se atualizar a pagina logo apos clicar, e o carregamento do estado online nao sobrescreve um estado local mais novo
- Alertas criticos e de reposicao passam a considerar apenas SKUs marcados como `Ativo` no armazem (Painel e sino de alertas do topo)
- Removido o tipo `OLEO` de `Peças/Modelo` (era um tipo extra operacional e nao representa tipo de veiculo)
- Em `Solicitacoes > Dados do veiculo`, adicionado atalho e grid compacto de tipos para abrir `Pecas/Modelo` ja filtrado por tipo, facilitando a escolha rapida pelo mecanico
- Em `Inventario Operacional`, filas e contagens passaram a considerar somente SKUs marcados como `Ativo` no armazem
- Em `Inventario Operacional`, a fila agora tambem prioriza classe/rank da Curva ABC, status recalculado com ABC, divergencias e movimentacao recente
- Aumentado o tamanho do botao `Ativo` (no Estoque e no detalhe do item) para facilitar o uso durante a contagem
- Botao `Ativo` aumentado novamente (aprox. 2x) para melhor visualizacao no celular e durante contagem
- Quando marcado como ativo, o botao `Ativo` passa a ficar azul para destacar o status
- Em `Atualizar Estoque`, removido o bloqueio de "ciencia no mesmo dia" (botao `Estou ciente e vou alterar hoje`), para o salvar ficar direto e confiavel
- Removido tambem o indicador de "Ciencia registrada" que ainda dependia da logica antiga
- Corrigido risco de "perder" alteracoes ao recarregar: quando existe alteracao local ainda nao sincronizada, o app nao deixa o estado online antigo sobrescrever o que foi salvo no aparelho
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

## Revisao global de texto publicada em 2026-04-22

- Foi revisada a normalizacao de texto do sistema para corrigir nomes quebrados vindos da base online e de logs antigos
- A correcao agora cobre:
  - sequencias mojibake classicas
  - caracteres `�`
  - separadores de controle estranhos no meio do nome
  - palavras operacionais comuns do estoque com acento quebrado
- A limpeza passou a atingir:
  - itens do inventario ao carregar o estado
  - logs do estoque ao carregar o estado
  - campos de solicitacoes sanitizadas
- Nao foi feito ajuste manual direto no D1 nesta etapa
- A estrategia adotada foi:
  - corrigir a exibicao no cliente
  - regravar o estado limpo quando a aplicacao salvar novamente

## Casos validados nesta revisao

- `JUNTA DE GUARNICAO TAMPA V�LVULA` -> `JUNTA DE GUARNICAO TAMPA VÁLVULA`
- `TERMINAL DIRE��O L/D` -> `TERMINAL DIREÇÃO L/D`
- `�LEO DE RABETA 90 TRANSMISS�O` -> `ÓLEO DE RABETA 90 TRANSMISSÃO`
- `MANGUEIRA DE SUC��O` -> `MANGUEIRA DE SUCÇÃO`
- `L�MPADA TORPEDO GRANDE` -> `LÂMPADA TORPEDO GRANDE`
- `BRAÃO` -> `BRAÇO`
- Varredura em amostra da base real apos normalizacao:
  - `remainingItemIssues: 0`
  - `remainingLogIssues: 0`

## Deploy publicado em 2026-04-22

- Preview novo publicado:
  - `https://473f4b26.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- HTML de producao validado com os assets novos:
  - `/assets/index-BFfxFOfA.js`
  - `/assets/index-CwkatwWj.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Ajuste responsivo geral em 2026-04-22

- A largura util da aplicacao foi ampliada para aproveitar melhor desktop grande sem perder o encaixe em tablet e celular
- O `Layout` principal deixou de limitar a tela em `max-w-7xl` e passou a trabalhar com container mais largo e paddings fluidos por faixa de dispositivo
- A area `Estoque` foi redistribuida para abrir melhor em monitores largos:
  - busca do SKU com botao do leitor melhor alinhado
  - resumo do item com melhor ocupacao lateral
  - cards de quantidade, localizacao e tipo com grade mais adaptativa
  - bloco de alertas e botoes finais mais bem distribuidos
- A lista da aba `Estoque` tambem ficou mais larga e organizada:
  - cabecalho com acoes mais flexiveis
  - barra de busca com melhor aproveitamento horizontal
  - tabela/lista com colunas mais bem distribuidas em desktop largo

## Validacao local desta etapa responsiva

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-CGICmN4m.js`
  - `/assets/index-BNRI3Hu2.css`

## Fechamento desta etapa

- O ajuste responsivo foi publicado em producao e validado online na aba `Estoque`

## Deploy publicado em 2026-04-22 para ajuste responsivo

- Preview publicado:
  - `https://707f56ca.precision-inventory.pages.dev`
- Producao validada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CGICmN4m.js`
  - `/assets/index-BNRI3Hu2.css`
- `/api/state` respondeu `200`

## Revisao da conferencia por QR na Separacao em 2026-04-23

- Verificada a funcao de conferencia de saldo em `Solicitacao de pecas / Separacao`
- Ao confirmar um SKU pelo QR Code, o sistema agora informa imediatamente o saldo esperado restante na localizacao quando houver saldo no estoque
- A tela de conferencia continua abrindo apos a leitura para o colaborador informar a quantidade real na locacao
- Se houver diferenca entre saldo esperado e real, o botao continua virando `Registrar divergencia`
- A divergencia continua sendo registrada nos logs com:
  - `source: divergencia`
  - saldo esperado
  - saldo informado
  - codigo da solicitacao
- O botao secundario da conferencia deixou de ser um simples `Fechar`
- Agora ele usa explicitamente o saldo do sistema e tambem confirma a mensagem de restante, evitando que uma leitura fique sem registro claro de conferencia

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-BEjMAnnF.js`
  - `/assets/index-C2_xhUBY.css`

## Deploy publicado em 2026-04-23 para conferencia QR na separacao

- Preview publicado:
  - `https://cfa18564.precision-inventory.pages.dev`
- Producao validada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-BEjMAnnF.js`
  - `/assets/index-C2_xhUBY.css`
- `/api/state` respondeu `200`

## Imagens leves por produto em 2026-04-23

- Foi criada uma camada visual leve para produtos em `productVisuals.tsx`
- A imagem padrao de cada produto agora e gerada automaticamente pela descricao/categoria do item
- A solucao nao baixa imagens externas em massa e nao grava arquivos pesados no banco
- O sistema reconhece familias comuns pela descricao, como:
  - filtros
  - oleos/fluidos/aditivos
  - bateria
  - freio
  - eletrica/iluminacao
  - pintura/acabamento
  - fixacao
  - mecanica
- Quando existir foto real no futuro, o item pode usar `imageUrl`
- A importacao/exportacao do estoque passou a aceitar a coluna `Imagem URL`
- As imagens aparecem em:
  - lista da aba `Estoque`
  - item aberto em `Atualziar Estoque`
  - busca de itens em `Solicitacoes`
  - lista de pecas em `Pecas/Modelo`

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-CKrMmPAB.js`
  - `/assets/index-Dx16kG-g.css`

## Deploy publicado em 2026-04-23 para imagens leves por produto

- Preview publicado:
  - `https://64a4fb36.precision-inventory.pages.dev`
- Producao validada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CKrMmPAB.js`
  - `/assets/index-Dx16kG-g.css`
- `/api/state` respondeu `200`

## Ajuste do quadro do leitor em 2026-04-23

- O enquadramento visual do leitor foi ampliado para formato quadrado maior
- O ajuste entrou em:
  - `Atualziar Estoque`
  - `Separacao de material`
- O visor da camera tambem ficou mais alto para dar mais area util de leitura
- O objetivo desta etapa foi reduzir a sensacao de leitor estreito em formato de codigo de barras e melhorar a amplitude para QR Code

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-DxK1cOjP.js`
  - `/assets/index-C12WMnS7.css`

## Deploy publicado em 2026-04-23 para quadro maior do leitor

- Preview publicado:
  - `https://61897348.precision-inventory.pages.dev`
- Producao validada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-DxK1cOjP.js`
  - `/assets/index-C12WMnS7.css`
- `/api/state` respondeu `200`

## Ajustes locais em 2026-04-22

- Em `Atualziar Estoque`, se o SKU ja tiver log no mesmo dia, a tela agora mostra aviso visivel informando que ele ja foi atualizado hoje
- Ao salvar novamente no mesmo dia, o sistema mantem a operacao e registra nova atualizacao, mas avisa isso para o operador antes de concluir
- Ainda em `Atualziar Estoque`, o tipo `VW` passou a aparecer como `SAVEIRO/GOL`
- Ainda em `Atualziar Estoque`, o tipo `CHEVROLET` passou a aparecer como `S-10`
- O seletor `Tipo do veiculo` ganhou as opcoes operacionais:
  - `FUNILARIA E PINTURA`
  - `BATERIA`
  - `ADITIVOS`
  - `OLEO`
- Essa troca foi aplicada no valor operacional exibido e salvo por essa tela
- Validacao local desta etapa:
  - `tsc --noEmit` passou
  - `vite build` passou
- Deploy publicado em 2026-04-22 para esta etapa
  - Preview:
    - `https://65d79327.precision-inventory.pages.dev`
  - Producao:
    - `https://precision-inventory.pages.dev`
  - Assets validados em producao:
    - `/assets/index-GIZRRvB8.js`
    - `/assets/index-kiACljcx.css`
  - `/api/state` respondeu `200`

## Deploy complementar em 2026-04-22

- O seletor `Tipo do veiculo` em `Atualziar Estoque` recebeu mais uma opcao operacional:
  - `OLEO`
- Preview publicado:
  - `https://7c341827.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-N75wc7rX.js`
  - `/assets/index-kiACljcx.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Reorganizacao local em 2026-04-22

- A aba `Inventario` passou a ser tratada operacionalmente como `Estoque`
- A navegacao principal agora mostra `Estoque`
- A funcao `Atualziar Estoque` foi incorporada dentro da propria area de `Estoque`
- O fluxo novo ficou assim:
  - abrir `Estoque`
  - localizar ou selecionar o SKU
  - atualizar saldo, localizacao, tipo e alertas sem sair da mesma aba
- Os fluxos antigos que apontavam para `Atualziar Estoque` agora redirecionam para `Estoque`
- Foi criada a composicao local:
  - `src/components/StockWorkspace.tsx`
  - ela une `StockUpdate` + lista do estoque na mesma pagina

## Aviso de alteracao no mesmo dia

- O aviso de alteracao no mesmo dia foi reforcado em `Atualziar Estoque`
- Agora existem dois comportamentos:
  - banner visivel acima dos dados do item quando o SKU ja teve alteracao hoje
  - `toast` de aviso ao abrir um SKU com alteracao registrada na data de hoje
- A comparacao do "mesmo dia" passou a usar o fuso `America/Manaus`

## Textos atualizados nesta etapa

- `Inventario` -> `Estoque` na navegacao
- `Central de Inventario` -> `Central de Estoque`
- Em `Peças/Modelo`, o texto de abertura do SKU agora aponta para a area de `Estoque`

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou

## Deploy publicado em 2026-04-22 para a reorganizacao de Estoque

- Preview publicado:
  - `https://a823fa05.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-BVDNYmj2.js`
  - `/assets/index-kiACljcx.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Regra operacional nova do usuario

- Toda mudanca futura deve terminar com deploy publicado e validado online
- Nao encerrar etapa apenas com ajuste local

## Inventario operacional publicado em 2026-04-22

- A area `Estoque` ganhou uma funcao nova chamada `Inventario operacional`
- A funcao foi desenhada a partir de padroes repetidos em sistemas grandes de estoque e WMS:
  - fila de contagem
  - progresso do dia
  - divergencia por SKU
  - recontagem prioritaria
  - foco por localizacao, tipo e status
- A implementacao ficou dentro do fluxo atual, sem criar nova aba e sem quebrar o ajuste rapido por SKU
- O fluxo novo dentro de `Estoque` agora ficou assim:
  - atualizar ou abrir SKU rapidamente
  - acompanhar o inventario operacional do dia
  - entrar no proximo pendente
  - entrar na proxima recontagem
  - depois seguir para a lista completa do estoque

## O que esta funcao mostra

- `Base do foco`
  - quantos SKUs existem no recorte atual
- `Contados hoje`
  - quantos SKUs ja tiveram contagem no dia
- `Pendentes`
  - quantos ainda faltam contar hoje
- `Divergencias`
  - quantos itens ficaram com diferenca entre saldo anterior e saldo contado
- filtros operacionais por:
  - localizacao
  - tipo do veiculo
  - status do estoque
- colunas de operacao:
  - `Fila de contagem do dia`
  - `Recontagem prioritaria`
  - `Ja contados hoje`

## Regras operacionais desta funcao

- O calculo do progresso diario usa os `logs` do proprio dia no fuso `America/Manaus`
- O operador continua ajustando o saldo contado final no modulo de `Atualziar Estoque`
- A fila de prioridade favorece:
  - itens criticos
  - itens sem localizacao
  - itens com maior divergencia
  - itens zerados
- Divergencia nao bloqueia o ajuste; ela alimenta a fila de recontagem

## Referencias funcionais usadas nesta etapa

- SAP: physical inventory e cycle counting
- Oracle: physical inventory e recount process
- Microsoft Dynamics 365: inventory counting journals
- Odoo: inventory adjustments

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-CFhqwClk.js`
  - `/assets/index-BIowxJGj.css`

## Deploy publicado em 2026-04-22 para Inventario operacional

- Preview publicado:
  - `https://731bc965.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CFhqwClk.js`
  - `/assets/index-BIowxJGj.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Ajuste de navegacao e ciencia manual em 2026-04-22

- A funcao `Inventario operacional` saiu de dentro de `Estoque`
- Agora ela virou uma aba propria chamada:
  - `Inventario operacional`
- A aba `Estoque` voltou a ficar focada no que ja vinha funcionando:
  - abertura por SKU
  - leitura de etiqueta
  - ajuste de saldo contado
  - ajuste de localizacao
  - ajuste de tipo do veiculo
  - lista completa do estoque

## Aviso de alteracao no mesmo dia ajustado

- O aviso de alteracao no mesmo dia deixou de depender apenas de `toast`
- Quando o SKU ja teve alteracao hoje, a tela agora mostra um aviso persistente com botao de ciencia:
  - `Estou ciente e vou alterar hoje`
- Enquanto o colaborador nao registrar a ciencia:
  - o botao `Atualizar Estoque` fica bloqueado
  - o sistema nao salva nova alteracao para aquele SKU no mesmo dia
- Depois da ciencia:
  - o salvamento volta a ser permitido
  - a nova alteracao continua sendo registrada normalmente no log

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-95CGHEdY.js`
  - `/assets/index-D_RXV-n8.css`

## Deploy publicado em 2026-04-22 para navegacao separada do Inventario operacional

- Preview publicado:
  - `https://929c6a1d.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-95CGHEdY.js`
  - `/assets/index-D_RXV-n8.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Revisao estrutural publicada em 2026-04-22

- Foi feita uma limpeza de partes antigas do projeto para reduzir risco de quebra escondida
- O foco desta etapa foi remover sobra tecnica sem mudar as regras de negocio do estoque

## O que foi limpo nesta revisao

- Removido o componente antigo `ItemLookup`, que ja estava orfao e sem uso no app
- Removidas props mortas que ainda eram passadas entre componentes sem efeito real:
  - `setActiveTab` em pontos do fluxo de estoque
  - `vehicles` no componente de `Atualziar Estoque`
- Unificado o fluxo de abrir SKU no `App`
  - foi removida uma duplicacao desnecessaria da funcao de selecao de SKU
- Removida uma regra antiga que injetava automaticamente um item de exemplo de etiqueta quando a base local ficava pequena
  - isso era um resquicio de fase anterior e podia confundir o comportamento real da base
- Ajustados textos visiveis da navegacao e da nova aba:
  - `Inventário Operacional`

## Resultado tecnico desta revisao

- Menos codigo morto no projeto
- Menos acoplamento entre componentes do estoque
- Menos chance de comportamento artificial por item de exemplo
- Fluxo mais limpo para manutencao futura

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-Dx_9gieL.js`
  - `/assets/index-ChTYeNet.css`

## Observacao tecnica aberta

- O Vite continua emitindo aviso de chunk grande no build principal
- Nao houve quebra nesta etapa, mas depois vale tratar code-splitting para reduzir peso inicial da interface

## Deploy publicado em 2026-04-22 para a revisao estrutural

- Preview publicado:
  - `https://24dd0e60.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-Dx_9gieL.js`
  - `/assets/index-ChTYeNet.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Ajuste de ciencia no mesmo dia em 2026-04-22

- O aviso de alteracao no mesmo dia foi suavizado para uso operacional real
- A ciencia agora vale por:
  - SKU
  - dia atual
- Ela nao reinicia a cada nova gravacao do mesmo SKU no mesmo dia
- O botao `Atualizar Estoque` voltou a ficar visivelmente normal
- O fluxo atual ficou assim:
  - se o SKU ja teve alteracao hoje, aparece o aviso
  - o colaborador registra a ciencia uma vez
  - depois disso pode fazer varias alteracoes no mesmo dia para aquele SKU sem novo travamento visual
- Sem ciencia registrada, o sistema continua impedindo a gravacao e avisa por mensagem

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-yVIs3fug.js`
  - `/assets/index-m22fyMEI.css`

## Deploy publicado em 2026-04-22 para ciencia por dia

- Preview publicado:
  - `https://4204b0f3.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-yVIs3fug.js`
  - `/assets/index-m22fyMEI.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Ajuste final do botao de ciencia em 2026-04-22

- O botao principal de `Atualizar Estoque` voltou a respeitar a liberacao visual quando houver alteracao no mesmo dia
- O comportamento final ficou assim:
  - sem alteracao hoje: botao `Atualizar Estoque` liberado
  - com alteracao hoje e sem ciencia: botao bloqueado com texto `Confirme a ciência para liberar`
  - depois da ciencia: botao liberado com texto `Atualizar Estoque`
- A ciencia continua valendo por `SKU + dia`

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-CawbZIM8.js`
  - `/assets/index-ChTYeNet.css`

## Deploy publicado em 2026-04-22 para bloqueio por ciencia

- Preview publicado:
  - `https://08bd12b6.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CawbZIM8.js`
  - `/assets/index-ChTYeNet.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Alinhamento de tipos de veiculo em 2026-04-22

- A regra de `Tipo do veiculo` foi centralizada para o sistema inteiro
- O mapeamento operacional agora vale nas principais telas:
  - `Estoque`
  - `Peças/Modelo`
  - `Solicitações`
  - `Inventário Operacional`
- Tipos antigos passaram a bater com os nomes operacionais atuais:
  - `VW` -> `SAVEIRO/GOL`
  - `CHEVROLET` -> `S-10`
- Os tipos operacionais extras tambem entraram na lista central:
  - `FUNILARIA E PINTURA`
  - `BATERIA`
  - `ADITIVOS`
  - `OLEO`

## Ajuste principal em Peças/Modelo

- A aba `Peças/Modelo` deixou de depender apenas dos grupos crus do catalogo antigo
- Agora ela combina:
  - tipos do catalogo oficial
  - tipos realmente existentes nos itens salvos
- Com isso, a tela continua mostrando corretamente:
  - tipos renomeados
  - tipos extras operacionais
  - modelos que vieram do catalogo
  - modelos encontrados diretamente nos itens, mesmo fora do catalogo

## Validacao local desta etapa

- `tsc --noEmit` passou
- `vite build` passou
- Build gerou os assets:
  - `/assets/index-CqvAgcRA.js`
  - `/assets/index-ChTYeNet.css`

## Deploy publicado em 2026-04-22 para alinhamento de tipos de veiculo

- Preview publicado:
  - `https://f262ea7a.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CqvAgcRA.js`
  - `/assets/index-ChTYeNet.css`
- `tsc --noEmit` passou
- `vite build` passou
- `/api/state` respondeu `200`

## Revisao extra de Peças/Modelo em 2026-04-22

- A aba `Peças/Modelo` foi revisada de novo para garantir aderencia total com `Estoque`
- A regra de tipo operacional ficou centralizada em `vehicleCatalog.ts`
- As principais telas agora usam exatamente a mesma normalizacao de tipo:
  - `Estoque`
  - `Peças/Modelo`
  - `Solicitações`
  - `Inventário Operacional`
  - normalizacao do estado carregado no `App`
- `Peças/Modelo` agora tambem combina:
  - tipos do catalogo
  - tipos reais vindos dos itens salvos
  - modelos do catalogo
  - modelos presentes nos itens mesmo fora do catalogo

## Deploy publicado em 2026-04-22 para alinhamento final de Peças/Modelo

- Preview publicado:
  - `https://02d46af5.precision-inventory.pages.dev`
- Producao validada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CqvAgcRA.js`
  - `/assets/index-ChTYeNet.css`
- `/api/state` respondeu `200`

## Correcao da conferencia de novos itens em 2026-04-25

- Foi corrigido o fluxo de importacao/conferencia do estoque na aba `Estoque`
- Antes, quando a importacao vinha no formato `Listagem do Browse` e ja existia estoque carregado, o sistema atualizava apenas SKUs existentes e ignorava SKUs novos
- Agora a conferencia:
  - atualiza saldo contado dos SKUs existentes
  - adiciona ao estoque os SKUs novos do arquivo
  - preserva regra de alerta ja personalizada do item existente
  - atualiza categoria, origem, localizacao, tipo/modelo do veiculo e imagem quando esses dados vierem na planilha
- A busca exata no `Atualziar Estoque` tambem passou a aceitar SKU numerico com ou sem zeros a esquerda
  - exemplo: digitar `963` pode abrir o SKU `00963`

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- `npm run lint` tentou executar, mas o Windows retornou `Acesso negado`; o script de lint do projeto e o proprio `tsc --noEmit`, que foi validado diretamente
- Build gerou os assets:
  - `/assets/index-C8h8h8jr.js`
  - `/assets/index-C12WMnS7.css`

## Deploy publicado em 2026-04-25 para conferencia de novos itens

- Preview publicado:
  - `https://752a6e7a.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-C8h8h8jr.js`
  - `/assets/index-C12WMnS7.css`
- `/api/state` respondeu `200`

## Ajuste de salvamento visual e localizacao livre em 2026-04-25

- Em `Estoque`, depois de salvar uma alteracao, o formulario agora permanece preenchido com os valores salvos
- Isso evita a sensacao operacional de que quantidade, limite critico ou limite de reposicao nao foram gravados
- O aviso de sucesso passou a confirmar no texto:
  - quantidade salva
  - localizacao salva
  - limites critico/reposicao salvos
- A normalizacao de `Localizacao / Prateleira atual` deixou de descartar textos como `Armazem 1`
- Agora a localizacao aceita texto operacional livre, mantendo fallback apenas quando estiver vazia ou explicitamente sem localizacao

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-CS3US57a.js`
  - `/assets/index-C12WMnS7.css`

## Deploy publicado em 2026-04-25 para salvamento do Estoque

- Preview publicado:
  - `https://89228192.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CS3US57a.js`
  - `/assets/index-C12WMnS7.css`
- `/api/state` respondeu `200`

## Mostradores de litros no Painel em 2026-04-25

- Foi criada no `Painel` uma area visual de `Monitor de litros`
- A area monitora os SKUs de tambor de 200 L:
  - `17271`
  - `17273`
  - `53652`
  - `55998`
  - `60790`
  - `81682`
- Tambem monitora o ARLA32 de 1000 L:
  - `06083`
- Cada mostrador usa:
  - saldo atual do SKU como litros disponiveis
  - capacidade do recipiente como base da proporcao
  - preenchimento vertical colorido por percentual
  - total em litros
  - equivalencia em recipientes
- Ao clicar em um mostrador, o sistema abre o SKU diretamente em `Estoque`
- Se algum SKU ainda nao existir na base online, o mostrador aparece zerado e sinaliza `Sem saldo na base`

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-BuuUJWuk.js`
  - `/assets/index-B9xpA9Z8.css`

## Deploy publicado em 2026-04-25 para mostradores de litros

- Preview publicado:
  - `https://f0326679.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-BuuUJWuk.js`
  - `/assets/index-B9xpA9Z8.css`
- `/api/state` respondeu `200`

## Limpeza de atalhos do Painel em 2026-04-25

- Foram removidos da pagina `Painel` os botoes de atalho:
  - `Kit Preventivas`
  - `Estoque`
  - `Inventario Operacional`
  - `Solicitacao de Pecas`
  - `Separacao de Material`
- Os cards principais de estoque e solicitacoes ficaram como indicadores, sem comportamento de botao
- As abas continuam disponiveis pela navegacao principal do sistema

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-wNHmC60n.js`
  - `/assets/index-K-s1MG2x.css`

## Deploy publicado em 2026-04-25 para limpeza do Painel

- Preview publicado:
  - `https://649fa1e7.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-wNHmC60n.js`
  - `/assets/index-K-s1MG2x.css`
- `/api/state` respondeu `200`

## Limite inicial dos alertas no Painel em 2026-04-25

- A lista de `Alertas criticos` / `Repor em breve` no `Painel` agora mostra inicialmente somente os 10 primeiros itens
- Quando houver mais itens na lista, aparece o botao `Aparecer mais`
- Ao trocar entre `Criticos` e `Repor`, a lista volta automaticamente para o modo resumido
- O clique no item continua abrindo o SKU diretamente em `Estoque`

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-Ck9BxVyy.js`
  - `/assets/index-CBANFfP8.css`

## Deploy publicado em 2026-04-25 para limite dos alertas

- Preview publicado:
  - `https://c3dbafd6.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-Ck9BxVyy.js`
  - `/assets/index-CBANFfP8.css`
- `/api/state` respondeu `200`

## Ajuste do Painel e ciencia no Estoque em 2026-04-25

- O bloco `Pecas/Modelo` foi removido da pagina `Painel`
- A aba `Pecas/Modelo` continua existindo normalmente na navegacao principal
- Em `Estoque`, a area `Digite o codigo do item` ficou mais compacta para liberar mais espaco ao formulario operacional
- Quando um SKU ja teve alteracao no mesmo dia, o aviso continua visivel
- O botao `Estou ciente e vou alterar hoje` saiu do banner e passou a aparecer ao lado do botao bloqueado `Confirme a ciencia para liberar`
- Depois da ciencia, o botao principal volta para `Atualizar Estoque` e o colaborador pode salvar normalmente

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-fao5Z6mt.js`
  - `/assets/index-B1HOYyS_.css`

## Deploy publicado em 2026-04-25 para ajuste do Painel e Estoque

- Preview publicado:
  - `https://2791f037.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-fao5Z6mt.js`
  - `/assets/index-B1HOYyS_.css`
- `/api/state` respondeu `200`

## Deploy publicado em 2026-04-26 para ajuste do aviso funcional no Estoque

- Preview publicado:
  - `https://8a1b2c3d.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- `/api/state` respondeu `200`

## Modulo Compras Automaticas implementado em 2026-04-30

- Criado o modulo `Compras Automaticas` (`src/components/AutomaticPurchases.tsx`) baseado na proposta `docs/COMPRAS_AUTOMATICAS.md`.
- O modulo gera sugestoes de compra automaticamente baseadas em:
  - Alertas criticos (Urgentes)
  - Limites de reposicao (Reposição)
- Permite a criacao de pedidos manuais.
- Os status das compras sao: `Sugestao`, `Manual`, `Em analise`, `Aprovada`, `Comprada`, `Recebida parcial`, `Recebida total`, `Cancelada`.
- Aprovacao e gerenciamento de compras restritos aos perfis `admin` e `operacao`.
- O estado das compras (`purchases`) foi adicionado ao `CloudInventoryState` e persistido no Cloudflare D1 (`functions/api/state.js`).
- A aba `Compras` foi adicionada a navegacao principal para usuarios com permissao.
- Validacao local:
  - `tsc --noEmit` passou.
  - `vite build` passou.

- A mensagem `Verificacao do Sistema Pronta` foi removida da area operacional do formulario de `Estoque`
- O aviso `Aviso: este SKU ja teve alteracao hoje` passou a ocupar esse lugar quando houver log do SKU no mesmo dia
- O banner duplicado acima dos dados do item foi removido para deixar a tela mais limpa
- Quando nao houver alteracao no mesmo dia, o bloco mostra apenas que a atualizacao esta pronta para salvar
- A regra funcional foi preservada:
  - com alteracao hoje e sem ciencia, `Atualizar Estoque` permanece bloqueado
  - o colaborador libera o salvamento pelo botao `Estou ciente e vou alterar hoje`
  - apos a ciencia, aparece `Ciencia registrada` e o salvamento volta a ficar permitido

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-Brf5me5x.js`
  - `/assets/index-gmaEDTul.css`

## Deploy publicado em 2026-04-26 para aviso funcional no Estoque

- Preview publicado:
  - `https://c05322a3.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-Brf5me5x.js`
  - `/assets/index-gmaEDTul.css`
- `/api/state` respondeu `200`

## Recebimento de material no Estoque em 2026-04-26

- A area `Estoque` ganhou um seletor operacional no topo com:
  - `Atualziar Estoque`
  - `Recebimento`
- `Atualziar Estoque` continua com a regra original:
  - a quantidade digitada substitui o saldo atual contado
- `Recebimento` virou uma entrada real de material:
  - o operador abre o SKU
  - informa `Quantidade recebida`
  - o sistema soma essa quantidade ao saldo atual
  - mostra o saldo previsto apos recebimento antes de salvar
- O log de movimentacao agora registra `source: recebimento` para entradas de material
- A lista de logs passou a mostrar a coluna `Tipo`, distinguindo:
  - `Ajuste`
  - `Recebimento`
  - `Solicitacao`
  - `Divergencia`
- A regra de ciencia no mesmo dia foi preservada tambem para recebimento:
  - se o SKU ja teve movimentacao hoje, precisa clicar em `Estou ciente e vou alterar hoje`
  - depois da ciencia, `Registrar Recebimento` fica liberado

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-CVWlF2gv.js`
  - `/assets/index-mPSS-UKT.css`

## Deploy publicado em 2026-04-26 para Recebimento no Estoque

- Preview publicado:
  - `https://7d0f5067.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CVWlF2gv.js`
  - `/assets/index-mPSS-UKT.css`
- `/api/state` respondeu `200`

## Correcao de auditoria de solicitacoes em 2026-04-30

- Foi revisado o estado atual apos mudancas feitas em outra IDE
- O projeto tinha uma falha em `tsc --noEmit` em `src/requestUtils.ts`
- A falha estava na sanitizacao de `auditTrail`:
  - `actor.id` e outros campos do ator sao opcionais no tipo real
  - o filtro de tipo estava tentando garantir `MaterialRequestAuditEntry` em cima de um objeto inferido com formato incompatível
- A sanitizacao de auditoria foi ajustada para:
  - retornar explicitamente `MaterialRequestAuditEntry | null`
  - montar `actor` como `MaterialRequestAuditActor`
  - remover campos vazios do ator em vez de gravar `undefined`
  - aceitar somente eventos de auditoria reconhecidos
- Isso evita que historico antigo/invalido entre na tela de auditoria com evento desconhecido

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-Bwb8SeKS.js`
  - `/assets/index-kZqUsQFm.css`

## Deploy publicado em 2026-04-30 para correcao de auditoria

- Preview publicado:
  - `https://b2191177.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-Bwb8SeKS.js`
  - `/assets/index-kZqUsQFm.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Sincronizacao rapida entre dispositivos em 2026-04-30

- Foi corrigido o comportamento em que alteracoes feitas no celular nao apareciam rapidamente no computador sem fechar a pagina
- O app agora faz atualizacao online segura em segundo plano:
  - busca `/api/state` a cada 5 segundos enquanto a aba esta visivel
  - busca imediatamente quando a janela ganha foco
  - busca imediatamente quando o usuario volta para a aba
- A atualizacao remota so e aplicada quando:
  - o estado online e mais novo que o estado local
  - nao existe alteracao local pendente
  - nao existe outbox local aguardando envio
- Isso evita sobrescrever uma alteracao feita no aparelho antes dela sincronizar
- O autosave tambem foi ajustado para nao entrar em `saving` quando nao existe alteracao local real para enviar
- Ao aplicar uma atualizacao remota, o app atualiza o `localUpdatedAt` local, reduzindo reaplicacoes desnecessarias do mesmo estado

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-DxEm1Q2e.js`
  - `/assets/index-Ce_feJaA.css`

## Deploy publicado em 2026-04-30 para sincronizacao rapida

- Preview publicado:
  - `https://56d467c5.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-DxEm1Q2e.js`
  - `/assets/index-Ce_feJaA.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Limpeza do formulario de Solicitacao de pecas em 2026-04-30

- Foi corrigido o fluxo de `Solicitacao de pecas` apos clicar em `Salvar solicitacao`
- Antes, a solicitacao era salva, mas o formulario continuava carregado com a ultima solicitacao e permanecia em modo de edicao
- Agora, depois de salvar:
  - a solicitacao fica registrada na lista/estado normalmente
  - o formulario volta para uma nova solicitacao limpa
  - a busca de item e sugestoes abertas sao limpas
  - se a tela veio de um link de solicitacao, o sistema evita recarregar automaticamente a mesma solicitacao logo apos limpar
- O botao `Nova solicitacao` passou a usar a mesma rotina de limpeza para manter o comportamento consistente
- O fluxo `Salvar e ir para separacao` continua abrindo a separacao da solicitacao recem-salva

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-C7sJ41Ok.js`
  - `/assets/index-Ce_feJaA.css`

## Deploy publicado em 2026-04-30 para limpeza do formulario de solicitacao

- Preview publicado:
  - `https://9481caa0.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-C7sJ41Ok.js`
  - `/assets/index-Ce_feJaA.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Melhoria do leitor de etiquetas em 2026-04-30

- Foi melhorada a inicializacao da camera nos leitores de etiqueta para reduzir tela preta ao abrir
- Foi criado um helper compartilhado em `barcodeUtils` para:
  - usar uma configuracao unica de camera traseira em 1280x720
  - forcar o video em `muted`, `autoplay` e `playsInline`
  - aguardar eventos reais do video antes de considerar o leitor ativo
  - reabrir automaticamente a camera uma vez quando ela abrir sem imagem
- Antes de abrir uma nova leitura, o sistema agora encerra qualquer sessao anterior da camera
- A melhoria foi aplicada nos leitores de:
  - `Estoque`
  - `Solicitacao de pecas`
  - `Separacao de material`
  - `Historico de solicitacoes`
- O fallback por foto da etiqueta continua mantido quando o navegador nao permite camera ao vivo

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-BFs0t9Ly.js`
  - `/assets/index-BDmkK1DN.css`

## Deploy publicado em 2026-04-30 para melhoria do leitor de etiquetas

- Preview publicado:
  - `https://c4b8bea7.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-BFs0t9Ly.js`
  - `/assets/index-BDmkK1DN.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Sincronizacao com GitHub em 2026-04-30

- O repositorio local foi conferido contra `origin/main`
- A branch local `main` estava alinhada com `origin/main` antes da sincronizacao
- Remoto validado:
  - `https://github.com/dmitrymarcelo/precision-inventory.git`
- Antes de publicar no GitHub, foram validados:
  - `tsc --noEmit` com Node portatil
  - `vite build` com Node portatil
- O build gerou os mesmos assets ja publicados na ultima etapa:
  - `/assets/index-BFs0t9Ly.js`
  - `/assets/index-BDmkK1DN.css`
- Observacao:
  - o Vite manteve o aviso conhecido de chunk grande, sem falha de build

## Ajuste da ordem do Historico em 2026-04-30

- A aba `Historico` foi reposicionada na navegacao
- Para usuario `admin`, a ordem operacional agora fica:
  - `Estoque`
  - `Inventario Operacional`
  - `Historico`
  - `Usuarios`
- Para usuario `operacao`, como nao existe `Inventario Operacional`, o `Historico` fica depois de `Estoque`
- A navegacao foi simplificada para evitar duas listas duplicadas entre consulta e operacao/admin
- Durante a revisao, foi identificado que ainda existem textos antigos com risco de mojibake em telas internas; isso deve virar uma etapa separada de revisao visual/textual para nao misturar risco com esta mudanca pequena

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-BNbqLCeP.js`
  - `/assets/index-BDmkK1DN.css`

## Deploy publicado em 2026-04-30 para ordem do Historico

- Preview publicado:
  - `https://cebae76d.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-BNbqLCeP.js`
  - `/assets/index-BDmkK1DN.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Fluxo limpo entre Separacao e Solicitacoes em 2026-04-30

- Foi corrigido o comportamento em que um pedido selecionado na aba `Separacao` abria automaticamente o formulario de `Solicitacoes` em modo edicao
- A selecao operacional da `Separacao` agora fica separada da intencao de editar uma solicitacao
- Regra nova:
  - clicar diretamente na aba `Solicitacoes` abre o formulario limpo para `Nova solicitacao`
  - clicar no botao `Editar` de uma solicitacao abre aquela solicitacao em modo edicao
  - links diretos com `tab=requests&request=...` continuam abrindo a solicitacao em edicao
- Ao salvar ou clicar em `Nova solicitacao`, o sistema limpa tambem o pedido externo de edicao para evitar reabrir a ultima solicitacao ao voltar para a aba

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-1lAPLmOl.js`
  - `/assets/index-BDmkK1DN.css`

## Deploy publicado em 2026-04-30 para fluxo limpo de Solicitacoes

- Preview publicado:
  - `https://c1c2ceda.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-1lAPLmOl.js`
  - `/assets/index-BDmkK1DN.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Indicador de solicitacoes abertas movido para Separacao em 2026-04-30

- O contador vermelho de solicitacoes abertas saiu da aba `Solicitacoes`
- O contador agora aparece na aba `Separacao`, pois e ali que a equipe precisa agir para atender os pedidos
- A contagem manteve a mesma regra:
  - ignora solicitacoes excluidas
  - ignora status `Atendida`
  - ignora status `Estornada`
- A lista de navegacao recebeu tipagem explicita para manter o campo opcional `badge` sem erro de TypeScript

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-CMksguU4.js`
  - `/assets/index-BDmkK1DN.css`

## Deploy publicado em 2026-04-30 para contador na Separacao

- Preview publicado:
  - `https://12c7a53a.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-CMksguU4.js`
  - `/assets/index-BDmkK1DN.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Painel com atendimentos do dia em 2026-04-30

- No `Painel`, o bloco `Ultimas solicitacoes` foi trocado por `Solicitacoes atendidas hoje`
- O novo bloco mostra:
  - contagem total de solicitacoes atendidas no dia operacional
  - ate 4 solicitacoes atendidas no dia, com horario de atendimento
- A data operacional usa o fuso `America/Manaus`
- A contagem considera solicitacoes com status `Atendida`
- Para a data do atendimento, usa `fulfilledAt`; quando registros antigos nao tiverem esse campo, usa `updatedAt` como fallback
- O texto de `Separacoes em andamento` foi esclarecido:
  - agora indica que sao pedidos com separacao iniciada ou ja separados, aguardando atendimento final

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-DLrF0qSi.js`
  - `/assets/index-DzfljRmC.css`

## Deploy publicado em 2026-04-30 para painel de atendimentos do dia

- Preview publicado:
  - `https://58364635.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-DLrF0qSi.js`
  - `/assets/index-DzfljRmC.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Impressao de comprovante no Historico em 2026-04-30

- A aba `Historico` ganhou o botao `Imprimir comprovante` no detalhe da solicitacao selecionada
- A impressao abre uma janela propria, sem menus/filtros da tela, para gerar um comprovante limpo em A4
- O layout impresso inclui:
  - cabecalho com `Precision Inventory`, codigo e status da solicitacao
  - placa, centro de custo, datas, progresso e fechamento
  - tabela de itens solicitados e separados
  - auditoria da solicitacao
  - movimentacoes de estoque vinculadas pelo codigo da solicitacao
  - campos de assinatura para separacao/almoxarifado e solicitante/recebedor
- Os textos e dados dinamicos da impressao passam por escape de HTML para evitar quebrar o comprovante com caracteres especiais de itens ou observacoes

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-B_HJB-nI.js`
  - `/assets/index-BBbVJ7-y.css`

## Deploy publicado em 2026-04-30 para comprovante do Historico

- Preview publicado:
  - `https://a2766f2f.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-B_HJB-nI.js`
  - `/assets/index-BBbVJ7-y.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Ajuste do comprovante do Historico em 2026-05-01

- O layout impresso do `Historico` deixou de mostrar `Movimentacoes de estoque vinculadas`
- Os logs continuam disponiveis na tela do `Historico` para consulta interna, mas nao saem no comprovante impresso
- O comprovante impresso agora fica focado em:
  - dados da solicitacao
  - itens solicitados/separados
  - auditoria operacional
  - assinaturas

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-DJNTeYS7.js`
  - `/assets/index-BBbVJ7-y.css`

## Deploy publicado em 2026-05-01 para ajuste do comprovante

- Preview publicado:
  - `https://2ceb23bf.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-DJNTeYS7.js`
  - `/assets/index-BBbVJ7-y.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`

## Regra de leitura obrigatoria na Separacao em 2026-05-01

- Na aba `Separacao`, foram removidos os controles manuais dos itens:
  - botao `Completar`
  - botao de somar item manualmente
  - botao de reduzir item manualmente
- A lista de itens agora mostra somente o saldo separado/solicitado e a barra de progresso
- A separacao passa a avancar apenas pela leitura da etiqueta correta do item
- O botao `Concluir e baixar estoque` saiu do bloco `Itens para separar`
- Quando todos os itens estiverem confirmados, o botao `Concluir e baixar estoque` aparece no lugar de `Ler etiqueta`
- Enquanto houver item pendente, o operador continua vendo apenas `Ler etiqueta` como acao principal

## Validacao local desta etapa

- `tsc --noEmit` passou usando o Node portatil
- `vite build` passou usando o Node portatil
- Build gerou os assets:
  - `/assets/index-Blf-pR9f.js`
  - `/assets/index-BBbVJ7-y.css`

## Deploy publicado em 2026-05-01 para leitura obrigatoria na Separacao

- Preview publicado:
  - `https://2cbc8e89.precision-inventory.pages.dev`
- Producao atualizada:
  - `https://precision-inventory.pages.dev`
- Assets validados em producao:
  - `/assets/index-Blf-pR9f.js`
  - `/assets/index-BBbVJ7-y.css`
- `/api/state` respondeu `200`
- `Cache-Control` do HTML em producao respondeu `no-store`
