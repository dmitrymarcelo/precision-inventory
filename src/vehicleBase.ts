import { VehicleRecord } from './types';
import { normalizeUserFacingText } from './textUtils';
import {
  listOfficialVehicleModels,
  normalizeOfficialVehicleModel
} from './vehicleCatalog';

const plateHeaders = [
  'placa',
  'placa veiculo',
  'placa do veiculo',
  'veiculo',
  'frota',
  'cod_placa',
  'placa_veiculo'
];

const costCenterHeaders = [
  'centro_custo',
  'centro de custo',
  'centro custo',
  'cost center',
  'ccusto',
  'cod_centro_custo'
];

const descriptionHeaders = [
  'marca_modelo',
  'des_mod_veic',
  'descricao',
  'modelo',
  'veiculo descricao',
  'equipamento',
  'des_mrc_veic',
  'tipo_veiculo'
];

export function sanitizeVehicles(input: unknown): VehicleRecord[] {
  if (!Array.isArray(input)) return [];

  return input
    .map(value => sanitizeVehicleRecord(value))
    .filter((value): value is VehicleRecord => Boolean(value))
    .sort((first, second) => first.plate.localeCompare(second.plate));
}

export function normalizePlate(value: string) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function findVehicleByPlate(vehicles: VehicleRecord[], plate: string) {
  const normalizedPlate = normalizePlate(plate);
  return vehicles.find(vehicle => normalizePlate(vehicle.plate) === normalizedPlate) || null;
}

export function getVehicleModelName(vehicle: VehicleRecord) {
  return normalizeOfficialVehicleModel(
    vehicle.description ||
    vehicle.details.Modelo ||
    vehicle.details['Marca Modelo'] ||
    vehicle.details.Descricao ||
    vehicle.details['Tipo Veiculo'] ||
    vehicle.details['Veiculo Descricao'] ||
    vehicle.details.Equipamento
  );
}

export function listVehicleModels(vehicles: VehicleRecord[]) {
  const officialVehicleModels = listOfficialVehicleModels();
  const recognized = new Set(
    vehicles
      .map(vehicle => getVehicleModelName(vehicle))
      .filter((value): value is string => Boolean(value))
  );

  if (!recognized.size) {
    return [...officialVehicleModels];
  }

  return officialVehicleModels.filter(model => recognized.has(model));
}

export function parseVehicleRows(rows: unknown[][]) {
  const headerIndex = rows.findIndex(row => {
    const headers = row.map(normalizeHeader);
    return headers.some(header => plateHeaders.includes(header)) &&
      headers.some(header => costCenterHeaders.includes(header));
  });

  if (headerIndex < 0) {
    throw new Error('Não encontrei as colunas de placa e centro de custo nessa base.');
  }

  const headers = rows[headerIndex].map(normalizeHeader);
  const plateIndex = findColumn(headers, plateHeaders);
  const costCenterIndex = findColumn(headers, costCenterHeaders);
  const descriptionIndex = findOptionalColumn(headers, descriptionHeaders);

  return rows
    .slice(headerIndex + 1)
    .map<VehicleRecord | null>((row, rowIndex) => {
      const plate = toText(row[plateIndex]).toUpperCase();
      const costCenter = normalizeUserFacingText(row[costCenterIndex]);
      const description = descriptionIndex >= 0 ? normalizeUserFacingText(row[descriptionIndex]) : '';

      if (!plate || !costCenter) return null;

      const details = headers.reduce<Record<string, string>>((acc, header, index) => {
        if (index === plateIndex || index === costCenterIndex || !header) return acc;
        const value = toText(row[index]);
        if (value) {
          acc[humanizeHeader(header)] = normalizeUserFacingText(value);
        }
        return acc;
      }, {});

      return {
        id: `${normalizePlate(plate)}-${rowIndex}-${Math.random().toString(36).slice(2, 6)}`,
        plate,
        costCenter,
        description: description || getVehicleModelName({ id: '', plate, costCenter, description: '', details }),
        details
      };
    })
    .filter((vehicle): vehicle is VehicleRecord => Boolean(vehicle));
}

export async function readCsvRows(file: File) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const text = utf8.includes('\uFFFD') ? new TextDecoder('windows-1252').decode(buffer) : utf8;

  const lines = text
    .split(/\r?\n/)
    .filter(line => line.trim());

  const delimiter = detectDelimiter(lines[0] || '');
  return lines.map(line => parseDelimitedLine(line, delimiter));
}

function sanitizeVehicleRecord(value: unknown): VehicleRecord | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<VehicleRecord>;
  const plate = String(candidate.plate || '').trim().toUpperCase();
  const costCenter = normalizeUserFacingText(candidate.costCenter || '');
  if (!plate || !costCenter) return null;

  return {
    id: String(candidate.id || `${normalizePlate(plate)}-${Math.random().toString(36).slice(2, 6)}`),
    plate,
    costCenter,
    description: candidate.description ? normalizeUserFacingText(candidate.description) : '',
    details: candidate.details && typeof candidate.details === 'object'
      ? Object.fromEntries(
          Object.entries(candidate.details).map(([key, detailValue]) => [
            normalizeUserFacingText(key),
            normalizeUserFacingText(detailValue)
          ])
        )
      : {}
  };
}

function normalizeHeader(value: unknown) {
  return toText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function humanizeHeader(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .split(' ')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function findColumn(headers: string[], names: string[]) {
  const index = names.reduce<number>((foundIndex, name) => {
    if (foundIndex >= 0) return foundIndex;
    return headers.indexOf(name);
  }, -1);

  if (index < 0) {
    throw new Error(`Coluna obrigatória ausente: ${names.join(', ')}`);
  }
  return index;
}

function findOptionalColumn(headers: string[], names: string[]) {
  return names.reduce<number>((foundIndex, name) => {
    if (foundIndex >= 0) return foundIndex;
    return headers.indexOf(name);
  }, -1);
}

function toText(value: unknown) {
  if (value === null || value === undefined) return '';

  let text = String(value).replace(/^\uFEFF/, '').trim();
  if (!text) return '';

  for (let index = 0; index < 3; index += 1) {
    const formulaMatch = text.match(/^=(?:"([\s\S]*)"|'([\s\S]*)')$/);
    if (formulaMatch) {
      text = (formulaMatch[1] ?? formulaMatch[2] ?? '').trim();
      continue;
    }

    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      text = text.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return text.replace(/""/g, '"').trim();
}

function detectDelimiter(line: string) {
  const semicolons = countDelimiter(line, ';');
  const commas = countDelimiter(line, ',');
  return semicolons >= commas ? ';' : ',';
}

function countDelimiter(line: string, delimiter: string) {
  let total = 0;
  let insideQuotes = false;

  for (const char of line) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (!insideQuotes && char === delimiter) {
      total += 1;
    }
  }

  return total;
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        current += '"';
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (!insideQuotes && char === delimiter) {
      cells.push(toText(current));
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(toText(current));
  return cells;
}
