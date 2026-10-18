import { randomUUID } from 'node:crypto';
import type { ActivityEvent, ActivitySnapshot } from '../../../../packages/shared/types.ts';

export class Activity {
  events: ActivityEvent[] = [];
  active = 0;
  total = 0;
  seq = 0;
  tasks: Record<string, boolean> = {};
  instance = randomUUID();
  record(event: Omit<ActivityEvent, 'seq' | 'at'>) {
    this.events.push({ ...event, seq: ++this.seq, at: new Date().toISOString() });
    this.events = this.events.slice(-64);
  }
  begin(task: string) { this.tasks[task] = true; this.record({ task, kind: 'task', state: 'started' }); }
  finish(task: string, success: boolean) { this.tasks[task] = false; this.record({ task, kind: 'task', state: success ? 'completed' : 'failed' }); }
  snapshot(): ActivitySnapshot { return { events: [...this.events], active: this.active, total: this.total, tasks: { ...this.tasks }, instance: this.instance }; }
}
