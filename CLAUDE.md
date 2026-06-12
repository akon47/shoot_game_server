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

## 파일 구성 (책임별 CommonJS 모듈)

| 파일 | 역할 |
|---|---|
| `server.js` | 진입점. WebSocket 연결 수락 + 클라이언트 메시지 라우팅만 담당 |
| `config.js` | 모든 튜닝 상수 (전투/AI/아이템/라운드/채팅). 클라이언트와 동일 값 유지 항목 주석 표시 |
| `state.js` | 공유 컬렉션 `clients`/`aiPlayers` + `forEachPlayer`/`countPlayers`/`resolvePlayer` 헬퍼 |
| `net.js` | `sendAll`(브로드캐스트), `sendTo`(개별), `sendServerChat`, `broadcastUserCount` |
| `chat-store.js` | 채팅 기록 메모리 보관 + `datas/user_chats.json` 영속화 (최근 100개 유지) |
| `combat.js` | 서버 권위 전투: 사격/근접/`applyDamage`/스폰 무적/펠릿 계산 |
| `ai.js` | AI 봇 FSM, 입퇴장, 이동/분리, 시야 판정. `start()`로 기동 |
| `items.js` | 아이템 스폰/획득 판정. `start()`로 기동 |
| `rounds.js` | 라운드 타이머/우승자 발표/킬스트릭 공지. `start()`로 기동 |
| `websocket-server.js` | HTTP 서버 + ws WebSocketServer 생성 팩토리 (`require(...)(port)`) |
| `map-helper.js` | 맵 그리드 로드, A* 길찾기(pathfinding 패키지), 벽 히트박스→세그먼트 변환 |
| `utils.js` | 기하 유틸: `shootIntersection`, `getDistance`, `getRayIntersection`, `normalizeAngleDeg` |
| `smoke-test.js` | 프로토콜 스모크 테스트 (`npm test`, 서버 실행 중이어야 함) |

의존 방향은 단방향이다: `server.js` → (combat/ai/items/rounds) → (net/state/config/utils).
**combat ↔ ai 순환 의존이 없도록**, AI 고유의 전투 반응은 플레이어 객체에 붙은 훅으로 처리한다
(`ai.js`의 `createAiPlayer`가 설정, `combat.applyDamage`가 호출):
`onDamaged(attackerId)` 생존 피격 시 어그로, `onScoredKill()` 킬 후 배회 복귀,
`respawn()` 사망 시 서버 직접 리스폰. 사람 플레이어는 훅이 없으므로 자동으로 건너뛴다.

코드 스타일: Prettier 기본 설정(2-space), 각 모듈 상단 `"use strict"`, 상수는 전부 `config.js`로.

## 통신 프로토콜

모든 메시지는 `{ type: string, data: any }` 형태의 JSON 문자열.

- 클라이언트 → 서버: `user_init`, `user_position`, `user_speed`, `user_name`,
  `user_chat`, `user_direction`, `user_character`, `user_weapon`, `user_shoot`,
  `user_melee_attack`, `user_reload`, `user_disconnected`, `echo`
- 서버 → 클라이언트(브로드캐스트): `user_connected`, `user_count`, `user_hp`,
  `user_die`, `user_kill`, `user_death`, `user_chat`, `user_chat_history`, `id`,
  `item_list`(접속 시 스냅샷)/`item_spawn`/`item_picked`, `round_info`,
  `server_notice`(킬스트릭/라운드 공지 — `{key, params}` 구조, 문구는 클라이언트
  locale_class.js 가 언어별로 렌더링), `ammo_refill`(획득자에게만 단독 전송)
  외에 위 상태 메시지들을 그대로 중계
- `user_shoot`의 `data.targetPoints`는 배열(샷건 펠릿 7개, 그 외 1개).
  펠릿마다 `shootProcess`를 호출한다. 클라·서버의 `SHOTGUN_PELLET_COUNT`/산탄각은 동일 값 유지.
- `user_connected`의 `protectedMs`: 남은 스폰 무적 시간(ms). `user_init`/AI 스폰·리스폰 시
  `invincibleUntil`이 설정되며, 무적 대상은 사격/근접 타겟팅에서 제외된다(`isProtected`).
- 프로토콜 스모크 테스트: 서버 실행 후 `node smoke-test.js` (펠릿/근접/장전/아이템/라운드 메시지 검증)

패턴: 클라이언트가 자기 상태 변경을 보내면 서버는 해당 클라이언트 객체에 저장 후
`sendAll(type, data)`로 전원에게 재방송한다. AI 봇도 동일한 `user_*` 메시지 타입을
사용하므로 클라이언트는 사람/AI를 구분하지 않는다 (id 접두사 `USER_` / `AI_`만 다름).

## 핵심 구현 패턴 (수정 시 반드시 인지할 것)

### 1. 배열을 맵처럼 쓰는 컬렉션 패턴
`clients`와 `aiPlayers`(state.js)는 `[]`로 선언되지만 실제로는 두 가지를 동시에 담는다:
- 숫자 인덱스: id 문자열 목록 (`clients.push(id)`)
- 문자열 키: 플레이어 객체 (`clients[id] = { ... }`)

**순회는 직접 루프 대신 반드시 `state.forEachPlayer(collection, fn)`을 사용한다**
(undefined 체크 내장). 개수는 `state.countPlayers()`, id 조회는 `state.resolvePlayer(id)`
(사람/AI 구분 없이 찾음 — id 접두사 `USER_`/`AI_`가 달라 충돌 없음).
제거 시에는 문자열 키 delete + 숫자 인덱스 splice 둘 다 처리한다 (server.js close 핸들러,
ai.js `removeAiPlayer` 참고).

