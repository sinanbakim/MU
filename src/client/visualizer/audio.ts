// Audio Engine: Device Discovery, Mic/File Input, Stereo Analyser Setup
// + AudioWorklet stream for continuous sample data (ring buffer)

export class AudioEngine {
  readonly fftSize: number;
  readonly bufferLength: number;
  debugEnabled: boolean = false;

  audioContext: AudioContext | null = null;
  analyserL: AnalyserNode | null = null;
  analyserR: AnalyserNode | null = null;
  splitter: ChannelSplitterNode | null = null;

  microphone: MediaStreamAudioSourceNode | null = null;
  stream: MediaStream | null = null;
  permissionStream: MediaStream | null = null;

  audioElement: HTMLAudioElement | null = null;
  audioURL: string | null = null;
  mediaSource: MediaElementAudioSourceNode | null = null;

  player: { playing: boolean; duration: number; currentTime: number } = {
    playing: false,
    duration: 0,
    currentTime: 0,
  };

  fftDataL: Float32Array<ArrayBuffer>;
  fftDataR: Float32Array<ArrayBuffer>;

  readonly ringBufferSize: number;
  readonly ringL: Float32Array<ArrayBuffer>;
  readonly ringR: Float32Array<ArrayBuffer>;
  ringWriteIndex: number = 0;
  ringReadIndex: number = 0;
  ringSamplesWritten: number = 0;

  newSamplesL: Float32Array<ArrayBuffer> | null = null;
  newSamplesR: Float32Array<ArrayBuffer> | null = null;
  newSampleCount: number = 0;

  streamNode: AudioWorkletNode | null = null;
  devicesLoaded: boolean = false;

  private _debugCounter: number = 0;

  constructor(fftSize = 4096, ringBufferSize = 16384) {
    this.fftSize = fftSize;
    this.bufferLength = fftSize / 2;
    this.ringBufferSize = ringBufferSize;
    this.ringL = new Float32Array(ringBufferSize);
    this.ringR = new Float32Array(ringBufferSize);
    this.fftDataL = new Float32Array(this.bufferLength);
    this.fftDataR = new Float32Array(this.bufferLength);
  }

  get sampleRate(): number {
    return this.audioContext ? this.audioContext.sampleRate : 44100;
  }

  async loadDevices(): Promise<MediaDeviceInfo[]> {
    if (!this.permissionStream) {
      try {
        this.permissionStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (err) {
        console.warn('Mikrofon-Berechtigung verweigert:', err);
        return [];
      }
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter((d) => d.kind === 'audioinput');
    this.devicesLoaded = audioInputs.length > 0;
    return audioInputs;
  }

  private _createAnalysers(): void {
    if (!this.audioContext) return;
    this.splitter = this.audioContext.createChannelSplitter(2);
    this.analyserL = this.audioContext.createAnalyser();
    this.analyserR = this.audioContext.createAnalyser();
    this.analyserL.fftSize = this.fftSize;
    this.analyserR.fftSize = this.fftSize;
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
  }

  private _onRingMessage(
    event: MessageEvent<{ left: Float32Array; right: Float32Array }>
  ): void {
    const { left, right } = event.data;
    const len = left.length;
    for (let i = 0; i < len; i++) {
      const idx = (this.ringWriteIndex + i) % this.ringBufferSize;
      this.ringL[idx] = left[i] ?? 0;
      this.ringR[idx] = right[i] ?? 0;
    }
    this.ringWriteIndex = (this.ringWriteIndex + len) % this.ringBufferSize;
    this.ringSamplesWritten += len;
  }

  private async _createStreamNode(
    source: AudioNode,
    connectToDestination: boolean
  ): Promise<void> {
    if (!this.audioContext) return;
    await this.audioContext.audioWorklet.addModule('stream-processor.js');
    this.streamNode = new AudioWorkletNode(
      this.audioContext,
      'stream-processor',
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
      }
    );
    this.streamNode.port.onmessage = (e: MessageEvent) =>
      this._onRingMessage(
        e as MessageEvent<{ left: Float32Array; right: Float32Array }>
      );

    source.connect(this.streamNode);
    if (connectToDestination) {
      this.streamNode.connect(this.audioContext.destination);
    }
    if (this.splitter) {
      source.connect(this.splitter);
    }
  }

  readRing(count: number): { left: Float32Array; right: Float32Array } {
    const n = Math.min(count, this.ringBufferSize);
    const outL = new Float32Array(n);
    const outR = new Float32Array(n);
    const start =
      (this.ringWriteIndex - n + this.ringBufferSize) % this.ringBufferSize;
    for (let i = 0; i < n; i++) {
      const idx = (start + i) % this.ringBufferSize;
      outL[i] = this.ringL[idx] ?? 0;
      outR[i] = this.ringR[idx] ?? 0;
    }
    return { left: outL, right: outR };
  }

  async resumeContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  async startMic(deviceId: string): Promise<void> {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        channelCount: 2,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.stream = stream;
    this.audioContext = new AudioContext();
    await this.resumeContext();
    this._createAnalysers();
    this.microphone = this.audioContext.createMediaStreamSource(stream);
    await this._createStreamNode(this.microphone, false);
  }

  async startFile(file: File): Promise<void> {
    this.stop();
    this.audioURL = URL.createObjectURL(file);
    this.audioElement = new Audio(this.audioURL);
    this.audioElement.loop = true;
    this.audioContext = new AudioContext();
    await this.resumeContext();
    this._createAnalysers();
    this.mediaSource = this.audioContext.createMediaElementSource(
      this.audioElement
    );
    await this._createStreamNode(this.mediaSource, true);

    await new Promise<void>((resolve) => {
      this.audioElement!.onloadedmetadata = () => {
        this.player.duration = this.audioElement!.duration;
        resolve();
      };
      this.audioElement!.load();
    });
    this.player.playing = false;
    this.player.currentTime = 0;
  }

  async startMidiContext(): Promise<{
    audioContext: AudioContext;
    splitter: ChannelSplitterNode;
    streamNode: AudioWorkletNode;
  }> {
    this.stop();
    this.audioContext = new AudioContext();
    await this.resumeContext();
    this._createAnalysers();
    await this.audioContext.audioWorklet.addModule('stream-processor.js');
    this.streamNode = new AudioWorkletNode(
      this.audioContext,
      'stream-processor',
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
      }
    );
    this.streamNode.port.onmessage = (e: MessageEvent) =>
      this._onRingMessage(
        e as MessageEvent<{ left: Float32Array; right: Float32Array }>
      );
    const { splitter, streamNode } = this;
    if (!splitter || !streamNode)
      throw new Error('AudioEngine: splitter/streamNode not ready');
    return { audioContext: this.audioContext, splitter, streamNode };
  }

