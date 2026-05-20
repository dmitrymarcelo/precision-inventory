# Operacao, Logs e Inventario Ciclico Obrigatorio - Design

Data: 2026-05-20

## Objetivo

Melhorar o projeto sem quebrar o fluxo atual: tornar o salvamento mais confiavel, criar uma area de log operacional, manter o Painel objetivo e permitir que administradores obriguem usuarios selecionados a concluir a contagem diaria antes de usar o restante do sistema.

## Decisoes Aprovadas

- A obrigatoriedade do inventario ciclico sera configurada em `Usuarios`.
- A obrigatoriedade sera aplicada somente a perfis `Operacao` e `Admin`, porque `Consulta` nao pode alterar estoque.
- Usuarios obrigados poderao acessar `Painel`, `Estoque` e `Inventario Operacional` enquanto a contagem diaria estiver pendente.
- A tela inicial mostrara a contagem diaria somente quando ela for obrigatoria e estiver pendente para o usuario.
- O bloqueio termina quando todos os itens do dia tiverem log operacional de contagem no dia em `America/Manaus` e nao houver divergencia aberta nesses SKUs.
- A area de log operacional sera uma tela de leitura com eventos de sincronizacao do aparelho, logs de estoque e trilha de auditoria das solicitacoes.
- O risco conhecido do `flushOutbox` sera corrigido para nao limpar uma alteracao local mais nova quando uma gravacao antiga terminar depois.
- A primeira melhoria de performance sera dividir os modulos pesados por `React.lazy`, mantendo a tela inicial leve.

## Escopo

Incluido:

- Campo de usuario `requires_daily_cycle_inventory`.
- Propagacao do campo no login, sessao e tela de usuarios.
- Calculo compartilhado da contagem diaria.
- Bloqueio de navegacao quando o ciclo obrigatorio estiver pendente.
- Card de ciclo diario no painel.
- Tela `Log do Sistema`.
- Correcao de corrida do outbox.
- Code splitting de modulos grandes.
- Atualizacao de `HANDOFF.md` e `SKILLS.md`.

Fora deste primeiro ciclo:

- Banco separado para logs imutaveis em D1.
- IndexedDB/service worker offline-first completo.
- Dashboard executivo de produtividade por usuario.
- Lighthouse automatizado em aparelho real.

## Verificacao

- Teste de outbox: salvar antigo nao pode apagar outbox mais novo.
- Teste de inventario ciclico: selecao diaria respeita pendentes e conta apenas logs operacionais.
- `scripts/test-state-consulta-save.mjs`.
- `tsc --noEmit`.
- `vite build`.
- `graphify update .`.
