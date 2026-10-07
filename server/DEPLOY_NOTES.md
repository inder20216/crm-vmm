# VMM backend — temporary live deployment

**Status: temporary, for testing only, ~1 week window** (started 2026-10-07). This is not the
permanent production setup — do not build further infrastructure on top of it without confirming
it's still intended to be temporary.

## Where it's running
A fresh EC2 instance (`43.204.141.221`), launched for PSRI's temp backend and **shared with it** —
this box runs both apps side by side, each on its own nginx path:

- PSRI: `https://43.204.141.221.nip.io/psri-api/*`
- VMM:  `https://43.204.141.221.nip.io/vmm-api/*`

`43.204.141.221.nip.io` is a free wildcard-DNS trick (nip.io resolves `<ip>.nip.io` straight to that
IP) — it exists purely so Let's Encrypt can issue a real HTTPS cert without needing an owned domain.
No custom domain was bought or configured for this.

## Server layout
```
/var/www/vmm/webhook/index.php              # this repo's server/webhook/index.php, copied over
/var/www/vmm/common/constraints/dbconfig.php # this repo's dbconfig.php, copied over (gitignored, not in git)
```
nginx routes `/vmm-api/` to `/var/www/vmm/webhook/index.php` via php-fpm (config at
`/etc/nginx/conf.d/psri-temp.conf` on the server, alongside PSRI's own location block in the same
file). `.htaccess` was copied too but nginx ignores it — it's a no-op here, kept only so the folder
matches what cPanel/Apache hosting would expect if this ever moves there.

## What points at it
- `.env.production` → `VITE_PHP_BASE=https://43.204.141.221.nip.io/vmm-api`
- Deployed frontend: `https://inder20216.github.io/crm-vmm/` (via `npm run deploy`, i.e. `gh-pages -d dist`)
- Azure AD redirect URI `https://inder20216.github.io/crm-vmm/` added to the shared app registration
  (Client ID `23cc525a-0ef9-420f-b82d-b5be71d2caa1`, same one PSRI uses)

## When this goes away
The EC2 instance is meant to be terminated after the test window. If this deployment needs to
become permanent, the real target is `vmm.openmindservices.in` (same server family as the PSRI
production plan — Ubuntu/Apache at `45.114.142.171`, DNS already points there) — **not** this temp
box. At that point: re-point `.env.production`'s `VITE_PHP_BASE` at the real domain, redeploy, and
this temp instance + its nip.io address can be forgotten entirely.

## Security note (fixed 2026-10-07)
`server/webhook/index.php` used to hardcode a client API key (`VMM-VISHAL-2026`) in plain,
committed source — already-public exposure once this repo went public. It was rotated and moved
into `dbconfig.php` as `VISHAL_API_KEY` (gitignored); the old value is dead. The new key was sent to
the client (Vishal Wholesale) out-of-band, not committed anywhere.
