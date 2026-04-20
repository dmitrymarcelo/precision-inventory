# Precision Inventory

Aplicativo de inventário feito com React, Vite, Tailwind CSS, Cloudflare Pages e Cloudflare D1.

## Como rodar

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Inicie o servidor local:

   ```bash
   npm run dev
   ```

3. Abra a URL exibida no terminal. O padrão configurado aceita acesso na rede local:

   ```text
   http://localhost:3000/
   ```

## Publicação

O projeto usa Cloudflare Pages e D1 para persistência online.

```bash
npm run deploy
```

Banco D1 configurado: `precision-inventory-db`.

## Funcionalidades

- Dashboard com métricas de estoque e limites editáveis para alertas.
- Busca por SKU exato na tela Buscar e Atualizar.
- Leitura de etiqueta por câmera/foto com OCR, procurando o código de 5 dígitos da etiqueta e conferindo contra a base carregada.
- Ajuste de quantidade como saldo atual contado do item na locação atual.
- Edição de locação atual e limites de alerta por item.
- Logs automáticos filtrados pelo SKU pesquisado, com saldo anterior, saldo contado e diferença.
- Lista de inventário com paginação.
- Importação de arquivo `.xlsx` ou `.csv` no modelo `mata225`:
  - `Produto` vira SKU.
  - `locação` (coluna K) vira Locação / Prateleira.
  - `Descricao` vira nome do item.
  - `Saldo Atual` vira quantidade.
  - `Grupo` vira categoria.
  - O status é calculado pelos limites de alerta do item; itens importados recebem o padrão atual do Dashboard.
- Persistência online no Cloudflare D1, com fallback local quando a API não estiver disponível.
