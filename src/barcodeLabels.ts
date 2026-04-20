import { InventoryItem } from './types';
import { normalizeUserFacingText } from './textUtils';

type QrSvgOptions = {
  size?: number;
};

type BarcodePrintOptions = {
  title: string;
  subtitle: string;
};

type PrintWindowOptions = BarcodePrintOptions;

export async function buildQrSvgMarkup(value: string, options: QrSvgOptions = {}) {
  const QRCode = await import('qrcode');
  const safeValue = sanitizeQrValue(value);

  return QRCode.toString(safeValue, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    width: options.size ?? 84,
    color: {
      dark: '#111827',
      light: '#FFFFFF'
    }
  });
}

export async function buildLabelPreviewMarkup(item: InventoryItem) {
  return buildQrSvgMarkup(item.sku, { size: 84 });
}

export async function createBarcodePrintDocument(
  items: InventoryItem[],
  options: BarcodePrintOptions
) {
  const generatedAt = new Date().toLocaleString('pt-BR');
  const labelsMarkup = await Promise.all(items.map(item => createLabelMarkup(item)));

  return `<!DOCTYPE html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(options.title)}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Arial, Helvetica, sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: #f3f4f6;
        color: #111827;
      }

      html,
      body {
        -webkit-text-size-adjust: 100%;
      }

      .preview-shell {
        max-width: 900px;
        margin: 0 auto;
        padding: 18px;
      }

      .header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: end;
        margin-bottom: 8mm;
      }

      .title {
        margin: 0;
        font-size: 20px;
        font-weight: 700;
      }

      .subtitle {
        margin: 4px 0 0;
        font-size: 12px;
        color: #4b5563;
      }

      .helper {
        margin: 0 0 8mm;
        padding: 10px 12px;
        border-radius: 12px;
        background: #e5effe;
        color: #243445;
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
      }

      .helper p {
        margin: 0;
        font-size: 12px;
        line-height: 1.4;
      }

      .helper button {
        height: 40px;
        padding: 0 16px;
        border: none;
        border-radius: 10px;
        background: #3e5f92;
        color: #f6f7ff;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        white-space: nowrap;
      }

      .stamp {
        font-size: 11px;
        color: #6b7280;
        text-align: right;
      }

      .sheet {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: flex-start;
      }

      .label {
        width: 63mm;
        height: 36mm;
        border: 1px solid #d1d5db;
        border-radius: 3mm;
        background: #ffffff;
        padding: 2.8mm;
        break-inside: avoid;
        page-break-inside: avoid;
        box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
        overflow: hidden;
      }

      .label-sku {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.02em;
      }

      .label-name {
        margin: 3px 0 0;
        font-size: 9.2px;
        line-height: 1.22;
        white-space: normal;
        overflow-wrap: anywhere;
        word-break: break-word;
        hyphens: auto;
      }

      .label-qr {
        display: flex;
        align-items: center;
        padding: 0;
      }

      .qr-layout {
        display: grid;
        grid-template-columns: 18mm minmax(0, 1fr);
        gap: 2.8mm;
        width: 100%;
        height: 100%;
        align-items: center;
      }

      .qr-code {
        width: 18mm;
        height: 18mm;
        padding: 1mm;
        border: 1px solid #e5e7eb;
        border-radius: 2mm;
        background: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .qr-code svg {
        width: 100%;
        height: 100%;
        display: block;
      }

      .qr-meta {
        min-width: 0;
        display: flex;
        flex-direction: column;
        height: 100%;
        justify-content: center;
      }

      .qr-meta .label-sku {
        font-size: 12.6px;
        margin-bottom: 1mm;
      }

      .qr-meta .label-name {
        margin: 0;
      }

      .label-name.name-lg {
        font-size: 9.2px;
        line-height: 1.22;
      }

      .label-name.name-md {
        font-size: 8.6px;
        line-height: 1.18;
      }

      .label-name.name-sm {
        font-size: 8px;
        line-height: 1.15;
      }

      .label-name.name-xs {
        font-size: 7.2px;
        line-height: 1.12;
      }

      .label-name.name-xxs {
        font-size: 6.6px;
        line-height: 1.1;
      }

      .label-name.name-xxxs {
        font-size: 5.8px;
        line-height: 1.08;
      }

      @page {
        size: A4 portrait;
        margin: 6mm;
      }

      @media print {
        body {
          background: #ffffff;
        }

        .helper,
        .header {
          display: none;
        }

        .preview-shell {
          padding: 0;
          margin: 0;
          max-width: none;
        }

        .sheet {
          display: grid;
          grid-template-columns: repeat(3, 63mm);
          gap: 4mm;
          width: 197mm;
          align-content: start;
          justify-content: start;
        }

        .label {
          margin: 0;
          box-shadow: none;
          border-radius: 0;
          position: relative;
        }

        .label::before {
          content: '';
          position: absolute;
          inset: -1mm;
          pointer-events: none;
          background:
            linear-gradient(#111827, #111827) left top / 4.8mm 0.22mm no-repeat,
            linear-gradient(#111827, #111827) left top / 0.22mm 4.8mm no-repeat,
            linear-gradient(#111827, #111827) right top / 4.8mm 0.22mm no-repeat,
            linear-gradient(#111827, #111827) right top / 0.22mm 4.8mm no-repeat,
            linear-gradient(#111827, #111827) left bottom / 4.8mm 0.22mm no-repeat,
            linear-gradient(#111827, #111827) left bottom / 0.22mm 4.8mm no-repeat,
            linear-gradient(#111827, #111827) right bottom / 4.8mm 0.22mm no-repeat,
            linear-gradient(#111827, #111827) right bottom / 0.22mm 4.8mm no-repeat;
          opacity: 0.5;
        }
      }
    </style>
  </head>
  <body>
    <main class="preview-shell">
      <section class="helper">
        <p>
          Confira no preview antes de imprimir. No diálogo de impressão, use escala 100% e desative cabeçalho/rodapé.
        </p>
        <button type="button" onclick="window.print()">Imprimir agora</button>
      </section>
      <section class="header">
        <div>
          <h1 class="title">${escapeHtml(options.title)}</h1>
          <p class="subtitle">${escapeHtml(options.subtitle)}</p>
        </div>
        <div class="stamp">
          <div>${items.length} etiquetas</div>
          <div>Gerado em ${escapeHtml(generatedAt)}</div>
        </div>
      </section>
      <section class="sheet">${labelsMarkup.join('')}</section>
    </main>
  </body>
</html>`;
}

