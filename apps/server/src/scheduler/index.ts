import { z } from 'zod';
import type { Schedule } from '../../../../packages/shared/types.ts';
import type { Configuration } from '../config/index.ts';
import type { Dashboard } from '../services/dashboard.ts';
import { AppError } from '../utils/errors.ts';

export class Cron {
  fields: Set<number>[];
  constructor(expression: string) {
    const parts = expression.trim().split(/\s+/);
    if (parts.length !== 5) throw new AppError('Cron 要有五段：分 时 日 月 星期');
    this.fields = parts.map((part, index) => {
      const minimum = [0, 0, 1, 1, 0][index], maximum = [59, 23, 31, 12, 7][index], values = new Set<number>();
      for (const item of part.split(',')) {
        if (!/^(?:\*|\d+(?:-\d+)?)(?:\/\d+)?$/.test(item)) throw new AppError('Cron 只支持数字、*、范围、列表和步长');
        const [range, stepText] = item.split('/'), step = stepText === undefined ? 1 : Number(stepText);
        const endpoints = range.split('-').map(Number);
        const first = range === '*' ? minimum : endpoints[0], last = range === '*' ? maximum : endpoints[1] ?? (stepText ? maximum : first);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || !Number.isSafeInteger(step) || step < 1 || step > maximum + 1 || first < minimum || last > maximum || first > last) throw new AppError('Cron 数字或范围无效');
        for (let value = first; value <= last; value += step) values.add(index === 4 && value === 7 ? 0 : value);
      }
      return values;
    });
  }
  matches(date: Date): boolean {
    const [minute, hour, day, month, weekday] = this.fields, d = day.has(date.getDate()), w = weekday.has(date.getDay());
    return minute.has(date.getMinutes()) && hour.has(date.getHours()) && month.has(date.getMonth() + 1) && (day.size === 31 || weekday.size === 7 ? d && w : d || w);
  }
  nextAfter(date: Date): Date {
    const next = new Date(Math.floor(date.getTime() / 60000) * 60000 + 60000), limit = new Date(date); limit.setFullYear(limit.getFullYear() + 8);
    while (next <= limit) {
      if (this.matches(next)) return next;
      // Step actual minutes through DST, skip whole nonmatching local calendar days safely.
      if (!this.fields[3].has(next.getMonth() + 1)) { next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0); }
      else next.setTime(next.getTime() + 60000);
    }
    throw new AppError('Cron 在未来八年内没有执行时间');
  }
}
export class Scheduler {
  value: Schedule;
  next: Date;
  result = 'idle';
  timer?: ReturnType<typeof setInterval>;
  gateTimer?: ReturnType<typeof setInterval>;
  private config: Configuration;
  private dashboard: Dashboard;
  constructor(config: Configuration, dashboard: Dashboard) { this.config = config; this.dashboard = dashboard; this.value = config.schedule(); this.next = new Cron(this.value.cron).nextAfter(new Date()); }
  snapshot(): Schedule { return { ...this.value, next_run: this.value.enabled ? this.next.toISOString() : null, result: this.result }; }
  update(payload: unknown) {
    const parsed = z.object({ enabled: z.boolean(), cron: z.string().min(1).max(256) }).strict().safeParse(payload);
    if (!parsed.success) throw new AppError('定时配置格式无效');
    const next = new Cron(parsed.data.cron).nextAfter(new Date());
    this.config.saveSection('schedule', { enabled: String(parsed.data.enabled), cron: parsed.data.cron });
    this.value = parsed.data; this.next = next; return this.snapshot();
  }
  start() {
    this.timer = setInterval(() => {
      if (!this.value.enabled || Date.now() < this.next.getTime()) return;
      this.next = new Cron(this.value.cron).nextAfter(new Date());
      if (this.dashboard.sourcesBusy) { this.result = 'busy'; return; }
      void this.dashboard.refreshSources().then(() => { this.result = 'completed'; }, () => { this.result = 'error'; });
    }, 1000);
    this.gateTimer = setInterval(() => { if (!this.dashboard.gateBusy) void this.dashboard.refreshOrders().catch(() => {}); }, 60000);
  }
  stop() { clearInterval(this.timer); clearInterval(this.gateTimer); }
}
