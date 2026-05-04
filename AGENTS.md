# AGENTS.md

Este arquivo e a memoria operacional do projeto para qualquer agente que trabalhar aqui.

## Ordem de leitura obrigatoria

1. Ler `HANDOFF.md`
2. Ler `SKILLS.md`
3. Ler os arquivos que vao ser alterados
4. So depois propor mudancas maiores

## O que este sistema e

Aplicativo web de inventario e operacao de estoque, com foco em:

- inventario fisico
- busca e atualizacao por SKU
- leitura de etiqueta por camera e foto
- solicitacao de pecas por placa e centro de custo
- separacao de material com validacao por codigo
- impressao de etiquetas
- persistencia online compartilhada via Cloudflare Pages + D1

## Regras de negocio que NAO devem ser quebradas

- Em `Buscar e Atualizar`, a quantidade digitada e o saldo atual contado do item na locacao atual. Nao e entrada, nao e saida.
- A regra de alertas e por item. O painel nao deve voltar a centralizar essa regra como unica fonte de verdade.
- A localizacao do inventario importado vem da coluna `K`, campo `locacao`, da planilha principal.
- Em `Solicitacao de pecas`, o formulario principal gira em torno de `placa` e `centro de custo`.
- Nao pode adicionar item sem saldo na solicitacao. O item deve ficar bloqueado e visivelmente em vermelho.
- Em `Separacao de material`, o leitor so confirma item se o codigo pertencer ao pedido aberto.
- Pedido entregue vira somente consulta. Nao pode editar nem excluir depois disso.
- A equipe usa o sistema em celular. Toda mudanca relevante precisa respeitar uso mobile.

## Preferencias explicitas do usuario

- Texto da interface em portugues do Brasil
- Linguagem simples, clara e operacional
- Impressao de etiquetas precisa ser pratica
- Leitura de etiqueta deve se comportar como coletor
- O sistema precisa "lembrar" o contexto do projeto e evitar repeticao

## Areas mais frageis hoje

- Codificacao de texto: ja houve problema com `\\u00e7`, `\\u00e3` aparecendo na tela
- Mojibake em alguns arquivos antigos (`Inventario`, `Separacao`, etc.)
- Impressao no navegador depende do dialogo do Windows
- Leitura por camera muda conforme navegador, permissao e qualidade da etiqueta
- Deploy com `wrangler` pode travar nesta maquina

## Regras para mudancas futuras

- Nao trocar o formato de etiqueta globalmente sem manter um fallback estavel
- Nao mexer em linguagem da interface sem revisao visual
- Nao quebrar o fluxo atual do inventario so para testar novos formatos
- Toda mudanca em impressao deve considerar:
  - varias etiquetas por folha
  - tamanho fisico coerente
  - nao "queimar" folha
- Toda mudanca em leitura deve considerar:
  - camera ao vivo
  - foto manual
  - fallback por numero impresso quando fizer sentido

## Fluxo recomendado para qualquer agente

1. Ler `HANDOFF.md` para saber o estado atual
2. Confirmar em qual modulo vai mexer
3. Fazer alteracoes pequenas e verificaveis
4. Rodar pelo menos:
   - `npm run lint`
   - `npm run build`
5. Quando deploy travar, registrar isso no `HANDOFF.md`

## Comandos uteis

- desenvolvimento local: `npm run dev`
- preview do build: `npm run build` depois `npm run preview`
- deploy: `npm run deploy`

## Fonte de verdade do estado online

- Pages Functions: `functions/api/state.js`
- Banco D1: `precision-inventory-db`

## Regra de handoff

Sempre que terminar uma etapa importante:

- atualizar `HANDOFF.md`
- registrar decisoes novas
- listar pendencias reais
- avisar o que foi validado e o que nao foi validado

## graphify

Este projeto tem um grafo de conhecimento do Graphify em `graphify-out/`.

Regras:
- Antes de responder perguntas de arquitetura ou do codigo, ler `graphify-out/GRAPH_REPORT.md`.
- Se `graphify-out/wiki/index.md` existir, usar a wiki antes de varrer arquivos brutos.
- Para perguntas entre modulos, preferir `graphify query "<pergunta>"`, `graphify path "<A>" "<B>"` ou `graphify explain "<conceito>"` antes de procurar tudo por texto.
- Depois de alterar codigo nesta sessao, rodar `C:\Users\dmitry.santos\.local\bin\graphify.exe update .` para manter o grafo atualizado. Esse update e local/AST e nao usa API.
