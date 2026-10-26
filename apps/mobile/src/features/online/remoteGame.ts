/**
 * Contrôleur de partie distante (contrat C3, SPEC §9) : salon, défi, ligue, machine en ligne
 * avec pari, ou regarder une partie.
 *
 * Le serveur fait foi : le contrôleur n'applique rien lui-même. Il envoie des intentions
 * (`game.move`, `game.roll`…) avec le dernier `seq` connu, et ne change d'état qu'à la
 * réception de `game.state`. L'événement (`game.event`, même `seq`) arrive juste avant
 * l'état : il est gardé puis rendu avec l'état, pour les animations et les sons.
 *
 * Reconnexion : la nouvelle connexion n'a plus d'abonnement, on se réabonne (le serveur
 * renvoie l'état complet). Les intentions envoyées pendant la coupure attendent dans la file
 * du client temps réel ; un `seq` dépassé est refusé (`game.stale`) et l'état suivant corrige.
 *
 * Module pur : le client temps réel, l'horloge et le hasard sont injectés.
 */
import type {
  GameEndMessage,
  GameEventMessage,
  GameStateMessage,
} from "@kwatt/protocol";
import { WS_RECONNECTED, type WsClient } from "../../api/ws";
import type {
  GameController,
  GameEvent,
  GameFamily,
  GameOutcome,
  SeatClock,
  SeatInfo,
} from "../game/controller";

export interface RemoteDeps {
  ws: Pick<WsClient, "on" | "send" | "request">;
  now: () => number;
  /** `bytes` octets aléatoires en hexadécimal (grain de sel du joueur pour le dé). */
  randomHex: (bytes: number) => string;
}

export interface RemoteOptions {
  spectate?: boolean;
}

/** Réactions reçues à la fin (spectateurs) : montrées sur l'écran de fin. */
export type EndReactions = GameEndMessage["reactions"];

export abstract class RemoteGameController<
  State,
  Move,
