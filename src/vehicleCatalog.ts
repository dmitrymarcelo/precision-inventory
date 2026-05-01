import { normalizeUserFacingText } from './textUtils';

export const EXTRA_OPERATIONAL_VEHICLE_TYPES = ['FUNILARIA E PINTURA', 'BATERIA', 'ADITIVOS'];

export interface VehicleCatalogEntry {
  model: string;
  type: string;
  aliases: string[];
}

export const vehicleCatalog: VehicleCatalogEntry[] = [
  { model: '11.180 DRC 4X2', type: 'CAMINH\u00c3O', aliases: ['11.180 DRC 4X2', '11180 DRC 4X2', 'VW 11.180 DRC 4X2'] },
  { model: '115 HP', type: 'LANCHA', aliases: ['115 HP'] },
  { model: '40 HP', type: 'LANCHA', aliases: ['40 HP'] },
  { model: '13.190 WORKER (NV)', type: 'CAMINH\u00c3O', aliases: ['13.190 WORKER', '13190 WORKER', 'WORKER NV'] },
  { model: '17.190 CRM 4X2 4P', type: 'CAMINH\u00c3O', aliases: ['17.190 CRM 4X2 4P', '17190 CRM 4X2 4P', '17.190 CRM'] },
  { model: '24.280 CRM 6X2', type: 'CAMINH\u00c3O', aliases: ['24.280 CRM 6X2', '24280 CRM 6X2', '24.280 CRM'] },
  { model: '9.170 DRC 4X2', type: 'CAMINH\u00c3O', aliases: ['9.170 DRC 4X2', '9170 DRC 4X2'] },
  { model: '90 HP', type: 'LANCHA', aliases: ['90 HP'] },
  { model: 'ACCELO 1417CE (EURO6)', type: 'CAMINH\u00c3O', aliases: ['ACCELO 1417CE', '1417CE EURO6', 'ACCELO 1417 CE'] },
  { model: 'ACCELO 815', type: 'CAMINH\u00c3O', aliases: ['ACCELO 815'] },
  { model: 'ACCELO 817 CE', type: 'CAMINH\u00c3O', aliases: ['ACCELO 817 CE', 'ACCELO 817CE'] },
  { model: 'ATEGO 1419', type: 'CAMINH\u00c3O', aliases: ['ATEGO 1419'] },
  { model: 'BC 1000XL', type: 'EQUIPAMENTO', aliases: ['BC 1000XL', 'BC1000XL'] },
  { model: 'FH540', type: 'CAMINH\u00c3O', aliases: ['FH540', 'FH 540'] },
  { model: 'GOL 1.6L MB5', type: 'VW', aliases: ['GOL 1.6L MB5', 'GOL 1.6 MB5'] },
  { model: 'I/M. BENZ 516 CDI SPRINTER C', type: 'CAMINH\u00c3O', aliases: ['516 CDI SPRINTER', 'BENZ 516 CDI SPRINTER', 'SPRINTER 516 CDI'] },
  { model: 'I/M.BENZ 416 CDI SPRINTER C', type: 'CAMINH\u00c3O', aliases: ['416 CDI SPRINTER', 'BENZ 416 CDI SPRINTER', 'SPRINTER 416 CDI'] },
  { model: 'L200 TRITON', type: 'MITSUBISHI', aliases: ['L200 TRITON'] },
  { model: 'LIPPEL PTU 300', type: 'EQUIPAMENTO', aliases: ['LIPPEL PTU 300', 'PTU 300'] },
  { model: 'MOBI LIKE', type: 'FIAT', aliases: ['MOBI LIKE'] },
  { model: 'NOVA SAVEIRO RB MBVS', type: 'VW', aliases: ['NOVA SAVEIRO RB MBVS', 'SAVEIRO RB MBVS', 'SAVEIRO RB'] },
  { model: 'NRX 160 BROS ABS', type: 'MOTO', aliases: ['NRX 160 BROS ABS', 'BROS 160 ABS', 'BROS ABS'] },
  { model: 'PALIO FIRE', type: 'FIAT', aliases: ['PALIO FIRE'] },
  { model: 'RANGER XL 13P', type: 'FORD', aliases: ['RANGER XL 13P', 'RANGER XL'] },
  { model: 'S10 LS DD4', type: 'CHEVROLET', aliases: ['S10 LS DD4', 'S10 LS'] },
  { model: 'STRADA ENDURANCE CS', type: 'FIAT', aliases: ['STRADA ENDURANCE CS', 'STRADA ENDURANCE'] },
  { model: 'TOYOTA HILUX CD4X4 STD', type: 'TOYOTA', aliases: ['TOYOTA HILUX CD4X4 STD', 'HILUX CD4X4 STD', 'HILUX CD 4X4 STD'] },
  { model: 'UNO ATTRACTIVE 1.0', type: 'FIAT', aliases: ['UNO ATTRACTIVE 1.0', 'UNO ATTRACTIVE'] },
  { model: 'VW 6.160 DRC 4X2', type: 'CAMINH\u00c3O', aliases: ['VW 6.160 DRC 4X2', '6.160 DRC 4X2', '6160 DRC 4X2'] },
  { model: 'VW KOMBI', type: 'VW', aliases: ['VW KOMBI', 'KOMBI'] }
];

export function normalizeComparableVehicleText(value: unknown) {
  return normalizeUserFacingText(value)
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findVehicleCatalogEntry(value: unknown) {
  const normalizedText = normalizeComparableVehicleText(value);
  if (!normalizedText) return null;

  const exact = vehicleCatalog.find(entry => normalizeComparableVehicleText(entry.model) === normalizedText);
  if (exact) return exact;

  return vehicleCatalog.find(entry =>
    entry.aliases.some(alias => normalizedText.includes(normalizeComparableVehicleText(alias)))
  ) || null;
}

export function normalizeOfficialVehicleModel(value: unknown) {
  const match = findVehicleCatalogEntry(value);
  return match?.model || normalizeUserFacingText(value);
}

export function getVehicleTypeFromModel(value: unknown) {
  return normalizeOperationalVehicleType(findVehicleCatalogEntry(value)?.type || '');
}

export function listOfficialVehicleModels() {
  return vehicleCatalog.map(entry => entry.model);
}

export function listVehicleTypes() {
  return Array.from(
    new Set([
      ...vehicleCatalog.map(entry => normalizeOperationalVehicleType(entry.type)),
      ...EXTRA_OPERATIONAL_VEHICLE_TYPES
    ])
  ).sort((first, second) =>
    first.localeCompare(second, 'pt-BR')
  );
}

export function listVehicleCatalogByType() {
  return listVehicleTypes().map(type => ({
    type,
    entries: vehicleCatalog.filter(entry => normalizeOperationalVehicleType(entry.type) === type)
  }));
}

export function normalizeOperationalVehicleType(value: unknown) {
  const normalized = normalizeUserFacingText(value);
  const comparable = normalized
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (comparable === 'OLEO') return '';
  if (normalized === 'VW') return 'SAVEIRO/GOL';
  if (normalized === 'CHEVROLET') return 'S-10';
  return normalized;
}
