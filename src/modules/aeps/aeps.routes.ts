import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { ZodError } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { bioSchema, eligibilitySchema, onboardingSchema, otpSchema, transactionSchema } from './aeps.schemas.js';
import { nobleAepsConfiguration, nobleAepsRequest } from './noble-aeps.client.js';

export const aepsRouter = Router();
aepsRouter.use(authenticate);

type ObjectValue = Record<string, unknown>;
const objectValue = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const stringValue = (value: unknown): string | undefined => value == null ? undefined : String(value);
const nestedData = (body: unknown): ObjectValue => { const root = objectValue(body); const data = objectValue(root.data); const rawResponse = data.responseData ?? root.responseData; const response = Array.isArray(rawResponse) ? objectValue(rawResponse[0]) : objectValue(rawResponse); return Object.keys(response).length ? response : Object.keys(data).length ? data : root; };
const providerMessage = (body: unknown) => { const root = objectValue(body); const data = nestedData(body); return stringValue(data.message ?? data.description ?? root.message ?? root.description) ?? 'Provider response received'; };
const providerCode = (body: unknown) => { const root = objectValue(body); const data = nestedData(body); return stringValue(data.responseCode ?? data.code ?? root.responseCode ?? root.code ?? root.status); };
const yes = (value: unknown) => ['YES','Y','TRUE','1','REQUIRED'].includes(String(value ?? '').toUpperCase());
const maskAadhaar = (value: string) => `XXXXXXXX${value.slice(-4)}`;
const maskMobile = (value: string) => `XXXXXX${value.slice(-4)}`;
const serviceCode = { CASH_WITHDRAWAL: 'CW', BALANCE_ENQUIRY: 'BE', MINI_STATEMENT: 'MS' } as const;

function parseBody<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try { return schema.parse(value); }
  catch (error) {
    if (error instanceof ZodError) throw new ApiError(422, 'VALIDATION_ERROR', 'Request validation failed', error.flatten());
    throw error;
  }
}

function retailer(request: Request): { partyId: string; userId: string } {
  if (!request.auth?.partyId || !request.auth.roles.includes('RETAILER')) throw new ApiError(403, 'RETAILER_ONLY', 'Only Retailers can use AEPS');
  return { partyId: request.auth.partyId, userId: request.auth.userId };
}
function context(request: Request, input: { mobileDeviceId: string; latitude: number; longitude: number }) {
  return { channel: 'WEB', mobileDeviceId: input.mobileDeviceId, ipAddress: request.ip, userAgent: request.get('user-agent')?.slice(0, 500) ?? 'Bright Spark Web', latitude: String(input.latitude), longitude: String(input.longitude) };
}
async function agentFor(partyId: string): Promise<RowDataPacket | undefined> {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM aeps_retailer_agents WHERE party_id=? LIMIT 1', [partyId]); return rows[0];
}
function requireOnboarded(agent: RowDataPacket | undefined): RowDataPacket {
  if (!agent?.unique_agent_id || agent.onboarding_status !== 'SUCCESS') throw new ApiError(409, 'AEPS_ONBOARDING_REQUIRED', 'Complete AEPS agent onboarding before continuing'); return agent;
}
function mapAgent(row: RowDataPacket | undefined) {
  if (!row) return { onboardingStatus: 'NOT_STARTED', kycStatus: 'UNKNOWN', daily2faStatus: 'UNKNOWN' };
  return { onboardingStatus: row.onboarding_status, kycStatus: row.kyc_status, daily2faStatus: row.daily_2fa_status, daily2faCompletedAt: row.daily_2fa_completed_at, lastProviderMessage: row.last_provider_message, lastLoadedAt: row.last_loaded_at };
}
function mapTransaction(row: RowDataPacket) {
  let statement: unknown; try { statement = typeof row.statement_json === 'string' ? JSON.parse(row.statement_json) : row.statement_json; } catch { statement = undefined; }
  return { id: row.transaction_id, serviceType: row.service_type, bankId: row.bank_iin, bankName: row.bank_name, maskedAadhaar: row.masked_aadhaar, maskedMobile: row.masked_mobile,
    amount: row.amount == null ? undefined : Number(row.amount), status: row.status, responseMessage: row.provider_message ?? 'Processing', providerReference: row.provider_reference,
    rrn: row.rrn, customerBankBalance: row.customer_bank_balance == null ? undefined : Number(row.customer_bank_balance), statement, createdAt: row.created_at };
}
function transactionResult(body: unknown) {
  const data = nestedData(body); const raw = String(data.tranStatus ?? data.transactionStatus ?? data.status ?? '').toUpperCase();
  const status = ['SUCCESS','SUCCESSFUL','TXN_SUCCESS','1'].includes(raw) ? 'SUCCESS' : ['FAILED','FAILURE','TXN_FAILED','0'].includes(raw) ? 'FAILED' : raw.includes('PENDING') ? 'PENDING' : 'UNKNOWN';
  return { status, code: providerCode(body), message: providerMessage(body), reference: stringValue(data.transactionId ?? data.providerTransactionId ?? data.txnId), rrn: stringValue(data.rrn),
    balance: data.balance ?? data.bankBalance ?? data.availableBalance, statement: data.miniStatement ?? data.statement ?? data.transactions };
}

