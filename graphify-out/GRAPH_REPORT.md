# Graph Report - Sistema inventario  (2026-05-20)

## Corpus Check
- 55 files · ~129,406 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 647 nodes · 1509 edges · 12 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 189 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 78 edges
2. `normalizeUserFacingText()` - 27 edges
3. `normalizeOperationalVehicleType()` - 19 edges
4. `flushOutbox()` - 18 edges
5. `getVehicleTypeFromModel()` - 17 edges
6. `appendSyncEvent()` - 15 edges
7. `applyOutboxViaJournalReplay()` - 15 edges
8. `getSessionFromRequest()` - 14 edges
9. `decodeFileCode()` - 13 edges
10. `getPendingOperationJournalQueue()` - 13 edges

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
Cohesion: 0.05
Nodes (67): handleAddManualDraftItem(), acquireOrLoad(), addItemToDraft(), addKitToDraft(), addSelectedPickerItems(), appendAuditEntry(), applyDetectedSku(), clearDraftForNextRequest() (+59 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (67): addManualLinkedItem(), AutomaticPurchases(), blockPaymentProgressIfHasDivergences(), buildInitialQuotationRows(), buildLinkedQuotationId(), buildQuotationBudgetItems(), buildQuotationPayload(), calculateQuotationScore() (+59 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (65): appendSyncEvent(), applyCloudStateIfNewer(), applyCloudUpdateNow(), applyOutboxViaJournalReplay(), clearOutbox(), describeCloudError(), flushJournalBridge(), flushOutbox() (+57 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (44): getEffectiveVehicleType(), getEffectiveVehicleType(), handleExportCsv(), handleFileUpload(), handleFilterClick(), handleOpenLabels(), commitEdit(), ensureEditableCatalog() (+36 more)

### Community 5 - "Community 5"
Cohesion: 0.07
Nodes (45): base64Decode(), bytesToHex(), concatBytes(), createUser(), decodeSalt(), ensureAuthSchema(), generateId(), generateToken() (+37 more)

### Community 6 - "Community 6"
Cohesion: 0.1
Nodes (36): applyPatchesToStateV2(), applyPatchToState(), chooseNewerRecord(), chunkArray(), cleanupOldJournalRows(), collectManifestKeysSafe(), ensureSchema(), hasSafeManifestParts() (+28 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (33): chooseNewerRecord(), chunkArray(), collectManifestKeysSafe(), collectNewDivergenceLogs(), ensureSchema(), filterConsultaCreatedRequests(), hasSafeManifestParts(), loadChunkedArray() (+25 more)

### Community 8 - "Community 8"
Cohesion: 0.11
Nodes (24): buildSuggestionReason(), openNextPending(), openNextRecount(), getAbcAnalysisForSku(), getAbcClassPriority(), getAbcSortRank(), getAbcStockPolicy(), getAdaptiveAbcStockPolicy() (+16 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (18): handleChangeRole(), handleCreate(), handleResetPassword(), handleSaveEdit(), handleToggleActive(), handleVehicleImport(), loadUsers(), countDelimiter() (+10 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (6): buildOperationLogEntries(), formatRequestEvent(), formatSyncEvent(), getSyncTone(), toRequestEntry(), toSyncEntry()

### Community 11 - "Community 11"
Cohesion: 0.31
Nodes (10): handlePrintLabels(), handlePrintCurrentLabel(), buildLabelPreviewMarkup(), buildQrSvgMarkup(), createBarcodePrintDocument(), createLabelMarkup(), escapeHtml(), getLabelNameSizeClass() (+2 more)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `normalizeUserFacingText()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 8`, `Community 9`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.175) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 8`, `Community 9`, `Community 11`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Why does `getSessionFromRequest()` connect `Community 5` to `Community 6`, `Community 7`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Are the 61 inferred relationships involving `showToast()` (e.g. with `blockPaymentProgressIfHasDivergences()` and `handleAddManualDraftItem()`) actually correct?**
  _`showToast()` has 61 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `normalizeOperationalVehicleType()` (e.g. with `normalizeInventoryItemRecord()` and `normalizePurchaseType()`) actually correct?**
  _`normalizeOperationalVehicleType()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 5 inferred relationships involving `flushOutbox()` (e.g. with `shouldUseJournalReplayForSync()` and `saveCloudState()`) actually correct?**
  _`flushOutbox()` has 5 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `getVehicleTypeFromModel()` (e.g. with `normalizeInventoryItemRecord()` and `getEffectivePurchaseType()`) actually correct?**
  _`getVehicleTypeFromModel()` has 6 INFERRED edges - model-reasoned connections that need verification._