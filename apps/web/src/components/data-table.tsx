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
          record.id ??
          (record.record_position !== undefined
            ? `source-${record.record_position}-${record.order_index}`
            : record.contract
              ? `${record.contract}-${record.side ?? ''}`
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
                onClick={() => setSelected(row.original)}
                aria-label={`查看第 ${row.index + 1} 条记录详情`}
              >
                查看
              </Button>
            </td>
          </>
        ),
      })),
    [visibleRows],
  );
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 pb-4 md:px-6">
        <label className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950 [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-0">
          <Search size={16} aria-hidden="true" />
          <Input
            type="search"
            aria-label={`搜索${label}`}
            placeholder="搜索合约、状态或订单编号"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
        <span className="shrink-0 text-[10px] text-zinc-500">
          {table.getFilteredRowModel().rows.length} 条记录
        </span>
      </div>
      <ScrollFade table compact={rows.length <= 3} label={`${label}表格，可横向或纵向滚动`}>
        <table className="w-full font-sans text-zinc-900 dark:text-zinc-100 border-collapse text-left text-xs whitespace-nowrap [&_th]:border-y [&_th]:border-zinc-200 [&_th]:bg-zinc-50 [&_th]:px-4 [&_th]:py-1 [&_th]:font-medium [&_th]:text-zinc-500 [&_td]:text-inherit [&_td]:font-sans [&_td]:max-w-[340px] [&_td]:overflow-hidden [&_td]:border-b [&_td]:border-zinc-200 [&_td]:px-4 [&_td]:py-4 [&_td]:text-ellipsis dark:[&_th]:border-zinc-800 dark:[&_th]:bg-zinc-950 dark:[&_td]:border-zinc-800 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-zinc-50 dark:[&_tbody_tr:hover]:bg-zinc-800/50">
          <caption className="sr-only">{label}</caption>
          <thead className="sticky top-0 z-10">
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
                <th scope="col">详情</th>
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
            正在读取{label}…
          </FadeIn>
        )}
        {!loading && !table.getRowModel().rows.length && (
          <FadeIn className="flex min-h-36 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-zinc-500 [&>strong]:font-medium [&>strong]:text-zinc-900 dark:[&>strong]:text-zinc-100 [&>p]:text-xs">
            <Search size={24} aria-hidden="true" />
            <strong>{filter ? '没有匹配的记录' : '还没有订单数据'}</strong>
            <p>{filter ? '试试其他合约或清除搜索。' : '配置连接后刷新，即可同步真实订单。'}</p>
          </FadeIn>
        )}
      </ScrollFade>
      <div className="flex items-center justify-between border-t border-zinc-200 px-4 py-3 text-[10px] text-zinc-500 md:px-6 dark:border-zinc-700 [&>div]:flex [&>div]:gap-2 [&_button]:min-h-8 [&_button]:p-1.5">
        <span>
          第 {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 页
        </span>
        <div>
          <Button
            aria-label="上一页"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            aria-label="下一页"
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
        aria-label={`${label}详情`}
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
