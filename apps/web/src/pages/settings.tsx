import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, Clock3 } from 'lucide-react';
import type { Settings, Schedule } from '../../../../packages/shared/types.ts';
import { api, post } from '../services/api';

export function SettingsPage() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });
  const schedule = useQuery({ queryKey: ['schedule'], queryFn: () => api<Schedule>('/api/schedule') });
  const client = useQueryClient();
  const [settingsVersion, setSettingsVersion] = useState(0), [scheduleVersion, setScheduleVersion] = useState(0);
  const save = useMutation({ mutationFn: (body: unknown) => post<Settings>('/api/settings', body), onSuccess: data => { client.setQueryData(['settings'], data); setSettingsVersion(value => value + 1); } });
  const timer = useMutation({ mutationFn: (body: unknown) => post<Schedule>('/api/schedule', body), onSuccess: data => { client.setQueryData(['schedule'], data); setScheduleVersion(value => value + 1); } });
  if (settings.isPending || schedule.isPending) return <p role="status">正在读取配置…</p>;
  if (!settings.data || !schedule.data) return <p role="alert">{(settings.error || schedule.error)?.message}</p>;
  return <div className="settings-grid"><section className="panel"><div className="panel-heading"><KeyRound size={18}/><h2>连接与存储</h2></div><p className="caption">凭证仅在服务端保存。留空保留现有密钥，勾选清除后才会删除本地值。</p>
    <form key={settingsVersion} onSubmit={(event: FormEvent<HTMLFormElement>) => {
      event.preventDefault(); const form = event.currentTarget, values = new FormData(form), body: Record<string, unknown> = {}, clear: string[] = [];
      for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET', 'ORDERS_DATA_DIR', 'ORDERS_ALLOWED_ORIGIN']) {
        const value = String(values.get(name) ?? ''); if (value || !['SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET'].includes(name)) body[name] = value;
        if (values.get(`clear_${name}`)) clear.push(name);
      }
      body.clear = clear; save.mutate(body);
    }}>
      <label>Supabase 项目地址<input name="SUPABASE_URL" type="url" defaultValue={settings.data?.SUPABASE_URL} placeholder="https://项目.supabase.co" autoComplete="off"/></label>
      {['SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET'].map(name => <div className="secret-field" key={name}><label>{name}<span className="caption">{settings.data?.configured[name] ? settings.data.credential_sources[name] || '已配置' : '未配置'}</span><input name={name} type="password" autoComplete="new-password" placeholder="留空保留现有值"/></label><label className="checkbox"><input type="checkbox" name={`clear_${name}`}/>清除本地值</label></div>)}
      <label>数据目录<input name="ORDERS_DATA_DIR" defaultValue={settings.data?.ORDERS_DATA_DIR} placeholder="留空使用默认位置"/></label>
      <label>允许的页面来源<input name="ORDERS_ALLOWED_ORIGIN" defaultValue={settings.data?.ORDERS_ALLOWED_ORIGIN} placeholder="默认使用当前服务地址"/></label>
      <p className="caption break">配置：{settings.data?.config_path}<br/>数据库：{settings.data?.database_path}</p>
      {settings.data?.restart_required && <p className="notice">数据目录将在重启后生效，请先备份并手动搬移旧数据库。</p>}
      <button className="primary" disabled={save.isPending}><Save size={16}/>{save.isPending ? '正在保存…' : '保存程序配置'}</button>
      <p role={save.error ? 'alert' : 'status'}>{save.error?.message || (save.isSuccess ? '配置已保存，备用凭证在后台刷新。' : '')}</p>
    </form></section><section className="panel"><div className="panel-heading"><Clock3 size={18}/><h2>来源自动追踪</h2></div><ScheduleForm key={scheduleVersion} value={schedule.data!} save={body => timer.mutate(body)} pending={timer.isPending}/><p role={timer.error ? 'alert' : 'status'}>{timer.error?.message || (timer.isSuccess ? '定时配置已保存。' : '')}</p><div className="note"><strong>独立的持仓保护</strong><p>Gate 持仓与平仓保护单每 60 秒检查一次，不受来源定时开关影响。停用来源定时不会中断正在运行的任务。</p></div></section></div>;
}
function ScheduleForm({ value, save, pending }: { value: Schedule; save: (body: Schedule) => void; pending: boolean }) {
  const [enabled, setEnabled] = useState(value.enabled), [cron, setCron] = useState(value.cron);
  return <form onSubmit={event => { event.preventDefault(); save({ enabled, cron }); }}><label className="checkbox"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}/>启用来源定时抓取与自动开仓</label><label>快捷周期<select onChange={event => { if (event.target.value) setCron(event.target.value); }} value={['*/5 * * * *', '*/15 * * * *', '0 * * * *'].includes(cron) ? cron : ''}><option value="">自定义</option><option value="*/5 * * * *">每 5 分钟</option><option value="*/15 * * * *">每 15 分钟</option><option value="0 * * * *">每小时</option></select></label><label>Cron 表达式<input value={cron} onChange={event => setCron(event.target.value)} required maxLength={256}/></label><p className="caption">分 · 时 · 日 · 月 · 星期，按服务器本地时间执行。错过的任务不会补跑。</p><p>下次执行：{value.next_run ? new Date(value.next_run).toLocaleString() : '已停用'}</p><button className="primary" disabled={pending}><Save size={16}/>{pending ? '正在保存…' : '保存定时配置'}</button></form>;
}