aepsRouter.get('/configuration', asyncHandler(async (request, response) => { retailer(request); return sendSuccess(response, nobleAepsConfiguration()); }));

aepsRouter.get('/session', asyncHandler(async (request, response) => {
  const { partyId } = retailer(request); return sendSuccess(response, { ...nobleAepsConfiguration(), agent: mapAgent(await agentFor(partyId)) });
}));

aepsRouter.post('/agent/onboard', asyncHandler(async (request, response) => {
  const { partyId, userId } = retailer(request); const input = parseBody(onboardingSchema, request.body); const existing = await agentFor(partyId);
  if (existing?.unique_agent_id && existing.onboarding_status === 'SUCCESS') throw new ApiError(409, 'AEPS_AGENT_ALREADY_ONBOARDED', 'This retailer is already onboarded for AEPS');
  if (existing?.onboarding_status === 'PENDING') throw new ApiError(409, 'AEPS_ONBOARDING_PENDING', 'Agent onboarding is already pending; check its status before retrying');
  const id = existing?.id ?? randomUUID();
  if (!existing) await pool.execute(`INSERT INTO aeps_retailer_agents (id,party_id,onboarding_transaction_id,onboarding_status,created_by_user_id) VALUES (?,?,?,'PENDING',?)`, [id, partyId, input.transactionId, userId]);
  else await pool.execute(`UPDATE aeps_retailer_agents SET onboarding_transaction_id=?,onboarding_status='PENDING',last_provider_message=NULL WHERE id=?`, [input.transactionId, id]);
  try {
    const body = await nobleAepsRequest('agent_onboarding', { ...context(request, input), transactionId: input.transactionId, name: input.name, mobile: input.mobile, email: input.email, pan: input.pan, aadhaar: input.aadhaar, dob: input.dob,
      agentCode: input.agentCode, address: input.address, state: input.state, city: input.city, pin: input.pin, bankName: input.bankName, accountNumber: input.accountNumber, ifsc: input.ifsc,
      shopName: input.shopName, shopAddress: input.shopAddress, isPhysicalVerified: input.isPhysicalVerified });
    const data = nestedData(body); const uniqueAgentId = stringValue(data.uniqueAgentId ?? data.agentId); const success = Boolean(uniqueAgentId);
    await pool.execute(`UPDATE aeps_retailer_agents SET unique_agent_id=?,onboarding_status=?,last_provider_code=?,last_provider_message=? WHERE id=?`, [uniqueAgentId ?? null, success ? 'SUCCESS' : 'PENDING', providerCode(body) ?? null, providerMessage(body), id]);
    return sendSuccess(response, { onboardingStatus: success ? 'SUCCESS' : 'PENDING', message: providerMessage(body) }, 201);
  } catch (error) { if (!(error instanceof ApiError && ['AEPS_PROVIDER_TIMEOUT','AEPS_PROVIDER_UNAVAILABLE'].includes(error.code))) await pool.execute(`UPDATE aeps_retailer_agents SET onboarding_status='FAILED',last_provider_message=? WHERE id=?`, [(error as Error).message, id]); throw error; }
}));

aepsRouter.post('/agent/onboarding-status', asyncHandler(async (request, response) => {
  const { partyId } = retailer(request); const agent = await agentFor(partyId);
  if (!agent?.onboarding_transaction_id) throw new ApiError(404, 'AEPS_ONBOARDING_NOT_FOUND', 'No AEPS onboarding attempt was found');
  const body = await nobleAepsRequest('agent_onboarding_status', { transactionId: agent.onboarding_transaction_id }); const data = nestedData(body);
  const uniqueAgentId = stringValue(data.uniqueAgentId ?? data.agentId); const raw = String(data.status ?? '').toUpperCase(); const status = uniqueAgentId || raw.includes('SUCCESS') ? 'SUCCESS' : raw.includes('FAIL') ? 'FAILED' : 'PENDING';
  await pool.execute('UPDATE aeps_retailer_agents SET unique_agent_id=COALESCE(?,unique_agent_id),onboarding_status=?,last_provider_code=?,last_provider_message=? WHERE id=?', [uniqueAgentId ?? null, status, providerCode(body) ?? null, providerMessage(body), agent.id]);
  return sendSuccess(response, { onboardingStatus: status, message: providerMessage(body) });
}));

