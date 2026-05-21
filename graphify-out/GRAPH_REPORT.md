# Graph Report - Sistema inventario  (2026-05-20)

## Corpus Check
- 58 files · ~136,428 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 705 nodes · 1720 edges · 13 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 249 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 78 edges
2. `getSupabaseAdmin()` - 33 edges
3. `normalizeUserFacingText()` - 27 edges
4. `migrateD1ToSupabaseIfNeeded()` - 24 edges
5. `isSupabaseConfigured()` - 23 edges
6. `onRequestPut()` - 19 edges
7. `flushOutbox()` - 19 edges
8. `normalizeOperationalVehicleType()` - 19 edges
9. `getVehicleTypeFromModel()` - 17 edges
10. `getSessionFromRequest()` - 16 edges

## Surprising Connections (you probably didn't know these)
- `handleFilterClick()` --calls--> `showToast()`  [INFERRED]
  src\components\InventoryList.tsx → src\App.tsx
- `handleFileUpload()` --calls--> `showToast()`  [INFERRED]
  src\components\InventoryList.tsx → src\App.tsx
- `handleExportCsv()` --calls--> `showToast()`  [INFERRED]
  src\components\InventoryList.tsx → src\App.tsx
- `handleOpenLabels()` --calls--> `showToast()`  [INFERRED]
  src\components\InventoryList.tsx → src\App.tsx
- `openNextPending()` --calls--> `showToast()`  [INFERRED]
  src\components\InventoryOperation.tsx → src\App.tsx

## Communities

### Community 0 - "Community 0"
Cohesion: 0.05
Nodes (73): acquireOrLoad(), applyManualSeparatedChange(), bootScanner(), closeScanner(), describeCurrentLockHolder(), finalizeRequest(), handleBeforeUnload(), handleDetectedCode() (+65 more)

### Community 1 - "Community 1"
Cohesion: 0.07
Nodes (68): appendSyncEvent(), applyCloudStateIfNewer(), applyCloudUpdateNow(), applyOutboxViaJournalReplay(), clearOutbox(), describeCloudError(), flushJournalBridge(), flushOutbox() (+60 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (62): chooseNewerRecord(), chunkArray(), collectManifestKeysSafe(), collectNewDivergenceLogs(), describeSupabaseError(), ensureSchema(), filterConsultaCreatedRequests(), hasSafeManifestParts() (+54 more)

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (67): addManualLinkedItem(), AutomaticPurchases(), blockPaymentProgressIfHasDivergences(), buildInitialQuotationRows(), buildLinkedQuotationId(), buildQuotationBudgetItems(), buildQuotationPayload(), calculateQuotationScore() (+59 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (60): handleAddManualDraftItem(), commitEdit(), ensureEditableCatalog(), normalizeSku(), removeItem(), acquireOrLoad(), addItemToDraft(), addKitToDraft() (+52 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (47): getEffectiveVehicleType(), getEffectiveVehicleType(), handleExportCsv(), handleFileUpload(), handleFilterClick(), handleOpenLabels(), getEffectiveVehicleType(), openTypeModelPicker() (+39 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (57): base64Decode(), bytesToHex(), concatBytes(), createUser(), decodeSalt(), ensureAuthSchema(), generateId(), generateToken() (+49 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (40): applyPatchesToStateV2(), applyPatchToState(), chooseNewerRecord(), chunkArray(), cleanupOldJournalRows(), cleanupOldJournalRowsSupabase(), collectManifestKeysSafe(), ensureSchema() (+32 more)

### Community 8 - "Community 8"
Cohesion: 0.13
Nodes (21): handleChangeRole(), handleCreate(), handleResetPassword(), handleSaveEdit(), handleToggleActive(), handleVehicleImport(), loadUsers(), countDelimiter() (+13 more)

### Community 9 - "Community 9"
Cohesion: 0.16
Nodes (19): buildSuggestionReason(), openNextPending(), openNextRecount(), getAbcAnalysisForSku(), getAbcClassPriority(), getAbcSortRank(), getAbcStockPolicy(), getAdaptiveAbcStockPolicy() (+11 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (6): buildOperationLogEntries(), formatRequestEvent(), formatSyncEvent(), getSyncTone(), toRequestEntry(), toSyncEntry()

### Community 11 - "Community 11"
Cohesion: 0.31
Nodes (10): handlePrintLabels(), handlePrintCurrentLabel(), buildLabelPreviewMarkup(), buildQrSvgMarkup(), createBarcodePrintDocument(), createLabelMarkup(), escapeHtml(), getLabelNameSizeClass() (+2 more)

### Community 12 - "Community 12"
Cohesion: 0.27
Nodes (6): buildBatterySearchText(), getBatteryValidityMonths(), isBatteryInventoryItem(), isBatteryLikeText(), isBatteryRequestItem(), normalizeSku()

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `normalizeUserFacingText()` connect `Community 5` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 8`, `Community 9`, `Community 10`, `Community 11`, `Community 12`?**
  _High betweenness centrality (0.148) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 4` to `Community 0`, `Community 1`, `Community 3`, `Community 5`, `Community 8`, `Community 9`, `Community 11`?**
  _High betweenness centrality (0.080) - this node is a cross-community bridge._
- **Why does `normalizeOperationalVehicleType()` connect `Community 5` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 9`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 61 inferred relationships involving `showToast()` (e.g. with `blockPaymentProgressIfHasDivergences()` and `handleAddManualDraftItem()`) actually correct?**
  _`showToast()` has 61 INFERRED edges - model-reasoned connections that need verification._
- **Are the 25 inferred relationships involving `getSupabaseAdmin()` (e.g. with `onRequestGet()` and `onRequestPost()`) actually correct?**
  _`getSupabaseAdmin()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **Are the 11 inferred relationships involving `migrateD1ToSupabaseIfNeeded()` (e.g. with `onRequestGet()` and `onRequestPost()`) actually correct?**
  _`migrateD1ToSupabaseIfNeeded()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **Are the 15 inferred relationships involving `isSupabaseConfigured()` (e.g. with `onRequestGet()` and `onRequestPost()`) actually correct?**
  _`isSupabaseConfigured()` has 15 INFERRED edges - model-reasoned connections that need verification._