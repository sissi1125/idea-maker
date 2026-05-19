# PostgreSQL 16 + pgvector
#
# 使用官方 postgres:16（Debian base），通过官方 apt 包安装 pgvector。
# 相比从源码编译，包安装更快、更稳定，且不需要 build-essential。
#
# postgresql-16-pgvector 包提供：
#   - /usr/lib/postgresql/16/lib/vector.so
#   - /usr/share/postgresql/16/extension/vector--*.sql
# CREATE EXTENSION IF NOT EXISTS vector; 会自动加载。
FROM postgres:16

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-16-pgvector \
    && rm -rf /var/lib/apt/lists/*
