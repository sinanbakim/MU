// AudioWorklet: stereo pass-through that posts {left, right} Float32Arrays
class StreamProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const left = input[0] || new Float32Array(128);
      const right =
        (input.length >= 2 ? input[1] : input[0]) || new Float32Array(128);
      this.port.postMessage({ left: left.slice(), right: right.slice() });
    }
    return true;
  }
}

registerProcessor('stream-processor', StreamProcessor);
