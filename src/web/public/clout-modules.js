/**
 * Clout Browser Modules Loader
 *
 * Loads ES modules and exposes them globally for use by app.js
 * This bridges the gap between ES modules and classic scripts.
 */

import { Crypto } from './crypto-browser.js';
import { BrowserIdentity } from './identity-browser.js';

// Expose to global scope for app.js
window.CloutCrypto = Crypto;
window.CloutIdentity = BrowserIdentity;

// Signal that modules are loaded
window.cloutModulesReady = true;
window.dispatchEvent(new Event('clout-modules-ready'));

console.log('[Clout] Browser crypto modules loaded');
