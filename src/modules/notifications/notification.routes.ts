import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { ApiError } from '../../shared/api-error.js';
import {
  listNotifications,
  getNotificationSummary,
  getNotificationById,
  markAsRead,
  markAsUnread,
  markAllAsRead,
  dismissNotification,
  markClicked,
  publishAnnouncement,
  getPreferences,
  updatePreference,
  exportNotificationsToCsv,
} from './notification.service.js';
import {
  listNotificationsSchema,
  notificationIdSchema,
  markAsReadSchema,
  markAsUnreadSchema,
  dismissSchema,
  clickedSchema,
  markAllReadSchema,
  publishAnnouncementSchema,
  updatePreferenceSchema,
  eventCodeSchema,
} from './notification.schemas.js';

export const notificationRouter = Router();
notificationRouter.use(authenticate);

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: List notifications for the calling user
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: severity, schema: { type: string } }
 *       - { in: query, name: status, schema: { type: string, enum: [UNREAD,READ,ALL] } }
 *       - { in: query, name: actionRequired, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string } }
 *       - { in: query, name: dateTo, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: excludeDismissed, schema: { type: string, enum: ['true','false'] } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 20 } }
 *     responses:
 *       '200': { description: Paginated notifications + summary }
 *       '401': { description: AUTHENTICATION_REQUIRED }
 */
notificationRouter.get(
  '/',
  requirePermission('NOTIFICATION_READ'),
  validate(listNotificationsSchema, 'query'),
  asyncHandler(async (request, response) => {
    const filters = listNotificationsSchema.parse(request.query);
    const result = await listNotifications(filters, request.auth!);
    return sendSuccess(response, result);
  }),
);

/**
 * @openapi
 * /notifications/summary:
 *   get:
 *     tags: [Notifications]
 *     summary: Summary counts for the bell menu badge / cards
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.get(
  '/summary',
  asyncHandler(async (request, response) => {
    return sendSuccess(response, await getNotificationSummary(request.auth!));
  }),
);

/**
 * @openapi
 * /notifications/export:
 *   get:
 *     tags: [Notifications]
 *     summary: CSV export of filtered notifications
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.get(
  '/export',
  requirePermission('NOTIFICATION_READ'),
  validate(listNotificationsSchema, 'query'),
  asyncHandler(async (request, response) => {
    const filters = listNotificationsSchema.parse(request.query);
    const { filename, content } = await exportNotificationsToCsv(filters, request.auth!);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return response.send('\uFEFF' + content);
  }),
);

/**
 * @openapi
 * /notifications/{id}:
 *   get:
 *     tags: [Notifications]
 *     summary: Get single notification by id (ownership-enforced)
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.get(
  '/:id',
  requirePermission('NOTIFICATION_READ'),
  validate(notificationIdSchema, 'params'),
  asyncHandler(async (request, response) => {
    const { id } = notificationIdSchema.parse(request.params);
    return sendSuccess(response, await getNotificationById(id, request.auth!));
  }),
);

/**
 * @openapi
 * /notifications/{id}/read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark a single notification as read
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.post(
  '/:id/read',
  validate(notificationIdSchema, 'params'),
  validate(markAsReadSchema, 'body'),
  asyncHandler(async (request, response) => {
    const { id } = notificationIdSchema.parse(request.params);
    return sendSuccess(response, await markAsRead(id, request.auth!));
  }),
);

/**
 * @openapi
 * /notifications/{id}/unread:
 *   post:
 *     tags: [Notifications]
 *     summary: Restore notification to UNREAD status
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.post(
  '/:id/unread',
  validate(notificationIdSchema, 'params'),
  validate(markAsUnreadSchema, 'body'),
  asyncHandler(async (request, response) => {
    const { id } = notificationIdSchema.parse(request.params);
    return sendSuccess(response, await markAsUnread(id, request.auth!));
  }),
);

/**
 * @openapi
 * /notifications/read-all:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark all of user's unread notifications as read
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.post(
  '/read-all',
  validate(markAllReadSchema, 'body'),
  asyncHandler(async (request, response) => {
    const body = markAllReadSchema.parse(request.body ?? {});
    return sendSuccess(response, await markAllAsRead(request.auth!, body.category));
  }),
);

/**
 * @openapi
 * /notifications/{id}/dismiss:
 *   post:
 *     tags: [Notifications]
 *     summary: Dismiss notification (hides from bell menu / announcement banner)
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.post(
  '/:id/dismiss',
  validate(notificationIdSchema, 'params'),
  validate(dismissSchema, 'body'),
  asyncHandler(async (request, response) => {
    const { id } = notificationIdSchema.parse(request.params);
    return sendSuccess(response, await dismissNotification(id, request.auth!));
  }),
);

/**
 * @openapi
 * /notifications/{id}/clicked:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark clicked (analytics)
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.post(
  '/:id/clicked',
  validate(notificationIdSchema, 'params'),
  validate(clickedSchema, 'body'),
  asyncHandler(async (request, response) => {
    const { id } = notificationIdSchema.parse(request.params);
    return sendSuccess(response, await markClicked(id, request.auth!));
  }),
);

/**
 * @openapi
 * /notifications/announcements:
 *   post:
 *     tags: [Notifications]
 *     summary: Publish a manual system announcement to targeted users
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.post(
  '/announcements',
  requirePermission('ANNOUNCEMENT_PUBLISH'),
  validate(publishAnnouncementSchema, 'body'),
  asyncHandler(async (request, response) => {
    const canPublish =
      request.auth!.roles.includes('ADMIN')
      || request.auth!.roles.includes('OPERATIONS')
      || request.auth!.permissions.includes('ANNOUNCEMENT_PUBLISH');
    if (!canPublish) {
      throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You do not have permission to publish announcements');
    }
    const input = publishAnnouncementSchema.parse(request.body);
    const result = await publishAnnouncement(input, request.auth!);
    return sendSuccess(response, result, 201);
  }),
);

/**
 * @openapi
 * /notifications/preferences:
 *   get:
 *     tags: [Notification Preferences]
 *     summary: Get merged notification preferences (catalog + per-user toggles)
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.get(
  '/preferences',
  asyncHandler(async (request, response) => {
    return sendSuccess(response, await getPreferences(request.auth!));
  }),
);

/**
 * @openapi
 * /notifications/preferences/{eventCode}:
 *   patch:
 *     tags: [Notification Preferences]
 *     summary: Upsert notification preference for one event code
 *     security:
 *       - bearerAuth: []
 */
notificationRouter.patch(
  '/preferences/:eventCode',
  validate(eventCodeSchema, 'params'),
  validate(updatePreferenceSchema, 'body'),
  asyncHandler(async (request, response) => {
    const { eventCode } = eventCodeSchema.parse(request.params);
    const body = updatePreferenceSchema.parse(request.body);
    return sendSuccess(response, await updatePreference(eventCode, body, request.auth!));
  }),
);
