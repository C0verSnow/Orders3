import { useMemo, useRef, useState, useEffect } from 'react';
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, getPaginationRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';
import { ArrowDownUp, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';

export function DataTable<T extends object>({ rows, columns, label }: { rows: T[]; columns: ColumnDef<T>[]; label: string }) {
  const [filter, setFilter] = useState(''), [sorting, setSorting] = useState<SortingState>([]), [selected, setSelected] = useState<T | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const data = useMemo(() => rows, [rows]);
  const table = useReactTable({ data, columns, state: { globalFilter: filter, sorting }, onGlobalFilterChange: setFilter, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), getSortedRowModel: getSortedRowModel(), getPaginationRowModel: getPaginationRowModel(), initialState: { pagination: { pageSize: 20 } } });
  useEffect(() => { if (selected) dialog.current?.showModal(); }, [selected]);
  return <>
    <div className="table-toolbar"><label className="search"><Search size={16} aria-hidden="true"/><input type="search" aria-label={`搜索${label}`} placeholder="搜索合约、状态或订单编号" value={filter} onChange={event => setFilter(event.target.value)}/></label><span className="caption">{table.getFilteredRowModel().rows.length} 条记录</span></div>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`${label}表格，可横向滚动`}>
      <table><caption className="sr-only">{label}</caption><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id} scope="col" aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : undefined}><button className="sort-button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<ArrowDownUp size={12} aria-hidden="true"/></button></th>)}<th scope="col">详情</th></tr>)}</thead>
      <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}<td><button className="text-button" onClick={() => setSelected(row.original)} aria-label={`查看第 ${row.index + 1} 条记录详情`}>查看</button></td></tr>)}</tbody></table>
      {!table.getRowModel().rows.length && <div className="empty"><Search size={24} aria-hidden="true"/><strong>{filter ? '没有匹配的记录' : '还没有订单数据'}</strong><p>{filter ? '试试其他合约或清除搜索。' : '配置连接后刷新，即可同步真实订单。'}</p></div>}
    </div>
    <div className="pagination"><span>第 {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 页</span><div><button aria-label="上一页" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}><ChevronLeft size={16}/></button><button aria-label="下一页" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}><ChevronRight size={16}/></button></div></div>
    <dialog ref={dialog} onClose={() => setSelected(null)} aria-labelledby="detail-title"><div className="dialog-heading"><h2 id="detail-title">订单详情</h2><button aria-label="关闭详情" onClick={() => dialog.current?.close()}><X size={18}/></button></div><p className="caption">保留完整业务字段，数值以服务端确认为准。</p><dl className="details">{selected && Object.entries(selected).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value ?? '—')}</dd></div>)}</dl></dialog>
  </>;
}
