import type { ServerMessage } from '../shared/messages';
import { isServerMessage } from '../shared/messages';
import { AudioVisualizer } from './visualizer/visualizer';
import baseVert from '../../shaders/base.vert?raw';
import baseFrag from '../../shaders/base.frag?raw';
import fullscreenVert from '../../shaders/fullscreen.vert?raw';
import blurFrag from '../../shaders/blur.frag?raw';
import compositeFrag from '../../shaders/composite.frag?raw';
import fadeFrag from '../../shaders/fade.frag?raw';

const shaders = {
  baseVert,
  baseFrag,
  fullscreenVert,
  blurFrag,
  compositeFrag,
  fadeFrag,
};

function handleServerMessage(message: ServerMessage): void {
  if (message.type === 'ack') {
    console.info(
      '[MuCaching]',
      message.kind,
      message.message,
      message.rank ?? ''
    );
    return;
  }
  console.error('[MuCaching]', message.message);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (!isServerMessage(event.data)) return;
  handleServerMessage(event.data);
});

window.addEventListener('DOMContentLoaded', () => {
  const visualizer = new AudioVisualizer(shaders);

  // iframes start AudioContext in "suspended" — resume on any user interaction
  const resumeOnInteraction = (): void => {
    void visualizer.resumeAudioContext();
  };

  for (const id of ['startBtn', 'midiBtn', 'glCanvas']) {
    document.getElementById(id)?.addEventListener('pointerdown', resumeOnInteraction);
  }

  // Also resume on any click anywhere as a fallback
  document.addEventListener('click', resumeOnInteraction, { once: true });

  // --- Keyboard-to-MIDI fallback (A W S E D F T G Y H X J K -> MIDI 60..72) ---
  const KEY_TO_MIDI: Record<string, number> = {
    a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, x: 70, j: 71, k: 72,
  };

  const pressedKeys = new Set<string>();

  window.addEventListener('keydown', async (ev: KeyboardEvent) => {
    const key = ev.key.toLowerCase();
    if (ev.repeat) return;
    const midi = KEY_TO_MIDI[key];
    if (midi === undefined) return;
    ev.preventDefault();
    if (pressedKeys.has(key)) return;
    pressedKeys.add(key);

    // Ensure audio is resumed on first keydown
    await visualizer.resumeAudioContext();

    // Trigger internal synth and visual deformation
    void visualizer.playKeyNote(midi);
  });

  window.addEventListener('keyup', (ev: KeyboardEvent) => {
    const key = ev.key.toLowerCase();
    const midi = KEY_TO_MIDI[key];
    if (midi === undefined) return;
    if (!pressedKeys.has(key)) return;
    pressedKeys.delete(key);
    visualizer.stopKeyNote(midi);
  });
});
