// Core kernel types. Language-agnostic contracts (see docs/02-architecture/02-platform-core.md).

export type FieldType =
  | 'text' | 'long_text' | 'int' | 'float' | 'currency' | 'percent'
  | 'date' | 'datetime' | 'select' | 'link' | 'table' | 'check' | 'phone' | 'email' | 'gstin';

export interface FieldDef {
  name: string;
  type: FieldType;
  required?: boolean;
  target?: string;       // for link
  child?: string;       // for table -> child entity/inline rows
  options?: string[];    // for select
  computed?: boolean;
  readonly?: boolean;
}

export type EntityKind = 'master' | 'document';

export interface EntityDef {
  name: string;          // e.g. sales_invoice
  label: string;
  kind: EntityKind;
  module: string;
  fields: FieldDef[];
  lifecycle?: { submit?: boolean; cancel?: boolean; amend?: boolean };
  posting?: string;      // name of a registered posting hook
  naming?: { series: string; example: string };
  permissions?: { role: string; read?: boolean; write?: boolean; submit?: boolean; cancel?: boolean }[];
}

export interface EntityRow {
  id: string;
  entity: string;
  tenant: string;
  status: string;        // Draft | Submitted | Cancelled | Amended
  data: Record<string, any>;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  /** Optional constrained paise source column for financial entities. */
  amountPaise?: number;
  amountDirection?: 'DEBIT' | 'CREDIT' | 'NONE';
  amountCurrency?: string;
}

export interface GLEntry {
  id: string;
  tenant: string;
  posting_date: string;
  voucher_type: string;
  voucher: string;
  account: string;
  party?: string;
  cost_center?: string;
  debit: number;
  credit: number;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  tenant: string;
  ts: string;
  actor: string;
  action: string;
  entity?: string;
  row_id?: string;
  before?: any;
  after?: any;
}

export interface OutboxEvent {
  id: string;
  tenant: string;
  type: string;          // e.g. sales.invoice.submitted.v1
  payload: any;
  created_at: string;
  published: boolean;
}

export interface StockLedgerEntry {
  id: string;
  tenant: string;
  posting_date: string;
  item: string;
  warehouse: string;
  qty: number;           // signed: + receipt / - issue
  balance_qty: number;   // running balance for (item,warehouse) after this entry
  valuation_rate?: number;
  valuation_adjustment?: number; // landed-cost revaluation (no qty impact)
  serial_nos?: string[]; // tracked serial numbers moved on this entry
  batch_no?: string;     // batch/lot moved on this entry
  voucher_type: string;
  voucher: string;
  created_at: string;
}

// Inward Supply (purchase-side) record pulled from the GSP/IMS for 2A/2B matching.
export interface InwardSupply {
  irn: string;
  supplierGstin: string;
  supplierName: string;
  docNo: string;
  docDate: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED';
}

export interface ImsAction {
  id: string;
  tenant: string;
  irn: string;
  action: 'ACC' | 'REJ' | 'PEN';
  reason?: string;
  actor: string;
  ts: string;
}
