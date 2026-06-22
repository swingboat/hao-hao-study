#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  admin端 Next.js dev server 守护脚本
#
#  用法（在 apps/admin/ 目录下）：
#      ./scripts/dev-server.sh start      # 后台启动（端口 3001）
#      ./scripts/dev-server.sh stop       # 停止
#      ./scripts/dev-server.sh restart    # 重启
#      ./scripts/dev-server.sh status     # 查看运行状态
#      ./scripts/dev-server.sh logs       # tail -f 实时日志
#      ./scripts/dev-server.sh logs 200   # 打印最后 200 行后退出
#
#  落盘位置（均在 apps/admin/.run/ 下，已加入 .gitignore）：
#      .run/dev.pid    — 后台进程 PID
#      .run/dev.log    — 合并 stdout / stderr
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

# 脚本所在目录的父目录 = apps/admin（允许从任意 cwd 调用）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$APP_DIR/.run"
PID_FILE="$RUN_DIR/dev.pid"
LOG_FILE="$RUN_DIR/dev.log"
PORT="${PORT:-3001}"

mkdir -p "$RUN_DIR"

# ─── 工具函数 ──────────────────────────────────────────────
is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || echo "")"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

current_pid() {
  cat "$PID_FILE" 2>/dev/null || echo ""
}

# 友好打印
info()  { printf "\033[36m[dev-server]\033[0m %s\n" "$*"; }
warn()  { printf "\033[33m[dev-server]\033[0m %s\n" "$*"; }
error() { printf "\033[31m[dev-server]\033[0m %s\n" "$*" >&2; }

# ─── 命令实现 ──────────────────────────────────────────────
cmd_start() {
  if is_running; then
    warn "已在运行（PID $(current_pid)），如需重启用 \`$0 restart\`"
    return 0
  fi

  cd "$APP_DIR"

  # nohup + setsid 让进程脱离当前 shell；setsid 在 macOS 没有自带，
  # 退而用 `disown` 等价方案：后台启动 + 写 PID + 重定向。
  info "启动 Next.js dev (port $PORT)，日志 → $LOG_FILE"
  : > "$LOG_FILE"  # 清空旧日志
  # shellcheck disable=SC2086
  ( PORT="$PORT" nohup pnpm dev >> "$LOG_FILE" 2>&1 & echo $! > "$PID_FILE" )

  # 等待几秒确认进程没立刻退出
  sleep 1
  if is_running; then
    info "已启动，PID $(current_pid)"
    info "查看日志：$0 logs"
  else
    error "启动失败，查看日志：$LOG_FILE"
    rm -f "$PID_FILE"
    return 1
  fi
}

cmd_stop() {
  if ! is_running; then
    warn "未在运行"
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(current_pid)"
  info "停止 PID ${pid}"

  # Next.js 的 pnpm dev 会 fork 出 next-server 子进程，
  # 用进程组（-PGID）一并干掉，避免子进程残留占住 3001。
  local pgid
  pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
  if [[ -n "$pgid" ]]; then
    kill -TERM "-$pgid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi

  # 最多等 5 秒优雅退出
  for _ in 1 2 3 4 5; do
    is_running || break
    sleep 1
  done

  if is_running; then
    warn "进程未在 5 秒内退出，发送 SIGKILL"
    [[ -n "$pgid" ]] && kill -KILL "-$pgid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE"
  info "已停止"
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  if is_running; then
    local pid
    pid="$(current_pid)"
    info "运行中 — PID ${pid}，端口 ${PORT}"
    # macOS / Linux 兼容：尝试 lsof 拿监听端口
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true
    fi
    return 0
  fi
  warn "未运行"
  return 1
}

cmd_logs() {
  if [[ ! -f "$LOG_FILE" ]]; then
    warn "无日志文件 ($LOG_FILE)"
    return 1
  fi
  local lines="${1:-}"
  if [[ -n "$lines" ]]; then
    tail -n "$lines" "$LOG_FILE"
  else
    info "tail -f $LOG_FILE   (Ctrl-C 退出)"
    tail -n 100 -f "$LOG_FILE"
  fi
}

# ─── 入口 ─────────────────────────────────────────────────
case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  restart) cmd_restart ;;
  status)  cmd_status ;;
  logs)    shift || true; cmd_logs "${1:-}" ;;
  *)
    cat <<EOF
用法: $0 {start|stop|restart|status|logs [行数]}

  start            后台启动 dev server（端口 \$PORT，默认 3001）
  stop             优雅停止（5 秒后强杀），并清理子进程
  restart          stop + start
  status           显示 PID 与监听端口
  logs             tail -f 实时输出
  logs 200         只打印最后 200 行后退出

环境变量:
  PORT=3001        覆盖默认端口

文件:
  $PID_FILE
  $LOG_FILE
EOF
    exit 1
    ;;
esac
