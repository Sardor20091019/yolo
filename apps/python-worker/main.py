import sys
import os
import json
import argparse
import asyncio
from yolo_detector import YoloShopliftingDetector

def run_ipc_loop(detector: YoloShopliftingDetector) -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get('requestId', 0)
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

            response = {
                'requestId': req_id,
                'result': result
            }
            sys.stdout.write(json.dumps(response) + '\n')
            sys.stdout.flush()
        except Exception as exc:
            err_resp = {
                'requestId': req.get('requestId', 0) if 'req' in locals() else 0,
                'error': str(exc),
                'result': {
                    'frameIndex': req.get('frameIndex', 0) if 'req' in locals() else 0,
                    'boxes': [],
                    'poses': [],
                    'suspicion': [],
                    'alertTriggered': False
                }
            }
            sys.stdout.write(json.dumps(err_resp) + '\n')
            sys.stdout.flush()

async def handle_ws_client(websocket, detector: YoloShopliftingDetector) -> None:
    async for message in websocket:
        try:
            req = json.loads(message)
            req_id = req.get('requestId', 0)
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

            await websocket.send(json.dumps({
                'requestId': req_id,
                'result': result
            }))
        except Exception as exc:
            await websocket.send(json.dumps({
                'error': str(exc)
            }))

async def run_websocket_server(detector: YoloShopliftingDetector, host: str, port: int) -> None:
    try:
        import websockets
        async with websockets.serve(lambda ws: handle_ws_client(ws, detector), host, port):
            sys.stderr.write(f'Python YOLO worker listening on ws://{host}:{port}\n')
            await asyncio.Future()
    except ImportError:
        sys.stderr.write('websockets module not installed, switching to IPC mode.\n')
        run_ipc_loop(detector)

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--detection-model', default=os.getenv('YOLO_DETECTION_MODEL', 'yolo26n.pt'))
    parser.add_argument('--detection-fallback', default=os.getenv('YOLO_DETECTION_FALLBACK_MODEL', 'yolo11n.pt'))
    parser.add_argument('--pose-model', default=os.getenv('YOLO_POSE_MODEL', 'yolo26n-pose.pt'))
    parser.add_argument('--pose-fallback', default=os.getenv('YOLO_POSE_FALLBACK_MODEL', 'yolo11n-pose.pt'))
    parser.add_argument('--mode', default=os.getenv('PYTHON_WORKER_MODE', 'ipc'))
    parser.add_argument('--host', default=os.getenv('PYTHON_WORKER_HOST', '127.0.0.1'))
    parser.add_argument('--port', type=int, default=int(os.getenv('PYTHON_WORKER_PORT', '5001')))

    args = parser.parse_args()

    detector = YoloShopliftingDetector(
        detection_model_path=args.detection_model,
        detection_fallback_path=args.detection_fallback,
        pose_model_path=args.pose_model,
        pose_fallback_path=args.pose_fallback
    )

    if args.mode.lower() == 'websocket':
        asyncio.run(run_websocket_server(detector, args.host, args.port))
    else:
        run_ipc_loop(detector)

if __name__ == '__main__':
    main()
