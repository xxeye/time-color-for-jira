# Project settings property (Jira project property) format

English | [中文](PROJECT_PROFILE.zh-TW.md)

> A second source of settings for the extension: a Jira admin (or admin tool) writes the whole configuration to a **project property**,
> so users can open the Timeline right after installing the extension, with no file to import.
> Format version: 1 | Last updated: 2026-09-27
>
> This English version is authoritative. Update the Chinese version in the same change.

## Lookup order

| Priority | Source | Notes |
|---|---|---|
| 1 | Project property `time-color-for-jira` | On the project of the current Timeline. Used only if valid; if invalid, the panel shows why and the next source is used |
| 2 | Imported configuration file | `sites.<site>.projects.<project ID>`, falling back to `sites.<site>.defaults` |

- Both sources use exactly the same `profile` format (see below).
- A user's own switches in the extension panel override the defaults in `profile.settings`.
- Reading uses the user's own Jira sign-in: `GET /rest/api/3/project/{project ID}/properties/time-color-for-jira`, which needs the Browse Projects permission. **Anyone who can browse the project can read the property**, so don't put secrets in it.
- Writing needs administer permission on the project: `PUT /rest/api/3/project/{project ID or key}/properties/time-color-for-jira`.

## Compatibility (2026-09-27)

Store updates to the extension wait for review, so an admin tool can be newer than the extension users have installed.

| Case | What the extension does | Rule for admin tools |
|---|---|---|
| Unknown field or setting key (at any level) | **Ignores it and uses the rest of the settings**; the panel notes "items not supported by this version". Dangerous keys such as `__proto__` still reject the whole value | Only start writing a new field after an extension version that supports it is live in the store |
| Known field with a wrong type, an unknown enum value, a missing required field, or a value out of range | Rejects the whole value (falls back to the imported configuration file) | Must never happen; such a change is incompatible |
| Incompatible format change | Rejects the whole value if `schemaVersion` isn't 1 | Increase `schemaVersion` by 1, and publish only after the new extension is live and users have updated |

The same applies to configuration files (imported JSON): unknown fields are ignored, and what gets saved is the content with those fields removed.

## Property value

```json
{
  "schemaVersion": 1,
  "template": { "id": "planning-timeline", "version": 1 },
  "profile": { "...": "see below" },
  "generatedBy": "Example Admin Tool",
  "updatedAt": "2026-09-25T10:00:00Z"
}
```

| Field | Required | Notes |
|---|---|---|
| `schemaVersion` | ✅ | Always `1` |
| `template` | ✅ | Always `{ "id": "planning-timeline", "version": 1 }` |
| `profile` | ✅ | The settings |
| `generatedBy`, `updatedAt` | | Display only ("settings source" in the panel), up to 100 characters |

## profile

| Field | Required | Format |
|---|---|---|
| `revision` | ✅ | Positive integer; add 1 on every change |
| `issueTypes` | ✅ | `{ planning: [ID], milestone: [ID], epic: [ID] }`, issue type IDs as strings; an ID can't appear in two groups |
| `fields` | ✅ | `{ role, epicHighlight, startDate, targetEnd }`, each `customfield_<number>` or `null` |
| `highlightRule` | ✅ | `{ operator: "equals", value: "string" }`: an Epic whose `epicHighlight` field equals this value gets a dashed stripe |
| `progress` | ✅ | `{ enabled, linkTypeIds: [ID], direction: "both" \| "inward" \| "outward", inProgressWeight: 0–1 }` |
| `calendar` | ✅ | See below |
| `settings` | ✅ | Display defaults, see below; only the keys you want to change are needed |
| `timelinePath` | ✅ | Empty string, or a custom Timeline path (e.g. `/jira/software/projects/ABC/timeline`) |

The public configuration generator doesn't offer the Epic dashed stripe settings (`epicHighlight`, `highlightRule`, `epicStripe`), but they still take effect when present in an imported file or a project property.

### calendar

```json
{
  "weekendDays": [0, 6],
  "holidays": [{ "date": "2027-01-01", "name": "New Year's Day" }],
  "workdays": [{ "date": "2027-02-20", "name": "Make-up workday" }]
}
```

| Field | Required | Notes |
|---|---|---|
| `weekendDays` | ✅ | Weekly days off, 0 = Sunday to 6 = Saturday |
| `holidays` | | Days off that aren't weekend days, up to 300 entries |
| `workdays` | | Make-up workdays (weekend days that are worked), up to 100 entries |

- `date` is `YYYY-MM-DD`. `name` is optional, up to 50 characters, with no `<`, `>` or control characters. A date can't appear twice.
- **Covered years**: every year that appears in `holidays` or `workdays` is treated as complete. Working days aren't shown for ranges that cross a year with no data.
- `sourceUrl` and `region` (ICS calendars) from older configuration files are ignored.

### settings (display defaults)

| Key | Type | Default | Notes |
|---|---|---|---|
| `enabled` | boolean | `true` | Master switch |
| `ptColorEnabled`, `ptColor` | boolean, `#RRGGBB` | `true`, `#6a9a23` | Planning Task color |
| `msColorEnabled`, `msColor` | boolean, `#RRGGBB` | `true`, `#FF8B00` | Milestone color |
| `msDiamond` | boolean | `true` | Show Milestones as diamonds |
| `msShowProgress` | boolean | `true` | Milestone progress badge |
| `ptTargetEndShade` | boolean | `false` | Shade Planning Tasks after the target end date (needs the `startDate` and `targetEnd` fields) |
| `ptLockDrag`, `epicLockDrag` | boolean | `false` | Lock dragging and resizing of Planning Task / Epic bars on the Timeline (the issue opens from its name in the left column). Extension 1.0.0 ignores these keys; later versions apply them |
| `epicStripe` | boolean | `false` | Dashed stripe on Epics matching `highlightRule` (needs the `epicHighlight` field) |
| `hideCurrentMonth`, `hideIssueKey` | boolean | `true`, `false` | Hide the current period highlight; hide issue keys |
| `showWeekends`, `showHolidays`, `showWorkingDays` | boolean | `true` | Weekend and holiday shading, and working days |

## Turning off project settings

A project property is data stored on the Jira project. **It stays after the admin tool that wrote it is removed**, the extension keeps preferring it, and imported configuration files don't take effect for that project.

- If the admin tool can clear its settings: clear them for every project before removing the tool.
- Otherwise: with an account that can administer the project, delete the property: `DELETE /rest/api/3/project/{project key}/properties/time-color-for-jira`.

## Test data

`tests/fixtures/project-property.json` holds valid and invalid cases, each marked with whether the extension (`extension`) and the admin tool that writes the property (`forge`) must accept or reject it. Tests on both sides read it and run each case through their own validation. To add cases, edit `tests/fixtures/make-project-property.mjs`, then run `node tests/fixtures/make-project-property.mjs tests/fixtures` to regenerate.

## Limits

- Project property: the whole `profile` must be at most 16,000 bytes (JSON, UTF-8).
- Configuration file: each `profile` must be at most 7,000 bytes (it is stored in Chrome sync storage, where one item is limited to 8 KB); only include the holiday years you need.
- All other validation rules are the same as for configuration files (`validateConfig` in `settings.js`).
