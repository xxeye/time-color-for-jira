// @ts-check
/** @import { JiraError, JiraField, JiraIssue, JiraIssueType, JiraLinkTypes, JiraMyself, JiraProject, JiraPropertyEnvelope, JiraSearchPage } from './types/jira' */
/* Fixed same-origin read-only requests. Credentials are never read or stored. */
(/** @param {typeof globalThis} root */ function (root) {
  'use strict';
  const abortError = () => new DOMException('Cancelled', 'AbortError');
  // Most issue keys per searchByKeys call; also the page size asked from Jira.
  const MAX_BATCH = 50;
  /** @param {number} ms @param {AbortSignal} [signal] @returns {Promise<void>} */
  function sleep(ms, signal) {
    return new Promise((/** @type {() => void} */ resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const done = () => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      };
      const timer = setTimeout(done, ms);
      const cancel = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        reject(abortError());
      };
      signal?.addEventListener('abort', cancel, { once: true });
    });
  }
  /**
   * @param {{ origin: string, fetchImpl?: typeof fetch, wait?: typeof sleep, timeout?: number }} options
   */
  function createApi({ origin, fetchImpl = (...args) => fetch(...args), wait = sleep, timeout = 15000 } = /** @type {{ origin: string }} */ ({})) {
    const base = new URL(origin);
    if (
      base.protocol !== 'https:' ||
      !/^[a-z0-9-]+\.atlassian\.net$/i.test(base.hostname) ||
      base.username ||
      base.password ||
      base.port
    )
      throw new Error('Invalid Jira origin');
    const key = (/** @type {unknown} */ k) => {
      if (typeof k !== 'string' || !/^[A-Z][A-Z0-9_]*-\d+$/i.test(k)) throw new Error('Invalid issue key');
      return k;
    };
    const fields = (/** @type {unknown} */ fs) => {
      if (
        !Array.isArray(fs) ||
        fs.length > 30 ||
        fs.some((/** @type {unknown} */ f) => !/^(issuetype|duedate|issuelinks|project|status|summary|customfield_\d+)$/.test(String(f)))
      )
        throw new Error('Invalid fields');
      return [...new Set(fs)];
    };
    /** @typedef {{ signal?: AbortSignal }} RequestOptions */
    // Resolves to the parsed JSON body, unchecked; each caller below names the shape Jira documents.
    /** @param {string} path @param {unknown} body @param {RequestOptions} [options] @returns {Promise<unknown>} */
    async function request(path, body, { signal } = {}) {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (signal?.aborted) throw abortError();
        const controller = new AbortController(),
          cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, timeout);
        /** @type {Response | undefined} */
        let res;
        /** @type {unknown} */
        let value;
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
          /** @type {JiraError} */
          const safe = new Error(controller.signal.aborted ? 'Jira request timed out' : 'Jira request unavailable');
          safe.code = controller.signal.aborted ? 'timeout' : 'network';
          throw safe;
        } finally {
          clearTimeout(timer);
          signal?.removeEventListener('abort', cancel);
        }
        if (signal?.aborted) throw abortError();
        // res is set: fetchImpl either resolved or the catch above threw.
        if (!res) throw new Error('Jira request unavailable');
        if (res.ok) return value;
        /** @type {JiraError} */
        const error = new Error('Jira request failed');
        error.status = res.status;
        if (![429, 503].includes(res.status) || attempt === 3) throw error;
        const raw = res.headers?.get('Retry-After'),
          parsed = raw && (/^\d+(\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now());
        const delay =
          raw && typeof parsed === 'number' && Number.isFinite(parsed) ? Math.max(0, parsed) : 2000 * 2 ** attempt + Math.floor(Math.random() * 500);
        if (delay > 300000) {
          error.retryAfterMs = delay;
          throw error;
        }
        await wait(delay, signal);
      }
    }
    /** @param {unknown} keys @param {unknown} [fs] @param {RequestOptions} [options] @returns {Promise<JiraIssue[]>} */
    async function searchByKeys(keys, fs = ['issuetype'], options = {}) {
      if (!Array.isArray(keys) || keys.length > MAX_BATCH) throw new Error('Invalid batch');
      keys.forEach(key);
      const wanted = fields(fs);
      if (!keys.length) return [];
      const jql = `key in (${[...new Set(keys)].map((k) => `"${k}"`).join(',')})`,
        /** @type {JiraIssue[]} */
        issues = [],
        tokens = new Set();
      /** @type {unknown} */
      let nextPageToken;
      for (let page = 0; page < 100; page++) {
        const data = /** @type {JiraSearchPage | null} */ (
          await request(
          '/rest/api/3/search/jql',
          { jql, fields: wanted, maxResults: MAX_BATCH, ...(nextPageToken ? { nextPageToken } : {}) },
          options,
        ));
        if (!Array.isArray(data?.issues)) throw new Error('Invalid Jira response');
        issues.push(.../** @type {JiraIssue[]} */ (data.issues));
        nextPageToken = data.nextPageToken;
        if (data.isLast === true || !nextPageToken) return issues;
        if (typeof nextPageToken !== 'string' || tokens.has(nextPageToken)) throw new Error('Invalid Jira pagination');
        tokens.add(nextPageToken);
      }
      throw new Error('Jira page limit reached');
    }
    return {
      maxBatch: MAX_BATCH,
      searchByKeys,
      sleep,
      getFields: (/** @type {RequestOptions} */ o) => /** @type {Promise<JiraField[] | null>} */ (request('/rest/api/3/field', null, o)),
      getTypes: (/** @type {RequestOptions} */ o) => /** @type {Promise<JiraIssueType[] | null>} */ (request('/rest/api/3/issuetype', null, o)),
      getLinkTypes: (/** @type {RequestOptions} */ o) => /** @type {Promise<JiraLinkTypes | null>} */ (request('/rest/api/3/issueLinkType', null, o)),
      getMyself: (/** @type {RequestOptions} */ o) => /** @type {Promise<JiraMyself | null>} */ (request('/rest/api/3/myself', null, o)),
      // The admin-maintained profile (PROJECT_PROFILE.md). Resolves null when the project has none.
      /** @param {unknown} projectId @param {RequestOptions} [o] @returns {Promise<JiraPropertyEnvelope | null>} */
      getProjectProperty: (projectId, o) => {
        if (!/^\d+$/.test(String(projectId))) return Promise.reject(new Error('Invalid project'));
        const read = /** @type {Promise<JiraPropertyEnvelope | null>} */ (
          request(`/rest/api/3/project/${projectId}/properties/time-color-for-jira`, null, o)
        );
        return read.catch((/** @type {JiraError} */ e) => {
          if (e.status === 404) return null;
          throw e;
        });
      },
      /** @param {string} k @param {RequestOptions} [o] @returns {Promise<JiraProject | null>} */
      getProject: (k, o) => {
        if (!/^[A-Z][A-Z0-9_]*$|^\d+$/i.test(k)) return Promise.reject(new Error('Invalid project'));
        return /** @type {Promise<JiraProject | null>} */ (request('/rest/api/3/project/' + encodeURIComponent(k), null, o));
      },
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createApi, sleep };
  else root.JiraApi = createApi({ origin: location.origin });
})(globalThis);
