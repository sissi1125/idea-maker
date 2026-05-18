"""
pymupdf 微服务 — PDF 精确文本提取

作用：提供 pymupdf (fitz) 库的 HTTP 接口，供 Next.js 预处理 API 调用。

为什么用微服务而不是 npm 包？
  pymupdf 是 Python 库，绑定了 C++ 的 MuPDF 引擎。
  无法在 Node.js 中直接 import，必须通过进程间通信（HTTP / gRPC）调用。
  FastAPI + Uvicorn 是最轻量的方案：几十行代码即可暴露 REST 接口。

pymupdf vs pdf-parse（Node.js）的优势：
  1. 几何位置感知：能获取每个文字块的 (x, y, w, h)，多列 PDF 可按位置重排
  2. 表格提取：内置 page.find_tables() 方法（pymupdf >= 1.23）
  3. 图片提取：page.get_images() 返回嵌入图片列表
  4. 精确分页：每页独立提取，不依赖 \f 分页符的存在
  5. 注释/书签：fitz.Document().get_toc() 提取目录结构
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import fitz  # pymupdf
import base64
import time
from typing import Optional

app = FastAPI(title="pymupdf-service", version="1.0.0")


# ─── 请求/响应模型 ─────────────────────────────────────────────────────────────

class ExtractRequest(BaseModel):
    """接受 base64 编码的 PDF 内容，和可选的提取参数"""
    pdf_base64: str           # PDF 文件的 base64 编码
    page_range: str = ""      # 页码范围，如 "1-10"，空字符串表示全部
    preserve_layout: bool = True  # 是否按几何位置重排文字（纠正多列乱序）
    extract_images: bool = False  # 是否提取图片（返回 base64）


class SourceRef(BaseModel):
    type: str   # "page"
    value: str  # 如 "第 3 页"
    char_start: int
    char_end: int


class ExtractResponse(BaseModel):
    raw_text: str
    clean_text: str
    char_count: int
    word_count: int
    page_count: int
    source_refs: list[SourceRef]
    warnings: list[str]
    duration_ms: int


# ─── 核心提取逻辑 ──────────────────────────────────────────────────────────────

def parse_page_range(range_str: str, total_pages: int) -> tuple[int, int]:
    """解析页码范围字符串，返回 (start, end)，0-indexed。"""
    if not range_str.strip():
        return 0, total_pages - 1
    parts = range_str.strip().split("-")
    try:
        start = int(parts[0]) - 1  # 用户输入 1-indexed，转为 0-indexed
        end = int(parts[1]) - 1 if len(parts) > 1 else start
        return max(0, start), min(total_pages - 1, end)
    except (ValueError, IndexError):
        return 0, total_pages - 1


def extract_page_text(page: fitz.Page, preserve_layout: bool) -> str:
    """
    从单页提取文本。

    preserve_layout=True 时使用 "blocks" 模式：
      fitz 返回每个文字块的 (x0, y0, x1, y1, text, block_no, block_type)
      按 y 坐标排序后拼接，能正确处理多列 PDF（如学术论文双栏格式）。

    preserve_layout=False 时使用简单的 get_text()，速度更快。
    """
    if preserve_layout:
        blocks = page.get_text("blocks")
        # 按垂直位置（y0）排序，再按水平位置（x0）排序
        blocks_sorted = sorted(blocks, key=lambda b: (round(b[1] / 10), b[0]))
        return "\n".join(b[4].strip() for b in blocks_sorted if b[4].strip())
    else:
        return page.get_text()


# ─── API 路由 ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """健康检查，供 Docker / kubernetes 探针使用"""
    return {"status": "ok", "library": fitz.__doc__.split("\n")[0] if fitz.__doc__ else "pymupdf"}


@app.post("/extract", response_model=ExtractResponse)
def extract(req: ExtractRequest):
    """
    主接口：接受 base64 PDF，返回提取的文本和 sourceRefs。

    Next.js 调用示例：
        const res = await fetch("http://pymupdf-service:8000/extract", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                pdf_base64: doc.rawContent,  // docStore 已存 base64
                page_range: "1-10",
                preserve_layout: true,
            }),
        });
    """
    started_at = time.time()
    warnings: list[str] = []

    # 1. 解码 base64 → bytes
    try:
        pdf_bytes = base64.b64decode(req.pdf_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"base64 解码失败: {e}")

    # 2. 用 pymupdf 打开 PDF
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"PDF 解析失败: {e}")

    total_pages = len(doc)
    start_page, end_page = parse_page_range(req.page_range, total_pages)

    # 3. 逐页提取文本，记录 sourceRef
    source_refs: list[SourceRef] = []
    all_text_parts: list[str] = []
    char_cursor = 0

    for page_idx in range(start_page, end_page + 1):
        page = doc[page_idx]
        page_text = extract_page_text(page, req.preserve_layout)

        if not page_text.strip():
            warnings.append(f"第 {page_idx + 1} 页提取到空文本（可能是扫描页，需 OCR）")
            continue

        ref_start = char_cursor
        char_cursor += len(page_text) + 1
        source_refs.append(SourceRef(
            type="page",
            value=f"第 {page_idx + 1} 页",
            char_start=ref_start,
            char_end=char_cursor,
        ))
        all_text_parts.append(page_text)

    doc.close()

    clean_text = "\n".join(all_text_parts)
    duration_ms = int((time.time() - started_at) * 1000)

    return ExtractResponse(
        raw_text=clean_text,
        clean_text=clean_text,
        char_count=len(clean_text),
        word_count=len(clean_text.split()),
        page_count=total_pages,
        source_refs=source_refs,
        warnings=warnings,
        duration_ms=duration_ms,
    )
