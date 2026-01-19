FROM denoland/deno:latest
WORKDIR /app

RUN apt-get update && apt-get install -y docker.io docker-compose && rm -rf /var/lib/apt/lists/*

# 复制配置文件
COPY deno.json .
COPY deno.lock .

# 复制源代码目录
COPY src/ ./src/
COPY web/ ./web/

# 缓存依赖
RUN deno cache src/main.ts

EXPOSE 10001
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "--allow-run=docker,docker-compose", "src/main.ts"]
