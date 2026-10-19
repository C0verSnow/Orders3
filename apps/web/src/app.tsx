import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Activity, ArrowDownToLine, ArrowUpRight, CircleHelp, Clock3, Database, History, LayoutDashboard, ListOrdered, LogOut, Menu, Monitor, Moon, RefreshCw, Settings2, ShieldCheck, Sun, Wallet, X } from 'lucide-react';
import type { ActivitySnapshot, SourceSnapshot, OrdersSnapshot, Intent, EntryEvent } from '../../../packages/shared/types.ts';
import { api, post } from './services/api';
import { DataTable } from './components/data-table';
import { SettingsPage } from './pages/settings';
import { useTheme } from './hooks/use-theme';

type Row = Record<string, unknown>;
type Page = 'overview' | 'sources' | 'trailing' | 'positions' | 'history' | 'activity' | 'settings';
const pages = [
  { id: 'overview', label: '交易概览', icon: LayoutDashboard }, { id: 'sources', label: '来源订单', icon: Database },
  { id: 'trailing', label: 'Gate 跟踪订单', icon: ListOrdered }, { id: 'positions', label: '持仓与保护', icon: Wallet },
  { id: 'history', label: '真实入仓历史', icon: History }, { id: 'activity', label: '活动与运行状态', icon: Activity }, { id: 'settings', label: '系统设置', icon: Settings2 }
] as const;
const date = (value: unknown) => { const time = typeof value === 'string' ? Date.parse(value) : value; return typeof time === 'number' && Number.isFinite(time) ? new Date(time).toLocaleString() : '—'; };
const status = (value: unknown) => (({ 1: '等待激活', 2: '已激活', 5: '已停止' } as Record<string, string>)[String(value)] ?? `状态 ${value}`);
function columns(fields: [string, string][]): ColumnDef<Row>[] {
  return fields.map(([key, label]) => ({ accessorKey: key, header: label, cell: info => {
    const value = info.getValue();
    if (key === 'timestamp' || key === 'entry_time') return <span className="caption nowrap">{date(value)}</span>;
    if (key === 'original_status') return <span className={`badge ${value === 1 ? 'blue' : ''}`}>{status(value)}</span>;
    if (key === 'reduce_only') return <span className="badge">{value ? '平仓保护' : '开仓追踪'}</span>;
    if (key === 'side') return String(value ?? '—');
    if (key === 'contract') return <strong className="contract">{String(value ?? '—').replace('_', ' / ')}</strong>;
    return <span className="numeric">{String(value ?? '—')}</span>;
  } }));
}
const sourceColumns = columns([['contract', '合约'], ['activation_price', '激活价格'], ['amount', '数量 / 张'], ['side', '来源方向'], ['timestamp', '来源时间']]);
const trailColumns = columns([['contract', '合约'], ['activation_price', '激活价格'], ['amount', '数量 / 张'], ['reduce_only', '用途'], ['original_status', '状态'], ['id', '订单编号'], ['timestamp', '更新时间']]);
const positionColumns = columns([['contract', '合约'], ['size', '持仓 / 张'], ['entry_price', '入仓均价'], ['mark_price', '标记价格'], ['unrealised_pnl', '未实现盈亏'], ['realised_pnl', '已实现盈亏'], ['initial_margin', '固定保证金'], ['close_price', '保护激活价']]);
const historyColumns = columns([['contract', '合约'], ['side', '方向（1 多 / -1 空）'], ['initial_margin', '固定保证金'], ['entry_time', '真实成交时间'], ['event_id', '成交编号']]);

