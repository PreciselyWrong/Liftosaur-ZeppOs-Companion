/**
 * The only component in this project that speaks HTTP to Liftosaur Cloud.
 *
 * Every method maps one-to-one onto a documented `https://www.liftosaur.com/api/v1`
 * endpoint and returns the unwrapped `data` object. No endpoint is inferred and
 * no response is reshaped: callers see what the API said.
 */

export function redactSecret(secret) {
  if (!secret) return '<empty>';
  const str = String(secret);
  if (str.startsWith('Bearer ')) {
    return 'Bearer ' + redactSecret(str.slice(7));
  }
  if (str.length <= 8) return '***';
  return `${str.slice(0, 6)}***${str.slice(-4)}`;
}

function redactMessage(message) {
  return String(message || '').replace(/lftsk_[a-zA-Z0-9_-]+/g, 'lftsk_***');
}

export class LiftosaurApiError extends Error {
  constructor(message, { status = 0, endpoint = '', code = null } = {}) {
    super(`[Liftosaur API ${status || 'Error'}] ${redactMessage(message)}`);
    this.name = 'LiftosaurApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.code = code;
    this.apiMessage = redactMessage(message);
  }
}

export function createLiftosaurApiClient({
  apiKey,
  baseUrl = 'https://www.liftosaur.com/api/v1',
  fetcher = typeof fetch !== 'undefined' ? fetch : null,
} = {}) {
  async function request(endpoint, { method = 'GET', body = null } = {}) {
    if (!fetcher) {
      throw new LiftosaurApiError('No HTTP fetcher available', { status: 0, endpoint });
    }
    if (!apiKey) {
      throw new LiftosaurApiError('No API key configured', { status: 401, endpoint, code: 'NO_API_KEY' });
    }

    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };

    let response;
    try {
      response = await fetcher(`${baseUrl}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      throw new LiftosaurApiError(`Network failure: ${networkErr?.message || 'unknown'}`, {
        status: 0,
        endpoint,
        code: 'NETWORK',
      });
    }

    let parsed = null;
    let rawText = '';
    try {
      rawText = await response.text();
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (parseErr) {
      parsed = null;
    }

    if (!response.ok) {
      const apiMessage =
        parsed?.error?.message || parsed?.error || parsed?.message || rawText || response.statusText;
      throw new LiftosaurApiError(apiMessage, {
        status: response.status,
        endpoint,
        code: parsed?.error?.code || null,
      });
    }

    if (parsed === null) {
      throw new LiftosaurApiError(`Invalid JSON response from ${endpoint}`, {
        status: response.status,
        endpoint,
        code: 'BAD_JSON',
      });
    }

    return parsed.data !== undefined ? parsed.data : parsed;
  }

  return {
    /** GET /programs -> [{ id, name, isCurrent }] */
    async listPrograms() {
      const data = await request('/programs');
      return Array.isArray(data?.programs) ? data.programs : [];
    },

    /** GET /programs/:id -> { id, name, text, isCurrent }. `current` selects the active one. */
    async getProgram(id = 'current') {
      return request(`/programs/${encodeURIComponent(id)}`);
    },

    /** PUT /programs/:id -> { id, name, text, isCurrent } */
    async updateProgram(id, { text, name = null } = {}) {
      return request(`/programs/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: { text, ...(name ? { name } : {}) },
      });
    },

    /** POST /playground -> { workout, updatedProgramText? } */
    async runPlayground({ programText, week = null, day = null, commands = [] } = {}) {
      return request('/playground', {
        method: 'POST',
        body: {
          programText,
          ...(week !== null && week !== undefined ? { week } : {}),
          ...(day !== null && day !== undefined ? { day } : {}),
          ...(Array.isArray(commands) && commands.length > 0 ? { commands } : {}),
        },
      });
    },

    /** POST /program-stats -> { days: [{ name, approxMinutes, workingSets }], ... } */
    async getProgramStats(programText) {
      return request('/program-stats', { method: 'POST', body: { programText } });
    },

    /** GET /gyms -> { currentGymId, gyms: [{ id, name, isCurrent, equipmentCount }] } */
    async listGyms() {
      const data = await request('/gyms');
      return {
        currentGymId: data?.currentGymId ?? null,
        gyms: Array.isArray(data?.gyms) ? data.gyms : [],
      };
    },

    /** GET /gyms/:gymId/equipment -> [{ id, bar, multiplier, isFixed, plates, fixed, isDeleted }] */
    async listEquipment(gymId) {
      const data = await request(`/gyms/${encodeURIComponent(gymId)}/equipment`);
      return Array.isArray(data?.equipment) ? data.equipment : [];
    },

    /** GET /exercise-data -> [{ key, exerciseName, rm1, rounding, equipment, isUnilateral }] */
    async listExerciseData() {
      const data = await request('/exercise-data');
      return Array.isArray(data?.exerciseData) ? data.exerciseData : [];
    },

    /** GET /history -> { records: [{ id, text }], hasMore, nextCursor? } */
    async listHistory({ limit = 20, cursor = null, startDate = null, endDate = null } = {}) {
      const query = [`limit=${encodeURIComponent(limit)}`];
      if (cursor) query.push(`cursor=${encodeURIComponent(cursor)}`);
      if (startDate) query.push(`startDate=${encodeURIComponent(startDate)}`);
      if (endDate) query.push(`endDate=${encodeURIComponent(endDate)}`);
      const data = await request(`/history?${query.join('&')}`);
      return {
        records: Array.isArray(data?.records) ? data.records : [],
        hasMore: Boolean(data?.hasMore),
        nextCursor: data?.nextCursor ?? null,
      };
    },

    /** POST /history -> { id, text } */
    async createHistoryRecord(text) {
      return request('/history', { method: 'POST', body: { text } });
    },

    /** PUT /history/:id -> { id, text } */
    async updateHistoryRecord(id, text) {
      return request(`/history/${encodeURIComponent(id)}`, { method: 'PUT', body: { text } });
    },

    /** DELETE /history/:id -> { deleted: true } */
    async deleteHistoryRecord(id) {
      return request(`/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
