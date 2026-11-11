const safeHost = /^(?:[a-z\d.-]+|\[[a-f\d:]+\])(?::\d{1,5})?$/i;

export function socialOrigin(headers = {}, configuredUrl = '', encrypted = false) {
  if (configuredUrl) {
    const configured = new URL(configuredUrl);
    if (!['https:', 'http:'].includes(configured.protocol) || configured.username || configured.password) {
      throw new TypeError('OPENTV_PUBLIC_URL debe ser una dirección HTTP(S) pública válida.');
    }
    return configured.origin;
  }

  const host = String(headers.host || 'localhost').trim();
  const safeDomain = safeHost.test(host) ? host : 'localhost';
  const forwarded = String(headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : encrypted ? 'https' : 'http';
  return new URL(`${protocol}://${safeDomain}`).origin;
}

export function renderSocialHtml(template, headers = {}, configuredUrl = '', encrypted = false) {
  const origin = socialOrigin(headers, configuredUrl, encrypted);
  return template
    .replaceAll('__OPENTV_PAGE_URL__', `${origin}/`)
    .replaceAll('__OPENTV_IMAGE_URL__', `${origin}/social-preview.png`);
}
