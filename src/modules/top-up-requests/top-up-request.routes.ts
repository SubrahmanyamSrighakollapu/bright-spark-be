import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { createTopUp, getProof, getTopUp, listTopUps, reviewTopUp } from './top-up-request.service.js';

const accepted=new Set(['application/pdf','image/jpeg','image/png']);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1},fileFilter:(_r,f,cb)=>cb(null,accepted.has(f.mimetype))});
export const topUpRequestRouter=Router(); topUpRequestRouter.use(authenticate);

topUpRequestRouter.get('/',asyncHandler(async(req,res)=>{const q=z.object({status:z.enum(['ALL','PENDING','APPROVED','REJECTED']).default('ALL'),search:z.string().max(100).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20)}).parse(req.query); return sendSuccess(res,await listTopUps(q,req.auth!));}));
topUpRequestRouter.post('/',upload.single('proof'),asyncHandler(async(req,res)=>{if(!req.file) throw new ApiError(400,'PROOF_REQUIRED','Payment proof (PDF, JPG or PNG; maximum 5 MB) is required'); const input=z.object({amount:z.coerce.number().min(100).max(100000000),paymentMode:z.enum(['BANK_TRANSFER','UPI','QR']),paymentReference:z.string().trim().min(4).max(100),remarks:z.string().trim().max(500).optional()}).parse(req.body); return sendSuccess(res,await createTopUp({...input,file:req.file},req.auth!),201);}));
topUpRequestRouter.get('/:id',asyncHandler(async(req,res)=>sendSuccess(res,await getTopUp(z.string().uuid().parse(req.params.id),req.auth!))));
topUpRequestRouter.get('/:id/proof',asyncHandler(async(req,res)=>{const proof=await getProof(z.string().uuid().parse(req.params.id),req.auth!); res.type(proof.mimeType); res.setHeader('Content-Disposition',`inline; filename="${proof.filename.replace(/["\r\n]/g,'_')}"`); proof.stream.pipe(res);}));
topUpRequestRouter.post('/:id/review',asyncHandler(async(req,res)=>{const id=z.string().uuid().parse(req.params.id); const input=z.object({decision:z.enum(['APPROVED','REJECTED']),remarks:z.string().trim().min(3).max(1000)}).parse(req.body); return sendSuccess(res,await reviewTopUp(id,input,req.auth!));}));
