# htl.ing mailing list / newsgroup server

A small self-contained server that runs the mailing list **`ing@htl.ing`**.
It provides two ways to join:

- **By e-mail:** send a message (any subject) to **`anmeldung@htl.ing`**
  ("Anmeldung" is German for "sign-up").
- **By web:** submit the signup form on [htl.ing](https://htl.ing/) (or on
  this server's own `/` page), which calls `POST /api/subscribe`.

Both paths use **double opt-in**: a confirmation e-mail with a unique link
is sent before the address is actually added, so nobody can subscribe an
address they don't control. Once confirmed, any message the subscriber
sends to `ing@htl.ing` is relayed to every other confirmed subscriber —
i.e. it behaves like a classic mailing list / newsgroup.

Unsubscribing: send a message (any subject) to **`abmeldung@htl.ing`**
("Abmeldung" is German for "sign-out"), or click the one-click unsubscribe
link included in the footer of every relayed message.

## Why this isn't part of the static site

`htl.ing` itself is a static site deployed to GitHub Pages (see the repo
root), which cannot receive e-mail or run server-side code. This directory
is a **separate Node.js service** that you deploy on a real host (VPS,
etc.) with its own DNS records. The static site only needs a small form
that calls this service's HTTP API (see "Wiring into the website" below).

## What it does

- Runs its own inbound SMTP server (`smtp-server`) that becomes (one of)
  the MX hosts for `htl.ing`, accepting mail only for `ing@htl.ing`,
  `anmeldung@htl.ing`, `abmeldung@htl.ing` and `postmaster@htl.ing`;
  everything else gets a `550`.
- Any mail to `anmeldung@htl.ing` is treated as a subscribe request and
  any mail to `abmeldung@htl.ing` as an unsubscribe request, regardless
  of subject. Mail to `ing@htl.ing` from a confirmed subscriber is
  relayed to the whole list; from anyone else it gets a "how to join"
  reply.
- Serves a small Express HTTP API for web signup, confirmation and
  unsubscribe links.
- Sends all outgoing mail (confirmations, relayed posts) through a
  configurable outbound SMTP relay, optionally DKIM-signed
  (`nodemailer`).
- Stores subscribers in a JSON file under `data/` (no database needed for
  a list of this size).

## Requirements

- Node.js 18+
- A host you control, with a public IP, where you can bind port 25 (or
  forward it)
- A domain/subdomain for the web API, e.g. `list.htl.ing`
- An outbound mail relay (a local Postfix, or a transactional provider
  like a shared SMTP relay) — the built-in SMTP server is for *receiving*
  mail, it deliberately doesn't try to be a general-purpose outbound MTA

## Setup

```bash
cd mailing-list
npm install
cp .env.example .env
# edit .env — see "Configuration" below
```

Run it directly for testing:

```bash
npm start
```

By default this binds SMTP on `0.0.0.0:25` and the HTTP API on
`127.0.0.1:3000`. Binding port 25 requires root or `CAP_NET_BIND_SERVICE`
(see the systemd unit below, which grants the capability to an
unprivileged user).

### Configuration (`.env`)

See `.env.example` for the full list. The important ones:

| Variable | Purpose |
|---|---|
| `LIST_ADDRESS` | The list's address, `ing@htl.ing` |
| `PUBLIC_BASE_URL` | Public URL of this service, used in confirm/unsubscribe links, e.g. `https://list.htl.ing` |
| `SMTP_PORT` | Inbound SMTP port, normally `25` |
| `HTTP_HOST` / `HTTP_PORT` | Where the web API listens (put a reverse proxy with TLS in front of it) |
| `CORS_ORIGINS` | Origins allowed to call `/api/subscribe` from the browser, e.g. `https://htl.ing` |
| `OUTBOUND_SMTP_*` | Relay used to send confirmation/list mail |
| `DKIM_*` | Optional DKIM signing of outbound mail (recommended) |

### DNS

1. **MX record** for `htl.ing` pointing at this server's hostname, e.g.

   ```
   htl.ing.        MX  10 mail.htl.ing.
   mail.htl.ing.   A   <server IP>
   ```

2. **Subdomain for the web API**, e.g. `list.htl.ing` → this server's IP,
   reverse-proxied with TLS (see below). It can be the same host as MX.

3. **SPF** (authorize this host to send as `htl.ing`):

   ```
   htl.ing.  TXT  "v=spf1 mx ~all"
   ```

4. **DKIM** (recommended, needed for reliable inbox delivery): generate a
   keypair, publish the public key, and set `DKIM_*` in `.env`:

   ```bash
   openssl genrsa -out dkim-private.pem 2048
   openssl rsa -in dkim-private.pem -pubout -out dkim-public.pem
   ```

   Publish `dkim-public.pem`'s contents as a TXT record at
   `list._domainkey.htl.ing` (selector `list`, matching `DKIM_SELECTOR`).

5. **DMARC**:

   ```
   _dmarc.htl.ing.  TXT  "v=DMARC1; p=quarantine; rua=mailto:postmaster@htl.ing"
   ```

### Reverse proxy + TLS for the web API

Put nginx (or similar) in front of the HTTP API and terminate TLS with
Let's Encrypt, e.g.:

```nginx
server {
    server_name list.htl.ing;
    listen 443 ssl;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo certbot --nginx -d list.htl.ing
```

### Running as a service

```bash
sudo useradd --system --home /opt/htl-mailinglist --shell /usr/sbin/nologin htl-mailinglist
sudo mkdir -p /opt/htl-mailinglist
sudo cp -r mailing-list/* /opt/htl-mailinglist/
sudo cp mailing-list/.env /opt/htl-mailinglist/.env   # filled in
cd /opt/htl-mailinglist && sudo npm install --omit=dev
sudo chown -R htl-mailinglist:htl-mailinglist /opt/htl-mailinglist
sudo cp systemd/htl-mailinglist.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now htl-mailinglist
```

Check logs: `journalctl -u htl-mailinglist -f`

## Wiring into the website (already done)

The signup form embedded in the main site (`index.html` at the repo root)
posts to:

```
<PUBLIC_BASE_URL>/api/subscribe
```

It reads the API base URL from `window.HTLING_LIST_API`, which defaults
to `https://list.htl.ing`. Update that constant near the bottom of the
form's script if you deploy the API under a different hostname, and make
sure `CORS_ORIGINS` in `.env` includes `https://htl.ing`.

## Testing locally

You can exercise the SMTP side without touching real DNS using `swaks` or
`curl`-based test tools, or simply:

```bash
# terminal 1
npm start

# terminal 2 — send a test "Anmeldung" mail to the local server
printf 'MAIL FROM:<test@example.com>\r\nRCPT TO:<ing@htl.ing>\r\nDATA\r\nSubject: Anmeldung\r\n\r\nHallo!\r\n.\r\nQUIT\r\n' \
  | nc 127.0.0.1 25
```

(For real inbound testing you need `OUTBOUND_SMTP_*` pointed at a working
relay so confirmation mail actually gets delivered.)

## Limitations / notes

- Storage is a flat JSON file — fine for a list with up to a few thousand
  subscribers, not meant to scale further.
- The rate limiter on `/api/subscribe` is in-memory and resets on
  restart; if abuse becomes a problem, put a proper rate limiter (e.g. at
  the reverse-proxy level) in front.
- Relayed posts are sent one-by-one per subscriber (small batches run
  concurrently) so each recipient gets a personalised unsubscribe link.
  For a very large list this would need queuing; not necessary at this
  list's scale.
