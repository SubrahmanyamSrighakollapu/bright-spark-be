import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../../database/pool.js';
import { logger } from '../../config/logger.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { ListByTypeFilters, ExportByTypeFilters } from './report.schemas.js';

const CSV_EXPORT_LIMIT = 250_000;

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatDateIso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n\r]/.test(s) ? `"${s}"` : s;
}

function toYyyymmdd(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'ALL';
    return d.toISOString().slice(0, 10).replace(/-/g, '');
  } catch {
    return 'ALL';
  }
}

function filenameFor(reportName: string, startDate: string, endDate: string): string {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return `${reportName}_From${toYyyymmdd(startDate)}_To${toYyyymmdd(endDate)}_${ts}.csv`;
}

function writeCsvResponse(response: Response, filename: string, headers: string[], rows: unknown[][]): void {
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const headerLine = headers.map(escapeCsv).join(',');
  const bodyLines = rows.map((r) => r.map(escapeCsv).join(','));
  const all = [headerLine, ...bodyLines].join('\r\n');
  response.send('\uFEFF' + all);
}

function isAdminOrAccounts(auth: AuthenticatedUser): boolean {
  return auth.roles.includes('ADMIN') || auth.roles.includes('SUPER_ADMIN') || auth.roles.includes('ACCOUNTS');
}

function applyPagination(page: number, pageSize: number, totalItems: number) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const offset = (safePage - 1) * pageSize;
  return { totalPages, safePage, offset };
}

// ==========================================================================
// TRANSACTIONS REPORT
// ==========================================================================
export interface TransactionsSummary {
  totalVolume: number;
  successCount: number;
  failCount: number;
  avgLatencyMs: number;
  tpsApprox: number;
}

export interface TransactionsReportResult {
  items: unknown[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: TransactionsSummary;
}

export async function getTransactionsReport(
  filters: ListByTypeFilters,
  auth: AuthenticatedUser,
): Promise<TransactionsReportResult> {
  const baseItems: unknown[] = [];
  const emptySummary: TransactionsSummary = {
    totalVolume: 0,
    successCount: 0,
    failCount: 0,
    avgLatencyMs: 0,
    tpsApprox: 0,
  };

  try {
    const whereClauses: string[] = ['t.created_at >= ?', 't.created_at <= ?'];
    const params: unknown[] = [filters.startDate, filters.endDate];

    if (!isAdminOrAccounts(auth) && auth.partyId) {
      whereClauses.push('t.party_id = ?');
      params.push(auth.partyId);
    } else if (filters.userId) {
      whereClauses.push('u.id = ?');
      params.push(filters.userId);
    }

    if (filters.role) {
      whereClauses.push('p.party_type = ?');
      params.push(filters.role);
    }

    const statusFilter = filters.transactionStatus || filters.status;
    if (statusFilter) {
      whereClauses.push('t.status = ?');
      params.push(statusFilter);
    }

    if (filters.service) {
      whereClauses.push('t.payment_mode = ?');
      params.push(filters.service);
    }

    const whereSql = 'WHERE ' + whereClauses.join(' AND ');

    const [countRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
      `SELECT COUNT(*) as c FROM transactions t
       LEFT JOIN parties p ON p.id = t.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}`,
      params,
    );
    const totalItems = toNumber(countRows[0]?.c ?? 0);
    const { totalPages, safePage, offset } = applyPagination(filters.page, filters.pageSize, totalItems);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT t.*, p.party_type, p.display_name as party_name, u.email as user_email
       FROM transactions t
       LEFT JOIN parties p ON p.id = t.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.pageSize, offset],
    );

