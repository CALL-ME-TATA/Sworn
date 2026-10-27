FROM python:3.12-slim
WORKDIR /srv/mcp
COPY pyproject.toml README.md ./
COPY sworn_mcp ./sworn_mcp
RUN pip install --no-cache-dir .
ENV PYTHONUNBUFFERED=1 \
    SWORN_API_URL=http://backend:3001 \
    MCP_TRANSPORT=streamable-http \
    MCP_HOST=0.0.0.0 \
    MCP_PORT=3003
EXPOSE 3003
CMD ["python", "-m", "sworn_mcp"]
