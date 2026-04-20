import { InventoryItem } from './types';

const FALLBACK_LOCATION = 'Sem localiza\u00e7\u00e3o';
const CRITICAL_STATUS = 'Estoque Cr\u00edtico';
const HEALTHY_STATUS = 'Estoque Saud\u00e1vel';

export function normalizeUserFacingText(value: unknown) {
  if (value === null || value === undefined) return '';

  let text = String(value).replace(/^\uFEFF/, '').trim();
  if (!text) return '';

  text = decodeLiteralUnicode(text);
  text = fixCommonMojibake(text);
  text = applyCommonTextFixes(text);

  return text.trim();
}

export function normalizeLocationText(value: unknown) {
  const text = normalizeUserFacingText(value);
  if (!text) return FALLBACK_LOCATION;

  if (/^sem\s+loca.{0,4}o$/i.test(text) || /^sem\s+localiza/i.test(text)) {
    return FALLBACK_LOCATION;
  }

  if (/^armaz[e\u00e9]m\s+\d+$/i.test(text)) {
    return FALLBACK_LOCATION;
  }

  const cleaned = text.replace(/^armaz[e\u00e9]m\s+\d+\s*-\s*/i, '').trim();
  return cleaned || FALLBACK_LOCATION;
}

export function normalizeInventoryStatus(value: unknown): InventoryItem['status'] {
  const text = normalizeUserFacingText(value).toLowerCase();

  if (text.includes('cr\u00edtico') || text.includes('critico')) {
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
  if (!/[\u00c3\u00c2]/.test(text)) return text;

  try {
    const bytes = Uint8Array.from(Array.from(text).map(character => character.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8').decode(bytes);
    return suspiciousScore(decoded) <= suspiciousScore(text) ? decoded : text;
  } catch {
    return text;
  }
}

function suspiciousScore(text: string) {
  return (
    text.match(
      /[\u00c3\u00c2\u00ef\u00bf\u00bd]|\u00e2\u20ac\u00a2|\u00e2\u20ac\u201c|\u00e2\u20ac\u201d|\u00e2\u20ac\u0153|\u00e2\u20ac|\\u00/g
    ) || []
  ).length;
}

function applyCommonTextFixes(text: string) {
  return text
    .replace(/\bSem Loca..o\b/gi, FALLBACK_LOCATION)
    .replace(/\bSem loca..o\b/gi, FALLBACK_LOCATION)
    .replace(/\bNao\b/g, 'N\u00e3o')
    .replace(/\bLocalizacao\b/g, 'Localiza\u00e7\u00e3o')
    .replace(/\bReposicao\b/g, 'Reposi\u00e7\u00e3o')
    .replace(/\bOLEO\b/gi, 'ÓLEO')
    .replace(/\bHIDRAULICA\b/gi, 'HIDRÁULICA')
    .replace(/\bHIDRAULICO\b/gi, 'HIDRÁULICO')
    .replace(/\bTRANSMISSAO\b/gi, 'TRANSMISSÃO')
    .replace(/\bTRANSMISS[ÃA�]{0,4}O\b/gi, 'TRANSMISSÃO')
    .replace(/\bTRANSMISS\uFFFD+O\b/gi, 'TRANSMISSÃO')
    .replace(/\bTUBARAO\b/gi, 'TUBARÃO')
    .replace(/\bTUBAR[ÃA�]{0,3}O\b/gi, 'TUBARÃO')
    .replace(/\bTUBAR\uFFFD+O\b/gi, 'TUBARÃO')
    .replace(/\bILUMINACAO\b/gi, 'ILUMINAÇÃO')
    .replace(/\bILUMINAC[ÃA�]{0,3}O\b/gi, 'ILUMINAÇÃO')
    .replace(/\bILUMINA\uFFFD+O\b/gi, 'ILUMINAÇÃO')
    .replace(/\bILUMINAC\uFFFD+O\b/gi, 'ILUMINAÇÃO')
    .replace(/\bDIRECAO\b/gi, 'DIREÇÃO')
    .replace(/\bDIREC[ÃA�]{0,3}O\b/gi, 'DIREÇÃO')
    .replace(/\bDIRE\uFFFD+O\b/gi, 'DIREÇÃO')
    .replace(/\bDIREC\uFFFD+O\b/gi, 'DIREÇÃO')
    .replace(/\bSUSPENSAO\b/gi, 'SUSPENSÃO')
    .replace(/\bSUSPENS[ÃA�]{0,3}O\b/gi, 'SUSPENSÃO')
    .replace(/\bSUSPENS\uFFFD+O\b/gi, 'SUSPENSÃO')
    .replace(/\bMAO\b/gi, 'MÃO')
    .replace(/\bM[ÃA�]{0,2}O\b/gi, 'MÃO')
    .replace(/\bMA\uFFFD+O\b/gi, 'MÃO')
    .replace(/\bCONEXAO\b/gi, 'CONEXÃO')
    .replace(/\bCONEX[ÃA�]{0,3}O\b/gi, 'CONEXÃO')
    .replace(/\bCONEX\uFFFD+O\b/gi, 'CONEXÃO')
    .replace(/\bTRACAO\b/gi, 'TRAÇÃO')
    .replace(/\bTRAC[ÃA�]{0,3}O\b/gi, 'TRAÇÃO')
    .replace(/\bTRA\uFFFD+O\b/gi, 'TRAÇÃO')
    .replace(/\bTRAC\uFFFD+O\b/gi, 'TRAÇÃO')
    .replace(/\bPISTAO\b/gi, 'PISTÃO')
    .replace(/\bPIST[ÃA�]{0,3}O\b/gi, 'PISTÃO')
    .replace(/\bPISTA\uFFFD+O\b/gi, 'PISTÃO')
    .replace(/\bPIST\uFFFD+O\b/gi, 'PISTÃO')
    .replace(/\bARTICULACAO\b/gi, 'ARTICULAÇÃO')
    .replace(/\bARTICULAC[ÃA�]{0,3}O\b/gi, 'ARTICULAÇÃO')
    .replace(/\bARTICULA\uFFFD+O\b/gi, 'ARTICULAÇÃO')
    .replace(/\bARTICULAC\uFFFD+O\b/gi, 'ARTICULAÇÃO')
    .replace(/\bPROTECAO\b/gi, 'PROTEÇÃO')
    .replace(/\bPROTEC[ÃA�]{0,3}O\b/gi, 'PROTEÇÃO')
    .replace(/\bPROTE\uFFFD+O\b/gi, 'PROTEÇÃO')
    .replace(/\bPROTEC\uFFFD+O\b/gi, 'PROTEÇÃO')
    .replace(/\bVEDACAO\b/gi, 'VEDAÇÃO')
    .replace(/\bVEDA\uFFFD+O\b/gi, 'VEDAÇÃO')
    .replace(/\bVEDAC\uFFFD+O\b/gi, 'VEDAÇÃO')
    .replace(/\bVEDAC[ÃA�]{0,3}O\b/gi, 'VEDAÇÃO')
    .replace(/\uFFFDVEL\b/gi, 'ÍVEL')
    .replace(/S\uFFFD{2,}ES\b/gi, 'SÕES')
    .replace(/S\uFFFD{2,}O\b/gi, 'SÃO')
    .replace(/\uFFFD{2,}ES\b/gi, 'ÇÕES')
    .replace(/\uFFFD{2,}O\b/gi, 'ÇÃO')
    .replace(/\uFFFD+O\b/gi, 'ÃO');
}
