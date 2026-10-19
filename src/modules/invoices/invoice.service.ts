import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export function renderInvoiceTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (_match, key: string) => escapeHtml(data[key]));
}

export async function generateTransactionInvoice(connection: PoolConnection, input: {
  transactionId: string; reference: string; partyId: string; categoryId: string; productId: string | null;
  customerName: string; customerMobile: string; categoryName: string; productName: string | null;
  amount: number; charge: number; gst: number; finalCredit: number; paymentMethod: string;
}): Promise<void> {
  const [templates] = await connection.query<RowDataPacket[]>(`SELECT t.*, c.code category_code, c.name category_name,
      p.code product_code, p.name product_name
    FROM service_invoice_templates t
    JOIN service_catalog_categories c ON c.id=t.service_category_id
    LEFT JOIN service_catalog_products p ON p.id=t.service_product_id
    WHERE t.service_category_id=? AND t.is_active=TRUE LIMIT 1`, [input.categoryId]);
  const template = templates[0];
  if (!template) return;

  const now = new Date();
  const invoiceNumber = `BSP-INV-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${input.reference.slice(-8)}`;
  const invoiceData: Record<string, unknown> = {
    invoiceNumber, transactionReference: input.reference, invoiceDate: now.toLocaleDateString('en-IN'),
    customerName: input.customerName, customerMobile: input.customerMobile,
    serviceCategory: input.categoryName, serviceProduct: input.productName ?? 'Custom amount',
    paymentMethod: input.paymentMethod, amount: input.amount.toFixed(2), charge: input.charge.toFixed(2),
    gst: input.gst.toFixed(2), totalDeductions: (input.charge + input.gst).toFixed(2),
    netAmount: input.finalCredit.toFixed(2), status: 'PENDING',
  };
  const renderedHtml = renderInvoiceTemplate(String(template.template_html), invoiceData);
  await connection.execute(`INSERT INTO transaction_invoices
    (id,invoice_number,transaction_id,template_id,service_category_id,service_product_id,party_id,invoice_status,template_snapshot,invoice_data,rendered_html)
    VALUES (?,?,?,?,?,?,?,'PENDING',?,?,?)`, [randomUUID(), invoiceNumber, input.transactionId, template.id,
      input.categoryId, input.productId, input.partyId,
      JSON.stringify({ templateName: template.template_name, fileName: template.original_file_name, html: template.template_html }),
      JSON.stringify(invoiceData), renderedHtml]);
}
