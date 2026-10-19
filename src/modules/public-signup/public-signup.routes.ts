import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { writeAuditLog } from '../../shared/audit.js';
import { normalizeClientIp } from '../../shared/ip.js';

export const publicSignupRouter = Router();
const uploadRoot=path.resolve(process.cwd(),'uploads','kyc');
const accepted=new Set(['application/pdf','image/jpeg','image/png']);
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:12},fileFilter:(_r,file,cb)=>cb(null,accepted.has(file.mimetype))});
const schema=z.object({role:z.enum(['MASTER_DISTRIBUTOR','DISTRIBUTOR','RETAILER']),fullName:z.string().trim().min(2).max(160),businessName:z.string().trim().min(2).max(200),email:z.string().trim().toLowerCase().email().max(254),mobile:z.string().trim().regex(/^[6-9]\d{9}$/),password:z.string().min(10).max(72).regex(/[A-Z]/,'Include an uppercase letter').regex(/[a-z]/,'Include a lowercase letter').regex(/\d/,'Include a number'),address:z.string().trim().min(5).max(200),city:z.string().trim().min(2).max(100),state:z.string().trim().min(2).max(100),postalCode:z.string().trim().regex(/^\d{6}$/)});
type DocumentRequirement={id:string;code:string;label:string;description:string|null;configuration:{required?:boolean;acceptedMimeTypes?:string[];maxSizeMb?:number;applicablePartyTypes?:string[]};sortOrder:number};
const getRequirements=async(role:string):Promise<DocumentRequirement[]>=>{const [rows]=await pool.query<RowDataPacket[]>(`SELECT id,code,label,description,configuration,sort_order FROM master_data WHERE category='KYC_DOCUMENT_TYPE' AND is_active=TRUE ORDER BY sort_order,label`);return rows.map(row=>({...row,configuration:typeof row.configuration==='string'?JSON.parse(row.configuration):(row.configuration??{}),sortOrder:Number(row.sort_order??0)})).filter(row=>!Array.isArray(row.configuration.applicablePartyTypes)||row.configuration.applicablePartyTypes.includes(role)) as DocumentRequirement[];};
const getFiles=(req:Express.Request)=>req.files as Express.Multer.File[]|undefined;

