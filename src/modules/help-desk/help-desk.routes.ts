import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool, withTransaction } from '../../database/pool.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { contextFromAuth, writeAuditLog } from '../../shared/audit.js';
import { sendSuccess } from '../../shared/response.js';

export const helpDeskRouter = Router();
helpDeskRouter.use(authenticate);
const requesterRoles = ['RETAILER','DISTRIBUTOR','MASTER_DISTRIBUTOR'];
const activeStatuses = ['OPEN','ASSIGNED','IN_PROGRESS','REOPENED'];
const isAdmin = (roles: string[]) => roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
const isOperations = (roles: string[]) => roles.includes('OPERATIONS') || roles.includes('SUPPORT');
const idSchema = z.string().uuid();

const createSchema = z.object({ category:z.string().trim().min(2).max(100),subcategory:z.string().trim().min(2).max(160),description:z.string().trim().min(10).max(2000) });
const listSchema = z.object({ status:z.string().max(30).optional(),search:z.string().trim().max(100).optional(),page:z.coerce.number().int().min(1).default(1),pageSize:z.coerce.number().int().min(1).max(100).default(20) });
const assignSchema = z.object({ employeeId:z.string().uuid().nullable(),reason:z.string().trim().min(5).max(500) });
const statusSchema = z.object({ status:z.enum(['IN_PROGRESS','RESOLVED','CLOSED','REOPENED']),remarks:z.string().trim().min(3).max(1000) });

async function autoAssignee(connection: PoolConnection): Promise<string|null> {
  await connection.query("SELECT state_key FROM help_desk_assignment_state WHERE state_key='OPERATIONS_DEFAULT' FOR UPDATE");
  const [rows] = await connection.query<RowDataPacket[]>(`SELECT ep.id, ep.created_at,
      SUM(CASE WHEN t.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED') THEN 1 ELSE 0 END) active_count
    FROM employee_profiles ep JOIN users u ON u.id=ep.user_id
    JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    LEFT JOIN help_desk_tickets t ON t.assigned_employee_id=ep.id
    WHERE ep.department_code='OPERATIONS' AND ep.employment_status='ACTIVE' AND u.status='ACTIVE' AND r.code='OPERATIONS' AND r.is_active=TRUE
    GROUP BY ep.id,ep.created_at ORDER BY active_count ASC,ep.created_at ASC,ep.id ASC`);
  if (!rows.length) return null;
  const minimum = Number(rows[0]!.active_count); const candidates=rows.filter(row=>Number(row.active_count)===minimum);
  const [states]=await connection.query<RowDataPacket[]>("SELECT last_assigned_employee_id FROM help_desk_assignment_state WHERE state_key='OPERATIONS_DEFAULT'");
  const last=states[0]?.last_assigned_employee_id as string|null; const lastIndex=candidates.findIndex(row=>row.id===last);
  const selected=candidates[(lastIndex+1)%candidates.length]!.id as string;
  await connection.execute("UPDATE help_desk_assignment_state SET last_assigned_employee_id=? WHERE state_key='OPERATIONS_DEFAULT'",[selected]);
  return selected;
}

const selectSql=`SELECT t.*,raiser.full_name raised_by_name,raiser.email raised_by_email,p.party_type raised_by_role,p.display_name party_name,
  ep.employee_code,assignee.full_name assigned_employee_name,assignee.email assigned_employee_email
  FROM help_desk_tickets t JOIN users raiser ON raiser.id=t.raised_by_user_id LEFT JOIN parties p ON p.id=t.raised_by_party_id
  LEFT JOIN employee_profiles ep ON ep.id=t.assigned_employee_id LEFT JOIN users assignee ON assignee.id=ep.user_id`;
const mapTicket=(r:RowDataPacket)=>({id:r.id,ticketId:r.ticket_number,category:r.category,subcategory:r.subcategory,description:r.description,status:r.status,
  raisedByUserId:r.raised_by_user_id,raisedByPartyId:r.raised_by_party_id,raisedByName:r.raised_by_name,raisedByEmail:r.raised_by_email,
  raisedByRole:r.raised_by_role,partyName:r.party_name,assignedEmployeeId:r.assigned_employee_id,assignedEmployeeCode:r.employee_code,
  assignedEmployeeName:r.assigned_employee_name,assignedEmployeeEmail:r.assigned_employee_email,assignmentMethod:r.assignment_method,
  assignedAt:r.assigned_at,resolvedAt:r.resolved_at,closedAt:r.closed_at,createdAt:r.created_at,updatedAt:r.updated_at});

