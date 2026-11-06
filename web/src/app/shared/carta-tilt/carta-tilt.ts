import { AfterViewChecked, Component, ElementRef, HostBinding, HostListener, Input, NgZone, OnChanges, OnDestroy, SimpleChanges, ViewChild, inject } from '@angular/core';
import { MetallicFoil } from '../metallic-foil/metallic-foil';
import { HOLO_PALETTES, HoloFragment, computeFragmentStyle, getHoloFragments } from './holo-mosaic';
import { MetalPreset } from '../metallic-foil/metal-palette';
import { CARTA_FINITURA_META, CartaFinitura, CartaFinituraGemma } from '../carta-finiture';
import { CARTA_ENTER_DURATION_MS, CARTA_REST_LIGHT, applyCartaPointer, cartaPointerPosition, resetCartaPointer } from '../carta-pointer';
import { CartaNameplate } from '../carta-nameplate/carta-nameplate';

export type { CartaFinitura } from '../carta-finiture';

const SVG_NS = 'http://www.w3.org/2000/svg';
export type CartaVariante = 'normale' | 'fullart' | 'tarocco';

// Tilt 3D continuo + foil, con due effetti visivi DIVERSI a seconda della finitura (richiesto
// esplicitamente da Rory, non intercambiabili):
// - Metalli (oro, argento): superficie liscia continua, componente <app-metallic-foil> a sé
//   (preset 'gold'/'silver', vedi metal-palette.ts), niente frammenti.
// - Pietre (onice/smeraldo/rubino/zaffiro/diamante): mosaico olografico "crushed ice" costruito qui
//   stesso con poligoni SVG (vedi holo-mosaic.ts per la fisica della luce per-frammento).
//   Pattern geometrico SEMPRE fisso, cambia solo il colore di ciascun frammento in base alla
//   propria normale ottica rispetto al mouse — non un riflettore che insegue il cursore né una
//   trama che si sposta (entrambe bocciate in versioni precedenti).
//
// Le centinaia di aggiornamenti fill/opacity durante il pointermove scrivono direttamente sugli
// attributi SVG e sulle CSS custom property del tilt (bypassando i binding di Angular, dentro
// NgZone.runOutsideAngular): farli passare dal change detection di Angular a ogni mossa del
// mouse sarebbe molto più lento con centinaia di poligoni per carta.
@Component({
  selector: 'app-carta-tilt',
  standalone: true,
  imports: [MetallicFoil, CartaNameplate],
  styleUrl: './carta-tilt.css',
  templateUrl: './carta-tilt.html'
})
export class CartaTilt implements AfterViewChecked, OnChanges, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly zone = inject(NgZone);

  @Input({ required: true }) finitura: CartaFinitura = 'flat';
  @Input() immagineUrl: string | null = null;
  @Input() nome = '';
  @Input() variante: CartaVariante = 'normale';

  @ViewChild('frame', { static: true }) private readonly frameRef!: ElementRef<HTMLElement>;
  @ViewChild('foilSvg') private readonly foilSvgRef?: ElementRef<SVGSVGElement>;
  @ViewChild(MetallicFoil) private readonly metallicFoil?: MetallicFoil;

  @HostBinding('class.carta-tilt-host') readonly hostClass = true;
  @HostBinding('class.carta-tilt-host--tarocco') protected get tarotHostClass(): boolean {
    return this.variante === 'tarocco';
  }
  @HostBinding('class.carta-tilt-host--fullart') protected get fullArtHostClass(): boolean {
    return this.isFullArt;
  }
  @HostBinding('style.aspect-ratio') protected get hostAspectRatio(): string | null {
    if (!this.isFullArt) return null;
    return this.imageAspectRatio ?? (this.variante === 'tarocco' ? '2 / 3' : '3 / 4');
  }

  protected get isFullArt(): boolean {
    return this.variante !== 'normale';
  }

  private pointerFrame: number | undefined;
  private pendingPointer: PointerEvent | undefined;

  private imageAspectRatio: string | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['immagineUrl']) this.imageAspectRatio = null;
  }

  // Getter, non un campo di classe: un campo inizializzato subito leggerebbe this.finitura
  // PRIMA che Angular assegni il valore reale dell'@Input (i campi di classe si valutano nel
  // costruttore, gli @Input vengono impostati solo dopo) — risultato: sempre false, niente
  // mosaico mai renderizzato. Bug reale, trovato testando: 0 poligoni nel DOM.
  protected get isMetallo(): boolean {
    return CARTA_FINITURA_META[this.finitura].famiglia === 'metallo';
  }

  protected get metalPreset(): MetalPreset {
    return CARTA_FINITURA_META[this.finitura].metalPreset ?? 'gold';
  }

  protected get isGemma(): boolean {
    return CARTA_FINITURA_META[this.finitura].famiglia === 'gemma';
  }

  private get palette() {
    return this.isGemma ? HOLO_PALETTES[this.finitura as CartaFinituraGemma] : undefined;
  }

  private fragmentElements: SVGPolygonElement[] = [];
  private fragments: HoloFragment[] = [];
  private foilAnimationFrame?: number;
  private foilAnimationStartedAt = 0;
  private foilAnimationFrom: readonly [number, number] = CARTA_REST_LIGHT;
  private foilAnimationTarget: readonly [number, number] = CARTA_REST_LIGHT;
  private foilAnimationDuration = 0;
  private currentFoilLight: readonly [number, number] = CARTA_REST_LIGHT;
  // Per quale finitura sono attualmente colorati i poligoni nell'SVG corrente — non "se" sono
  // stati costruiti, ma "per cosa": serve a distinguere i due casi che altrimenti si
  // confondono con un semplice flag booleano (vedi sotto).
  private finituraCostruita?: CartaFinitura;

  // ngAfterViewChecked invece di ngAfterViewInit: con due @for che iterano sullo stesso
  // elenco di carte in punti diversi del template (album "mio" e "dell'altro"), le istanze di
  // CartaTilt del SECONDO blocco non ricevevano mai la chiamata a ngAfterViewInit — bug
  // verificato con un log diagnostico (0 chiamate registrate per quelle istanze, DOM comunque
  // presente ma mosaico mai costruito). Non individuata la causa esatta lato Angular;
  // ngAfterViewChecked (che gira ad ogni ciclo di change detection, non solo una volta) è una
  // rete di sicurezza robusta indipendente da quella causa.
  //
  // Due situazioni distinte da gestire qui, non una sola ("già costruito sì/no"):
  // 1. SVG vuoto (0 figli): o è la primissima costruzione, o Angular ha appena ricreato
  //    l'elemento perché la carta è passata da un'altra finitura (oro/flat) a una gemma —
  //    serve costruire la geometria dei poligoni da zero.
  // 2. SVG già pieno MA per una finitura diversa da quella attuale: Angular riusa la stessa
  //    istanza e lo stesso <svg> quando si passa da una finitura gemma a un'altra (es. rubino
  //    → smeraldo) restando nello stesso punto della griglia (stesso design, stesso track
  //    key) — la geometria dei triangoli è identica per ogni gemma, cambia solo la palette,
  //    quindi basta ricolorare gli stessi poligoni, non ricrearli. Il primo giro di questo fix
  //    (un flag "costruito: sì/no" per sempre) non gestiva questo secondo caso: lasciava i
  //    colori della finitura precedente sui poligoni già esistenti — è il bug del "fantasma
  //    rubino dentro l'album smeraldo" segnalato da Rory.
  ngAfterViewChecked(): void {
    if (!this.isGemma || this.isFullArt || !this.foilSvgRef) return;
    const svg = this.foilSvgRef.nativeElement;

    if (svg.childElementCount === 0) {
      this.finituraCostruita = this.finitura;
      this.zone.runOutsideAngular(() => this.buildMosaic());
      return;
    }

    if (this.finituraCostruita !== this.finitura) {
      this.finituraCostruita = this.finitura;
      this.zone.runOutsideAngular(() => this.renderFoil(...CARTA_REST_LIGHT));
    }
  }

  ngOnDestroy(): void {
    this.cancelPointerFrame();
    this.cancelFoilAnimation();
    this.fragmentElements = [];
  }

  private buildMosaic(): void {
    const svg = this.foilSvgRef!.nativeElement;
    this.fragments = getHoloFragments();

    const docFragment = document.createDocumentFragment();
    this.fragmentElements = this.fragments.map((frag) => {
      const [x1, y1, x2, y2, x3, y3] = frag.points;
      const polygon = document.createElementNS(SVG_NS, 'polygon');
      polygon.setAttribute('points', `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
      docFragment.appendChild(polygon);
      return polygon;
    });
    svg.appendChild(docFragment);

    this.renderFoil(...CARTA_REST_LIGHT);
  }

  private renderFoil(lightX: number, lightY: number): void {
    if (!this.palette) return;
    this.currentFoilLight = [lightX, lightY];
    for (let i = 0; i < this.fragments.length; i++) {
      const style = computeFragmentStyle(this.fragments[i], this.palette, lightX, lightY);
      const el = this.fragmentElements[i];
      el.setAttribute('fill', style.fill);
      el.setAttribute('opacity', style.opacity.toFixed(3));
    }
  }

  private animateFoilTo(lightX: number, lightY: number, duration: number, updateTargetOnly = false): void {
    this.foilAnimationTarget = [lightX, lightY];
    if (updateTargetOnly && this.foilAnimationFrame !== undefined) return;

    this.cancelFoilAnimation();
    this.foilAnimationFrom = this.currentFoilLight;
    this.foilAnimationTarget = [lightX, lightY];
    this.foilAnimationDuration = duration;
    this.foilAnimationStartedAt = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - this.foilAnimationStartedAt) / this.foilAnimationDuration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const x = this.foilAnimationFrom[0] + (this.foilAnimationTarget[0] - this.foilAnimationFrom[0]) * eased;
      const y = this.foilAnimationFrom[1] + (this.foilAnimationTarget[1] - this.foilAnimationFrom[1]) * eased;
      this.renderFoil(x, y);

      if (progress < 1) {
        this.foilAnimationFrame = requestAnimationFrame(step);
      } else {
        this.foilAnimationFrame = undefined;
      }
    };
    this.foilAnimationFrame = requestAnimationFrame(step);
  }

  private cancelFoilAnimation(): void {
    if (this.foilAnimationFrame !== undefined) cancelAnimationFrame(this.foilAnimationFrame);
    this.foilAnimationFrame = undefined;
  }

  @HostListener('pointermove', ['$event'])
  protected onPointerMove(event: PointerEvent): void {
    this.pendingPointer = event;
    if (this.pointerFrame !== undefined) return;
    this.zone.runOutsideAngular(() => {
      this.pointerFrame = requestAnimationFrame(() => {
        this.pointerFrame = undefined;
        const latest = this.pendingPointer;
        this.pendingPointer = undefined;
        if (latest) this.applyPointerMove(latest);
      });
    });
  }

  private cancelPointerFrame(): void {
    if (this.pointerFrame !== undefined) cancelAnimationFrame(this.pointerFrame);
    this.pointerFrame = undefined;
    this.pendingPointer = undefined;
  }

  private applyPointerMove(event: PointerEvent): void {
    const [px, py] = cartaPointerPosition(event, this.host.nativeElement);

    this.zone.runOutsideAngular(() => {
      const frame = this.frameRef.nativeElement;
      applyCartaPointer(frame, px, py);

      if (this.isMetallo && !this.isFullArt) this.metallicFoil?.setPointer(px, py);
      if (this.isGemma && !this.isFullArt) {
        if (frame.classList.contains('is-entering')) {
          // Il primo evento avvia l'interpolazione; quelli successivi aggiornano solo il
          // bersaglio, senza riavviare continuamente i 140ms.
          this.animateFoilTo(px, py, CARTA_ENTER_DURATION_MS, true);
        } else {
          this.cancelFoilAnimation();
          this.renderFoil(px, py);
        }
      }
    });
  }

  @HostListener('pointerleave')
  protected onPointerLeave(): void {
    this.cancelPointerFrame();
    this.zone.runOutsideAngular(() => {
      const frame = this.frameRef.nativeElement;
      // --mx/--my pilotano anche .carta-tilt-gloss (vernice lucida, background-position):
      // senza questo reset restavano ferme all'ultima posizione del mouse invece di tornare al
      // centro, la striscia di luce restava "bloccata" invece di rientrare (segnalato da Rory).
      resetCartaPointer(frame);

      if (this.isMetallo && !this.isFullArt) this.metallicFoil?.resetPointer();
      if (this.isGemma && !this.isFullArt) this.animateFoilTo(...CARTA_REST_LIGHT, 500);
    });
  }

  protected get backgroundImage(): string {
    return this.immagineUrl ? `url("${this.immagineUrl}")` : 'none';
  }

  protected onFullArtImageLoad(event: Event): void {
    const image = event.currentTarget as HTMLImageElement;
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      this.imageAspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`;
    }
  }

  protected get gemMaterialStyle(): string {
    if (!this.palette) return 'none';
    const dark = this.palette.dark.join(',');
    const base = this.palette.base.join(',');
    const bright = this.palette.bright.join(',');
    return `radial-gradient(circle at 32% 22%, rgb(${bright}), rgb(${base}) 48%, rgb(${dark}) 100%)`;
  }
}
