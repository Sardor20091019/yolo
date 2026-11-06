import { Injectable, signal, WritableSignal } from '@angular/core';
import { Socket } from 'socket.io-client';

interface ViewerJoinedPayload {
  viewerSocketId: string;
  stationId: string;
}

interface WebRtcOfferPayload {
  senderSocketId: string;
  stationId: string;
  sdp: RTCSessionDescriptionInit;
}

interface WebRtcAnswerPayload {
  senderSocketId: string;
  stationId: string;
  sdp: RTCSessionDescriptionInit;
}

interface WebRtcIceCandidatePayload {
  senderSocketId: string;
  stationId: string;
  candidate: RTCIceCandidateInit;
}

@Injectable({
  providedIn: 'root',
})
export class WebrtcService {
  private socket: Socket | null = null;
  private localStream: MediaStream | null = null;
  private readonly broadcasterPeerConnections: Map<string, RTCPeerConnection> = new Map();
  private readonly viewerPeerConnections: Map<string, RTCPeerConnection> = new Map();
  private readonly remoteStreamsMap: Map<string, WritableSignal<MediaStream | null>> = new Map();
  private readonly pendingIceCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  public readonly isBroadcasting: WritableSignal<boolean> = signal<boolean>(false);
  public readonly currentStationId: WritableSignal<string> = signal<string>('');
  public readonly currentStationName: WritableSignal<string> = signal<string>('');
  public readonly activeViewerCount: WritableSignal<number> = signal<number>(0);

  private readonly iceServers: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  };

  public initSignaling(socket: Socket): void {
    if (this.socket === socket) {
      return;
    }
    this.socket = socket;
    this.setupSignalingListeners();
  }

  public getRemoteStreamSignal(stationId: string): WritableSignal<MediaStream | null> {
    if (!this.remoteStreamsMap.has(stationId)) {
      this.remoteStreamsMap.set(stationId, signal<MediaStream | null>(null));
    }
    return this.remoteStreamsMap.get(stationId)!;
  }

  public startBroadcasting(stationId: string, stationName: string, stream: MediaStream): void {
    this.localStream = stream;
    this.currentStationId.set(stationId);
    this.currentStationName.set(stationName);
    this.isBroadcasting.set(true);

    if (this.socket && this.socket.connected) {
      this.socket.emit('register_camera_station', {
        stationId,
        stationName,
      });
    }
  }

  public stopBroadcasting(): void {
    this.broadcasterPeerConnections.forEach((pc) => {
      try {
        pc.close();
      } catch {
        return;
      }
    });
    this.broadcasterPeerConnections.clear();
    this.activeViewerCount.set(0);
    this.localStream = null;
    this.isBroadcasting.set(false);
  }

  public watchStation(stationId: string): void {
    if (this.viewerPeerConnections.has(stationId)) {
      return;
    }

    if (this.socket && this.socket.connected) {
      this.socket.emit('admin_watch_station', { stationId });
    }
  }

  public stopWatchingStation(stationId: string): void {
    const pc = this.viewerPeerConnections.get(stationId);
    if (pc) {
      try {
        pc.close();
      } catch {
        return;
      }
      this.viewerPeerConnections.delete(stationId);
    }
    const sig = this.remoteStreamsMap.get(stationId);
    if (sig) {
      sig.set(null);
    }
  }

  private setupSignalingListeners(): void {
    if (!this.socket) {
      return;
    }

    this.socket.on('webrtc_viewer_joined', async (payload: ViewerJoinedPayload) => {
      await this.handleViewerJoined(payload);
    });

    this.socket.on('webrtc_offer', async (payload: WebRtcOfferPayload) => {
      await this.handleWebRtcOffer(payload);
    });

    this.socket.on('webrtc_answer', async (payload: WebRtcAnswerPayload) => {
      await this.handleWebRtcAnswer(payload);
    });

    this.socket.on('webrtc_ice_candidate', async (payload: WebRtcIceCandidatePayload) => {
      await this.handleWebRtcIceCandidate(payload);
    });
  }

  private async handleViewerJoined(payload: ViewerJoinedPayload): Promise<void> {
    if (!this.localStream || !this.socket) {
      return;
    }

    const pc = new RTCPeerConnection(this.iceServers);
    this.broadcasterPeerConnections.set(payload.viewerSocketId, pc);
    this.activeViewerCount.set(this.broadcasterPeerConnections.size);

    this.localStream.getTracks().forEach((track) => {
      if (this.localStream) {
        pc.addTrack(track, this.localStream);
      }
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('webrtc_ice_candidate', {
          targetSocketId: payload.viewerSocketId,
          stationId: payload.stationId,
          candidate: event.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.broadcasterPeerConnections.delete(payload.viewerSocketId);
        this.activeViewerCount.set(this.broadcasterPeerConnections.size);
      }
    };

    try {
      const offer = await pc.createOffer({
        offerToReceiveVideo: false,
        offerToReceiveAudio: false,
      });
      await pc.setLocalDescription(offer);

      this.socket.emit('webrtc_offer', {
        targetSocketId: payload.viewerSocketId,
        stationId: payload.stationId,
        sdp: offer,
      });
    } catch {
      return;
    }
  }

  private async handleWebRtcOffer(payload: WebRtcOfferPayload): Promise<void> {
    if (!this.socket) {
      return;
    }

    const pc = new RTCPeerConnection(this.iceServers);
    this.viewerPeerConnections.set(payload.stationId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('webrtc_ice_candidate', {
          targetSocketId: payload.senderSocketId,
          stationId: payload.stationId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        const streamSig = this.getRemoteStreamSignal(payload.stationId);
        streamSig.set(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.stopWatchingStation(payload.stationId);
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await this.flushPendingIceCandidates(payload.stationId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit('webrtc_answer', {
        targetSocketId: payload.senderSocketId,
        stationId: payload.stationId,
        sdp: answer,
      });
    } catch {
      return;
    }
  }

  private async handleWebRtcAnswer(payload: WebRtcAnswerPayload): Promise<void> {
    const pc = this.broadcasterPeerConnections.get(payload.senderSocketId);
    if (!pc) {
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
      await this.flushPendingIceCandidates(payload.senderSocketId, pc);
    } catch {
      return;
    }
  }

  private async handleWebRtcIceCandidate(payload: WebRtcIceCandidatePayload): Promise<void> {
    const pcViewer = this.viewerPeerConnections.get(payload.stationId);
    if (pcViewer) {
      if (pcViewer.remoteDescription) {
        try {
          await pcViewer.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          return;
        }
      } else {
        const queue = this.pendingIceCandidates.get(payload.stationId) || [];
        queue.push(payload.candidate);
        this.pendingIceCandidates.set(payload.stationId, queue);
      }
      return;
    }

    const pcBroadcaster = this.broadcasterPeerConnections.get(payload.senderSocketId);
    if (pcBroadcaster) {
      if (pcBroadcaster.remoteDescription) {
        try {
          await pcBroadcaster.addIceCandidate(new RTCIceCandidate(payload.candidate));
        } catch {
          return;
        }
      } else {
        const queue = this.pendingIceCandidates.get(payload.senderSocketId) || [];
        queue.push(payload.candidate);
        this.pendingIceCandidates.set(payload.senderSocketId, queue);
      }
    }
  }

  private async flushPendingIceCandidates(targetId: string, pc: RTCPeerConnection): Promise<void> {
    const list = this.pendingIceCandidates.get(targetId);
    if (list && list.length > 0) {
      for (const cand of list) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {
          continue;
        }
      }
      this.pendingIceCandidates.delete(targetId);
    }
  }
}

