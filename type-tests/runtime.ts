// Type contract tests for jiraApi.js and runtime_session.js. Nothing here runs.
import type { JiraIssue } from '../types/jira';
import type { SessionResult, SessionState, StatusState } from '../types/runtime';

const api = globalThis.JiraApi;

async function jira() {
  const issues: JiraIssue[] = await api.searchByKeys(['DEMO-1'], ['issuetype']);
  const property = await api.getProjectProperty('10001');
  // @ts-expect-error the property may be missing
  property.value;
  // @ts-expect-error the property value is unvalidated JSON
  const profile: { profile: unknown } = property?.value;
  void [issues, profile];
}
void jira;

// A session result has one of the states load() can produce.
declare const session: InstanceType<typeof globalThis.JptSession.RuntimeSession>;
async function load() {
  const result: SessionResult = await session.load('https://demo.atlassian.net', 'DEMO');
  const state: SessionState = result.state;
  const status: StatusState = state;
  // @ts-expect-error the page adds 'checking' itself; load() never returns it
  const checking: SessionState = 'checking';
  void [status, checking];
}
void load;
