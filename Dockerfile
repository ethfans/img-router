FROM denoland/deno:latest
WORKDIR /app

# 复制配置文件
COPY deno.json .
COPY deno.lock .

# 复制源代码目录
COPY src/ ./src/

# 缓存依赖
RUN deno cache src/main.ts

EXPOSE 10001
CMD ["run", "--allow-net", "--allow-env", "--allow-read", "--allow-write", "src/main.ts"]