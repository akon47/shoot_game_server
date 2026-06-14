"use strict";

// 게임 서버 튜닝 상수 모음.
// "클라이언트와 동일 값 유지"라고 표시된 값은 클라이언트 저장소의 해당 파일과 같이 수정해야 한다.

module.exports = {
  PORT: 8080,

  // 전투
  SPAWN_PROTECTION_DURATION: 3000, // 스폰/리스폰 직후 무적 시간(ms). 클라이언트 system_class.js 와 동일 값 유지
  SHOTGUN_PELLET_COUNT: 7, // 샷건 1회 발사 펠릿 수. 클라이언트 player_class.js 와 동일 값 유지
  SHOTGUN_SPREAD_ANGLE: (Math.PI / 180) * 12, // 샷건 산탄 각도. 클라이언트와 동일 값 유지
  WEAPON_DAMAGE: {
    handgun: 10,
    rifle: 15,
    shotgun: 8, // 펠릿 1발당 데미지 (한 번에 SHOTGUN_PELLET_COUNT 발)
  },
  SHOOT_RANGE: 1000, // 탄도 최대 사거리(px)
  HIT_RADIUS: 16, // 피격 판정 원 반지름(px)
  MELEE_RANGE: 56, // 근접 공격 사거리(중심 간 거리, px)
  MELEE_ANGLE_TOLERANCE: 60, // 근접 공격 유효 각도(공격자 방향 기준 ±도)
  MELEE_KNIFE_DAMAGE: 50, // 나이프 근접 데미지
  MELEE_BASH_DAMAGE: 20, // 총기류 개머리판 근접 데미지

  // AI 동작
  AI_SIGHT_RANGE: 700, // 시야 거리(px)
  AI_ATTACK_RANGE: 380, // 이 거리 안이면 정지 후 사격
  AI_ATTACK_RANGE_BUFFER: 80, // attack -> chase 전환 히스테리시스(px)
  AI_RETREAT_RANGE: 120, // 타겟이 이 거리보다 가까우면 거리 벌리기
  AI_REPATH_INTERVAL: 300, // A* 경로 재계산 최소 간격(ms)
  AI_TARGET_LOST_TIMEOUT: 2500, // 타겟을 시야에서 놓친 후 추격 포기까지(ms)
  AI_LAST_SEEN_ARRIVE_DISTANCE: 48, // 마지막 목격 지점 도착 판정 거리(px)
  AI_SHOOT_INTERVAL: 400, // 사격 간격(ms)
  AI_SHOOT_FACING_TOLERANCE: 25, // 타겟 방향과 이 각도(도) 이내일 때만 사격
  AI_MOVE_SPEED: 3, // 프레임당 이동량(px)
  AI_BODY_DISTANCE: 32, // 플레이어끼리 유지해야 하는 최소 중심 거리(px)
  AI_SPAWN_MIN_DISTANCE: 200, // 스폰 시 다른 플레이어와 최소 거리(px)

  // AI 입퇴장(인구)
  AI_MAX_COUNT: 10, // 동시 접속 AI 최대 수
  AI_MIN_COUNT: 2, // 방이 비지 않도록 유지할 최소 수
  AI_JOIN_INTERVAL_MIN: 20 * 1000, // 다음 입장 시도까지 최소 간격(ms)
  AI_JOIN_INTERVAL_MAX: 80 * 1000, // 다음 입장 시도까지 최대 간격(ms)
  AI_STAY_DURATION_MIN: 2 * 60 * 1000, // 입장 후 머무는 최소 시간(ms)
  AI_STAY_DURATION_MAX: 7 * 60 * 1000, // 입장 후 머무는 최대 시간(ms)
  AI_GREETING_CHANCE: 0.4, // 입장 시 인사 채팅 확률
  AI_FAREWELL_CHANCE: 0.35, // 퇴장 전 작별 채팅 확률

  AI_NAME_POOL: [
    "초코우유",
    "감자튀김",
    "야근중",
    "총잡이김씨",
    "옆집형",
    "고양이발바닥",
    "롤하다옴",
    "서울촌놈",
    "물복숭아",
    "겜잘알",
    "닉네임뭐하지",
    "불꽃남자",
    "피곤한직장인",
    "김밥천국",
    "달리는거북이",
    "Shadow",
    "nova7",
    "PewPew",
    "Ghost99",
    "mango",
    "Rookie",
    "headshot_kim",
    "ZeroCool",
    "BlueBerry",
    "xXSniperXx",
    "lucky",
    "DancingPotato",
    "Bro",
    "Ballmer",
  ],
  AI_GREETINGS: [
    "ㅎㅇ",
    "ㅎㅇㅎㅇ",
    "안녕하세요",
    "hi",
    "hello~",
    "왔습니다",
    "다들 ㅎㅇ",
  ],
  AI_FAREWELLS: [
    "ㅂㅂ",
    "전 이만",
    "bye",
    "gg",
    "밥먹으러 갑니다",
    "잘있어요~",
    "나중에 또 봐요",
  ],
  AI_WEAPONS: ["handgun", "rifle", "shotgun"],

  // 아이템
  ITEM_MAX_COUNT: 6, // 맵에 동시에 존재하는 아이템 최대 수
  ITEM_INITIAL_COUNT: 3, // 서버 시작 시 미리 깔아두는 아이템 수
  ITEM_SPAWN_INTERVAL_MIN: 12 * 1000, // 다음 아이템 스폰까지 최소 간격(ms)
  ITEM_SPAWN_INTERVAL_MAX: 25 * 1000, // 다음 아이템 스폰까지 최대 간격(ms)
  ITEM_PICKUP_DISTANCE: 28, // 아이템 획득 판정 거리(px)
  ITEM_MEDKIT_HEAL: 50, // 메드킷 회복량

  // PvE 침공(스켈레톤 떼). 몬스터는 100% 서버 권위이며 monster_* 프로토콜로 전파한다.
  // 클라이언트는 보관/렌더링만 한다(item 과 동일). 동일 값 동기화가 필요한 상수 없음.
  MONSTER_HP: 60, // 스켈레톤 1마리 체력
  MONSTER_MOVE_SPEED: 3.5, // 몬스터 루프(30fps) 틱당 이동량(px). 봇(60fps·3px)보다 느리게
  MONSTER_SIGHT_RANGE: 1400, // 추격 대상 탐지 거리(px). 벽 무시(냄새로 추적), 경로는 A* 로 우회
  MONSTER_ATTACK_RANGE: 46, // 접촉 공격 사거리(중심 간 거리, px)
  MONSTER_ATTACK_DAMAGE: 8, // 접촉 공격 1회 데미지
  MONSTER_ATTACK_INTERVAL: 800, // 접촉 공격 쿨다운(ms)
  MONSTER_REPATH_INTERVAL: 500, // 추격 경로 재계산 최소 간격(ms)
  MONSTER_BODY_DISTANCE: 26, // 몬스터끼리 유지하는 최소 중심 거리(px)
  MONSTER_SPAWN_MIN_DISTANCE: 360, // 스폰 시 살아있는 플레이어와 최소 거리(px)
  MONSTER_KILL_SCORE: 1, // 몬스터 처치 시 킬 점수 가산량(리더보드/킬스트릭 반영)

  // 침공 디렉터: 일정 간격마다 사이렌 후 웨이브로 몬스터를 풀어놓는다
  INVASION_INTERVAL_MIN: 3 * 60 * 1000, // 다음 침공까지 최소 간격(ms)
  INVASION_INTERVAL_MAX: 5 * 60 * 1000, // 다음 침공까지 최대 간격(ms)
  INVASION_WARN_DELAY: 5 * 1000, // 사이렌 공지 후 첫 등장까지(ms)
  INVASION_DURATION_MAX: 100 * 1000, // 미처치 시 강제 종료까지(ms)
  INVASION_WAVES: 3, // 한 침공당 웨이브 수
  INVASION_WAVE_INTERVAL: 14 * 1000, // 웨이브 사이 간격(ms)
  INVASION_BASE_COUNT: 4, // 웨이브당 기본 마릿수
  INVASION_PER_COMBATANT: 1, // 전투원(사람+봇) 1명당 추가 마릿수
  INVASION_MAX_ALIVE: 28, // 동시 생존 몬스터 상한

  // 라운드/킬스트릭
  ROUND_DURATION: 10 * 60 * 1000, // 라운드 길이(ms)
  // 라운드마다 순환하는 맵 목록. ../shoot_game/map_{name}.js 파일과
  // 클라이언트 map_registry.js 의 키 이름이 일치해야 한다.
  // 첫 번째 항목이 서버 시작 시 활성 맵이며, 클라이언트 DEFAULT_MAP_NAME 과 같아야 한다.
  MAP_ROTATION: ["office", "arena", "ruins"],
  // 공지를 보내는 연속 킬 수. 공지 문구는 클라이언트 locale_class.js 가
  // 현재 언어로 렌더링한다 (killstreak_{n} 키 — 양쪽 같이 수정)
  KILLSTREAK_MILESTONES: [3, 5, 7, 10],

  // 채팅
  CHAT_HISTORY_LIMIT: 100, // 보관/전송할 최근 채팅 수
};
