// =========================================================================
// Render Pipeline: OGL Setup, Shader Strings, Ringbuffer, Fade+Glow

import { Renderer, Camera, Transform, Geometry, Program, Mesh, RenderTarget } from 'ogl';

export class RenderPipeline {
	constructor(canvas) {
		this.canvas = canvas;
		this.gl = null;
		this.renderer = null;
		this.camera = null;
		this.scene = null;
		this.geometry = null;
		this.mesh = null;

		this.programs = { base: null, fade: null, blur: null, composite: null };

		// Glow + Fade pipeline
		this.mainRT = null; // accumulation buffer (never cleared)
		this.tempRT = null; // temp for fade pass output
		this.blurRT1 = null;
		this.blurRT2 = null;
		this.fullscreenQuad = null;

		// GPU Ringbuffer
		this.maxPoints = 65536;
		this.positionsBuffer = new Float32Array(this.maxPoints * 3);
		this.colorsBuffer = new Float32Array(this.maxPoints * 3);
		this.writeIndex = 0;
		this.totalWritten = 0;

		// Orbit Camera
		this.orbitAngleX = 0;
		this.orbitAngleY = 0.3;
		this.orbitRadius = 3;
		this._ortho = false;
		this._orthoScale = 3;
	}

	// --- Init ---

	init(settings, shaders) {
		const container = this.canvas.parentElement;
		const width = container.clientWidth;
		const height = container.clientHeight;

		this.renderer = new Renderer({
			canvas: this.canvas,
			width: width,
			height: height,
			dpr: Math.min(window.devicePixelRatio, 2),
			alpha: false,
			antialias: true,
			preserveDrawingBuffer: true,
		});
		this.gl = this.renderer.gl;
		const gl = this.gl;

		// Camera
		this.camera = new Camera(gl, { fov: 45, aspect: width / height, near: 0.01, far: 100 });
		this.updateCameraOrbit();

		// Scene
		this.scene = new Transform();

		// 3D Mesh Geometry
		this.geometry = new Geometry(gl, {
			position: { size: 3, data: this.positionsBuffer, usage: gl.DYNAMIC_DRAW },
			color: { size: 3, data: this.colorsBuffer, usage: gl.DYNAMIC_DRAW },
		});
		this.geometry.setDrawRange(0, 0);

		// Programs
		this.programs.base = new Program(gl, {
			vertex: shaders.baseVert,
			fragment: shaders.baseFrag,
			uniforms: {
				uPointSize: { value: settings.pointSize },
				uTrailDepth: { value: settings.trailDepth },
			},
			depthTest: true,
			depthWrite: true,
			transparent: false,
		});

		this.programs.fade = new Program(gl, {
			vertex: shaders.fullscreenVert,
			fragment: shaders.fadeFrag,
			uniforms: {
				tMap: { value: null },
				uFade: { value: settings.fadeOut },
			},
			depthTest: false,
			depthWrite: false,
		});

		this.programs.blur = new Program(gl, {
			vertex: shaders.fullscreenVert,
			fragment: shaders.blurFrag,
			uniforms: {
				tMap: { value: null },
				uDirection: { value: [0, 0] },
			},
			depthTest: false,
			depthWrite: false,
		});

		this.programs.composite = new Program(gl, {
			vertex: shaders.fullscreenVert,
			fragment: shaders.compositeFrag,
			uniforms: {
				tScene: { value: null },
				tBlur: { value: null },
				uGlow: { value: settings.glowIntensity },
			},
			depthTest: false,
			depthWrite: false,
		});

		// Mesh
		this.mesh = new Mesh(gl, {
			geometry: this.geometry,
			program: this.programs.base,
			mode: gl[settings.renderMode],
		});
		this.mesh.setParent(this.scene);

		// Fullscreen Quad
		const quadGeo = new Geometry(gl, {
			position: { size: 2, data: new Float32Array([-1, -1, 3, -1, -1, 3]) },
		});
		this.fullscreenQuad = new Mesh(gl, {
			geometry: quadGeo,
			program: this.programs.fade,
			frustumCulled: false,
		});

		// Render Targets
		this.mainRT = new RenderTarget(gl, { width: width, height: height });
		this.tempRT = new RenderTarget(gl, { width: width, height: height });
		this.blurRT1 = new RenderTarget(gl, { width: width, height: height, depth: false });
		this.blurRT2 = new RenderTarget(gl, { width: width, height: height, depth: false });

		// GL State
		gl.clearColor(0.0, 0.0, 0.0, 1.0);
		gl.enable(gl.DEPTH_TEST);

		// Clear mainRT initially
		this.renderer.render({ scene: this.scene, camera: this.camera, target: this.mainRT });

		this.resize();
		window.addEventListener('resize', () => this.resize());
	}

	// --- Camera ---

	setProjection(ortho, scale) {
		const container = this.canvas.parentElement;
		const aspect = container.clientWidth / container.clientHeight;
		this._ortho = ortho;
		this._orthoScale = scale || this.orbitRadius;

		if (ortho) {
			const s = this._orthoScale;
			this.camera.orthographic({ left: -aspect * s, right: aspect * s, bottom: -s, top: s, near: 0.01, far: 100 });
		} else {
			this.camera.perspective({ fov: 45, aspect, near: 0.01, far: 100 });
		}
	}

