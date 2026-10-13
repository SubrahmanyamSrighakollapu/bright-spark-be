import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env.js';

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object, example?: unknown) => ({
  'application/json': { schema, ...(example === undefined ? {} : { example }) },
});
const success = (description: string, dataSchema: object, status = 200) => ({
  [String(status)]: {
    description,
    content: json({
      allOf: [
        ref('SuccessEnvelope'),
        { type: 'object', properties: { data: dataSchema } },
      ],
    }),
  },
});
const error = (description: string) => ({ description, content: json(ref('ErrorResponse')) });
const protectedErrors = {
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '422': { $ref: '#/components/responses/ValidationError' },
  '429': { $ref: '#/components/responses/RateLimited' },
  '500': { $ref: '#/components/responses/InternalError' },
};
const bearer = [{ bearerAuth: [] }];
const idParameter = {
  name: 'id', in: 'path', required: true,
  description: 'Party or master-data item UUID.',
  schema: { type: 'string', format: 'uuid' },
  example: '550e8400-e29b-41d4-a716-446655440000',
};

const configurationResources = ['gateways', 'methods', 'options', 'mappings', 'plans', 'plan-configurations', 'commissions'] as const;
const configurationPaths = Object.fromEntries(configurationResources.flatMap((resource) => {
  const label = resource.replaceAll('-', ' ');
  const collection = `${env.API_PREFIX}/configuration/${resource}`;
  const item = `${collection}/{id}`;
  return [
    [collection, {
      get: { operationId: `listConfiguration${resource}`, tags: ['Configuration'], summary: `List ${label}`, security: bearer, responses: { ...success(`${label} returned.`, { type: 'array', items: { type: 'object' } }), ...protectedErrors } },
      post: { operationId: `createConfiguration${resource}`, tags: ['Configuration'], summary: `Create ${label}`, security: bearer, requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) }, responses: { ...success(`${label} created.`, { type: 'object' }, 201), ...protectedErrors } },
    }],
    [item, {
      put: { operationId: `updateConfiguration${resource}`, tags: ['Configuration'], summary: `Update ${label}`, security: bearer, parameters: [idParameter], requestBody: { required: true, content: json({ type: 'object', additionalProperties: true }) }, responses: { ...success(`${label} updated.`, { type: 'object' }), ...protectedErrors, '404': error('Configuration record was not found.') } },
      delete: { operationId: `deleteConfiguration${resource}`, tags: ['Configuration'], summary: `Delete ${label}`, security: bearer, parameters: [idParameter], responses: { ...success(`${label} deleted.`, { type: 'object', properties: { deleted: { type: 'boolean' } } }), ...protectedErrors, '404': error('Configuration record was not found.'), '409': error('Configuration record is still in use.') } },
    }],
  ];
}));

