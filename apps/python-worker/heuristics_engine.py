import time
import math
from typing import Dict, List, Tuple, Any, Optional

PORTABLE_ITEMS = {
    'bottle', 'cell phone', 'book', 'cup', 'backpack', 'handbag',
    'remote', 'clock', 'scissors', 'toothbrush', 'umbrella'
}

class TrackState:
    def __init__(self, track_id: int):
        self.track_id = track_id
        self.last_seen: float = time.time()
        self.wrist_in_waist_prev: Dict[str, bool] = {'left': False, 'right': False}
        self.waist_entries: List[float] = []
        self.portable_item_interactions: List[Tuple[float, str]] = []
        self.concealment_events: List[float] = []
        self.zone_dwell: Dict[str, float] = {}
        self.zone_entry_time: Dict[str, float] = {}

class ShopliftingHeuristicsEngine:
    def __init__(self):
        self.tracks: Dict[int, TrackState] = {}
        self.cleanup_interval_seconds: float = 30.0
        self.last_cleanup: float = time.time()

    def get_or_create_track(self, track_id: int) -> TrackState:
        now = time.time()
        if track_id not in self.tracks:
            self.tracks[track_id] = TrackState(track_id)
        state = self.tracks[track_id]
        state.last_seen = now
        return state

    def cleanup_stale_tracks(self) -> None:
        now = time.time()
        if now - self.last_cleanup < self.cleanup_interval_seconds:
            return
        self.last_cleanup = now
        stale_ids = [
            tid for tid, s in self.tracks.items()
            if now - s.last_seen > self.cleanup_interval_seconds
        ]
        for tid in stale_ids:
            del self.tracks[tid]

    def point_in_polygon(self, x: float, y: float, polygon: List[List[float]]) -> bool:
        if len(polygon) < 3:
            return False
        inside = False
        j = len(polygon) - 1
        for i in range(len(polygon)):
            xi, yi = polygon[i][0], polygon[i][1]
            xj, yj = polygon[j][0], polygon[j][1]
            intersect = ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-9) + xi)
            if intersect:
                inside = not inside
            j = i
        return inside

    def point_inside_bbox(self, px: float, py: float, bbox: Tuple[float, float, float, float]) -> bool:
        bx1, by1, bx2, by2 = bbox
        return bx1 <= px <= bx2 and by1 <= py <= by2

    def distance(self, p1: Tuple[float, float], p2: Tuple[float, float]) -> float:
        return math.hypot(p1[0] - p2[0], p1[1] - p2[1])

    def calculate_waist_zone(
        self,
        keypoints: List[Dict[str, Any]],
        person_bbox: Tuple[float, float, float, float]
    ) -> Tuple[float, float, float, float]:
        left_hip = next((kp for kp in keypoints if kp.get('name') == 'left_hip'), None)
        right_hip = next((kp for kp in keypoints if kp.get('name') == 'right_hip'), None)

        px1, py1, px2, py2 = person_bbox
        person_w = px2 - px1
        person_h = py2 - py1

        if left_hip and right_hip and left_hip.get('confidence', 0) > 0.3 and right_hip.get('confidence', 0) > 0.3:
            lx, ly = left_hip['x'], left_hip['y']
            rx, ry = right_hip['x'], right_hip['y']
            hx1 = min(lx, rx) - 0.25 * person_w
            hx2 = max(lx, rx) + 0.25 * person_w
            hy1 = min(ly, ry) - 0.15 * person_h
            hy2 = max(ly, ry) + 0.30 * person_h
            return (hx1, hy1, hx2, hy2)

        wy1 = py1 + 0.48 * person_h
        wy2 = py1 + 0.75 * person_h
        wx1 = px1 + 0.15 * person_w
        wx2 = px2 - 0.15 * person_w
        return (wx1, wy1, wx2, wy2)

    def evaluate_person(
        self,
        track_id: int,
        person_bbox: Tuple[float, float, float, float],
        keypoints: List[Dict[str, Any]],
        detected_items: List[Dict[str, Any]],
        zones: List[Dict[str, Any]],
        calibration: Dict[str, Any]
    ) -> Dict[str, Any]:
        state = self.get_or_create_track(track_id)
        now = time.time()

        loitering_limit = float(calibration.get('loiteringThresholdSeconds', 10))
        nervous_sensitivity = int(calibration.get('nervousCheckSensitivity', 3))

        left_wrist = next((kp for kp in keypoints if kp.get('name') == 'left_wrist'), None)
        right_wrist = next((kp for kp in keypoints if kp.get('name') == 'right_wrist'), None)

        waist_bbox = self.calculate_waist_zone(keypoints, person_bbox)

        for item in detected_items:
            item_label = item.get('label', '').lower()
            if item_label not in PORTABLE_ITEMS:
                continue
            ix1, iy1, ix2, iy2 = item.get('bbox', [0, 0, 0, 0])
            item_center = ((ix1 + ix2) / 2.0, (iy1 + iy2) / 2.0)
            item_radius = max((ix2 - ix1), (iy2 - iy1)) * 0.75

            for wrist in [left_wrist, right_wrist]:
                if wrist and wrist.get('confidence', 0) > 0.35:
                    d = self.distance((wrist['x'], wrist['y']), item_center)
                    if d < max(65.0, item_radius):
                        state.portable_item_interactions.append((now, item_label))

        state.portable_item_interactions = [
            (t, l) for (t, l) in state.portable_item_interactions if now - t <= 8.0
        ]

        wrists = [('left', left_wrist), ('right', right_wrist)]
        for side, wrist in wrists:
            if wrist and wrist.get('confidence', 0) > 0.35:
                in_waist = self.point_inside_bbox(wrist['x'], wrist['y'], waist_bbox)
                prev_in_waist = state.wrist_in_waist_prev.get(side, False)

                if in_waist and not prev_in_waist:
                    state.waist_entries.append(now)
                    if len(state.portable_item_interactions) > 0:
                        state.concealment_events.append(now)

                state.wrist_in_waist_prev[side] = in_waist

        window_seconds = 6.0
        state.waist_entries = [t for t in state.waist_entries if now - t <= window_seconds]
        state.concealment_events = [t for t in state.concealment_events if now - t <= 10.0]

        concealment_score = 0.0
        triggers = []

        if len(state.concealment_events) > 0:
            concealment_score = 50.0
            recent_item = state.portable_item_interactions[-1][1] if state.portable_item_interactions else 'item'
            triggers.append(f'Concealment motion into waist/pocket ({recent_item})')

        nervous_count = len(state.waist_entries)
        nervous_score = 0.0
        if nervous_count >= nervous_sensitivity:
            nervous_score = min(35.0, 15.0 + (nervous_count - nervous_sensitivity + 1) * 7.0)
            triggers.append(f'Nervous waist check ({nervous_count}x in {int(window_seconds)}s)')

        person_base_x = (person_bbox[0] + person_bbox[2]) / 2.0
        person_base_y = person_bbox[3]

        loitering_score = 0.0
        current_zone_name: Optional[str] = None
        current_loitering_seconds = 0.0

        for zone in zones:
            zone_id = str(zone.get('id', ''))
            zone_name = str(zone.get('name', 'High Value Zone'))
            polygon = zone.get('polygon', [])
            dwell_limit = float(zone.get('dwellLimit', loitering_limit))

            is_inside = self.point_in_polygon(person_base_x, person_base_y, polygon)
            if is_inside:
                if zone_id not in state.zone_entry_time:
                    state.zone_entry_time[zone_id] = now
                entry = state.zone_entry_time[zone_id]
                dwell_sec = now - entry
                state.zone_dwell[zone_id] = dwell_sec

                if dwell_sec > current_loitering_seconds:
                    current_loitering_seconds = dwell_sec
                    current_zone_name = zone_name

                if dwell_sec >= dwell_limit:
                    excess = dwell_sec - dwell_limit
                    score_for_zone = min(30.0, 10.0 + excess * 2.0)
                    if score_for_zone > loitering_score:
                        loitering_score = score_for_zone
            else:
                if zone_id in state.zone_entry_time:
                    del state.zone_entry_time[zone_id]
                if zone_id in state.zone_dwell:
                    del state.zone_dwell[zone_id]

        if loitering_score > 0:
            triggers.append(f'Loitering in {current_zone_name} ({int(current_loitering_seconds)}s)')

        total_score = min(100.0, concealment_score + nervous_score + loitering_score)

        return {
            'trackId': track_id,
            'score': round(total_score, 1),
            'concealmentScore': round(concealment_score, 1),
            'nervousCheckScore': round(nervous_score, 1),
            'loiteringScore': round(loitering_score, 1),
            'loiteringSeconds': round(current_loitering_seconds, 1),
            'nervousCount': nervous_count,
            'zoneName': current_zone_name,
            'triggers': triggers
        }

