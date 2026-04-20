import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { InventoryItem } from './types';

export type DetectedScan = {
  matchedSku: string | null;
  detectedCode: string | null;
  candidates: string[];
};

type ScanTarget = {
  canvas: HTMLCanvasElement;
  statusMessage: string;
};

export function getScannerReader(readerRef: { current: BrowserMultiFormatReader | null }) {
  if (!readerRef.current) {
    readerRef.current = new BrowserMultiFormatReader(buildScannerHints(), {
      delayBetweenScanAttempts: 70,
      delayBetweenScanSuccess: 180,
      tryPlayVideoTimeout: 1800
    });
  }

  return readerRef.current;
}

export async function decodeFileCode(
  file: File,
  items: InventoryItem[],
  aliases: Record<string, string>,
  setStatus: (value: string) => void
) {
  const imageUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(imageUrl);
    const reader = new BrowserMultiFormatReader(buildScannerHints(), {
      delayBetweenScanAttempts: 70,
      delayBetweenScanSuccess: 180,
      tryPlayVideoTimeout: 1800
    });

    try {
      const result = await reader.decodeFromImageElement(image);
      return resolveScannedCode(result.getText(), items, aliases);
    } catch {
      setStatus('Melhorando contraste do QR Code...');
      const enhancedResult = await decodePreparedImageVariants(image, reader);
      if (enhancedResult) {
        return resolveScannedCode(enhancedResult, items, aliases);
      }

      return {
        matchedSku: null,
        detectedCode: null,
        candidates: []
      };
    }
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function decodeVideoSnapshotCode(
  video: HTMLVideoElement,
  items: InventoryItem[],
  aliases: Record<string, string>,
  setStatus: (value: string) => void
) {
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }

  const snapshots = captureScanTargets(video);
  if (snapshots.length === 0) return null;

  const reader = new BrowserMultiFormatReader(buildScannerHints(), {
    delayBetweenScanAttempts: 50,
    delayBetweenScanSuccess: 150,
    tryPlayVideoTimeout: 1200
  });

  try {
    for (const snapshot of snapshots) {
      setStatus(snapshot.statusMessage);
      const decoded = await decodePreparedImageVariants(snapshot.canvas, reader);
      if (decoded) {
        return resolveScannedCode(decoded, items, aliases);
      }

    }

    return null;
  } catch {
    return null;
  }
}

export function resolveScannedCode(
  rawCode: string,
  items: InventoryItem[],
  aliases: Record<string, string>
): DetectedScan {
  const normalizedCandidates = expandScannedCodeCandidates(rawCode);
  const normalizedItems = new Map(items.map(item => [normalizeCode(item.sku), item.sku]));

  const matchedFromMemory =
    normalizedCandidates
      .map(candidate => aliases[candidate])
      .find(candidate => candidate && normalizedItems.has(normalizeCode(candidate))) || null;

  const directMatch =
    normalizedCandidates.find(candidate => normalizedItems.has(normalizeCode(candidate))) || null;

  const matchedSku =
    matchedFromMemory ||
    (directMatch ? normalizedItems.get(normalizeCode(directMatch)) ?? directMatch : null);

  return {
    matchedSku,
    detectedCode: directMatch || normalizedCandidates[0] || null,
    candidates: normalizedCandidates
  };
}

export function isExpectedScannerError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return ['NotFoundException', 'ChecksumException', 'FormatException'].includes(error.name);
}

export async function playConfirmTone(audioContextRef: { current: AudioContext | null }) {
  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) return;

  if (!audioContextRef.current) {
    audioContextRef.current = new AudioContextCtor();
  }

  const context = audioContextRef.current;
  if (context.state === 'suspended') {
    await context.resume();
  }

  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(920, now);
  oscillator.frequency.linearRampToValueAtTime(1180, now + 0.08);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.18);
}

function normalizeCode(value: string) {
  return value.trim().toLowerCase();
}

async function loadImage(src: string) {
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Nao foi possivel carregar a imagem.'));
    image.src = src;
  });
}

function buildScannerHints() {
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [
    BarcodeFormat.QR_CODE
  ]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  hints.set(DecodeHintType.CHARACTER_SET, 'utf-8');
  return hints;
}

async function decodePreparedImageVariants(
  source: HTMLImageElement | HTMLCanvasElement,
  reader: BrowserMultiFormatReader
) {
  const variants = await buildImageVariants(source);

  for (const variant of variants) {
    try {
      const result = await reader.decodeFromImageElement(variant);
      if (result?.getText()) {
        return result.getText();
      }
    } catch {
      // Try next prepared variant.
    }
  }

  return null;
}

