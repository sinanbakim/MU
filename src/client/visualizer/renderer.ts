// Render Pipeline: OGL Setup, Shader Strings, Ring Buffer, Fade + Glow

import {
  Camera,
  Geometry,
  Mesh,
  Program,
  Renderer,
  RenderTarget,
  Transform,
} from 'ogl';
import type { OGLRenderingContext, Texture } from 'ogl';

export type ShaderSources = {
  baseVert: string;
  baseFrag: string;
  fullscreenVert: string;
  blurFrag: string;
  compositeFrag: string;
  fadeFrag: string;
};

type RenderSettings = {
  pointSize: number;
  trailDepth: number;
  glowIntensity: number;
  fadeOut: number;
  renderMode: string;
};

type BaseUniforms = {
  uPointSize: { value: number };
  uTrailDepth: { value: number };
};
type FadeUniforms = {
  tMap: { value: Texture | null };
  uFade: { value: number };
};
type BlurUniforms = {
  tMap: { value: Texture | null };
  uDirection: { value: [number, number] };
};
type CompositeUniforms = {
  tScene: { value: Texture | null };
  tBlur: { value: Texture | null };
  uGlow: { value: number };
};

export class RenderPipeline {
  readonly canvas: HTMLCanvasElement;
  gl: OGLRenderingContext | null = null;
  renderer: Renderer | null = null;
  camera: Camera | null = null;
  scene: Transform | null = null;
  geometry: Geometry | null = null;
  mesh: Mesh | null = null;

  programs: {
    base: Program | null;
    fade: Program | null;
    blur: Program | null;
    composite: Program | null;
  } = { base: null, fade: null, blur: null, composite: null };

  private baseUniforms: BaseUniforms | null = null;
  private fadeUniforms: FadeUniforms | null = null;
  private blurUniforms: BlurUniforms | null = null;
  private compositeUniforms: CompositeUniforms | null = null;

  private mainRT: RenderTarget | null = null;
  private tempRT: RenderTarget | null = null;
  private blurRT1: RenderTarget | null = null;
  private blurRT2: RenderTarget | null = null;
  private fullscreenQuad: Mesh | null = null;

  readonly maxPoints = 65536;
  readonly positionsBuffer: Float32Array;
  readonly colorsBuffer: Float32Array;
  writeIndex: number = 0;
  totalWritten: number = 0;

