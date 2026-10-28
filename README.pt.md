# open-paletools

[English](README.md) | Português | [Español](README.es.md)

Código-fonte modular e desofuscado do userscript Paletools para o Web App do EA SPORTS FC Ultimate Team.

Não oficial: baseado no Paletools 27.2.1 de Paleta. Sem afiliação com Paleta ou com a EA.

## 1. Preparação do ambiente

Requer [Git](https://git-scm.com/) e [Node.js](https://nodejs.org/) 22.13 ou superior.

```sh
git clone https://github.com/viniciusron7/open-paletools.git
cd open-paletools
npm ci          # instala as dependências de build e testes
```

## 2. Estrutura do código

```
src/
  userscript-header.js   bloco de metadados ==UserScript==
  custom-plugins.js      plugins personalizados, executados após os nativos
  manifest.json          todos os módulos, em ordem de inicialização (seguida pelo build)
  bootstrap/boot.js      aguarda o Web App, aplica patches e inicializa os plugins
  plugins/<nome>/        uma pasta por funcionalidade (index.js define o plugin; .css ao lado)
  config/                configurações padrão, carregamento e persistência (localStorage)
  i18n/                  tabelas de tradução (en, es, it, pt, de, fr) e translate()
  core/                  utilitários genéricos (DOM, eventos, HTTP, objetos, hooks de protótipo)
  ui/                    componentes e controles de interface, notificações e atalhos
  webapp/                integração com o Web App (navegação, pilhas de itens, patches globais)
  market/ club/ sbc/ db/ auxiliares do Mercado de Transferências, clube, DME (SBC) e IndexedDB
  assets/ styles/        imagens e folha de estilos global embutidas pelo build
  runtime/               runtime do webpack do bundle original (não editar)
  external-globals.json  APIs do Web App, do navegador e do userscript permitidas nos módulos
scripts/                 scripts de build, verificação e atualização upstream
upstream/                versão oficial que src/ acompanha (base.user.js, base.json)
tests/                   suíte de testes e Web App simulado
docs/                    documentação técnica
```

| Componente                                               | Localização                                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Nome do script, diretivas `@match`/`@grant`              | [`src/userscript-header.js`](src/userscript-header.js)                                                                     |
| Versão                                                   | `@version` em [`src/userscript-header.js`](src/userscript-header.js) e [`src/config/version.js`](src/config/version.js)    |
| Configurações padrão                                     | [`src/config/defaults.js`](src/config/defaults.js) ([detalhes](docs/pt/SETTINGS.md))                                       |
| Textos da interface (UI)                                 | [`src/i18n/`](src/i18n/), um arquivo por idioma (inglês é a tabela de referência)                                          |
| Plugins personalizados                                   | [`src/custom-plugins.js`](src/custom-plugins.js) ([guia de criação](docs/pt/ADDING-A-FEATURE.md))                          |
| Player snipe (motor, pausas, preços)                     | [`src/plugins/player-snipe/core.js`](src/plugins/player-snipe/core.js)                                                     |
| Player snipe: busca/compra no Web App, seleção           | [`market.js`](src/plugins/player-snipe/market.js) e [`selection.js`](src/plugins/player-snipe/selection.js) na mesma pasta |
| Bulk Buy — compra em massa (plano, orçamento, execução)  | [`src/plugins/bulk-buy/core.js`](src/plugins/bulk-buy/core.js)                                                             |
| Bulk Buy: busca por OVR, candidatos, saldo               | [`src/plugins/bulk-buy/market.js`](src/plugins/bulk-buy/market.js)                                                         |
| Sessões, diálogos e exclusão mútua de ambos              | [`src/plugins/market-automation/sessions.js`](src/plugins/market-automation/sessions.js)                                   |
| Botões e hooks de ambas as automações                    | `index.js` de [`player-snipe`](src/plugins/player-snipe/index.js) e [`bulk-buy`](src/plugins/bulk-buy/index.js)            |
| Snipe legado (atalhos, fila, confirmação)                | [`src/plugins/snipe/`](src/plugins/snipe/)                                                                                 |
| Auto Snipe (Paletools 27.2.1, bloco em Transferências)   | [`src/plugins/auto-snipe/`](src/plugins/auto-snipe/)                                                                       |
| Botão de compra do álbum e da galeria, diálogo de compra | [`src/plugins/album/album-view-controller.js`](src/plugins/album/album-view-controller.js)                                 |
| Ferramentas de atualização upstream                      | [`scripts/upstream/`](scripts/upstream/) e versão base em [`upstream/`](upstream/)                                         |
| Lista de plugins nativos e sequência de inicialização    | [`src/bootstrap/boot.js`](src/bootstrap/boot.js)                                                                           |
| Patches globais do Web App                               | [`src/webapp/patches.js`](src/webapp/patches.js)                                                                           |
| Motor de hooks de protótipo                              | [`src/core/prototype-override.js`](src/core/prototype-override.js)                                                         |
| Demais funcionalidades                                   | [`src/plugins/`](src/plugins/), uma pasta por funcionalidade (ex.: `sbc-auto-solver`, `my-packs`)                          |

## 3. Desenvolvimento e validação

- **Criação de ferramentas:** criar um módulo de plugin em `src/plugins/<nome>/` e registrá-lo em [`src/custom-plugins.js`](src/custom-plugins.js) ([passo a passo](docs/pt/ADDING-A-FEATURE.md)). Módulos isolados registrados em `custom-plugins.js` são preservados automaticamente ao atualizar para novas versões do Paletools.
- **Edição de funcionalidades nativas:** cada módulo em `src/` possui um comentário de cabeçalho descrevendo responsabilidades, hooks instalados, invariantes e defeitos conhecidos. Consultar [Invariantes](docs/pt/INVARIANTS.md), [Regras de módulos](docs/pt/MODULE-RULES.md) e [Configurações padrão](docs/pt/SETTINGS.md) antes de alterar comportamentos existentes.
- **Validação:**

  ```sh
  npm run verify   # verifica regras de módulos, formatação e executa a suíte de testes
  ```

  Caso haja alterações intencionais na sequência de inicialização (novos plugins, hooks ou folhas de estilo), atualizar o snapshot de inicialização com `npm run update:boot-snapshot` ([documentação de testes](docs/pt/TESTING.md)).

## 4. Build e instalação no Tampermonkey

Gerar o arquivo final do userscript:

```sh
npm run build   # gera dist/paletools.user.js
```

Para instalar no [Tampermonkey](https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo):

1. Abrir o painel (Dashboard) e clicar em **+** para criar um novo script.
2. Substituir todo o modelo pelo conteúdo de `dist/paletools.user.js` e salvar.
3. Manter o Paletools oficial desativado para evitar conflitos de execução.

A cada alteração em `src/`, executar `npm run build` novamente e atualizar o conteúdo do script no Tampermonkey ([funcionamento do build](docs/pt/BUILD.md)).

## 5. Atualização

- **Nova versão oficial do Paletools:** portar uma nova versão publicada por Paleta para `src/` preservando plugins personalizados e alterações locais, com verificação instrução por instrução:
  - via [Claude Code](https://claude.com/claude-code): `/update-paletools`;
  - via linha de comando: `npm run upstream:check` e `npm run upstream:update` ([funcionamento detalhado](docs/pt/UPDATING.md)).
- **Nova versão deste repositório:** executar `git pull`, gerar um novo build com `npm run build` e atualizar o script no Tampermonkey ([mais detalhes](docs/pt/UPDATING.md)).

## 6. Documentação

- [Adição de funcionalidades](docs/pt/ADDING-A-FEATURE.md): estrutura e registro de novos plugins.
- [Regras de módulos](docs/pt/MODULE-RULES.md): restrições de escopo e importação exigidas pelo build.
- [Invariantes](docs/pt/INVARIANTS.md): comportamentos sensíveis (sniping, Bulk Buy, inicialização) e defeitos conhecidos.
- [Configurações padrão](docs/pt/SETTINGS.md): persistência em `localStorage` e redefinição de valores.
- [Depuração](docs/pt/DEBUGGING.md): localização de erros e módulos de origem.
- [Testes](docs/pt/TESTING.md): cobertura da suíte de testes e atualização do snapshot de inicialização.
- [Funcionamento do build](docs/pt/BUILD.md): montagem do userscript a partir de `src/`.
- [Comandos](docs/pt/COMMANDS.md): referência dos scripts npm do projeto.
- [Atualização e coexistência com o Paletools oficial](docs/pt/UPDATING.md): port de versões oficiais e sincronização do repositório.
