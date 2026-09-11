"""Shared wildlife, random coats and non-destructive save upgrades."""
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from app.meadow import Meadow, load_meadow, save_meadow
from tests.test_meadow import advance, wait_for


def quiet_world(seed=23, count=6):
    model = Meadow(seed=seed, initial_count=count)
    # Keep targets stationary and prevent births without breaking saved invariants.
    for index, rabbit in enumerate(model.rabbits):
        rabbit.update(x=300 + index * 40, y=350, _speed=0, cooldown=999)
    return model


class WildlifeTests(unittest.TestCase):
    def test_newborn_coats_are_random_and_do_not_change_when_caught_or_released(self):
        model = Meadow(seed=46, initial_count=30)
        wait_for(model, lambda: model.born_count >= 12, seconds=40)
        babies = [rabbit for rabbit in model.rabbits if rabbit["id"] > 30]
        self.assertGreaterEqual(len({rabbit["coat"] for rabbit in babies}), 4)
        self.assertTrue(all(rabbit["coat"] in Meadow.coats for rabbit in model.rabbits))
        baby = babies[0]
        identity, coat = baby["id"], baby["coat"]
        model.catch(identity)
        self.assertEqual(model.basket[0]["coat"], coat)
        self.assertEqual(model.release_one()["coat"], coat)
        self.assertEqual(Meadow.from_state(model.export_state()).snapshot(), model.snapshot())

    def test_both_animals_warn_then_take_one_rabbit_and_leave(self):
        for kind in ("eagle", "wolf"):
            with self.subTest(kind=kind):
                model = quiet_world()
                self.assertTrue(model._start_encounter(kind))
                identity = model.encounter["targetId"]
                coat = next(rabbit["coat"] for rabbit in model.rabbits if rabbit["id"] == identity)
                self.assertFalse(model._start_encounter(kind))
                advance(model, 2.9)
                self.assertEqual(model.encounter["phase"], "warning")
                self.assertEqual(model.raided_count, 0)
                wait_for(model, lambda: model.raided_count == 1, seconds=8.2)
                self.assertEqual(model.encounter["phase"], "leaving")
                self.assertEqual(model.encounter["carrying"], {"id": identity, "coat": coat, "adult": True})
                self.assertEqual(model.total_count, 5)
                self.assertEqual(model.basket, [])
                self.assertIsNone(model.catch(identity))
                wait_for(model, lambda: model.encounter is None, seconds=3.2)
                self.assertEqual(model.raided_count, 1)
                self.assertGreaterEqual(model._next_encounter_in, 35)
                self.assertLessEqual(model._next_encounter_in, 70)

    def test_wolf_routes_around_water_while_eagle_can_fly_over_it(self):
        for kind in ("wolf", "eagle"):
            model = quiet_world()
            model._start_encounter(kind)
            target = next(rabbit for rabbit in model.rabbits if rabbit["id"] == model.encounter["targetId"])
            target.update(x=960, y=135)
            model.encounter.update(x=680, y=135)
            crossed_water = False
            for _ in range(120):
                model.update(.1)
                animal = model.encounter
                if animal is None:
                    break
                safe = model.is_safe_position(animal["x"], animal["y"])
                crossed_water |= not safe
                if kind == "wolf":
                    self.assertTrue(safe)
                Meadow.from_state(model.export_state())
            self.assertEqual(model.raided_count, 1)
            self.assertEqual(crossed_water, kind == "eagle")

    def test_predator_interrupts_pair_before_carrying_rabbit_away(self):
        for kind in ("eagle", "wolf"):
            model = quiet_world()
            first, second = model.rabbits[:2]
            first["cooldown"] = second["cooldown"] = 0
            model._pair_rabbits()
            pair = model.pairs[0]
            self.assertEqual(pair["firstId"], first["id"])
            model._start_encounter(kind)
            model.encounter.update(targetId=first["id"], x=first["x"], y=first["y"], phase="chasing", remaining=8)
            model.update(.1)
            self.assertEqual(model.raided_count, 1)
            self.assertEqual(model.pairs, [])
            self.assertIsNone(second["partnerId"])
            self.assertIsNone(second["pairId"])
            self.assertEqual(model.encounter["carrying"]["id"], first["id"])
            Meadow.from_state(model.export_state())

    def test_user_can_rescue_target_before_predator_and_basket_is_safe(self):
        for kind in ("eagle", "wolf"):
            model = quiet_world()
            model.catch(model.rabbits[0]["id"])
            saved_basket = deepcopy(model.basket)
            model._start_encounter(kind)
            identity = model.encounter["targetId"]
            self.assertNotEqual(identity, saved_basket[0]["id"])
            self.assertIsNotNone(model.catch(identity))
            # Actions are saved immediately, before the next simulation tick.
            Meadow.from_state(model.export_state())
            model.update(.1)
            self.assertEqual(model.encounter["phase"], "leaving")
            self.assertIsNone(model.encounter["carrying"])
            advance(model, 4)
            self.assertEqual(model.raided_count, 0)
            self.assertEqual(model.total_count, 6)
            self.assertEqual({rabbit["id"] for rabbit in model.basket}, {identity, saved_basket[0]["id"]})

    def test_minimum_two_on_grass_survive_and_capacity_remains_bounded(self):
        model = quiet_world(count=3)
        model._start_encounter("eagle")
        other = next(rabbit for rabbit in model.rabbits if rabbit["id"] != model.encounter["targetId"])
        model.catch(other["id"])
        advance(model, 6)
        self.assertEqual(len(model.rabbits), 2)
        self.assertEqual(len(model.basket), 1)
        self.assertEqual(model.raided_count, 0)
        self.assertFalse(model._start_encounter("wolf"))
        advance(model, 120)
        self.assertEqual(model.raided_count, 0)
        for count in (0, 1, 2):
            self.assertFalse(quiet_world(count=count)._start_encounter("eagle"))
        growing = Meadow(seed=4, initial_count=12, max_rabbits=15)
        for _ in range(1600):
            growing.update(.1)
            self.assertLessEqual(growing.total_count + len(growing.pairs), 15)
            self.assertEqual(growing.total_count, 12 + growing.born_count - growing.raided_count)

    def test_random_schedule_is_bounded_and_no_time_passes_without_ticks(self):
        timers = [Meadow(seed=seed)._next_encounter_in for seed in range(10)]
        self.assertTrue(all(15 <= timer <= 30 for timer in timers))
        self.assertGreater(len(set(timers)), 1)
        model = quiet_world()
        stored = model.export_state()
        restored = Meadow.from_state(stored)
        self.assertEqual(restored.export_state(), stored)
        wait_for(model, lambda: model.encounter is not None, seconds=30.1)
        self.assertGreaterEqual(model.time, 15)
        self.assertLessEqual(model.time, 30.1)
        self.assertEqual(model.encounter["phase"], "warning")
        self.assertEqual(restored.time, 0)

    def test_full_meadow_long_run_preserves_routes_population_and_checkpoints(self):
        phases, species = set(), set()
        for seed in (0, 19):
            model = Meadow(seed=seed, initial_count=60)
            for step in range(3600):
                if step % 150 == 0:
                    model.add_carrot(680 if step % 300 == 0 else 960, 135)
                if step % 200 == 0:
                    model.catch(model.rabbits[0]["id"])
                if step % 200 == 100:
                    model.release_one()
                model.update(.1)
                self.assertEqual(model.total_count, 60 + model.born_count - model.raided_count)
                self.assertLessEqual(model.total_count + len(model.pairs), 60)
                self.assertGreaterEqual(len(model.rabbits), 2)
                if model.encounter is not None:
                    phases.add(model.encounter["phase"])
                    species.add(model.encounter["kind"])
                    if model.encounter["kind"] == "wolf":
                        self.assertTrue(model.is_safe_position(model.encounter["x"], model.encounter["y"]))
                if step % 20 == 0:
                    self.assertEqual(Meadow.from_state(model.export_state()).snapshot(), model.snapshot())
        self.assertEqual(phases, {"warning", "chasing", "leaving"})
        self.assertEqual(species, {"eagle", "wolf"})


