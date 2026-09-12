"""One bounded, server-owned rabbit meadow and its SQLite checkpoint.

Coordinates are always 1000 x 600 regardless of a visitor's screen. The service
owns the clock; this model does not run threads or advance while it is unloaded.
"""
from contextlib import closing
from copy import deepcopy
import json
import math
from pathlib import Path
import random
import sqlite3


class Meadow:
    width = 1000
    height = 600
    adult_age = 30
    nesting_duration = 2.8
    margin = 28
    pond = {"x": 825, "y": 135, "rx": 114, "ry": 72}
    schema_version = 4
    coats = ("white", "cream", "caramel", "chocolate", "silver", "charcoal", "ginger", "spotted")
    lasso_anchor = {"x": 500, "y": 380}
    seat_anchors = [
        {"seatId": 1, "x": 90, "y": 230},
        {"seatId": 2, "x": 90, "y": 295},
        {"seatId": 3, "x": 90, "y": 360},
        {"seatId": 4, "x": 90, "y": 425},
        {"seatId": 5, "x": 910, "y": 230},
        {"seatId": 6, "x": 910, "y": 295},
        {"seatId": 7, "x": 910, "y": 360},
        {"seatId": 8, "x": 910, "y": 425},
    ]
    lasso_lifetime = 25
    lasso_lease = 1.2

    def __init__(self, seed=None, *, initial_count=12, max_rabbits=60):
        if type(max_rabbits) is not int or not 1 <= max_rabbits <= 60:
            raise ValueError("max_rabbits must be between 1 and 60")
        if type(initial_count) is not int or not 0 <= initial_count <= max_rabbits:
            raise ValueError("initial_count exceeds meadow capacity")
        self._random = random.Random(seed)
        self.max_rabbits = max_rabbits
        self.rabbits, self.basket, self.carrots, self.pairs = [], [], [], []
        self.lassos, self.lasso_results = [], []
        self._next_lasso_id = 1
        self.receipts = []
        self.time = 0.0
        self.born_count = 0
        self.raided_count = 0
        self.encounter = None
        self._next_rabbit_id = self._next_carrot_id = self._next_pair_id = 1
        self._next_encounter_id = 1
        self._pair_check = 0.0
        self._waypoints = [
            {"x": self.pond["x"] + math.cos(i * math.pi / 8) * self.pond["rx"] * 1.06,
             "y": self.pond["y"] + math.sin(i * math.pi / 8) * self.pond["ry"] * 1.06}
            for i in range(16)
        ]
        self.rabbits = [self._make_rabbit(adult=True) for _ in range(initial_count)]
        self._next_encounter_in = self._between(15, 30)

    @property
    def total_count(self):
        return len(self.rabbits) + len(self.basket)

    def _between(self, low, high):
        return self._random.uniform(low, high)

    @staticmethod
    def _distance(first, second):
        return math.hypot(first["x"] - second["x"], first["y"] - second["y"])

    @staticmethod
    def _finite(value):
        return type(value) in (int, float) and math.isfinite(value)

    def _safe_point(self, x=None, y=None):
        x = x if self._finite(x) else self._between(self.margin, self.width - self.margin)
        y = y if self._finite(y) else self._between(self.margin, self.height - self.margin)
        point = {"x": max(self.margin, min(self.width - self.margin, x)),
                 "y": max(self.margin, min(self.height - self.margin, y))}
        dx = (point["x"] - self.pond["x"]) / self.pond["rx"]
        dy = (point["y"] - self.pond["y"]) / self.pond["ry"]
        radius = math.hypot(dx, dy)
        if radius < 1.015:
            angle = math.atan2(dy, dx) if radius > 0.0001 else math.pi
            point["x"] = self.pond["x"] + math.cos(angle) * self.pond["rx"] * 1.02
            point["y"] = self.pond["y"] + math.sin(angle) * self.pond["ry"] * 1.02
        return point

    def is_safe_position(self, x, y):
        return (self._finite(x) and self._finite(y)
                and self.margin - .001 <= x <= self.width - self.margin + .001
                and self.margin - .001 <= y <= self.height - self.margin + .001
                and ((x - self.pond["x"]) / self.pond["rx"]) ** 2
                + ((y - self.pond["y"]) / self.pond["ry"]) ** 2 >= .9999)

    def _segment_clear(self, start, end):
        ax = (start["x"] - self.pond["x"]) / self.pond["rx"]
        ay = (start["y"] - self.pond["y"]) / self.pond["ry"]
        dx = (end["x"] - start["x"]) / self.pond["rx"]
        dy = (end["y"] - start["y"]) / self.pond["ry"]
        length = dx * dx + dy * dy
        progress = max(0, min(1, -(ax * dx + ay * dy) / length)) if length else 0
        return (ax + dx * progress) ** 2 + (ay + dy * progress) ** 2 >= 1

    def _route_to(self, start, destination):
        if self._segment_clear(start, destination):
            return [destination]
        # At most 18 nodes. A small visibility graph routes rabbits around water.
        nodes = [start, destination, *self._waypoints]
        costs = [math.inf] * len(nodes)
        previous = [-1] * len(nodes)
        pending = set(range(len(nodes)))
        costs[0] = 0
        while pending:
            current = min(pending, key=lambda item: costs[item])
            if not math.isfinite(costs[current]):
                break
            if current == 1:
                path, index = [], 1
                while index != 0:
                    path.insert(0, {"x": nodes[index]["x"], "y": nodes[index]["y"]})
                    index = previous[index]
                return path
            pending.remove(current)
            for index in pending:
                if not self._segment_clear(nodes[current], nodes[index]):
                    continue
                cost = costs[current] + self._distance(nodes[current], nodes[index])
                if cost < costs[index]:
                    costs[index], previous[index] = cost, current
        return []

    def _move_toward(self, rabbit, target):
        rabbit["_path"] = self._route_to(rabbit, self._safe_point(target["x"], target["y"]))
        rabbit["moving"] = bool(rabbit["_path"])
        if not rabbit["pairId"]:
            rabbit["state"] = "hopping" if rabbit["moving"] else "idle"

    def _make_rabbit(self, x=None, y=None, adult=False):
        point = self._safe_point(x, y)
        rabbit = {
            "id": self._next_rabbit_id, **point,
            "coat": self._random.choice(self.coats),
            "age": self.adult_age + self._between(3, 25) if adult else 0,
            "adult": adult, "state": "idle", "moving": False,
            "hopProgress": 0, "pairProgress": 0,
            "direction": self._random.choice((-1, 1)), "partnerId": None, "pairId": None,
            "cooldown": self._between(9, 13) if adult else self._between(3, 6),
            "_wait": self._between(.1, 1.5), "_speed": self._between(65, 92),
            "_path": [], "_carrotId": None,
        }
        self._next_rabbit_id += 1
        return rabbit

    def _settle(self, rabbit):
        rabbit.update(state="idle", moving=False, hopProgress=0, pairProgress=0,
                      partnerId=None, pairId=None, _path=[], _carrotId=None,
                      _wait=self._between(.4, 1.5))

    def _end_pair(self, pair, interrupted=False):
        self.pairs.remove(pair)
        for rabbit in self.rabbits:
            if rabbit["id"] in (pair["firstId"], pair["secondId"]):
                self._settle(rabbit)
                rabbit["cooldown"] = self._between(5, 8) if interrupted else self._between(18, 26)

    def _pair_rabbits(self):
        vacancies = self.max_rabbits - self.total_count - len(self.pairs)
        eligible = [rabbit for rabbit in self.rabbits
                    if rabbit["adult"] and rabbit["cooldown"] <= 0 and not rabbit["pairId"]
                    and rabbit["state"] != "roped"]
        while len(eligible) > 1 and vacancies > 0:
            first, second = min(((first, second) for i, first in enumerate(eligible)
                                 for second in eligible[i + 1:]),
                                key=lambda pair: self._distance(*pair))
            eligible.remove(first)
            eligible.remove(second)
            point = self._safe_point((first["x"] + second["x"]) / 2,
                                     (first["y"] + second["y"]) / 2)
            pair = {"id": self._next_pair_id, "firstId": first["id"], "secondId": second["id"],
                    **point, "phase": "approaching", "progress": 0, "elapsed": 0}
            self._next_pair_id += 1
            self.pairs.append(pair)
            for rabbit, partner, offset in ((first, second, -11), (second, first, 11)):
                rabbit.update(pairId=pair["id"], partnerId=partner["id"], state="pairing", _carrotId=None)
                self._move_toward(rabbit, self._safe_point(point["x"] + offset, point["y"]))
            vacancies -= 1

    def _advance_movement(self, rabbit, dt):
        movement = rabbit["_speed"] * dt * (1 if rabbit["adult"] else .72)
        was_moving = bool(rabbit["_path"])
        while movement > 0 and rabbit["_path"]:
            destination = rabbit["_path"][0]
            gap = self._distance(rabbit, destination)
            if abs(destination["x"] - rabbit["x"]) > .01:
                rabbit["direction"] = 1 if destination["x"] > rabbit["x"] else -1
            if gap <= movement:
                rabbit.update(destination)
                rabbit["_path"].pop(0)
                movement -= gap
            else:
                rabbit["x"] += (destination["x"] - rabbit["x"]) / gap * movement
                rabbit["y"] += (destination["y"] - rabbit["y"]) / gap * movement
                movement = 0
        rabbit["moving"] = bool(rabbit["_path"])
        rabbit["hopProgress"] = (rabbit["hopProgress"] + dt / .48) % 1 if rabbit["moving"] else 0
        if was_moving and not rabbit["moving"] and not rabbit["pairId"]:
            rabbit.update(state="idle", _wait=self._between(.5, 2.2))

    def update(self, dt):
        """Advance one bounded step; the service decides whether visitors are present."""
        if not self._finite(dt) or dt <= 0:
            return
        dt = min(dt, .1)
        self.time += dt
        for carrot in self.carrots:
            carrot["remaining"] -= dt
        self.carrots[:] = [carrot for carrot in self.carrots if carrot["remaining"] > 0]
        for rabbit in self.basket:
            rabbit["age"] += dt
            rabbit["adult"] = rabbit["age"] >= self.adult_age
        for rabbit in self.rabbits:
            rabbit["age"] += dt
            rabbit["adult"] = rabbit["age"] >= self.adult_age
            if rabbit["adult"]:
                rabbit["cooldown"] = max(0, rabbit["cooldown"] - dt)
            if rabbit["state"] == "roped":
                continue
            if not rabbit["pairId"]:
                nearby = [carrot for carrot in self.carrots if self._distance(rabbit, carrot) < 330]
                carrot = min(nearby, key=lambda item: self._distance(rabbit, item)) if nearby else None
                if carrot and rabbit["_carrotId"] != carrot["id"]:
                    rabbit["_carrotId"] = carrot["id"]
                    self._move_toward(rabbit, self._safe_point(carrot["x"] + self._between(-15, 15),
                                                             carrot["y"] + self._between(-12, 12)))
                elif not carrot:
                    rabbit["_carrotId"] = None
                if not rabbit["moving"]:
                    rabbit["_wait"] -= dt
                    if carrot and self._distance(rabbit, carrot) < 32:
                        carrot["remaining"] -= dt * .2
                    elif rabbit["_wait"] <= 0:
                        self._move_toward(rabbit, self._safe_point(rabbit["x"] + self._between(-145, 145),
                                                                 rabbit["y"] + self._between(-105, 105)))
            self._advance_movement(rabbit, dt)
        self._advance_lassos(dt)
        lookup = {rabbit["id"]: rabbit for rabbit in self.rabbits}
        for pair in list(self.pairs):
            first, second = lookup.get(pair["firstId"]), lookup.get(pair["secondId"])
            if not first or not second:
                self._end_pair(pair, interrupted=True)
                continue
            if pair["phase"] == "approaching" and not first["moving"] and not second["moving"]:
                pair["phase"] = first["state"] = second["state"] = "nesting"
            if pair["phase"] == "nesting":
                pair["elapsed"] += dt
                pair["progress"] = min(1, pair["elapsed"] / self.nesting_duration)
                first["pairProgress"] = second["pairProgress"] = pair["progress"]
                if pair["elapsed"] >= self.nesting_duration:
                    if self.total_count < self.max_rabbits:
                        self.rabbits.append(self._make_rabbit(pair["x"], pair["y"] + 15))
                        self.born_count += 1
                    self._end_pair(pair)
        self._pair_check -= dt
        if self._pair_check <= 0:
            self._pair_rabbits()
            self._pair_check = .5
        self._advance_encounter(dt)

    def _start_encounter(self, kind=None):
        # The basket is a refuge. Wildlife never takes the last two on the grass.
        if self.encounter is not None or len(self.rabbits) <= 2:
            return False
        kind = kind or self._random.choice(("eagle", "wolf"))
        if kind not in ("eagle", "wolf"):
            raise ValueError("unknown wildlife")
        if self._random.choice((True, False)):
            point = self._safe_point(self._random.choice((self.margin, self.width - self.margin)),
                                     self._between(self.margin, self.height - self.margin))
        else:
            point = self._safe_point(self._between(self.margin, self.width - self.margin),
                                     self._random.choice((self.margin, self.height - self.margin)))
        roped = [rabbit for rabbit in self.rabbits if rabbit["state"] == "roped"]
        target = self._random.choice(roped if roped and self._random.random() < .65 else self.rabbits)
        self.encounter = {
            "id": self._next_encounter_id, "kind": kind, "phase": "warning", **point,
            "direction": 1 if target["x"] >= point["x"] else -1,
            "targetId": target["id"], "remaining": 3.0, "carrying": None,
            "_path": [], "_routeIn": 0.0, "_leaveSpeed": 0.0,
        }
        self._next_encounter_id += 1
        return True

    def _move_wildlife(self, distance):
        animal = self.encounter
        while distance > 0 and animal["_path"]:
            destination = animal["_path"][0]
            gap = self._distance(animal, destination)
            if abs(destination["x"] - animal["x"]) > .01:
                animal["direction"] = 1 if destination["x"] > animal["x"] else -1
            if gap <= distance:
                animal.update(destination)
                animal["_path"].pop(0)
                distance -= gap
            else:
                animal["x"] += (destination["x"] - animal["x"]) / gap * distance
                animal["y"] += (destination["y"] - animal["y"]) / gap * distance
                break

    def _leave_encounter(self):
        animal = self.encounter
        exits = [self._safe_point(self.margin, animal["y"]),
                 self._safe_point(self.width - self.margin, animal["y"]),
                 self._safe_point(animal["x"], self.margin),
                 self._safe_point(animal["x"], self.height - self.margin)]
        routes = [self._route_to(animal, point) if animal["kind"] == "wolf" else [point]
                  for point in exits]
        def length(route):
            return sum(self._distance(first, second) for first, second in zip([animal, *route], route))
        route = min((route for route in routes if route), key=length)
        animal.update(phase="leaving", remaining=3.0, _path=route,
                      _routeIn=0.0, _leaveSpeed=length(route) / 3)

    def _advance_encounter(self, dt):
        if self.encounter is None:
            self._next_encounter_in = max(0.0, self._next_encounter_in - dt)
            if self._next_encounter_in <= 0:
                if not self._start_encounter():
                    self._next_encounter_in = self._between(35, 70)
            return
        animal = self.encounter
        animal["remaining"] = max(0.0, animal["remaining"] - dt)
        if animal["phase"] == "leaving":
            self._move_wildlife(animal["_leaveSpeed"] * dt)
            if animal["remaining"] <= 0:
                self.encounter = None
                self._next_encounter_in = self._between(35, 70)
            return
        target = next((rabbit for rabbit in self.rabbits if rabbit["id"] == animal["targetId"]), None)
        if target is None or len(self.rabbits) <= 2:
            self._leave_encounter()
            return
        if animal["phase"] == "warning":
            if animal["remaining"] <= 0:
                animal.update(phase="chasing", remaining=8.0)
            return
        if animal["remaining"] <= 0:
            self._leave_encounter()
            return
        animal["_routeIn"] -= dt
        if animal["kind"] == "eagle":
            animal["_path"] = [{"x": target["x"], "y": target["y"]}]
        elif animal["_routeIn"] <= 0 or not animal["_path"]:
            animal["_path"] = self._route_to(animal, {"x": target["x"], "y": target["y"]})
            animal["_routeIn"] = .4
        self._move_wildlife((260 if animal["kind"] == "eagle" else 220) * dt)
        if self._distance(animal, target) <= 22:
            pair = next((pair for pair in self.pairs if pair["id"] == target["pairId"]), None)
            if pair is not None:
                self._end_pair(pair, interrupted=True)
            lasso = next((item for item in self.lassos if item["rabbitId"] == target["id"]), None)
            if lasso is not None:
                self._finish_lasso(lasso, "stolen", target, settle=False)
            self.rabbits.remove(target)
            animal["carrying"] = {key: target[key] for key in ("id", "coat", "adult")}
            self.raided_count += 1
            self._leave_encounter()

    def add_carrot(self, x, y):
        if len(self.carrots) >= 6 or not self._finite(x) or not self._finite(y):
            return None
        carrot = {"id": self._next_carrot_id, **self._safe_point(x, y), "remaining": 18, "lifetime": 18}
        self._next_carrot_id += 1
        self.carrots.append(carrot)
        return carrot

    def catch(self, rabbit_id):
        if type(rabbit_id) is not int:
            return None
        rabbit = next((rabbit for rabbit in self.rabbits if rabbit["id"] == rabbit_id), None)
        if rabbit is None:
            return None
        pair = next((pair for pair in self.pairs if pair["id"] == rabbit["pairId"]), None)
        if pair:
            self._end_pair(pair, interrupted=True)
        lasso = next((item for item in self.lassos if item["rabbitId"] == rabbit_id), None)
        if lasso is not None:
            self._finish_lasso(lasso, "caught", rabbit, settle=False)
        self.rabbits.remove(rabbit)
        self._settle(rabbit)
        rabbit["state"] = "basket"
        self.basket.append(rabbit)
        return rabbit

    @staticmethod
    def _valid_owner(owner):
        return isinstance(owner, str) and len(owner) == 64 and all(character in "0123456789abcdef" for character in owner)

    def lasso_for(self, owner):
        return next((item["id"] for item in self.lassos if item["_owner"] == owner), None)

    @classmethod
    def _anchor_for_seat(cls, seat_id):
        if seat_id is None:
            return dict(cls.lasso_anchor)
        if type(seat_id) is not int or not 1 <= seat_id <= len(cls.seat_anchors):
            raise ValueError("invalid lasso seat")
        seat = cls.seat_anchors[seat_id - 1]
        return {"x": seat["x"], "y": seat["y"]}

    def start_lasso(self, rabbit_id, owner, seat_id=None):
        """Reserve a rabbit; a rope alone never moves it into the basket."""
        if not self._valid_owner(owner):
            raise ValueError("invalid lasso owner")
        anchor = self._anchor_for_seat(seat_id)
        rabbit = next((item for item in self.rabbits if type(rabbit_id) is int and item["id"] == rabbit_id), None)
        if rabbit is None:
            return "rabbit_gone"
        if self.lasso_for(owner) is not None:
            return "player_busy"
        if any(item["rabbitId"] == rabbit_id for item in self.lassos):
            return "rabbit_roped"
        if seat_id is not None and any(item["seatId"] == seat_id for item in self.lassos):
            return "seat_busy"
        if len(self.lassos) >= 8:
            return "lasso_limit"
        pair = next((item for item in self.pairs if item["id"] == rabbit["pairId"]), None)
        if pair is not None:
            self._end_pair(pair, interrupted=True)
        self._settle(rabbit)
        rabbit["state"] = "roped"
        path = self._route_to(rabbit, anchor)
        length = sum(self._distance(first, second) for first, second in zip([rabbit, *path], path))
        self.lassos.append({"id": self._next_lasso_id, "rabbitId": rabbit_id,
                            "seatId": seat_id, "anchorX": anchor["x"], "anchorY": anchor["y"],
                            "remaining": self.lasso_lifetime, "_owner": owner,
                            "_path": path, "_length": length, "_duration": max(4.5, length / 75),
                            "_elapsed": 0.0, "_lease": 0.0})
        self._next_lasso_id += 1
        return "lassoed"

    def _owned_lasso(self, lasso_id, owner):
        lasso = next((item for item in self.lassos if type(lasso_id) is int and item["id"] == lasso_id), None)
        return lasso, "lasso_gone" if lasso is None else "not_yours" if lasso["_owner"] != owner else None

    def pull_lasso(self, lasso_id, owner):
        lasso, error = self._owned_lasso(lasso_id, owner)
        if error:
            return error
        lasso["_lease"] = self.lasso_lease
        rabbit = next(item for item in self.rabbits if item["id"] == lasso["rabbitId"])
        rabbit["moving"] = bool(lasso["_path"])
        return "pulling"

    def stop_lasso(self, lasso_id, owner):
        lasso, error = self._owned_lasso(lasso_id, owner)
        if error:
            return error
        lasso["_lease"] = 0.0
        rabbit = next(item for item in self.rabbits if item["id"] == lasso["rabbitId"])
        rabbit.update(moving=False, hopProgress=0)
        return "pull_stopped"

    def cancel_lasso(self, lasso_id, owner):
        lasso, error = self._owned_lasso(lasso_id, owner)
        if error:
            return error
        rabbit = next(item for item in self.rabbits if item["id"] == lasso["rabbitId"])
        self._finish_lasso(lasso, "cancelled", rabbit)
        return "lasso_cancelled"

    def pause_lassos(self):
        """Used on service startup: restored ropes wait for their player's hand."""
        for lasso in self.lassos:
            self.stop_lasso(lasso["id"], lasso["_owner"])

    def _finish_lasso(self, lasso, outcome, rabbit, *, settle=True):
        self.lassos.remove(lasso)
        self.lasso_results.append({"id": lasso["id"], "rabbitId": lasso["rabbitId"],
                                   "seatId": lasso["seatId"], "anchorX": lasso["anchorX"], "anchorY": lasso["anchorY"],
                                   "outcome": outcome, "x": rabbit["x"], "y": rabbit["y"], "time": self.time})
        self.lasso_results[:] = self.lasso_results[-12:]
        if settle:
            self._settle(rabbit)

    def _advance_lassos(self, dt):
        self.lasso_results[:] = [item for item in self.lasso_results if self.time - item["time"] < 8]
        for lasso in list(self.lassos):
            rabbit = next(item for item in self.rabbits if item["id"] == lasso["rabbitId"])
            lasso["remaining"] = max(0.0, lasso["remaining"] - dt)
            if lasso["remaining"] <= 1e-9:
                self._finish_lasso(lasso, "escaped", rabbit)
                continue
            pulling_time = min(dt, lasso["_lease"], lasso["_duration"] - lasso["_elapsed"])
            lasso["_lease"] = max(0.0, lasso["_lease"] - dt)
            lasso["_elapsed"] += pulling_time
            distance = lasso["_length"] / lasso["_duration"] * pulling_time
            while lasso["_path"]:
                destination = lasso["_path"][0]
                gap = self._distance(rabbit, destination)
                if abs(destination["x"] - rabbit["x"]) > .01:
                    rabbit["direction"] = 1 if destination["x"] > rabbit["x"] else -1
                if gap <= distance + 1e-9:
                    rabbit.update(destination)
                    lasso["_path"].pop(0)
                    distance = max(0.0, distance - gap)
                else:
                    if distance > 0:
                        rabbit["x"] += (destination["x"] - rabbit["x"]) / gap * distance
                        rabbit["y"] += (destination["y"] - rabbit["y"]) / gap * distance
                    break
            if lasso["_elapsed"] >= lasso["_duration"] - 1e-9:
                self.catch(rabbit["id"])
            else:
                rabbit["moving"] = lasso["_lease"] > 1e-9 and bool(lasso["_path"])
                rabbit["hopProgress"] = (rabbit["hopProgress"] + pulling_time / .48) % 1 if rabbit["moving"] else 0

    def release_one(self):
        if not self.basket:
            return None
        rabbit = self.basket.pop(0)
        rabbit.update(self._safe_point())
        self._settle(rabbit)
        rabbit["cooldown"] = max(rabbit["cooldown"], 5)
        self.rabbits.append(rabbit)
        return rabbit

    def snapshot(self):
        public = lambda rabbit: {key: value for key, value in rabbit.items() if not key.startswith("_")}
        return {"width": self.width, "height": self.height, "maxRabbits": self.max_rabbits,
                "adultAge": self.adult_age, "time": self.time, "bornCount": self.born_count,
                "raidedCount": self.raided_count,
                "encounter": deepcopy(public(self.encounter)) if self.encounter is not None else None,
                "totalCount": self.total_count, "rabbits": [public(rabbit) for rabbit in self.rabbits],
                "basket": [public(rabbit) for rabbit in self.basket],
                "carrots": deepcopy(self.carrots), "pairs": deepcopy(self.pairs),
                "lassos": [{**public(item), "progress": min(1, item["_elapsed"] / item["_duration"]),
                            "pulling": item["_lease"] > 1e-9} for item in self.lassos],
                "lassoResults": deepcopy(self.lasso_results)}

    def export_state(self):
        # JSON encoding turns random's tuple hierarchy into arrays; from_state
        # restores that hierarchy before calling setstate(). No pickle is used.
        return deepcopy({"version": self.schema_version, "width": self.width, "height": self.height,
                         "maxRabbits": self.max_rabbits, "time": self.time, "bornCount": self.born_count,
                         "raidedCount": self.raided_count, "encounter": self.encounter,
                         "nextEncounterId": self._next_encounter_id, "nextEncounterIn": self._next_encounter_in,
                         "rabbits": self.rabbits, "basket": self.basket, "carrots": self.carrots,
                         "pairs": self.pairs, "receipts": self.receipts, "nextRabbitId": self._next_rabbit_id,
                         "lassos": self.lassos, "lassoResults": self.lasso_results, "nextLassoId": self._next_lasso_id,
                         "nextCarrotId": self._next_carrot_id, "nextPairId": self._next_pair_id,
                         "pairCheck": self._pair_check, "randomState": self._random.getstate()})

    @classmethod
    def from_state(cls, state):
        """Reject incomplete/corrupt state instead of silently deleting a shared world."""
        try:
            if (not isinstance(state, dict) or type(state["version"]) is not int
                    or state["version"] not in (1, 2, 3, cls.schema_version)):
                raise ValueError("unsupported meadow state version")
            if state["width"] != cls.width or state["height"] != cls.height:
                raise ValueError("unsupported meadow dimensions")
            model = cls(0, initial_count=0, max_rabbits=state["maxRabbits"])
            model.time, model.born_count = state["time"], state["bornCount"]
            model._pair_check = state["pairCheck"]
            for name in ("rabbits", "basket", "carrots", "pairs", "receipts"):
                setattr(model, name, deepcopy(state[name]))
            # The old shared meadow only had white rabbits. Upgrading preserves
            # every rabbit, action receipt and pairing instead of reseeding it.
            if state["version"] == 1:
                for rabbit in model.rabbits + model.basket:
                    rabbit["coat"] = "white"
                model.raided_count, model.encounter = 0, None
                model._next_encounter_id = 1
            else:
                model.raided_count = state["raidedCount"]
                model.encounter = deepcopy(state["encounter"])
                model._next_encounter_id = state["nextEncounterId"]
                model._next_encounter_in = state["nextEncounterIn"]
            model._next_rabbit_id = state["nextRabbitId"]
            model._next_carrot_id = state["nextCarrotId"]
            model._next_pair_id = state["nextPairId"]
            if state["version"] >= 3:
                model.lassos = deepcopy(state["lassos"])
                model.lasso_results = deepcopy(state["lassoResults"])
                model._next_lasso_id = state["nextLassoId"]
                if state["version"] == 3:
                    # Keep old pulls on their original route. New visits can
                    # finish them without shifting the rabbit to a new seat.
                    for lasso in model.lassos:
                        lasso["seatId"] = None
                    for result in model.lasso_results:
                        result.update(seatId=None, anchorX=cls.lasso_anchor["x"], anchorY=cls.lasso_anchor["y"])
            def tuples(value):
                return tuple(tuples(item) for item in value) if isinstance(value, (list, tuple)) else value
            model._random.setstate(tuples(state["randomState"]))
            if state["version"] == 1:
                model._next_encounter_in = model._between(15, 30)
            model._validate_state()
            return model
        except (KeyError, TypeError, IndexError, OverflowError, ValueError) as error:
            raise ValueError(f"Invalid persisted meadow state: {error}") from error

    def _validate_state(self):
        def number(value, low=0, high=math.inf):
            if not self._finite(value) or not low <= value <= high:
                raise ValueError("invalid numeric state")
        def integer(value, low=1):
            if type(value) is not int or value < low:
                raise ValueError("invalid identifier or count")
        def point(item):
            if not isinstance(item, dict) or not self.is_safe_position(item["x"], item["y"]):
                raise ValueError("position outside meadow")
        for items, limit in ((self.rabbits, 60), (self.basket, 60), (self.carrots, 6), (self.pairs, 30),
                             (self.lassos, 8), (self.lasso_results, 12)):
            if not isinstance(items, list) or len(items) > limit:
                raise ValueError("invalid entity collection")
        if self.total_count + len(self.pairs) > self.max_rabbits:
            raise ValueError("population exceeds capacity")
        if not isinstance(self.receipts, list) or len(self.receipts) > 1000:
            raise ValueError("invalid action receipts")
        request_ids = []
        for receipt in self.receipts:
            if not isinstance(receipt, dict) or type(receipt["ok"]) is not bool:
                raise ValueError("invalid action receipt")
            for key in ("requestId", "signature", "code"):
                if not isinstance(receipt[key], str) or not 1 <= len(receipt[key]) <= 512:
                    raise ValueError("invalid action receipt field")
            request_ids.append(receipt["requestId"])
        if len(set(request_ids)) != len(request_ids):
            raise ValueError("duplicate action receipt")
        number(self.time)
        integer(self.born_count, 0)
        integer(self.raided_count, 0)
        integer(self._next_encounter_id)
        number(self._next_encounter_in, 0, 70)
        number(self._pair_check, 0, .5)
        all_rabbits = self.rabbits + self.basket
        ids, carrot_ids, pair_ids = [], [], []
        for rabbit in all_rabbits:
            point(rabbit)
            integer(rabbit["id"])
            if rabbit["coat"] not in self.coats:
                raise ValueError("invalid rabbit coat")
            ids.append(rabbit["id"])
            for key in ("age", "cooldown", "_speed"):
                number(rabbit[key])
            number(rabbit["_wait"], -math.inf, 3)
            number(rabbit["hopProgress"], 0, 1)
            number(rabbit["pairProgress"], 0, 1)
            if type(rabbit["adult"]) is not bool or rabbit["adult"] != (rabbit["age"] >= self.adult_age):
                raise ValueError("inconsistent rabbit maturity")
            if type(rabbit["moving"]) is not bool or type(rabbit["direction"]) is not int or rabbit["direction"] not in (-1, 1):
                raise ValueError("invalid movement state")
            if rabbit["state"] not in ("idle", "hopping", "pairing", "nesting", "basket", "roped"):
                raise ValueError("invalid rabbit state")
            path = rabbit["_path"]
            if (not isinstance(path, list) or len(path) > 18
                    or (rabbit["state"] != "roped" and rabbit["moving"] != bool(path))
                    or (rabbit["state"] == "roped" and path)):
                raise ValueError("invalid route")
            previous = rabbit
            for destination in path:
                point(destination)
                if not self._segment_clear(previous, destination):
                    raise ValueError("route crosses water")
                previous = destination
            for key in ("partnerId", "pairId", "_carrotId"):
                if rabbit[key] is not None:
                    integer(rabbit[key])
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate rabbit")
        if any(rabbit["state"] != "basket" or rabbit["pairId"] or rabbit["moving"] for rabbit in self.basket):
            raise ValueError("invalid basket")
        if any(rabbit["state"] == "basket" for rabbit in self.rabbits):
            raise ValueError("basket rabbit on grass")
        for carrot in self.carrots:
            point(carrot)
            integer(carrot["id"])
            carrot_ids.append(carrot["id"])
            number(carrot["remaining"], -2, 18)
            if carrot["lifetime"] != 18:
                raise ValueError("invalid carrot lifetime")
        lookup = {rabbit["id"]: rabbit for rabbit in self.rabbits}
        lasso_ids, lasso_rabbits, owners, occupied_seats = [], [], [], []
        for lasso in self.lassos:
            expected = {"id", "rabbitId", "seatId", "anchorX", "anchorY", "remaining", "_owner", "_path",
                        "_length", "_duration", "_elapsed", "_lease"}
            if not isinstance(lasso, dict) or set(lasso) != expected or not self._valid_owner(lasso["_owner"]):
                raise ValueError("invalid lasso owner or fields")
            integer(lasso["id"])
            integer(lasso["rabbitId"])
            lasso_ids.append(lasso["id"])
            lasso_rabbits.append(lasso["rabbitId"])
            owners.append(lasso["_owner"])
            anchor = self._anchor_for_seat(lasso["seatId"])
            if lasso["seatId"] is not None:
                occupied_seats.append(lasso["seatId"])
            if lasso["anchorX"] != anchor["x"] or lasso["anchorY"] != anchor["y"]:
                raise ValueError("invalid lasso anchor")
            number(lasso["remaining"], 1e-9, self.lasso_lifetime)
            number(lasso["_length"], 0, 2000)
            number(lasso["_duration"], 4.5, 2000 / 75)
            if abs(lasso["_duration"] - max(4.5, lasso["_length"] / 75)) > 1e-8:
                raise ValueError("invalid lasso pulling duration")
            number(lasso["_elapsed"], 0, lasso["_duration"])
            number(lasso["_lease"], 0, self.lasso_lease)
            if lasso["_elapsed"] > self.lasso_lifetime - lasso["remaining"] + 1e-7:
                raise ValueError("lasso progressed faster than time")
            rabbit = lookup[lasso["rabbitId"]]
            if rabbit["state"] != "roped" or rabbit["pairId"] is not None or rabbit["_carrotId"] is not None:
                raise ValueError("invalid roped rabbit")
            path = lasso["_path"]
            if not isinstance(path, list) or len(path) > 18:
                raise ValueError("invalid lasso route")
            if rabbit["moving"] != (lasso["_lease"] > 1e-9 and bool(path)):
                raise ValueError("invalid lasso movement")
            previous, remaining_length = rabbit, 0.0
            for destination in path:
                point(destination)
                if set(destination) != {"x", "y"} or not self._segment_clear(previous, destination):
                    raise ValueError("lasso route crosses water")
                remaining_length += self._distance(previous, destination)
                previous = destination
            if previous["x"] != lasso["anchorX"] or previous["y"] != lasso["anchorY"]:
                raise ValueError("lasso route misses basket")
            expected_length = lasso["_length"] * (1 - lasso["_elapsed"] / lasso["_duration"])
            if abs(remaining_length - expected_length) > .001:
                raise ValueError("inconsistent lasso progress")
        if len(set(lasso_rabbits)) != len(lasso_rabbits) or len(set(owners)) != len(owners):
            raise ValueError("duplicate lasso rabbit or owner")
        if len(set(occupied_seats)) != len(occupied_seats):
            raise ValueError("duplicate lasso seat")
        if {rabbit["id"] for rabbit in all_rabbits if rabbit["state"] == "roped"} != set(lasso_rabbits):
            raise ValueError("orphaned lasso")
        previous_result_time = -1
        for result in self.lasso_results:
            if not isinstance(result, dict) or set(result) != {"id", "rabbitId", "seatId", "anchorX", "anchorY", "outcome", "x", "y", "time"}:
                raise ValueError("invalid lasso result")
            anchor = self._anchor_for_seat(result["seatId"])
            if result["anchorX"] != anchor["x"] or result["anchorY"] != anchor["y"]:
                raise ValueError("invalid result anchor")
            integer(result["id"])
            integer(result["rabbitId"])
            lasso_ids.append(result["id"])
            if result["rabbitId"] >= self._next_rabbit_id or result["outcome"] not in ("caught", "stolen", "escaped", "cancelled"):
                raise ValueError("invalid lasso outcome")
            point(result)
            number(result["time"], max(0, self.time - 8), self.time)
            if result["time"] < previous_result_time:
                raise ValueError("unordered lasso results")
            previous_result_time = result["time"]
        integer(self._next_lasso_id)
        if len(set(lasso_ids)) != len(lasso_ids) or self._next_lasso_id <= max(lasso_ids, default=0):
            raise ValueError("invalid next lasso identifier")
        partnered = set()
        for pair in self.pairs:
            point(pair)
            integer(pair["id"])
            pair_ids.append(pair["id"])
            number(pair["progress"], 0, 1)
            number(pair["elapsed"], 0, self.nesting_duration)
            if pair["phase"] not in ("approaching", "nesting") or pair["firstId"] == pair["secondId"]:
                raise ValueError("invalid pair")
            for identity, partner in ((pair["firstId"], pair["secondId"]), (pair["secondId"], pair["firstId"])):
                integer(identity)
                rabbit = lookup[identity]
                if identity in partnered or not rabbit["adult"] or rabbit["pairId"] != pair["id"] or rabbit["partnerId"] != partner:
                    raise ValueError("inconsistent pairing")
                partnered.add(identity)
        for rabbit in all_rabbits:
            if (rabbit["pairId"] is not None) != (rabbit["id"] in partnered):
                raise ValueError("orphaned pairing")
            if rabbit["pairId"] is None and rabbit["partnerId"] is not None:
                raise ValueError("orphaned partner")
        for identities, next_id in ((ids, self._next_rabbit_id), (carrot_ids, self._next_carrot_id), (pair_ids, self._next_pair_id)):
            integer(next_id)
            if len(set(identities)) != len(identities) or next_id <= max(identities, default=0):
                raise ValueError("invalid next identifier")
        if self.encounter is not None:
            animal = self.encounter
            if not isinstance(animal, dict):
                raise ValueError("invalid wildlife encounter")
            integer(animal["id"])
            if animal["id"] >= self._next_encounter_id or animal["kind"] not in ("eagle", "wolf"):
                raise ValueError("invalid wildlife identity")
            if animal["phase"] not in ("warning", "chasing", "leaving"):
                raise ValueError("invalid wildlife phase")
            number(animal["remaining"], 0, 8 if animal["phase"] == "chasing" else 3)
            number(animal["_routeIn"], -math.inf, .4)
            number(animal["_leaveSpeed"])
            integer(animal["targetId"])
            if animal["targetId"] >= self._next_rabbit_id:
                raise ValueError("invalid wildlife target")
            if type(animal["direction"]) is not int or animal["direction"] not in (-1, 1):
                raise ValueError("invalid wildlife direction")
            def wildlife_point(item):
                number(item["x"], self.margin, self.width - self.margin)
                number(item["y"], self.margin, self.height - self.margin)
                if animal["kind"] == "wolf":
                    point(item)
            wildlife_point(animal)
            if not isinstance(animal["_path"], list) or len(animal["_path"]) > 18:
                raise ValueError("invalid wildlife route")
            previous = animal
            for destination in animal["_path"]:
                wildlife_point(destination)
                if animal["kind"] == "wolf" and not self._segment_clear(previous, destination):
                    raise ValueError("wolf route crosses water")
                previous = destination
            carried = animal["carrying"]
            if carried is not None:
                if (not isinstance(carried, dict) or set(carried) != {"id", "coat", "adult"}
                        or animal["phase"] != "leaving" or self.raided_count < 1
                        or carried["id"] != animal["targetId"] or carried["id"] in ids
                        or carried["coat"] not in self.coats or type(carried["adult"]) is not bool):
                    raise ValueError("invalid carried rabbit")
                integer(carried["id"])


