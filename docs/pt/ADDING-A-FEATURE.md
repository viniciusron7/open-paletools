# Adição de funcionalidades

[English](../ADDING-A-FEATURE.md) | Português | [Español](../es/ADDING-A-FEATURE.md)

Uma funcionalidade consiste em um plugin: um objeto com uma função `run()`, executada uma única vez quando o Web App está pronto para instalar os hooks necessários, e opcionalmente um bloco `settings` para a tela de configurações do Paletools.

1. Criar `src/plugins/my-feature/index.js`:

   ```js
   /**
    * Plugin My Feature (`myFeaturePlugin`): descrição do comportamento e dos hooks instalados.
    */
   import { configuration, persistConfiguration } from "../../config/configuration.js";
   import { appendToggle } from "../../ui/settings-controls.js";

   const myFeatureSettings = configuration.plugins.myFeature;

   export const myFeaturePlugin = {
     run() {
       // Envolve um método do Web App: chama o original, adiciona o comportamento e retorna o resultado.
       const originalSetSquad = UTSBCSquadOverviewView.prototype.setSquad;
       UTSBCSquadOverviewView.prototype.setSquad = function (...args) {
         const result = originalSetSquad.apply(this, args);
         if (configuration.enabled && myFeatureSettings.enabled) {
           // Código personalizado: `this` é a view, `args[0]` é o elenco.
         }
         return result;
       };
     },
     settings: {
       name: "my-feature",
       title: "plugins.myFeature.settings.title",
       menu() {
         const container = document.createElement("div");
         appendToggle(container, "enabled", myFeatureSettings.enabled, (isEnabled) => {
           myFeatureSettings.enabled = isEnabled;
           persistConfiguration();
         });
         return container;
       },
     },
   };
   ```

2. Adicionar as configurações padrão ao objeto `plugins` de [`src/config/defaults.js`](../../src/config/defaults.js): `myFeature: { enabled: true },`.
3. Adicionar os textos em [`src/i18n/en.js`](../../src/i18n/en.js): `"plugins.myFeature.settings.title": "My Feature",`. Idiomas que não possuírem a chave utilizam o texto em inglês como fallback.
4. Adicionar `"src/plugins/my-feature/index.js"` em [`src/manifest.json`](../../src/manifest.json), após os módulos que ele importa e antes de `"src/custom-plugins.js"`.
5. Em [`src/custom-plugins.js`](../../src/custom-plugins.js), importar o plugin e adicioná-lo à lista: `export const customPlugins = [myFeaturePlugin];`. Os plugins personalizados são executados após os plugins nativos, na ordem dessa lista (apenas o plugin de configurações, que constrói a tela de ajustes, roda depois deles).
6. Executar `npm run update:boot-snapshot` e, em seguida, `npm run verify`. Revisar o diff de `tests/userscript/boot-fingerprint.snapshot.json`: ele deve apenas adicionar linhas referentes ao novo plugin (seus hooks e folhas de estilo); nenhuma linha existente deve ser alterada ou deslocada. Consultar [Testes](TESTING.md).
7. Executar `npm run build` e instalar o arquivo `dist/paletools.user.js` gerado para testar a funcionalidade no Web App.

## Observações técnicas

- Para estilos, criar `my-feature.css` ao lado do `index.js`, importá-lo (`import myFeatureCss from "./my-feature.css";`) e aplicá-lo em `run()` com `upsertStylesheet("paletools-my-feature", myFeatureCss)` de [`src/ui/stylesheets.js`](../../src/ui/stylesheets.js).
- Classes e variáveis globais do Web App (como `UTSBCSquadOverviewView` ou `services`) só podem ser utilizadas se estiverem listadas em [`src/external-globals.json`](../../src/external-globals.json). O build informa qualquer identificador ausente; adicioná-los em `webApp`.
- [`src/plugins/refresh-coins/`](../../src/plugins/refresh-coins/) e [`src/plugins/decimal-rating/`](../../src/plugins/decimal-rating/) servem como exemplos de plugins simples.
- O build valida estritamente as [regras de módulos](MODULE-RULES.md) e indica eventuais correções necessárias.
- Um novo valor padrão para uma configuração existente pode não ter efeito imediato no navegador: consultar [Configurações padrão](SETTINGS.md).
- Para diagnóstico de falhas, consultar [Depuração](DEBUGGING.md).
- Plugins isolados em módulos próprios e listados em `src/custom-plugins.js` são preservados intactos ao atualizar para novas versões do Paletools. Caso uma versão oficial remova uma função ou valor nativo utilizado pelo plugin, a atualização o mantém e registra um conflito (consultar [Atualização](UPDATING.md#código-personalizado)).
