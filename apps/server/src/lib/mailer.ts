/**
 * E-mails : codes de vérification, mot de passe oublié, alertes de sécurité.
 * Rendus dans la langue du destinataire (i18n du serveur), couleurs de @kwatt/design.
 *
 * - SMTP configuré (SMTP_HOST) : envoi par nodemailer.
 * - SMTP vide (développement, petit déploiement) : l'e-mail, code compris, est écrit dans le journal.
 * - Tests : transport en mémoire.
 */
import { night } from '@kwatt/design';
import type { Locale } from '@kwatt/protocol';
import { createTransport } from 'nodemailer';
import { escapeHtml, formatDate, t } from '../i18n/index.js';
import type { Logger } from './logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export class SmtpTransport implements MailTransport {
  private readonly transporter;
  constructor(
    options: { host: string; port: number; secure: boolean; user: string | undefined; password: string | undefined },
    private readonly from: string,
  ) {
    this.transporter = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      ...(options.user !== undefined ? { auth: { user: options.user, pass: options.password ?? '' } } : {}),
    });
  }
  async send(m: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
  }
}

/** Développement : l'e-mail est écrit dans le journal (le code s'y lit). */
export class LogTransport implements MailTransport {
  constructor(private readonly log: Logger) {}
  async send(m: MailMessage): Promise<void> {
    this.log.info({ mail: { to: m.to, subject: m.subject, text: m.text } }, `E-mail (SMTP non configuré) pour ${m.to} : ${m.subject}`);
  }
}

/** Tests : les e-mails sont gardés en mémoire. */
export class MemoryTransport implements MailTransport {
  readonly sent: MailMessage[] = [];
  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }
  /** Dernier e-mail envoyé à `to`. */
  last(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }
  /** Dernier code à 6 chiffres envoyé à `to`. */
  lastCode(to: string): string | undefined {
    return /\b(\d{6})\b/.exec(this.last(to)?.subject ?? '')?.[1];
  }
}

interface Content {
  title: string;
  paragraphs: string[];
  code?: string;
}

/** Gabarit commun (texte + HTML), aux couleurs de Kwatt. */
function render(locale: Locale, subject: string, c: Content): { subject: string; text: string; html: string } {
  const signature = t(locale, 'email.signature');
  const footer = t(locale, 'email.footer');
  const text = [c.title, '', ...c.paragraphs.flatMap((p) => [p, '']), ...(c.code ? [c.code, ''] : []), signature, '', footer]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  const p = (s: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:${night.text}">${escapeHtml(s)}</p>`;
  const code = c.code
    ? `<div style="margin:8px 0 18px;padding:14px 0;text-align:center;font-family:'Unbounded',Arial,sans-serif;font-size:32px;font-weight:700;letter-spacing:10px;color:${night.onAction};background:${night.action};border-radius:14px">${escapeHtml(c.code)}</div>`
    : '';
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:${night.bg};font-family:'DM Sans',Arial,sans-serif">
<div style="max-width:480px;margin:0 auto;background:${night.surface};border:1px solid ${night.border};border-radius:18px;overflow:hidden">
<div style="height:10px;background:${night.surfaceStrong}"></div>
<div style="padding:22px 22px 8px">
<div style="font-family:'Unbounded',Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:2px;color:${night.textMuted};margin-bottom:10px">KWATT</div>
<h1 style="margin:0 0 16px;font-family:'Unbounded',Arial,sans-serif;font-size:20px;color:${night.text}">${escapeHtml(c.title)}</h1>
${c.paragraphs.map(p).join('\n')}
${code}
${p(signature)}
</div>
<div style="padding:12px 22px 18px;border-top:1px solid ${night.border};font-size:12px;line-height:1.5;color:${night.textMuted}">${escapeHtml(footer)}</div>
</div></body></html>`;
  return { subject, text, html };
}

export class Mailer {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly transport: MailTransport,
    private readonly log: Logger,
  ) {}

  /** Envoie sans faire attendre la requête ; une erreur d'envoi est journalisée. */
  private queue(message: MailMessage): void {
    const p = this.transport
      .send(message)
      .catch((err: unknown) => this.log.error({ err, to: message.to }, 'envoi d\'e-mail en échec'))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Attend la fin des envois en cours (tests, arrêt du serveur). */
  async idle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  sendVerificationCode(to: string, locale: Locale, code: string, pseudo: string): void {
    this.queue({
      to,
      ...render(locale, t(locale, 'email.verify.subject', { code }), {
        title: t(locale, 'email.verify.title'),
        paragraphs: [t(locale, 'email.verify.intro', { pseudo }), t(locale, 'email.verify.expires')],
        code,
      }),
    });
  }

  sendResetCode(to: string, locale: Locale, code: string): void {
    this.queue({
      to,
      ...render(locale, t(locale, 'email.reset.subject', { code }), {
        title: t(locale, 'email.reset.title'),
        paragraphs: [t(locale, 'email.reset.intro'), t(locale, 'email.reset.expires'), t(locale, 'email.ignore')],
        code,
      }),
    });
  }

  sendPasswordChanged(to: string, locale: Locale, pseudo: string): void {
    this.queue({
      to,
      ...render(locale, t(locale, 'email.password_changed.subject'), {
        title: t(locale, 'email.password_changed.title'),
        paragraphs: [t(locale, 'email.password_changed.intro', { pseudo }), t(locale, 'email.password_changed.help')],
      }),
    });
  }

  sendDeletionScheduled(to: string, locale: Locale, pseudo: string, eraseOn: Date): void {
    this.queue({
      to,
      ...render(locale, t(locale, 'email.deletion.subject'), {
        title: t(locale, 'email.deletion.title'),
        paragraphs: [
          t(locale, 'email.deletion.intro', { pseudo, date: formatDate(locale, eraseOn) }),
          t(locale, 'email.deletion.cancel'),
        ],
      }),
    });
  }
}
