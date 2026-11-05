/** Uses the shared CSPRNG unless a repeatable seed is supplied. */

import { ToolError, type ToolRun } from "../../lib/tool-framework/run.ts";
import type { ToolResult } from "../../lib/tool-framework/result.ts";
import { secureRandomInt } from "../../lib/devtools/shared/crypto.ts";

type Settings = {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly seed: string;
  readonly decimalPlaces: string;
  readonly uniqueValues: boolean;
  readonly wholeNumbers: boolean;
  readonly sortResult: boolean;
};

function seededRandomInt(seed: string): (maxExclusive: number) => number {
  let state = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    state = Math.imul(state ^ seed.charCodeAt(index), 0x01000193);
  }

  return (maxExclusive) => {
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
    let value: number;
    do {
      state = (state + 0x6d2b79f5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      value = (mixed ^ (mixed >>> 14)) >>> 0;
    } while (value >= limit);
    return value % maxExclusive;
  };
}

export const run: ToolRun<Settings> = (ctx): ToolResult => {
  const { min, max, count, seed, decimalPlaces, uniqueValues, wholeNumbers, sortResult } = ctx.settings;
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) {
    throw new ToolError(
      "bounds-not-integers",
      "Min and max must be integers.",
      "Remove any decimal part from the range.",
      { messageRef: { key: "errors.bounds-not-integers" }, recoveryMessage: { key: "recovery.bounds-not-integers" } },
    );
  }
  if (min > max) {
    throw new ToolError("bounds-inverted", "Min cannot be greater than max.", "Swap the two values.", {
      messageRef: { key: "errors.bounds-inverted" },
      recoveryMessage: { key: "recovery.bounds-inverted" },
    });
  }
  const places = wholeNumbers ? 0 : Number(decimalPlaces);
  const scale = 10 ** places;
  const scaledMin = min * scale;
  const span = (max - min) * scale + 1;
  if (!Number.isSafeInteger(scaledMin) || !Number.isSafeInteger(span) || span > 0x1_0000_0000) {
    throw new ToolError("invalid-random-range", "Random range is too large.", "Reduce the range or decimal places.", {
      messageRef: { key: "errors.invalid-random-range" },
      recoveryMessage: { key: "recovery.invalid-random-range" },
    });
  }
  if (uniqueValues && count > span) {
    throw new ToolError(
      "not-enough-unique-values",
      "The range does not contain enough unique values.",
      "Reduce the count or widen the range.",
      {
        messageRef: { key: "errors.not-enough-unique-values" },
        recoveryMessage: { key: "recovery.not-enough-unique-values" },
      },
    );
  }

  const draw = seed ? seededRandomInt(seed) : secureRandomInt;
  const values: number[] = [];
  const seen = new Set<number>();
  while (values.length < count) {
    const value = scaledMin + draw(span);
    if (!uniqueValues || !seen.has(value)) {
      values.push(value);
      seen.add(value);
    }
  }
  if (sortResult) values.sort((left, right) => left - right);

  return {
    render: "list",
    items: values.map((value) => (wholeNumbers ? String(value) : (value / scale).toFixed(places))),
    downloadName: "random-numbers.txt",
  };
};

export default run;
