# Comandos

[English](../COMMANDS.md) | Português (Brasil) | [Español](../es/COMMANDS.md)

Executar `npm ci` uma vez após clonar o repositório para instalar as dependências necessárias aos demais comandos.

| Comando                        | Descrição                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                       | Instala as ferramentas de build e teste fixadas em `package-lock.json`.                                                                                               |
| `npm run build`                | Valida os módulos e gera `dist/paletools.user.js` a partir de `src/` com o próximo [número de build](BUILD.md#versão-e-número-de-build).                              |
| `npm run check:modules`        | Verifica apenas imports, exports e as [regras de módulos](MODULE-RULES.md).                                                                                           |
| `npm test`                     | Compila uma cópia temporária de teste (sem alterar `dist/`) e executa todos os [testes](TESTING.md) contra `src/` e contra o userscript gerado.                       |
| `npm run verify`               | Executa `check:modules` + `format:check` + `npm test`. Recomendado antes de cada commit.                                                                              |
| `npm run format`               | Formata o código com o Prettier (`npm run format:check` apenas verifica a formatação).                                                                                |
| `npm run update:boot-snapshot` | Atualiza o snapshot de inicialização após mudanças intencionais na sequência de boot (plugins, hooks, folhas de estilo).                                              |
| `npm run upstream:check`       | Verifica se há uma versão oficial do Paletools mais recente que a acompanhada por `src/` ([atualização](UPDATING.md)).                                                |
| `npm run upstream:update`      | Porta a versão oficial mais recente para `src/` e verifica a equivalência do resultado ([atualização](UPDATING.md#via-linha-de-comando)).                             |
| `npm run upstream:verify`      | Verifica se o build de `src/` permanece equivalente ao resultado esperado do último port (`-- --finish` registra a nova base; `--conflicts-resolved` após conflitos). |
| `npm run upstream:status`      | Lista todos os pontos em que `src/` difere da versão base oficial (modificações próprias deste projeto).                                                              |

Argumentos adicionais após `--` são repassados ao runner `node --test` (ex.: `npm test -- --test-name-pattern=boot`).

No Claude Code, o comando `/update-paletools` automatiza todo o fluxo de atualização para uma nova versão do Paletools (consultar [Atualização](UPDATING.md)).
