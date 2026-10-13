import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool, withTransaction } from '../../database/pool.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { contextFromAuth, writeAuditLog } from '../../shared/audit.js';
import { sendSuccess } from '../../shared/response.js';

export const transactionRouter = Router();
transactionRouter.use(authenticate);
const isAdmin = (roles: string[]) => roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
const createSchema = z.object({
  customerName: z.string().trim().min(2).max(160),
  customerMobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian customer mobile number'),
  serviceCategoryId: z.string().uuid(), serviceProductId: z.string().uuid().nullable().optional(),
  paymentGatewayId: z.string().uuid(), paymentMethodId: z.string().uuid(), paymentOptionId: z.string().uuid(),
  amount: z.coerce.number().min(10).max(2000000), remarks: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});

function mapTransaction(r: RowDataPacket) {
  const snapshot = typeof r.calculation_snapshot === 'string' ? JSON.parse(r.calculation_snapshot) : (r.calculation_snapshot ?? {});
  const isPayout = r.transaction_type === 'PAY_OUT';
  return { id:r.id,transactionRef:r.internal_reference,referenceId:r.provider_reference ?? undefined,utr:r.bank_reference ?? undefined,
    merchantName:r.party_name,retailerName:r.party_name,retailerId:r.party_id,distributorName:r.parent_name ?? undefined,distributorId:r.parent_party_id ?? undefined,
    type:r.transaction_type,amount:Number(r.gross_amount),fee:Number(r.charge_amount),gst:Number(r.tax_amount),netAmount:Number(r.final_credit_amount ?? r.gross_amount),status:r.status,
    paymentMode:r.method_code === 'CREDIT_CARD' || r.method_code === 'DEBIT_CARD' ? 'CARD' : (r.method_code ?? r.payment_mode),provider:r.gateway_name,service:r.category_name,channel:'Web',
    customerName:r.customer_name,customerMobile:r.customer_mobile,failureCode:r.failure_code ?? undefined,failureReason:r.failure_message ?? undefined,
    accountingSnapshot:snapshot,createdAt:r.created_at,updatedAt:r.updated_at,
    timeline:[{timestamp:r.created_at,event:isPayout?'Pay-Out Initiated':'Pay-In Initiated',description:isPayout?'Settlement recorded and wallet funds placed on hold.':'Payment request recorded and awaiting payment gateway processing.',status:'COMPLETED'},{timestamp:r.updated_at,event:'Gateway Processing',description:'Provider execution will start after gateway integration is enabled.',status:'PENDING'}] };
}
const selectSql = `SELECT t.*,p.display_name party_name,p.parent_party_id,parent.display_name parent_name,
 g.gateway_name,m.method_name,m.method_code,o.option_name,c.name category_name
 FROM transactions t JOIN parties p ON p.id=t.party_id LEFT JOIN parties parent ON parent.id=p.parent_party_id
 LEFT JOIN payment_gateways g ON g.id=t.gateway_id LEFT JOIN payment_methods m ON m.id=t.payment_method_id
 LEFT JOIN payment_method_options o ON o.id=t.payment_option_id LEFT JOIN service_catalog_categories c ON c.id=t.service_category_id`;

