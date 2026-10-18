import {useEffect, useMemo, useState, type ReactNode} from "react";
import {gridPage} from "../model";
import {Empty} from "./Primitives";

export interface Column<T> {label: string; numeric?: boolean; className?: string; render: (row: T) => ReactNode}
interface Props<T> {
  id: string; rows: readonly T[]; columns: Column<T>[]; rowKey: (row: T, index: number) => string;
  caption: string; searchLabel: string; filters: [string, string][]; sorts: {id: string; label: string; compare: (a: T, b: T) => number}[];
  matches: (row: T, query: string, status: string) => boolean; pageSize?: number; loading?: boolean; error?: string;
  className?: string; searchId?: string; filterId?: string;
}
export function DataGrid<T>({id, rows, columns, rowKey, caption, searchLabel, filters, sorts, matches, pageSize = 25, loading, error, className = "", searchId = `${id}-search`, filterId = `${id}-filter`}: Props<T>) {
  const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [sort, setSort] = useState(sorts[0].id), [page, setPage] = useState(1);
  const view = useMemo(() => gridPage(rows, {query, status, page, pageSize, matches, compare: sorts.find((mode) => mode.id === sort)?.compare}), [rows, query, status, page, pageSize, matches, sorts, sort]);
  useEffect(() => { if (page !== view.page) setPage(view.page); }, [page, view.page]);
  return <>
    <div className="toolbar"><label className="search"><span aria-hidden="true">⌕</span><input id={searchId} type="search" aria-label={searchLabel} placeholder={searchLabel} value={query} onChange={(event) => {setQuery(event.target.value); setPage(1);}} /></label>
      <label className="filter">筛选 <select id={filterId} value={status} onChange={(event) => {setStatus(event.target.value); setPage(1);}}>{filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="filter">排序 <select id={`${id}-sort`} value={sort} onChange={(event) => {setSort(event.target.value); setPage(1);}}>{sorts.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select></label></div>
    <div id={`${id}-records`} className="panel-content" aria-busy={loading || undefined}>
      {view.rows.length ? <div className="table-scroll" role="region" tabIndex={0} aria-label={`${caption}，可横向滚动查看全部列`}><table className={`data-table ${className}`}><caption className="sr-only">{caption}</caption><thead><tr>{columns.map((column) => <th key={column.label} scope="col" className={column.numeric ? "numeric" : ""}>{column.label}</th>)}</tr></thead><tbody>{view.rows.map((row, index) => <tr key={rowKey(row, index)}>{columns.map((column) => <td key={column.label} className={`${column.numeric ? "numeric " : ""}${column.className || ""}`}>{column.render(row)}</td>)}</tr>)}</tbody></table></div>
        : <Empty>{loading ? "正在读取本地快照…" : error ? "读取失败。请重读本地快照；已有数据会在恢复连接后显示。" : rows.length ? "没有匹配的记录，试试其他关键词或筛选。" : "当前快照暂无记录。"}</Empty>}
    </div>
    <div className="pagination"><span id={`${id}-page`} role="status">{view.matched} / {view.total} 条 · 第 {view.page} / {view.pages} 页</span><div><button id={`${id}-prev`} type="button" className="secondary" disabled={view.page === 1} onClick={() => setPage(view.page - 1)}>上一页</button><button id={`${id}-next`} type="button" className="secondary" disabled={view.page === view.pages} onClick={() => setPage(view.page + 1)}>下一页</button></div></div>
  </>;
}
