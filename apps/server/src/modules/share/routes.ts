/**
 * Liens de partage web (SPEC §10, salons) :
 *   GET /s/:code  → salon : ouvre kwatt://salon/CODE
 *   GET /l/:code  → ligue : ouvre kwatt://ligue/CODE
 * Petite page HTML aux couleurs de Kwatt (thème Nuit de @kwatt/design, tissu ndop dessiné
 * en CSS), dans la langue du navigateur (?lang=fr|en pour changer), qui explique comment
 * installer l'appli. Aucun script : un bouton ouvre l'appli.
 */
import { fabrics, night } from '@kwatt/design';
import type { Locale } from '@kwatt/protocol';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { escapeHtml, localeFromAcceptLanguage, t } from '../../i18n/index.js';

/** Codes de salon : 6 caractères sans 0/O/1/I, affichés « ABC-DEF ». */
export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
/** Codes de ligue : mêmes caractères, 6 à 10 (fixés par le module Ligues). */
export const LEAGUE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6,10}$/;

type Kind = 'room' | 'league';

export function normalizeShareCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}

export function formatShareCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code;
}

const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

interface PageInput {
  locale: Locale;
  kind: Kind;
  code: string | null;
  deepLink: string | null;
  installUrl: string | null;
  otherLangHref: string;
}

function page(p: PageInput): string {
  const tr = (key: string, params: Record<string, string> = {}) => t(p.locale, key, params, { html: true });
  const c = night;
  const m = fabrics.ndop.motif;
  const title = p.code ? tr(`share.${p.kind}.title`) : tr('share.invalid.title');
  const shown = p.code ? escapeHtml(formatShareCode(p.code)) : '';
  const body = p.code
    ? `<p class="k">${tr(`share.${p.kind}.code_label`)}</p>
<p class="code">${shown}</p>
<h1>${tr(`share.${p.kind}.heading`)}</h1>
<a class="cta" href="${escapeHtml(p.deepLink ?? '#')}">${tr('share.open')}</a>
<div class="card">
<h2>${tr('share.install_title')}</h2>
<ol>
<li>${tr('share.install_step1')} ${p.installUrl ? `<a href="${escapeHtml(p.installUrl)}" rel="noopener">${tr('share.install_link')}</a>` : tr('share.install_ask')}</li>
<li>${tr(`share.${p.kind}.install_step2`, { code: formatShareCode(p.code) })}</li>
</ol>
</div>`
    : `<h1>${tr('share.invalid.title')}</h1><p>${tr('share.invalid.body')}</p>`;

  return `<!doctype html>
<html lang="${p.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="${c.bg}">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Unbounded:wght@700;800&display=swap">
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:${c.bg};color:${c.text};font:16px/1.5 'DM Sans',system-ui,sans-serif}
.ndop{height:56px;background-color:${fabrics.ndop.base};background-image:linear-gradient(135deg,${m} 25%,transparent 25%),linear-gradient(225deg,${m} 25%,transparent 25%),linear-gradient(315deg,${m} 25%,transparent 25%),linear-gradient(45deg,${m} 25%,transparent 25%);background-size:16px 16px;background-position:-8px 0,-8px 0,0 0,0 0}
main{max-width:440px;margin:0 auto;padding:24px 16px 40px}
.brand{font-family:'Unbounded',system-ui,sans-serif;font-weight:800;font-size:28px;letter-spacing:.04em;margin:0}
.tag{color:${c.textMuted};margin:4px 0 28px}
.k{margin:0;font-size:12px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${c.textMuted}}
.code{font-family:'Unbounded',system-ui,sans-serif;font-size:40px;font-weight:800;letter-spacing:.08em;margin:4px 0 8px}
h1{font-family:'Unbounded',system-ui,sans-serif;font-size:20px;margin:0 0 20px}
h2{font-family:'Unbounded',system-ui,sans-serif;font-size:16px;margin:0 0 10px}
.cta{display:flex;align-items:center;justify-content:center;min-height:56px;border-radius:14px;background:${c.action};color:${c.onAction};font-weight:700;text-decoration:none;font-size:16px;margin-bottom:24px}
.card{background:${c.surface};border:1px solid ${c.border};border-radius:16px;padding:16px 18px}
ol{margin:0;padding-left:20px}li{margin:6px 0}
a{color:${c.actionText}}
.lang{display:inline-flex;align-items:center;min-height:48px;margin-top:20px;color:${c.textMuted}}
</style>
</head>
<body>
<div class="ndop" aria-hidden="true"></div>
<main>
<p class="brand">KWATT</p>
<p class="tag">${tr('share.tagline')}</p>
${body}
<a class="lang" href="${escapeHtml(p.otherLangHref)}">${tr('share.other_language')}</a>
</main>
</body>
</html>`;
}

const shareRoutes: FastifyPluginAsync = async (app) => {
  const scheme = app.config.appScheme;

  async function render(kind: Kind, req: FastifyRequest<{ Params: { code: string }; Querystring: { lang?: string } }>, reply: FastifyReply) {
    const q = req.query.lang;
    const locale: Locale = q === 'en' || q === 'fr' ? q : localeFromAcceptLanguage(req.headers['accept-language']);
    const code = normalizeShareCode(req.params.code);
    const valid = (kind === 'room' ? ROOM_CODE_PATTERN : LEAGUE_CODE_PATTERN).test(code);
    const path = kind === 'room' ? 'salon' : 'ligue';
    const html = page({
      locale,
      kind,
      code: valid ? code : null,
      deepLink: valid ? `${scheme}://${path}/${code}` : null,
      installUrl: app.config.appInstallUrl,
      otherLangHref: `?lang=${locale === 'fr' ? 'en' : 'fr'}`,
    });
    return reply
      .status(valid ? 200 : 404)
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', CSP)
      .header('cache-control', 'public, max-age=300')
      .send(html);
  }

  app.get<{ Params: { code: string }; Querystring: { lang?: string } }>('/s/:code', (req, reply) => render('room', req, reply));
  app.get<{ Params: { code: string }; Querystring: { lang?: string } }>('/l/:code', (req, reply) => render('league', req, reply));
};

export default shareRoutes;
