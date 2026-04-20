import { normalizeUserFacingText } from './textUtils';

type CategoryRule = {
  label: string;
  keywords: string[];
};

const categoryRules: CategoryRule[] = [
  {
    label: 'Climatização e Cabine • Filtro de cabine',
    keywords: ['filtro de ar condicionado', 'filtro cabine', 'filtro de cabine']
  },
  {
    label: 'Climatização e Cabine • Ar-condicionado',
    keywords: ['ar condicionado', 'compressor do ar', 'evaporador', 'condensador']
  },
  {
    label: 'Freios • Discos, pastilhas e componentes',
    keywords: ['freio', 'pastilha', 'disco de freio', 'tambor', 'cilindro mestre', 'hidrovacuo']
  },
  {
    label: 'Suspensão e Direção • Pivôs, buchas e articulações',
    keywords: ['pivo', 'pivô', 'bieleta', 'bucha', 'terminal', 'axial', 'bandeja', 'coxim']
  },
  {
    label: 'Rolamentos, Cubos e Mancais',
    keywords: ['rolamento', 'cubo de roda', 'mancal']
  },
  {
    label: 'Correias, Polias e Tensores',
    keywords: ['correia', 'tensor', 'polia']
  },
  {
    label: 'Transmissão e Embreagem',
    keywords: ['embreagem', 'transmiss', 'cambio', 'câmbio', 'homocinet', 'diferencial']
  },
  {
    label: 'Motor e Admissão',
    keywords: ['motor', 'cabecote', 'cabeçote', 'valvula', 'válvula', 'junta', 'pistao', 'pistão', 'biela']
  },
  {
    label: 'Arrefecimento • Radiadores e mangueiras',
    keywords: ['radiador', 'mangueira', 'bomba dagua', "bomba d'agua", 'arrefecimento', 'reservatorio']
  },
  {
    label: 'Elétrica e Ignição • Iluminação automotiva',
    keywords: ['luz', 'lampada', 'lâmpada', 'farol', 'lanterna', 'led']
  },
  {
    label: 'Elétrica e Ignição • Cabos, conectores e tomadas',
    keywords: ['cabo flex', 'cabo ', 'plug', 'conector', 'terminal eletrico', 'tomada']
  },
  {
    label: 'Elétrica e Ignição • Sensores e automação',
    keywords: ['sensor', 'rele', 'relé', 'fusivel', 'fusível', 'bobina', 'vela', 'alternador', 'partida']
  },
  {
    label: 'Lubrificantes e Fluidos • Óleos e graxas',
    keywords: ['oleo', 'óleo', 'lubrificante', 'graxa', 'fluido']
  },
  {
    label: 'Pintura e Acabamento • Tintas e preparação',
    keywords: ['tinta', 'catalisador para tinta', 'catalisador', 'primer', 'verniz']
  },
  {
    label: 'Pintura e Acabamento • Abrasivos e mascaramento',
    keywords: ['lixa', 'fita crepe', 'mascaramento']
  },
  {
    label: 'Químicos e Fixação • Adesivos e selantes',
    keywords: ['adesivo', 'cola', 'selante', 'silicone', 'veda']
  },
  {
    label: 'Fixação e Ferragens',
    keywords: ['parafuso', 'porca', 'arruela', 'abraçadeira', 'abracadeira', 'rebite']
  },
  {
    label: 'Ferramentas e Oficina',
    keywords: ['chave', 'alicate', 'broca', 'esmerilhadeira', 'disco de corte']
  }
];

export function classifyInventoryCategory(name: string, sourceCategory?: string) {
  const normalizedName = normalizeForMatch(name);
  const normalizedSource = normalizeUserFacingText(sourceCategory);
  const sourceLabel = normalizedSource || undefined;

  const rule = categoryRules.find(entry =>
    entry.keywords.some(keyword => normalizedName.includes(normalizeForMatch(keyword)))
  );

  if (rule) {
    return {
      category: rule.label,
      sourceCategory: sourceLabel
    };
  }

  if (sourceLabel && !/^grupo\s+\d+/i.test(sourceLabel)) {
    return {
      category: sourceLabel,
      sourceCategory: sourceLabel
    };
  }

  return {
    category: sourceLabel ? `Suprimentos e Consumo • ${sourceLabel}` : 'Suprimentos e Consumo',
    sourceCategory: sourceLabel
  };
}

function normalizeForMatch(value: string) {
  return normalizeUserFacingText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