export async function openBarcodePrintWindow(
  items: InventoryItem[],
  options: PrintWindowOptions
) {
  const printWindow = window.open('', '_blank', 'width=1200,height=900');
  if (!printWindow) {
    return false;
  }

  const documentMarkup = await createBarcodePrintDocument(items, options);

  printWindow.document.open();
  printWindow.document.write(documentMarkup);
  printWindow.document.close();

  return true;
}

async function createLabelMarkup(item: InventoryItem) {
  const qrMarkup = await buildQrSvgMarkup(item.sku, { size: 76 });
  const displayName = normalizeUserFacingText(item.name);
  const nameClass = getLabelNameSizeClass(displayName);
  return `
    <article class="label label-qr">
      <div class="qr-layout">
        <div class="qr-code">${qrMarkup}</div>
        <div class="qr-meta">
          <p class="label-sku">SKU ${escapeHtml(item.sku)}</p>
          <p class="label-name ${nameClass}">${escapeHtml(displayName)}</p>
        </div>
      </div>
    </article>
  `;
}

function getLabelNameSizeClass(value: string) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  const length = normalized.length;

  if (length > 90) return 'name-xxxs';
  if (length > 72) return 'name-xxs';
  if (length > 56) return 'name-xs';
  if (length > 42) return 'name-sm';
  if (length > 32) return 'name-md';
  return 'name-lg';
}

function sanitizeQrValue(value: string) {
  return String(value || '').trim() || 'SEM-CODIGO';
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
