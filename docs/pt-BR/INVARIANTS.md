# Invariantes e comportamentos sensíveis

[English](../INVARIANTS.md) | Português (Brasil) | [Español](../es/INVARIANTS.md)

Este documento reúne regras e comportamentos que podem ser quebrados inadvertidamente durante modificações. Os detalhes específicos de cada módulo encontram-se no comentário de cabeçalho do respectivo arquivo em `src/`.

## 1. Estrutura e inicialização

- **Escopo único, ordem do manifesto.** O build concatena os módulos de `src/manifest.json` dentro do módulo 723 do runtime original do webpack. A ordem do manifesto define a ordem de inicialização: instruções de topo com efeitos colaterais (patches de protótipo, `JSUtils.inherits`, `new ...()`) dependem dela. Declarações de função sofrem hoisting e podem residir em qualquer módulo.
- **Runtime do webpack** (`src/runtime/webpack-runtime.js`, não editar), incluindo os módulos vazios 491 e 831: `importModule(491)` e `getEmptyModule831Default()` são executados durante a inicialização e devem ser mantidos.
- **Inicialização / Boot** (`src/bootstrap/boot.js`): `bootWhenWebAppReady` executa imediatamente se `document.body` existir (ou em `DOMContentLoaded`) e repete a tentativa a cada 1 s até que `.ut-login` não esteja presente e `services.Localization` e `services.Authentication.utasSession.url` existam. Em seguida: criação de iframe oculto para restaurar `console`, ajuste de classes de dispositivo móvel (`phone`), chamada única a `applyWebAppPatches()`, inicialização do banco IndexedDB e chamada a `initializePluginsWhenReady` (caso `.ut-tab-bar` ainda não exista, agenda nova tentativa em 1 s e retorna). `getAppMain()._ptBooted` é definido ao final de `bootWhenWebAppReady`, o que pode ocorrer antes da execução dos plugins: tentativas iniciadas após a definição da flag são ignoradas, mas outra instância do script (como o Paletools oficial) cuja verificação tenha iniciado antes também completará a inicialização.
- **Lista de plugins.** A lista literal de plugins nativos em `initializePluginsWhenReady`, a entrada `getEmptyModule831Default()` (um objeto `{}`), o comparador `left.order - right.order` e a chamada a `Array.prototype.sort` devem permanecer inalterados: algumas entradas não possuem `order`, fazendo o comparador retornar `NaN` e tornando a ordenação dependente da posição original dos itens na lista. Reordenar, adicionar ou remover entradas na lista nativa, ou alterar o comparador, modifica a ordem de execução dos plugins e o encadeamento de hooks. Novos plugins devem ser registrados exclusivamente em `src/custom-plugins.js`, cuja lista é concatenada após a ordenação dos plugins nativos e executada antes do plugin de configurações.
- **Ausência de isolamento de erros.** Se o método `run()` de qualquer plugin lançar uma exceção, os plugins seguintes, o menu de configurações e os eventos `APP_LOADED`/`APP_STARTED` deixam de ser executados.
- **Encadeamento de hooks.** Múltiplos plugins sobrescrevem os mesmos métodos (como `UTMarketSearchFiltersView.prototype._generate`), cada um invocando a implementação anterior. A ordem de execução dos plugins determina o aninhamento. Sobrescritas diretas devem continuar invocando a função capturada; o mecanismo em `src/core/prototype-override.js` reutiliza um único wrapper por método (suportando prioridade, `cancel`, `setArgs`, `setResult` e `once`).

## 2. Player snipe (`src/plugins/player-snipe/`, `market-automation/`)

