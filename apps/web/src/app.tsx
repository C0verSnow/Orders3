import { Button, Input, Badge, Panel, BrandLogo } from './components/ui';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  CircleHelp,
  Clock3,
  Database,
  History,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Monitor,
  Moon,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sun,
  Wallet,
  X,
} from 'lucide-react';
import type {
  ActivitySnapshot,
  SourceSnapshot,
  OrdersSnapshot,
  Intent,
  EntryEvent,
} from '../../../packages/shared/types.ts';
import { two } from '../../../packages/decimal/index.ts';
import { api, post } from './services/api';
import { DataTable } from './components/data-table';
import { AnimatedValue, MotionList, ScrollFade, TwoToneTitle } from './components/motion';
import { Navigation } from './components/navigation';
import { SettingsPage } from './pages/settings';
import { useTheme } from './hooks/use-theme';

type Row = Record<string, unknown>;
type Page = 'overview' | 'sources' | 'trailing' | 'positions' | 'history' | 'activity' | 'settings';
const pages = [
  { id: 'overview', label: '交易概览', icon: LayoutDashboard },
  { id: 'sources', label: '预测订单', icon: Database },
  { id: 'trailing', label: '跟踪订单', icon: ListOrdered },
  { id: 'positions', label: '当前持仓', icon: Wallet },
  { id: 'history', label: '入仓历史', icon: History },
  { id: 'activity', label: '运行状态', icon: Activity },
  { id: 'settings', label: '系统设置', icon: Settings2 },
] as const;
const date = (value: unknown) => {
  const time = typeof value === 'string' ? Date.parse(value) : value;
  return typeof time === 'number' && Number.isFinite(time) ? new Date(time).toLocaleString() : '—';
};
const status = (value: unknown) =>
  (({ 1: '等待激活', 2: '已激活', 5: '已停止' }) as Record<string, string>)[String(value)] ??
  `状态 ${value}`;
function columns(fields: [string, string][]): ColumnDef<Row>[] {
  return fields.map(([key, label]) => ({
    accessorKey: key,
    header: label,
    cell: (info) => {
      const value = info.getValue();
      if (key === 'timestamp' || key === 'entry_time')
        return (
          <span className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
            {date(value)}
          </span>
        );
      if (key === 'original_status')
        return <Badge tone={value === 1 ? 'blue' : 'neutral'}>{status(value)}</Badge>;
      if (key === 'reduce_only') return <Badge>{value ? '平仓保护' : '开仓追踪'}</Badge>;
      if (key === 'side') return String(value ?? '—');
      if (key === 'contract')
        return (
          <strong className="font-semibold tracking-tight">
            {String(value ?? '—').replace('_', ' / ')}
          </strong>
        );
      const numeric = [
        'activation_price',
        'amount',
        'size',
        'entry_price',
        'mark_price',
        'unrealised_pnl',
        'realised_pnl',
        'initial_margin',
        'value',
        'leverage_max',
      ].includes(key);
      return (
        <span className="tabular-nums tracking-tight">
          {value == null ? '—' : numeric ? two(String(value)) : String(value)}
        </span>
      );
    },
  }));
}
const sourceColumns = columns([
  ['contract', '合约'],
  ['activation_price', '激活价格'],
  ['amount', '数量 / 张'],
  ['side', '来源方向'],
  ['timestamp', '来源时间'],
]);
const trailColumns = columns([
  ['contract', '合约'],
  ['activation_price', '激活价格'],
  ['amount', '数量 / 张'],
  ['reduce_only', '用途'],
  ['original_status', '状态'],
  ['id', '订单编号'],
  ['timestamp', '更新时间'],
]);
const positionColumns = columns([
  ['contract', '合约'],
  ['size', '持仓 / 张'],
  ['entry_price', '入仓均价'],
  ['mark_price', '标记价格'],
  ['unrealised_pnl', '未实现盈亏'],
  ['realised_pnl', '已实现盈亏'],
  ['initial_margin', '持仓保证金'],
]);
const historyColumns = columns([
  ['contract', '合约'],
  ['side', '方向（1 多 / -1 空）'],
  ['initial_margin', '固定保证金'],
  ['entry_time', '真实成交时间'],
  ['event_id', '成交编号'],
]);

