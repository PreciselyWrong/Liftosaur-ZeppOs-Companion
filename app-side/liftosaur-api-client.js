export function redactSecret(secret) {
  if (!secret) return '<empty>';
  const str = String(secret);
  if (str.length <= 8) return '***';
  if (str.startsWith('Bearer ')) {
    return 'Bearer ' + redactSecret(str.slice(7));
  }
  const prefix = str.slice(0, 6);
  const suffix = str.slice(-4);
  return `${prefix}***${suffix}`;
}

export class LiftosaurApiError extends Error {
  constructor(message, { status, endpoint, rawBody = '' }) {
    // Redact any potential secret in the error message or raw body
    const cleanMsg = message.replace(/lftsk_[a-zA-Z0-9_-]+/g, 'lftsk_***');
    super(`[Liftosaur API ${status || 'Error'}] ${cleanMsg}`);
    this.name = 'LiftosaurApiError';
    this.status = status;
    this.endpoint = endpoint;
  }
}

export function createLiftosaurApiClient({
  apiKey,
  baseUrl = 'https://www.liftosaur.com/api',
  fetcher = typeof fetch !== 'undefined' ? fetch : null,
} = {}) {
  async function request(endpoint, { method = 'GET', body = null } = {}) {
    if (!fetcher) {
      throw new LiftosaurApiError('No HTTP fetcher available', { status: 0, endpoint });
    }

    const url = `${baseUrl}${endpoint}`;
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    let response;
    try {
      response = await fetcher(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      throw new LiftosaurApiError(`Network failure: ${networkErr.message || 'unknown'}`, {
        status: 0,
        endpoint,
      });
    }

    if (!response.ok) {
      let errText = '';
      try {
        errText = await response.text();
      } catch (e) {}
      throw new LiftosaurApiError(
        `Request to ${endpoint} failed with HTTP ${response.status}: ${response.statusText}`,
        {
          status: response.status,
          endpoint,
          rawBody: errText,
        }
      );
    }

    try {
      return await response.json();
    } catch (parseErr) {
      throw new LiftosaurApiError(`Invalid JSON response from ${endpoint}`, {
        status: response.status,
        endpoint,
      });
    }
  }

  return {
    async getCurrentProgram() {
      return request('/program');
    },

    async getWorkoutDay(dayIndex = 0) {
      return request(`/workout/day/${dayIndex}`);
    },

    async runPlaygroundSimulation(scriptText) {
      return request('/playground', {
        method: 'POST',
        body: { script: scriptText },
      });
    },
  };
}
