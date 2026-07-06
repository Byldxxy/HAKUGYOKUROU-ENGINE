const crypto = require('crypto');
const config = require('../config');

const passwordPrefix = 'scrypt';
const sessionCookieName = 'trpg_session';

const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `${passwordPrefix}$${salt}$${hash}`;
};

const isPasswordHash = (value) => typeof value === 'string' && value.startsWith(`${passwordPrefix}$`);

const verifyPassword = (password, storedHash) => {
  if (!isPasswordHash(storedHash)) return false;
  const [, salt, expectedValue] = storedHash.split('$');
  if (!salt || !expectedValue) return false;

  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedValue, 'base64url');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

const sign = (value) => crypto
  .createHmac('sha256', config.session.secret)
  .update(value)
  .digest('base64url');

const createSessionToken = (username) => {
  const now = Math.floor(Date.now() / 1000);
  const payload = encode(JSON.stringify({
    sub: username,
    iat: now,
    exp: now + config.session.maxAgeSeconds,
  }));
  return `${payload}.${sign(payload)}`;
};

const verifySessionToken = (token) => {
  if (!token || typeof token !== 'string') return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expectedSignature = sign(payload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    return null;
  }

  try {
    const data = JSON.parse(decode(payload));
    const now = Math.floor(Date.now() / 1000);
    if (!data.sub || !data.exp || data.exp <= now) return null;
    return { username: data.sub, issuedAt: data.iat, expiresAt: data.exp };
  } catch {
    return null;
  }
};

const safelyDecodeCookie = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

const parseCookies = (header = '') => Object.fromEntries(
  header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) return [part, ''];
    return [part.slice(0, separatorIndex), safelyDecodeCookie(part.slice(separatorIndex + 1))];
  })
);

const getSessionFromCookieHeader = (header) => {
  const token = parseCookies(header)[sessionCookieName];
  return verifySessionToken(token);
};

const serializeSessionCookie = (token, maxAgeSeconds = config.session.maxAgeSeconds) => {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (config.session.secureCookie) parts.push('Secure');
  return parts.join('; ');
};

const createLoginCookie = (username) => serializeSessionCookie(createSessionToken(username));
const createLogoutCookie = () => serializeSessionCookie('', 0);

module.exports = {
  createLoginCookie,
  createLogoutCookie,
  getSessionFromCookieHeader,
  hashPassword,
  isPasswordHash,
  verifyPassword,
};
