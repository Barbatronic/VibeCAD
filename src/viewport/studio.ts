/**
 * Éclairage « Rendu » de la vue (style d'affichage Rendu, export vidéo) : pièce d'environnement
 * (reflets), lumière principale fixe avec ombres douces posées sur un sol invisible, ombrage des
 * creux (GTAO), rendu des couleurs neutre (PBR Neutral : les blancs restent blancs). Chargé seulement quand il sert.
 */
import {
  NeutralToneMapping,
  CanvasTexture,
  Color,
  DirectionalLight,
  HalfFloatType,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  PCFSoftShadowMap,
  PlaneGeometry,
  PMREMGenerator,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderTarget,
  type Box3,
  type Camera,
  type OrthographicCamera,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { DEFAULT_RENDER, lightDirection, type RenderSettings } from '../domain/render';

/** Fond : dégradé vertical (haut, bas) ou couleur unie. */
export type StudioBackground = { top: string; bottom: string } | string;


export class Studio {
  private readonly env: Texture;
  readonly key = new DirectionalLight(0xffffff, 1.5);
  /** Sol invisible qui ne reçoit que l'ombre, ou sol coloré. */
  private readonly ground = new Mesh(new PlaneGeometry(1, 1), new ShadowMaterial({ opacity: 0.22, depthWrite: false }));
  private readonly floor = new Mesh(new PlaneGeometry(1, 1), new MeshStandardMaterial({ color: 0xd9dde3, roughness: 0.92, metalness: 0 }));
  private settings: RenderSettings = { ...DEFAULT_RENDER };
  private readonly keyDirection = new Vector3();
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly gtao: GTAOPass;
  private gtaoKey = '';
  private backgroundKey = '';
  private backgroundTexture: Texture | Color | null = null;
  private size = { width: 1, height: 1 };

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    camera: Camera,
  ) {
    const pmrem = new PMREMGenerator(renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 5;
    this.key.shadow.blurSamples = 16;
    this.ground.receiveShadow = true;
    this.ground.userData = { kind: 'studio-ground' };
    this.ground.renderOrder = -1;
    this.floor.receiveShadow = true;
    this.floor.userData = { kind: 'studio-ground' };
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.gtao = new GTAOPass(scene, camera, 1, 1);
    this.gtao.blendIntensity = 1;
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
    this.configure(DEFAULT_RENDER);
  }

  /** Applique les réglages de la scène (lumière, ambiance, sol, ombrage des creux). */
  configure(settings: RenderSettings): void {
    this.settings = settings;
    const d = lightDirection(settings);
    this.keyDirection.set(d.x, d.y, d.z).normalize();
    this.key.intensity = settings.lightIntensity;
    this.key.shadow.radius = Math.max(1, settings.shadowSoftness);
    this.key.shadow.blurSamples = settings.shadowSoftness <= 0.5 ? 1 : 16;
    (this.ground.material as ShadowMaterial).opacity = settings.shadowOpacity;
    (this.floor.material as MeshStandardMaterial).color.set(settings.groundColor);
    this.ground.visible = settings.ground === 'shadow';
    this.floor.visible = settings.ground === 'color';
    this.gtao.enabled = settings.occlusion;
    if (this.attached) this.applyTone();
  }

  private attached = false;

  private applyTone(): void {
    this.scene.environmentIntensity = this.settings.environment;
    this.renderer.toneMappingExposure = this.settings.exposure;
  }

  /** Met l'éclairage en place dans la scène (true) ou l'en retire (false). */
  attach(on: boolean): void {
    this.attached = on;
    this.scene.environment = on ? this.env : null;
    this.renderer.toneMapping = on ? NeutralToneMapping : NoToneMapping;
    if (on) this.applyTone();
    else {
      this.scene.environmentIntensity = 1;
      this.renderer.toneMappingExposure = 1;
    }
    this.renderer.shadowMap.enabled = on;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    if (on) this.scene.add(this.key, this.key.target, this.ground, this.floor);
    else this.scene.remove(this.key, this.key.target, this.ground, this.floor);
    if (!on) this.scene.background = null;
  }

  /**
   * Rendu de la scène (taille en pixels du tampon, sans facteur d'écran) : lumière et sol placés
   * d'après la boîte des pièces, ombrage des creux à l'échelle du modèle.
   */
  render(camera: PerspectiveCamera | OrthographicCamera, bounds: Box3 | null, width: number, height: number, background: StudioBackground): void {
    this.setBackground(background);
    if (width !== this.size.width || height !== this.size.height) {
      this.size = { width, height };
      this.composer.setPixelRatio(1);
      this.composer.setSize(width, height);
    }
    const center = bounds && !bounds.isEmpty() ? bounds.getCenter(new Vector3()) : new Vector3();
    const radius = bounds && !bounds.isEmpty() ? Math.max(bounds.getSize(new Vector3()).length() / 2, 1) : 50;
    const floor = bounds && !bounds.isEmpty() ? bounds.min.z : 0;
    // Lumière fixe dans le monde (la caméra peut tourner autour) ; ombre cadrée sur le modèle.
    this.key.position.copy(center).addScaledVector(this.keyDirection, radius * 4);
    this.key.target.position.copy(center);
    const shadow = this.key.shadow.camera;
    shadow.left = -radius * 1.6;
    shadow.right = radius * 1.6;
    shadow.top = radius * 1.6;
    shadow.bottom = -radius * 1.6;
    shadow.near = radius * 0.5;
    shadow.far = radius * 8;
    shadow.updateProjectionMatrix();
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = radius * 0.004;
    // Sol juste sous les pièces : invisible (il ne reçoit que l'ombre) ou coloré, assez grand pour l'horizon.
    this.ground.position.set(center.x, center.y, floor - radius * 0.002);
    this.ground.scale.set(radius * 12, radius * 12, 1);
    this.floor.position.copy(this.ground.position);
    this.floor.scale.set(radius * 200, radius * 200, 1);
    // Ombrage des creux à l'échelle du modèle ; la caméra de la vue peut changer (perspective ou non).
    this.renderPass.camera = camera;
    this.gtao.camera = camera;
    const perspective = (camera as PerspectiveCamera).isPerspectiveCamera ? 1 : 0;
    const gtaoKey = `${camera.uuid}|${radius.toPrecision(3)}`;
    if (gtaoKey !== this.gtaoKey) {
      this.gtaoKey = gtaoKey;
      this.gtao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = perspective;
      this.gtao.gtaoMaterial.needsUpdate = true;
      this.gtao.updateGtaoMaterial({ radius: radius * 0.12, distanceExponent: 1.5, thickness: radius * 0.08, scale: 1.1, samples: 16 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.setSize(width, height);
    }
    this.composer.render();
  }

  setBackground(bg: StudioBackground): void {
    const key = typeof bg === 'string' ? bg : `${bg.top}|${bg.bottom}`;
    if (key !== this.backgroundKey) {
      this.backgroundKey = key;
      if (this.backgroundTexture && !(this.backgroundTexture instanceof Color)) this.backgroundTexture.dispose();
      if (typeof bg === 'string') this.backgroundTexture = new Color(bg);
      else {
        const canvas = document.createElement('canvas');
        canvas.width = 2;
        canvas.height = 256;
        const ctx = canvas.getContext('2d')!;
        const g = ctx.createLinearGradient(0, 0, 0, 256);
        g.addColorStop(0, bg.top);
        g.addColorStop(1, bg.bottom);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 2, 256);
        const tex = new CanvasTexture(canvas);
        tex.colorSpace = SRGBColorSpace;
        this.backgroundTexture = tex;
      }
    }
    this.scene.background = this.backgroundTexture;
  }

  dispose(): void {
    this.attach(false);
    this.env.dispose();
    this.composer.dispose();
    this.gtao.dispose();
    this.ground.geometry.dispose();
    (this.ground.material as ShadowMaterial).dispose();
    this.floor.geometry.dispose();
    (this.floor.material as MeshStandardMaterial).dispose();
    if (this.backgroundTexture && !(this.backgroundTexture instanceof Color)) this.backgroundTexture.dispose();
  }
}
