# Graph Report - Sistema inventario  (2026-05-04)

## Corpus Check
- 36 files · ~101,642 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 447 nodes · 1025 edges · 11 communities detected
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 136 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 65 edges
2. `normalizeUserFacingText()` - 25 edges
3. `normalizeOperationalVehicleType()` - 19 edges
4. `getVehicleTypeFromModel()` - 17 edges
5. `decodeFileCode()` - 13 edges
6. `normalizeLocationText()` - 13 edges
7. `calculateItemStatus()` - 12 edges
8. `normalizeUserFacingText()` - 12 edges
9. `syncUrl()` - 11 edges
10. `prepareScannerVideo()` - 11 edges

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
Nodes (65): bootScanner(), closeScanner(), finalizeRequest(), handleDetectedCode(), handlePhotoRead(), handleResolvedScan(), lockScannerBriefly(), normalizeLocationText() (+57 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (67): addManualLinkedItem(), AutomaticPurchases(), blockPaymentProgressIfHasDivergences(), buildInitialQuotationRows(), buildLinkedQuotationId(), buildQuotationBudgetItems(), buildQuotationPayload(), calculateQuotationScore() (+59 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (39): handleAddManualDraftItem(), addItemToDraft(), addKitToDraft(), addSelectedPickerItems(), appendAuditEntry(), applyDetectedSku(), clearDraftForNextRequest(), closeSkuScanner() (+31 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (34): appendSyncEvent(), applyCloudStateIfNewer(), applyCloudUpdateNow(), clearOutbox(), flushOutbox(), forceApplyCloudState(), handleClearRequestEditor(), handleEditRequest() (+26 more)

### Community 4 - "Community 4"
Cohesion: 0.12
Nodes (35): base64Decode(), bytesToHex(), concatBytes(), createUser(), decodeSalt(), ensureAuthSchema(), generateId(), generateToken() (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (25): getEffectiveVehicleType(), getEffectiveVehicleType(), handleExportCsv(), handleFileUpload(), handleFilterClick(), handleOpenLabels(), getEffectiveVehicleType(), openTypeModelPicker() (+17 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (21): handleChangeRole(), handleCreate(), handleResetPassword(), handleSaveEdit(), handleToggleActive(), handleVehicleImport(), loadUsers(), countDelimiter() (+13 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (15): buildSuggestionReason(), openNextPending(), openNextRecount(), getAbcAnalysisForSku(), getAbcClassPriority(), getAbcSortRank(), getAbcStockPolicy(), getAdaptiveAbcStockPolicy() (+7 more)

### Community 8 - "Community 8"
Cohesion: 0.15
Nodes (14): applyCommonTextFixes(), applyReplacementCase(), canonicalizeWord(), decodeLiteralUnicode(), findClosestRepair(), fixCommonMojibake(), isSuspiciousWord(), levenshteinDistance() (+6 more)

### Community 9 - "Community 9"
Cohesion: 0.2
Nodes (16): chooseNewerRecord(), collectNewDivergenceLogs(), ensureSchema(), mergeAliases(), mergeItemsBySku(), mergeLogsById(), mergePurchasesById(), mergeRequestsById() (+8 more)

### Community 10 - "Community 10"
Cohesion: 0.31
Nodes (10): handlePrintLabels(), handlePrintCurrentLabel(), buildLabelPreviewMarkup(), buildQrSvgMarkup(), createBarcodePrintDocument(), createLabelMarkup(), escapeHtml(), getLabelNameSizeClass() (+2 more)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `normalizeUserFacingText()` connect `Community 8` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 10`?**
  _High betweenness centrality (0.198) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 2` to `Community 0`, `Community 1`, `Community 3`, `Community 5`, `Community 6`, `Community 7`, `Community 10`?**
  _High betweenness centrality (0.116) - this node is a cross-community bridge._
- **Why does `normalizeOperationalVehicleType()` connect `Community 5` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 7`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Are the 53 inferred relationships involving `showToast()` (e.g. with `blockPaymentProgressIfHasDivergences()` and `handleAddManualDraftItem()`) actually correct?**
  _`showToast()` has 53 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `normalizeOperationalVehicleType()` (e.g. with `normalizeInventoryItemRecord()` and `normalizePurchaseType()`) actually correct?**
  _`normalizeOperationalVehicleType()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `getVehicleTypeFromModel()` (e.g. with `normalizeInventoryItemRecord()` and `getEffectivePurchaseType()`) actually correct?**
  _`getVehicleTypeFromModel()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `decodeFileCode()` (e.g. with `handlePhotoRead()` and `readSkuFromPhoto()`) actually correct?**
  _`decodeFileCode()` has 4 INFERRED edges - model-reasoned connections that need verification._