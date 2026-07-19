export const SOURCE_TIMESTAMP_FIELDS = Object.freeze([
  'source_updated_at',
  'content_changed_at',
  'vod_time',
  'vod_time_add',
  'vod_pubdate',
]);

export const SOURCE_TIMESTAMP_MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

function text(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

export function parseSourceTimestampMs(value) {
  const normalized = text(value);
  if (!normalized) return 0;
  const local = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2}))?)?)?$/u);
  if (local) {
    const [, year, month, day, hour = '0', minute = '0', second = '0'] = local;
    return Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) - 8, Number(minute), Number(second));
  }
  const numericValue = Number(normalized);
  if (Number.isFinite(numericValue) && numericValue > 0) return numericValue > 1e12 ? numericValue : numericValue * 1000;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function inspectSourceTimestamp(value, options = {}) {
  const raw = text(value);
  const parsedMs = parseSourceTimestampMs(raw);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const maxFutureSkewMs = Math.max(0, Number(options.maxFutureSkewMs ?? SOURCE_TIMESTAMP_MAX_FUTURE_SKEW_MS));
  if (!raw) return { raw, parsedMs: 0, effectiveMs: 0, status: 'missing' };
  if (!parsedMs) return { raw, parsedMs: 0, effectiveMs: 0, status: 'invalid' };
  if (parsedMs > nowMs + maxFutureSkewMs) return { raw, parsedMs, effectiveMs: 0, status: 'future-rejected' };
  if (parsedMs > nowMs) return { raw, parsedMs, effectiveMs: nowMs, status: 'clock-skew-capped' };
  return { raw, parsedMs, effectiveMs: parsedMs, status: 'ok' };
}

export function latestPlausibleSourceTimestamp(input, options = {}) {
  const rows = Array.isArray(input) ? input : [input];
  const fields = Array.isArray(options.fields) && options.fields.length ? options.fields : SOURCE_TIMESTAMP_FIELDS;
  let latest = { raw: '', field: '', parsedMs: 0, effectiveMs: 0, status: 'missing' };
  const anomalies = [];
  for (const row of rows) {
    for (const field of fields) {
      const evidence = inspectSourceTimestamp(row?.[field], options);
      if (evidence.status === 'future-rejected' || evidence.status === 'clock-skew-capped' || evidence.status === 'invalid') {
        anomalies.push({ field, ...evidence });
      }
      if (evidence.effectiveMs > latest.effectiveMs) latest = { field, ...evidence };
    }
  }
  return {
    ...latest,
    ms: latest.effectiveMs,
    iso: latest.effectiveMs ? new Date(latest.effectiveMs).toISOString() : '',
    anomalies,
    futureRejectedCount: anomalies.filter((row) => row.status === 'future-rejected').length,
    clockSkewCappedCount: anomalies.filter((row) => row.status === 'clock-skew-capped').length,
  };
}

export default Object.freeze({
  SOURCE_TIMESTAMP_FIELDS,
  SOURCE_TIMESTAMP_MAX_FUTURE_SKEW_MS,
  inspectSourceTimestamp,
  latestPlausibleSourceTimestamp,
  parseSourceTimestampMs,
});