- **Confirmação.** O botão permanece habilitado apenas na tela visível de filtros, com um jogador selecionado e um `Buy Now Price Max` inteiro válido (200–14.999.000, alinhado aos incrementos de preço). O diálogo exibe o jogador e o preço máximo; ao acionar **Confirm**, todas as condições são revalidadas (controller visível, mesmo jogador, mesmo máximo e filtro Player ID compatível). Cada busca repete a verificação e encerra a sessão caso o jogador ou o preço máximo tenham sido alterados.
- **Identidade.** Qualquer versão do mesmo jogador é aceita (mesmo `definitionId` ou mesmo id base via `ItemIdMask.DATABASE`); `defId` e o campo Player ID devem compartilhar o mesmo id base.
- **Primeira oferta elegível.** Filtra as ofertas ativas do jogador com `buyNowPrice` inteiro no intervalo `(0, máximo]` e compra `items[0]` **na ordem retornada pelo servidor** (sem ordenação por preço), encerrando a sessão após a primeira compra confirmada.
- **Progressão de preços mínimos** (`getNextPlayerSnipePrices`): inicia em `{minBid: 0, minBuy: 0}`; a cada ciclo avança `minBuy` em um incremento de preço do Mercado de Transferências (`UTCurrencyInputControl.getIncrementAboveVal`); quando `minBuy` atingiria `máximo / 2`, avança `minBid` e iguala `minBuy` a ele. **Mantém sempre `minBuy < máximo / 2` (estrito).** Quando `minBid` não puder mais avançar, o ciclo reinicia em 0/0 sem interromper a sessão.
- **Pausas variáveis** (`createPlayerSnipeTiming`): valores inteiros em milissegundos — busca (`search`) 80–180, retorno (`return`) 70–160, ajuste (`adjust`) 30–90, compra (`buy`) 15–55 — nunca repetindo a pausa imediatamente anterior (global) nem a pausa anterior da mesma ação.
- **Proteção contra eventos CHANGE.** Os setters nativos de preço emitem eventos CHANGE e os handlers `e*PriceChanged` normalizam os mínimos (`minBid < minBuy`). Durante uma sessão ativa, esses handlers são cancelados via hooks (`prototypeOverride.cancel()`); a busca grava os preços no DTO, invoca os setters e regrava os valores no DTO. O cancelamento depende apenas de `activePlayerSnipeSession`; `triggeringSearch` apenas distingue buscas da sessão de buscas manuais, e `applyingFilters` é atribuído mas não lido.
- **Captura da busca.** O wrapper de `services.Item.searchTransferMarket` entrega o observable à busca pendente somente se ainda não tiver sido capturado e se `maxBuy`, `minBid` e `minBuy` coincidirem. Deve permanecer como o wrapper mais externo (instalado na ordem 10010).
- **Stop (Parar).** Aborta o sinal (`signal`), impedindo novas buscas ou compras. **Uma requisição de compra já enviada continua sendo observada sem o sinal de aborto** (sujeita apenas ao timeout de 30 s) e, se confirmada pelo servidor, é contabilizada. Buscas manuais (`eSearchSelected` fora da sessão), redefinição de filtros e desativação do Paletools também encerram a sessão.

## 3. Bulk Buy — Compra em massa (`src/plugins/bulk-buy/`, `market-automation/`)

- **Plano** (`validateBulkBuyPlan`): composto por linhas de OVR (1–99), preço máximo (200–14.999.000, múltiplo do incremento da respectiva faixa: ≤1.000→50, ≤10.000→100, ≤50.000→250, ≤100.000→500, acima→1.000) e quantidade (inteiro positivo). **A soma dos custos máximos deve ser estritamente menor que o saldo de moedas.**
- **Revalidação de orçamento.** Executada no diálogo a cada edição e a cada evento `USER_CURRENCY_UPDATE`; ao acionar **Run**, valida o plano, atualiza o saldo junto ao servidor, valida novamente, fecha o diálogo e revalida em `startBulkBuy`. Antes de cada lance, o custo máximo das unidades restantes deve ser estritamente menor que `min(saldo atual, saldo inicial − gasto)`.
- **Contabilização.** Apenas compras confirmadas com preço inteiro em `(0, máximo da linha]` são contabilizadas.
- **OVR exato com paginação.** O Mercado de Transferências não filtra por OVR exato no servidor: cada página busca cartas até o preço máximo com `disableOverrides: true` e filtra `rating === OVR` localmente; páginas sem candidatos elegíveis também são percorridas; o tamanho da página segue a configuração da EA com leitura antecipada (lookahead) para detectar páginas seguintes. Após cada compra confirmada, a busca da linha reinicia da primeira página.
- **Deduplicação.** Cada leilão (`tradeId`) é tentado no máximo uma vez por execução, registrando-se a chave antes do envio do lance.
- **Ofertas perdidas.** Respostas 462/478/479 da EA (com os respectivos códigos HTTP) são ignoradas sem interromper a execução; qualquer outro erro encerra o processo.
- **Stop (Parar).** Mesmo comportamento do sniping: impede novas compras e aguarda a conclusão de eventual compra já enviada.

