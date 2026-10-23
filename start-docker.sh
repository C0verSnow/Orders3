#!/usr/bin/env bash
# Run on the Docker host (macOS or Linux), not inside the container.
set -euo pipefail

image="${ORDERS_IMAGE:-ghcr.io/c0versnow/orders3:latest}"
container_name="${ORDERS_CONTAINER_NAME:-orders-dashboard}"
volume_name="${ORDERS_VOLUME_NAME:-orders-dashboard-data}"
pull_policy="${ORDERS_PULL_POLICY:-always}"
env_file="${ORDERS_ENV_FILE:-.env}"
env_args=()
if [[ -f "$env_file" ]]; then
    env_args=(--env-file "$env_file")
elif [[ -n "${ORDERS_ENV_FILE:-}" ]]; then
    echo 'ORDERS_ENV_FILE 指向的文件不存在。' >&2
    exit 1
fi
command -v docker >/dev/null
command -v curl >/dev/null
docker info >/dev/null
# Resolve the image first so failures leave the existing service running.
case "$pull_policy" in
    always)
        printf '正在拉取镜像：%s\n' "$image"
        docker pull "$image"
        ;;
    never)
        printf '正在使用本地镜像：%s\n' "$image"
        docker image inspect "$image" >/dev/null
        ;;
    *)
        echo 'ORDERS_PULL_POLICY 只支持 always 或 never。' >&2
        exit 1
        ;;
esac
if docker container inspect "$container_name" >/dev/null 2>&1; then
    printf '正在删除同名旧容器：%s（保留数据卷）\n' "$container_name"
    # SIGKILL leaves the five-minute data-directory lock behind. Give the
    # service time to stop requests, close SQLite and release that lock.
    docker stop --time 45 "$container_name" >/dev/null
    docker rm "$container_name" >/dev/null
fi

start_mapped_dashboard() {
    local attempt port container_id failure
    failure="$(mktemp)"
    for attempt in {1..15}; do
        # Docker's actual bind decides availability, avoiding probe/bind races.
        port=$((49152 + RANDOM % 16384))
        if ! container_id="$(docker create --pull never --name "$container_name" --restart unless-stopped \
            -p "127.0.0.1:$port:$port" -v "$volume_name:/data" \
            "${env_args[@]}" -e ORDERS_HOST=0.0.0.0 -e "ORDERS_PORT=$port" -e ORDERS_NO_BROWSER=1 \
            "$image" "$@" --host 0.0.0.0 --port "$port" --no-browser)"; then
            rm -f "$failure"
            return 1
        fi
        if docker start "$container_id" >/dev/null 2>"$failure"; then
            rm -f "$failure"
            dashboard_port="$port"
            dashboard_container_id="$container_id"
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

dashboard_container_id=''
dashboard_port=''
start_mapped_dashboard "$@"
# Docker inspection, not the requested random value, is the source of truth.
read_mapping() {
    local binding
    binding="$(docker port "$dashboard_container_id" "$dashboard_port/tcp")" || return 1
    [[ "$binding" =~ ^127\.0\.0\.1:([0-9]+)$ ]] || {
        echo '实际端口映射不是唯一的本机回环地址，停止记录。' >&2
        return 1
    }
    actual_port="${BASH_REMATCH[1]}"
}
diagnose() {
    echo "部署诊断：container=$dashboard_container_id requested_port=$dashboard_port actual_port=${actual_port:-unknown} last_http=${last_http:-none}" >&2
    docker inspect --format 'running={{.State.Running}} restarting={{.State.Restarting}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' "$dashboard_container_id" >&2 || true
    docker port "$dashboard_container_id" >&2 || true
    # No inspect of Config.Env: it can contain exchange credentials.
    docker logs --tail 100 "$dashboard_container_id" >&2 || true
}
actual_port=''
last_http='none'
if ! read_mapping; then diagnose; exit 1; fi
dashboard_url="http://127.0.0.1:$actual_port/"
# A crash can leave a live-looking lock for five minutes; never delete that lock
# or weaken process exclusion. The service retries until it can safely acquire it.
for attempt in {1..360}; do
    if [[ "$(docker inspect --format '{{.State.Running}}' "$dashboard_container_id")" != true ]]; then
        diagnose
        echo '容器已退出，看板启动失败。' >&2
        exit 1
    fi
    last_http="$(curl --noproxy '*' --fail --silent --connect-timeout 1 --max-time 2 --output /dev/null --write-out '%{http_code}' "${dashboard_url}health")" || last_http="${last_http:-000}"
    if [[ "$last_http" == 200 ]] && curl --noproxy '*' --fail --silent --connect-timeout 1 --max-time 2 "$dashboard_url" >/dev/null; then
        # Recheck identity and binding before publishing the checked address.
        confirmed_port="$actual_port"
        if ! read_mapping || [[ "$actual_port" != "$confirmed_port" ]] \
            || [[ "$(docker inspect --format '{{.State.Running}}' "$dashboard_container_id")" != true ]]; then
            diagnose; echo '就绪后容器或映射已变化，保留原有 docker.md。' >&2; exit 1
        fi
        if [[ -d docker.md ]]; then
            echo '无法保存看板地址：docker.md 是目录。' >&2
            exit 1
        fi
        if ! address_file="$(mktemp .docker.md.XXXXXX)"; then
            echo '无法创建看板地址临时文件，保留原有 docker.md。' >&2
            exit 1
        fi
        if ! printf '本地看板：\n127.0.0.1:%s\n' "$actual_port" > "$address_file" \
            || ! mv -f "$address_file" docker.md; then
            rm -f "$address_file"
            echo '无法保存看板地址，保留原有 docker.md。' >&2
            exit 1
        fi
        test -s docker.md
        [[ "$(sed -n '2p' docker.md)" == "127.0.0.1:$actual_port" ]]
        printf '本地看板：%s\n容器名称：%s\n地址记录：%s/docker.md\n' "$dashboard_url" "$container_name" "$PWD"
        exit 0
    fi
    sleep 1
done
diagnose
echo "看板未就绪（已等待 360 次检查），保留原有 docker.md。" >&2
exit 1
