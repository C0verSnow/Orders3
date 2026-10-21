import { StableText } from '../components/stable-text';
import { t, useLanguage, dateLocale } from '../i18n';
import { Button, Input, Select, Panel } from '../components/ui';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, Clock3 } from 'lucide-react';
import type { Settings, Schedule } from '../../../../packages/shared/types.ts';
import { TwoToneTitle } from '../components/motion';
import { api, post } from '../services/api';
import type { Theme } from '../hooks/use-theme';
import { circularReveal } from '../circular-reveal';

export function SettingsPage({ theme, setTheme }: { theme: Theme; setTheme: (value: Theme) => void }) {
  useLanguage();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('/api/settings'),
  });
  const schedule = useQuery({
    queryKey: ['schedule'],
    queryFn: () => api<Schedule>('/api/schedule'),
  });
  const client = useQueryClient();
  const [settingsVersion, setSettingsVersion] = useState(0),
    [scheduleVersion, setScheduleVersion] = useState(0),
    [openingVersion, setOpeningVersion] = useState(0);
  const save = useMutation({
    mutationFn: (body: unknown) => post<Settings>('/api/settings', body),
    onSuccess: (data) => {
      client.setQueryData(['settings'], data);
      setSettingsVersion((value) => value + 1);
    },
  });
  const timer = useMutation({
    mutationFn: (body: unknown) => post<Schedule>('/api/schedule', body),
    onSuccess: (data) => {
      client.setQueryData(['schedule'], data);
      setScheduleVersion((value) => value + 1);
    },
  });
  const opening = useMutation({
    mutationFn: (body: unknown) => post<Schedule>('/api/schedule/opening', body),
    onSuccess: (data) => {
      client.setQueryData(['schedule'], data);
      setOpeningVersion((value) => value + 1);
    },
  });
  if (settings.isPending || schedule.isPending) return <p role="status"><StableText text={t('正在读取配置…')} /></p>;
  if (!settings.data || !schedule.data)
    return <p role="alert">{t((settings.error || schedule.error)?.message)}</p>;
  return (
    <div className="grid items-start gap-6 xl:grid-cols-2 [&_form]:grid [&_form]:gap-5 [&_form_label:not(:has(input[type=checkbox]))]:grid [&_form_label]:gap-2 [&_form_label]:text-xs [&_form_label]:font-medium [&_form_button]:justify-self-start [&_form_p]:text-xs [&_form_p[role=alert]]:text-red-600 [&_form_p[role=status]]:text-zinc-500 [&_section>p]:mb-5">
      <Panel className="xl:col-span-2" data-ui="appearance-settings">
        <TwoToneTitle title={t('外观主题')} description={t('界面偏好')} />
        <label className="mt-5 grid max-w-sm gap-2 text-xs font-medium">
          <StableText text={t('主题模式')} />
          <Select
            data-ui="theme-select"
            value={theme}
            onChange={(event) => {
              const next = event.currentTarget.value as Theme;
              void circularReveal(event.currentTarget, () => setTheme(next));
            }}
          >
            <option value="light">{t('浅色模式')}</option>
            <option value="dark">{t('深色模式')}</option>
            <option value="system">{t('跟随系统')}</option>
          </Select>
        </label>
      </Panel>
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
          <KeyRound size={18} />
          <TwoToneTitle title={t('连接与存储')} description={t('凭证与数据')} />
        </div>
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          <StableText text={t('凭证仅在服务端保存。留空保留现有密钥，勾选清除后才会删除本地值。')} />
        </p>
        <form
          key={settingsVersion}
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = event.currentTarget,
              values = new FormData(form),
              body: Record<string, unknown> = {},
              clear: string[] = [];
            for (const name of [
              'SUPABASE_URL',
              'SUPABASE_ANON_KEY',
              'API_KEY',
              'API_SECRET',
              'ORDERS_DATA_DIR',
              'ORDERS_ALLOWED_ORIGIN',
            ]) {
              const value = String(values.get(name) ?? '');
              if (value || !['SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET'].includes(name))
                body[name] = value;
              if (values.get(`clear_${name}`)) clear.push(name);
            }
            body.clear = clear;
            save.mutate(body);
          }}
        >
          <label>
            <StableText text={t('Supabase 项目地址')} />
            <Input
              name="SUPABASE_URL"
              type="url"
              defaultValue={settings.data?.SUPABASE_URL}
              placeholder={t('https://项目.supabase.co')}
              autoComplete="off"
            />
          </label>
          {['SUPABASE_ANON_KEY', 'API_KEY', 'API_SECRET'].map((name) => (
            <div
              className="grid gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
              key={name}
            >
              <label>
                {name}
                <span className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  <StableText text={settings.data?.configured[name]
                    ? t(settings.data.credential_sources[name]) || t('已配置')
                    : t('未配置')} />
                </span>
                <Input
                  name={name}
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('留空保留现有值')}
                />
              </label>
              <label className="flex flex-row items-center gap-2 text-xs font-normal">
                <Input type="checkbox" name={`clear_${name}`} />
                <StableText text={t('清除本地值')} />
              </label>
            </div>
          ))}
          <label>
            <StableText text={t('数据目录')} />
            <Input
              name="ORDERS_DATA_DIR"
              defaultValue={settings.data?.ORDERS_DATA_DIR}
              placeholder={t('留空使用默认位置')}
            />
          </label>
          <label>
            <StableText text={t('允许的页面来源')} />
            <Input
              name="ORDERS_ALLOWED_ORIGIN"
              defaultValue={settings.data?.ORDERS_ALLOWED_ORIGIN}
              placeholder={t('默认使用当前服务地址')}
            />
          </label>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 break-words [overflow-wrap:anywhere]">
            <StableText text={t('配置：')} />
            {settings.data?.config_path}
            <br />
            <StableText text={t('数据库：')} />
            {settings.data?.database_path}
          </p>
          {settings.data?.restart_required && (
            <p className="mb-5 flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-4 py-3 text-xs dark:bg-blue-950">
              <StableText text={t('数据目录将在重启后生效，请先备份并手动搬移旧数据库。')} />
            </p>
          )}
          <Button variant="primary" disabled={save.isPending}>
            <Save size={16} />
            {save.isPending ? t('正在保存…') : t('保存程序配置')}
          </Button>
          <p role={save.error ? 'alert' : 'status'}>
            {t(save.error?.message) ||
              (save.isSuccess ? t('配置已保存，备用凭证在后台刷新。') : '')}
          </p>
        </form>
      </Panel>
      <Panel>
        <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
          <Clock3 size={18} />
          <TwoToneTitle title={t('预测抓取')} description={t('定时与周期')} />
        </div>
        <ScheduleForm
          key={scheduleVersion}
          label={t('启用预测订单定时抓取')}
          value={schedule.data!}
          save={(body) => timer.mutate(body)}
          pending={timer.isPending}
        />
        <p role={timer.error ? 'alert' : 'status'}>
          {t(timer.error?.message) || (timer.isSuccess ? t('定时配置已保存。') : '')}
        </p>
        <div className="mt-8 mb-5">
          <TwoToneTitle title={t('自动开仓')} description={t('独立授权与周期')} />
        </div>
        <p className="mb-4 text-xs leading-relaxed text-zinc-500">
          <StableText text={t(
            '默认关闭。启用后仅在计划时间使用已保存的有效预测订单交易；启动、刷新和预测抓取不会开仓。请先完成一次预测抓取。',
          )} />
        </p>
        <ScheduleForm
          key={`opening-${openingVersion}`}
          label={t('启用自动开仓（涉及真实交易）')}
          value={schedule.data.opening!}
          save={(body) => opening.mutate(body)}
          pending={opening.isPending}
        />
        <p role={opening.error ? 'alert' : 'status'}>
          {t(opening.error?.message) || (opening.isSuccess ? t('自动开仓配置已保存。') : '')}
        </p>
        <div className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-xs leading-relaxed text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-100 [&_p]:mt-2">
          <strong><StableText text={t('独立的持仓同步')} /></strong>
          <p>
            <StableText text={t(
              'Gate 持仓与订单每 60秒只读同步一次，不受来源定时开关影响；不会创建、修改或撤销保护单。停用来源定时不会中断正在运行的任务。',
            )} />
          </p>
        </div>
      </Panel>
    </div>
  );
}
function ScheduleForm({
  value,
  save,
  pending,
  label,
}: {
  label: string;
  value: Schedule;
  save: (body: Schedule) => void;
  pending: boolean;
}) {
  useLanguage();
  const [enabled, setEnabled] = useState(value.enabled),
    [cron, setCron] = useState(value.cron);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save({ enabled, cron });
      }}
    >
      <label className="flex flex-row items-center gap-2 text-xs font-normal">
        <Input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <StableText text={label} />
      </label>
      <label>
        <StableText text={t('快捷周期')} />
        <Select
          onChange={(event) => {
            if (event.target.value) setCron(event.target.value);
          }}
          value={['*/5 * * * *', '*/15 * * * *', '0 * * * *'].includes(cron) ? cron : ''}
        >
          <option value="">{t('自定义')}</option>
          <option value="*/5 * * * *">{t('每 5 分钟')}</option>
          <option value="*/15 * * * *">{t('每 15 分钟')}</option>
          <option value="0 * * * *">{t('每小时')}</option>
        </Select>
      </label>
      <label>
        <StableText text={t('Cron 表达式')} />
        <Input
          value={cron}
          onChange={(event) => setCron(event.target.value)}
          required
          maxLength={256}
        />
      </label>
      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        <StableText text={t('分 · 时 · 日 · 月 · 星期，按服务器本地时间执行。错过的任务不会补跑。')} />
      </p>
      <p role={value.error ? 'alert' : 'status'}>
        {t(value.error) || t('上次状态：{0}', [t(value.result ?? 'idle')])}
      </p>
      <p>
        <StableText text={t('下次执行：')} />
        {value.next_run ? new Date(value.next_run).toLocaleString(dateLocale()) : t('已停用')}
      </p>
      <Button variant="primary" disabled={pending}>
        <Save size={16} />
        {pending ? t('正在保存…') : t('保存定时配置')}
      </Button>
    </form>
  );
}
