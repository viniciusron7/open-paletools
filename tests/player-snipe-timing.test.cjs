const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { loadSources } = require("./support/load-sources.cjs");
const { PLAYER_SNIPE_CORE } = require("./support/market-automation-sources.cjs");

const context = vm.createContext({ AbortController, DOMException, setTimeout, clearTimeout });
loadSources(context, {
  modules: [PLAYER_SNIPE_CORE],
  epilogue: "globalThis.playerSnipeTiming = createPlayerSnipeTiming;",
});
const createPlayerSnipeTiming = context.playerSnipeTiming;
const ranges = { search: [80, 180], return: [70, 160], adjust: [30, 90], buy: [15, 55] };

test("uses a short integer delay within the range assigned to each action", () => {
  const timing = createPlayerSnipeTiming();
  for (let attempt = 0; attempt < 1000; attempt++) {
    for (const [action, [minimum, maximum]] of Object.entries(ranges)) {
      const delay = timing(action);
      assert(Number.isInteger(delay), `${action}: the delay must be an integer`);
      assert(
        delay >= minimum && delay <= maximum,
        `${action}: ${delay} is outside ${minimum}–${maximum} ms`,
      );
    }
  }
});

test("the first sample can reach either inclusive endpoint of every range", () => {
  for (const [action, [minimum, maximum]] of Object.entries(ranges)) {
    assert.equal(createPlayerSnipeTiming(() => 0)(action), minimum);
    assert.equal(createPlayerSnipeTiming(() => 1 - Number.EPSILON)(action), maximum);
  }
});

for (const value of [0, 0.5, 1 - Number.EPSILON]) {
  test(`a constant random source (${value}) cannot repeat the previous global or per-action delay`, () => {
    const timing = createPlayerSnipeTiming(() => value);
    const previousByAction = new Map();
    let previousGlobal;
    const actions = ["search", "return", "adjust", "search", "adjust", "buy", "return", "buy"];
    for (let attempt = 0; attempt < 256; attempt++) {
      for (const action of actions) {
        const delay = timing(action);
        const [minimum, maximum] = ranges[action];
        assert(Number.isInteger(delay) && delay >= minimum && delay <= maximum);
        assert.notEqual(
          delay,
          previousGlobal,
          `${action}: repeated the immediately preceding delay`,
        );
        assert.notEqual(
          delay,
          previousByAction.get(action),
          `${action}: repeated the previous attempt for this action`,
        );
        previousGlobal = delay;
        previousByAction.set(action, delay);
      }
    }
  });
}

test("repeated use of one action still changes the delay with a constant random source", () => {
  for (const action of Object.keys(ranges)) {
    const timing = createPlayerSnipeTiming(() => 0);
    let previous;
    for (let attempt = 0; attempt < 100; attempt++) {
      const delay = timing(action);
      assert.notEqual(delay, previous);
      previous = delay;
    }
  }
});

test("preserves the previous delay of an action across intervening actions", () => {
  const timing = createPlayerSnipeTiming(() => 0);
  const firstSearch = timing("search");
  timing("return");
  timing("adjust");
  timing("buy");
  assert.notEqual(timing("search"), firstSearch);
});

test("a reproducible source makes the generated timing sequence reproducible", () => {
  const values = [0, 0.27, 0.5, 0.99, 0.13, 0.8];
  const makeSource = () => {
    let index = 0;
    return () => values[index++ % values.length];
  };
  const first = createPlayerSnipeTiming(makeSource());
  const second = createPlayerSnipeTiming(makeSource());
  for (let attempt = 0; attempt < 100; attempt++) {
    for (const action of Object.keys(ranges)) assert.equal(first(action), second(action));
  }
});

test("rejects unsupported actions, including inherited object property names", () => {
  const timing = createPlayerSnipeTiming(() => 0.5);
  for (const action of [undefined, null, "", "unknown", "__proto__", "constructor", "toString"]) {
    assert.throws(() => timing(action));
  }
});

test("rejects invalid random sources and samples", () => {
  for (const source of [null, false, 0, "random", {}]) {
    assert.throws(() => createPlayerSnipeTiming(source));
  }
  for (const value of [
    -1,
    -Number.EPSILON,
    1,
    2,
    NaN,
    Infinity,
    -Infinity,
    undefined,
    null,
    "0.5",
  ]) {
    assert.throws(() => createPlayerSnipeTiming(() => value)("search"));
  }
});
