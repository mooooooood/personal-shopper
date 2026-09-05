import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from app.database import initialize, load_site, import_site, backup

class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'site.sqlite3'
        self.source = Path(self.temp.name) / 'edit.json'

    def write(self, site):
        self.source.write_text(json.dumps(site), encoding='utf-8')

    def test_seed_once_and_persist_changes(self):
        site = load_site(self.path)
        site['brand'] = 'Changed brand'
        site['contact']['email'] = 'contact@example.com'
        site['products'] = list(reversed(site['products']))[:2]
        self.write(site)
        import_site(self.source, self.path)
        initialize(self.path)
        self.assertEqual(load_site(self.path), site)

    def test_invalid_import_preserves_existing_data(self):
        original = load_site(self.path)
        changed = json.loads(json.dumps(original))
        changed['products'][1]['slug'] = changed['products'][0]['slug']
        self.write(changed)
        with self.assertRaises(ValueError):
            import_site(self.source, self.path)
        self.assertEqual(load_site(self.path), original)

    def test_transaction_rollback_on_database_failure(self):
        original = load_site(self.path)
        with sqlite3.connect(self.path) as conn:
            conn.execute("CREATE TRIGGER fail_insert BEFORE INSERT ON products BEGIN SELECT RAISE(ABORT, 'failure'); END")
        changed = {**original, 'brand': 'Should not persist'}
        self.write(changed)
        with self.assertRaises(sqlite3.IntegrityError):
            import_site(self.source, self.path)
        self.assertEqual(load_site(self.path), original)

    def test_backup_is_independent_and_cannot_overwrite(self):
        original = load_site(self.path)
        target = Path(self.temp.name) / 'backup.sqlite3'
        backup(target, self.path)
        self.write({**original, 'brand': 'New'})
        import_site(self.source, self.path)
        self.assertEqual(load_site(target), original)
        with self.assertRaises(FileExistsError):
            backup(target, self.path)
        with self.assertRaises(FileExistsError):
            backup(self.path, self.path)

    def test_rebrand_preserves_custom_data_and_runs_once(self):
        from app.database import SEED, ROOT
        legacy = json.loads((ROOT / 'data/legacy-site.json').read_text())
        initialize(self.path)
        legacy['contact']['email'] = 'real@example.com'
        legacy['products'][0]['description'] = 'My custom description'
        self.write(legacy)
        import_site(self.source, self.path)
        with sqlite3.connect(self.path) as conn:
            conn.execute('DELETE FROM content_migrations')
        upgraded = load_site(self.path)
        self.assertEqual(upgraded['contact']['email'], 'real@example.com')
        self.assertEqual(upgraded['hero_title'], json.loads(SEED.read_text())['hero_title'])
        products = {p['slug']: p for p in upgraded['products']}
        self.assertEqual(products['fitness-equipment']['description'], 'My custom description')
        self.assertNotIn('fishing-rods', products)
        self.assertIn('home-living', products)
        self.write({**upgraded, 'products': []})
        import_site(self.source, self.path)
        self.assertEqual(load_site(self.path)['products'], [])
