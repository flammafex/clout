/**
 * Shared validation utilities for route handlers
 *
 * This module consolidates common validation logic to avoid duplication
 * across route files and ensure consistent error messaging.
 */

import type { Request, Response, NextFunction } from 'express';
import { Crypto } from '../../crypto.js';

/**
 * Validate a hex-encoded public key (32 bytes = 64 hex chars)
 * @param publicKey - The value to validate
 * @param fieldName - Field name for error messages
 * @returns The validated public key string
 * @throws Error if validation fails
 */
export function validatePublicKey(publicKey: unknown, fieldName = 'publicKey'): string {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  if (!Crypto.isValidPublicKeyHex(publicKey)) {
    throw new Error(`Invalid ${fieldName}: must be 64 hex characters (32 bytes)`);
  }

  return publicKey;
}

/**
 * Validate and convert a hex-encoded Ed25519 signature to Uint8Array (64 bytes = 128 hex chars)
 * @param signature - The hex string to validate
 * @param fieldName - Field name for error messages
 * @returns The signature as Uint8Array
 * @throws Error if validation fails
 */
export function validateSignature(signature: unknown, fieldName = 'signature'): Uint8Array {
  if (!signature || typeof signature !== 'string') {
    throw new Error(`${fieldName} is required`);
  }

  // Ed25519 signature is 64 bytes = 128 hex chars
  if (signature.length !== 128 || !/^[0-9a-fA-F]+$/.test(signature)) {
    throw new Error(`Invalid ${fieldName}: must be 128 hex characters (64 bytes)`);
  }

  return Crypto.fromHex(signature);
}

/**
 * Validate a positive integer from query/body parameter
 * @param value - The value to validate
 * @param fieldName - Field name for error messages
 * @param defaultValue - Default if value is undefined/null
 * @returns The validated integer
 */
export function validatePositiveInt(
  value: unknown,
  fieldName: string,
  defaultValue: number
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);

  if (isNaN(parsed) || parsed < 0) {
    throw new Error(`Invalid ${fieldName}: must be a positive integer`);
  }

  return parsed;
}

/**
 * Validate a weight value (0.1 to 1.0)
 * @param value - The value to validate
 * @param defaultValue - Default if value is undefined
 * @returns The validated weight, clamped to [0.1, 1.0]
 */
export function validateWeight(value: unknown, defaultValue = 1.0): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  const weight = typeof value === 'number' ? value : parseFloat(String(value));

  if (isNaN(weight)) {
    return defaultValue;
  }

  return Math.max(0.1, Math.min(1.0, weight));
}

/**
 * Extract browser user's public key from request
 * Checks: X-User-PublicKey header, userPublicKey query param, userPublicKey body field
 * @param req - Express request object
 * @returns The public key if found and valid, undefined otherwise
 */
export function getBrowserUserPublicKey(req: Request): string | undefined {
  // Try header first (preferred for GET requests)
  const headerKey = req.headers['x-user-publickey'];
  if (headerKey && typeof headerKey === 'string' && headerKey.length === 64) {
    return headerKey;
  }

  // Try query param
  const queryKey = req.query?.userPublicKey;
  if (queryKey && typeof queryKey === 'string' && queryKey.length === 64) {
    return queryKey;
  }

  // Try body (for POST requests)
  const bodyKey = req.body?.userPublicKey;
  if (bodyKey && typeof bodyKey === 'string' && bodyKey.length === 64) {
    return bodyKey;
  }

  return undefined;
}

/**
 * Type guard to check if error has a message property
 */
export function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  );
}

/**
 * Get error message from unknown error type
 * @param error - The caught error
 * @returns Error message string
 */
export function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

/**
 * Standard error response helper
 * @param res - Express response object
 * @param error - The error to send
 * @param statusCode - HTTP status code (default 400)
 */
export function sendErrorResponse(
  res: Response,
  error: unknown,
  statusCode = 400
): void {
  res.status(statusCode).json({
    success: false,
    error: getErrorMessage(error),
  });
}

/**
 * Async route handler wrapper that catches errors and sends proper responses
 * @param handler - Async route handler function
 * @returns Wrapped handler with error handling
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res, next).catch((error: unknown) => {
      sendErrorResponse(res, error);
    });
  };
}
