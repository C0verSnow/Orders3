// Derive the view from server telemetry only. Snapshot reads never count as trades.
export function activityView(snapshot, connected = true) {
  const requests = Object.values(snapshot?.requests || {});
  const jobs = Object.values(snapshot?.jobs || {});
  const nodes = {};
  for (const name of ["sources", "gate"]) {
    const rows = requests.filter((row) => row.node === name);
    const active = connected && rows.some((row) => row.active > 0);
    const latest = [...(snapshot?.events || [])].reverse().find((event) => event.node === name);
    nodes[name] = {
      active,
      write: active && rows.some((row) => row.active > 0 && row.write),
      state: !connected ? "offline" : active ? "busy"
        : latest?.type === "request-end" ? (latest.status >= 200 && latest.status < 300 ? "ready" : "error") : "idle",
      completed: rows.reduce((sum, row) => sum + (row.completed || 0), 0),
      failed: rows.reduce((sum, row) => sum + (row.failed || 0), 0)
    };
  }
  const running = connected && jobs.includes("running");
  return {
    nodes, running,
    state: !connected ? "offline" : running ? "busy" : jobs.includes("failed") ? "error"
      : jobs.length ? "ready" : "idle",
    completed: requests.reduce((sum, row) => sum + (row.completed || 0), 0),
    failed: requests.reduce((sum, row) => sum + (row.failed || 0), 0)
  };
}

export function newActivityEvents(snapshot, sequence) {
  // A lower sequence signals a server restart. Do not replay old animation on first load.
  if (sequence == null || snapshot.sequence < sequence) return [];
  return (snapshot.events || []).filter((event) => event.sequence > sequence);
}
