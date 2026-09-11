export function normalizeGetReadySeconds(value) {
  let candidate = value;
  if (typeof candidate === 'string') {
    try { candidate = JSON.parse(candidate); } catch (_) { /* Select can return plain text. */ }
  }
  if (candidate && typeof candidate === 'object') candidate = candidate.value;
  if (typeof candidate !== 'number' && typeof candidate !== 'string') return 5;
  if (typeof candidate === 'string' && !candidate.trim()) return 5;
  const seconds = Number(candidate);
  return [0, 3, 5, 10].includes(seconds) ? seconds : 5;
}
