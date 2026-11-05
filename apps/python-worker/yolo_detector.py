import sys
import os
os.environ['YOLO_CONFIG_DIR'] = '/tmp/ultralytics_config'
os.environ['PYTHONUNBUFFERED'] = '1'

import base64
import time
import math
import concurrent.futures
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

MAP_COCO_TO_RETAIL = {
    'cell phone': 'phone',
    'bottle': 'bottle',
    'cup': 'cup',
    'handbag': 'bag',
    'backpack': 'backpack',
    'book': 'book',
    'laptop': 'laptop',
    'mouse': 'mouse',
    'keyboard': 'keyboard',
    'chair': 'chair',
    'couch': 'sofa',
    'dining table': 'desk',
    'clock': 'clock',
    'umbrella': 'umbrella',
    'scissors': 'scissors',
    'wine glass': 'glass'
}

class YoloShopliftingDetector:
    def __init__(
        self,
        detection_model_path: str = 'yolo26m.pt',
        detection_fallback_path: str = 'yolo26m.pt',
        pose_model_path: str = 'yolo26m-pose.pt',
        pose_fallback_path: str = 'yolo26m-pose.pt'
    ):
        self.heuristics = ShopliftingHeuristicsEngine()
        self.detection_model = None
        self.pose_model = None
        self.cv2 = None
        self.np = None
        self.has_ultralytics = False
        self.simulation_step = 0
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)

        self.initialize_models(
            detection_model_path,
            detection_fallback_path,
            pose_model_path,
            pose_fallback_path
        )

    def __del__(self) -> None:
        if hasattr(self, 'executor') and self.executor:
            self.executor.shutdown(wait=False)

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

            base_dir = os.path.dirname(os.path.abspath(__file__))
            repo_dir = os.path.dirname(os.path.dirname(base_dir))

            def resolve_model_file(name: str) -> str:
                paths_to_check = [
                    name,
                    os.path.join(base_dir, name),
                    os.path.join(repo_dir, name),
                    os.path.join(os.getcwd(), name),
                    os.path.join(base_dir, 'yolo26m.pt'),
                    os.path.join(base_dir, 'yolo26m-pose.pt')
                ]
                for p in paths_to_check:
                    if os.path.isfile(p):
                        return p
                return name

            det_candidates = [
                resolve_model_file(det_path),
                resolve_model_file(det_fallback),
                resolve_model_file('yolo26m.pt'),
                resolve_model_file('yolo11n.pt'),
                'yolo26m.pt'
            ]
            for candidate in det_candidates:
                try:
                    self.detection_model = YOLO(candidate)
                    break
                except Exception:
                    continue

            pose_candidates = [
                resolve_model_file(pose_path),
                resolve_model_file(pose_fallback),
                resolve_model_file('yolo26m-pose.pt'),
                resolve_model_file('yolo11n-pose.pt'),
                'yolo26m-pose.pt'
            ]
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

    def predict_detection(self, image: Any, conf_thresh: float) -> List[Any]:
        if not self.detection_model:
            return []
        try:
            return self.detection_model.predict(
                source=image,
                conf=conf_thresh,
                verbose=False
            )
        except Exception:
            return []

    def predict_pose(self, image: Any, conf_thresh: float) -> List[Any]:
        if not self.pose_model:
            return []
        try:
            return self.pose_model.predict(
                source=image,
                conf=conf_thresh,
                verbose=False
            )
        except Exception:
            return []

    def overlay_stream_frame(
        self,
        image: Any,
        poses: List[Dict[str, Any]],
        boxes: List[Dict[str, Any]]
    ) -> Any:
        if self.cv2 is None:
            return image

        canvas = image.copy()

        for pose in poses:
            kps = pose.get('keypoints', [])
            skel = pose.get('skeleton', SKELETON_PAIRS)
            for pair in skel:
                p1_idx, p2_idx = pair[0], pair[1]
                if p1_idx < len(kps) and p2_idx < len(kps):
                    pt1 = kps[p1_idx]
                    pt2 = kps[p2_idx]
                    if pt1.get('confidence', 0) >= 0.25 and pt2.get('confidence', 0) >= 0.25:
                        c1 = (int(pt1['x']), int(pt1['y']))
                        c2 = (int(pt2['x']), int(pt2['y']))
                        self.cv2.line(canvas, c1, c2, (40, 210, 245), 2, self.cv2.LINE_AA)

            for kp in kps:
                if kp.get('confidence', 0) >= 0.25:
                    pt = (int(kp['x']), int(kp['y']))
                    self.cv2.circle(canvas, pt, 3, (60, 255, 120), -1, self.cv2.LINE_AA)

        for b in boxes:
            bbox = b.get('bbox', [0, 0, 0, 0])
            x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
            label_name = b.get('label', 'object').upper()
            conf_val = int(b.get('confidence', 0) * 100)
            tag = f"{label_name} {conf_val}%"

            rect_color = (60, 60, 225) if b.get('label') == 'person' else (225, 160, 45)
            self.cv2.rectangle(canvas, (x1, y1), (x2, y2), rect_color, 2, self.cv2.LINE_AA)

            (tw, th), _ = self.cv2.getTextSize(tag, self.cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
            top_y = max(0, y1 - th - 6)
            self.cv2.rectangle(canvas, (x1, top_y), (x1 + tw + 6, top_y + th + 6), rect_color, -1)
            self.cv2.putText(canvas, tag, (x1 + 3, top_y + th + 1), self.cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, self.cv2.LINE_AA)

        return canvas

    def process_frame(
        self,
        frame_data: str,
        frame_index: int,
        zones: List[Dict[str, Any]],
        calibration: Dict[str, Any]
    ) -> Dict[str, Any]:
        conf_thresh = float(calibration.get('confidenceThreshold', 0.35))

        if self.has_ultralytics:
            image = self.decode_frame(frame_data)
            if image is not None:
                return self.run_yolo_inference(image, frame_index, zones, calibration, conf_thresh)

        return {
            'frameIndex': frame_index,
            'timestamp': int(time.time() * 1000),
            'boxes': [],
            'poses': [],
            'suspicion': [],
            'alertTriggered': False,
            'annotatedFrame': ''
        }

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

        future_det = self.executor.submit(self.predict_detection, image, conf_thresh)
        future_pose = self.executor.submit(self.predict_pose, image, conf_thresh)

        det_results = future_det.result()
        pose_results = future_pose.result()

        for r in det_results:
            boxes = getattr(r, 'boxes', None)
            if boxes is None:
                continue
            for i in range(len(boxes)):
                xyxy = boxes.xyxy[i].cpu().numpy().tolist()
                cls_id = int(boxes.cls[i].item())
                conf = float(boxes.conf[i].item())
                raw_label = self.detection_model.names.get(cls_id, f'class_{cls_id}').lower()
                track_id = int(boxes.id[i].item()) if getattr(boxes, 'id', None) is not None and boxes.id[i] is not None else (i + 1)

                if raw_label in MAP_COCO_TO_RETAIL:
                    label = MAP_COCO_TO_RETAIL[raw_label]
                elif raw_label != 'person':
                    label = raw_label
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
            p_boxes = getattr(pr, 'boxes', None)
            p_keypoints = getattr(pr, 'keypoints', None)
            if p_boxes is None or p_keypoints is None:
                continue

            for i in range(len(p_boxes)):
                p_track_id = int(p_boxes.id[i].item()) if getattr(p_boxes, 'id', None) is not None and p_boxes.id[i] is not None else (i + 1)
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

        annotated_buffer = self.overlay_stream_frame(image, poses_out, boxes_out)
        annotated_base64 = ''
        if self.cv2 is not None:
            try:
                ret, buf = self.cv2.imencode('.jpg', annotated_buffer, [int(self.cv2.IMWRITE_JPEG_QUALITY), 70])
                if ret:
                    annotated_base64 = 'data:image/jpeg;base64,' + base64.b64encode(buf).decode('utf-8')
            except Exception:
                pass

        return {
            'frameIndex': frame_index,
            'timestamp': int(time.time() * 1000),
            'boxes': boxes_out,
            'poses': poses_out,
            'suspicion': suspicion_out,
            'alertTriggered': any(s['score'] >= float(calibration.get('suspicionThreshold', 75)) for s in suspicion_out),
            'annotatedFrame': annotated_base64
        }
