import { Button } from './ui';
import { X } from 'lucide-react';
import { two } from '../../../../packages/decimal/index.ts';

const labels: Record<string, string> = {
  source_record: '完整来源记录',
  contract: '合约',
  side: '方向',
  amount: '数量 / 张',
  size: '持仓 / 张',
  activation_price: '激活价格',
  entry_price: '入仓均价',
  mark_price: '标记价格',
  value: '持仓价值',
  leverage_max: '最大杠杆',
  initial_margin: '持仓保证金',
  unrealised_pnl: '未实现盈亏',
  realised_pnl: '已实现盈亏',
  timestamp: '来源时间',
  entry_time: '成交时间',
  id: '订单编号',
  event_id: '成交编号',
  reduce_only: '订单用途',
  original_status: '订单状态',
  record_position: '来源记录位置',
  order_index: '订单序号',
  price_round: 'Supabase 下单步长',
  order_price_round: 'Gate 价格步长',
  quanto_multiplier: '合约乘数',
  raw_activation_price: '原始激活价格',
  raw_amount: '原始数量',
};
const numeric = new Set([
  'amount',
  'size',
  'activation_price',
  'entry_price',
  'mark_price',
  'value',
  'leverage_max',
  'initial_margin',
  'unrealised_pnl',
  'realised_pnl',
]);
const technical = new Set([
  'source_record',
  'price_round',
  'order_price_round',
  'quanto_multiplier',
  'raw_activation_price',
  'raw_amount',
  'record_position',
  'order_index',
]);
function display(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (numeric.has(key)) {
    try {
      return two(String(value));
    } catch {
      return String(value);
    }
  }
  if (key === 'timestamp' || key === 'entry_time') {
    const time = Number(value);
    if (Number.isFinite(time) && !Number.isNaN(new Date(time).getTime()))
      return new Date(time).toLocaleString();
  }
  if (key === 'reduce_only') return value ? '仅平仓' : '开仓追踪';
  if (key === 'original_status')
    return (
      ({ 1: '等待激活', 2: '已激活', 5: '已停止' } as Record<string, string>)[String(value)] ??
      String(value)
    );
  if (key === 'side')
    return (
      (
        { 'Open Long': '开多', 'Open Short': '开空', buy: '买入', sell: '卖出' } as Record<
          string,
          string
        >
      )[String(value)] ?? String(value)
    );
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
export function OrderDetails({
  row,
  label,
  onClose,
}: {
  row: object;
  label: string;
  onClose: () => void;
}) {
  const entries = Object.entries(row),
    contract = entries.find(([key]) => key === 'contract')?.[1];
  const group = (items: [string, unknown][]) => (
    <dl className="m-0 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 sm:grid-cols-2 dark:border-zinc-700 dark:bg-zinc-700 [&>div]:min-w-0 [&>div]:bg-white [&>div]:p-4 sm:[&>div:last-child:nth-child(odd)]:col-span-2 dark:[&>div]:bg-zinc-900 [&_dt]:mb-2 [&_dt]:text-[11px] [&_dt]:text-zinc-500 [&_dd]:text-sm [&_dd]:leading-relaxed [&_dd]:font-medium [&_dd]:whitespace-pre-wrap [&_dd]:[overflow-wrap:anywhere] [&_dd]:tabular-nums [&_pre]:mt-3 [&_pre]:text-[11px] [&_pre]:font-normal [&_pre]:whitespace-pre-wrap [&_pre]:[overflow-wrap:anywhere] [&_summary]:cursor-pointer [&_summary]:text-blue-600 dark:[&_summary]:text-blue-400">
      {items.map(([key, value]) => (
        <div key={key}>
          <dt>{labels[key] ?? key}</dt>
          <dd title={String(value ?? '')}>
            {value !== null && typeof value === 'object' ? (
              <details>
                <summary>展开原始记录</summary>
                <pre>{display(key, value)}</pre>
              </details>
            ) : (
              display(key, value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
  const primary = entries.filter(([key]) => !technical.has(key)),
    precision = entries.filter(([key]) => technical.has(key));
  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-zinc-200 bg-white p-5 md:px-7 dark:border-zinc-700 dark:bg-zinc-900 [&>div]:min-w-0 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:break-words">
        <div>
          <p className="mb-3 text-[10px] font-semibold tracking-[.14em] text-zinc-500 dark:text-zinc-400">
            {label}
          </p>
          <h2>{contract ? String(contract).replace('_', ' / ') : '记录详情'}</h2>
        </div>
        <Button variant="quiet" aria-label="关闭详情" onClick={onClose} autoFocus>
          <X size={20} />
        </Button>
      </header>
      <div className="p-5 md:p-7 [&_h3]:mb-4 [&_h3]:text-xs [&_h3]:font-semibold [&_h3]:text-zinc-500">
        <section aria-label="业务信息">
          <h3>业务信息</h3>
          {group(primary)}
        </section>
        {!!precision.length && (
          <section
            className="mt-6 [&>p]:mb-4 [&_dd]:font-mono [&_dd]:text-xs [&_dd]:font-normal"
            aria-label="原始值与精度"
          >
            <h3>原始值与精度</h3>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              以下保留原始精度，步长不做两位小数舍入。
            </p>
            {group(precision)}
          </section>
        )}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 bg-zinc-50 px-5 py-4 text-[10px] text-zinc-500 md:px-7 dark:border-zinc-700 dark:bg-zinc-950">
        <span>交易状态以 Gate 实际记录为准</span>
        <Button onClick={onClose}>关闭详情</Button>
      </footer>
    </>
  );
}
