const errorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    console.error('❌ 服务端错误:', error);
  }

  res.status(statusCode).json({
    success: false,
    error: error.message || '服务器发生未知错误。',
  });
};

module.exports = errorHandler;
