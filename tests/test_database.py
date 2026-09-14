import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from app.database import DEFAULT_WHATSAPP, initialize, load_site, import_site, backup

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

    def test_solo_copy_migration_preserves_contacts_and_custom_products(self):
        current = load_site(self.path)
        current['hero_title'] = 'Found it in China?\nLet’s make it yours.'
        current['contact']['email'] = 'owner@example.com'
        current['about'] = 'My own biography'
        original_product = current['products'][0]
        original_product['description'] = 'My edited product description'
        current['products'][1]['description'] = current['products'][1]['summary'] + ' Send a link or reference and we will check whether we can source it. Product availability, seller details, fees and delivery options are confirmed before purchase.'
        self.write(current)
        import_site(self.source, self.path)
        with sqlite3.connect(self.path) as conn:
            conn.execute("DELETE FROM content_migrations WHERE name='solo-v1'")
        upgraded = load_site(self.path)
        self.assertEqual(upgraded['hero_title'], 'Your person in China.\nFor the things you need.')
        self.assertEqual(upgraded['contact']['email'], 'owner@example.com')
        self.assertEqual(upgraded['about'], 'My own biography')
        self.assertEqual(upgraded['products'][0], original_product)
        self.assertIn('I will check sourcing options', upgraded['products'][1]['description'])
        self.assertEqual(load_site(self.path), upgraded)

    def test_whatsapp_migration_preserves_site_products_and_meadow(self):
        for previous in (None, '', '  '):
            with self.subTest(previous=previous):
                path = Path(self.temp.name) / f'whatsapp-{previous!r}.sqlite3'
                site = load_site(path)
                site['brand'] = 'My independent shop'
                site['about'] = 'My custom introduction'
                site['contact']['email'] = 'owner@example.com'
                site['contact']['phone'] = '+44 1234567890'
                site['contact']['wechat'] = 'my-custom-account'
                site['products'] = list(reversed(site['products']))[:2]
                if previous is None:
                    site['contact'].pop('whatsapp')
                else:
                    site['contact']['whatsapp'] = previous
                self.write(site)
                import_site(self.source, path)
                meadow_state = '{"worldId":"keep-this-world","rabbits":[{"id":42}]}'
                with sqlite3.connect(path) as conn:
                    conn.execute("DELETE FROM content_migrations WHERE name='whatsapp-v1'")
                    conn.execute('CREATE TABLE meadow_state (id INTEGER PRIMARY KEY, state TEXT NOT NULL, updated_at TEXT NOT NULL)')
                    conn.execute('INSERT INTO meadow_state VALUES(1, ?, ?)', (meadow_state, '2026-09-14'))
                    products_before = conn.execute('SELECT * FROM products ORDER BY position').fetchall()
                expected = json.loads(json.dumps(site))
                expected['contact']['whatsapp'] = DEFAULT_WHATSAPP
                self.assertEqual(load_site(path), expected)
                self.assertEqual(load_site(path), expected)
                with sqlite3.connect(path) as conn:
                    self.assertEqual(conn.execute('SELECT * FROM products ORDER BY position').fetchall(), products_before)
                    self.assertEqual(conn.execute('SELECT * FROM meadow_state').fetchall(), [(1, meadow_state, '2026-09-14')])
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM content_migrations WHERE name='whatsapp-v1'").fetchone()[0], 1)

    def test_whatsapp_migration_keeps_existing_number_and_runs_once(self):
        site = load_site(self.path)
        site['contact']['whatsapp'] = '+44 7700 900123'
        self.write(site)
        import_site(self.source, self.path)
        with sqlite3.connect(self.path) as conn:
            conn.execute("DELETE FROM content_migrations WHERE name='whatsapp-v1'")
        self.assertEqual(load_site(self.path), site)
        site['contact']['whatsapp'] = ''
        self.write(site)
        import_site(self.source, self.path)
        self.assertEqual(load_site(self.path), site)

    def test_legacy_contact_import_without_whatsapp_remains_supported(self):
        site = load_site(self.path)
        site['contact'].pop('whatsapp')
        self.write(site)
        import_site(self.source, self.path)
        self.assertEqual(load_site(self.path), site)

    def test_invalid_whatsapp_import_preserves_existing_data(self):
        original = load_site(self.path)
        site = json.loads(json.dumps(original))
        site['contact']['whatsapp'] = 8615927146828
        self.write(site)
        with self.assertRaises(ValueError):
            import_site(self.source, self.path)
        self.assertEqual(load_site(self.path), original)
