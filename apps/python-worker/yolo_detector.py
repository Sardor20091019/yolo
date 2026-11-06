import sys
import os
os.environ['YOLO_CONFIG_DIR'] = '/tmp/ultralytics_config'
os.environ['PYTHONUNBUFFERED'] = '1'

import base64
import time
import math
import argparse
from concurrent.futures import ThreadPoolExecutor
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
        self.executor = ThreadPoolExecutor(max_workers=2)

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
            repo_dir = os.path.dirname(base_dir)

            def resolve_model_file(name: str) -> str:
                if not name:
                    return ''
                paths_to_check = [
                    name,
                    os.path.join(base_dir, name),
                    os.path.join(repo_dir, name),
                    os.path.join(os.getcwd(), name),
                    os.path.join(base_dir, 'apps/python-worker', name),
                    os.path.join(repo_dir, 'apps/python-worker', name)
                ]
                for p in paths_to_check:
                    if os.path.isfile(p):
                        return p
                return name

            det_candidates = [
                resolve_model_file(det_path),
                resolve_model_file(det_fallback),
                resolve_model_file('yolo26m.pt'),
                resolve_model_file('yolo26n.pt'),
                resolve_model_file('yolo11m.pt'),
                resolve_model_file('yolo11n.pt'),
                'yolo26m.pt',
                'yolo11m.pt'
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
                resolve_model_file('yolo26n-pose.pt'),
                resolve_model_file('yolo11m-pose.pt'),
                resolve_model_file('yolo11n-pose.pt'),
                'yolo26m-pose.pt',
                'yolo11m-pose.pt'
            ]
            for candidate in pose_candidates:
                try:
                    self.pose_model = YOLO(candidate)
                    break
                except Exception:
                    continue

            if self.detection_model is not None and self.pose_model is not None:
                self.has_ultralytics = True
                self.executor = ThreadPoolExecutor(max_workers=2)
        except ImportError:
            self.has_ultralytics = False

    def decode_frame(self, frame_data: Any) -> Optional[Any]:
        if self.cv2 is None or self.np is None:
            return None
        if isinstance(frame_data, self.np.ndarray):
            return frame_data
        if not isinstance(frame_data, str) or not frame_data:
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
        boxes: List[Dict[str, Any]],
        suspicion: Optional[List[Dict[str, Any]]] = None,
        zones: Optional[List[Dict[str, Any]]] = None,
        fps: Optional[float] = None
    ) -> Any:
        if self.cv2 is None or self.np is None:
            return image

        canvas = image.copy()
        h, w = canvas.shape[:2]

        if zones:
            for zone in zones:
                polygon = zone.get('polygon', [])
                if len(polygon) >= 3:
                    pts = self.np.array([[int(p[0]), int(p[1])] for p in polygon], self.np.int32)
                    pts = pts.reshape((-1, 1, 2))
                    overlay = canvas.copy()
                    self.cv2.fillPoly(overlay, [pts], (240, 150, 40))
                    self.cv2.addWeighted(overlay, 0.25, canvas, 0.75, 0, canvas)
                    self.cv2.polylines(canvas, [pts], True, (255, 180, 50), 2, self.cv2.LINE_AA)
                    z_name = str(zone.get('name', 'ZONE')).upper()
                    cx = int(sum(p[0] for p in polygon) / len(polygon))
                    cy = int(sum(p[1] for p in polygon) / len(polygon))
                    self.cv2.putText(canvas, z_name, (cx - 40, cy), self.cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, self.cv2.LINE_AA)

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
                    self.cv2.circle(canvas, pt, 4, (60, 255, 120), -1, self.cv2.LINE_AA)

        suspicion_by_track: Dict[int, Dict[str, Any]] = {}
        if suspicion:
            for s in suspicion:
                tid = s.get('trackId')
                if tid is not None:
                    suspicion_by_track[tid] = s

        for b in boxes:
            bbox = b.get('bbox', [0, 0, 0, 0])
            x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
            label_name = b.get('label', 'object').lower()
            track_id = b.get('trackId', 0)

            if label_name == 'person':
                susp_info = suspicion_by_track.get(track_id, {})
                score = susp_info.get('score', 0.0)
                triggers = susp_info.get('triggers', [])

                if score >= 55.0 or len(triggers) > 0:
                    box_color = (40, 40, 235)
                    thickness = 3
                elif score >= 25.0:
                    box_color = (30, 180, 245)
                    thickness = 2
                else:
                    box_color = (70, 215, 70)
                    thickness = 2

                self.cv2.rectangle(canvas, (x1, y1), (x2, y2), box_color, thickness, self.cv2.LINE_AA)

                tag = f"PERSON #{track_id} | SUSP: {int(score)}%"
                (tw, th), _ = self.cv2.getTextSize(tag, self.cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
                top_y = max(0, y1 - th - 8)
                self.cv2.rectangle(canvas, (x1, top_y), (x1 + tw + 8, top_y + th + 8), box_color, -1)
                self.cv2.putText(canvas, tag, (x1 + 4, top_y + th + 2), self.cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, self.cv2.LINE_AA)

                waist_box = susp_info.get('waistBbox')
                if waist_box:
                    wx1, wy1, wx2, wy2 = [int(v) for v in waist_box]
                    self.cv2.rectangle(canvas, (wx1, wy1), (wx2, wy2), (230, 100, 240), 1, self.cv2.LINE_AA)

                for idx_trig, trig in enumerate(triggers):
                    trig_tag = f"! {trig}"
                    trig_y = y2 + 18 + (idx_trig * 20)
                    if trig_y < h:
                        self.cv2.putText(canvas, trig_tag, (x1, trig_y), self.cv2.FONT_HERSHEY_SIMPLEX, 0.45, (40, 40, 240), 2, self.cv2.LINE_AA)
            elif label_name == 'face':
                self.cv2.rectangle(canvas, (x1, y1), (x2, y2), (200, 100, 220), 1, self.cv2.LINE_AA)
            else:
                conf_val = int(b.get('confidence', 0) * 100)
                tag = f"{label_name.upper()} {conf_val}%"
                self.cv2.rectangle(canvas, (x1, y1), (x2, y2), (235, 170, 40), 2, self.cv2.LINE_AA)
                (tw, th), _ = self.cv2.getTextSize(tag, self.cv2.FONT_HERSHEY_SIMPLEX, 0.42, 1)
                top_y = max(0, y1 - th - 6)
                self.cv2.rectangle(canvas, (x1, top_y), (x1 + tw + 6, top_y + th + 6), (235, 170, 40), -1)
                self.cv2.putText(canvas, tag, (x1 + 3, top_y + th + 1), self.cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 0, 0), 1, self.cv2.LINE_AA)

        active_alerts = []
        if suspicion:
            for s in suspicion:
                for trig in s.get('triggers', []):
                    active_alerts.append(f"TRACK #{s.get('trackId')}: {trig}")

        if active_alerts:
            banner_h = 32 + (len(active_alerts) * 22)
            banner = canvas[0:banner_h, 0:w].copy()
            self.cv2.rectangle(canvas, (0, 0), (w, banner_h), (30, 30, 210), -1)
            self.cv2.addWeighted(canvas[0:banner_h, 0:w], 0.85, banner, 0.15, 0, canvas[0:banner_h, 0:w])
            self.cv2.putText(canvas, "SECURITY ALERT TRIGGERED", (15, 22), self.cv2.FONT_HERSHEY_SIMPLEX, 0.65, (255, 255, 255), 2, self.cv2.LINE_AA)
            for idx_a, alert_text in enumerate(active_alerts):
                self.cv2.putText(canvas, alert_text, (15, 46 + (idx_a * 22)), self.cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 240, 240), 1, self.cv2.LINE_AA)

        hud_y = banner_h + 20 if active_alerts else 25
        fps_text = f"FPS: {int(fps)}" if fps is not None else ""
        person_count = sum(1 for b in boxes if b.get('label') == 'person')
        item_count = sum(1 for b in boxes if b.get('label') not in ['person', 'face'])
        stats_text = f"{fps_text} | People: {person_count} | Items: {item_count}".strip(" |")
        self.cv2.putText(canvas, stats_text, (w - 320, 25), self.cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 2, self.cv2.LINE_AA)
        self.cv2.putText(canvas, stats_text, (w - 320, 25), self.cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 240, 100), 1, self.cv2.LINE_AA)

        return canvas

    def process_frame(
        self,
        frame_data: Any,
        frame_index: int,
        zones: List[Dict[str, Any]],
        calibration: Dict[str, Any],
        return_annotated: bool = False
    ) -> Dict[str, Any]:
        conf_thresh = max(0.18, min(float(calibration.get('confidenceThreshold', 0.25)), 0.35))

        if self.has_ultralytics:
            image = self.decode_frame(frame_data)
            if image is not None:
                result = self.run_yolo_inference(image, frame_index, zones, calibration, conf_thresh)
                if return_annotated:
                    annotated = self.overlay_stream_frame(
                        image=image,
                        poses=result.get('poses', []),
                        boxes=result.get('boxes', []),
                        suspicion=result.get('suspicion', []),
                        zones=zones
                    )
                    result['annotatedFrame'] = annotated
                return result

        return self.run_optical_simulation(frame_index, zones, calibration, conf_thresh)

    def run_optical_simulation(
        self,
        frame_index: int,
        zones: List[Dict[str, Any]],
        calibration: Dict[str, Any],
        conf_thresh: float
    ) -> Dict[str, Any]:
        return {
            'frameIndex': frame_index,
            'timestamp': int(time.time() * 1000),
            'boxes': [],
            'poses': [],
            'suspicion': [],
            'alertTriggered': False,
            'annotatedFrame': '',
            'isYoloActive': False,
            'engineError': 'YOLO model inference is offline or models failed to initialize'
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
                retail_label = MAP_COCO_TO_RETAIL.get(raw_label, raw_label)
                track_id = int(boxes.id[i].item()) if getattr(boxes, 'id', None) is not None and boxes.id[i] is not None else (i + 1)

                item_info = {
                    'trackId': track_id,
                    'label': retail_label,
                    'confidence': round(conf, 2),
                    'bbox': [round(x, 1) for x in xyxy]
                }
                boxes_out.append(item_info)

        for pr in pose_results:
            p_boxes = getattr(pr, 'boxes', None)
            p_keypoints = getattr(pr, 'keypoints', None)
            if p_boxes is None or p_keypoints is None:
                continue

            for i in range(len(p_boxes)):
                p_track_id = int(p_boxes.id[i].item()) if getattr(p_boxes, 'id', None) is not None and p_boxes.id[i] is not None else (i + 1)
                p_xyxy = p_boxes.xyxy[i].cpu().numpy().tolist()
                p_conf = float(p_boxes.conf[i].item())

                has_person = any(b.get('label') == 'person' and abs(b['bbox'][0] - p_xyxy[0]) < 50 for b in boxes_out)
                if not has_person:
                    boxes_out.insert(0, {
                        'trackId': p_track_id,
                        'label': 'person',
                        'confidence': round(p_conf, 2),
                        'bbox': [round(x, 1) for x in p_xyxy]
                    })

                kp_data = p_keypoints.data[i].cpu().numpy()

                formatted_kps = []
                face_pts = []
                for k_idx in range(min(len(kp_data), len(KEYPOINT_NAMES))):
                    kx, ky, kc = float(kp_data[k_idx][0]), float(kp_data[k_idx][1]), float(kp_data[k_idx][2])
                    formatted_kps.append({
                        'x': round(kx, 1),
                        'y': round(ky, 1),
                        'confidence': round(kc, 2),
                        'name': KEYPOINT_NAMES[k_idx]
                    })
                    if k_idx in [0, 1, 2, 3, 4] and kc >= 0.15 and kx > 0 and ky > 0:
                        face_pts.append((kx, ky))

                poses_out.append({
                    'trackId': p_track_id,
                    'keypoints': formatted_kps,
                    'skeleton': SKELETON_PAIRS
                })

                face_box = None
                if len(face_pts) >= 2:
                    xs = [pt[0] for pt in face_pts]
                    ys = [pt[1] for pt in face_pts]
                    fx1, fx2 = min(xs), max(xs)
                    fy1, fy2 = min(ys), max(ys)
                    fw = fx2 - fx1
                    fh = fy2 - fy1
                    pad = max(24.0, max(fw, fh) * 0.5)
                    face_box = [max(0.0, fx1 - pad), max(0.0, fx1 - pad), fx2 + pad, fy2 + pad]
                elif len(face_pts) == 1:
                    cx, cy = face_pts[0]
                    rad = 38.0
                    face_box = [max(0.0, cx - rad), max(0.0, cy - rad), cx + rad, cy + rad]
                elif len(formatted_kps) > 6:
                    ls = formatted_kps[5]
                    rs = formatted_kps[6]
                    if ls['confidence'] >= 0.25 and rs['confidence'] >= 0.25 and ls['x'] > 0 and rs['x'] > 0:
                        head_cx = (ls['x'] + rs['x']) / 2.0
                        shoulder_w = abs(ls['x'] - rs['x'])
                        head_h = max(35.0, shoulder_w * 0.75)
                        head_cy = min(ls['y'], rs['y']) - (head_h * 0.55)
                        if head_cy > 0:
                            rad = head_h * 0.5
                            face_box = [max(0.0, head_cx - rad), max(0.0, head_cy - rad), head_cx + rad, head_cy + rad]

                if face_box:
                    boxes_out.append({
                        'trackId': p_track_id,
                        'label': 'face',
                        'confidence': 0.95,
                        'bbox': [round(v, 1) for v in face_box]
                    })

        suspicion_out: List[Dict[str, Any]] = []
        alert_triggered = False
        detected_items = [b for b in boxes_out if b.get('label') not in ['person', 'face']]

        for pose in poses_out:
            p_tid = pose.get('trackId')
            kps = pose.get('keypoints', [])
            matching_box = next((b for b in boxes_out if b.get('label') == 'person' and b.get('trackId') == p_tid), None)
            if not matching_box:
                continue

            person_bbox = tuple(matching_box['bbox'])
            eval_res = self.heuristics.evaluate_person(
                track_id=p_tid,
                person_bbox=person_bbox,
                keypoints=kps,
                detected_items=detected_items,
                zones=zones,
                calibration=calibration
            )
            suspicion_out.append(eval_res)
            if eval_res.get('score', 0) >= 50.0 or len(eval_res.get('triggers', [])) > 0:
                alert_triggered = True

        self.heuristics.cleanup_stale_tracks()

        return {
            'frameIndex': frame_index,
            'timestamp': int(time.time() * 1000),
            'boxes': boxes_out,
            'poses': poses_out,
            'suspicion': suspicion_out,
            'alertTriggered': alert_triggered,
            'annotatedFrame': '',
            'isYoloActive': True
        }

    def run_live(
        self,
        source: Any = 0,
        zones: Optional[List[Dict[str, Any]]] = None,
        calibration: Optional[Dict[str, Any]] = None,
        conf_thresh: float = 0.25,
        window_title: str = "Live Shoplifting Detection & Heuristics"
    ) -> None:
        if self.cv2 is None:
            sys.stderr.write("OpenCV is not available.\n")
            return

        active_zones = zones if zones is not None else []
        active_calib = calibration if calibration is not None else {
            'confidenceThreshold': conf_thresh,
            'loiteringThresholdSeconds': 8,
            'nervousCheckSensitivity': 3
        }

        cap = self.cv2.VideoCapture(source)
        if not cap.isOpened():
            sys.stderr.write(f"Failed to open video source: {source}\n")
            if source == 0 and os.path.exists("test-video.mp4"):
                sys.stderr.write("Switching to fallback 'test-video.mp4'...\n")
                cap = self.cv2.VideoCapture("test-video.mp4")
            if not cap.isOpened():
                return

        frame_idx = 0
        p_time = time.time()

        try:
            while True:
                success, frame = cap.read()
                if not success:
                    if isinstance(source, str) and os.path.isfile(source):
                        cap.set(self.cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    break

                frame_idx += 1
                c_time = time.time()
                elapsed = c_time - p_time
                fps = 1.0 / elapsed if elapsed > 0 else 0.0
                p_time = c_time

                result = self.run_yolo_inference(
                    image=frame,
                    frame_index=frame_idx,
                    zones=active_zones,
                    calibration=active_calib,
                    conf_thresh=conf_thresh
                )

                annotated = self.overlay_stream_frame(
                    image=frame,
                    poses=result.get('poses', []),
                    boxes=result.get('boxes', []),
                    suspicion=result.get('suspicion', []),
                    zones=active_zones,
                    fps=fps
                )

                self.cv2.imshow(window_title, annotated)
                key = self.cv2.waitKey(1) & 0xFF
                if key == ord('q') or key == 27:
                    break
                elif key == ord('c'):
                    self.heuristics.clear_tracks()
                elif key == ord('s'):
                    snap_name = f"snapshot_{int(time.time())}.jpg"
                    self.cv2.imwrite(snap_name, annotated)
                elif key == ord('z'):
                    if active_zones:
                        active_zones = []
                    else:
                        h, w = frame.shape[:2]
                        active_zones = [{
                            'id': 'shelf_1',
                            'name': 'High Value Shelf',
                            'polygon': [
                                [int(w * 0.05), int(h * 0.35)],
                                [int(w * 0.45), int(h * 0.35)],
                                [int(w * 0.45), int(h * 0.85)],
                                [int(w * 0.05), int(h * 0.85)]
                            ],
                            'dwellLimit': 5
                        }]
        finally:
            cap.release()
            self.cv2.destroyAllWindows()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Live Camera / Video Shoplifting Detection")
    parser.add_argument('--source', default=0, help="Webcam index (e.g. 0) or path to video file")
    parser.add_argument('--det-model', default='yolo26m.pt', help="Path to YOLO detection model")
    parser.add_argument('--pose-model', default='yolo26m-pose.pt', help="Path to YOLO pose model")
    parser.add_argument('--conf', type=float, default=0.25, help="Confidence threshold")
    parser.add_argument('--demo-zone', action='store_true', help="Enable demo high-value shelf polygon")

    args = parser.parse_args()

    cam_source: Any = args.source
    if isinstance(cam_source, str) and cam_source.isdigit():
        cam_source = int(cam_source)

    initial_zones = []
    if args.demo_zone:
        initial_zones.append({
            'id': 'demo_zone_1',
            'name': 'High Value Display',
            'polygon': [[40, 150], [400, 150], [400, 600], [40, 600]],
            'dwellLimit': 5
        })

    detector = YoloShopliftingDetector(
        detection_model_path=args.det_model,
        pose_model_path=args.pose_model
    )

    detector.run_live(
        source=cam_source,
        zones=initial_zones,
        conf_thresh=args.conf
    )
