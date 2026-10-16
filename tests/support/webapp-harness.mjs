// Boots a complete userscript inside a simulated EA Web App and records what it does.
//
// Every global the script uses but the harness does not model (EA classes such as
// `UTMarketSearchView`, `services`, `repositories`, ...) becomes a recording stub: calls,
// property writes and prototype overrides on it are appended to the trace, in order. A small
// fake DOM records stylesheets, listeners and dispatched events. Time and randomness are fixed,
// so the trace is a deterministic fingerprint of the script's initialization. No network,
// storage or account action can happen: nothing real is reachable from the sandbox.
import vm from "node:vm";
import { analyze } from "eslint-scope";
import { parse } from "acorn";

const FIXED_TIME = 1_700_000_000_000;

/** Free identifiers referenced by a script (excluding the sandbox's own builtins). */
export function freeGlobals(source) {
  const program = parse(source, { ecmaVersion: 2024, sourceType: "script", ranges: true });
  const manager = analyze(program, { ecmaVersion: 2022, sourceType: "script" });
  return [...new Set(manager.globalScope.through.map((reference) => reference.identifier.name))];
}

/**
 * V8 quotes source expressions in some messages ("value.sort is not a function"). Local names
 * are not behavior, so they are removed; property names and string messages are kept.
 */
export function normalizeErrorMessage(message) {
  return String(message)
    .replace(/\s+/g, " ")
    .replace(
      /^.+ is not (a function or its return value is not iterable|a function|iterable|a constructor)$/,
      "<expression> is not $1",
    )
    .replace(
      /Cannot access '[^']+' before initialization/,
      "Cannot access <binding> before initialization",
    )
    .slice(0, 160);
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619) >>> 0;
  }
  return value.toString(16).padStart(8, "0");
}

/**
 * Values returned instead of stubs for a few properties that drive the boot sequence:
 * the Web App has not booted Paletools yet and the user session is established.
 */
export const DEFAULT_PRESETS = Object.freeze({
  "getAppMain()._ptBooted": false,
  "services.Authentication.utasSession.url": "https://utas.example/ut/game/fc",
});

