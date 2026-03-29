# RouteAI Air-Gapped Deployment

This directory contains the Docker Compose configuration for running RouteAI in
a fully air-gapped (offline) environment. All services are self-contained and no
external network access is required once the initial setup is complete.

## Architecture

The air-gapped stack includes:

| Service        | Port  | Purpose                                |
|----------------|-------|----------------------------------------|
| PostgreSQL     | 5432  | Primary database with pgvector         |
| Redis          | 6379  | Caching and rate limiting              |
| MinIO          | 9000  | Object storage for project files       |
| Ollama         | 11434 | Local LLM inference (mistral/llama)    |
| API            | 8080  | Go API gateway                         |
| Intelligence   | 8081  | Python intelligence service            |
| Parser         | 8082  | File parsing service                   |
| Web            | 3000  | Frontend application                   |

## Prerequisites

- Docker Engine 24+ with Compose V2
- At least 16 GB RAM (32 GB recommended for larger models)
- At least 30 GB free disk space (models require ~10-15 GB)
- NVIDIA GPU with CUDA drivers (optional, strongly recommended for LLM inference)

## Setup on a Connected Machine

Run these steps on a machine with internet access to prepare the deployment
artifacts.

### 1. Pull all container images

```bash
docker compose -f docker-compose.airgap.yml pull
```

### 2. Save images to a tar archive

```bash
docker save \
  postgis/postgis:16-3.4 \
  redis:7-alpine \
  minio/minio:latest \
  ollama/ollama:latest \
  curlimages/curl:latest \
  routeai/api:latest \
  routeai/intelligence:latest \
  routeai/parser:latest \
  routeai/web:latest \
  | gzip > routeai-airgap-images.tar.gz
```

### 3. Download LLM model weights

```bash
# Start Ollama temporarily to pull models.
docker run -d --name ollama-prep -v ollama_prep:/root/.ollama ollama/ollama:latest

# Wait for it to start.
sleep 5

# Pull models.
docker exec ollama-prep ollama pull mistral
docker exec ollama-prep ollama pull llama3.1
docker exec ollama-prep ollama pull nomic-embed-text

# Export the models volume.
docker run --rm -v ollama_prep:/data -v $(pwd):/backup alpine \
  tar czf /backup/ollama-models.tar.gz -C /data .

# Clean up.
docker stop ollama-prep && docker rm ollama-prep
docker volume rm ollama_prep
```

### 4. Transfer files to the air-gapped host

Copy these files to the target machine:
- `routeai-airgap-images.tar.gz` (container images)
- `ollama-models.tar.gz` (LLM model weights)
- This entire `air-gapped/` directory

## Setup on the Air-Gapped Host

### 1. Load container images

```bash
docker load < routeai-airgap-images.tar.gz
```

### 2. Restore LLM model weights

```bash
# Create the Ollama data volume and populate it.
docker volume create routeai-airgap_ollama_data
docker run --rm \
  -v routeai-airgap_ollama_data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/ollama-models.tar.gz -C /data
```

### 3. Configure secrets

Edit `docker-compose.airgap.yml` and replace the default passwords:
- `POSTGRES_PASSWORD` / `DB_PASSWORD`: change from `routeai_airgap`
- `MINIO_ROOT_PASSWORD` / `MINIO_SECRET_KEY`: change from `routeai_airgap`
- `JWT_SECRET`: set a strong random string

### 4. Start the stack

```bash
docker compose -f docker-compose.airgap.yml up -d
```

### 5. Verify all services

```bash
# Check that all containers are running.
docker compose -f docker-compose.airgap.yml ps

# Verify the API is healthy.
curl http://localhost:8080/health

# Verify Ollama has the models loaded.
curl http://localhost:11434/api/tags
```

Expected output from `/api/tags` should list `mistral`, `llama3.1`, and
`nomic-embed-text`.

### 6. Seed the RAG database (optional)

If you want the knowledge base pre-populated with IPC standards and component
data, run the seed script:

```bash
docker exec routeai-ag-intelligence python -m scripts.seed_rag
```

## Verifying Network Isolation

To confirm no outbound connections are made:

```bash
# Set the network to internal mode (edit docker-compose.airgap.yml).
# Under networks.routeai-internal, change: internal: true

# Restart the stack.
docker compose -f docker-compose.airgap.yml down
docker compose -f docker-compose.airgap.yml up -d

# Monitor for any outbound connection attempts.
docker exec routeai-ag-api ping -c1 8.8.8.8  # Should fail.
```

## Choosing a Model

The default model is `mistral` (7B parameters). For different trade-offs:

| Model           | Size | RAM   | Quality | Speed   |
|-----------------|------|-------|---------|---------|
| mistral (7B)    | 4 GB | 8 GB  | Good    | Fast    |
| llama3.1 (8B)   | 5 GB | 10 GB | Better  | Fast    |
| mixtral (8x7B)  | 26GB | 48 GB | Best    | Slower  |

To switch models, change `OLLAMA_MODEL` in the intelligence service environment.

## Updating Models Offline

To update models on the air-gapped host:

1. On a connected machine, pull the new model version with Ollama.
2. Export the updated volume as a tar archive.
3. Transfer the archive and restore it on the air-gapped host.
4. Restart the Ollama container.

## Troubleshooting

**Ollama fails to start**: Check GPU drivers with `nvidia-smi`. If no GPU is
available, remove the `deploy.resources.reservations` block from the ollama
service in the compose file. CPU inference will be slower but functional.

**Intelligence service cannot reach Ollama**: Verify both containers are on the
`routeai-internal` network with `docker network inspect`.

**Database connection errors**: Ensure PostgreSQL is healthy before starting the
API. The compose file uses `depends_on` with health checks, but if the database
takes long to initialize the API may need a restart.