aepsRouter.post('/agent/load', asyncHandler(async (request, response) => {
  const { partyId } = retailer(request); const input = parseBody(eligibilitySchema, request.body); const agent = requireOnboarded(await agentFor(partyId));
  const body = await nobleAepsRequest('load_agent', { transactionId: `LOAD-${randomUUID()}`, uniqueAgentId: agent.unique_agent_id, ...context(request, input) }); const data = nestedData(body);
  const kycRequired = yes(data.kycRequired); const daily2faRequired = yes(data.daily2faRequired);
  await pool.execute(`UPDATE aeps_retailer_agents SET kyc_status=?,daily_2fa_status=?,last_provider_code=?,last_provider_message=?,last_loaded_at=UTC_TIMESTAMP(6) WHERE id=?`, [kycRequired ? 'REQUIRED' : 'COMPLETED', daily2faRequired ? 'REQUIRED' : 'COMPLETED', providerCode(body) ?? null, providerMessage(body), agent.id]);
  return sendSuccess(response, { kycRequired, daily2faRequired, kycWadhValue: stringValue(data.kycWadhValue), amountForOtp: Number(data.amountForOtp ?? 0), tranTypeForOtp: stringValue(data.tranTypeForOtp), message: providerMessage(body) });
}));

aepsRouter.post('/agent/kyc', asyncHandler(async (request, response) => {
  const { partyId } = retailer(request); const input = parseBody(bioSchema, request.body); const agent = requireOnboarded(await agentFor(partyId));
  const body = await nobleAepsRequest('kyc', { transactionId: `KYC-${randomUUID()}`, uniqueAgentId: agent.unique_agent_id, ...context(request, input), businessNature: 'RETAILER', annualIncome: '0', bioType: input.bioType, pidData: input.pidData });
  const data = nestedData(body); const completed = !yes(data.kycRequired) && !String(data.status ?? '').toUpperCase().includes('FAIL');
  await pool.execute('UPDATE aeps_retailer_agents SET kyc_status=?,last_provider_code=?,last_provider_message=? WHERE id=?', [completed ? 'COMPLETED' : 'FAILED', providerCode(body) ?? null, providerMessage(body), agent.id]);
  return sendSuccess(response, { completed, message: providerMessage(body) });
}));

aepsRouter.post('/agent/daily-2fa', asyncHandler(async (request, response) => {
  const { partyId } = retailer(request); const input = parseBody(bioSchema, request.body); const agent = requireOnboarded(await agentFor(partyId));
  const body = await nobleAepsRequest('daily_2fa', { transactionId: `2FA-${randomUUID()}`, uniqueAgentId: agent.unique_agent_id, ...context(request, input), serviceType: 'AEPS', bioType: input.bioType, pidData: input.pidData });
  const data = nestedData(body); const completed = !yes(data.daily2faRequired) && !String(data.status ?? '').toUpperCase().includes('FAIL');
  await pool.execute(`UPDATE aeps_retailer_agents SET daily_2fa_status=?,daily_2fa_completed_at=${completed ? 'UTC_TIMESTAMP(6)' : 'NULL'},last_provider_code=?,last_provider_message=? WHERE id=?`, [completed ? 'COMPLETED' : 'FAILED', providerCode(body) ?? null, providerMessage(body), agent.id]);
  return sendSuccess(response, { completed, message: providerMessage(body) });
}));

aepsRouter.post('/otp', asyncHandler(async (request, response) => {
  const { partyId } = retailer(request); const input = parseBody(otpSchema, request.body); const agent = requireOnboarded(await agentFor(partyId));
  const body = await nobleAepsRequest('generate_otp', { transactionId: input.transactionId, uniqueAgentId: agent.unique_agent_id, ...context(request, input), tranType: 'CW', amount: String(input.amount), bankIn: input.bankIin, mobile: input.mobile, aadhaar: input.aadhaar });
  const data = nestedData(body); return sendSuccess(response, { otpReference: stringValue(data.otpReference ?? data.referenceId), message: providerMessage(body) });
}));

