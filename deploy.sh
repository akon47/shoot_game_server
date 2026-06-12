#!/bin/bash
# shoot_game_server 배포 스크립트
# 사용법: /var/www 에 이 파일을 두고 `./deploy.sh` 실행
# 하는 일: pm2 중지 -> 채팅 백업 -> 로컬 변경 폐기 후 git pull -> npm install
#          -> 채팅 복원 -> pm2 재시작
#
# 주의: 운영 서버에서 직접 고친 코드(tracked 파일)는 전부 폐기되고
#       origin/master 기준으로 덮어쓴다. 운영 전용 수정이 필요하면
#       저장소에 커밋해서 관리할 것.

set -e

# 전체를 함수로 감싸서, git pull 로 이 스크립트 자신이 갱신되어도
# 실행 중이던 셸이 깨지지 않도록 한다
main() {
  local SCRIPT_DIR
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local APP_DIR="$SCRIPT_DIR/shoot_game_server"
  # 스크립트가 저장소 안에서 실행된 경우(예: 저장소 루트의 deploy.sh)도 지원
  if [ ! -d "$APP_DIR" ] && [ -f "$SCRIPT_DIR/server.js" ]; then
    APP_DIR="$SCRIPT_DIR"
  fi

  local PM2_NAME="server"
  local CHAT_FILE="$APP_DIR/datas/user_chats.json"
  local BACKUP_FILE="/tmp/user_chats.backup.json"

  trap 'echo "!! 배포 실패 — 서버가 중지된 상태일 수 있습니다. pm2 ps 로 확인하세요."' ERR

  cd "$APP_DIR"

  echo "== 1/6 pm2 중지 =="
  pm2 stop "$PM2_NAME" || true

  echo "== 2/6 채팅 기록 백업 =="
  if [ -f "$CHAT_FILE" ]; then
    cp "$CHAT_FILE" "$BACKUP_FILE"
    echo "백업: $BACKUP_FILE"
  else
    echo "채팅 파일 없음 (건너뜀)"
  fi

  echo "== 3/6 로컬 변경 폐기 후 pull =="
  git checkout -- .
  git pull

  echo "== 4/6 의존성 설치 =="
  npm install --no-audit --no-fund

  echo "== 5/6 채팅 기록 복원 =="
  if [ -f "$BACKUP_FILE" ]; then
    mkdir -p "$APP_DIR/datas"
    cp "$BACKUP_FILE" "$CHAT_FILE"
  fi

  echo "== 6/6 pm2 재시작 =="
  pm2 restart "$PM2_NAME" || { pm2 start "$APP_DIR/server.js" --name "$PM2_NAME"; pm2 save; }

  echo "== 배포 완료 =="
  pm2 ps
}

main "$@"
