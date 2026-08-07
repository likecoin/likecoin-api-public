/* eslint-disable no-underscore-dangle */
import type { Response } from 'express';
import { getBook3URL } from '../../liker-land';

export type EmailVerifyPageStatus = 'success' | 'failed' | 'error';

const BRAND_COLOR = '#28646E';

/**
 * Self-contained result page for the emailed one-click verification link.
 * No external assets: mail clients open this in a bare browser tab.
 */
export function renderEmailVerifyPage(res: Response, status: EmailVerifyPageStatus): string {
  const isSuccess = status === 'success';
  const title = res.__(`EmailVerifyPage.${status}.title`);
  const body = res.__(`EmailVerifyPage.${status}.body`);
  const cta = res.__(`EmailVerifyPage.${status}.cta`);
  const locale = res.getLocale();
  const ctaHref = getBook3URL('', { language: locale });
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<!-- The URL holds a live verification token; keep it out of 3ook.com's logs. -->
<meta name="referrer" content="no-referrer">
<title>${title}</title>
<style>
:root { color-scheme: light dark; }
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7f7f5;
  color: #1a1a1a;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  line-height: 1.6;
}
main { max-width: 24rem; padding: 2rem; text-align: center; }
.mark {
  width: 3.5rem;
  height: 3.5rem;
  margin: 0 auto 1.5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.75rem;
  color: #fff;
  background: ${isSuccess ? BRAND_COLOR : '#9b9b9b'};
}
h1 { font-size: 1.375rem; margin: 0 0 0.5rem; }
p { margin: 0 0 2rem; color: #4a4a4a; }
a.cta {
  display: inline-block;
  padding: 0.75rem 1.75rem;
  border-radius: 0.375rem;
  background: ${BRAND_COLOR};
  color: #fff;
  text-decoration: none;
  font-weight: 600;
}
@media (prefers-color-scheme: dark) {
  body { background: #16181a; color: #f2f2f2; }
  p { color: #b8b8b8; }
}
</style>
</head>
<body>
<main>
<div class="mark" aria-hidden="true">${isSuccess ? '&#10003;' : '&#33;'}</div>
<h1>${title}</h1>
<p>${body}</p>
<a class="cta" href="${ctaHref}">${cta}</a>
</main>
</body>
</html>`;
}