export function createWebAppHarness({ isPhone = false, presets = DEFAULT_PRESETS } = {}) {
  const trace = [];
  const record = (entry) => trace.push(entry);
  const stubs = new Map();
  const timers = [];
  const presetValues = new Map(Object.entries(presets));
  const overrides = []; // prototype methods installed by the script, in installation order

  const describe = (value) => {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (stubPaths.has(value)) return `<${stubPaths.get(value)}>`;
    switch (typeof value) {
      case "string":
        return value.length > 60
          ? `"${value.slice(0, 40)}…#${hash(value)}"`
          : JSON.stringify(value);
      case "number":
      case "boolean":
        return String(value);
      case "function":
        return "fn";
      case "symbol":
        return "symbol";
      default:
        if (value instanceof FakeElement) return `<${value.tagName}>`;
        return Array.isArray(value) ? `[${value.length}]` : "{…}";
    }
  };

  // ------------------------------------------------------------------ recording stubs
  const stubPaths = new WeakMap();
  function stub(path) {
    if (stubs.has(path)) return stubs.get(path);
    const store = new Map();
    const target = function () {};
    let prototype;
    const proxy = new Proxy(target, {
      get(_target, property) {
        if (store.has(property)) return store.get(property);
        if (property === "prototype") {
          prototype ??= prototypeStub(path);
          return prototype;
        }
        if (property === Symbol.toPrimitive) return (hint) => (hint === "number" ? 0 : "");
        if (property === Symbol.iterator) return function* () {};
        if (property === Symbol.hasInstance) return () => false;
        if (property === "then" || typeof property === "symbol") return undefined;
        if (property === "toString" || property === "toJSON") return () => "";
        if (property === "valueOf") return () => 0;
        if (property === "length") return 0;
        if (property === "name") return path;
        if (presetValues.has(`${path}.${property}`)) return presetValues.get(`${path}.${property}`);
        return stub(`${path}.${property}`);
      },
      set(_target, property, value) {
        record(`set ${path}.${String(property)} = ${describe(value)}`);
        store.set(property, value);
        return true;
      },
      defineProperty(_target, property, descriptor) {
        record(`define ${path}.${String(property)}`);
        store.set(property, descriptor.value ?? descriptor.get?.call(proxy));
        return true;
      },
      deleteProperty(_target, property) {
        record(`delete ${path}.${String(property)}`);
        store.delete(property);
        return true;
      },
      has(_target, property) {
        return store.has(property);
      },
      apply(_target, _this, args) {
        record(`call ${path}(${args.map(describe).join(", ")})`);
        return stub(`${path}()`);
      },
      construct(_target, args) {
        record(`new ${path}(${args.map(describe).join(", ")})`);
        return stub(`new ${path}`);
      },
    });
    stubPaths.set(proxy, path);
    stubs.set(path, proxy);
    return proxy;
  }
  function prototypeStub(path) {
    const store = new Map();
    return new Proxy(
      {},
      {
        get(_target, property) {
          if (store.has(property)) return store.get(property);
          if (typeof property === "symbol") return undefined;
          return stub(`${path}.prototype.${property}`);
        },
        set(_target, property, value) {
          record(`override ${path}.prototype.${String(property)} = ${describe(value)}`);
          store.set(property, value);
          if (typeof value === "function")
            overrides.push({ name: `${path}.prototype.${String(property)}`, value });
          return true;
        },
        has(_target, property) {
          return store.has(property) || typeof property === "string";
        },
      },
    );
  }

  // ------------------------------------------------------------------ fake DOM
  class FakeClassList {
    constructor(element) {
      this.element = element;
    }
    get values() {
      return this.element.className.split(/\s+/).filter(Boolean);
    }
    add(...names) {
      this.element.className = [...new Set([...this.values, ...names])].join(" ");
    }
    remove(...names) {
      this.element.className = this.values.filter((name) => !names.includes(name)).join(" ");
    }
    toggle(name, force) {
      const enabled = force ?? !this.contains(name);
      if (enabled) this.add(name);
      else this.remove(name);
      return enabled;
    }
    contains(name) {
      return this.values.includes(name);
    }
  }
  class FakeElement {
    constructor(tagName) {
      this.tagName = String(tagName).toLowerCase();
      this.nodeName = this.tagName.toUpperCase();
      this.children = [];
      this.parentNode = null;
      this.attributes = new Map();
      this.listeners = new Map();
      this.style = {
        setProperty(name, value) {
          this[name] = value;
        },
        removeProperty(name) {
          delete this[name];
        },
        getPropertyValue(name) {
          return this[name] ?? "";
        },
      };
      this.dataset = {};
      this.className = "";
      this.classList = new FakeClassList(this);
      this.id = "";
      this.textContent = "";
      this.innerHTML = "";
      this.value = "";
      if (this.tagName === "iframe") this.contentWindow = { console: makeConsole() };
    }
    get parentElement() {
      return this.parentNode;
    }
    get childNodes() {
      return this.children;
    }
    get firstChild() {
      return this.children[0] ?? null;
    }
    get lastChild() {
      return this.children.at(-1) ?? null;
    }
    get firstElementChild() {
      return this.firstChild;
    }
    get nextSibling() {
      const siblings = this.parentNode?.children ?? [];
      return siblings[siblings.indexOf(this) + 1] ?? null;
    }
    get isConnected() {
      let node = this;
      while (node.parentNode) node = node.parentNode;
      return node === documentElement;
    }
    adopt(child) {
      if (typeof child === "string")
        child = Object.assign(new FakeElement("#text"), { textContent: child });
      child.parentNode?.removeChild(child);
      child.parentNode = this;
      if (child.tagName === "style" && this.isConnected)
        record(`stylesheet #${child.id} ${hash(child.textContent)}`);
      return child;
    }
    appendChild(child) {
      this.children.push(this.adopt(child));
      return child;
    }
    append(...children) {
      for (const child of children) this.children.push(this.adopt(child));
    }
    prepend(...children) {
      this.children.unshift(...children.map((child) => this.adopt(child)));
    }
    insertBefore(child, reference) {
      const index = this.children.indexOf(reference);
      const adopted = this.adopt(child);
      if (index < 0) this.children.push(adopted);
      else this.children.splice(index, 0, adopted);
      return child;
    }
    insertAdjacentElement(_position, element) {
      return this.appendChild(element);
    }
    replaceChildren(...children) {
      this.children = [];
      this.append(...children);
    }
    removeChild(child) {
      this.children = this.children.filter((item) => item !== child);
      child.parentNode = null;
      return child;
    }
    remove() {
      this.parentNode?.removeChild(this);
    }
    cloneNode() {
      return new FakeElement(this.tagName);
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
      if (name === "class") this.className = String(value);
      if (name === "id") this.id = String(value);
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    hasAttribute(name) {
      return this.attributes.has(name);
    }
    removeAttribute(name) {
      this.attributes.delete(name);
    }
    addEventListener(type) {
      if (this === body || this === documentElement) record(`listen body:${type}`);
    }
    removeEventListener() {}
    dispatchEvent(event) {
      return true;
    }
    focus() {}
    blur() {}
    click() {}
    select() {}
    scrollIntoView() {}
    getBoundingClientRect() {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    }
    matches(selector) {
      return matches(this, selector);
    }
    contains(other) {
      for (let node = other; node; node = node.parentNode) if (node === this) return true;
      return false;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentNode) if (matches(node, selector)) return node;
      return null;
    }
    querySelectorAll(selector) {
      const found = [];
      const visit = (element) => {
        for (const child of element.children) {
          if (child instanceof FakeElement) {
            if (matches(child, selector)) found.push(child);
            visit(child);
          }
        }
      };
      visit(this);
      return found;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    getElementsByClassName(name) {
      return this.querySelectorAll(`.${name}`);
    }
    getElementsByTagName(name) {
      return this.querySelectorAll(name);
    }
  }
  function matches(element, selectorList) {
    return String(selectorList)
      .split(",")
      .some((selector) => {
        const compound = selector.trim().split(/\s+|>/).filter(Boolean).at(-1) ?? "";
        const parts = compound.match(/[.#]?[^.#[\]:]+|\[[^\]]+\]/g) ?? [];
        return parts.every((part) => {
          if (part.startsWith(".")) return element.classList.contains(part.slice(1));
          if (part.startsWith("#")) return element.id === part.slice(1);
          if (part.startsWith("[")) return element.hasAttribute(part.slice(1, -1).split("=")[0]);
          return element.tagName === part.toLowerCase();
        });
      });
  }
  const documentElement = new FakeElement("html");
  const head = documentElement.appendChild(new FakeElement("head"));
  const body = documentElement.appendChild(new FakeElement("body"));
  // Elements the boot sequence waits for: the main tab bar and the FC header.
  const tabBar = body.appendChild(new FakeElement("nav"));
  tabBar.className = "ut-tab-bar";
  const header = body.appendChild(new FakeElement("header"));
  header.className = "fc-header-view";

  const document = {
    body,
    head,
    documentElement,
    readyState: "complete",
    createElement: (tagName) => new FakeElement(tagName),
    createElementNS: (_namespace, tagName) => new FakeElement(tagName),
    createTextNode: (text) => Object.assign(new FakeElement("#text"), { textContent: text }),
    createDocumentFragment: () => new FakeElement("#fragment"),
    getElementById: (id) => documentElement.querySelector(`#${id}`),
    querySelector: (selector) => documentElement.querySelector(selector),
    querySelectorAll: (selector) => documentElement.querySelectorAll(selector),
    getElementsByClassName: (name) => documentElement.getElementsByClassName(name),
    getElementsByTagName: (name) => documentElement.getElementsByTagName(name),
    addEventListener: (type) => record(`listen document:${type}`),
    removeEventListener: () => {},
    dispatchEvent: (event) => {
      record(`dispatch document:${event.type}`);
      return true;
    },
    execCommand: () => true,
  };
  function makeConsole() {
    return { log() {}, info() {}, warn() {}, error() {}, debug() {}, trace() {} };
  }
  const storage = () => {
    const values = new Map();
    return {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => {
        record(`storage.set ${key}`);
        values.set(key, String(value));
      },
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    };
  };
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
    preventDefault() {}
    stopPropagation() {}
  }
  // The sandbox global object plays the role of `window` (and of `unsafeWindow`).
  const provided = {
    document,
    addEventListener: (type) => record(`listen window:${type}`),
    removeEventListener: () => {},
    dispatchEvent: (event) => {
      record(`dispatch window:${event.type}`);
      return true;
    },
    innerWidth: 1280,
    innerHeight: 800,
    console: makeConsole(),
    localStorage: storage(),
    sessionStorage: storage(),
    location: {
      href: "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/",
      hostname: "www.ea.com",
      pathname: "/ea-sports-fc/ultimate-team/web-app/",
    },
    navigator: { userAgent: "paletools-harness", language: "en-US", platform: "harness" },
    CustomEvent: FakeEvent,
    Event: FakeEvent,
    MouseEvent: FakeEvent,
    HTMLElement: FakeElement,
    Element: FakeElement,
    isPhone: () => isPhone,
    // Without IndexedDB the script skips its local database (as in browsers lacking it).
    indexedDB: undefined,
    // Read through `getPageWindow().XMLHttpRequest`, so it is not a free identifier.
    XMLHttpRequest: stub("XMLHttpRequest"),
    AudioContext: stub("AudioContext"),
    setTimeout: (callback, delay = 0) => {
      record(`setTimeout ${delay}`);
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout: () => {},
    setInterval: (_callback, delay = 0) => {
      record(`setInterval ${delay}`);
      return 0;
    },
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    queueMicrotask,
    structuredClone,
    AbortController,
    DOMException,
    URL,
    Blob,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    fetch: (url) => {
      record(`fetch ${url}`);
      return new Promise(() => {});
    },
    // Network access is never performed: every request fails asynchronously.
    GM_xmlhttpRequest: (request) => {
      record(`GM_xmlhttpRequest ${request?.method ?? "GET"} ${request?.url}`);
      queueMicrotask(() => request?.onerror?.({ status: 0, statusText: "offline (harness)" }));
    },
    GM_download: () => record("GM_download"),
  };
  return { trace, provided, stub, timers, record, document, FakeElement, overrides, describe };
}

/**
 * Runs `source` in a fresh sandbox and resolves once the asynchronous boot has settled.
 * Returns the trace and any error thrown synchronously or by the boot promise chain.
 */
export async function bootUserscript(source, options = {}) {
  const harness = createWebAppHarness(options);
  const sandbox = { ...harness.provided };
  const builtins = new Set(vm.runInNewContext("Object.getOwnPropertyNames(globalThis)"));
  for (const name of freeGlobals(source)) {
    if (!(name in sandbox) && !builtins.has(name)) sandbox[name] = harness.stub(name);
  }
  const context = vm.createContext(sandbox);
  vm.runInContext(
    `Date.now = () => ${FIXED_TIME};
     Math.random = (() => { let seed = 42; return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; })();
     globalThis.window = globalThis.unsafeWindow = globalThis.self = globalThis;`,
    context,
  );
  const errors = [];
  const unhandled = (reason) => errors.push(reason);
  process.on("unhandledRejection", unhandled);
  try {
    vm.runInContext(source, context, { filename: "userscript.js" });
  } catch (error) {
    errors.push(error);
  }
  const settle = async () => {
    for (let round = 0; round < 50; round++) await new Promise((resolve) => setImmediate(resolve));
  };
  await settle();
  if (options.exerciseHooks) {
    // Calls every installed prototype override once, with a stub receiver and stub arguments,
    // and records the outcome. Overrides installed while doing so are exercised as well.
    for (let index = 0; index < harness.overrides.length && index < 2000; index++) {
      const { name, value } = harness.overrides[index];
      harness.record(`exercise ${name}`);
      try {
        const result = value.call(
          harness.stub(`this<${name}>`),
          ...[1, 2, 3].map((n) => harness.stub(`arg${n}<${name}>`)),
        );
        harness.record(`  returned ${harness.describe(result)}`);
      } catch (error) {
        harness.record(`  threw ${error?.name}: ${normalizeErrorMessage(error?.message)}`);
      }
      await settle();
    }
  }
  process.off("unhandledRejection", unhandled);
  return { trace: harness.trace, errors, timers: harness.timers, context };
}