helpDeskRouter.post('/tickets',asyncHandler(async(req,res)=>{
  if(!req.auth!.roles.some(role=>requesterRoles.includes(role)))throw new ApiError(403,'REQUESTER_ONLY','Only network users can raise Help Desk tickets');
  const input=createSchema.parse(req.body);const result=await withTransaction(async connection=>{
    const id=randomUUID();const ticketNumber=`QSP-HD-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${id.slice(0,8).toUpperCase()}`;
    const employeeId=await autoAssignee(connection);const status=employeeId?'ASSIGNED':'OPEN';
    await connection.execute(`INSERT INTO help_desk_tickets (id,ticket_number,raised_by_user_id,raised_by_party_id,category,subcategory,description,status,assigned_employee_id,assignment_method,assigned_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,${employeeId?'UTC_TIMESTAMP(6)':'NULL'})`,[id,ticketNumber,req.auth!.userId,req.auth!.partyId,input.category,input.subcategory,input.description,status,employeeId,employeeId?'AUTO_WORKLOAD_ROUND_ROBIN':null]);
    if(employeeId)await connection.execute(`INSERT INTO help_desk_ticket_assignments (id,ticket_id,to_employee_id,assignment_method,assigned_by_user_id) VALUES (?,?,?,'AUTO_WORKLOAD_ROUND_ROBIN',NULL)`,[randomUUID(),id,employeeId]);
    await connection.execute(`INSERT INTO help_desk_ticket_status_history (id,ticket_id,from_status,to_status,remarks,changed_by_user_id) VALUES (?,?,NULL,?,'Ticket raised',?)`,[randomUUID(),id,status,req.auth!.userId]);
    await writeAuditLog({action:'HELP_DESK_TICKET_CREATED',resourceType:'HELP_DESK_TICKET',resourceId:id,afterData:{ticketNumber,status,employeeId}},contextFromAuth(req.auth!),connection);
    const [rows]=await connection.query<RowDataPacket[]>(`${selectSql} WHERE t.id=?`,[id]);return mapTicket(rows[0]!);
  });return sendSuccess(res,result,201);
}));

