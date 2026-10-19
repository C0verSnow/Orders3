export type DecimalText = string;
export interface SourceOrder {
  record_position: number; order_index: number; contract: string;
  activation_price: DecimalText; amount: DecimalText; side: string | null; timestamp: number;
  quanto_multiplier?: string;
  order_price_round?: string; // Gate tick after source enrichment.
  price_round?: string; // Internal snapshot of Supabase orders.order_price_round.
}
export interface TrailOrder {
  id: string; contract: string; amount: DecimalText; activation_price: DecimalText;
  reduce_only: boolean; original_status: number; timestamp: number;
}
export interface Position {
  contract: string; size: string; entry_price: string; value: string;
  leverage_max: string; unrealised_pnl: string; realised_pnl: string;
  initial_margin: string; mark_price: string;
  quanto_multiplier: string; order_price_round: string;
}
export interface Execution {
  action: 'stopped' | 'created' | 'skipped' | 'failed'; contract: string;
  id?: string; message?: string; error?: string; operation?: string;
}
export interface EntryEvent { event_id: string; entry_time: number; contract: string; side: number; initial_margin?: string | null }
export interface Schedule { enabled: boolean; cron: string; next_run?: string | null; result?: string }
export interface Settings {
  SUPABASE_URL: string; ORDERS_DATA_DIR: string; ORDERS_ALLOWED_ORIGIN: string;
  configured: Record<string, boolean>; credential_sources: Record<string, string>;
  config_path: string; database_path: string; restart_required: boolean;
}
export interface SourceSnapshot {
  items: Record<string, unknown>[]; orders: SourceOrder[]; execution: Execution[];
  phase: string; updated_at: string | null; error: string | null; refreshing: boolean;
}
export interface OrdersSnapshot {
  orders: TrailOrder[]; positions: Position[]; close_execution: Execution[];
  updated_at: string | null; position_updated_at: string | null; trailing_updated_at: string | null; error: string | null; refreshing: boolean;
  unrealised_pnl: string; realised_pnl: string; uptime_ms: number;
}
export interface ActivityEvent {
  seq: number; at: string; task: string; kind: 'task' | 'request';
  state: 'started' | 'completed' | 'failed'; method?: string; host?: string; status?: number;
}
export interface ActivitySnapshot { events: ActivityEvent[]; active: number; total: number; tasks: Record<string, boolean>; instance: string }
export interface Intent { owner: string | null; request_id: string | null; review_evidence: string | null; id: string; operation: string; payload: string; state: string; exchange_id: string | null; created_at: number }
