"""
本地 Cross-encoder Rerank 服务

兼容 HuggingFace TEI /rerank 接口：
  POST /rerank  { "query": "...", "texts": ["...", ...] }
  返回          [{ "index": 0, "score": 0.95 }, ...]  按 score 降序

启动：
  uvicorn main:app --host 0.0.0.0 --port 8080

模型通过环境变量配置：
  RERANK_MODEL=BAAI/bge-reranker-base  （默认）
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import CrossEncoder

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MODEL_ID = os.environ.get("RERANK_MODEL", "BAAI/bge-reranker-base")
model: CrossEncoder | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    logger.info(f"加载模型: {MODEL_ID}")
    model = CrossEncoder(MODEL_ID)
    logger.info("模型加载完成")
    yield


app = FastAPI(title="Rerank Service", lifespan=lifespan)


class RerankRequest(BaseModel):
    query: str
    texts: List[str]


class RerankResult(BaseModel):
    index: int
    score: float


@app.get("/health")
def health():
    return {"message": "Ok", "model": MODEL_ID, "ready": model is not None}


@app.post("/rerank", response_model=List[RerankResult])
def rerank(req: RerankRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="模型尚未加载")
    if not req.texts:
        return []

    pairs = [(req.query, text) for text in req.texts]
    scores = model.predict(pairs).tolist()

    results = sorted(
        [{"index": i, "score": float(s)} for i, s in enumerate(scores)],
        key=lambda x: x["score"],
        reverse=True,
    )
    return results
