export type Decimal = string | number | null;
export interface TrailingOrder {
  id?: Decimal; contract?: string; amount?: Decimal; activation_price?: Decimal;
  reduce_only?: boolean; original_status?: number | string; timestamp?: number | string;
}
export interface Position {
  contract?: string; size?: Decimal; entry_price?: Decimal; value?: Decimal; leverage_max?: Decimal;
  unrealised_pnl?: Decimal; realised_pnl?: Decimal; initial_margin?: Decimal; mark_price?: Decimal; close_price?: Decimal;
}
export interface SourceRecord {
  id?: Decimal; contract?: string; url?: string; error?: string; status_code?: number;
  created_at?: string; data?: unknown; [key: string]: unknown;
}
export interface SourceOrder {
  record_position: number; order_index?: number; contract?: string; side?: string;
  activation_price?: Decimal; amount?: Decimal; timestamp?: Decimal;
}
export interface Execution {
  action: string; contract?: string; amount?: Decimal; id?: Decimal; error?: string; message?: string;
}
export interface Schedule {
  enabled: boolean; cron: string; next_run?: string | null; last_run?: string | null; last_result?: string;
}
export interface SourceSnapshot {
  items: SourceRecord[]; orders: SourceOrder[]; schedule?: Schedule; updated_at?: string | null;
  refreshing?: boolean; error?: string; phase?: string; execution?: Execution[];
}
export interface OrdersSnapshot {
  orders: TrailingOrder[]; positions?: Position[]; updated_at?: string | null; refreshing?: boolean; error?: string;
  unrealised_pnl?: Decimal; realised_pnl?: Decimal; uptime_ms?: number; close_execution?: Execution[];
}
export interface RequestActivity {
  node: "sources" | "gate"; active: number; completed: number; failed: number; write: boolean;
}
export interface ActivityEvent {
  sequence: number; type: string; node?: string; job?: string; write?: boolean; status?: number; success?: boolean; at: string;
}
export interface ActivitySnapshot {
  sequence: number; jobs: Record<string, string>; requests: Record<string, RequestActivity>; events: ActivityEvent[];
}
export type SecretName = "SUPABASE_ANON_KEY" | "API_KEY" | "API_SECRET";
export interface SettingsValues {
  SUPABASE_URL?: string; ORDERS_DATA_DIR?: string; ORDERS_ALLOWED_ORIGIN?: string;
  SUPABASE_ANON_KEY_SET?: boolean; API_KEY_SET?: boolean; API_SECRET_SET?: boolean;
  SUPABASE_ANON_KEY_SOURCE?: string; API_KEY_SOURCE?: string; API_SECRET_SOURCE?: string;
}
export interface Settings { values: SettingsValues; config_path: string }
export type SettingsPayload = Pick<SettingsValues, "SUPABASE_URL" | "ORDERS_DATA_DIR" | "ORDERS_ALLOWED_ORIGIN"> & Partial<Record<SecretName, string>>;
export type View = "live" | "orders" | "positions" | "sources" | "config" | "schedule";
export type Tone = "info" | "error" | "success";
export interface Message { text: string; tone: Tone }
