# Static-host security headers

Wind Tunnel is a static client-side application. Its content-security policy deliberately blocks runtime network connections: the product has no telemetry, third-party embeds, remote font loading, API calls, or server endpoints.

`vercel.json` applies these headers on Vercel. Any alternate static host should apply the equivalent response headers to every route and static asset:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()
```

The `script-src` and `style-src` inline allowances exist for the framework's static bootstrap and generated styles. They do not permit a remote origin. Changes to this policy require reviewing both the static privacy scan and the Playwright request allowlist.
