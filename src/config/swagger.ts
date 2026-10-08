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
  ],
  paths: {
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
      ErrorResponse: { type: 'object', required: ['success', 'error', 'timestamp', 'requestId'], properties: { success: { type: 'boolean', const: false }, error: { type: 'object', required: ['code', 'message'], properties: { code: { type: 'string', example: 'VALIDATION_ERROR' }, message: { type: 'string', example: 'Request validation failed' }, details: { description: 'Additional safe error context; validation failures contain flattened Zod field errors.' } } }, timestamp: { type: 'string', format: 'date-time' }, requestId: { type: 'string', description: 'Server-generated UUID or a validated client-supplied X-Request-ID.' } } },
      LiveStatus: { type: 'object', required: ['status'], properties: { status: { type: 'string', const: 'ok' } } },
      ReadyStatus: { type: 'object', required: ['status', 'database'], properties: { status: { type: 'string', const: 'ready' }, database: { type: 'string', const: 'connected' } } },
      LoginRequest: { type: 'object', required: ['identifier', 'password'], properties: { identifier: { type: 'string', minLength: 3, maxLength: 254, description: 'Email, mobile number, or accepted login identifier.' }, password: { type: 'string', format: 'password', minLength: 4, maxLength: 128, writeOnly: true } } },
      ChangePasswordRequest: { type: 'object', required: ['currentPassword', 'newPassword'], properties: { currentPassword: { type: 'string', format: 'password', minLength: 4, writeOnly: true }, newPassword: { type: 'string', format: 'password', minLength: 8, writeOnly: true } } },
      RefreshTokenRequest: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string', minLength: 20, writeOnly: true, example: 'eyJ...masked-refresh-token' } } },
      AuthenticatedUser: { type: 'object', required: ['userId', 'partyId', 'email', 'roles', 'permissions', 'mustChangePassword'], properties: { userId: { type: 'string', format: 'uuid' }, partyId: { oneOf: [{ type: 'string', format: 'uuid' }, { type: 'null' }] }, email: { type: 'string', format: 'email' }, roles: { type: 'array', items: { type: 'string' } }, permissions: { type: 'array', items: { type: 'string' } }, mustChangePassword: { type: 'boolean' }, name: { type: 'string', description: 'Returned by login only.' } } },
      TokenPair: { type: 'object', required: ['accessToken', 'refreshToken', 'tokenType', 'expiresIn'], properties: { accessToken: { type: 'string', writeOnly: true, example: 'eyJ...masked-access-token' }, refreshToken: { type: 'string', writeOnly: true, example: 'eyJ...masked-refresh-token' }, tokenType: { type: 'string', const: 'Bearer' }, expiresIn: { type: 'string', example: '15m' } } },
      LoginResult: { allOf: [ref('TokenPair'), { type: 'object', required: ['user'], properties: { user: ref('AuthenticatedUser') } }] },
      LogoutResult: { type: 'object', required: ['loggedOut'], properties: { loggedOut: { type: 'boolean', const: true } } },
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
    },
  },
};

export const swaggerDocument = swaggerJsdoc({ definition, apis: [] });
