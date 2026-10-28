# Atualização

[English](../UPDATING.md) | Português (Brasil) | [Español](../es/UPDATING.md)

Existem dois tipos de atualização:

- **Nova versão oficial do Paletools** (publicada por Paleta em `https://pale.tools/fifa/dist/latest/paletools.user.js`): portar as alterações para `src/` com as ferramentas upstream descritas abaixo.
- **Nova versão deste projeto** (novos commits no repositório): `git pull`, consultar [Obtenção de uma nova versão deste projeto](#obtenção-de-uma-nova-versão-deste-projeto).

## Nova versão oficial do Paletools

`src/` acompanha uma versão oficial específica, sua **base**: `upstream/base.user.js` contém essa versão exatamente como publicada, byte por byte, e `upstream/base.json` registra seu número de versão. Quando o Paletools publica uma versão mais recente, as ferramentas de atualização portam cada alteração para `src/`, preservam todas as modificações deste projeto (Player Snipe, Bulk Buy, plugins em `src/custom-plugins.js` e edições em módulos nativos) e verificam a equivalência estrutural do resultado.

### Com o Claude Code (recomendado)

Executar `/update-paletools` no Claude Code dentro da pasta do projeto. O comando executa as ferramentas abaixo, resolve conflitos pendentes, organiza o código novo em módulos com nomes descritivos e comentários, executa todas as verificações e resume o que mudou. É necessário fazer commit do trabalho local antes de iniciar (incluindo `upstream/`): a atualização recusa a execução enquanto os arquivos que ela modifica (`src/`, `upstream/`, `package.json`, `package-lock.json`, `README.md`, `tests/userscript/`) tiverem alterações não commitadas, garantindo que `git diff` mostre apenas as mudanças do port.

### Via linha de comando

```sh
npm run upstream:check     # verifica se há versão nova (-- --exit-code retorna código 10 quando há)
npm run upstream:update    # porta a versão mais recente para src/
npm run upstream:verify    # compara src/ com o programa esperado (executar após cada edição)
```

`npm run upstream:update` exibe um resumo e grava `.upstream/<versão>/report.md`. Quando termina com "done", o port está completo e verificado: a nova versão passa a ser a base e o snapshot de inicialização é regravado. Quando termina com "ported, with work left" (código de saída 2: conflitos, erros de regras de módulos, diferenças, alteração no runtime do webpack ou outros problemas), o relatório lista as pendências: resolver os itens apontados, executar `npm run upstream:verify` até obter "equivalent" e, em seguida, `npm run upstream:verify -- --finish` para registrar a nova base (adicionar `--conflicts-resolved` quando houver conflitos, após revisar cada um deles). Até a conclusão, `npm run upstream:update` impede o início de outro port.

O código novo adicionado pela versão oficial chega com identificadores originais (`_0x...`), e blocos grandes são alocados em novos módulos dentro de `src/upstream-new/<versão>/`. O userscript já se comporta de forma idêntica à versão oficial; renomear e mover esse código para módulos definitivos visa manter a legibilidade (processo automatizado por `/update-paletools`; para execução manual, seguir a seção 3 de [.claude/skills/update-paletools/SKILL.md](../../.claude/skills/update-paletools/SKILL.md)). Por fim, executar `npm run verify`, `npm run build` e instalar o novo `dist/paletools.user.js`.

Opções de `npm run upstream:update -- <opções>` (o `--` é obrigatório para repassar os argumentos ao script). Opções desconhecidas retornam erro (código de saída 64).

| Opção           | Efeito                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| `--file <path>` | Porta um arquivo de versão baixado localmente em vez de buscar a versão mais recente pela rede.         |
| `--url <url>`   | Baixa a versão a partir de outro endereço.                                                              |
| `--dry-run`     | Calcula o port e grava o relatório em `.upstream/<versão>/dry-run/`, sem modificar arquivos do projeto. |
| `--force`       | Executa o port mesmo que a versão não seja mais recente que a base ou que haja um port inacabado.       |
| `--allow-dirty` | Permite executar com alterações não commitadas em `src/` (perdendo a separação limpa no `git diff`).    |

`npm run upstream:status` lista todos os pontos em que `src/` difere da versão base: as modificações próprias deste projeto.

### Funcionamento do port

1. A base e a nova versão são desofuscadas (`scripts/upstream/deobfuscate.mjs`): a tabela de strings é decodificada estaticamente (sem executar código da versão), e números hexadecimais, `!0`/`!1` e acessos `obj["nome"]` são normalizados. Todo o Paletools reside em um único módulo webpack da versão oficial, cujo id e identificadores (`_0x...`) mudam a cada lançamento.
2. `src/` é compilado, e os três programas (base, nova versão e build de `src/`) são alinhados instrução por instrução (`scripts/upstream/lib/align.mjs`). A comparação ignora nomes e construções de minificador (`a && b()` equivale a `if (a) b();`), mapeando automaticamente cada identificador `_0x...` aos nomes correspondentes em `src/`.
3. Um merge de três vias (`scripts/upstream/lib/merge.mjs`) aplica as alterações da nova versão (em relação à base) sobre o build de `src/`, chegando ao nível de expressões individuais, elementos de listas e propriedades de objetos. Onde a versão oficial e este projeto modificaram o mesmo trecho de formas incompatíveis, registra-se um **conflito** e preserva-se a versão deste projeto naquele ponto (aplicando normalmente as demais alterações ao redor).
4. O resultado é aplicado aos módulos de `src/` (`scripts/upstream/lib/apply-src.mjs`): trechos modificados recebem patch local preservando nomes, comentários e formatação; código novo é emitido com os nomes de `src/` para vínculos existentes; CSS, imagens e arquivos de dados alterados são atualizados; mudanças de tradução vão para `src/i18n/`; instruções são posicionadas conforme a ordem de avaliação da versão oficial (blocos novos grandes geram novos módulos listados na respectiva posição em `src/manifest.json`; módulos reordenados pela versão são movidos no manifesto); novas funções são alocadas no módulo que exige menos imports adicionais sem criar ciclos. Em seguida, imports e exports são corrigidos (`scripts/upstream/lib/fix-links.mjs`), novas variáveis globais do Web App são incluídas em `src/external-globals.json`, o número de versão é atualizado nos arquivos correspondentes, novos metadados (como `@connect`) são adicionados a `src/userscript-header.js` e o código é formatado.
5. **Verificação.** O mesmo merge, aplicado na direção inversa (modificações deste projeto sobre a nova versão oficial), gera o programa esperado. O build de `src/` deve ser estruturalmente equivalente a ele (`scripts/upstream/lib/equivalence.mjs`: mesmas instruções na mesma ordem, mesmos operadores, propriedades e literais, renomeação consistente de vínculos, permitindo movimentação de declarações de função). Em pontos de conflito, o programa esperado também mantém a versão deste projeto, evitando falsos positivos na verificação.
6. Quando o build é equivalente e não restam pendências (sem conflitos, erros de regras de módulos ou alterações no runtime do webpack), a nova versão é registrada como base e o snapshot de inicialização (`tests/userscript/boot-fingerprint.snapshot.json`) é atualizado automaticamente.

### Escopo da verificação

- Comprova que o build de `src/` equivale à nova versão oficial somada às alterações deste projeto, instrução por instrução, exceto nas instruções de topo que contêm conflitos: estas ficam fora da comparação automática e são listadas por `npm run upstream:verify` para revisão manual.
- O código fora do módulo principal do Paletools (o runtime do webpack) também é comparado; caso a versão oficial o altere, o relatório indica a necessidade de portá-lo manualmente para `src/runtime/webpack-runtime.js`.
- Assim como o restante da suíte de testes, a verificação não executa o script no Web App real.
- Defeitos existentes na versão oficial são preservados intencionalmente e documentados em [Invariantes](INVARIANTS.md).

### Código personalizado

- Plugins listados em `src/custom-plugins.js` e módulos exclusivos deste projeto não são alterados pelo port. Caso a versão oficial remova uma função ou valor nativo utilizado por um módulo personalizado, a atualização mantém o código necessário e relata um conflito do tipo `"removed-but-used"`. Manter funcionalidades próprias em módulos isolados (conforme [Adição de funcionalidades](ADDING-A-FEATURE.md)) garante compatibilidade direta nas atualizações.
- Edições feitas diretamente em módulos nativos são preservadas; caso a versão oficial modifique o mesmo trecho, um conflito é gerado no relatório com o comparativo entre base, código local e nova versão.
- Configurações, chaves do `localStorage` e chaves de tradução nunca são renomeadas por uma atualização.

### Arquivos utilizados

| Caminho                     | Descrição                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `upstream/base.user.js`     | Versão oficial que `src/` acompanha (versionada no git e substituída a cada atualização concluída).                                           |
| `upstream/base.json`        | Número de versão e hash SHA-256 da base atual.                                                                                                |
| `.upstream/<versão>/`       | Arquivos temporários de trabalho de um port (não versionados): versões desofuscadas, programa esperado, build anterior, `report.md` e estado. |
| `src/upstream-new/<versão>` | Código novo de uma versão oficial aguardando organização em módulos definitivos.                                                              |

### Solução de problemas

- **"src/ has uncommitted changes"**: fazer commit ou guardar as alterações no stash (`git stash`) antes de executar a atualização.
- **Reverter um port**: `git restore -- src upstream tests/userscript package.json package-lock.json README.md` restaura os arquivos rastreados; `git clean -fd src` remove os arquivos criados pelo port (executar `git clean -nd src` antes para conferir a lista). Remover também `.upstream/<versão>/`.
- **"the port to ... is not finished"**: finalizar com `npm run upstream:verify -- --finish` ou reverter o port conforme o item anterior.
- **"upstream/base.user.js is not the release recorded"**: o arquivo base foi modificado; restaurar com `git restore upstream`.
- **Falha no download**: baixar o arquivo manualmente e utilizar `--file <caminho>`.
- **`upstream:verify` aponta diferenças após edições manuais**: alguma edição alterou o comportamento ou a ordem de avaliação. A saída indica a instrução divergente no programa esperado e no build atual, junto ao respectivo módulo.

## Obtenção de uma nova versão deste projeto

```sh
git pull
npm ci          # necessário apenas quando package-lock.json for atualizado
npm run build
```

Em seguida, atualizar o conteúdo do script no Tampermonkey com o novo `dist/paletools.user.js`.

O script gerado não define `@updateURL` nem `@downloadURL`, de modo que o Tampermonkey nunca substitui o build local automaticamente.

## Coexistência com o Paletools oficial

- O metadado `@name` é definido como `open-paletools` (diferente do `Paletools` oficial), permitindo que o Tampermonkey mantenha os dois scripts separados. Caso o nome seja alterado em [`src/userscript-header.js`](../../src/userscript-header.js), manter um identificador distinto do oficial.
- Manter o Paletools oficial desativado enquanto este script estiver em uso para evitar duplicação de botões e hooks.
- Ambos compartilham as mesmas configurações salvas na chave `paletools:settings` do `localStorage` do Web App (consultar [Configurações padrão](SETTINGS.md)).
- O aviso de atualização exibido dentro do Web App (plugin Check for Updates) refere-se ao lançamento oficial em `pale.tools`: clicar para instalar a partir dele instalará o script oficial, servindo apenas como indicador de que há uma nova versão disponível para ser portada com `/update-paletools` ou `npm run upstream:update`.
