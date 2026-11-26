const { monitorEventLoopDelay } = require('node:perf_hooks');

// Only fixed metric names and provider channels are recorded. Keep a bounded sample
// for percentiles while counting every observation in the reporting interval.
const series = new Map();
function observe(name, value, { channel = '', outcome = '' } = {}) {
  if (!Number.isFinite(value)) return;
  const key = [name, channel, outcome].join('/');
  let row = series.get(key);
  if (!row) {
    row = { name, channel, outcome, count: 0, sum: 0, max: value, samples: [] };
    series.set(key, row);
  }
  row.samples[row.count % 512] = value;
  row.count++;
  row.sum += value;
  row.max = Math.max(row.max, value);
}

function flush() {
  const rows = [];
  for (const { samples, ...summary } of series.values()) {
    samples.sort((a, b) => a - b);
    const percentile = p => Math.round(100 * samples[Math.ceil(samples.length * p) - 1]) / 100;
    rows.push({ ...summary, p50: percentile(0.5), p95: percentile(0.95) });
  }
  series.clear();
  return rows;
}

function startReporting(intervalMs) {
  if (!intervalMs) return;
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  const timer = setInterval(() => {
    const metrics = flush();
    if (metrics.length) console.log(JSON.stringify({ type: 'trpg_performance', intervalMs,
      eventLoopP95Ms: Math.round(lag.percentile(95) / 10000) / 100, metrics }));
    lag.reset();
  }, intervalMs);
  timer.unref();
}

module.exports = { observe, flush, startReporting };
