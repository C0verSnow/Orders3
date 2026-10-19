import { useMemo, useRef, useState, useEffect } from 'react';
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, getPaginationRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { ArrowDownUp, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { MotionList, ScrollFade } from './motion';
import { OrderDetails } from './order-details';

export function DataTable<T extends object>({ rows, columns, label, loading = false }: { rows: T[]; columns: ColumnDef<T>[]; label: string; loading?: boolean }) {
  const [filter, setFilter] = useState(''), [sorting, setSorting] = useState<SortingState>([]), [selected, setSelected] = useState<T | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const data = useMemo(() => rows, [rows]);
  const table = useReactTable({ data, columns, state: { globalFilter: filter, sorting }, onGlobalFilterChange: setFilter, onSortingChange: setSorting,
    getRowId: (row, index) => {
      const record = row as Record<string, unknown>;
      return String(record.event_id ?? record.id ?? (record.record_position !== undefined ? `source-${record.record_position}-${record.order_index}` : record.contract ? `${record.contract}-${record.side ?? ''}` : index));
    }, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 20 } } });
  useEffect(() => { if (selected && !dialog.current?.open) dialog.current?.showModal(); }, [selected]);
  const visibleRows = table.getRowModel().rows;
  const items = useMemo(() => visibleRows.map(row => ({
    id: row.id, version: JSON.stringify(row.getVisibleCells().map(cell => cell.getValue())),
    content: <>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}<td><button className="text-button" onClick={() => setSelected(row.original)} aria-label={`查看第 ${row.index + 1} 条记录详情`}>查看</button></td></>
  })), [visibleRows]);
  return <>
    <div className="table-toolbar"><label className="search"><Search size={16} aria-hidden="true"/><input type="search" aria-label={`搜索${label}`} placeholder="搜索合约、状态或订单编号" value={filter} onChange={event => setFilter(event.target.value)}/></label><span className="caption">{table.getFilteredRowModel().rows.length} 条记录</span></div>
    <ScrollFade className="table-scroll" label={`${label}表格，可横向或纵向滚动`}>
      <table><caption className="sr-only">{label}</caption><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}><button className="sort-button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<ArrowDownUp size={12} aria-hidden="true"/></button></th>)}<th scope="col">详情</th></tr>)}</thead>
      <MotionList items={items}/></table>
      {loading && <div className="empty" role="status">正在读取{label}…</div>}
      {!loading && !table.getRowModel().rows.length && <div className="empty"><Search size={24} aria-hidden="true"/><strong>{filter ? '没有匹配的记录' : '还没有订单数据'}</strong><p>{filter ? '试试其他合约或清除搜索。' : '配置连接后刷新，即可同步真实订单。'}</p></div>}
    </ScrollFade>
    <div className="pagination"><span>第 {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 页</span><div><button aria-label="上一页" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft size={16}/></button><button aria-label="下一页" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight size={16}/></button></div></div>
    <dialog ref={dialog} className="order-dialog" onClose={() => setSelected(null)} aria-label={`${label}详情`} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.current?.close(); } }}>
      {selected && <OrderDetails row={selected} label={label} onClose={() => dialog.current?.close()}/>}
    </dialog>
  </>;
}
