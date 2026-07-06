const buckets = new Map();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  buckets.forEach((bucket, key) => {
    if (bucket.resetAt <= now) buckets.delete(key);
  });
}, 10 * 60 * 1000);
cleanupTimer.unref();

const createRateLimit = ({ windowMs, max, message }) => (req, res, next) => {
  const now = Date.now();
  const key = `${req.ip}:${req.path}`;
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;

  bucket.count += 1;
  buckets.set(key, bucket);
  res.setHeader('RateLimit-Limit', max);
  res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));
  res.setHeader('RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));

  if (bucket.count > max) {
    return res.status(429).json({ success: false, error: message || '请求过于频繁，请稍后重试。' });
  }
  next();
};

module.exports = createRateLimit;