### 2. 서버 권위(authoritative) 피격 판정 (combat.js)
`shootProcess()`가 총알을 선분(머즐→타겟)으로 보고 모든 플레이어의 AABB로 1차 필터 후
`shootIntersection`(선분-원, 반지름 `HIT_RADIUS`)으로 최종 판정. 가장 가까운 대상 하나만 피격.
무기별 데미지는 `config.WEAPON_DAMAGE`: handgun 10 / rifle 15 / shotgun 8(펠릿당, 1회 7펠릿).
근접 공격은 `meleeAttackProcess()`: 전방 ±60도·56px 내 가장 가까운 대상에게
knife 50 / 그 외 무기 20 데미지.

데미지 적용~사망/킬/데스/킬스트릭은 `applyDamage()` 한 곳에 공통화되어 있다.
사격·근접 모두 이 함수를 거치며, 스폰 무적(`isProtected`) 대상은 타겟팅 단계에서 제외된다.

- 사람 사망: `user_die` + 킬/데스 카운트 전파 (리스폰은 클라이언트가 처리)
- AI 사망: `respawn()` 훅으로 서버가 즉시 hp 100 리셋 + 랜덤 위치 + `user_connected` 재전송
- 킬스트릭: `KILLSTREAK_MILESTONES`(3/5/7/10킬) 달성 시 공지(rounds.js `announceKill`),
  스트릭 보유자 처치 시 저지 공지. 공지는 `net.sendServerNotice(key, params)`로 보낸다 —
  문자열 조립/이스케이프는 서버가 하지 않고 클라이언트 locale_class.js 가 담당한다.
  새 공지 key를 추가하면 클라이언트 `LOCALE_STRINGS`(en/ko)에도 추가해야 한다.

### 2-1. 라운드 (rounds.js) / 아이템 (items.js)
- 라운드: `ROUND_DURATION`(10분)마다 `endRound()`가 우승자 공지 후 전원 킬/데스/스트릭 리셋.
  `round_info`(남은 ms)는 접속 시 + 10초마다 브로드캐스트, 사이는 클라이언트가 로컬 카운트다운.
- 아이템: `items` 맵(`ITEM_` id)에 메드킷/탄약 상자를 보관. 12~25초 간격 스폰(최대 6개),
  100ms 간격 `checkItemPickups()`가 거리 28px 이내 획득 판정. 메드킷은 hp<100인 대상만,
  AI는 메드킷만 줍는다. 탄약은 클라이언트 권위라 획득자에게 `ammo_refill`만 보낸다.

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
- 타겟은 객체 참조가 아니라 **id**(`fsm.targetId`)로 보관하고 매 틱 `state.resolvePlayer()`로
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
- AI가 킬을 올리면 `onScoredKill` 훅이 `resetToRoam()`을 호출한다 (combat → 훅 → ai)
- 방향 회전은 `turnToward()`/`normalizeAngleDeg()`(utils.js)로 ±180 wrap 처리 (가까운 쪽으로 회전)

### 4. 맵 / 길찾기 / 라운드 로테이션 (map-helper.js)
- 모듈 로드 시점에 `config.MAP_ROTATION`의 모든 맵(`../shoot_game/map_{name}.js`)을 읽어
  맵별 pathfinding Grid/`walkablePositions`/세그먼트를 구축하고 "활성 맵"을 전환한다.
  활성 맵 의존 함수: `getWalkableRandomPosition`/`isWalkablePosition`/`set*DestinationPath`/
  `getMapSegments`(시야 레이캐스트 — 배열을 직접 import 하지 말고 매번 호출할 것).
- 라운드가 끝나면 rounds.js 가 `MAP_ROTATION` 순서대로 `setActiveMap()` 후
  `map_changed` 공지 + `onRoundEnd` 훅 실행(server.js 가 AI 리스폰/아이템 재배치 등록).
  클라이언트는 `round_info.map`을 보고 스스로 새 맵에서 리스폰(user_init)한다.
  접속 시에는 `round_info`를 `id`보다 먼저 보내야 첫 스폰 맵이 맞는다 (server.js 주석 참고).
- `findMapHitBoxes()`: 벽 타일을 그리디하게 직사각형(최대 32x32 타일)으로 묶고,
  `createSegments()`가 중복 변을 제거해 시야 레이캐스트용 세그먼트 생성
- 좌표계 주의: 길찾기는 타일 단위, 게임 로직은 픽셀 단위
  (`tile_width`/`tile_height` 곱·나눗셈으로 변환)
- `findPath`는 매번 `grid.clone()` 사용 (A*가 그리드를 변형하기 때문)
- 새 맵 추가: 클라이언트 `tools/generate_maps.js`로 생성 → 클라 framework.js/map_registry.js
  등록 → 서버 `MAP_ROTATION`에 추가 (이름이 곧 파일명/프로토콜 키)

### 5. 채팅
`user_chat` 수신 시 `<`/`>`를 HTML 엔티티로 이스케이프(XSS 방지) 후 브로드캐스트하고
`chat-store.append()`로 파일에 남긴다. `/`로 시작하는 메시지는 명령어로 예약(미구현, 무시됨).

## 알려진 특이점

- 커밋 메시지는 한/영 혼용, 코드 주석은 주로 한국어
