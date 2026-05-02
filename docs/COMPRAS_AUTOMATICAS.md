# Compras Automaticas - Proposta pronta

Este documento deixa o modulo futuro de compras pronto para implementacao sem misturar compra com estoque.

## Objetivo

Transformar alertas criticos, reposicao, Curva ABC e pedidos manuais em uma fila de compras revisavel, aprovada por usuario e conectada ao recebimento real.

## Principio de seguranca

- Sugestao de compra nao altera estoque.
- Aprovacao de compra nao altera estoque.
- Compra marcada como comprada nao altera estoque.
- O estoque so aumenta no fluxo `Recebimento`.

## Fontes da necessidade

- SKU ativo com status `Estoque Critico`.
- SKU ativo com status `Repor em Breve`.
- Minimo/maximo automatico da Curva ABC.
- Saidas recentes dos ultimos 120 dias.
- Pedido manual criado pela equipe.
- Item limitante em `Kit Preventivas`.

## Calculo sugerido

Para cada SKU ativo com politica ABC ou limite manual:

```text
quantidade_sugerida = max(0, maximo_calculado - saldo_atual)
```

Regras de prioridade:

- `Urgente`: saldo atual menor ou igual ao minimo.
- `Repor`: saldo atual maior que minimo e menor ou igual ao maximo.
- `Manual`: pedido criado por usuario.
- Classe A sobe prioridade.
- Rank ABC menor sobe prioridade.
- Saida recente acima da media sobe prioridade.

## Estados da compra

- `Sugestao`: gerada automaticamente.
- `Manual`: criada por usuario.
- `Em analise`: alguem assumiu revisao.
- `Aprovada`: liberada para comprar.
- `Comprada`: compra realizada, aguardando chegada.
- `Recebida parcial`: parte entrou por recebimento.
- `Recebida total`: concluida.
- `Cancelada`: descartada com motivo.

## Tela `Compras`

### Resumo

- Urgentes
- Reposicao
- Manuais
- Aguardando recebimento
- Valor estimado futuro, quando houver preco

### Fila automatica

Cards ordenados por:

1. Urgente
2. Classe ABC
3. Rank ABC
4. Saida recente
5. Maior falta ate o maximo

### Pedido manual

Campos minimos:

- SKU
- quantidade solicitada
- motivo
- observacao

### Card do item

Mostrar:

- SKU e descricao
- saldo atual
- minimo/maximo usado
- quantidade sugerida
- classe/rank ABC
- saidas recentes
- motivo da sugestao
- status da compra
- botoes: `Aprovar`, `Ajustar`, `Ignorar`, `Marcar comprada`, `Abrir estoque`

## Modelo de dados sugerido

```ts
type PurchaseRequestStatus =
  | 'Sugestao'
  | 'Manual'
  | 'Em analise'
  | 'Aprovada'
  | 'Comprada'
  | 'Recebida parcial'
  | 'Recebida total'
  | 'Cancelada';

interface PurchaseRequest {
  id: string;
  sku: string;
  itemName: string;
  status: PurchaseRequestStatus;
  source: 'alerta-critico' | 'reposicao' | 'manual' | 'kit-preventiva';
  suggestedQuantity: number;
  approvedQuantity?: number;
  receivedQuantity?: number;
  reason: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  approvedBy?: string;
  cancelledReason?: string;
}
```

## Persistencia futura

Adicionar `purchases` ao estado salvo:

- `items`
- `logs`
- `settings`
- `requests`
- `vehicles`
- `ocrAliases`
- `purchases`

## Primeira entrega recomendada

1. Criar tipo `PurchaseRequest`.
2. Adicionar `purchases` ao estado local/cloud.
3. Criar aba `Compras`.
4. Gerar sugestoes automaticas em memoria a partir dos alertas.
5. Permitir criar pedido manual.
6. Permitir aprovar, ajustar e cancelar.
7. Deixar recebimento integrado como etapa separada.

## O que nao fazer na primeira versao

- Nao calcular preco se ainda nao houver base confiavel.
- Nao enviar compra automaticamente para fornecedor.
- Nao alterar saldo por aprovacao.
- Nao duplicar sugestao de SKU que ja tenha compra aberta.

