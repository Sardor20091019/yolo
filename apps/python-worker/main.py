import sys
import os
os.makedirs('/tmp/yolo_config', exist_ok=True)
os.environ['YOLO_CONFIG_DIR'] = '/tmp/yolo_config'
os.environ['PYTHONUNBUFFERED'] = '1'

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
                calibration=calibration,
                return_annotated=True
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
                    'alertTriggered': False,
                    'isYoloActive': False,
                    'engineError': str(exc)
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
                calibration=calibration,
                return_annotated=True
            )

            response = {
                'requestId': req_id,
                'result': result
            }
            await websocket.send(json.dumps(response))
        except Exception as exc:
            err_resp = {
                'requestId': 0,
                'error': str(exc),
                'result': {
                    'frameIndex': 0,
                    'boxes': [],
                    'poses': [],
                    'suspicion': [],
                    'alertTriggered': False
                }
            }
            await websocket.send(json.dumps(err_resp))

def run_ws_server(detector: YoloShopliftingDetector, host: str, port: int) -> None:
    try:
        import websockets
        async def main():
            async with websockets.serve(lambda ws: handle_ws_client(ws, detector), host, port):
                sys.stderr.write(f"Python YOLO Worker WebSocket server running on ws://{host}:{port}\n")
                await asyncio.Future()
        asyncio.run(main())
    except ImportError:
        sys.stderr.write("websockets package not installed, falling back to IPC mode\n")
        run_ipc_loop(detector)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Shoplifting YOLO Detection Worker')
    parser.add_argument('--detection-model', type=str, default='yolo26m.pt')
    parser.add_argument('--detection-fallback', type=str, default='yolo26m.pt')
    parser.add_argument('--pose-model', type=str, default='yolo26m-pose.pt')
    parser.add_argument('--pose-fallback', type=str, default='yolo26m-pose.pt')
    parser.add_argument('--mode', type=str, choices=['ipc', 'ws'], default='ipc')
    parser.add_argument('--host', type=str, default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5001)

    args = parser.parse_args()

    detector = YoloShopliftingDetector(
        detection_model_path=args.detection_model,
        detection_fallback_path=args.detection_fallback,
        pose_model_path=args.pose_model,
        pose_fallback_path=args.pose_fallback
    )

    if args.mode == 'ws':
        run_ws_server(detector, args.host, args.port)
    else:
        run_ipc_loop(detector)
