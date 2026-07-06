const securityService = require('../services/securityService');
const userRepository = require('../repositories/userRepository');

const getAuthenticatedUser = (cookieHeader) => {
  const session = securityService.getSessionFromCookieHeader(cookieHeader);
  if (!session) return null;
  const user = userRepository.findByUsername(session.username);
  return user ? { username: user.username, expiresAt: session.expiresAt } : null;
};

const requireAuth = (req, res, next) => {
  const user = getAuthenticatedUser(req.headers.cookie);
  if (!user) return res.status(401).json({ success: false, error: '登录状态已失效，请重新登录。' });
  req.user = user;
  next();
};

const authenticateSocket = (socket, next) => {
  const user = getAuthenticatedUser(socket.handshake.headers.cookie);
  if (!user) return next(new Error('unauthorized'));
  socket.data.user = user;
  next();
};

module.exports = {
  authenticateSocket,
  requireAuth,
};
