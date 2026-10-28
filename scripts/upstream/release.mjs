#!/usr/bin/env node
// Upstream release utilities: download the latest Paletools release, read its ==UserScript==
// metadata block, compare versions and hash the files.
//
//   node scripts/upstream/release.mjs [--url <url>] [--json]
//
// prints the @version of the release published at <url> (default: LATEST_RELEASE_URL). With
// --json it prints { url, version, sha256, bytes } instead. Used by the upstream check (is
// src/ behind the latest release?) and by the update tools of scripts/upstream/.
import { createHash } from "node:crypto";
import { isMainModule } from "../lib/ast.mjs";

/** Where Paletools publishes its latest release. */
export const LATEST_RELEASE_URL = "https://pale.tools/fifa/dist/latest/paletools.user.js";

const BLOCK_START = /^[ \t]*\/\/[ \t]*==UserScript==[ \t]*\r?$/m;
const BLOCK_END = /^[ \t]*\/\/[ \t]*==\/UserScript==[ \t]*\r?$/m;
const METADATA_LINE = /^[ \t]*\/\/[ \t]*@(\S+)(?:[ \t]+(.*?))?[ \t]*$/;

/**
 * Downloads a release and returns its text. Throws a clear error when the request fails or times
 * out, on an HTTP error status, and when the body is not a userscript (no ==UserScript== block).
 */
export async function fetchRelease(url = LATEST_RELEASE_URL, { timeoutMs = 60000 } = {}) {
  let response;
  let body;
  try {
    // The timeout covers the whole download, body included.
    const signal = AbortSignal.timeout(timeoutMs);
    response = await fetch(url, { signal });
    if (response.ok) body = await response.text();
    else await response.body?.cancel();
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError")
      throw new Error(`downloading ${url} timed out after ${timeoutMs} ms`, { cause: error });
    const reason = error.cause?.code ?? error.cause?.message ?? error.message;
    throw new Error(`could not download ${url}: ${reason}`, { cause: error });
  }
  if (!response.ok)
    throw new Error(
      `could not download ${url}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    );
  if (!findMetadataBlock(body))
    throw new Error(`${url} did not return a userscript: the body has no ==UserScript== block`);
  return body;
}

/**
 * Locates the first ==UserScript== metadata block of `source`. Returns { start, end, text }, where
 * `start` is the offset of the `// ==UserScript==` line and `end` the offset right after
 * `// ==/UserScript==` (its line break excluded), or null when there is no complete block.
 */
export function findMetadataBlock(source) {
  const start = BLOCK_START.exec(source);
  if (!start) return null;
  const afterStart = start.index + start[0].length;
  const end = BLOCK_END.exec(source.slice(afterStart));
  if (!end) return null;
  const endOffset = afterStart + end.index + end[0].replace(/\r$/, "").length;
  return { start: start.index, end: endOffset, text: source.slice(start.index, endOffset) };
}

/**
 * The `// @key value` lines of the ==UserScript== block, in order, as { key, value } (keys may
 * repeat, e.g. @match; a key without a value gets ""). Throws when there is no metadata block.
 */
export function readMetadata(source) {
  const block = findMetadataBlock(source);
  if (!block) throw new Error("the userscript has no ==UserScript== metadata block");
  const entries = [];
  for (const line of block.text.split(/\r?\n/)) {
    const match = METADATA_LINE.exec(line);
    if (match) entries.push({ key: match[1], value: match[2] ?? "" });
  }
  return entries;
}

/** The @version of a userscript (the first one). Throws when it is missing or empty. */
export function releaseVersion(source) {
  const entry = readMetadata(source).find((item) => item.key === "version");
  if (!entry || entry.value === "")
    throw new Error("the userscript metadata block has no `// @version` line");
  return entry.value;
}

function versionParts(version) {
  if (typeof version !== "string")
    throw new TypeError(`a version must be a string, got ${typeof version}`);
  return version.split(".").map((part) => {
    if (!/^\d+$/.test(part))
      throw new TypeError(`invalid version "${version}": "${part}" is not a number`);
    return BigInt(part);
  });
}

/**
 * Compares two dot-separated numeric versions: -1 when a < b, 0 when equal, 1 when a > b. Parts
 * compare as numbers (27.2.1 > 27.1.15 > 27.1.5) and missing parts count as 0 (27.1 = 27.1.0).
 * Throws a TypeError on a part that is not a decimal number (27.x, 27..1, v27, "").
 */
export function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index] ?? 0n;
    const y = right[index] ?? 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** SHA-256 of a text (UTF-8) or a buffer, as lowercase hexadecimal. */
export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function main(argv) {
  let url = LATEST_RELEASE_URL;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === "--url" && argv[index + 1]) url = argv[++index];
    else if (argument === "--json") json = true;
    else
      throw new Error(`usage: release.mjs [--url <url>] [--json] (unknown argument ${argument})`);
  }
  const source = await fetchRelease(url);
  const version = releaseVersion(source);
  if (json)
    console.log(
      JSON.stringify(
        { url, version, sha256: sha256(source), bytes: Buffer.byteLength(source) },
        null,
        2,
      ),
    );
  else console.log(version);
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