helpDeskRouter.get('/tickets',asyncHandler(async(req,res)=>{
  const q=listSchema.parse(req.query);const where:string[]=[];const params:unknown[]=[];
  if(isAdmin(req.auth!.roles)){}else if(isOperations(req.auth!.roles)){
    const [profiles]=await pool.query<RowDataPacket[]>('SELECT id FROM employee_profiles WHERE user_id=?',[req.auth!.userId]);if(!profiles[0])throw new ApiError(403,'EMPLOYEE_PROFILE_REQUIRED','Operations employee profile was not found');where.push('t.assigned_employee_id=?');params.push(profiles[0].id);
  }else if(req.auth!.roles.some(role=>requesterRoles.includes(role))){where.push('t.raised_by_user_id=?');params.push(req.auth!.userId);}else throw new ApiError(403,'ACCESS_DENIED','Help Desk access denied');
  if(q.status&&q.status!=='ALL'){where.push('t.status=?');params.push(q.status);}if(q.search){const term=`%${q.search}%`;where.push('(t.ticket_number LIKE ? OR t.category LIKE ? OR t.subcategory LIKE ? OR raiser.full_name LIKE ?)');params.push(term,term,term,term);}
  const clause=where.length?`WHERE ${where.join(' AND ')}`:'';const [counts]=await pool.query<RowDataPacket[]>(`SELECT COUNT(*) total FROM help_desk_tickets t JOIN users raiser ON raiser.id=t.raised_by_user_id ${clause}`,params);
  const [rows]=await pool.query<RowDataPacket[]>(`${selectSql} ${clause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,[...params,q.pageSize,(q.page-1)*q.pageSize]);const total=Number(counts[0]?.total??0);
  return sendSuccess(res,{items:rows.map(mapTicket),pagination:{page:q.page,pageSize:q.pageSize,totalItems:total,totalPages:Math.max(1,Math.ceil(total/q.pageSize))}});
}));

helpDeskRouter.get('/operations-employees',asyncHandler(async(req,res)=>{if(!isAdmin(req.auth!.roles))throw new ApiError(403,'ADMIN_ONLY','Admin access is required');
  const [rows]=await pool.query<RowDataPacket[]>(`SELECT ep.id,ep.employee_code,u.full_name,u.email,
    SUM(CASE WHEN t.status IN ('OPEN','ASSIGNED','IN_PROGRESS','REOPENED') THEN 1 ELSE 0 END) active_ticket_count
    FROM employee_profiles ep JOIN users u ON u.id=ep.user_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
    LEFT JOIN help_desk_tickets t ON t.assigned_employee_id=ep.id WHERE ep.department_code='OPERATIONS' AND ep.employment_status='ACTIVE' AND u.status='ACTIVE' AND r.code='OPERATIONS'
    GROUP BY ep.id,ep.employee_code,u.full_name,u.email ORDER BY active_ticket_count,u.full_name`);
  return sendSuccess(res,rows.map(r=>({id:r.id,employeeCode:r.employee_code,name:r.full_name,email:r.email,activeTicketCount:Number(r.active_ticket_count)})));
}));

helpDeskRouter.patch('/tickets/:id/assignment',asyncHandler(async(req,res)=>{if(!isAdmin(req.auth!.roles))throw new ApiError(403,'ADMIN_ONLY','Admin access is required');const id=idSchema.parse(req.params.id);const input=assignSchema.parse(req.body);
  const result=await withTransaction(async connection=>{const [tickets]=await connection.query<RowDataPacket[]>('SELECT assigned_employee_id,status FROM help_desk_tickets WHERE id=? FOR UPDATE',[id]);if(!tickets[0])throw new ApiError(404,'TICKET_NOT_FOUND','Ticket was not found');
    if(input.employeeId){const [employees]=await connection.query<RowDataPacket[]>(`SELECT ep.id FROM employee_profiles ep JOIN users u ON u.id=ep.user_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE ep.id=? AND ep.department_code='OPERATIONS' AND ep.employment_status='ACTIVE' AND u.status='ACTIVE' AND r.code='OPERATIONS'`,[input.employeeId]);if(!employees[0])throw new ApiError(422,'INVALID_ASSIGNEE','Select an active Operations employee');}
    const previous=tickets[0].assigned_employee_id as string|null;const method=input.employeeId?(previous?'ADMIN_REASSIGNMENT':'ADMIN_MANUAL'):'RETURNED_UNASSIGNED';const nextStatus=input.employeeId?(tickets[0].status==='OPEN'?'ASSIGNED':tickets[0].status):'OPEN';
    await connection.execute('UPDATE help_desk_tickets SET assigned_employee_id=?,assignment_method=?,assigned_at=?,status=? WHERE id=?',[input.employeeId,input.employeeId?(previous?'ADMIN_REASSIGNMENT':'ADMIN_MANUAL'):null,input.employeeId?new Date():null,nextStatus,id]);
    await connection.execute('INSERT INTO help_desk_ticket_assignments (id,ticket_id,from_employee_id,to_employee_id,assignment_method,reason,assigned_by_user_id) VALUES (?,?,?,?,?,?,?)',[randomUUID(),id,previous,input.employeeId,method,input.reason,req.auth!.userId]);
    await writeAuditLog({action:'HELP_DESK_TICKET_ASSIGNED',resourceType:'HELP_DESK_TICKET',resourceId:id,afterData:{employeeId:input.employeeId,method},metadata:{reason:input.reason}},contextFromAuth(req.auth!),connection);
    const [rows]=await connection.query<RowDataPacket[]>(`${selectSql} WHERE t.id=?`,[id]);return mapTicket(rows[0]!);});return sendSuccess(res,result);
}));

helpDeskRouter.patch('/tickets/:id/status',asyncHandler(async(req,res)=>{if(!isAdmin(req.auth!.roles)&&!isOperations(req.auth!.roles))throw new ApiError(403,'ACCESS_DENIED','Admin or Operations access is required');const id=idSchema.parse(req.params.id);const input=statusSchema.parse(req.body);
  const result=await withTransaction(async connection=>{const [tickets]=await connection.query<RowDataPacket[]>('SELECT status,assigned_employee_id FROM help_desk_tickets WHERE id=? FOR UPDATE',[id]);if(!tickets[0])throw new ApiError(404,'TICKET_NOT_FOUND','Ticket was not found');
    if(!isAdmin(req.auth!.roles)){const [profiles]=await connection.query<RowDataPacket[]>('SELECT id FROM employee_profiles WHERE user_id=?',[req.auth!.userId]);if(profiles[0]?.id!==tickets[0].assigned_employee_id)throw new ApiError(403,'NOT_TICKET_OWNER','This ticket is assigned to another employee');}
    await connection.execute(`UPDATE help_desk_tickets SET status=?,resolved_at=IF(?='RESOLVED',UTC_TIMESTAMP(6),resolved_at),closed_at=IF(?='CLOSED',UTC_TIMESTAMP(6),closed_at) WHERE id=?`,[input.status,input.status,input.status,id]);
    await connection.execute('INSERT INTO help_desk_ticket_status_history (id,ticket_id,from_status,to_status,remarks,changed_by_user_id) VALUES (?,?,?,?,?,?)',[randomUUID(),id,tickets[0].status,input.status,input.remarks,req.auth!.userId]);
    const [rows]=await connection.query<RowDataPacket[]>(`${selectSql} WHERE t.id=?`,[id]);return mapTicket(rows[0]!);});return sendSuccess(res,result);
}));