class WildlifePersistenceTests(unittest.TestCase):
    def test_v1_migration_preserves_legacy_world_catalog_and_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "site.sqlite3"
            load_meadow(path)
            model = Meadow(seed=22)
            wait_for(model, lambda: len(model.pairs) >= 2)
            model.catch(model.rabbits[0]["id"])
            model.receipts = [{"requestId": "legacy-action", "signature": "catch:1", "ok": True, "code": "caught"}]
            legacy = model.export_state()
            legacy["version"] = 1
            for key in ("raidedCount", "encounter", "nextEncounterId", "nextEncounterIn"):
                legacy.pop(key)
            for rabbit in legacy["rabbits"] + legacy["basket"]:
                rabbit.pop("coat")
            encoded = json.dumps(legacy)
            with sqlite3.connect(path) as connection:
                connection.execute("UPDATE meadow_state SET state=?", (encoded,))
                connection.execute("CREATE TABLE site_settings (content TEXT)")
                connection.execute("INSERT INTO site_settings VALUES ('owner contact')")
            migrated = load_meadow(path)
            self.assertEqual(migrated.total_count, model.total_count)
            self.assertEqual(migrated.receipts, model.receipts)
            self.assertEqual(migrated.time, model.time)
            self.assertTrue(model.pairs)
            self.assertEqual(migrated.pairs, model.pairs)
            self.assertTrue(all(rabbit["coat"] == "white" for rabbit in migrated.rabbits + migrated.basket))
            for upgraded, original in zip(migrated.rabbits + migrated.basket, legacy["rabbits"] + legacy["basket"]):
                self.assertEqual({key: value for key, value in upgraded.items() if key != "coat"}, original)
            self.assertEqual(migrated.export_state()["version"], 2)
            self.assertEqual(migrated.export_state(), Meadow.from_state(legacy).export_state())
            save_meadow(path, migrated)
            self.assertEqual(load_meadow(path).export_state(), migrated.export_state())
            with sqlite3.connect(path) as connection:
                self.assertEqual(connection.execute("SELECT content FROM site_settings").fetchone()[0], "owner contact")
                self.assertEqual(json.loads(connection.execute("SELECT state FROM meadow_state").fetchone()[0])["version"], 2)

    def test_each_phase_and_random_future_survive_json_and_sqlite_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "site.sqlite3"
            load_meadow(path)
            for kind in ("eagle", "wolf"):
                model = quiet_world()
                model._start_encounter(kind)
                for phase in ("warning", "chasing", "leaving"):
                    wait_for(model, lambda: model.encounter is not None and model.encounter["phase"] == phase, seconds=12)
                    model.update(.1)
                    save_meadow(path, model)
                    restored = load_meadow(path)
                    self.assertEqual(restored.export_state(), model.export_state())
                    self.assertEqual(Meadow.from_state(json.loads(json.dumps(model.export_state()))).export_state(), model.export_state())
                    # Check the whole later encounter schedule, target, coat and
                    # movement stream; randomness must not reroll at restart.
                    continuing = Meadow.from_state(model.export_state())
                    for _ in range(800):
                        continuing.update(.1)
                        restored.update(.1)
                        self.assertEqual(restored.export_state(), continuing.export_state())

    def test_corrupt_wildlife_or_coat_is_rejected_and_private_routes_stay_private(self):
        model = quiet_world()
        model._start_encounter("wolf")
        snapshot = model.snapshot()
        self.assertFalse(any(key.startswith("_") for key in snapshot["encounter"]))
        snapshot["encounter"]["x"] = -100
        self.assertGreater(model.encounter["x"], 0)
        for change in (
            lambda state: state["rabbits"][0].update(coat="unknown"),
            lambda state: state.update(nextEncounterIn=float("nan")),
            lambda state: state.update(raidedCount=-1),
            lambda state: state["encounter"].update(kind="bear"),
            lambda state: state["encounter"].update(x=825, y=135),
            lambda state: state["encounter"].update(remaining=900),
            lambda state: state["encounter"].update(carrying={"id": 1, "coat": "white", "adult": True}),
        ):
            state = model.export_state()
            change(state)
            with self.assertRaisesRegex(ValueError, "Invalid persisted meadow state"):
                Meadow.from_state(state)


if __name__ == "__main__":
    unittest.main()