const definition = {
  openapi: '3.1.0',
  info: {
    title: 'Qin Star Pay API',
    version: '0.1.0',
    description: 'Interactive contract for the Qin Star Pay payment operations backend. Only currently implemented APIs are documented.',
  },
  servers: [{ url: `http://localhost:${env.PORT}`, description: 'Local development server' }],
  tags: [
    { name: 'Health', description: 'Process and database health probes.' },
    { name: 'Authentication', description: 'JWT authentication and refresh-token lifecycle.' },
    { name: 'Parties', description: 'Master Distributor, Distributor, Retailer, and Employee hierarchy management.' },
    { name: 'Roles', description: 'Protected network roles and configurable employee roles.' },
    { name: 'Employees', description: 'Internal employee accounts, profiles, departments, and role assignment.' },
    { name: 'Master Data', description: 'Controlled platform reference data.' },
    { name: 'Headlines & Tickers', description: 'Dynamic headline, notice-board, and scrolling ticker content.' },
    { name: 'Payout Charges', description: 'Admin-configured flat settlement charges by transfer mode and amount range.' },
    { name: 'Service Catalogue', description: 'Admin-configured service categories and products exposed to Retailer Pay-In.' },
    { name: 'Configuration', description: 'Payment gateways, payment methods, plans, mappings, role configurations, and commission rates.' },
    { name: 'Wallet Top-Ups', description: 'Retailer funding requests, payment proof review, and atomic Admin wallet credits.' },
    { name: 'Transactions', description: 'Retailer Pay-In creation and role-scoped transaction monitoring.' },
    { name: 'Retailer Settlements', description: 'Retailer beneficiary management, Pay-Out holds, and settlement limit requests.' },
  ],
  paths: {
    ...configurationPaths,
    [`${env.API_PREFIX}/settlements/overview`]: { get: { operationId:'getRetailerSettlementOverview',tags:['Retailer Settlements'],summary:'Get Retailer settlement overview',security:bearer,responses:{...success('Settlement overview returned.',{type:'object'}),...protectedErrors} } },
    [`${env.API_PREFIX}/settlements/beneficiaries`]: {
      get:{operationId:'listSettlementBeneficiaries',tags:['Retailer Settlements'],summary:'List the authenticated Retailer bank beneficiaries',security:bearer,responses:{...success('Beneficiaries returned.',{type:'array',items:{type:'object'}}),...protectedErrors}},
      post:{operationId:'registerSettlementBeneficiary',tags:['Retailer Settlements'],summary:'Register a validated beneficiary bank',security:bearer,requestBody:{required:true,content:json({type:'object'})},responses:{...success('Beneficiary registered.',{type:'object'},201),...protectedErrors,'409':error('Beneficiary already exists.')}}
    },
    [`${env.API_PREFIX}/settlements/beneficiaries/validate`]: { post:{operationId:'validateSettlementBeneficiary',tags:['Retailer Settlements'],summary:'Validate beneficiary field formats before registration',description:'This endpoint does not claim provider ownership verification. It reports provider verification as pending until a payout provider is integrated.',security:bearer,requestBody:{required:true,content:json({type:'object'})},responses:{...success('Beneficiary fields validated.',{type:'object'}),...protectedErrors}} },
    [`${env.API_PREFIX}/settlements/beneficiaries/{id}`]: { delete:{operationId:'deleteSettlementBeneficiary',tags:['Retailer Settlements'],summary:'Soft-delete a Retailer beneficiary',security:bearer,parameters:[idParameter],responses:{...success('Beneficiary deleted.',{type:'object'}),...protectedErrors,'404':error('Beneficiary was not found.'),'409':error('Beneficiary has a pending settlement.')}} },
    [`${env.API_PREFIX}/settlements/payouts`]: { post:{operationId:'createRetailerPayout',tags:['Retailer Settlements'],summary:'Create a pending Pay-Out and hold wallet funds',description:'Atomically validates available balance, resolves the configured flat charge, applies GST, creates the transaction and ledger records, and holds the total debit. Provider execution remains NOT_SUBMITTED until the payout integration is enabled.',security:bearer,requestBody:{required:true,content:json({type:'object',required:['beneficiaryId','amount','mode','idempotencyKey'],properties:{beneficiaryId:{type:'string',format:'uuid'},amount:{type:'number',exclusiveMinimum:0},mode:{type:'string',enum:['IMPS','NEFT','RTGS','UPI']},idempotencyKey:{type:'string'}}})},responses:{...success('Pending Pay-Out created and funds held.',{type:'object'},201),...protectedErrors,'409':error('Wallet is unavailable.'),'422':error('Insufficient balance, invalid beneficiary, or missing charge rule.')}} },
    [`${env.API_PREFIX}/settlements/limit-requests`]: { post:{operationId:'requestSettlementLimitUpgrade',tags:['Retailer Settlements'],summary:'Submit a settlement limit upgrade request',security:bearer,requestBody:{required:true,content:json({type:'object',required:['requestedLimit','reason']})},responses:{...success('Limit request submitted.',{type:'object'},201),...protectedErrors,'409':error('A request is already pending.')}} },
    [`${env.API_PREFIX}/transactions`]: { get: { operationId: 'listTransactions', tags: ['Transactions'], summary: 'List role-scoped transactions', security: bearer, description: 'Admin sees platform transactions; Retailers are always restricted to their authenticated party.', parameters: [{name:'type',in:'query',schema:{type:'string',enum:['ALL','PAY_IN','PAY_OUT']}},{name:'status',in:'query',schema:{type:'string'}},{name:'searchQuery',in:'query',schema:{type:'string'}},{name:'dateRange',in:'query',schema:{type:'string'}},{name:'page',in:'query',schema:{type:'integer',minimum:1}},{name:'pageSize',in:'query',schema:{type:'integer',minimum:1,maximum:100}}], responses: { ...success('Transactions returned.', {type:'object'}), ...protectedErrors } } },
    [`${env.API_PREFIX}/transactions/payin/request`]: { post: { operationId: 'createPayIn', tags: ['Transactions'], summary: 'Create a Retailer Pay-In transaction', security: bearer, description: 'Creates a PENDING transaction and immutable calculation snapshot. It does not fabricate provider success or credit a wallet before gateway confirmation.', requestBody:{required:true,content:json({type:'object',required:['customerName','customerMobile','serviceCategoryId','paymentGatewayId','paymentMethodId','paymentOptionId','amount','idempotencyKey'],properties:{customerName:{type:'string',minLength:2},customerMobile:{type:'string',pattern:'^[6-9]\\d{9}$'},serviceCategoryId:{type:'string',format:'uuid'},serviceProductId:{type:['string','null'],format:'uuid'},paymentGatewayId:{type:'string',format:'uuid'},paymentMethodId:{type:'string',format:'uuid'},paymentOptionId:{type:'string',format:'uuid'},amount:{type:'number',minimum:10,maximum:2000000},remarks:{type:'string',maxLength:500},idempotencyKey:{type:'string',minLength:8,maxLength:100}}})},responses:{...success('Pay-In transaction created.',{type:'object'},201),...protectedErrors,'409':error('Duplicate Pay-In request.'),'422':error('Invalid payment route, category, product, or amount.')}} },
    [`${env.API_PREFIX}/transactions/{id}`]: { get: { operationId:'getTransaction',tags:['Transactions'],summary:'Get a role-scoped transaction',security:bearer,parameters:[idParameter],responses:{...success('Transaction returned.',{type:'object'}),...protectedErrors,'404':error('Transaction was not found.')} } },
    [`${env.API_PREFIX}/top-up-requests`]: {
      get: { operationId: 'listTopUpRequests', tags: ['Wallet Top-Ups'], summary: 'List visible top-up requests', security: bearer, description: 'Retailers receive only their own requests. Admin roles receive the review queue.', parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['ALL', 'PENDING', 'APPROVED', 'REJECTED'] } }, { name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } }], responses: { ...success('Top-up requests returned.', { type: 'object' }), ...protectedErrors } },
      post: { operationId: 'createTopUpRequest', tags: ['Wallet Top-Ups'], summary: 'Submit Retailer top-up proof', security: bearer, requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['amount', 'paymentMode', 'paymentReference', 'proof'], properties: { amount: { type: 'number', minimum: 100 }, paymentMode: { type: 'string', enum: ['BANK_TRANSFER', 'UPI', 'QR'] }, paymentReference: { type: 'string', minLength: 4, maxLength: 100 }, remarks: { type: 'string', maxLength: 500 }, proof: { type: 'string', format: 'binary', description: 'PDF, JPEG, or PNG; maximum 5 MB.' } } } } } }, responses: { ...success('Top-up request created.', { type: 'object' }, 201), ...protectedErrors, '409': error('Payment reference was already submitted.') } },
    },
    [`${env.API_PREFIX}/top-up-requests/{id}`]: { get: { operationId: 'getTopUpRequest', tags: ['Wallet Top-Ups'], summary: 'Get top-up request details', security: bearer, parameters: [idParameter], responses: { ...success('Top-up request returned.', { type: 'object' }), ...protectedErrors, '404': error('Top-up request was not found.') } } },
    [`${env.API_PREFIX}/top-up-requests/{id}/proof`]: { get: { operationId: 'getTopUpProof', tags: ['Wallet Top-Ups'], summary: 'Open payment proof', security: bearer, parameters: [idParameter], responses: { '200': { description: 'Payment proof binary.', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } }, 'image/jpeg': { schema: { type: 'string', format: 'binary' } }, 'image/png': { schema: { type: 'string', format: 'binary' } } } }, ...protectedErrors, '404': error('Proof was not found.') } } },
    [`${env.API_PREFIX}/top-up-requests/{id}/review`]: { post: { operationId: 'reviewTopUpRequest', tags: ['Wallet Top-Ups'], summary: 'Approve or reject a pending top-up', security: bearer, description: 'Admin-only. Approval credits the wallet and creates the ledger entry in the same transaction.', parameters: [idParameter], requestBody: { required: true, content: json({ type: 'object', required: ['decision', 'remarks'], properties: { decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] }, remarks: { type: 'string', minLength: 3, maxLength: 1000 } } }) }, responses: { ...success('Top-up reviewed.', { type: 'object' }), ...protectedErrors, '404': error('Top-up request was not found.'), '409': error('Top-up request was already reviewed.') } } },
    [`${env.API_PREFIX}/configuration/payment-routing-options`]: {
      get: {
        operationId: 'getPaymentRoutingOptions', tags: ['Configuration'], summary: 'Get active Pay-In routing selections', security: bearer,
        description: 'Returns only active gateways, gateway-method mappings, methods, and method options required by transactional screens. It does not expose inactive or administrative configuration.',
        responses: { ...success('Active payment routing options returned.', ref('PaymentRoutingOptions')), ...protectedErrors },
      },
    },
    '/health/live': {
      get: {
        operationId: 'getLiveness', tags: ['Health'], summary: 'Check process liveness',
        description: 'Public probe confirming that the HTTP process is running. It does not test MySQL.',
        responses: { ...success('Process is live.', ref('LiveStatus')), '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' } },
      },
    },
    '/health/ready': {
      get: {
        operationId: 'getReadiness', tags: ['Health'], summary: 'Check database readiness',
        description: 'Public readiness probe that runs a lightweight MySQL query.',
        responses: { ...success('API and database are ready.', ref('ReadyStatus')), '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' } },
      },
    },
    [`${env.API_PREFIX}/auth/login`]: {
      post: {
        operationId: 'login', tags: ['Authentication'], summary: 'Authenticate a user',
        description: 'Validates credentials and returns a short-lived JWT access token plus a rotating refresh token. Repeated failures can temporarily lock the account.',
        requestBody: { required: true, content: json(ref('LoginRequest'), { identifier: 'admin@qinstarpay.com', password: 'ExamplePassword123!' }) },
        responses: {
          ...success('Authentication succeeded.', ref('LoginResult')),
          '401': error('Credentials are invalid.'), '403': error('Account is not active.'), '422': { $ref: '#/components/responses/ValidationError' },
          '423': error('Account is temporarily locked.'), '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    [`${env.API_PREFIX}/auth/refresh`]: {
      post: {
        operationId: 'refreshAccessToken', tags: ['Authentication'], summary: 'Rotate a refresh token',
        description: 'Consumes a valid refresh token and returns a new access/refresh pair. A consumed or revoked refresh token cannot be reused.',
        requestBody: { required: true, content: json(ref('RefreshTokenRequest')) },
        responses: { ...success('Token pair rotated.', ref('TokenPair')), '401': error('Refresh token is invalid, expired, revoked, or reused.'), '422': { $ref: '#/components/responses/ValidationError' }, '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' } },
      },
    },
    [`${env.API_PREFIX}/auth/logout`]: {
      post: {
        operationId: 'logout', tags: ['Authentication'], summary: 'Revoke a refresh token', security: bearer,
        description: 'Requires an access token and revokes the submitted refresh token.',
        requestBody: { required: true, content: json(ref('RefreshTokenRequest')) },
        responses: { ...success('Refresh token revoked.', ref('LogoutResult')), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/auth/me`]: {
      get: {
        operationId: 'getCurrentUser', tags: ['Authentication'], summary: 'Get current token identity', security: bearer,
        description: 'Returns the authenticated identity embedded in the verified access token.',
        responses: { ...success('Current identity returned.', ref('AuthenticatedUser')), '401': { $ref: '#/components/responses/Unauthorized' }, '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' } },
      },
    },
    [`${env.API_PREFIX}/parties`]: {
      get: {
        operationId: 'listParties', tags: ['Parties'], summary: 'List hierarchy parties', security: bearer,
        description: 'Requires PARTY_READ. Returns filtered parties ordered by newest first. Current implementation does not apply additional tenant hierarchy scoping.',
        parameters: [
          { name: 'type', in: 'query', description: 'Filter by party type.', schema: ref('PartyType') },
          { name: 'parentPartyId', in: 'query', description: 'Filter by direct parent UUID.', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', description: 'Filter by account status.', schema: ref('AccountStatus') },
          { name: 'approvalStatus', in: 'query', description: 'Filter by approval status.', schema: ref('ApprovalStatus') },
          { name: 'search', in: 'query', description: 'Search code, display name, email, or mobile; maximum 100 characters.', schema: { type: 'string', maxLength: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
        ],
        responses: { ...success('Paginated party list returned.', ref('PartyPage')), ...protectedErrors },
      },
      post: {
        operationId: 'createParty', tags: ['Parties'], summary: 'Create a hierarchy party', security: bearer,
        description: 'Requires PARTY_CREATE. Distributors require an active Master Distributor parent; Retailers require an active Distributor parent. New parties await approval.',
        requestBody: { required: true, content: json(ref('CreatePartyRequest'), { partyType: 'RETAILER', code: 'RET-0001', displayName: 'Example Retail Point', email: 'retailer@example.com', mobile: '9876543210', parentPartyId: '550e8400-e29b-41d4-a716-446655440000' }) },
        responses: { ...success('Party created.', ref('Party'), 201), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/parties/{id}`]: {
      get: {
        operationId: 'getParty', tags: ['Parties'], summary: 'Get party details', security: bearer,
        description: 'Requires PARTY_READ.', parameters: [idParameter],
        responses: { ...success('Party returned.', ref('Party')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    [`${env.API_PREFIX}/parties/{id}/status`]: {
      patch: {
        operationId: 'updatePartyStatus', tags: ['Parties'], summary: 'Change party account status', security: bearer,
        description: 'Requires PARTY_STATUS_UPDATE. Uses optimistic concurrency; submit the latest party version and an audit reason.', parameters: [idParameter],
        requestBody: { required: true, content: json(ref('UpdatePartyStatusRequest'), { accountStatus: 'SUSPENDED', reason: 'Compliance review required', version: 1 }) },
        responses: { ...success('Party status updated.', ref('Party')), ...protectedErrors, '409': { $ref: '#/components/responses/Conflict' } },
      },
    },
    [`${env.API_PREFIX}/parties/{id}/review`]: {
      post: {
        operationId: 'reviewParty', tags: ['Parties'], summary: 'Approve or reject a pending party', security: bearer,
        description: 'Requires PARTY_APPROVE. Only a PENDING_APPROVAL party at the submitted version can be reviewed.', parameters: [idParameter],
        requestBody: { required: true, content: json(ref('ReviewPartyRequest'), { decision: 'APPROVED', remarks: 'KYC and hierarchy checks completed', version: 1 }) },
        responses: { ...success('Party review recorded.', ref('Party')), ...protectedErrors, '409': { $ref: '#/components/responses/Conflict' } },
      },
    },
    [`${env.API_PREFIX}/master-data/{category}`]: {
      get: {
        operationId: 'listMasterData', tags: ['Master Data'], summary: 'List master-data items', security: bearer,
        description: 'Requires MASTER_DATA_READ. Items are ordered by sort order and label.',
        parameters: [ref('CategoryParameter'), { name: 'includeInactive', in: 'query', description: 'Include inactive records.', schema: { type: 'boolean', default: false } }],
        responses: { ...success('Master-data items returned.', { type: 'array', items: ref('MasterDataItem') }), ...protectedErrors },
      },
      post: {
        operationId: 'createMasterData', tags: ['Master Data'], summary: 'Create a master-data item', security: bearer,
        description: 'Requires MASTER_DATA_WRITE.', parameters: [ref('CategoryParameter')],
        requestBody: { required: true, content: json(ref('CreateMasterDataRequest'), { code: 'IMPS', label: 'IMPS', description: 'Immediate Payment Service', sortOrder: 10, isActive: true }) },
        responses: { ...success('Master-data item created.', ref('MasterDataItem'), 201), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/auth/change-password`]: {
      post: {
        operationId: 'changePassword', tags: ['Authentication'], summary: 'Replace the current or temporary password', security: bearer,
        description: 'Changes the password, revokes every existing refresh token, and returns a fresh token pair.',
        requestBody: { required: true, content: json(ref('ChangePasswordRequest')) },
        responses: { ...success('Password changed.', ref('TokenPair')), ...protectedErrors, '422': { $ref: '#/components/responses/ValidationError' } },
      },
    },
    [`${env.API_PREFIX}/roles/permissions`]: {
      get: { operationId: 'listPermissions', tags: ['Roles'], summary: 'List assignable permissions', security: bearer,
        description: 'Requires ROLE_READ.', responses: { ...success('Permissions returned.', { type: 'array', items: ref('Permission') }), ...protectedErrors } },
    },
    [`${env.API_PREFIX}/roles`]: {
      get: { operationId: 'listRoles', tags: ['Roles'], summary: 'List roles', security: bearer, description: 'Requires ROLE_READ.',
        parameters: [{ name: 'category', in: 'query', schema: ref('RoleCategory') }, { name: 'includeInactive', in: 'query', schema: { type: 'boolean', default: false } }],
        responses: { ...success('Roles returned.', { type: 'array', items: ref('Role') }), ...protectedErrors } },
      post: { operationId: 'createEmployeeRole', tags: ['Roles'], summary: 'Create an employee role', security: bearer,
        description: 'Requires ROLE_CREATE. Admin-created roles are always employee roles.', requestBody: { required: true, content: json(ref('CreateRoleRequest')) },
        responses: { ...success('Employee role created.', ref('Role'), 201), ...protectedErrors } },
    },
    [`${env.API_PREFIX}/roles/{id}`]: {
      patch: { operationId: 'updateEmployeeRole', tags: ['Roles'], summary: 'Update an employee role', security: bearer,
        description: 'Requires ROLE_UPDATE. System and network roles are protected.', parameters: [{ ...idParameter, description: 'Numeric role ID.', schema: { type: 'integer', minimum: 1 } }],
        requestBody: { required: true, content: json(ref('UpdateRoleRequest')) }, responses: { ...success('Employee role updated.', ref('Role')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' }, '409': { $ref: '#/components/responses/Conflict' } } },
    },
    [`${env.API_PREFIX}/employees`]: {
      get: { operationId: 'listEmployees', tags: ['Employees'], summary: 'List employees', security: bearer, description: 'Requires EMPLOYEE_READ.',
        parameters: [{ name: 'search', in: 'query', schema: { type: 'string', maxLength: 100 } }, { name: 'departmentCode', in: 'query', schema: { type: 'string' } }, { name: 'roleId', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'] } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }],
        responses: { ...success('Employee page returned.', ref('EmployeePage')), ...protectedErrors } },
      post: { operationId: 'createEmployee', tags: ['Employees'], summary: 'Create an employee account', security: bearer,
        description: 'Requires EMPLOYEE_CREATE. User, employee profile, employee role assignment, and audit event are committed atomically.',
        requestBody: { required: true, content: json(ref('CreateEmployeeRequest')) }, responses: { ...success('Employee created.', ref('Employee'), 201), ...protectedErrors, '409': { $ref: '#/components/responses/Conflict' } } },
    },
    [`${env.API_PREFIX}/employees/meta`]: {
      get: { operationId: 'getEmployeeMeta', tags: ['Employees'], summary: 'List employee departments and roles', security: bearer, description: 'Requires EMPLOYEE_READ.', responses: { ...success('Employee metadata returned.', ref('EmployeeMeta')), ...protectedErrors } },
    },
    [`${env.API_PREFIX}/employees/{id}`]: {
      get: { operationId: 'getEmployee', tags: ['Employees'], summary: 'Get employee details', security: bearer, description: 'Requires EMPLOYEE_READ.', parameters: [idParameter], responses: { ...success('Employee returned.', ref('Employee')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
      put: { operationId: 'updateEmployee', tags: ['Employees'], summary: 'Update employee details and role', security: bearer, description: 'Requires EMPLOYEE_UPDATE.', parameters: [idParameter], requestBody: { required: true, content: json(ref('UpdateEmployeeRequest')) }, responses: { ...success('Employee updated.', ref('Employee')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' }, '409': { $ref: '#/components/responses/Conflict' } } },
    },
    [`${env.API_PREFIX}/employees/{id}/status`]: {
      patch: { operationId: 'updateEmployeeStatus', tags: ['Employees'], summary: 'Change employee status', security: bearer, description: 'Requires EMPLOYEE_UPDATE.', parameters: [idParameter], requestBody: { required: true, content: json(ref('UpdateEmployeeStatusRequest')) }, responses: { ...success('Employee status updated.', ref('Employee')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
    },
    [`${env.API_PREFIX}/employees/{id}/reset-password`]: {
      post: { operationId: 'resetEmployeePassword', tags: ['Employees'], summary: 'Reset employee password', security: bearer, description: 'Requires EMPLOYEE_UPDATE. Returns a temporary password for secure delivery.', parameters: [idParameter], requestBody: { required: true, content: json(ref('ResetEmployeePasswordRequest')) }, responses: { ...success('Password reset.', { type: 'object', properties: { temporaryPassword: { type: 'string', writeOnly: true } } }), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
    },
    [`${env.API_PREFIX}/master-data/item/{id}`]: {
      patch: {
        operationId: 'updateMasterData', tags: ['Master Data'], summary: 'Update a master-data item', security: bearer,
        description: 'Requires MASTER_DATA_WRITE. versionReason is mandatory, and at least one editable field must also be supplied.', parameters: [idParameter],
        requestBody: { required: true, content: json(ref('UpdateMasterDataRequest'), { label: 'IMPS Transfer', versionReason: 'Clarify display label' }) },
        responses: { ...success('Master-data item updated.', ref('MasterDataItem')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    [`${env.API_PREFIX}/audit-logs`]: {
      get: {
        operationId: 'listAuditLogs', tags: ['Audit Logs'], summary: 'List audit log entries', security: bearer,
        description: 'Requires AUDIT_READ. Returns paginated, filtered audit entries ordered by newest first.',
        parameters: [
          { name: 'actorUserId', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'resourceType', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['SUCCESS', 'FAILURE'] } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
          { name: 'resourceId', in: 'query', schema: { type: 'string' } },
          { name: 'ipAddress', in: 'query', schema: { type: 'string' } },
          { name: 'actorRole', in: 'query', schema: { type: 'string' } },
          { name: 'keyword', in: 'query', schema: { type: 'string', maxLength: 100 } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('Audit log page returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/audit-logs/summary`]: {
      get: {
        operationId: 'getAuditLogSummary', tags: ['Audit Logs'], summary: 'Get audit log summary counts', security: bearer,
        description: 'Requires AUDIT_READ. Returns aggregate counts grouped by action, outcome, and day.',
        responses: { ...success('Audit log summary returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/audit-logs/action-catalog`]: {
      get: {
        operationId: 'getActionCatalog', tags: ['Audit Logs'], summary: 'List audit action types catalog', security: bearer,
        description: 'Requires AUDIT_READ. Returns the static action, resource type, and outcome enum catalog.',
        responses: { ...success('Action catalog returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/audit-logs/{id}`]: {
      get: {
        operationId: 'getAuditLogById', tags: ['Audit Logs'], summary: 'Get single audit log entry', security: bearer,
        description: 'Requires AUDIT_READ.', parameters: [{ ...idParameter, name: 'id', description: 'Audit log entry id.' }],
        responses: { ...success('Audit log entry returned.', { type: 'object' }), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    [`${env.API_PREFIX}/audit-logs/export.csv`]: {
      get: {
        operationId: 'exportAuditLogsCsv', tags: ['Audit Logs'], summary: 'Export audit logs as CSV', security: bearer,
        description: 'Requires AUDIT_READ and EXPORT_CSV. Streams CSV content for the filtered result set.',
        parameters: [
          { name: 'actorUserId', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'resourceType', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['SUCCESS', 'FAILURE'] } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
          { name: 'keyword', in: 'query', schema: { type: 'string', maxLength: 100 } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/login-history`]: {
      get: {
        operationId: 'listLoginHistory', tags: ['Login History'], summary: 'List login event history', security: bearer,
        description: 'Returns paginated, filtered login events.',
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'result', in: 'query', schema: { type: 'array', items: { type: 'string', enum: ['SUCCESS', 'FAILED', 'LOCKED', 'LOGGED_OUT', 'REFRESH'] } } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
          { name: 'ip', in: 'query', schema: { type: 'string' } },
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('Login history page returned.', ref('LoginHistoryPage')), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/login-history/summary`]: {
      get: {
        operationId: 'getLoginHistorySummary', tags: ['Login History'], summary: 'Get login event summary counts', security: bearer,
        description: 'Returns aggregate login counts grouped by result type and day.',
        responses: { ...success('Login history summary returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/login-history/{id}`]: {
      get: {
        operationId: 'getLoginHistoryById', tags: ['Login History'], summary: 'Get single login event', security: bearer,
        description: 'Retrieve detailed login event.', parameters: [{ ...idParameter, name: 'id', description: 'Login history event id.' }],
        responses: { ...success('Login event returned.', ref('LoginHistoryItem')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    [`${env.API_PREFIX}/login-history/session/{sessionId}/location`]: {
      patch: {
        operationId: 'updateLoginSessionLocation', tags: ['Login History'], summary: 'Complete asynchronous login geolocation', security: bearer,
        description: 'Updates the authenticated user\'s exact login-history record after the browser permission decision completes. Canonical audit rows remain immutable; Audit Logs exposes the final location through a session-linked read projection.',
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: { type: 'string', minLength: 1 } }],
        requestBody: { required: true, content: json(ref('LoginLocationUpdateRequest')) },
        responses: { ...success('Login location updated.', ref('LoginHistoryItem')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    [`${env.API_PREFIX}/login-history/export.csv`]: {
      get: {
        operationId: 'exportLoginHistoryCsv', tags: ['Login History'], summary: 'Export login history as CSV', security: bearer,
        description: 'Streams CSV. Requires EXPORT_CSV permission to export other users; own user always allowed.',
        parameters: [
          { name: 'userId', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'result', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
          { name: 'ip', in: 'query', schema: { type: 'string' } },
          { name: 'keyword', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/reports/transactions`]: {
      get: {
        operationId: 'getTransactionsReport', tags: ['Reports'], summary: 'Get transactions report', security: bearer,
        description: 'Requires REPORT_TRANSACTIONS_READ. Paginated transactions with summary aggregates.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'service', in: 'query', schema: { type: 'string' } },
          { name: 'transactionStatus', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('Transactions report returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/reports/transactions/export.csv`]: {
      get: {
        operationId: 'exportTransactionsCsv', tags: ['Reports'], summary: 'Export transactions report CSV', security: bearer,
        description: 'Requires REPORT_TRANSACTIONS_READ + EXPORT_CSV.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'service', in: 'query', schema: { type: 'string' } },
          { name: 'transactionStatus', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/reports/ledger`]: {
      get: {
        operationId: 'getLedgerReport', tags: ['Reports'], summary: 'Get ledger entries report', security: bearer,
        description: 'Requires REPORT_LEDGER_READ.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('Ledger report returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/reports/ledger/export.csv`]: {
      get: {
        operationId: 'exportLedgerCsv', tags: ['Reports'], summary: 'Export ledger report CSV', security: bearer,
        description: 'Requires REPORT_LEDGER_READ + EXPORT_CSV.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/reports/settlements`]: {
      get: {
        operationId: 'getSettlementReport', tags: ['Reports'], summary: 'Get settlements report', security: bearer,
        description: 'Requires REPORT_SETTLEMENTS_READ.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'settlementCycle', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('Settlements report returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/reports/settlements/export.csv`]: {
      get: {
        operationId: 'exportSettlementCsv', tags: ['Reports'], summary: 'Export settlements report CSV', security: bearer,
        description: 'Requires REPORT_SETTLEMENTS_READ + EXPORT_CSV.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'settlementCycle', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/reports/balance`]: {
      get: {
        operationId: 'getBalanceReport', tags: ['Reports'], summary: 'Get wallet balance report', security: bearer,
        description: 'Requires REPORT_BALANCE_READ. Wallets snapshot grouped by party.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('Balance report returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/reports/balance/export.csv`]: {
      get: {
        operationId: 'exportBalanceCsv', tags: ['Reports'], summary: 'Export balance report CSV', security: bearer,
        description: 'Requires REPORT_BALANCE_READ + EXPORT_CSV.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/reports/chargebacks`]: {
      get: {
        operationId: 'getChargebackReport', tags: ['Reports'], summary: 'Get chargebacks report', security: bearer,
        description: 'Requires REPORT_CHARGEBACKS_READ.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'chargebackStatus', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('Chargebacks report returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/reports/chargebacks/export.csv`]: {
      get: {
        operationId: 'exportChargebackCsv', tags: ['Reports'], summary: 'Export chargebacks report CSV', security: bearer,
        description: 'Requires REPORT_CHARGEBACKS_READ + EXPORT_CSV.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'role', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'chargebackStatus', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/reports/api-performance`]: {
      get: {
        operationId: 'getApiPerformanceReport', tags: ['Reports'], summary: 'Get API performance report', security: bearer,
        description: 'Requires REPORT_API_PERFORMANCE_READ. Daily route × status_class aggregate stats from api_request_logs.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'status', in: 'query', schema: { type: 'string', description: 'status_class filter: 2XX / 4XX / 5XX' } },
          { name: 'service', in: 'query', schema: { type: 'string', description: 'Route template substring match (e.g. /transactions)' } },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 20 } },
        ],
        responses: { ...success('API performance report returned.', { type: 'object' }), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/reports/api-performance/export.csv`]: {
      get: {
        operationId: 'exportApiPerformanceCsv', tags: ['Reports'], summary: 'Export API performance CSV', security: bearer,
        description: 'Requires REPORT_API_PERFORMANCE_READ + EXPORT_CSV.',
        parameters: [
          { name: 'startDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'endDate', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'status', in: 'query', schema: { type: 'string' } },
          { name: 'service', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'CSV file streamed.', content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } } },
          ...protectedErrors,
        },
      },
    },
    [`${env.API_PREFIX}/headlines`]: {
      get: {
        operationId: 'listHeadlinesAndTickers', tags: ['Headlines & Tickers'], summary: 'List dynamic communication content', security: bearer,
        description: 'Returns persisted headlines, notice-board items, or scrolling tickers. Empty categories return an empty array; no hidden default content is injected.',
        parameters: [{ name: 'category', in: 'query', schema: ref('HeadlineCategory'), description: 'Optional content-category filter.' }],
        responses: { ...success('Communication content returned.', { type: 'array', items: ref('HeadlineContent') }), '401': { $ref: '#/components/responses/Unauthorized' }, '422': { $ref: '#/components/responses/ValidationError' }, '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' } },
      },
      post: {
        operationId: 'createHeadlineOrTicker', tags: ['Headlines & Tickers'], summary: 'Publish communication content', security: bearer,
        description: 'Requires MASTER_DATA_WRITE. TICKER speed and targetAudience control the downline scrolling banner.',
        requestBody: { required: true, content: json(ref('HeadlineContentRequest'), { category: 'TICKER', title: 'Service update', message: 'Instant settlement services are operating normally.', speed: 'Normal', targetAudience: 'Retailers Only', isActive: true }) },
        responses: { ...success('Content published.', ref('HeadlineContent'), 201), ...protectedErrors },
      },
    },
    [`${env.API_PREFIX}/headlines/{id}`]: {
      patch: {
        operationId: 'updateHeadlineOrTicker', tags: ['Headlines & Tickers'], summary: 'Update communication content', security: bearer,
        description: 'Requires MASTER_DATA_WRITE. Only supplied fields are changed.', parameters: [idParameter],
        requestBody: { required: true, content: json(ref('HeadlineContentUpdateRequest')) },
        responses: { ...success('Content updated.', ref('HeadlineContent')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
      delete: {
        operationId: 'deleteHeadlineOrTicker', tags: ['Headlines & Tickers'], summary: 'Delete communication content', security: bearer,
        description: 'Requires MASTER_DATA_WRITE. Deleted ticker text immediately disappears on the next client refresh.', parameters: [idParameter],
        responses: { ...success('Content deleted.', { type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean', const: true } } }), '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '422': { $ref: '#/components/responses/ValidationError' }, '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' } },
      },
    },
    [`${env.API_PREFIX}/headlines/{id}/status`]: {
      patch: {
        operationId: 'toggleHeadlineOrTickerStatus', tags: ['Headlines & Tickers'], summary: 'Toggle content active status', security: bearer,
        description: 'Requires MASTER_DATA_WRITE. Active ticker records are displayed according to their target audience.', parameters: [idParameter],
        responses: { ...success('Content status toggled.', { type: 'object', required: ['id', 'isActive'], properties: { id: { type: 'string', format: 'uuid' }, isActive: { type: 'boolean' } } }), '401': { $ref: '#/components/responses/Unauthorized' }, '403': { $ref: '#/components/responses/Forbidden' }, '404': { $ref: '#/components/responses/NotFound' }, '422': { $ref: '#/components/responses/ValidationError' }, '429': { $ref: '#/components/responses/RateLimited' }, '500': { $ref: '#/components/responses/InternalError' } },
      },
    },
    [`${env.API_PREFIX}/service-categories`]: {
      get: { operationId: 'listServiceCategories', tags: ['Service Catalogue'], summary: 'List service categories and products', security: bearer, parameters: [{ name: 'activeOnly', in: 'query', schema: { type: 'boolean', default: false } }], responses: { ...success('Service catalogue returned.', { type: 'array', items: ref('ServiceCategory') }), ...protectedErrors } },
      post: { operationId: 'createServiceCategory', tags: ['Service Catalogue'], summary: 'Create a service category', security: bearer, description: 'Requires MASTER_DATA_WRITE.', requestBody: { required: true, content: json(ref('ServiceCategoryInput')) }, responses: { ...success('Service category created.', ref('ServiceCategory'), 201), ...protectedErrors, '409': { $ref: '#/components/responses/Conflict' } } },
    },
    [`${env.API_PREFIX}/service-categories/{id}`]: {
      put: { operationId: 'updateServiceCategory', tags: ['Service Catalogue'], summary: 'Update a service category', security: bearer, parameters: [idParameter], requestBody: { required: true, content: json(ref('ServiceCategoryInput')) }, responses: { ...success('Service category updated.', ref('ServiceCategory')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
      delete: { operationId: 'deleteServiceCategory', tags: ['Service Catalogue'], summary: 'Delete a category and its products', security: bearer, parameters: [idParameter], responses: { ...success('Service category deleted.', { type: 'object', properties: { deleted: { type: 'boolean' } } }), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
    },
    [`${env.API_PREFIX}/service-categories/{id}/status`]: {
      patch: { operationId: 'setServiceCategoryStatus', tags: ['Service Catalogue'], summary: 'Activate or deactivate a category', security: bearer, parameters: [idParameter], requestBody: { required: true, content: json(ref('CatalogueStatusInput')) }, responses: { ...success('Service category status updated.', ref('ServiceCategory')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
    },
    [`${env.API_PREFIX}/service-categories/{id}/products`]: {
      post: { operationId: 'createServiceProduct', tags: ['Service Catalogue'], summary: 'Create a product in a category', security: bearer, parameters: [idParameter], requestBody: { required: true, content: json(ref('ServiceProductInput')) }, responses: { ...success('Service product created.', ref('ServiceCategory'), 201), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' }, '409': { $ref: '#/components/responses/Conflict' } } },
    },
    [`${env.API_PREFIX}/service-categories/{id}/products/{productId}`]: {
      put: { operationId: 'updateServiceProduct', tags: ['Service Catalogue'], summary: 'Update a service product', security: bearer, parameters: [idParameter, { ...idParameter, name: 'productId', description: 'Service product UUID.' }], requestBody: { required: true, content: json(ref('ServiceProductInput')) }, responses: { ...success('Service product updated.', ref('ServiceCategory')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
      delete: { operationId: 'deleteServiceProduct', tags: ['Service Catalogue'], summary: 'Delete a service product', security: bearer, parameters: [idParameter, { ...idParameter, name: 'productId', description: 'Service product UUID.' }], responses: { ...success('Service product deleted.', ref('ServiceCategory')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
    },
    [`${env.API_PREFIX}/service-categories/{id}/products/{productId}/status`]: {
      patch: { operationId: 'setServiceProductStatus', tags: ['Service Catalogue'], summary: 'Activate or deactivate a product', security: bearer, parameters: [idParameter, { ...idParameter, name: 'productId', description: 'Service product UUID.' }], requestBody: { required: true, content: json(ref('CatalogueStatusInput')) }, responses: { ...success('Service product status updated.', ref('ServiceCategory')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } } },
    },
    [`${env.API_PREFIX}/payout-charge-rules`]: {
      get: {
        operationId: 'listPayoutChargeRules', tags: ['Payout Charges'], summary: 'List active payout charge rules', security: bearer,
        responses: { ...success('Payout charge rules returned.', { type: 'array', items: ref('PayoutChargeRule') }), ...protectedErrors },
      },
      post: {
        operationId: 'createPayoutChargeRule', tags: ['Payout Charges'], summary: 'Create a payout charge rule', security: bearer,
        description: 'Requires MASTER_DATA_WRITE. Active ranges for the same payout mode cannot overlap.',
        requestBody: { required: true, content: json(ref('PayoutChargeRuleInput')) },
        responses: { ...success('Payout charge rule created.', ref('PayoutChargeRule'), 201), ...protectedErrors, '409': { $ref: '#/components/responses/Conflict' } },
      },
    },
    [`${env.API_PREFIX}/payout-charge-rules/resolve`]: {
      get: {
        operationId: 'resolvePayoutCharge', tags: ['Payout Charges'], summary: 'Resolve the flat charge for a settlement', security: bearer,
        parameters: [
          { name: 'payoutMode', in: 'query', required: true, schema: ref('PayoutMode') },
          { name: 'amount', in: 'query', required: true, schema: { type: 'number', exclusiveMinimum: 0 } },
        ],
        responses: { ...success('Matching payout charge returned.', ref('PayoutChargeResolution')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
    [`${env.API_PREFIX}/payout-charge-rules/{id}`]: {
      get: {
        operationId: 'getPayoutChargeRule', tags: ['Payout Charges'], summary: 'Get a payout charge rule', security: bearer, parameters: [idParameter],
        responses: { ...success('Payout charge rule returned.', ref('PayoutChargeRule')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
      put: {
        operationId: 'updatePayoutChargeRule', tags: ['Payout Charges'], summary: 'Update a payout charge rule', security: bearer, parameters: [idParameter],
        description: 'Requires MASTER_DATA_WRITE and the latest optimistic-lock version.',
        requestBody: { required: true, content: json(ref('UpdatePayoutChargeRuleInput')) },
        responses: { ...success('Payout charge rule updated.', ref('PayoutChargeRule')), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' }, '409': { $ref: '#/components/responses/Conflict' } },
      },
      delete: {
        operationId: 'deletePayoutChargeRule', tags: ['Payout Charges'], summary: 'Deactivate a payout charge rule', security: bearer, parameters: [idParameter],
        description: 'Requires MASTER_DATA_WRITE. Rules are soft-deleted to preserve history.',
        responses: { ...success('Payout charge rule deleted.', { type: 'object', required: ['deleted'], properties: { deleted: { type: 'boolean', const: true } } }), ...protectedErrors, '404': { $ref: '#/components/responses/NotFound' } },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Paste the access token returned by the login endpoint.' } },
    parameters: {
      CategoryParameter: { name: 'category', in: 'path', required: true, description: 'Uppercase master-data category (2–50 characters).', schema: { type: 'string', minLength: 2, maxLength: 50, pattern: '^[A-Z0-9_]+$' }, example: 'PAYMENT_MODE' },
    },
    responses: {
      Unauthorized: error('Bearer token is missing, invalid, or expired.'), Forbidden: error('Authenticated user lacks the required permission.'),
      ValidationError: error('Path, query, or body validation failed.'), NotFound: error('Requested resource was not found.'),
      Conflict: error('Resource version or state conflicts with the request.'), RateLimited: error('Request rate limit exceeded.'), InternalError: error('Unexpected server or database failure.'),
    },
    schemas: {
      SuccessEnvelope: { type: 'object', required: ['success', 'data', 'timestamp', 'requestId'], properties: { success: { type: 'boolean', const: true }, data: {}, timestamp: { type: 'string', format: 'date-time' }, requestId: { type: 'string', description: 'Server-generated UUID or a validated client-supplied X-Request-ID.' } } },
      CatalogueStatusInput: { type: 'object', required: ['status'], properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } } },
      PaymentRoutingOptions: { type: 'object', required: ['gateways', 'methods', 'options', 'mappings'], properties: { gateways: { type: 'array', items: { type: 'object', required: ['id', 'gatewayName'], properties: { id: { type: 'string', format: 'uuid' }, gatewayName: { type: 'string' } } } }, methods: { type: 'array', items: { type: 'object', required: ['id', 'methodName', 'methodCode'], properties: { id: { type: 'string', format: 'uuid' }, methodName: { type: 'string' }, methodCode: { type: 'string' } } } }, options: { type: 'array', items: { type: 'object', required: ['id', 'methodId', 'optionName', 'optionCode'], properties: { id: { type: 'string', format: 'uuid' }, methodId: { type: 'string', format: 'uuid' }, optionName: { type: 'string' }, optionCode: { type: 'string' } } } }, mappings: { type: 'array', items: { type: 'object', required: ['id', 'gatewayId', 'methodId'], properties: { id: { type: 'string', format: 'uuid' }, gatewayId: { type: 'string', format: 'uuid' }, methodId: { type: 'string', format: 'uuid' } } } } } },
      ServiceProductInput: { type: 'object', required: ['code', 'name', 'price'], properties: { code: { type: 'string', pattern: '^[A-Z0-9_]+$' }, name: { type: 'string' }, description: { type: 'string' }, price: { type: 'number', exclusiveMinimum: 0 }, status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' } } },
      ServiceProduct: { allOf: [ref('ServiceProductInput'), { type: 'object', required: ['id', 'status'], properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] } } }] },
      ServiceCategoryInput: { type: 'object', required: ['code', 'name'], properties: { code: { type: 'string', pattern: '^[A-Z0-9_]+$' }, name: { type: 'string' }, description: { type: 'string' }, pricingMode: { type: 'string', enum: ['BOTH', 'PRESET_ONLY', 'MANUAL_ONLY'], default: 'BOTH' }, status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' } } },
      ServiceCategory: { allOf: [ref('ServiceCategoryInput'), { type: 'object', required: ['id', 'status', 'products'], properties: { id: { type: 'string', format: 'uuid' }, status: { type: 'string', enum: ['ACTIVE', 'INACTIVE'] }, products: { type: 'array', items: ref('ServiceProduct') } } }] },
      ErrorResponse: { type: 'object', required: ['success', 'error', 'timestamp', 'requestId'], properties: { success: { type: 'boolean', const: false }, error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string', example: 'Request validation failed' }, details: { description: 'Additional safe error context; validation failures contain flattened Zod field errors.' } } }, timestamp: { type: 'string', format: 'date-time' }, requestId: { type: 'string', description: 'Server-generated UUID or a validated client-supplied X-Request-ID.' } } },
      LiveStatus: { type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'ok' } } },
      ReadyStatus: { type: 'object', required: ['status', 'database'], properties: { status: { type: 'string', const: 'ready' }, database: { type: 'string', const: 'connected' } } },
      LoginRequest: { type: 'object', required: ['identifier', 'password'], properties: {
        identifier: { type: 'string', minLength: 3, maxLength: 254, description: 'Email, mobile number, or accepted login identifier.' },
        password: { type: 'string', format: 'password', minLength: 4, maxLength: 128, writeOnly: true },
        latitude: { type: 'number', format: 'double', minimum: -90, maximum: 90, description: 'Browser Geolocation latitude (optional, captured on client consent).' },
        longitude: { type: 'number', format: 'double', minimum: -180, maximum: 180, description: 'Browser Geolocation longitude (optional).' },
        locationAccuracy: { type: 'number', format: 'float', minimum: 0, description: 'Geolocation accuracy radius in meters (optional).' },
        locationStatus: { type: 'string', enum: ['GRANTED', 'DENIED', 'TIMEOUT', 'UNSUPPORTED', 'ERROR', 'PENDING', 'UNAVAILABLE'], description: 'Outcome of the browser geolocation request. PENDING is temporary while a browser permission decision is still open.' },
        locationCapturedAt: { type: 'string', format: 'date-time', description: 'ISO timestamp when the location was captured by the browser (optional).' },
      } },
      ChangePasswordRequest: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password', minLength: 4, writeOnly: true }, newPassword: { type: 'string', format: 'password', minLength: 8, writeOnly: true } } },
      RefreshTokenRequest: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string', minLength: 20, writeOnly: true, example: 'eyJ...masked-refresh-token' } } },
      AuthenticatedUser: { type: 'object', required: ['userId', 'partyId', 'email', 'roles', 'permissions', 'mustChangePassword'], properties: { userId: { type: 'string', format: 'uuid' }, partyId: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] }, email: { type: 'string', format: 'email' }, roles: { type: 'array', items: { type: 'string' } }, permissions: { type: 'array', items: { type: 'string' } }, mustChangePassword: { type: 'boolean' }, name: { type: 'string', description: 'Returned by login only.' } } },
      TokenPair: { type: 'object', required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn'], properties: { accessToken: { type: 'string', writeOnly: true, example: 'eyJ...masked-access-token' }, refreshToken: { type: 'string', writeOnly: true, example: 'eyJ...masked-refresh-token' }, tokenType: { type: 'string', const: 'Bearer' }, expiresIn: { type: 'string', example: '15m' } } },
      LoginResult: { allOf: [ref('TokenPair'), { type: 'object', required: ['sessionId', 'user'], properties: { sessionId: { type: 'string', description: 'Opaque session id used to complete asynchronous login geolocation.' }, user: ref('AuthenticatedUser') } }] },
      LoginLocationUpdateRequest: { type: 'object', required: ['locationStatus'], properties: {
        latitude: { type: 'number', format: 'double', minimum: -90, maximum: 90 },
        longitude: { type: 'number', format: 'double', minimum: -180, maximum: 180 },
        locationAccuracy: { type: 'number', format: 'float', minimum: 0, maximum: 100000 },
        locationStatus: { type: 'string', enum: ['GRANTED', 'DENIED', 'TIMEOUT', 'UNSUPPORTED', 'ERROR', 'PENDING', 'UNAVAILABLE'] },
        locationCapturedAt: { type: 'string', format: 'date-time' },
      } },
      LogoutResult: { type: 'object', required: ['loggedOut'], properties: { loggedOut: { type: 'boolean', const: true } } },
      HeadlineCategory: { type: 'string', enum: ['HEADLINE', 'NOTICE_BOARD', 'TICKER'] },
      HeadlineContent: { type: 'object', required: ['id', 'category', 'code', 'title', 'message', 'isActive'], properties: { id: { type: 'string', format: 'uuid' }, category: ref('HeadlineCategory'), code: { type: 'string' }, title: { type: 'string' }, message: { type: 'string' }, configuration: { type: ['object', 'null'], properties: { targetRoles: { type: 'array', items: { type: 'string' } }, speed: { type: 'string', enum: ['Slow', 'Normal', 'Fast'] }, targetAudience: { type: 'string' }, noticeType: { type: 'string' }, publishDate: { type: ['string', 'null'] }, expiryDate: { type: ['string', 'null'] } } }, sortOrder: { type: 'integer' }, isActive: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' } } },
      HeadlineContentRequest: { type: 'object', required: ['title', 'message'], properties: { category: ref('HeadlineCategory'), code: { type: 'string' }, title: { type: 'string', minLength: 2, maxLength: 200 }, message: { type: 'string', minLength: 2, maxLength: 1000 }, targetRoles: { type: 'array', items: { type: 'string' } }, speed: { type: 'string', enum: ['Slow', 'Normal', 'Fast'] }, targetAudience: { type: 'string' }, noticeType: { type: 'string', enum: ['Information', 'Important', 'Urgent Alert'] }, publishDate: { type: 'string' }, expiryDate: { type: 'string' }, sortOrder: { type: 'integer', default: 0 }, isActive: { type: 'boolean', default: true } } },
      HeadlineContentUpdateRequest: { type: 'object', properties: { title: { type: 'string', minLength: 2, maxLength: 200 }, message: { type: 'string', minLength: 2, maxLength: 1000 }, targetRoles: { type: 'array', items: { type: 'string' } }, speed: { type: 'string', enum: ['Slow', 'Normal', 'Fast'] }, targetAudience: { type: 'string' }, noticeType: { type: 'string', enum: ['Information', 'Important', 'Urgent Alert'] }, publishDate: { type: 'string' }, expiryDate: { type: 'string' }, sortOrder: { type: 'integer' }, isActive: { type: 'boolean' } } },
      PayoutMode: { type: 'string', enum: ['IMPS', 'NEFT', 'RTGS', 'UPI'] },
      PayoutChargeRule: { type: 'object', required: ['id', 'payoutMode', 'minAmount', 'maxAmount', 'flatCharge', 'isActive', 'version', 'createdAt', 'updatedAt'], properties: { id: { type: 'string', format: 'uuid' }, payoutMode: ref('PayoutMode'), minAmount: { type: 'number', minimum: 0 }, maxAmount: { type: 'number', exclusiveMinimum: 0 }, flatCharge: { type: 'number', minimum: 0 }, isActive: { type: 'boolean' }, version: { type: 'integer', minimum: 1 }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      PayoutChargeRuleInput: { type: 'object', required: ['payoutMode', 'minAmount', 'maxAmount', 'flatCharge'], properties: { payoutMode: ref('PayoutMode'), minAmount: { type: 'number', minimum: 0 }, maxAmount: { type: 'number', exclusiveMinimum: 0 }, flatCharge: { type: 'number', minimum: 0 } } },
      UpdatePayoutChargeRuleInput: { allOf: [ref('PayoutChargeRuleInput'), { type: 'object', required: ['version'], properties: { version: { type: 'integer', minimum: 1 } } }] },
      PayoutChargeResolution: { type: 'object', required: ['rule', 'charge'], properties: { rule: ref('PayoutChargeRule'), charge: { type: 'number', minimum: 0 } } },
      PartyType: { type: 'string', enum: ['MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER', 'EMPLOYEE'] },
      AccountStatus: { type: 'string', enum: ['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED'] },
      ApprovalStatus: { type: 'string', enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED'] },
      Party: { type: 'object', required: ['id', 'partyType', 'code', 'displayName', 'approvalStatus', 'accountStatus', 'kycStatus', 'version', 'createdAt', 'updatedAt'], properties: { id: { type: 'string', format: 'uuid' }, partyType: ref('PartyType'), code: { type: 'string' }, displayName: { type: 'string' }, legalName: { type: ['string', 'null'] }, email: { type: ['string', 'null'], format: 'email' }, mobile: { type: ['string', 'null'] }, parentPartyId: { type: ['string', 'null'], format: 'uuid' }, parentName: { type: ['string', 'null'] }, approvalStatus: ref('ApprovalStatus'), accountStatus: ref('AccountStatus'), kycStatus: { type: 'string' }, version: { type: 'integer', minimum: 1 }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      Pagination: { type: 'object', required: ['page', 'pageSize', 'total', 'totalPages'], properties: { page: { type: 'integer', minimum: 1 }, pageSize: { type: 'integer', minimum: 1, maximum: 100 }, total: { type: 'integer', minimum: 0 }, totalPages: { type: 'integer', minimum: 0 } } },
      PartyPage: { type: 'object', required: ['items', 'pagination'], properties: { items: { type: 'array', items: ref('Party') }, pagination: ref('Pagination') } },
      CreatePartyRequest: { type: 'object', required: ['partyType', 'code', 'displayName'], properties: { partyType: ref('PartyType'), code: { type: 'string', minLength: 2, maxLength: 50, pattern: '^[A-Z0-9_-]+$' }, displayName: { type: 'string', minLength: 2, maxLength: 160 }, legalName: { type: 'string', maxLength: 200 }, email: { type: 'string', format: 'email', maxLength: 254 }, mobile: { type: 'string', pattern: '^[6-9]\\d{9}$' }, parentPartyId: { type: 'string', format: 'uuid' } } },
      UpdatePartyStatusRequest: { type: 'object', required: ['accountStatus', 'reason', 'version'], properties: { accountStatus: ref('AccountStatus'), reason: { type: 'string', minLength: 3, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } },
      ReviewPartyRequest: { type: 'object', required: ['decision', 'remarks', 'version'], properties: { decision: { type: 'string', enum: ['APPROVED', 'REJECTED'] }, reasonCode: { type: 'string', maxLength: 50 }, remarks: { type: 'string', minLength: 3, maxLength: 1000 }, version: { type: 'integer', minimum: 1 } } },
      MasterDataItem: { type: 'object', required: ['id', 'category', 'code', 'label', 'sortOrder', 'isActive', 'createdAt', 'updatedAt'], properties: { id: { type: 'string', format: 'uuid' }, category: { type: 'string' }, code: { type: 'string' }, label: { type: 'string' }, description: { type: ['string', 'null'] }, configuration: {}, sortOrder: { type: 'integer', minimum: 0 }, isActive: { type: 'boolean' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
      CreateMasterDataRequest: { type: 'object', required: ['code', 'label'], properties: { code: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Z0-9_-]+$' }, label: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 1000 }, configuration: { type: 'object', additionalProperties: true }, sortOrder: { type: 'integer', minimum: 0, default: 0 }, isActive: { type: 'boolean', default: true } } },
      UpdateMasterDataRequest: { type: 'object', required: ['versionReason'], properties: { code: { type: 'string', minLength: 1, maxLength: 100, pattern: '^[A-Z0-9_-]+$' }, label: { type: 'string', minLength: 1, maxLength: 200 }, description: { type: 'string', maxLength: 1000 }, configuration: { type: 'object', additionalProperties: true }, sortOrder: { type: 'integer', minimum: 0 }, isActive: { type: 'boolean' }, versionReason: { type: 'string', minLength: 3, maxLength: 500 } } },
      RoleCategory: { type: 'string', enum: ['SYSTEM', 'NETWORK', 'EMPLOYEE'] },
      Permission: { type: 'object', required: ['code', 'module', 'action'], properties: { code: { type: 'string' }, module: { type: 'string' }, action: { type: 'string' }, description: { type: ['string', 'null'] } } },
      Role: { type: 'object', required: ['id', 'code', 'name', 'category', 'isSystem', 'isActive', 'assignedUserCount', 'permissions'], properties: { id: { type: 'integer' }, code: { type: 'string' }, name: { type: 'string' }, description: { type: ['string', 'null'] }, category: ref('RoleCategory'), isSystem: { type: 'boolean' }, isActive: { type: 'boolean' }, assignedUserCount: { type: 'integer' }, permissions: { type: 'array', items: { type: 'string' } } } },
      CreateRoleRequest: { type: 'object', required: ['code', 'name', 'permissionCodes'], properties: { code: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$' }, name: { type: 'string', minLength: 2, maxLength: 100 }, description: { type: 'string', maxLength: 500 }, permissionCodes: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } } } },
      UpdateRoleRequest: { type: 'object', required: ['reason'], properties: { name: { type: 'string' }, description: { type: ['string', 'null'] }, permissionCodes: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string' } }, isActive: { type: 'boolean' }, reason: { type: 'string', minLength: 3, maxLength: 500 } } },
      Employee: { type: 'object', required: ['id', 'userId', 'employeeCode', 'fullName', 'email', 'departmentCode', 'shiftCode', 'employmentStatus', 'role'], properties: { id: { type: 'string', format: 'uuid' }, userId: { type: 'string', format: 'uuid' }, employeeCode: { type: 'string' }, fullName: { type: 'string' }, email: { type: 'string', format: 'email' }, mobile: { type: ['string', 'null'] }, accountStatus: { type: 'string' }, departmentCode: { type: 'string' }, designation: { type: ['string', 'null'] }, managerUserId: { type: ['string', 'null'], format: 'uuid' }, joiningDate: { type: ['string', 'null'], format: 'date' }, shiftCode: { type: 'string', enum: ['MORNING', 'EVENING', 'NIGHT'] }, employmentStatus: { type: 'string' }, role: { type: 'object', properties: { id: { type: 'integer' }, code: { type: 'string' }, name: { type: 'string' } } } } },
      EmployeePage: { type: 'object', required: ['items', 'pagination'], properties: { items: { type: 'array', items: ref('Employee') }, pagination: { type: 'object', required: ['page', 'pageSize', 'totalItems', 'totalPages'], properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, totalItems: { type: 'integer' }, totalPages: { type: 'integer' } } } } },
      CreateEmployeeRequest: { type: 'object', required: ['employeeCode', 'fullName', 'email', 'mobile', 'departmentCode', 'roleId'], properties: { employeeCode: { type: 'string', pattern: '^[A-Z0-9_-]+$' }, fullName: { type: 'string' }, email: { type: 'string', format: 'email' }, mobile: { type: 'string', pattern: '^[6-9]\\d{9}$', description: 'Required; its last four digits form the one-time initial password.' }, departmentCode: { type: 'string' }, roleId: { type: 'integer', minimum: 1 }, designation: { type: 'string' }, managerUserId: { type: 'string', format: 'uuid' }, joiningDate: { type: 'string', format: 'date' }, shiftCode: { type: 'string', enum: ['MORNING', 'EVENING', 'NIGHT'], default: 'MORNING' } } },
      UpdateEmployeeRequest: { type: 'object', required: ['fullName', 'email', 'departmentCode', 'roleId', 'shiftCode', 'reason'], properties: { fullName: { type: 'string' }, email: { type: 'string', format: 'email' }, mobile: { type: ['string', 'null'] }, departmentCode: { type: 'string' }, roleId: { type: 'integer', minimum: 1 }, designation: { type: ['string', 'null'] }, managerUserId: { type: ['string', 'null'], format: 'uuid' }, joiningDate: { type: ['string', 'null'], format: 'date' }, shiftCode: { type: 'string', enum: ['MORNING', 'EVENING', 'NIGHT'] }, reason: { type: 'string', minLength: 3 } } },
      UpdateEmployeeStatusRequest: { type: 'object', required: ['status', 'reason'], properties: { status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED'] }, reason: { type: 'string', minLength: 3 } } },
      ResetEmployeePasswordRequest: { type: 'object', required: ['reason'], properties: { password: { type: 'string', minLength: 8, writeOnly: true }, reason: { type: 'string', minLength: 3 } } },
      EmployeeMeta: { type: 'object', required: ['departments', 'roles'], properties: { departments: { type: 'array', items: { type: 'object' } }, roles: { type: 'array', items: { type: 'object' } } } },
      LoginHistoryItem: { type: 'object', required: ['id', 'result', 'loginMethod', 'locationStatus', 'createdAt'], properties: {
        id: { type: 'integer' },
        userId: { type: ['string', 'null'], format: 'uuid' },
        userFullName: { type: ['string', 'null'] },
        userEmail: { type: ['string', 'null'], format: 'email' },
        userMobile: { type: ['string', 'null'] },
        partyType: { type: ['string', 'null'], description: 'Associated party type (e.g. MASTER_DISTRIBUTOR, DISTRIBUTOR, RETAILER).' },
        roles: { type: ['string', 'null'], description: 'Comma-separated role codes.' },
        sessionId: { type: ['string', 'null'] },
        result: { type: 'string', enum: ['SUCCESS', 'FAILED', 'LOCKED', 'LOGGED_OUT', 'REFRESH'] },
        failReason: { type: ['string', 'null'] },
        loginMethod: { type: 'string' },
        ipAddress: { type: ['string', 'null'], description: 'Trusted-proxy client IP resolved by the backend.' },
        userAgent: { type: ['string', 'null'] },
        deviceFingerprint: { type: ['string', 'null'] },
        latitude: { type: ['number', 'null'], format: 'double' },
        longitude: { type: ['number', 'null'], format: 'double' },
        locationAccuracy: { type: ['number', 'null'], format: 'float', description: 'Geolocation accuracy radius in meters.' },
        locationStatus: { type: 'string', enum: ['GRANTED', 'DENIED', 'TIMEOUT', 'UNSUPPORTED', 'ERROR', 'PENDING', 'UNAVAILABLE'], description: 'Outcome of the browser geolocation request for this login.' },
        locationCapturedAt: { type: ['string', 'null'], format: 'date-time' },
        metadata: {},
        createdAt: { type: 'string', format: 'date-time' },
        updatedAt: { type: 'string', format: 'date-time' },
      } },
      LoginHistoryPage: { type: 'object', required: ['items', 'pagination'], properties: { items: { type: 'array', items: ref('LoginHistoryItem') }, pagination: { type: 'object', required: ['page', 'pageSize', 'totalItems', 'totalPages'], properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, totalItems: { type: 'integer' }, totalPages: { type: 'integer' } } } } },
    },
  },
};

export const swaggerDocument = swaggerJsdoc({ definition, apis: [] });
