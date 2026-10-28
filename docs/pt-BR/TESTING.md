# Testes

[English](../TESTING.md) | Português (Brasil) | [Español](../es/TESTING.md)

`npm test` compila uma cópia temporária do userscript (sem modificar `dist/` nem incrementar o [número de build](BUILD.md#versão-e-número-de-build)) e executa:

- `tests/*.test.cjs`: testes de Player Snipe, Bulk Buy e integração com o Web App usando objetos simulados (fakes), executados tanto contra os módulos em `src/` quanto contra o userscript gerado.
- `tests/userscript/boot.test.mjs`: executa o userscript completo em um Web App simulado (sem acesso à rede nem conta da EA) e compara cada chamada, hook, listener, folha de estilo e requisição da inicialização com o registro em `tests/userscript/boot-fingerprint.snapshot.json`.
- `tests/tooling/`: testes do build, do verificador de módulos e das ferramentas de atualização upstream (desofuscador, utilitários de versão, verificador de equivalência e motor de merge). Alguns testes upstream utilizam arquivos locais na pasta `versoes_paletools/` quando presente, sendo ignorados caso contrário.

## Snapshot de inicialização (boot snapshot)

Qualquer alteração no comportamento de inicialização do script (adição ou modificação de plugin, hook ou folha de estilo) faz o teste de boot acusar diferença. Quando a alteração for intencional:

1. Executar `npm run update:boot-snapshot`.
2. Revisar o diff de `tests/userscript/boot-fingerprint.snapshot.json`. Um novo plugin deve apenas acrescentar linhas; alterações ou deslocamentos em linhas preexistentes indicam efeito colateral sobre outros módulos.
3. Incluir o arquivo de snapshot atualizado no commit.

O snapshot garante a estabilidade do que é executado no arranque, mas não substitui a validação funcional no Web App.

Atualizações upstream regravam o snapshot automaticamente ao serem concluídas (`npm run upstream:update` quando não há pendências, ou `npm run upstream:verify -- --finish`).

Os testes nunca acessam o Web App real nem contas da EA. Defeitos conhecidos herdados do script original são mantidos intencionalmente e estão documentados nos cabeçalhos dos módulos e em [Invariantes](INVARIANTS.md).