transactionRouter.post('/payin/request', asyncHandler(async(req,res)=>{
  if(!req.auth!.partyId || !req.auth!.roles.includes('RETAILER')) throw new ApiError(403,'RETAILER_ONLY','Only a linked Retailer can create Pay-In transactions');
  const input=createSchema.parse(req.body); const partyId=req.auth!.partyId;
  const result=await withTransaction(async connection=>{
    const [parties]=await connection.query<RowDataPacket[]>("SELECT id,account_status FROM parties WHERE id=? AND party_type='RETAILER' AND deleted_at IS NULL",[partyId]);
    if(!parties[0]) throw new ApiError(403,'RETAILER_ONLY','Your login is not linked to a valid Retailer account');
    if(parties[0].account_status!=='ACTIVE') throw new ApiError(400,'RETAILER_INACTIVE','Retailer account must be active to create Pay-In transactions');
    const [routes]=await connection.query<RowDataPacket[]>(`SELECT g.gateway_name,m.method_name,m.method_code,o.option_name
      FROM payment_gateways g JOIN gateway_method_mappings gm ON gm.gateway_id=g.id AND gm.method_id=? AND gm.is_active=TRUE
      JOIN payment_methods m ON m.id=gm.method_id AND m.is_active=TRUE JOIN payment_method_options o ON o.id=? AND o.method_id=m.id AND o.is_active=TRUE
      WHERE g.id=? AND g.is_active=TRUE LIMIT 1`,[input.paymentMethodId,input.paymentOptionId,input.paymentGatewayId]);
    if(!routes[0]) throw new ApiError(422,'INVALID_PAYMENT_ROUTE','The selected gateway, payment method, and payment option are not an active mapped combination');
    const [categories]=await connection.query<RowDataPacket[]>("SELECT id,name,pricing_mode FROM service_catalog_categories WHERE id=? AND status='ACTIVE'",[input.serviceCategoryId]);
    const category=categories[0]; if(!category) throw new ApiError(422,'INVALID_SERVICE_CATEGORY','The selected service category is inactive or unavailable');
    let product:null|RowDataPacket=null;
    if(input.serviceProductId){const [products]=await connection.query<RowDataPacket[]>("SELECT id,name,price FROM service_catalog_products WHERE id=? AND category_id=? AND status='ACTIVE'",[input.serviceProductId,input.serviceCategoryId]);product=products[0]??null;if(!product)throw new ApiError(422,'INVALID_SERVICE_PRODUCT','The selected product is inactive or does not belong to this category');}
    if(category.pricing_mode==='PRESET_ONLY'&&!product) throw new ApiError(422,'PRODUCT_REQUIRED','Select a configured product for this service category');
    if(product&&Math.abs(Number(product.price)-input.amount)>0.009) throw new ApiError(422,'PRODUCT_AMOUNT_MISMATCH','The amount must match the configured product price');
    const charge=Number((input.amount*0.0175).toFixed(2)); const gst=Number((charge*0.18).toFixed(2)); const finalCredit=Number(Math.max(0,input.amount-charge-gst).toFixed(2));
    const id=randomUUID(); const reference=`QSPIN${new Date().toISOString().slice(0,10).replaceAll('-','')}${id.slice(0,8).toUpperCase()}`;
    const snapshot={principalAmount:input.amount,customerCharge:charge,gstAmount:gst,totalDeductions:charge+gst,actualCreditAmount:finalCredit,customerTotal:input.amount,gatewayName:routes[0].gateway_name,paymentMethod:routes[0].method_name,paymentOption:routes[0].option_name,serviceCategory:category.name,serviceProduct:product?.name??null,providerIntegrationStatus:'PENDING_INTEGRATION'};
    try { await connection.execute(`INSERT INTO transactions (id,internal_reference,idempotency_key,party_id,transaction_type,payment_mode,gateway_id,payment_method_id,payment_option_id,service_category_id,service_product_id,customer_name,customer_mobile,remarks,status,gross_amount,charge_amount,tax_amount,final_credit_amount,calculation_snapshot)
      VALUES (?,?,?,?,'PAY_IN',?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?,?)`,[id,reference,input.idempotencyKey,partyId,routes[0].method_code,input.paymentGatewayId,input.paymentMethodId,input.paymentOptionId,input.serviceCategoryId,input.serviceProductId??null,input.customerName,input.customerMobile,input.remarks??null,input.amount,charge,gst,finalCredit,JSON.stringify(snapshot)]); }
    catch(error:unknown){if(typeof error==='object'&&error!==null&&'code' in error&&error.code==='ER_DUP_ENTRY'){const [existing]=await connection.query<RowDataPacket[]>(`${selectSql} WHERE t.party_id=? AND t.idempotency_key=? LIMIT 1`,[partyId,input.idempotencyKey]);if(existing[0])return mapTransaction(existing[0]);throw new ApiError(409,'DUPLICATE_PAY_IN','This Pay-In request has already been submitted');}throw error;}
    await connection.execute(`INSERT INTO transaction_status_history (transaction_id,to_status,source,description,metadata) VALUES (?,'PENDING','USER','Pay-In created; awaiting provider integration',?)`,[id,JSON.stringify({gatewayId:input.paymentGatewayId})]);
    await writeAuditLog({action:'PAY_IN_CREATED',resourceType:'TRANSACTION',resourceId:id,afterData:{reference,status:'PENDING',amount:input.amount,finalCreditAmount:finalCredit}},contextFromAuth(req.auth),connection);
    const [rows]=await connection.query<RowDataPacket[]>(`${selectSql} WHERE t.id=?`,[id]); return mapTransaction(rows[0]!);
  }); return sendSuccess(res,result,201);
}));

