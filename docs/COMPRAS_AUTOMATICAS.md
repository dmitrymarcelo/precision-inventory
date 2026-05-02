# Compras Automaticas - modulo operacional

Este documento registra a regra operacional do modulo de compras sem misturar compra com estoque.

## Objetivo

Transformar alertas criticos, reposicao, Curva ABC e pedidos manuais em pacotes de compras revisaveis, aprovados por usuario e conectados ao recebimento real.

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

O maximo calculado vem da Curva ABC quando o SKU existir na base tratada. Se nao existir, usa o limite de reposicao manual/fallback do item.

Regras de prioridade:

- `Urgente`: saldo atual menor ou igual ao minimo.
- `Repor`: saldo atual maior que minimo e menor ou igual ao maximo.
- `Manual`: pedido criado por usuario.
- Classe A sobe prioridade.
- Rank ABC menor sobe prioridade.
- Saida recente acima da media sobe prioridade.

## Pacotes de compra

As sugestoes devem ficar agrupadas para facilitar cotacao e compra:

- Primeiro por `tipo do veiculo` ou tipo operacional salvo no item.
- Depois por classificacao: `Critico`, `Repor`, `Manual` ou `Kit preventiva`.
- Somente SKUs marcados como ativos no armazem entram na fila automatica.
- `VW` aparece como `SAVEIRO/GOL`.
- `CHEVROLET` aparece como `S-10`.
- `OLEO`, quando salvo no item, continua como pacote operacional de compra.

Exemplos de pacote:

- `SAVEIRO/GOL / Critico`
- `SAVEIRO/GOL / Repor`
- `BATERIA / Critico`
- `OLEO / Repor`

## Cotacoes por item

Ao clicar em `Analisar`, o sistema deve abrir o mapa de cotacoes do SKU.

Regras:

- exigir no minimo 3 cotacoes completas para aprovar o item
- cotacao completa = fornecedor + valor unitario + status `Recebida`
- registrar contato, numero da cotacao, data, validade, frete/taxas, prazo, condicao de pagamento e observacoes
- permitir escolher manualmente a cotacao vencedora
- sugerir automaticamente a melhor opcao por pontuacao
- manter justificativa da escolha
- permitir importar PDF em cada cotacao
- carregar a leitura de PDF sob demanda, somente ao clicar em `Importar PDF`
- preencher automaticamente fornecedor, contato, numero, datas, valores, prazo e pagamento quando o texto do PDF permitir
- reconhecer SKUs adicionais presentes na mesma cotacao, mesmo quando pertencem a outro tipo/subgrupo
- mostrar itens reconhecidos por tipo e classificacao: `Critico`, `Repor`, `Manual` ou `Kit preventiva`
- permitir selecionar manualmente um item quando o PDF nao reconhecer
- ao salvar, replicar a cotacao para os outros itens reconhecidos, sem escolher vencedor automaticamente nesses outros SKUs
- cada cotacao deve ter botao pequeno para imprimir o mapa de cotacao

Pontuacao sugerida:

- preco/custo total: 45%
- aderencia tecnica/qualidade: 35%
- prazo de entrega: 20%

Importante:

- a menor cotacao nao precisa ser obrigatoriamente a escolhida
- a aprovacao continua sendo decisao humana
- aprovar cotacao nao altera saldo do estoque

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
