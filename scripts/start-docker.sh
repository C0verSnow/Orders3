#!/usr/bin/env bash
# Run on the Docker host (macOS or Linux), not inside the container.
set -euo pipefail

image="${ORDERS_IMAGE:-ghcr.io/huan00000/orders3:latest}"
container_name="${ORDERS_CONTAINER_NAME:-orders-dashboard}"
volume_name="${ORDERS_VOLUME_NAME:-orders-dashboard-data}"
command -v docker >/dev/null
command -v curl >/dev/null
docker info >/dev/null
# Pull first so a failed download leaves the existing service running.
printf '正在拉取镜像：%s\n' "$image"
docker pull "$image"
if docker container inspect "$container_name" >/dev/null 2>&1; then
    printf '正在删除同名旧容器：%s（保留数据卷）\n' "$container_name"
    docker rm -f "$container_name" >/dev/null
fi

start_mapped_dashboard() {
    local attempt port container_id failure
    failure="$(mktemp)"
    for attempt in {1..15}; do
        # Docker's actual bind decides availability, avoiding probe/bind races.
        port=$((49152 + RANDOM % 16384))
        if ! container_id="$(docker create --name "$container_name" --restart unless-stopped \
            -p "127.0.0.1:$port:$port" -v "$volume_name:/data" \
            -e ORDERS_HOST=0.0.0.0 -e "ORDERS_PORT=$port" -e ORDERS_NO_BROWSER=1 \
            "$image" "$@" --host 0.0.0.0 --port "$port" --no-browser)"; then
            rm -f "$failure"
            return 1
        fi
        if docker start "$container_id" >/dev/null 2>"$failure"; then
            rm -f "$failure"
            dashboard_port="$port"
            return 0
        fi
        # Remove only the container created by this attempt; preserve its data volume.
        docker rm "$container_id" >/dev/null
        if ! grep -Eqi 'port is already allocated|address already in use|ports are not available' "$failure"; then
            cat "$failure" >&2
            rm -f "$failure"
            return 1
        fi
    done
    cat "$failure" >&2
    rm -f "$failure"
    echo '自动端口映射失败，15 次尝试均遇到端口占用。' >&2
    return 1
}

dashboard_port=''
start_mapped_dashboard "$@"
dashboard_url="http://127.0.0.1:$dashboard_port/"
for attempt in {1..60}; do
    if [[ "$(docker inspect --format '{{.State.Running}}' "$container_name")" != true ]]; then
        docker logs "$container_name" >&2
        echo '容器已退出，看板启动失败。' >&2
        exit 1
    fi
    if curl --fail --silent --connect-timeout 1 --max-time 2 "$dashboard_url" >/dev/null; then
        printf '本地看板：%s\n容器名称：%s\n' "$dashboard_url" "$container_name"
        exit 0
    fi
    sleep 1
done
docker logs "$container_name" >&2
echo "看板未就绪，请检查容器 $container_name 的日志。" >&2
exit 1
