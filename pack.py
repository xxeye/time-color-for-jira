"""Build the extension from an explicit allowlist; never package the source tree."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import json
import re

ROOT = Path(__file__).resolve().parent
FILES = (
    'manifest.json', 'background.js', 'settings.js', 'settings_broker.js',
    'settings_client.js', 'jiraApi.js', 'issue_rules.js', 'issue_cache.js',
    'calendar.js', 'timeline_dates.js', 'timeline_geometry.js', 'runtime_session.js', 'timeline_adapter.js',
    'floating_toolbar.js', 'timeline_color.js', 'timeline_color.css',
    'ui_helpers.js', 'popup.html', 'popup.js', 'popup.css',
    'onboarding.html', 'onboarding.js', 'onboarding.css',
    'options.html', 'options.js', 'options_tabs.js', 'options.css',
    'i18n.js', '_locales/en/messages.json', '_locales/zh_TW/messages.json',
    'generator.html', 'generator.js', 'generator.css', 'architecture_template.js',
    'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png',
)
# The settings page embeds the admin generator; its sources live in config-generator/.
SOURCES = {
    'generator.html': 'config-generator/index.html',
    'generator.js': 'config-generator/generator.js',
    'generator.css': 'config-generator/generator.css',
}


def source(name):
    return SOURCES.get(name, name)


def payloads():
    result = {}
    for name in FILES:
        path = ROOT / source(name)
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError(f'Missing or unsafe extension input: {name}')
        result[name] = path.read_bytes()
    manifest = json.loads(result['manifest.json'])
    references = [manifest['background']['service_worker'],
                  manifest['action']['default_popup'], manifest['options_ui']['page']]
    references.extend(manifest['icons'].values())
    references.extend(manifest['action']['default_icon'].values())
    for script in manifest['content_scripts']:
        references.extend(script.get('js', []))
        references.extend(script.get('css', []))
    for name, data in result.items():
        if name.endswith('.html'):
            references.extend(re.findall(r'<(?:script|link|iframe)\b[^>]*\b(?:src|href|data-src)=["\']([^"\']+)', data.decode('utf-8')))
    for reference in references:
        if reference not in result:
            raise ValueError(f'Unbundled extension dependency: {reference}')
    return result


def build(output=None, unpacked=None):
    output = Path(output) if output is not None else ROOT / 'dist/pt-timeline-color.zip'
    unpacked = Path(unpacked) if unpacked is not None else output.with_suffix('')
    data = payloads()
    # A pre-existing unknown file must not accidentally become part of the loadable build.
    if unpacked.is_symlink():
        raise ValueError('Unsafe unpacked output directory')
    if unpacked.exists():
        directories = {parent.as_posix() for name in data for parent in Path(name).parents if parent != Path('.')}
        for path in unpacked.rglob('*'):
            relative = path.relative_to(unpacked).as_posix()
            if path.is_symlink() or (path.is_file() and relative not in data) or (path.is_dir() and relative not in directories):
                raise ValueError(f'Unexpected unpacked output: {path}')
    output.parent.mkdir(parents=True, exist_ok=True)
    unpacked.mkdir(parents=True, exist_ok=True)
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as bundle:
        for name, content in data.items():
            info = ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, content)
            destination = unpacked / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
    return output


if __name__ == '__main__':
    print(build())
