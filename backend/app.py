"""Stateless Crystal Studio API. Run: uvicorn app:app --host 0.0.0.0."""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from starlette.concurrency import run_in_threadpool

from parsers import parse_structure
from science import MAX_FILE_BYTES, StructureError, bond_scale, parse_repetitions, rebuild

logger = logging.getLogger("crystal_studio")
MAX_REBUILD_BODY = 8 * 1024 * 1024
MAX_MULTIPART_BODY = MAX_FILE_BYTES + 64 * 1024


def allowed_origins() -> list[str]:
    origins = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 5174)}
    for value in re.split(r"[\s,]+", os.getenv("ALLOWED_ORIGINS", "").strip()):
        if not value:
            continue
        parsed = urlsplit(value)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname
                or parsed.username or parsed.password or parsed.path not in ("", "/")
                or parsed.query or parsed.fragment or "*" in value):
            raise RuntimeError("ALLOWED_ORIGINS must contain exact HTTP(S) origins, without paths or wildcards.")
        origins.add(value.rstrip("/"))
    return sorted(origins)


class BodyLimitMiddleware:
    """Limit streamed bodies before multipart/JSON parsers allocate them."""
    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http" or scope.get("method") != "POST":
            await self.app(scope, receive, send)
            return
        limit = MAX_REBUILD_BODY if scope.get("path") == "/api/rebuild" else MAX_MULTIPART_BODY
        headers = dict(scope.get("headers", []))
        declared = headers.get(b"content-length")
        if declared is not None:
            try:
                length = int(declared)
            except ValueError:
                await JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)(scope, receive, send)
                return
            if length < 0 or length > limit:
                await JSONResponse({"detail": "Request exceeds the size limit."}, status_code=413)(scope, receive, send)
                return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > limit:
                await JSONResponse({"detail": "Request exceeds the size limit."}, status_code=413)(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay() -> dict:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)


class RebuildRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    structure: dict[str, Any]
    bondScale: float = Field(default=1.1, strict=True, ge=0.5, le=2.0, allow_inf_nan=False)
    repetitions: list[StrictInt] = Field(default_factory=lambda: [1, 1, 1], min_length=3, max_length=3)


app = FastAPI(title="Crystal Studio scientific API", version="1.0.0", docs_url=None, redoc_url=None)
app.state.compute_lock = asyncio.Lock()
app.add_middleware(BodyLimitMiddleware)
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins(), allow_credentials=False,
                   allow_methods=["GET", "POST"], allow_headers=["Content-Type"])


@app.exception_handler(StructureError)
async def structure_error_handler(request: Request, exc: StructureError) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=exc.status_code)


async def compute(function: Any, *args: Any) -> dict:
    # One bounded scientific job at a time suits the free 512 MiB service.
    if app.state.compute_lock.locked():
        raise HTTPException(status_code=429, detail="Another structure is being processed. Please retry shortly.")
    async with app.state.compute_lock:
        try:
            return await run_in_threadpool(function, *args)
        except StructureError:
            raise
        except Exception as exc:
            # Never log uploaded coordinates, filenames or user-supplied bodies.
            logger.error("Scientific computation failed (%s)", type(exc).__name__)
            raise HTTPException(status_code=500, detail="Structure processing failed. Please retry or check the input file.") from exc


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "schemaVersion": 1}


@app.post("/api/structure")
async def upload_structure(file: UploadFile = File(...), bond_scale_value: float = Form(1.1, alias="bond_scale"),
                           supercell: str = Form("1,1,1")) -> dict:
    try:
        scale = bond_scale(bond_scale_value)
        repeat = parse_repetitions(supercell)
        data = await file.read(MAX_FILE_BYTES + 1)
        if len(data) > MAX_FILE_BYTES:
            raise StructureError("File exceeds the 2 MiB upload limit.", 413)
        return await compute(parse_structure, data, file.filename or "structure.cif", scale, repeat)
    finally:
        await file.close()


@app.post("/api/rebuild")
async def rebuild_structure(body: RebuildRequest) -> dict:
    return await compute(rebuild, body.structure, body.bondScale, body.repetitions)
