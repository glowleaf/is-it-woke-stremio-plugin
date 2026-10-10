// Woke Score - Stremio addon. Route: greekai.gr/woke/*
// Passes every request under /woke/ straight through to the addon on the home server, so the
// addon can be installed from a greekai.gr URL. Nothing else on the domain is touched.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = "https://relay.loveisbitcoin.com" + url.pathname + url.search;
    const upstream = await fetch(target, {
      method: request.method,
      headers: { "user-agent": "woke-score-greekai-worker", accept: request.headers.get("accept") || "*/*" },
    });
    const headers = new Headers(upstream.headers);
    headers.set("access-control-allow-origin", "*");
    headers.set("access-control-allow-headers", "*");
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  },
};