## 4. Exclusão mútua entre as duas automações

`src/plugins/market-automation/sessions.js` centraliza as variáveis de estado `activePlayerSnipeSession`, `playerSnipeConfirmation`, `activeBulkBuySession` e `bulkBuyConfirmation`. Enquanto qualquer uma delas estiver ativa, nenhuma das duas automações abre diálogo ou inicia nova sessão, mantendo ambos os botões desabilitados. A centralização em um único módulo evita ciclos de importação.

## 5. Automações upstream que realizam compras (Paletools 27.2.1)

Originadas da versão oficial do Paletools, **não** participam da exclusão mútua descrita na seção 4 e compartilham os limites de requisições da conta no Mercado de Transferências:

- **Auto Snipe** (`src/plugins/auto-snipe/`): desativado por padrão; sua ativação exige confirmação (`plugins.dangerous`). Executa apenas em sua tela própria (bloco na central de Transferências) enquanto o Paletools e o Auto Snipe estiverem habilitados, parando ao sair da tela ou ao desativar a opção. Cada busca e cada compra contam como uma tentativa (`maxSnipes`), e as cartas adquiridas contam para `maxCards`; compra todas as ofertas ativas até o preço máximo, ordenadas da mais barata para a mais cara. Seus filtros embutidos executam os hooks de `market-search-filters` e recebem os botões Snipe Player e Bulk Buy, que são ocultados pela folha de estilos do próprio Auto Snipe.
- **Botão de compra do álbum e da galeria** (`src/plugins/album/album-view-controller.js`): desativado por padrão (`album.buyEnabled`, `gallery.buyEnabled`, confirmado com `plugins.dangerous`); realiza uma compra por vez da oferta ativa mais barata da carta selecionada, mediante confirmação em diálogo e desde que o preço permaneça inalterado.

## 6. Dados persistidos e identificadores externos

Não devem ser renomeados: chaves do `localStorage` (ex.: `paletools:settings`, `paletools:searchFilters`), nomes de bancos e stores do IndexedDB, chaves de configuração (`configuration.plugins.<nome>`), chaves de tradução, nomes de eventos (`paletools:*`), ids/classes CSS referenciados por estilos ou atalhos, e métodos adicionados a protótipos do Web App invocados por nome em outros módulos.

## 7. Defeitos conhecidos herdados do script original

Defeitos preexistentes no Paletools original foram preservados intencionalmente para manter equivalência de comportamento. A relação completa consta na seção `"Known issues (kept as-is)"` do cabeçalho de cada módulo. Qualquer correção altera o comportamento original e requer validação com `npm test`.

- Identificadores não declarados — `saveConfiguration`, `updateConfiguration`, `addStyles`, `removeStyles`, `remove`, `i`, `info` e uma ocorrência de `response` — lançam `ReferenceError` se os respectivos caminhos de código forem executados (listados em `src/external-globals.json`, `undeclaredInOriginal`).
- `hasClass("phone")` na inicialização é invocado sem elemento.
- O comparador da lista de plugins retorna `NaN` para entradas sem propriedade `order` (ver seção 1).
- Os transformadores de resultados do mercado (`src/webapp/patches.js`) são aplicados às buscas do Player Snipe (que não utilizam `disableOverrides`). Com a opção de ocultar duplicados (`marketSearchFilters.hideDuplicates`) ativada, ofertas cujo `definitionId` já exista no clube são filtradas antes de chegarem ao sniping. Desde a versão 27.2.1, o mesmo ocorre para ofertas fora da faixa de OVR definida em `marketSearchFilters.playerRating`. O Bulk Buy e o Auto Snipe não são afetados por utilizarem `disableOverrides: true`.

Defeitos introduzidos na versão 27.2.1 do Paletools e preservados pelo port:

- Club Analyzer: a versão 27.2.1 removeu a inicialização de `counters.rare`, mas manteve o incremento para jogadores raros (`rareflag` 1), lançando `TypeError` no primeiro jogador raro do clube (não empréstimo) e interrompendo a conclusão da análise.
- Filtros de busca de mercado: o transformador de resultados holográfico/OVR executa mesmo com o Paletools desativado, e `handlePlayerIdChange` atribui `defId = []` no controller ativo mesmo quando este não é um controller de filtros de mercado.
