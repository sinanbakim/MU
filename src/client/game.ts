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
  new AudioVisualizer(shaders);
});
