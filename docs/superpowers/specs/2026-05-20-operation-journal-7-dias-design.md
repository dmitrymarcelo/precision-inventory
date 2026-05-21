# Ponte Segura de Operacoes - Design

## Objetivo

Reduzir o risco de perda de operacoes quando um aparelho ainda nao terminou de sincronizar e alguem limpa dados do navegador, troca de celular ou fecha a sessao cedo demais.

## Decisao principal

Criar uma ponte curta no servidor, chamada `operation_journal`, com retencao de 7 dias.

Ela nao e historico permanente. E uma confirmacao de transicao:

1. o navegador salva a operacao localmente
2. o navegador cria um patch pequeno da mudanca
3. o patch entra em uma fila local da ponte
4. quando ha internet, a fila envia para `/api/operation-journal`
5. depois que `/api/state` confirma o estado principal, a operacao e marcada como `applied`
6. registros com mais de 7 dias sao limpos automaticamente pelo endpoint

## Escopo

- Proteger operacoes enquanto ainda existe pendencia local.
- Avisar claramente o operador para nao limpar dados do navegador antes de sincronizar.
- Permitir exportar backup de emergencia quando houver pendencia.
- Nao criar historico longo no D1.
- Nao aplicar automaticamente patches do diario sobre o estado principal sem revisao humana/admin.

## Dados no D1

Tabela: `operation_journal`

Campos principais:

- `id`
- `device_id`
- `actor_matricula`
- `actor_name`
- `actor_role`
- `operation_type`
- `entity`
- `payload`
- `status`
- `created_at`
- `received_at`
- `applied_at`

Retencao: 7 dias por `created_at`.

## Frontend

- `src/operationJournal.ts` monta patches pequenos por SKU/id.
- `src/App.tsx` cria entrada da ponte quando grava o outbox.
- `src/App.tsx` tenta enviar a ponte antes do `PUT /api/state`.
- `src/App.tsx` marca a ponte como aplicada depois do estado principal salvo.
- `Layout` mostra aviso forte quando houver pendencia.
- `OperationLogPanel` mostra botoes para sincronizar e exportar backup.

## Limitacao assumida

Se o aparelho estiver totalmente offline, o servidor nao recebe nada. Nesse caso, a protecao possivel e local: aviso forte, bloqueio de saida por confirmacao e backup exportavel.
