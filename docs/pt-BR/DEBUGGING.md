# Depuração

[English](../DEBUGGING.md) | Português (Brasil) | [Español](../es/DEBUGGING.md)

- Erros de execução e mensagens de `console.log` são exibidos no console das ferramentas de desenvolvedor do navegador na página do Web App.
- O script instalado corresponde ao arquivo gerado pelo build: cada módulo é delimitado por comentários `// #region src/...` e `// #endregion src/...`, permitindo localizar diretamente o módulo de origem a partir da linha informada no stack trace.
- Uma exceção não tratada dentro de `run()` interrompe a inicialização de todos os plugins subsequentes e da tela de configurações do Paletools. Recomenda-se envolver código experimental em blocos `try`/`catch` durante o desenvolvimento.
- Os logs internos de depuração vêm desativados por padrão: alterar `isDebugLoggingEnabled` para `true` em [`src/core/logger.js`](../../src/core/logger.js) para habilitá-los.
- Caso uma alteração de valor padrão não surta efeito, verificar se há uma configuração salva no navegador sobrepondo o novo valor (consultar [Configurações padrão](SETTINGS.md)) e se o Paletools oficial está desativado (consultar [Atualização](UPDATING.md)).
- `npm test` executa o userscript completo em um Web App simulado (consultar [Testes](TESTING.md)): se o `run()` de algum plugin lançar erro, o teste de inicialização falha com `"paletools:appStarted must be dispatched"` antes mesmo da instalação no navegador. Como o ambiente simulado utiliza objetos substitutos (fakes), validações dependentes do servidor real ainda exigem teste no Web App.