transactionRouter.get('/',asyncHandler(async(req,res)=>{
  const q=z.object({type:z.enum(['ALL','PAY_IN','PAY_OUT']).default('ALL'),status:z.string().optional(),searchQuery:z.string().trim().max(100).optional(),dateRange:z.string().max(50).optional(),retailerId:z.string().optional(),providerId:z.string().optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(10)}).parse(req.query);
  const where:string[]=[];const params:unknown[]=[];if(!isAdmin(req.auth!.roles)){if(!req.auth!.partyId)throw new ApiError(403,'ACCESS_DENIED','No party linked');where.push('t.party_id=?');params.push(req.auth!.partyId);}else if(q.retailerId&&q.retailerId!=='ALL'){where.push('t.party_id=?');params.push(q.retailerId);}if(q.providerId&&q.providerId!=='ALL'){where.push('t.gateway_id=?');params.push(q.providerId);}if(q.type!=='ALL'){where.push('t.transaction_type=?');params.push(q.type);}if(q.status&&q.status!=='ALL'){where.push('t.status=?');params.push(q.status);}if(q.searchQuery){const term=`%${q.searchQuery}%`;where.push('(t.internal_reference LIKE ? OR t.customer_mobile LIKE ? OR t.customer_name LIKE ? OR p.display_name LIKE ?)');params.push(term,term,term,term);}if(q.dateRange){if(q.dateRange.includes('_to_')){const [start,end]=q.dateRange.split('_to_');if(start){where.push('t.created_at>=?');params.push(`${start} 00:00:00`);}if(end){where.push('t.created_at<=?');params.push(`${end} 23:59:59`);}}else {const days=q.dateRange==='yesterday'?1:q.dateRange==='7d'?6:q.dateRange==='30d'?29:0;where.push(`DATE(t.created_at)=DATE_SUB(CURRENT_DATE,INTERVAL ${days} DAY)`);if(q.dateRange==='7d'||q.dateRange==='30d')where[where.length-1]=`t.created_at>=DATE_SUB(CURRENT_DATE,INTERVAL ${days} DAY)`;}}const clause=where.length?`WHERE ${where.join(' AND ')}`:'';const offset=(q.page-1)*q.pageSize;
  const [counts]=await pool.query<(RowDataPacket&{total:number})[]>(`SELECT COUNT(*) total FROM transactions t JOIN parties p ON p.id=t.party_id ${clause}`,params);const [rows]=await pool.query<RowDataPacket[]>(`${selectSql} ${clause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,[...params,q.pageSize,offset]);const total=Number(counts[0]?.total??0);return sendSuccess(res,{items:rows.map(mapTransaction),pagination:{page:q.page,pageSize:q.pageSize,totalItems:total,totalPages:Math.max(1,Math.ceil(total/q.pageSize))}});
}));

transactionRouter.get('/:id',asyncHandler(async(req,res)=>{const id=z.string().min(1).max(60).parse(req.params.id);const scope=!isAdmin(req.auth!.roles)?' AND t.party_id=?':'';const params=!isAdmin(req.auth!.roles)?[id,id,req.auth!.partyId]:[id,id];const [rows]=await pool.query<RowDataPacket[]>(`${selectSql} WHERE (t.id=? OR t.internal_reference=?)${scope} LIMIT 1`,params);if(!rows[0])throw new ApiError(404,'TRANSACTION_NOT_FOUND','Transaction was not found');return sendSuccess(res,mapTransaction(rows[0]));}));
