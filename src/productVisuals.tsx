import React from 'react';
import { InventoryItem } from './types';
import { normalizeUserFacingText } from './textUtils';

type ProductVisualSize = 'list' | 'card' | 'hero';

interface ProductVisualProps {
  item: InventoryItem;
  size?: ProductVisualSize;
  className?: string;
}

interface ProductVisualProfile {
  label: string;
  title: string;
  subtitle: string;
  tone: string;
  chipTone: string;
}

const visualRules: Array<{
  tokens: string[];
  label: string;
  title: string;
  subtitle: string;
  tone: string;
  chipTone: string;
}> = [
  {
    tokens: ['FILTRO', 'ELEMENTO FILTRANTE'],
    label: 'FLT',
    title: 'Filtro',
    subtitle: 'Reposicao limpa',
    tone: 'from-sky-100 via-blue-50 to-slate-100 text-blue-900',
    chipTone: 'bg-blue-100 text-blue-900'
  },
  {
    tokens: ['OLEO', 'ÓLEO', 'LUBRIF', 'GRAXA', 'FLUIDO', 'ADITIVO'],
    label: 'OLEO',
    title: 'Oleo / Fluido',
    subtitle: 'Lubrificacao',
    tone: 'from-amber-100 via-orange-50 to-yellow-100 text-amber-950',
    chipTone: 'bg-amber-100 text-amber-950'
  },
  {
    tokens: ['BATERIA', 'PILHA'],
    label: 'BAT',
    title: 'Bateria',
    subtitle: 'Energia',
    tone: 'from-emerald-100 via-lime-50 to-slate-100 text-emerald-950',
    chipTone: 'bg-emerald-100 text-emerald-950'
  },
  {
    tokens: ['PNEU', 'RODA', 'CAMARA', 'CÂMARA'],
    label: 'RODA',
    title: 'Rodas',
    subtitle: 'Rodagem',
    tone: 'from-zinc-200 via-slate-100 to-stone-100 text-slate-950',
    chipTone: 'bg-slate-200 text-slate-900'
  },
  {
    tokens: ['DISCO', 'PASTILHA', 'FREIO', 'SAPATA', 'TAMBOR'],
    label: 'FR',
    title: 'Freio',
    subtitle: 'Seguranca',
    tone: 'from-red-100 via-rose-50 to-slate-100 text-red-950',
    chipTone: 'bg-red-100 text-red-950'
  },
  {
    tokens: ['LAMPADA', 'LÂMPADA', 'FAROL', 'LANTERNA', 'LUZ', 'LED'],
    label: 'LUZ',
    title: 'Iluminacao',
    subtitle: 'Eletrica',
    tone: 'from-yellow-100 via-sky-50 to-blue-100 text-blue-950',
    chipTone: 'bg-yellow-100 text-yellow-950'
  },
  {
    tokens: ['CABO', 'FIO', 'PLUG', 'TOMADA', 'FUSIVEL', 'FUSÍVEL', 'RELE', 'RELÉ', 'SENSOR'],
    label: 'ELE',
    title: 'Eletrico',
    subtitle: 'Componente',
    tone: 'from-cyan-100 via-slate-50 to-blue-100 text-cyan-950',
    chipTone: 'bg-cyan-100 text-cyan-950'
  },
  {
    tokens: ['TINTA', 'LIXA', 'MASSA', 'ADESIVO', 'COLA', 'FUNILARIA', 'PINTURA', 'CATALISADOR'],
    label: 'PNT',
    title: 'Pintura',
    subtitle: 'Acabamento',
    tone: 'from-indigo-100 via-fuchsia-50 to-rose-100 text-indigo-950',
    chipTone: 'bg-indigo-100 text-indigo-950'
  },
  {
    tokens: ['PARAFUSO', 'PORCA', 'ARRUELA', 'JUNTA', 'RETENTOR', 'ANEL', 'PINO'],
    label: 'FIX',
    title: 'Fixacao',
    subtitle: 'Peca tecnica',
    tone: 'from-stone-200 via-neutral-100 to-slate-100 text-stone-950',
    chipTone: 'bg-stone-200 text-stone-950'
  },
  {
    tokens: ['MANGUEIRA', 'VALVULA', 'VÁLVULA', 'BOMBA', 'ROTOR', 'RABETA'],
    label: 'MEC',
    title: 'Mecanica',
    subtitle: 'Conjunto',
    tone: 'from-teal-100 via-slate-50 to-emerald-100 text-teal-950',
    chipTone: 'bg-teal-100 text-teal-950'
  }
];

