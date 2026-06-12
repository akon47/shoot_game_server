# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

2D 멀티플레이어 슈팅 게임(shoot_game)의 Node.js WebSocket 서버.
클라이언트 프로젝트는 형제 디렉토리 `../shoot_game` 에 있으며, 이 서버는
`../shoot_game/map_office.js` 의 맵 데이터를 직접 require 한다.
**클라이언트 저장소가 같은 부모 폴더에 clone 되어 있지 않으면 서버가 기동되지 않는다.**

- 데모: https://shootgame.kimhwan.kr/
- 테스트 코드 없음, 린트 설정 없음.

## 명령어

```bash
npm install        # 의존성 설치
npm start          # 서버 실행 (node server.js, 포트 8080)
```

서버는 8080 포트에 HTTP 서버를 띄우고 그 위에 WebSocket(ws 라이브러리)을 올린다.
HTTPS/WSS 인증서 경로는 `websocket-server.js`에 주석 처리되어 있다(운영 배포 시 사용).

## 파일 구성 (4개 파일이 전부)

| 파일 | 역할 |
|---|---|
| `server.js` | 메인. 연결/메시지 처리, 피격 판정, AI 봇 전체 로직 |
| `websocket-server.js` | HTTP 서버 + ws WebSocketServer 생성 팩토리 (`require(...)(port)`) |
| `map-helper.js` | 맵 그리드 로드, A* 길찾기(pathfinding 패키지), 벽 히트박스→세그먼트 변환 |
| `utils.js` | 기하 유틸: 선분-원 교차(`shootIntersection`), 거리(`getDistance`) |

런타임에 `datas/user_chats.json` 파일을 생성해 채팅 로그를 append 한다
(JSON Lines 비슷하게 `{...},\n` 형식으로 누적, 로드 시 `[...]`로 감싸 파싱, 최근 100개만 유지).

## 통신 프로토콜

모든 메시지는 `{ type: string, data: any }` 형태의 JSON 문자열.

- 클라이언트 → 서버: `user_init`, `user_position`, `user_speed`, `user_name`,
  `user_chat`, `user_direction`, `user_character`, `user_weapon`, `user_shoot`,
  `user_disconnected`, `echo`
- 서버 → 클라이언트(브로드캐스트): `user_connected`, `user_count`, `user_hp`,
  `user_die`, `user_kill`, `user_death`, `user_chat`, `user_chat_history`, `id`
  외에 위 상태 메시지들을 그대로 중계

패턴: 클라이언트가 자기 상태 변경을 보내면 서버는 해당 클라이언트 객체에 저장 후
`sendAll(type, data)`로 전원에게 재방송한다. AI 봇도 동일한 `user_*` 메시지 타입을
사용하므로 클라이언트는 사람/AI를 구분하지 않는다 (id 접두사 `USER_` / `AI_`만 다름).

## 핵심 구현 패턴 (수정 시 반드시 인지할 것)

### 1. 배열을 맵처럼 쓰는 컬렉션 패턴
`clients`와 `aiPlayers`는 `[]`로 선언되지만 실제로는 두 가지를 동시에 담는다:
- 숫자 인덱스: id 문자열 목록 (`clients.push(id)`)
- 문자열 키: 플레이어 객체 (`clients[id] = [...]; clients[id].x = ...`)

순회는 항상 이중 참조다: `for (i=0; i<clients.length; i++) { const c = clients[clients[i]]; if (c) ... }`
연결 종료 시 `delete clients[id]`만 하고 숫자 인덱스는 남기므로 **undefined 체크가 필수**.
새 코드도 이 관례를 따르거나, 바꾼다면 전체를 일괄 변경해야 한다.

### 2. 서버 권위(authoritative) 피격 판정
`shootProcess()`가 총알을 선분(머즐→타겟)으로 보고 모든 플레이어의 AABB로 1차 필터 후
`shootIntersection`(선분-원, 반지름 16)으로 최종 판정. 가장 가까운 대상 하나만 피격.
무기별 데미지는 이 함수 안에 하드코딩: handgun 10 / rifle 15 / shotgun 8.

- 사람 사망: `user_die` + 킬/데스 카운트 전파 (리스폰은 클라이언트가 처리)
- AI 사망: 서버가 즉시 hp 100으로 리셋하고 랜덤 위치로 옮긴 뒤 `user_connected` 재전송

### 3. AI 봇 FSM과 입퇴장 시스템
AI는 사람처럼 보이도록 **주기적으로 입퇴장**한다 (동작 파라미터는 server.js 상단 `AI_*` 상수):
- 서버 시작 시 `AI_MIN_COUNT`(2명)로 시작, `scheduleNextAiJoin()`이 20~80초 간격으로
  입장 시도 (최대 `AI_MAX_COUNT` 10명)
