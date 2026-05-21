# Operacao, Logs e Inventario Ciclico Obrigatorio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Melhorar confiabilidade, memoria operacional, performance inicial e obrigatoriedade do inventario ciclico diario por usuario.

**Architecture:** Extrair regras puras para helpers testaveis, manter o estado principal no fluxo atual e fazer mudancas cirurgicas em App, Usuarios, Auth e Dashboard. A tela de log agrega eventos ja existentes em vez de criar uma tabela D1 separada neste primeiro ciclo.

**Tech Stack:** React 19, TypeScript, Vite, Cloudflare Pages Functions, D1, Node 24 para scripts de teste.

---

### Task 1: Testes de Base

**Files:**
- Create: `scripts/test-sync-outbox.mjs`
- Create: `scripts/test-cyclic-inventory.mjs`

- [ ] Escrever teste que falha para comparar identidade de outbox e preservar alteracao mais nova.
- [ ] Escrever teste que falha para selecao diaria do inventario ciclico e filtro de logs operacionais.
- [ ] Rodar os testes e confirmar falha esperada por modulo/funcoes ausentes.

### Task 2: Helpers Puros

**Files:**
- Create: `src/syncOutbox.ts`
- Create: `src/cyclicInventory.ts`

- [ ] Implementar helper de identidade do outbox.
- [ ] Implementar helper de selecao dos itens ciclicos.
- [ ] Rodar os testes e confirmar passagem.

### Task 3: Sincronizacao

**Files:**
- Modify: `src/App.tsx`

- [ ] Usar o helper de outbox no `flushOutbox`.
- [ ] Evitar aplicar retorno antigo do cloud quando existir outbox novo.
- [ ] Manter indicador de pendencia local atualizado.

### Task 4: Usuarios e Auth

**Files:**
- Modify: `functions/api/auth.js`
- Modify: `functions/api/users.js`
- Modify: `functions/api/state.js`
- Modify: `src/components/UserManager.tsx`
- Modify: `src/App.tsx`

- [ ] Adicionar coluna `requires_daily_cycle_inventory`.
- [ ] Retornar o campo em login, `me` e listagem de usuarios.
- [ ] Permitir admin editar o campo para `admin` e `operacao`.
- [ ] Impedir `consulta` de receber obrigatoriedade.

### Task 5: Inventario Ciclico Obrigatorio

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/InventoryOperation.tsx`

- [ ] Reusar o helper ciclico no App e no Inventario Operacional.
- [ ] Mostrar a contagem diaria no Painel somente quando houver obrigatoriedade pendente.
- [ ] Bloquear navegacao fora de Painel, Estoque e Inventario Operacional ate concluir.

### Task 6: Log do Sistema

**Files:**
- Create: `src/operationLog.ts`
- Create: `src/components/OperationLogPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/Layout.tsx`

- [ ] Agregar eventos de sincronizacao, logs de estoque e auditorias de solicitacao.
- [ ] Criar tela de log com filtros simples e status de salvamento.
- [ ] Adicionar acesso no menu do usuario para `admin` e `operacao`.

### Task 7: Performance

**Files:**
- Modify: `src/App.tsx`

- [ ] Trocar imports pesados por `React.lazy`.
- [ ] Adicionar fallback leve de carregamento de modulo.
- [ ] Validar reducao dos chunks no build.

### Task 8: Memoria e Validacao

**Files:**
- Modify: `HANDOFF.md`
- Modify: `SKILLS.md`
- Modify: `docs/PROMPT_DE_CONTEXTO.md`

- [ ] Registrar decisoes e pendencias reais.
- [ ] Rodar testes, TypeScript, build e Graphify.
- [ ] Relatar o que foi validado e qualquer limitacao.
