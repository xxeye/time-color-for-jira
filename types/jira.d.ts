// Jira REST responses, only the parts this extension reads.
// The data is not validated against these shapes: every level is optional and the code reads it with
// optional chaining, and text shown to the user is re-checked with typeof (issue_rules.js). Custom
// fields are `unknown`. Treat these as "what Jira documents", not as a guarantee.

export interface JiraStatusCategoryRef {
  statusCategory?: { key?: string };
}

/** A linked issue as embedded in `issuelinks`. */
export interface JiraLinkedIssue {
  id?: string;
  key?: string;
  fields?: {
    summary?: unknown;
    status?: JiraStatusCategoryRef;
    issuetype?: { id?: string | number; name?: unknown; iconUrl?: unknown };
  };
}

export interface JiraIssueLink {
  type?: { id?: string | number };
  inwardIssue?: JiraLinkedIssue;
  outwardIssue?: JiraLinkedIssue;
}

export interface JiraProject {
  id?: string | number;
  key?: string;
}
export interface JiraMyself {
  accountId?: string;
}
export interface JiraField {
  id?: string;
  schema?: { type?: string };
}
export interface JiraIssueType {
  id?: string | number;
}
export interface JiraLinkTypes {
  issueLinkTypes?: { id?: string | number }[];
}
/** /project/{id}/properties/{key}; `value` goes through settings.validateProperty. */
export interface JiraPropertyEnvelope {
  key?: string;
  value?: unknown;
}
/** One page of /rest/api/3/search/jql; searchByKeys checks each field before use. */
export interface JiraSearchPage {
  issues?: unknown;
  nextPageToken?: unknown;
  isLast?: unknown;
}
/** Errors thrown by jiraApi.js. */
export type JiraError = Error & {
  /** no HTTP response: timed out or the network failed */
  code?: 'timeout' | 'network';
  /** HTTP status of a failed response */
  status?: number;
  /** a 429/503 asked to wait longer than the extension retries */
  retryAfterMs?: number;
};

/** One issue from /rest/api/3/search/jql with the requested fields. */
export interface JiraIssue {
  key?: string;
  fields?: {
    issuetype?: { id?: string | number };
    issuelinks?: unknown;
    duedate?: unknown;
    /** Custom fields (role, start date, target end, epic highlight) */
    [field: string]: unknown;
  };
}
