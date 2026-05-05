# CODEX.md

Protocolo obrigatorio do projeto para o Codex.

Este arquivo deve ser consultado primeiro, antes de propor ou alterar codigo. Ele complementa `AGENTS.md`, `HANDOFF.md` e `SKILLS.md`; as regras de negocio do projeto continuam tendo prioridade quando houver conflito.

## Fonte instalada

- Repositorio clonado para referencia local: `.codex-tools/andrej-karpathy-skills`
- Skill global do Codex: `C:\Users\dmitry.santos\.codex\skills\karpathy-guidelines\SKILL.md`
- Protocolo original dentro da skill: `C:\Users\dmitry.santos\.codex\skills\karpathy-guidelines\references\protocol.md`

## Ferramentas complementares instaladas

- Superpowers clonado em: `C:\Users\dmitry.santos\.codex\superpowers`
- Referencia local do projeto: `.codex-tools/superpowers`
- Skills descobertas por junction em: `C:\Users\dmitry.santos\.agents\skills\superpowers`
- Uso esperado: consultar as skills do Superpowers quando a tarefa pedir brainstorming, plano, TDD, debug sistematico, revisao, finalizacao de branch ou verificacao antes de concluir.
- Prioridade: Superpowers complementa este protocolo; `CODEX.md`, `AGENTS.md` e as regras de negocio do inventario continuam acima.

## Regra de uso

Antes de qualquer tarefa de codigo que nao seja trivial:

1. Consultar este protocolo.
2. Ler `AGENTS.md`, `HANDOFF.md` e `SKILLS.md`.
3. Ler os arquivos que serao alterados.
4. Definir uma verificacao clara antes de editar.
5. Fazer mudancas pequenas, cirurgicas e verificaveis.

## 1. Pensar antes de codar

- Nao assumir silenciosamente formato, escopo, dados, regra de negocio ou intencao de UX.
- Quando houver mais de uma interpretacao valida, declarar a escolha ou pedir uma pergunta curta.
- Apontar tradeoffs quando uma decisao puder afetar estoque real, pedidos, deploy, dados online ou uso mobile.
- Parar e perguntar quando a incerteza puder gerar perda operacional.

## 2. Simplicidade primeiro

- Resolver o pedido com o menor codigo correto.
- Nao criar abstracao, configuracao ou flexibilidade que nao foi pedida.
- Nao transformar uma correcao pequena em refatoracao grande.
- Se a solucao ficar grande demais para o problema, simplificar antes de seguir.

## 3. Mudancas cirurgicas

- Mexer somente nos arquivos e linhas necessarios.
- Manter estilo, nomes e padroes existentes.
- Nao "melhorar" codigo vizinho sem pedido.
- Remover apenas imports, variaveis ou funcoes que ficaram mortos por causa da propria mudanca.
- Se encontrar problema fora do escopo, registrar como risco ou pendencia em vez de alterar.

## 4. Execucao guiada por objetivo

- Converter o pedido em resultado verificavel.
- Para bug, reproduzir ou identificar o comportamento antes de corrigir quando for viavel.
- Para tarefa com varias etapas, trabalhar em passos pequenos com verificacao por passo.
- Rodar validacoes adequadas antes de concluir.

## Aplicacao no Armazem 28

- Nunca enfraquecer regras criticas de estoque, solicitacao, separacao, compras, divergencias ou permissao.
- Preservar uso mobile e linguagem simples em portugues do Brasil.
- Para mudanca funcional, validar TypeScript/build e atualizar `HANDOFF.md`.
- Depois de alterar codigo, rodar `C:\Users\dmitry.santos\.local\bin\graphify.exe update .`.
