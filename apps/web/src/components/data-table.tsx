import { t, useLanguage } from '../i18n';
import { Button, Input } from './ui';
import { useMemo, useRef, useState, useEffect } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDownUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { FadeIn, MotionList, ScrollFade } from './motion';
import { OrderDetails } from './order-details';

export function DataTable<T extends object>({
  rows,
  columns,
  label,
  loading = false,
}: {
  rows: T[];
  columns: ColumnDef<T>[];
  label: string;
  loading?: boolean;
}) {
  const language = useLanguage();
  const [filter, setFilter] = useState(''),
    [sorting, setSorting] = useState<SortingState>([]),
    [selected, setSelected] = useState<T | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const data = useMemo(() => rows, [rows]);
  const table = useReactTable({
    data,
    columns,
    state: { globalFilter: filter, sorting },
    onGlobalFilterChange: setFilter,
    onSortingChange: setSorting,
    getRowId: (row, index) => {
      const record = row as Record<string, unknown>;
      return String(
        record.event_id ??
          record.source_id ??
          record.id ??
          (record.record_position !== undefined
            ? `source-${record.record_position}-${record.order_index}`
            : record.contract
              ? `${record.contract}-${record.side ?? ''}-${record.size ?? ''}`
              : index),
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
  });
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
  }, [selected]);
  const visibleRows = table.getRowModel().rows;
  const items = useMemo(
    () =>
      visibleRows.map((row) => ({
        id: row.id,
        version: JSON.stringify(row.getVisibleCells().map((cell) => cell.getValue())),
        content: (
          <>
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
            ))}
            <td>
              <Button
                variant="text"
                className="relative z-30"
                onClick={() => setSelected(row.original)}
                aria-label={t('查看第 {0} 条记录详情', [row.index + 1])}
              >
                {t('查看')}
              </Button>
            </td>
          </>
        ),
      })),
    [visibleRows, language],
  );
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 pb-4 md:px-6">
        <label className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-0">
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            aria-label={t('搜索{0}', [label])}
            placeholder={t('搜索合约、状态或订单编号')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <span className="shrink-0 text-[10px] text-zinc-500">
          {t('{0} 条记录', [table.getFilteredRowModel().rows.length])}
        </span>
      </div>
      <ScrollFade table compact={rows.length <= 3} label={t('{0}表格，可横向或纵向滚动', [label])}>
        <table className="w-full font-sans text-zinc-900 dark:text-zinc-100 border-collapse text-left text-xs whitespace-nowrap [&_th]:border-y [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-4 [&_th]:py-1 [&_th]:font-medium [&_th]:text-zinc-500 [&_td]:text-inherit [&_td]:font-sans [&_td]:max-w-[340px] [&_td]:overflow-hidden [&_td]:border-b [&_td]:border-zinc-200 [&_td]:px-4 [&_td]:py-4 [&_td]:text-ellipsis dark:[&_th]:border-zinc-800 dark:[&_th]:bg-zinc-950 dark:[&_td]:border-zinc-800 [&_tbody_tr]:transition-[background-color] [&_tbody_tr:hover]:bg-zinc-50 dark:[&_tbody_tr:hover]:bg-zinc-800/50">
          <caption className="sr-only">{label}</caption>
          <thead className="sticky top-0 z-40">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      header.column.getIsSorted() === 'asc'
                        ? 'ascending'
                        : header.column.getIsSorted() === 'desc'
                          ? 'descending'
                          : undefined
                    }
                  >
                    <Button
                      className="min-h-8! border-0! bg-transparent! px-0! text-[11px]! font-medium! text-zinc-500!"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <ArrowDownUp size={12} aria-hidden="true" />
                    </Button>
                  </th>
                ))}
                <th scope="col">{t('详情')}</th>
              </tr>
            ))}
          </thead>
          <MotionList items={items} />
        </table>
        {loading && (
          <FadeIn
            className="flex min-h-36 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500 [&>strong]:font-medium [&>strong]:text-zinc-900 dark:[&>strong]:text-zinc-100 [&>p]:text-xs"
            role="status"
          >
            {t('正在读取{0}…', [label])}
          </FadeIn>
        )}
        {!loading && !table.getRowModel().rows.length && (
          <FadeIn className="flex min-h-36 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500 [&>strong]:font-medium [&>strong]:text-zinc-900 dark:[&>strong]:text-zinc-100 [&>p]:text-xs">
            <Search size={24} aria-hidden="true" />
            <strong>{filter ? t('没有匹配的记录') : t('还没有订单数据')}</strong>
            <p>
              {filter ? t('试试其他合约或清除搜索。') : t('配置连接后刷新，即可同步真实订单。')}
            </p>
          </FadeIn>
        )}
      </ScrollFade>
      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-[10px] text-zinc-500 md:px-6 dark:border-zinc-700 [&>div]:flex [&>div]:gap-2 [&_button]:min-h-8 [&_button]:p-1.5">
        <span>
          {t('第 {0} / {1} 页', [
            table.getState().pagination.pageIndex + 1,
            Math.max(1, table.getPageCount()),
          ])}
        </span>
        <div>
          <Button
            aria-label={t('上一页')}
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            aria-label={t('下一页')}
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight size={16} />
          </Button>
        </div>
      </div>
      <dialog
        ref={dialog}
        className="fixed inset-0 m-auto font-sans max-h-[calc(100dvh-32px)] w-[min(720px,calc(100vw-32px))] overflow-auto overscroll-contain rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl backdrop:bg-black/30 backdrop:backdrop-blur-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        onClose={() => setSelected(null)}
        aria-label={t('{0}详情', [label])}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < rect.left ||
              event.clientX > rect.right ||
              event.clientY < rect.top ||
              event.clientY > rect.bottom
            )
              dialog.current?.close();
          }
        }}
      >
        {selected && (
          <OrderDetails row={selected} label={label} onClose={() => dialog.current?.close()} />
        )}
      </dialog>
    </>
  );
}
