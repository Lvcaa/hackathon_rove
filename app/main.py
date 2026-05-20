from fastapi import FastAPI

app = FastAPI(title="Hackathon Rove AI")


@app.get("/")
def read_root() -> dict[str, str]:
    return {"status": "ok", "message": "Hackathon Rove AI API is running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}
