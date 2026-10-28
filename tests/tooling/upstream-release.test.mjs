// Tests of scripts/upstream/release.mjs. No network: fetchRelease and the CLI are tested against
// a local HTTP server on 127.0.0.1.
//
// The base release (upstream/base.user.js) is replaced by every port, so nothing here assumes its
// version: it is read from upstream/base.json (else from the file). UPSTREAM_BASE_PATH runs these
// tests on another release (see tests/support/upstream-fixtures.mjs).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  LATEST_RELEASE_URL,
  compareVersions,
  fetchRelease,
  findMetadataBlock,
  readMetadata,
  releaseVersion,
  sha256,
} from "../../scripts/upstream/release.mjs";
import { ROOT } from "../../scripts/lib/modules.mjs";
import { metadataHeader, readBaseRelease, SAVED_RELEASES } from "../support/upstream-fixtures.mjs";

const run = promisify(execFile);
const baseRelease = readBaseRelease();
const base = baseRelease.source;
const header = metadataHeader(base);

test("the latest release URL is the one Paletools publishes", () => {
  assert.equal(LATEST_RELEASE_URL, "https://pale.tools/fifa/dist/latest/paletools.user.js");
});

/** Keys a Paletools release has exactly once, and keys it has at least once. */
const SINGLE_KEYS = ["name", "namespace", "version", "description", "updateURL", "downloadURL"];
const LIST_KEYS = ["match", "grant", "connect"];

/** The structure of the metadata of a Paletools release (not its values, which may change). */
function assertReleaseMetadata(entries, version, label) {
  assert.deepEqual(
    entries.slice(0, 3).map((entry) => entry.key),
    ["name", "namespace", "version"],
    `${label}: the block starts with @name, @namespace and @version`,
  );
  assert.equal(entries[2].value, version, `${label}: @version`);
  for (const { key, value } of entries) {
    assert.match(key, /^[\w:-]+$/, `${label}: key ${key}`);
    assert.equal(typeof value, "string", `${label}: @${key}`);
  }
  const values = (key) => entries.filter((entry) => entry.key === key).map((entry) => entry.value);
  for (const key of SINGLE_KEYS) {
    assert.equal(values(key).length, 1, `${label}: one @${key}`);
    assert.notEqual(values(key)[0], "", `${label}: @${key} has a value`);
  }
  for (const key of LIST_KEYS) {
    assert(values(key).length >= 1, `${label}: at least one @${key}`);
    assert(
      values(key).every((value) => value !== "" && !/\s/.test(value)),
      `${label}: @${key}`,
    );
  }
  for (const url of values("match")) assert.match(url, /^https:\/\/[^/]+\//, `${label}: @match`);
  assert(
    values("grant").every((name) => /^[\w.]+$/.test(name)),
    `${label}: @grant names`,
  );
  // The port downloads the release from LATEST_RELEASE_URL: it must stay the release's own.
  assert.deepEqual(values("updateURL"), [LATEST_RELEASE_URL], `${label}: @updateURL`);
}

test("readMetadata lists the @key value lines of the base release in order", () => {
  const entries = readMetadata(base);
  assertReleaseMetadata(entries, baseRelease.version, baseRelease.label);
  assert.deepEqual(readMetadata(header), entries, "the lines of the block only");
  assert.equal(entries.length, header.split("\n").filter((line) => /^\/\/ @/.test(line)).length);
});

test("readMetadata handles CRLF, spacing, localized keys, empty values and outside lines", () => {
  const source = [
    "// @version 0.0.1 (outside the block, ignored)",
    "  //   ==UserScript==  ",
    "//   @name    Spaced   Name   ",
    "// @name:pt-BR Nome",
    "// @noframes",
    "// a comment line without a key",
    "//@version 1.2.3",
    "// ==/UserScript==",
    "// @grant after the block",
    "code();",
  ].join("\r\n");
  assert.deepEqual(readMetadata(source), [
    { key: "name", value: "Spaced   Name" },
    { key: "name:pt-BR", value: "Nome" },
    { key: "noframes", value: "" },
    { key: "version", value: "1.2.3" },
  ]);
  assert.equal(releaseVersion(source), "1.2.3");
  const block = findMetadataBlock(source);
  assert(block.text.startsWith("  //   ==UserScript=="));
  assert(block.text.endsWith("// ==/UserScript=="), "the block ends without its line break");
  assert.equal(source.slice(block.start, block.end), block.text);
});

test("readMetadata and releaseVersion refuse a source without a complete block or @version", () => {
  assert.equal(findMetadataBlock("const a = 1;"), null);
  assert.equal(findMetadataBlock("// ==UserScript==\n// @version 1\n"), null, "no end line");
  assert.throws(() => readMetadata("const a = 1;"), /no ==UserScript== metadata block/);
  assert.throws(() => releaseVersion("const a = 1;"), /no ==UserScript== metadata block/);
  assert.throws(
    () => releaseVersion("// ==UserScript==\n// @name x\n// ==/UserScript=="),
    /no `\/\/ @version` line/,
  );
  assert.throws(
    () => releaseVersion("// ==UserScript==\n// @version\n// ==/UserScript=="),
    /no `\/\/ @version` line/,
  );
});

const releases = SAVED_RELEASES;
const savedFiles = () =>
  fs.readdirSync(releases).filter((name) => /^Paletools-[\d.]+\.js$/.test(name));

test("releaseVersion reads the version of the base release", () => {
  assert.equal(releaseVersion(header), baseRelease.version);
  assert.equal(releaseVersion(base), baseRelease.version);
});

test(
  "upstream/base.json records the version and the SHA-256 of the base release",
  { skip: !baseRelease.info && `no base.json for ${baseRelease.label}` },
  () => {
    assert.equal(baseRelease.info.version, releaseVersion(base));
    assert.equal(baseRelease.info.sha256, sha256(base));
    assert.equal(baseRelease.info.source, LATEST_RELEASE_URL);
  },
);

test(
  "releaseVersion reads the version of every saved release, and their metadata has the same structure",
  {
    skip: !fs.existsSync(releases) && "versoes_paletools/ is not present",
  },
  () => {
    const files = savedFiles();
    assert(files.length > 0, "versoes_paletools/ has releases");
    for (const file of files) {
      const text = fs.readFileSync(path.join(releases, file), "utf8");
      const version = file.replace(/^Paletools-|\.js$/g, "");
      assert.equal(releaseVersion(text), version, file);
      assertReleaseMetadata(readMetadata(metadataHeader(text)), version, file);
    }
  },
);

test("compareVersions compares the numeric parts", () => {
  assert.equal(compareVersions("27.2.1", "27.1.15"), 1);
  assert.equal(compareVersions("27.1.15", "27.1.5"), 1);
  assert.equal(compareVersions("27.1.5", "27.2.1"), -1);
  assert.equal(compareVersions("27.1.5", "27.1.5"), 0);
  assert.equal(compareVersions("27.10", "27.9"), 1, "numbers, not text");
  assert.equal(compareVersions("27.1", "27.1.0"), 0, "missing parts are 0");
  assert.equal(compareVersions("27.1.0.0", "27.1"), 0);
  assert.equal(compareVersions("27.1.5.1", "27.1.5"), 1, "a build number is newer");
  assert.equal(compareVersions("27.01", "27.1"), 0, "leading zeros");
  assert.equal(compareVersions("27", "26.99.99"), 1);
  assert.equal(compareVersions("99999999999999999999.1", "99999999999999999999.0"), 1, "big parts");
});

test("compareVersions sorts the saved releases in release order", () => {
  const versions = [
    "27.1.0",
    "27.0.10",
    "27.2.1",
    "27.0.2",
    "27.1.15",
    "27.0.9",
    "27.1.5",
    "27.2.0",
  ];
  assert.deepEqual(versions.sort(compareVersions), [
    "27.0.2",
    "27.0.9",
    "27.0.10",
    "27.1.0",
    "27.1.5",
    "27.1.15",
    "27.2.0",
    "27.2.1",
  ]);
});

test("compareVersions throws on parts that are not numbers", () => {
  for (const invalid of ["27.x", "27..1", "v27.1", "", "27.1.", " 27.1", "27.1-beta", "-1"])
    assert.throws(() => compareVersions(invalid, "27.1"), TypeError, JSON.stringify(invalid));
  assert.throws(() => compareVersions("27.1", "27.1.a"), /"a" is not a number/);
  assert.throws(() => compareVersions(27, "27"), /must be a string/);
});

test("sha256 hashes text as UTF-8 and buffers as bytes", () => {
  assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256("ç"), sha256(Buffer.from([0xc3, 0xa7])));
});

