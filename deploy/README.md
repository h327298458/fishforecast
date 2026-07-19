# Ubuntu production deployment

This deployment is separate from the legacy root Compose files so an existing
server with local Docker changes can pull repository updates without those files
being overwritten.

The image installs the validated `eo-tides==0.10.4` Python runtime. EOT20 model
data is not copied into the image or Git; it is mounted read-only at `/models`.
The image keeps the real `eo-tides.model` and `pyTMD` calculation stack, but
does not install unrelated satellite STAC, Dask-distributed, Arrow, plotting or
machine-learning extras. This is important on small disks: none of those
packages are used by TideLine's single-coordinate tide worker.
The mounted host directory must contain:

```text
EOT20/ocean_tides/*_ocean_eot20.nc
```

Create `.env.server` (do not commit it):

```text
PUBLIC_PORT=8000
EOT20_MODEL_PATH=/home/azureuser/fishforecast/data/tide-models
EOT20_MODEL_VERSION=EOT20-85762
COOKIE_SECURE=false
ALLOWED_ORIGIN=http://20.11.32.12:8000
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=replace-with-a-unique-long-password
```

Use `COOKIE_SECURE=false` only while the site is plain HTTP. Set it to `true`
after putting the service behind HTTPS.

Build and start on a 2-core/1-GB host:

```bash
docker compose --env-file .env.server \
  -f deploy/compose.server.yml \
  -f deploy/compose.low-memory.yml \
  build
docker compose --env-file .env.server \
  -f deploy/compose.server.yml \
  -f deploy/compose.low-memory.yml \
  up -d
```

If a previous build failed with `no space left on device`, clean only unused
Docker build/image data first. Do not prune volumes because the named volume
contains SQLite data:

```bash
docker builder prune -af
docker image prune -af
df -h / /var/lib/docker
docker system df
```

Verify the runtime without starting a forecast:

```bash
docker compose --env-file .env.server -f deploy/compose.server.yml exec app \
  sh -lc '$EOT20_PYTHON -c "from eo_tides.model import model_tides; print(\"eo-tides OK\")"'
curl -fsS http://127.0.0.1:8000/api/system-status
```

The first uncached EOT20 request can be CPU and memory intensive. Official-port
forecasts do not launch Python; EOT20 is calculated only when selected or when
the comparison endpoint is explicitly requested.

For later updates, keep local server overrides in `.env.server` and use only the
tracked `deploy/` files. Then a normal update is conflict-free:

```bash
git pull --ff-only origin master
docker compose --env-file .env.server \
  -f deploy/compose.server.yml \
  -f deploy/compose.low-memory.yml \
  up -d --build
```

Do not edit the tracked root `docker-compose.yml` for server paths. Existing
root-file edits can be backed up once and restored with `git restore` before the
first pull; `.env.server` is ignored and remains local.