export function App() {
  const themeState = useTheme();
  const [token, setToken] = useState(''), [initialToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token'));
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ authenticated: boolean }>('/api/session'), retry: false });
  const client = useQueryClient();
  const login = useMutation({ mutationFn: (value: string) => api<{ authenticated: boolean }>('/api/session', { method: 'POST', headers: { Authorization: `Bearer ${value}` } }), onSuccess: data => { setToken(''); client.setQueryData(['session'], data); } });
  useEffect(() => {
    if (initialToken) {
      history.replaceState(null, '', location.pathname + location.search);
      login.mutate(initialToken);
    }
    // The URL bootstrap is consumed exactly once; never retain it in storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (session.isPending) return <main className="login"><p role="status">正在连接工作台…</p></main>;
  if (!session.data?.authenticated) return <main className="login"><div className="panel"><div className="brand-mark">O<span>3</span></div><h1>连接你的交易工作台</h1><p className="muted">输入服务启动时显示的登录令牌。凭证与交易调度由你的服务端管理。</p><form onSubmit={(event: FormEvent) => { event.preventDefault(); login.mutate(token); }}><label>工作台登录令牌<input type="password" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" required autoFocus/></label><button className="primary" disabled={login.isPending}>{login.isPending ? '连接中…' : '连接工作台'}<ArrowUpRight size={16}/></button><p role="alert">{login.error?.message || session.error?.message}</p></form><p className="caption">在服务器运行日志中查找“登录令牌”，或使用管理员设置的 ORDERS_ACCESS_TOKEN。</p></div></main>;
  return <Workspace onLogout={() => { client.clear(); }} themeState={themeState}/>;
}

function Workspace({ onLogout, themeState }: { onLogout: () => void; themeState: ReturnType<typeof useTheme> }) {
  const client = useQueryClient(), [page, setPage] = useState<Page>('overview'), [menu, setMenu] = useState(false), [showStopped, setShowStopped] = useState(false);
  const [theme, setTheme] = themeState, [notice, setNotice] = useState('');
  const [compact, setCompact] = useState(() => matchMedia('(max-width:768px)').matches), navigation = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = matchMedia('(max-width:768px)'), update = () => setCompact(media.matches);
    media.addEventListener('change', update); return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!compact || !menu) return;
    const previous = document.activeElement as HTMLElement, overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const controls = () => Array.from(navigation.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select,a[href]') ?? []).filter(element => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(false); return; }
      if (event.key !== 'Tab') return;
      const elements = controls(), first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [compact, menu]);
  const source = useQuery({ queryKey: ['sources'], queryFn: () => api<SourceSnapshot>('/api/data'), refetchInterval: query => query.state.data?.refreshing ? 5000 : 60000 });
  const orders = useQuery({ queryKey: ['orders'], queryFn: () => api<OrdersSnapshot>('/api/orders'), refetchInterval: 60000 });
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api<ActivitySnapshot>('/api/activity', { signal: AbortSignal.timeout(3000) }), refetchInterval: 600, retry: false });
  const pending = useQuery({ queryKey: ['pending'], queryFn: () => api<{ pending: Intent[]; database_error: string | null }>('/api/status'), refetchInterval: 5000 });
  const entries = useQuery({ queryKey: ['history'], queryFn: () => api<{ entries: EntryEvent[] }>('/api/history'), enabled: page === 'history', refetchInterval: 60000 });
  const completedSeq = activity.data?.events.filter(event => event.kind === 'task' && event.state !== 'started').at(-1)?.seq;
  useEffect(() => {
    if (completedSeq !== undefined) { for (const key of ['sources', 'orders', 'pending', 'history']) void client.invalidateQueries({ queryKey: [key] }); }
  }, [completedSeq, activity.data?.instance, client]);
  useEffect(() => {
    for (const error of [source.error, orders.error, activity.error]) if (error && 'status' in error && error.status === 401) { client.clear(); return; }
  }, [source.error, orders.error, activity.error, client]);
  const refresh = useMutation({ mutationFn: async (which: 'all' | 'sources' | 'orders') => {
    if (which !== 'orders') await post('/api/refresh');
    if (which !== 'sources') await post('/api/orders/refresh');
  }, onSuccess: () => setNotice('刷新完成，以下为服务端确认的数据。'), onError: error => setNotice(error.message), onSettled: () => { for (const key of ['sources', 'orders', 'pending']) void client.invalidateQueries({ queryKey: [key] }); } });
  const resolve = useMutation({ mutationFn: (input: { id: string; evidence: string }) => post('/api/intents/resolve', { ...input, confirmed_exchange_review: true }), onSuccess: () => { setNotice('已记录人工核对，未重新发送交易。'); void client.invalidateQueries({ queryKey: ['pending'] }); }, onError: error => setNotice(error.message) });
  const logout = useMutation({ mutationFn: () => api('/api/session', { method: 'DELETE' }), onSuccess: onLogout, onError: error => setNotice(error.message) });
  const download = async () => {
    try {
      const response = await fetch('/api/download', { credentials: 'same-origin' });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error || '下载失败'); }
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a'); link.href = url; link.download = 'data.db'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice(error instanceof Error ? error.message : '下载失败'); }
  };
  const sourceRows = useMemo(() => source.data?.orders.map(row => ({ ...row, source_record: source.data?.items[row.record_position] })) ?? [], [source.data]);
  const trailingRows = useMemo(() => orders.data?.orders.filter(row => showStopped || row.original_status !== 5).map(row => ({ ...row })) ?? [], [orders.data, showStopped]);
  const positionRows = useMemo(() => orders.data?.positions.map(row => ({ ...row })) ?? [], [orders.data]);
  const historyRows = useMemo(() => entries.data?.entries.map(row => ({ ...row })) ?? [], [entries.data]);
  const busy = refresh.isPending || source.data?.refreshing || orders.data?.refreshing;
  const heading = pages.find(item => item.id === page)!;
  const requestRefresh = (which: 'all' | 'sources' | 'orders') => {
    const message = which === 'orders' ? '刷新会同步 Gate 持仓，并按现有策略停止或补建平仓保护单。确认执行？' : '刷新来源会同步真实订单，并可能停止旧开仓单、提交新开仓单；统一刷新还会处理持仓保护。确认执行？';
    if (confirm(message)) { setNotice('正在同步，请等待服务端确认结果…'); refresh.mutate(which); }
  };
  return <div className="workspace"><a href="#main" className="skip-link">跳到主要内容</a>{menu && <button className="nav-backdrop" aria-label="关闭导航" onClick={() => setMenu(false)}/>}
    <aside ref={navigation} inert={compact && !menu} className={`sidebar ${menu ? 'open' : ''}`}><div className="brand"><div className="brand-mark">O<span>3</span></div><div><strong>Orders3</strong><span>特洛伊资本 · 交易工作台</span></div><button className="mobile-only" aria-label="关闭导航" onClick={() => setMenu(false)}><X size={18}/></button></div><p className="nav-label">工作空间</p><nav aria-label="主要导航">{pages.map(item => <button key={item.id} className={page === item.id ? 'selected' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => { setPage(item.id); setMenu(false); }}><item.icon size={17} strokeWidth={1.7}/>{item.label}{item.id === 'activity' && !!pending.data?.pending.length && <span className="count">{pending.data.pending.length}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="connection"><span className={`status-dot ${activity.error ? 'offline' : ''}`}/><span>{activity.error ? '连接中断，正在重连' : '服务端已连接'}</span></div><p className="caption">交易状态以 Gate 实际记录为准</p><label className="theme-picker"><span className="sr-only">外观主题</span>{theme === 'dark' ? <Moon size={16}/> : theme === 'light' ? <Sun size={16}/> : <Monitor size={16}/>}<select value={theme} onChange={event => setTheme(event.target.value as typeof theme)}><option value="system">跟随系统</option><option value="light">浅色外观</option><option value="dark">深色外观</option></select></label><button className="text-button" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={14}/>退出工作台</button></div></aside>
    <div className="main-column" inert={compact && menu}><header className="topbar"><div className="breadcrumb"><button className="mobile-only" onClick={() => setMenu(true)} aria-label="打开导航"><Menu size={20}/></button><span>工作空间</span><span className="separator">/</span><strong>{heading.label}</strong></div><div className="topbar-actions"><button className="quiet" onClick={download}><ArrowDownToLine size={16}/><span>下载数据库</span></button><span className="avatar" aria-label="本地受信任会话">T</span></div></header>
    <main id="main" tabIndex={-1}><div className="page-heading"><div><p className="eyebrow">ORDERS WORKSPACE</p><h1>{heading.label}</h1><p className="muted">{page === 'overview' ? '看清每一笔订单，掌握每一次执行。' : page === 'settings' ? '管理连接、存储与自动追踪。' : '真实数据同步，保留完整业务记录。'}</p></div>{page !== 'settings' && <button className="primary" disabled={busy} onClick={() => requestRefresh('all')}><RefreshCw size={16} className={busy ? 'spin' : ''}/>{busy ? '正在同步…' : '统一刷新'}</button>}</div>
    {notice && <div className="notice" role="status">{notice}<button aria-label="关闭提示" onClick={() => setNotice('')}><X size={14}/></button></div>}
    {(source.error || orders.error || source.data?.error || orders.data?.error || activity.error || pending.error || pending.data?.database_error) && <div className="error-banner" role="alert"><CircleHelp size={18}/><div><strong>{activity.error ? '连接暂时中断，当前列表可能不是最新数据' : '有任务需要检查'}</strong><p>{pending.error ? '无法确认当前阻断状态，请重新读取状态。' : pending.data?.database_error || source.error?.message || orders.error?.message || source.data?.error || orders.data?.error || activity.error?.message}</p><button className="text-button" onClick={() => { void client.invalidateQueries(); }}>重新读取状态</button></div></div>}
    {!!pending.data?.pending.length && <div className="error-banner" role="alert"><ShieldCheck size={20}/><div><strong>自动交易已暂停：有 {pending.data.pending.length} 笔请求结果需要核对</strong><p>请先在 Gate 查看真实订单与成交，确认后到“活动与运行状态”处理。系统不会自动重发这些请求。</p><button className="text-button" onClick={() => setPage('activity')}>查看待核对交易<ArrowUpRight size={14}/></button></div></div>}
    {(page === 'overview') && <><div className="metrics"><Metric label="来源订单" value={source.data ? String(source.data.orders.length) : '—'} detail="完整分页后保存"/><Metric label="有效跟踪订单" value={orders.data ? String(orders.data.orders.filter(row => [1, 2].includes(row.original_status)).length) : '—'} detail="等待激活与已激活"/><Metric label="未实现盈亏 / USDT" value={orders.data?.unrealised_pnl ?? '—'} detail="当前非零持仓合计"/><Metric label="已实现盈亏 / USDT" value={orders.data?.realised_pnl ?? '—'} detail="缓存持仓口径，非全历史"/></div><section className="panel execution-panel"><div><span className="live-label"><span className={`status-dot ${activity.error ? 'offline' : ''}`}/>执行状态</span><h2>{activity.error ? '等待重新连接' : activity.data?.active ? `${activity.data.active} 个真实网络请求进行中` : '所有请求已结束'}</h2><p className="muted">来源抓取 → 成交核对 → 交易执行 → 持久化确认</p></div><div className="execution-stats"><span><strong>{activity.data?.total ?? '—'}</strong>本次进程请求</span><span><strong>{source.data?.phase ?? '—'}</strong>来源任务阶段</span><span><strong>{orders.data ? `${Math.floor(orders.data.uptime_ms / 60000)} 分钟` : '—'}</strong>运行时长</span></div></section><OrderPanel title="订单工作台" description="来源信号与 Gate 跟踪单，共用同一套交易规则。" action={<button className="quiet" disabled={busy} onClick={() => requestRefresh('sources')}><RefreshCw size={14}/>刷新来源</button>}><DataTable rows={sourceRows} columns={sourceColumns} label="来源订单"/></OrderPanel><div className="two-column"><section className="panel"><div className="panel-heading"><ShieldCheck size={18}/><h2>持仓保护</h2></div><p className="feature-number">{orders.data?.positions.length ?? '—'}<span>个非零持仓方向</span></p><p className="muted">固定入仓保证金计算目标，独立每分钟核对保护单。</p><button className="text-button" onClick={() => setPage('positions')}>查看持仓与保护<ArrowUpRight size={14}/></button></section><section className="panel"><div className="panel-heading"><Clock3 size={18}/><h2>最近执行结果</h2></div><ExecutionList rows={[...(source.data?.execution ?? []), ...(orders.data?.close_execution ?? [])].slice(-10)}/></section></div></>}
    {page === 'sources' && <OrderPanel title="来源订单" description={`最近保存：${source.data?.updated_at ? new Date(source.data.updated_at).toLocaleString() : '尚未同步'} · 详情保留完整来源记录`} action={<button disabled={busy} onClick={() => requestRefresh('sources')}>刷新来源并执行策略</button>}><DataTable rows={sourceRows} columns={sourceColumns} label="来源订单"/></OrderPanel>}
    {page === 'trailing' && <OrderPanel title="Gate 跟踪订单" description={`状态 2 保留；状态 5 默认隐藏。订单最近同步：${date(orders.data?.trailing_updated_at)}`} action={<label className="checkbox"><input type="checkbox" checked={showStopped} onChange={event => setShowStopped(event.target.checked)}/>显示已停止</label>}><DataTable rows={trailingRows} columns={trailColumns} label="Gate 跟踪订单"/></OrderPanel>}
    {page === 'positions' && <><OrderPanel title="持仓与平仓保护" description={`保护价为追踪激活价。持仓最近同步：${date(orders.data?.position_updated_at)}；订单最近同步：${date(orders.data?.trailing_updated_at)}`} action={<button disabled={busy} onClick={() => requestRefresh('orders')}>同步持仓并核对保护单</button>}><DataTable rows={positionRows} columns={positionColumns} label="持仓"/></OrderPanel><section className="panel"><h2>平仓保护执行结果</h2><ExecutionList rows={orders.data?.close_execution ?? []}/></section></>}
    {page === 'history' && <OrderPanel title="真实入仓历史" description="仅记录真实开仓、加仓或反手新开方向；保留最近 100 条，用于 7 天限制。">{entries.error && <p role="alert">{entries.error.message}</p>}<DataTable rows={historyRows} columns={historyColumns} label="入仓历史"/></OrderPanel>}
    {page === 'settings' && <SettingsPage/>}
    {page === 'activity' && <><section className="panel"><div className="panel-heading"><ShieldCheck size={18}/><h2>需要人工核对的交易</h2></div>{pending.isPending && <p role="status">正在读取待核对状态…</p>}{pending.error && <p role="alert">无法确认当前阻断状态，请重试。</p>}{!pending.isPending && !pending.error && pending.data && !pending.data.database_error && pending.data.pending.length === 0 && <p className="muted">当前没有待核对请求。</p>}{pending.data?.pending.map(intent => <article className="pending-intent" key={intent.id}><strong>{intent.operation === 'create' ? '创建追踪单' : '停止追踪单'} · {date(intent.created_at)}</strong><code>{intent.payload}</code><p className="caption">本地编号：{intent.id} · 状态：{intent.state}<br/>原凭证指纹（不是账户 ID）：{intent.owner || '旧版记录缺失，禁止在线解除'}<br/>请求关联：{intent.request_id || '旧版记录缺失'}</p><button disabled={resolve.isPending || !intent.owner} onClick={() => { if (confirm('你已在 Gate 核对这笔请求的真实结果，并确认允许后续自动策略继续执行？确认只解除本地阻断，不会重发原请求。')) { const evidence = prompt('请填写 Gate 订单号、请求关联 text、成交记录或查询结果，至少 8 个字，作为本次人工核对依据：'); if (evidence && evidence.trim().length >= 8) resolve.mutate({ id: intent.id, evidence: evidence.trim() }); } }}>已在 Gate 核对，解除此项阻断</button></article>)}{pending.data?.database_error && <p role="alert">{pending.data.database_error}</p>}</section><section className="panel"><div className="panel-heading"><Activity size={18}/><h2>真实请求与任务记录</h2></div><p className="caption">最近 64 个内存事件；持久化请求日志保存在服务端，内容不包含密钥或请求正文。</p><ol className="event-list">{activity.data?.events.slice().reverse().map(event => <li key={event.seq}><span className={`event-dot ${event.state}`}/><div><strong>{event.task} · {event.kind === 'request' ? `${event.method} ${event.host}` : '任务'}</strong><span>{event.state === 'started' ? '开始' : event.state === 'failed' ? '失败' : '完成'}{event.status !== undefined ? ` · HTTP ${event.status}` : ''}</span></div><time>{new Date(event.at).toLocaleTimeString()}</time></li>)}</ol></section></>}
    <footer>Orders3<span>服务端确认 · 十进制计算 · 原始记录可追溯</span></footer></main></div>
  </div>;
}
function Metric({ label, value, detail }: { label: string; value: string; detail: string }) { return <section className="metric"><p>{label}</p><strong className="numeric">{value}</strong><span>{detail}</span></section>; }
function OrderPanel({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) { return <section className="panel table-panel"><div className="panel-title"><div><h2>{title}</h2><p className="caption">{description}</p></div>{action}</div>{children}</section>; }
function ExecutionList({ rows }: { rows: { action: string; contract: string; error?: string; message?: string; id?: string }[] }) { return rows.length ? <ul className="execution-list">{rows.map((row, index) => <li key={`${row.id}-${index}`}><span className={`badge ${row.action === 'failed' ? 'danger' : ''}`}>{({ created: '已创建', stopped: '已停止', skipped: '已保留', failed: '失败' } as Record<string, string>)[row.action] || row.action}</span><strong>{row.contract}</strong><span>{row.error || row.message || row.id}</span></li>)}</ul> : <p className="muted">尚无执行结果。刷新或自动任务完成后会在这里显示。</p>; }