    const items = rows.map((r) => ({
      id: r.id,
      internalReference: r.internal_reference,
      partyId: r.party_id,
      partyName: r.party_name ?? null,
      partyType: r.party_type ?? null,
      userEmail: r.user_email ?? null,
      transactionType: r.transaction_type,
      paymentMode: r.payment_mode,
      clientOrderId: r.client_order_id ?? null,
      providerReference: r.provider_reference ?? null,
      bankReference: r.bank_reference ?? null,
      status: r.status,
      currency: r.currency,
      grossAmount: toNumber(r.gross_amount),
      chargeAmount: toNumber(r.charge_amount),
      taxAmount: toNumber(r.tax_amount),
      finalCreditAmount: r.final_credit_amount != null ? toNumber(r.final_credit_amount) : null,
      totalDebitAmount: r.total_debit_amount != null ? toNumber(r.total_debit_amount) : null,
      failureCode: r.failure_code ?? null,
      failureMessage: r.failure_message ?? null,
      createdAt: formatDateIso(r.created_at),
      completedAt: formatDateIso(r.completed_at),
    }));

    const [aggRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(t.gross_amount), 0) as totalVolume,
         SUM(CASE WHEN t.status = 'SUCCESS' THEN 1 ELSE 0 END) as successCount,
         SUM(CASE WHEN t.status IN ('FAILED','EXPIRED','CANCELLED','REVERSED') THEN 1 ELSE 0 END) as failCount,
         COALESCE(AVG(TIMESTAMPDIFF(MICROSECOND, t.created_at, COALESCE(t.completed_at, t.updated_at)) / 1000), 0) as avgLatencyUs,
         TIMESTAMPDIFF(SECOND, ?, ?) as spanSec
       FROM transactions t
       LEFT JOIN parties p ON p.id = t.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}`,
      [filters.startDate, filters.endDate, ...params],
    );

    const agg = aggRows[0] ?? ({} as RowDataPacket);
    const spanSec = Math.max(1, toNumber(agg.spanSec ?? 0));
    const successCount = toNumber(agg.successCount ?? 0);
    const failCount = toNumber(agg.failCount ?? 0);
    const summary: TransactionsSummary = {
      totalVolume: toNumber(agg.totalVolume ?? 0),
      successCount,
      failCount,
      avgLatencyMs: toNumber(agg.avgLatencyUs ?? 0),
      tpsApprox: totalItems / spanSec,
    };

    return {
      items,
      pagination: { page: safePage, pageSize: filters.pageSize, totalItems, totalPages },
      summary,
    };
  } catch (err) {
    logger.warn({ err, report: 'transactions' }, 'getTransactionsReport: query failed, returning empty');
    return {
      items: baseItems,
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  }
}

export async function exportTransactionsCsv(
  filters: ExportByTypeFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> {
  const listFilters: ListByTypeFilters = { ...filters, page: 1, pageSize: CSV_EXPORT_LIMIT };
  const { items, summary } = await getTransactionsReport(listFilters, auth);
  const headers = [
    'Transaction ID',
    'Internal Reference',
    'Party ID',
    'Party Name',
    'Party Type',
    'User Email',
    'Type',
    'Payment Mode',
    'Client Order ID',
    'Provider Ref',
    'Bank Ref',
    'Status',
    'Currency',
    'Gross Amount',
    'Charge',
    'Tax',
    'Final Credit',
    'Total Debit',
    'Failure Code',
    'Created At',
    'Completed At',
  ];
  const summaryHeaders = ['Total Volume', 'Success Count', 'Fail Count', 'Avg Latency (ms)', 'Approx TPS'];
  const summaryRow = [summary.totalVolume, summary.successCount, summary.failCount, summary.avgLatencyMs, summary.tpsApprox];
  const rows: unknown[][] = [];
  rows.push(summaryHeaders);
  rows.push(summaryRow);
  rows.push([]);
  rows.push(headers);
  for (const it of items as any[]) {
    rows.push([
      it.id,
      it.internalReference,
      it.partyId,
      it.partyName,
      it.partyType,
      it.userEmail,
      it.transactionType,
      it.paymentMode,
      it.clientOrderId,
      it.providerReference,
      it.bankReference,
      it.status,
      it.currency,
      it.grossAmount,
      it.chargeAmount,
      it.taxAmount,
      it.finalCreditAmount,
      it.totalDebitAmount,
      it.failureCode,
      it.createdAt,
      it.completedAt,
    ]);
  }
  writeCsvResponse(response, filenameFor('Transactions', filters.startDate, filters.endDate), headers, rows);
}

// ==========================================================================
// LEDGER REPORT
// ==========================================================================
export interface LedgerSummary {
  totalCreditAmount: number;
  totalDebitAmount: number;
  balanceForward: number;
}

export interface LedgerReportResult {
  items: unknown[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: LedgerSummary;
}

export async function getLedgerReport(
  filters: ListByTypeFilters,
  auth: AuthenticatedUser,
): Promise<LedgerReportResult> {
  const emptySummary: LedgerSummary = { totalCreditAmount: 0, totalDebitAmount: 0, balanceForward: 0 };

  try {
    const whereClauses: string[] = ['le.created_at >= ?', 'le.created_at <= ?'];
    const params: unknown[] = [filters.startDate, filters.endDate];

    if (!isAdminOrAccounts(auth) && auth.partyId) {
      whereClauses.push('le.party_id = ?');
      params.push(auth.partyId);
    } else if (filters.userId) {
      whereClauses.push('u.id = ?');
      params.push(filters.userId);
    }

    if (filters.role) {
      whereClauses.push('p.party_type = ?');
      params.push(filters.role);
    }

    if (filters.status) {
      whereClauses.push('le.entry_type = ?');
      params.push(filters.status);
    }

    const whereSql = 'WHERE ' + whereClauses.join(' AND ');

    const [countRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
      `SELECT COUNT(*) as c FROM ledger_entries le
       LEFT JOIN parties p ON p.id = le.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}`,
      params,
    );
    const totalItems = toNumber(countRows[0]?.c ?? 0);
    const { totalPages, safePage, offset } = applyPagination(filters.page, filters.pageSize, totalItems);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT le.*, p.party_type, p.display_name as party_name, w.currency, u.email as user_email
       FROM ledger_entries le
       LEFT JOIN parties p ON p.id = le.party_id
       LEFT JOIN wallets w ON w.id = le.wallet_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}
       ORDER BY le.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.pageSize, offset],
    );

    const items = rows.map((r) => ({
      id: r.id,
      walletId: r.wallet_id,
      partyId: r.party_id,
      partyName: r.party_name ?? null,
      partyType: r.party_type ?? null,
      userEmail: r.user_email ?? null,
      entryType: r.entry_type,
      amount: toNumber(r.amount),
      currency: r.currency ?? 'INR',
      availableBalanceBefore: toNumber(r.available_balance_before),
      availableBalanceAfter: toNumber(r.available_balance_after),
      holdBalanceBefore: toNumber(r.hold_balance_before),
      holdBalanceAfter: toNumber(r.hold_balance_after),
      referenceType: r.reference_type ?? null,
      referenceId: r.reference_id ?? null,
      narration: r.narration ?? null,
      createdByUserId: r.created_by_user_id ?? null,
      createdAt: formatDateIso(r.created_at),
    }));

    const [aggRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(CASE WHEN le.entry_type IN ('CREDIT','RELEASE','COMMISSION','REVERSAL') THEN le.amount ELSE 0 END), 0) as totalCredit,
         COALESCE(SUM(CASE WHEN le.entry_type IN ('DEBIT','HOLD','FEE') THEN le.amount ELSE 0 END), 0) as totalDebit
       FROM ledger_entries le
       LEFT JOIN parties p ON p.id = le.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}`,
      params,
    );
    const agg = aggRows[0] ?? ({} as RowDataPacket);
    const totalCreditAmount = toNumber(agg.totalCredit ?? 0);
    const totalDebitAmount = toNumber(agg.totalDebit ?? 0);

    return {
      items,
      pagination: { page: safePage, pageSize: filters.pageSize, totalItems, totalPages },
      summary: {
        totalCreditAmount,
        totalDebitAmount,
        balanceForward: totalCreditAmount - totalDebitAmount,
      },
    };
  } catch (err) {
    logger.warn({ err, report: 'ledger' }, 'getLedgerReport: query failed, returning empty');
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  }
}

