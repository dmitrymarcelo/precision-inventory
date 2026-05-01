import { InventoryItem } from './types';

const FALLBACK_LOCATION = 'Sem localização';
const CRITICAL_STATUS = 'Estoque Crítico';
const HEALTHY_STATUS = 'Estoque Saudável';

const EXACT_WORD_REPAIRS = new Map<string, string>([
  ['NAO', 'não'],
  ['LOCALIZACAO', 'localização'],
  ['REPOSICAO', 'reposição'],
  ['OLEO', 'óleo'],
  ['HIDRAULICA', 'hidráulica'],
  ['HIDRAULICO', 'hidráulico'],
  ['TRANSMISSAO', 'transmissão'],
  ['TUBARAO', 'tubarão'],
  ['ILUMINACAO', 'iluminação'],
  ['DIRECAO', 'direção'],
  ['SUSPENSAO', 'suspensão'],
  ['MAO', 'mão'],
  ['CONEXAO', 'conexão'],
  ['TRACAO', 'tração'],
  ['PISTAO', 'pistão'],
  ['ARTICULACAO', 'articulação'],
  ['PROTECAO', 'proteção'],
  ['VEDACAO', 'vedação'],
  ['VALVULA', 'válvula'],
  ['SEGURANCA', 'segurança'],
  ['IGNICAO', 'ignição'],
  ['EXTENSAO', 'extensão'],
  ['FLEXIVEL', 'flexível'],
  ['SUCCAO', 'sucção'],
  ['ELETRICA', 'elétrica'],
  ['ELETRICO', 'elétrico'],
  ['MECANICA', 'mecânica'],
  ['MODULO', 'módulo'],
  ['LAMPADA', 'lâmpada'],
  ['CAMINHAO', 'caminhão'],
  ['BOTAO', 'botão'],
  ['PINGAO', 'pingão'],
  ['GRAO', 'grão'],
  ['PRECISAO', 'precisão'],
  ['SOLUCAO', 'solução'],
  ['REVISAO', 'revisão'],
  ['REMOCAO', 'remoção'],
  ['BRACO', 'braço'],
  ['BRAAO', 'braço'],
  ['GUARNICAO', 'guarnição'],
  ['REFRIGERACAO', 'refrigeração'],
  ['LIGACAO', 'ligação'],
  ['FIXACAO', 'fixação'],
  ['IDENTIFICACAO', 'identificação'],
  ['REDUCAO', 'redução'],
  ['ALGODAO', 'algodão'],
  ['BLUSAO', 'blusão'],
  ['CARVAO', 'carvão'],
  ['PINHAO', 'pinhão'],
  ['ACAO', 'ação']
]);

const PHRASE_REPAIRS = [
  { pattern: /\bL(?:Ã|\uFFFD|A)\s+CARNEIRO\b/gi, replacement: 'lã carneiro' }
];

export function normalizeUserFacingText(value: unknown) {
  if (value === null || value === undefined) return '';

  let text = String(value).replace(/^\uFEFF/, '').trim();
  if (!text) return '';

  text = decodeLiteralUnicode(text);
  text = fixCommonMojibake(text);
  text = applyCommonTextFixes(text);

  return text.normalize('NFC').trim();
}

export function normalizeLocationText(value: unknown) {
  const text = normalizeUserFacingText(value);
  if (!text) return FALLBACK_LOCATION;

  if (/^sem\s+loca.{0,4}o$/i.test(text) || /^sem\s+localiza/i.test(text)) {
    return FALLBACK_LOCATION;
  }

  return text;
}

export function normalizeInventoryStatus(value: unknown): InventoryItem['status'] {
  const text = normalizeUserFacingText(value).toLowerCase();

  if (text.includes('crítico') || text.includes('critico')) {
    return CRITICAL_STATUS;
  }

  if (text.includes('repor') || text.includes('repos')) {
    return 'Repor em Breve';
  }

  return HEALTHY_STATUS;
}

function decodeLiteralUnicode(text: string) {
  let next = text;

  for (let index = 0; index < 3; index += 1) {
    const decoded = next
      .replace(/\\\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));

    if (decoded === next) {
      return decoded;
    }

    next = decoded;
  }

  return next;
}

