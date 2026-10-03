import test from "node:test";
import assert from "node:assert/strict";
import {activityView, newActivityEvents} from "../../web/activity.js";

const empty = () => ({sequence: 0, jobs: {}, requests: {}, events: []});
test("cached data and idle jobs cannot start the animation", () => {
  const view = activityView(empty());
  assert.equal(view.state, "idle");
  assert.equal(view.nodes.sources.active, false);
  assert.equal(view.nodes.gate.active, false);
});
test("source fetching and Gate polling animate together", () => {
  const data = empty();
  data.jobs = {sources: "running", orders: "running"};
  data.requests = {a: {node: "sources", active: 1}, b: {node: "gate", active: 1}};
  const view = activityView(data);
  assert.equal(view.nodes.sources.active, true);
  assert.equal(view.nodes.gate.active, true);
  assert.equal(view.state, "busy");
});
test("trading moves toward Gate while waiting for a lock does not animate", () => {
  const data = empty();
  data.jobs = {sources: "running"};
  assert.equal(activityView(data).nodes.gate.active, false);
  data.requests = {trade: {node: "gate", active: 1, write: true}};
  assert.equal(activityView(data).nodes.gate.write, true);
});
test("completion stops motion; failure is visible", () => {
  const data = empty();
  data.jobs = {orders: "failed"};
  data.requests = {gate: {node: "gate", active: 0, completed: 2, failed: 1}};
  data.events = [{node: "gate", type: "request-end", status: 502}];
  const view = activityView(data);
  assert.equal(view.nodes.gate.active, false);
  assert.equal(view.nodes.gate.state, "error");
  assert.equal(view.state, "error");
  assert.equal(view.completed, 2);
  assert.equal(view.failed, 1);
});
test("disconnect stops every link even if the last snapshot was active", () => {
  const data = empty();
  data.jobs = {sources: "running"};
  data.requests = {source: {node: "sources", active: 1}, gate: {node: "gate", active: 1, write: true}};
  const view = activityView(data, false);
  assert.equal(view.state, "offline");
  assert.equal(view.running, false);
  assert.equal(view.nodes.sources.active, false);
  assert.equal(view.nodes.gate.active, false);
  assert.equal(view.nodes.gate.write, false);
});
test("short requests produce an acknowledgement once, without replay on load or restart", () => {
  const data = {sequence: 9, events: [{sequence: 8, type: "request-start"}, {sequence: 9, type: "request-end"}]};
  assert.deepEqual(newActivityEvents(data, undefined), []);
  assert.equal(newActivityEvents(data, 7).length, 2);
  assert.deepEqual(newActivityEvents(data, 9), []);
  assert.deepEqual(newActivityEvents(data, 20), []);
});
