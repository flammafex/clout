/**
 * API Module - HTTP communication layer
 *
 * Handles all API calls to the Clout server.
 */

export const API_BASE = '/api';

/**
 * Make an API call to the Clout server
 * @param {string} endpoint - API endpoint (e.g., '/feed')
 * @param {string} method - HTTP method (GET, POST, PUT, DELETE)
 * @param {object} body - Request body for POST/PUT
 * @returns {Promise<any>} Response data
 */
export async function apiCall(endpoint, method = 'GET', body = null) {
  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${API_BASE}${endpoint}`, options);
    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || 'Request failed');
    }

    return data.data;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

/**
 * Upload media file to server
 * @param {File} file - File to upload
 * @param {function} onProgress - Progress callback
 * @returns {Promise<object>} Upload result { cid, mimeType, filename, size }
 */
export async function uploadMediaFile(file) {
  const buffer = await file.arrayBuffer();

  const response = await fetch(`${API_BASE}/media/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': file.type,
      'X-Filename': file.name
    },
    body: buffer
  });

  const data = await response.json();

  if (!data.success) {
    throw new Error(data.error || 'Upload failed');
  }

  return data.data;
}
