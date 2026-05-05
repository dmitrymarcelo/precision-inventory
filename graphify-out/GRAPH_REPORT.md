# Graph Report - Sistema inventario  (2026-05-05)

## Corpus Check
- 37 files · ~106,923 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 475 nodes · 1106 edges · 10 communities detected
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 150 edges (avg confidence: 0.8)
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

## God Nodes (most connected - your core abstractions)
1. `showToast()` - 70 edges
2. `normalizeUserFacingText()` - 26 edges
3. `normalizeOperationalVehicleType()` - 19 edges
4. `getVehicleTypeFromModel()` - 17 edges
5. `decodeFileCode()` - 13 edges
6. `normalizeLocationText()` - 13 edges
7. `flushOutbox()` - 12 edges
8. `calculateItemStatus()` - 12 edges
9. `normalizeUserFacingText()` - 12 edges
10. `syncUrl()` - 11 edges

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
Nodes (61): bootScanner(), closeScanner(), finalizeRequest(), handleDetectedCode(), handlePhotoRead(), handleResolvedScan(), lockScannerBriefly(), normalizeLocationText() (+53 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (49): applyManualSeparatedChange(), addItemToDraft(), addKitToDraft(), addSelectedPickerItems(), appendAuditEntry(), applyDetectedSku(), clearDraftForNextRequest(), closeSkuScanner() (+41 more)

### Community 3 - "Community 3"
Cohesion: 0.08
Nodes (44): handleAddManualDraftItem(), reverseSelectedRequest(), openCreateItem(), appendSyncEvent(), applyCloudStateIfNewer(), applyCloudUpdateNow(), clearOutbox(), flushOutbox() (+36 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (35): handleExportCsv(), handleFileUpload(), handleFilterClick(), handleOpenLabels(), handlePrintLabels(), commitEdit(), ensureEditableCatalog(), normalizeSku() (+27 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (35): base64Decode(), bytesToHex(), concatBytes(), createUser(), decodeSalt(), ensureAuthSchema(), generateId(), generateToken() (+27 more)

### Community 6 - "Community 6"
Cohesion: 0.13
Nodes (19): getEffectiveVehicleType(), getEffectiveVehicleType(), getEffectiveVehicleType(), openTypeModelPicker(), handleCreateItem(), getEffectiveVehicleModel(), getEffectiveVehicleType(), normalizeUserFacingText() (+11 more)

### Community 7 - "Community 7"
Cohesion: 0.17
Nodes (21): chooseNewerRecord(), collectNewDivergenceLogs(), ensureSchema(), mergeAliases(), mergeAuditTrail(), mergeItemsBySku(), mergeLogsById(), mergeMaterialRequest() (+13 more)

### Community 8 - "Community 8"
Cohesion: 0.17
Nodes (15): buildSuggestionReason(), openNextPending(), openNextRecount(), getAbcAnalysisForSku(), getAbcClassPriority(), getAbcSortRank(), getAbcStockPolicy(), getAdaptiveAbcStockPolicy() (+7 more)

### Community 9 - "Community 9"
Cohesion: 0.15
Nodes (18): handleChangeRole(), handleCreate(), handleResetPassword(), handleSaveEdit(), handleToggleActive(), handleVehicleImport(), loadUsers(), countDelimiter() (+10 more)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `normalizeUserFacingText()` connect `Community 4` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 6`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.207) - this node is a cross-community bridge._
- **Why does `showToast()` connect `Community 3` to `Community 0`, `Community 1`, `Community 2`, `Community 4`, `Community 6`, `Community 8`, `Community 9`?**
  _High betweenness centrality (0.119) - this node is a cross-community bridge._
- **Why does `normalizeOperationalVehicleType()` connect `Community 6` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 8`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Are the 57 inferred relationships involving `showToast()` (e.g. with `blockPaymentProgressIfHasDivergences()` and `handleAddManualDraftItem()`) actually correct?**
  _`showToast()` has 57 INFERRED edges - model-reasoned connections that need verification._
- **Are the 9 inferred relationships involving `normalizeOperationalVehicleType()` (e.g. with `normalizeInventoryItemRecord()` and `normalizePurchaseType()`) actually correct?**
  _`normalizeOperationalVehicleType()` has 9 INFERRED edges - model-reasoned connections that need verification._
- **Are the 6 inferred relationships involving `getVehicleTypeFromModel()` (e.g. with `normalizeInventoryItemRecord()` and `getEffectivePurchaseType()`) actually correct?**
  _`getVehicleTypeFromModel()` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Are the 4 inferred relationships involving `decodeFileCode()` (e.g. with `handlePhotoRead()` and `readSkuFromPhoto()`) actually correct?**
  _`decodeFileCode()` has 4 INFERRED edges - model-reasoned connections that need verification._