/** Serves `routes` (path -> { status, body } or "hang") on 127.0.0.1; returns its base URL. */
async function serve(t, routes) {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    const route = routes[request.url];
    if (route === "hang") return; // never answers
    if (!route) {
      response.writeHead(404, { "content-type": "text/plain" });
      return response.end("not found");
    }
    response.writeHead(route.status ?? 200, { "content-type": "text/javascript" });
    response.end(route.body);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

// The local server publishes the base release itself, as pale.tools publishes a release.
const release = base;

test("fetchRelease returns the userscript text", async (t) => {
  const url = await serve(t, { "/latest.user.js": { body: release } });
  const text = await fetchRelease(`${url}/latest.user.js`);
  assert.equal(text, release);
  assert.equal(releaseVersion(text), baseRelease.version);
});

test("fetchRelease reports HTTP errors, non-userscripts, timeouts and refused connections", async (t) => {
  const url = await serve(t, {
    "/error": { status: 500, body: "boom" },
    "/page": { body: "<html>maintenance</html>" },
    "/slow": "hang",
  });
  await assert.rejects(fetchRelease(`${url}/missing`), /could not download .*: HTTP 404 Not Found/);
  await assert.rejects(fetchRelease(`${url}/error`), /HTTP 500/);
  await assert.rejects(fetchRelease(`${url}/page`), /not return a userscript.*==UserScript==/);
  await assert.rejects(fetchRelease(`${url}/slow`, { timeoutMs: 200 }), /timed out after 200 ms/);
  // A port that was just closed refuses the connection.
  const closed = http.createServer();
  await new Promise((resolve) => closed.listen(0, "127.0.0.1", resolve));
  const port = closed.address().port;
  await new Promise((resolve) => closed.close(resolve));
  await assert.rejects(fetchRelease(`http://127.0.0.1:${port}/x`), /could not download/);
});

test("the CLI prints the version (or JSON) of the release at --url", async (t) => {
  const url = await serve(t, { "/latest.user.js": { body: release } });
  const script = path.join(ROOT, "scripts/upstream/release.mjs");
  const plain = await run(process.execPath, [script, "--url", `${url}/latest.user.js`]);
  assert.equal(plain.stdout, `${baseRelease.version}\n`);
  const json = await run(process.execPath, [script, "--url", `${url}/latest.user.js`, "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), {
    url: `${url}/latest.user.js`,
    version: baseRelease.version,
    sha256: sha256(release),
    bytes: Buffer.byteLength(release),
  });
  await assert.rejects(
    run(process.execPath, [script, "--url", `${url}/missing`]),
    (error) => error.code === 1 && /HTTP 404/.test(error.stderr),
  );
});
