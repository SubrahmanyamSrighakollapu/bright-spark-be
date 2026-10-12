import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/response.js';
import { contextFromAuth, writeAuditLog } from '../../shared/audit.js';

export const serviceCategoryRouter = Router();
serviceCategoryRouter.use(authenticate);
const write = requirePermission('MASTER_DATA_WRITE');
const id = z.string().uuid();
const statusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
interface CategoryRow extends RowDataPacket { id: string }
interface ProductRow extends RowDataPacket { categoryId: string }
export const categorySchema = z.object({ code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/), name: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).default(''), pricingMode: z.enum(['BOTH', 'PRESET_ONLY', 'MANUAL_ONLY']).default('BOTH'), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') });
export const productSchema = z.object({ code: z.string().trim().min(2).max(80).regex(/^[A-Z0-9_]+$/), name: z.string().trim().min(2).max(160), description: z.string().trim().max(1000).default(''), price: z.coerce.number().positive(), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') });

async function catalogue(activeOnly = false) {
  const where = activeOnly ? "WHERE c.status = 'ACTIVE'" : '';
  const [categories] = await pool.query<CategoryRow[]>(`SELECT c.id,c.code,c.name,COALESCE(c.description,'') description,c.pricing_mode pricingMode,c.status FROM service_catalog_categories c ${where} ORDER BY c.created_at`);
  const [products] = await pool.query<ProductRow[]>(`SELECT id,category_id categoryId,code,name,COALESCE(description,'') description,CAST(price AS DOUBLE) price,status FROM service_catalog_products ${activeOnly ? "WHERE status = 'ACTIVE'" : ''} ORDER BY created_at`);
  return categories.map((category) => ({ ...category, products: products.filter((product) => product.categoryId === category.id) }));
}

serviceCategoryRouter.get('/', asyncHandler(async (request, response) => sendSuccess(response, await catalogue(request.query.activeOnly === 'true'))));
serviceCategoryRouter.post('/', write, asyncHandler(async (request, response) => { const input = categorySchema.parse(request.body); const categoryId = randomUUID(); await pool.execute('INSERT INTO service_catalog_categories (id,code,name,description,pricing_mode,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?)', [categoryId,input.code,input.name,input.description,input.pricingMode,input.status,request.auth!.userId,request.auth!.userId]); await writeAuditLog({ action: 'SERVICE_CATEGORY_CREATED', resourceType: 'SERVICE_CATEGORY', resourceId: categoryId, afterData: input }, contextFromAuth(request.auth)); return sendSuccess(response, { id: categoryId, ...input, products: [] }, 201); }));
serviceCategoryRouter.put('/:id', write, asyncHandler(async (request, response) => { const categoryId = id.parse(request.params.id); const input = categorySchema.parse(request.body); const [result] = await pool.execute<ResultSetHeader>('UPDATE service_catalog_categories SET code=?,name=?,description=?,pricing_mode=?,status=?,updated_by=? WHERE id=?', [input.code,input.name,input.description,input.pricingMode,input.status,request.auth!.userId,categoryId]); if (!result.affectedRows) throw new ApiError(404,'CATEGORY_NOT_FOUND','Service category was not found'); return sendSuccess(response, (await catalogue()).find((item) => item.id === categoryId)); }));
serviceCategoryRouter.patch('/:id/status', write, asyncHandler(async (request, response) => { const categoryId=id.parse(request.params.id); const input=statusSchema.parse(request.body); const [result]=await pool.execute<ResultSetHeader>('UPDATE service_catalog_categories SET status=?,updated_by=? WHERE id=?',[input.status,request.auth!.userId,categoryId]); if(!result.affectedRows) throw new ApiError(404,'CATEGORY_NOT_FOUND','Service category was not found'); return sendSuccess(response,(await catalogue()).find((item)=>item.id===categoryId)); }));
serviceCategoryRouter.delete('/:id', write, asyncHandler(async (request,response)=>{ const categoryId=id.parse(request.params.id); const [result]=await pool.execute<ResultSetHeader>('DELETE FROM service_catalog_categories WHERE id=?',[categoryId]); if(!result.affectedRows) throw new ApiError(404,'CATEGORY_NOT_FOUND','Service category was not found'); return sendSuccess(response,{deleted:true}); }));
serviceCategoryRouter.post('/:id/products', write, asyncHandler(async(request,response)=>{ const categoryId=id.parse(request.params.id); const input=productSchema.parse(request.body); const productId=randomUUID(); await pool.execute('INSERT INTO service_catalog_products (id,category_id,code,name,description,price,status,created_by,updated_by) VALUES (?,?,?,?,?,?,?,?,?)',[productId,categoryId,input.code,input.name,input.description,input.price,input.status,request.auth!.userId,request.auth!.userId]); return sendSuccess(response,(await catalogue()).find((item)=>item.id===categoryId),201); }));
serviceCategoryRouter.put('/:id/products/:productId', write, asyncHandler(async(request,response)=>{ const categoryId=id.parse(request.params.id); const productId=id.parse(request.params.productId); const input=productSchema.parse(request.body); const [result]=await pool.execute<ResultSetHeader>('UPDATE service_catalog_products SET code=?,name=?,description=?,price=?,status=?,updated_by=? WHERE id=? AND category_id=?',[input.code,input.name,input.description,input.price,input.status,request.auth!.userId,productId,categoryId]); if(!result.affectedRows) throw new ApiError(404,'PRODUCT_NOT_FOUND','Service product was not found'); return sendSuccess(response,(await catalogue()).find((item)=>item.id===categoryId)); }));
serviceCategoryRouter.patch('/:id/products/:productId/status', write, asyncHandler(async(request,response)=>{ const categoryId=id.parse(request.params.id); const productId=id.parse(request.params.productId); const input=statusSchema.parse(request.body); const [result]=await pool.execute<ResultSetHeader>('UPDATE service_catalog_products SET status=?,updated_by=? WHERE id=? AND category_id=?',[input.status,request.auth!.userId,productId,categoryId]); if(!result.affectedRows) throw new ApiError(404,'PRODUCT_NOT_FOUND','Service product was not found'); return sendSuccess(response,(await catalogue()).find((item)=>item.id===categoryId)); }));
serviceCategoryRouter.delete('/:id/products/:productId', write, asyncHandler(async(request,response)=>{ const categoryId=id.parse(request.params.id); const productId=id.parse(request.params.productId); const [result]=await pool.execute<ResultSetHeader>('DELETE FROM service_catalog_products WHERE id=? AND category_id=?',[productId,categoryId]); if(!result.affectedRows) throw new ApiError(404,'PRODUCT_NOT_FOUND','Service product was not found'); return sendSuccess(response,(await catalogue()).find((item)=>item.id===categoryId)); }));
