// Draws the QR code on the printable flyer. Uses qrcode.js.
// The link is the folder the flyer was opened from, so a copy hosted anywhere points at itself.
// A file on disk has no public address, and example.org / example.com / example.net are placeholders,
// so those use the published app. A printed flyer never gets a QR code for either.
(function (root) {
  const PUBLISHED = 'https://frankoo6.github.io/medicine-shelf/';

  function placeholderHost(hostname) {
    const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
    return host === 'example.org' || host === 'example.com' || host === 'example.net'
      || host.endsWith('.example.org') || host.endsWith('.example.com') || host.endsWith('.example.net');
  }

  // Usable on paper only as an absolute http(s) URL whose host is not a placeholder.
  function usableFlyerLink(url) {
    try {
      const u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !placeholderHost(u.hostname);
    } catch (e) {
      return false;
    }
  }

  // pageHref is the flyer page (location.href). typed is the link box; blank uses the page's own folder.
  function flyerQrUrl(pageHref, typed) {
    const custom = typeof typed === 'string' ? typed.trim() : '';
    if (custom && usableFlyerLink(custom)) return custom;
    try {
      const folder = new URL('./', pageHref).href;
      if (usableFlyerLink(folder)) return folder;
    } catch (e) { /* the page address can't be resolved */ }
    return PUBLISHED;
  }

  const api = { PUBLISHED, flyerQrUrl };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Flyer = api;
  if (typeof document === 'undefined' || !document.getElementById) return;

  const input = document.getElementById('url');
  if (!input) return;
  input.value = flyerQrUrl(location.href, '');
  function draw() {
    const url = flyerQrUrl(location.href, input.value);
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    document.getElementById('qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    document.getElementById('urlText').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  input.addEventListener('input', draw);
  document.getElementById('print').addEventListener('click', () => window.print());
  draw();
})(typeof window !== 'undefined' ? window : globalThis);