export function ProductImage({ item, size = 'list', className = '' }: ProductVisualProps) {
  const profile = getProductVisualProfile(item);
  const dimensions = getImageDimensions(size);
  const title = normalizeUserFacingText(item.name);

  if (item.imageUrl) {
    return (
      <div className={`${dimensions.wrapper} relative overflow-hidden bg-surface-container ${className}`}>
        <FallbackVisual profile={profile} size={size} />
        <img
          src={item.imageUrl}
          alt={title || `Imagem do SKU ${item.sku}`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={event => {
            event.currentTarget.style.display = 'none';
          }}
        />
      </div>
    );
  }

  return (
    <div className={`${dimensions.wrapper} ${className}`}>
      <FallbackVisual profile={profile} size={size} />
    </div>
  );
}

export function getProductVisualProfile(item: InventoryItem): ProductVisualProfile {
  const source = `${normalizeUserFacingText(item.name)} ${normalizeUserFacingText(item.category)} ${normalizeUserFacingText(item.imageHint)}`.toUpperCase();
  const rule = visualRules.find(candidate => candidate.tokens.some(token => source.includes(token)));

  if (rule) {
    return {
      label: rule.label,
      title: rule.title,
      subtitle: rule.subtitle,
      tone: rule.tone,
      chipTone: rule.chipTone
    };
  }

  return {
    label: buildInitials(item),
    title: 'Produto',
    subtitle: 'Estoque',
    tone: 'from-slate-100 via-blue-50 to-slate-200 text-slate-900',
    chipTone: 'bg-slate-200 text-slate-900'
  };
}

function FallbackVisual({ profile, size }: { profile: ProductVisualProfile; size: ProductVisualSize }) {
  const dimensions = getImageDimensions(size);

  return (
    <div className={`${dimensions.inner} bg-gradient-to-br ${profile.tone} relative overflow-hidden`}>
      <div className="absolute -right-6 -top-6 h-16 w-16 rounded-full bg-white/35" />
      <div className="absolute -bottom-8 left-2 h-20 w-20 rounded-full border border-white/50" />
      <div className="relative z-10 flex h-full w-full flex-col justify-between p-2.5">
        <span className={`inline-flex w-fit rounded-full px-2 py-0.5 text-[10px] font-black tracking-tight ${profile.chipTone}`}>
          {profile.label}
        </span>
        {size !== 'list' && (
          <div>
            <p className="text-sm font-black leading-tight">{profile.title}</p>
            <p className="text-[10px] font-semibold opacity-75">{profile.subtitle}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function getImageDimensions(size: ProductVisualSize) {
  switch (size) {
    case 'hero':
      return {
        wrapper: 'h-36 sm:h-44 lg:h-full min-h-36 rounded-2xl',
        inner: 'h-full w-full rounded-2xl'
      };
    case 'card':
      return {
        wrapper: 'h-20 w-24 rounded-xl shrink-0',
        inner: 'h-full w-full rounded-xl'
      };
    default:
      return {
        wrapper: 'h-12 w-12 rounded-xl shrink-0',
        inner: 'h-full w-full rounded-xl'
      };
  }
}

function buildInitials(item: InventoryItem) {
  const name = normalizeUserFacingText(item.name);
  const words = name.split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map(word => word[0]).join('');
  return (initials || item.sku.slice(0, 3) || 'SKU').toUpperCase();
}
