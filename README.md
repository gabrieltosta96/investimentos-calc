# Calculadora de Renda Fixa — Brasil

Ferramenta pessoal de apoio à decisão para CDB, RDB, LCI e LCA. Compara qualquer investimento com um
CDB a 100% do CDI pelo **valor líquido** (após IR, IOF e custos), simula taxas promocionais seguidas de
reinvestimentos e mostra o resultado num horizonte fixo (padrão: 24 meses).

HTML + CSS + JavaScript puro (ES Modules). Sem build, sem backend, sem dependências. Os dados ficam no seu navegador.

## Executar localmente

ES Modules não carregam via `file://`; use qualquer servidor estático:

```bash
python3 -m http.server 8000      # ou: npx serve .
# abra http://localhost:8000
```

## Testes

Requer Node.js 18+ (usado só para os testes; o app continua estático):

```bash
npm test          # = node --test tests/*.test.js
```

| Arquivo | Cobre |
|---|---|
| `tests/financial-math.test.js` | feriados/dias úteis, taxa diária do DI (conferida com a série 12 do BCB), pré, IPCA+, CDI ≠ Selic, bruto × líquido, entradas inválidas, anualização |
| `tests/tax-rules.test.js` | IR nas 4 faixas (limites), IOF até/após 30 dias, ordem IOF → IR, isenção LCI/LCA, carência mínima |
| `tests/comparison.test.js` | 100% × 100% = 0, 107,3% por 5 meses + 100% por 19 meses, aplicação única × reinvestimento, vencimento fora do horizonte, múltiplas etapas, percentual de CDI equivalente |
| `tests/rates-api.test.js` | falha de rede, HTTP 500, JSON inválido, cache marcado como desatualizado, datas futuras da Selic meta |

Os valores esperados são recalculados no próprio teste com as fórmulas explícitas. O cenário principal
também foi conferido com um script Python independente (feriados digitados à mão), batendo centavo a centavo.

## Estrutura

```
index.html            layout e formulário
css/styles.css        tema (variáveis CSS), responsivo
js/app.js             interface: eventos, renderização, exportação
js/state.js           estado padrão, saneamento (localStorage/URL), conversão para o modelo
js/calendar.js        datas ISO, prazos, feriados nacionais, dias úteis
js/tax-rules.js       IR, IOF, produtos suportados e carências — regras centralizadas e datadas
js/financial-math.js  fatores de juros e simulação de uma aplicação
js/comparison.js      cenários A, B e C, reinvestimentos, percentual de CDI equivalente
js/rates-api.js       consulta às séries do BCB
js/storage.js         localStorage e link de compartilhamento
js/charts.js          gráfico SVG com tooltip
js/formatters.js      Intl.NumberFormat (R$, %), datas
tests/                testes (node:test)
```

## Fontes das taxas

API pública do Banco Central (SGS), sem chave e com CORS liberado (`Access-Control-Allow-Origin: *`, verificado em 20/10/2026):

| Série | Código | Unidade | Uso |
|---|---|---|---|
| Selic meta (Copom) | 432 | % a.a. | só exibição. A série vem com **datas futuras** (repete a meta até o próximo Copom), então valores com data após hoje são ignorados |
| Selic efetiva (over), base 252 | 1178 | % a.a. | projeção para títulos atrelados à Selic |
| CDI anualizado, base 252 | 4389 | % a.a. | projeção do CDI |

`https://api.bcb.gov.br/dados/serie/bcdata.sgs.{código}/dados?formato=json&dataInicial=dd/mm/aaaa&dataFinal=dd/mm/aaaa`

- Os três indicadores são diferentes. Em 20/10/2026: meta 13,75%, Selic efetiva 13,65%, CDI 13,65%.
- A B3 não tem endpoint público documentado com CORS para a taxa DI. A série 4389 do BCB é calculada a partir da taxa DI da B3.
- Sem resposta da API, o app usa o último valor salvo, **marcado como desatualizado**. Sem nenhum valor, o campo fica vazio e você digita a projeção. Nenhuma taxa é inventada.
- A API do BCB às vezes demora ou responde erro sem cabeçalho CORS; o app tenta de novo uma vez por série.

## Fórmulas e convenções

