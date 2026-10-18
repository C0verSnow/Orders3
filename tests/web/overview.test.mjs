import test from "node:test";
import assert from "node:assert/strict";
import {selectOverview, exactValue, pnlTone} from "../../web/overview.js";

test("overview keeps exact decimal and ID text, hides status 5 without changing the snapshot", () => {
  const orders = [
    {id: "90071992547409931234", contract: "BTC_USDT", amount: "-12345678901234567890", activation_price: "0.000000000000001234", original_status: 1},
    {id: "hidden", contract: "BTC_USDT", original_status: "5"}
  ];
  const before = JSON.stringify(orders);
  const view = selectOverview(orders, {query: "90071992547409931234"});
  assert.equal(view.total, 1);
  assert.equal(view.rows[0].activation_price, "0.000000000000001234");
  assert.equal(view.rows[0].amount, "-12345678901234567890");
  assert.equal(JSON.stringify(orders), before);
});

test("filter, sort and paging retain unknown statuses and clamp a shrinking snapshot", () => {
  const orders = Array.from({length: 19}, (_, i) => ({id: String(i), contract: i % 2 ? "ETH_USDT" : "BTC_USDT",
    original_status: i % 2 ? 2 : 1, timestamp: 1700000000000 + i * 1000}));
  assert.deepEqual(selectOverview(orders).rows.map((row) => row.id), ["18", "17", "16", "15", "14", "13", "12", "11"]);
  assert.equal(selectOverview(orders, {page: 3}).rows.length, 3);
  const filtered = selectOverview(orders, {query: "eth", status: "2", page: 99, sort: "contract"});
  assert.equal(filtered.page, 2);
  assert.equal(filtered.matched, 9);
  assert.equal(selectOverview([], {page: 3}).page, 1);
  assert.equal(selectOverview(orders, {query: "不存在"}).matched, 0);
  assert.equal(selectOverview([{original_status: 77}]).total, 1);
});

test("missing values and arbitrarily small PnL remain readable without rounding", () => {
  assert.equal(exactValue(null), "—");
  assert.equal(exactValue(0), "0");
  assert.equal(exactValue("0.000000001"), "0.000000001");
  assert.equal(pnlTone("-0.00000000001"), "negative");
  assert.equal(pnlTone("123456789012345678901"), "positive");
  assert.equal(pnlTone("-0.00000"), "neutral");
  assert.equal(pnlTone("invalid"), "neutral");
});
