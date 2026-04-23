export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*',
        }
      });
    }

    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) return new Response('Missing url param', { status: 400 });

    try {
      const resp = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': new URL(targetUrl).origin + '/',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      const contentType = resp.headers.get('content-type') || 'text/html';

      if (contentType.includes('text/html')) {
        let html = await resp.text();
        const baseOrigin = new URL(targetUrl).origin;

        // ── Strip known ad network script tags ──
        const adDomains = [
          'popads','popcash','propellerads','exoclick','trafficjunky',
          'juicyads','hilltopads','adsterra','adcash','revcontent',
          'taboola','outbrain','mgid','adnxs','doubleclick',
          'googlesyndication','adservice','adtraff','clickadu',
          'monetag','richpush','pushground','evadav','runative',
          'zeropark','trafmag','adtelligent','admaven','adskeeper',
        ];
        adDomains.forEach(domain => {
          const re = new RegExp(`<script[^>]*src=["'][^"']*${domain}[^"']*["'][^>]*>\\s*<\\/script>`, 'gi');
          html = html.replace(re, '');
        });

        // ── Strip inline ad/popup/redirect scripts ──
        html = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (match, code) => {
          const adKeywords = [
            'popunder','pop-under','clickunder','openNewTab',
            'window.open','top.location','parent.location',
            'document.location.replace','self.location',
            'adsbygoogle','push_tag','monetag','propeller',
            'adSterra','clickadu','richpush',
          ];
          if (adKeywords.some(k => code.toLowerCase().includes(k.toLowerCase()))) {
            return '<!-- ad removed -->';
          }
          return match;
        });

        // ── Rewrite relative URLs to absolute ──
        html = html.replace(/(href|src)="(\/[^"]*?)"/gi, `$1="${baseOrigin}$2"`);
        html = html.replace(/(href|src)='(\/[^']*?)'/gi, `$1='${baseOrigin}$2'`);

        // ── Inject anti-popup + anti-redirect shield ──
        const shield = `<script>
(function() {
  // Block all window.open popups
  var _open = window.open;
  window.open = function(url, name, specs) {
    if (!url || url === '' || url === 'about:blank') return null;
    // Only allow if it's a same-origin video/player URL
    try {
      var u = new URL(url, location.href);
      if (u.hostname === location.hostname) return _open(url, name, specs);
    } catch(e) {}
    return null;
  };
  // Block top-level redirects
  Object.defineProperty(window, 'top', { get: function(){ return window; }, configurable: true });
  Object.defineProperty(window, 'parent', { get: function(){ return window; }, configurable: true });
  // Kill beforeunload redirects
  window.addEventListener('beforeunload', function(e) { e.stopImmediatePropagation(); }, true);
  // Remove target=_blank ad links
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[target="_blank"]').forEach(function(a) {
      var href = a.getAttribute('href') || '';
      if (!href.includes('video') && !href.includes('player') && !href.includes('stream')) {
        a.removeAttribute('target');
        a.removeAttribute('href');
      }
    });
    // Hide common ad containers
    var adSelectors = [
      '[class*="ad-"]','[class*="-ad"]','[id*="ad-"]',
      '[class*="popup"]','[class*="overlay"]','[id*="popup"]',
      'ins.adsbygoogle','[data-ad]',
    ];
    adSelectors.forEach(function(sel) {
      try {
        document.querySelectorAll(sel).forEach(function(el) {
          if (!el.querySelector('video') && !el.querySelector('iframe')) {
            el.style.display = 'none';
          }
        });
      } catch(e) {}
    });
  });
  // MutationObserver to kill ads added dynamically
  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(node) {
        if (node.nodeType === 1) {
          var tag = (node.tagName || '').toLowerCase();
          if (tag === 'script') {
            var src = node.src || node.getAttribute('src') || '';
            var content = node.textContent || '';
            var blocked = ['popads','popunder','propeller','adsterra','exoclick','monetag'];
            if (blocked.some(function(b){ return src.includes(b) || content.includes(b); })) {
              node.remove();
            }
          }
          // Remove popup divs
          if (['div','section','aside'].includes(tag)) {
            var cls = (node.className || '') + (node.id || '');
            if (/popup|overlay|modal|advert|banner-ad/i.test(cls)) {
              if (!node.querySelector('video')) node.remove();
            }
          }
        }
      });
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`;

        // Inject shield right after <head> or at start
        if (html.includes('<head>')) {
          html = html.replace('<head>', '<head>' + shield);
        } else {
          html = shield + html;
        }

        return new Response(html, {
          status: resp.status,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'X-Frame-Options': 'ALLOWALL',
            'Content-Security-Policy': "frame-ancestors *",
            'Cache-Control': 'no-store',
          }
        });

      } else {
        // Proxy JS/CSS/fonts as-is
        const body = await resp.arrayBuffer();
        return new Response(body, {
          status: resp.status,
          headers: {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
          }
        });
      }

    } catch (e) {
      return new Response('Proxy error: ' + e.message, { status: 500 });
    }
  }
};
