# Real-Time AI Shoplifting & Suspicious Behavior Detection System

A high-performance full-stack computer vision security and loss prevention monorepo combining **NestJS 10+** (backend), **Angular 19+ with Signals and Tailwind CSS** (frontend), and an **Ultralytics YOLO26m/YOLO11m Pose & ByteTrack Heuristics Engine** (Python worker).

---

## Architecture Overview

```
yolo/
├── .env                              # Master environment variables (Zero Hardcoding)
├── .env.example                      # Template configuration
├── package.json                      # Monorepo workspaces definition
├── tsconfig.base.json                # Shared TypeScript base configuration
├── setup.sh                          # Automated installation script
├── apps/
│   ├── api/                          # NestJS Backend Application
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main.ts               # App entrypoint, CORS, ValidationPipe
│   │       ├── app.module.ts         # Module tree assembly
│   │       ├── config/               # ConfigModule typed configuration & validation
│   │       │   ├── config.interface.ts
│   │       │   ├── configuration.ts
│   │       │   └── config.validation.ts
│   │       ├── database/             # Kysely Type-Safe Query Builder Layer
│   │       │   ├── database.module.ts
│   │       │   ├── database.service.ts
│   │       │   ├── database.types.ts
│   │       │   └── database.schema.ts
│   │       ├── detection/            # Real-Time Detection Module
│   │       │   ├── detection.module.ts
│   │       │   ├── detection.controller.ts
│   │       │   ├── detection.gateway.ts
│   │       │   ├── detection.service.ts
│   │       │   ├── detection.repository.ts
│   │       │   └── dto/
│   │       └── alerts/               # Incident Logs & Snapshots Module
│   │           ├── alerts.module.ts
│   │           ├── alerts.controller.ts
│   │           ├── alerts.service.ts
│   │           ├── alerts.repository.ts
│   │           └── dto/
│   ├── web/                          # Angular 19+ Standalone Signals Frontend
│   │   ├── package.json
│   │   ├── angular.json
│   │   ├── tailwind.config.js
│   │   └── src/
│   │       ├── index.html
│   │       ├── main.ts
│   │       ├── styles.css
│   │       └── app/
│   │           ├── app.config.ts
│   │           ├── app.component.ts
│   │           ├── models/
│   │           ├── services/
│   │           │   ├── websocket.service.ts
│   │           │   ├── detection.service.ts
│   │           │   └── alerts.service.ts
│   │           └── components/
│   │               ├── camera-stream/       # Mode A (WebRTC) & Mode B (IP Stream) + HUD
│   │               ├── alerts-sidebar/      # Real-time Incident Cards & Snapshots
│   │               └── calibration-panel/   # Live Sliders & Shelf ROI Zone Manager
│   └── python-worker/                # Computer Vision & Heuristics Service
│       ├── requirements.txt
│       ├── main.py                   # IPC / WebSocket streaming bridge
│       ├── yolo_detector.py          # YOLO26m / YOLO11m Pose & Multi-Object Tracking
│       ├── heuristics_engine.py      # Suspicion Score Engine (Concealment, Nervous Checks, Loitering)
│       └── tests/
│           └── test_heuristics.py    # Unit tests for shoplifting heuristics
```

---

## 3-Factor Suspicion Score Engine

The Python inference worker tracks targets with persistent `track_id` assignments using ByteTrack and evaluates a live 0% to 100% composite risk score:

1. **Concealment Gesture (+50% Risk)**:
   - Tracks wrist keypoints (`left_wrist`, `right_wrist`) interacting with portable items (`bottle`, `cell phone`, `book`, `cup`, `backpack`, `handbag`).
   - Detects trajectory where wrist transitions directly into the hip/waist/pocket bounding region.
2. **Nervous Waist Check (+35% Risk)**:
   - Tracks frequency of wrist entries into the waist/hip zone within a rolling 6-second window.
   - Triggers when entry count meets or exceeds the user-configured sensitivity threshold (e.g. 3x entries).
3. **High-Value Zone Loitering (+30% Risk)**:
   - Uses point-in-polygon ray casting against user-defined Shelf ROI polygons.
   - Measures continuous dwell time of person footprint / centroid.
   - Penalizes dwell times exceeding the calibrated threshold (e.g. > 10 seconds).

---

## Prerequisites

- **Node.js**: v18.x or higher (v20+ recommended)
- **Python**: 3.10+ (with `pip` and virtual environment support)
- **PostgreSQL**: Neon DB connection string or local PostgreSQL instance

---

## Setup & Execution Guide

### 1. Environment Configuration
The `.env` file at the root directory contains all configuration variables. Copy from `.env.example` if setting up from scratch:

```bash
cp .env.example .env
```

Ensure `DATABASE_URL` contains your PostgreSQL connection string.

### 2. Automated Setup (One Command)
Run the setup script:

```bash
chmod +x setup.sh
./setup.sh
```

Or install manually:

```bash
# Monorepo dependencies
npm install

# Python virtual environment & packages
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/python-worker/requirements.txt
```

### 3. Verify Heuristics Engine
Execute the standalone heuristics test suite:

```bash
npm run test:worker
# or
python3 apps/python-worker/tests/test_heuristics.py
```

### 4. Running the Monorepo

#### Start NestJS Backend API:
```bash
npm run start:api
```
The NestJS API starts on `http://localhost:3000` (or `PORT` defined in `.env`), automatically initializing Kysely schema tables (`alerts`, `detection_zones`, `detection_events`) on Neon PostgreSQL and spawning the Python YOLO worker subprocess via IPC.

#### Start Angular Web Frontend:
```bash
npm run start:web
```
The Angular application starts on `http://localhost:4200` with hot-reloading.

#### Standalone Python Worker (Optional WebSocket Mode):
```bash
python3 apps/python-worker/main.py --mode websocket --port 5001
```

---

## Single-Project Vercel Deployment

The monorepo is configured for instant, single-project deployment on **Vercel** with zero external platform dependencies:

1. Connect your repository to Vercel or run:
   ```bash
   vercel
   ```
2. Configure your Environment Variables in the Vercel dashboard:
   - `DATABASE_URL`: Your PostgreSQL (Neon) connection string
   - `NODE_ENV`: `production`
3. Vercel automatically:
   - Builds the Angular 19 frontend into static edge assets (`apps/web/dist/web/browser`)
   - Deploys the NestJS backend as a serverless API handler (`api/index.ts`)
   - Executes the native AI heuristics engine for continuous risk scoring without needing background daemon workers
   - Streams camera frames seamlessly over HTTP (`/api/detection/process-frame`) with real-time HUD rendering

---

## Key Features

- **Mode A (Webcam)**: Direct browser camera streaming via HTML5 Canvas WebSocket to the NestJS gateway.
- **Mode B (IP Webcam / RTSP)**: Input RTSP/HTTP video feed URL for IP security camera networks.
- **Color-Coded Cyber HUD Canvas**:
  - Green (< 40% normal)
  - Amber (40% - 74% elevated attention)
  - Flashing Red (>= 75% critical shoplifting threat)
- **Pose Skeleton Overlay**: Joint markers and skeletal bones connecting wrists, elbows, hips, and knees.
- **Interactive Shelf ROI Tool**: Click directly on the video feed to draw polygon boundaries around high-value merchandise shelves.
- **Real-Time Incident Log**: Instant notifications of suspicious events with captured thumbnail snapshots and audit controls (Confirm Theft, Dismiss, Review).
- **Live Calibration Sliders**: Dynamically tune confidence, suspicion threshold, loitering limits, and sensitivity without restarting services.

