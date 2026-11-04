import sys
import os
import time
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from heuristics_engine import ShopliftingHeuristicsEngine

class TestShopliftingHeuristics(unittest.TestCase):
    def setUp(self):
        self.engine = ShopliftingHeuristicsEngine()
        self.default_calibration = {
            'loiteringThresholdSeconds': 5.0,
            'nervousCheckSensitivity': 3,
            'suspicionThreshold': 75.0,
            'confidenceThreshold': 0.35
        }

    def test_point_in_polygon(self):
        polygon = [[0, 0], [100, 0], [100, 100], [0, 100]]
        self.assertTrue(self.engine.point_in_polygon(50, 50, polygon))
        self.assertFalse(self.engine.point_in_polygon(150, 50, polygon))

    def test_concealment_gesture(self):
        track_id = 1
        person_bbox = (100.0, 100.0, 200.0, 400.0)
        items = [{
            'trackId': 50,
            'label': 'bottle',
            'bbox': [130.0, 240.0, 160.0, 280.0]
        }]
        keypoints = [
            {'name': 'right_wrist', 'x': 145.0, 'y': 250.0, 'confidence': 0.9},
            {'name': 'left_wrist', 'x': 110.0, 'y': 200.0, 'confidence': 0.9},
            {'name': 'left_hip', 'x': 130.0, 'y': 270.0, 'confidence': 0.9},
            {'name': 'right_hip', 'x': 170.0, 'y': 270.0, 'confidence': 0.9},
        ]

        res1 = self.engine.evaluate_person(track_id, person_bbox, keypoints, items, [], self.default_calibration)
        self.assertIn(track_id, self.engine.tracks)

        keypoints_conceal = [
            {'name': 'right_wrist', 'x': 150.0, 'y': 275.0, 'confidence': 0.9},
            {'name': 'left_wrist', 'x': 110.0, 'y': 200.0, 'confidence': 0.9},
            {'name': 'left_hip', 'x': 130.0, 'y': 270.0, 'confidence': 0.9},
            {'name': 'right_hip', 'x': 170.0, 'y': 270.0, 'confidence': 0.9},
        ]
        res2 = self.engine.evaluate_person(track_id, person_bbox, keypoints_conceal, [], [], self.default_calibration)
        self.assertGreaterEqual(res2['concealmentScore'], 50.0)
        self.assertGreaterEqual(res2['score'], 50.0)

    def test_nervous_waist_check(self):
        track_id = 2
        person_bbox = (100.0, 100.0, 200.0, 400.0)
        hip_kps = [
            {'name': 'left_hip', 'x': 130.0, 'y': 270.0, 'confidence': 0.9},
            {'name': 'right_hip', 'x': 170.0, 'y': 270.0, 'confidence': 0.9},
        ]

        for cycle in range(3):
            kps_outside = hip_kps + [{'name': 'right_wrist', 'x': 190.0, 'y': 220.0, 'confidence': 0.9}]
            self.engine.evaluate_person(track_id, person_bbox, kps_outside, [], [], self.default_calibration)

            kps_inside = hip_kps + [{'name': 'right_wrist', 'x': 150.0, 'y': 275.0, 'confidence': 0.9}]
            res = self.engine.evaluate_person(track_id, person_bbox, kps_inside, [], [], self.default_calibration)

        self.assertGreaterEqual(res['nervousCount'], 3)
        self.assertGreaterEqual(res['nervousCheckScore'], 15.0)

    def test_high_value_zone_loitering(self):
        track_id = 3
        person_bbox = (100.0, 100.0, 200.0, 400.0)
        zones = [{
            'id': 'zone-1',
            'name': 'High-End Shelf',
            'polygon': [[50, 300], [250, 300], [250, 500], [50, 500]],
            'dwellLimit': 0.1
        }]
        keypoints = [
            {'name': 'left_hip', 'x': 130.0, 'y': 270.0, 'confidence': 0.9},
            {'name': 'right_hip', 'x': 170.0, 'y': 270.0, 'confidence': 0.9},
        ]

        self.engine.evaluate_person(track_id, person_bbox, keypoints, [], zones, self.default_calibration)
        time.sleep(0.15)
        res = self.engine.evaluate_person(track_id, person_bbox, keypoints, [], zones, self.default_calibration)
        self.assertGreater(res['loiteringScore'], 0.0)
        self.assertEqual(res['zoneName'], 'High-End Shelf')

if __name__ == '__main__':
    unittest.main()
