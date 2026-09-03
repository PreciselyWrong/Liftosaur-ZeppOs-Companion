export function withRequestTimeout(
  request,
  {
    timeoutMs,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('timeoutMs must be a positive number'));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      const error = new Error('Phone request timeout');
      error.code = 'NETWORK';
      reject(error);
    }, timeoutMs);

    Promise.resolve(request).then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimer(timer);
        reject(error);
      }
    );
  });
}