function fixCommonMojibake(text: string) {
  if (!looksLikeMojibake(text)) return text;

  try {
    const bytes = Uint8Array.from(Array.from(text).map(character => character.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return suspiciousScore(decoded) <= suspiciousScore(text) ? decoded : text;
  } catch {
    return text;
  }
}

function looksLikeMojibake(text: string) {
  return /Ã[\u0080-\u00BF\u00D0-\u00FF]|Â[\u0080-\u00BF\u00D0-\u00FF]|Ãƒ|Ã‚|ï¿½|â€¢|â€“|â€”|â€œ|â€|\\u00/.test(text);
}

function suspiciousScore(text: string) {
  return (
    text.match(
      /[\u00C3\u00C2\u00EF\u00BF\u00BD]|\u00E2\u20AC\u00A2|\u00E2\u20AC\u201C|\u00E2\u20AC\u201D|\u00E2\u20AC\u0153|\u00E2\u20AC|\\u00/g
    ) || []
  ).length;
}

function applyCommonTextFixes(text: string) {
  let next = text
    .replace(/\s*[\u0000-\u001F\u007F]+\s*/g, ' - ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\s{2,}/g, ' ');

  for (const repair of PHRASE_REPAIRS) {
    next = next.replace(repair.pattern, match => applyReplacementCase(match, repair.replacement));
  }

  next = next.replace(/[\p{L}\uFFFD]+/gu, maybeRepairWord);

  return next
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+-\s+/g, ' - ')
    .trim();
}

function maybeRepairWord(word: string) {
  const key = canonicalizeWord(word);
  if (!key) return word;

  const exactMatch = EXACT_WORD_REPAIRS.get(key);
  if (exactMatch) {
    return applyReplacementCase(word, exactMatch);
  }

  if (!isSuspiciousWord(word) || key.length < 3) {
    return word;
  }

  const fuzzyMatch = findClosestRepair(key, word);
  if (!fuzzyMatch) {
    return word;
  }

  return applyReplacementCase(word, fuzzyMatch);
}

function canonicalizeWord(word: string) {
  return word
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
}

function isSuspiciousWord(word: string) {
  return /[\uFFFD\u00C3\u00C2]/.test(word);
}

function findClosestRepair(key: string, originalWord: string) {
  const replacementChars = (originalWord.match(/\uFFFD/g) || []).length;
  const maxDistance = replacementChars > 0 ? Math.min(2, replacementChars + 1) : 1;

  let bestValue = '';
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [candidateKey, candidateValue] of EXACT_WORD_REPAIRS.entries()) {
    if (Math.abs(candidateKey.length - key.length) > maxDistance) continue;

    const distance = levenshteinDistance(key, candidateKey);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestValue = candidateValue;
    }
  }

  return bestDistance <= maxDistance ? bestValue : '';
}

function levenshteinDistance(source: string, target: string) {
  if (source === target) return 0;
  if (!source.length) return target.length;
  if (!target.length) return source.length;

  const matrix = Array.from({ length: source.length + 1 }, () => new Array<number>(target.length + 1).fill(0));

  for (let row = 0; row <= source.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= target.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= source.length; row += 1) {
    for (let column = 1; column <= target.length; column += 1) {
      const substitutionCost = source[row - 1] === target[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );
    }
  }

  return matrix[source.length][target.length];
}

function applyReplacementCase(original: string, replacement: string) {
  if (original === original.toLocaleUpperCase('pt-BR')) {
    return replacement.toLocaleUpperCase('pt-BR');
  }

  if (original === original.toLocaleLowerCase('pt-BR')) {
    return replacement.toLocaleLowerCase('pt-BR');
  }

  const lowerOriginal = original.toLocaleLowerCase('pt-BR');
  const capitalizedOriginal =
    original.charAt(0) === original.charAt(0).toLocaleUpperCase('pt-BR') &&
    original.slice(1) === lowerOriginal.slice(1);

  if (capitalizedOriginal) {
    const lowerReplacement = replacement.toLocaleLowerCase('pt-BR');
    return `${lowerReplacement.charAt(0).toLocaleUpperCase('pt-BR')}${lowerReplacement.slice(1)}`;
  }

  return replacement;
}
