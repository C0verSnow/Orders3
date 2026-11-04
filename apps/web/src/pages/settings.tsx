import { StableText } from '../components/stable-text';
import { t, useLanguage, dateLocale } from '../i18n';
import { Button, Input, JellyToggle, SegmentedChoice, Panel } from '../components/ui';
import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Save, Clock3, Palette, ShieldCheck, ChevronRight, ArrowLeft } from 'lucide-react';
import type { Settings, Schedule } from '../../../../packages/shared/types.ts';
import { Stagger, TwoToneTitle } from '../components/motion';
import { api, post } from '../services/api';
import type { Theme } from '../hooks/use-theme';
import { circularReveal } from '../circular-reveal';

export function SettingsPage({ theme, setTheme }: { theme: Theme; setTheme: (value: Theme) => void }) {
  useLanguage();
  const [section, setSection] = useState<string | null>(null);
  const sections = [
    { id: 'appearance', title: '外观设置', description: '主题与界面偏好', icon: Palette },
    { id: 'connections', title: '连接与存储', description: '数据库连接、凭证与存储', icon: KeyRound },
    { id: 'prediction', title: '预测抓取', description: '定时抓取与执行间隔', icon: Clock3 },
    { id: 'trading', title: '平仓参数', description: '平仓目标乘数', icon: ShieldCheck },
    { id: 'opening', title: '自动开仓', description: '自动入场与安全限制', icon: ShieldCheck },
  ];
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Settings>('/api/settings'),
  });
  const schedule = useQuery({
    queryKey: ['schedule'],
    queryFn: () => api<Schedule>('/api/schedule'),
  });
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: (body: unknown) => post<Settings>('/api/settings', body),
    onSuccess: (data) => {
      client.setQueryData(['settings'], data);
    },
  });
  const timer = useMutation({
    mutationFn: (body: unknown) => post<Schedule>('/api/schedule', body),
    onSuccess: (data) => {
      client.setQueryData(['schedule'], data);
    },
  });
  const opening = useMutation({
    mutationFn: (body: unknown) => post<Schedule>('/api/schedule/opening', body),
    onSuccess: (data) => {
      client.setQueryData(['schedule'], data);
    },
  });
  if (settings.isPending || schedule.isPending) return <p role="status"><StableText text={t('正在读取配置…')} /></p>;
  if (!settings.data || !schedule.data)
    return <p role="alert">{t((settings.error || schedule.error)?.message)}</p>;
  return (
    <div data-ui="settings" className="settings-content">
      <Stagger revision={section ?? 'overview'}>
      {section === null ? <div data-ui="settings-overview" className="grid gap-4">
        {sections.map(({ id, title, description, icon: Icon }) => <Button key={id} data-stagger-item="" data-settings-section={id} className="settings-card" onClick={() => setSection(id)}>
          <Icon size={22} aria-hidden="true" />
          <span className="grid min-w-0 flex-1 gap-1 text-left"><strong className="text-sm font-semibold"><StableText text={t(title)} /></strong><span className="text-xs text-zinc-500 dark:text-zinc-400"><StableText text={t(description)} /></span></span>
          <ChevronRight size={18} aria-hidden="true" />
        </Button>)}
      </div> : <Button data-ui="settings-back" className="mb-5" onClick={() => setSection(null)}><ArrowLeft size={16} />{t('返回设置')}</Button>}
      <div className="grid items-start gap-6 [&_form]:grid [&_form]:gap-5 [&_form_label:not(:has(input[type=checkbox]))]:grid [&_form_label]:gap-2 [&_form_label]:text-xs [&_form_label]:font-medium [&_form_button]:justify-self-start [&_form_p]:text-xs [&_form_p[role=alert]]:text-red-600 [&_form_p[role=status]]:text-zinc-500 [&_section>p]:mb-5">
      <div hidden={section !== 'appearance'}><Panel data-ui="appearance-settings">
        <TwoToneTitle title={t('外观主题')} description={t('界面偏好')} />
        <div className="setting-group mt-5">
          <SegmentedChoice ui="theme-choice" label={t('主题模式')} value={theme}
            options={[{ value: 'light', label: t('浅色模式') }, { value: 'system', label: t('跟随系统') }, { value: 'dark', label: t('深色模式') }]}
            onChange={(value, element) => { void circularReveal(element, () => setTheme(value as Theme)); }} />
        </div>
      </Panel></div>
      <div hidden={section !== 'connections'}><Panel>
        <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
          <KeyRound size={18} />
          <TwoToneTitle title={t('连接与存储')} description={t('凭证与数据')} />
        </div>
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          <StableText text={t('凭证仅在服务端保存。留空保留现有密钥，勾选清除后才会删除本地值。')} />
        </p>
        <form
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
            save.mutate(body, { onSuccess: () => form.reset() });
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
                <JellyToggle name={`clear_${name}`} disabled={save.isPending} />
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
          <Button variant="primary" status={save.isPending ? 'pending' : save.isError ? 'error' : save.isSuccess ? 'success' : 'idle'} disabled={save.isPending}>
            <Save size={16} />
            {t('保存程序配置')}
          </Button>
          {save.error && <p role="alert">{t(save.error.message)}</p>}
        </form>
      </Panel></div>
      <div hidden={section !== 'trading'}><Panel>
        <TwoToneTitle title={t('平仓参数')} description={t('平仓目标乘数')} />
        <p className="mt-4 text-xs text-zinc-500">{t('默认 3.1，必须大于零。保存后从下一轮持仓维护生效，不会立即下单；未激活的平仓单可能在下轮调整。')}</p>
        <form onSubmit={event => {
          event.preventDefault();
          save.mutate({ close_multiplier: String(new FormData(event.currentTarget).get('close_multiplier')) });
        }}>
          <label><StableText text={t('平仓乘数')} /><Input name="close_multiplier" type="number" step="any" min="0" required defaultValue={settings.data.close_multiplier}
            onChange={event => event.currentTarget.setCustomValidity(event.currentTarget.value !== '' && Number(event.currentTarget.value) <= 0 ? t('平仓乘数必须是大于零的有效十进制数') : '')} /></label>
          <Button variant="primary" status={save.isPending ? 'pending' : save.isError ? 'error' : save.isSuccess ? 'success' : 'idle'}>{t('保存平仓参数')}</Button>
          {save.error && <p role="alert">{t(save.error.message)}</p>}
        </form>
      </Panel></div>
      <div hidden={section !== 'prediction'}><Panel>
        <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
          <Clock3 size={18} />
          <TwoToneTitle title={t('预测抓取')} description={t('定时与周期')} />
        </div>
        <ScheduleForm
          label={t('启用预测订单定时抓取')}
          value={schedule.data!}
          save={(body) => timer.mutate(body)}
          pending={timer.isPending}
          status={timer.isPending ? 'pending' : timer.isError ? 'error' : timer.isSuccess ? 'success' : 'idle'}
        />
        {timer.error && <p role="alert">{t(timer.error.message)}</p>}
      </Panel></div>
      <div hidden={section !== 'opening'}><Panel>
        <div className="mb-5">
          <TwoToneTitle title={t('自动开仓')} description={t('独立授权与周期')} />
        </div>
        <p className="mb-4 text-xs leading-relaxed text-zinc-500">
          <StableText text={t(
            '默认关闭。启用后仅在计划时间使用已保存的有效预测订单交易；启动、刷新和预测抓取不会开仓。请先完成一次预测抓取。',
          )} />
        </p>
        <ScheduleForm
          label={t('启用自动开仓（涉及真实交易）')}
          value={schedule.data.opening!}
          save={(body) => opening.mutate(body)}
          pending={opening.isPending}
          status={opening.isPending ? 'pending' : opening.isError ? 'error' : opening.isSuccess ? 'success' : 'idle'}
        />
        {opening.error && <p role="alert">{t(opening.error.message)}</p>}
        <div className="mt-8 rounded-xl border border-zinc-200 bg-zinc-50 p-5 text-xs leading-relaxed text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-100 [&_p]:mt-2">
          <strong><StableText text={t('独立的持仓同步')} /></strong>
          <p>
            <StableText text={t(
              'Gate 持仓与订单每 60秒只读同步一次，不受来源定时开关影响；不会创建、修改或撤销保护单。停用来源定时不会中断正在运行的任务。',
            )} />
          </p>
        </div>
      </Panel></div>
      </div>
      </Stagger>
    </div>
  );
}
function ScheduleForm({
  value,
  save,
  pending,
  label,
  status,
}: {
  label: string;
  value: Schedule;
  save: (body: Schedule) => void;
  pending: boolean;
  status: 'idle' | 'pending' | 'success' | 'error';
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
      <div className="setting-group">
      <label className="setting-row">
        <StableText text={label} />
        <JellyToggle
          disabled={pending}
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </label>
      <SegmentedChoice label={t('快捷周期')} disabled={pending}
        value={['*/5 * * * *', '*/15 * * * *', '0 * * * *'].includes(cron) ? cron : ''}
        options={[{value: '', label: t('自定义')}, {value: '*/5 * * * *', label: t('每 5 分钟')}, {value: '*/15 * * * *', label: t('每 15 分钟')}, {value: '0 * * * *', label: t('每小时')}]}
        onChange={value => setCron(value)} />
      </div>
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
      <Button variant="primary" status={status} disabled={pending}>
        <Save size={16} />
        {t('保存定时配置')}
      </Button>
    </form>
  );
}
