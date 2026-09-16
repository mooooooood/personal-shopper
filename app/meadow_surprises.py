"""Small shared, harmless meadow surprises; no additional background workers."""
import math


class SurpriseMixin:
    surprise_kinds = ('hero', 'pirates', 'ufo', 'carrot_rain', 'rain', 'mushrooms',
                      'train', 'dinosaur', 'ghosts', 'king')
    surprise_duration = 24.0
    surprise_mushrooms = ((360, 330), (530, 360), (680, 410))
    surprise_anchors = {
        'hero': (500, 280), 'pirates': (700, 280), 'ufo': (500, 300),
        'carrot_rain': (500, 300), 'rain': (500, 260), 'mushrooms': (500, 340),
        'train': (150, 530), 'dinosaur': (520, 150), 'ghosts': (500, 340), 'king': (200, 400),
    }

    def _init_surprises(self):
        self.surprise = None
        self._next_surprise_id = 1
        self._surprise_queue = []
        # Reuse the initial random delay without perturbing existing rabbit paths.
        self._next_surprise_in = self._next_encounter_in + 5

    def _surprise_eligible(self, rabbit):
        return (rabbit['burrow'] is None and rabbit['_burrowTarget'] is None
                and rabbit['pairId'] is None and rabbit['state'] not in ('roped', 'basket')
                and not any(rope['rabbitId'] == rabbit['id'] for rope in self.lassos)
                and not self._dog_near(rabbit))

    def _surprise_participant(self, rabbit):
        return self.surprise is not None and rabbit['id'] in self.surprise['rabbitIds']

    def _release_surprise_rabbit(self, rabbit):
        if self._surprise_participant(rabbit):
            self.surprise['rabbitIds'].remove(rabbit['id'])

    def _start_surprise(self, kind=None):
        if self.surprise is not None or self.encounter is not None:
            return False
        if kind is not None and kind not in self.surprise_kinds:
            raise ValueError('unknown meadow surprise')
        if kind is None:
            if not self._surprise_queue:
                self._surprise_queue = list(self.surprise_kinds)
                self._random.shuffle(self._surprise_queue)
            kind = self._surprise_queue.pop(0)
        x, y = self.surprise_anchors[kind]
        eligible = [rabbit for rabbit in self.rabbits if self._surprise_eligible(rabbit)]
        limit = {'pirates': 1, 'ufo': 1, 'mushrooms': 3, 'train': 3, 'ghosts': 4, 'king': 5}.get(kind, 0)
        selected = sorted(eligible, key=lambda rabbit: (self._distance(rabbit, {'x': x, 'y': y}), rabbit['id']))[:limit]
        if kind == 'ufo' and selected:
            x, y = selected[0]['x'], selected[0]['y']
        self.surprise = {
            'id': self._next_surprise_id, 'kind': kind, 'seed': self._random.randrange(2 ** 31),
            'x': x, 'y': y, 'elapsed': 0.0, 'duration': self.surprise_duration,
            'rabbitIds': [rabbit['id'] for rabbit in selected], 'carrotIds': [],
            '_milestone': 0, '_routeIn': 0.0,
        }
        self._next_surprise_id += 1
        return True

    def _surprise_flee(self, x, y, radius):
        origin = {'x': x, 'y': y}
        for rabbit in self.rabbits:
            if not self._surprise_eligible(rabbit) or self._distance(rabbit, origin) > radius:
                continue
            angle = math.atan2(rabbit['y'] - y, rabbit['x'] - x)
            exits = [self._safe_point(rabbit['x'] + math.cos(angle + turn) * 150,
                                     rabbit['y'] + math.sin(angle + turn) * 150)
                     for turn in (0, -.8, .8)]
            rabbit['_carrotId'] = None
            self._move_toward(rabbit, max(exits, key=lambda point: self._distance(origin, point)))

    def _prune_surprise_participants(self):
        if self.surprise is not None:
            eligible_ids = {rabbit["id"] for rabbit in self.rabbits if self._surprise_eligible(rabbit)}
            self.surprise["rabbitIds"][:] = [identity for identity in self.surprise["rabbitIds"] if identity in eligible_ids]

    def _advance_surprise(self, dt, *, schedule=True):
        event = self.surprise
        if event is None:
            # Pausing this clock during wildlife prevents back-to-back overlap.
            if not schedule or self.encounter is not None:
                return
            self._next_surprise_in = max(0.0, self._next_surprise_in - dt)
            if self._next_surprise_in <= 0:
                self._start_surprise()
            return
        event['elapsed'] = min(event['duration'], event['elapsed'] + dt)
        if event['duration'] - event['elapsed'] < 1e-8:
            self.surprise = None
            self._next_surprise_in = self._between(35, 65)
            self._next_encounter_in = max(12, self._next_encounter_in)
            return
        self._prune_surprise_participants()
        kind, elapsed = event['kind'], event['elapsed']
        milestones = {'hero': (3,), 'pirates': (5,), 'dinosaur': (10,),
                      'carrot_rain': (4, 7, 10), 'king': (20,)}.get(kind, ())
        while event['_milestone'] < len(milestones) and elapsed + 1e-8 >= milestones[event['_milestone']]:
            stage = event['_milestone']
            event['_milestone'] += 1
            if kind in ('hero', 'pirates', 'dinosaur'):
                self._surprise_flee(event['x'], event['y'], 290 if kind != 'pirates' else 170)
            else:
                location = ((360, 250), (600, 360), (420, 450))[stage] if kind == 'carrot_rain' else (800, 400)
                carrot = self.add_carrot(*location)
                if carrot:
                    event['carrotIds'].append(carrot['id'])
        event['_routeIn'] = max(0.0, event['_routeIn'] - dt)

    def _advance_surprise_rabbit(self, rabbit, dt):
        """Control only chosen free rabbits, using existing safe ground routes."""
        if not self._surprise_participant(rabbit):
            return False
        event = self.surprise
        kind, elapsed = event['kind'], event['elapsed']
        index = event['rabbitIds'].index(rabbit['id'])
        holding = ((kind == 'ufo' and 5 <= elapsed <= 13)
                   or (kind == 'pirates' and 6 <= elapsed <= 12)
                   or (kind == 'ghosts' and 6 <= elapsed <= 18))
        if holding:
            rabbit.update(_path=[], moving=False, state='idle', hopProgress=0)
            return True
        if kind == 'train' and 2 <= elapsed <= 18:
            progress = max(0, min(1, (elapsed - 8) / 10))
            destination = {'x': 150 + 700 * progress - 80 - 62 * index, 'y': 530}
        elif kind == 'mushrooms' and 2 <= elapsed <= 18:
            x, y = self.surprise_mushrooms[index]
            destination = {'x': x, 'y': y}
        elif kind == 'king' and 2 <= elapsed <= 20:
            progress = max(0, min(1, (elapsed - 4) / 16))
            destination = {'x': 200 + 600 * progress - 32 * (index + 1), 'y': 400 + 7 * (index % 2)}
        elif kind == 'ghosts' and elapsed < 6:
            hole = min(self.burrows, key=lambda point: self._distance(rabbit, point))
            destination = {'x': hole['x'] + 28, 'y': hole['y'] + 18}
        else:
            return False
        if kind in ('train', 'king') or event['_routeIn'] <= 0 or not rabbit['_path']:
            self._move_toward(rabbit, destination)
        self._advance_movement(rabbit, dt * (2.0 if kind == 'train' else 1.2))
        return True

    def _validate_surprises(self):
        def integer(value, low=0, high=2 ** 63):
            if type(value) is not int or not low <= value <= high:
                raise ValueError('invalid surprise identifier')
        def number(value, low, high):
            if not self._finite(value) or not low <= value <= high:
                raise ValueError('invalid surprise timer')
        integer(self._next_surprise_id, 1)
        number(self._next_surprise_in, 0, 65)
        queue = self._surprise_queue
        if (not isinstance(queue, list) or len(queue) > 10 or any(kind not in self.surprise_kinds for kind in queue)
                or len(set(queue)) != len(queue)):
            raise ValueError('invalid surprise queue')
        event = self.surprise
        if event is None:
            return
        if (not isinstance(event, dict) or set(event) != {
                'id', 'kind', 'seed', 'x', 'y', 'elapsed', 'duration', 'rabbitIds', 'carrotIds', '_milestone', '_routeIn'}):
            raise ValueError('invalid surprise')
        if self.encounter is not None or event['kind'] not in self.surprise_kinds:
            raise ValueError('overlapping or unknown surprise')
        integer(event['id'], 1, self._next_surprise_id - 1)
        integer(event['seed'], 0, 2 ** 31 - 1)
        if not self.is_safe_position(event['x'], event['y']):
            raise ValueError('invalid surprise anchor')
        number(event['elapsed'], 0, self.surprise_duration - 1e-9)
        if type(event['duration']) not in (int, float) or event['duration'] != self.surprise_duration:
            raise ValueError('invalid surprise duration')
        number(event['_routeIn'], 0, .5)
        limits = {'pirates': 1, 'ufo': 1, 'mushrooms': 3, 'train': 3, 'ghosts': 4, 'king': 5}
        for field, limit, maximum in (('rabbitIds', limits.get(event['kind'], 0), self._next_rabbit_id - 1),
                                      ('carrotIds', 3 if event['kind'] == 'carrot_rain' else 1 if event['kind'] == 'king' else 0, self._next_carrot_id - 1)):
            ids = event[field]
            if not isinstance(ids, list) or len(ids) > limit:
                raise ValueError('invalid surprise participants')
            for identity in ids:
                integer(identity, 1, maximum)
            if len(set(ids)) != len(ids):
                raise ValueError('duplicate surprise participants')
        eligible_ids = {rabbit['id'] for rabbit in self.rabbits if self._surprise_eligible(rabbit)}
        if any(identity not in eligible_ids for identity in event['rabbitIds']):
            raise ValueError('unavailable surprise participant')
        stages = {'hero': (3,), 'pirates': (5,), 'dinosaur': (10,), 'carrot_rain': (4, 7, 10), 'king': (20,)}.get(event['kind'], ())
        integer(event['_milestone'], 0, len(stages))
        if event['_milestone'] != sum(event['elapsed'] + 1e-8 >= stage for stage in stages):
            raise ValueError('inconsistent surprise milestone')
        if len(event['carrotIds']) > event['_milestone']:
            raise ValueError('impossible surprise carrots')
