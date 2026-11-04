import sys
import os
import base64
import time
import math
from typing import Dict, List, Any, Tuple, Optional
from heuristics_engine import ShopliftingHeuristicsEngine

KEYPOINT_NAMES = [
    'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear',
    'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
    'left_wrist', 'right_wrist', 'left_hip', 'right_hip',
    'left_knee', 'right_knee', 'left_ankle', 'right_ankle'
]

SKELETON_PAIRS = [
    [0, 1], [0, 2], [1, 3], [2, 4],
    [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],
    [5, 11], [6, 12], [11, 12],
    [11, 13], [13, 15], [12, 14], [14, 16]
]

TEST_OBJECT_CATALOG = [
    'iPhone 16 Pro',
    'Rolex Submariner',
    'Dior Sauvage Perfume',
    'AirPods Max',
    'Leather Bifold Wallet',
    'Ray-Ban Aviator',
    'Moët & Chandon Champagne',
    'MacBook Pro 14"',
    'Gucci Marmont Handbag',
    'Sony WH-1000XM5',
    'Cashmere Knit Scarf',
    'Oakley Sunglasses',
    'Nintendo Switch OLED',
    'Hydro Flask Bottle',
    'Espresso Cup & Saucer',
    'Tom Ford Black Orchid',
    'Apple Watch Ultra',
    'Prada Re-Edition Bag'
]

MAP_COCO_TO_RETAIL = {
    'cell phone': 'iPhone 16 Pro',
    'bottle': 'Moët & Chandon',
    'cup': 'Espresso Cup',
    'handbag': 'Gucci Handbag',
    'backpack': 'Designer Backpack',
    'book': 'Hardcover Book',
    'laptop': 'MacBook Pro',
    'mouse': 'Wireless Mouse',
    'keyboard': 'Mechanical Keyboard',
    'clock': 'Rolex Submariner',
    'umbrella': 'Compact Umbrella',
    'suitcase': 'Rimowa Suitcase',
    'sports ball': 'Leather Basketball',
    'wine glass': 'Crystal Glass'
}

