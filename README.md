# Time color for Jira

English | [中文](README.zh-TW.md)

A Chrome extension that makes the Jira Cloud Timeline easier to read. It colors Planning Tasks, Milestones and Epics the way your team sets them up, marks weekends and public holidays on the timeline, and shows working days when you hover over a bar.

> This is an independent tool and is not affiliated with Atlassian. Jira is a trademark of Atlassian.

Website: <https://xxeye.github.io/time-color-for-jira/>

## Features

- **Issue type colors**: separate colors for Planning Tasks and Milestones; Milestones can show as diamonds
- **Weekends and holidays**: holidays and make-up workdays listed by your admin (in a configuration file or the Jira project settings); no external calendar is contacted
- **Working days**: hover over or drag a bar to see its working days, with weekends and holidays excluded
- **Milestone progress**: linked issues, progress and due date
- **Drag locks (optional)**: stop Planning Task or Epic bars from being dragged or resized by accident; open the issue from its name in the left column
- **Project settings**: an admin saves the settings in a Jira project property (format: [PROJECT_PROFILE.md](PROJECT_PROFILE.md)), and they apply as soon as teammates open the Timeline
- **Configuration generator for admins**: fill in a form on the settings page instead of writing JSON

## Supported

- Project Timelines on Jira Cloud (`https://*.atlassian.net`)
- Not yet supported: Jira Server, Data Center and custom domains
- Extension language: English (default) and Traditional Chinese, following your browser language
- Jira language: English and Traditional Chinese

## Install

Coming soon to the Chrome Web Store. You can also install it manually:

If no release is available yet, download or clone this repository, run `python pack.py`, and use the generated `dist/pt-timeline-color/` folder in step 3.

1. Download the latest `time-color-for-jira-v*.zip` from [Releases](../../releases/latest) and unzip it into a folder
2. Open `chrome://extensions` and turn on **Developer mode** (top right)
3. Click **Load unpacked** and choose the unzipped folder

Manual installs don't update automatically. When a new version is out, download it again and click **Reload** on the extensions page.

## Usage

### Users

- If your admin saved the settings in the Jira project: just open that project's Timeline. Nothing to set up.
- If your admin gave you a configuration file (JSON):
  1. Click the extension icon in the browser toolbar and choose **Manage settings**
  2. On **Import & manage**, choose the file, check the preview, and save
  3. Open the Jira project's Timeline; the settings apply automatically

The extension uses your current Jira sign-in. You never enter a password or API token.

### Jira admins

Choose either way to share the settings (if a project has both, the project settings win):

- **Save them in a Jira project property**: with an account (or admin tool) that can administer the project, write the settings to the project property `time-color-for-jira`. See [PROJECT_PROFILE.md](PROJECT_PROFILE.md) for the format. Anyone who can browse the project can read it, so don't put secrets in it.
- **Share a configuration file**:
  1. Open **Manage settings** and switch to **Create configuration (admin)**
  2. Enter the Jira site URL, the issue type IDs and the field IDs you need (the page links to where each ID can be found), plus holidays and make-up workdays (one per line)
  3. Download the file, import it yourself and check the Timeline
  4. When it looks right, share the file with your users

A configuration file contains your company's Jira URL and field details. Don't post it anywhere public.

## Privacy

Jira issue data is used only in the user's browser. It is never sent to the developer, and there is no tracking or analytics. See the [privacy policy](https://xxeye.github.io/time-color-for-jira/privacy.html).

## Development

No packages or build tools needed: plain JavaScript, HTML and CSS (Manifest V3).

| Path | Contents |
|---|---|
| `manifest.json` | Extension manifest |
| `background.js`, `settings_broker.js` | Service worker: settings storage |
| `timeline_color.js`, `timeline_*.js`, `floating_toolbar.js` | Content scripts drawing on the Jira Timeline |
| `jiraApi.js`, `runtime_session.js`, `issue_*.js` | Reading Jira data (same site, read-only) |
| `settings.js`, `architecture_template.js` | Configuration format and validation |
| `popup.*`, `options.*`, `ui_helpers.js` | Extension panel and settings page |
| `config-generator/` | Configuration generator for admins (packed into the settings page) |
| `tests/` | Automated tests |
| `site/` | GitHub Pages site (home page and privacy policy; English at the root, Chinese in `zh/`) |

### Tests

```bash
node --test --test-isolation=none tests/*.test.js
```

```bash
python -m unittest discover -s tests -p "test_*.py"
```

`tests/browser-smoke.cjs` loads the extension in a real browser and needs [Playwright](https://playwright.dev/) installed separately.

### Packaging

```bash
python pack.py
```

Produces `dist/pt-timeline-color.zip` (for the Chrome Web Store) and `dist/pt-timeline-color/` (loadable unpacked). Only files on the allowlist in `pack.py` are included.

### Formatting

Code is formatted with [Prettier](https://prettier.io/) (settings in `.prettierrc.json`):

```bash
npx prettier@3.9.6 --write "*.js" "config-generator/*.js" "tests/*.js" "tests/*.cjs"
```

### Releasing

1. Update `version` in `manifest.json` (for example `1.0.1`) and commit
2. Create a tag with the same version and push it:

   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. GitHub Actions (`.github/workflows/release.yml`) runs the tests, packs the extension and creates a GitHub Release with the ZIP and its SHA-256
4. Upload the same ZIP in the Chrome Web Store developer dashboard

The release fails if the tag and the `manifest.json` version don't match.

### Website

When `site/` is pushed to `main`, GitHub Actions (`.github/workflows/pages.yml`) publishes it to GitHub Pages. Before the first run, set **Settings → Pages → Source** to **GitHub Actions** in the repository.

## Reporting issues

Please use GitHub Issues. Don't include your company's site URL, issue content or unredacted screenshots.

## License

[MIT License](LICENSE)
