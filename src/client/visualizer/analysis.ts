// Audio Analysis Utilities: Pitch Detection, HSV Color
// Pure functions, no state

const C0 = 440 * Math.pow(2, -4.75);

export type PitchResult = {
  frequency: number;
  amplitude: number;
};

export function detectPitch(
  fftData: Float32Array,
  sampleRate: number
): PitchResult {
  let maxValue = -Infinity;
  let maxIndex = 0;

  const minIndex = Math.floor((20 * fftData.length) / (sampleRate / 2));
  const maxIndexBound = Math.floor((18000 * fftData.length) / (sampleRate / 2));

  for (let i = minIndex; i < maxIndexBound; i++) {
    const val = fftData[i];
    if (val !== undefined && val > maxValue) {
      maxValue = val;
      maxIndex = i;
    }
  }

  return {
    frequency: (maxIndex * (sampleRate / 2)) / fftData.length,
    amplitude: maxValue,
  };
}

export function frequencyToNote(frequency: number): {
  note: number;
  octave: number;
} {
  if (frequency < 20) return { note: 0, octave: 0 };
  const halfSteps = 12 * Math.log2(frequency / C0);
  const octave = Math.floor(halfSteps / 12);
  const note = Math.round(halfSteps % 12);
  return { note: note < 0 ? 0 : note, octave: octave < 0 ? 0 : octave };
}

export function hsvToRgb(
  h: number,
  s: number,
  v: number
): [number, number, number] {
  let r = 0,
    g = 0,
    b = 0;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    case 5:
      r = v;
      g = p;
      b = q;
      break;
  }

  return [r, g, b];
}

export function calculateColor(
  frequency: number,
  amplitude: number,
  saturationBoost: number
): [number, number, number] {
  const { note, octave } = frequencyToNote(frequency);
  const hue = note / 12;
  const baseSaturation = Math.max(0, Math.min(1, (amplitude + 100) / 100));
  const saturation = Math.max(0, Math.min(1, baseSaturation * saturationBoost));
  const value = Math.max(0.2, Math.min(1, 1 - octave / 10));
  return hsvToRgb(hue, saturation, value);
}