  play(): void {
    this.audioElement?.play();
    this.player.playing = true;
  }

  pause(): void {
    this.audioElement?.pause();
    this.player.playing = false;
  }

  togglePlayback(): void {
    if (this.player.playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    if (!this.audioElement) return;
    this.audioElement.currentTime = Math.max(
      0,
      Math.min(time, this.player.duration || Infinity)
    );
    this.player.currentTime = this.audioElement.currentTime;
  }

  syncPlayerTime(): void {
    if (this.audioElement) {
      this.player.currentTime = this.audioElement.currentTime;
    }
  }

  readFrame(): void {
    if (!this.analyserL || !this.analyserR) return;

    this.analyserL.getFloatFrequencyData(this.fftDataL);
    this.analyserR.getFloatFrequencyData(this.fftDataR);

    const writePos = this.ringWriteIndex;
    const readPos = this.ringReadIndex;
    let available =
      (writePos - readPos + this.ringBufferSize) % this.ringBufferSize;
    if (available > this.ringBufferSize) available = this.ringBufferSize;

    this.newSampleCount = available;

    if (available > 0) {
      this.newSamplesL = new Float32Array(available);
      this.newSamplesR = new Float32Array(available);
      for (let i = 0; i < available; i++) {
        const idx = (readPos + i) % this.ringBufferSize;
        this.newSamplesL[i] = this.ringL[idx] ?? 0;
        this.newSamplesR[i] = this.ringR[idx] ?? 0;
      }
      this.ringReadIndex = writePos;
    } else {
      this.newSamplesL = null;
      this.newSamplesR = null;
    }

    this._debugCounter++;
    if (this.debugEnabled && this._debugCounter % 60 === 0) {
      console.log(
        'New samples:',
        this.newSampleCount,
        '| Ring W:',
        writePos,
        'R:',
        readPos
      );
    }
  }

  stop(): void {
    if (this.streamNode) {
      try {
        this.streamNode.disconnect();
      } catch (_) {
        /* ignore */
      }
      try {
        this.streamNode.port.close();
      } catch (_) {
        /* ignore */
      }
      this.streamNode = null;
    }
    if (this.microphone) {
      try {
        this.microphone.disconnect();
      } catch (_) {
        /* ignore */
      }
      this.microphone = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioElement) {
      try {
        this.audioElement.pause();
      } catch (_) {
        /* ignore */
      }
      if (this.audioURL) {
        URL.revokeObjectURL(this.audioURL);
        this.audioURL = null;
      }
      this.audioElement = null;
      this.mediaSource = null;
    }
    this.player.playing = false;
    this.player.duration = 0;
    this.player.currentTime = 0;

    if (this.audioContext) {
      try {
        this.audioContext.close();
      } catch (_) {
        /* ignore */
      }
      this.audioContext = null;
    }
    this.analyserL = null;
    this.analyserR = null;
    this.splitter = null;

    this.ringL.fill(0);
    this.ringR.fill(0);
    this.ringWriteIndex = 0;
    this.ringReadIndex = 0;
    this.ringSamplesWritten = 0;
    this.newSamplesL = null;
    this.newSamplesR = null;
    this.newSampleCount = 0;
  }
}