publicSignupRouter.use(rateLimit({windowMs:15*60_000,limit:10,standardHeaders:'draft-8',legacyHeaders:false}));
publicSignupRouter.get('/document-requirements',asyncHandler(async(req,res)=>{const role=z.enum(['MASTER_DISTRIBUTOR','DISTRIBUTOR','RETAILER']).parse(req.query.role);return sendSuccess(res,await getRequirements(role));}));
publicSignupRouter.post('/',upload.any(),asyncHandler(async(req,res)=>{
  const input=schema.parse(req.body);const requirements=await getRequirements(input.role);const files=getFiles(req)??[];const filesByCode=new Map(files.map(file=>[file.fieldname,file]));
  const required=requirements.filter(item=>item.configuration.required).map(item=>item.code);const missing=required.filter(code=>!filesByCode.has(code));if(missing.length)throw new ApiError(422,'KYC_DOCUMENTS_MISSING',`Upload all required documents: ${missing.join(', ')}`);
  for(const file of files){const requirement=requirements.find(item=>item.code===file.fieldname);if(!requirement)throw new ApiError(422,'INVALID_DOCUMENT_TYPE',`${file.fieldname} is not configured for ${input.role}`);const allowed=requirement.configuration.acceptedMimeTypes;if(allowed?.length&&!allowed.includes(file.mimetype))throw new ApiError(422,'INVALID_DOCUMENT_FORMAT',`${requirement.label} has an unsupported file format`);const maximum=(requirement.configuration.maxSizeMb??5)*1024*1024;if(file.size>maximum)throw new ApiError(422,'DOCUMENT_TOO_LARGE',`${requirement.label} must be within ${requirement.configuration.maxSizeMb??5} MB`);}
  const [existing]=await pool.query<RowDataPacket[]>('SELECT id FROM users WHERE email=? OR mobile=? LIMIT 1',[input.email,input.mobile]);if(existing[0])throw new ApiError(409,'APPLICANT_EXISTS','An application or account already exists for this email or mobile number');
  const partyId=randomUUID(),userId=randomUUID(),applicationId=randomUUID();const suffix=partyId.replaceAll('-','').slice(0,8).toUpperCase();const prefix=input.role==='MASTER_DISTRIBUTOR'?'MD':input.role==='DISTRIBUTOR'?'DST':'RET';const code=`${prefix}-EXT-${suffix}`;const reference=`BSP-APP-${suffix}`;const targetDir=path.join(uploadRoot,partyId);await mkdir(targetDir,{recursive:true});
  const stored:Array<{id:string;type:string;key:string;file:Express.Multer.File}>=[];
  try{
    for(const requirement of requirements){const file=filesByCode.get(requirement.code);if(!file)continue;const id=randomUUID();const ext=file.mimetype==='application/pdf'?'.pdf':file.mimetype==='image/png'?'.png':'.jpg';const key=`${partyId}/${id}${ext}`;await writeFile(path.join(uploadRoot,key),file.buffer);stored.push({id,type:requirement.code,key,file});}
    await withTransaction(async c=>{
      const [duplicate]=await c.query<RowDataPacket[]>('SELECT id FROM users WHERE email=? OR mobile=? FOR UPDATE',[input.email,input.mobile]);if(duplicate[0])throw new ApiError(409,'APPLICANT_EXISTS','An application or account already exists for this email or mobile number');
      await c.execute(`INSERT INTO parties (id,party_type,code,display_name,legal_name,email,mobile,parent_party_id,created_by_user_id,signup_source,approval_status,account_status,kyc_status) VALUES (?,?,?,?,?,?,?,NULL,NULL,'PUBLIC_SELF_SERVICE','PENDING_APPROVAL','PENDING','PENDING')`,[partyId,input.role,code,input.fullName,input.businessName,input.email,input.mobile]);
      await c.execute(`INSERT INTO party_addresses (id,party_id,address_type,line1,city,state_code,postal_code,country_code,is_primary) VALUES (?,?,'BUSINESS',?,?,?,?,'IN',TRUE)`,[randomUUID(),partyId,input.address,input.city,input.state,input.postalCode]);
      await c.execute(`INSERT INTO users (id,party_id,email,mobile,full_name,password_hash,status) VALUES (?,?,?,?,?,?,'PENDING')`,[userId,partyId,input.email,input.mobile,input.fullName,await bcrypt.hash(input.password,env.BCRYPT_ROUNDS)]);
      const [roles]=await c.query<RowDataPacket[]>('SELECT id FROM roles WHERE code=? AND is_active=TRUE LIMIT 1',[input.role]);if(!roles[0])throw new ApiError(500,'ROLE_CONFIGURATION_MISSING','The selected partner role is not configured');await c.execute('INSERT INTO user_roles (user_id,role_id,assigned_by) VALUES (?,?,NULL)',[userId,roles[0].id]);
      await c.execute(`INSERT INTO onboarding_applications (id,party_id,application_reference,applicant_email,applicant_mobile,status,submitted_at) VALUES (?,?,?,?,?,'SUBMITTED',CURRENT_TIMESTAMP(6))`,[applicationId,partyId,reference,input.email,input.mobile]);
      for(const item of stored)await c.execute(`INSERT INTO kyc_documents (id,application_id,document_type,storage_key,original_filename,mime_type,size_bytes,checksum_sha256,status) VALUES (?,?,?,?,?,?,?,?, 'UNDER_REVIEW')`,[item.id,applicationId,item.type,item.key,item.file.originalname,item.file.mimetype,item.file.size,createHash('sha256').update(item.file.buffer).digest('hex')]);
      await writeAuditLog({action:'PUBLIC_PARTNER_SIGNUP_SUBMITTED',resourceType:'ONBOARDING_APPLICATION',resourceId:applicationId,afterData:{reference,partyId,role:input.role,status:'SUBMITTED'},metadata:{signupSource:'PUBLIC_SELF_SERVICE',documentTypes:stored.map(item=>item.type)}},{actorUserId:null,actorPartyId:null,requestId:req.requestId,ipAddress:normalizeClientIp(req.ip),userAgent:req.header('user-agent')},c);
    });
  }catch(error){await rm(targetDir,{recursive:true,force:true});throw error;}
  return sendSuccess(res,{reference,applicationId,status:'PENDING_KYC_REVIEW',role:input.role,message:'Your application was submitted. Login remains disabled until KYC review, Admin assignment, and network approval are complete.'},201);
}));
