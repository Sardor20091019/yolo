import sys
import time
import cv2
from ultralytics import YOLO

model = YOLO("yolo26n-pose.pt")
source = sys.argv[1] if len(sys.argv) > 1 else 0
if isinstance(source, str) and source.isdigit():
    source = int(source)

cap = cv2.VideoCapture(source)
pTime = 0

while True:
    success, frame = cap.read()
    if not success:
        break

    results = model(frame, verbose=False)
    annotated_frame = results[0].plot()

    cTime = time.time()
    fps = 1 / (cTime - pTime) if (cTime - pTime) > 0 else 0
    pTime = cTime

    cv2.putText(annotated_frame, f"FPS: {int(fps)}", (10, 50), cv2.FONT_HERSHEY_PLAIN, 2, (0, 255, 0), 2)
    cv2.imshow("YOLO Pose Tracking", annotated_frame)

    if cv2.waitKey(1) & 0xFF == ord("q"):
        break

cap.release()
cv2.destroyAllWindows()