  orbitAngleX: number = 0;
  orbitAngleY: number = 0.3;
  orbitRadius: number = 3;
  private _ortho: boolean = false;
  private _orthoScale: number = 3;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.positionsBuffer = new Float32Array(this.maxPoints * 3);
    this.colorsBuffer = new Float32Array(this.maxPoints * 3);
  }

  init(settings: RenderSettings, shaders: ShaderSources): void {
    const container = this.canvas.parentElement ?? document.body;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer = new Renderer({
      canvas: this.canvas,
      width,
      height,
      dpr: Math.min(window.devicePixelRatio, 2),
      alpha: false,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.gl = this.renderer.gl;
    const gl = this.gl;

    this.camera = new Camera(gl, {
      fov: 45,
      aspect: width / height,
      near: 0.01,
      far: 100,
    });
    this.updateCameraOrbit();

    this.scene = new Transform();

    this.geometry = new Geometry(gl, {
      position: { size: 3, data: this.positionsBuffer, usage: gl.DYNAMIC_DRAW },
      color: { size: 3, data: this.colorsBuffer, usage: gl.DYNAMIC_DRAW },
    });
    this.geometry.setDrawRange(0, 0);

    this.baseUniforms = {
      uPointSize: { value: settings.pointSize },
      uTrailDepth: { value: settings.trailDepth },
    };
    this.programs.base = new Program(gl, {
      vertex: shaders.baseVert,
      fragment: shaders.baseFrag,
      uniforms: this.baseUniforms,
      depthTest: true,
      depthWrite: true,
      transparent: false,
    });

    this.fadeUniforms = {
      tMap: { value: null },
      uFade: { value: settings.fadeOut },
    };
    this.programs.fade = new Program(gl, {
      vertex: shaders.fullscreenVert,
      fragment: shaders.fadeFrag,
      uniforms: this.fadeUniforms,
      depthTest: false,
      depthWrite: false,
    });

    this.blurUniforms = {
      tMap: { value: null },
      uDirection: { value: [0, 0] },
    };
    this.programs.blur = new Program(gl, {
      vertex: shaders.fullscreenVert,
      fragment: shaders.blurFrag,
      uniforms: this.blurUniforms,
      depthTest: false,
      depthWrite: false,
    });

    this.compositeUniforms = {
      tScene: { value: null },
      tBlur: { value: null },
      uGlow: { value: settings.glowIntensity },
    };
    this.programs.composite = new Program(gl, {
      vertex: shaders.fullscreenVert,
      fragment: shaders.compositeFrag,
      uniforms: this.compositeUniforms,
      depthTest: false,
      depthWrite: false,
    });

    const renderModeKey = settings.renderMode as keyof OGLRenderingContext;
    const mode = (gl[renderModeKey] as number | undefined) ?? gl.POINTS;

    this.mesh = new Mesh(gl, {
      geometry: this.geometry,
      program: this.programs.base,
      mode,
    });
    this.mesh.setParent(this.scene);

    const quadGeo = new Geometry(gl, {
      position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
    });
    this.fullscreenQuad = new Mesh(gl, {
      geometry: quadGeo,
      program: this.programs.fade,
      frustumCulled: false,
    });

    this.mainRT = new RenderTarget(gl, { width, height });
    this.tempRT = new RenderTarget(gl, { width, height });
    this.blurRT1 = new RenderTarget(gl, { width, height, depth: false });
    this.blurRT2 = new RenderTarget(gl, { width, height, depth: false });

    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);

    this.renderer.render({
      scene: this.scene,
      camera: this.camera,
      target: this.mainRT,
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setProjection(ortho: boolean, scale?: number): void {
    if (!this.camera) return;
    const container = this.canvas.parentElement ?? document.body;
    const aspect =
      (container.clientWidth || window.innerWidth) /
      (container.clientHeight || window.innerHeight);
    this._ortho = ortho;
    this._orthoScale = scale ?? this.orbitRadius;

    if (ortho) {
      const s = this._orthoScale;
      this.camera.orthographic({
        left: -aspect * s,
        right: aspect * s,
        bottom: -s,
        top: s,
        near: 0.01,
        far: 100,
      });
    } else {
      this.camera.perspective({ fov: 45, aspect, near: 0.01, far: 100 });
    }
  }

  updateCameraOrbit(): void {
    if (!this.camera) return;
    this.camera.position.x =
      Math.sin(this.orbitAngleX) *
      Math.cos(this.orbitAngleY) *
      this.orbitRadius;
    this.camera.position.y = Math.sin(this.orbitAngleY) * this.orbitRadius;
    this.camera.position.z =
      Math.cos(this.orbitAngleX) *
      Math.cos(this.orbitAngleY) *
      this.orbitRadius;
    this.camera.lookAt([0, 0, 0]);
  }

  resize(): void {
    if (!this.renderer || !this.camera) return;
    const container = this.canvas.parentElement ?? document.body;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    this.renderer.setSize(width, height);

    if (this._ortho) {
      this.setProjection(true, this._orthoScale);
    } else {
      this.camera.perspective({
        fov: 45,
        aspect: width / height,
        near: 0.01,
        far: 100,
      });
    }

    if (this.mainRT) {
      this.mainRT = new RenderTarget(this.gl!, { width, height });
      this.tempRT = new RenderTarget(this.gl!, { width, height });
      this.blurRT1 = new RenderTarget(this.gl!, {
        width,
        height,
        depth: false,
      });
      this.blurRT2 = new RenderTarget(this.gl!, {
        width,
        height,
        depth: false,
      });
    }
  }

  resetRingbuffer(): void {
    this.positionsBuffer.fill(0);
    this.colorsBuffer.fill(0);
    this.writeIndex = 0;
    this.totalWritten = 0;
    this.geometry?.setDrawRange(0, 0);

    if (this.gl && this.mainRT) {
      const gl = this.gl;
      gl.bindFramebuffer(
        gl.FRAMEBUFFER,
        (this.mainRT as unknown as { buffer: WebGLFramebuffer }).buffer
      );
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  writePoint(
    x: number,
    y: number,
    z: number,
    r: number,
    g: number,
    b: number
  ): void {
    const bufIdx = (this.writeIndex % this.maxPoints) * 3;
    this.positionsBuffer[bufIdx + 0] = x;
    this.positionsBuffer[bufIdx + 1] = y;
    this.positionsBuffer[bufIdx + 2] = z;
    this.colorsBuffer[bufIdx + 0] = r;
    this.colorsBuffer[bufIdx + 1] = g;
    this.colorsBuffer[bufIdx + 2] = b;
    this.writeIndex++;
  }

  shiftZ(speed: number): void {
    const count = this.totalWritten;
    for (let i = 0; i < count; i++) {
      this.positionsBuffer[i * 3 + 2] =
        (this.positionsBuffer[i * 3 + 2] ?? 0) - speed;
    }
  }

  commitFrame(): void {
    this.totalWritten = Math.min(this.writeIndex, this.maxPoints);
    if (this.geometry) {
      const posAttr = this.geometry.attributes['position'];
      const colAttr = this.geometry.attributes['color'];
      if (posAttr) posAttr.needsUpdate = true;
      if (colAttr) colAttr.needsUpdate = true;
      this.geometry.setDrawRange(0, this.totalWritten);
    }
  }

  render(glowIntensity: number): void {
    if (
      !this.renderer ||
      !this.scene ||
      !this.camera ||
      !this.mainRT ||
      !this.tempRT ||
      !this.blurRT1 ||
      !this.blurRT2 ||
      !this.fullscreenQuad ||
      !this.fadeUniforms ||
      !this.blurUniforms ||
      !this.compositeUniforms
    )
      return;

    const gl = this.gl!;

    // Step 1: Fade previous accumulation (mainRT → tempRT)
    this.fadeUniforms.tMap.value = this.mainRT.texture;
    this.fullscreenQuad.program = this.programs.fade!;
    this.renderer.render({ scene: this.fullscreenQuad, target: this.tempRT });

    // Step 2: Copy faded result back to mainRT (fade=0 = simple copy)
    this.fadeUniforms.tMap.value = this.tempRT.texture;
    const savedFade = this.fadeUniforms.uFade.value;
    this.fadeUniforms.uFade.value = 0;
    this.renderer.render({ scene: this.fullscreenQuad, target: this.mainRT });
    this.fadeUniforms.uFade.value = savedFade;

    // Step 3: Draw new geometry into mainRT with additive blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    this.renderer.render({
      scene: this.scene,
      camera: this.camera,
      target: this.mainRT,
      clear: false,
    });
    gl.disable(gl.BLEND);

    if (glowIntensity > 0) {
      // Step 4: Horizontal blur
      this.blurUniforms.tMap.value = this.mainRT.texture;
      this.blurUniforms.uDirection.value = [
        3.0 / (this.mainRT as unknown as { width: number }).width,
        0,
      ];
      this.fullscreenQuad.program = this.programs.blur!;
      this.renderer.render({
        scene: this.fullscreenQuad,
        target: this.blurRT1,
      });

      // Step 5: Vertical blur
      this.blurUniforms.tMap.value = this.blurRT1.texture;
      this.blurUniforms.uDirection.value = [
        0,
        3.0 / (this.mainRT as unknown as { height: number }).height,
      ];
      this.renderer.render({
        scene: this.fullscreenQuad,
        target: this.blurRT2,
      });

      // Step 6: Composite → screen
      this.compositeUniforms.tScene.value = this.mainRT.texture;
      this.compositeUniforms.tBlur.value = this.blurRT2.texture;
      this.fullscreenQuad.program = this.programs.composite!;
      this.renderer.render({ scene: this.fullscreenQuad });
    } else {
      // No glow — blit mainRT to screen
      this.fadeUniforms.tMap.value = this.mainRT.texture;
      this.fadeUniforms.uFade.value = 0;
      this.fullscreenQuad.program = this.programs.fade!;
      this.renderer.render({ scene: this.fullscreenQuad });
      this.fadeUniforms.uFade.value = savedFade;
    }
  }

  clear(): void {
    if (!this.gl || !this.mainRT) return;
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(
      gl.FRAMEBUFFER,
      (this.mainRT as unknown as { buffer: WebGLFramebuffer }).buffer
    );
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
}
