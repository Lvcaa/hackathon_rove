# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Environment

All code runs inside Docker containers — there is no local Python runtime. The repo root is mounted at `/workspace` inside every container. Before running any Python, the image must be built:

```bash
cp .env.example .env   # fill in API keys
make build             # or: docker compose build
```

## Common Commands

```bash
make jupyter     # JupyterLab at http://localhost:8888 (no auth)
make api         # FastAPI at http://localhost:8000 (--reload enabled)
make streamlit   # Streamlit at http://localhost:8501
make gradio      # Gradio at http://localhost:7860
make shell       # Interactive bash in the container
make test        # pytest
make lint        # ruff check .
make format      # black .
make down        # stop all containers
```

Run a one-off command without entering a shell:
```bash
docker compose run --rm ai python scripts/your_script.py
```

Rebuild after changing `requirements.txt`:
```bash
docker compose build --no-cache
```

## Architecture

Three starter app entry points in `app/`:
- `app/main.py` — FastAPI app, served by uvicorn with hot-reload
- `app/streamlit_app.py` — Streamlit demo UI
- `app/gradio_app.py` — Gradio demo UI

The `api`, `streamlit`, and `gradio` Docker Compose services use profiles, so `docker compose up` (no args) only starts the base `ai` service. `make api` / `make streamlit` / `make gradio` start the correct service directly.

`data/`, `models/`, and `outputs/` are bind-mounted into the container and git-ignored — use these for large files.

## Environment Variables

Copy `.env.example` to `.env` and set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and/or `HF_TOKEN` as needed. The `.env` file is optional at container start (won't fail if absent).