- **Dias úteis (du)**: de segunda a sexta, exceto feriados nacionais (fixos, Carnaval, Sexta-feira Santa, Corpus Christi e 20/11 a partir de 2024). Conta de [aplicação, resgate).
- **Taxa diária DI**: `TD = (1 + CDI)^(1/252) − 1`, arredondada na 8ª casa (convenção B3).
- **% do CDI / % da Selic**: `bruto = P × (1 + TD × percentual)^du`.
- **Prefixado**: `bruto = P × (1 + taxa)^(du/252)`.
- **IPCA + taxa** (simplificado): `bruto = P × [(1 + IPCA) × (1 + taxa)]^(du/252)`.
- **IOF** (resgate em até 29 dias corridos): `IOF = rendimento × tabela regressiva` (96% no dia 1 … 3% no dia 29; 0 a partir do dia 30).
- **IR**: `IR = (rendimento − IOF) × alíquota`, com alíquota pelos dias corridos **de cada aplicação**: até 180 dias 22,5%; 181–360 dias 20%; 361–720 dias 17,5%; acima de 720 dias 15%.
- **Líquido** = bruto − IOF − IR − custos. Bruto, IOF e IR são arredondados em centavos no resgate.
- **Reinvestimento**: nova aplicação com o líquido anterior; prazo de IR/IOF recomeça do zero.
- **Anualização**: `(1 + retorno)^(252/du) − 1`.
- **% do CDI equivalente**: bisseção do percentual que faz um CDB tributável chegar ao mesmo líquido no mesmo período. Fica abaixo da regra de bolso `taxa_LCI / (1 − IR)` por causa da capitalização.

## Cenários

- **A**: o investimento informado (etapa 1), sozinho.
- **B**: CDB a 100% do CDI (percentual editável), mesmo capital e mesmas datas, com IR regressivo e IOF.
- **C**: horizonte fixo (padrão 24 meses).
  - Referência: uma única aplicação no CDB de referência durante todo o horizonte.
  - Estratégia: as etapas cadastradas, em sequência. Se terminarem antes do horizonte, o líquido é reinvestido no CDB a X% do CDI (hipótese marcada como "hipótese" na tabela) até completar o prazo.
  - Se a etapa 1 vencer depois do horizonte: com liquidez diária, assume-se resgate no fim do horizonte (com aviso); sem liquidez diária, a comparação é recusada, sem presumir resgate antecipado.

## Regras tributárias (verificadas em 20/10/2026)

Centralizadas em `js/tax-rules.js`. Atualize esse arquivo e `TAX_RULES_VERIFIED_AT` se a lei mudar.

- Tabela regressiva de IR (Lei 11.033/2004): vigente. A MP 1.303/2025, que propunha 17,5% fixo e IR de 5% para LCI/LCA, perdeu a validade em outubro de 2025.
- IOF regressivo: Decreto 6.306/2007.
- LCI/LCA: isentas de IR para pessoa física. Carência mínima (Res. CMN 5.215/2025): 6 meses; 36 meses para LCI e 12 meses para LCA atreladas a índice de preços. O app avisa se o prazo for menor.
- Por etapa, a tributação pode ser forçada para "tabela regressiva" ou "isento" quando o enquadramento for diferente do padrão.

## Premissas e limitações

- CDI, Selic e IPCA projetados ficam **constantes** no período. É uma hipótese, não uma previsão nem uma garantia.
- Não usa o CDI diário realizado em datas passadas (sempre projeta com a taxa informada).
- Vencimento em dia não útil não é deslocado para o dia útil seguinte (há um aviso).
- IPCA+ é simplificado (sem VNA mensal nem defasagem do índice).
- Ainda não simulados (o app explica o motivo em vez de mostrar números): Tesouro Selic/Prefixado/IPCA+ (marcação a mercado e custódia), fundos (taxa de administração e come-cotas), poupança (TR e aniversários) e "Outro".
- Resgate antecipado e liquidez "outra condição" são informativos; não alteram o cálculo.
- Custos são valores fixos em R$ por etapa, descontados no resgate.
- Só considera pessoa física. FGC não garante rentabilidade. Não é recomendação de investimento nem aconselhamento tributário.

## Publicar

### Criar o repositório

```bash
git init && git add . && git commit -m "Calculadora de renda fixa"
gh repo create investimentos-calc --public --source . --push   # ou crie no site e use git remote add + git push
```

### GitHub Pages

Settings → Pages → Source: *Deploy from a branch* → branch `main`, pasta `/ (root)`. Endereço: `https://<usuario>.github.io/investimentos-calc/`.
Os caminhos são relativos, então funciona em subpasta. Não há build.

### Cloudflare Pages

Dashboard → Workers & Pages → Create → Pages → *Connect to Git* → selecione o repositório.
Framework preset: *None*; Build command: vazio; Build output directory: `/`.
Sem Git: `npx wrangler pages deploy . --project-name investimentos-calc`.

## Privacidade

- Simulações e cache de taxas ficam no `localStorage` do navegador.
- O link de compartilhamento leva a simulação codificada no fragmento `#s=…`, que o navegador não envia ao servidor.
- A única chamada externa é a consulta de taxas ao BCB, sem nenhum dado seu.
