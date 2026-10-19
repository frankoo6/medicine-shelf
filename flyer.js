// Draws the QR code on the printable flyer. Uses qrcode.js.
(() => {
  const input = document.getElementById('url');
  const here = new URL('./', location.href);
  input.value = location.protocol === 'file:' ? 'https://example.org/medicine-shelf/' : here.href;
  function draw() {
    const url = input.value.trim() || here.href;
    const qr = qrcode(0, 'M'); qr.addData(url); qr.make();
    document.getElementById('qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true });
    document.getElementById('urlText').textContent = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  input.addEventListener('input', draw);
  document.getElementById('print').addEventListener('click', () => window.print());
  draw();
})();
