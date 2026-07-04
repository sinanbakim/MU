// MIDI Synth: Polyphonic voice map

type Voice = {
  osc: OscillatorNode;
  gain: GainNode;
  delay: DelayNode;
};

export class MidiSynth {
  private audioContext: AudioContext | null = null;
  private voices = new Map<number, Voice>();
  private masterGain: GainNode | null = null;
  private merger: ChannelMergerNode | null = null;
  active: boolean = false;

  start(
    audioContext: AudioContext,
    splitter: ChannelSplitterNode,
    streamNode: AudioWorkletNode
  ): void {
    this.audioContext = audioContext;

    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(audioContext.destination);

    this.merger = audioContext.createChannelMerger(2);
    this.merger.connect(this.masterGain);

    this.masterGain.connect(splitter);
    this.masterGain.connect(streamNode);

    this.voices = new Map();
    this.active = true;

    if (navigator.requestMIDIAccess) {
      navigator
        .requestMIDIAccess()
        .then((access) => {
          for (const input of access.inputs.values()) {
            input.onmidimessage = (msg) => this.handleMessage(msg);
          }
        })
        .catch((err) => {
          console.warn('MIDI access denied:', err);
        });
    }
  }

  handleMessage(msg: MIDIMessageEvent): void {
    const data = msg.data;
    if (!data) return;
    const status = data[0] ?? 0;
    const note = data[1] ?? 0;
    const velocity = data[2] ?? 0;
    const cmd = status & 0xf0;

    if (cmd === 0x90 && velocity > 0) {
      this.noteOn(note, velocity);
    } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
      this.noteOff(note);
    }
  }

  noteOn(note: number, velocity: number): void {
    if (!this.audioContext || !this.merger) return;
    if (this.voices.has(note)) this.noteOff(note);

    const freq = 440 * Math.pow(2, (note - 69) / 12);
    const osc = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    const delay = this.audioContext.createDelay(1.0);

    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = velocity / 127;
    delay.delayTime.value = 1 / (freq * 4);

    osc.connect(gain);
    gain.connect(this.merger, 0, 0);
    gain.connect(delay);
    delay.connect(this.merger, 0, 1);

    osc.start();
    this.voices.set(note, { osc, gain, delay });
  }

  noteOff(note: number): void {
    const voice = this.voices.get(note);
    if (!voice || !this.audioContext) return;

    voice.gain.gain.setTargetAtTime(0.0, this.audioContext.currentTime, 0.02);
    setTimeout(() => {
      try {
        voice.osc.stop();
      } catch (_) {
        /* ignore */
      }
      try {
        voice.osc.disconnect();
      } catch (_) {
        /* ignore */
      }
      try {
        voice.gain.disconnect();
      } catch (_) {
        /* ignore */
      }
      try {
        voice.delay.disconnect();
      } catch (_) {
        /* ignore */
      }
    }, 100);

    this.voices.delete(note);
  }

  stop(): void {
    for (const note of this.voices.keys()) {
      this.noteOff(note);
    }
    this.voices = new Map();

    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch (_) {
        /* ignore */
      }
      this.masterGain = null;
    }
    if (this.merger) {
      try {
        this.merger.disconnect();
      } catch (_) {
        /* ignore */
      }
      this.merger = null;
    }
    this.active = false;
    this.audioContext = null;
  }
}
