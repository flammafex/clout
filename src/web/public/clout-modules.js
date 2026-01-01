/**
 * Clout Browser Modules Loader
 *
 * Loads ES modules and exposes them globally for use by app.js
 * This bridges the gap between ES modules and classic scripts.
 */

import { Crypto } from './crypto-browser.js';
import { BrowserIdentity } from './identity-browser.js';
import { BrowserUserData } from './user-data-browser.js';
import * as VOPRF from './voprf-browser.js';
import * as DayPass from './daypass-browser.js';

// Create user data instance
const userData = new BrowserUserData();

// Expose to global scope for app.js
window.CloutCrypto = Crypto;
window.CloutIdentity = BrowserIdentity;
window.CloutUserData = userData;
window.CloutVOPRF = VOPRF;
window.CloutDayPass = DayPass;

// Initialize user data store
userData.init().then(() => {
  // Signal that modules are loaded
  window.cloutModulesReady = true;
  window.dispatchEvent(new Event('clout-modules-ready'));
  console.log('[Clout] Browser modules loaded (crypto, identity, user data, voprf, daypass)');
}).catch(err => {
  console.error('[Clout] Failed to initialize user data store:', err);
  // Still signal ready so app can proceed
  window.cloutModulesReady = true;
  window.dispatchEvent(new Event('clout-modules-ready'));
});
