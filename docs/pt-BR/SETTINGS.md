# Configurações padrão

[English](../SETTINGS.md) | Português (Brasil) | [Español](../es/SETTINGS.md)

O valor padrão de cada configuração fica definido em [`src/config/defaults.js`](../../src/config/defaults.js) (`plugins.<nome>` armazena as configurações de cada plugin).

Alterar um valor padrão já existente afeta apenas navegadores que ainda não salvaram aquela configuração. O Paletools grava todas as configurações na primeira execução, na chave `paletools:settings` do `localStorage` do Web App (compartilhada com o Paletools oficial), e os valores salvos prevalecem sobre os padrões do código. Novas chaves de configuração são aplicadas normalmente em instalações existentes, pois os dados salvos são mesclados sobre o objeto de padrões.

Para aplicar um padrão modificado em um navegador que já executou o Paletools:

- alterar a opção diretamente na tela de configurações do Paletools no Web App, ou
- remover a entrada `paletools:settings` do `localStorage` de `https://www.ea.com` (pelas ferramentas de desenvolvedor do navegador) e recarregar a página, redefinindo todas as configurações.

O fluxo de carregamento e persistência das configurações está documentado no cabeçalho de [`src/config/configuration.js`](../../src/config/configuration.js).
