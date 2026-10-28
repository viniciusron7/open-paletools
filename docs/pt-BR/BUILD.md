# Funcionamento do build

[English](../BUILD.md) | Português (Brasil) | [Español](../es/BUILD.md)

[`scripts/build.mjs`](../../scripts/build.mjs) valida todos os módulos (consultar [Regras de módulos](MODULE-RULES.md)) e, em seguida, monta o arquivo final:

1. escreve o bloco de metadados de [`src/userscript-header.js`](../../src/userscript-header.js), acrescentando o número de build à linha `@version` (ver abaixo);
2. insere, dentro do runtime do webpack de [`src/runtime/webpack-runtime.js`](../../src/runtime/webpack-runtime.js), uma constante para cada recurso embutido (CSS, imagens, dados) seguida de todos os módulos de [`src/manifest.json`](../../src/manifest.json), na ordem do manifesto e sem as instruções `import`/`export`. Cada módulo fica delimitado por comentários `// #region <caminho>` e `// #endregion <caminho>`.

O código resultante é formatado com o Prettier e gravado em `dist/paletools.user.js` (não versionado no git).

Em tempo de execução, todos os módulos compartilham o mesmo escopo e são avaliados na ordem do manifesto, reproduzindo a inicialização do bundle original.

O userscript gerado é totalmente autocontido: não carrega código externo em tempo de execução (sem `@require`), realizando apenas requisições de dados (como verificação de versão em `pale.tools` e consulta de preços em `fut.gg`).

## Versão e número de build

`npm run build` grava o `@version` de `src/userscript-header.js` seguido de um número sequencial de build: o primeiro build da versão 27.1.5 recebe `27.1.5.1`, o décimo recebe `27.1.5.10`.

- O contador registra as execuções bem-sucedidas de `npm run build` no ambiente local e fica armazenado em `.build-number.json` na raiz do projeto (não versionado). Remover esse arquivo reinicia a contagem em 1.
- A contagem reinicia automaticamente em 1 quando o `@version` de `src/userscript-header.js` é atualizado (manter [`src/config/version.js`](../../src/config/version.js) com a mesma versão, conforme validado pelos testes).
- Caso o build falhe por violação de alguma [regra de módulo](MODULE-RULES.md), nenhum arquivo é gerado e o contador não é incrementado.
- `npm test`, `npm run verify` e `npm run update:boot-snapshot` geram cópias temporárias próprias, sem alterar `dist/` nem o número de build.
- Apenas o metadado `@version` do cabeçalho recebe o sufixo de build; a versão interna exibida na interface do Paletools permanece sendo a definida em `src/config/version.js`.
