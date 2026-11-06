import { setDiagnosticGraphics } from '../core/diagnostics';
import { AfterViewInit, Component, DestroyRef, ElementRef, effect, inject, viewChild } from '@angular/core';
import { WorldSettingsService } from '../core/world-settings.service';

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vUv;
  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;

  float noise(vec2 coordinate) {
    const float e = 2.718281828459045;
    vec2 r = e * sin(e * coordinate);
    return fract(r.x * r.y * (1.0 + coordinate.x));
  }

  mat2 rotate2d(float angle) {
    float c = cos(angle);
    float s = sin(angle);
    return mat2(c, -s, s, c);
  }

  void main() {
    vec2 uv = vUv;
    uv.x *= uAspect;
    vec2 tex = rotate2d(-0.12) * (uv * 1.02);
    float offset = 4.2 * uTime;
    tex.y += 0.035 * sin(8.0 * tex.x - offset);

    float folds = 0.6 + 0.4 * sin(
      3.3 * (tex.x + tex.y + cos(2.0 * tex.x + 3.2 * tex.y) + 0.02 * offset)
      + sin(10.0 * (tex.x + tex.y - 0.1 * offset))
    );
    float grain = noise(gl_FragCoord.xy) / 42.0;
    // Trama neutra: con soft-light modifica solo luci e ombre dello sfondo,
    // senza sovrapporgli un nuovo colore.
    float shade = mix(0.16, 0.69, folds) - grain;
    gl_FragColor = vec4(vec3(shade), 0.58);
  }
`;

@Component({ selector: 'app-world-silk', standalone: true, templateUrl: './world-silk.html' })
export class WorldSilk implements AfterViewInit {
  protected readonly worldSettingsService = inject(WorldSettingsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');
  private animationFrame = 0;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private timeUniform: WebGLUniformLocation | null = null;
  private aspectUniform: WebGLUniformLocation | null = null;
  private startedAt = performance.now();
  private reducedMotion = false;
  private ready = false;
  private destroyed = false;
  private failed = false;

  constructor() {
    effect(() => {
      this.worldSettingsService.settings().silk;
      queueMicrotask(() => this.reconcile());
    });
  }

  ngAfterViewInit(): void {
    this.ready = true;
    const canvas = this.canvas()?.nativeElement;
    if (!canvas) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = media.matches;
    const resize = () => { if (this.enabled()) this.resize(canvas); };
    const visibility = () => this.reconcile();
    const motion = () => { this.reducedMotion = media.matches; this.stop(); this.reconcile(); };
    const lost = (event: Event) => {
      event.preventDefault();
      this.stop();
      this.failed = true;
      canvas.classList.add('is-fallback');
      setDiagnosticGraphics({ contextLost: true, effect: 'silk' });
    };
    const restored = () => {
      this.gl = null; this.program = null; this.buffer = null; this.failed = false;
      this.reconcile();
    };
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', visibility);
    media.addEventListener('change', motion);
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', visibility);
      media.removeEventListener('change', motion);
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      if (this.buffer) this.gl?.deleteBuffer(this.buffer);
      if (this.program) this.gl?.deleteProgram(this.program);
      this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
      this.gl = null;
    });
    this.reconcile();
  }

  private enabled(): boolean {
    return this.ready && !this.destroyed && !document.hidden && this.worldSettingsService.settings().silk;
  }

  private reconcile(): void {
    if (!this.enabled()) { this.stop(); return; }
    const canvas = this.canvas()?.nativeElement;
    if (!canvas || this.failed) return;
    if (!this.gl && !this.initialize(canvas)) return;
    this.resize(canvas);
    this.start();
  }

  private initialize(canvas: HTMLCanvasElement): boolean {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' });
    this.gl = gl;
    if (!gl) { this.failed = true; canvas.classList.add('is-fallback'); return false; }
    this.program = this.createProgram(gl);
    if (!this.program) { this.failed = true; canvas.classList.add('is-fallback'); return false; }
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(this.program, 'aPosition');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.timeUniform = gl.getUniformLocation(this.program, 'uTime');
    this.aspectUniform = gl.getUniformLocation(this.program, 'uAspect');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    setDiagnosticGraphics({ effect: 'silk', renderer: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER), vendor: gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR), version: gl.getParameter(gl.VERSION) });
    canvas.classList.remove('is-fallback');
    return true;
  }

  private createProgram(gl: WebGLRenderingContext): WebGLProgram | null {
    const compile = (type: number, source: string): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Impossibile compilare lo shader della seta:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader); return null;
      }
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }
    const program = gl.createProgram();
    if (program) { gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); }
    gl.deleteShader(vertex); gl.deleteShader(fragment);
    if (!program) return null;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Impossibile collegare lo shader della seta:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program); return null;
    }
    return program;
  }

  private resize(canvas: HTMLCanvasElement): void {
    if (!this.gl) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.round(window.innerWidth * ratio));
    const height = Math.max(1, Math.round(window.innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width; canvas.height = height;
      this.gl.viewport(0, 0, width, height);
      if (this.reducedMotion) this.render(0);
    }
  }

  private start(): void {
    if (!this.enabled() || this.failed || this.animationFrame || !this.gl || !this.program) return;
    if (this.reducedMotion) { this.render(0); return; }
    const frame = (now: number) => {
      this.animationFrame = 0;
      if (!this.enabled() || this.failed) return;
      this.render((now - this.startedAt) / 1000 * 0.1);
      this.animationFrame = requestAnimationFrame(frame);
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  private stop(): void {
    cancelAnimationFrame(this.animationFrame);
    this.animationFrame = 0;
  }

  private render(time: number): void {
    if (!this.gl || !this.program) return;
    this.gl.useProgram(this.program);
    this.gl.uniform1f(this.timeUniform, time);
    this.gl.uniform1f(this.aspectUniform, this.gl.canvas.width / this.gl.canvas.height);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }
}
