from http.server import BaseHTTPRequestHandler
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from yolo_detector import YoloShopliftingDetector

detector = YoloShopliftingDetector(
    detection_model_path=os.getenv('YOLO_DETECTION_MODEL', 'yolo26m.pt'),
    detection_fallback_path=os.getenv('YOLO_DETECTION_FALLBACK_MODEL', 'yolo26m.pt'),
    pose_model_path=os.getenv('YOLO_POSE_MODEL', 'yolo26m-pose.pt'),
    pose_fallback_path=os.getenv('YOLO_POSE_FALLBACK_MODEL', 'yolo26m-pose.pt')
)

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        response = {'status': 'ok', 'service': 'python-worker'}
        self.wfile.write(json.dumps(response).encode('utf-8'))

    def do_POST(self):
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            req = json.loads(post_data.decode('utf-8'))

            frame_data = req.get('frameData', '')
            frame_index = req.get('frameIndex', 0)
            zones = req.get('zones', [])
            calibration = req.get('calibration', {})

            result = detector.process_frame(
                frame_data=frame_data,
                frame_index=frame_index,
                zones=zones,
                calibration=calibration
            )

            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(result).encode('utf-8'))
        except Exception as exc:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            error_response = {'error': str(exc)}
            self.wfile.write(json.dumps(error_response).encode('utf-8'))

if __name__ == '__main__':
    from http.server import HTTPServer
    port = int(os.getenv('PORT', os.getenv('PYTHON_WORKER_PORT', '5001')))
    server = HTTPServer(('0.0.0.0', port), handler)
    server.serve_forever()

