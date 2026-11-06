from ultralytics import YOLO

# Load a model
# model = YOLO("yolo26n-pose.yaml")  # build a new model from YAML
model = YOLO("yolo26m-pose.pt")  # load a pretrained model (recommended for training)
# model = YOLO("yolo26n-pose.yaml").load("yolo26n-pose.pt")  # build from YAML and transfer weights 


results = model.track("test-video.mp4", save=True, show=True, persist=True)