/* Fixed same-origin read-only requests. Credentials are never read or stored. */
(function (root) {
  'use strict';
  const abortError = () => new DOMException('Cancelled', 'AbortError');
  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const done = () => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      };
      const timer = setTimeout(done, ms);
      const cancel = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        reject(abortError());
      };
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  function createApi({ origin, fetchImpl = (...args) => fetch(...args), wait = sleep, timeout = 15000 } = {}) {
    const base = new URL(origin);
    if (
      base.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.atlassian\.net$/i.test(base.hostname) ||
      base.username ||
      base.password ||
      base.port
    )
      throw new Error('Invalid Jira origin');
    const key = (k) => {
      if (typeof k !== 'string' || !/^[A-Z][A-Z0-9_]*-\d+$/i.test(k)) throw new Error('Invalid issue key');
      return k;
    };
    const fields = (fs) => {
      if (
        !Array.isArray(fs) ||
        fs.length > 30 ||
        fs.some((f) => !/^(issuetype|duedate|issuelinks|project|status|summary|customfield_\d+)$/.test(f))
      )
        throw new Error('Invalid fields');
      return [...new Set(fs)];
    };
    async function request(path, body, { signal } = {}) {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (signal?.aborted) throw abortError();
        const controller = new AbortController(),
          cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, timeout);
        let res, value;
        try {
          res = await fetchImpl(base.origin + path, {
            method: body ? 'POST' : 'GET',
            credentials: 'include',
            redirect: 'error',
            cache: 'no-store',
            headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
          });
          if (res.ok) value = await res.json();
        } catch (e) {
          if (signal?.aborted) throw abortError();
          const safe = new Error(controller.signal.aborted ? 'Jira request timed out' : 'Jira request unavailable');
          safe.code = controller.signal.aborted ? 'timeout' : 'network';
          throw safe;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
        }
        if (signal?.aborted) throw abortError();
        if (res.ok) return value;
        const error = new Error('Jira request failed');
        error.status = res.status;
        if (![429, 503].includes(res.status) || attempt === 3) throw error;
        const raw = res.headers?.get('Retry-After'),
          parsed = raw && (/^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now());
        const delay =
          raw && Number.isFinite(parsed) ? Math.max(0, parsed) : 2000 * 2 ** attempt + Math.floor(Math.random() * 500);
        if (delay > 300000) {
          error.retryAfterMs = delay;
          throw error;
        }
        await wait(delay, signal);
      }
    }
    async function searchByKeys(keys, fs = ['issuetype'], options = {}) {
      if (!Array.isArray(keys) || keys.length > 50) throw new Error('Invalid batch');
      keys.forEach(key);
      fs = fields(fs);
      if (!keys.length) return [];
      const jql = `key in (${[...new Set(keys)].map((k) => `"${k}"`).join(',')})`,
        issues = [],
        tokens = new Set();
      let nextPageToken;
      for (let page = 0; page < 100; page++) {
        const data = await request(
          '/rest/api/3/search/jql',
          { jql, fields: fs, maxResults: 50, ...(nextPageToken ? { nextPageToken } : {}) },
          options,
        );
        if (!Array.isArray(data?.issues)) throw new Error('Invalid Jira response');
        issues.push(...data.issues);
        nextPageToken = data.nextPageToken;
        if (data.isLast === true || !nextPageToken) return issues;
        if (typeof nextPageToken !== 'string' || tokens.has(nextPageToken)) throw new Error('Invalid Jira pagination');
        tokens.add(nextPageToken);
      }
      throw new Error('Jira page limit reached');
    }
    return {
      searchByKeys,
      sleep,
      getIssue: (k, fs = ['issuetype'], o = {}) =>
        Promise.resolve().then(() =>
          request(`/rest/api/3/issue/${encodeURIComponent(key(k))}?fields=${fields(fs).join(',')}`, null, o),
        ),
      getFields: (o) => request('/rest/api/3/field', null, o),
      getTypes: (o) => request('/rest/api/3/issuetype', null, o),
      getLinkTypes: (o) => request('/rest/api/3/issueLinkType', null, o),
      getMyself: (o) => request('/rest/api/3/myself', null, o),
      // The admin-maintained profile (PROJECT_PROFILE.md). Resolves null when the project has none.
      getProjectProperty: (projectId, o) => {
        if (!/^\d+$/.test(String(projectId))) return Promise.reject(new Error('Invalid project'));
        return request(`/rest/api/3/project/${projectId}/properties/time-color-for-jira`, null, o).catch((e) => {
          if (e.status === 404) return null;
          throw e;
        });
      },
      getProject: (k, o) => {
        if (!/^[A-Z][A-Z0-9_]*$|^\d+$/i.test(k)) return Promise.reject(new Error('Invalid project'));
        return request('/rest/api/3/project/' + encodeURIComponent(k), null, o);
      },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createApi, sleep };
  else root.JiraApi = createApi({ origin: location.origin });
})(globalThis);
