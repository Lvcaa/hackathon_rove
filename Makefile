.PHONY: help build up down shell jupyter api streamlit gradio test lint format clean

COMPOSE ?= docker compose
SERVICE ?= ai

help:
	@echo "Hackathon AI repo commands"
	@echo ""
	@echo "  make build       Build the Docker image"
	@echo "  make up          Start the default container"
	@echo "  make down        Stop containers"
	@echo "  make shell       Open a shell in the AI container"
	@echo "  make jupyter     Start JupyterLab on http://localhost:8888"
	@echo "  make api         Start FastAPI on http://localhost:8000"
	@echo "  make streamlit   Start Streamlit on http://localhost:8501"
	@echo "  make gradio      Start Gradio on http://localhost:7860"
	@echo "  make test        Run pytest"
	@echo "  make lint        Run ruff"
	@echo "  make format      Run black"

build:
	$(COMPOSE) build

up:
	$(COMPOSE) up $(SERVICE)

down:
	$(COMPOSE) down

shell:
	$(COMPOSE) run --rm $(SERVICE) bash

jupyter:
	$(COMPOSE) up jupyter

api:
	$(COMPOSE) up api

streamlit:
	$(COMPOSE) up streamlit

gradio:
	$(COMPOSE) up gradio

test:
	$(COMPOSE) run --rm $(SERVICE) pytest

lint:
	$(COMPOSE) run --rm $(SERVICE) ruff check .

format:
	$(COMPOSE) run --rm $(SERVICE) black .

clean:
	$(COMPOSE) down --volumes --remove-orphans
