import assert from 'node:assert/strict';
const moduleUrl = new URL('../src/cyclicInventory.ts', import.meta.url).href;
const {
  buildDailyCycleRows,
  getCalendarDayKey,
  getLatestOperationalLogBySku,
  isOperationalInventoryLog
} = await import(moduleUrl);

const candidates = ['100', '101', '102', '103', '104', '105'].map((sku, index) => ({
  item: { sku, name: `ITEM ${sku}` },
  countedToday: index === 5,
  needsRecount: false,
  cycleWeight: index === 0 ? 3 : 1
}));

const selected = buildDailyCycleRows(candidates, { count: 5, dayKey: '2026-05-20' });
assert.equal(selected.length, 5, 'seleciona 5 itens quando ha candidatos suficientes');
assert.equal(selected.some(row => row.item.sku === '105'), false, 'quando ha 5 pendentes, nao deve preencher com item ja contado');

const scarcePending = candidates.map((row, index) => ({
  ...row,
  countedToday: index > 1
}));
const filled = buildDailyCycleRows(scarcePending, { count: 5, dayKey: '2026-05-20' });
assert.equal(filled.length, 5, 'preenche com ja contados quando ha menos de 5 pendentes');
assert.equal(filled.filter(row => !row.countedToday).length, 2, 'preserva todos os pendentes existentes');

assert.equal(getCalendarDayKey(new Date('2026-05-20T04:30:00.000Z'), 'America/Manaus'), '2026-05-20');
assert.equal(getCalendarDayKey(new Date('2026-05-20T03:30:00.000Z'), 'America/Manaus'), '2026-05-19');

assert.equal(isOperationalInventoryLog({ source: 'ajuste' }), true, 'ajuste conta como inventario operacional');
assert.equal(isOperationalInventoryLog({ source: 'divergencia' }), true, 'divergencia conta como inventario operacional');
assert.equal(isOperationalInventoryLog({ source: 'solicitacao' }), false, 'saida por solicitacao nao conta como contagem');
assert.equal(isOperationalInventoryLog({ referenceCode: 'SOL-123' }), false, 'log vinculado a pedido nao conta como contagem');

const latestBySku = getLatestOperationalLogBySku(
  [
    { sku: '100', date: '2026-05-20T12:00:00.000Z', source: 'solicitacao' },
    { sku: '100', date: '2026-05-20T13:00:00.000Z', source: 'ajuste' },
    { sku: '100', date: '2026-05-20T14:00:00.000Z', source: 'recebimento' },
    { sku: '101', date: '2026-05-19T23:30:00.000Z', source: 'ajuste' }
  ],
  new Date('2026-05-20T15:00:00.000Z'),
  'America/Manaus'
);

assert.equal(latestBySku.get('100')?.date, '2026-05-20T13:00:00.000Z');
assert.equal(latestBySku.has('101'), false, 'log do dia anterior em Manaus nao entra');

console.log('cyclic inventory rules passed');
