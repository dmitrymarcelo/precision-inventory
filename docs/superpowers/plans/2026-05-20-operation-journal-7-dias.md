# Ponte Segura de Operacoes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar uma ponte curta de 7 dias no D1 para reduzir risco de perda de operacoes pendentes de sincronizacao.

**Architecture:** O frontend gera patches pequenos do estado local e guarda uma fila local. A API `/api/operation-journal` salva esses patches no D1 por ate 7 dias e marca como aplicado quando `/api/state` confirma o estado principal.

**Tech Stack:** React, TypeScript, Cloudflare Pages Functions, D1, localStorage.

---

### Task 1: Testes de contrato

**Files:**
- Create: `scripts/test-operation-journal-api.mjs`
- Create: `scripts/test-operation-journal-patch.mjs`

- [x] Criar teste que falha quando `/api/operation-journal` ainda nao existe.
- [x] Criar teste que falha quando `buildOperationJournalPatch` ainda nao existe.
- [x] Confirmar RED com erro de modulo ausente.

### Task 2: API D1

**Files:**
- Create: `functions/api/operation-journal.js`

- [x] Criar tabela `operation_journal`.
- [x] Implementar `POST` para receber ate 25 entradas por chamada.
- [x] Implementar `PUT` para marcar entradas como `applied`.
- [x] Limpar registros com mais de 7 dias.
- [x] Validar sessao via `getSessionFromRequest`.

### Task 3: Cliente da ponte

**Files:**
- Create: `src/operationJournal.ts`

- [x] Gerar patch compacto por `sku`/`id`.
- [x] Manter fila local `precisionInventory.operationJournal.queue.v1`.
- [x] Enviar fila para `/api/operation-journal`.
- [x] Marcar entradas como aplicadas.
- [x] Evitar payload grande demais para o D1.

### Task 4: Integracao no fluxo de sync

**Files:**
- Modify: `src/App.tsx`

- [x] Criar entrada da ponte ao escrever outbox.
- [x] Tentar enviar ponte antes de salvar estado principal.
- [x] Marcar ponte como aplicada depois de `saveCloudState`.
- [x] Bloquear fechamento/reload com pendencia por `beforeunload`.
- [x] Confirmar logout quando existir pendencia.
- [x] Exportar backup de emergencia.

### Task 5: UX operacional

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/OperationLogPanel.tsx`
- Modify: `src/operationLog.ts`

- [x] Mostrar banner forte quando houver pendencia local.
- [x] Adicionar botoes `Sincronizar agora` e `Exportar backup`.
- [x] Mostrar contagem de ponte local no log.
- [x] Traduzir eventos novos na linha do tempo.

### Task 6: Validacao

**Files:**
- Modify: `HANDOFF.md`
- Modify: `SKILLS.md`
- Modify: `docs/PROMPT_DE_CONTEXTO.md`

- [x] Rodar testes novos e regressivos.
- [x] Rodar TypeScript.
- [x] Rodar build.
- [x] Rodar Graphify.
- [x] Fazer deploy e validar `/` e `/api/state`.
- [x] Atualizar memorias persistentes.