	updateCameraOrbit() {
		this.camera.position.x = Math.sin(this.orbitAngleX) * Math.cos(this.orbitAngleY) * this.orbitRadius;
		this.camera.position.y = Math.sin(this.orbitAngleY) * this.orbitRadius;
		this.camera.position.z = Math.cos(this.orbitAngleX) * Math.cos(this.orbitAngleY) * this.orbitRadius;
		this.camera.lookAt([0, 0, 0]);
	}

	resize() {
		const container = this.canvas.parentElement;
		const width = container.clientWidth;
		const height = container.clientHeight;

		this.renderer.setSize(width, height);

		if (this._ortho) {
			this.setProjection(true, this._orthoScale);
		} else {
			this.camera.perspective({ fov: 45, aspect: width / height, near: 0.01, far: 100 });
		}

		if (this.mainRT) {
			this.mainRT.setSize(width, height);
			this.tempRT.setSize(width, height);
			this.blurRT1.setSize(width, height);
			this.blurRT2.setSize(width, height);
		}
	}

	// --- Ringbuffer ---

	resetRingbuffer() {
		this.positionsBuffer.fill(0);
		this.colorsBuffer.fill(0);
		this.writeIndex = 0;
		this.totalWritten = 0;
		this.geometry.setDrawRange(0, 0);

		// Clear accumulation buffer
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.mainRT.buffer);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}

	writePoint(x, y, z, r, g, b) {
		const bufIdx = (this.writeIndex % this.maxPoints) * 3;
		this.positionsBuffer[bufIdx + 0] = x;
		this.positionsBuffer[bufIdx + 1] = y;
		this.positionsBuffer[bufIdx + 2] = z;
		this.colorsBuffer[bufIdx + 0] = r;
		this.colorsBuffer[bufIdx + 1] = g;
		this.colorsBuffer[bufIdx + 2] = b;
		this.writeIndex++;
	}

	shiftZ(speed) {
		const count = this.totalWritten;
		for (let i = 0; i < count; i++) {
			this.positionsBuffer[i * 3 + 2] -= speed;
		}
	}

	commitFrame() {
		this.totalWritten = Math.min(this.writeIndex, this.maxPoints);
		this.geometry.attributes.position.needsUpdate = true;
		this.geometry.attributes.color.needsUpdate = true;
		this.geometry.setDrawRange(0, this.totalWritten);
	}

	// --- Render ---

	render(glowIntensity) {
		const gl = this.gl;

		// Step 1: Fade previous accumulation (mainRT → tempRT)
		this.programs.fade.uniforms.tMap.value = this.mainRT.texture;
		this.fullscreenQuad.program = this.programs.fade;
		this.renderer.render({ scene: this.fullscreenQuad, target: this.tempRT });

		// Step 2: Copy faded result back to mainRT
		// We reuse the fade program with uFade=0 to do a simple copy
		this.programs.fade.uniforms.tMap.value = this.tempRT.texture;
		const savedFade = this.programs.fade.uniforms.uFade.value;
		this.programs.fade.uniforms.uFade.value = 0;
		this.renderer.render({ scene: this.fullscreenQuad, target: this.mainRT });
		this.programs.fade.uniforms.uFade.value = savedFade;

		// Step 3: Draw new geometry into mainRT with additive blending
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
		this.renderer.render({ scene: this.scene, camera: this.camera, target: this.mainRT, clear: false });
		gl.disable(gl.BLEND);

		if (glowIntensity > 0) {
			// Step 4: Horizontal Blur
			this.programs.blur.uniforms.tMap.value = this.mainRT.texture;
			this.programs.blur.uniforms.uDirection.value = [3.0 / this.mainRT.width, 0];
			this.fullscreenQuad.program = this.programs.blur;
			this.renderer.render({ scene: this.fullscreenQuad, target: this.blurRT1 });

			// Step 5: Vertical Blur
			this.programs.blur.uniforms.tMap.value = this.blurRT1.texture;
			this.programs.blur.uniforms.uDirection.value = [0, 3.0 / this.mainRT.height];
			this.renderer.render({ scene: this.fullscreenQuad, target: this.blurRT2 });

			// Step 6: Composite → Screen
			this.programs.composite.uniforms.tScene.value = this.mainRT.texture;
			this.programs.composite.uniforms.tBlur.value = this.blurRT2.texture;
			this.fullscreenQuad.program = this.programs.composite;
			this.renderer.render({ scene: this.fullscreenQuad });
		} else {
			// No glow — just blit mainRT to screen
			this.programs.fade.uniforms.tMap.value = this.mainRT.texture;
			this.programs.fade.uniforms.uFade.value = 0;
			this.fullscreenQuad.program = this.programs.fade;
			this.renderer.render({ scene: this.fullscreenQuad });
			this.programs.fade.uniforms.uFade.value = savedFade;
		}
	}

	clear() {
		const gl = this.gl;
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		// Also clear accumulation buffer
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.mainRT.buffer);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	}
}

// =========================================================================