- 각 봇은 2~7분(`leaveTime`) 머문 후 퇴장. 최소 인원 이하로 떨어지면 퇴장을 미룬다
- 이름은 `aiNamePool`(한/영 혼합)에서 중복 없이 선택, 무기/캐릭터(0~99)는 랜덤
- 입장 시 40% 확률로 인사, 퇴장 전 35% 확률로 작별 채팅 (`sendAiChat` — 유저 채팅과
  동일하게 기록/브로드캐스트됨)
- `user_count`는 실유저+AI 합산으로 브로드캐스트 (`broadcastUserCount()`)
- 퇴장 시 `removeAiPlayer()`가 문자열 키 삭제 + 숫자 인덱스 splice 둘 다 처리 (누수 방지)

모든 봇은 하나의 전역 `setInterval` 60fps 루프에서 `aiProcess(aiPlayer, now)`로 처리된다.

- 상태: `roam` → `chase` → `attack` (`aiPlayer.fsm.state`)
- 타겟은 객체 참조가 아니라 **id**(`fsm.targetId`)로 보관하고 매 틱 `resolveTarget()`으로
  다시 찾는다 — 접속 종료/사망한 타겟이 자동 무효화됨 (과거 유령 추격 버그의 원인)
- `roam`: 0.5% 확률로 랜덤 목적지 A* 경로, 아니면 제자리 회전 정찰. 적 발견 시 chase
- `chase`: 타겟 추격. 시야를 놓치면 마지막 목격 지점(`lastSeenX/Y`)을 수색하고,
  `AI_TARGET_LOST_TIMEOUT`(2.5초) 경과 또는 목격 지점 도착 시 roam 복귀.
  교전 거리(`AI_ATTACK_RANGE` 380px) 진입 시 attack
- `attack`: 정지 후 타겟 조준(타겟 방향 ±25도 이내일 때만 400ms 간격 사격).
  너무 가까우면(`AI_RETREAT_RANGE` 120px) 후퇴, 멀어지면 chase 복귀(히스테리시스 +80px)
- A* 재계산은 `AI_REPATH_INTERVAL`(300ms) 쿨다운으로 제한 (`repathToPoint`)
- **분리(separation)**: `applySeparation()`이 매 틱 다른 플레이어와 32px 미만으로 겹치면
  봇을 밀어낸다. 완전히 겹치면 탈출 방향을 고정(`separationEscapeAngle`)해 랜덤워크 방지,
  idle 상태면 destination도 같이 옮겨야 함(안 옮기면 aiMove가 도로 끌어당김 — 주석 참고)
- 피격 시 `aiAggro()`로 시야 밖 공격자에게도 즉시 반응 (방향 전환 + chase)
- 시야 판정 `getPlayersInSight()`: 전방 ±55도 부채꼴, 거리 700, `mapSegments`(벽 세그먼트)와
  레이 교차 검사로 벽 뒤 차폐 처리. 거리순 정렬 반환
- AI가 킬을 올리면 `resetToRoam()`을 호출하는 처리가 `shootProcess` 안에 있음
- 방향 회전은 `turnToward()`/`normalizeAngleDeg()`로 ±180 wrap 처리 (가까운 쪽으로 회전)

### 4. 맵 / 길찾기 (map-helper.js)
- 모듈 로드 시점에 클라이언트의 `map_office.js`를 읽어 `wall_tiles` 기준으로
  pathfinding Grid와 `walkablePositions`를 구축
- `findMapHitBoxes()`: 벽 타일을 그리디하게 직사각형(최대 32x32 타일)으로 묶고,
  `createSegments()`가 중복 변을 제거해 시야 레이캐스트용 `mapSegments` 생성
- 좌표계 주의: 길찾기는 타일 단위, 게임 로직은 픽셀 단위
  (`tile_width`/`tile_height` 곱·나눗셈으로 변환)
- `findPath`는 매번 `mapGrid.clone()` 사용 (A*가 그리드를 변형하기 때문)

### 5. 채팅
`user_chat` 수신 시 `<`/`>`를 HTML 엔티티로 이스케이프(XSS 방지) 후 브로드캐스트하고
파일에 append. `/`로 시작하는 메시지는 명령어로 예약되어 있으나 `runCommand`는 현재 빈 구현.

## 알려진 특이점

- package.json의 mysql, express, commander, yargs, websocket 패키지는 현재 코드에서 사용되지 않음 (실제 사용: ws, pathfinding)
- 커밋 메시지는 한/영 혼용, 코드 주석은 주로 한국어