export async function exportLedgerCsv(
  filters: ExportByTypeFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> {
  const listFilters: ListByTypeFilters = { ...filters, page: 1, pageSize: CSV_EXPORT_LIMIT };
  const { items, summary } = await getLedgerReport(listFilters, auth);
  const headers = [
    'Entry ID',
    'Wallet ID',
    'Party ID',
    'Party Name',
    'Party Type',
    'User Email',
    'Entry Type',
    'Amount',
    'Currency',
    'Available Before',
    'Available After',
    'Hold Before',
    'Hold After',
    'Reference Type',
    'Reference ID',
    'Narration',
    'Created By User',
    'Created At',
  ];
  const summaryHeaders = ['Total Credit', 'Total Debit', 'Balance Forward'];
  const summaryRow = [summary.totalCreditAmount, summary.totalDebitAmount, summary.balanceForward];
  const rows: unknown[][] = [];
  rows.push(summaryHeaders);
  rows.push(summaryRow);
  rows.push([]);
  rows.push(headers);
  for (const it of items as any[]) {
    rows.push([
      it.id,
      it.walletId,
      it.partyId,
      it.partyName,
      it.partyType,
      it.userEmail,
      it.entryType,
      it.amount,
      it.currency,
      it.availableBalanceBefore,
      it.availableBalanceAfter,
      it.holdBalanceBefore,
      it.holdBalanceAfter,
      it.referenceType,
      it.referenceId,
      it.narration,
      it.createdByUserId,
      it.createdAt,
    ]);
  }
  writeCsvResponse(response, filenameFor('Ledger', filters.startDate, filters.endDate), headers, rows);
}

// ==========================================================================
// SETTLEMENTS REPORT (STUB — settlements table not in migrations)
// ==========================================================================
export interface SettlementSummary {
  totalSettled: number;
  totalTds: number;
  totalGst: number;
  totalHoldDeducted: number;
  cycleCount: number;
}

export interface SettlementReportResult {
  items: unknown[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: SettlementSummary;
}

export async function getSettlementReport(
  filters: ListByTypeFilters,
  _auth: AuthenticatedUser,
): Promise<SettlementReportResult> {
  const emptySummary: SettlementSummary = {
    totalSettled: 0,
    totalTds: 0,
    totalGst: 0,
    totalHoldDeducted: 0,
    cycleCount: 0,
  };

  try {
    void filters;
    await pool.query<RowDataPacket[]>(`SELECT 1 FROM settlements LIMIT 1`);
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  } catch (err) {
    logger.warn({ err, report: 'settlements' }, 'getSettlementReport: settlements table not available, returning stub empty');
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  }
}

export async function exportSettlementCsv(
  filters: ExportByTypeFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> {
  const listFilters: ListByTypeFilters = { ...filters, page: 1, pageSize: CSV_EXPORT_LIMIT };
  const { items, summary } = await getSettlementReport(listFilters, auth);
  const headers = [
    'Settlement ID',
    'Cycle ID',
    'Party ID',
    'Party Name',
    'Status',
    'Total Transactions',
    'Gross Amount',
    'TDS',
    'GST',
    'Hold Deducted',
    'Net Settled',
    'UTR',
    'Settled At',
  ];
  const summaryHeaders = ['Total Settled', 'Total TDS', 'Total GST', 'Total Hold Deducted', 'Cycle Count'];
  const summaryRow = [summary.totalSettled, summary.totalTds, summary.totalGst, summary.totalHoldDeducted, summary.cycleCount];
  const rows: unknown[][] = [];
  rows.push(summaryHeaders);
  rows.push(summaryRow);
  rows.push([]);
  rows.push(headers);
  for (const it of items as any[]) {
    rows.push([
      it.id,
      it.cycleId,
      it.partyId,
      it.partyName,
      it.status,
      it.totalTransactions,
      it.grossAmount,
      it.tds,
      it.gst,
      it.holdDeducted,
      it.netSettled,
      it.utr,
      it.settledAt,
    ]);
  }
  writeCsvResponse(response, filenameFor('Settlements', filters.startDate, filters.endDate), headers, rows);
}

// ==========================================================================
// BALANCE REPORT (wallets snapshot + party grouping)
// ==========================================================================
export interface BalanceSummary {
  grandTotalAvailable: number;
  grandTotalHold: number;
  grandTotalLedger: number;
}

export interface BalanceReportResult {
  items: unknown[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: BalanceSummary;
}

export async function getBalanceReport(
  filters: ListByTypeFilters,
  auth: AuthenticatedUser,
): Promise<BalanceReportResult> {
  const emptySummary: BalanceSummary = { grandTotalAvailable: 0, grandTotalHold: 0, grandTotalLedger: 0 };

  try {
    const whereClauses: string[] = [];

    if (!isAdminOrAccounts(auth) && auth.partyId) {
      whereClauses.push('w.party_id = ?');
    } else if (filters.userId) {
      whereClauses.push('u.id = ?');
    }

    if (filters.role) {
      whereClauses.push('p.party_type = ?');
    }

    if (filters.status) {
      whereClauses.push('w.status = ?');
    }

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const params: unknown[] = [];
    if (!isAdminOrAccounts(auth) && auth.partyId) params.push(auth.partyId);
    else if (filters.userId) params.push(filters.userId);
    if (filters.role) params.push(filters.role);
    if (filters.status) params.push(filters.status);

    const [countRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
      `SELECT COUNT(*) as c FROM wallets w
       LEFT JOIN parties p ON p.id = w.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}`,
      params,
    );
    const totalItems = toNumber(countRows[0]?.c ?? 0);
    const { totalPages, safePage, offset } = applyPagination(filters.page, filters.pageSize, totalItems);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT w.*, p.party_type, p.display_name as party_name, p.code as party_code, u.email as user_email
       FROM wallets w
       LEFT JOIN parties p ON p.id = w.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}
       ORDER BY p.party_type, w.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.pageSize, offset],
    );

    const items = rows.map((r) => ({
      walletId: r.id,
      partyId: r.party_id,
      partyCode: r.party_code ?? null,
      partyName: r.party_name ?? null,
      partyType: r.party_type ?? null,
      userEmail: r.user_email ?? null,
      currency: r.currency ?? 'INR',
      status: r.status,
      availableBalance: toNumber(r.available_balance),
      holdBalance: toNumber(r.hold_balance),
      ledgerBalance: toNumber(r.ledger_balance),
      createdAt: formatDateIso(r.created_at),
      updatedAt: formatDateIso(r.updated_at),
    }));

    const [aggRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(w.available_balance), 0) as grandAvailable,
         COALESCE(SUM(w.hold_balance), 0) as grandHold,
         COALESCE(SUM(w.ledger_balance), 0) as grandLedger
       FROM wallets w
       LEFT JOIN parties p ON p.id = w.party_id
       LEFT JOIN users u ON u.party_id = p.id
       ${whereSql}`,
      params,
    );
    const agg = aggRows[0] ?? ({} as RowDataPacket);

    return {
      items,
      pagination: { page: safePage, pageSize: filters.pageSize, totalItems, totalPages },
      summary: {
        grandTotalAvailable: toNumber(agg.grandAvailable ?? 0),
        grandTotalHold: toNumber(agg.grandHold ?? 0),
        grandTotalLedger: toNumber(agg.grandLedger ?? 0),
      },
    };
  } catch (err) {
    logger.warn({ err, report: 'balance' }, 'getBalanceReport: query failed, returning empty');
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  }
}

export async function exportBalanceCsv(
  filters: ExportByTypeFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> {
  const listFilters: ListByTypeFilters = { ...filters, page: 1, pageSize: CSV_EXPORT_LIMIT };
  const { items, summary } = await getBalanceReport(listFilters, auth);
  const headers = [
    'Wallet ID',
    'Party ID',
    'Party Code',
    'Party Name',
    'Party Type',
    'User Email',
    'Currency',
    'Status',
    'Available Balance',
    'Hold Balance',
    'Ledger Balance',
    'Created At',
    'Updated At',
  ];
  const summaryHeaders = ['Grand Total Available', 'Grand Total Hold', 'Grand Total Ledger'];
  const summaryRow = [summary.grandTotalAvailable, summary.grandTotalHold, summary.grandTotalLedger];
  const rows: unknown[][] = [];
  rows.push(summaryHeaders);
  rows.push(summaryRow);
  rows.push([]);
  rows.push(headers);
  for (const it of items as any[]) {
    rows.push([
      it.walletId,
      it.partyId,
      it.partyCode,
      it.partyName,
      it.partyType,
      it.userEmail,
      it.currency,
      it.status,
      it.availableBalance,
      it.holdBalance,
      it.ledgerBalance,
      it.createdAt,
      it.updatedAt,
    ]);
  }
  writeCsvResponse(response, filenameFor('Balance', filters.startDate, filters.endDate), headers, rows);
}

// ==========================================================================
// CHARGEBACKS REPORT (STUB — chargebacks table not in migrations)
// ==========================================================================
export interface ChargebackSummary {
  openCount: number;
  wonCount: number;
  lostCount: number;
  pendingDocCount: number;
  disputedAmount: number;
}

export interface ChargebackReportResult {
  items: unknown[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: ChargebackSummary;
}

export async function getChargebackReport(
  filters: ListByTypeFilters,
  _auth: AuthenticatedUser,
): Promise<ChargebackReportResult> {
  const emptySummary: ChargebackSummary = {
    openCount: 0,
    wonCount: 0,
    lostCount: 0,
    pendingDocCount: 0,
    disputedAmount: 0,
  };

  try {
    void filters;
    await pool.query<RowDataPacket[]>(`SELECT 1 FROM chargebacks LIMIT 1`);
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  } catch (err) {
    logger.warn({ err, report: 'chargebacks' }, 'getChargebackReport: chargebacks table not available, returning stub empty');
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  }
}

export async function exportChargebackCsv(
  filters: ExportByTypeFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> {
  const listFilters: ListByTypeFilters = { ...filters, page: 1, pageSize: CSV_EXPORT_LIMIT };
  const { items, summary } = await getChargebackReport(listFilters, auth);
  const headers = [
    'Chargeback ID',
    'Transaction ID',
    'Party ID',
    'Party Name',
    'Gateway Ref',
    'ARN',
    'Amount',
    'Currency',
    'Reason Code',
    'Status',
    'Filed At',
    'Respond By',
    'Resolved At',
    'Resolution',
  ];
  const summaryHeaders = ['Open', 'Won', 'Lost', 'Pending Docs', 'Total Disputed Amount'];
  const summaryRow = [summary.openCount, summary.wonCount, summary.lostCount, summary.pendingDocCount, summary.disputedAmount];
  const rows: unknown[][] = [];
  rows.push(summaryHeaders);
  rows.push(summaryRow);
  rows.push([]);
  rows.push(headers);
  for (const it of items as any[]) {
    rows.push([
      it.id,
      it.transactionId,
      it.partyId,
      it.partyName,
      it.gatewayRef,
      it.arn,
      it.amount,
      it.currency,
      it.reasonCode,
      it.status,
      it.filedAt,
      it.respondBy,
      it.resolvedAt,
      it.resolution,
    ]);
  }
  writeCsvResponse(response, filenameFor('Chargebacks', filters.startDate, filters.endDate), headers, rows);
}

// ==========================================================================
// API PERFORMANCE REPORT
// ==========================================================================
export interface ApiPerformanceSummary {
  totalRequests: number;
  total5xx: number;
  total4xx: number;
  p50Ms: number;
  p95ApproxMs: number;
}

export interface ApiPerformanceReportResult {
  items: unknown[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  summary: ApiPerformanceSummary;
}

export async function getApiPerformanceReport(
  filters: ListByTypeFilters,
  auth: AuthenticatedUser,
): Promise<ApiPerformanceReportResult> {
  const emptySummary: ApiPerformanceSummary = {
    totalRequests: 0,
    total5xx: 0,
    total4xx: 0,
    p50Ms: 0,
    p95ApproxMs: 0,
  };

  try {
    void auth;
    const whereClauses: string[] = ['arl.created_at >= ?', 'arl.created_at <= ?'];
    const params: unknown[] = [filters.startDate, filters.endDate];

    if (filters.status) {
      whereClauses.push('arl.status_class = ?');
      params.push(filters.status);
    }

    if (filters.service) {
      whereClauses.push('arl.route_template LIKE ?');
      params.push(`%${filters.service}%`);
    }

    const whereSql = 'WHERE ' + whereClauses.join(' AND ');

    const [countRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
      `SELECT COUNT(DISTINCT DATE(arl.created_at), arl.route_template, arl.status_class, arl.method) as c
       FROM api_request_logs arl ${whereSql}`,
      params,
    );
    const totalItems = toNumber(countRows[0]?.c ?? 0);
    const { totalPages, safePage, offset } = applyPagination(filters.page, filters.pageSize, totalItems);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT
         DATE(arl.created_at) as dayDate,
         arl.route_template,
         arl.status_class,
         arl.method,
         COUNT(*) as requestCount,
         COALESCE(AVG(arl.response_time_ms), 0) as avgResponseMs,
         COALESCE(AVG(arl.response_time_ms) * 1.645, 0) as approxP95Ms
       FROM api_request_logs arl
       ${whereSql}
       GROUP BY DATE(arl.created_at), arl.route_template, arl.status_class, arl.method
       ORDER BY dayDate DESC, requestCount DESC
       LIMIT ? OFFSET ?`,
      [...params, filters.pageSize, offset],
    );

    const items = rows.map((r) => ({
      date: formatDateIso(r.dayDate),
      routeTemplate: r.route_template ?? null,
      statusClass: r.status_class,
      method: r.method,
      requestCount: toNumber(r.requestCount),
      avgResponseMs: toNumber(r.avgResponseMs),
      approxP95Ms: toNumber(r.approxP95Ms),
    }));

    const [aggRows] = await pool.query<RowDataPacket[]>(
      `SELECT
         COUNT(*) as totalRequests,
         SUM(CASE WHEN arl.status_class = '5XX' THEN 1 ELSE 0 END) as total5xx,
         SUM(CASE WHEN arl.status_class = '4XX' THEN 1 ELSE 0 END) as total4xx,
         COALESCE(AVG(arl.response_time_ms), 0) as avgMs
       FROM api_request_logs arl ${whereSql}`,
      params,
    );
    const agg = aggRows[0] ?? ({} as RowDataPacket);
    const totalRequests = toNumber(agg.totalRequests ?? 0);
    const avgMs = toNumber(agg.avgMs ?? 0);

    return {
      items,
      pagination: { page: safePage, pageSize: filters.pageSize, totalItems, totalPages },
      summary: {
        totalRequests,
        total5xx: toNumber(agg.total5xx ?? 0),
        total4xx: toNumber(agg.total4xx ?? 0),
        p50Ms: avgMs,
        p95ApproxMs: avgMs * 1.645,
      },
    };
  } catch (err) {
    logger.warn({ err, report: 'api-performance' }, 'getApiPerformanceReport: query failed, returning empty');
    return {
      items: [],
      pagination: { page: filters.page, pageSize: filters.pageSize, totalItems: 0, totalPages: 1 },
      summary: emptySummary,
    };
  }
}

export async function exportApiPerformanceCsv(
  filters: ExportByTypeFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> {
  const listFilters: ListByTypeFilters = { ...filters, page: 1, pageSize: CSV_EXPORT_LIMIT };
  const { items, summary } = await getApiPerformanceReport(listFilters, auth);
  const headers = [
    'Date',
    'Route Template',
    'Status Class',
    'Method',
    'Request Count',
    'Avg Response (ms)',
    'Approx P95 (ms)',
  ];
  const summaryHeaders = ['Total Requests', 'Total 5xx', 'Total 4xx', 'P50 (ms)', 'P95 Approx (ms)'];
  const summaryRow = [summary.totalRequests, summary.total5xx, summary.total4xx, summary.p50Ms, summary.p95ApproxMs];
  const rows: unknown[][] = [];
  rows.push(summaryHeaders);
  rows.push(summaryRow);
  rows.push([]);
  rows.push(headers);
  for (const it of items as any[]) {
    rows.push([
      it.date,
      it.routeTemplate,
      it.statusClass,
      it.method,
      it.requestCount,
      it.avgResponseMs,
      it.approxP95Ms,
    ]);
  }
  writeCsvResponse(response, filenameFor('Api-Performance', filters.startDate, filters.endDate), headers, rows);
}
