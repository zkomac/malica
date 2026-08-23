# Extra Caddy sites

Any `*.caddy` file in this directory is imported by the main `Caddyfile`, so one Caddy instance can serve other sites on the same server (for example a static company site next to Malica). The files are host-specific and ignored by git; if a site needs extra volumes (a web root), add them in `docker-compose.override.yml` (also ignored).

Example `caddy-sites/example.caddy`:

```
example.com {
    root * /srv/example
    encode gzip
    file_server
}
```
