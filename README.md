# Utilidades

Páginas de utilidade num só lugar. React 19 + Vite + TypeScript.

- **Calculadora Vending Machine** (`#/vending`): lucro mensal, margem, ponto de equilíbrio (pacotes/mês e /dia).
- **Calculadora de Renda Fixa** (`#/investimentos`): compara CDB, RDB, LCI e LCA com 100% do CDI pelo valor líquido (IR, IOF, reinvestimentos). Regras, fórmulas e fontes em `src/pages/investimentos/lib/` (JS puro, testado).

```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm test     # node:test (investimentos) + check da vending
pnpm build
```

Nova utilidade: crie `src/pages/<nome>/`, reaproveite `src/components/` e adicione uma linha em `pages` no `src/App.tsx`.

Deploy: GitHub Pages via `.github/workflows/deploy.yml` a cada push na `main`.

Não é recomendação de investimento nem aconselhamento tributário.
