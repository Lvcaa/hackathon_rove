# Hackathon Rove AI Starter

Docker Compose setup for an AI hackathon project. It includes common Python AI, ML, notebook, API, and demo-app frameworks so teammates can start quickly on the same environment.

## Requirements

- Docker Desktop or Docker Engine
- Docker Compose v2, available as `docker compose`
- Optional: `make`

## Quick Start

```bash
cp .env.example .env
docker compose build
docker compose up jupyter
```

Open JupyterLab at:

```text
http://localhost:8888
```

Jupyter auth is disabled for local hackathon speed. Do not expose this container directly to the public internet.

## Common Commands

With `make`:

```bash
make build      # Build the Docker image
make jupyter    # Start JupyterLab
make shell      # Open a shell in the container
make api        # Start FastAPI
make streamlit  # Start Streamlit
make gradio     # Start Gradio
make test       # Run pytest
make lint       # Run ruff
make format     # Format code with black
make down       # Stop containers
```

Without `make`:

```bash
docker compose build
docker compose up jupyter
docker compose run --rm ai bash
docker compose down
```

## Services

| Service | URL | Purpose |
| --- | --- | --- |
| `ai` | n/a | Base development container |
| `jupyter` | `http://localhost:8888` | Notebooks and experiments |
| `api` | `http://localhost:8000` | FastAPI backend |
| `streamlit` | `http://localhost:8501` | Streamlit demo UI |
| `gradio` | `http://localhost:7860` | Gradio demo UI |

The `api`, `streamlit`, and `gradio` services start from these starter files:

```text
app/main.py
app/streamlit_app.py
app/gradio_app.py
```

## Running Scripts

Put project scripts in `scripts/`, then run them inside the same Docker environment:

```bash
docker compose run --rm ai python scripts/your_script.py
docker compose run --rm ai bash scripts/your_script.sh
```

Examples:

```bash
./scripts/bootstrap.sh
./scripts/run_jupyter.sh
```

## Python Packages

The base environment is defined in `requirements.txt` and includes:

- PyTorch: `torch`, `torchvision`, `torchaudio`
- TensorFlow/Keras: `tensorflow`, `keras`
- Data science: `numpy`, `pandas`, `scipy`, `scikit-learn`
- Notebooks and plotting: `jupyterlab`, `ipykernel`, `matplotlib`, `seaborn`, `plotly`
- LLM tooling: `openai`, `anthropic`, `transformers`, `datasets`, `accelerate`, `sentence-transformers`, `langchain`
- Apps and APIs: `fastapi`, `uvicorn`, `streamlit`, `gradio`
- Dev tools: `pytest`, `ruff`, `black`

If the image gets too large, remove packages you do not need from `requirements.txt` and rebuild.

## Data And Models

Local folders for large generated files are mounted into the container and ignored by git:

```text
data/
models/
outputs/
```

Keep datasets, downloaded model weights, and generated artifacts there.

## Rebuild After Dependency Changes

```bash
docker compose build --no-cache
docker compose up jupyter
```
