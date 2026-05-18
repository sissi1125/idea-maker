# 使用官方 Python 3.12 slim 镜像，减小体积
FROM python:3.12-slim

WORKDIR /app

# pymupdf 编译时需要这些系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmupdf-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# uvicorn 在 0.0.0.0 监听，允许容器外部访问
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

EXPOSE 8000
