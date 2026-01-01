/**
 * Route Modules Index
 *
 * Exports all route factory functions for use by the main server.
 */

export { createFeedRoutes, notifyNewPost, notifyNotifications } from './feed.js';
export { createTrustRoutes } from './trust.js';
export { createMediaRoutes } from './media.js';
export { createSlidesRoutes } from './slides.js';
export { createSettingsRoutes } from './settings.js';
export { createDataRoutes } from './data.js';
export { createSubmitRoutes, type SubmitRoutesConfig } from './submit.js';
export { createAdminRoutes, type AdminRoutesConfig } from './admin.js';
export { createOpenGraphRoutes } from './opengraph.js';
