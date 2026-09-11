"""Authoritative world invariants and durable checkpoint regression tests."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app.meadow import Meadow, load_meadow, save_meadow


def advance(model, seconds):
    for _ in range(round(seconds * 10)):
        model.update(.1)


def wait_for(model, condition, seconds=35):
    for _ in range(round(seconds * 10)):
        if condition():
            return
        model.update(.1)
    assert condition(), f"Condition not reached within {seconds} seconds"


class MeadowTests(unittest.TestCase):
    def test_starts_with_twelve_adults_on_one_canonical_map(self):
        model = Meadow(seed=12)
        state = model.snapshot()
        self.assertEqual((state["width"], state["height"]), (1000, 600))
        self.assertEqual(state["totalCount"], 12)
        self.assertEqual(state["maxRabbits"], 60)
        self.assertEqual(state["adultAge"], 30)
        self.assertTrue(all(rabbit["adult"] and model.is_safe_position(rabbit["x"], rabbit["y"])
                            for rabbit in state["rabbits"]))
        self.assertEqual(state, Meadow(seed=12).snapshot())
        self.assertNotEqual(state, Meadow(seed=13).snapshot())

    def test_pair_nests_gives_birth_and_baby_grows(self):
        model = Meadow(seed=42)
        wait_for(model, lambda: any(pair["phase"] == "nesting" for pair in model.pairs))
        pair = next(pair for pair in model.pairs if pair["phase"] == "nesting")
        parents = [rabbit for rabbit in model.rabbits if rabbit["id"] in (pair["firstId"], pair["secondId"])]
        self.assertEqual(len(parents), 2)
        self.assertTrue(all(rabbit["state"] == "nesting" and rabbit["partnerId"] for rabbit in parents))
        self.assertLess(model._distance(*parents), 30)
        wait_for(model, lambda: model.born_count > 0, seconds=4)
        baby = next(rabbit for rabbit in model.rabbits if not rabbit["adult"])
        self.assertEqual(baby["age"], 0)
        self.assertLess(model.time, 22)
        advance(model, 29)
        self.assertFalse(baby["adult"])
        advance(model, 1.2)
        self.assertTrue(baby["adult"])

    def test_catch_by_identity_cancels_pair_and_duplicate_catch_is_noop(self):
        model = Meadow(seed=42, initial_count=2)
        wait_for(model, lambda: any(pair["phase"] == "nesting" for pair in model.pairs))
        first, second = model.rabbits
        self.assertEqual(model.catch(first["id"])["id"], first["id"])
        self.assertIsNone(model.catch(first["id"]))
        self.assertIsNone(model.catch(True))
        self.assertIsNone(model.catch(str(second["id"])))
        self.assertEqual(len(model.rabbits), 1)
        self.assertEqual(len(model.basket), 1)
        self.assertEqual(model.pairs, [])
        self.assertIsNone(second["partnerId"])
        self.assertIsNone(second["pairId"])
        advance(model, 12)
        self.assertEqual(model.born_count, 0)
        self.assertEqual(model.release_one()["id"], first["id"])
        self.assertTrue(model.is_safe_position(first["x"], first["y"]))
        self.assertIsNone(model.release_one())
        self.assertEqual(model.total_count, 2)

    def test_birth_reservations_and_communal_basket_obey_cap(self):
        model = Meadow(seed=7, max_rabbits=15)
        wait_for(model, lambda: model.total_count == 15)
        for rabbit in model.rabbits[:6]:
            model.catch(rabbit["id"])
        self.assertEqual(len(model.basket), 6)
        advance(model, 90)
        self.assertEqual(model.total_count, 15)
        self.assertEqual(model.born_count, 3)
        self.assertEqual(model.pairs, [])
        while model.basket:
            self.assertIsNotNone(model.release_one())
        advance(model, 20)
        self.assertEqual(len(model.rabbits), 15)
        self.assertEqual(model.born_count, 3)

    def test_carrots_attract_expire_and_reject_invalid_coordinates(self):
        model = Meadow(seed=3, initial_count=1)
        rabbit = model.rabbits[0]
        carrot = model.add_carrot(rabbit["x"] + (120 if rabbit["x"] < 500 else -120), rabbit["y"])
        before = model._distance(rabbit, carrot)
        advance(model, 2.5)
        self.assertLess(model._distance(rabbit, carrot), before / 2)
        for _ in range(5):
            carrot = model.add_carrot(825, 135)
            self.assertTrue(model.is_safe_position(carrot["x"], carrot["y"]))
        self.assertIsNone(model.add_carrot(10, 10))
        advance(model, 20)
        self.assertEqual(model.carrots, [])
        for x, y in ((float("nan"), 100), (100, float("inf")), ("10", 20), (True, 20)):
            self.assertIsNone(model.add_carrot(x, y))
        self.assertTrue(model.is_safe_position(**{k: model.add_carrot(-10000, 10000)[k] for k in ("x", "y")}))

    def test_movement_birth_release_and_full_state_remain_safe(self):
        # Force repeated routes across both sides of the pond while reaching the
        # population ceiling. Restoring checkpoints here also covers active paths.
        for seed in (0, 11, "pond"):
            model = Meadow(seed=seed, initial_count=24)
            for step in range(1200):
                if step % 90 == 0:
                    model.add_carrot(700 if step % 180 == 0 else 960, 135)
                if step % 150 == 0:
                    model.catch(model.rabbits[0]["id"])
                    model.release_one()
                model.update(.1)
                self.assertTrue(all(model.is_safe_position(rabbit["x"], rabbit["y"]) for rabbit in model.rabbits))
                self.assertLessEqual(model.total_count + len(model.pairs), 60)
                paired = [identity for pair in model.pairs for identity in (pair["firstId"], pair["secondId"])]
                self.assertEqual(len(set(paired)), len(paired))
                if step % 37 == 0:
                    self.assertEqual(Meadow.from_state(model.export_state()).snapshot(), model.snapshot())

    def test_updates_are_bounded_and_snapshots_do_not_expose_internal_state(self):
        model = Meadow(seed=3)
        before = model.snapshot()
        for dt in (0, -1, float("nan"), float("inf"), "1", True):
            model.update(dt)
        self.assertEqual(model.snapshot(), before)
        model.update(600)
        self.assertEqual(model.time, .1)
        self.assertEqual(model.born_count, 0)
        before["rabbits"][0]["x"] = -1
        self.assertGreater(model.rabbits[0]["x"], 0)
        self.assertFalse(any(key.startswith("_") for key in model.snapshot()["rabbits"][0]))
        self.assertNotIn("receipts", model.snapshot())


class MeadowPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "site.sqlite3"

    def test_state_roundtrip_restores_rng_routes_basket_and_action_receipts(self):
        load_meadow(self.path)
        model = Meadow(seed=42)
        wait_for(model, lambda: model.born_count > 0 and bool(model.pairs))
        model.catch(model.rabbits[-1]["id"])
        model.add_carrot(910, 260)
        model.receipts.append({"requestId": "action-001", "signature": "catch:13", "ok": True, "code": "caught"})
        save_meadow(self.path, model)
        restored = load_meadow(self.path)
        self.assertEqual(restored.export_state(), model.export_state())
        for step in range(250):
            for world in (model, restored):
                if step == 20:
                    world.release_one()
                if step % 60 == 0:
                    world.add_carrot(500, 500)
                world.update(.1)
            self.assertEqual(restored.export_state(), model.export_state())
        encoded = json.loads(json.dumps(model.export_state()))
        self.assertEqual(Meadow.from_state(encoded).export_state(), model.export_state())

    def test_initialization_and_updates_preserve_existing_catalogue(self):
        with sqlite3.connect(self.path) as connection:
            connection.execute("CREATE TABLE site_settings (id INTEGER PRIMARY KEY, content TEXT)")
            connection.execute("INSERT INTO site_settings VALUES (1, 'owner contact')")
            connection.execute("CREATE TABLE products (slug TEXT PRIMARY KEY, content TEXT)")
            connection.execute("INSERT INTO products VALUES ('custom', 'owner product')")
        model = load_meadow(self.path)
        model.catch(model.rabbits[0]["id"])
        save_meadow(self.path, model)
        self.assertEqual(load_meadow(self.path).snapshot(), model.snapshot())
        with sqlite3.connect(self.path) as connection:
            self.assertEqual(connection.execute("SELECT * FROM site_settings").fetchall(), [(1, "owner contact")])
            self.assertEqual(connection.execute("SELECT * FROM products").fetchall(), [("custom", "owner product")])
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM meadow_state").fetchone()[0], 1)

    def test_malformed_or_missing_checkpoint_fails_without_reseeding(self):
        model = load_meadow(self.path)
        invalid_states = []
        for mutate in (
            lambda state: state.update(version=999),
            lambda state: state["rabbits"][0].update(x=825, y=135),
            lambda state: state["rabbits"].append(deepcopy(state["rabbits"][0])),
            lambda state: state["rabbits"][0].update(pairId=99, partnerId=98),
            lambda state: state.update(randomState=[]),
            lambda state: state.update(time=float("nan")),
        ):
            state = model.export_state()
            mutate(state)
            invalid_states.append(json.dumps(state))
        for encoded in ("{broken", "[]", "{}", *invalid_states):
            with sqlite3.connect(self.path) as connection:
                connection.execute("UPDATE meadow_state SET state=?", (encoded,))
            with self.assertRaisesRegex(ValueError, "Invalid persisted meadow state"):
                load_meadow(self.path)
            with sqlite3.connect(self.path) as connection:
                self.assertEqual(connection.execute("SELECT state FROM meadow_state").fetchone()[0], encoded)
        with sqlite3.connect(self.path) as connection:
            connection.execute("DELETE FROM meadow_state")
        with self.assertRaisesRegex(ValueError, "singleton row is missing"):
            load_meadow(self.path)

    def test_failed_save_keeps_previous_atomic_checkpoint(self):
        model = load_meadow(self.path)
        previous = model.export_state()
        model.catch(model.rabbits[0]["id"])
        # A SQLite failure after beginning the update must not partially replace
        # a saved meadow (for example, a failing trigger during an upgrade).
        with sqlite3.connect(self.path) as connection:
            connection.execute("CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON meadow_state BEGIN SELECT RAISE(ABORT, 'disk write rejected'); END")
        with self.assertRaises(sqlite3.IntegrityError):
            save_meadow(self.path, model)
        self.assertEqual(load_meadow(self.path).export_state(), previous)
        model.rabbits[0]["age"] = float("nan")
        with self.assertRaises(ValueError):
            save_meadow(self.path, model)
        self.assertEqual(load_meadow(self.path).export_state(), previous)


if __name__ == "__main__":
    unittest.main()