async function buildImageVariants(source: HTMLImageElement | HTMLCanvasElement) {
  const baseCanvas = drawSourceToCanvas(source);
  const variants = [baseCanvas];

  const enlarged = transformCanvas(baseCanvas, { scale: 2.2, contrast: 1.28, grayscale: true });
  variants.push(enlarged);

  const thresholded = transformCanvas(baseCanvas, {
    scale: 2.4,
    contrast: 1.55,
    grayscale: true,
    threshold: 154
  });
  variants.push(thresholded);

  const darkBoost = transformCanvas(baseCanvas, {
    scale: 2.6,
    contrast: 1.75,
    grayscale: true,
    threshold: 132
  });
  variants.push(darkBoost);

  return await Promise.all(variants.map(canvas => canvasToImage(canvas)));
}

function drawSourceToCanvas(source: HTMLImageElement | HTMLCanvasElement) {
  const width = source instanceof HTMLCanvasElement ? source.width : source.naturalWidth || source.width;
  const height =
    source instanceof HTMLCanvasElement ? source.height : source.naturalHeight || source.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  context.drawImage(source, 0, 0, width, height);
  return canvas;
}

function transformCanvas(
  source: HTMLCanvasElement,
  options: { scale: number; contrast: number; grayscale: boolean; threshold?: number }
) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * options.scale));
  canvas.height = Math.max(1, Math.round(source.height * options.scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;

  context.imageSmoothingEnabled = false;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const factor = (259 * (options.contrast * 100 + 255)) / (255 * (259 - options.contrast * 100));

  for (let index = 0; index < data.length; index += 4) {
    let red = data[index];
    let green = data[index + 1];
    let blue = data[index + 2];

    if (options.grayscale) {
      const gray = red * 0.299 + green * 0.587 + blue * 0.114;
      red = gray;
      green = gray;
      blue = gray;
    }

    red = truncateColor(factor * (red - 128) + 128);
    green = truncateColor(factor * (green - 128) + 128);
    blue = truncateColor(factor * (blue - 128) + 128);

    if (typeof options.threshold === 'number') {
      const gray = (red + green + blue) / 3;
      const binary = gray >= options.threshold ? 255 : 0;
      red = binary;
      green = binary;
      blue = binary;
    }

    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

function truncateColor(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

async function canvasToImage(canvas: HTMLCanvasElement) {
  const image = new Image();
  image.src = canvas.toDataURL('image/png');
  await image.decode().catch(
    () =>
      new Promise<void>(resolve => {
        image.onload = () => resolve();
        image.onerror = () => resolve();
      })
  );
  return image;
}

function captureScanTargets(video: HTMLVideoElement) {
  return [
    {
      canvas: captureVideoArea(video, { x: 0.2, y: 0.12, width: 0.6, height: 0.76 }),
      statusMessage: 'Refinando leitura do QR Code...'
    },
    {
      canvas: captureVideoArea(video, { x: 0.09, y: 0.14, width: 0.82, height: 0.72 }),
      statusMessage: 'Refinando leitura da etiqueta...'
    },
    {
      canvas: captureVideoArea(video, { x: 0.09, y: 0.33, width: 0.82, height: 0.34 }),
      statusMessage: 'Refinando leitura do QR Code...'
    }
  ].filter(isReadyScanTarget);
}

function captureVideoArea(
  video: HTMLVideoElement,
  area: { x: number; y: number; width: number; height: number }
) {
  const canvas = document.createElement('canvas');
  const cropWidth = Math.max(1, Math.floor(video.videoWidth * area.width));
  const cropHeight = Math.max(1, Math.floor(video.videoHeight * area.height));
  const cropX = Math.max(0, Math.floor(video.videoWidth * area.x));
  const cropY = Math.max(0, Math.floor(video.videoHeight * area.y));

  canvas.width = cropWidth;
  canvas.height = cropHeight;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  return canvas;
}

function isReadyScanTarget(
  target: { canvas: HTMLCanvasElement | null; statusMessage: string }
): target is ScanTarget {
  return Boolean(target.canvas);
}

function expandScannedCodeCandidates(rawCode: string) {
  const cleaned = rawCode
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^0-9A-Z-]/g, '');

  const noDash = cleaned.replace(/-/g, '');
  const digitsOnly = noDash.replace(/\D/g, '');
  const candidates = new Set<string>();

  if (cleaned) candidates.add(cleaned);
  if (noDash) candidates.add(noDash);

  if (digitsOnly) {
    candidates.add(digitsOnly);
    if (digitsOnly.length <= 5) {
      candidates.add(digitsOnly.padStart(5, '0'));
    }
    if (digitsOnly.length > 5) {
      candidates.add(digitsOnly.slice(-5));
      const chunks = digitsOnly.match(/\d{5}/g) ?? [];
      chunks.forEach(chunk => candidates.add(chunk));
    }
  }

  return Array.from(candidates);
}