export function App() {
  const themeState = useTheme();
  const [token, setToken] = useState(''),
    [initialToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token'));
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => api<{ authenticated: boolean }>('/api/session', { signal }),
    retry: false,
  });
  const client = useQueryClient();
  const login = useMutation({
    mutationFn: (value: string) =>
      api<{ authenticated: boolean }>('/api/session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${value}` },
      }),
    onSuccess: async (data) => {
      await client.cancelQueries({ queryKey: ['session'] });
      setToken('');
      client.setQueryData(['session'], data);
    },
  });
  useEffect(() => {
    if (initialToken) {
      history.replaceState(null, '', location.pathname + location.search);
      login.mutate(initialToken);
    }
    // The URL bootstrap is consumed exactly once; never retain it in storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (session.isPending)
    return (
      <main className="mx-auto grid min-h-dvh max-w-xl place-content-center p-6 [&_form]:mt-6 [&_form]:grid [&_form]:gap-5 [&_label]:grid [&_label]:gap-2 [&_label]:text-sm [&_h1]:my-6 [&_h1]:text-2xl [&_h1]:font-semibold">
        <p role="status">正在连接工作台…</p>
      </main>
    );
  if (!session.data?.authenticated)
    return (
      <main className="mx-auto grid min-h-dvh max-w-xl place-content-center p-6 [&_form]:mt-6 [&_form]:grid [&_form]:gap-5 [&_label]:grid [&_label]:gap-2 [&_label]:text-sm [&_h1]:my-6 [&_h1]:text-2xl [&_h1]:font-semibold">
        <div className="mb-6 min-w-0 rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm md:p-6 dark:border-zinc-700 dark:bg-zinc-900">
          <BrandLogo />
          <h1>连接你的交易工作台</h1>
          <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
            输入服务启动时显示的登录令牌。凭证与交易调度由你的服务端管理。
          </p>
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              login.mutate(token);
            }}
          >
            <label>
              工作台登录令牌
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="off"
                required
                autoFocus
              />
            </label>
            <Button variant="primary" disabled={login.isPending}>
              {login.isPending ? '连接中…' : '连接工作台'}
              <ArrowUpRight size={16} />
            </Button>
            <p role="alert">{login.error?.message || session.error?.message}</p>
          </form>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            在服务器运行日志中查找“登录令牌”，或使用管理员设置的 ORDERS_ACCESS_TOKEN。
          </p>
        </div>
      </main>
    );
  return (
    <Workspace
      onLogout={() => {
        client.clear();
      }}
      themeState={themeState}
    />
  );
}

