import importlib.util
import json
import re
from pathlib import Path
from contextlib import contextmanager
import shutil
import uuid
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('extension_pack', ROOT / 'pack.py')
pack = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pack)


@contextmanager
def temporary_output():
    directory = ROOT / 'dist' / ('test-extension-' + uuid.uuid4().hex)
    directory.mkdir(parents=True)
    try:
        yield directory
    finally:
        resolved = directory.resolve()
        if not resolved.is_relative_to((ROOT / 'dist').resolve()) or not resolved.name.startswith('test-extension-'):
            raise ValueError('Unsafe test cleanup target')
        shutil.rmtree(resolved)


class ExtensionPackageTests(unittest.TestCase):
    def test_reproducible_whitelist_and_loadable_folder(self):
        with temporary_output() as temp:
            output = Path(temp) / 'extension.zip'
            pack.build(output)
            first = output.read_bytes()
            pack.build(output)
            self.assertEqual(first, output.read_bytes())
            with ZipFile(output) as archive:
                self.assertEqual(set(archive.namelist()), set(pack.FILES))
                for name in archive.namelist():
                    self.assertEqual(archive.read(name), (ROOT / pack.source(name)).read_bytes())
                    self.assertEqual(archive.read(name), (output.with_suffix('') / name).read_bytes())
                for name in archive.namelist():
                    locale_file = re.fullmatch(r'_locales/[A-Za-z_]+/messages\.json', name)
                    self.assertFalse(name.endswith(('.md', '.zip', '.py')), name)
                    self.assertFalse(name.endswith('.json') and name != 'manifest.json' and not locale_file, name)
                    self.assertFalse(name.startswith(('config-generator/', 'tests/', 'dist/')), name)
                    self.assertFalse(name.startswith('_') and not locale_file, name)

    def test_admin_generator_is_bundled_from_offline_sources(self):
        data = pack.payloads()
        for name, source in pack.SOURCES.items():
            self.assertEqual(data[name], (ROOT / source).read_bytes())
        self.assertIn('data-src="generator.html"', data['options.html'].decode('utf-8'))
        html = data['generator.html'].decode('utf-8')
        for dependency in ['architecture_template.js', 'settings.js', 'generator.js', 'generator.css']:
            self.assertIn('"' + dependency + '"', html)
            self.assertIn(dependency, data)

    def test_extension_pages_follow_mv3_csp(self):
        for name, content in pack.payloads().items():
            if name.endswith('.html'):
                html = content.decode('utf-8')
                self.assertIsNone(re.search(r'<script(?![^>]*\bsrc=)', html), name + ' has an inline script')
                self.assertIsNone(re.search(r'\son[a-z]+\s*=', html), name + ' has an inline event handler')
                self.assertNotIn('javascript:', html, name)

    def test_manifest_dependency_order_and_minimal_permissions(self):
        manifest = json.loads(pack.payloads()['manifest.json'])
        scripts = manifest['content_scripts'][0]['js']
        # Only Jira sites: holidays come from the project property or the configuration file.
        self.assertEqual(manifest['permissions'], ['storage'])
        self.assertEqual(manifest['host_permissions'], ['https://*.atlassian.net/*'])
        self.assertNotIn('optional_host_permissions', manifest)
        self.assertEqual(scripts[0], 'i18n.js')
        self.assertEqual(manifest['default_locale'], 'en')
        self.assertEqual(manifest['options_ui']['page'], 'options.html')
        for dependency in ['settings.js', 'settings_client.js', 'jiraApi.js', 'issue_rules.js', 'issue_cache.js', 'calendar.js', 'runtime_session.js', 'timeline_adapter.js']:
            self.assertLess(scripts.index(dependency), scripts.index('timeline_color.js'))
        self.assertLess(scripts.index('timeline_adapter.js'), scripts.index('floating_toolbar.js'))

    def test_unknown_existing_output_is_rejected_without_deletion(self):
        with temporary_output() as temp:
            unpacked = Path(temp) / 'unpacked'
            unpacked.mkdir()
            private = unpacked / 'private.json'
            private.write_text('private')
            with self.assertRaises(ValueError):
                pack.build(Path(temp) / 'extension.zip', unpacked)
            self.assertEqual(private.read_text(), 'private')

    def test_unknown_empty_directory_is_rejected(self):
        with temporary_output() as temp:
            unpacked = Path(temp) / 'unpacked'
            (unpacked / '_private').mkdir(parents=True)
            with self.assertRaises(ValueError):
                pack.build(Path(temp) / 'extension.zip', unpacked)
