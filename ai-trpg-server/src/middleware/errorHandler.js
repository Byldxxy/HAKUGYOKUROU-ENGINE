// SECTION: 统一错误响应
// NOTE: 路由层 throw 或 next(error) 后统一在这里转成 JSON，避免前端收到 HTML 错误页。
const errorHandler = (error, req, res, next) => {
  const statusCode = error.statusCode || 500;
  if (statusCode >= 500) {
    // NOTE: 4xx 是业务校验失败，5xx 才打印完整堆栈方便排查。
    console.error('❌ 服务端错误:', error);
  }

  res.status(statusCode).json({
    success: false,
    error: error.message || '服务器发生未知错误。',
  });
};

module.exports = errorHandler;
