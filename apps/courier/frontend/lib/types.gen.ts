/* eslint-disable */
/**
 * GENERATED FILE - do not edit.
 *
 * Source: FastAPI OpenAPI schema (`app.main:app`).
 * Regenerate: python scripts/gen_types.py
 */

export interface AddressCheckIn {
  postcode?: string;
  state?: string;
  city?: string;
}

export interface AddressCheckOut {
  postcode: string;
  known: boolean;
  state?: string;
  city?: string;
  cities?: string[];
  ok: boolean;
  field?: string | null;
  message?: string | null;
  notice?: string | null;
  suggestions?: string[];
  suggestions_total?: number;
  suggestions_for?: string;
}

export interface AddressParseIn {
  text?: string;
}

export interface AddressParseOut {
  name: string;
  phone: string;
  postcode: string;
  city: string;
  state: string;
  address: string;
  check: AddressCheckOut;
}

export interface AdminLastEventOut {
  label: string;
  location: string;
  occurred_at: string;
}

export interface AdminOrderDetailOut {
  order: AdminOrderOut;
  events: TrackingEventOut[];
}

export interface AdminOrderOut {
  id: number;
  tracking_no: string;
  customer_order_no: string | null;
  created_at: string;
  receiver_name: string;
  receiver_phone: string;
  receiver_postcode: string;
  receiver_city: string | null;
  receiver_state: string;
  receiver_address: string;
  items: Record<string, unknown>[];
  pieces: number;
  order_payment_type: string | null;
  cod_amount: string;
  order_value: string;
  freight_fee: string | null;
  chargeable_weight: string;
  supplier_ships: boolean;
  source: string;
  tracking_status: string;
  status_label: string;
  tracking_updated_at: string | null;
  last_event?: AdminLastEventOut | null;
  tracking_url: string;
  waybill_url: string;
  warehouse_order_id?: number | null;
  warehouse_order_no?: string | null;
  warehouse_status?: string | null;
}

export interface AdminOrderPage {
  items: AdminOrderOut[];
  page: number;
  size: number;
  total: number;
  pages: number;
  counts: Record<string, number>;
  sources: SourceCountOut[];
  today: number;
  newest_id: number;
}

export interface Body_upload_api_v1_bulk_upload_post {
  file: string;
}

export interface BulkCommitIn {
  output_dir: string;
  row_ids?: number[] | null;
  merge_pdf?: boolean | null;
}

export interface BulkCommitOut {
  batch_id: number;
  total: number;
  created: number;
  failed: number;
  duplicates: number;
  duration_ms: number;
  output_dir: string;
  manifest_path?: string | null;
  errors_path?: string | null;
  merged_path?: string | null;
  manifest_url: string;
  zip_url: string;
  row_errors?: RowError[];
  whatsapp_queued?: number;
  whatsapp_to_dropship?: number;
  packing_files?: PackingFileOut[];
  packing_left_out?: number;
}

export interface BulkProgressOut {
  batch_id: number;
  stage: string;
  status: string;
  processed: number;
  total: number;
  percent: number;
  eta_ms?: number | null;
}