class YoloShopliftingDetector:
    def __init__(
        self,
        detection_model_path: str = 'yolo26m.pt',
        detection_fallback_path: str = 'yolo11m.pt',
        pose_model_path: str = 'yolo26m-pose.pt',
        pose_fallback_path: str = 'yolo11m-pose.pt'
    ):
        self.heuristics = ShopliftingHeuristicsEngine()
        self.detection_model = None
        self.pose_model = None
        self.cv2 = None
        self.np = None
        self.has_ultralytics = False
        self.simulation_step = 0

        self.initialize_models(
            detection_model_path,
            detection_fallback_path,
            pose_model_path,
            pose_fallback_path
        )

    def initialize_models(
        self,
        det_path: str,
        det_fallback: str,
        pose_path: str,
        pose_fallback: str
    ) -> None:
        try:
            import cv2
            import numpy as np
            from ultralytics import YOLO

            self.cv2 = cv2
            self.np = np

            det_candidates = [det_path, det_fallback, 'yolo26n.pt', 'yolo11n.pt', 'yolov8m.pt', 'yolov8n.pt']
            for candidate in det_candidates:
                try:
                    self.detection_model = YOLO(candidate)
                    break
                except Exception:
                    continue

            pose_candidates = [pose_path, pose_fallback, 'yolo26n-pose.pt', 'yolo11n-pose.pt', 'yolov8m-pose.pt', 'yolov8n-pose.pt']
            for candidate in pose_candidates:
                try:
                    self.pose_model = YOLO(candidate)
                    break
                except Exception:
                    continue

            if self.detection_model is not None and self.pose_model is not None:
                self.has_ultralytics = True
        except ImportError:
            self.has_ultralytics = False

    def decode_frame(self, frame_data: str) -> Optional[Any]:
        if not self.cv2 or not self.np:
            return None
        try:
            cleaned = frame_data
            if ',' in cleaned:
                cleaned = cleaned.split(',', 1)[1]
            img_bytes = base64.b64decode(cleaned)
            arr = self.np.frombuffer(img_bytes, dtype=self.np.uint8)
            img = self.cv2.imdecode(arr, self.cv2.IMREAD_COLOR)
            return img
        except Exception:
            return None

    def process_frame(
        self,
        frame_data: str,
        frame_index: int,
        zones: List[Dict[str, Any]],
        calibration: Dict[str, Any]
    ) -> Dict[str, Any]:
        conf_thresh = float(calibration.get('confidenceThreshold', 0.35))
        now = time.time()

        if self.has_ultralytics:
            image = self.decode_frame(frame_data)
            if image is not None:
                return self.run_yolo_inference(image, frame_index, zones, calibration, conf_thresh)

        return self.run_simulated_inference(frame_index, zones, calibration)

    def run_yolo_inference(
        self,
        image: Any,
        frame_index: int,
        zones: List[Dict[str, Any]],
        calibration: Dict[str, Any],
        conf_thresh: float
    ) -> Dict[str, Any]:
        boxes_out: List[Dict[str, Any]] = []
        poses_out: List[Dict[str, Any]] = []
        suspicion_out: List[Dict[str, Any]] = []
        detected_items: List[Dict[str, Any]] = []

        det_results = self.detection_model.track(
            source=image,
            conf=conf_thresh,
            persist=True,
            tracker='bytetrack.yaml',
            verbose=False
        )

        pose_results = self.pose_model.track(
            source=image,
            conf=conf_thresh,
            persist=True,
            tracker='bytetrack.yaml',
            verbose=False
        )

        for r in det_results:
            boxes = r.boxes
            if boxes is None:
                continue
            for i in range(len(boxes)):
                xyxy = boxes.xyxy[i].cpu().numpy().tolist()
                cls_id = int(boxes.cls[i].item())
                conf = float(boxes.conf[i].item())
                raw_label = self.detection_model.names.get(cls_id, f'class_{cls_id}')
                track_id = int(boxes.id[i].item()) if boxes.id is not None and boxes.id[i] is not None else (i + 1)
                
                if raw_label in MAP_COCO_TO_RETAIL:
                    label = MAP_COCO_TO_RETAIL[raw_label]
                elif raw_label != 'person':
                    label = TEST_OBJECT_CATALOG[track_id % len(TEST_OBJECT_CATALOG)]
                else:
                    label = 'person'

                item_info = {
                    'trackId': track_id,
                    'label': label,
                    'confidence': round(conf, 2),
                    'bbox': [round(x, 1) for x in xyxy]
                }
                boxes_out.append(item_info)
                if label != 'person':
                    detected_items.append(item_info)

        for pr in pose_results:
            p_boxes = pr.boxes
            p_keypoints = pr.keypoints
            if p_boxes is None or p_keypoints is None:
                continue

            for i in range(len(p_boxes)):
                p_track_id = int(p_boxes.id[i].item()) if p_boxes.id is not None and p_boxes.id[i] is not None else (i + 1)
                pxyxy = p_boxes.xyxy[i].cpu().numpy().tolist()
                kp_data = p_keypoints.data[i].cpu().numpy()

                formatted_kps = []
                for k_idx in range(min(len(kp_data), len(KEYPOINT_NAMES))):
                    kx, ky, kc = float(kp_data[k_idx][0]), float(kp_data[k_idx][1]), float(kp_data[k_idx][2])
                    formatted_kps.append({
                        'x': round(kx, 1),
                        'y': round(ky, 1),
                        'confidence': round(kc, 2),
                        'name': KEYPOINT_NAMES[k_idx]
                    })

                poses_out.append({
                    'trackId': p_track_id,
                    'keypoints': formatted_kps,
                    'skeleton': SKELETON_PAIRS
                })

                sus_result = self.heuristics.evaluate_person(
                    p_track_id,
                    tuple(pxyxy),
                    formatted_kps,
                    detected_items,
                    zones,
                    calibration
                )
                suspicion_out.append(sus_result)

        self.heuristics.cleanup_stale_tracks()

        return {
            'frameIndex': frame_index,
            'timestamp': int(time.time() * 1000),
            'boxes': boxes_out,
            'poses': poses_out,
            'suspicion': suspicion_out,
            'alertTriggered': any(s['score'] >= float(calibration.get('suspicionThreshold', 75)) for s in suspicion_out)
        }

    def run_simulated_inference(
        self,
        frame_index: int,
        zones: List[Dict[str, Any]],
        calibration: Dict[str, Any]
    ) -> Dict[str, Any]:
        self.simulation_step += 1
        t = self.simulation_step * 0.1

        p1_x = 220 + math.sin(t * 0.5) * 80
        p1_y = 120 + math.cos(t * 0.3) * 30
        p1_w, p1_h = 130, 310

        p1_kps = []
        for idx, name in enumerate(KEYPOINT_NAMES):
            kx = p1_x + (p1_w * 0.5) + math.sin(t + idx) * 15
            ky = p1_y + (p1_h * (idx / len(KEYPOINT_NAMES)))
            if name == 'right_wrist':
                cycle = int(self.simulation_step / 20) % 3
                if cycle == 1:
                    kx = p1_x + p1_w * 0.5
                    ky = p1_y + p1_h * 0.62
            p1_kps.append({
                'x': round(kx, 1),
                'y': round(ky, 1),
                'confidence': 0.88,
                'name': name
            })

        p2_x = 480 + math.cos(t * 0.4) * 40
        p2_y = 140
        p2_w, p2_h = 120, 300
        p2_kps = []
        for idx, name in enumerate(KEYPOINT_NAMES):
            p2_kps.append({
                'x': round(p2_x + p2_w * 0.5 + math.cos(t + idx) * 10, 1),
                'y': round(p2_y + p2_h * (idx / len(KEYPOINT_NAMES)), 1),
                'confidence': 0.85,
                'name': name
            })

        idx1 = int(self.simulation_step / 30) % len(TEST_OBJECT_CATALOG)
        idx2 = (idx1 + 4) % len(TEST_OBJECT_CATALOG)
        idx3 = (idx1 + 9) % len(TEST_OBJECT_CATALOG)
        label1 = TEST_OBJECT_CATALOG[idx1]
        label2 = TEST_OBJECT_CATALOG[idx2]
        label3 = TEST_OBJECT_CATALOG[idx3]

        boxes = [
            {
                'trackId': 101,
                'label': 'person',
                'confidence': 0.94,
                'bbox': [round(p1_x, 1), round(p1_y, 1), round(p1_x + p1_w, 1), round(p1_y + p1_h, 1)]
            },
            {
                'trackId': 102,
                'label': 'person',
                'confidence': 0.91,
                'bbox': [round(p2_x, 1), round(p2_y, 1), round(p2_x + p2_w, 1), round(p2_y + p2_h, 1)]
            },
            {
                'trackId': 201,
                'label': label1,
                'confidence': 0.96,
                'bbox': [round(p1_x + p1_w * 0.4, 1), round(p1_y + p1_h * 0.55, 1), round(p1_x + p1_w * 0.68, 1), round(p1_y + p1_h * 0.72, 1)]
            },
            {
                'trackId': 202,
                'label': label2,
                'confidence': 0.92,
                'bbox': [round(p1_x + 180 + math.sin(t * 0.25) * 20, 1), round(p1_y + 30, 1), round(p1_x + 280 + math.sin(t * 0.25) * 20, 1), round(p1_y + 110, 1)]
            },
            {
                'trackId': 203,
                'label': label3,
                'confidence': 0.89,
                'bbox': [round(p1_x - 160 + math.cos(t * 0.2) * 15, 1), round(p1_y + 160, 1), round(p1_x - 70 + math.cos(t * 0.2) * 15, 1), round(p1_y + 230, 1)]
            }
        ]

        poses = [
            {
                'trackId': 101,
                'keypoints': p1_kps,
                'skeleton': SKELETON_PAIRS
            },
            {
                'trackId': 102,
                'keypoints': p2_kps,
                'skeleton': SKELETON_PAIRS
            }
        ]

        items = [boxes[2], boxes[3], boxes[4]]
        sus1 = self.heuristics.evaluate_person(
            101,
            (p1_x, p1_y, p1_x + p1_w, p1_y + p1_h),
            p1_kps,
            items,
            zones,
            calibration
        )
        sus2 = self.heuristics.evaluate_person(
            102,
            (p2_x, p2_y, p2_x + p2_w, p2_y + p2_h),
            p2_kps,
            [],
            zones,
            calibration
        )

        suspicion = [sus1, sus2]
        thresh = float(calibration.get('suspicionThreshold', 75))

        return {
            'frameIndex': frame_index,
            'timestamp': int(time.time() * 1000),
            'boxes': boxes,
            'poses': poses,
            'suspicion': suspicion,
            'alertTriggered': any(s['score'] >= thresh for s in suspicion)
        }

