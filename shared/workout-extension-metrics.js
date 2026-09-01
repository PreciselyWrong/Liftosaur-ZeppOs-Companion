export function parseSportDataResult(result, metricType) {
  if (!result || result.code !== 0 || typeof result.data !== 'string') {
    return { ok: false, value: null, error: 'Sport data unavailable' };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.data);
  } catch (err) {
    return { ok: false, value: null, error: 'Malformed sport data' };
  }

  const items = Array.isArray(parsed) ? parsed : [parsed];
  const match = items.find(
    (item) => item && typeof item === 'object' && metricType in item,
  );
  return match
    ? { ok: true, value: String(match[metricType]), error: null }
    : { ok: false, value: null, error: 'Metric not found' };
}