function Workspace({
  onLogout,
  themeState,
}: {
  onLogout: () => void;
  themeState: ReturnType<typeof useTheme>;
}) {
  const client = useQueryClient(),
    [page, setPage] = useState<Page>('overview'),
    [menu, setMenu] = useState(false),
    [showStopped, setShowStopped] = useState(false);
  const [theme, setTheme] = themeState,
    [notice, setNotice] = useState('');
  const [compact, setCompact] = useState(() => matchMedia('(max-width:768px)').matches),
    navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia('(max-width:768px)'),
      update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!compact || !menu) return;
    const previous = document.activeElement as HTMLElement,
      overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () =>
      Array.from(
        navigation.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,a[href]') ??
          [],
      ).filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = controls(),
        first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [compact, menu]);
  const source = useQuery({
    queryKey: ['sources'],
    queryFn: () => api<SourceSnapshot>('/api/data'),
    refetchInterval: (query) => (query.state.data?.refreshing ? 5000 : 60000),
  });
  const orders = useQuery({
    queryKey: ['orders'],
    queryFn: () => api<OrdersSnapshot>('/api/orders'),
    refetchInterval: 60000,
  });
  const activity = useQuery({
    queryKey: ['activity'],
    queryFn: () => api<ActivitySnapshot>('/api/activity', { signal: AbortSignal.timeout(3000) }),
    refetchInterval: 600,
    retry: false,
  });
  const pending = useQuery({
    queryKey: ['pending'],
    queryFn: () => api<{ pending: Intent[]; database_error: string | null }>('/api/status'),
    refetchInterval: 5000,
  });
  const entries = useQuery({
    queryKey: ['history'],
    queryFn: () => api<{ entries: EntryEvent[] }>('/api/history'),
    enabled: page === 'history',
    refetchInterval: 60000,
  });
  const completedSeq = activity.data?.events
    .filter((event) => event.kind === 'task' && event.state !== 'started')
    .at(-1)?.seq;
  useEffect(() => {
    if (completedSeq !== undefined) {
      for (const key of ['sources', 'orders', 'pending', 'history'])
        void client.invalidateQueries({ queryKey: [key] });
    }
  }, [completedSeq, activity.data?.instance, client]);
  useEffect(() => {
    for (const error of [source.error, orders.error, activity.error])
      if (error && 'status' in error && error.status === 401) {
        client.clear();
        return;
      }
  }, [source.error, orders.error, activity.error, client]);
  const refresh = useMutation({
    mutationFn: async (which: 'all' | 'sources' | 'orders') => {
      if (which !== 'orders') await post('/api/refresh');
      if (which !== 'sources') await post('/api/orders/refresh');
    },
    onSuccess: () => setNotice('刷新完成，以下为服务端确认的数据。'),
    onError: (error) => setNotice(error.message),
    onSettled: () => {
      for (const key of ['sources', 'orders', 'pending'])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
  const manualOpening = useMutation({
    mutationFn: () => post('/api/opening/manual', { confirmed_trade_execution: true }),
    onSuccess: () => setNotice('手动开仓完成，请核对执行结果。'),
    onError: error => setNotice(error.message),
    onSettled: () => { for (const key of ['sources', 'orders', 'pending', 'history']) void client.invalidateQueries({ queryKey: [key] }); },
  });
  const resolve = useMutation({
    mutationFn: (input: { id: string; evidence: string }) =>
      post('/api/intents/resolve', { ...input, confirmed_exchange_review: true }),
    onSuccess: () => {
      setNotice('已记录人工核对，未重新发送交易。');
      void client.invalidateQueries({ queryKey: ['pending'] });
    },
    onError: (error) => setNotice(error.message),
  });
  const logout = useMutation({
    mutationFn: () => api('/api/session', { method: 'DELETE' }),
    onSuccess: onLogout,
    onError: (error) => setNotice(error.message),
  });
  const download = async () => {
    try {
      const response = await fetch('/api/download', { credentials: 'same-origin' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || '下载失败');
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement('a');
      link.href = url;
      link.download = 'data.db';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '下载失败');
    }
  };
  const sourceRows = useMemo(
    () =>
      source.data?.orders.map((row) => ({
        ...row,
        source_record: source.data?.items[row.record_position],
      })) ?? [],
    [source.data],
  );
  const trailingRows = useMemo(
    () =>
      orders.data?.orders
        .filter((row) => showStopped || row.original_status !== 5)
        .map((row) => ({ ...row })) ?? [],
    [orders.data, showStopped],
  );
  const positionRows = useMemo(
    () => orders.data?.positions.map((row) => ({ ...row })) ?? [],
    [orders.data],
  );
  const historyRows = useMemo(
    () => entries.data?.entries.map((row) => ({ ...row })) ?? [],
    [entries.data],
  );
  const activityItems = useMemo(() => eventItems(activity.data), [activity.data]);
  const busy = manualOpening.isPending || refresh.isPending || source.data?.refreshing || orders.data?.refreshing;
  const heading = pages.find((item) => item.id === page)!;
  const requestRefresh = (which: 'all' | 'sources' | 'orders') => {
    {
      setNotice('正在同步，请等待服务端确认结果…');
      refresh.mutate(which);
    }
  };
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="fixed top-[-80px] left-4 z-[100] rounded-lg bg-white p-3 text-blue-600 shadow-sm focus:top-3 dark:bg-zinc-900"
      >
        跳到主要内容
      </a>
      {menu && (
        <Button
          className="fixed! inset-0 z-40 rounded-none! border-0! bg-black/30! backdrop-blur-sm md:hidden"
          aria-label="关闭导航"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        ref={navigation}
        inert={compact && !menu}
        className={`fixed inset-y-0 left-0 z-50 flex w-[260px] flex-col border-r border-zinc-200 bg-zinc-100/95 px-4 pt-7 pb-5 backdrop-blur-xl transition-transform duration-300 motion-reduce:transition-none md:w-[212px] md:translate-x-0 lg:w-[238px] dark:border-zinc-800 dark:bg-zinc-900/95 ${menu ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-3 px-2 pb-8 [&_strong]:text-lg [&_strong]:font-semibold [&_strong]:tracking-tight [&>div>span]:mt-1 [&>div>span]:block [&>div>span]:text-[10px] [&>div>span]:text-zinc-500 [&>button]:ml-auto">
          <BrandLogo />
          <div>
            <strong>Orders3</strong>
            <span>特洛伊资本 · 交易工作台</span>
          </div>
          <Button className="md:hidden" aria-label="关闭导航" onClick={() => setMenu(false)}>
            <X size={18} />
          </Button>
        </div>
        <p className="px-3 pb-3 text-[10px] font-semibold tracking-widest text-zinc-500">
          工作空间
        </p>
        <Navigation>
          {pages.map((item) => (
            <Button
              key={item.id}
              variant="quiet"
              className={`relative w-full justify-start! rounded-xl! px-3! py-3! hover:bg-transparent! dark:hover:bg-transparent! ${page === item.id ? 'font-semibold! text-blue-600 dark:text-blue-400 before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-full before:bg-blue-600 dark:before:bg-blue-400' : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'}`}
              aria-current={page === item.id ? 'page' : undefined}
              onClick={() => {
                setPage(item.id);
                setMenu(false);
              }}
            >
              <item.icon size={17} strokeWidth={1.7} />
              {item.label}
              {item.id === 'activity' && !!pending.data?.pending.length && (
                <span className="ml-auto rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">
                  {pending.data.pending.length}
                </span>
              )}
            </Button>
          ))}
        </Navigation>
        <div className="mt-auto grid gap-3 border-t border-zinc-200 px-2 pt-5 pb-[env(safe-area-inset-bottom)] dark:border-zinc-700">
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${activity.error ? 'bg-red-500' : 'bg-emerald-500'}`}
            />
            <span>{activity.error ? '连接中断，正在重连' : '服务端已连接'}</span>
          </div>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            交易状态以 Gate 实际记录为准
          </p>
          <div role="group" aria-label="外观主题" className="grid grid-cols-3 gap-1 rounded-xl bg-zinc-200/60 p-1 dark:bg-zinc-800">
            {([{ value: 'light', label: '浅色模式', icon: Sun }, { value: 'dark', label: '深色模式', icon: Moon }, { value: 'system', label: '跟随系统', icon: Monitor }] as const).map(option => (
              <Button key={option.value} aria-pressed={theme === option.value} aria-label={option.label}
                variant="quiet" onClick={() => setTheme(option.value)}
                className={`min-w-0 flex-col gap-1! px-1! py-2! text-[10px]! ${theme === option.value ? 'bg-white! text-zinc-900 shadow-sm dark:bg-zinc-600! dark:text-white' : 'text-zinc-500 dark:text-zinc-400'}`}>
                <option.icon size={14} aria-hidden="true" />{option.label}
              </Button>
            ))}
          </div>
          <Button variant="text" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut size={14} />
            退出工作台
          </Button>
        </div>
      </aside>
      <div className="min-w-0 flex-1 md:ml-[212px] lg:ml-[238px]" inert={compact && menu}>
        <header className="flex h-16 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-5 md:px-8 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex min-w-0 items-center gap-2 text-xs md:gap-4 [&>span]:text-zinc-500 [&>strong]:font-medium">
            <Button className="md:hidden" onClick={() => setMenu(true)} aria-label="打开导航">
              <Menu size={20} />
            </Button>
            <span className="hidden md:inline">工作空间</span>
            <span className="hidden opacity-40 md:inline">/</span>
            <strong>{heading.label}</strong>
          </div>
          <div className="flex shrink-0 items-center gap-3 [&_button>span]:hidden md:[&_button>span]:inline">
            <Button variant="quiet" onClick={download}>
              <ArrowDownToLine size={16} />
              <span>下载数据库</span>
            </Button>

          </div>
        </header>
        <main
          className="mx-auto max-w-[1740px] p-5 pt-8 outline-none md:p-8 xl:p-10"
          id="main"
          tabIndex={-1}
        >
          <div className="mb-8 flex flex-col items-start justify-between gap-5 xl:flex-row xl:items-center">
            <div>
              <p className="mb-3 text-[10px] font-semibold tracking-[.14em] text-zinc-500 dark:text-zinc-400">
                ORDERS WORKSPACE
              </p>
              <TwoToneTitle
                level={1}
                title={heading.label}
                description={
                  page === 'overview'
                    ? '看清每一笔订单，掌握每一次执行。'
                    : page === 'settings'
                      ? '管理连接、存储与自动追踪。'
                      : '真实数据同步，保留完整业务记录。'
                }
              />
            </div>
            {page !== 'settings' && (
              <Button variant="primary" disabled={busy} onClick={() => requestRefresh('all')}>
                <RefreshCw
                  size={16}
                  className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
                />
                {busy ? '正在同步…' : '统一刷新'}
              </Button>
            )}
          </div>
          {notice && (
            <div
              className="mb-5 flex items-center justify-between gap-3 rounded-xl bg-blue-50 px-4 py-3 text-xs dark:bg-blue-950"
              role="status"
            >
              {notice}
              <Button aria-label="关闭提示" onClick={() => setNotice('')}>
                <X size={14} />
              </Button>
            </div>
          )}
          {(source.error ||
            orders.error ||
            source.data?.error ||
            orders.data?.error ||
            activity.error ||
            pending.error ||
            pending.data?.database_error) && (
            <div
              className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-5 text-xs leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300 [&>svg]:shrink-0 [&_strong]:font-semibold [&_p]:mt-1"
              role="alert"
            >
              <CircleHelp size={18} />
              <div>
                <strong>
                  {activity.error ? '连接暂时中断，当前列表可能不是最新数据' : '有任务需要检查'}
                </strong>
                <p>
                  {pending.error
                    ? '无法确认当前阻断状态，请重新读取状态。'
                    : pending.data?.database_error ||
                      source.error?.message ||
                      orders.error?.message ||
                      source.data?.error ||
                      orders.data?.error ||
                      activity.error?.message}
                </p>
                <Button
                  variant="text"
                  onClick={() => {
                    void client.invalidateQueries();
                  }}
                >
                  重新读取状态
                </Button>
              </div>
            </div>
          )}
          {!!pending.data?.pending.length && (
            <div
              className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-5 text-xs leading-relaxed text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300 [&>svg]:shrink-0 [&_strong]:font-semibold [&_p]:mt-1"
              role="alert"
            >
              <ShieldCheck size={20} />
              <div>
                <strong>自动交易已暂停：有 {pending.data.pending.length} 笔请求结果需要核对</strong>
                <p>
                  请先在 Gate
                  查看真实订单与成交，确认后到“运行状态”处理。系统不会自动重发这些请求。
                </p>
                <Button variant="text" onClick={() => setPage('activity')}>
                  查看待核对交易
                  <ArrowUpRight size={14} />
                </Button>
              </div>
            </div>
          )}
          {page === 'overview' && (
            <>
              <div className="mb-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm xl:grid-cols-4 dark:border-zinc-700 dark:bg-zinc-900">
                <Metric
                  label="预测订单"
                  value={source.data ? String(source.data.orders.length) : '—'}
                  detail="完整分页后保存"
                />
                <Metric
                  label="有效跟踪订单"
                  value={
                    orders.data
                      ? String(
                          orders.data.orders.filter((row) => [1, 2].includes(row.original_status))
                            .length,
                        )
                      : '—'
                  }
                  detail="等待激活与已激活"
                />
                <Metric
                  label="未实现盈亏 / USDT"
                  value={orders.data?.unrealised_pnl ?? '—'}
                  detail="当前非零持仓合计"
                />
                <Metric
                  label="已实现盈亏 / USDT"
                  value={orders.data?.realised_pnl ?? '—'}
                  detail="缓存持仓口径，非全历史"
                />
              </div>
              <Panel className="flex flex-wrap items-center justify-between gap-6 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mt-2 [&_p]:text-xs">
                <div>
                  <span className="mb-3 flex items-center gap-2 text-[10px] text-zinc-500">
                    <span
                      className={`inline-block size-1.5 shrink-0 rounded-full ${activity.error ? 'bg-red-500' : 'bg-emerald-500'}`}
                    />
                    执行状态
                  </span>
                  <h2>
                    {activity.error
                      ? '等待重新连接'
                      : activity.data?.active
                        ? `${activity.data.active} 个真实网络请求进行中`
                        : '所有请求已结束'}
                  </h2>
                  <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    预测抓取与自动开仓独立调度
                  </p>
                </div>
                <div className="flex w-full flex-wrap justify-between gap-5 xl:w-auto [&>span]:flex [&>span]:flex-col [&>span]:gap-2 [&>span]:text-[10px] [&>span]:text-zinc-500 [&_strong]:whitespace-nowrap [&_strong]:text-sm [&_strong]:font-medium [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-100">
                  <span>
                    <strong>
                      <AnimatedValue value={String(activity.data?.total ?? '—')} />
                    </strong>
                    本次进程请求
                  </span>
                  <span>
                    <strong>
                      <AnimatedValue text value={source.data?.phase ?? '—'} />
                    </strong>
                    来源任务阶段
                  </span>
                  <span>
                    <strong>
                      <AnimatedValue
                        value={
                          orders.data ? String(Math.floor(orders.data.uptime_ms / 60000)) : '—'
                        }
                      />{' '}
                      分钟
                    </strong>
                    运行时长
                  </span>
                </div>
              </Panel>
              <OrderPanel
                title="订单工作台"
                description="来源信号与 Gate 跟踪单，共用同一套交易规则。"
                action={
                  <Button variant="quiet" disabled={busy} onClick={() => requestRefresh('sources')}>
                    <RefreshCw size={14} />
                    刷新来源
                  </Button>
                }
              >
                <DataTable
                  loading={source.isPending}
                  rows={sourceRows}
                  columns={sourceColumns}
                  label="预测订单"
                />
              </OrderPanel>
              <div className="grid gap-0 lg:grid-cols-[1fr_1.5fr] lg:gap-6">
                <Panel>
                  <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
                    <ShieldCheck size={18} />
                    <TwoToneTitle title="持仓同步" description="只读快照" />
                  </div>
                  <p
                    data-ui="position-count"
                    className="my-5 flex items-baseline gap-3 text-3xl font-medium [&>span:last-child]:text-xs [&>span:last-child]:text-zinc-500"
                  >
                    <AnimatedValue value={String(orders.data?.positions.length ?? '—')} />
                    <span>个非零持仓方向</span>
                  </p>
                  <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                    每分钟同步持仓，不再自动创建或调整保护单。
                  </p>
                  <Button variant="text" onClick={() => setPage('positions')}>
                    查看当前持仓
                    <ArrowUpRight size={14} />
                  </Button>
                </Panel>
                <Panel>
                  <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
                    <Clock3 size={18} />
                    <TwoToneTitle title="最近执行结果" description="来源任务" />
                  </div>
                  <ExecutionList rows={[...(source.data?.execution ?? [])].slice(-10)} />
                </Panel>
              </div>
            </>
          )}
          {page === 'sources' && (
            <OrderPanel
              title="预测订单"
              description={`最近保存：${source.data?.updated_at ? new Date(source.data.updated_at).toLocaleString() : '尚未同步'} · 详情保留完整来源记录`}
              action={
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => requestRefresh('sources')}>刷新预测订单</Button>
                  <Button disabled={busy || !sourceRows.length} onClick={() => {
                    if (confirm('手动开仓将使用当前保存的预测订单，按策略停止旧开仓单并提交新开仓单；不受自动开仓开关限制。确认操作真实账户？')) manualOpening.mutate();
                  }}>手动开仓</Button>
                </div>
              }
            >
              <DataTable
                loading={source.isPending}
                rows={sourceRows}
                columns={sourceColumns}
                label="预测订单"
              />
            </OrderPanel>
          )}
          {page === 'trailing' && (
            <OrderPanel
              title="跟踪订单"
              description={`状态 2 保留；状态 5 默认隐藏。订单最近同步：${date(orders.data?.trailing_updated_at)}`}
              action={
                <label className="flex flex-row items-center gap-2 text-xs font-normal">
                  <Input
                    type="checkbox"
                    checked={showStopped}
                    onChange={(event) => setShowStopped(event.target.checked)}
                  />
                  显示已停止
                </label>
              }
            >
              <DataTable
                loading={orders.isPending}
                rows={trailingRows}
                columns={trailColumns}
                label="跟踪订单"
              />
            </OrderPanel>
          )}
          {page === 'positions' && (
            <OrderPanel
              title="当前持仓"
              description={`仅同步数据，自动保护单功能已取消。持仓最近同步：${date(orders.data?.position_updated_at)}；订单最近同步：${date(orders.data?.trailing_updated_at)}`}
              action={
                <Button disabled={busy} onClick={() => requestRefresh('orders')}>
                  同步持仓与订单
                </Button>
              }
            >
              <DataTable
                loading={orders.isPending}
                rows={positionRows}
                columns={positionColumns}
                label="当前持仓"
              />
            </OrderPanel>
          )}
          {page === 'history' && (
            <OrderPanel
              title="入仓历史"
              description="仅记录真实开仓、加仓或反手新开方向；保留最近 100 条，用于 7 天限制。"
            >
              {entries.error && <p role="alert">{entries.error.message}</p>}
              <DataTable
                loading={entries.isPending}
                rows={historyRows}
                columns={historyColumns}
                label="入仓历史"
              />
            </OrderPanel>
          )}
          {page === 'settings' && <SettingsPage />}
          {page === 'activity' && (
            <>
              <Panel>
                <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
                  <ShieldCheck size={18} />
                  <TwoToneTitle title="需要人工核对的交易" description="请求结果" />
                </div>
                {pending.isPending && <p role="status">正在读取待核对状态…</p>}
                {pending.error && <p role="alert">无法确认当前阻断状态，请重试。</p>}
                {!pending.isPending &&
                  !pending.error &&
                  pending.data &&
                  !pending.data.database_error &&
                  pending.data.pending.length === 0 && (
                    <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                      当前没有待核对请求。
                    </p>
                  )}
                {pending.data?.pending.map((intent) => (
                  <article
                    className="mt-4 rounded-xl border border-red-200 bg-red-50 p-5 text-xs dark:border-red-900 dark:bg-red-950/40 [&_code]:block [&_code]:py-4 [&_code]:text-[11px] [&_code]:whitespace-pre-wrap [&_code]:break-all [&_button]:mt-4"
                    key={intent.id}
                  >
                    <strong>
                      {intent.operation === 'create' ? '创建追踪单' : '停止追踪单'} ·{' '}
                      {date(intent.created_at)}
                    </strong>
                    <code>{intent.payload}</code>
                    <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                      本地编号：{intent.id} · 状态：{intent.state}
                      <br />
                      原凭证指纹（不是账户 ID）：{intent.owner || '旧版记录缺失，禁止在线解除'}
                      <br />
                      请求关联：{intent.request_id || '旧版记录缺失'}
                    </p>
                    <Button
                      disabled={resolve.isPending || !intent.owner}
                      onClick={() => {
                        if (
                          confirm(
                            '你已在 Gate 核对这笔请求的真实结果，并确认允许后续自动策略继续执行？确认只解除本地阻断，不会重发原请求。',
                          )
                        ) {
                          const evidence = prompt(
                            '请填写 Gate 订单号、请求关联 text、成交记录或查询结果，至少 8 个字，作为本次人工核对依据：',
                          );
                          if (evidence && evidence.trim().length >= 8)
                            resolve.mutate({ id: intent.id, evidence: evidence.trim() });
                        }
                      }}
                    >
                      已在 Gate 核对，解除此项阻断
                    </Button>
                  </article>
                ))}
                {pending.data?.database_error && <p role="alert">{pending.data.database_error}</p>}
              </Panel>
              <Panel>
                <div className="mb-4 flex flex-wrap items-center gap-2 [&>svg]:size-[18px] [&>svg]:text-zinc-500">
                  <Activity size={18} />
                  <TwoToneTitle title="真实请求与任务记录" description="最近 64 个事件" />
                </div>
                <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  最近 64 个内存事件；持久化请求日志保存在服务端，内容不包含密钥或请求正文。
                </p>
                <ScrollFade label="真实请求与任务记录，可滚动">
                  <MotionList
                    as="ol"
                    className="m-0 list-none p-0 [&>li]:flex [&>li]:items-center [&>li]:gap-3 [&>li]:border-b [&>li]:border-zinc-200 [&>li]:py-4 [&>li]:text-xs dark:[&>li]:border-zinc-700 [&>li>div]:min-w-0 [&>li>div]:flex-1 [&_strong]:block [&_strong]:text-[11px] [&_strong]:break-words [&_time]:text-[10px] [&_time]:whitespace-nowrap [&_time]:text-zinc-500 [&>li>div>span]:text-[10px] [&>li>div>span]:text-zinc-500"
                    items={activityItems}
                  />
                </ScrollFade>
              </Panel>
            </>
          )}
          <footer className="pb-5 text-[10px] text-zinc-500">Orders3</footer>
        </main>
      </div>
    </div>
  );
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section
      data-ui="metric"
      className="min-w-0 p-5 not-first:border-l not-first:border-zinc-200 nth-3:border-t nth-3:border-l-0 nth-4:border-t xl:nth-3:border-t-0 xl:nth-3:border-l xl:nth-4:border-t-0 dark:not-first:border-zinc-700 [&>p]:text-xs [&>p]:text-zinc-500 [&>strong]:my-3 [&>strong]:block [&>strong]:text-3xl [&>strong]:font-semibold [&>span]:text-[10px] [&>span]:text-zinc-500"
    >
      <p>{label}</p>
      <strong className="tabular-nums tracking-tight">
        <AnimatedValue value={value} />
      </strong>
      <span>{detail}</span>
    </section>
  );
}
function OrderPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Panel className="overflow-hidden p-0! md:p-0!">
      <div
        data-ui="panel-title"
        className="flex flex-wrap items-center justify-between gap-4 px-4 pt-6 pb-4 md:px-6"
      >
        <TwoToneTitle title={title} description={description} />
        {action}
      </div>
      {children}
    </Panel>
  );
}
function ExecutionList({
  rows,
}: {
  rows: { action: string; contract: string; error?: string; message?: string; id?: string }[];
}) {
  const items = useMemo(
    () =>
      rows.map((row, index) => ({
        id: `${row.id ?? row.contract}-${index}`,
        version: JSON.stringify(row),
        content: (
          <>
            <Badge tone={row.action === 'failed' ? 'danger' : 'neutral'}>
              {(
                {
                  created: '已创建',
                  stopped: '已停止',
                  skipped: '已保留',
                  failed: '失败',
                } as Record<string, string>
              )[row.action] || row.action}
            </Badge>
            <strong>{row.contract}</strong>
            <span>{row.error || row.message || row.id}</span>
          </>
        ),
      })),
    [rows],
  );
  return (
    <ScrollFade label="最近执行结果，可滚动">
      {rows.length ? (
        <MotionList
          as="ul"
          className="m-0 list-none p-0 [&>li]:flex [&>li]:flex-wrap [&>li]:items-center [&>li]:gap-2 [&>li]:border-b [&>li]:border-zinc-200 [&>li]:py-3 [&>li]:text-xs dark:[&>li]:border-zinc-700 [&>li>span:last-child]:break-words [&>li>span:last-child]:text-zinc-500"
          items={items}
        />
      ) : (
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          尚无执行结果。自动开仓任务完成后会在这里显示。
        </p>
      )}
    </ScrollFade>
  );
}

function eventItems(activity: ActivitySnapshot | undefined) {
  return (
    activity?.events
      .slice()
      .reverse()
      .map((event) => ({
        id: `${activity.instance}-${event.seq}`,
        version: JSON.stringify(event),
        content: (
          <>
            <span
              className={`size-1.5 shrink-0 rounded-full ${event.state === 'completed' ? 'bg-emerald-500' : event.state === 'failed' ? 'bg-red-500' : 'bg-zinc-400'}`}
            />
            <div>
              <strong>
                {event.task} · {event.kind === 'request' ? `${event.method} ${event.host}` : '任务'}
              </strong>
              <span>
                {event.state === 'started' ? '开始' : event.state === 'failed' ? '失败' : '完成'}
                {event.status !== undefined ? ` · HTTP ${event.status}` : ''}
              </span>
            </div>
            <time>{new Date(event.at).toLocaleTimeString()}</time>
          </>
        ),
      })) ?? []
  );
}
