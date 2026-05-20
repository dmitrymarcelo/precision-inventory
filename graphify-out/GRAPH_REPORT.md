# Graph Report - Sistema inventario  (2026-05-20)

## Corpus Check
- 51 files · ~119,683 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 585 nodes · 1329 edges · 14 communities detected
- Extraction: 88% EXTRACTED · 12% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 13|Community 13]]

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 75 edges
2. `normalizeUserFacingText()` - 27 edges
3. `normalizeOperationalVehicleType()` - 19 edges
4. `getVehicleTypeFromModel()` - 17 edges
5. `flushOutbox()` - 15 edges
6. `getSessionFromRequest()` - 14 edges
7. `decodeFileCode()` - 13 edges
8. `normalizeLocationText()` - 13 edges
9. `calculateItemStatus()` - 12 edges
10. `normalizeUserFacingText()` - 12 edges

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
Nodes (67): addManualLinkedItem(), AutomaticPurchases(), blockPaymentProgressIfHasDivergences(), buildInitialQuotationRows(), buildLinkedQuotationId(), buildQuotationBudgetItems(), buildQuotationPayload(), calculateQuotationScore() (+59 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (56): appendSyncEvent(), applyCloudStateIfNewer(), applyCloudUpdateNow(), clearOutbox(), flushJournalBridge(), flushOutbox(), forceApplyCloudState(), handleClearRequestEditor() (+48 more)

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (56): handleAddManualDraftItem(), acquireOrLoad(), addItemToDraft(), addKitToDraft(), addSelectedPickerItems(), appendAuditEntry(), applyDetectedSku(), clearDraftForNextRequest() (+48 more)

### Community 3 - "Community 3"
Cohesion: 0.06
Nodes (44): buildSuggestionReason(), getEffectiveVehicleType(), getEffectiveVehicleType(), handleExportCsv(), handleFileUpload(), handleFilterClick(), handleOpenLabels(), openNextPending() (+36 more)

### Community 4 - "Community 4"
Cohesion: 0.08
Nodes (43): bootScanner(), handleDetectedCode(), applyDetectedSku(), bootScanner(), closeSkuScanner(), formatTimestamp(), normalizeSkuFilter(), printSelectedRequest() (+35 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (45): base64Decode(), bytesToHex(), concatBytes(), createUser(), decodeSalt(), ensureAuthSchema(), generateId(), generateToken() (+37 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (23): commitEdit(), ensureEditableCatalog(), normalizeSku(), removeItem(), getEffectiveVehicleModel(), normalizeUserFacingText(), resolvePreventiveKitCatalog(), getProductVisualProfile() (+15 more)

### Community 7 - "Community 7"
Cohesion: 0.11
Nodes (30): acquireOrLoad(), applyManualSeparatedChange(), closeScanner(), describeCurrentLockHolder(), finalizeRequest(), handleBeforeUnload(), handlePhotoRead(), handleResolvedScan() (+22 more)

### Community 8 - "Community 8"
Cohesion: 0.14
Nodes (23): chooseNewerRecord(), collectNewDivergenceLogs(), ensureSchema(), filterConsultaCreatedRequests(), mergeAliases(), mergeAuditTrail(), mergeConsultaRequestState(), mergeItemsBySku() (+15 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (21): handleChangeRole(), handleCreate(), handleResetPassword(), handleSaveEdit(), handleToggleActive(), handleVehicleImport(), loadUsers(), countDelimiter() (+13 more)

### Community 10 - "Community 10"
Cohesion: 0.15
Nodes (6): buildOperationLogEntries(), formatRequestEvent(), formatSyncEvent(), getSyncTone(), toRequestEntry(), toSyncEntry()

### Community 11 - "Community 11"
Cohesion: 0.32
Nodes (8): cleanupOldJournalRows(), ensureSchema(), onRequestPost(), onRequestPut(), safeJson(), sanitizeEntry(), sanitizeIso(), sanitizeText()

### Community 12 - "Community 12"
Cohesion: 0.27
Nodes (6): buildBatterySearchText(), getBatteryValidityMonths(), isBatteryInventoryItem(), isBatteryLikeText(), isBatteryRequestItem(), normalizeSku()

### Community 13 - "Community 13"
Cohesion: 0.31
Nodes (10): handlePrintLabels(), handlePrintCurrentLabel(), buildLabelPreviewMarkup(), buildQrSvgMarkup(), createBarcodePrintDocument(), createLabelMarkup(), escapeHtml(), getLabelNameSizeClass() (+2 more)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `normalizeUserFacingText()` connect `Community 6` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 7`, `Community 9`, `Community 10`, `Community 12`, `Community 13`?**
  _High betweenness centrality (0.208) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 9`, `Community 13`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `normalizeOperationalVehicleType()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Are the 61 inferred relationships involving `showToast()` (e.g. with `blockPaymentProgressIfHasDivergences()` and `handleAddManualDraftItem()`) actually correct?**
  _`showToast()` has 61 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `normalizeOperationalVehicleType()` (e.g. with `normalizeInventoryItemRecord()` and `normalizePurchaseType()`) actually correct?**
  _`normalizeOperationalVehicleType()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `getVehicleTypeFromModel()` (e.g. with `normalizeInventoryItemRecord()` and `getEffectivePurchaseType()`) actually correct?**
  _`getVehicleTypeFromModel()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `flushOutbox()` (e.g. with `saveCloudState()` and `getFlushCompletionMode()`) actually correct?**
  _`flushOutbox()` has 4 INFERRED edges - model-reasoned connections that need verification._