def load_meadow(path):
    """Create the singleton once, preserving all unrelated catalogue tables."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path, timeout=10)) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meadow_state'").fetchone()
        if exists is None:
            connection.execute("CREATE TABLE meadow_state (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, updated_at TEXT NOT NULL)")
            model = Meadow()
            connection.execute("INSERT INTO meadow_state(id, state, updated_at) VALUES(1, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
                               (json.dumps(model.export_state(), separators=(",", ":"), allow_nan=False),))
            return model
        row = connection.execute("SELECT state FROM meadow_state WHERE id=1").fetchone()
        if row is None:
            raise ValueError("Invalid persisted meadow state: singleton row is missing")
        try:
            state = json.loads(row[0])
        except (TypeError, ValueError) as error:
            raise ValueError("Invalid persisted meadow state: unreadable JSON") from error
        return Meadow.from_state(state)


def save_meadow(path, meadow):
    """Atomically checkpoint the whole world; a failed write retains the old row."""
    state = meadow.export_state()
    Meadow.from_state(state)  # Never overwrite a valid checkpoint with corrupt state.
    encoded = json.dumps(state, separators=(",", ":"), allow_nan=False)
    with closing(sqlite3.connect(path, timeout=10)) as connection, connection:
        cursor = connection.execute("UPDATE meadow_state SET state=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1", (encoded,))
        if cursor.rowcount != 1:
            raise ValueError("Meadow must be loaded before it can be saved")