> implements GameController<State, Move> {
  readonly kind = "remote" as const;
  abstract readonly family: GameFamily;

  protected msg: GameStateMessage | null = null;
  protected state: State | null = null;
  /** Heure locale de réception du dernier état (pendules et temps du tour). */
  protected receivedAt = 0;
  private readonly listeners = new Set<(s: State, e?: GameEvent) => void>();
  private readonly offs: (() => void)[] = [];
  private pendingEvent: {
    seq: number;
    event: GameEventMessage["event"];
  } | null = null;
  private reactions: EndReactions = [];
  private disposed = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: unknown) => void;
  private failure: unknown = null;

  constructor(
    readonly id: string,
    protected readonly deps: RemoteDeps,
    protected readonly options: RemoteOptions = {},
  ) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // Évite une promesse rejetée sans écouteur si personne n'attend `ready()`.
    this.readyPromise.catch(() => undefined);
    const ws = deps.ws;
    this.offs.push(
      ws.on<GameStateMessage>("game.state", (m) => {
        if (m.gameId === this.id) this.onState(m);
      }),
      ws.on<GameEventMessage>("game.event", (m) => {
        if (m.gameId === this.id)
          this.pendingEvent = { seq: m.seq, event: m.event };
      }),
      ws.on<GameEndMessage>("game.end", (m) => {
        if (m.gameId === this.id) this.reactions = m.reactions;
      }),
      ws.on(WS_RECONNECTED, () => this.subscribeRemote()),
    );
    this.subscribeRemote();
  }

  /** Premier état reçu (ou erreur : partie introuvable…). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** Erreur du premier abonnement (code), ou null. */
  error(): unknown {
    return this.failure;
  }

  private subscribeRemote(): void {
    if (this.disposed) return;
    this.deps.ws
      .request<GameStateMessage>({
        t: "game.subscribe",
        gameId: this.id,
        ...(this.options.spectate ? { spectate: true } : {}),
      })
      .then((m) => {
        if (m.t === "game.state") this.onState(m);
      })
      .catch((err: unknown) => {
        if (this.msg) return;
        this.failure = err;
        this.rejectReady(err);
      });
  }

  /** Redemande l'état (écran revenu au premier plan). */
  sync(): void {
    this.deps.ws.send({ t: "game.sync", gameId: this.id });
  }

  private onState(m: GameStateMessage): void {
    if (this.disposed) return;
    // Un état plus ancien que celui qu'on a (réponse en retard) est ignoré.
    if (this.msg && m.seq < this.msg.seq) return;
    const previous = this.msg;
    const prevState = this.state;
    this.msg = m;
    this.receivedAt = this.deps.now();
    this.state = this.parseState(m);
    const wire =
      this.pendingEvent && this.pendingEvent.seq === m.seq
        ? this.pendingEvent.event
        : null;
    this.pendingEvent = null;
    const events =
      previous && prevState
        ? this.eventsFor(wire, prevState, this.state, previous, m)
        : [];
    if (!previous) this.resolveReady();
    if (events.length === 0) this.emit(undefined);
    for (const e of events) this.emit(e);
  }

  private emit(event: GameEvent | undefined): void {
    const s = this.state;
    if (s === null) return;
    for (const l of [...this.listeners]) l(s, event);
  }

  /** État des règles à partir du message du serveur. */
  protected abstract parseState(m: GameStateMessage): State;
  /** Événements d'animation et de son à rendre avec ce nouvel état. */
  protected abstract eventsFor(
    wire: GameEventMessage["event"] | null,
    before: State,
    after: State,
    prev: GameStateMessage,
    next: GameStateMessage,
  ): GameEvent[];
  abstract legalMoves(): Move[];
  abstract play(move: Move): void;

  getState(): State {
    if (this.state === null)
      throw new Error("Partie distante pas encore reçue : attendre ready()");
    return this.state;
  }

  /** Dernier message d'état du serveur (spectateurs, commitment du dé…). */
  wire(): GameStateMessage | null {
    return this.msg;
  }

  subscribe(cb: (state: State, event?: GameEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  mySeats(): number[] {
    return this.msg?.mySeats ?? [];
  }

  seats(): SeatInfo[] {
    return (this.msg?.seats ?? []).map((s) => ({
      seat: s.seat,
      userId: s.userId,
      name: s.pseudo,
      ...(s.machine ? { machine: s.machine } : {}),
      ...(s.avatar ? { avatar: s.avatar } : {}),
      connected: s.connected,
      ...(s.team !== undefined ? { team: s.team } : {}),
    }));
  }

  isSpectator(): boolean {
    return this.mySeats().length === 0;
  }

  isThinking(): boolean {
    return this.msg?.thinking ?? false;
  }

  /** Nombre de spectateurs (écran de partie, « 12 regardent »). */
  spectators(): number {
    return this.msg?.spectators ?? 0;
  }

  endReactions(): EndReactions {
    return this.reactions;
  }

  /** Temps écoulé depuis l'envoi de l'état, corrigé de l'heure locale. */
  protected elapsed(): number {
    return Math.max(0, this.deps.now() - this.receivedAt);
  }

  clock(): Record<number, SeatClock> | null {
    const clocks = this.msg?.clocks;
    if (!clocks) return null;
    const out: Record<number, SeatClock> = {};
    const finished = this.msg?.status !== "playing";
    for (const [seat, c] of Object.entries(clocks)) {
      const running = c.running && !finished;
      out[Number(seat)] = {
        remainingMs: Math.max(
          0,
          c.remainingMs - (running ? this.elapsed() : 0),
        ),
        running,
      };
    }
    return out;
  }

  outcome(): GameOutcome | null {
    const o = this.msg?.outcome;
    if (!o) return null;
    return {
      places: Object.fromEntries(
        Object.entries(o.places).map(([k, v]) => [Number(k), v]),
      ),
      draw: o.draw,
      reason: o.reason,
    };
  }

  /** Envoie une intention avec le dernier `seq` connu. */
  protected sendIntent(message: { t: string; [k: string]: unknown }): void {
    if (!this.msg || this.isSpectator()) return;
    this.deps.ws.send({ ...message, gameId: this.id, seq: this.msg.seq });
  }

  resign(): void {
    if (this.isSpectator()) return;
    this.deps.ws.send({ t: "game.resign", gameId: this.id });
  }

  react(key: string): void {
    // Clé « reaction.ekie » ou « ekie » : le serveur attend la clé courte.
    this.deps.ws.send({
      t: "game.react",
      gameId: this.id,
      key: key.replace(/^reaction\./, ""),
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs) off();
    this.listeners.clear();
    this.deps.ws.send({ t: "game.unsubscribe", gameId: this.id });
  }
}
