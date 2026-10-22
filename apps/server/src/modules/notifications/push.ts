/**
 * Notifications push par le service d'Expo (https://exp.host/--/api/v2/push/send).
 * Aucun module natif : l'appli obtient un jeton avec expo-notifications et l'enregistre
 * (POST /v1/notifications/push-token). Envoi par lots de 100.
 */
import type { Logger } from '../../lib/logger.js';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default' | null;
  badge?: number;
  /** Canal Android (créé par l'appli) ; « default » si absent. */
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
}

export interface PushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushSender {
  /** Rend un ticket par message, dans le même ordre. */
  send(messages: PushMessage[]): Promise<PushTicket[]>;
}

const CHUNK = 100;

export class ExpoPushSender implements PushSender {
  constructor(
    private readonly url: string,
    private readonly accessToken: string | undefined,
    private readonly log: Logger,
  ) {}

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    const tickets: PushTicket[] = [];
    for (let i = 0; i < messages.length; i += CHUNK) {
      const chunk = messages.slice(i, i + CHUNK);
      try {
        const res = await fetch(this.url, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(chunk),
          signal: AbortSignal.timeout(10_000),
        });
        const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
        const data = Array.isArray(json?.data) ? (json.data as PushTicket[]) : null;
        if (!res.ok || data === null || data.length !== chunk.length) {
          this.log.warn({ status: res.status }, 'réponse inattendue du service push Expo');
          tickets.push(...chunk.map(() => ({ status: 'error' as const, message: `http_${res.status}` })));
        } else {
          tickets.push(...data);
        }
      } catch (err) {
        this.log.warn({ err }, 'service push Expo injoignable');
        tickets.push(...chunk.map(() => ({ status: 'error' as const, message: 'unreachable' })));
      }
    }
    return tickets;
  }
}

/** Tests : garde les messages ; les jetons listés dans `unregistered` répondent DeviceNotRegistered. */
export class MemoryPushSender implements PushSender {
  readonly sent: PushMessage[] = [];
  readonly unregistered = new Set<string>();

  async send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return messages.map((m) =>
      this.unregistered.has(m.to)
        ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
        : { status: 'ok', id: `ticket-${this.sent.length}` },
    );
  }
}
