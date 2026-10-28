# Regras de módulos

[English](../MODULE-RULES.md) | Português (Brasil) | [Español](../es/MODULE-RULES.md)

O build reúne todos os módulos em um único escopo compartilhado, seguindo a ordem definida em [`src/manifest.json`](../../src/manifest.json), assim como no bundle original. `npm run build` e `npm run check:modules` validam as regras abaixo antes de gerar qualquer arquivo.

- Imports devem ser nomeados e apontar para módulos listados no manifesto: `import { a, b } from "./file.js"`. Exports devem ser declarações diretas (`export function`, `export const`, `export let` ou `export class`). Não são permitidos aliases (`as`), `export default`, listas de exportação, re-exports, imports de namespace (`* as`) nem imports apenas por efeito colateral.
- Todo identificador utilizado por um módulo deve ser declarado localmente, importado de outro módulo ou listado em [`src/external-globals.json`](../../src/external-globals.json).
- Identificadores de nível de topo (top-level), incluindo nomes de recursos importados, devem ser únicos em todo o projeto.
- Não são permitidos ciclos de importação nem imports ou exports sem uso.
- Variáveis importadas não podem receber nova atribuição (exceto vínculos `export let` anotados com `@mutable` em seu comentário). A mutação de propriedades de objetos exportados é permitida.
- O código de nível de topo de um módulo é avaliado na ordem do manifesto; portanto, não deve ler variáveis, constantes ou classes declaradas em módulos posicionados depois dele no manifesto, nem diretamente nem por funções chamadas durante a inicialização.
- Não utilizar `import.meta`, nem `await` ou `this` no nível de topo.
- Arquivos estáticos podem ser importados como recursos embutidos: `.css`, `.txt` e `.js.txt` como texto, `.svg`/`.png`/`.webp` como data URIs e `.gz` como base64 (`import styles from "./my-feature.css"`). O conteúdo é embutido byte por byte.
- Alterar a ordem de `src/manifest.json` altera a ordem de inicialização do código: manter a sequência existente, salvo quando a mudança for intencional.

A implementação dessas verificações encontra-se em [`scripts/check-modules.mjs`](../../scripts/check-modules.mjs).