aepsRouter.post('/transactions', asyncHandler(async (request, response) => {
  const { partyId, userId } = retailer(request); const input = parseBody(transactionSchema, request.body); const agent = requireOnboarded(await agentFor(partyId));
  if (agent.kyc_status !== 'COMPLETED' || agent.daily_2fa_status !== 'COMPLETED') throw new ApiError(409, 'AEPS_RETAILER_AUTH_REQUIRED', 'Complete AEPS KYC and daily retailer authentication before a customer transaction');
  const fingerprint = createHash('sha256').update(`${partyId}:${input.transactionId}:${input.serviceType}:${input.bankIin}:${input.aadhaar.slice(-4)}:${input.amount ?? 0}`).digest('hex');
  const [prior] = await pool.query<RowDataPacket[]>('SELECT * FROM aeps_transactions WHERE transaction_id=? LIMIT 1', [input.transactionId]); if (prior[0]) return sendSuccess(response, mapTransaction(prior[0]));
  const id = randomUUID(); await pool.execute(`INSERT INTO aeps_transactions (id,transaction_id,party_id,agent_id,service_type,bank_name,bank_iin,masked_aadhaar,masked_mobile,amount,request_fingerprint,created_by_user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id,input.transactionId,partyId,agent.id,input.serviceType,input.bankName,input.bankIin,maskAadhaar(input.aadhaar),maskMobile(input.mobile),input.serviceType === 'CASH_WITHDRAWAL' ? input.amount : null,fingerprint,userId]);
  try {
    const body = await nobleAepsRequest('transaction', { transactionId: input.transactionId, uniqueAgentId: agent.unique_agent_id, ...context(request, input), tranType: serviceCode[input.serviceType], amount: String(input.serviceType === 'CASH_WITHDRAWAL' ? input.amount : 0), bankName: input.bankName, bankIn: input.bankIin, mobile: input.mobile, aadhaar: input.aadhaar, isOtp: input.otpReference ? 1 : 0, otpReference: input.otpReference ?? '', bioType: input.bioType, pidData: input.pidData }, { retryAuthentication: false });
    const result = transactionResult(body); await pool.execute(`UPDATE aeps_transactions SET status=?,provider_reference=?,rrn=?,provider_code=?,provider_message=?,customer_bank_balance=?,statement_json=?,completed_at=IF(? IN ('SUCCESS','FAILED'),UTC_TIMESTAMP(6),NULL) WHERE id=?`,
      [result.status,result.reference ?? null,result.rrn ?? null,result.code ?? null,result.message,result.balance == null ? null : Number(result.balance),result.statement == null ? null : JSON.stringify(result.statement),result.status,id]);
    await pool.execute('INSERT INTO aeps_transaction_status_history (id,aeps_transaction_id,status,provider_code,provider_message) VALUES (?,?,?,?,?)', [randomUUID(),id,result.status,result.code ?? null,result.message]);
  } catch (error) { await pool.execute(`UPDATE aeps_transactions SET status='UNKNOWN',provider_message=? WHERE id=?`, [(error as Error).message,id]); }
  const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM aeps_transactions WHERE id=?',[id]); return sendSuccess(response,mapTransaction(rows[0]!),201);
}));

aepsRouter.get('/transactions', asyncHandler(async (request, response) => { const { partyId } = retailer(request); const [rows] = await pool.query<RowDataPacket[]>('SELECT * FROM aeps_transactions WHERE party_id=? ORDER BY created_at DESC LIMIT 100',[partyId]); return sendSuccess(response,rows.map(mapTransaction)); }));

aepsRouter.post('/transactions/:transactionId/status', asyncHandler(async (request, response) => {
  const { partyId } = retailer(request); const [rows] = await pool.query<RowDataPacket[]>('SELECT t.*,a.unique_agent_id FROM aeps_transactions t JOIN aeps_retailer_agents a ON a.id=t.agent_id WHERE t.transaction_id=? AND t.party_id=? LIMIT 1',[request.params.transactionId,partyId]); const row=rows[0];
  if(!row) throw new ApiError(404,'AEPS_TRANSACTION_NOT_FOUND','AEPS transaction was not found');
  const body=await nobleAepsRequest('transaction_status',{transactionId:row.transaction_id,transactionDate:new Date(row.created_at).toLocaleDateString('en-GB')}); const result=transactionResult(body);
  await pool.execute(`UPDATE aeps_transactions SET status=?,provider_reference=COALESCE(?,provider_reference),rrn=COALESCE(?,rrn),provider_code=?,provider_message=?,customer_bank_balance=COALESCE(?,customer_bank_balance),statement_json=COALESCE(?,statement_json),completed_at=IF(? IN ('SUCCESS','FAILED'),UTC_TIMESTAMP(6),completed_at) WHERE id=?`,[result.status,result.reference??null,result.rrn??null,result.code??null,result.message,result.balance==null?null:Number(result.balance),result.statement==null?null:JSON.stringify(result.statement),result.status,row.id]);
  await pool.execute('INSERT INTO aeps_transaction_status_history (id,aeps_transaction_id,status,provider_code,provider_message) VALUES (?,?,?,?,?)',[randomUUID(),row.id,result.status,result.code??null,result.message]); const [updated]=await pool.query<RowDataPacket[]>('SELECT * FROM aeps_transactions WHERE id=?',[row.id]); return sendSuccess(response,mapTransaction(updated[0]!));
}));
