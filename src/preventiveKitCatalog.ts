import type { InventorySettings, PreventiveKitDefinition } from './types';

export const preventiveKitCatalog: PreventiveKitDefinition[] = [
  {
    id: 'saveiro',
    name: 'SAVEIRO',
    items: [
      { sku: '17251', description: 'FILTRO COMBUSTIVEL', requiredQuantity: 1 },
      { sku: '17253', description: 'FILTRO DE AR CONDICIONADO (CABINE)', requiredQuantity: 1 },
      { sku: '17255', description: 'FILTRO DE AR MOTOR', requiredQuantity: 1 },
      { sku: '17257', description: 'FILTRO DE OLEO LUBRIF.', requiredQuantity: 1 },
      { sku: '66640', description: 'OLEO 10W40 - TAMBOR', requiredQuantity: 4 }
    ]
  },
  {
    id: 'strada-mobi',
    name: 'STRADA/MOBI',
    items: [
      { sku: '19479', description: 'FILTRO DE AR MOTOR', requiredQuantity: 1 },
      { sku: '17261', description: 'FILTRO DE AR CONDICIONADO (CABINE)', requiredQuantity: 1 },
      { sku: '19477', description: 'FILTRO DE COMBUSTIVEL', requiredQuantity: 1 },
      { sku: '19476', description: 'FILTRO DE OLEO', requiredQuantity: 1 },
      { sku: '55998', description: 'OLEO 5W30 - TAMBOR', requiredQuantity: 3 }
    ]
  },
  {
    id: 'ranger',
    name: 'RANGER',
    items: [
      { sku: '55996', description: 'FILTRO COMBUSTIVEL', requiredQuantity: 1 },
      { sku: '54492', description: 'FILTRO DE AR CONDICIONADO (CABINE)', requiredQuantity: 1 },
      { sku: '50321', description: 'FILTRO AR DO MOTOR', requiredQuantity: 1 },
      { sku: '50323', description: 'FILTRO DE OLEO', requiredQuantity: 1 },
      { sku: '55998', description: 'OLEO 5W30 - TAMBOR', requiredQuantity: 8 }
    ]
  },
  {
    id: 'hilux',
    name: 'HILUX',
    items: [
      { sku: '21301', description: 'FILTRO AR MOTOR', requiredQuantity: 1 },
      { sku: '21302', description: 'FILTRO DE OLEO', requiredQuantity: 1 },
      { sku: '21305', description: 'FILTRO DE COMBUSTIVEL', requiredQuantity: 1 },
      { sku: '21307', description: 'FILTRO DE AR CONDICIONADO (CABINE)', requiredQuantity: 1 },
      { sku: '55998', description: 'OLEO 5W30 - TAMBOR', requiredQuantity: 8 }
    ]
  },
  {
    id: 's10',
    name: 'S10',
    items: [
      { sku: '06682', description: 'FILTRO DE AR CONDICIONADO (CABINE)', requiredQuantity: 1 },
      { sku: '17297', description: 'FILTRO DE AR MOTOR', requiredQuantity: 1 },
      { sku: '17233', description: 'FILTRO DE COMBUSTIVEL', requiredQuantity: 2 },
      { sku: '06694', description: 'FILTRO DE OLEO', requiredQuantity: 1 },
      { sku: '55998', description: 'OLEO 5W30 - TAMBOR', requiredQuantity: 6 }
    ]
  },
  {
    id: 'gol',
    name: 'GOL',
    items: [
      { sku: '17251', description: 'FILTRO COMBUSTIVEL', requiredQuantity: 1 },
      { sku: '17253', description: 'FILTRO DE AR CONDICIONADO (CABINE)', requiredQuantity: 1 },
      { sku: '54111', description: 'FILTRO DE AR MOTOR-TR\u00caS CILINDRO', requiredQuantity: 1 },
      { sku: '17257', description: 'FILTRO DE OLEO LUBRIF.', requiredQuantity: 1 },
      { sku: '66640', description: 'OLEO 10W40 - TAMBOR', requiredQuantity: 4 }
    ]
  },
  {
    id: 'moto',
    name: 'MOTO',
    items: [
      { sku: '18002', description: 'FILTRO COMBUSTIVEL GI80 HONDA NXR BROS', requiredQuantity: 1 },
      { sku: '17902', description: 'OLEO 20W50 MOTO - LITRO', requiredQuantity: 1 }
    ]
  },
  {
    id: 'lancha-40hp',
    name: 'LANCHA 40HP',
    items: [
      { sku: '52502', description: '\u00d3LEO DA RABETA 90 TRANS.', requiredQuantity: 1 },
      { sku: '52514', description: 'FILTRO DE COMBUSTIVEL 40HP', requiredQuantity: 1 },
      { sku: '52508', description: 'JUNTA DO PARAFUSO 40HP/90HP', requiredQuantity: 2 },
      { sku: '52516', description: 'VELA IGNI\u00c7\u00c3O 40HP', requiredQuantity: 2 },
      { sku: '52518', description: 'ROTOR DA BOMBAD\'AGUA 40HP', requiredQuantity: 1 }
    ]
  },
  {
    id: 'lancha-90hp-115hp',
    name: 'LANCHA 90HP / 115HP',
    items: [
      { sku: '52502', description: '\u00d3LEO DA RABETA 920 TRANSM.', requiredQuantity: 1 },
      { sku: '55299', description: 'OLEO 20W50', requiredQuantity: 4 },
      { sku: '17257', description: 'FILTRO DE OLEO', requiredQuantity: 1 },
      { sku: '17251', description: 'FILTRO COMBUSTIVEL', requiredQuantity: 1 },
      { sku: '52508', description: 'JUNTA DO PARAFUSO', requiredQuantity: 2 },
      { sku: '52510', description: 'VELA IGNI\u00c7\u00c3O 90-115HP', requiredQuantity: 1 },
      { sku: '52512', description: 'ROTOR DA BOMBA D\'AGUA 90-115HP', requiredQuantity: 1 }
    ]
  }
];

export function resolvePreventiveKitCatalog(settings?: InventorySettings | null) {
  const custom = settings?.preventiveKits;
  return Array.isArray(custom) && custom.length > 0 ? custom : preventiveKitCatalog;
}
