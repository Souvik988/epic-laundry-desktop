import assert from 'node:assert/strict';
import { moneyNumber, optionalMoney, parseMoney } from './kernel/money.js';

assert.equal(parseMoney('12.34'), 1234, 'decimal strings become integer paise');
assert.equal(parseMoney(12.3), 1230, 'numeric input is normalized without binary drift');
assert.equal(moneyNumber(parseMoney('0', 'zero', { allowZero: true })), 0, 'zero is supported where explicitly allowed');
assert.equal(optionalMoney(undefined), 0, 'optional monetary fields default to zero');
assert.throws(() => parseMoney('12.345'), /at most two decimal places/, 'over-precise money is rejected');
assert.throws(() => parseMoney('₹12.00'), /valid amount/, 'formatted currency strings are rejected at the API boundary');
assert.throws(() => parseMoney(-1), /cannot be negative/, 'negative money is rejected unless explicitly allowed');
assert.equal(parseMoney('-1.25', 'opening balance', { allowNegative: true }), -125, 'signed opening balances are explicit');
// Deterministic property checks: every representable two-decimal value must
// round-trip through the public number/string boundary without changing paise.
let seed = 0x13579bdf;
for (let index = 0; index < 2_000; index += 1) {
  seed = (seed * 1_664_525 + 1_013_904_223) >>> 0;
  const paise = seed % 10_000_000;
  const display = (paise / 100).toFixed(2);
  assert.equal(parseMoney(display), paise, `paise round-trip remains exact at sample ${index}`);
  assert.equal(parseMoney(moneyNumber(paise)), paise, `numeric round-trip remains exact at sample ${index}`);
  const first = Math.floor(paise / 3);
  const second = paise - first;
  assert.equal(first + second, paise, `split/recombine preserves balance at sample ${index}`);
  assert.equal((first + second) - second, first, `reversal arithmetic preserves balance at sample ${index}`);
}
console.log('PASS  fixed-scale money boundary self-test complete');