/** One staged row, shaped for the grid. */
export interface BulkRowOut {
  id: number;
  row_no: number;
  status: string;
  error_field?: string | null;
  error_message?: string | null;
  tracking_no?: string | null;
  data?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface BulkUploadOut {
  batch_id: number;
  filename: string;
  total: number;
  ok: number;
  errors: number;
  warnings?: string[];
  rows?: BulkRowOut[];
  row_errors?: RowError[];
}

/** One day of the admin calendar, in Malaysia time. */
export interface CalendarDayOut {
  day: string;
  orders: number;
  statuses: Record<string, number>;
  cod_amount: string;
  delivered: number;
  returned: number;
}

export interface CalendarOut {
  month: string;
  today: string;
  days: CalendarDayOut[];
  total_orders: number;
  total_delivered: number;
  total_returned: number;
  sources: SourceCountOut[];
}

export interface DeleteRowsIn {
  row_ids: number[];
}

export interface DeleteRowsOut {
  deleted: number;
}

export interface EventTypeOut {
  code: string;
  label: string;
  status: string;
  template: string;
  without_location: string;
}

export interface HTTPValidationError {
  detail?: ValidationError[];
}

export interface LoginIn {
  login?: string;
  password?: string;
}

export interface MeOut {
  id?: number | null;
  username: string;
  name: string;
  role: string;
  account_code?: string | null;
  company_name?: string | null;
}

/** The Normal Order form.  The sender is never supplied by the client. */
export interface NormalOrderIn {
  receiver_name: string;
  receiver_phone: string;
  receiver_postcode: string;
  receiver_address: string;
  receiver_city?: string;
  receiver_state?: string;
  address_type?: "HOME" | "OFFICE";
  goods_type?: "PARCEL" | "DOCUMENT";
  goods_name: string;
  item_variant?: string;
  quantity?: number;
  items?: OrderItemIn[];
  actual_weight: number | string;
  length_cm?: number | string;
  width_cm?: number | string;
  height_cm?: number | string;
  chargeable_weight?: number | string | null;
  customer_order_no: string;
  cod_amount?: number | string;
  order_value?: number | string;
  order_payment_type?: "PREPAID" | "COD";
  service_mode?: "PICK_UP" | "DROP_OFF";
  source?: string;
  remark?: string;
  output_dir?: string | null;
}

export interface OrderCreatedOut {
  tracking_no: string;
  sortation_code: string | null;
  route_code: string | null;
  waybill_url: string;
  freight_fee: string | null;
  order: OrderOut;
}

/** One line of a parcel's contents. */
export interface OrderItemIn {
  goods_name: string;
  item_variant?: string;
  quantity?: number;
  dropship?: boolean;
}

export interface OrderOut {
  id: number;
  tracking_no: string;
  customer_order_no: string | null;
  receiver_name: string;
  receiver_phone: string;
  receiver_postcode: string;
  receiver_city: string | null;
  receiver_state: string;
  receiver_address: string;
  address_type: string;
  goods_type: string;
  goods_name: string | null;
  item_variant: string | null;
  quantity: number;
  items?: Record<string, unknown>[] | null;
  service_mode?: string | null;
  source?: string;
  actual_weight: string;
  volumetric_weight: string;
  chargeable_weight: string;
  service_type: string;
  service_scope: string | null;
  sortation_code: string | null;
  route_code: string | null;
  payment_type: string;
  order_payment_type: string | null;
  cod_amount: string;
  order_value: string;
  freight_fee: string | null;
  remark: string | null;
  waybill_filename: string | null;
  waybill_path: string | null;
  order_date: string | null;
  status: string;
  batch_id: number | null;
  created_at: string;
  tracking_status?: string;
  tracking_updated_at?: string | null;
  waybill_url: string;
}

export interface OrderPage {
  items: OrderOut[];
  page: number;
  size: number;
  total: number;
  pages: number;
}

export interface OutputDirCheckIn {
  output_dir: string;
}

export interface OutputDirCheckOut {
  ok: boolean;
  resolved?: string | null;
  message?: string | null;
}

/** One packing PDF: every label of one product, ready to print. */
export interface PackingFileOut {
  title: string;
  orders: number;
  pieces: number;
  url: string;
}

/** A draft parcel, for the live totals on the Normal Order footer. */
export interface QuoteIn {
  receiver_postcode?: string;
  receiver_state?: string;
  goods_type?: "PARCEL" | "DOCUMENT";
  actual_weight?: number | string;
  length_cm?: number | string;
  width_cm?: number | string;
  height_cm?: number | string;
  chargeable_weight?: number | string | null;
  cod_amount?: number | string;
  item_value?: number | string;
}

export interface QuoteOut {
  volumetric_weight: string;
  chargeable_weight: string;
  service_scope: string;
  freight_fee: string;
  base_shipping_fee: string;
  base_price_tax: string;
  discounted_shipping_fee: string;
  discounted_tax: string;
  cod_fee: string;
  cod_tax: string;
  cod_handling_fee: string;
  insurance_fee?: string | null;
  total_sst: string;
  total_shipping_fee: string;
}

export interface RowError {
  row_no: number;
  status: string;
  field?: string | null;
  message?: string | null;
}

export interface SenderProfileIn {
  company_name: string;
  phone: string;
  postcode: string;
  state: string;
  address: string;
  account_code?: string | null;
  payment_type?: string | null;
  default_service?: string | null;
}

export interface SenderProfileOut {
  id: number;
  account_code: string;
  company_name: string;
  phone: string;
  postcode: string;
  state: string;
  address: string;
  payment_type: string;
  default_service: string;
}

/** Checked by the endpoint itself, so each problem gets a plain message. */
export interface SignupIn {
  name?: string;
  username?: string;
  phone?: string;
  email?: string;
  password?: string;
  confirm_password?: string;
}

export interface SignupOut {
  username: string;
  status: string;
  message: string;
}

export interface SourceCountOut {
  name: string;
  count: number;
}

export interface SourceOut {
  name: string;
  kind: string;
  default: boolean;
}

export interface TrackingDayOut {
  date_label: string;
  events: TrackingEventOut[];
}

export interface TrackingEventOut {
  id: number | null;
  event_type: string;
  label: string;
  location: string;
  description: string;
  occurred_at: string;
  date_label: string;
  time_label: string;
}

/** One waybill on the public tracking page - no names or addresses. */
export interface TrackingOut {
  tracking_no: string;
  found: boolean;
  status?: string | null;
  status_label?: string | null;
  origin?: string;
  destination?: string;
  steps?: TrackingStepOut[];
  days?: TrackingDayOut[];
}

export interface TrackingStepOut {
  key: string;
  label: string;
  reached: boolean;
}

/** A status update for one or several parcels (the dashboard's bulk bar). */
export interface TrackingUpdateIn {
  tracking_nos: string[];
  event_type: string;
  location?: string;
  description?: string;
  occurred_at?: string | null;
}

export interface TrackingUpdateOut {
  updated: number;
  not_found?: string[];
}

/** An account the admin makes: active at once, no approval needed. */
export interface UserCreateIn {
  name?: string;
  username?: string;
  phone?: string;
  email?: string;
  password?: string;
  role?: "admin" | "operator" | "merchant";
}

export interface UserOut {
  id: number;
  username: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
}

export interface UserUpdateIn {
  status?: "active" | "blocked" | null;
  password?: string | null;
}

export interface ValidationError {
  loc: string | number[];
  msg: string;
  type: string;
  input?: unknown;
  ctx?: Record<string, unknown>;
}

/** RFC 7807 problem+json body returned by every error path. */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  row_errors?: RowError[];
}
