// =========================================================================
// MIDI Synth: Polyphone Voice Map

export class MidiSynth {
	constructor() {
		this.audioContext = null;
		this.voices = new Map();
		this.masterGain = null;
		this.merger = null;
		this.midiAccess = null;
		this.active = false;
	}

	start(audioContext, splitter, streamNode) {
		this.audioContext = audioContext;

		this.masterGain = audioContext.createGain();
		this.masterGain.gain.value = 0.5;
		this.masterGain.connect(audioContext.destination);

		this.merger = audioContext.createChannelMerger(2);
		this.merger.connect(this.masterGain);

		// Stereo-Split für Analysers
		this.masterGain.connect(splitter);

		// Worklet-Stream für kontinuierliche Time-Domain Daten
		if (streamNode) {
			this.masterGain.connect(streamNode);
		}

		this.voices = new Map();
		this.active = true;

		// MIDI Access
		if (navigator.requestMIDIAccess) {
			navigator.requestMIDIAccess().then((access) => {
				this.midiAccess = access;
				for (const input of access.inputs.values()) {
					input.onmidimessage = (msg) => this.handleMessage(msg);
				}
			});
		}
	}

	handleMessage(msg) {
		const [status, note, velocity] = msg.data;
		const cmd = status & 0xf0;

		if (cmd === 0x90 && velocity > 0) {
			this.noteOn(note, velocity);
		} else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
			this.noteOff(note);
		}
	}

	noteOn(note, velocity) {
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
		gain.connect(this.merger, 0, 0); // direkt → L
		gain.connect(delay);
		delay.connect(this.merger, 0, 1); // delayed → R

		osc.start();
		this.voices.set(note, { osc, gain, delay });
	}

	noteOff(note) {
		const voice = this.voices.get(note);
		if (!voice) return;

		voice.gain.gain.setTargetAtTime(0.0, this.audioContext.currentTime, 0.02);
		setTimeout(() => {
			try {
				voice.osc.stop();
			} catch (e) {}
			try {
				voice.osc.disconnect();
			} catch (e) {}
			try {
				voice.gain.disconnect();
			} catch (e) {}
			try {
				voice.delay.disconnect();
			} catch (e) {}
		}, 100);

		this.voices.delete(note);
	}

	stop() {
		for (const note of this.voices.keys()) {
			this.noteOff(note);
		}
		this.voices = new Map();

		if (this.masterGain) {
			try {
				this.masterGain.disconnect();
			} catch (e) {}
			this.masterGain = null;
		}
		if (this.merger) {
			try {
				this.merger.disconnect();
			} catch (e) {}
			this.merger = null;
		}
		this.active = false;
		this.audioContext = null;
	}
}

// =========================================================================
